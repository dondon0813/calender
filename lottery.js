// ===================================================================
// lottery.js — 抽獎（抽獎活動＋得獎人；掛在帳務頁子分頁「🎁 抽獎」，2026-09-14 改版）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 accounting.js／subscriptions.js／
// books.js）。理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好
// 停在 accounting（或舊值 lottery）、本檔卻排在後面，開機當下 loadLotteryView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js／accounting.js 的內部函式；
// 跟它們共用的只有全域 currentToken／hasPerm／hasEditPerm／escHtml／copyText／acctTab／
// renderAccountingView／acctSwitchTab／switchView 等（同 books.js 的做法，呼叫前一律 typeof 防呆）。
//
// 資料模型改版（取代舊版的行事曆 event_id 綁定）：抽獎活動改綁「帳務團」（accounting_records，
// 也就是雪莉常說的 R 號），不再綁行事曆團——行事曆 events 只涵蓋 2026 年，拿它當綁定／排序錨點
// 會讓 2025 年以前的抽獎全部對不上（dondon-platform memory anchor-new-features-on-hub-table）。
// 四個分區（lottery_draws.section）：groupbuy 團購抽獎（綁帳務團，依 R 號排序）｜non_groupbuy 非團購
// （簽到／貼文／記事本…）｜special 🎂 特殊抽獎專區（生日慶，不綁團）｜groupbuy 但 acctId 為空＝待配對。
//
// 對應設計正本：dondon-platform/docs/09-lottery-design.md §11（11.1 定案／11.3 API／11.4 前端）。
// ===================================================================

const LOTTERY_API_URL = 'https://dondon-platform.vercel.app/api/lottery';

// ----- 模組層狀態 -----
let LOTTERY_LOADED = false;
let LOTTERY_LOAD_PROMISE = null;   // 同時觸發（帳務明細小標預抓＋使用者點開子分頁）共用同一個請求
let LOTTERY_TABLE_READY = true;
let LOTTERY_ACCT_READY = true;     // §11.2 三個新欄位（acct_id/section/no_lottery）還沒 push 時 false
let LOTTERY_TODAY = '';
let LOTTERY_ACCT_TEAMS = [];       // 全部帳務根列（continuation_of 為空），legacyId 升冪
let LOTTERY_DRAWS = [];
let LOTTERY_STATS = {};
let LOTTERY_BRAND_CHOICES = [];
let LOTTERY_CAN_EDIT = true;       // hasEditPerm('lotteryEdit') 的快取，每次載入/渲染時重算
let LOTTERY_VIEW = 'cards';        // 'cards'｜'todo'
let LOTTERY_FILTER = { status: 'all', brand: '', year: null, q: '' }; // year=null＝還沒套「預設今年」
let LOTTERY_SHOW_NO_LOTTERY = false; // 篩選列「已標不抽」顯示開關（預設隱藏，docs/09 §11.4）
let LOTTERY_SECTION_COLLAPSED = { groupbuy: false, non_groupbuy: false, special: false, unpaired: false };
let LOTTERY_EDIT_DRAW_ID = null;   // 目前 lotteryDrawModal 編輯中的活動 id；null＝新增
let LOTTERY_WINNER_EDIT = null;    // { drawId, winnerId }；winnerId=null＝新增
const LOTTERY_EXPANDED_OVERRIDE = {}; // 使用者手動展開/收合過的團卡／抽獎卡，key -> true/false，蓋過自動展開規則

// 排序方向：'asc'=依 R 號／建立時間 舊→新（預設）｜'desc'=新→舊。localStorage key: lottery_sort_dir
// 排序一律以帳務 R 號（或非團購／特殊區的建立時間）為準，不用日期猜（docs/09 §11.1 第 7 點）。
function lotLoadSortDir() {
  try {
    return localStorage.getItem('lottery_sort_dir') === 'desc' ? 'desc' : 'asc';
  } catch (e) { return 'asc'; }
}
function lotSaveSortDir(v) {
  try { localStorage.setItem('lottery_sort_dir', v); } catch (e) {}
}
let LOTTERY_SORT_DIR = lotLoadSortDir();

// 狀態機（§3）：代碼 -> 顯示名／CSS 修飾字
const LOT_STATUS_LABEL = {
  pending: '待聯絡', awaiting_info: '待回填資料', info_ready: '待寄出',
  handed_to_vendor: '廠商寄送中', done: '已完成', redrawn: '已重抽'
};
const LOT_STATUS_ORDER = ['pending', 'awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'];
const LOT_SHIP_BY_LABEL = { self: '自寄', vendor: '廠商寄', none: '不用寄' };
const LOT_SECTION_LABEL = { groupbuy: '🛍️ 團購抽獎', non_groupbuy: '📌 非團購', special: '🎂 特殊抽獎專區' };
// 篩選 chips：待聯絡刻意不列（原本設計就只有這六顆）；待抽／待配對是分區虛擬狀態，一併放進 chip 方便直接篩。
const LOT_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: 'pending_draw', label: '⏰ 待抽' },
  { key: 'awaiting_info', label: '待回填' },
  { key: 'info_ready', label: '待寄出' },
  { key: 'handed_to_vendor', label: '廠商寄送中' },
  { key: 'done', label: '已完成' },
  { key: 'redrawn', label: '已重抽' },
  { key: 'unpaired', label: '🔗 待配對' }
];
// 待辦清單視圖不含已完成/已重抽/待抽/待配對（本來就篩掉了），chips 只留跟它相關的四顆
const LOT_TODO_CHIPS = ['all', 'awaiting_info', 'info_ready', 'handed_to_vendor'];

// ===== HTML 逃逸（自帶一份，不依賴 admin.js，同 books.js/subscriptions.js 的做法）=====
function lotEscapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 登入逾時（同 subscriptions.js 的 csForceRelogin）=====
function lotForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API 呼叫 =====
async function lotApiGet() {
  const url = LOTTERY_API_URL + '?token=' + encodeURIComponent(currentToken || '');
  const res = await fetch(url);
  const data = await res.json();
  if (data && data.needLogin) { lotForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}
async function lotApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(LOTTERY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) { lotForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}

// ===== 小工具 =====
function lotSetStatus(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'form-status' + (cls ? ' ' + cls : '');
}
function lotToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
// YYYY-MM-DD -> M/D（卡頭日期／下拉用；解析不了原樣回傳）
function lotFmtMD(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return Number(m[2]) + '/' + Number(m[3]);
}
// YYYY-MM-DD -> 「YYYY年M月」（不確定日期，只到月，別顯示 1 號像真的）
function lotFmtYM(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/);
  return m ? (m[1] + '年' + Number(m[2]) + '月') : dateStr;
}
// 卡頭抽獎日顯示：日期確定＝完整「抽獎日 YYYY-MM-DD」；不確定（估算值）＝只到月「約 YYYY年M月 ⚠」
function lotFmtDrawDate(draw) {
  if (!draw.drawDate) return '';
  if (draw.dateUncertain) return '約 ' + lotFmtYM(draw.drawDate) + ' ⚠';
  return '抽獎日 ' + draw.drawDate;
}
// 距今天數（今天－dateStr），用於待辦清單「卡了幾天」；解析不了回 null
function lotDaysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - d) / 86400000);
}
// 電話中間 3 碼遮罩（不管原本格式，統一遮字串正中間 3 個字元）
function lotMaskPhone(phone) {
  const s = String(phone || '');
  if (s.length <= 3) return s ? '***' : '';
  const start = Math.max(0, Math.floor((s.length - 3) / 2));
  return s.slice(0, start) + '***' + s.slice(start + 3);
}
// 地址只顯示前 3 字＋「…」
function lotMaskAddress(addr) {
  const s = String(addr || '');
  if (!s) return '';
  return s.length > 3 ? s.slice(0, 3) + '…' : s;
}
// R 號排序鍵：抓數字部分（R0505 -> 505），抓不到就退回字串比較，永遠不會拋例外
function lotLegacyNumKey(legacyId) {
  const m = String(legacyId || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}
function lotCompareLegacyId(a, b) {
  const na = lotLegacyNumKey(a), nb = lotLegacyNumKey(b);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a || '').localeCompare(String(b || ''));
}
function lotApplyDir(items) {
  return LOTTERY_SORT_DIR === 'desc' ? items.slice().reverse() : items;
}
function lotSortDirLabel() {
  return LOTTERY_SORT_DIR === 'desc' ? '📅 新→舊 ↓' : '📅 舊→新 ↑';
}
// 固定欄寬表格的獎品欄：white-space:normal＋最多 2 行截斷（CSS -webkit-line-clamp）＋ title 全文
function lotPrizeCellHtml(prize) {
  const esc = lotEscapeHtml(prize);
  return '<td class="lot-td-prize" title="' + esc + '"><span class="lot-prize-clamp">' + esc + '</span></td>';
}

