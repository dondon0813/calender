// ===== 工作首頁自訂入口卡（2026-10-10 雪莉：每位員工自己決定首頁放哪些，綁後台帳號） =====
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
let homeLayoutDraft = null;     // 設定視窗編輯中的暫存順序

const HL_ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14.5l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

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
    out.push({
      view,
      name: clone.textContent.trim(),
      perm: btn.dataset.perm || '',
      iconHtml: svg ? svg.outerHTML : '',
    });
  });
  return out;
}

function hlAllowed(item) {
  return !item.perm || (typeof hasPerm === 'function' && hasPerm(item.perm));
}

// 只留「目前存在於側邊欄」的項目並去重（分頁改名／移除後殘值自動略過）
function hlSanitize(views) {
  const valid = new Set(hlCatalog().map(c => c.view));
  const out = [];
  (Array.isArray(views) ? views : []).forEach(v => {
    v = String(v || '');
    if (valid.has(v) && !out.includes(v)) out.push(v);
  });
  return out;
}

function hlGetCard(item) {
  const grid = document.querySelector('#viewHome .home-grid');
  let card = document.querySelector('#viewHome .home-card[data-view="' + item.view + '"]');
  if (card) return card;
  card = document.createElement('div');
  card.className = 'home-card';
  card.dataset.view = item.view;
  if (item.perm) card.dataset.perm = item.perm;
  card.addEventListener('click', () => switchView(item.view));
  const icon = document.createElement('span');
  icon.className = 'hc-icon';
  icon.innerHTML = item.iconHtml;
  const svg = icon.querySelector('svg');
  if (svg) { svg.removeAttribute('class'); svg.setAttribute('stroke-width', '1.6'); }
  const name = document.createElement('span');
  name.className = 'hc-name';
  name.textContent = item.name;
  card.appendChild(icon);
  card.appendChild(name);
  (grid || document.body).appendChild(card);
  return card;
}

function renderHomeLayout() {
  const grid = document.querySelector('#viewHome .home-grid');
  const pool = document.getElementById('homeCardPool');
  if (!grid || !pool) return;
  const catalog = hlCatalog();
  const byView = {};
  catalog.forEach(c => { byView[c.view] = c; });
  // 先全部收進隱藏區，再依順序搬回格子
  Array.from(grid.querySelectorAll('.home-card')).forEach(c => pool.appendChild(c));
  homeLayoutViews.forEach(v => {
    const item = byView[v];
    if (!item) return;
    grid.appendChild(hlGetCard(item));
  });
  // 新產生的卡片要套一次權限顯示（data-perm）
  grid.querySelectorAll('.home-card[data-perm]').forEach(el => {
    el.style.display = hasPerm(el.dataset.perm) ? '' : 'none';
  });
  const empty = document.getElementById('homeEmptyHint');
  const visible = Array.from(grid.querySelectorAll('.home-card')).some(el => el.style.display !== 'none');
  if (empty) empty.style.display = visible ? 'none' : '';
  const btn = document.getElementById('homeSettingsBtn');
  if (btn) btn.style.display = (typeof isViewOnlyMode !== 'undefined' && isViewOnlyMode) ? 'none' : '';
}

function hlApply(views) {
  const clean = hlSanitize(views);
  homeLayoutViews = clean;
  try { localStorage.setItem(hlCacheKey(), JSON.stringify(clean)); } catch (e) {}
  renderHomeLayout();
}

// 開頁先用本機快取畫（避免先閃預設 7 張再跳）
function homeLayoutBoot() {
  try {
    const raw = localStorage.getItem(hlCacheKey());
    if (raw) homeLayoutViews = hlSanitize(JSON.parse(raw));
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
    if (res.value) {
      const parsed = JSON.parse(res.value);
      hlApply(parsed && Array.isArray(parsed.views) ? parsed.views : HOME_LAYOUT_DEFAULT);
    } else {
      hlApply(HOME_LAYOUT_DEFAULT); // 雲端沒存過＝預設 7 張
    }
  } catch (e) { /* 讀不到就維持快取／預設 */ }
}

