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
let LOTTERY_PRIZE_READY = true;
let LOTTERY_WINNER_TYPE_READY = true; // migration 20260925130000（得獎人自訂類型）    // 2026-09-23 獎品類型欄位（prize_type/prize/cash_amount 等）還沒 push 時 false
let LOTTERY_TODAY = '';
let LOTTERY_ACCT_TEAMS = [];       // 全部帳務根列（continuation_of 為空），legacyId 升冪
let LOTTERY_DRAWS = [];
let LOTTERY_STATS = {};
let LOTTERY_BRAND_CHOICES = [];
let LOTTERY_EVENT_CHOICES = []; // 行事曆團購但帳務還沒建（給④待配對／新增「未開團」區綁定用），data.eventChoices（舊後端沒有時＝[]）
let LOTTERY_CAN_EDIT = true;       // hasEditPerm('lotteryEdit') 的快取，每次載入/渲染時重算
let LOTTERY_VIEW = 'cards';        // 'cards'｜'todo'
let LOTTERY_FILTER = { status: 'all', brand: '', year: null, q: '' }; // year=null＝還沒套「預設今年」
let LOTTERY_SHOW_NO_LOTTERY = false; // 篩選列「已標不抽」顯示開關（預設隱藏，docs/09 §11.4）
// 「未開團／帳務未建」區預設收合（跟其餘三區不同，其餘預設展開），狀態存 localStorage
// key lottery_unopened_collapsed（'1'=收合／'0'=展開；預設收合）。
function lotLoadUnopenedCollapsed() {
  try {
    const v = localStorage.getItem('lottery_unopened_collapsed');
    return v === null ? true : v !== '0';
  } catch (e) { return true; }
}
function lotSaveUnopenedCollapsed(v) {
  try { localStorage.setItem('lottery_unopened_collapsed', v ? '1' : '0'); } catch (e) {}
}
// 「舊資料（已結案）」區同樣預設收合，狀態存 localStorage key lottery_archived_collapsed（同 unopened 的做法）。
function lotLoadArchivedCollapsed() {
  try {
    const v = localStorage.getItem('lottery_archived_collapsed');
    return v === null ? true : v !== '0';
  } catch (e) { return true; }
}
function lotSaveArchivedCollapsed(v) {
  try { localStorage.setItem('lottery_archived_collapsed', v ? '1' : '0'); } catch (e) {}
}
let LOTTERY_SECTION_COLLAPSED = { groupbuy: false, non_groupbuy: false, special: false, unpaired: false, unopened: lotLoadUnopenedCollapsed(), archived: lotLoadArchivedCollapsed() };
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

// 隱藏已完成開關：①②③區已全數完成（得獎人皆 done/redrawn）的項目預設隱藏，避免埋掉還要處理的。
// localStorage key: lottery_hide_done（'1'=隱藏／'0'=不隱藏），預設隱藏。
function lotLoadHideDone() {
  try {
    const v = localStorage.getItem('lottery_hide_done');
    return v === null ? true : v !== '0';
  } catch (e) { return true; }
}
function lotSaveHideDone(v) {
  try { localStorage.setItem('lottery_hide_done', v ? '1' : '0'); } catch (e) {}
}
let LOTTERY_HIDE_DONE = lotLoadHideDone();

