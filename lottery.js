// ===================================================================
// lottery.js — 抽獎管理（獨立分頁 #viewLottery，2026-10-10 恢復；抽獎活動＋得獎人）
// 設計正本：dondon-platform/docs/16-lottery-redesign.md（三大類＋小類、連團以行事曆團為主、待抽吃 pendingEvents）。
// 帳務頁只在使用者有 lotteryEdit 時於背景呼叫 loadLotteryView()，讓明細列 🎁 小標有資料。
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 accounting.js／subscriptions.js／
// books.js）。理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好
// 停在 lottery（或 accounting）、本檔卻排在後面，開機當下 loadLotteryView 還不存在，整頁變磚。
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
let LOTTERY_EVENT_CHOICES = []; // 全部行事曆團購（docs/16 §6.2：含已建帳務的，多 acctId／legacyId），data.eventChoices（舊後端沒有時＝[]）
let LOTTERY_SUBTYPE_READY = true;       // 後端 subtypeReady===false（欄位未 db push）才 false
let LOTTERY_EVENT_NL_READY = true;      // 後端 eventNoLotteryReady===false（events.no_lottery 未 db push）才 false
let LOTTERY_PENDING_EVENTS_READY = true; // 後端 pendingEventsReady===false＝行事曆查詢失敗，待抽暫時算不出來
let LOTTERY_PENDING_EVENTS = [];        // data.pendingEvents（舊後端沒有時＝[]）
let LOTTERY_NO_LOTTERY_EVENTS = [];     // data.noLotteryEvents（舊後端沒有時＝[]）
let LOTTERY_QUOTA_READY = true;         // 後端 quotaReady===false（lottery_draws.quota 未 db push）才 false；舊後端沒這個 key＝視同 true
let LOT_DATA_CHANGED_CBS = [];          // 每次 loadLotteryView 成功後呼叫（行事曆視窗的抽獎區塊重畫用）
let LOTTERY_CAN_EDIT = true;       // hasEditPerm('lotteryEdit') 的快取，每次載入/渲染時重算
let LOTTERY_VIEW = 'cards';        // 'cards'｜'todo'
let LOTTERY_FILTER = { status: 'all', brand: '', year: null, q: '', subtype: lotLoadSubtypeFilter() }; // year=null＝還沒套「預設今年」；subtype ''＝全部｜'none'＝未分類｜其餘＝小類代碼
let LOTTERY_SHOW_NO_LOTTERY = false; // 篩選列「已標不抽」顯示開關（預設隱藏，docs/09 §11.4）
// 小類篩選記 localStorage（key lottery_subtype_filter）；讀寫都 try/catch，被擋也不影響畫面
function lotLoadSubtypeFilter() {
  try { return localStorage.getItem('lottery_subtype_filter') || ''; } catch (e) { return ''; }
}
function lotSaveSubtypeFilter(v) {
  try { localStorage.setItem('lottery_subtype_filter', v || ''); } catch (e) {}
}
// （舊）「未開團／帳務未建」區預設收合（跟其餘三區不同，其餘預設展開），狀態存 localStorage
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
// ===== 抽獎管理頂端切換「抽獎｜特殊活動」（docs/16 §8）=====
// activitiesReady 缺 key 或 false＝後端還沒部署／表未 push：特殊活動分頁只顯示提示＋扁平清單，抽獎分頁保留原本的特殊活動分區（完全退回現況）。
let LOTTERY_CAMPAIGN_READY = false; // 第 4 期 4a：資格規則／獎品清單／登記截止／指定團／資格預覽
let LOTTERY_ACTIVITIES_READY = false;
let LOTTERY_ACTIVITIES = [];
function lotLoadMainTab() {
  try { return localStorage.getItem('lottery_main_tab') === 'activities' ? 'activities' : 'draws'; } catch (e) { return 'draws'; }
}
function lotSaveMainTab(v) {
  try { localStorage.setItem('lottery_main_tab', v); } catch (e) {}
}
let LOTTERY_MAIN_TAB = lotLoadMainTab();   // 'draws'｜'activities'
function lotActivitiesTabOn() { return LOTTERY_MAIN_TAB === 'activities'; }
// 活動卡展開狀態（預設收合），key lottery_activity_open：{ <activityId>: true }
function lotLoadActivityOpen() {
  try {
    const o = JSON.parse(localStorage.getItem('lottery_activity_open') || '{}');
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (e) { return {}; }
}
function lotSaveActivityOpen() {
  try { localStorage.setItem('lottery_activity_open', JSON.stringify(LOTTERY_ACTIVITY_OPEN)); } catch (e) {}
}
let LOTTERY_ACTIVITY_OPEN = lotLoadActivityOpen();
let LOTTERY_ACTIVITY_TEXT_OPEN = {};       // 介紹／規則「展開」狀態（不存 localStorage）
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
// awaiting_announce（雪莉 09-29 新增）：錢/東西已經匯出去或寄出去了，但抽獎結果還沒公告——
// 介於「廠商寄送中/待寄出」跟「已完成」之間，要等公告完才手動轉「已完成」，不能一寄出/匯款就自動算完成。
const LOT_STATUS_LABEL = {
  pending: '待聯絡', awaiting_info: '待回填資料', info_ready: '待寄出',
  handed_to_vendor: '廠商寄送中', awaiting_announce: '已完成（待公告）', done: '已完成', redrawn: '已重抽', forfeited: '已放棄'
};
const LOT_STATUS_ORDER = ['pending', 'awaiting_info', 'info_ready', 'handed_to_vendor', 'awaiting_announce', 'done', 'redrawn', 'forfeited'];
// 「結束態」＝不算待處理、不算完成的狀態（已重抽／已放棄）：進度、待辦、隱藏已完成都把它們排除
const LOT_CLOSED = ['redrawn', 'forfeited'];
function lotIsClosed(w) { return LOT_CLOSED.indexOf(w.status) !== -1; }
function lotIsSettled(w) { return w.status === 'done' || lotIsClosed(w); }
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
// 顯示名稱（2026-10-10 docs/16）：值不變，只改文字
const LOT_SECTION_LABEL = { groupbuy: '綁團', non_groupbuy: '一般', special: '特殊活動' };
// 小類（固定選單，不給自由打字）：依大類不同；特殊活動沒有小類
const LOT_SUBTYPE_LABEL = { order: '下單抽', post: '貼文抽', trial: '試用抽', bonus: '加碼抽', calendar: '每月行事曆', other: '其它' };
const LOT_SUBTYPES_BY_SECTION = {
  groupbuy: ['order', 'post', 'trial', 'bonus'],
  non_groupbuy: ['post', 'calendar', 'bonus', 'other'],
  special: []
};
// 一場抽獎的小類代碼（''＝未分類；特殊活動恆 ''）
function lotDrawSubtype(d) { return (d && d.section !== 'special' && d.subtype) ? d.subtype : ''; }
// 小類小膠囊（標題旁）：綁團／一般且沒小類＝灰色「未分類」；特殊活動不顯示；欄位未 push（舊後端）不顯示
function lotSubtypePillHtml(d) {
  if (!LOTTERY_SUBTYPE_READY || !d || d.section === 'special') return '';
  const st = lotDrawSubtype(d);
  return st
    ? '<span class="lot-subtype-pill">' + lotEscapeHtml(LOT_SUBTYPE_LABEL[st] || st) + '</span>'
    : '<span class="lot-subtype-pill none">未分類</span>';
}
// 一組抽獎（團列用）：去重後的小膠囊
function lotSubtypePillsForDraws(draws) {
  if (!LOTTERY_SUBTYPE_READY) return '';
  const seen = {};
  return (draws || []).map(d => {
    if (!d || d.section === 'special') return '';
    const k = lotDrawSubtype(d) || '__none';
    if (seen[k]) return '';
    seen[k] = 1;
    return lotSubtypePillHtml(d);
  }).join('');
}
// 目前小類篩選是否放行這場（與其他篩選 AND）
function lotSubtypeFilterOk(d) {
  const f = LOTTERY_FILTER.subtype;
  if (!f || !LOTTERY_SUBTYPE_READY) return true;
  if (f === 'none') return !!d && d.section !== 'special' && !lotDrawSubtype(d);
  return lotDrawSubtype(d) === f;
}
// 篩選 chips：待聯絡刻意不列（原本設計就只有這六顆）；待抽／待配對是分區虛擬狀態，一併放進 chip 方便直接篩。
const LOT_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: 'pending_draw', label: '待抽' },
  { key: 'awaiting_info', label: '待回填' },
  { key: 'info_ready', label: '待寄出' },
  { key: 'handed_to_vendor', label: '廠商寄送中' },
  { key: 'awaiting_announce', label: '已完成（待公告）' },
  { key: 'done', label: '已完成' },
  { key: 'redrawn', label: '已重抽' },
  { key: 'forfeited', label: '已放棄' },
  { key: 'unpaired', label: '待配對' }
];
// 待辦清單視圖不含已完成/已重抽/待抽/待配對（本來就篩掉了），chips 只留跟它相關的五顆
const LOT_TODO_CHIPS = ['all', 'awaiting_info', 'info_ready', 'handed_to_vendor', 'awaiting_announce'];

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

