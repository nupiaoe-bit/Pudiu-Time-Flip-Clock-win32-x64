/* =========================================================================
 * Pudiu Time 桌面版 · 渲染进程主逻辑
 * 模块：配置 / 多语言 / 翻页走时 / 时区底座 / 壁纸与轮播 / 素材库 / 桌面投放
 * ========================================================================= */
const api = window.desktopAPI;
if (!api) {
  document.body.innerHTML = '<div style="color:#fff;padding:40px;font:16px/1.8 sans-serif">预加载脚本未加载，请在 Electron 环境中运行本程序。</div>';
  throw new Error('desktopAPI missing');
}

// ----------------------------- 全局状态 -----------------------------
let CONFIG = null;
let i18nConfig = {};
let bgDataList = [];
let library = [];          // 本地素材库
let playlist = [];         // 轮播播放列表（素材 id 顺序）
let seqIndex = 0;          // 当前序列游标
let currentItem = null;    // 当前背景项
let carouselTimer = null;
let carouselRunning = false;

let currentLang = 'zh-CN';
let currentTz = 'Asia/Shanghai';
let is24Hour = true;
let currentTimes = { 'hours-tens': -1, 'hours-ones': -1, 'minutes-tens': -1, 'minutes-ones': -1, 'seconds-tens': -1, 'seconds-ones': -1 };
let flipTimeouts = {};
let localCityName = '';
let isLocked = false;
let standbyHintTimer = null;
let lockCooldown = false;
let isFlipX = false;
let isFlipY = false;
let appInfo = {};

const rtlLanguages = ['ar', 'he', 'fa'];
const tzToCityKey = {
  'Asia/Shanghai': 'city_Beijing', 'Asia/Tokyo': 'city_Tokyo', 'Asia/Seoul': 'city_Seoul', 'Asia/Singapore': 'city_Singapore',
  'Asia/Bangkok': 'city_Bangkok', 'Asia/Dubai': 'city_Dubai', 'Europe/London': 'city_London', 'Europe/Paris': 'city_Paris',
  'Europe/Berlin': 'city_Berlin', 'Europe/Rome': 'city_Rome', 'Europe/Moscow': 'city_Moscow', 'America/New_York': 'city_NewYork',
  'America/Los_Angeles': 'city_LosAngeles', 'America/Chicago': 'city_Chicago', 'America/Toronto': 'city_Toronto',
  'America/Sao_Paulo': 'city_SaoPaulo', 'Australia/Sydney': 'city_Sydney', 'Pacific/Auckland': 'city_Auckland',
  'Africa/Cairo': 'city_Cairo', 'Africa/Johannesburg': 'city_Johannesburg'
};

