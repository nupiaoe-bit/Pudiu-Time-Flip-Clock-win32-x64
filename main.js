/**
 * Pudiu Time 桌面版 · 主进程
 * ------------------------------------------------------------
 * 职责：
 *  1. 创建无边框主窗口、系统托盘、开机自启、窗口置顶、多显示器投放
 *  2. 注册 media:// 自定义协议，安全地把本地视频/图片以流式方式交给渲染进程
 *  3. 本地配置持久化（%APPDATA%/pudiu-time-desktop/config.json）
 *  4. 提供文件选择、缩略图保存等桌面能力给渲染进程（preload 桥接）
 */
const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, Tray, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsSync = require('fs');
const fsp = require('fs/promises');
const { Readable } = require('stream');
const os = require('os');

// ============ 简易文件日志（GUI 程序无控制台，排障用） ============
const LOG_FILE = path.join(os.tmpdir(), 'pudiu-time-desktop.log');
try { fsSync.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] --- boot ---\n`); } catch (e) {}
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try { fsSync.appendFileSync(LOG_FILE, line); } catch (e) {}
  console.log(...args);
}
process.on('uncaughtException', (e) => { log('[uncaughtException]', e && e.stack ? e.stack : String(e)); });
process.on('unhandledRejection', (e) => { log('[unhandledRejection]', e && e.stack ? e.stack : String(e)); });

// ============ 单实例锁 ============
if (!app || typeof app.requestSingleInstanceLock !== 'function') {
  // 被 ELECTRON_RUN_AS_NODE=1 影响时会走到这里（Electron 被当成纯 Node 执行）
  log('[fatal] 未运行在 Electron 主进程中，请检查环境变量 ELECTRON_RUN_AS_NODE 是否被设置为 1');
  process.exit(1);
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

const IS_DEV = process.argv.includes('--dev');
let mainWindow = null;
let tray = null;

// ============ 路径 ============
const USER_DATA = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA, 'config.json');
const THUMB_DIR = path.join(USER_DATA, 'thumbs');

function ensureDirs() {
  if (!fsSync.existsSync(THUMB_DIR)) fsSync.mkdirSync(THUMB_DIR, { recursive: true });
}

// ============ 默认配置 ============
function defaultConfig() {
  let tz = 'Asia/Shanghai';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
  return {
    version: 1,
    lang: 'zh-CN',
    tz,
    hourFormat: '24',
    scale: 1,
    font: "'Inter', sans-serif",
    cardBg: '#1a1a1c',
    fontColor: '#f5f5f7',
    showClock: true,
    mirrorX: false,
    mirrorY: false,
    audio: { enabled: false, volume: 0.5, path: null, name: null },
    bg: { mode: 'online', id: 'i1', color: '#000000' },
    // 本地素材库
    library: [],
    // 轮播播放列表（存素材 id 顺序）
    playlist: [],
    carousel: { enabled: false, interval: 30, shuffle: false, mute: false, videoVolume: 0.8 },
    // Bing 每日壁纸
    bing: { auto: false, date: null, url: null },
    // 桌面投放参数
    desktop: {
      openAtLogin: false,
      alwaysOnTop: false,
      displayId: null,
      minimizeToTray: true,
      startFullscreen: false,
      showCloseConfirm: true
    },
    dockCities: [
      { tz: 'America/New_York', cityEn: 'New York', icon: '🇺🇸' },
      { tz: 'Europe/London', cityEn: 'London', icon: '🇬🇧' },
      { tz: 'Asia/Tokyo', cityEn: 'Tokyo', icon: '🇯🇵' }
    ]
  };
}

function loadConfig() {
  try {
    if (fsSync.existsSync(CONFIG_FILE)) {
      const raw = fsSync.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return deepMerge(defaultConfig(), parsed);
    }
  } catch (e) {
    console.error('[config] 读取失败，使用默认配置：', e.message);
  }
  return defaultConfig();
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

let CONFIG = defaultConfig();
let saveTimer = null;
function saveConfig(patch) {
  if (patch) CONFIG = deepMerge(CONFIG, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8');
    } catch (e) { console.error('[config] 写入失败', e); }
  }, 120);
}

// ============ media:// 本地素材协议（支持 Range，视频可拖动/循环） ============
protocol.registerSchemesAsPrivileged([
  {
    // corsEnabled 必须开启，否则渲染层带 crossOrigin 的请求会被 Chromium 的 CORS 策略拦截
    // （典型现象：本地视频/图片加载失败、canvas 缩略图抓取失败）
    scheme: 'media',
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, stream: true,
      bypassCSP: true, corsEnabled: true, allowServiceWorkers: true
    }
  }
]);

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac'
};

function decodeMediaUrl(url) {
  // media://local/<encodeURIComponent(绝对路径)>
  let p = url.replace(/^media:\/\//i, '');
  p = p.replace(/^local\//i, '');
  try { p = decodeURIComponent(p); } catch (e) {}
  p = p.split('?')[0];
  return p;
}

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const filePath = decodeMediaUrl(request.url);
      if (!filePath || !fsSync.existsSync(filePath)) {
        return new Response('Not Found: ' + filePath, { status: 404 });
      }
      const stat = fsSync.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        let start = 0, end = stat.size - 1;
        if (m) {
          if (m[1]) start = parseInt(m[1], 10);
          if (m[2]) end = parseInt(m[2], 10);
        }
        if (start >= stat.size) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        const stream = Readable.toWeb(fsSync.createReadStream(filePath, { start, end }));
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        headers['Content-Length'] = String(end - start + 1);
        return new Response(stream, { status: 206, headers });
      }

      const stream = Readable.toWeb(fsSync.createReadStream(filePath));
      headers['Content-Length'] = String(stat.size);
      return new Response(stream, { status: 200, headers });
    } catch (e) {
      return new Response('Error: ' + e.message, { status: 500 });
    }
  });
}

// ============ 创建窗口 ============
function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const target = CONFIG.desktop.displayId
    ? (screen.getAllDisplays().find(d => String(d.id) === String(CONFIG.desktop.displayId)) || primary)
    : primary;

  mainWindow = new BrowserWindow({
    width: Math.min(1440, target.workAreaSize.width),
    height: Math.min(900, target.workAreaSize.height),
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    minWidth: 520,
    minHeight: 380,
    frame: false,                 // 无边框，标题栏由渲染层自绘
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,   // 后台不降频，保证走时/轮播准确
      webSecurity: true
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 渲染层日志转发到文件（便于排障：%TEMP%/pudiu-time-desktop.log）
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    log(`[renderer:${level}] ${message} @${sourceId}:${line}`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => log('[did-fail-load]', code, desc));
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => log('[preload-error]', preloadPath, error && error.message));
  mainWindow.webContents.on('render-process-gone', (_e, details) => log('[render-process-gone]', details && details.reason));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (CONFIG.desktop.startFullscreen) mainWindow.setFullScreen(true);
  });

  mainWindow.on('close', (e) => {
    if (CONFIG.desktop.minimizeToTray && !(global.__forceQuit === true)) {
      e.preventDefault();
      mainWindow.hide();
      showTrayNotice();
      return;
    }
    saveConfig();
    try { fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8'); } catch (err) {}
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // 关闭时若用户想退出，走 forceQuit
  app.on('before-quit', () => { global.__forceQuit = true; });
}

function showTrayNotice() {
  if (!tray) return;
  tray.displayBalloon({
    iconType: 'info',
    title: 'Pudiu Time 桌面版',
    content: '程序已最小化到系统托盘，双击托盘图标可重新打开。'
  });
}

// ============ 系统托盘 ============
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  if (!fsSync.existsSync(iconPath)) return;
  tray = new Tray(iconPath);
  tray.setToolTip('Pudiu Time 桌面版');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏窗口', click: () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); } },
    { label: '进入全屏投放', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.setFullScreen(true); } } },
    { label: '打开配置目录', click: () => shell.openPath(USER_DATA) },
    { type: 'separator' },
    { label: '退出程序', click: () => { global.__forceQuit = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); });
}

// ============ 开机自启 ============
function applyLoginItem() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!CONFIG.desktop.openAtLogin,
      openAsHidden: true,
      args: ['--startup']
    });
  } catch (e) { console.error('[loginItem]', e); }
}

// ============ IPC ============
function setupIpc() {
  ipcMain.handle('config:get', () => CONFIG);
  ipcMain.handle('config:set', (_e, patch) => {
    saveConfig(patch);
    if (patch && patch.desktop && 'openAtLogin' in patch.desktop) applyLoginItem();
    if (patch && patch.desktop && 'alwaysOnTop' in patch.desktop && mainWindow) {
      mainWindow.setAlwaysOnTop(!!patch.desktop.alwaysOnTop, 'screen-saver');
    }
    return CONFIG;
  });
  ipcMain.handle('config:reset', () => {
    CONFIG = defaultConfig();
    try { fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8'); } catch (e) {}
    applyLoginItem();
    if (mainWindow) mainWindow.setAlwaysOnTop(false);
    return CONFIG;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: USER_DATA,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node
  }));

  ipcMain.handle('app:login-settings', () => app.getLoginItemSettings());

  ipcMain.handle('dialog:pick-media', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地视频 / 图片素材（可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '媒体文件', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogv'] },
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (res.canceled) return [];
    return res.filePaths.map(p => ({
      path: p,
      name: path.basename(p),
      ext: path.extname(p).toLowerCase().replace('.', ''),
      size: (() => { try { return fsSync.statSync(p).size; } catch (e) { return 0; } })(),
      kind: /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i.test(p) ? 'video' : 'image'
    }));
  });

  ipcMain.handle('dialog:pick-audio', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择本地背景音乐',
      properties: ['openFile'],
      filters: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }]
    });
    if (res.canceled) return null;
    const p = res.filePaths[0];
    return { path: p, name: path.basename(p) };
  });

  // 内置静态资源（file:// 下渲染层无法直接 fetch，改由主进程读取）
  ipcMain.handle('asset:read', (_e, name) => {
    try {
      const safe = String(name).replace(/[\\/]+/g, '');
      const file = path.join(__dirname, 'src', safe);
      return fsSync.readFileSync(file, 'utf8');
    } catch (e) {
      log('[asset:read] 失败:', name, e && e.message);
      return null;
    }
  });

  ipcMain.handle('media:url', (_e, absPath) => 'media://local/' + encodeURIComponent(absPath));
  ipcMain.handle('media:exists', (_e, absPath) => {
    try { return fsSync.existsSync(absPath); } catch (e) { return false; }
  });

  // 保存渲染层生成的视频缩略图（dataURL -> 文件）
  ipcMain.handle('thumb:save', async (_e, id, dataUrl) => {
    try {
      ensureDirs();
      const base64 = String(dataUrl).split(',')[1] || '';
      const file = path.join(THUMB_DIR, id.replace(/[^a-zA-Z0-9_-]/g, '') + '.png');
      await fsp.writeFile(file, Buffer.from(base64, 'base64'));
      return file;
    } catch (e) { return null; }
  });

  ipcMain.handle('shell:open-dir', (_e, dir) => { shell.openPath(dir || USER_DATA); return true; });
  ipcMain.handle('shell:show-item', (_e, filePath) => { if (filePath) shell.showItemInFolder(filePath); return true; });

  ipcMain.handle('display:list', () => screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `显示器 ${i + 1}`,
    primary: d.primary || false,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    size: `${d.bounds.width}x${d.bounds.height}`
  })));

  ipcMain.handle('display:move', (_e, id) => {
    if (!mainWindow) return false;
    const target = screen.getAllDisplays().find(d => String(d.id) === String(id));
    if (!target) return false;
    const b = target.bounds;
    mainWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    saveConfig({ desktop: { displayId: id } });
    return true;
  });

  ipcMain.handle('win:control', (_e, action) => {
    if (!mainWindow) return false;
    switch (action) {
      case 'minimize': mainWindow.minimize(); break;
      case 'maximize': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
      case 'hide': mainWindow.hide(); break;
      case 'close':
        global.__forceQuit = true;
        try { fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8'); } catch (err) {}
        app.quit();
        break;
      case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); break;
      case 'is-fullscreen': return mainWindow.isFullScreen();
      case 'always-on-top': {
        const next = !mainWindow.isAlwaysOnTop();
        mainWindow.setAlwaysOnTop(next, 'screen-saver');
        saveConfig({ desktop: { alwaysOnTop: next } });
        return next;
      }
      default: break;
    }
    return true;
  });

  ipcMain.handle('app:quit', () => {
    global.__forceQuit = true;
    try { fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8'); } catch (err) {}
    app.quit();
  });
}

// ============ 启动 ============
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  log('whenReady: userData =', USER_DATA);
  ensureDirs();
  CONFIG = loadConfig();
  log('config loaded, displays =', screen.getAllDisplays().length);
  registerMediaProtocol();
  setupIpc();
  createWindow();
  log('window created');
  createTray();
  applyLoginItem();
  if (CONFIG.desktop.alwaysOnTop && mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    try { fsSync.writeFileSync(CONFIG_FILE, JSON.stringify(CONFIG, null, 2), 'utf8'); } catch (e) {}
    app.quit();
  }
});

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