// ===== 訂單編號 ↔ 訂單庫對照（2026-10-03，docs/09 §13）=====
// 抽出來就先填訂單編號：後端 GET 每位得獎人帶 order（對到的訂單｜null＝訂單庫沒有），
// 表單輸入時另打 lottery-order-lookup 即時核對是不是這團的訂單。
let LOTTERY_ORDERS_READY = true; // 後端對照查詢失敗（或舊後端沒這個欄位）時 false＝只顯示編號、不顯示核對結果
function lotMoney(n) { return '$' + Number(n || 0).toLocaleString('en-US'); }
// 核對結果一行字：這團已付款訂單＝綠、別團或未付款＝警示色、訂單庫沒有＝淡字
function lotOrderInfoHtml(order) {
  if (!order) return '<span class="lot-ord lot-ord-none">訂單庫沒有這筆（還沒收單，或編號打錯）</span>';
  const parts = [order.customerName, lotMoney(order.amount), order.statusLabel, order.memberNo ? '會員 ' + order.memberNo : '']
    .filter(Boolean).map(lotEscapeHtml).join('・');
  if (order.sameTeam === false) {
    return '<span class="lot-ord lot-ord-warn">不是這團的訂單' + (order.teamTitle ? '（' + lotEscapeHtml(order.teamTitle) + '）' : '') + '：' + parts + '</span>';
  }
  return '<span class="lot-ord ' + (order.paid ? 'lot-ord-ok' : 'lot-ord-warn') + '">' + (order.paid ? lotIcon('check') : '') + parts + '</span>';
}
// 輸入框即時核對：停手 500ms 後查，結果寫進 hintEl；過期的回應丟棄。getCtx 回 {drawId}｜{acctId}｜{eventId}｜{}
function lotBindOrderLookup(input, hintEl, getCtx) {
  let timer = null, seq = 0;
  const run = () => {
    const val = input.value.trim();
    const mySeq = ++seq;
    if (!/[A-Za-z0-9]{8,}/.test(val)) { hintEl.innerHTML = ''; return; } // 空的或還沒打完，不查
    hintEl.innerHTML = '<span class="lot-ord lot-ord-none">核對中…</span>';
    lotApiPost('lottery-order-lookup', Object.assign({ orderNos: [val] }, getCtx() || {})).then(res => {
      if (mySeq !== seq) return;
      const r = res && res.success ? (res.results || [])[0] : null;
      hintEl.innerHTML = r ? lotOrderInfoHtml(r.order) : '';
    }).catch(() => { if (mySeq === seq) hintEl.innerHTML = ''; });
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 500); });
  input._lotLookup = () => { clearTimeout(timer); run(); };
  input._lotLookupCancel = () => { clearTimeout(timer); seq++; }; // 作廢排程中／在途的查詢（視窗換人時用）
}
// 這段文字裡有沒有像訂單編號的片段（8 碼以上英數、至少 6 個數字）；貼上模式用來分辨哪一段是訂單編號
function lotLooksLikeOrderNo(text) {
  return String(text || '').split(/[^A-Za-z0-9]+/).some(t => t.length >= 8 && (t.match(/\d/g) || []).length >= 6);
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
// 卡頭日期顯示（欄位名 drawDate，但實際多是開團日／月份估算，畫面一律叫「日期」）：日期確定＝完整「日期 YYYY-MM-DD」；不確定（估算值）＝只到月「約 YYYY年M月 ⚠」
function lotFmtDrawDate(draw) {
  if (!draw.drawDate) return '';
  if (draw.dateUncertain) return '約 ' + lotFmtYM(draw.drawDate) + '（估）';
  return '日期 ' + draw.drawDate; // 2026-10-10 改名：這欄實際多是開團日或月份估算，不一定是抽獎日
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
// 這個函式同時服務兩種呼叫端：①使用者點開「抽獎管理」分頁（admin.js switchView('lottery')）
// ②進帳務頁時預抓一次給帳務明細列的抽獎狀態小標用（admin.js switchView('accounting')，需 lotteryEdit）。
// 兩邊同時觸發時共用同一個請求（LOTTERY_LOAD_PROMISE），成功後一律完整重繪 #viewLottery 的 DOM——
// 反正 lotBody 等元素不管分頁有沒有被打開都存在（只是 .view 沒顯示），
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
    LOTTERY_ORDERS_READY = data.ordersReady === true; // 訂單編號對照（舊後端沒這個 key＝不顯示核對結果）
    LOTTERY_TODAY = data.today || lotToday();
    LOTTERY_ACCT_TEAMS = Array.isArray(data.acctTeams) ? data.acctTeams : [];
    LOTTERY_DRAWS = Array.isArray(data.draws) ? data.draws : [];
    LOTTERY_STATS = data.stats || {};
    LOTTERY_BRAND_CHOICES = Array.isArray(data.brandChoices) ? data.brandChoices : [];
    LOTTERY_EVENT_CHOICES = Array.isArray(data.eventChoices) ? data.eventChoices : [];
    LOTTERY_SUBTYPE_READY = data.subtypeReady !== false;            // 舊後端沒有這個 key＝視同 true（小類 UI 照常，後端若不認小類欄位會自己擋）
    LOTTERY_EVENT_NL_READY = data.eventNoLotteryReady !== false;
    LOTTERY_PENDING_EVENTS_READY = data.pendingEventsReady !== false;
    LOTTERY_PENDING_EVENTS = Array.isArray(data.pendingEvents) ? data.pendingEvents : [];
    LOTTERY_NO_LOTTERY_EVENTS = Array.isArray(data.noLotteryEvents) ? data.noLotteryEvents : [];
    LOTTERY_QUOTA_READY = data.quotaReady !== false;
    LOTTERY_ACTIVITIES_READY = data.activitiesReady === true && Array.isArray(data.activities); // 缺 key＝視同 false（退回現況）
    LOTTERY_ACTIVITIES = LOTTERY_ACTIVITIES_READY ? data.activities : [];
    LOTTERY_CAMPAIGN_READY = LOTTERY_ACTIVITIES_READY && data.campaignReady === true; // 第 4 期（缺 key／false＝新功能整組隱藏）
    lotSyncMainTabUI();
    // 小類篩選若記著的值在欄位未 push 時沒意義，重置
    if (!LOTTERY_SUBTYPE_READY) LOTTERY_FILTER.subtype = '';
    // 帳務年份篩選預設今年，只套用一次（之後使用者自己改就不要再洗掉）
    if (LOTTERY_FILTER.year === null) LOTTERY_FILTER.year = String(new Date().getFullYear());
    LOTTERY_CAN_EDIT = typeof hasEditPerm !== 'function' || hasEditPerm('lotteryEdit');
    const addBtn = document.getElementById('lotAddDrawBtn');
    if (addBtn) addBtn.style.display = (LOTTERY_CAN_EDIT && LOTTERY_TABLE_READY) ? '' : 'none';

    // 行事曆檢視／編輯視窗裡的抽獎區塊跟著新資料重畫（各 callback 自己 try/catch，不影響抽獎頁）
    LOT_DATA_CHANGED_CBS.forEach(cb => { try { cb(); } catch (e) {} });
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
  const note = txt => '<div style="background:#F5EFE9; border:1px solid transparent; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' + txt + '</div>';
  if (!LOTTERY_TABLE_READY) {
    box.innerHTML = note('抽獎資料表尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。');
    return;
  }
  const parts = [];
  if (!LOTTERY_ACCT_READY) {
    parts.push(note('抽獎掛帳務團所需的欄位（acct_id／section／no_lottery）尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。' +
      '目前綁定帳務團、分區、「這團不抽」都先關閉，其他功能（新增得獎人、改狀態…）不受影響。'));
  }
  // docs/16 第 1 期 migration（20261010210000）：小類 subtype／行事曆「這團不抽」events.no_lottery
  if (!LOTTERY_SUBTYPE_READY) {
    parts.push(note('小類欄位待 db push（20261010210000_lottery_entity_subtype）：目前先不顯示、也不能選小類，其他功能照常。'));
  }
  if (!LOTTERY_PENDING_EVENTS_READY) {
    parts.push(note('待抽提醒暫時算不出來，請稍後按重新整理'));
  }
  if (!LOTTERY_EVENT_NL_READY) {
    parts.push(note('行事曆「這團不抽」欄位待 db push（20261010210000_lottery_entity_subtype）：行事曆團的「這團不抽」暫時不能用。'));
  }
  box.innerHTML = parts.join('');
}

// ===== 摘要磚（點磚套篩選）=====
function renderLotteryTiles() {
  const box = document.getElementById('lotTiles');
  if (!box) return;
  const s = Object.assign({}, LOTTERY_STATS || {});
  const actTab = lotActivitiesTabOn();
  // 特殊活動有自己的分頁後（2026-10-10 第 3 期）：得獎人狀態磚只算「目前分頁看得到的抽獎」，
  // 否則抽獎分頁的磚會含特殊活動得獎人、點下去卻看不到（驗收抓到）。未就緒時照舊用後端全量統計。
  if (LOTTERY_ACTIVITIES_READY) {
    const inTab = d => !d.archived && (actTab ? d.section === 'special' : d.section !== 'special');
    const cnt = st => LOTTERY_DRAWS.filter(inTab).reduce((n, d) => n + (d.winners || []).filter(w => w.status === st).length, 0);
    s.awaitingInfo = cnt('awaiting_info'); s.infoReady = cnt('info_ready');
    s.handedToVendor = cnt('handed_to_vendor'); s.awaitingAnnounce = cnt('awaiting_announce');
  }
  const tile = (key, cls, n, label) =>
    '<div class="lot-tile ' + cls + (LOTTERY_FILTER.status === key ? ' on' : '') + '" data-tile="' + key + '">' +
    '<div class="lot-tile-n">' + (n || 0) + '</div><div class="lot-tile-l">' + label + '</div></div>';
  box.innerHTML =
    '<div class="lot-tiles-grid">' +
      tile('awaiting_info', 'await', s.awaitingInfo, '待回填資料') +
      tile('info_ready', 'ready', s.infoReady, '待寄出') +
      tile('handed_to_vendor', 'vendor', s.handedToVendor, '廠商寄送中') +
      tile('awaiting_announce', 'announce', s.awaitingAnnounce, '待公告') +
      (actTab ? '' : // 待抽／待配對只跟綁團有關，特殊活動分頁不顯示
        tile('pending_draw', 'pending', s.awaitingDraw, '待抽') +
        tile('unpaired', 'unpaired', s.unpaired, '待配對')) +
    '</div>';
  box.querySelectorAll('.lot-tile').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.tile;
      LOTTERY_FILTER.status = (LOTTERY_FILTER.status === key) ? 'all' : key;
      // 摘要磚的數字是「全部年份」算的，點磚要一起把年份切回全部，不然舊年度的待辦會被預設今年篩掉＝點了是空的（曾曾 10/9 回報）
      if (LOTTERY_FILTER.status !== 'all') LOTTERY_FILTER.year = '';
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
}

// ===== 篩選列 =====
function renderLotteryFilters() {
  const box = document.getElementById('lotFilters');
  if (!box) return;
  const chipKeys = LOTTERY_VIEW === 'todo' ? LOT_TODO_CHIPS : LOT_FILTER_CHIPS.map(c => c.key);
  const actTab = lotActivitiesTabOn();
  const chipsHtml = LOT_FILTER_CHIPS.filter(c => chipKeys.indexOf(c.key) !== -1 && !(actTab && ['pending_draw', 'unpaired', 'unopened'].indexOf(c.key) !== -1)).map(c =>
    '<span class="lot-status-chip' + (LOTTERY_FILTER.status === c.key ? ' on' : '') + '" data-chip="' + c.key + '">' + c.label + '</span>'
  ).join('');

  // 年份下拉只影響「綁團」那一區（依團的日期：帳務開團日／行事曆開團日）；只列實際出現過的年份
  const years = Array.from(new Set(
    LOTTERY_ACCT_TEAMS.map(t => String(t.recordDate || '').slice(0, 4))
      .concat(LOTTERY_DRAWS.map(d => String(d.teamDate || '').slice(0, 4)))
      .concat(LOTTERY_PENDING_EVENTS.map(e => String(e.startDate || '').slice(0, 4)))
      .concat(LOTTERY_NO_LOTTERY_EVENTS.map(e => String(e.startDate || '').slice(0, 4)))
      .filter(Boolean))).sort().reverse();
  // 小類篩選（全部／各小類／未分類）；欄位未 push 時整個不顯示
  const subtypeOptions = '<option value="">小類：全部</option>' +
    ['order', 'post', 'trial', 'bonus', 'calendar', 'other'].map(k => '<option value="' + k + '"' + (LOTTERY_FILTER.subtype === k ? ' selected' : '') + '>' + LOT_SUBTYPE_LABEL[k] + '</option>').join('') +
    '<option value="none"' + (LOTTERY_FILTER.subtype === 'none' ? ' selected' : '') + '>未分類</option>';
  const yearOptions = '<option value="">帳務年份：全部</option>' + years.map(y => '<option value="' + y + '"' + (LOTTERY_FILTER.year === y ? ' selected' : '') + '>' + y + ' 年</option>').join('');
  const brandOptions = '<option value="">品牌：全部</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '"' + (LOTTERY_FILTER.brand === b.id ? ' selected' : '') + '>' + lotEscapeHtml(b.name) + '</option>'
  ).join('');

  const noLotteryCount = LOTTERY_ACCT_TEAMS.filter(t => t.noLottery && !lotDrawsForAcct(t.acctId).length).length + LOTTERY_NO_LOTTERY_EVENTS.length;
  const showToggleHtml = (LOTTERY_VIEW === 'cards' && !actTab)
    ? '<span class="lot-toggle-chip' + (LOTTERY_SHOW_NO_LOTTERY ? ' on' : '') + '" id="lotShowNoLotteryToggle">已標不抽（' + noLotteryCount + '）</span>'
    : '';
  const hideDoneCount = (LOTTERY_VIEW === 'cards' || actTab) ? lotComputeHideDoneCount() : 0;
  const hideDoneToggleHtml = (LOTTERY_VIEW === 'cards' || actTab)
    ? '<span class="lot-toggle-chip' + (LOTTERY_HIDE_DONE ? ' on' : '') + '" id="lotHideDoneToggle">隱藏已完成（' + hideDoneCount + '）</span>'
    : '';

  box.innerHTML =
    chipsHtml +
    '<select id="lotBrandSelect">' + brandOptions + '</select>' +
    (LOTTERY_SUBTYPE_READY ? '<select id="lotSubtypeSelect">' + subtypeOptions + '</select>' : '') +
    ((LOTTERY_VIEW === 'cards' && !actTab) ? '<select id="lotYearSelect">' + yearOptions + '</select>' : '') +
    '<input type="text" id="lotSearchInput" placeholder="搜尋 R號／團名／獎品／得獎人／姓名／訂單編號" value="' + lotEscapeHtml(LOTTERY_FILTER.q) + '">' +
    (actTab ? '' : '<div class="lot-seg"><span class="' + (LOTTERY_VIEW === 'cards' ? 'on' : '') + '" data-seg="cards">依分區</span><span class="' + (LOTTERY_VIEW === 'todo' ? 'on' : '') + '" data-seg="todo">待辦清單</span></div>') +
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
  const subtypeSel = document.getElementById('lotSubtypeSelect');
  if (subtypeSel) subtypeSel.addEventListener('change', function () {
    LOTTERY_FILTER.subtype = this.value;
    lotSaveSubtypeFilter(this.value);
    renderLotteryFilters(); renderLotteryBody(); // 重畫篩選列以更新「隱藏已完成」數字
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
// 頂端「抽獎｜特殊活動」切換：同步按鈕外觀並綁一次點擊
function lotSyncMainTabUI() {
  const seg = document.getElementById('lotMainSeg');
  if (!seg) return;
  seg.querySelectorAll('[data-main-seg]').forEach(el => el.classList.toggle('on', el.dataset.mainSeg === LOTTERY_MAIN_TAB));
}
(function lotBindMainTab() {
  const seg = document.getElementById('lotMainSeg');
  if (!seg) return;
  seg.querySelectorAll('[data-main-seg]').forEach(el => {
    el.addEventListener('click', () => {
      LOTTERY_MAIN_TAB = el.dataset.mainSeg === 'activities' ? 'activities' : 'draws';
      lotSaveMainTab(LOTTERY_MAIN_TAB);
      lotSyncMainTabUI();
      if (!LOTTERY_LOADED || !LOTTERY_TABLE_READY) return;
      // 「待配對」「待抽」是抽獎分頁專屬；切到特殊活動時先重置，免得篩到空
      if (lotActivitiesTabOn() && (LOTTERY_FILTER.status === 'pending_draw' || LOTTERY_FILTER.status === 'unpaired' || LOTTERY_FILTER.status === 'unopened')) LOTTERY_FILTER.status = 'all';
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
  lotSyncMainTabUI();
})();
// 目前這個畫面該重畫哪一個（分區清單 or 特殊活動頁）；展開／收合列、收合區塊用
function lotRenderMain() {
  if (lotActivitiesTabOn()) renderLotteryActivities();
  else renderLotterySections();
}

function renderLotteryBody() {
  if (lotActivitiesTabOn()) renderLotteryActivities();
  else if (LOTTERY_VIEW === 'todo') renderLotteryTodo();
  else renderLotterySections();
}

// 分區可見性：「待抽」「待配對」是分區專屬的虛擬篩選鍵，切到那個鍵只顯示對應那一區；
// 其餘（全部／各種得獎人狀態）四區都顯示，各區內部再各自過濾。
function lotZoneVisible(key) {
  const s = LOTTERY_FILTER.status;
  if (s === 'unpaired') return key === 'unpaired';
  if (s === 'unopened') return key === 'unopened';
  if (s === 'pending_draw') return key === 'groupbuy';
  // 舊資料（已結案）不算進任何待辦統計，篩選某個狀態時不顯示，免得點了待辦只看到結案歷史（曾曾 10/9 回報）
  if (key === 'archived') return s === 'all';
  return true;
}
function lotSearchQuery() { return LOTTERY_FILTER.q.trim().toLowerCase(); }
function lotWinnerHay(w) {
  return [w.prize, w.winnerHandle, w.name, w.orderNo, w.order && w.order.customerName].map(x => String(x || '')).join(' ').toLowerCase();
}
function lotWinnerStatusFilterOk(w) {
  const s = LOTTERY_FILTER.status;
  if (['awaiting_info', 'info_ready', 'handed_to_vendor', 'awaiting_announce', 'done', 'redrawn', 'forfeited'].indexOf(s) === -1) return true;
  return w.status === s;
}

// ===== 隱藏已完成：一場抽獎「已完成」＝至少 1 位得獎人，且全部得獎人狀態為 done／redrawn =====
function lotDrawCompleted(d) {
  const winners = d.winners || [];
  return winners.length > 0 && winners.every(lotIsSettled);
}
// 搜尋中或直接篩選 done／redrawn 狀態時，隱藏規則失效（不然會篩出空結果）
function lotHideDoneBypassed() {
  return !!lotSearchQuery() || LOTTERY_FILTER.status === 'done' || lotIsClosed({ status: LOTTERY_FILTER.status });
}
function lotHideDoneActive() {
  return LOTTERY_HIDE_DONE && !lotHideDoneBypassed();
}

// ===== 綁團區（docs/16 §6.3）：一個「團」一列 =====
// 分組鍵＝acctId || ('ev:' + eventId)：已連帳務的抽獎依帳務團分組，只連行事曆團（帳務還沒建）的依 eventId 分組，
// 兩種都併在同一區，不再另開「未開團／帳務未建」區。其餘項目：
//   pending       ＝舊邏輯的帳務待抽（沒連行事曆團的舊帳務列，acctTeams[].pendingDraw）
//   nolottery     ＝舊邏輯的帳務「不抽」標記
//   pendingEvent  ＝後端 pendingEvents（行事曆團結團＋14 天還沒抽獎）
//   nolotteryEvent＝後端 noLotteryEvents（行事曆團標了「這團不抽」）
// 後端尚未部署新欄位時 LOTTERY_PENDING_EVENTS／LOTTERY_NO_LOTTERY_EVENTS 都是空陣列＝這兩種列不出現。
function lotEventPseudoTeam(src) {
  return {
    acctId: src.acctId || '', eventId: src.eventId || '', title: src.title || '', recordDate: src.startDate || '',
    brandId: src.brandId || '', brandName: src.brandName || '', legacyId: '', failed: false, noLottery: false, pendingDraw: false, isEventTeam: true
  };
}
function lotItemSortDate(it) {
  if (it.type === 'real') return (it.draws[0] && it.draws[0].teamDate) || it.team.recordDate || '';
  return it.team.recordDate || '';
}
function lotZoneGroupbuyItems() {
  const items = [];
  const groups = new Map();
  LOTTERY_DRAWS.forEach(d => {
    if (d.section !== 'groupbuy' || d.archived) return;
    if (!d.acctId && !d.eventId) return; // 兩邊都沒連＝待配對區
    const key = d.acctId || ('ev:' + d.eventId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  });
  groups.forEach((draws, key) => {
    const d0 = draws[0];
    let team = d0.acctId ? lotTeamByAcctId(d0.acctId) : null;
    if (!team) team = lotEventPseudoTeam({ eventId: d0.eventId, acctId: d0.acctId, title: d0.eventTitle || d0.title, startDate: d0.eventStartDate || d0.teamDate, brandId: d0.brandId, brandName: d0.brandName });
    items.push({ type: 'real', key, team, draws });
  });
  const nlEventAcctIds = new Set(LOTTERY_NO_LOTTERY_EVENTS.map(e => e.acctId).filter(Boolean));
  LOTTERY_ACCT_TEAMS.forEach(team => {
    if (groups.has(team.acctId)) return;
    if (team.noLottery) { if (!nlEventAcctIds.has(team.acctId)) items.push({ type: 'nolottery', key: 'nolot:' + team.acctId, team, draws: [] }); }
    else if (team.pendingDraw) items.push({ type: 'pending', key: 'pending:' + team.acctId, team, draws: [] });
    // 其餘（沒有 draw、沒標不抽、也還沒達待抽門檻）：什麼都不用做，不顯示
  });
  LOTTERY_PENDING_EVENTS.forEach(ev => items.push({ type: 'pendingEvent', key: 'pendev:' + ev.eventId, ev, team: lotEventPseudoTeam(ev), draws: [] }));
  LOTTERY_NO_LOTTERY_EVENTS.forEach(ev => items.push({ type: 'nolotteryEvent', key: 'nolotev:' + ev.eventId, ev, team: lotEventPseudoTeam(ev), draws: [] }));
  // 由久到近（teamDate 升冪；沒日期的排最前，同 docs/09 慣例）；同日再依 R 號、團名穩定排序
  items.sort((x, y) => {
    const dx = lotItemSortDate(x), dy = lotItemSortDate(y);
    if (dx !== dy) return dx.localeCompare(dy);
    const c = lotCompareLegacyId(x.team.legacyId, y.team.legacyId);
    return c || String(x.team.title || '').localeCompare(String(y.team.title || ''));
  });
  return items;
}
function lotFilterGroupbuyItems(items, opts) {
  const q = lotSearchQuery();
  const applyHideDone = !opts || opts.hideDone !== false;
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'awaiting_announce', 'done', 'redrawn', 'forfeited'].indexOf(LOTTERY_FILTER.status) !== -1;
  return items.filter(it => {
    if ((it.type === 'nolottery' || it.type === 'nolotteryEvent') && !LOTTERY_SHOW_NO_LOTTERY) return false;
    // 「已標不抽」「待抽」兩種虛擬列永不因「已完成」被隱藏，只有 type='real' 且全部抽獎都已完成才隱藏
    if (it.type === 'real' && applyHideDone && lotHideDoneActive() && it.draws.every(lotDrawCompleted)) return false;
    if (LOTTERY_FILTER.year && lotItemSortDate(it).slice(0, 4) !== LOTTERY_FILTER.year) return false;
    if (LOTTERY_FILTER.brand && it.team.brandId !== LOTTERY_FILTER.brand) return false;
    if (LOTTERY_FILTER.status === 'pending_draw' && it.type === 'real') return false;
    // 小類篩選：只有真的有抽獎的團才有小類；待抽／不抽虛擬列在篩選小類時一律不顯示
    if (LOTTERY_FILTER.subtype && LOTTERY_SUBTYPE_READY) {
      if (it.type !== 'real' || !it.draws.some(lotSubtypeFilterOk)) return false;
    }
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
  const winnerStatusActive = ['awaiting_info', 'info_ready', 'handed_to_vendor', 'awaiting_announce', 'done', 'redrawn', 'forfeited'].indexOf(LOTTERY_FILTER.status) !== -1;
  return draws.filter(d => {
    if (applyHideDone && lotHideDoneActive() && lotDrawCompleted(d)) return false;
    if (LOTTERY_FILTER.brand && d.brandId !== LOTTERY_FILTER.brand) return false;
    if (!lotSubtypeFilterOk(d)) return false;
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
    if (!lotSubtypeFilterOk(d)) return false;
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
    if (!lotSubtypeFilterOk(d)) return false;
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
  if (lotActivitiesTabOn()) { // 特殊活動分頁：只算特殊活動的抽獎
    const sp = LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived);
    return lotFilterSimpleZoneDraws(sp, { hideDone: false }).length - lotFilterSimpleZoneDraws(sp, { hideDone: true }).length;
  }
  const zone1Items = lotZoneGroupbuyItems();
  const zone1Without = lotFilterGroupbuyItems(zone1Items, { hideDone: false }).length;
  const zone1With = lotFilterGroupbuyItems(zone1Items, { hideDone: true }).length;
  const nonGroupbuyDraws = LOTTERY_DRAWS.filter(d => d.section === 'non_groupbuy' && !d.archived);
  const specialDraws = LOTTERY_ACTIVITIES_READY ? [] : LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived); // 活動表就緒後特殊活動只在「特殊活動」分頁
  const zone23Without = lotFilterSimpleZoneDraws(nonGroupbuyDraws, { hideDone: false }).length + lotFilterSimpleZoneDraws(specialDraws, { hideDone: false }).length;
  const zone23With = lotFilterSimpleZoneDraws(nonGroupbuyDraws, { hideDone: true }).length + lotFilterSimpleZoneDraws(specialDraws, { hideDone: true }).length;
  return (zone1Without - zone1With) + (zone23Without - zone23With);
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
      if (lotIsClosed(w)) return;
      const pt = lotWinnerType(w, d);
      const v = (x) => { const s = (x == null ? '' : String(x)).trim(); return /^[-－—]+$/.test(s) ? '' : s; }; // 試算表空值寫法「-」當空
      let contact = '';
      let copy = '';
      if (pt === 'cash') {
        const bank = [w.bankName, w.bankCode, w.bankBranch].filter(Boolean).join(' ');
        contact = [bank, w.bankAccount ? '帳號 ' + lotMaskAccount(w.bankAccount) : '', (w.cashAmount || w.cashAmount === 0) ? '$' + w.cashAmount : ''].filter(Boolean).join('　');
        // 歷史匯入的現金得獎人常把銀行資料整串放在地址／電話欄：銀行欄位都空就退回顯示那些文字
        if (!contact) contact = [w.phone, w.address].filter(v => v && v !== '-').join('　').replace(/\s+/g, ' ');
        // copy＝複製鈕用的完整文字（帳號不遮罩；其餘同 contact）
        copy = w.bankAccount ? contact.replace('帳號 ' + lotMaskAccount(w.bankAccount), '帳號 ' + w.bankAccount) : contact;
      } else if (pt === 'virtual') {
        contact = w.email || '';
        copy = contact;
      } else {
        contact = [v(w.phone), [v(w.zip), v(w.address)].filter(Boolean).join(' ')].filter(Boolean).join('　');
        // 複製鈕只複製地址（含郵遞區號），不含電話（雪莉 09-29：只要地址就好）
        copy = [v(w.zip), v(w.address)].filter(Boolean).join(' ');
      }
      // 姓名／暱稱都還沒有時，退回訂單上的姓名或訂單編號（抽出來只先填了訂單編號的階段）
      const who = v(w.name) || v(w.winnerHandle) || v(w.order && w.order.customerName) || (v(w.orderNo) ? '訂單 ' + v(w.orderNo) : '') || '（未填）';
      rows.push({ prize: w.prize || '', who, contact, copy, done: w.status === 'done' });
    });
  });
  return rows;
}
function lotBriefCol(rows, field) {
  if (!rows.length) return field === 'who' ? '<span class="lot-empty-cell">尚未抽出</span>' : '';
  // 電話／地址欄每行尾端一顆複製鈕（複製「電話 地址」或匯款資料整段，雪莉 09-25）；data-role 由 lotBindSectionEvents 綁，點了不會展開列
  const copyBtn = (txt) => '<button type="button" class="lot-copy-btn" data-role="copy-text" data-copy="' + lotEscapeHtml(txt) + '" title="複製">' + lotIcon('copy') + '</button>';
  const shown = rows.slice(0, LOT_BRIEF_MAX).map(r => '<div class="lot-brief-line' + (r.done ? ' lot-brief-done' : '') + '">' +
    (r[field] ? lotEscapeHtml(r[field]) + (field === 'contact' ? copyBtn((r.copy || r[field]).replace(/\u3000/g, ' ')) : '') : '<span class="lot-empty-cell">—</span>') + '</div>').join('');
  return shown + (rows.length > LOT_BRIEF_MAX && field === 'who' ? '<div class="lot-brief-line lot-more">+' + (rows.length - LOT_BRIEF_MAX) + ' 位</div>' : '');
}
function lotWinnersBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'who'); }
function lotPrizeBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'prize'); }
function lotContactBrief(draws) { return lotBriefCol(lotWinnersRows(draws), 'contact'); }
function lotProgressOf(draws) {
  const all = (draws || []).flatMap(d => d.winners || []).filter(w => !lotIsClosed(w));
  const done = all.filter(w => w.status === 'done').length;
  return { done, total: all.length, pending: all.length - done };
}
// 已抽幾位（排除已重抽／已放棄）；名額（null＝沒填；欄位未 push 當沒填）
function lotDrawnCount(d) { return ((d && d.winners) || []).filter(w => !lotIsClosed(w)).length; }
function lotDrawQuota(d) {
  if (!LOTTERY_QUOTA_READY || !d || d.quota === null || d.quota === undefined || d.quota === '') return null;
  const q = Number(d.quota);
  return Number.isFinite(q) && q > 0 ? q : null;
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
    '<td class="lot-td-title"' + (o.titleText ? ' title="' + lotEscapeHtml(o.titleText) + '"' : '') + '>' + (o.title || '') + '</td>' +
    '<td class="lot-td-prize">' + (o.prize || '') + '</td>' +
    '<td class="lot-td-winners">' + (o.winners || '') + '</td>' +
    '<td class="lot-td-contact">' + (o.contact || '') + '</td>' +
    '<td class="lot-td-num">' + (o.progress || '') + '</td>' +
    '<td class="lot-td-status">' + (o.status || '') + '</td>' +
  '</tr>';
  if (expanded) html += '<tr class="lot-tr-detail"><td colspan="7"><div class="lot-detail">' +
    ((o.brand || o.ref) ? '<div class="lot-detail-brand">' + [o.brand ? '品牌：' + lotEscapeHtml(o.brand) : '', o.ref ? lotEscapeHtml(o.ref) : ''].filter(Boolean).join('　') + '</div>' : '') + (o.detail || '') + '</div></td></tr>';
  return html;
}
function lotProgressTxt(draws) { const p = lotProgressOf(draws); return p.total ? p.done + ' / ' + p.total : '—'; }
function lotTitleWithRef(title, draw) {
  return '<span>' + lotEscapeHtml(title || '(未命名活動)') + '</span>' + lotSubtypePillHtml(draw) +
    (draw && draw.sheetRef ? ' <span class="lot-sheet-ref">' + lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef) + '</span>' : '');
}
function lotGroupbuyItemRowHtml(item) {
  if (item.type === 'pending') return lotPendingTeamRowHtml(item.team);
  if (item.type === 'nolottery') return lotNoLotteryTableRowHtml(item.team);
  if (item.type === 'pendingEvent') return lotPendingEventRowHtml(item.ev);
  if (item.type === 'nolotteryEvent') return lotNoLotteryEventRowHtml(item.ev);
  return lotTeamRowHtml(item.team, item.draws);
}
// 待抽（行事曆團）：後端 pendingEvents；「建立抽獎」預帶這團、「這團不抽」寫到行事曆團上
function lotPendingEventRowHtml(ev) {
  const ops = LOTTERY_CAN_EDIT
    ? ' <button class="task-mini-btn" data-role="pending-event-create" data-event-id="' + lotEscapeHtml(ev.eventId) + '">＋ 建立抽獎</button>' +
      (LOTTERY_EVENT_NL_READY ? '<button class="task-mini-btn" data-role="pending-event-no-lottery" data-event-id="' + lotEscapeHtml(ev.eventId) + '">這團不抽</button>' : '') : '';
  return lotRowHtml({
    key: 'pendev:' + ev.eventId, toggle: false, cls: 'lot-tr-pending', attrs: ' data-event-id="' + lotEscapeHtml(ev.eventId) + '"' + (ev.acctId ? ' data-acct-id="' + lotEscapeHtml(ev.acctId) + '"' : ''),
    date: ev.startDate ? lotFmtYMD(ev.startDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(ev.title || '') + '</span>', titleText: ev.title || '',
    brand: ev.brandName, winners: '<span class="lot-warn">已達待抽門檻</span>', progress: '—', status: lotPill('待抽', 'draw') + '<span class="lot-td-ops">' + ops + '</span>',
  });
}
function lotNoLotteryEventRowHtml(ev) {
  const ops = (LOTTERY_CAN_EDIT && LOTTERY_EVENT_NL_READY) ? ' <button class="task-mini-btn" data-role="restore-event-no-lottery" data-event-id="' + lotEscapeHtml(ev.eventId) + '">還原</button>' : '';
  return lotRowHtml({
    key: 'nolotev:' + ev.eventId, toggle: false, cls: 'lot-tr-muted', attrs: ' data-event-id="' + lotEscapeHtml(ev.eventId) + '"' + (ev.acctId ? ' data-acct-id="' + lotEscapeHtml(ev.acctId) + '"' : ''),
    date: ev.startDate ? lotFmtYMD(ev.startDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(ev.title || '') + '</span>', titleText: ev.title || '',
    brand: ev.brandName, winners: '', progress: '—', status: lotPill('不抽', 'muted') + '<span class="lot-td-ops">' + ops + '</span>',
  });
}
function lotTeamRowHtml(team, draws) {
  const idAttrs = (team.acctId ? ' data-acct-id="' + lotEscapeHtml(team.acctId) + '"' : '') + (team.eventId ? ' data-event-id="' + lotEscapeHtml(team.eventId) + '"' : '');
  const detail = draws.map(d => lotDrawBlockHtml(d, { showWinnerFoot: true })).join('') +
    ((LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? '<div class="lot-card-foot"><button class="task-mini-btn" data-role="team-add-draw"' + idAttrs + '>＋ 這團加開一場抽獎</button></div>' : '');
  const dateStr = (draws[0] && draws[0].teamDate) || team.recordDate;
  return lotRowHtml({
    key: 'team:' + (team.acctId || ('ev:' + team.eventId)), toggle: true, attrs: idAttrs,
    date: dateStr ? lotFmtYMD(dateStr) : '（無日期）',
    // R 號不進表格（雪莉 09-25：團名固定寬度、後面 R 號不用），改放展開列的品牌那行
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>' + (team.failed ? ' <span class="lot-warn">未成團</span>' : '') + lotSubtypePillsForDraws(draws),
    titleText: team.title || '', ref: team.legacyId || '',
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
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>', titleText: team.title || '', ref: team.legacyId || '',
    brand: team.brandName, winners: '<span class="lot-warn">已達待抽門檻</span>', progress: '—', status: lotPill('待抽', 'draw') + '<span class="lot-td-ops">' + ops + '</span>',
  });
}
function lotNoLotteryTableRowHtml(team) {
  const ops = (LOTTERY_CAN_EDIT && LOTTERY_ACCT_READY) ? ' <button class="task-mini-btn" data-role="restore-no-lottery" data-acct-id="' + lotEscapeHtml(team.acctId) + '">還原</button>' : '';
  return lotRowHtml({
    key: 'nolot:' + team.acctId, toggle: false, cls: 'lot-tr-muted', attrs: ' data-acct-id="' + lotEscapeHtml(team.acctId) + '"',
    date: team.recordDate ? lotFmtYMD(team.recordDate) : '（無日期）',
    title: '<span>' + lotEscapeHtml(team.title || '') + '</span>', titleText: team.title || '', ref: team.legacyId || '',
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

// ===== 特殊活動分頁（docs/16 §8.1）=====
const LOT_ACT_STATUS_LABEL = { draft: '準備中', open: '報名中', drawn: '已抽籤', ended: '已結束' };
const LOT_ACT_STATUS_PILL = { draft: 'muted', open: 'info', drawn: 'draw', ended: 'done' };
function lotParseYMD(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
// 活動期間 M/D–M/D；兩端不同年份才帶年
function lotFmtActivityRange(startDate, endDate) {
  const ps = lotParseYMD(startDate), pe = lotParseYMD(endDate);
  if (!ps && !pe) return '';
  const md = p => p.m + '/' + p.d;
  const full = p => p.y + '/' + p.m + '/' + p.d;
  if (ps && !pe) return md(ps) + ' 起';
  if (!ps && pe) return md(pe) + ' 止';
  return ps.y === pe.y ? md(ps) + '–' + md(pe) : full(ps) + '–' + full(pe);
}
function lotActivityById(id) { return LOTTERY_ACTIVITIES.find(a => a.id === id) || null; }
function lotActivityOptionLabel(a) {
  const r = lotFmtActivityRange(a.startDate, a.endDate);
  return (a.title || '(未命名)') + (r ? '（' + r + '）' : '');
}
function lotActivityTextBlockHtml(a, label, txt, key) {
  txt = String(txt || '');
  if (!txt.trim()) return '';
  const long = txt.length > 90 || (txt.match(/\n/g) || []).length >= 3;
  const exp = !!LOTTERY_ACTIVITY_TEXT_OPEN[a.id + ':' + key];
  return '<div class="lot-act-block"><div class="lot-act-label">' + lotEscapeHtml(label) + '</div>' +
    '<div class="lot-act-text' + (long && !exp ? ' clamp' : '') + '">' + lotEscapeHtml(txt) + '</div>' +
    (long ? '<button type="button" class="lot-act-more" data-role="act-text-toggle" data-act-id="' + lotEscapeHtml(a.id) + '" data-key="' + key + '">' + (exp ? '收合' : '展開') + '</button>' : '') +
    '</div>';
}
// ===== 第 4 期 4a 小工具：規則摘要／獎品摘要 =====
const LOT_RULE_MODE_LABEL = { per_order: '單筆滿額，一筆一次', per_order_stack: '單筆滿額，可累積', total: '活動期間總額滿額' };
function lotRuleSummary(d) {
  if (!d || !d.ruleMode) return '';
  const lab = d.ruleMode === 'per_order' ? '一筆一次' : (d.ruleMode === 'per_order_stack' ? '可累積' : '');
  const th = d.ruleThreshold ? lotMoney(d.ruleThreshold) : '';
  if (d.ruleMode === 'total') return '活動總額滿 ' + th;
  return '單筆滿 ' + th + (lab ? '・' + lab : '');
}
function lotPrizeItemsSummary(d) {
  const items = Array.isArray(d && d.prizeItems) ? d.prizeItems : [];
  if (!items.length) return '';
  const total = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  return '獎品 ' + items.length + ' 種／共 ' + total + ' 份';
}
function lotActivityCardHtml(a, draws) {
  const open = !!LOTTERY_ACTIVITY_OPEN[a.id];
  const range = lotFmtActivityRange(a.startDate, a.endDate);
  const nDraw = Number(a.drawCount) || 0, nWin = Number(a.winnerCount) || 0;
  const idAttr = ' data-act-id="' + lotEscapeHtml(a.id) + '"';
  const meta = [range ? '<span>' + lotEscapeHtml(range) + '</span>' : '', '<span>' + nDraw + ' 場抽獎・' + nWin + ' 位得獎人</span>'].filter(Boolean).join('');
  // 第 4 期：登記截止／抽獎日／算哪些團（campaignReady 才顯示）
  let campaignMeta = '';
  if (LOTTERY_CAMPAIGN_READY) {
    const md = s => { const m = String(s || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; };
    const dl = [a.registerDeadline ? '登記截止 ' + md(a.registerDeadline) : '', a.drawDate ? '抽獎 ' + md(a.drawDate) : ''].filter(Boolean).join('・');
    const teamTxt = a.allTeams === false ? '指定 ' + (Array.isArray(a.teams) ? a.teams.length : 0) + ' 團' : '全部團';
    const pub = a.publishDate ? '活動頁 ' + md(a.publishDate) + ' 上線' : '';
    campaignMeta = '<div class="lot-meta">' + (dl ? '<span>' + lotEscapeHtml(dl) + '</span>' : '') + (pub ? '<span>' + lotEscapeHtml(pub) + '</span>' : '') + '<span>' + teamTxt + '</span></div>';
    if (a.slug) {
      const url = 'https://member.sheridondon.com.tw/campaign/' + a.slug;
      campaignMeta += '<div class="lot-meta"><span>活動頁：' + lotEscapeHtml(url) + '</span>' +
        '<button type="button" class="task-mini-btn" data-role="act-copy-link" data-url="' + lotEscapeHtml(url) + '">複製連結</button></div>';
    }
  }
  let body = '';
  if (open) {
    let ruleLines = '';
    if (LOTTERY_CAMPAIGN_READY && draws.length) {
      ruleLines = '<div class="lot-act-sub">' + draws.map(d => {
        const rs = lotRuleSummary(d), ps = lotPrizeItemsSummary(d);
        return '<div>' + lotEscapeHtml(d.title || '(未命名)') + (rs ? '<span class="lot-act-rule">' + lotEscapeHtml(rs) + '</span>' : '') + (ps ? '<span class="lot-act-rule">' + lotEscapeHtml(ps) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    body = '<div class="lot-card-body">' + ruleLines + (draws.length
      ? lotTableWrap(draws.map(d => lotSimpleDrawRowHtml(d)).join(''))
      : (nDraw > 0 && lotHideDoneActive()
          // 底下抽獎全部已完成、被「隱藏已完成」藏起來：講清楚，並給一顆直接關掉隱藏的鈕（10-10 實測：已結束的生日慶整張卡看起來是空的）
          ? '<div class="task-empty lot-zone-empty">' + nDraw + ' 場都已完成，已隱藏 <button type="button" class="lot-act-more" data-role="act-show-done">顯示</button></div>'
          : '<div class="task-empty lot-zone-empty">（沒有符合條件的抽獎）</div>')) + '</div>' +
      (LOTTERY_CAN_EDIT ? '<div class="lot-card-foot">' +
        '<button class="task-mini-btn" data-role="act-add-draw"' + idAttr + '>＋ 新增小活動</button>' +
        '<span class="lot-spacer"></span>' +
        (LOTTERY_CAMPAIGN_READY ? '<button class="task-mini-btn" data-role="act-elig"' + idAttr + '>' + lotIcon('eye') + ' 資格預覽</button>' : '') +
        '<button class="task-mini-btn" data-role="act-edit"' + idAttr + '>' + lotIcon('edit') + ' 編輯活動</button>' +
        '<button class="task-mini-btn danger" data-role="act-delete"' + idAttr + '>' + lotIcon('trash') + ' 刪除活動</button>' +
      '</div>' : '');
  }
  return '<div class="lot-card lot-act-card"' + idAttr + '>' +
    '<div class="lot-card-head" data-role="act-toggle"' + idAttr + '>' +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(a.title || '(未命名活動)') + '</span>' +
          lotPill(LOT_ACT_STATUS_LABEL[a.status] || a.status || '', LOT_ACT_STATUS_PILL[a.status] || 'muted') + '</div>' +
        '<div class="lot-meta">' + meta + '</div>' + campaignMeta +
      '</div>' +
      '<div class="lot-progress"><span class="lot-caret">' + lotCaretHtml(open, '收合', '展開') + '</span></div>' +
    '</div>' +
    lotActivityTextBlockHtml(a, '活動介紹', a.intro, 'intro') +
    lotActivityTextBlockHtml(a, '規則說明', a.rules, 'rules') +
    body +
  '</div>';
}
function renderLotteryActivities() {
  const box = document.getElementById('lotBody');
  if (!box) return;
  const byCreated = arr => arr.slice().sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')));
  const specialAll = LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived);
  const note = txt => '<div class="lot-act-note">' + txt + '</div>';
  const parts = [];

  if (!LOTTERY_ACTIVITIES_READY) {
    // 退回現況：沒有活動表，特殊活動抽獎照舊用扁平清單
    parts.push(note('特殊活動功能還沒準備好（系統更新中或資料表待 db push）：目前先照舊列出特殊活動的抽獎，暫時不能新增活動。'));
    const flat = lotApplyDir(lotFilterSimpleZoneDraws(byCreated(specialAll)));
    parts.push(lotRenderZone('special', LOT_SECTION_LABEL.special, flat, d => lotSimpleDrawRowHtml(d)));
    box.innerHTML = parts.join('');
    lotBindSectionEvents(box);
    return;
  }

  if (LOTTERY_CAN_EDIT) parts.push('<div class="lot-act-toolbar"><button class="task-mini-btn" data-role="act-new">＋ 新增特殊活動</button></div>');
  const q = lotSearchQuery();
  const filtersActive = !!(q || LOTTERY_FILTER.brand || LOTTERY_FILTER.status !== 'all' || LOTTERY_FILTER.subtype);
  const knownIds = new Set(LOTTERY_ACTIVITIES.map(a => a.id));
  const cards = [];
  LOTTERY_ACTIVITIES.forEach(a => {
    const mine = specialAll.filter(d => d.activityId === a.id);
    const shown = lotApplyDir(lotFilterSimpleZoneDraws(byCreated(mine)));
    if (filtersActive && !shown.length) {
      const titleHit = q && [a.title, a.intro, a.rules].map(x => String(x || '')).join(' ').toLowerCase().indexOf(q) !== -1;
      if (!titleHit || LOTTERY_FILTER.brand || LOTTERY_FILTER.status !== 'all') return;
    }
    cards.push(lotActivityCardHtml(a, shown));
  });
  if (cards.length) parts.push('<div class="lot-act-list">' + cards.join('') + '</div>');
  else if (!LOTTERY_ACTIVITIES.length) parts.push('<div class="task-empty">還沒有特殊活動</div>');
  else parts.push('<div class="task-empty">沒有符合條件的特殊活動</div>');

  // 不屬於任何活動的特殊活動抽獎
  const orphan = lotApplyDir(lotFilterSimpleZoneDraws(byCreated(specialAll.filter(d => !d.activityId || !knownIds.has(d.activityId)))));
  if (orphan.length) parts.push(lotRenderZone('act_none', '未歸類的特殊活動抽獎', orphan, d => lotSimpleDrawRowHtml(d)));

  box.innerHTML = parts.join('');
  lotBindSectionEvents(box);
  lotBindActivityEvents(box);
}
function lotBindActivityEvents(box) {
  const stop = (el, fn) => el.addEventListener('click', ev => { ev.stopPropagation(); fn(el); });
  box.querySelectorAll('[data-role="act-new"]').forEach(el => stop(el, () => openLotteryActivityModal(null)));
  box.querySelectorAll('[data-role="act-toggle"]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.actId;
      if (LOTTERY_ACTIVITY_OPEN[id]) delete LOTTERY_ACTIVITY_OPEN[id]; else LOTTERY_ACTIVITY_OPEN[id] = true;
      lotSaveActivityOpen();
      renderLotteryActivities();
    });
  });
  box.querySelectorAll('[data-role="act-text-toggle"]').forEach(el => stop(el, () => {
    const k = el.dataset.actId + ':' + el.dataset.key;
    LOTTERY_ACTIVITY_TEXT_OPEN[k] = !LOTTERY_ACTIVITY_TEXT_OPEN[k];
    renderLotteryActivities();
  }));
  box.querySelectorAll('[data-role="act-add-draw"]').forEach(el => stop(el, () => {
    openLotteryDrawModal(null, { section: 'special', activityId: el.dataset.actId, drawDate: lotToday() });
  }));
  box.querySelectorAll('[data-role="act-elig"]').forEach(el => stop(el, () => openLotteryEligibilityModal(lotActivityById(el.dataset.actId))));
  box.querySelectorAll('[data-role="act-edit"]').forEach(el => stop(el, () => openLotteryActivityModal(lotActivityById(el.dataset.actId))));
  box.querySelectorAll('[data-role="act-delete"]').forEach(el => stop(el, () => lotDeleteActivity(el.dataset.actId)));
  box.querySelectorAll('[data-role="act-copy-link"]').forEach(el => stop(el, () => {
    const url = el.dataset.url || '';
    const fallback = () => { try { window.prompt('複製這個連結', url); } catch (e) {} };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => { el.textContent = '已複製'; setTimeout(() => { el.textContent = '複製連結'; }, 1500); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }));
  box.querySelectorAll('[data-role="act-show-done"]').forEach(el => stop(el, () => {
    LOTTERY_HIDE_DONE = false; lotSaveHideDone(false);
    renderLotteryFilters(); renderLotteryBody();
  }));
}
async function lotDeleteActivity(id) {
  const a = lotActivityById(id);
  if (!a) return;
  if (!confirm('確定要刪除活動「' + (a.title || '') + '」嗎？\n\n活動底下如果還有抽獎，系統會擋下來，要先移走或刪除那些抽獎。')) return;
  try {
    const res = await lotApiPost('lottery-activity-delete', { id });
    if (!res || !res.success) { alert((res && res.error) || '刪除失敗'); return; }
    delete LOTTERY_ACTIVITY_OPEN[id]; lotSaveActivityOpen();
    closeLotteryActivityModal();
    loadLotteryView(true);
  } catch (err) { alert('刪除失敗：' + err.message); }
}

// ===== 資格預覽 modal（第 4 期 4a；lottery-activity-eligibility）=====
let LOT_ELIG = null; // {act, data}
let LOT_ELIG_OPEN = {}; // userId -> true（展開的會員）
function closeLotteryEligibilityModal() {
  const m = document.getElementById('lotteryEligibilityModal');
  if (m) m.classList.remove('show');
  LOT_ELIG = null;
}
async function openLotteryEligibilityModal(act) {
  if (!act) return;
  LOT_ELIG = { act, data: null };
  LOT_ELIG_OPEN = {};
  document.getElementById('lotEligTitle').textContent = '資格預覽：' + (act.title || '');
  document.getElementById('lotEligSearch').value = '';
  document.getElementById('lotEligSummary').innerHTML = '';
  document.getElementById('lotEligBody').innerHTML = '<div class="task-empty">讀取中…</div>';
  document.getElementById('lotteryEligibilityModal').classList.add('show');
  try {
    const res = await lotApiPost('lottery-activity-eligibility', { activityId: act.id });
    if (!LOT_ELIG || LOT_ELIG.act !== act) return; // 讀取期間視窗已關／換活動
    if (!res || !res.success) throw new Error((res && res.error) || '讀取失敗');
    LOT_ELIG.data = res;
    lotRenderEligibility();
  } catch (err) {
    if (LOT_ELIG && LOT_ELIG.act === act) document.getElementById('lotEligBody').innerHTML = '<div class="task-empty">讀取失敗：' + lotEscapeHtml(err.message) + '</div>';
  }
}
function lotEligDrawLabel(d) {
  return (d.title || '(未命名)') + (d.ruleMode ? '（' + lotRuleSummary(d) + '）' : '');
}
function lotEligFilteredMembers() {
  const data = LOT_ELIG && LOT_ELIG.data;
  if (!data) return [];
  const q = document.getElementById('lotEligSearch').value.trim().toLowerCase();
  const members = Array.isArray(data.members) ? data.members : [];
  if (!q) return members;
  return members.filter(m => [m.memberNo, m.displayName].some(v => String(v || '').toLowerCase().includes(q)) ||
    (m.orders || []).some(o => String(o.orderNo || '').toLowerCase().includes(q)));
}
function lotRenderEligibility() {
  const data = LOT_ELIG && LOT_ELIG.data;
  if (!data) return;
  const draws = Array.isArray(data.draws) ? data.draws : [];
  const sum = draws.map(d => '<div class="lot-elig-sum-row">' + lotEscapeHtml(lotEligDrawLabel(d)) +
    '｜' + (Number(d.entrants) || 0) + ' 人有資格｜共 ' + (Number(d.totalChances) || 0) + ' 次機會</div>').join('');
  const pend = Number(data.pendingRegistrations) || 0;
  document.getElementById('lotEligSummary').innerHTML = (sum || '<div class="task-empty">這個活動還沒有設定資格規則的小活動</div>') +
    '<div class="lot-elig-sum-row">待核對的登記 ' + pend + ' 筆</div>';
  const members = lotEligFilteredMembers();
  const body = document.getElementById('lotEligBody');
  // 後端有說明原因（例如「活動尚未填訂單計算期間」「指定團但還沒選團」）就顯示原因，不要只說沒人符合（10-10 驗收）
  if (!members.length) { body.innerHTML = '<div class="task-empty">' + ((data.members || []).length ? '沒有符合搜尋的會員' : lotEscapeHtml(data.reason || '目前沒有人符合資格')) + '</div>'; return; }
  const colCount = draws.length + 3;
  const head = '<tr><th>會員編號</th><th>名稱</th>' + draws.map(d => '<th>' + lotEscapeHtml(d.title || '') + '</th>').join('') + '<th>合格訂單數</th></tr>';
  const rows = members.map(m => {
    const open = !!LOT_ELIG_OPEN[m.userId];
    const chances = m.chances || {};
    let html = '<tr class="lot-elig-member" data-uid="' + lotEscapeHtml(m.userId) + '"><td>' + lotEscapeHtml(m.memberNo || '') + '</td><td>' + lotEscapeHtml(m.displayName || '') + '</td>' +
      draws.map(d => '<td>' + (Number(chances[d.drawId]) || 0) + '</td>').join('') +
      '<td>' + (m.orders || []).length + '</td></tr>';
    if (open) {
      html += '<tr class="lot-elig-orders"><td colspan="' + colCount + '">' + ((m.orders || []).length
        ? (m.orders || []).map(o => lotEscapeHtml(o.orderNo || '') + '　' + lotMoney(o.amount) + '　' + lotEscapeHtml(String(o.orderedAt || '').slice(0, 10)) + '　' + lotEscapeHtml(o.teamTitle || '')).join('<br>')
        : '沒有合格訂單') + '</td></tr>';
    }
    return html;
  }).join('');
  body.innerHTML = '<div class="lot-tbl-wrap"><table class="lot-elig-tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  body.querySelectorAll('tr.lot-elig-member').forEach(tr => tr.addEventListener('click', () => {
    const id = tr.dataset.uid;
    if (LOT_ELIG_OPEN[id]) delete LOT_ELIG_OPEN[id]; else LOT_ELIG_OPEN[id] = true;
    lotRenderEligibility();
  }));
}
function lotCsvCell(v) {
  let s = String(v === undefined || v === null ? '' : v);
  if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s; // 防公式注入
  return '"' + s.replace(/"/g, '""') + '"';
}
function lotEligExportCsv() {
  const data = LOT_ELIG && LOT_ELIG.data;
  if (!data) { alert('資料還沒讀取完成'); return; }
  const draws = Array.isArray(data.draws) ? data.draws : [];
  const members = lotEligFilteredMembers();
  const lines = [['會員編號', '名稱'].concat(draws.map(d => d.title || ''), ['合格訂單數', '合格訂單（編號 金額 下單日 團名）']).map(lotCsvCell).join(',')];
  members.forEach(m => {
    const ch = m.chances || {};
    const os = (m.orders || []).map(o => [o.orderNo, o.amount, String(o.orderedAt || '').slice(0, 10), o.teamTitle].join(' ')).join('；');
    lines.push([m.memberNo, m.displayName].concat(draws.map(d => Number(ch[d.drawId]) || 0), [(m.orders || []).length, os]).map(lotCsvCell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '資格預覽-' + (LOT_ELIG.act.title || '活動') + '-' + lotToday() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.getElementById('lotEligSearch').addEventListener('input', lotRenderEligibility);
document.getElementById('lotEligCsvBtn').addEventListener('click', lotEligExportCsv);

// ===== 新增／編輯特殊活動 modal =====
let LOTTERY_EDIT_ACTIVITY_ID = null;
let LOT_ACT_ORIG_SLUG = '';
function openLotteryActivityModal(act) {
  LOTTERY_EDIT_ACTIVITY_ID = act ? act.id : null;
  LOT_ACT_ORIG_SLUG = act ? (act.slug || '') : '';
  document.getElementById('lotActModalTitle').textContent = act ? '編輯特殊活動' : '新增特殊活動';
  document.getElementById('lotActTitleInput').value = act ? (act.title || '') : '';
  document.getElementById('lotActStartInput').value = act ? (act.startDate || '') : '';
  document.getElementById('lotActEndInput').value = act ? (act.endDate || '') : '';
  document.getElementById('lotActStatusSelect').value = act ? (act.status || 'draft') : 'draft';
  document.getElementById('lotActIntroInput').value = act ? (act.intro || '') : '';
  document.getElementById('lotActRulesInput').value = act ? (act.rules || '') : '';
  document.getElementById('lotActSlugInput').value = act ? (act.slug || '') : '';
  document.getElementById('lotActDeleteBtn').style.display = act ? 'inline-block' : 'none';
  lotInitActCampaignFields(act);
  lotSetStatus('lotActFormStatus', '', '');
  document.getElementById('lotteryActivityModal').classList.add('show');
}

// ----- 第 4 期：活動視窗的登記截止／抽獎日／算哪些團／每人上限（campaignReady 才顯示）-----
let LOT_ACT_TEAMS = [];        // 已選團：['event:<uuid>' | 'acct:<uuid>', ...]
let LOT_ACT_TEAM_TITLES = {};  // key -> 顯示文字（取自活動既有 teams[]，挑選清單找不到時的備援）
function lotActTeamKey(t) { return t.kind + ':' + t.id; }
function lotInitActCampaignFields(act) {
  const on = LOTTERY_CAMPAIGN_READY;
  document.getElementById('lotActCampaignGroup').style.display = on ? '' : 'none';
  document.getElementById('lotActPeriodHint').style.display = on ? '' : 'none';
  document.getElementById('lotActStartLabel').textContent = on ? '訂單計算期間：開始日（下單日）' : '開始日';
  document.getElementById('lotActEndLabel').textContent = on ? '訂單計算期間：結束日（下單日）' : '結束日';
  if (!on) return;
  document.getElementById('lotActRegDeadlineInput').value = act ? (act.registerDeadline || '') : '';
  document.getElementById('lotActDrawDateInput').value = act ? (act.drawDate || '') : '';
  document.getElementById('lotActPublishDateInput').value = act ? (act.publishDate || '') : '';
  document.getElementById('lotActCoverUrlInput').value = act ? (act.coverUrl || '') : '';
  document.getElementById('lotActMaxWinsInput').value = (act && act.maxWins !== null && act.maxWins !== undefined && act.maxWins !== '') ? act.maxWins : '';
  const picked = !!(act && act.allTeams === false);
  document.querySelector('input[name="lotActTeamsMode"][value="' + (picked ? 'picked' : 'all') + '"]').checked = true;
  LOT_ACT_TEAMS = []; LOT_ACT_TEAM_TITLES = {};
  ((act && Array.isArray(act.teams)) ? act.teams : []).forEach(t => {
    const k = lotActTeamKey(t);
    if (LOT_ACT_TEAMS.indexOf(k) === -1) LOT_ACT_TEAMS.push(k);
    LOT_ACT_TEAM_TITLES[k] = t.title || '';
  });
  document.getElementById('lotActTeamsSearch').value = '';
  lotSyncActTeamsMode();
}
function lotActTeamLabel(key) {
  const [kind, id] = key.split(':');
  if (kind === 'event') {
    const ev = lotEventChoiceById(id);
    if (ev) return lotEventOptionLabel(ev);
  } else {
    const t = lotTeamByAcctId(id);
    if (t) return lotAcctTeamOptionLabel(t);
  }
  return LOT_ACT_TEAM_TITLES[key] || id;
}
function lotSyncActTeamsMode() {
  const picked = (document.querySelector('input[name="lotActTeamsMode"]:checked') || {}).value === 'picked';
  document.getElementById('lotActTeamsBox').style.display = picked ? '' : 'none';
  if (picked) lotRenderActTeamsPicker();
}
function lotRenderActTeamsPicker() {
  const q = document.getElementById('lotActTeamsSearch').value.trim().toLowerCase();
  const selBox = document.getElementById('lotActTeamsSelected');
  selBox.innerHTML = LOT_ACT_TEAMS.length ? LOT_ACT_TEAMS.map(k =>
    '<div class="lot-team-sel-row"><span>' + lotEscapeHtml(lotActTeamLabel(k)) + '</span>' +
    '<button type="button" class="task-mini-btn x-btn" data-key="' + lotEscapeHtml(k) + '" title="移除" aria-label="移除" style="flex:none; padding:2px 8px;">✕</button></div>'
  ).join('') : '<div class="hint" style="font-size:12px; color:var(--c-text-soft);">還沒有選團</div>';
  selBox.querySelectorAll('button[data-key]').forEach(b => b.addEventListener('click', () => {
    LOT_ACT_TEAMS = LOT_ACT_TEAMS.filter(x => x !== b.dataset.key);
    lotRenderActTeamsPicker();
  }));
  const chosen = new Set(LOT_ACT_TEAMS);
  const evs = LOTTERY_EVENT_CHOICES.filter(ev => !chosen.has('event:' + ev.eventId) && (!q || (ev.title || '').toLowerCase().includes(q)))
    .sort((x, y) => String(y.startDate || '').localeCompare(String(x.startDate || '')));
  const ac = LOTTERY_ACCT_TEAMS.filter(t => !t.eventId && !chosen.has('acct:' + t.acctId) && (!q || (t.title || '').toLowerCase().includes(q) || (t.legacyId || '').toLowerCase().includes(q)));
  const LIMIT = 150;
  const row = (key, label) => '<label class="lot-team-pick"><input type="checkbox" data-key="' + lotEscapeHtml(key) + '"><span>' + lotEscapeHtml(label) + '</span></label>';
  let html = '';
  if (evs.length) html += '<div class="lot-team-group">行事曆團購</div>' + evs.slice(0, LIMIT).map(ev => row('event:' + ev.eventId, lotEventOptionLabel(ev))).join('');
  if (ac.length) html += '<div class="lot-team-group">舊團（只有帳務）</div>' + ac.slice(0, LIMIT).map(t => row('acct:' + t.acctId, lotAcctTeamOptionLabel(t))).join('');
  if (evs.length > LIMIT || ac.length > LIMIT) html += '<div class="hint" style="font-size:12px; color:var(--c-text-soft); padding:6px 0;">只列前 ' + LIMIT + ' 筆，請用搜尋縮小範圍</div>';
  if (!html) html = '<div class="hint" style="font-size:12px; color:var(--c-text-soft); padding:6px 0;">沒有符合的團</div>';
  const list = document.getElementById('lotActTeamsList');
  list.innerHTML = html;
  list.querySelectorAll('input[data-key]').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked && LOT_ACT_TEAMS.indexOf(cb.dataset.key) === -1) LOT_ACT_TEAMS.push(cb.dataset.key);
    lotRenderActTeamsPicker();
  }));
}
document.querySelectorAll('input[name="lotActTeamsMode"]').forEach(r => r.addEventListener('change', lotSyncActTeamsMode));
document.getElementById('lotActTeamsSearch').addEventListener('input', lotRenderActTeamsPicker);
function closeLotteryActivityModal() {
  const m = document.getElementById('lotteryActivityModal');
  if (m) m.classList.remove('show');
  LOTTERY_EDIT_ACTIVITY_ID = null;
}
document.getElementById('lotActSaveBtn').addEventListener('click', async () => {
  const title = document.getElementById('lotActTitleInput').value.trim();
  const startDate = document.getElementById('lotActStartInput').value || '';
  const endDate = document.getElementById('lotActEndInput').value || '';
  const slug = document.getElementById('lotActSlugInput').value.trim();
  if (!title) { lotSetStatus('lotActFormStatus', '請填寫活動名稱', 'error'); return; }
  if (startDate && endDate && endDate < startDate) { lotSetStatus('lotActFormStatus', '結束日不能早於開始日', 'error'); return; }
  if (slug && !/^[a-z0-9-]{2,60}$/.test(slug)) { lotSetStatus('lotActFormStatus', '網址代號只能用小寫英文、數字和 -（2～60 字）', 'error'); return; }
  const payload = {
    title,
    startDate: startDate || null,
    endDate: endDate || null,
    status: document.getElementById('lotActStatusSelect').value || 'draft',
    intro: document.getElementById('lotActIntroInput').value,
    rules: document.getElementById('lotActRulesInput').value
  };
  if (LOTTERY_CAMPAIGN_READY) {
    const reg = document.getElementById('lotActRegDeadlineInput').value || '';
    const dd = document.getElementById('lotActDrawDateInput').value || '';
    const mwRaw = document.getElementById('lotActMaxWinsInput').value.trim();
    if (mwRaw !== '' && (!/^\d+$/.test(mwRaw) || Number(mwRaw) < 1 || Number(mwRaw) > 99)) { lotSetStatus('lotActFormStatus', '每人最多中幾次只能填 1～99 的整數，或留空', 'error'); return; }
    const picked = (document.querySelector('input[name="lotActTeamsMode"]:checked') || {}).value === 'picked';
    if (picked && !LOT_ACT_TEAMS.length) { lotSetStatus('lotActFormStatus', '選了「指定團」請至少勾一個團，或改選「全部團」', 'error'); return; }
    payload.registerDeadline = reg || null;
    payload.drawDate = dd || null;
    const pubDate = document.getElementById('lotActPublishDateInput').value || '';
    const coverUrl = document.getElementById('lotActCoverUrlInput').value.trim();
    if (coverUrl && !/^https?:\/\//i.test(coverUrl)) { lotSetStatus('lotActFormStatus', '頂圖網址要以 http 開頭', 'error'); return; }
    payload.publishDate = pubDate || null;
    payload.coverUrl = coverUrl;
    payload.maxWins = mwRaw === '' ? null : Number(mwRaw);
    payload.allTeams = !picked;
    payload.teams = picked ? LOT_ACT_TEAMS.slice() : [];
  }
  if (slug || LOT_ACT_ORIG_SLUG) payload.slug = slug; // 新增且沒填＝不送（免得空字串撞唯一鍵）；原本有代號、現在清空＝送空字串
  if (LOTTERY_EDIT_ACTIVITY_ID) payload.id = LOTTERY_EDIT_ACTIVITY_ID;
  const btn = document.getElementById('lotActSaveBtn');
  btn.disabled = true;
  lotSetStatus('lotActFormStatus', '儲存中…', '');
  try {
    const res = await lotApiPost('lottery-activity-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    closeLotteryActivityModal();
    loadLotteryView(true);
  } catch (err) {
    lotSetStatus('lotActFormStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
document.getElementById('lotActDeleteBtn').addEventListener('click', () => {
  if (LOTTERY_EDIT_ACTIVITY_ID) lotDeleteActivity(LOTTERY_EDIT_ACTIVITY_ID);
});

function renderLotterySections() {
  const box = document.getElementById('lotBody');
  if (!box) return;

  const groupbuyItems = lotApplyDir(lotFilterGroupbuyItems(lotZoneGroupbuyItems())); // 已由久到近排好（teamDate 升冪）
  const nonGroupbuyDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'non_groupbuy' && !d.archived)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const specialDraws = lotApplyDir(lotFilterSimpleZoneDraws(LOTTERY_DRAWS.filter(d => d.section === 'special' && !d.archived)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const acctlessGroupbuyDraws = LOTTERY_DRAWS.filter(d => d.section === 'groupbuy' && !d.acctId && !d.archived);
  const archivedDraws = lotApplyDir(lotFilterArchivedDraws(LOTTERY_DRAWS.filter(d => d.archived === true)).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
  const unpairedDraws = lotApplyDir(lotFilterUnpairedDraws(acctlessGroupbuyDraws.filter(d => !lotDrawHasEvent(d))).slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));

  const parts = [];
  if (lotZoneVisible('groupbuy')) parts.push(lotRenderZone('groupbuy', LOT_SECTION_LABEL.groupbuy, groupbuyItems, lotGroupbuyItemRowHtml));
  if (lotZoneVisible('non_groupbuy')) parts.push(lotRenderZone('non_groupbuy', LOT_SECTION_LABEL.non_groupbuy, nonGroupbuyDraws, d => lotSimpleDrawRowHtml(d)));
  if (lotZoneVisible('special') && !LOTTERY_ACTIVITIES_READY) parts.push(lotRenderZone('special', LOT_SECTION_LABEL.special, specialDraws, d => lotSimpleDrawRowHtml(d)));
  if (lotZoneVisible('unpaired')) parts.push(lotRenderZone('unpaired', '待配對（綁團但還沒連到團）', unpairedDraws, d => lotUnpairedRowHtml(d)));
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
  const unfinished = allWinners.some(w => !lotIsSettled(w));
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
  { // 名額：有填才顯示「已抽 n／名額」，沒抽滿用提示色
    const quota = lotDrawQuota(draw);
    if (quota !== null) { const n = lotDrawnCount(draw); metaParts.push(chip('已抽 ' + n + '／' + quota, n < quota ? 'lot-warn' : '')); }
  }
  if (draw.lineKeyword) metaParts.push(chip('L關鍵字：' + lotEscapeHtml(draw.lineKeyword)));
  metaParts.push(chip('贊助：' + (LOT_SHIP_BY_LABEL[draw.shipBy] || '團購主')));
  if (draw.note) metaParts.push(chip(lotIcon('note') + ' 有備註', '', ' title="' + lotEscapeHtml(draw.note) + '"'));
  if (draw.sheetRef) metaParts.push(chip(lotIcon('sheet') + ' ' + lotEscapeHtml(draw.sheetRef), 'lot-sheet-ref'));
  // ①團購抽獎專屬：acctId 是靠對應的行事曆團「後來才建了帳務列」自動補上的（非雪莉手綁）
  if (draw.acctDerived) metaParts.push(chip('由行事曆團自動對應', 'lot-chip-hint'));

  const rowsHtml = (draw.winners || []).map(w => lotWinnerRowHtml(draw.id, w, lotWinnerType(w, prizeType), prizeType)).join('');

  return '<div class="lot-draw-block" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-draw-block-head">' +
      '<span class="lot-draw-block-title">' + lotEscapeHtml(draw.title || '(未命名活動)') + lotSubtypePillHtml(draw) + '</span>' +
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
  const unfinished = (draw.winners || []).some(w => !lotIsSettled(w));
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
      '<button class="task-mini-btn" data-role="unpaired-to-nongroupbuy" data-draw-id="' + lotEscapeHtml(draw.id) + '">改為一般</button>' +
    '</div>'
  ) : (LOTTERY_ACCT_READY ? '' : '<div class="lot-unpaired-bind"><span class="hint">帳務欄位還沒 db push，暫時不能綁定</span></div>');

  // 或綁行事曆團購（帳務還沒建）：選了直接送出（不用另外按綁定鍵），沒有候選團購就整條不顯示
  const eventOptionsHtml = lotEventChoicesForUnpairedDraw(draw).map(ev =>
    '<option value="' + lotEscapeHtml(ev.eventId) + '">' + lotEscapeHtml(lotFmtEventRangeYMD(ev.startDate, ev.endDate)) + ' ' + lotEscapeHtml(ev.title || '') + '</option>'
  ).join('');
  const eventBindHtml = (LOTTERY_CAN_EDIT && LOTTERY_EVENT_CHOICES.length) ? (
    '<div class="lot-unpaired-bind">' +
      '<span class="hint">或綁行事曆團購：</span>' +
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
  const unfinished = (draw.winners || []).some(w => !lotIsSettled(w));
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
      if (lotIsClosed(w)) return;
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
  const rowCls = lotIsClosed(w) ? ' lot-wl-row-redrawn' : ''; // 已重抽／已放棄同一種淡化＋刪除線
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
      (!lotIsSettled(w) && w.status !== 'awaiting_announce' ? '<button class="lot-ic-btn" title="' + shipActionLabel + '" aria-label="' + shipActionLabel + '" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">' + lotIcon('check') + '</button>' : '') +
      (!lotIsClosed(w) ? '<button class="lot-ic-btn danger" title="重抽" aria-label="重抽" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">' + lotIcon('redo') + '</button>' : '')
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
  // 訂單編號放下行最前面＋核對結果（處理中的才提示「訂單庫沒有」，已結束的歷史資料只列編號不吵）；
  // 團購抽獎還在待聯絡／待回填卻沒填訂單編號 → 提醒補上（2026-10-03 雪莉：抽出來就要先填訂單編號）
  const orderParts = [];
  const orderNo = String(w.orderNo || '').trim();
  const settled = lotIsSettled(w);
  if (orderNo && orderNo !== '-') {
    const info = LOTTERY_ORDERS_READY && (w.order || !settled) ? lotOrderInfoHtml(w.order) : '';
    orderParts.push(sub('訂單', lotEscapeHtml(orderNo)) + (info ? '<span>' + info + '</span>' : ''));
  } else if (w.status === 'pending' || w.status === 'awaiting_info') {
    const d = LOTTERY_DRAWS.find(x => x.id === drawId);
    if (d && d.section === 'groupbuy') orderParts.push('<span class="lot-ord lot-ord-warn">還沒填訂單編號</span>');
  }
  const subHtml = orderParts.join('') + (subParts.length ? subParts.join('') : '<span class="lot-sub-empty">' + emptyMsg + '</span>');
  // 姓名還沒回填時，先淡字顯示訂單上的姓名（僅供辨識，不會寫回資料）
  const orderName = (!w.name && w.order && w.order.customerName)
    ? '<span class="lot-ord-name" title="訂單上的姓名（還沒回填）">' + lotEscapeHtml(w.order.customerName) + '</span>' : '';

  return '<div class="lot-wl-row' + rowCls + '">' +
    '<div class="lot-wl-main">' +
      '<span class="lot-wl-prize" title="' + lotEscapeHtml(w.prize) + '">' + lotEscapeHtml(w.prize) + typeTag + '</span>' +
      '<span class="lot-wl-who">' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : empty) + '</span>' +
      '<span class="lot-wl-status">' + statusSel + '</span>' +
      '<span class="lot-wl-name">' + (w.name ? lotEscapeHtml(w.name) : (orderName || empty)) + '</span>' +
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
    if (!lotSubtypeFilterOk(draw)) return;
    const team = draw.acctId ? lotTeamByAcctId(draw.acctId) : null;
    (draw.winners || []).forEach(w => {
      if (lotIsSettled(w)) return;
      if (!lotWinnerStatusFilterOk(w)) return;
      const q = lotSearchQuery();
      if (q) {
        const hay = [draw.title, draw.eventTitle, team && team.legacyId, team && team.title].concat([lotWinnerHay(w)]).map(x => String(x || '')).join(' ').toLowerCase();
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
    const teamLabel = (team ? lotTeamTitleHtml(team) : lotEscapeHtml(draw.eventTitle || draw.title || '')) + lotSubtypePillHtml(draw);
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
        nextBtns = '<button class="lot-next-btn" data-role="mark-awaiting-announce" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已完成（待公告）›</button>';
      } else if (w.status === 'awaiting_announce') {
        nextBtns = '<button class="lot-next-btn" data-role="todo-done" data-winner-id="' + lotEscapeHtml(w.id) + '">標記已公告 ›</button>';
      }
    }
    return '<tr>' +
      '<td>' + teamLabel + sheetRefTxt + '</td>' +
      lotPrizeCellHtml(w.prize) +
      '<td>' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle)
        : ((w.name || (w.order && w.order.customerName)) ? lotEscapeHtml(w.name || w.order.customerName)
          : (w.orderNo ? '<span class="lot-empty-cell">訂單 ' + lotEscapeHtml(w.orderNo) + '</span>' : '<span class="lot-empty-cell">—</span>'))) + '</td>' +
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
      lotRenderMain();
    });
  });
  // 複製鈕（表格電話／地址欄）：複製後圖示變綠 1.2 秒；stopPropagation 免得觸發同一列的展開
  box.querySelectorAll('[data-role="copy-text"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const txt = btn.dataset.copy || '';
      try { await navigator.clipboard.writeText(txt); }
      catch (err) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1200);
    });
  });
  box.querySelectorAll('[data-role="toggle-card"]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.cardKey;
      const cur = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, key) ? LOTTERY_EXPANDED_OVERRIDE[key] : false;
      LOTTERY_EXPANDED_OVERRIDE[key] = !cur;
      lotRenderMain();
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
      // 團可能只有行事曆團（沒有帳務列）：acctId 空、只有 eventId
      const team = el.dataset.acctId ? lotTeamByAcctId(el.dataset.acctId) : null;
      const eventId = el.dataset.eventId || (team && team.eventId) || '';
      if (!team && !eventId) return;
      const evc = eventId ? lotEventChoiceById(eventId) : null;
      const sib = LOTTERY_DRAWS.find(x => eventId && x.eventId === eventId);
      openLotteryDrawModal(null, {
        acctId: team ? team.acctId : ((evc && evc.acctId) || ''), eventId,
        brandId: (team && team.brandId) || (sib && sib.brandId) || '', brandName: (team && team.brandName) || (sib && sib.brandName) || '',
        title: (team && team.title) || (evc && evc.title) || (sib && (sib.eventTitle || sib.title)) || '', section: 'groupbuy'
      });
    });
  });
  // 待抽（行事曆團，後端 pendingEvents）：建立抽獎＝預帶這團；這團不抽＝寫到行事曆團
  box.querySelectorAll('[data-role="pending-event-create"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const pe = LOTTERY_PENDING_EVENTS.find(x => x.eventId === el.dataset.eventId);
      if (!pe) return;
      openLotteryDrawModal(null, { acctId: pe.acctId || '', eventId: pe.eventId, brandId: pe.brandId || '', brandName: pe.brandName || '', title: pe.title, section: 'groupbuy', drawDate: lotToday() });
    });
  });
  box.querySelectorAll('[data-role="pending-event-no-lottery"]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!confirm('確定這團不用抽獎嗎？（之後可打開篩選列「已標不抽」清單還原）')) return;
      lotSetEventNoLottery(el.dataset.eventId, true);
    });
  });
  box.querySelectorAll('[data-role="restore-event-no-lottery"]').forEach(el => {
    el.addEventListener('click', ev => { ev.stopPropagation(); lotSetEventNoLottery(el.dataset.eventId, false); });
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
      if (!confirm('確定把這場抽獎改成「一般」嗎？（小類需要重新選）')) return;
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
  box.querySelectorAll('[data-role="mark-awaiting-announce"]').forEach(el => {
    el.addEventListener('click', () => lotChangeStatus(el.dataset.winnerId, 'awaiting_announce'));
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
  // 匯款／寄出／發送後先進「已完成（待公告）」，等抽獎結果公告完再手動轉「已完成」（雪莉 09-29）
  lotApiPost('lottery-winner-upsert', { id: winnerId, status: 'awaiting_announce', shippedAt: lotToday() }).then(res => {
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
// 行事曆團的「這團不抽」（docs/16 §6.2 新端點；欄位未 push 後端會回「待 db push」）
function lotSetEventNoLottery(eventId, noLottery) {
  lotApiPost('lottery-event-no-lottery-set', { eventId, noLottery }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
  }).catch(err => alert('操作失敗：' + (err.message || err)));
}
// ===== 行事曆「檢視／編輯視窗」的抽獎區塊（docs/16 §7；兩個視窗共用這一份）=====
// boxEl＝容器；eventLegacyId＝這團的 legacy id（新團尚未存檔傳 ''）。資料沿用抽獎頁已載入的 LOTTERY_*（沒載入過就先抓一次，不切換畫面）。
const LOT_EVBOX_REG = new Map(); // boxEl -> eventLegacyId（資料更新時重畫用）
function lotEvboxNote(txt, warn) { return '<div class="lot-evbox-note' + (warn ? ' lot-evbox-warn' : '') + '">' + lotEscapeHtml(txt) + '</div>'; }
function lotEvboxBind(boxEl) {
  if (boxEl._lotBound) return;
  boxEl._lotBound = true;
  boxEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (!btn || !boxEl.contains(btn)) return;
    const role = btn.dataset.role;
    const legacy = String(LOT_EVBOX_REG.get(boxEl) || '');
    if (role === 'ev-edit-draw') {
      const d = LOTTERY_DRAWS.find(x => x.id === btn.dataset.drawId);
      if (d) openLotteryDrawModal(d);
    } else if (role === 'ev-add-draw') {
      const choice = LOTTERY_EVENT_CHOICES.find(c => String(c.legacyId) === legacy);
      const pe = LOTTERY_PENDING_EVENTS.find(x => String(x.legacyId) === legacy);
      const sib = LOTTERY_DRAWS.find(x => String(x.eventLegacyId || '') === legacy);
      const pf = { section: 'groupbuy', drawDate: lotToday(),
        brandId: (pe && pe.brandId) || (sib && sib.brandId) || '', brandName: (pe && pe.brandName) || (sib && sib.brandName) || '' };
      if (choice) { pf.eventId = choice.eventId; pf.acctId = choice.acctId || ''; pf.title = choice.title || ''; }
      else if (pe) { pf.eventId = pe.eventId; pf.acctId = pe.acctId || ''; pf.title = pe.title || ''; } // 開團日超過一年不在選單裡的待抽團
      openLotteryDrawModal(null, pf);
    } else if (role === 'ev-nl-set') {
      const choice = LOTTERY_EVENT_CHOICES.find(c => String(c.legacyId) === legacy);
      const pe = LOTTERY_PENDING_EVENTS.find(x => String(x.legacyId) === legacy) || LOTTERY_NO_LOTTERY_EVENTS.find(x => String(x.legacyId) === legacy);
      const eventId = (pe && pe.eventId) || (choice && choice.eventId);
      if (!eventId) { alert('找不到這團的資料，請重新整理後再試'); return; }
      const noLottery = btn.dataset.no === '1';
      if (noLottery && !confirm('確定這團不用抽獎嗎？（之後可在這裡按「還原」）')) return;
      lotSetEventNoLottery(eventId, noLottery);
    }
  });
}
// 用已載入的資料同步畫出內容
function lotEvboxDraw(boxEl) {
  const legacy = String(LOT_EVBOX_REG.get(boxEl) || '');
  if (!legacy) { boxEl.innerHTML = lotEvboxNote('存檔後才能加抽獎'); return; }
  if (!LOTTERY_TABLE_READY) { boxEl.innerHTML = lotEvboxNote('抽獎資料表尚未建立，暫時不能使用。', true); return; }
  const canEdit = typeof hasEditPerm !== 'function' || hasEditPerm('lotteryEdit');
  const draws = LOTTERY_DRAWS.filter(d => String(d.eventLegacyId || '') === legacy && !d.archived);
  const pe = LOTTERY_PENDING_EVENTS.find(x => String(x.legacyId) === legacy);
  const nl = LOTTERY_NO_LOTTERY_EVENTS.find(x => String(x.legacyId) === legacy);
  const choice = LOTTERY_EVENT_CHOICES.find(c => String(c.legacyId) === legacy);
  let html = '';
  if (pe && !draws.length) html += lotEvboxNote('這團已結團 14 天，還沒建抽獎', true);
  if (nl && !draws.length) {
    html += lotEvboxNote('已標記這團不抽');
    if (canEdit && LOTTERY_EVENT_NL_READY) html += '<div class="lot-evbox-actions"><button type="button" class="task-mini-btn" data-role="ev-nl-set" data-no="0">還原</button></div>';
  } else {
    draws.forEach(d => {
      const n = lotDrawnCount(d), quota = lotDrawQuota(d);
      const p = lotProgressOf([d]);
      const prog = !p.total ? '尚未抽出' : (p.pending ? '待處理 ' + p.pending : '已完成');
      html += '<div class="lot-evbox-row">' +
        '<span class="lot-evbox-title">' + lotEscapeHtml(d.title || d.prize || '(未命名活動)') + '</span>' + lotSubtypePillHtml(d) +
        '<span class="lot-evbox-meta' + ((quota !== null && n < quota) ? ' lot-quota-short' : '') + '">' + (quota !== null ? '已抽 ' + n + '／' + quota : '已抽 ' + n + ' 位') + '</span>' +
        '<span class="lot-evbox-meta">' + lotEscapeHtml(prog) + '</span>' +
        (canEdit ? '<button type="button" class="task-mini-btn" data-role="ev-edit-draw" data-draw-id="' + lotEscapeHtml(d.id) + '">編輯</button>' : '') +
      '</div>';
    });
    if (!draws.length && !pe) html += lotEvboxNote('還沒有抽獎');
    if (canEdit) {
      if (!choice && !pe) html += lotEvboxNote('找不到這團的團購資料，新增時請在視窗裡自己選團', true);
      html += '<div class="lot-evbox-actions">' +
        (LOTTERY_TABLE_READY ? '<button type="button" class="task-mini-btn" data-role="ev-add-draw">＋ 新增抽獎</button>' : '') +
        ((!draws.length && LOTTERY_EVENT_NL_READY) ? '<button type="button" class="task-mini-btn" data-role="ev-nl-set" data-no="1">這團不抽</button>' : '') +
      '</div>';
    }
  }
  boxEl.innerHTML = html;
}
async function lotRenderEventLotteryBox(boxEl, eventLegacyId, opts) {
  if (!boxEl) return;
  opts = opts || {};
  const section = opts.sectionEl || boxEl.parentElement;
  const canView = typeof hasPerm !== 'function' || hasPerm('lotteryEdit');
  if (!canView) {
    boxEl.innerHTML = '';
    LOT_EVBOX_REG.delete(boxEl);
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';
  lotEvboxBind(boxEl);
  const legacy = String(eventLegacyId === null || eventLegacyId === undefined ? '' : eventLegacyId);
  const seq = (boxEl._lotSeq = (boxEl._lotSeq || 0) + 1);
  LOT_EVBOX_REG.set(boxEl, legacy);
  if (legacy && !LOTTERY_LOADED) {
    boxEl.innerHTML = lotEvboxNote('讀取中…');
    try { await loadLotteryView(false); } catch (e) { /* 下面統一判斷 */ }
    if (seq !== boxEl._lotSeq) return; // 期間視窗已換成別團
    if (!LOTTERY_LOADED) { boxEl.innerHTML = lotEvboxNote('抽獎資料讀取失敗，請稍後再開一次視窗。', true); return; }
  }
  lotEvboxDraw(boxEl);
}
LOT_DATA_CHANGED_CBS.push(() => {
  LOT_EVBOX_REG.forEach((legacy, el) => {
    if (legacy && el.isConnected && el.parentElement && el.parentElement.style.display !== 'none') lotEvboxDraw(el);
  });
});

function lotSetNoLottery(acctId, noLottery) {
  lotApiPost('lottery-acct-no-lottery-set', { acctId, noLottery }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
// 複製通知文：只用暱稱＋獎品，待聯絡／待回填資料的得獎人才列入，不含個資。
// 還沒有暱稱（抽出來只先填了訂單編號）→ 改用「訂單編號末 5 碼」稱呼，不露整串編號
function lotBuildNotifyText(draw) {
  return (draw.winners || [])
    .filter(w => w.status === 'pending' || w.status === 'awaiting_info')
    .map(w => {
      const h = String(w.winnerHandle || '').trim();
      const digits = ((String(w.orderNo || '').split(/[^A-Za-z0-9]+/).filter(t => t.length >= 8).sort((a, b) => b.length - a.length)[0]) || '');
      const who = h ? (h.startsWith('@') ? h : '@' + h) : (digits ? '訂單編號末五碼 ' + digits.slice(-5) : '@');
      return who + ' 恭喜抽中「' + (w.prize || '') + '」，請私訊姓名電話地址';
    })
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
    if (team.pendingDraw || LOTTERY_PENDING_EVENTS.some(e => e.acctId === team.acctId)) return { label: '待抽', cls: 'lot-acct-badge-draw' };
    if (LOTTERY_NO_LOTTERY_EVENTS.some(e => e.acctId === team.acctId)) return { label: '不抽', cls: 'lot-acct-badge-off' };
    return null;
  }
  const winners = draws.flatMap(d => d.winners || []);
  const pending = winners.filter(w => !lotIsSettled(w));
  if (!pending.length) return { label: '已完成 ' + winners.length, cls: 'lot-acct-badge-done' };
  return { label: '待處理 ' + pending.length, cls: 'lot-acct-badge-pending' };
}
// 點帳務明細列上的抽獎小標：切到「抽獎管理」分頁，捲到並閃一下該團那一列（.lot-tr[data-acct-id]）。
// 找不到就停在分頁頂端；第一次找不到時暫時放寬篩選（不寫入 localStorage）再找一次，免得被預設年份／隱藏已完成擋住。
function lotJumpToAcctTeamCard(legacyId) {
  if (typeof switchView === 'function') switchView('lottery');
  if (LOTTERY_MAIN_TAB !== 'draws') { // 團的抽獎在「抽獎」分頁
    LOTTERY_MAIN_TAB = 'draws'; lotSaveMainTab('draws'); lotSyncMainTabUI();
    if (LOTTERY_LOADED) { renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody(); }
  }
  const scrollTo = retried => {
    const team = lotTeamByLegacyId(legacyId);
    if (!team) return;
    const find = () => document.querySelector('#lotBody .lot-tr[data-acct-id="' + team.acctId + '"]');
    let el = find();
    if (!el && !retried) {
      LOTTERY_FILTER.status = 'all'; LOTTERY_FILTER.brand = ''; LOTTERY_FILTER.year = ''; LOTTERY_FILTER.q = ''; LOTTERY_FILTER.subtype = '';
      LOTTERY_HIDE_DONE = false; LOTTERY_SHOW_NO_LOTTERY = true; LOTTERY_VIEW = 'cards';
      LOTTERY_SECTION_COLLAPSED.groupbuy = false;
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
      el = find();
    }
    if (!el) return;
    const key = el.dataset.cardKey;
    if (key && !LOTTERY_EXPANDED_OVERRIDE[key]) {
      LOTTERY_EXPANDED_OVERRIDE[key] = true;
      renderLotterySections();
      el = find() || el;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('lot-flash');
    setTimeout(() => el.classList.remove('lot-flash'), 1600);
  };
  if (LOTTERY_LOADED) setTimeout(() => scrollTo(false), 60);
  else loadLotteryView().then(() => scrollTo(false)).catch(() => {});
}

// ===== 新增／編輯抽獎 modal =====
// prefill：只在 draw=null（新增）時用，來自團卡「＋這團加開一場抽獎」／待抽虛擬卡「＋建立抽獎」，
// 預帶 {acctId,brandId,title,section,drawDate}；不是既有活動，不會把 LOTTERY_EDIT_DRAW_ID 設成別的 id。
// LOT_DRAW_TITLE_OVERRIDE：團購分區下標題預設自動產生（「M月 品牌」，由後端算）；使用者點「改」
// 才顯示標題輸入框並手動接管，這個旗標記著目前是不是手動接管中。每次開視窗重置。
let LOT_DRAW_TITLE_OVERRIDE = false;
let LOT_DRAW_ORIG_SECTION = '';           // 編輯中活動原本的大類（從特殊活動改成綁團／一般時，小類必選）
let LOT_DRAW_ORIG_SUBTYPE = '';           // 編輯中活動原本的小類（''＝原本就未分類，這種可以維持未分類存檔）
let LOT_DRAW_INIT = { eventId: '', acctId: '' }; // 開視窗當下的團綁定，存檔時選的行事曆團沒帶 acctId 就沿用同一團的
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
  // 小類：依大類換選項；新增必選；舊資料沒小類時多一個「未分類」並預選
  LOT_DRAW_ORIG_SUBTYPE = draw ? lotDrawSubtype(draw) : '';
  LOT_DRAW_ORIG_SECTION = draw ? section : '';
  lotRenderSubtypeOptions(section, draw ? lotDrawSubtype(draw) : ((pf && pf.subtype) || ''));

  // 名額（選填）：欄位未 push 時整欄隱藏
  const quotaGroup = document.getElementById('lotDrawQuotaGroup');
  if (quotaGroup) quotaGroup.style.display = LOTTERY_QUOTA_READY ? '' : 'none';
  const quotaInput = document.getElementById('lotDrawQuotaInput');
  if (quotaInput) quotaInput.value = (draw && draw.quota !== null && draw.quota !== undefined && draw.quota !== '') ? draw.quota : '';

  const brandSel = document.getElementById('lotDrawBrandSelect');
  brandSel.innerHTML = '<option value="">（不指定）</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '">' + lotEscapeHtml(b.name) + '</option>'
  ).join('');
  brandSel.value = draw ? (draw.brandId || '') : (pf ? (pf.brandId || '') : '');
  if (!brandSel.value && pf && pf.brandName) {
    const byName = LOTTERY_BRAND_CHOICES.find(b => b.name === pf.brandName);
    if (byName) brandSel.value = byName.id;
  }

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

  // 團下拉（docs/16 §6.3）：行事曆團優先——有 eventId 選 event:；只有 acctId 時，若該帳務團連著行事曆團也選那個 event:，
  // 否則才選 acct:（行事曆時代以前的舊團）
  const bindSrc = draw || pf || {};
  let boundValue = '';
  if (bindSrc.eventId) boundValue = 'event:' + bindSrc.eventId;
  else if (bindSrc.acctId) {
    const bt = lotTeamByAcctId(bindSrc.acctId);
    boundValue = (bt && bt.eventId) ? 'event:' + bt.eventId : 'acct:' + bindSrc.acctId;
  }
  LOT_DRAW_INIT = { eventId: bindSrc.eventId || '', acctId: bindSrc.acctId || '' };
  document.getElementById('lotDrawAcctSearchInput').value = '';
  // 開啟當下表單欄位還沒填入這次的資料（品牌/標題/日期在上面剛設），排序脈絡直接用 draw/prefill，避免吃到上一次開視窗的殘值
  const src = draw || pf || {};
  lotFillDrawAcctSelect('', boundValue, { brandId: src.brandId || '', title: src.title || '', drawDate: src.drawDate || '', eventTitle: draw ? (draw.eventTitle || '') : '' });

  // 依分區顯示/隱藏團購欄位＋標題自動產生 UI（讀取上面剛設好的 lotDrawTitleInput 值）
  lotSyncDrawSectionUI();
  // 特殊活動下拉：編輯預選 draw.activityId、新增預選 prefill.activityId
  lotRenderActivityOptions(draw ? (draw.activityId || '') : ((pf && pf.activityId) || ''));
  lotInitRuleSection(draw);

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

// 小類選項（依大類）。selected＝要預選的值；選項順序＝LOT_SUBTYPES_BY_SECTION。
// 第一個空值選項：原本就未分類的舊資料＝「未分類」（可維持）；其餘＝「（請選擇）」（存檔時擋下）。
function lotRenderSubtypeOptions(section, selected) {
  const group = document.getElementById('lotDrawSubtypeGroup');
  const sel = document.getElementById('lotDrawSubtypeSelect');
  const warn = document.getElementById('lotDrawSubtypeReadyWarn');
  if (!group || !sel) return;
  const list = LOT_SUBTYPES_BY_SECTION[section] || [];
  if (warn) warn.style.display = (!LOTTERY_SUBTYPE_READY && list.length) ? '' : 'none';
  if (!LOTTERY_SUBTYPE_READY || !list.length) { group.style.display = 'none'; sel.innerHTML = ''; return; }
  group.style.display = '';
  const emptyLabel = (LOTTERY_EDIT_DRAW_ID && LOT_DRAW_ORIG_SUBTYPE === '') ? '未分類' : '（請選擇）';
  sel.innerHTML = '<option value="">' + emptyLabel + '</option>' +
    list.map(k => '<option value="' + k + '">' + LOT_SUBTYPE_LABEL[k] + '</option>').join('');
  sel.value = list.indexOf(selected) !== -1 ? selected : '';
}
// 分區改了：目前小類對新分區不合法就清空（選項重畫會自動處理）
function lotSyncDrawSubtypeUI() {
  const sel = document.getElementById('lotDrawSubtypeSelect');
  lotRenderSubtypeOptions(document.getElementById('lotDrawSectionSelect').value, sel ? sel.value : '');
}
// 特殊活動下拉：只在大類＝特殊活動且活動表就緒時顯示；選項＝activities（名稱＋期間）
function lotRenderActivityOptions(selected) {
  const group = document.getElementById('lotDrawActivityGroup');
  const sel = document.getElementById('lotDrawActivitySelect');
  if (!group || !sel) return;
  const show = LOTTERY_ACTIVITIES_READY && document.getElementById('lotDrawSectionSelect').value === 'special';
  group.style.display = show ? '' : 'none';
  if (!show) { sel.innerHTML = ''; return; }
  sel.innerHTML = '<option value="">（請選擇）</option>' + LOTTERY_ACTIVITIES.map(a =>
    '<option value="' + lotEscapeHtml(a.id) + '">' + lotEscapeHtml(lotActivityOptionLabel(a)) + '</option>').join('');
  sel.value = LOTTERY_ACTIVITIES.some(a => a.id === selected) ? selected : '';
}
// ----- 第 4 期：小活動資格規則＋獎品清單（大類＝特殊活動且 campaignReady 才顯示）-----
let LOT_PRIZE_ITEMS_ORIG = '[]';
function lotRuleSectionOn() {
  return LOTTERY_CAMPAIGN_READY && document.getElementById('lotDrawSectionSelect').value === 'special';
}
function lotSyncRuleSectionUI() {
  document.getElementById('lotDrawRuleGroup').style.display = lotRuleSectionOn() ? '' : 'none';
}
function lotInitRuleSection(draw) {
  const d = draw || {};
  document.getElementById('lotDrawRuleModeSelect').value = d.ruleMode || '';
  document.getElementById('lotDrawRuleThresholdInput').value = (d.ruleThreshold || d.ruleThreshold === 0) ? d.ruleThreshold : '';
  document.getElementById('lotDrawMaxWinsInput').value = (d.maxWins || d.maxWins === 0) ? d.maxWins : '';
  const rows = document.getElementById('lotPrizeItemsRows');
  rows.innerHTML = '';
  const items = Array.isArray(d.prizeItems) ? d.prizeItems.slice().sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0)) : [];
  items.forEach(it => lotAddPrizeItemRow(it));
  LOT_PRIZE_ITEMS_ORIG = JSON.stringify(lotCollectPrizeItems(false).items);
  lotUpdatePrizeItemsTotal();
  lotSyncRuleSectionUI();
}
function lotUpdatePrizeItemsTotal() {
  let kinds = 0, total = 0;
  document.querySelectorAll('#lotPrizeItemsRows .lot-prize-row').forEach(r => {
    kinds++; total += Number(r.querySelector('[data-f="qty"]').value) || 0;
  });
  document.getElementById('lotPrizeItemsTotal').textContent = kinds ? '（' + kinds + ' 種，共 ' + total + ' 份）' : '';
}
function lotAddPrizeItemRow(it) {
  it = it || {};
  const row = document.createElement('div');
  row.className = 'lot-prize-row';
  if (it.id) row.dataset.itemId = it.id;
  const type = it.prizeType || '';
  row.innerHTML =
    '<input type="text" data-f="name" maxlength="80" placeholder="獎品名稱" value="' + lotEscapeHtml(it.name || '') + '">' +
    '<input type="number" data-f="qty" min="1" max="9999" step="1" placeholder="數量" value="' + lotEscapeHtml(it.qty === undefined || it.qty === null ? 1 : it.qty) + '">' +
    '<select data-f="type"><option value="">跟活動</option><option value="physical"' + (type === 'physical' ? ' selected' : '') + '>實體</option><option value="cash"' + (type === 'cash' ? ' selected' : '') + '>現金</option><option value="virtual"' + (type === 'virtual' ? ' selected' : '') + '>虛擬</option></select>' +
    '<input type="number" data-f="cash" min="0" step="1" placeholder="現金金額" style="width:96px; flex:none;' + (type === 'cash' ? '' : ' display:none;') + '" value="' + lotEscapeHtml(it.cashAmount === undefined || it.cashAmount === null ? '' : it.cashAmount) + '">' +
    '<button type="button" class="task-mini-btn x-btn" title="刪除這種獎品" aria-label="刪除這種獎品" style="flex:none; padding:2px 8px;">✕</button>';
  row.querySelector('[data-f="type"]').addEventListener('change', e => {
    row.querySelector('[data-f="cash"]').style.display = e.target.value === 'cash' ? '' : 'none';
  });
  row.querySelector('[data-f="qty"]').addEventListener('input', lotUpdatePrizeItemsTotal);
  row.querySelector('button').addEventListener('click', () => { row.remove(); lotUpdatePrizeItemsTotal(); });
  document.getElementById('lotPrizeItemsRows').appendChild(row);
}
// validate=true 時回傳 {error}；false 時只收集（不驗證，用來取開窗基準）
function lotCollectPrizeItems(validate) {
  const items = [];
  const rows = document.querySelectorAll('#lotPrizeItemsRows .lot-prize-row');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = r.querySelector('[data-f="name"]').value.trim();
    const qtyRaw = r.querySelector('[data-f="qty"]').value.trim();
    const prizeType = r.querySelector('[data-f="type"]').value || '';
    const cashRaw = r.querySelector('[data-f="cash"]').value.trim();
    if (validate) {
      if (!name) return { error: '第 ' + (i + 1) + ' 種獎品請填名稱（不需要的請按 ✕ 刪掉）' };
      if (!/^\d+$/.test(qtyRaw) || Number(qtyRaw) < 1 || Number(qtyRaw) > 9999) return { error: '「' + name + '」的數量要填 1～9999 的整數' };
      if (cashRaw !== '' && !/^\d+$/.test(cashRaw)) return { error: '「' + name + '」的現金金額只能填數字' };
    }
    const it = { name, qty: Number(qtyRaw) || 0, prizeType, cashAmount: (prizeType === 'cash' && cashRaw !== '') ? Number(cashRaw) : null };
    if (r.dataset.itemId) it.id = r.dataset.itemId;
    items.push(it);
  }
  return { items };
}
document.getElementById('lotPrizeItemAddBtn').addEventListener('click', () => { lotAddPrizeItemRow(null); lotUpdatePrizeItemsTotal(); });
function lotSyncDrawSectionUI() {
  const groupbuy = document.getElementById('lotDrawSectionSelect').value === 'groupbuy';
  lotSyncRuleSectionUI();
  lotSyncDrawSubtypeUI();
  { const aSel = document.getElementById('lotDrawActivitySelect'); lotRenderActivityOptions(aSel ? aSel.value : ''); }
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
// 團下拉（docs/16 §6.3）：第一個 optgroup「行事曆團購」＝全部行事曆團（後端 eventChoices，含已建帳務的；
// 標籤「YYYY/M/D 團名」，value "event:<eventId>"）；第二個 optgroup「舊團（只有帳務）」＝帳務根列裡沒連行事曆團的
// （value "acct:<acctId>"）；空字串＝不綁。
// ctx（可省略）：{brandId,title,drawDate,eventTitle} 明確指定排序依據＋selectedValue 已不在候選
// 清單裡時的備援標題；沒給就讀 modal 目前表單值（品牌／標題／抽獎日）
function lotEventOptionLabel(ev) {
  return (ev.startDate ? lotFmtYMD(ev.startDate) + ' ' : '（無日期）') + (ev.title || '');
}
function lotFillDrawAcctSelect(filterText, selectedValue, ctx) {
  const sel = document.getElementById('lotDrawAcctSelect');
  const q = (filterText || '').trim().toLowerCase();
  const rankCtx = ctx || {
    brandId: document.getElementById('lotDrawBrandSelect').value,
    title: document.getElementById('lotDrawTitleInput').value,
    drawDate: document.getElementById('lotDrawDateInput').value
  };

  const filteredAcct = LOTTERY_ACCT_TEAMS.filter(t => !t.eventId && (!q || (t.legacyId || '').toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q) || (t.brandName || '').toLowerCase().includes(q)));
  const acctList = lotRankAcctTeams(filteredAcct, rankCtx);

  const brandName = rankCtx.brandId ? ((LOTTERY_BRAND_CHOICES.find(b => b.id === rankCtx.brandId) || {}).name || '') : '';
  const eventListAll = lotEventChoicesForUnpairedDraw({ brandName, title: rankCtx.title, drawDate: rankCtx.drawDate });
  const eventList = eventListAll.filter(ev => !q || (ev.title || '').toLowerCase().includes(q) || (ev.brandName || '').toLowerCase().includes(q));

  let html = '<option value="">（不綁）</option>';
  const parts = selectedValue ? String(selectedValue).split(':') : ['', ''];
  const selKind = parts[0], selId = parts[1];
  if (selKind === 'acct' && selId && !acctList.some(t => t.acctId === selId)) {
    const cur = lotTeamByAcctId(selId);
    if (cur) html += '<option value="acct:' + lotEscapeHtml(selId) + '" selected>' + lotEscapeHtml(lotAcctTeamOptionLabel(cur)) + '</option>';
  } else if (selKind === 'event' && selId && !eventList.some(ev => ev.eventId === selId)) {
    const cur = lotEventChoiceById(selId);
    const label = cur ? lotEventOptionLabel(cur) : ((ctx && ctx.eventTitle) || selId);
    html += '<option value="event:' + lotEscapeHtml(selId) + '" selected>' + lotEscapeHtml(label) + '</option>';
  }
  if (eventList.length) {
    html += '<optgroup label="行事曆團購">' + eventList.map(ev =>
      '<option value="event:' + lotEscapeHtml(ev.eventId) + '">' + lotEscapeHtml(lotEventOptionLabel(ev)) + '</option>'
    ).join('') + '</optgroup>';
  }
  if (acctList.length) {
    html += '<optgroup label="舊團（只有帳務）">' + acctList.map(t =>
      '<option value="acct:' + lotEscapeHtml(t.acctId) + '">' + lotEscapeHtml(lotAcctTeamOptionLabel(t)) + '</option>'
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
    if (ev && ev.brandId && LOTTERY_BRAND_CHOICES.some(b => b.id === ev.brandId)) document.getElementById('lotDrawBrandSelect').value = ev.brandId;
  }
  lotSyncDrawTitleUI();
});

// ===== 新增抽獎：得獎人快速輸入列（訂單編號＋獎品＋得獎人，狀態固定待聯絡）=====
// 訂單編號排第一欄（2026-10-03 雪莉：抽出來就要先填，才知道是這團的哪一筆訂單），輸入後即時核對。
// 獎品欄預帶目前「活動獎品」欄位的值；沒有手動指定 prize（data.prize 空）時標記 data-auto=1，
// 之後活動獎品欄改了會同步跟著改，使用者一旦直接編輯這一列的獎品欄就解除同步（見下面的 input 監聽）。
// 目前表單選的團（給訂單核對用）：非團購分區或沒選團＝{}（只查有沒有這筆、不判斷是不是這團）
function lotDrawFormTeamCtx() {
  if ((document.getElementById('lotDrawSectionSelect').value || 'groupbuy') !== 'groupbuy') return {};
  const parts = (document.getElementById('lotDrawAcctSelect').value || '').split(':');
  if (parts[0] === 'acct' && parts[1]) return { acctId: parts[1] };
  if (parts[0] === 'event' && parts[1]) return { eventId: parts[1] };
  return {};
}
function addLotWinnerFormRow(data) {
  const wrap = document.getElementById('lotWinnerRows');
  const row = document.createElement('div');
  row.className = 'lot-winner-row';

  const drawPrize = document.getElementById('lotDrawPrizeInput').value.trim();
  const explicitPrize = data && data.prize;

  const order = document.createElement('input');
  order.type = 'text';
  order.className = 'lot-row-order';
  order.placeholder = '訂單編號';
  order.value = (data && data.orderNo) || '';
  row.appendChild(order);

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
  handle.placeholder = '暱稱／帳號（可先空著）';
  handle.value = (data && data.winnerHandle) || '';
  row.appendChild(handle);

  // 「待聯絡」小標拿掉（2026-10-03）：位置讓給訂單編號欄，狀態說明在上方提示文字

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'task-mini-btn x-btn';
  del.style.cssText = 'flex:none; padding:2px 8px;';
  del.textContent = '✕';
  del.addEventListener('click', () => row.remove());
  row.appendChild(del);

  const hint = document.createElement('div');
  hint.className = 'lot-order-hint';
  row.appendChild(hint);
  lotBindOrderLookup(order, hint, lotDrawFormTeamCtx);

  wrap.appendChild(row);
  if (order.value) order._lotLookup();
}
// 換團／換分區後，已經填了訂單編號的列重新核對一次（是不是「這團」的答案會變）
function lotRecheckWinnerFormRows() {
  document.querySelectorAll('#lotWinnerRows .lot-row-order').forEach(input => { if (input._lotLookup) input._lotLookup(); });
}
document.getElementById('lotDrawAcctSelect').addEventListener('change', lotRecheckWinnerFormRows);
document.getElementById('lotDrawSectionSelect').addEventListener('change', lotRecheckWinnerFormRows);
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
    orderNo: row.querySelector('.lot-row-order').value.trim(),
    prize: row.querySelector('.lot-row-prize').value.trim() || drawPrize,
    winnerHandle: row.querySelector('.lot-row-handle').value.trim()
  })).filter(r => r.prize);
}