// ===== 資料存取小工具 =====
function lotDrawsForAcct(acctId) {
  return LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && d.acctId === acctId);
}
function lotTeamByAcctId(acctId) {
  return LOTTERY_ACCT_TEAMS.find(t => t.acctId === acctId) || null;
}
function lotTeamByLegacyId(legacyId) {
  return LOTTERY_ACCT_TEAMS.find(t => t.legacyId === legacyId) || null;
}

// ===== 載入 =====
// 這個函式同時服務兩種呼叫端：①使用者點開「🎁 抽獎」子分頁（accounting.js acctSwitchTab）
// ②進帳務頁時預抓一次給帳務明細列的抽獎狀態小標用（admin.js switchView）。
// 兩邊同時觸發時共用同一個請求（LOTTERY_LOAD_PROMISE），成功後一律完整重繪子分頁 DOM——
// 反正 lotBody 等元素就算子分頁沒被打開也存在（只是被 acctPaneLottery 的 display:none 蓋住），
// 預先畫好切換分頁才會瞬間，不用另外拆一套「只抓資料不畫面」的邏輯。
function loadLotteryView(forceReload) {
  if (LOTTERY_LOADED && !forceReload) return Promise.resolve();
  if (LOTTERY_LOAD_PROMISE && !forceReload) return LOTTERY_LOAD_PROMISE;

  const bodyEl = document.getElementById('lotBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="task-empty">讀取中…</div>';
  const bannerEl = document.getElementById('lotBanner');
  if (bannerEl) bannerEl.innerHTML = '';

  LOTTERY_LOAD_PROMISE = lotApiGet().then(data => {
    if (!data || !data.success) {
      if (bodyEl) bodyEl.innerHTML = '<div class="task-empty">讀取失敗：' + lotEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    LOTTERY_LOADED = true;
    LOTTERY_TABLE_READY = data.tableReady !== false;
    LOTTERY_ACCT_READY = data.acctReady !== false;
    LOTTERY_TODAY = data.today || lotToday();
    LOTTERY_ACCT_TEAMS = Array.isArray(data.acctTeams) ? data.acctTeams : [];
    LOTTERY_DRAWS = Array.isArray(data.draws) ? data.draws : [];
    LOTTERY_STATS = data.stats || {};
    LOTTERY_BRAND_CHOICES = Array.isArray(data.brandChoices) ? data.brandChoices : [];
    // 帳務年份篩選預設今年，只套用一次（之後使用者自己改就不要再洗掉）
    if (LOTTERY_FILTER.year === null) LOTTERY_FILTER.year = String(new Date().getFullYear());
    LOTTERY_CAN_EDIT = typeof hasEditPerm !== 'function' || hasEditPerm('lotteryEdit');
    const addBtn = document.getElementById('lotAddDrawBtn');
    if (addBtn) addBtn.style.display = (LOTTERY_CAN_EDIT && LOTTERY_TABLE_READY) ? '' : 'none';

    renderLotteryBanner();
    if (!LOTTERY_TABLE_READY) {
      if (document.getElementById('lotTiles')) document.getElementById('lotTiles').innerHTML = '';
      if (document.getElementById('lotFilters')) document.getElementById('lotFilters').innerHTML = '';
      if (bodyEl) bodyEl.innerHTML = '';
      return;
    }
    renderLotteryTiles();
    renderLotteryFilters();
    renderLotteryBody();
    // 帳務明細列的抽獎狀態小標要跟著這份資料一起更新（新增/修改抽獎、變更狀態後都會重跑到這裡）
    if (typeof acctTab !== 'undefined' && acctTab === 'list' && typeof renderAccountingView === 'function') {
      renderAccountingView();
    }
  }).catch(err => {
    if (bodyEl) bodyEl.innerHTML = '<div class="task-empty">讀取失敗：' + lotEscapeHtml(err.message || '') + '</div>';
  }).finally(() => { LOTTERY_LOAD_PROMISE = null; });

  return LOTTERY_LOAD_PROMISE;
}

function renderLotteryBanner() {
  const box = document.getElementById('lotBanner');
  if (!box) return;
  if (!LOTTERY_TABLE_READY) {
    box.innerHTML = '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' +
      '⚠️ 抽獎資料表尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。</div>';
  } else if (!LOTTERY_ACCT_READY) {
    box.innerHTML = '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' +
      '⚠️ 抽獎掛帳務團所需的欄位（acct_id／section／no_lottery）尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。' +
      '目前綁定帳務團、分區、「這團不抽」都先關閉，其他功能（新增得獎人、改狀態…）不受影響。</div>';
  } else {
    box.innerHTML = '';
  }
}

// ===== 摘要磚（點磚套篩選）=====
function renderLotteryTiles() {
  const box = document.getElementById('lotTiles');
  if (!box) return;
  const s = LOTTERY_STATS || {};
  const tile = (key, cls, n, label) =>
    '<div class="lot-tile ' + cls + (LOTTERY_FILTER.status === key ? ' on' : '') + '" data-tile="' + key + '">' +
    '<div class="lot-tile-n">' + (n || 0) + '</div><div class="lot-tile-l">' + label + '</div></div>';
  box.innerHTML =
    '<div class="lot-tiles-grid">' +
      tile('awaiting_info', 'await', s.awaitingInfo, '待回填資料') +
      tile('info_ready', 'ready', s.infoReady, '待寄出') +
      tile('handed_to_vendor', 'vendor', s.handedToVendor, '廠商寄送中') +
      tile('pending_draw', 'pending', s.awaitingDraw, '待抽') +
      tile('unpaired', 'unpaired', s.unpaired, '待配對') +
    '</div>';
  box.querySelectorAll('.lot-tile').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.tile;
      LOTTERY_FILTER.status = (LOTTERY_FILTER.status === key) ? 'all' : key;
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
}

// ===== 篩選列 =====
function renderLotteryFilters() {
  const box = document.getElementById('lotFilters');
  if (!box) return;
  const chipKeys = LOTTERY_VIEW === 'todo' ? LOT_TODO_CHIPS : LOT_FILTER_CHIPS.map(c => c.key);
  const chipsHtml = LOT_FILTER_CHIPS.filter(c => chipKeys.indexOf(c.key) !== -1).map(c =>
    '<span class="acct-tab' + (LOTTERY_FILTER.status === c.key ? ' on' : '') + '" data-chip="' + c.key + '">' + c.label + '</span>'
  ).join('');

  // 年份下拉只影響①團購抽獎那一區（依帳務 record_date）；只列帳務團實際出現過的年份
  const years = Array.from(new Set(LOTTERY_ACCT_TEAMS.map(t => String(t.recordDate || '').slice(0, 4)).filter(Boolean))).sort().reverse();
  const yearOptions = '<option value="">帳務年份：全部</option>' + years.map(y => '<option value="' + y + '"' + (LOTTERY_FILTER.year === y ? ' selected' : '') + '>' + y + ' 年</option>').join('');
  const brandOptions = '<option value="">品牌：全部</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '"' + (LOTTERY_FILTER.brand === b.id ? ' selected' : '') + '>' + lotEscapeHtml(b.name) + '</option>'
  ).join('');

  const noLotteryCount = LOTTERY_ACCT_TEAMS.filter(t => t.noLottery && !lotDrawsForAcct(t.acctId).length).length;
  const showToggleHtml = LOTTERY_VIEW === 'cards'
    ? '<span class="lot-toggle-chip' + (LOTTERY_SHOW_NO_LOTTERY ? ' on' : '') + '" id="lotShowNoLotteryToggle">🙈 已標不抽（' + noLotteryCount + '）</span>'
    : '';

  box.innerHTML =
    chipsHtml +
    '<select id="lotBrandSelect">' + brandOptions + '</select>' +
    (LOTTERY_VIEW === 'cards' ? '<select id="lotYearSelect">' + yearOptions + '</select>' : '') +
    '<input type="text" id="lotSearchInput" placeholder="搜尋 R號／團名／獎品／得獎人／姓名／訂單編號" value="' + lotEscapeHtml(LOTTERY_FILTER.q) + '">' +
    '<div class="lot-seg"><span class="' + (LOTTERY_VIEW === 'cards' ? 'on' : '') + '" data-seg="cards">依分區</span><span class="' + (LOTTERY_VIEW === 'todo' ? 'on' : '') + '" data-seg="todo">待辦清單</span></div>' +
    '<button class="task-mini-btn" id="lotSortDirBtn" type="button">' + lotSortDirLabel() + '</button>' +
    showToggleHtml;

  box.querySelectorAll('[data-chip]').forEach(el => {
    el.addEventListener('click', () => {
      LOTTERY_FILTER.status = el.dataset.chip;
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
  box.querySelectorAll('[data-seg]').forEach(el => {
    el.addEventListener('click', () => {
      LOTTERY_VIEW = el.dataset.seg;
      // 「待抽」「待配對」都是「依分區」卡片視圖專屬，待辦清單本來就是分區攤平的得獎人列表，
      // 切到待辦清單時重置避免篩到空
      if (LOTTERY_VIEW === 'todo' && (LOTTERY_FILTER.status === 'pending_draw' || LOTTERY_FILTER.status === 'unpaired')) LOTTERY_FILTER.status = 'all';
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
  document.getElementById('lotSortDirBtn').addEventListener('click', () => {
    LOTTERY_SORT_DIR = LOTTERY_SORT_DIR === 'asc' ? 'desc' : 'asc';
    lotSaveSortDir(LOTTERY_SORT_DIR);
    renderLotteryFilters(); renderLotteryBody();
  });
  const showToggleEl = document.getElementById('lotShowNoLotteryToggle');
  if (showToggleEl) {
    showToggleEl.addEventListener('click', () => {
      LOTTERY_SHOW_NO_LOTTERY = !LOTTERY_SHOW_NO_LOTTERY;
      renderLotteryFilters(); renderLotteryBody();
    });
  }
  document.getElementById('lotBrandSelect').addEventListener('change', function () {
    LOTTERY_FILTER.brand = this.value; renderLotteryBody();
  });
  const yearSel = document.getElementById('lotYearSelect');
  if (yearSel) yearSel.addEventListener('change', function () { LOTTERY_FILTER.year = this.value; renderLotteryBody(); });
  let searchTimer = null;
  document.getElementById('lotSearchInput').addEventListener('input', function () {
    const val = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { LOTTERY_FILTER.q = val.trim(); renderLotteryBody(); }, 200);
  });
}

// ===== 主體渲染 =====
function renderLotteryBody() {
  if (LOTTERY_VIEW === 'todo') renderLotteryTodo();
  else renderLotterySections();
}

// 分區可見性：「待抽」「待配對」是分區專屬的虛擬篩選鍵，切到那個鍵只顯示對應那一區；
// 其餘（全部／各種得獎人狀態）四區都顯示，各區內部再各自過濾。
function lotZoneVisible(key) {
  const s = LOTTERY_FILTER.status;
  if (s === 'unpaired') return key === 'unpaired';
  if (s === 'pending_draw') return key === 'groupbuy';
  return true;
}
function lotSearchQuery() { return LOTTERY_FILTER.q.trim().toLowerCase(); }
function lotWinnerHay(w) {
  return [w.prize, w.winnerHandle, w.name, w.orderNo].map(x => String(x || '')).join(' ').toLowerCase();
}
function lotWinnerStatusFilterOk(w) {
  const s = LOTTERY_FILTER.status;
  if (['awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'].indexOf(s) === -1) return true;
  return w.status === s;
}

// ===== ①團購抽獎：一個帳務團一張卡（或虛擬「待抽」卡／已標不抽列）=====
function lotZoneGroupbuyItems() {
  const items = [];
  LOTTERY_ACCT_TEAMS.forEach(team => {
    const draws = lotDrawsForAcct(team.acctId);
    if (draws.length) items.push({ type: 'real', team, draws });
    else if (team.noLottery) items.push({ type: 'nolottery', team, draws: [] });
    else if (team.pendingDraw) items.push({ type: 'pending', team, draws: [] });
    // 其餘（沒有 draw、沒標不抽、也還沒達待抽門檻）：什麼都不用做，不顯示
  });
  return items;
}
function lotFilterGroupbuyItems(items) {
  const q = lotSearchQuery();
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'].indexOf(LOTTERY_FILTER.status) !== -1;
  return items.filter(it => {
    if (it.type === 'nolottery' && !LOTTERY_SHOW_NO_LOTTERY) return false;
    if (LOTTERY_FILTER.year && String(it.team.recordDate || '').slice(0, 4) !== LOTTERY_FILTER.year) return false;
    if (LOTTERY_FILTER.brand && it.team.brandId !== LOTTERY_FILTER.brand) return false;
    if (LOTTERY_FILTER.status === 'pending_draw' && it.type === 'real') return false;
    if (winnerStatusActive) {
      if (it.type !== 'real') return false;
      const hasMatch = it.draws.some(d => (d.winners || []).some(w => w.status === LOTTERY_FILTER.status));
      if (!hasMatch) return false;
    }
    if (q) {
      const hay = [it.team.title, it.team.brandName, it.team.legacyId]
        .concat(it.draws.flatMap(d => (d.winners || []).map(lotWinnerHay)))
        .map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ===== ②非團購／③特殊抽獎專區：依建立時間 =====
function lotFilterSimpleZoneDraws(draws) {
  const q = lotSearchQuery();
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'].indexOf(LOTTERY_FILTER.status) !== -1;
  return draws.filter(d => {
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (LOTTERY_FILTER.status === 'pending_draw' || LOTTERY_FILTER.status === 'unpaired') return false;
    if (winnerStatusActive && !(d.winners || []).some(w => w.status === LOTTERY_FILTER.status)) return false;
    if (q) {
      const hay = [d.title, d.brandName].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ===== ④待配對：section=groupbuy 但 acctId 為空 =====
function lotFilterUnpairedDraws(draws) {
  const q = lotSearchQuery();
  if (LOTTERY_FILTER.status !== 'all' && LOTTERY_FILTER.status !== 'unpaired') return [];
  return draws.filter(d => {
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (q) {
      const hay = [d.title, d.brandName].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function lotRenderZone(key, label, items, itemRenderer) {
  const collapsed = !!LOTTERY_SECTION_COLLAPSED[key];
  const bodyHtml = collapsed ? '' : (items.length
    ? '<div class="lot-cards">' + items.map(itemRenderer).join('') + '</div>'
    : '<div class="task-empty lot-zone-empty">（沒有符合條件的項目）</div>');
  return '<div class="lot-zone" data-zone="' + key + '">' +
    '<div class="lot-zone-head" data-zone-toggle="' + key + '">' +
      '<span class="lot-zone-caret">' + (collapsed ? '▶' : '▼') + '</span>' +
      '<span class="lot-zone-title">' + label + '</span>' +
      '<span class="lot-zone-count">' + items.length + '</span>' +
    '</div>' +
    bodyHtml +
  '</div>';
}

function renderLotterySections() {
  const box = document.getElementById('lotBody');
  if (!box) return;

  const groupbuyItems = lotApplyDir(lotFilterGroupbuyItems(lotZoneGroupbuyItems()).sort((a, b) => lotCompareLegacyId(a.team.legacyId, b.team.legacyId)));
  const nonGroupbuyDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'non_groupbuy')).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const specialDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'special')).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const unpairedDraws = lotApplyDir(lotFilterUnpairedDraws(LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && !d.acctId)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));

  const parts = [];
  if (lotZoneVisible('groupbuy')) parts.push(lotRenderZone('groupbuy', LOT_SECTION_LABEL.groupbuy, groupbuyItems, lotGroupbuyItemHtml));
  if (lotZoneVisible('non_groupbuy')) parts.push(lotRenderZone('non_groupbuy', LOT_SECTION_LABEL.non_groupbuy, nonGroupbuyDraws, d => lotSimpleDrawCardHtml(d)));
  if (lotZoneVisible('special')) parts.push(lotRenderZone('special', LOT_SECTION_LABEL.special, specialDraws, d => lotSimpleDrawCardHtml(d)));
  if (lotZoneVisible('unpaired')) parts.push(lotRenderZone('unpaired', '🔗 待配對（團購但還沒綁帳務團）', unpairedDraws, d => lotUnpairedCardHtml(d)));

  box.innerHTML = parts.join('') || '<div class="task-empty">沒有符合條件的抽獎活動</div>';
  lotBindSectionEvents(box);
}

// ===== ①團購抽獎：卡片 HTML =====
function lotGroupbuyItemHtml(item) {
  if (item.type === 'pending') return lotPendingTeamCardHtml(item.team);
  if (item.type === 'nolottery') return lotNoLotteryRowHtml(item.team);
  return lotTeamCardHtml(item.team, item.draws);
}

function lotTeamHeaderMetaHtml(team) {
  const parts = [];
  if (team.brandName) parts.push('<span>品牌：' + lotEscapeHtml(team.brandName) + '</span>');
  if (team.recordDate) parts.push('<span>開團日 ' + lotEscapeHtml(team.recordDate) + '</span>');
  if (team.failed) parts.push('<span class="lot-warn">未成團</span>');
  return parts.join('');
}

function lotTeamCardHtml(team, draws) {
  const allWinners = draws.flatMap(d => d.winners || []);
  const total = allWinners.length;
  const doneCount = allWinners.filter(w => w.status === 'done').length;
  const unfinished = allWinners.some(w => w.status !== 'done' && w.status !== 'redrawn');
  const cardKey = 'team:' + team.acctId;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : unfinished;

  const thumb = team.brandThumb ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(team.brandThumb) + '" alt="">' : '';
  const counts = { done: 0, handed_to_vendor: 0, info_ready: 0, awaiting_info: 0, pending: 0 };
  allWinners.forEach(w => { if (counts[w.status] !== undefined) counts[w.status]++; });
  const barTotal = total || 1;
  const segHtml = ['done', 'handed_to_vendor', 'info_ready', 'awaiting_info', 'pending'].map(k => {
    const pct = Math.round((counts[k] / barTotal) * 100);
    if (!pct) return '';
    const clsMap = { done: 'lot-bar-done', handed_to_vendor: 'lot-bar-vendor', info_ready: 'lot-bar-ready', awaiting_info: 'lot-bar-await', pending: 'lot-bar-pending' };
    return '<i class="' + clsMap[k] + '" style="width:' + pct + '%"></i>';
  }).join('');
  const progressHtml = '<span class="lot-progress-txt">' + doneCount + ' / ' + total + ' 已完成</span>' + '<div class="lot-bar">' + segHtml + '</div>';

  const drawBlocksHtml = draws.map(d => lotDrawBlockHtml(d, { showWinnerFoot: true })).join('');

  return '<div class="lot-card lot-team-card" data-acct-id="' + lotEscapeHtml(team.acctId) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      '<span class="lot-r-badge">' + lotEscapeHtml(team.legacyId || '') + '</span>' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(team.title || '') + '</span></div>' +
        '<div class="lot-meta">' + lotTeamHeaderMetaHtml(team) + '</div>' +
      '</div>' +
      '<div class="lot-progress">' + progressHtml + '<span class="lot-caret">' + (expanded ? '▲ 收合' : '▼ 展開') + '</span></div>' +
    '</div>' +
    (expanded ? (
      '<div class="lot-card-body">' + drawBlocksHtml + '</div>' +
      '<div class="lot-card-foot">' +
        (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY ? '<button class="task-mini-btn" data-role="team-add-draw" data-acct-id="' + lotEscapeHtml(team.acctId) + '">＋ 這團加開一場抽獎</button>' : '') +
      '</div>'
    ) : '') +
  '</div>';
}

// 一場抽獎（一個 draw）的區塊：標題列＋meta＋得獎人表格＋（可選）小工具列。
// 團卡（正抽＋加碼可能多場）跟②③區（一區一場）都共用這個渲染，只差外層包裝。
function lotDrawBlockHtml(draw, opts) {
  opts = opts || {};
  const metaParts = [];
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  if (draw.lineKeyword) metaParts.push('<span class="lot-kw">L關鍵字：' + lotEscapeHtml(draw.lineKeyword) + '</span>');
  metaParts.push('<span>寄送：' + (LOT_SHIP_BY_LABEL[draw.shipBy] || '自寄') + '</span>');
  if (draw.note) metaParts.push('<span title="' + lotEscapeHtml(draw.note) + '">📝 有備註</span>');

  const rowsHtml = (draw.winners || []).map(w => lotWinnerRowHtml(draw.id, w)).join('');

  return '<div class="lot-draw-block" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-draw-block-head">' +
      '<span class="lot-draw-block-title">' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span>' +
      metaParts.join('') +
    '</div>' +
    '<div style="overflow-x:auto;"><table class="lot-table lot-table-fixed">' +
      '<colgroup><col style="width:200px"><col style="width:130px"><col style="width:120px"><col style="width:90px"><col style="width:130px"><col style="width:150px"><col style="width:80px"><col style="width:70px"><col><col style="width:110px"></colgroup>' +
      '<thead><tr><th>獎品</th><th>得獎人</th><th>狀態</th><th>姓名</th><th>電話</th><th>地址</th><th>寄出日</th><th>運費</th><th>備註</th><th></th></tr></thead>' +
      '<tbody>' + rowsHtml + '</tbody>' +
    '</table></div>' +
    '<div class="lot-draw-block-foot">' +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="add-winner" data-draw-id="' + lotEscapeHtml(draw.id) + '">＋ 加一位得獎人</button>' : '') +
      '<button class="task-mini-btn" data-role="copy-notify" data-draw-id="' + lotEscapeHtml(draw.id) + '">📋 複製通知文</button>' +
      '<span class="lot-spacer"></span>' +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="edit-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">✏️ 編輯這場</button>' : '') +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn danger" data-role="delete-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">🗑 刪除這場</button>' : '') +
    '</div>' +
  '</div>';
}

// ②③區：一場抽獎自己一張卡（非團購／特殊抽獎專區，不綁帳務團）
function lotSimpleDrawCardHtml(draw) {
  const total = (draw.winners || []).length;
  const doneCount = (draw.winners || []).filter(w => w.status === 'done').length;
  const unfinished = (draw.winners || []).some(w => w.status !== 'done' && w.status !== 'redrawn');
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : unfinished;
  const thumb = draw.brandThumb ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(draw.brandThumb) + '" alt="">' : '';
  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');

  return '<div class="lot-card" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span></div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<div class="lot-progress"><span class="lot-progress-txt">' + doneCount + ' / ' + total + ' 已完成</span><span class="lot-caret">' + (expanded ? '▲ 收合' : '▼ 展開') + '</span></div>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : '') +
  '</div>';
}

// ④待配對：卡＋「綁定帳務團」下拉（同品牌排最前，依開團日）＋「改為非團購」
function lotUnpairedCardHtml(draw) {
  const total = (draw.winners || []).length;
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false;
  const thumb = draw.brandThumb ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(draw.brandThumb) + '" alt="">' : '';
  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  metaParts.push('<span>' + total + ' 位得獎人</span>');

  const bindHtml = (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? (
    '<div class="lot-unpaired-bind">' +
      '<input type="text" placeholder="搜尋 R 號／團名…" data-role="unpaired-search" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
      '<select data-role="unpaired-select" data-draw-id="' + lotEscapeHtml(draw.id) + '"></select>' +
      '<button class="task-mini-btn" data-role="unpaired-bind" data-draw-id="' + lotEscapeHtml(draw.id) + '">綁定</button>' +
      '<button class="task-mini-btn" data-role="unpaired-to-nongroupbuy" data-draw-id="' + lotEscapeHtml(draw.id) + '">改為非團購</button>' +
    '</div>'
  ) : (LOTTERY_ACCT_READY ? '' : '<div class="lot-unpaired-bind"><span class="hint">⚠ 帳務欄位還沒 db push，暫時不能綁定</span></div>');

  return '<div class="lot-card" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span></div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<span class="lot-caret">' + (expanded ? '▲ 收合明細' : '▼ 展開明細') + '</span>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : '') +
    bindHtml +
  '</div>';
}

function lotPendingTeamCardHtml(team) {
  const thumb = team.brandThumb
    ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(team.brandThumb) + '" alt="">'
    : '<div class="lot-thumb-fallback">' + lotEscapeHtml(((team.brandName || team.title || '?').trim().charAt(0)) || '?') + '</div>';
  const metaParts = ['<span>開團日 ' + lotEscapeHtml(team.recordDate || '') + '</span>'];
  if (team.brandName) metaParts.push('<span>品牌：' + lotEscapeHtml(team.brandName) + '</span>');
  metaParts.push('<span class="lot-warn">已達待抽門檻</span>');
  return '<div class="lot-card lot-card-pending" data-acct-id="' + lotEscapeHtml(team.acctId) + '">' +
    '<div class="lot-card-head">' +
      '<span class="lot-r-badge">' + lotEscapeHtml(team.legacyId || '') + '</span>' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(team.title || '') + '</span></div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
    '</div>' +
    ((LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? (
      '<div class="lot-card-foot">' +
        '<button class="task-mini-btn" data-role="pending-create" data-acct-id="' + lotEscapeHtml(team.acctId) + '">＋ 建立抽獎</button>' +
        '<button class="task-mini-btn danger" data-role="pending-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">這團不抽</button>' +
      '</div>'
    ) : '') +
  '</div>';
}

// 已標「這團不抽」：預設隱藏在「🙈 已標不抽」篩選 chip 後面，展開後每列可「還原」
function lotNoLotteryRowHtml(team) {
  return '<div class="lot-nolottery-row" data-acct-id="' + lotEscapeHtml(team.acctId) + '">' +
    '<span class="lot-r-badge">' + lotEscapeHtml(team.legacyId || '') + '</span>' +
    '<span>' + lotEscapeHtml(team.title || '') + '</span>' +
    '<span class="lot-spacer"></span>' +
    ((LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? '<button class="task-mini-btn" data-role="restore-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">還原</button>' : '') +
  '</div>';
}

function lotWinnerRowHtml(drawId, w) {
  const rowCls = w.status === 'redrawn' ? ' class="lot-row-redrawn"' : '';
  const statusOptions = LOT_STATUS_ORDER.map(k => '<option value="' + k + '"' + (w.status === k ? ' selected' : '') + '>' + LOT_STATUS_LABEL[k] + '</option>').join('');
  const statusSel = '<select class="lot-status-sel lot-s-' + lotEscapeHtml(w.status) + '" data-role="status-sel" data-winner-id="' + lotEscapeHtml(w.id) + '"' + (LOTTERY_CAN_EDIT ? '' : ' disabled') + '>' + statusOptions + '</select>';

  const phoneCell = w.phone
    ? '<span class="lot-mask" data-full="' + lotEscapeHtml(w.phone) + '" data-masked="' + lotEscapeHtml(lotMaskPhone(w.phone)) + '" data-revealed="0"><span class="lot-mask-text">' + lotEscapeHtml(lotMaskPhone(w.phone)) + '</span><span class="lot-eye" data-role="toggle-mask">👁</span></span>'
    : '<span class="lot-empty-cell">—</span>';
  const addressCell = w.address
    ? '<span class="lot-mask" data-full="' + lotEscapeHtml(w.address) + '" data-masked="' + lotEscapeHtml(lotMaskAddress(w.address)) + '" data-revealed="0"><span class="lot-mask-text">' + lotEscapeHtml(lotMaskAddress(w.address)) + '</span><span class="lot-eye" data-role="toggle-mask">👁</span></span>'
    : '<span class="lot-empty-cell">—</span>';

  const actions = LOTTERY_CAN_EDIT
    ? '<button class="task-mini-btn" style="padding:2px 8px;" data-role="edit-winner" data-winner-id="' + lotEscapeHtml(w.id) + '" data-draw-id="' + lotEscapeHtml(drawId) + '">✏️</button>' +
      (w.status !== 'done' && w.status !== 'redrawn' ? '<button class="task-mini-btn" style="padding:2px 8px;" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">✅寄出</button>' : '') +
      (w.status !== 'redrawn' ? '<button class="task-mini-btn danger" style="padding:2px 8px;" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">🔁重抽</button>' : '')
    : '';

  return '<tr' + rowCls + '>' +
    lotPrizeCellHtml(w.prize) +
    '<td class="lot-td-who">' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : '<span class="lot-empty-cell">—</span>') + '</td>' +
    '<td>' + statusSel + '</td>' +
    '<td>' + (w.name ? lotEscapeHtml(w.name) : '<span class="lot-empty-cell">—</span>') + '</td>' +
    '<td>' + phoneCell + '</td>' +
    '<td>' + addressCell + '</td>' +
    '<td>' + (w.shippedAt ? lotEscapeHtml(w.shippedAt) : '<span class="lot-empty-cell">—</span>') + '</td>' +
    '<td>' + (w.shippingFee ? lotEscapeHtml(w.shippingFee) : '<span class="lot-empty-cell">—</span>') + '</td>' +
    '<td>' + (w.memo ? lotEscapeHtml(w.memo) : '<span class="lot-empty-cell">—</span>') + '</td>' +
    '<td style="white-space:nowrap;">' + actions + '</td>' +
  '</tr>';
}

// ===== 待辦清單視圖（攤平所有分區未完成的得獎人列）=====
function renderLotteryTodo() {
  const box = document.getElementById('lotBody');
  if (!box) return;
  let rows = [];
  LOTTERY_DRAWS.forEach(draw => {
    if (LOTTERY_FILTER.brand && draw.brandId !== LOTTERY_FILTER.brand) return;
    const team = draw.acctId ? lotTeamByAcctId(draw.acctId) : null;
    (draw.winners || []).forEach(w => {
      if (w.status === 'done' || w.status === 'redrawn') return;
      if (!lotWinnerStatusFilterOk(w)) return;
      const q = lotSearchQuery();
      if (q) {
        const hay = [draw.title, team && team.legacyId, team && team.title].concat([lotWinnerHay(w)]).map(x => String(x || '')).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      rows.push({ draw, team, w });
    });
  });
  // 後端 draws 順序＝R 號／建立時間序（asc 基準），依 LOTTERY_SORT_DIR 整批反轉
  rows = lotApplyDir(rows);

  if (!rows.length) {
    box.innerHTML = '<div class="task-empty">目前沒有待辦事項 🎉</div>';
    return;
  }

  const trHtml = rows.map(({ draw, team, w }) => {
    const stuck = lotDaysSince(draw.drawDate || (draw.createdAt || '').slice(0, 10));
    const stuckTxt = stuck === null ? '—' : (stuck < 0 ? '未到' : stuck + ' 天');
    const teamLabel = team ? (lotEscapeHtml(team.legacyId || '') + ' · ' + lotEscapeHtml(team.title || '')) : lotEscapeHtml(draw.title || '');
    let nextBtns = '';
    if (LOTTERY_CAN_EDIT) {
      if (w.status === 'pending') {
        nextBtns = '<button class="lot-next-btn" data-role="todo-notify" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已通知 ›</button>';
      } else if (w.status === 'awaiting_info') {
        nextBtns = '<button class="lot-next-btn" data-role="edit-winner" data-winner-id="' + lotEscapeHtml(w.id) + '" data-draw-id="' + lotEscapeHtml(draw.id) + '">填入資料 ›</button>' +
          '<button class="lot-next-btn danger" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">重抽</button>';
      } else if (w.status === 'info_ready') {
        nextBtns = '<button class="lot-next-btn" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已寄出（今天）›</button>';
      } else if (w.status === 'handed_to_vendor') {
        nextBtns = '<button class="lot-next-btn" data-role="todo-done" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已完成 ›</button>';
      }
    }
    return '<tr>' +
      '<td>' + teamLabel + '</td>' +
      lotPrizeCellHtml(w.prize) +
      '<td>' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : '<span class="lot-empty-cell">—</span>') + '</td>' +
      '<td><span class="lot-status-sel lot-s-' + lotEscapeHtml(w.status) + '" style="display:inline-block; cursor:default;">' + LOT_STATUS_LABEL[w.status] + '</span></td>' +
      '<td class="lot-todo-stuck">' + stuckTxt + '</td>' +
      '<td style="white-space:nowrap;">' + nextBtns + '</td>' +
    '</tr>';
  }).join('');

  box.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table class="lot-table lot-table-fixed" style="min-width:680px;">' +
    '<colgroup><col style="width:220px"><col style="width:180px"><col style="width:120px"><col style="width:100px"><col style="width:70px"><col></colgroup>' +
    '<thead><tr><th>團</th><th>獎品</th><th>得獎人</th><th>狀態</th><th>卡了</th><th>下一步</th></tr></thead>' +
    '<tbody>' + trHtml + '</tbody></table></div>';
  lotBindTodoEvents(box);
}

// ===== 分區事件委派（①②③④共用）=====
function lotBindSectionEvents(box) {
  box.querySelectorAll('[data-zone-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.zoneToggle;
      LOTTERY_SECTION_COLLAPSED[key] = !LOTTERY_SECTION_COLLAPSED[key];
      renderLotterySections();
    });
  });
  box.querySelectorAll('[data-role="toggle-card"]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.cardKey;
      const cur = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, key) ? LOTTERY_EXPANDED_OVERRIDE[key] : false;
      LOTTERY_EXPANDED_OVERRIDE[key] = !cur;
      renderLotterySections();
    });
  });
  box.querySelectorAll('[data-role="toggle-mask"]').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const holder = el.closest('.lot-mask');
      if (!holder) return;
      const revealed = holder.dataset.revealed === '1';
      holder.dataset.revealed = revealed ? '0' : '1';
      holder.querySelector('.lot-mask-text').textContent = revealed ? holder.dataset.masked : holder.dataset.full;
    });
  });
  box.querySelectorAll('[data-role="status-sel"]').forEach(sel => {
    sel.addEventListener('click', ev => ev.stopPropagation());
    sel.addEventListener('change', () => lotChangeStatus(sel.dataset.winnerId, sel.value));
  });
  box.querySelectorAll('[data-role="edit-winner"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const draw = LOTTERY_DRAWS.find(d => d.id === el.dataset.drawId);
      const w = draw && (draw.winners || []).find(x => x.id === el.dataset.winnerId);
      openLotteryWinnerModal(el.dataset.drawId, w || null);
    });
  });
  box.querySelectorAll('[data-role="add-winner"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); openLotteryWinnerModal(el.dataset.drawId, null); });
  });
  box.querySelectorAll('[data-role="mark-shipped"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); lotMarkShipped(el.dataset.winnerId); });
  });
  box.querySelectorAll('[data-role="redraw-winner"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); lotRedraw(el.dataset.winnerId); });
  });
  box.querySelectorAll('[data-role="copy-notify"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const draw = LOTTERY_DRAWS.find(d => d.id === el.dataset.drawId);
      if (!draw) return;
      const text = lotBuildNotifyText(draw);
      if (!text) { alert('這個活動目前沒有待聯絡／待回填資料的得獎人可複製。'); return; }
      if (typeof copyText === 'function') copyText(text, el);
      else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    });
  });
  box.querySelectorAll('[data-role="edit-draw"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const draw = LOTTERY_DRAWS.find(d => d.id === el.dataset.drawId);
      openLotteryDrawModal(draw || null);
    });
  });
  box.querySelectorAll('[data-role="delete-draw"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); lotDeleteDraw(el.dataset.drawId); });
  });
  box.querySelectorAll('[data-role="team-add-draw"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const team = lotTeamByAcctId(el.dataset.acctId);
      if (!team) return;
      openLotteryDrawModal(null, { acctId: team.acctId, brandId: team.brandId, title: team.title, section: 'groupbuy' });
    });
  });
  box.querySelectorAll('[data-role="pending-create"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const team = lotTeamByAcctId(el.dataset.acctId);
      if (!team) return;
      openLotteryDrawModal(null, { acctId: team.acctId, brandId: team.brandId, title: team.title, section: 'groupbuy', drawDate: lotToday() });
    });
  });
  box.querySelectorAll('[data-role="pending-no-lottery"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm('確定這團不用抽獎嗎？（之後可在篩選列「🙈 已標不抽」清單裡還原）')) return;
      lotSetNoLottery(el.dataset.acctId, true);
    });
  });
  box.querySelectorAll('[data-role="restore-no-lottery"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); lotSetNoLottery(el.dataset.acctId, false); });
  });
  // 待配對：綁定帳務團／改為非團購
  box.querySelectorAll('[data-role="unpaired-select"]').forEach(sel => {
    lotFillUnpairedSelect(sel, '');
    sel.addEventListener('click', ev => ev.stopPropagation());
  });
  box.querySelectorAll('[data-role="unpaired-search"]').forEach(input => {
    input.addEventListener('click', ev => ev.stopPropagation());
    input.addEventListener('input', function () {
      const sel = box.querySelector('[data-role="unpaired-select"][data-draw-id="' + this.dataset.drawId + '"]');
      if (sel) lotFillUnpairedSelect(sel, this.value);
    });
  });
  box.querySelectorAll('[data-role="unpaired-bind"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const sel = box.querySelector('[data-role="unpaired-select"][data-draw-id="' + el.dataset.drawId + '"]');
      const acctId = sel ? sel.value : '';
      if (!acctId) { alert('請先選一個帳務團'); return; }
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, acctId, section: 'groupbuy' }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('綁定失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
  box.querySelectorAll('[data-role="unpaired-to-nongroupbuy"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm('確定把這場抽獎改成「非團購」嗎？')) return;
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, section: 'non_groupbuy', acctId: null }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
}

