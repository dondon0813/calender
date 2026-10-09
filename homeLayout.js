// ===== 工作首頁自訂入口卡（2026-10-10 雪莉：每位員工自己決定首頁放哪些，綁後台帳號） =====
// 第二版（同日雪莉）：設定視窗改成「編輯模式」——按「編輯首頁」後直接在首頁上操作：
//   · 拖曳卡片排序（滑鼠移 6px 起拖、觸控長按 300ms；同 customBlocks.js cbDrag 手感）
//   · 卡片右上角 ✕ 移除
//   · 從左欄側邊欄（#sideNav）直接把功能拖進首頁格子；編輯模式中點左欄項目＝加到最後（不換頁）
//   · 首頁下方「可以加入」區（手機沒有左欄時用）同樣可點或拖
//   · 每次變動自動存檔（debounce），按「完成」離開編輯模式
// 存法：POST setting-get／setting-set 帶 personal:true，後端把 key 改寫成 u.<登入者userId>.adminHome
//       （dondon-platform lib/legacy/settings.ts）＝換電腦換手機都跟著帳號走；前端無法指定別人。
// 本機另存一份快取（admin_home_layout.<姓名>）只為了開頁瞬間先畫對，雲端回來以雲端為準。
// 可選項目＝側邊欄所有 data-view 入口（工作首頁本身除外），權限沿用該入口的 data-perm；
// 原本 7 張手刻卡片（admin.html #viewHome，標 data-view）優先沿用（圖示與「我的備忘錄」等名稱不變），
// 其他項目從側邊欄複製圖示與名稱產生。沒選的卡片收進隱藏的 #homeCardPool，不刪除
// （任務卡的 #homeUrgentIcon 會被 admin.js 用 getElementById 更新，節點必須一直在 DOM 裡）。

const HOME_LAYOUT_DEFAULT = ['memo', 'calendar', 'myTasks', 'todoList', 'tools', 'brandVendor', 'report'];
const HOME_LAYOUT_SETTING_KEY = 'adminHome';
let homeLayoutViews = HOME_LAYOUT_DEFAULT.slice();
let homeLayoutLoaded = false;   // 雲端讀過一次就不再讀（每次重新整理資料都會呼叫 homeLayoutLoad）
// 桌機每排幾個：4～6（預設 4；2026-10-10 雪莉定：不給下拉選，編輯模式把東西拖到右邊虛線「多一欄」才增加，最多 6）
// 手機（<768px）一律 2 個，見 admin.html CSS。卡片少於欄數時自動縮回（最少 4）。
const HL_COLS_MIN = 4, HL_COLS_MAX = 6;
let homeLayoutCols = HL_COLS_MIN;
let homeEditMode = false;
let hlSaveTimer = null;
let hlDrag = null;
let hlSuppressClickUntil = 0;   // 剛拖完放開時瀏覽器會補一個 click，這段時間內吞掉

const HL_REMOVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

function hlCacheKey() { return 'admin_home_layout.' + (typeof currentUser === 'string' && currentUser ? currentUser : '_'); }

// 側邊欄所有可放上首頁的入口：[{view, name, perm, iconHtml}]
function hlCatalog() {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('#sideNav .sn-item[data-view]').forEach(btn => {
    const view = btn.dataset.view;
    if (!view || view === 'home' || seen.has(view)) return;
    seen.add(view);
    const svg = btn.querySelector('svg.nav-ico');
    const clone = btn.cloneNode(true);
    clone.querySelectorAll('svg, span').forEach(n => n.remove());
    out.push({ view, name: clone.textContent.trim(), perm: btn.dataset.perm || '', iconHtml: svg ? svg.outerHTML : '' });
  });
  return out;
}
function hlCatalogMap() {
  const m = {};
  hlCatalog().forEach(c => { m[c.view] = c; });
  return m;
}
function hlAllowed(item) {
  return !item.perm || (typeof hasPerm === 'function' && hasPerm(item.perm));
}

