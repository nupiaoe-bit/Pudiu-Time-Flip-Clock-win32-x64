/**
 * 预加载脚本：为渲染进程提供受控的桌面能力（contextIsolation 安全桥接）
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  // 应用信息
  getInfo: () => ipcRenderer.invoke('app:info'),
  getLoginSettings: () => ipcRenderer.invoke('app:login-settings'),

  // 文件选择
  pickMedia: () => ipcRenderer.invoke('dialog:pick-media'),
  pickAudio: () => ipcRenderer.invoke('dialog:pick-audio'),

  // 内置静态资源
  readAsset: (name) => ipcRenderer.invoke('asset:read', name),

  // 本地素材
  mediaUrl: (absPath) => ipcRenderer.invoke('media:url', absPath),
  mediaExists: (absPath) => ipcRenderer.invoke('media:exists', absPath),
  saveThumb: (id, dataUrl) => ipcRenderer.invoke('thumb:save', id, dataUrl),

  // 外壳
  openDir: (dir) => ipcRenderer.invoke('shell:open-dir', dir),
  showItem: (filePath) => ipcRenderer.invoke('shell:show-item', filePath),

  // 显示器
  listDisplays: () => ipcRenderer.invoke('display:list'),
  moveToDisplay: (id) => ipcRenderer.invoke('display:move', id),

  // 窗口与退出
  win: (action) => ipcRenderer.invoke('win:control', action),
  quit: () => ipcRenderer.invoke('app:quit')
});