// 狀態機（§3）：代碼 -> 顯示名／CSS 修飾字
const LOT_STATUS_LABEL = {
  pending: '待聯絡', awaiting_info: '待回填資料', info_ready: '待寄出',
  handed_to_vendor: '廠商寄送中', done: '已完成', redrawn: '已重抽'
};
const LOT_STATUS_ORDER = ['pending', 'awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'];
const LOT_SHIP_BY_LABEL = { self: '團購主', vendor: '廠商', none: '團購主' };
// 2026-09-23 獎品類型三選一（docs/09 §12）
const LOT_PRIZE_TYPE_LABEL = { cash: '現金／免單', physical: '實體贈品', virtual: '虛擬贈品' };
// 狀態文字依獎品類型變化：info_ready／done 這兩格在三種類型底下說法不同（待匯款/待寄出/待發送、已匯款/已完成/已發送），
// 其餘狀態（待聯絡／待回填資料／廠商寄送中／已重抽）三種類型共用同一套文字，直接查 LOT_STATUS_LABEL。
// 得獎人的有效獎品類型（2026-09-25）：自己有設就用自己的，沒設跟活動；同一場可混現金與實體（雪莉抓到的 bug）
function lotWinnerType(w, drawOrType) {
  const base = (drawOrType && typeof drawOrType === 'object') ? (drawOrType.prizeType || 'physical') : (drawOrType || 'physical');
  return (w && w.prizeType) || base;
}
function lotStatusLabel(status, prizeType) {
  if (status === 'info_ready') {
    if (prizeType === 'cash') return '待匯款';
    if (prizeType === 'virtual') return '待發送';
    return '待寄出';
  }
  if (status === 'done') {
    if (prizeType === 'cash') return '已匯款';
    if (prizeType === 'virtual') return '已發送';
    return '已完成';
  }
  return LOT_STATUS_LABEL[status] || status;
}
const LOT_SECTION_LABEL = { groupbuy: '團購抽獎', non_groupbuy: '非團購', special: '特殊抽獎專區' };
// 篩選 chips：待聯絡刻意不列（原本設計就只有這六顆）；待抽／待配對是分區虛擬狀態，一併放進 chip 方便直接篩。
const LOT_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: 'pending_draw', label: '⏰ 待抽' },
  { key: 'awaiting_info', label: '待回填' },
  { key: 'info_ready', label: '待寄出' },
  { key: 'handed_to_vendor', label: '廠商寄送中' },
  { key: 'done', label: '已完成' },
  { key: 'redrawn', label: '已重抽' },
  { key: 'unpaired', label: '待配對' }
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
// YYYY-MM-DD -> "2026/8/25"（無前導零；帳務團橫跨 2023–2026，光看 M/D 會誤判年份，一律帶年）；空值/解析不了回空字串
function lotFmtYMD(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return Number(m[1]) + '/' + Number(m[2]) + '/' + Number(m[3]);
}
// 開團區間帶年份："2026/9/15–9/21"（同年省略結束年）／跨年 "2026/12/28–2027/1/3"（結束年全寫）
function lotFmtEventRangeYMD(startDate, endDate) {
  const sm = String(startDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const em = String(endDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!sm && !em) return '';
  if (sm && !em) return lotFmtYMD(startDate);
  if (!sm && em) return lotFmtYMD(endDate);
  if (startDate === endDate) return lotFmtYMD(startDate);
  const s = lotFmtYMD(startDate);
  const e = sm[1] === em[1] ? (Number(em[2]) + '/' + Number(em[3])) : lotFmtYMD(endDate);
  return s + '–' + e;
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
  if (draw.dateUncertain) return '約 ' + lotFmtYM(draw.drawDate) + '（估）';
  return '抽獎日 ' + draw.drawDate;
}
// 依 eventId 查 eventChoices（行事曆團購但帳務還沒建的清單）；查無回 null（=「未知」，未發布徽章跳過不顯示）
function lotEventChoiceById(eventId) {
  if (!eventId) return null;
  return LOTTERY_EVENT_CHOICES.find(e => e.eventId === eventId) || null;
}
// 去掉標題開頭「9/15 - 9/21 」這種日期前綴，方便跟行事曆團名做文字比對
function lotStripLeadingDatePrefix(title) {
  return String(title || '').replace(/^\s*\d{1,2}\/\d{1,2}\s*[-–~]\s*\d{1,2}\/\d{1,2}\s*/, '').trim();
}
// 文字相似度：去空白標點後，任兩字元 substring（中英文皆可）有交集即算命中，例如「禾流書團」vs「禾流文創」share「禾流」
function lotTextAffinity(a, b) {
  const clean = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const ca = clean(a), cb = clean(b);
  if (ca.length < 2 || cb.length < 2) return false;
  for (let i = 0; i <= ca.length - 2; i++) {
    if (cb.indexOf(ca.slice(i, i + 2)) !== -1) return true;
  }
  return false;
}
// 兩個 YYYY-MM-DD 的天數差（絕對值）；任一解析不了回 Infinity（=排到最後）
function lotDateDistance(dateStr, refDateStr) {
  if (!dateStr || !refDateStr) return Infinity;
  const d1 = new Date(dateStr + 'T00:00:00');
  const d2 = new Date(refDateStr + 'T00:00:00');
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return Infinity;
  return Math.abs(d1.getTime() - d2.getTime());
}
// 帳務團候選排序共用邏輯：①同品牌優先 ②標題/品牌文字相似優先 ③有抽獎日→recordDate 離抽獎日近的優先，否則 recordDate 新到舊
function lotRankAcctTeams(list, ctx) {
  const brandId = (ctx && ctx.brandId) || '';
  const refTitle = lotStripLeadingDatePrefix((ctx && ctx.title) || '');
  const drawDate = (ctx && ctx.drawDate) || '';
  return list.slice().sort((a, b) => {
    const sa = (brandId && a.brandId === brandId) ? 0 : 1;
    const sb = (brandId && b.brandId === brandId) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ma = (refTitle && (lotTextAffinity(refTitle, a.title) || lotTextAffinity(refTitle, a.brandName))) ? 0 : 1;
    const mb = (refTitle && (lotTextAffinity(refTitle, b.title) || lotTextAffinity(refTitle, b.brandName))) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    if (drawDate) {
      const da = lotDateDistance(a.recordDate, drawDate);
      const db = lotDateDistance(b.recordDate, drawDate);
      if (da !== db) return da - db;
      return 0;
    }
    return String(b.recordDate || '').localeCompare(String(a.recordDate || ''));
  });
}
// 帳務團下拉／團卡頭共用文字：完整日期在前、R 號降成括號殿後——帳務頁面本身看不到 R 號，
// 光看 M/D 會誤判年份（帳務團橫跨 2023–2026），日期＋團名才是雪莉真正認得出來的識別
function lotAcctTeamOptionLabel(t) {
  const dateLead = t.recordDate ? (lotFmtYMD(t.recordDate) + ' ') : '（無日期）';
  return dateLead + (t.title || '') + (t.legacyId ? '（' + t.legacyId + '）' : '');
}
// ④待配對卡「或綁行事曆團購」下拉的候選排序：團名含抽獎品牌名／跟抽獎標題（去掉日期前綴）有交集或字詞相似的排最前，
// 同分時有抽獎日→離抽獎日近的優先，否則依開團日 asc
function lotEventChoicesForUnpairedDraw(draw) {
  const brandName = String((draw && draw.brandName) || '').trim();
  const drawTitle = lotStripLeadingDatePrefix((draw && draw.title) || '');
  const drawDate = (draw && draw.drawDate) || '';
  const isMatch = ev => {
    const evTitle = String((ev && ev.title) || '');
    if (!evTitle) return false;
    if (brandName && evTitle.indexOf(brandName) !== -1) return true;
    if (drawTitle && (evTitle.indexOf(drawTitle) !== -1 || drawTitle.indexOf(evTitle) !== -1)) return true;
    if (drawTitle && lotTextAffinity(drawTitle, evTitle)) return true;
    if (brandName && lotTextAffinity(brandName, evTitle)) return true;
    return false;
  };
  return LOTTERY_EVENT_CHOICES.slice().sort((a, b) => {
    const ma = isMatch(a) ? 0 : 1, mb = isMatch(b) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    if (drawDate) {
      const da = lotDateDistance((a && a.startDate) || '', drawDate);
      const db = lotDateDistance((b && b.startDate) || '', drawDate);
      if (da !== db) return da - db;
    }
    return String((a && a.startDate) || '').localeCompare(String((b && b.startDate) || ''));
  });
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
// 銀行帳號遮罩：只顯示末 4 碼，前面一律 ***（不管原長度）
function lotMaskAccount(acc) {
  const s = String(acc || '');
  if (!s) return '';
  return s.length <= 4 ? '***' : '***' + s.slice(-4);
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
  return LOTTERY_SORT_DIR === 'desc' ? '新→舊 ↓' : '舊→新 ↑';
}
// 固定欄寬表格的獎品欄：white-space:normal＋最多 2 行截斷（CSS -webkit-line-clamp）＋ title 全文
function lotPrizeCellHtml(prize) {
  const esc = lotEscapeHtml(prize);
  return '<td class="lot-td-prize" title="' + esc + '"><span class="lot-prize-clamp">' + esc + '</span></td>';
}

// ===== 資料存取小工具 =====
// 已結案（archived===true）的抽獎一律排除在外——這是唯一的團卡/badge 資料來源，
// 排除在這裡等於同時讓①團購抽獎卡片與 lotBadgeForAcctRow（帳務明細列小標）都不會再看到它。
// 舊後端沒有 archived 欄位＝undefined＝視同 false，行為不變。
function lotDrawsForAcct(acctId) {
  return LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && d.acctId === acctId && !d.archived);
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
    LOTTERY_PRIZE_READY = data.prizeReady !== false;
    LOTTERY_WINNER_TYPE_READY = data.winnerTypeReady !== false; // 得獎人自訂類型欄位（migration 20260925130000）
    LOTTERY_TODAY = data.today || lotToday();
    LOTTERY_ACCT_TEAMS = Array.isArray(data.acctTeams) ? data.acctTeams : [];
    LOTTERY_DRAWS = Array.isArray(data.draws) ? data.draws : [];
    LOTTERY_STATS = data.stats || {};
    LOTTERY_BRAND_CHOICES = Array.isArray(data.brandChoices) ? data.brandChoices : [];
    LOTTERY_EVENT_CHOICES = Array.isArray(data.eventChoices) ? data.eventChoices : [];
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
    box.innerHTML = '<div style="background:#F5EFE9; border:1px solid transparent; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' +
      '抽獎資料表尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。</div>';
  } else if (!LOTTERY_ACCT_READY) {
    box.innerHTML = '<div style="background:#F5EFE9; border:1px solid transparent; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' +
      '抽獎掛帳務團所需的欄位（acct_id／section／no_lottery）尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。' +
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
      tile('unopened', 'unopened', s.unopened, '未開團') +
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
    ? '<span class="lot-toggle-chip' + (LOTTERY_SHOW_NO_LOTTERY ? ' on' : '') + '" id="lotShowNoLotteryToggle">已標不抽（' + noLotteryCount + '）</span>'
    : '';
  const hideDoneCount = LOTTERY_VIEW === 'cards' ? lotComputeHideDoneCount() : 0;
  const hideDoneToggleHtml = LOTTERY_VIEW === 'cards'
    ? '<span class="lot-toggle-chip' + (LOTTERY_HIDE_DONE ? ' on' : '') + '" id="lotHideDoneToggle">隱藏已完成（' + hideDoneCount + '）</span>'
    : '';

  box.innerHTML =
    chipsHtml +
    '<select id="lotBrandSelect">' + brandOptions + '</select>' +
    (LOTTERY_VIEW === 'cards' ? '<select id="lotYearSelect">' + yearOptions + '</select>' : '') +
    '<input type="text" id="lotSearchInput" placeholder="搜尋 R號／團名／獎品／得獎人／姓名／訂單編號" value="' + lotEscapeHtml(LOTTERY_FILTER.q) + '">' +
    '<div class="lot-seg"><span class="' + (LOTTERY_VIEW === 'cards' ? 'on' : '') + '" data-seg="cards">依分區</span><span class="' + (LOTTERY_VIEW === 'todo' ? 'on' : '') + '" data-seg="todo">待辦清單</span></div>' +
    '<button class="task-mini-btn" id="lotSortDirBtn" type="button">' + lotSortDirLabel() + '</button>' +
    showToggleHtml +
    hideDoneToggleHtml;

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
      if (LOTTERY_VIEW === 'todo' && (LOTTERY_FILTER.status === 'pending_draw' || LOTTERY_FILTER.status === 'unpaired' || LOTTERY_FILTER.status === 'unopened')) LOTTERY_FILTER.status = 'all';
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
  const hideDoneToggleEl = document.getElementById('lotHideDoneToggle');
  if (hideDoneToggleEl) {
    hideDoneToggleEl.addEventListener('click', () => {
      LOTTERY_HIDE_DONE = !LOTTERY_HIDE_DONE;
      lotSaveHideDone(LOTTERY_HIDE_DONE);
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
  if (s === 'unopened') return key === 'unopened';
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

// ===== 隱藏已完成：一場抽獎「已完成」＝至少 1 位得獎人，且全部得獎人狀態為 done／redrawn =====
function lotDrawCompleted(d) {
  const winners = d.winners || [];
  return winners.length > 0 && winners.every(w => w.status === 'done' || w.status === 'redrawn');
}
// 搜尋中或直接篩選 done／redrawn 狀態時，隱藏規則失效（不然會篩出空結果）
function lotHideDoneBypassed() {
  return !!lotSearchQuery() || LOTTERY_FILTER.status === 'done' || LOTTERY_FILTER.status === 'redrawn';
}
function lotHideDoneActive() {
  return LOTTERY_HIDE_DONE && !lotHideDoneBypassed();
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
function lotFilterGroupbuyItems(items, opts) {
  const q = lotSearchQuery();
  const applyHideDone = !opts || opts.hideDone !== false;
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'].indexOf(LOTTERY_FILTER.status) !== -1;
  return items.filter(it => {
    if (it.type === 'nolottery' && !LOTTERY_SHOW_NO_LOTTERY) return false;
    // 「已標不抽」「待抽」兩種虛擬卡片永不因「已完成」被隱藏，只有 type='real' 且全部抽獎都已完成才隱藏
    if (it.type === 'real' && applyHideDone && lotHideDoneActive() && it.draws.every(lotDrawCompleted)) return false;
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
        .concat(it.draws.map(d => d.sheetRef))
        .map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ===== ②非團購／③特殊抽獎專區：依建立時間 =====
function lotFilterSimpleZoneDraws(draws, opts) {
  const q = lotSearchQuery();
  const applyHideDone = !opts || opts.hideDone !== false;
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'].indexOf(LOTTERY_FILTER.status) !== -1;
  return draws.filter(d => {
    if (applyHideDone && lotHideDoneActive() && lotDrawCompleted(d)) return false;
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (LOTTERY_FILTER.status === 'pending_draw' || LOTTERY_FILTER.status === 'unpaired') return false;
    if (winnerStatusActive && !(d.winners || []).some(w => w.status === LOTTERY_FILTER.status)) return false;
    if (q) {
      const hay = [d.title, d.brandName, d.sheetRef].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ④待配對 vs 新增的「未開團／帳務未建」區，兩者都是 section=groupbuy 且 acctId 為空，
// 差別只在有沒有 eventId（d.eventId 缺欄位＝舊後端還沒部署，視同沒有＝一律落回④待配對，行為不變）：
// ④待配對＝沒有 eventId；未開團＝有 eventId（已經有對應的行事曆團購，只是帳務還沒建）。
function lotDrawHasEvent(d) { return !!(d && d.eventId); }

// ===== ④待配對：section=groupbuy 但 acctId／eventId 皆為空 =====
function lotFilterUnpairedDraws(draws) {
  const q = lotSearchQuery();
  if (LOTTERY_FILTER.status !== 'all' && LOTTERY_FILTER.status !== 'unpaired') return [];
  return draws.filter(d => {
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (q) {
      const hay = [d.title, d.brandName, d.sheetRef].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ===== 📦 舊資料（已結案）：archived===true，不分 section，全部攤平在這一區；
// 不受「隱藏已完成」規則影響（呆帳寫死結案，不用再看完成度），只套品牌篩選＋搜尋 =====
function lotFilterArchivedDraws(draws) {
  const q = lotSearchQuery();
  return draws.filter(d => {
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (q) {
      const hay = [d.title, d.brandName, d.sheetRef].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// ===== 新增：🗓 未開團／帳務未建：section=groupbuy、acctId 為空、eventId 有值 =====
// 跟①②③一樣受「隱藏已完成」規則影響（不像④待配對不受影響）；搜尋欄位額外含 eventTitle。
function lotFilterUnopenedDraws(draws, opts) {
  const q = lotSearchQuery();
  const applyHideDone = !opts || opts.hideDone !== false;
  if (LOTTERY_FILTER.status !== 'all' && LOTTERY_FILTER.status !== 'unopened') return [];
  return draws.filter(d => {
    if (applyHideDone && lotHideDoneActive() && lotDrawCompleted(d)) return false;
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (q) {
      const hay = [d.title, d.brandName, d.sheetRef, d.eventTitle].concat((d.winners || []).map(lotWinnerHay)).map(x => String(x || '')).join(' ').toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

// 「隱藏已完成」篩選列 chip 的數字：①②③區在套用其他篩選條件（品牌/年份/狀態/搜尋）之後、
// 套用隱藏已完成規則「前」vs「後」的項目數差＝目前被這條規則藏起來的數量（④待配對不受規則影響，不計入）
function lotComputeHideDoneCount() {
  const zone1Items = lotZoneGroupbuyItems();
  const zone1Without = lotFilterGroupbuyItems(zone1Items, { hideDone: false }).length;
  const zone1With = lotFilterGroupbuyItems(zone1Items, { hideDone: true }).length;
  const nonGroupbuyDraws = LOTTERY_DRAWS.filter(d => d.section === 'non_groupbuy' && !d.archived);
  const specialDraws = LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived);
  const zone23Without = lotFilterSimpleZoneDraws(nonGroupbuyDraws, { hideDone: false }).length + lotFilterSimpleZoneDraws(specialDraws, { hideDone: false }).length;
  const zone23With = lotFilterSimpleZoneDraws(nonGroupbuyDraws, { hideDone: true }).length + lotFilterSimpleZoneDraws(specialDraws, { hideDone: true }).length;
  const unopenedDraws = LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && !d.acctId && !d.archived && lotDrawHasEvent(d));
  const zoneUnopenedWithout = lotFilterUnopenedDraws(unopenedDraws, { hideDone: false }).length;
  const zoneUnopenedWith = lotFilterUnopenedDraws(unopenedDraws, { hideDone: true }).length;
  return (zone1Without - zone1With) + (zone23Without - zone23With) + (zoneUnopenedWithout - zoneUnopenedWith);
}

// ===== 表格模式（雪莉 09-25：改成會員總覽那種一列一團、點列展開，比卡片清楚）=====
// 欄位：開團日期｜團名（R 號小字）｜品牌｜得獎人（姓名，最多 4 位＋N）｜進度｜狀態。
// 點列（data-role="toggle-card"，事件綁定與卡片版同一段）展開下一列＝原本的抽獎場白框＋操作鈕。
function lotTableWrap(rowsHtml) {
  return '<div class="lot-tbl-wrap"><table class="lot-tbl"><thead><tr>' +
    '<th>開團日期</th><th>團名</th><th>獎品</th><th>得獎人</th><th>電話／地址</th><th class="lot-td-num">進度</th><th>狀態</th>' +
    '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
}
// 得獎人相關三欄（獎品｜姓名｜電話／地址或匯款資料）：一位一行、三欄同序對齊；最多列 4 位，其餘「+N 位」；重抽的不列
const LOT_BRIEF_MAX = 4;
function lotWinnersRows(draws) {
  const rows = [];
  (draws || []).forEach(d => {
    (d.winners || []).forEach(w => {
      if (w.status === 'redrawn') return;
      const pt = lotWinnerType(w, d);
      let contact = '';
      if (pt === 'cash') {
        const bank = [w.bankName, w.bankCode, w.bankBranch].filter(Boolean).join(' ');
        contact = [bank, w.bankAccount ? '帳號 ' + lotMaskAccount(w.bankAccount) : '', (w.cashAmount || w.cashAmount === 0) ? '$' + w.cashAmount : ''].filter(Boolean).join('　');
        // 歷史匯入的現金得獎人常把銀行資料整串放在地址／電話欄：銀行欄位都空就退回顯示那些文字
        if (!contact) contact = [w.phone, w.address].filter(v => v && v !== '-').join('　').replace(/\s+/g, ' ');
      } else if (pt === 'virtual') {
        contact = w.email || '';
      } else {
        contact = [w.phone, [w.zip, w.address].filter(Boolean).join(' ')].filter(Boolean).join('　');
      }
      rows.push({ prize: w.prize || '', who: w.name || w.winnerHandle || '（未填）', contact, done: w.status === 'done' });
    });
  });
  return rows;
}
function lotBriefCol(rows, field) {
  if (!rows.length) return field === 'who' ? '<span class="lot-empty-cell">尚未抽出</span>' : '';
  const shown = rows.slice(0, LOT_BRIEF_MAX).map(r => '<div class="lot-brief-line' + (r.done ? ' lot-brief-done' : '') + '">' + (r[field] ? lotEscapeHtml(r[field]) : '<span class="lot-empty-cell">—</span>') + '</div>').join('');
  return shown + (rows.length > LOT_BRIEF_MAX && field === 'who' ? '<div class="lot-brief-line lot-more">+' + (rows.length - LOT_BRIEF_MAX) + ' 位</div>' : '');
}
function lotWinnersBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'who'); }
function lotPrizeBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'prize'); }
function lotContactBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'contact'); }
function lotProgressOf(draws) {
  const all = (draws || []).flatMap(d => d.winners || []).filter(w => w.status !== 'redrawn');
  const done = all.filter(w => w.status === 'done').length;
  return { done, total: all.length, pending: all.length - done };
}
function lotPill(label, cls) { return '<span class="lot-pill lot-pill-' + cls + '">' + lotEscapeHtml(label) + '</span>'; }
function lotDrawStatusPill(draws) {
  const p = lotProgressOf(draws);
  if (!p.total) return lotPill('待抽', 'draw');
  return p.pending ? lotPill('待處理 ' + p.pending, 'pending') : lotPill('已完成', 'done');
}
// 一列：o = { key, toggle(bool), date, title(html), brand(展開列才顯示), prize(html), winners(html), contact(html), progress(html), status(html), detail(html, 展開時), cls }
function lotRowHtml(o) {
  const expanded = o.toggle && (Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, o.key) ? LOTTERY_EXPANDED_OVERRIDE[o.key] : false);
  const caret = o.toggle ? '<span class="lot-tr-caret">' + lotChevron(expanded ? 'down' : 'right') + '</span>' : '<span class="lot-tr-caret"></span>';
  let html = '<tr class="lot-tr' + (expanded ? ' on' : '') + (o.cls ? ' ' + o.cls : '') + '"' +
    (o.toggle ? ' data-role="toggle-card" data-card-key="' + lotEscapeHtml(o.key) + '"' : '') + (o.attrs || '') + '>' +
    '<td class="lot-td-date">' + caret + lotEscapeHtml(o.date || '') + '</td>' +
    '<td class="lot-td-title">' + (o.title || '') + '</td>' +
    '<td class="lot-td-prize">' + (o.prize || '') + '</td>' +
    '<td class="lot-td-winners">' + (o.winners || '') + '</td>' +
    '<td class="lot-td-contact">' + (o.contact || '') + '</td>' +
    '<td class="lot-td-num">' + (o.progress || '') + '</td>' +
    '<td class="lot-td-status">' + (o.status || '') + '</td>' +
  '</tr>';
  if (expanded) html += '<tr class="lot-tr-detail"><td colspan="7"><div class="lot-detail">' +
    (o.brand ? '<div class="lot-detail-brand">品牌：' + lotEscapeHtml(o.brand) + '</div>' : '') + (o.detail || '') + '</div></td></tr>';
  return html;
}
function lotProgressTxt(draws) { const p = lotProgressOf(draws); return p.total ? p.done + ' / ' + p.total : '—'; }
function lotTitleWithRef(title, draw) {
  return '<span>' + lotEscapeHtml(title || '(未命名活動)') + '</span>' +
    (draw && draw.sheetRef ? ' <span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span>' : '');
}
function lotGroupbuyItemRowHtml(item) {
  if (item.type === 'pending') return lotPendingTeamRowHtml(item.team);
  if (item.type === 'nolottery') return lotNoLotteryTableRowHtml(item.team);
  return lotTeamRowHtml(item.team, item.draws);
}
function lotTeamRowHtml(team, draws) {
  const detail = draws.map(d => lotDrawBlockHtml(d, { showWinnerFoot: true })).join('') +
    ((LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? '<div class="lot-card-foot"><button class="task-mini-btn" data-role="team-add-draw" data-acct-id="' + lotEscapeHtml(team.acctId) + '">＋ 這團加開一場抽獎</button></div>' : '');
  return lotRowHtml({
    key: 'team:' + team.acctId, toggle: true, attrs: ' data-acct-id="' + lotEscapeHtml(team.acctId) + '"',
    date: team.recordDate ? lotFmtYMD(team.recordDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>' + (team.legacyId ? ' <span class="lot-r-muted">（' + lotEscapeHtml(team.legacyId) + '）</span>' : '') + (team.failed ? ' <span class="lot-warn">未成團</span>' : ''),
    brand: team.brandName, prize: lotPrizeBrief(draws), winners: lotWinnersBrief(draws), contact: lotContactBrief(draws), progress: lotProgressTxt(draws), status: lotDrawStatusPill(draws), detail,
  });
}
function lotPendingTeamRowHtml(team) {
  const ops = (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY)
    ? ' <button class="task-mini-btn" data-role="pending-create" data-acct-id="' + lotEscapeHtml(team.acctId) + '">＋ 建立抽獎</button>' +
      '<button class="task-mini-btn danger" data-role="pending-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">這團不抽</button>' : '';
  return lotRowHtml({
    key: 'pending:' + team.acctId, toggle: false, cls: 'lot-tr-pending', attrs: ' data-acct-id="' + lotEscapeHtml(team.acctId) + '"',
    date: team.recordDate ? lotFmtYMD(team.recordDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>' + (team.legacyId ? ' <span class="lot-r-muted">（' + lotEscapeHtml(team.legacyId) + '）</span>' : ''),
    brand: team.brandName, winners: '<span class="lot-warn">已達待抽門檻</span>', progress: '—', status: lotPill('待抽', 'draw') + '<span class="lot-td-ops">' + ops + '</span>',
  });
}
function lotNoLotteryTableRowHtml(team) {
  const ops = (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? ' <button class="task-mini-btn" data-role="restore-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">還原</button>' : '';
  return lotRowHtml({
    key: 'nolot:' + team.acctId, toggle: false, cls: 'lot-tr-muted', attrs: ' data-acct-id="' + lotEscapeHtml(team.acctId) + '"',
    date: team.recordDate ? lotFmtYMD(team.recordDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>' + (team.legacyId ? ' <span class="lot-r-muted">（' + lotEscapeHtml(team.legacyId) + '）</span>' : ''),
    brand: team.brandName, winners: '', progress: '—', status: lotPill('不抽', 'muted') + '<span class="lot-td-ops">' + ops + '</span>',
  });
}
function lotSimpleDrawRowHtml(draw) {
  return lotRowHtml({
    key: 'draw:' + draw.id, toggle: true, attrs: ' data-draw-id="' + lotEscapeHtml(draw.id) + '"',
    date: lotFmtDrawDate(draw) || '（無日期）', title: lotTitleWithRef(draw.title, draw), brand: draw.brandName,
    prize: lotPrizeBrief([draw]), winners: lotWinnersBrief([draw]), contact: lotContactBrief([draw]), progress: lotProgressTxt([draw]), status: lotDrawStatusPill([draw]), detail: lotDrawBlockHtml(draw),
  });
}
function lotUnpairedRowHtml(draw) {
  return lotRowHtml({
    key: 'draw:' + draw.id, toggle: true, attrs: ' data-draw-id="' + lotEscapeHtml(draw.id) + '"',
    date: lotFmtDrawDate(draw) || '（無日期）', title: lotTitleWithRef(draw.title, draw), brand: draw.brandName,
    prize: lotPrizeBrief([draw]), winners: lotWinnersBrief([draw]), contact: lotContactBrief([draw]), progress: lotProgressTxt([draw]), status: lotPill('待配對', 'info'),
    detail: lotDrawBlockHtml(draw) + lotUnpairedExtrasHtml(draw),
  });
}
function lotUnopenedRowHtml(draw) {
  const evChoice = lotEventChoiceById(draw.eventId);
  const rangeTxt = lotFmtEventRangeYMD(draw.eventStartDate, draw.eventEndDate);
  return lotRowHtml({
    key: 'draw:' + draw.id, toggle: true, attrs: ' data-draw-id="' + lotEscapeHtml(draw.id) + '"',
    date: rangeTxt || lotFmtDrawDate(draw) || '（無日期）',
    title: lotTitleWithRef(draw.eventTitle || draw.title, draw) + (evChoice && evChoice.isPublished === false ? ' <span class="lot-warn">未發布</span>' : ''),
    brand: draw.brandName, prize: lotPrizeBrief([draw]), winners: lotWinnersBrief([draw]), contact: lotContactBrief([draw]), progress: lotProgressTxt([draw]), status: lotPill('未開團', 'info'),
    detail: lotDrawBlockHtml(draw) + lotUnopenedExtrasHtml(draw),
  });
}
function lotArchivedRowHtml(draw) {
  return lotRowHtml({
    key: 'draw:' + draw.id, toggle: true, cls: 'lot-tr-muted', attrs: ' data-draw-id="' + lotEscapeHtml(draw.id) + '"',
    date: lotFmtDrawDate(draw) || '（無日期）', title: lotTitleWithRef(draw.title, draw), brand: draw.brandName,
    prize: lotPrizeBrief([draw]), winners: lotWinnersBrief([draw]), contact: lotContactBrief([draw]), progress: lotProgressTxt([draw]), status: lotPill('已結案', 'muted'),
    detail: lotDrawBlockHtml(draw) + (LOTTERY_CAN_EDIT ? '<div class="lot-card-foot"><button class="task-mini-btn" data-role="unarchive-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('undo') + ' 取消結案</button></div>' : ''),
  });
}

function lotRenderZone(key, label, items, itemRenderer) {
  const collapsed = !!LOTTERY_SECTION_COLLAPSED[key];
  const bodyHtml = collapsed ? '' : (items.length
    ? lotTableWrap(items.map(itemRenderer).join(''))
    : '<div class="task-empty lot-zone-empty">（沒有符合條件的項目）</div>');
  return '<div class="lot-zone" data-zone="' + key + '">' +
    '<div class="lot-zone-head" data-zone-toggle="' + key + '">' +
      '<span class="lot-zone-caret">' + lotChevron(collapsed ? 'right' : 'down') + '</span>' +
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
  const nonGroupbuyDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'non_groupbuy' && !d.archived)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const specialDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const acctlessGroupbuyDraws = LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && !d.acctId && !d.archived);
  const archivedDraws = lotApplyDir(lotFilterArchivedDraws(LOTTERY_DRAWS.filter(d => d.archived === true)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const unopenedDraws = lotApplyDir(lotFilterUnopenedDraws(acctlessGroupbuyDraws.filter(lotDrawHasEvent)).slice().sort((a, b) => {
    const da = String(a.eventStartDate || ''), db = String(b.eventStartDate || '');
    return da !== db ? da.localeCompare(db) : String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  }));
  const unpairedDraws = lotApplyDir(lotFilterUnpairedDraws(acctlessGroupbuyDraws.filter(d => !lotDrawHasEvent(d))).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));

  const parts = [];
  if (lotZoneVisible('groupbuy')) parts.push(lotRenderZone('groupbuy', LOT_SECTION_LABEL.groupbuy, groupbuyItems, lotGroupbuyItemRowHtml));
  if (lotZoneVisible('unopened')) parts.push(lotRenderZone('unopened', '未開團／帳務未建', unopenedDraws, d => lotUnopenedRowHtml(d)));
  if (lotZoneVisible('non_groupbuy')) parts.push(lotRenderZone('non_groupbuy', LOT_SECTION_LABEL.non_groupbuy, nonGroupbuyDraws, d => lotSimpleDrawRowHtml(d)));
  if (lotZoneVisible('special')) parts.push(lotRenderZone('special', LOT_SECTION_LABEL.special, specialDraws, d => lotSimpleDrawRowHtml(d)));
  if (lotZoneVisible('unpaired')) parts.push(lotRenderZone('unpaired', '待配對（團購但還沒綁帳務團）', unpairedDraws, d => lotUnpairedRowHtml(d)));
  if (lotZoneVisible('archived')) parts.push(lotRenderZone('archived', '舊資料（已結案）', archivedDraws, d => lotArchivedRowHtml(d)));

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
  if (team.failed) parts.push('<span class="lot-warn">未成團</span>');
  return parts.join('');
}
// 團卡頭共用：完整日期＋團名為主標題，R 號降成句尾小灰字（雪莉在帳務頁本來就看不到 R 號，
// 日期＋團名才是認得出來的識別；同一份文字也用在待辦清單「團」欄）
function lotTeamTitleHtml(team) {
  const dateLead = team.recordDate ? (lotFmtYMD(team.recordDate) + ' ') : '（無日期）';
  return '<span>' + lotEscapeHtml(dateLead) + lotEscapeHtml(team.title || '') + '</span>' +
    (team.legacyId ? '<span class="lot-r-muted">（' + lotEscapeHtml(team.legacyId) + '）</span>' : '');
}

function lotTeamCardHtml(team, draws) {
  const allWinners = draws.flatMap(d => d.winners || []);
  const total = allWinners.length;
  const doneCount = allWinners.filter(w => w.status === 'done').length;
  const unfinished = allWinners.some(w => w.status !== 'done' && w.status !== 'redrawn');
  const cardKey = 'team:' + team.acctId;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false; // 預設收合（雪莉 09-25），收合時卡上列得獎人摘要

  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
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
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title">' + lotTeamTitleHtml(team) + '</div>' +
        '<div class="lot-meta">' + lotTeamHeaderMetaHtml(team) + '</div>' +
      '</div>' +
      '<div class="lot-progress">' + progressHtml + '<span class="lot-caret">' + lotCaretHtml(expanded, '收合', '展開') + '</span></div>' +
    '</div>' +
    (expanded ? (
      '<div class="lot-card-body">' + drawBlocksHtml + '</div>' +
      '<div class="lot-card-foot">' +
        (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY ? '<button class="task-mini-btn" data-role="team-add-draw" data-acct-id="' + lotEscapeHtml(team.acctId) + '">＋ 這團加開一場抽獎</button>' : '') +
      '</div>'
    ) : lotCardSummaryHtml(draws)) +
  '</div>';
}

// 一場抽獎（一個 draw）的區塊：標題列＋meta＋得獎人表格＋（可選）小工具列。
// 團卡（正抽＋加碼可能多場）跟②③區（一區一場）都共用這個渲染，只差外層包裝。
function lotDrawBlockHtml(draw, opts) {
  opts = opts || {};
  const prizeType = draw.prizeType || 'physical';
  // meta 一律做成小膠囊（.lot-chip），排在標題下一行（雪莉 09-24 A 版：原本跟標題擠成一行＝一整片文字）
  const chip = (inner, cls, attrs) => '<span class="lot-chip' + (cls ? ' ' + cls : '') + '"' + (attrs || '') + '>' + inner + '</span>';
  const metaParts = [];
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push(chip(dateTxt, draw.dateUncertain ? 'lot-warn' : ''));
  metaParts.push(chip(LOT_PRIZE_TYPE_LABEL[prizeType] || '', 'lot-ptype lot-ptype-' + lotEscapeHtml(prizeType)));
  if (draw.prize) metaParts.push(chip('獎品：' + lotEscapeHtml(draw.prize)));
  if (prizeType === 'cash' && (draw.cashAmount || draw.cashAmount === 0)) metaParts.push(chip('$' + lotEscapeHtml(draw.cashAmount)));
  if (draw.lineKeyword) metaParts.push(chip('L關鍵字：' + lotEscapeHtml(draw.lineKeyword)));
  metaParts.push(chip('贊助：' + (LOT_SHIP_BY_LABEL[draw.shipBy] || '團購主')));
  if (draw.note) metaParts.push(chip(lotIcon('note') + ' 有備註', '', ' title="' + lotEscapeHtml(draw.note) + '"'));
  if (draw.sheetRef) metaParts.push(chip(lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef), 'lot-sheet-ref'));
  // ①團購抽獎專屬：acctId 是靠對應的行事曆團「後來才建了帳務列」自動補上的（非雪莉手綁）
  if (draw.acctDerived) metaParts.push(chip('由行事曆團自動對應', 'lot-chip-hint'));

  const rowsHtml = (draw.winners || []).map(w => lotWinnerRowHtml(draw.id, w, lotWinnerType(w, prizeType), prizeType)).join('');

  return '<div class="lot-draw-block" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-draw-block-head">' +
      '<span class="lot-draw-block-title">' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span>' +
      '<div class="lot-draw-meta">' + metaParts.join('') + '</div>' +
    '</div>' +
    '<div class="lot-wl">' +
      '<div class="lot-wl-head"><span>獎品</span><span>得獎人</span><span>狀態</span><span>姓名</span><span>備註</span><span></span></div>' +
      (rowsHtml || '<div class="lot-wl-empty">還沒有得獎人</div>') +
    '</div>' +
    '<div class="lot-draw-block-foot">' +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="add-winner" data-draw-id="' + lotEscapeHtml(draw.id) + '">＋ 加一位得獎人</button>' : '') +
      '<button class="task-mini-btn" data-role="copy-notify" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('copy') + ' 複製通知文</button>' +
      '<span class="lot-spacer"></span>' +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="edit-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('edit') + ' 編輯這場</button>' : '') +
      (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn danger" data-role="delete-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('trash') + ' 刪除這場</button>' : '') +
    '</div>' +
  '</div>';
}

// ②③區：一場抽獎自己一張卡（非團購／特殊抽獎專區，不綁帳務團）
function lotSimpleDrawCardHtml(draw) {
  const total = (draw.winners || []).length;
  const doneCount = (draw.winners || []).filter(w => w.status === 'done').length;
  const unfinished = (draw.winners || []).some(w => w.status !== 'done' && w.status !== 'redrawn');
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false; // 預設收合（雪莉 09-25），收合時卡上列得獎人摘要
  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
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
      '<div class="lot-progress"><span class="lot-progress-txt">' + doneCount + ' / ' + total + ' 已完成</span><span class="lot-caret">' + lotCaretHtml(expanded, '收合', '展開') + '</span></div>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : lotCardSummaryHtml([draw])) +
  '</div>';
}

// ④待配對：卡＋「綁定帳務團」下拉（同品牌排最前，依開團日）＋「改為非團購」
function lotUnpairedCardHtml(draw) {
  const total = (draw.winners || []).length;
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false;
  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  metaParts.push('<span>' + total + ' 位得獎人</span>');

  return '<div class="lot-card" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span>' +
          (draw.sheetRef ? '<span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span>' : '') +
        '</div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<span class="lot-caret">' + lotCaretHtml(expanded, '收合明細', '展開明細') + '</span>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : lotCardSummaryHtml([draw])) +
    lotUnpairedExtrasHtml(draw) +
  '</div>';
}
// ④待配對的操作區：綁定帳務團（搜尋＋下拉＋綁定／改為非團購）＋或綁行事曆團購＋結案（卡片與表格展開列共用）
function lotUnpairedExtrasHtml(draw) {
  const bindHtml = (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? (
    '<div class="lot-unpaired-bind">' +
      '<input type="text" placeholder="搜尋 R 號／團名…" data-role="unpaired-search" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
      '<select data-role="unpaired-select" data-draw-id="' + lotEscapeHtml(draw.id) + '"></select>' +
      '<button class="task-mini-btn" data-role="unpaired-bind" data-draw-id="' + lotEscapeHtml(draw.id) + '">綁定</button>' +
      '<button class="task-mini-btn" data-role="unpaired-to-nongroupbuy" data-draw-id="' + lotEscapeHtml(draw.id) + '">改為非團購</button>' +
    '</div>'
  ) : (LOTTERY_ACCT_READY ? '' : '<div class="lot-unpaired-bind"><span class="hint">帳務欄位還沒 db push，暫時不能綁定</span></div>');

  // 或綁行事曆團購（帳務還沒建）：選了直接送出（不用另外按綁定鍵），沒有候選團購就整條不顯示
  const eventOptionsHtml = lotEventChoicesForUnpairedDraw(draw).map(ev =>
    '<option value="' + lotEscapeHtml(ev.eventId) + '">' + lotEscapeHtml(lotFmtEventRangeYMD(ev.startDate, ev.endDate)) + ' ' + lotEscapeHtml(ev.title || '') + '</option>'
  ).join('');
  const eventBindHtml = (LOTTERY_CAN_EDIT && LOTTERY_EVENT_CHOICES.length) ? (
    '<div class="lot-unpaired-bind">' +
      '<span class="hint">或綁行事曆團購（帳務未建）：</span>' +
      '<select data-role="unpaired-event-select" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
        '<option value="">（選擇要綁定的行事曆團）</option>' + eventOptionsHtml +
      '</select>' +
    '</div>'
  ) : '';
  // 呆帳寫死結案：不需要 LOTTERY_ACCT_READY（archived 不吃 acct 欄位），只要有編輯權限就能結案
  const archiveBtnHtml = LOTTERY_CAN_EDIT
    ? '<div class="lot-unpaired-bind"><button class="task-mini-btn" data-role="unpaired-archive" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('archive') + ' 結案</button></div>'
    : '';

  return bindHtml + eventBindHtml + archiveBtnHtml;
}

// 🗓 未開團／帳務未建：section=groupbuy、acctId 空、eventId 有值——已經有對應的行事曆團購，
// 只是那個團的帳務列還沒建（結團前，或雪莉還沒手動建帳務）。跟④待配對同一種卡片骨架，
// 差別是多顯示行事曆團購資訊（開團日期／團名／未發布徽章）＋多一顆「解除行事曆綁定」。
function lotUnopenedCardHtml(draw) {
  const total = (draw.winners || []).length;
  const unfinished = (draw.winners || []).some(w => w.status !== 'done' && w.status !== 'redrawn');
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false; // 預設收合（雪莉 09-25），收合時卡上列得獎人摘要
  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
  const rangeTxt = lotFmtEventRangeYMD(draw.eventStartDate, draw.eventEndDate);
  const evChoice = lotEventChoiceById(draw.eventId);

  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  metaParts.push('<span>' + total + ' 位得獎人</span>');
  // 查無 eventChoices 對應列＝未知，不顯示未發布／已發布徽章（不確定就不標）
  if (evChoice && evChoice.isPublished === false) metaParts.push('<span class="lot-warn">未發布</span>');

  return '<div class="lot-card" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title">' +
          (rangeTxt ? '<span class="lot-r-badge">' + lotEscapeHtml(rangeTxt) + '</span>' : '') +
          '<span>' + lotEscapeHtml(draw.eventTitle || draw.title || '(未命名活動)') + '</span>' +
          (draw.sheetRef ? '<span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span>' : '') +
        '</div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<span class="lot-caret">' + lotCaretHtml(expanded, '收合明細', '展開明細') + '</span>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : lotCardSummaryHtml([draw])) +
    lotUnopenedExtrasHtml(draw) +
  '</div>';
}
// 未開團的操作區：綁定帳務團／解除行事曆綁定＋結案（卡片與表格展開列共用）
function lotUnopenedExtrasHtml(draw) {
  let bindHtml = '';
  if (LOTTERY_CAN_EDIT) {
    const unbindBtn = '<button class="task-mini-btn danger" data-role="unopened-unbind" data-draw-id="' + lotEscapeHtml(draw.id) + '">解除行事曆綁定</button>';
    bindHtml = '<div class="lot-unpaired-bind">' +
      (LOTTERY_ACCT_READY ? (
        '<input type="text" placeholder="搜尋 R 號／團名…" data-role="unopened-search" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
        '<select data-role="unopened-select" data-draw-id="' + lotEscapeHtml(draw.id) + '"></select>' +
        '<button class="task-mini-btn" data-role="unopened-bind" data-draw-id="' + lotEscapeHtml(draw.id) + '">綁定帳務團</button>'
      ) : '<span class="hint">帳務欄位還沒 db push，暫時不能綁定帳務團</span>') +
      unbindBtn +
    '</div>';
  }
  // 呆帳寫死結案：不需要 LOTTERY_ACCT_READY，只要有編輯權限就能結案
  const archiveBtnHtml = LOTTERY_CAN_EDIT
    ? '<div class="lot-unpaired-bind"><button class="task-mini-btn" data-role="unopened-archive" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('archive') + ' 結案</button></div>'
    : '';

  return bindHtml + archiveBtnHtml;
}

// ===== 📦 舊資料（已結案）：卡片沿用②③/④「簡單卡」骨架——標題／完整年份日期／sheetRef pill／
// 得獎人表格（跟其他區同一顆 lotDrawBlockHtml，仍可編輯得獎人細節，唯一差別是多一顆「取消結案」）=====
function lotArchivedCardHtml(draw) {
  const total = (draw.winners || []).length;
  const doneCount = (draw.winners || []).filter(w => w.status === 'done').length;
  const cardKey = 'draw:' + draw.id;
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, cardKey) ? LOTTERY_EXPANDED_OVERRIDE[cardKey] : false;
  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  metaParts.push('<span>' + total + ' 位得獎人</span>');

  return '<div class="lot-card lot-card-archived" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card" data-card-key="' + lotEscapeHtml(cardKey) + '">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(draw.title || '(未命名活動)') + '</span>' +
          (draw.sheetRef ? '<span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span>' : '') +
        '</div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<div class="lot-progress"><span class="lot-progress-txt">' + doneCount + ' / ' + total + ' 已完成</span><span class="lot-caret">' + lotCaretHtml(expanded, '收合', '展開') + '</span></div>' +
    '</div>' +
    (expanded ? '<div class="lot-card-body">' + lotDrawBlockHtml(draw) + '</div>' : lotCardSummaryHtml([draw])) +
    (LOTTERY_CAN_EDIT ? '<div class="lot-card-foot"><button class="task-mini-btn" data-role="unarchive-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">' + lotIcon('undo') + ' 取消結案</button></div>' : '') +
  '</div>';
}

function lotPendingTeamCardHtml(team) {
  const thumb = ''; // 品牌小圖拿掉（雪莉 09-24：讓頁面更亂）
  const metaParts = [];
  if (team.brandName) metaParts.push('<span>品牌：' + lotEscapeHtml(team.brandName) + '</span>');
  metaParts.push('<span class="lot-warn">已達待抽門檻</span>');
  return '<div class="lot-card lot-card-pending" data-acct-id="' + lotEscapeHtml(team.acctId) + '">' +
    '<div class="lot-card-head">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title">' + lotTeamTitleHtml(team) + '</div>' +
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
    lotTeamTitleHtml(team) +
    '<span class="lot-spacer"></span>' +
    ((LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? '<button class="task-mini-btn" data-role="restore-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">還原</button>' : '') +
  '</div>';
}

// 線條圖示（藕粉奶茶色系規則：圖示用 SVG 線條、不用 emoji）
// 收合狀態的得獎人摘要（雪莉 09-25：卡片預設關閉，外面直接看獎品／姓名／電話／地址，不要遮罩眼睛）。
// 一位得獎人一列：獎品｜姓名（沒填就用 IG 帳號）｜寄件或匯款資料全文｜狀態小字；重抽的不列。點整張卡才展開完整編輯列。
function lotCardSummaryHtml(draws) {
  const rows = [];
  (draws || []).forEach(d => {
    const pt = d.prizeType || 'physical';
    (d.winners || []).forEach(w => {
      if (w.status === 'redrawn') return;
      const who = w.name || w.winnerHandle || '';
      const info = [];
      if (pt === 'cash') {
        const bank = [w.bankName, w.bankCode, w.bankBranch].filter(Boolean).join(' ');
        if (bank) info.push(bank);
        if (w.bankAccount) info.push('帳號 ' + lotMaskAccount(w.bankAccount));
        if (w.cashAmount || w.cashAmount === 0) info.push('$' + w.cashAmount);
      } else if (pt === 'virtual') {
        if (w.email) info.push(w.email);
      } else {
        if (w.phone) info.push(w.phone);
        if (w.zip || w.address) info.push([w.zip, w.address].filter(Boolean).join(' '));
      }
      rows.push('<div class="lot-sum-row' + (w.status === 'done' ? ' lot-sum-done' : '') + '">' +
        '<span class="lot-sum-prize">' + lotEscapeHtml(w.prize || '') + '</span>' +
        '<span class="lot-sum-who">' + lotEscapeHtml(who) + '</span>' +
        '<span class="lot-sum-info">' + lotEscapeHtml(info.join('　')) + '</span>' +
        '<span class="lot-sum-status">' + lotEscapeHtml(lotStatusLabel(w.status, pt)) + '</span>' +
      '</div>');
    });
  });
  if (!rows.length) return '';
  return '<div class="lot-card-summary">' + rows.join('') + '</div>';
}

// 線條箭頭（取代 ▲▼▶ 文字符號）：dir = down|up|right，CSS .lot-chev-* 負責旋轉
function lotChevron(dir) {
  return '<svg class="lot-chev lot-chev-' + dir + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
}
function lotCaretHtml(expanded, closeTxt, openTxt) {
  return lotChevron(expanded ? 'up' : 'down') + ' ' + (expanded ? closeTxt : openTxt);
}
function lotIcon(name) {
  const P = { eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    redo: '<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    note: '<path d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9z"/><path d="M13.5 3.5V9H19"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
    sheet: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    undo: '<path d="M3 10h11a5 5 0 0 1 0 10h-3"/><path d="M7 6l-4 4 4 4"/>' };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
}

// 得獎人一列＝兩層（2026-09-23 雪莉選 B 版）：上行＝處理時看的（獎品／得獎人／狀態／姓名／備註／操作），
// 下行淡字＝寄件才要看的（電話／地址／寄出日／運費）。欄位減半＝任何寬度都放得下、不再橫向捲動。
// data-role／data-winner-id 與舊表格版完全相同，事件綁定（lotBindSectionEvents）零改動。
function lotWinnerRowHtml(drawId, w, prizeType, drawPrizeType) {
  prizeType = prizeType || 'physical';
  // 得獎人類型跟活動不同（例：免單場裡的實體贈品）→ 獎品名後標小膠囊
  const typeTag = (drawPrizeType && prizeType !== drawPrizeType)
    ? ' <span class="lot-ptype lot-ptype-' + lotEscapeHtml(prizeType) + '">' + (LOT_PRIZE_TYPE_LABEL[prizeType] || '') + '</span>' : '';
  const rowCls = w.status === 'redrawn' ? ' lot-wl-row-redrawn' : '';
  const statusOptions = LOT_STATUS_ORDER.map(k => '<option value="' + k + '"' + (w.status === k ? ' selected' : '') + '>' + lotStatusLabel(k, prizeType) + '</option>').join('');
  const statusSel = '<select class="lot-status-sel lot-s-' + lotEscapeHtml(w.status) + '" data-role="status-sel" data-winner-id="' + lotEscapeHtml(w.id) + '"' + (LOTTERY_CAN_EDIT ? '' : ' disabled') + '>' + statusOptions + '</select>';
  const empty = '<span class="lot-empty-cell">—</span>';
  const maskCell = (full, masked) => full
    ? '<span class="lot-mask" data-full="' + lotEscapeHtml(full) + '" data-masked="' + lotEscapeHtml(masked) + '" data-revealed="0"><span class="lot-mask-text">' + lotEscapeHtml(masked) + '</span><span class="lot-eye" data-role="toggle-mask" title="顯示／隱藏">' + lotIcon('eye') + '</span></span>'
    : empty;
  // 標記完成鈕的文字依獎品類型：現金＝匯款、虛擬＝發送、實體＝寄出
  const shipActionLabel = prizeType === 'cash' ? '標記已匯款（今天）' : (prizeType === 'virtual' ? '標記已發送（今天）' : '標記已寄出（今天）');
  const actions = LOTTERY_CAN_EDIT
    ? '<button class="lot-ic-btn" title="編輯" aria-label="編輯" data-role="edit-winner" data-winner-id="' + lotEscapeHtml(w.id) + '" data-draw-id="' + lotEscapeHtml(drawId) + '">' + lotIcon('edit') + '</button>' +
      (w.status !== 'done' && w.status !== 'redrawn' ? '<button class="lot-ic-btn" title="' + shipActionLabel + '" aria-label="' + shipActionLabel + '" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">' + lotIcon('check') + '</button>' : '') +
      (w.status !== 'redrawn' ? '<button class="lot-ic-btn danger" title="重抽" aria-label="重抽" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">' + lotIcon('redo') + '</button>' : '')
    : '';
  const sub = (label, val) => '<span><b>' + label + '</b>' + val + '</span>';

  // 只列「有填」的欄位；一個都沒填就一句淡字（雪莉 09-24：一排「—」讓畫面散亂）
  const subParts = [];
  let emptyMsg;
  if (prizeType === 'cash') {
    const bankLine = [w.bankName, w.bankCode, w.bankBranch].filter(Boolean).join(' ');
    if (w.accountName) subParts.push(sub('戶名', lotEscapeHtml(w.accountName)));
    if (bankLine) subParts.push(sub('銀行', lotEscapeHtml(bankLine)));
    if (w.bankAccount) subParts.push(sub('帳號', maskCell(w.bankAccount, lotMaskAccount(w.bankAccount))));
    if (w.cashAmount || w.cashAmount === 0) subParts.push(sub('金額', lotEscapeHtml(w.cashAmount)));
    if (w.shippedAt) subParts.push(sub('匯款日', lotEscapeHtml(w.shippedAt)));
    if (!subParts.length) { // 歷史匯入：銀行資料整串在地址／電話欄
      const legacy = [w.phone, w.address].filter(v => v && v !== '-').join('　');
      if (legacy) subParts.push(sub('匯款資料', lotEscapeHtml(legacy)));
    }
    emptyMsg = '尚未填寫匯款資料';
  } else if (prizeType === 'virtual') {
    if (w.email) subParts.push(sub('email', lotEscapeHtml(w.email)));
    if (w.shippedAt) subParts.push(sub('發送日', lotEscapeHtml(w.shippedAt)));
    emptyMsg = '尚未填寫 email';
  } else {
    if (w.phone) subParts.push(sub('電話', lotEscapeHtml(w.phone))); // 不遮罩（雪莉 09-25）
    if (w.zip) subParts.push(sub('郵遞區號', lotEscapeHtml(w.zip)));
    if (w.address) subParts.push(sub('地址', lotEscapeHtml(w.address))); // 不遮罩（雪莉 09-25）
    if (w.shippedAt) subParts.push(sub('寄出日', lotEscapeHtml(w.shippedAt)));
    if (w.shippingFee) subParts.push(sub('運費', lotEscapeHtml(w.shippingFee)));
    emptyMsg = '尚未填寫寄件資料';
  }
  const subHtml = subParts.length ? subParts.join('') : '<span class="lot-sub-empty">' + emptyMsg + '</span>';

  return '<div class="lot-wl-row' + rowCls + '">' +
    '<div class="lot-wl-main">' +
      '<span class="lot-wl-prize" title="' + lotEscapeHtml(w.prize) + '">' + lotEscapeHtml(w.prize) + typeTag + '</span>' +
      '<span class="lot-wl-who">' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : empty) + '</span>' +
      '<span class="lot-wl-status">' + statusSel + '</span>' +
      '<span class="lot-wl-name">' + (w.name ? lotEscapeHtml(w.name) : empty) + '</span>' +
      '<span class="lot-wl-memo">' + (w.memo ? lotEscapeHtml(w.memo) : empty) + '</span>' +
      '<span class="lot-wl-ops">' + actions + '</span>' +
    '</div>' +
    '<div class="lot-wl-sub">' + subHtml + '</div>' +
  '</div>';
}

// ===== 待辦清單視圖（攤平所有分區未完成的得獎人列）=====
function renderLotteryTodo() {
  const box = document.getElementById('lotBody');
  if (!box) return;
  let rows = [];
  LOTTERY_DRAWS.forEach(draw => {
    if (draw.archived) return; // 呆帳結案：待辦清單也不再出現
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
    box.innerHTML = '<div class="task-empty">目前沒有待辦事項</div>';
    return;
  }

  const trHtml = rows.map(({ draw, team, w }) => {
    const stuck = lotDaysSince(draw.drawDate || (draw.createdAt || '').slice(0, 10));
    const stuckTxt = stuck === null ? '—' : (stuck < 0 ? '未到' : stuck + ' 天');
    const teamLabel = team ? lotTeamTitleHtml(team) : lotEscapeHtml(draw.title || '');
    const sheetRefTxt = draw.sheetRef ? '<div><span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span></div>' : '';
    let nextBtns = '';
    if (LOTTERY_CAN_EDIT) {
      if (w.status === 'pending') {
        nextBtns = '<button class="lot-next-btn" data-role="todo-notify" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已通知 ›</button>';
      } else if (w.status === 'awaiting_info') {
        nextBtns = '<button class="lot-next-btn" data-role="edit-winner" data-winner-id="' + lotEscapeHtml(w.id) + '" data-draw-id="' + lotEscapeHtml(draw.id) + '">填入資料 ›</button>' +
          '<button class="lot-next-btn danger" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">重抽</button>';
      } else if (w.status === 'info_ready') {
        const wt = lotWinnerType(w, draw);
        const shipLabel = wt === 'cash' ? '標記已匯款（今天）›' : (wt === 'virtual' ? '標記已發送（今天）›' : '標記已寄出（今天）›');
        nextBtns = '<button class="lot-next-btn" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">' + shipLabel + '</button>';
      } else if (w.status === 'handed_to_vendor') {
        nextBtns = '<button class="lot-next-btn" data-role="todo-done" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已完成 ›</button>';
      }
    }
    return '<tr>' +
      '<td>' + teamLabel + sheetRefTxt + '</td>' +
      lotPrizeCellHtml(w.prize) +
      '<td>' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : '<span class="lot-empty-cell">—</span>') + '</td>' +
      '<td><span class="lot-status-sel lot-s-' + lotEscapeHtml(w.status) + '" style="display:inline-block; cursor:default;">' + lotStatusLabel(w.status, lotWinnerType(w, draw)) + '</span></td>' +
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
      if (key === 'unopened') lotSaveUnopenedCollapsed(LOTTERY_SECTION_COLLAPSED[key]);
      if (key === 'archived') lotSaveArchivedCollapsed(LOTTERY_SECTION_COLLAPSED[key]);
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
      if (!confirm('確定這團不用抽獎嗎？（之後可在篩選列「已標不抽」清單裡還原）')) return;
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
  // ④待配對卡：「或綁行事曆團購（帳務未建）」下拉，選了直接送出（沒有另外的綁定鍵）
  box.querySelectorAll('[data-role="unpaired-event-select"]').forEach(sel => {
    sel.addEventListener('click', ev => ev.stopPropagation());
    sel.addEventListener('change', function () {
      const eventId = this.value;
      if (!eventId) return;
      lotApiPost('lottery-draw-upsert', { id: this.dataset.drawId, eventId }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('綁定失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
  // 🗓 未開團／帳務未建：綁定帳務團（同④的搜尋＋下拉＋按鈕）／解除行事曆綁定
  box.querySelectorAll('[data-role="unopened-select"]').forEach(sel => {
    lotFillUnpairedSelect(sel, '');
    sel.addEventListener('click', ev => ev.stopPropagation());
  });
  box.querySelectorAll('[data-role="unopened-search"]').forEach(input => {
    input.addEventListener('click', ev => ev.stopPropagation());
    input.addEventListener('input', function () {
      const sel = box.querySelector('[data-role="unopened-select"][data-draw-id="' + this.dataset.drawId + '"]');
      if (sel) lotFillUnpairedSelect(sel, this.value);
    });
  });
  box.querySelectorAll('[data-role="unopened-bind"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const sel = box.querySelector('[data-role="unopened-select"][data-draw-id="' + el.dataset.drawId + '"]');
      const acctId = sel ? sel.value : '';
      if (!acctId) { alert('請先選一個帳務團'); return; }
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, acctId, section: 'groupbuy' }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('綁定失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
  box.querySelectorAll('[data-role="unopened-unbind"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm('確定要解除這場抽獎跟行事曆團購的綁定嗎？（帳務團綁定不受影響）')) return;
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, eventId: '' }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
  // 📦 結案（④待配對／🗓未開團卡皆有）：呆帳寫死收掉，之後只能在「舊資料（已結案）」取消
  const archiveHandler = el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm('結案後這筆不會出現在待配對與待辦，之後可在「舊資料（已結案）」取消。確定？')) return;
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, archived: true }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  };
  box.querySelectorAll('[data-role="unpaired-archive"]').forEach(archiveHandler);
  box.querySelectorAll('[data-role="unopened-archive"]').forEach(archiveHandler);
  // 📦 舊資料（已結案）區：取消結案
  box.querySelectorAll('[data-role="unarchive-draw"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      lotApiPost('lottery-draw-upsert', { id: el.dataset.drawId, archived: false }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
}

function lotFillUnpairedSelect(sel, filterText) {
  const drawId = sel.dataset.drawId;
  const draw = LOTTERY_DRAWS.find(d => d.id === drawId);
  const q = (filterText || '').trim().toLowerCase();
  const filtered = LOTTERY_ACCT_TEAMS.filter(t => !q || (t.legacyId || '').toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q) || (t.brandName || '').toLowerCase().includes(q));
  const list = lotRankAcctTeams(filtered, draw ? { brandId: draw.brandId, title: draw.title, drawDate: draw.drawDate } : null);
  const cur = sel.value;
  sel.innerHTML = '<option value="">（選擇要綁定的帳務團）</option>' + list.map(t =>
    '<option value="' + lotEscapeHtml(t.acctId) + '">' + lotEscapeHtml(lotAcctTeamOptionLabel(t)) + '</option>'
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
  if (team.noLottery) return { label: '不抽', cls: 'lot-acct-badge-off' };
  const draws = lotDrawsForAcct(team.acctId);
  if (!draws.length) {
    if (team.pendingDraw) return { label: '待抽', cls: 'lot-acct-badge-draw' };
    return null;
  }
  const winners = draws.flatMap(d => d.winners || []);
  const pending = winners.filter(w => w.status !== 'done' && w.status !== 'redrawn');
  if (!pending.length) return { label: '已完成 ' + winners.length, cls: 'lot-acct-badge-done' };
  return { label: '待處理 ' + pending.length, cls: 'lot-acct-badge-pending' };
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
// LOT_DRAW_TITLE_OVERRIDE：團購分區下標題預設自動產生（「M月 品牌」，由後端算）；使用者點「改」
// 才顯示標題輸入框並手動接管，這個旗標記著目前是不是手動接管中。每次開視窗重置。
let LOT_DRAW_TITLE_OVERRIDE = false;
function openLotteryDrawModal(draw, prefill) {
  LOTTERY_EDIT_DRAW_ID = draw ? draw.id : null;
  LOT_DRAW_TITLE_OVERRIDE = false;
  const isNew = !draw;
  const pf = (!draw && prefill) ? prefill : null;
  document.getElementById('lotDrawModalTitle').textContent = isNew ? '新增抽獎' : '編輯活動';
  document.getElementById('lotDrawDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  document.getElementById('lotDrawWinnerSection').style.display = isNew ? '' : 'none';

  const prizeReadyWarn = document.getElementById('lotDrawPrizeReadyWarn');
  if (prizeReadyWarn) prizeReadyWarn.style.display = LOTTERY_PRIZE_READY ? 'none' : '';

  const section = draw ? (draw.section || 'groupbuy') : (pf ? (pf.section || 'groupbuy') : 'groupbuy');
  document.getElementById('lotDrawSectionSelect').value = section;

  const brandSel = document.getElementById('lotDrawBrandSelect');
  brandSel.innerHTML = '<option value="">（不指定）</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '">' + lotEscapeHtml(b.name) + '</option>'
  ).join('');
  brandSel.value = draw ? (draw.brandId || '') : (pf ? (pf.brandId || '') : '');

  document.getElementById('lotDrawTitleInput').value = draw ? (draw.title || '') : (pf ? (pf.title || '') : '');
  document.getElementById('lotDrawDateInput').value = draw ? (draw.drawDate || '') : (pf ? (pf.drawDate || '') : '');
  document.getElementById('lotDrawDateUncertain').checked = !!(draw && draw.dateUncertain);
  const rawShipBy = draw ? (draw.shipBy || 'self') : 'self';
  document.getElementById('lotDrawShipBySelect').value = rawShipBy === 'none' ? 'self' : rawShipBy;
  document.getElementById('lotDrawNoteInput').value = draw ? (draw.note || '') : '';

  document.getElementById('lotDrawPrizeTypeSelect').value = draw ? (draw.prizeType || 'physical') : (pf ? (pf.prizeType || 'physical') : 'physical');
  document.getElementById('lotDrawPrizeInput').value = draw ? (draw.prize || '') : (pf ? (pf.prize || '') : '');
  document.getElementById('lotDrawCashAmountInput').value = (draw && (draw.cashAmount || draw.cashAmount === 0)) ? draw.cashAmount : '';
  lotSyncDrawPrizeTypeUI();

  // 「團購」合併下拉：有 acctId 選 acct、否則有 eventId 選 event（點 1）
  const boundValue = draw
    ? (draw.acctId ? 'acct:' + draw.acctId : (draw.eventId ? 'event:' + draw.eventId : ''))
    : (pf ? (pf.acctId ? 'acct:' + pf.acctId : (pf.eventId ? 'event:' + pf.eventId : '')) : '');
  document.getElementById('lotDrawAcctSearchInput').value = '';
  // 開啟當下表單欄位還沒填入這次的資料（品牌/標題/日期在上面剛設），排序脈絡直接用 draw/prefill，避免吃到上一次開視窗的殘值
  const src = draw || pf || {};
  lotFillDrawAcctSelect('', boundValue, { brandId: src.brandId || '', title: src.title || '', drawDate: src.drawDate || '', eventTitle: draw ? (draw.eventTitle || '') : '' });

  // 依分區顯示/隱藏團購欄位＋標題自動產生 UI（讀取上面剛設好的 lotDrawTitleInput 值）
  lotSyncDrawSectionUI();

  const readyWarn = document.getElementById('lotDrawAcctReadyWarn');
  readyWarn.style.display = LOTTERY_ACCT_READY ? 'none' : '';
  document.getElementById('lotDrawAcctSearchInput').disabled = !LOTTERY_ACCT_READY;
  document.getElementById('lotDrawAcctSelect').disabled = !LOTTERY_ACCT_READY;

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
  lotSyncDrawTitleUI();
}
// 團購分區：標題預設自動產生（隱藏輸入框、只顯示一行小字＋「改」連結）；非團購／特殊分區：照舊必填輸入框。
function lotSyncDrawTitleUI() {
  const groupbuy = document.getElementById('lotDrawSectionSelect').value === 'groupbuy';
  const box = document.getElementById('lotDrawTitleAutoBox');
  const group = document.getElementById('lotDrawTitleGroup');
  if (!groupbuy || LOT_DRAW_TITLE_OVERRIDE) {
    box.style.display = 'none';
    group.style.display = '';
    return;
  }
  group.style.display = 'none';
  box.style.display = '';
  const existing = document.getElementById('lotDrawTitleInput').value.trim();
  document.getElementById('lotDrawTitleAutoText').textContent = existing
    ? ('標題：' + existing + '（自動產生）')
    : '標題將自動產生「M月 品牌」';
}
document.getElementById('lotDrawTitleEditLink').addEventListener('click', () => {
  LOT_DRAW_TITLE_OVERRIDE = true;
  lotSyncDrawTitleUI();
});
function lotSyncDrawPrizeTypeUI() {
  const isCash = document.getElementById('lotDrawPrizeTypeSelect').value === 'cash';
  document.getElementById('lotDrawCashAmountGroup').style.display = isCash ? '' : 'none';
}
document.getElementById('lotDrawPrizeTypeSelect').addEventListener('change', lotSyncDrawPrizeTypeUI);
// 團購合併下拉：optgroup「已建帳務」(LOTTERY_ACCT_TEAMS) + 「尚未建帳務（行事曆）」(LOTTERY_EVENT_CHOICES)。
// value 格式 "acct:<id>" / "event:<id>"／空字串＝不綁。
// ctx（可省略）：{brandId,title,drawDate,eventTitle} 明確指定排序依據＋selectedValue 是行事曆但已不在候選
// 清單裡時的備援標題；沒給就讀 modal 目前表單值（品牌／標題／抽獎日）
function lotFillDrawAcctSelect(filterText, selectedValue, ctx) {
  const sel = document.getElementById('lotDrawAcctSelect');
  const q = (filterText || '').trim().toLowerCase();
  const rankCtx = ctx || {
    brandId: document.getElementById('lotDrawBrandSelect').value,
    title: document.getElementById('lotDrawTitleInput').value,
    drawDate: document.getElementById('lotDrawDateInput').value
  };

  const filteredAcct = LOTTERY_ACCT_TEAMS.filter(t => !q || (t.legacyId || '').toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q) || (t.brandName || '').toLowerCase().includes(q));
  const acctList = lotRankAcctTeams(filteredAcct, rankCtx);

  const brandName = rankCtx.brandId ? ((LOTTERY_BRAND_CHOICES.find(b => b.id === rankCtx.brandId) || {}).name || '') : '';
  const eventListAll = lotEventChoicesForUnpairedDraw({ brandName, title: rankCtx.title, drawDate: rankCtx.drawDate });
  const eventList = eventListAll.filter(ev => !q || (ev.title || '').toLowerCase().includes(q));

  let html = '<option value="">（不綁）</option>';
  const parts = selectedValue ? String(selectedValue).split(':') : ['', ''];
  const selKind = parts[0], selId = parts[1];
  if (selKind === 'acct' && selId && !acctList.some(t => t.acctId === selId)) {
    const cur = lotTeamByAcctId(selId);
    if (cur) html += '<option value="acct:' + lotEscapeHtml(selId) + '" selected>' + lotEscapeHtml(lotAcctTeamOptionLabel(cur)) + '</option>';
  } else if (selKind === 'event' && selId && !eventList.some(ev => ev.eventId === selId)) {
    const cur = lotEventChoiceById(selId);
    const label = cur ? (lotFmtEventRangeYMD(cur.startDate, cur.endDate) + ' ' + (cur.title || '')) : ((ctx && ctx.eventTitle) || selId);
    html += '<option value="event:' + lotEscapeHtml(selId) + '" selected>' + lotEscapeHtml(label) + '</option>';
  }
  if (acctList.length) {
    html += '<optgroup label="已建帳務">' + acctList.map(t =>
      '<option value="acct:' + lotEscapeHtml(t.acctId) + '">' + lotEscapeHtml(lotAcctTeamOptionLabel(t)) + '</option>'
    ).join('') + '</optgroup>';
  }
  if (eventList.length) {
    html += '<optgroup label="尚未建帳務（行事曆）">' + eventList.map(ev =>
      '<option value="event:' + lotEscapeHtml(ev.eventId) + '">' + lotEscapeHtml(lotFmtEventRangeYMD(ev.startDate, ev.endDate)) + ' ' + lotEscapeHtml(ev.title || '') + '</option>'
    ).join('') + '</optgroup>';
  }
  sel.innerHTML = html;
  if (selectedValue) sel.value = selectedValue;
}
document.getElementById('lotDrawSectionSelect').addEventListener('change', lotSyncDrawSectionUI);
document.getElementById('lotDrawAcctSearchInput').addEventListener('input', function () {
  lotFillDrawAcctSelect(this.value, document.getElementById('lotDrawAcctSelect').value);
});
document.getElementById('lotDrawAcctSelect').addEventListener('change', function () {
  const val = this.value;
  if (!val) return;
  const parts = val.split(':');
  const kind = parts[0], id = parts[1];
  if (kind === 'acct') {
    const team = lotTeamByAcctId(id);
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
  } else if (kind === 'event') {
    const ev = lotEventChoiceById(id);
    if (ev && ev.title) document.getElementById('lotDrawTitleInput').value = ev.title;
  }
  lotSyncDrawTitleUI();
});

// ===== 新增抽獎：得獎人快速輸入列（獎品＋得獎人，狀態固定待聯絡）=====
// 獎品欄預帶目前「活動獎品」欄位的值；沒有手動指定 prize（data.prize 空）時標記 data-auto=1，
// 之後活動獎品欄改了會同步跟著改，使用者一旦直接編輯這一列的獎品欄就解除同步（見下面的 input 監聽）。
function addLotWinnerFormRow(data) {
  const wrap = document.getElementById('lotWinnerRows');
  const row = document.createElement('div');
  row.className = 'lot-winner-row';

  const drawPrize = document.getElementById('lotDrawPrizeInput').value.trim();
  const explicitPrize = data && data.prize;

  const prize = document.createElement('input');
  prize.type = 'text';
  prize.className = 'lot-row-prize';
  prize.placeholder = '獎品';
  prize.value = explicitPrize || drawPrize || '';
  if (!explicitPrize) row.dataset.auto = '1';
  prize.addEventListener('input', () => { delete row.dataset.auto; });
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
// 活動獎品欄一改，所有還沒被手動接管過（data-auto=1）的列跟著同步
document.getElementById('lotDrawPrizeInput').addEventListener('input', function () {
  const val = this.value;
  document.querySelectorAll('#lotWinnerRows .lot-winner-row').forEach(row => {
    if (row.dataset.auto === '1') {
      const input = row.querySelector('.lot-row-prize');
      if (input) input.value = val;
    }
  });
});
function collectLotWinnerFormRows() {
  const drawPrize = document.getElementById('lotDrawPrizeInput').value.trim();
  return Array.from(document.querySelectorAll('#lotWinnerRows .lot-winner-row')).map(row => ({
    prize: row.querySelector('.lot-row-prize').value.trim() || drawPrize,
    winnerHandle: row.querySelector('.lot-row-handle').value.trim()
  })).filter(r => r.prize);
}

document.getElementById('lotAddWinnerRowBtn').addEventListener('click', () => addLotWinnerFormRow(null));
document.getElementById('lotPasteToggleBtn').addEventListener('click', () => {
  const box = document.getElementById('lotPasteBox');
  box.style.display = box.style.display === 'none' ? '' : 'none';
});
// 貼上模式拆行規則：一行一位，「獎品」與「得獎人」用 Tab／全形空白／連續兩個以上半形空白隔開，
// 前段當獎品、後段當得獎人；沒有分隔（整行只有得獎人）也接受，獎品用活動獎品欄（見 addLotWinnerFormRow）。
document.getElementById('lotPasteParseBtn').addEventListener('click', () => {
  const raw = document.getElementById('lotPasteArea').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let ok = 0;
  lines.forEach(line => {
    const m = line.match(/^(.*?)(?:\t+|　+| {2,})(.+)$/);
    if (m) {
      addLotWinnerFormRow({ prize: m[1].trim(), winnerHandle: m[2].trim() });
    } else {
      addLotWinnerFormRow({ winnerHandle: line });
    }
    ok++;
  });
  document.getElementById('lotPasteParseStatus').textContent = ok ? ('已加入 ' + ok + ' 列') : '沒有內容可解析';
  if (ok) document.getElementById('lotPasteArea').value = '';
});

document.getElementById('lotDrawSaveBtn').addEventListener('click', async () => {
  const section = document.getElementById('lotDrawSectionSelect').value || 'groupbuy';
  // 團購分區且沒點過「改」＝標題交給後端自動產生（不送 title 欄位）；非團購／特殊分區照舊必填
  const titleTouched = section !== 'groupbuy' || LOT_DRAW_TITLE_OVERRIDE;
  let title = '';
  if (titleTouched) {
    title = document.getElementById('lotDrawTitleInput').value.trim();
    if (section !== 'groupbuy' && !title) { lotSetStatus('lotDrawFormStatus', '請填寫活動標題', 'error'); return; }
  }
  const prize = document.getElementById('lotDrawPrizeInput').value.trim();
  if (!prize) { lotSetStatus('lotDrawFormStatus', '請填寫獎品', 'error'); return; }

  const teamVal = document.getElementById('lotDrawAcctSelect').value || '';
  const teamParts = teamVal ? teamVal.split(':') : ['', ''];
  const teamKind = teamParts[0], teamId = teamParts[1];
  const cashAmountRaw = document.getElementById('lotDrawCashAmountInput').value;

  const payload = {
    section,
    acctId: section === 'groupbuy' && teamKind === 'acct' ? teamId : null,
    eventId: section === 'groupbuy' && teamKind === 'event' ? teamId : '',
    brandId: document.getElementById('lotDrawBrandSelect').value || null,
    drawDate: document.getElementById('lotDrawDateInput').value || null,
    dateUncertain: document.getElementById('lotDrawDateUncertain').checked,
    shipBy: document.getElementById('lotDrawShipBySelect').value,
    note: document.getElementById('lotDrawNoteInput').value.trim(),
    prizeType: document.getElementById('lotDrawPrizeTypeSelect').value || 'physical',
    prize,
    cashAmount: cashAmountRaw.trim() === '' ? null : cashAmountRaw.trim()
  };
  if (titleTouched) payload.title = title;
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
// 表單欄位依所屬活動的獎品類型變化：cash＝金額＋匯款帳戶、physical＝電話地址運費、virtual＝email（點 7）
function lotSyncWinnerModalFields(prizeType) {
  const cashGroup = document.getElementById('lotWinnerCashGroup');
  const physicalGroup = document.getElementById('lotWinnerPhysicalGroup');
  const virtualGroup = document.getElementById('lotWinnerVirtualGroup');
  if (cashGroup) cashGroup.style.display = prizeType === 'cash' ? '' : 'none';
  if (physicalGroup) physicalGroup.style.display = prizeType === 'physical' ? '' : 'none';
  if (virtualGroup) virtualGroup.style.display = prizeType === 'virtual' ? '' : 'none';
  const shippedLabel = document.getElementById('lotWinnerShippedAtLabel');
  if (shippedLabel) shippedLabel.textContent = prizeType === 'cash' ? '匯款日' : (prizeType === 'virtual' ? '發送日' : '寄出日');
  const statusSel = document.getElementById('lotWinnerStatusSel');
  if (statusSel) Array.from(statusSel.options).forEach(opt => { opt.textContent = lotStatusLabel(opt.value, prizeType); });
}
function openLotteryWinnerModal(drawId, winner) {
  LOTTERY_WINNER_EDIT = { drawId, winnerId: winner ? winner.id : null };
  const draw = LOTTERY_DRAWS.find(d => d.id === drawId);
  const drawType = (draw && draw.prizeType) || 'physical';
  const typeSel = document.getElementById('lotWinnerPrizeTypeSel');
  if (typeSel) {
    typeSel.value = (winner && winner.prizeType) || '';
    typeSel.options[0].textContent = '跟活動一樣（' + (LOT_PRIZE_TYPE_LABEL[drawType] || '') + '）';
    typeSel.onchange = () => lotSyncWinnerModalFields(typeSel.value || drawType);
  }
  const typeWarn = document.getElementById('lotWinnerTypeReadyWarn');
  if (typeWarn) typeWarn.style.display = LOTTERY_WINNER_TYPE_READY ? 'none' : '';
  const prizeType = lotWinnerType(winner, drawType);
  document.getElementById('lotWinnerModalTitle').textContent = winner ? '編輯得獎人' : '新增得獎人';
  document.getElementById('lotWinnerDeleteBtn').style.display = winner ? 'inline-block' : 'none';
  const readyWarn = document.getElementById('lotWinnerPrizeReadyWarn');
  if (readyWarn) readyWarn.style.display = LOTTERY_PRIZE_READY ? 'none' : '';
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('lotWinnerPrizeInput', winner ? winner.prize : ((draw && draw.prize) || ''));
  v('lotWinnerHandleInput', winner ? winner.winnerHandle : '');
  document.getElementById('lotWinnerStatusSel').value = winner ? winner.status : 'pending';
  v('lotWinnerNameInput', winner ? winner.name : '');
  v('lotWinnerPhoneInput', winner ? winner.phone : '');
  v('lotWinnerAddressInput', winner ? winner.address : '');
  v('lotWinnerZipInput', winner ? winner.zip : '');
  v('lotWinnerOrderNoInput', winner ? winner.orderNo : '');
  v('lotWinnerShippingFeeInput', winner ? winner.shippingFee : '');
  v('lotWinnerShippedAtInput', winner ? winner.shippedAt : '');
  v('lotWinnerSponsorNoteInput', winner ? winner.sponsorNote : '');
  v('lotWinnerMemoInput', winner ? winner.memo : '');
  v('lotWinnerCashAmountInput', winner ? winner.cashAmount : ((!winner && draw) ? draw.cashAmount : ''));
  v('lotWinnerAccountNameInput', winner ? winner.accountName : '');
  v('lotWinnerBankNameInput', winner ? winner.bankName : '');
  v('lotWinnerBankCodeInput', winner ? winner.bankCode : '');
  v('lotWinnerBankBranchInput', winner ? winner.bankBranch : '');
  v('lotWinnerBankAccountInput', winner ? winner.bankAccount : '');
  v('lotWinnerEmailInput', winner ? winner.email : '');
  lotSyncWinnerModalFields(prizeType);
  lotSetStatus('lotWinnerFormStatus', '', '');
  document.getElementById('lotteryWinnerModal').classList.add('show');
}
function closeLotteryWinnerModal() {
  document.getElementById('lotteryWinnerModal').classList.remove('show');
  LOTTERY_WINNER_EDIT = null;
}

document.getElementById('lotWinnerSaveBtn').addEventListener('click', async () => {
  if (!LOTTERY_WINNER_EDIT) return;
  const draw = LOTTERY_DRAWS.find(d => d.id === LOTTERY_WINNER_EDIT.drawId);
  const typeSelVal = (document.getElementById('lotWinnerPrizeTypeSel') || {}).value || '';
  const prizeType = typeSelVal || ((draw && draw.prizeType) || 'physical');
  const prize = document.getElementById('lotWinnerPrizeInput').value.trim();
  if (!prize) { lotSetStatus('lotWinnerFormStatus', '請填寫獎品', 'error'); return; }
  const payload = {
    drawId: LOTTERY_WINNER_EDIT.drawId,
    prize,
    winnerHandle: document.getElementById('lotWinnerHandleInput').value.trim(),
    status: document.getElementById('lotWinnerStatusSel').value,
    name: document.getElementById('lotWinnerNameInput').value.trim(),
    orderNo: document.getElementById('lotWinnerOrderNoInput').value.trim(),
    shippedAt: document.getElementById('lotWinnerShippedAtInput').value || null,
    sponsorNote: document.getElementById('lotWinnerSponsorNoteInput').value.trim(),
    memo: document.getElementById('lotWinnerMemoInput').value.trim(),
    prizeType: typeSelVal // ''＝跟活動
  };
  // 只送該類型有顯示的欄位（partial）
  if (prizeType === 'cash') {
    const amt = document.getElementById('lotWinnerCashAmountInput').value;
    payload.cashAmount = amt.trim() === '' ? null : amt.trim();
    payload.accountName = document.getElementById('lotWinnerAccountNameInput').value.trim();
    payload.bankName = document.getElementById('lotWinnerBankNameInput').value.trim();
    payload.bankCode = document.getElementById('lotWinnerBankCodeInput').value.trim();
    payload.bankBranch = document.getElementById('lotWinnerBankBranchInput').value.trim();
    payload.bankAccount = document.getElementById('lotWinnerBankAccountInput').value.trim();
  } else if (prizeType === 'virtual') {
    payload.email = document.getElementById('lotWinnerEmailInput').value.trim();
  } else {
    payload.phone = document.getElementById('lotWinnerPhoneInput').value.trim();
    payload.address = document.getElementById('lotWinnerAddressInput').value.trim();
    payload.zip = document.getElementById('lotWinnerZipInput').value.trim();
    payload.shippingFee = document.getElementById('lotWinnerShippingFeeInput').value.trim();
  }
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
