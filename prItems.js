// ===================================================================
// prItems.js — 公關品清單頁＋公關品明細（行事曆彈窗／派遣任務彈窗共用）
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('prItems')
// → loadPrItems()；本檔若排在後面，開機當下函式還不存在，整頁變磚
// （同 2026-07-21 bvSearchScope TDZ 事故的模式）。
//
// 本檔最外層只有「宣告」與「DOM 事件掛載」（script 在 </body> 前，DOM 已就緒），
// 不得在最外層直接呼叫 admin.js 的函式。執行期依賴 admin.js 的全域：
// postTask、prLocations、fillPrLocationSelect、setFormStatus、allEvents、
// getMemoKey、escapeHtml 等——這些都在事件/函式內才會被讀到，載入順序安全。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放檔案最前段） -----
// 公關品清單頁
let prItemsLoaded = false;
let prItemsCache = [];
let priFilter = 'all';          // all｜received｜shot｜unlinked
let priSort = 'created';        // brand｜created｜eventDate
const priExpanded = {};         // id -> true，記住哪幾張卡片被展開
const priInlineCtx = {};        // prefix -> { evKey, vendor, group }，共用明細區塊用
// 分類是手動標的；沒標就依所屬團購的結團日自動分到「已結團」或「未來開團」
const PR_CATEGORY_LIST = ['試用中', '準備安排開團', '暫不安排', '公關分享禮'];
const PR_TRIAL_CATEGORIES = ['試用中', '準備安排開團', '暫不安排'];
const PR_GROUP_DEFS = [
  { key: 'upcoming', label: '📅 未來開團' },
  { key: 'trial',    label: '🧪 試用中' },
  { key: 'gift',     label: '🎁 公關分享禮' },
  { key: 'ended',    label: '✅ 已結團' },
  { key: 'other',    label: '❓ 未關聯團購' }
];

// ===== 公關品狀態列表（首頁「公關品狀態」卡片頁面） =====
// prItemsLoaded / prItemsCache 等模組層狀態宣告在檔案最前段（避免開機期 TDZ），見 VIEW_ID_MAP 附近