function lotFillUnpairedSelect(sel, filterText) {
  const drawId = sel.dataset.drawId;
  const draw = LOTTERY_DRAWS.find(d => d.id === drawId);
  const preferBrandId = draw ? draw.brandId : '';
  const q = (filterText || '').trim().toLowerCase();
  const list = LOTTERY_ACCT_TEAMS.filter(t => !q || (t.legacyId || '').toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q) || (t.brandName || '').toLowerCase().includes(q))
    .slice()
    .sort((a, b) => {
      if (preferBrandId) {
        const pa = a.brandId === preferBrandId ? 0 : 1;
        const pb = b.brandId === preferBrandId ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      return String(a.recordDate || '').localeCompare(String(b.recordDate || ''));
    })
    .slice(0, 200);
  const cur = sel.value;
  sel.innerHTML = '<option value="">（選擇要綁定的帳務團）</option>' + list.map(t =>
    '<option value="' + lotEscapeHtml(t.acctId) + '">' + lotEscapeHtml(t.legacyId || '') + '　' + lotEscapeHtml(t.title || '') + (t.recordDate ? '（' + lotFmtMD(t.recordDate) + '）' : '') + '</option>'
  ).join('');
  if (cur && list.some(t => t.acctId === cur)) sel.value = cur;
}