// 只留「目前存在於側邊欄」的項目並去重（分頁改名／移除後殘值自動略過）
function hlSanitize(views) {
  const valid = hlCatalogMap();
  const out = [];
  (Array.isArray(views) ? views : []).forEach(v => {
    v = String(v || '');
    if (valid[v] && !out.includes(v)) out.push(v);
  });
  return out;
}

function hlIconSpan(cls, iconHtml, strokeWidth) {
  const icon = document.createElement('span');
  icon.className = cls;
  icon.innerHTML = iconHtml;
  const svg = icon.querySelector('svg');
  if (svg) { svg.removeAttribute('class'); if (strokeWidth) svg.setAttribute('stroke-width', strokeWidth); }
  return icon;
}

function hlGetCard(item) {
  let card = document.querySelector('#viewHome .home-card[data-view="' + item.view + '"]');
  if (card) return card;
  card = document.createElement('div');
  card.className = 'home-card';
  card.dataset.view = item.view;
  if (item.perm) card.dataset.perm = item.perm;
  card.addEventListener('click', () => switchView(item.view));
  card.appendChild(hlIconSpan('hc-icon', item.iconHtml, '1.6'));
  const name = document.createElement('span');
  name.className = 'hc-name';
  name.textContent = item.name;
  card.appendChild(name);
  return card;
}

function hlGridViews() {
  const grid = document.querySelector('#viewHome .home-grid');
  if (!grid) return homeLayoutViews.slice();
  return Array.from(grid.querySelectorAll('.home-card[data-view]')).map(c => c.dataset.view);
}

function renderHomeLayout() {
  const grid = document.querySelector('#viewHome .home-grid');
  const pool = document.getElementById('homeCardPool');
  if (!grid || !pool) return;
  const byView = hlCatalogMap();
  Array.from(grid.querySelectorAll('.home-card')).forEach(c => { if (c.classList.contains('hc-placeholder')) c.remove(); else pool.appendChild(c); });
  homeLayoutViews.forEach(v => {
    const item = byView[v];
    if (item) grid.appendChild(hlGetCard(item));
  });
  grid.querySelectorAll('.home-card[data-perm]').forEach(el => {
    el.style.display = hasPerm(el.dataset.perm) ? '' : 'none';
  });
  // 編輯模式：每張卡加 ✕
  grid.querySelectorAll('.home-card').forEach(card => {
    let rm = card.querySelector('.hc-remove');
    if (homeEditMode && !rm) {
      rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'hc-remove';
      rm.title = '從首頁移除';
      rm.setAttribute('aria-label', '從首頁移除');
      rm.innerHTML = HL_REMOVE_ICON;
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        hlSetViews(hlGridViews().filter(v => v !== card.dataset.view));
      });
      card.appendChild(rm);
    } else if (!homeEditMode && rm) {
      rm.remove();
    }
  });
  const view = document.getElementById('viewHome');
  if (view) {
    view.classList.toggle('home-editing', homeEditMode);
    hlApplyCols(view);
  }
  const sideNav = document.getElementById('sideNav');
  if (sideNav) {
    sideNav.classList.toggle('hl-editing', homeEditMode);
    sideNav.querySelectorAll('.sn-item[data-view]').forEach(btn => {
      btn.classList.toggle('hl-on-home', homeEditMode && homeLayoutViews.includes(btn.dataset.view));
    });
  }
  const empty = document.getElementById('homeEmptyHint');
  const visible = Array.from(grid.querySelectorAll('.home-card')).some(el => el.style.display !== 'none');
  if (empty) empty.style.display = (visible || homeEditMode) ? 'none' : '';
  const btn = document.getElementById('homeSettingsBtn');
  if (btn) btn.style.display = (homeEditMode || (typeof isViewOnlyMode !== 'undefined' && isViewOnlyMode)) ? 'none' : '';
  const bar = document.getElementById('homeEditBar');
  if (bar) bar.style.display = homeEditMode ? '' : 'none';
  hlRenderTray();
}