const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2200) {
  const box = $('toast-box');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

/** 确保音频元素有可用音源（重启后从配置里恢复上次选择的本地音频） */
async function ensureAudioSource() {
  const audio = $('ambient-audio');
  if (audio && audio.src && audio.src !== location.href) return true;
  const p = CONFIG.audio && CONFIG.audio.path;
  if (!p) return false;
  const exists = await api.mediaExists(p);
  if (!exists) { console.error('[audio] 文件已不存在:', p); return false; }
  audio.src = mediaUrlOf(p);
  audio.load();
  console.log('[audio] 已恢复音源:', p);
  return true;
}

function getLocalizedCityName(tz, fallback) {
  const t = i18nConfig[currentLang] || i18nConfig.en || {};
  const key = tzToCityKey[tz];
  return (key && t[key]) ? t[key] : fallback;
}

// ============================ 1. 多语言 ============================
function applyTranslations() {
  const t = i18nConfig[currentLang] || i18nConfig.en || {};
  // 桌面版：窗口标题固定为产品名（网页 SEO 标题过长，不适合作为客户端窗口/任务栏标题）
  document.title = 'Pudiu Time 桌面版';
  document.querySelectorAll('[data-i18n]').forEach(el => { if (t[el.dataset.i18n]) el.innerText = t[el.dataset.i18n]; });
  document.documentElement.dir = rtlLanguages.includes(currentLang) ? 'rtl' : 'ltr';
  const activeLi = document.querySelector(`.lang-dropdown-list li[data-lang="${currentLang}"]`);
  if (activeLi) {
    $('current-lang-display').innerHTML = `🌐 ${activeLi.innerText}`;
    document.querySelectorAll('.lang-dropdown-list li').forEach(li => li.classList.remove('active'));
    activeLi.classList.add('active');
  }
  renderDock();
  updateTime();
}

// ============================ 2. 走时引擎 ============================
function updateTime() {
  const now = new Date();
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: currentTz, hour12: !is24Hour, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  } catch (e) {
    parts = new Intl.DateTimeFormat('en-US', { hour12: !is24Hour, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  }
  let h = (parts.find(p => p.type === 'hour') || { value: '00' }).value;
  const m = (parts.find(p => p.type === 'minute') || { value: '00' }).value;
  const s = (parts.find(p => p.type === 'second') || { value: '00' }).value;
  if (is24Hour && h === '24') h = '00';
  h = h.padStart(2, '0');

  updateUnit('hours-tens', h[0]); updateUnit('hours-ones', h[1]);
  updateUnit('minutes-tens', m[0]); updateUnit('minutes-ones', m[1]);
  updateUnit('seconds-tens', s[0]); updateUnit('seconds-ones', s[1]);

  const ampmEl = $('display-ampm');
  const ampmPart = parts.find(p => p.type === 'dayPeriod');
  if (!is24Hour && ampmPart) { ampmEl.style.display = 'inline-block'; ampmEl.innerText = ampmPart.value.toUpperCase(); }
  else { ampmEl.style.display = 'none'; }

  try {
    $('display-date').innerText = new Intl.DateTimeFormat(currentLang, { timeZone: currentTz, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  } catch (e) {
    $('display-date').innerText = now.toLocaleDateString();
  }
}

function updateUnit(id, newVal) {
  if (currentTimes[id] === newVal) return;
  const unit = $(id);
  if (!unit) return;
  const topBg = unit.querySelector('.top-bg span'), bottomBg = unit.querySelector('.bottom-bg span');
  const topFlip = unit.querySelector('.top-flip span'), bottomFlip = unit.querySelector('.bottom-flip span');
  const oldVal = currentTimes[id];

  if (oldVal === -1) {
    currentTimes[id] = newVal;
    topBg.innerText = newVal; bottomBg.innerText = newVal; topFlip.innerText = newVal; bottomFlip.innerText = newVal;
    return;
  }
  currentTimes[id] = newVal;
  if (flipTimeouts[id]) clearTimeout(flipTimeouts[id]);
  topBg.innerText = newVal; bottomBg.innerText = oldVal; topFlip.innerText = oldVal; bottomFlip.innerText = newVal;
  unit.classList.remove('is-flipping'); void unit.offsetWidth; unit.classList.add('is-flipping');
  flipTimeouts[id] = setTimeout(() => {
    topFlip.innerText = newVal; bottomBg.innerText = newVal; unit.classList.remove('is-flipping');
  }, 850);
}

function scheduleNextTick() {
  const now = new Date();
  setTimeout(() => { updateTime(); scheduleNextTick(); }, 1000 - now.getMilliseconds());
}

// ============================ 3. 时区底座 ============================
const dockContainer = $('dock-container');
const tzModal = $('tz-modal');
let dockCities = [];

function renderDock() {
  if (!dockContainer) return;
  dockContainer.innerHTML = '';
  const t = i18nConfig[currentLang] || i18nConfig.en || {};

  const localBtn = document.createElement('button');
  localBtn.className = 'dock-btn active';
  localBtn.dataset.tz = currentTz;
  const localName = localCityName || (tzToCityKey[currentTz] ? getLocalizedCityName(currentTz, currentTz) : currentTz);
  localBtn.dataset.city = localName;
  localBtn.innerHTML = `${t.localTxt || '📍 当前：'}${localName}`;
  dockContainer.appendChild(localBtn);

  dockCities.forEach(item => {
    const btn = document.createElement('button');
    btn.className = `dock-btn ${currentTz === item.tz ? 'active' : ''}`;
    btn.dataset.tz = item.tz;
    const locName = getLocalizedCityName(item.tz, item.cityEn);
    btn.dataset.city = locName;
    btn.innerHTML = `${item.icon} ${locName}`;
    dockContainer.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'dock-btn add-btn';
  addBtn.innerHTML = t.addMoreTz || '🌍 更多地区';
  addBtn.onclick = (e) => { e.stopPropagation(); tzModal.classList.add('show'); };
  dockContainer.appendChild(addBtn);
}

async function initLocation() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('http://ip-api.com/json/', { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data && data.status === 'success') {
      localCityName = (data.city || '').toUpperCase();
      if (!CONFIG.__tzManual && data.timezone) currentTz = data.timezone;
    }
  } catch (e) {
    localCityName = currentTz.split('/').pop().replace(/_/g, ' ').toUpperCase();
  }
  $('display-city').innerText = tzToCityKey[currentTz] ? getLocalizedCityName(currentTz, localCityName) : (localCityName || currentTz);
  renderDock();
  updateTime();
}

// ============================ 4. 背景与轮播引擎 ============================
const bgLayer = $('bg-layer');

function mediaUrlOf(absPath) { return 'media://local/' + encodeURIComponent(absPath); }

/** 视频音量：0~1，缺省 0.8 */
function videoVolume() {
  const v = CONFIG.carousel && CONFIG.carousel.videoVolume;
  return typeof v === 'number' ? Math.min(1, Math.max(0, v)) : 0.8;
}

function syncBgVideoVolume() {
  const v = bgLayer.querySelector('video');
  if (v) { v.volume = videoVolume(); }
}

// ============================ Bing 每日壁纸 ============================
const BING_ID = 'bing_random';

/** bing.php 服务端每次随机返回近 8 张中的一张；rand=true 与网页版保持一致 */
function bingUrl(rand) {
  return 'https://time.pudiu.com/bing.php' + (rand ? `?rand=true&t=${Date.now()}` : `?t=${Date.now()}`);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function updateBingStatus() {
  const el = $('bing-status');
  if (!el) return;
  const active = CONFIG.bg.mode === 'bing';
  const auto = !!(CONFIG.bing && CONFIG.bing.auto);
  el.textContent = active ? (auto ? '使用中 · 每日自动更新' : '使用中') : (auto ? '未启用 · 已开自动更新' : '未启用');
  const card = $('bing-card');
  if (card) card.classList.toggle('active', active);
}

/** 应用 Bing 壁纸。rand=true 强制换一张；silent 用于开机自动刷新（不弹提示） */
async function applyBing({ rand = true, silent = false } = {}) {
  const url = bingUrl(rand);
  carouselRunning = false;
  $('car-enabled').checked = false;
  CONFIG.bg.mode = 'bing';
  CONFIG.bg.id = BING_ID;
  CONFIG.bing = Object.assign({}, CONFIG.bing, { date: todayStr(), url });
  document.querySelectorAll('#master-bg-grid .bg-card').forEach(c => c.classList.remove('active'));
  applyBackground({ kind: 'image', url, id: BING_ID, name: 'Bing 每日壁纸' });
  await api.setConfig({ bg: { mode: 'bing', id: BING_ID }, carousel: { enabled: false }, bing: CONFIG.bing });
  updateBingStatus();
  if (!silent) toast(rand ? 'Bing 壁纸：已换一张' : '已设为 Bing 每日壁纸');
}

/** 每日 0 点后自动换一张（开启「每日自动更新」时） */
function scheduleBingAuto() {
  setInterval(() => {
    if (!(CONFIG.bing && CONFIG.bing.auto)) return;
    if (CONFIG.bing.date === todayStr()) return;
    if (CONFIG.carousel.enabled) return;              // 轮播优先，不打断
    console.log('[bing] 每日自动更新触发');
    applyBing({ rand: false, silent: true });
  }, 60 * 1000);
}

function libItemById(id) { return library.find(i => i.id === id); }

/** 当前可切换序列 */
function getSequence() {
  if (CONFIG.carousel.enabled && playlist.length) {
    return playlist.map(libItemById).filter(Boolean).map(i => ({ kind: i.kind, url: mediaUrlOf(i.path), id: i.id, name: i.name }));
  }
  if (CONFIG.bg.mode === 'library' && library.length) {
    return library.map(i => ({ kind: i.kind, url: mediaUrlOf(i.path), id: i.id, name: i.name }));
  }
  if (CONFIG.bg.mode === 'bing') {
    return [{ kind: 'image', url: (CONFIG.bing && CONFIG.bing.url) || bingUrl(false), id: BING_ID, name: 'Bing 每日壁纸' }];
  }
  return bgDataList.map(i => ({ kind: i.type, url: i.url, id: i.id, name: i.id }));
}

function clearCarouselTimer() {
  if (carouselTimer) { clearTimeout(carouselTimer); carouselTimer = null; }
}

function applyBackground(item, opts = {}) {
  if (!item) return;
  currentItem = item;
  clearCarouselTimer();
  bgLayer.innerHTML = '';
  bgLayer.style.backgroundColor = '#000';

  if (item.kind === 'color') {
    bgLayer.style.backgroundColor = item.color || '#000000';
    updateCarStatus();
    return;
  }

  if (item.kind === 'video') {
    const vid = document.createElement('video');
    vid.src = item.url;
    vid.autoplay = true;
    vid.muted = CONFIG.carousel.mute !== false;
    vid.volume = videoVolume();              // 默认 0.8，避免"取消静音却音量为 0"听起来像没声音
    vid.loop = !CONFIG.carousel.enabled;           // 轮播时不循环，播完切下一个
    vid.playsInline = true;
    vid.className = 'bg-media';
    vid.onloadeddata = () => console.log('[bg] video loaded:', item.name || item.url, 'muted=' + vid.muted, 'volume=' + vid.volume);
    vid.onerror = () => {
      const code = vid.error && vid.error.code;
      const msg = vid.error && vid.error.message;
      console.error('[bg] video error:', item.name || item.url, 'code=' + code, msg || '');
      toast('素材加载失败：' + (item.name || '当前素材') + (code ? '（错误码 ' + code + '）' : ''));
      if (carouselRunning) setTimeout(nextSlide, 1500);
    };
    vid.onended = () => { if (carouselRunning) nextSlide(); };
    bgLayer.appendChild(vid);
    vid.play().catch((e) => console.error('[bg] video play rejected:', e && e.message));
  } else {
    const img = document.createElement('img');
    img.src = item.url;
    img.className = 'bg-media';
    img.onload = () => console.log('[bg] image loaded:', item.name || item.url);
    img.onerror = () => {
      console.error('[bg] image error:', item.name || item.url);
      toast('素材加载失败：' + (item.name || '当前素材'));
    };
    bgLayer.appendChild(img);
  }

  if (carouselRunning && item.kind === 'image') {
    const stay = Math.max(3, CONFIG.carousel.interval || 30) * 1000;
    carouselTimer = setTimeout(nextSlide, stay);
  }
  updateCarStatus();
}

function nextSlide() {
  // Bing 模式下「下一张」= 重新拉一张 Bing 随机图（与网页版行为一致）
  if (CONFIG.bg.mode === 'bing' && !CONFIG.carousel.enabled) { applyBing({ rand: true }); return; }
  const seq = getSequence();
  if (!seq.length) return;
  if (CONFIG.carousel.shuffle && seq.length > 1) {
    let n = seqIndex;
    while (n === seqIndex) n = Math.floor(Math.random() * seq.length);
    seqIndex = n;
  } else {
    seqIndex = (seqIndex + 1) % seq.length;
  }
  applyBackground(seq[seqIndex]);
}

function prevSlide() {
  if (CONFIG.bg.mode === 'bing' && !CONFIG.carousel.enabled) { applyBing({ rand: true }); return; }
  const seq = getSequence();
  if (!seq.length) return;
  seqIndex = (seqIndex - 1 + seq.length) % seq.length;
  applyBackground(seq[seqIndex]);
}

function startCarousel() {
  const seq = getSequence();
  if (!seq.length) { toast('播放列表为空，请先导入素材'); $('car-enabled').checked = false; return; }
  carouselRunning = true;
  seqIndex = Math.max(0, Math.min(seqIndex, seq.length - 1));
  applyBackground(seq[seqIndex]);
  toast('已开始轮播播放');
}

function stopCarousel() {
  carouselRunning = false;
  clearCarouselTimer();
  if (currentItem && currentItem.kind === 'video') {
    const v = bgLayer.querySelector('video');
    if (v) { v.loop = true; v.play().catch(() => {}); }
  }
  updateCarStatus();
}

function updateCarStatus() {
  const el = $('car-status');
  if (!el) return;
  if (!carouselRunning) { el.textContent = '当前：未轮播（单素材循环）'; return; }
  const seq = getSequence();
  el.textContent = `轮播中 ${seqIndex + 1}/${seq.length} · ${(currentItem && currentItem.name) || '-'}`;
}

// ============================ 5. 素材库 ============================
async function importMedia() {
  const files = await api.pickMedia();
  if (!files || !files.length) return;
  let added = 0;
  for (const f of files) {
    if (library.some(i => i.path === f.path)) { toast(`已存在：${f.name}`); continue; }
    const item = {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: f.kind, name: f.name, path: f.path, size: f.size, thumb: null, addedAt: Date.now()
    };
    library.push(item);
    playlist.push(item.id);
    added++;
    // 异步生成缩略图
    generateThumb(item);
  }
  if (added) {
    toast(`已导入 ${added} 个素材`);
    persistLibrary();
    renderLibrary();
    // 首次导入、或当前没有背景素材时，直接投放到背景，避免"导入后什么都不显示"
    if (!currentItem || (currentItem.kind === 'color')) {
      const first = library[library.length - added];
      seqIndex = library.findIndex(i => i.id === first.id);
      CONFIG.bg.mode = 'library';
      CONFIG.bg.id = first.id;
      await api.setConfig({ bg: { mode: 'library', id: first.id } });
      applyBackground({ kind: first.kind, url: mediaUrlOf(first.path), id: first.id, name: first.name });
      $('screen-clock').scrollIntoView({ behavior: 'smooth' });
    }
  }
}

async function generateThumb(item) {
  try {
    const url = mediaUrlOf(item.path);
    let dataUrl = null;
    if (item.kind === 'video') {
      dataUrl = await new Promise((resolve) => {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.muted = true;
        v.preload = 'metadata';
        v.src = url;
        const done = (val) => resolve(val);
        v.onloadedmetadata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { done(null); } };
        v.onseeked = () => {
          try {
            const c = document.createElement('canvas');
            c.width = 320; c.height = 180;
            c.getContext('2d').drawImage(v, 0, 0, 320, 180);
            done(c.toDataURL('image/png'));
          } catch (e) { done(null); }
        };
        v.onerror = () => done(null);
        setTimeout(() => done(null), 8000);
      });
    } else {
      dataUrl = await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = 320; c.height = 180;
            const ctx = c.getContext('2d');
            const r = Math.max(320 / img.width, 180 / img.height);
            const w = img.width * r, h = img.height * r;
            ctx.drawImage(img, (320 - w) / 2, (180 - h) / 2, w, h);
            resolve(c.toDataURL('image/png'));
          } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
        setTimeout(() => resolve(null), 8000);
      });
    }
    if (!dataUrl) return;
    const saved = await api.saveThumb(item.id, dataUrl);
    if (saved) {
      item.thumb = saved;
      persistLibrary();
      renderLibrary();
    }
  } catch (e) { /* 缩略图失败不影响使用 */ }
}

function persistLibrary() {
  api.setConfig({ library, playlist });
}

function removeMedia(id) {
  library = library.filter(i => i.id !== id);
  playlist = playlist.filter(p => p !== id);
  persistLibrary();
  renderLibrary();
  if (currentItem && currentItem.id === id) {
    const seq = getSequence();
    if (seq.length) applyBackground(seq[0]); else applyBackground({ kind: 'color', color: CONFIG.bg.color });
  }
}

function renderLibrary() {
  // 播放列表（素材库面板）
  const list = $('lib-list');
  if (list) {
    list.innerHTML = '';
    if (!library.length) {
      list.innerHTML = '<div class="lib-empty">还没有素材，点击上方「导入视频 / 图片」开始</div>';
    }
    library.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'lib-item';
      const inList = playlist.includes(item.id);
      row.innerHTML = `
        <div class="lib-thumb">${item.thumb
          ? `<img src="${mediaUrlOf(item.thumb)}" alt="">`
          : `<span>${item.kind === 'video' ? '▶' : '🖼'}</span>`}</div>
        <div class="lib-meta">
          <div class="lib-name" title="${item.path}">${item.name}</div>
          <div class="lib-sub">${item.kind === 'video' ? '视频' : '图片'} · ${(item.size / 1048576).toFixed(1)} MB</div>
        </div>
        <label class="lib-check"><input type="checkbox" ${inList ? 'checked' : ''}><span>轮播</span></label>
        <button class="lib-play" title="立即投放到背景">投放</button>
        <button class="lib-del" title="移除素材">✕</button>`;
      row.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) { if (!playlist.includes(item.id)) playlist.push(item.id); }
        else playlist = playlist.filter(p => p !== item.id);
        persistLibrary();
      });
      row.querySelector('.lib-play').addEventListener('click', async () => {
        seqIndex = Math.max(0, library.findIndex(i => i.id === item.id));
        CONFIG.bg.mode = 'library';
        await api.setConfig({ bg: { mode: 'library', id: item.id } });
        applyBackground({ kind: item.kind, url: mediaUrlOf(item.path), id: item.id, name: item.name });
        closeLibrary();
        $('screen-clock').scrollIntoView({ behavior: 'smooth' });
        toast('已投放：' + item.name);
      });
      row.querySelector('.lib-del').addEventListener('click', () => removeMedia(item.id));
      list.appendChild(row);
    });
    $('lib-count').textContent = `${library.length} 个素材 · ${playlist.length} 个进入轮播`;
  }

  // 本地素材宫格（媒体屏）
  const grid = $('local-grid');
  if (grid) {
    const uploadCard = $('local-import-card');
    grid.innerHTML = '';
    if (uploadCard) grid.appendChild(uploadCard);
    library.forEach(item => {
      const card = document.createElement('div');
      card.className = 'bg-card' + (currentItem && currentItem.id === item.id ? ' active' : '');
      card.innerHTML = `<div class="bg-type-badge">${item.kind === 'video' ? '▶' : '🖼'}</div>
        ${item.thumb ? `<img class="bg-cover" src="${mediaUrlOf(item.thumb)}">` : '<div class="bg-cover bg-cover-empty">' + (item.kind === 'video' ? '▶' : '🖼') + '</div>'}
        <div class="bg-card-name">${item.name}</div>`;
      card.onclick = async () => {
        seqIndex = Math.max(0, library.findIndex(i => i.id === item.id));
        CONFIG.bg.mode = 'library';
        await api.setConfig({ bg: { mode: 'library', id: item.id } });
        applyBackground({ kind: item.kind, url: mediaUrlOf(item.path), id: item.id, name: item.name });
        $('screen-clock').scrollIntoView({ behavior: 'smooth' });
      };
      grid.appendChild(card);
    });
  }
}