function lotBindTodoEvents(box) {
  box.querySelectorAll('[data-role="todo-notify"]').forEach(el => {
    el.addEventListener('click', () => lotApiPost('lottery-winner-upsert', { id: el.dataset.winnerId, status: 'awaiting_info' }).then(res => {
      if (res && res.success) loadLotteryView(true); else alert('更新失敗：' + ((res && res.error) || '未知錯誤'));
    }));
  });
  box.querySelectorAll('[data-role="todo-done"]').forEach(el => {
    el.addEventListener('click', () => lotApiPost('lottery-winner-upsert', { id: el.dataset.winnerId, status: 'done' }).then(res => {
      if (res && res.success) loadLotteryView(true); else alert('更新失敗：' + ((res && res.error) || '未知錯誤'));
    }));
  });
  box.querySelectorAll('[data-role="edit-winner"]').forEach(el => {
    el.addEventListener('click', () => {
      const draw = LOTTERY_DRAWS.find(d => d.id === el.dataset.drawId);
      const w = draw && (draw.winners || []).find(x => x.id === el.dataset.winnerId);
      openLotteryWinnerModal(el.dataset.drawId, w || null);
    });
  });
  box.querySelectorAll('[data-role="mark-shipped"]').forEach(el => {
    el.addEventListener('click', () => lotMarkShipped(el.dataset.winnerId));
  });
  box.querySelectorAll('[data-role="redraw-winner"]').forEach(el => {
    el.addEventListener('click', () => lotRedraw(el.dataset.winnerId));
  });
}