function hlNormCols(v) {
  const n = parseInt(v, 10);
  return (n >= HL_COLS_MIN && n <= HL_COLS_MAX) ? n : HL_COLS_MIN; // 舊版存的 'auto'／2／3 一律當 4
}
function hlIsDesktop() { return window.matchMedia('(min-width: 768px)').matches; }
// 編輯模式＋桌機＋還沒到 6 欄：格子右邊多一條虛線「多一欄」放置區
function hlExtraColOn() { return homeEditMode && hlIsDesktop() && homeLayoutCols < HL_COLS_MAX; }
function hlApplyCols(view) {
  const tracks = homeLayoutCols + (hlExtraColOn() ? 1 : 0);
  view.style.setProperty('--home-cols', 'repeat(' + tracks + ', 1fr)');
  view.style.setProperty('--home-maxw', (tracks * 180) + 'px');
  hlPositionCards();
}
// 有「多一欄」放置區時，卡片要明確指定欄列，才不會自動流進最右那欄；其他時候交回自動排列
function hlPositionCards() {
  const grid = document.querySelector('#viewHome .home-grid');
  if (!grid) return;
  let zone = document.getElementById('homeExtraCol');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'homeExtraCol';
    zone.className = 'home-extra-col';
    zone.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>拖到這裡<br>每排多一個</span>';
    grid.appendChild(zone);
  }
  const on = hlExtraColOn();
  const cards = Array.from(grid.querySelectorAll('.home-card')).filter(c => c.style.display !== 'none');
  if (!on) {
    zone.style.display = 'none';
    cards.forEach(c => { c.style.gridColumn = ''; c.style.gridRow = ''; });
    return;
  }
  const n = homeLayoutCols;
  cards.forEach((c, i) => { c.style.gridColumn = String((i % n) + 1); c.style.gridRow = String(Math.floor(i / n) + 1); });
  const rows = Math.max(1, Math.ceil(cards.length / n));
  zone.style.display = '';
  zone.style.gridColumn = String(n + 1);
  zone.style.gridRow = '1 / span ' + rows;
}
function hlWriteCache() {
  try { localStorage.setItem(hlCacheKey(), JSON.stringify({ views: homeLayoutViews, cols: homeLayoutCols })); } catch (e) {}
}

function hlRenderTray() {
  const tray = document.getElementById('homeAddTray');
  if (!tray) return;
  tray.style.display = homeEditMode ? '' : 'none';
  if (!homeEditMode) return;
  const list = document.getElementById('homeAddTrayList');
  list.innerHTML = '';
  const rest = hlCatalog().filter(c => hlAllowed(c) && !homeLayoutViews.includes(c.view));
  rest.forEach(item => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'hl-chip';
    chip.dataset.view = item.view;
    chip.appendChild(hlIconSpan('hl-chip-icon', item.iconHtml, '1.8'));
    const name = document.createElement('span');
    name.textContent = item.name;
    chip.appendChild(name);
    chip.addEventListener('pointerdown', (e) => hlPointerDown(e, { kind: 'add', view: item.view, source: chip }));
    chip.addEventListener('click', () => {
      if (Date.now() < hlSuppressClickUntil) return;
      hlSetViews(hlGridViews().concat(item.view));
    });
    list.appendChild(chip);
  });
  if (!rest.length) {
    const p = document.createElement('p');
    p.className = 'hl-empty';
    p.textContent = '全部功能都已經放在首頁了。';
    list.appendChild(p);
  }
}

// 套用新順序：畫面＋本機快取＋排程雲端存檔
function hlSetViews(views) {
  homeLayoutViews = hlSanitize(views);
  const count = homeLayoutViews.filter(v => { const it = hlCatalogMap()[v]; return it && hlAllowed(it); }).length;
  if (count < homeLayoutCols) homeLayoutCols = Math.max(HL_COLS_MIN, count); // 卡片少於欄數＝縮回
  hlWriteCache();
  renderHomeLayout();
  hlScheduleSave();
}