document.getElementById('lotAddWinnerRowBtn').addEventListener('click', () => addLotWinnerFormRow(null));
document.getElementById('lotPasteToggleBtn').addEventListener('click', () => {
  const box = document.getElementById('lotPasteBox');
  box.style.display = box.style.display === 'none' ? '' : 'none';
});
// 貼上模式拆行規則：一行一位，各段用 Tab／全形空白／連續兩個以上半形空白隔開。
// 第一個「像訂單編號」的段落（8 碼以上英數、至少 6 個數字，可帶「52.」這類序號前綴）當訂單編號；
// 其餘段落照舊：兩段＝前段獎品、後段得獎人，一段＝得獎人（獎品用活動獎品欄，見 addLotWinnerFormRow）。
// 只貼訂單編號也可以（暱稱之後再補）。
document.getElementById('lotPasteParseBtn').addEventListener('click', () => {
  const raw = document.getElementById('lotPasteArea').value;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let ok = 0;
  lines.forEach(line => {
    const parts = line.split(/\t+|　+| {2,}/).map(p => p.trim()).filter(Boolean);
    // @ 開頭的帳號、手機號碼（LINE ID 常見）就算一長串數字也不是訂單編號
    const orderIdx = parts.findIndex(p => !/^@/.test(p) && !/^09\d{8}$/.test(p) && lotLooksLikeOrderNo(p));
    const orderNo = orderIdx === -1 ? '' : parts.splice(orderIdx, 1)[0];
    if (parts.length >= 2) {
      addLotWinnerFormRow({ orderNo, prize: parts[0], winnerHandle: parts.slice(1).join(' ') });
    } else {
      addLotWinnerFormRow({ orderNo, winnerHandle: parts[0] || '' });
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
  let prize = document.getElementById('lotDrawPrizeInput').value.trim();
  // 特殊活動小活動有獎品清單時，「獎品」文字欄可空：自動用清單名稱串起來（10-10，避免同一件事填兩次）
  if (!prize && section === 'special' && typeof LOTTERY_CAMPAIGN_READY !== 'undefined' && LOTTERY_CAMPAIGN_READY) {
    const pi = lotCollectPrizeItems(false);
    const names = ((pi && pi.items) || []).map(x => x.name).filter(Boolean);
    if (names.length) prize = names.join('、');
  }
  if (!prize) { lotSetStatus('lotDrawFormStatus', '請填寫獎品（或在下方獎品清單加一種）', 'error'); return; }

  const teamVal = document.getElementById('lotDrawAcctSelect').value || '';
  const teamParts = teamVal ? teamVal.split(':') : ['', ''];
  const teamKind = teamParts[0], teamId = teamParts[1];
  // 2026-10-10：綁團抽獎一定要連一團（新增時必選；編輯舊的待配對資料不擋）
  if (section === 'groupbuy' && !teamVal && !LOTTERY_EDIT_DRAW_ID) { lotSetStatus('lotDrawFormStatus', '請選擇團購', 'error'); return; }
  const cashAmountRaw = document.getElementById('lotDrawCashAmountInput').value;

  // 名額（選填）：空＝清空；有值須為 1–999 整數
  let quotaVal = '';
  if (LOTTERY_QUOTA_READY) {
    const qRaw = (document.getElementById('lotDrawQuotaInput').value || '').trim();
    if (qRaw !== '') {
      if (!/^\d+$/.test(qRaw) || Number(qRaw) < 1 || Number(qRaw) > 999) { lotSetStatus('lotDrawFormStatus', '名額只能填 1～999 的整數', 'error'); return; }
      quotaVal = String(Number(qRaw));
    }
  }

  // 小類：欄位已 push 且不是特殊活動時，新增必選（編輯時原本就未分類的舊資料可維持未分類）
  let subtypeVal = '';
  if (LOTTERY_SUBTYPE_READY && section !== 'special') {
    subtypeVal = document.getElementById('lotDrawSubtypeSelect').value || '';
    if (!subtypeVal && (!LOTTERY_EDIT_DRAW_ID || LOT_DRAW_ORIG_SUBTYPE !== '' || LOT_DRAW_ORIG_SECTION !== section)) { lotSetStatus('lotDrawFormStatus', '請選擇小類', 'error'); return; }
  }
  // 特殊活動：新增（或從別的大類改成特殊活動）必選
  let activityVal = '';
  if (LOTTERY_ACTIVITIES_READY && section === 'special') {
    activityVal = document.getElementById('lotDrawActivitySelect').value || '';
    if (!activityVal && (!LOTTERY_EDIT_DRAW_ID || LOT_DRAW_ORIG_SECTION !== 'special')) { lotSetStatus('lotDrawFormStatus', '請選擇特殊活動', 'error'); return; }
  }
  // 連團：選行事曆團 → eventId＝它、acctId＝該團 choice 的 acctId（沒有就沿用開視窗時同一團的 acctId，否則 ''）；
  // 選舊團 → acctId＝它、eventId ''
  let payloadAcctId = null, payloadEventId = '';
  if (section === 'groupbuy' && teamKind === 'event' && teamId) {
    const choice = lotEventChoiceById(teamId);
    payloadEventId = teamId;
    payloadAcctId = (choice && choice.acctId) || (teamId === LOT_DRAW_INIT.eventId ? LOT_DRAW_INIT.acctId : '') || '';
  } else if (section === 'groupbuy' && teamKind === 'acct' && teamId) {
    payloadAcctId = teamId;
  }

  const payload = {
    section,
    acctId: payloadAcctId,
    eventId: payloadEventId,
    brandId: document.getElementById('lotDrawBrandSelect').value || null,
    drawDate: document.getElementById('lotDrawDateInput').value || null,
    dateUncertain: document.getElementById('lotDrawDateUncertain').checked,
    shipBy: document.getElementById('lotDrawShipBySelect').value,
    note: document.getElementById('lotDrawNoteInput').value.trim(),
    prizeType: document.getElementById('lotDrawPrizeTypeSelect').value || 'physical',
    prize,
    cashAmount: cashAmountRaw.trim() === '' ? null : cashAmountRaw.trim()
  };
  if (LOTTERY_SUBTYPE_READY) payload.subtype = section === 'special' ? '' : subtypeVal; // 欄位未 push 時不送，免得後端回「待 db push」
  if (LOTTERY_QUOTA_READY) payload.quota = quotaVal; // 欄位未 push 時不送，免得後端回「待 db push」
  if (LOTTERY_ACTIVITIES_READY) payload.activityId = section === 'special' ? activityVal : ''; // 活動表未就緒時不送
  if (titleTouched) payload.title = title;
  if (LOTTERY_EDIT_DRAW_ID) payload.id = LOTTERY_EDIT_DRAW_ID;

  // 第 4 期：資格規則＋獎品清單（只有特殊活動小活動；驗證在送出前）
  let prizeItemsToSave = null;
  if (lotRuleSectionOn()) {
    const ruleMode = document.getElementById('lotDrawRuleModeSelect').value || '';
    const thRaw = document.getElementById('lotDrawRuleThresholdInput').value.trim();
    const mwRaw = document.getElementById('lotDrawMaxWinsInput').value.trim();
    if (ruleMode && (!/^\d+$/.test(thRaw) || Number(thRaw) < 1)) { lotSetStatus('lotDrawFormStatus', '選了資格規則就要填門檻金額（正整數）', 'error'); return; }
    if (thRaw !== '' && !/^\d+$/.test(thRaw)) { lotSetStatus('lotDrawFormStatus', '門檻金額只能填正整數', 'error'); return; }
    if (mwRaw !== '' && (!/^\d+$/.test(mwRaw) || Number(mwRaw) < 1 || Number(mwRaw) > 99)) { lotSetStatus('lotDrawFormStatus', '每人最多中幾次只能填 1～99 的整數，或留空', 'error'); return; }
    const col = lotCollectPrizeItems(true);
    if (col.error) { lotSetStatus('lotDrawFormStatus', col.error, 'error'); return; }
    payload.ruleMode = ruleMode;
    payload.ruleThreshold = ruleMode ? Number(thRaw) : null;
    payload.maxWins = mwRaw === '' ? null : Number(mwRaw);
    if (JSON.stringify(col.items) !== LOT_PRIZE_ITEMS_ORIG) prizeItemsToSave = col.items;
  }

  // 團購抽獎：抽出來就要先填訂單編號（2026-10-03 雪莉）。沒填的列提醒一次、不強制擋（有些團是留言抽獎沒有訂單）
  if (!LOTTERY_EDIT_DRAW_ID && section === 'groupbuy') {
    const missing = collectLotWinnerFormRows().filter(r => !r.orderNo).length;
    if (missing && !confirm('有 ' + missing + ' 位得獎人還沒填訂單編號。\n\n綁團抽獎建議抽出來就先填中獎的訂單編號，之後才對得到是哪一筆訂單。\n\n確定要先這樣儲存嗎？')) return;
  }

  const btn = document.getElementById('lotDrawSaveBtn');
  btn.disabled = true;
  lotSetStatus('lotDrawFormStatus', '儲存中…', '');
  let drawSaved = false;
  try {
    const res = await lotApiPost('lottery-draw-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    drawSaved = true;
    const drawId = res.draw && res.draw.id;
    // 抽獎本身已存好之後的步驟（獎品清單、得獎人）失敗：不能讓視窗停在「新增」狀態——再按一次儲存會多建一場重複的抽獎（10-10 驗收抓到）。
    // 改成照樣把能存的存完、關視窗重新載入，再告訴使用者哪一步沒存到、去哪裡補。
    const laterErrors = [];
    if (prizeItemsToSave && (drawId || LOTTERY_EDIT_DRAW_ID)) {
      const pres = await lotApiPost('lottery-prize-items-set', { drawId: drawId || LOTTERY_EDIT_DRAW_ID, items: prizeItemsToSave });
      if (!pres || !pres.success) laterErrors.push('獎品清單沒存到：' + ((pres && pres.error) || '未知錯誤'));
    }
    if (!LOTTERY_EDIT_DRAW_ID && drawId) {
      const rows = collectLotWinnerFormRows();
      for (const r of rows) {
        const wres = await lotApiPost('lottery-winner-upsert', { drawId, prize: r.prize, winnerHandle: r.winnerHandle, orderNo: r.orderNo, status: 'pending' });
        if (!wres || !wres.success) laterErrors.push('得獎人「' + (r.orderNo || r.winnerHandle || r.prize) + '」沒存到：' + ((wres && wres.error) || '未知錯誤'));
      }
    }
    closeLotteryDrawModal();
    loadLotteryView(true);
    if (laterErrors.length) alert('抽獎已經建立／儲存了，但有部分內容沒存到：\n\n' + laterErrors.join('\n') + '\n\n請到抽獎管理找到這場，按「編輯」補上（不要再按新增，會變成兩場）。');
  } catch (err) {
    lotSetStatus('lotDrawFormStatus', (drawSaved ? '' : '儲存失敗：') + err.message, 'error');
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
  // 訂單編號核對：先用清單帶回來的結果，之後輸入時即時重查
  const orderHint = document.getElementById('lotWinnerOrderHint');
  const orderInput = document.getElementById('lotWinnerOrderNoInput');
  if (orderInput._lotLookupCancel) orderInput._lotLookupCancel(); // 上一位得獎人還在途中的查詢不能寫到這一位
  if (orderHint) {
    const hasNo = !!(winner && String(winner.orderNo || '').trim());
    // 已結束的歷史資料查無訂單就不提示（同清單列規則）
    orderHint.innerHTML = (hasNo && LOTTERY_ORDERS_READY && (winner.order || !lotIsSettled(winner))) ? lotOrderInfoHtml(winner.order) : '';
  }
  lotSyncWinnerModalFields(prizeType);
  lotSetStatus('lotWinnerFormStatus', '', '');
  document.getElementById('lotteryWinnerModal').classList.add('show');
}
function closeLotteryWinnerModal() {
  document.getElementById('lotteryWinnerModal').classList.remove('show');
  LOTTERY_WINNER_EDIT = null;
}
lotBindOrderLookup(document.getElementById('lotWinnerOrderNoInput'), document.getElementById('lotWinnerOrderHint'),
  () => (LOTTERY_WINNER_EDIT ? { drawId: LOTTERY_WINNER_EDIT.drawId } : {}));

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