// ===== 快捷操作 =====
function lotChangeStatus(winnerId, status) {
  lotApiPost('lottery-winner-upsert', { id: winnerId, status }).then(res => {
    if (res && res.success) loadLotteryView(true);
    else { alert('更新失敗：' + ((res && res.error) || '未知錯誤')); loadLotteryView(true); }
  });
}
function lotMarkShipped(winnerId) {
  lotApiPost('lottery-winner-upsert', { id: winnerId, status: 'done', shippedAt: lotToday() }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('更新失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
function lotRedraw(winnerId) {
  if (!confirm('確定要重抽嗎？這一位會標記為「已重抽」，並自動新增一列同獎品的空得獎人。')) return;
  lotApiPost('lottery-winner-redraw', { id: winnerId }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('重抽失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
function lotDeleteDraw(drawId) {
  if (!confirm('確定要刪除這場抽獎活動嗎？底下所有得獎人紀錄也會一併刪除，無法復原。')) return;
  lotApiPost('lottery-draw-delete', { id: drawId }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('刪除失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
function lotSetNoLottery(acctId, noLottery) {
  lotApiPost('lottery-acct-no-lottery-set', { acctId, noLottery }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
// 複製通知文：只用暱稱＋獎品，待聯絡／待回填資料的得獎人才列入，不含個資
function lotBuildNotifyText(draw) {
  return (draw.winners || [])
    .filter(w => w.status === 'pending' || w.status === 'awaiting_info')
    .map(w => { const h = String(w.winnerHandle || '').trim(); return (h.startsWith('@') ? h : '@' + h) + ' 恭喜抽中「' + (w.prize || '') + '」，請私訊姓名電話地址'; })
    .join('\n');
}

// ===== 帳務明細列的抽獎狀態小標（給 accounting.js 呼叫）=====
// legacyId＝該列的帳務 R 號；contFromLegacyId＝延續列時填它接續的那個根列 R 號（延續列看根列的抽獎）。
function lotBadgeForAcctRow(legacyId, contFromLegacyId) {
  if (!LOTTERY_LOADED || !LOTTERY_TABLE_READY) return null;
  const key = contFromLegacyId || legacyId;
  if (!key) return null;
  const team = lotTeamByLegacyId(key);
  if (!team) return null;
  if (team.noLottery) return { label: '🎁 不抽', cls: 'lot-acct-badge-off' };
  const draws = lotDrawsForAcct(team.acctId);
  if (!draws.length) {
    if (team.pendingDraw) return { label: '🎁 待抽', cls: 'lot-acct-badge-draw' };
    return null;
  }
  const winners = draws.flatMap(d => d.winners || []);
  const pending = winners.filter(w => w.status !== 'done' && w.status !== 'redrawn');
  if (!pending.length) return { label: '🎁 已完成 ' + winners.length, cls: 'lot-acct-badge-done' };
  return { label: '🎁 待處理 ' + pending.length, cls: 'lot-acct-badge-pending' };
}
// 點帳務明細列上的抽獎小標：切到抽獎子分頁，捲到並閃一下對應的團卡
function lotJumpToAcctTeamCard(legacyId) {
  if (typeof switchView === 'function') switchView('accounting');
  if (typeof acctSwitchTab === 'function') acctSwitchTab('lottery');
  const scrollTo = () => {
    const team = lotTeamByLegacyId(legacyId);
    if (!team) return;
    const el = document.querySelector('.lot-team-card[data-acct-id="' + team.acctId + '"], .lot-card-pending[data-acct-id="' + team.acctId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('lot-flash');
    setTimeout(() => el.classList.remove('lot-flash'), 1600);
  };
  if (LOTTERY_LOADED) setTimeout(scrollTo, 60);
  else loadLotteryView().then(scrollTo).catch(() => {});
}

// ===== 新增／編輯抽獎 modal =====
// prefill：只在 draw=null（新增）時用，來自團卡「＋這團加開一場抽獎」／待抽虛擬卡「＋建立抽獎」，
// 預帶 {acctId,brandId,title,section,drawDate}；不是既有活動，不會把 LOTTERY_EDIT_DRAW_ID 設成別的 id。
function openLotteryDrawModal(draw, prefill) {
  LOTTERY_EDIT_DRAW_ID = draw ? draw.id : null;
  const isNew = !draw;
  const pf = (!draw && prefill) ? prefill : null;
  document.getElementById('lotDrawModalTitle').textContent = isNew ? '➕ 新增抽獎' : '✏️ 編輯活動';
  document.getElementById('lotDrawDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  document.getElementById('lotDrawWinnerSection').style.display = isNew ? '' : 'none';

  const section = draw ? (draw.section || 'groupbuy') : (pf ? (pf.section || 'groupbuy') : 'groupbuy');
  document.getElementById('lotDrawSectionSelect').value = section;

  const boundAcctId = draw ? (draw.acctId || '') : (pf ? (pf.acctId || '') : '');
  document.getElementById('lotDrawAcctSearchInput').value = '';
  lotFillDrawAcctSelect('', boundAcctId);
  lotSyncDrawSectionUI();

  const readyWarn = document.getElementById('lotDrawAcctReadyWarn');
  readyWarn.style.display = LOTTERY_ACCT_READY ? 'none' : '';
  document.getElementById('lotDrawAcctSearchInput').disabled = !LOTTERY_ACCT_READY;
  document.getElementById('lotDrawAcctSelect').disabled = !LOTTERY_ACCT_READY;

  const brandSel = document.getElementById('lotDrawBrandSelect');
  brandSel.innerHTML = '<option value="">（不指定）</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '">' + lotEscapeHtml(b.name) + '</option>'
  ).join('');
  brandSel.value = draw ? (draw.brandId || '') : (pf ? (pf.brandId || '') : '');

  document.getElementById('lotDrawTitleInput').value = draw ? (draw.title || '') : (pf ? (pf.title || '') : '');
  document.getElementById('lotDrawDateInput').value = draw ? (draw.drawDate || '') : (pf ? (pf.drawDate || '') : '');
  document.getElementById('lotDrawDateUncertain').checked = !!(draw && draw.dateUncertain);
  document.getElementById('lotDrawKeywordInput').value = draw ? (draw.lineKeyword || '') : '';
  document.getElementById('lotDrawShipBySelect').value = draw ? (draw.shipBy || 'self') : 'self';
  document.getElementById('lotDrawNoteInput').value = draw ? (draw.note || '') : '';

  document.getElementById('lotWinnerRows').innerHTML = '';
  document.getElementById('lotPasteArea').value = '';
  document.getElementById('lotPasteBox').style.display = 'none';
  document.getElementById('lotPasteParseStatus').textContent = '';

  lotSetStatus('lotDrawFormStatus', '', '');
  document.getElementById('lotteryDrawModal').classList.add('show');
}
function closeLotteryDrawModal() {
  document.getElementById('lotteryDrawModal').classList.remove('show');
  LOTTERY_EDIT_DRAW_ID = null;
}

function lotSyncDrawSectionUI() {
  const groupbuy = document.getElementById('lotDrawSectionSelect').value === 'groupbuy';
  document.getElementById('lotDrawAcctGroup').style.display = groupbuy ? '' : 'none';
  if (!groupbuy) {
    document.getElementById('lotDrawAcctSelect').value = '';
    document.getElementById('lotDrawAcctSearchInput').value = '';
  }
}
function lotFillDrawAcctSelect(filterText, selectedAcctId) {
  const sel = document.getElementById('lotDrawAcctSelect');
  const q = (filterText || '').trim().toLowerCase();
  const list = LOTTERY_ACCT_TEAMS.filter(t => !q || (t.legacyId || '').toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q) || (t.brandName || '').toLowerCase().includes(q));
  let html = '<option value="">（不綁）</option>';
  if (selectedAcctId && !list.some(t => t.acctId === selectedAcctId)) {
    const cur = lotTeamByAcctId(selectedAcctId);
    if (cur) html += '<option value="' + lotEscapeHtml(cur.acctId) + '" selected>' + lotEscapeHtml(cur.legacyId || '') + '　' + lotEscapeHtml(cur.title || '') + '</option>';
  }
  html += list.slice(0, 200).map(t => '<option value="' + lotEscapeHtml(t.acctId) + '">' + lotEscapeHtml(t.legacyId || '') + '　' + lotEscapeHtml(t.title || '') + '</option>').join('');
  sel.innerHTML = html;
  if (selectedAcctId) sel.value = selectedAcctId;
}
document.getElementById('lotDrawSectionSelect').addEventListener('change', lotSyncDrawSectionUI);
document.getElementById('lotDrawAcctSearchInput').addEventListener('input', function () {
  lotFillDrawAcctSelect(this.value, document.getElementById('lotDrawAcctSelect').value);
});
document.getElementById('lotDrawAcctSelect').addEventListener('change', function () {
  const team = lotTeamByAcctId(this.value);
  if (!team) return;
  if (team.title) document.getElementById('lotDrawTitleInput').value = team.title;
  if (team.brandId) {
    const direct = LOTTERY_BRAND_CHOICES.some(b => b.id === team.brandId);
    if (direct) {
      document.getElementById('lotDrawBrandSelect').value = team.brandId;
    } else {
      const byName = LOTTERY_BRAND_CHOICES.find(b => b.name === team.brandName);
      if (byName) document.getElementById('lotDrawBrandSelect').value = byName.id;
    }
  }
});

// ===== 新增抽獎：得獎人快速輸入列（獎品＋得獎人，狀態固定待聯絡）=====
function addLotWinnerFormRow(data) {
  const wrap = document.getElementById('lotWinnerRows');
  const row = document.createElement('div');
  row.className = 'lot-winner-row';

  const prize = document.createElement('input');
  prize.type = 'text';
  prize.className = 'lot-row-prize';
  prize.placeholder = '獎品';
  prize.value = (data && data.prize) || '';
  row.appendChild(prize);

  const handle = document.createElement('input');
  handle.type = 'text';
  handle.className = 'lot-row-handle';
  handle.placeholder = '得獎人暱稱／帳號';
  handle.value = (data && data.winnerHandle) || '';
  row.appendChild(handle);

  const tag = document.createElement('span');
  tag.className = 'lot-pending-tag';
  tag.textContent = '待聯絡';
  row.appendChild(tag);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-mini-btn danger';
  del.style.cssText = 'flex:none; padding:2px 8px;';
  del.textContent = '✕';
  del.addEventListener('click', () => row.remove());
  row.appendChild(del);

  wrap.appendChild(row);
}
function collectLotWinnerFormRows() {
  return Array.from(document.querySelectorAll('#lotWinnerRows .lot-winner-row')).map(row => ({
    prize: row.querySelector('.lot-row-prize').value.trim(),
    winnerHandle: row.querySelector('.lot-row-handle').value.trim()
  })).filter(r => r.prize);
}

document.getElementById('lotAddWinnerRowBtn').addEventListener('click', () => addLotWinnerFormRow(null));
document.getElementById('lotPasteToggleBtn').addEventListener('click', () => {
  const box = document.getElementById('lotPasteBox');
  box.style.display = box.style.display === 'none' ? '' : 'none';
});
// 貼上模式拆行規則：一行一位，「獎品」與「得獎人」用 Tab／全形空白／連續兩個以上半形空白隔開，
// 前段當獎品、後段當得獎人；解析不了的行整行跳過並計入「無法辨識」數字回報給雪莉。
document.getElementById('lotPasteParseBtn').addEventListener('click', () => {
  const raw = document.getElementById('lotPasteArea').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  lines.forEach(line => {
    const m = line.match(/^(.*?)(?:\t+|　+| {2,})(.+)$/);
    if (!m) { fail++; return; }
    addLotWinnerFormRow({ prize: m[1].trim(), winnerHandle: m[2].trim() });
    ok++;
  });
  document.getElementById('lotPasteParseStatus').textContent = ok
    ? ('已加入 ' + ok + ' 列' + (fail ? '，' + fail + ' 行無法辨識（格式需要「獎品 分隔 得獎人」）' : ''))
    : '沒有辨識出任何列，請確認獎品與得獎人之間有 Tab 或至少兩個空格';
  if (ok) document.getElementById('lotPasteArea').value = '';
});

document.getElementById('lotDrawSaveBtn').addEventListener('click', async () => {
  const title = document.getElementById('lotDrawTitleInput').value.trim();
  if (!title) { lotSetStatus('lotDrawFormStatus', '請填寫活動標題', 'error'); return; }
  const section = document.getElementById('lotDrawSectionSelect').value || 'groupbuy';
  const payload = {
    title,
    section,
    acctId: section === 'groupbuy' ? (document.getElementById('lotDrawAcctSelect').value || null) : null,
    brandId: document.getElementById('lotDrawBrandSelect').value || null,
    drawDate: document.getElementById('lotDrawDateInput').value || null,
    dateUncertain: document.getElementById('lotDrawDateUncertain').checked,
    lineKeyword: document.getElementById('lotDrawKeywordInput').value.trim(),
    shipBy: document.getElementById('lotDrawShipBySelect').value,
    note: document.getElementById('lotDrawNoteInput').value.trim()
  };
  if (LOTTERY_EDIT_DRAW_ID) payload.id = LOTTERY_EDIT_DRAW_ID;

  const btn = document.getElementById('lotDrawSaveBtn');
  btn.disabled = true;
  lotSetStatus('lotDrawFormStatus', '儲存中…', '');
  try {
    const res = await lotApiPost('lottery-draw-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    const drawId = res.draw && res.draw.id;
    if (!LOTTERY_EDIT_DRAW_ID && drawId) {
      const rows = collectLotWinnerFormRows();
      for (const r of rows) {
        const wres = await lotApiPost('lottery-winner-upsert', { drawId, prize: r.prize, winnerHandle: r.winnerHandle, status: 'pending' });
        if (!wres || !wres.success) throw new Error('得獎人「' + r.prize + '」存檔失敗：' + ((wres && wres.error) || '未知錯誤'));
      }
    }
    closeLotteryDrawModal();
    loadLotteryView(true);
  } catch (err) {
    lotSetStatus('lotDrawFormStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('lotDrawDeleteBtn').addEventListener('click', () => {
  if (!LOTTERY_EDIT_DRAW_ID) return;
  const id = LOTTERY_EDIT_DRAW_ID;
  closeLotteryDrawModal();
  lotDeleteDraw(id);
});

// ===== 新增／編輯得獎人 modal（個資與寄送資訊；新增給定 drawId，狀態預設待聯絡）=====
function openLotteryWinnerModal(drawId, winner) {
  LOTTERY_WINNER_EDIT = { drawId, winnerId: winner ? winner.id : null };
  document.getElementById('lotWinnerModalTitle').textContent = winner ? '✏️ 編輯得獎人' : '➕ 新增得獎人';
  document.getElementById('lotWinnerDeleteBtn').style.display = winner ? 'inline-block' : 'none';
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('lotWinnerPrizeInput', winner ? winner.prize : '');
  v('lotWinnerHandleInput', winner ? winner.winnerHandle : '');
  document.getElementById('lotWinnerStatusSel').value = winner ? winner.status : 'pending';
  v('lotWinnerNameInput', winner ? winner.name : '');
  v('lotWinnerPhoneInput', winner ? winner.phone : '');
  v('lotWinnerAddressInput', winner ? winner.address : '');
  v('lotWinnerOrderNoInput', winner ? winner.orderNo : '');
  v('lotWinnerShippingFeeInput', winner ? winner.shippingFee : '');
  v('lotWinnerShippedAtInput', winner ? winner.shippedAt : '');
  v('lotWinnerSponsorNoteInput', winner ? winner.sponsorNote : '');
  v('lotWinnerMemoInput', winner ? winner.memo : '');
  lotSetStatus('lotWinnerFormStatus', '', '');
  document.getElementById('lotteryWinnerModal').classList.add('show');
}
function closeLotteryWinnerModal() {
  document.getElementById('lotteryWinnerModal').classList.remove('show');
  LOTTERY_WINNER_EDIT = null;
}

document.getElementById('lotWinnerSaveBtn').addEventListener('click', async () => {
  if (!LOTTERY_WINNER_EDIT) return;
  const prize = document.getElementById('lotWinnerPrizeInput').value.trim();
  if (!prize) { lotSetStatus('lotWinnerFormStatus', '請填寫獎品', 'error'); return; }
  const payload = {
    drawId: LOTTERY_WINNER_EDIT.drawId,
    prize,
    winnerHandle: document.getElementById('lotWinnerHandleInput').value.trim(),
    status: document.getElementById('lotWinnerStatusSel').value,
    name: document.getElementById('lotWinnerNameInput').value.trim(),
    phone: document.getElementById('lotWinnerPhoneInput').value.trim(),
    address: document.getElementById('lotWinnerAddressInput').value.trim(),
    orderNo: document.getElementById('lotWinnerOrderNoInput').value.trim(),
    shippingFee: document.getElementById('lotWinnerShippingFeeInput').value.trim(),
    shippedAt: document.getElementById('lotWinnerShippedAtInput').value || null,
    sponsorNote: document.getElementById('lotWinnerSponsorNoteInput').value.trim(),
    memo: document.getElementById('lotWinnerMemoInput').value.trim()
  };
  if (LOTTERY_WINNER_EDIT.winnerId) payload.id = LOTTERY_WINNER_EDIT.winnerId;

  const btn = document.getElementById('lotWinnerSaveBtn');
  btn.disabled = true;
  lotSetStatus('lotWinnerFormStatus', '儲存中…', '');
  try {
    const res = await lotApiPost('lottery-winner-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    closeLotteryWinnerModal();
    loadLotteryView(true);
  } catch (err) {
    lotSetStatus('lotWinnerFormStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('lotWinnerDeleteBtn').addEventListener('click', async () => {
  if (!LOTTERY_WINNER_EDIT || !LOTTERY_WINNER_EDIT.winnerId) return;
  if (!confirm('確定要刪除這位得獎人嗎？')) return;
  const btn = document.getElementById('lotWinnerDeleteBtn');
  btn.disabled = true;
  lotSetStatus('lotWinnerFormStatus', '刪除中…', '');
  try {
    const res = await lotApiPost('lottery-winner-delete', { id: LOTTERY_WINNER_EDIT.winnerId });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    closeLotteryWinnerModal();
    loadLotteryView(true);
  } catch (err) {
    lotSetStatus('lotWinnerFormStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('lotAddDrawBtn').addEventListener('click', () => openLotteryDrawModal(null));
document.getElementById('lotRefreshBtn').addEventListener('click', () => loadLotteryView(true));