function renderOnlineGrid() {
  const grid = $('master-bg-grid');
  if (!grid) return;
  grid.innerHTML = '';
  bgDataList.forEach(item => {
    const card = document.createElement('div');
    const isActive = CONFIG.bg.mode === 'online' && CONFIG.bg.id === item.id;
    card.className = 'bg-card' + (isActive ? ' active' : '');
    card.innerHTML = `<div class="bg-type-badge">${item.type === 'video' ? '▶' : '🖼'}</div><img class="bg-cover" src="${item.cover}">`;
    card.onclick = async () => {
      CONFIG.bg.mode = 'online';
      CONFIG.bg.id = item.id;
      carouselRunning = false;
      document.querySelectorAll('#master-bg-grid .bg-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      await api.setConfig({ bg: { mode: 'online', id: item.id }, carousel: { enabled: false } });
      $('car-enabled').checked = false;
      applyBackground({ kind: item.type, url: item.url, id: item.id, name: item.id });
      updateBingStatus();
      $('screen-clock').scrollIntoView({ behavior: 'smooth' });
    };
    grid.appendChild(card);
  });
}

// ============================ 6. 设置绑定 ============================
function bindSettings() {
  const root = document.documentElement;

  $('setting-show-clock').addEventListener('change', async (e) => {
    const w = $('main-widget');
    w.style.transition = 'opacity 0.4s ease';
    w.style.opacity = e.target.checked ? '1' : '0';
    w.style.pointerEvents = e.target.checked ? 'auto' : 'none';
    await api.setConfig({ showClock: e.target.checked });
  });

  $('setting-scale').addEventListener('input', async (e) => {
    root.style.setProperty('--clock-scale', e.target.value);
    await api.setConfig({ scale: parseFloat(e.target.value) });
  });

  $('setting-font').addEventListener('change', async (e) => {
    root.style.setProperty('--clock-font', e.target.value);
    await api.setConfig({ font: e.target.value });
  });

  $('setting-card-bg').addEventListener('input', async (e) => {
    root.style.setProperty('--card-bg-color', e.target.value);
    await api.setConfig({ cardBg: e.target.value });
  });

  $('setting-font-color').addEventListener('input', async (e) => {
    root.style.setProperty('--clock-color', e.target.value);
    await api.setConfig({ fontColor: e.target.value });
  });

  $('setting-hour-format').addEventListener('change', async (e) => {
    is24Hour = e.target.value === '24';
    Object.keys(currentTimes).forEach(k => currentTimes[k] = -1);
    updateTime();
    await api.setConfig({ hourFormat: e.target.value });
  });

  // 背景音乐
  const audio = $('ambient-audio');
  const audioToggle = $('setting-audio-toggle');
  const audioVol = $('setting-volume');
  audio.volume = audioVol.value;
  audio.onerror = () => console.error('[audio] load error:', audio.src, audio.error && audio.error.message);

  audioToggle.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const ok = await ensureAudioSource();
      if (!ok) {
        toast('请先选择本地音频文件：设置 → 背景音乐 → 选择本地音频…');
        e.target.checked = false;
        await api.setConfig({ audio: { enabled: false } });
        return;
      }
      audio.play().catch(err => {
        console.error('[audio] play failed:', err && err.message);
        toast('播放失败：' + ((err && err.message) || '未知原因'));
      });
    } else {
      audio.pause();
    }
    await api.setConfig({ audio: { enabled: e.target.checked } });
  });
  audioVol.addEventListener('input', async (e) => {
    audio.volume = e.target.value;
    await api.setConfig({ audio: { volume: parseFloat(e.target.value) } });
  });
  $('custom-audio-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const absPath = file.path || null;          // Electron 下 File 带 path 属性，可持久化
    if (absPath) {
      audio.src = mediaUrlOf(absPath);
      audio.load();
    } else {
      audio.src = URL.createObjectURL(file);    // 兜底：仅本次会话有效
    }
    audio.volume = audioVol.value;
    audioToggle.checked = true;
    audio.play().catch(err => console.error('[audio] play failed:', err && err.message));
    $('mp3-name').innerText = file.name;
    await api.setConfig({ audio: { enabled: true, name: file.name, path: absPath } });
    CONFIG.audio.path = absPath;
    CONFIG.audio.name = file.name;
    toast('背景音乐已设置：' + file.name);
  });

  // 纯色背景
  $('bg-color-picker').addEventListener('input', async (e) => {
    bgLayer.innerHTML = '';
    bgLayer.style.backgroundColor = e.target.value;
    CONFIG.bg.mode = 'color';
    CONFIG.bg.color = e.target.value;
    await api.setConfig({ bg: { mode: 'color', color: e.target.value } });
    updateCarStatus();
  });

  // 桌面投放
  $('setting-autostart').addEventListener('change', async (e) => {
    await api.setConfig({ desktop: { openAtLogin: e.target.checked } });
    toast(e.target.checked ? '已设置开机自动启动' : '已取消开机自启');
  });
  $('setting-ontop').addEventListener('change', async (e) => {
    await api.setConfig({ desktop: { alwaysOnTop: e.target.checked } });
    $('btn-pin').classList.toggle('active', e.target.checked);
  });
  $('setting-tray').addEventListener('change', async (e) => {
    await api.setConfig({ desktop: { minimizeToTray: e.target.checked } });
  });
  $('setting-autofull').addEventListener('change', async (e) => {
    await api.setConfig({ desktop: { startFullscreen: e.target.checked } });
  });
  $('setting-display').addEventListener('change', async (e) => {
    const id = e.target.value;
    if (!id) return;
    await api.moveToDisplay(Number(id));
    toast('已投放到所选显示器');
  });
  $('open-dir-btn').addEventListener('click', async () => {
    await api.openDir(appInfo.userData);
  });

  $('reset-btn').addEventListener('click', async () => {
    if (confirm('确定清空所有本地配置（含素材索引）并重置吗？')) {
      await api.resetConfig();
      location.reload();
    }
  });
}