// ===== 設定視窗 =====
function openHomeLayoutModal() {
  homeLayoutDraft = homeLayoutViews.slice();
  document.getElementById('homeLayoutStatus').textContent = '';
  renderHomeLayoutModal();
  document.getElementById('homeLayoutModal').classList.add('show');
}
function closeHomeLayoutModal() {
  document.getElementById('homeLayoutModal').classList.remove('show');
  homeLayoutDraft = null;
}

function hlBtn(cls, icon, title, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hl-icon-btn ' + cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  b.addEventListener('click', onClick);
  return b;
}

function hlRow(item, controls) {
  const row = document.createElement('div');
  row.className = 'hl-row';
  const icon = document.createElement('span');
  icon.className = 'hl-row-icon';
  icon.innerHTML = item.iconHtml;
  const name = document.createElement('span');
  name.className = 'hl-row-name';
  name.textContent = item.name;
  row.appendChild(icon);
  row.appendChild(name);
  const box = document.createElement('span');
  box.className = 'hl-row-ctrl';
  controls.forEach(c => box.appendChild(c));
  row.appendChild(box);
  return row;
}

function renderHomeLayoutModal() {
  const catalog = hlCatalog().filter(hlAllowed);
  const byView = {};
  catalog.forEach(c => { byView[c.view] = c; });
  // 沒權限的項目不出現在視窗裡，但若之前選過就原樣保留在順序中（權限開回來會自動出現）
  const chosen = homeLayoutDraft.filter(v => byView[v]);
  const onList = document.getElementById('homeLayoutOn');
  const offList = document.getElementById('homeLayoutOff');
  onList.innerHTML = '';
  offList.innerHTML = '';

  chosen.forEach((v, i) => {
    const move = (dir) => {
      const j = i + dir;
      if (j < 0 || j >= chosen.length) return;
      const a = homeLayoutDraft.indexOf(chosen[i]);
      const b = homeLayoutDraft.indexOf(chosen[j]);
      [homeLayoutDraft[a], homeLayoutDraft[b]] = [homeLayoutDraft[b], homeLayoutDraft[a]];
      renderHomeLayoutModal();
    };
    const up = hlBtn('', HL_ICONS.up, '往前移', () => move(-1));
    const down = hlBtn('', HL_ICONS.down, '往後移', () => move(1));
    up.disabled = i === 0;
    down.disabled = i === chosen.length - 1;
    const rm = hlBtn('hl-remove', HL_ICONS.remove, '從首頁移除', () => {
      homeLayoutDraft = homeLayoutDraft.filter(x => x !== v);
      renderHomeLayoutModal();
    });
    onList.appendChild(hlRow(byView[v], [up, down, rm]));
  });
  if (!chosen.length) {
    const p = document.createElement('p');
    p.className = 'hl-empty';
    p.textContent = '首頁目前沒有放任何入口，從下面加入。';
    onList.appendChild(p);
  }

  const rest = catalog.filter(c => !homeLayoutDraft.includes(c.view));
  rest.forEach(item => {
    const add = hlBtn('hl-add', HL_ICONS.add, '加到首頁', () => {
      homeLayoutDraft.push(item.view);
      renderHomeLayoutModal();
    });
    offList.appendChild(hlRow(item, [add]));
  });
  if (!rest.length) {
    const p = document.createElement('p');
    p.className = 'hl-empty';
    p.textContent = '全部都已經放在首頁了。';
    offList.appendChild(p);
  }
}

function homeLayoutResetDraft() {
  homeLayoutDraft = HOME_LAYOUT_DEFAULT.slice();
  renderHomeLayoutModal();
}

async function saveHomeLayout() {
  const status = document.getElementById('homeLayoutStatus');
  const btn = document.getElementById('homeLayoutSaveBtn');
  const views = hlSanitize(homeLayoutDraft);
  btn.disabled = true;
  status.textContent = '儲存中…';
  try {
    const res = await postTask({ type: 'setting-set', key: HOME_LAYOUT_SETTING_KEY, personal: true, value: JSON.stringify({ views }) });
    if (!res || !res.success) {
      status.textContent = '儲存失敗：' + ((res && res.error) || '請稍後再試');
      return;
    }
    homeLayoutLoaded = true;
    hlApply(views);
    closeHomeLayoutModal();
  } catch (e) {
    status.textContent = '儲存失敗：網路連線有問題，請稍後再試';
  } finally {
    btn.disabled = false;
  }
}