function cssEscapeAdmin(str) { return String(str).replace(/(["\\])/g, '\\$1'); }

function renderPriLocationSelect() {
  fillPrLocationSelect(document.getElementById('priLocation'), '');
}

document.getElementById('priLocation').addEventListener('change', (e) => {
  document.getElementById('priLocationNewRow').classList.toggle('show', e.target.value === '__new__');
});
document.getElementById('priLocationNewBtn').addEventListener('click', async () => {
  const input = document.getElementById('priLocationNewInput');
  const name = input.value.trim();
  if (!name) return;
  try {
    await postTask({ type: 'pr-location-add', name });
    if (prLocations.indexOf(name) === -1) prLocations.push(name);
    fillPrLocationSelect(document.getElementById('priLocation'), name);
    document.getElementById('priLocationNewRow').classList.remove('show');
    input.value = '';
  } catch (err) {
    setFormStatus('priAddStatus', '新增位置失敗：' + err.message, 'error');
  }
});

async function loadPrItems(force) {
  fillPrEventSelect(document.getElementById('priGroup'), '');
  if (prItemsLoaded && !force) { renderPrItemsList(); return; }
  const listEl = document.getElementById('priList');
  listEl.innerHTML = '<div class="task-empty">載入中…</div>';
  try {
    const result = await postTask({ type: 'pr-item-list' });
    prItemsCache = Array.isArray(result.items) ? result.items : [];
    prItemsLoaded = true;
  } catch (err) {
    listEl.innerHTML = '<div class="task-empty">讀取失敗：' + escHtml(err.message) + '</div>';
    return;
  }
  renderPrItemsList();
}

// 清單頁篩選／排序／分組的狀態與常數宣告在檔案最前段（避免開機期 TDZ），見 VIEW_ID_MAP 附近

function priFilterMatch_(item) {
  const st = prStatusOfItem_(item);
  if (priFilter === 'received') return st === '已收到';
  if (priFilter === 'shot') return st === '已拍攝';
  // 跟分組用同一套判斷，免得「evKey 指向已刪除團購」的品項在兩邊分類不一致
  if (priFilter === 'unlinked') return prGroupOf_(item) === 'other';
  return true;
}

function prEventOf_(evKey) {
  return evKey ? allEvents.find(e => getMemoKey(e) === evKey) : null;
}

// 結團日＝含延長的實際結束日
function prEventEndOf_(item) {
  const ev = prEventOf_(item.evKey);
  return ev ? (ev.displayEnd || ev.end) : null;
}

function prEventStartOf_(item) {
  const ev = prEventOf_(item.evKey);
  return ev ? ev.start : null;
}

function prGroupOf_(item) {
  const cat = item.category || '';
  if (cat === '公關分享禮') return 'gift';
  if (PR_TRIAL_CATEGORIES.indexOf(cat) !== -1) return 'trial';
  const end = prEventEndOf_(item);
  if (!end) return 'other';
  return end < startOfDay(new Date()) ? 'ended' : 'upcoming';
}

// 排序：依開團日時，未來的團由近到遠、已結團的由新到舊，都是「最相關的在最上面」
function priSortItems_(items, groupKey) {
  const arr = items.slice();
  if (priSort === 'brand') {
    return arr.sort((a, b) =>
      (a.brand || '').localeCompare(b.brand || '', 'zh-Hant') ||
      (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
  }
  if (priSort === 'eventDate') {
    const asc = groupKey === 'upcoming';
    return arr.sort((a, b) => {
      const da = prEventStartOf_(a), db = prEventStartOf_(b);
      if (!da && !db) return 0;
      if (!da) return 1;          // 沒關聯團購的排最後
      if (!db) return -1;
      return asc ? da - db : db - da;
    });
  }
  // 依新增日期，新的在前。後端的「建立時間」是 M/d HH:mm 沒有年份也沒補零，
  // 字串比大小會排錯，所以改用試算表的列順序（getPrItems_ 依列序回傳＝新增順序）
  const order = priOrderMap_();
  return arr.sort((a, b) => (order.get(b.id) || 0) - (order.get(a.id) || 0));
}

// id → 在 prItemsCache 裡的列序，每次重畫建一次就好（避免排序時反覆 indexOf）
function priOrderMap_() {
  const m = new Map();
  prItemsCache.forEach((it, i) => m.set(it.id, i));
  return m;
}

function renderPrItemsList() {
  const listEl = document.getElementById('priList');
  if (!listEl) return;
  if (!prItemsCache.length) {
    listEl.innerHTML = '<div class="task-empty">目前沒有公關品紀錄</div>';
    return;
  }
  const matched = prItemsCache.filter(priFilterMatch_);
  if (!matched.length) {
    listEl.innerHTML = '<div class="task-empty">這個條件下沒有公關品</div>';
    return;
  }
  listEl.innerHTML = PR_GROUP_DEFS.map(def => {
    const items = priSortItems_(matched.filter(it => prGroupOf_(it) === def.key), def.key);
    if (!items.length) return '';   // 空的分組就不佔版面
    return `<div class="pri-group">` +
      `<div class="pri-group-head">${escHtml(def.label)}<span class="pri-group-count">${items.length}</span></div>` +
      items.map(priCardHtml_).join('') +
      `</div>`;
  }).join('');
  bindPrItemCards_();
}

function priCardHtml_(it) {
  const id = escHtml(it.id);
  const st = prStatusOfItem_(it);
  const chip = st
    ? `<span class="pri-card-chip pr-${PR_STATUS_CLASS[st] || 'st-none'}">${escHtml(st)}</span>`
    : '<span class="pri-card-chip">未關聯團購</span>';
  const groupText = prEventTitleOf_(it.evKey) || it.group || '—';
  const open = !!priExpanded[it.id];
  const catTag = it.category ? `<span class="pri-card-cat">${escHtml(it.category)}</span>` : '';
  return `
    <div class="pri-card${open ? ' open' : ''}" data-id="${id}">
      <div class="pri-card-head" data-id="${id}">
        <span class="pri-card-arrow">${open ? '▾' : '▸'}</span>
        <span class="pri-card-title">${escHtml(it.name || '（未命名）')}</span>
        ${it.brand ? `<span class="pri-card-brand">${escHtml(it.brand)}</span>` : ''}
        ${catTag}${chip}
      </div>
      <div class="pri-card-body"${open ? '' : ' style="display:none;"'}>
        <div class="pri-card-meta">廠商：${escHtml(it.vendor || '—')}　團購：${escHtml(groupText)}</div>
        <div class="pri-card-row">
          <select class="pri-edit-group" data-id="${id}"></select>
          <select class="pri-edit-category" data-id="${id}"></select>
        </div>
        <div class="pri-card-row">
          <input type="text" class="pri-edit-brand" data-id="${id}" placeholder="品牌" value="${escHtml(it.brand || '')}">
          <select class="pri-edit-location" data-id="${id}"></select>
        </div>
        <div class="pri-card-row">
          <input type="text" class="pri-edit-note" data-id="${id}" placeholder="備註" value="${escHtml(it.note || '')}" style="flex:1 1 100%;">
        </div>
        <div class="pri-card-actions">
          <button class="pnote-btn pnote-btn-save pri-save-btn" data-id="${id}">💾 儲存</button>
          <button class="pnote-btn pnote-btn-delete pri-delete-btn" data-id="${id}">🗑 刪除</button>
          <span class="pri-card-status" id="priStatus_${id}"></span>
        </div>
      </div>
    </div>`;
}

function bindPrItemCards_() {
  const listEl = document.getElementById('priList');
  if (!listEl) return;

  listEl.querySelectorAll('.pri-card-head').forEach(head => {
    head.addEventListener('click', () => {
      const id = head.dataset.id;
      priExpanded[id] = !priExpanded[id];
      const card = head.parentElement;
      card.classList.toggle('open', priExpanded[id]);
      card.querySelector('.pri-card-body').style.display = priExpanded[id] ? '' : 'none';
      head.querySelector('.pri-card-arrow').textContent = priExpanded[id] ? '▾' : '▸';
    });
  });

  listEl.querySelectorAll('.pri-edit-category').forEach(sel => {
    const id = sel.dataset.id;
    const item = prItemsCache.find(x => x.id === id);
    const cur = item ? (item.category || '') : '';
    sel.innerHTML = '<option value="">（依團購時間自動分組）</option>' +
      PR_CATEGORY_LIST.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    sel.value = cur;
  });
  listEl.querySelectorAll('.pri-edit-group').forEach(sel => {
    const id = sel.dataset.id;
    const item = prItemsCache.find(x => x.id === id);
    fillPrEventSelect(sel, item ? item.evKey : '');
  });
  listEl.querySelectorAll('.pri-edit-location').forEach(sel => {
    const id = sel.dataset.id;
    const item = prItemsCache.find(x => x.id === id);
    fillPrLocationSelect(sel, item ? item.location : '');
    sel.addEventListener('change', (e) => {
      if (e.target.value === '__new__') handlePrLocationNewOption_(e.target);
    });
  });
  listEl.querySelectorAll('.pri-save-btn').forEach(btn => {
    btn.addEventListener('click', () => savePrItemEdit(btn.dataset.id));
  });
  listEl.querySelectorAll('.pri-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePrItemRow(btn.dataset.id));
  });
}

async function savePrItemEdit(id) {
  const card = document.querySelector(`.pri-card[data-id="${cssEscapeAdmin(id)}"]`);
  if (!card) return;
  const brand = card.querySelector('.pri-edit-brand').value.trim();
  const location = card.querySelector('.pri-edit-location').value;
  const note = card.querySelector('.pri-edit-note').value.trim();
  const evKey = card.querySelector('.pri-edit-group').value;
  const category = card.querySelector('.pri-edit-category').value;
  const local = prItemsCache.find(x => x.id === id);
  // 換團或換分類都會讓卡片跳到別的分組，必須整份重畫
  const regroup = !!local && ((local.evKey || '') !== evKey || (local.category || '') !== category);
  const payload = { type: 'pr-item-update', id, brand, location, note, evKey, category };
  // 團購標題跟著關聯走；查不到標題（沒關聯／團購已被刪）就別動舊資料裡手打的名稱
  const evTitle = prEventTitleOf_(evKey);
  if (evTitle) payload.group = evTitle;
  const statusEl = document.getElementById('priStatus_' + id);
  if (statusEl) { statusEl.textContent = '儲存中…'; statusEl.className = 'pri-card-status'; }
  try {
    await postTask(payload);
    if (local) {
      local.brand = brand; local.location = location; local.note = note;
      local.evKey = evKey; local.category = category;
      if (evTitle) local.group = evTitle;
    }
    if (statusEl) { statusEl.textContent = '已儲存 ✓'; statusEl.className = 'pri-card-status ok'; }
    renderPriInline('prEventItems');
    renderPriInline('taskPrItems');
    if (regroup) {
      renderPrItemsList();
      // 重畫會把上面那句「已儲存 ✓」連同舊 DOM 一起換掉，補寫回新卡片上
      const after = document.getElementById('priStatus_' + id);
      if (after) { after.textContent = '已儲存 ✓'; after.className = 'pri-card-status ok'; }
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '儲存失敗'; statusEl.className = 'pri-card-status error'; }
  }
}

async function deletePrItemRow(id) {
  if (!confirm('確定要刪除這筆公關品紀錄嗎？')) return;
  try {
    await postTask({ type: 'pr-item-delete', id });
    prItemsCache = prItemsCache.filter(x => x.id !== id);
    renderPrItemsList();
    renderPriInline('prEventItems');
    renderPriInline('taskPrItems');
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ===================================================================
// 公關品明細（行事曆彈窗／派遣任務彈窗共用）
// 資料只有一份＝「公關品清單」表；狀態不自己存，一律繼承所屬團購在
// 「公關品狀態」表的狀態（收到／拍攝都是整團一起，所以狀態掛在團上）
// ===================================================================

// 這份清單只在進公關品頁時才會載入，彈窗要用時先確保拉過一次
async function ensurePrItemsLoaded() {
  if (prItemsLoaded) return;
  const result = await postTask({ type: 'pr-item-list' });
  prItemsCache = Array.isArray(result.items) ? result.items : [];
  prItemsLoaded = true;
}

function prItemsOfEvent_(evKey) {
  if (!evKey) return [];
  return prItemsCache.filter(it => it.evKey === evKey);
}

// 公關品的狀態＝所屬團購的狀態；沒關聯團購就沒有狀態
function prStatusOfItem_(item) {
  if (!item || !item.evKey) return '';
  const pr = prStatusMap[item.evKey];
  return (pr && pr.status) || '尚未選品';
}

function prEventTitleOf_(evKey) {
  if (!evKey) return '';
  const ev = allEvents.find(e => getMemoKey(e) === evKey);
  return ev ? ev.title : '';
}

// 團購下拉：值是 memoKey，跟「公關品狀態」表用同一把鑰匙
function fillPrEventSelect(selectEl, currentValue) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">不指定團購</option>' + buildEventOptions_();
  const prev = currentValue || '';
  // 舊資料指到已被刪掉的團購時，補一個選項免得值被吃掉
  if (prev && !Array.prototype.some.call(selectEl.options, o => o.value === prev)) {
    const o = document.createElement('option');
    o.value = prev;
    o.textContent = '（已不存在的團購）';
    selectEl.appendChild(o);
  }
  selectEl.value = prev;
}

// 位置下拉選到「＋新增更多」時的共用處理
function handlePrLocationNewOption_(selectEl, onDone) {
  const name = prompt('請輸入新的位置選項：');
  if (!name || !name.trim()) { selectEl.value = ''; return; }
  const trimmed = name.trim();
  postTask({ type: 'pr-location-add', name: trimmed }).then(() => {
    if (prLocations.indexOf(trimmed) === -1) prLocations.push(trimmed);
    fillPrLocationSelect(selectEl, trimmed);
    if (onDone) onDone(trimmed);
  }).catch(err => {
    selectEl.value = '';
    alert('新增位置失敗：' + err.message);
  });
}

// priInlineCtx 宣告在檔案最前段（避免開機期 TDZ），見 VIEW_ID_MAP 附近

function priInlineField_(prefix) {
  return document.querySelector('.pri-inline-field[data-pri-prefix="' + prefix + '"]');
}

function setPriInlineMsg(prefix, text, ok) {
  const field = priInlineField_(prefix);
  if (!field) return;
  const el = field.querySelector('.pri-inline-msg');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok === true ? '#7BAF7B' : (ok === false ? '#d9534f' : '#c9a892');
}

// 掛載到某一場團購；evKey 為空時整區隱藏（例如任務沒指定對應團購）
function mountPriInline(prefix, evKey, ctx) {
  const field = priInlineField_(prefix);
  if (!field) return;
  priInlineCtx[prefix] = Object.assign({ evKey: evKey || '' }, ctx || {});
  field.style.display = evKey ? 'block' : 'none';
  setPriInlineMsg(prefix, '');
  const input = field.querySelector('.pri-inline-add-input');
  if (input) input.value = '';
  if (!evKey) return;
  renderPriInline(prefix);
  ensurePrItemsLoaded()
    .then(() => renderPriInline(prefix))
    .catch(() => setPriInlineMsg(prefix, '公關品清單讀取失敗', false));
}

function renderPriInline(prefix) {
  const field = priInlineField_(prefix);
  if (!field) return;
  const ctx = priInlineCtx[prefix] || {};
  const listEl = field.querySelector('.pri-inline-list');
  const countEl = field.querySelector('.pri-inline-count');
  const items = prItemsOfEvent_(ctx.evKey);
  if (countEl) countEl.textContent = items.length ? '（' + items.length + ' 件）' : '';
  if (!items.length) {
    listEl.innerHTML = '<div class="pri-inline-empty">還沒有登記公關品，在下面輸入名稱就能加一件</div>';
    return;
  }
  listEl.innerHTML = items.map(it => `
    <div class="pri-inline-row" data-id="${escHtml(it.id)}">
      <input type="text" class="pri-inline-name" value="${escHtml(it.name || '')}" placeholder="名稱">
      <input type="text" class="pri-inline-brand" value="${escHtml(it.brand || '')}" placeholder="品牌">
      <select class="pri-inline-loc"></select>
      <button type="button" class="pri-inline-del" title="刪除這件">🗑</button>
    </div>`).join('');

  listEl.querySelectorAll('.pri-inline-row').forEach(row => {
    const id = row.dataset.id;
    const item = items.find(x => x.id === id);
    const loc = row.querySelector('.pri-inline-loc');
    fillPrLocationSelect(loc, item ? item.location : '');
    loc.addEventListener('change', (e) => {
      if (e.target.value === '__new__') {
        handlePrLocationNewOption_(e.target, () => savePriInlineRow(prefix, id));
        return;
      }
      savePriInlineRow(prefix, id);
    });
    row.querySelector('.pri-inline-name').addEventListener('change', () => savePriInlineRow(prefix, id));
    row.querySelector('.pri-inline-brand').addEventListener('change', () => savePriInlineRow(prefix, id));
    row.querySelector('.pri-inline-del').addEventListener('click', () => deletePriInlineRow(prefix, id));
  });
}

async function savePriInlineRow(prefix, id) {
  const field = priInlineField_(prefix);
  if (!field) return;
  const row = field.querySelector('.pri-inline-row[data-id="' + cssEscapeAdmin(id) + '"]');
  if (!row) return;
  const name = row.querySelector('.pri-inline-name').value.trim();
  const brand = row.querySelector('.pri-inline-brand').value.trim();
  const locVal = row.querySelector('.pri-inline-loc').value;
  const location = locVal === '__new__' ? '' : locVal;
  setPriInlineMsg(prefix, '儲存中…');
  try {
    await postTask({ type: 'pr-item-update', id, name, brand, location });
    const local = prItemsCache.find(x => x.id === id);
    if (local) { local.name = name; local.brand = brand; local.location = location; }
    setPriInlineMsg(prefix, '已儲存 ✓', true);
    if (isViewShown('prItems')) renderPrItemsList();
  } catch (err) {
    setPriInlineMsg(prefix, '儲存失敗：' + err.message, false);
  }
}

async function deletePriInlineRow(prefix, id) {
  if (!confirm('確定要刪除這件公關品嗎？')) return;
  setPriInlineMsg(prefix, '刪除中…');
  try {
    await postTask({ type: 'pr-item-delete', id });
    prItemsCache = prItemsCache.filter(x => x.id !== id);
    renderPriInline(prefix);
    setPriInlineMsg(prefix, '已刪除 ✓', true);
    if (isViewShown('prItems')) renderPrItemsList();
  } catch (err) {
    setPriInlineMsg(prefix, '刪除失敗：' + err.message, false);
  }
}

async function addPriInline(prefix) {
  const field = priInlineField_(prefix);
  if (!field) return;
  const ctx = priInlineCtx[prefix] || {};
  if (!ctx.evKey) return;
  const input = field.querySelector('.pri-inline-add-input');
  const name = (input.value || '').trim();
  if (!name) { setPriInlineMsg(prefix, '請先輸入名稱', false); return; }
  setPriInlineMsg(prefix, '新增中…');
  try {
    await ensurePrItemsLoaded();
    const payload = {
      type: 'pr-item-add',
      name,
      vendor: ctx.vendor || '',
      group: ctx.group || '',
      evKey: ctx.evKey
    };
    const result = await postTask(payload);
    prItemsCache.push({
      id: result.id, name, vendor: payload.vendor, brand: '', group: payload.group,
      location: '', note: '', created: '', updated: '', evKey: ctx.evKey
    });
    input.value = '';
    renderPriInline(prefix);
    setPriInlineMsg(prefix, '已新增 ✓', true);
    if (isViewShown('prItems')) renderPrItemsList();
  } catch (err) {
    setPriInlineMsg(prefix, '新增失敗：' + err.message, false);
  }
}

// 兩個共用區塊的新增按鈕／Enter 送出，一次接線
document.querySelectorAll('.pri-inline-field').forEach(field => {
  const prefix = field.dataset.priPrefix;
  field.querySelector('.pri-inline-add-btn').addEventListener('click', () => addPriInline(prefix));
  field.querySelector('.pri-inline-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addPriInline(prefix); }
  });
});

// 公關品清單頁的篩選鈕
document.querySelectorAll('.pri-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    priFilter = btn.dataset.priFilter;
    document.querySelectorAll('.pri-filter-btn').forEach(b => b.classList.toggle('on', b === btn));
    renderPrItemsList();
  });
});

document.getElementById('priSortSelect').addEventListener('change', (e) => {
  priSort = e.target.value;
  renderPrItemsList();
});

document.getElementById('priAddBtn').addEventListener('click', async () => {
  const name = document.getElementById('priName').value.trim();
  const vendor = document.getElementById('priVendor').value.trim();
  const brand = document.getElementById('priBrand').value.trim();
  const evKey = document.getElementById('priGroup').value;
  const group = prEventTitleOf_(evKey);   // 團購名稱一律由關聯的團購決定，不再手打
  const category = document.getElementById('priCategory').value;
  const locSel = document.getElementById('priLocation').value;
  const location = locSel === '__new__' ? '' : locSel;
  const note = document.getElementById('priNote').value.trim();
  if (!name) { setFormStatus('priAddStatus', '請至少輸入名稱', 'error'); return; }
  const btn = document.getElementById('priAddBtn');
  btn.disabled = true;
  setFormStatus('priAddStatus', '新增中…');
  try {
    const result = await postTask({ type: 'pr-item-add', name, vendor, brand, group, location, note, evKey, category });
    // 一律 push：prItemsCache 的順序＝試算表列序＝新增順序，排序邏輯靠這個
    prItemsCache.push({ id: result.id, name, vendor, brand, group, location, note, created: '', updated: '', evKey, category });
    renderPrItemsList();
    ['priName', 'priVendor', 'priBrand', 'priNote'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('priGroup').value = '';
    document.getElementById('priCategory').value = '';
    document.getElementById('priLocation').value = '';
    setFormStatus('priAddStatus', '已新增 ✓', 'ok');
  } catch (err) {
    setFormStatus('priAddStatus', '新增失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