async function fillDisplays() {
  const sel = $('setting-display');
  const displays = await api.listDisplays();
  sel.innerHTML = '';
  displays.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.label} · ${d.size}${d.primary ? ' · 主屏' : ''}`;
    sel.appendChild(opt);
    if (CONFIG.desktop.displayId && String(d.id) === String(CONFIG.desktop.displayId)) sel.value = d.id;
  });
  if (!CONFIG.desktop.displayId) sel.value = displays[0] ? displays[0].id : '';
}

// ============================ 7. 交互与快捷键 ============================
function toggleFullScreen() { api.win('fullscreen'); }

function lockScreen() {
  if (isLocked) return;
  api.win('fullscreen');
  const full = true;
  document.body.classList.add('standby-mode');
  $('sidebar-wrapper').classList.remove('open');
  $('library-panel').classList.remove('open');
  isLocked = true;
  lockCooldown = true;
  $('screen-clock').scrollIntoView();
  setTimeout(() => { lockCooldown = false; }, 1500);
}

function unlockScreen() {
  if (!isLocked) return;
  document.body.classList.remove('standby-mode');
  $('standby-hint').classList.remove('active');
  isLocked = false;
  api.win('is-fullscreen').then(isFull => { if (isFull) api.win('fullscreen'); });
}

function wakeUpStandbyHint() {
  if (!isLocked || lockCooldown) return;
  $('standby-hint').classList.add('active');
  clearTimeout(standbyHintTimer);
  standbyHintTimer = setTimeout(() => $('standby-hint').classList.remove('active'), 2500);
}

function closeLibrary() { $('library-panel').classList.remove('open'); }

function bindUI() {
  // 标题栏窗口控制
  $('win-min').addEventListener('click', () => api.win('minimize'));
  $('win-max').addEventListener('click', () => api.win('maximize'));
  $('win-close').addEventListener('click', () => api.win('hide'));
  $('header-logo').addEventListener('click', () => $('screen-clock').scrollIntoView({ behavior: 'smooth' }));

  // 快捷控制
  $('btn-fullscreen').addEventListener('click', (e) => { e.stopPropagation(); toggleFullScreen(); });
  $('btn-standby').addEventListener('click', (e) => { e.stopPropagation(); isLocked ? unlockScreen() : lockScreen(); });
  $('btn-next-bg').addEventListener('click', (e) => { e.stopPropagation(); nextSlide(); });
  $('btn-prev-bg').addEventListener('click', (e) => { e.stopPropagation(); prevSlide(); });
  $('btn-library').addEventListener('click', (e) => { e.stopPropagation(); $('library-panel').classList.toggle('open'); });
  $('btn-pin').addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = await api.win('always-on-top');
    $('btn-pin').classList.toggle('active', !!next);
    $('setting-ontop').checked = !!next;
  });
  $('btn-flip-x').addEventListener('click', async (e) => { e.stopPropagation(); isFlipX = !isFlipX; updateMirror(); await api.setConfig({ mirrorX: isFlipX }); });
  $('btn-flip-y').addEventListener('click', async (e) => { e.stopPropagation(); isFlipY = !isFlipY; updateMirror(); await api.setConfig({ mirrorY: isFlipY }); });

  // 侧边栏
  $('settings-btn').addEventListener('click', (e) => { e.stopPropagation(); $('sidebar-wrapper').classList.toggle('open'); });
  $('close-sidebar-btn').addEventListener('click', () => $('sidebar-wrapper').classList.remove('open'));
  $('close-library-btn').addEventListener('click', closeLibrary);

  // 素材库
  $('import-media-btn').addEventListener('click', (e) => { e.stopPropagation(); importMedia(); });
  $('local-import-card').addEventListener('click', (e) => { e.stopPropagation(); importMedia(); });
  $('clear-lib-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!library.length) return;
    if (!confirm(`确定移除全部 ${library.length} 个素材索引？（不会删除磁盘上的原文件）`)) return;
    library = []; playlist = [];
    persistLibrary(); renderLibrary();
    toast('素材库已清空');
  });

  // 轮播设置
  $('car-enabled').addEventListener('change', async (e) => {
    CONFIG.carousel.enabled = e.target.checked;
    await api.setConfig({ carousel: { enabled: e.target.checked } });
    if (e.target.checked) startCarousel(); else stopCarousel();
  });
  $('car-interval').addEventListener('input', async (e) => {
    $('car-interval-val').textContent = e.target.value + 's';
    CONFIG.carousel.interval = parseInt(e.target.value, 10);
    await api.setConfig({ carousel: { interval: CONFIG.carousel.interval } });
    if (carouselRunning && currentItem && currentItem.kind === 'image') {
      clearCarouselTimer();
      carouselTimer = setTimeout(nextSlide, CONFIG.carousel.interval * 1000);
    }
  });
  $('car-shuffle').addEventListener('change', async (e) => {
    CONFIG.carousel.shuffle = e.target.checked;
    await api.setConfig({ carousel: { shuffle: e.target.checked } });
  });
  $('car-mute').addEventListener('change', async (e) => {
    CONFIG.carousel.mute = e.target.checked;
    const v = bgLayer.querySelector('video');
    // 取消静音时若音量还是 0，自动给一个可听见的默认值，避免"关了静音仍然没声"
    if (!e.target.checked && videoVolume() === 0) {
      CONFIG.carousel.videoVolume = 0.8;
      $('car-volume').value = 80;
      $('car-volume-val').textContent = '80%';
    }
    if (v) { v.muted = e.target.checked; v.volume = videoVolume(); }
    await api.setConfig({ carousel: { mute: e.target.checked, videoVolume: videoVolume() } });
  });
  $('car-volume').addEventListener('input', async (e) => {
    const vol = parseInt(e.target.value, 10) / 100;
    $('car-volume-val').textContent = e.target.value + '%';
    CONFIG.carousel.videoVolume = vol;
    if (vol > 0 && CONFIG.carousel.mute) {      // 拖动音量视为要听声音，自动解除静音
      CONFIG.carousel.mute = false;
      $('car-mute').checked = false;
    }
    syncBgVideoVolume();
    const v = bgLayer.querySelector('video');
    if (v) v.muted = CONFIG.carousel.mute !== false;
    await api.setConfig({ carousel: { videoVolume: vol, mute: CONFIG.carousel.mute } });
  });

  // Bing 每日壁纸
  $('bing-apply').addEventListener('click', (e) => { e.stopPropagation(); applyBing({ rand: false }); });
  $('bing-next').addEventListener('click', (e) => { e.stopPropagation(); applyBing({ rand: true }); });
  $('bing-auto').addEventListener('change', async (e) => {
    CONFIG.bing = Object.assign({}, CONFIG.bing, { auto: e.target.checked, date: todayStr() });
    await api.setConfig({ bing: CONFIG.bing });
    updateBingStatus();
    toast(e.target.checked ? '已开启：每日 0 点后自动换一张 Bing 壁纸' : '已关闭每日自动更新');
  });

  // 媒体屏 tab
  document.querySelectorAll('.media-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLocal = tab.dataset.tab === 'local';
      $('media-local').classList.toggle('hidden', !isLocal);
      $('media-online').classList.toggle('hidden', isLocal);
    });
  });

  // 滚动提示
  $('hint-to-media').addEventListener('click', () => $('screen-media').scrollIntoView({ behavior: 'smooth' }));
  $('hint-to-about').addEventListener('click', () => $('screen-about').scrollIntoView({ behavior: 'smooth' }));

  // 语言
  const langWrapper = document.querySelector('.lang-dropdown-wrapper');
  $('current-lang-display').addEventListener('click', (e) => { e.stopPropagation(); langWrapper.classList.toggle('active'); });
  document.querySelectorAll('.lang-dropdown-list li').forEach(li => {
    li.addEventListener('click', async (e) => {
      e.stopPropagation();
      currentLang = li.dataset.lang;
      applyTranslations();
      langWrapper.classList.remove('active');
      await api.setConfig({ lang: currentLang });
    });
  });

  // 时区弹窗
  $('close-tz-btn').addEventListener('click', () => tzModal.classList.remove('show'));
  tzModal.addEventListener('click', (e) => { if (e.target === tzModal) tzModal.classList.remove('show'); });
  document.querySelectorAll('.tz-item').forEach(item => {
    item.addEventListener('click', async () => {
      const tz = item.dataset.tz;
      const cityEn = item.dataset.cityEn;
      const icon = item.innerHTML.trim().split(' ')[0];
      if (!dockCities.find(c => c.tz === tz)) {
        if (dockCities.length >= 4) dockCities.shift();
        dockCities.push({ tz, cityEn, icon });
        await api.setConfig({ dockCities });
      }
      currentTz = tz;
      CONFIG.__tzManual = true;
      $('display-city').innerText = getLocalizedCityName(tz, cityEn);
      document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
      renderDock();
      Object.keys(currentTimes).forEach(k => currentTimes[k] = -1);
      updateTime();
      tzModal.classList.remove('show');
      await api.setConfig({ tz });
    });
  });

  dockContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.dock-btn:not(.add-btn)');
    if (!btn) return;
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTz = btn.dataset.tz;
    $('display-city').innerText = btn.dataset.city;
    Object.keys(currentTimes).forEach(k => currentTimes[k] = -1);
    updateTime();
  });

  // 全局点击：收起面板 / 解锁
  document.addEventListener('click', (e) => {
    const sw = $('sidebar-wrapper'), lp = $('library-panel');
    if (sw.classList.contains('open') && !e.target.closest('.sidebar-panel') && !e.target.closest('#settings-btn')) sw.classList.remove('open');
    if (lp.classList.contains('open') && !e.target.closest('.library-panel') && !e.target.closest('#btn-library')) lp.classList.remove('open');
    if (langWrapper.classList.contains('active') && !e.target.closest('.lang-dropdown-wrapper')) langWrapper.classList.remove('active');
    if (e.target.closest('.control-btn') || e.target.closest('.sidebar-panel') || e.target.closest('.library-panel') ||
        e.target.closest('.scroll-hint') || e.target.closest('.tz-modal') || e.target.closest('.lang-dropdown-wrapper') ||
        e.target.closest('.win-controls') || e.target.closest('.media-panel')) return;
    if (isLocked && !lockCooldown) unlockScreen();
  });

  document.addEventListener('mousemove', () => { if (isLocked) wakeUpStandbyHint(); });

  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (isLocked) {
      if (e.code === 'KeyL' && !lockCooldown) unlockScreen();
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'KeyF': e.preventDefault(); toggleFullScreen(); break;
      case 'KeyL': e.preventDefault(); lockScreen(); break;
      case 'KeyN': e.preventDefault(); nextSlide(); break;
      case 'KeyP': e.preventDefault(); prevSlide(); break;
      case 'KeyB': e.preventDefault(); $('library-panel').classList.toggle('open'); break;
      case 'Escape': if ($('library-panel').classList.contains('open')) closeLibrary(); break;
      default: break;
    }
  });
}

function updateMirror() {
  const appRoot = $('app-root');
  appRoot.className = 'app-root';
  if (isFlipX && isFlipY) appRoot.classList.add('mirror-xy');
  else if (isFlipX) appRoot.classList.add('mirror-x');
  else if (isFlipY) appRoot.classList.add('mirror-y');
  $('btn-flip-x').classList.toggle('active', isFlipX);
  $('btn-flip-y').classList.toggle('active', isFlipY);
}

// ============================ 8. 启动 ============================
async function boot() {
  CONFIG = await api.getConfig();
  appInfo = await api.getInfo();

  // 内置资源（file:// 下由主进程读取）
  try {
    const i18nRaw = await api.readAsset('i18n_full.json');
    if (i18nRaw) i18nConfig = JSON.parse(i18nRaw);
    else console.error('[asset] i18n_full.json 为空');
  } catch (e) { console.error('[asset] i18n 读取失败:', e && e.message); i18nConfig = {}; }
  try {
    const bgRaw = await api.readAsset('bg_assets.json');
    if (bgRaw) bgDataList = JSON.parse(bgRaw);
    else console.error('[asset] bg_assets.json 为空');
  } catch (e) { console.error('[asset] 在线壁纸清单读取失败:', e && e.message); bgDataList = []; }

  // 应用配置
  currentLang = CONFIG.lang || 'zh-CN';
  currentTz = CONFIG.tz || currentTz;
  is24Hour = CONFIG.hourFormat !== '12';
  isFlipX = !!CONFIG.mirrorX;
  isFlipY = !!CONFIG.mirrorY;
  library = Array.isArray(CONFIG.library) ? CONFIG.library.slice() : [];
  playlist = Array.isArray(CONFIG.playlist) ? CONFIG.playlist.slice() : [];
  dockCities = Array.isArray(CONFIG.dockCities) ? CONFIG.dockCities.slice() : [];

  const root = document.documentElement;
  root.style.setProperty('--clock-scale', CONFIG.scale);
  root.style.setProperty('--clock-font', CONFIG.font);
  root.style.setProperty('--card-bg-color', CONFIG.cardBg);
  root.style.setProperty('--clock-color', CONFIG.fontColor);

  $('setting-show-clock').checked = CONFIG.showClock !== false;
  $('setting-hour-format').value = CONFIG.hourFormat || '24';
  $('setting-scale').value = CONFIG.scale;
  $('setting-font').value = CONFIG.font;
  $('setting-card-bg').value = CONFIG.cardBg;
  $('setting-font-color').value = CONFIG.fontColor;
  $('setting-volume').value = CONFIG.audio.volume;
  $('setting-audio-toggle').checked = !!CONFIG.audio.enabled;
  if (CONFIG.audio.name) $('mp3-name').innerText = CONFIG.audio.name;
  $('bg-color-picker').value = CONFIG.bg.color || '#000000';
  $('car-enabled').checked = !!CONFIG.carousel.enabled;
  $('car-interval').value = CONFIG.carousel.interval || 30;
  $('car-interval-val').textContent = (CONFIG.carousel.interval || 30) + 's';
  $('car-shuffle').checked = !!CONFIG.carousel.shuffle;
  $('car-mute').checked = CONFIG.carousel.mute !== false;
  // 旧配置兼容：静音已关但音量为 0 → 补一个听得见的默认值（表现为"视频没声音"）
  if (CONFIG.carousel.mute === false && (CONFIG.carousel.videoVolume == null || CONFIG.carousel.videoVolume === 0)) {
    CONFIG.carousel.videoVolume = 0.8;
    await api.setConfig({ carousel: { videoVolume: 0.8 } });
  }
  $('car-volume').value = Math.round(videoVolume() * 100);
  $('car-volume-val').textContent = Math.round(videoVolume() * 100) + '%';
  CONFIG.bing = CONFIG.bing || { auto: false, date: null, url: null };
  $('bing-auto').checked = !!CONFIG.bing.auto;
  $('setting-autostart').checked = !!CONFIG.desktop.openAtLogin;
  $('setting-ontop').checked = !!CONFIG.desktop.alwaysOnTop;
  $('setting-tray').checked = !!CONFIG.desktop.minimizeToTray;
  $('setting-autofull').checked = !!CONFIG.desktop.startFullscreen;
  $('btn-pin').classList.toggle('active', !!CONFIG.desktop.alwaysOnTop);

  $('si-version').innerText = 'v' + appInfo.version;
  $('si-runtime').innerText = `Electron ${appInfo.electron} / Node ${appInfo.node}`;
  $('si-userdata').innerText = appInfo.userData;

  updateMirror();
  applyTranslations();
  renderLibrary();
  renderOnlineGrid();
  fillDisplays();
  bindSettings();
  bindUI();

  // 恢复背景
  if (CONFIG.bg.mode === 'color') {
    applyBackground({ kind: 'color', color: CONFIG.bg.color || '#000000' });
  } else if ((CONFIG.bg.mode === 'library' || CONFIG.carousel.enabled) && library.length) {
    const targetId = CONFIG.carousel.enabled ? (playlist[0] || library[0].id) : CONFIG.bg.id;
    const idx = library.findIndex(i => i.id === targetId);
    const item = library[idx >= 0 ? idx : 0];
    seqIndex = idx >= 0 ? idx : 0;
    if (CONFIG.carousel.enabled) { carouselRunning = true; applyBackground({ kind: item.kind, url: mediaUrlOf(item.path), id: item.id, name: item.name }); }
    else applyBackground({ kind: item.kind, url: mediaUrlOf(item.path), id: item.id, name: item.name });
  } else if (CONFIG.bg.mode === 'bing') {
    // 开了每日自动更新且已跨天 → 拉一张新的；否则沿用上次的 URL（避免每次启动都换图）
    const needFresh = CONFIG.bing.auto && CONFIG.bing.date !== todayStr();
    const url = needFresh ? bingUrl(false) : ((CONFIG.bing.url) || bingUrl(false));
    if (needFresh) {
      CONFIG.bing = Object.assign({}, CONFIG.bing, { date: todayStr(), url });
      await api.setConfig({ bing: CONFIG.bing });
    }
    applyBackground({ kind: 'image', url, id: BING_ID, name: 'Bing 每日壁纸' });
  } else {
    const item = bgDataList.find(d => d.id === CONFIG.bg.id) || bgDataList[0];
    if (item) {
      seqIndex = bgDataList.findIndex(d => d.id === item.id);
      applyBackground({ kind: item.type, url: item.url, id: item.id, name: item.id });
    } else {
      applyBackground({ kind: 'color', color: CONFIG.bg.color || '#000000' });
    }
  }

  // 恢复背景音（上次选择的本地音频文件会在重启后自动续上）
  if (CONFIG.audio && CONFIG.audio.enabled) {
    const ok = await ensureAudioSource();
    if (ok) {
      $('ambient-audio').volume = CONFIG.audio.volume;
      $('ambient-audio').play().catch(err => console.error('[audio] autoplay failed:', err && err.message));
    } else {
      $('setting-audio-toggle').checked = false;
      toast('上次选择的音频文件不可用，请重新选择本地音频');
    }
  }

  updateBingStatus();
  scheduleBingAuto();

  initLocation();
  updateTime();
  scheduleNextTick();
  console.log('[PudiuTime] 桌面版已启动', appInfo,
    '| 素材', library.length, '个 | 在线壁纸', bgDataList.length,
    '张 | 语言包', Object.keys(i18nConfig).length, '种');
}

boot();