function hlStatus(text, isError) {
  const el = document.getElementById('homeEditStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

function hlScheduleSave() {
  clearTimeout(hlSaveTimer);
  hlStatus('儲存中…');
  hlSaveTimer = setTimeout(hlSaveNow, 600);
}

async function hlSaveNow() {
  clearTimeout(hlSaveTimer);
  hlSaveTimer = null;
  const views = homeLayoutViews.slice();
  try {
    const res = await postTask({ type: 'setting-set', key: HOME_LAYOUT_SETTING_KEY, personal: true, value: JSON.stringify({ views, cols: homeLayoutCols }) });
    if (!res || !res.success) { hlStatus('儲存失敗：' + ((res && res.error) || '請稍後再試'), true); return false; }
    homeLayoutLoaded = true;
    hlStatus('已儲存');
    return true;
  } catch (e) {
    hlStatus('儲存失敗：網路連線有問題，請稍後再試', true);
    return false;
  }
}

// 開頁先用本機快取畫（避免先閃預設 7 張再跳）
function homeLayoutBoot() {
  try {
    const raw = localStorage.getItem(hlCacheKey());
    if (raw) {
      const c = JSON.parse(raw); // 舊快取是純陣列、新快取是 {views, cols}
      homeLayoutViews = hlSanitize(Array.isArray(c) ? c : c.views);
      if (!Array.isArray(c)) homeLayoutCols = hlNormCols(c.cols);
    }
  } catch (e) {}
  renderHomeLayout();
}

// admin.js 每次載完後台包（權限已更新）會呼叫；雲端只讀第一次
async function homeLayoutLoad() {
  if (homeLayoutLoaded) { renderHomeLayout(); return; }
  homeLayoutBoot();
  try {
    const res = await postTask({ type: 'setting-get', key: HOME_LAYOUT_SETTING_KEY, personal: true });
    if (!res || !res.success) return;
    homeLayoutLoaded = true;
    if (homeEditMode) return; // 使用者已經在改了，不要拿雲端舊值蓋掉
    let views = HOME_LAYOUT_DEFAULT;
    if (res.value) {
      const parsed = JSON.parse(res.value);
      if (parsed && Array.isArray(parsed.views)) views = parsed.views;
      homeLayoutCols = hlNormCols(parsed && parsed.cols);
    } else {
      homeLayoutCols = HL_COLS_MIN;
    }
    homeLayoutViews = hlSanitize(views);
    hlWriteCache();
    renderHomeLayout();
  } catch (e) { /* 讀不到就維持快取／預設 */ }
}

// ===== 編輯模式 =====
function enterHomeEditMode() {
  if (typeof isViewOnlyMode !== 'undefined' && isViewOnlyMode) return;
  homeEditMode = true;
  hlStatus('');
  renderHomeLayout();
}
async function exitHomeEditMode() {
  if (hlSaveTimer) await hlSaveNow();
  homeEditMode = false;
  renderHomeLayout();
}
function homeLayoutResetDefault() {
  if (!confirm('要把首頁恢復成預設的 7 個入口（每排 4 個）嗎？')) return;
  homeLayoutCols = HL_COLS_MIN;
  hlSetViews(HOME_LAYOUT_DEFAULT.slice());
}

// 編輯模式中：首頁卡片的點擊不換頁；左欄項目點一下＝加到首頁最後（不換頁）
document.addEventListener('click', (e) => {
  if (!homeEditMode) return;
  const t = e.target;
  if (!t || !t.closest) return;
  const card = t.closest('#viewHome .home-grid .home-card');
  if (card && !t.closest('.hc-remove')) { e.stopPropagation(); e.preventDefault(); return; }
  const sn = t.closest('#sideNav .sn-item[data-view]');
  if (!sn) return;
  // 首頁不在畫面上（例如從漢堡選單換頁了）＝自動結束編輯模式，讓點擊照常換頁
  if (typeof isViewShown === 'function' && !isViewShown('home')) { exitHomeEditMode(); return; }
  e.stopPropagation();
  e.preventDefault();
  if (Date.now() < hlSuppressClickUntil) return;
  const view = sn.dataset.view;
  if (view === 'home') return;
  if (homeLayoutViews.includes(view)) { hlFlashCard(view); return; }
  if (sn.dataset.perm && !hasPerm(sn.dataset.perm)) return;
  hlSetViews(hlGridViews().concat(view));
  hlFlashCard(view);
}, true);

function hlFlashCard(view) {
  const card = document.querySelector('#viewHome .home-grid .home-card[data-view="' + view + '"]');
  if (!card) return;
  card.classList.remove('hc-flash');
  void card.offsetWidth;
  card.classList.add('hc-flash');
}

// ===== 拖曳 =====
// kind='card'：首頁卡片排序（卡片本身跟著移動位置）
// kind='add'：從左欄／加入區拖進來（游標旁有浮動小卡，格子裡出現虛線占位）
document.addEventListener('pointerdown', (e) => {
  if (!homeEditMode) return;
  const t = e.target;
  if (!t || !t.closest || t.closest('.hc-remove')) return;
  const card = t.closest('#viewHome .home-grid .home-card');
  if (card) { hlPointerDown(e, { kind: 'card', view: card.dataset.view, source: card }); return; }
  const sn = t.closest('#sideNav .sn-item[data-view]');
  if (sn && sn.dataset.view !== 'home' && !homeLayoutViews.includes(sn.dataset.view)
      && (!sn.dataset.perm || hasPerm(sn.dataset.perm))
      && (typeof isViewShown !== 'function' || isViewShown('home'))) {
    hlPointerDown(e, { kind: 'add', view: sn.dataset.view, source: sn });
  }
}, true);

function hlPointerDown(e, info) {
  if (hlDrag) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  hlDrag = Object.assign({}, info, {
    startX: e.clientX, startY: e.clientY, started: false, moved: false, timer: null,
    isTouch: e.pointerType !== 'mouse', ghost: null, placeholder: null,
  });
  if (hlDrag.isTouch) hlDrag.timer = setTimeout(() => { if (hlDrag && !hlDrag.started && !hlDrag.moved) hlStartDrag(hlDrag.startX, hlDrag.startY); }, 300);
  document.addEventListener('pointermove', hlDragMove);
  document.addEventListener('pointerup', hlDragUp);
  document.addEventListener('pointercancel', hlDragCancel);
}
function hlBlockScroll(e) { e.preventDefault(); }

// 拖曳時游標下跟著一張半透明的卡（2026-10-10 雪莉：比較直覺），尺寸同首頁卡片；
// 拖既有卡片＝抓哪裡就從哪裡跟著走，從左欄／加入區拖＝卡片中心對準游標。
function hlStartDrag(x, y) {
  hlDrag.started = true;
  document.addEventListener('touchmove', hlBlockScroll, { passive: false });
  document.body.classList.add('hl-dragging');
  if (hlDrag.kind === 'card') {
    const r = hlDrag.source.getBoundingClientRect();
    const ghost = hlDrag.source.cloneNode(true);
    ghost.removeAttribute('onclick');
    ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); // 任務卡含 #homeUrgentIcon，複本不能重複 id
    ghost.querySelectorAll('.hc-remove').forEach(n => n.remove());
    hlMountGhost(ghost, r.width, r.height, hlDrag.startX - r.left, hlDrag.startY - r.top);
    hlDrag.source.classList.add('hc-dragging');
    hlMoveGhost(x, y);
    return;
  }
  const item = hlCatalogMap()[hlDrag.view];
  if (!item) return;
  const ph = document.createElement('div');
  ph.className = 'home-card hc-placeholder';
  ph.appendChild(hlIconSpan('hc-icon', item.iconHtml, '1.6'));
  const phName = document.createElement('span');
  phName.className = 'hc-name';
  phName.textContent = item.name;
  ph.appendChild(phName);
  hlDrag.placeholder = ph;
  // 浮動卡尺寸＝目前首頁一張卡的大小（沒有卡就用預設）
  const sample = Array.from(document.querySelectorAll('#viewHome .home-grid .home-card')).find(c => c.style.display !== 'none');
  const sr = sample ? sample.getBoundingClientRect() : null;
  const w = sr && sr.width ? sr.width : 150;
  const h = sr && sr.height ? sr.height : 110;
  const ghost = ph.cloneNode(true);
  ghost.className = 'home-card';
  hlMountGhost(ghost, w, h, w / 2, h / 2);
  hlMoveGhost(x, y);
}

function hlMountGhost(ghost, w, h, offX, offY) {
  ghost.classList.add('hl-card-ghost');
  ghost.style.width = w + 'px';
  ghost.style.height = h + 'px';
  ghost.style.display = '';
  ghost.style.gridColumn = '';
  ghost.style.gridRow = '';
  document.body.appendChild(ghost);
  hlDrag.ghost = ghost;
  hlDrag.offX = offX;
  hlDrag.offY = offY;
}

function hlMoveGhost(x, y) {
  if (hlDrag && hlDrag.ghost) hlDrag.ghost.style.transform = 'translate(' + (x - hlDrag.offX) + 'px,' + (y - hlDrag.offY) + 'px)';
}

// 落點判斷（第二版：驗收抓到「依最近卡片中心算」會因版面位移來回抖動，改成只看游標正下方那張卡）
// 可放下的範圍＝整個首頁畫面（不只格子；雪莉：拖到格子外也要有用），「可以加入」區除外（放回去＝取消）
function hlGridInRange(x, y) {
  const view = document.getElementById('viewHome');
  const grid = view && view.querySelector('.home-grid');
  if (!grid) return null;
  const r = view.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const tray = document.getElementById('homeAddTray');
  if (tray && tray.style.display !== 'none') {
    const tr = tray.getBoundingClientRect();
    if (x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom) return null;
  }
  return grid;
}
function hlCardUnder(x, y, grid) {
  const under = document.elementFromPoint(x, y);
  const card = under && under.closest ? under.closest('.home-card') : null;
  return card && card.parentNode === grid ? card : null;
}

function hlDragMove(e) {
  if (!hlDrag) return;
  const dist = Math.hypot(e.clientX - hlDrag.startX, e.clientY - hlDrag.startY);
  if (!hlDrag.started) {
    if (!hlDrag.isTouch && dist > 6) hlStartDrag(e.clientX, e.clientY);
    else if (dist > 10) { hlDrag.moved = true; clearTimeout(hlDrag.timer); }
    if (!hlDrag.started) return;
  }
  e.preventDefault();
  hlMoveGhost(e.clientX, e.clientY);
  // 拖到右邊「多一欄」放置區：記下游標所在的列，放開時欄數＋1
  const zone = document.getElementById('homeExtraCol');
  if (zone && zone.style.display !== 'none') {
    const zr = zone.getBoundingClientRect();
    const inZone = e.clientX >= zr.left && e.clientX <= zr.right && e.clientY >= zr.top - 20 && e.clientY <= zr.bottom + 20;
    zone.classList.toggle('is-over', inZone);
    if (inZone) {
      hlDrag.overExtraRow = hlRowAt(e.clientY);
      if (hlDrag.placeholder && hlDrag.placeholder.parentNode) { hlDrag.placeholder.remove(); hlPositionCards(); }
      return;
    }
    hlDrag.overExtraRow = null;
  }
  const grid = hlGridInRange(e.clientX, e.clientY);
  if (hlDrag.kind === 'card') {
    // 同 customBlocks.js cbDrag：游標下的卡在後面＝放到它後面、在前面＝放到它前面（交換後游標落在自己身上就不再動＝不抖）
    if (!grid) return;
    const target = hlCardUnder(e.clientX, e.clientY, grid);
    if (!target || target === hlDrag.source) return;
    const cards = Array.from(grid.querySelectorAll('.home-card'));
    if (cards.indexOf(hlDrag.source) < cards.indexOf(target)) target.after(hlDrag.source);
    else target.before(hlDrag.source);
    hlPositionCards();
    return;
  }
  const ph = hlDrag.placeholder;
  if (!grid) { if (ph && ph.parentNode) { ph.remove(); hlPositionCards(); } return; }
  const target = hlCardUnder(e.clientX, e.clientY, grid); // 占位 pointer-events:none，不會被抓到
  if (!target) {
    // 游標在格子下方（低於最後一排）＝放最後；在卡片之間的縫隙＝維持原占位
    const gr = grid.getBoundingClientRect();
    const last = Array.from(grid.querySelectorAll('.home-card')).pop();
    if (!ph.parentNode || e.clientY > gr.bottom) { if (last !== ph) { grid.appendChild(ph); hlPositionCards(); } }
    return;
  }
  // 游標在卡片左半＝插在它前面、右半＝後面；插入後游標下的卡已滑開，下一次判斷落在占位或同一張卡上，不會來回跳
  const r = target.getBoundingClientRect();
  if (e.clientX < r.left + r.width / 2) { if (target.previousElementSibling !== ph) { target.before(ph); hlPositionCards(); } }
  else if (target.nextElementSibling !== ph) { target.after(ph); hlPositionCards(); }
}

// 游標在第幾列（依目前看得到的卡片頂端位置）
function hlRowAt(y) {
  const grid = document.querySelector('#viewHome .home-grid');
  if (!grid) return 0;
  const tops = [];
  grid.querySelectorAll('.home-card').forEach(c => { if (c.style.display === 'none' || c.classList.contains('hc-placeholder')) return; const t = Math.round(c.getBoundingClientRect().top); if (!tops.includes(t)) tops.push(t); });
  tops.sort((p, q) => p - q);
  let row = 0;
  tops.forEach((t, i) => { if (y >= t) row = i; });
  return row;
}

function hlDragCleanup() {
  if (!hlDrag) return;
  clearTimeout(hlDrag.timer);
  document.removeEventListener('pointermove', hlDragMove);
  document.removeEventListener('pointerup', hlDragUp);
  document.removeEventListener('pointercancel', hlDragCancel);
  document.removeEventListener('touchmove', hlBlockScroll);
  document.body.classList.remove('hl-dragging');
  const zone = document.getElementById('homeExtraCol');
  if (zone) zone.classList.remove('is-over');
  if (hlDrag.ghost) hlDrag.ghost.remove();
  if (hlDrag.source) hlDrag.source.classList.remove('hc-dragging');
  if (hlDrag.started) hlSuppressClickUntil = Date.now() + 400;
}

function hlDragCancel() {
  hlDragCleanup();
  if (hlDrag && hlDrag.placeholder) hlDrag.placeholder.remove();
  hlDrag = null;
  renderHomeLayout();
}

function hlDragUp() {
  if (!hlDrag) return;
  const d = hlDrag;
  hlDragCleanup();
  hlDrag = null;
  if (!d.started) return;
  if (d.overExtraRow !== null && d.overExtraRow !== undefined && homeLayoutCols < HL_COLS_MAX) {
    if (d.placeholder) d.placeholder.remove();
    const newCols = homeLayoutCols + 1;
    const views = hlGridViews().filter(v => v !== d.view);
    const idx = Math.min(d.overExtraRow * newCols + newCols - 1, views.length);
    views.splice(idx, 0, d.view);
    homeLayoutCols = newCols;
    hlSetViews(views);
    hlFlashCard(d.view);
    return;
  }
  if (d.kind === 'card') {
    const views = hlGridViews();
    if (views.join() !== homeLayoutViews.join()) hlSetViews(views);
    return;
  }
  const ph = d.placeholder;
  if (!ph || !ph.parentNode) { renderHomeLayout(); return; }
  const grid = ph.parentNode;
  const views = [];
  Array.from(grid.querySelectorAll('.home-card')).forEach(c => {
    if (c === ph) views.push(d.view);
    else if (c.dataset.view) views.push(c.dataset.view);
  });
  ph.remove();
  hlSetViews(views);
  hlFlashCard(d.view);
}

// 編輯中跨過手機／桌機寬度時，重排「多一欄」放置區與卡片位置
let hlResizeTimer = null;
window.addEventListener('resize', () => {
  if (!homeEditMode) return;
  clearTimeout(hlResizeTimer);
  hlResizeTimer = setTimeout(renderHomeLayout, 150);
});
