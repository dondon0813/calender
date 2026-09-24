// ===================================================================
// report.js — 「報表統計」主選單分頁（第 8 個 view）
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由跟 prItems.js / brandVendor.js 等既有模組一樣：admin.js 開機還原上次
// 停留的分頁時，switchView() 會同步呼叫 renderReportView()；本檔若排在
// admin.js 之後載入，開機當下函式還不存在，整頁會變磚。
//
// 資料層歸屬：statsMap／allEvents／customBlocks 的宣告與寫入都在 admin.js
// （loadData／fetchMemos 等處理），本檔只讀，不另外打後端——除了：
//   (1) 「重新整理」按鈕會呼叫 postTask({type:'stat-report'}) 拉最新累計、直接更新 statsMap；
//   (2) 2026-09-20 起新增「每日彙總」：postTask({type:'stat-report-daily', from, to})，
//       回 {tableReady, earliest, rows:[[日期,entity_type,entity_key,kind,source,cnt]…]}。
//       tableReady:false（後端尚未部署／表不存在）→ 總覽／各頁流量／團購成效退回「累計版」渲染（舊邏輯保留當備援）。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不直接呼叫 admin.js 的函式；
// 執行期（renderReportView 等函式被呼叫時）才會用到 admin.js 的全域：
// statsMap、allEvents、customBlocks、postTask、getMemoKey、setFormStatus、escHtml。
//
// 四個子分頁：總覽(overview)／各頁流量(pages)／購買點擊(buy)／團購成效(perf)。
// 日期一律用「台灣日期字串 YYYY-MM-DD」比對（rptTaipeiDateStr），不使用瀏覽器本地時區。
// ===================================================================

// ----- 模組層常數（開機期就會被讀到，一律放檔案最前段） -----
// key 要跟各前台頁面送出的 page_<key>_日期 完全一致（頁面代號只能小寫英數，見 Code.gs STAT_KEY_WHITELIST_RE）
// 2026-07-31 新增 kids／starcard／namesticker／schoollabels 四頁，之前這四頁沒有任何統計
// （此清單只給「累計版」備援渲染使用；每日版的頁面清單由資料動態產生，見 RPT_PAGE_LABELS）
const RPT_PAGE_DEFS = [
  { key: 'index', label: '團購行事曆' },
  { key: 'recipes', label: '食譜大全' },
  { key: 'school', label: '開學清單' },
  { key: 'kids', label: '免費資源' },
  { key: 'starcard', label: '集點卡' },
  { key: 'namesticker', label: '姓名貼產生器' },
  { key: 'schoollabels', label: '開學姓名貼' },
  { key: 'books', label: '繪本館' }
];
// 每日版「各頁流量」已知頁面代號→中文名（順序即列出順序；未知代號顯示原代號）
const RPT_PAGE_LABELS = {
  index: '團購行事曆', recipes: '食譜大全', school: '開學清單', kids: '免費資源',
  starcard: '集點卡', namesticker: '姓名貼產生器', schoollabels: '開學姓名貼', books: '繪本館',
  learn: '玩中學', member: '會員中心', materials: '教材館', materialsdetail: '教材介紹頁',
  blog: '部落格', blogpost: '部落格文章', go: '導購中繼頁'
};
// 繪本館外連按鈕點擊（2026-08-25）：picture-books.html pbTrackClick() 送 page_<key>_<日期> 的 clicks 欄，
// key 代號要跟前台完全一致
const RPT_BOOKS_BUTTON_DEFS = [
  { key: 'booksorder', label: '頂端前往下單' },
  { key: 'booksbuy', label: '彈窗前往購買（開團中）' },
  { key: 'booksshopee', label: '蝦皮購買' },
  { key: 'booksdownload', label: '教材下載' }
];
// 首頁（recipes.html）入口卡片點擊（2026-09-20）：前台每張卡送 page_homecard<代號>_<日期> 的 clicks，
// 每日資料為 entity_type='page'、entity_key='homecard<代號>'、kind='click'。順序＝首頁卡片排列
const RPT_HOME_CARD_DEFS = [
  { key: 'calendar', label: '團購行事曆' },
  { key: 'recipes', label: '觀看食譜' },
  { key: 'books', label: '繪本館' },
  { key: 'materials', label: '教材館' },
  { key: 'school', label: '開學清單' },
  { key: 'free', label: '免費資源' }
];
const RPT_HOME_CARD_PREFIX = 'homecard';
const RPT_HOME_VIEW_KEY = 'recipes';   // 點擊率分母＝首頁（page/recipes）瀏覽
// 左上角選單項目點擊（2026-09-20）：前台送 page_menu<代號>_<日期> 的 clicks，
// 每日資料為 entity_type='page'、entity_key='menu<代號>'、kind='click'。順序＝選單順序；沒有點擊率（無合適分母）
const RPT_MENU_DEFS = [
  { key: 'home', label: '首頁' },
  { key: 'calendar', label: '團購行事曆' },
  { key: 'recipes', label: '觀看食譜' },
  { key: 'books', label: '繪本館' },
  { key: 'materials', label: '教材館' },
  { key: 'school', label: '開學清單' },
  { key: 'free', label: '免費資源' }
];
const RPT_MENU_PREFIX = 'menu';
// 其他頁面層級點擊按鈕（2026-09-20）：開學姓名貼頁「購買標籤機」，送 page_labelsbuy_<日期> 的 clicks。
// 只併入購買點擊分頁的「按鈕種類」表；刻意不放進 RPT_BOOKS_BUTTON_DEFS（那是繪本館專屬區塊用）
const RPT_PAGE_CLICK_BUTTON_DEFS = [
  { key: 'labelsbuy', label: '購買標籤機（開學姓名貼頁）' }
];
// 事件層級按鈕（不分來源）：來源欄位就是 intro/recipe/order/code 本身
const RPT_EVENT_BUTTON_DEFS = [
  { key: 'order', label: '下單按鈕' },
  { key: 'code', label: '折扣碼' },
  { key: 'intro', label: '介紹' },
  { key: 'recipe', label: '食譜' }
];
// 對應 index.html 的 attachStatTracking()：來源 key 固定是 evKey + '_src_' + mode
// 行事曆各模式維持單層；食譜頁／開學清單頁 2026-07-27 拆成頁內細項（items），
// 每個 items 陣列最後一個固定是舊碼（未細分歷史資料），標籤統一顯示「（未細分）」
// （只給「累計版」備援使用；每日版用下面的 RPT_SOURCE_LABELS 攤平顯示）
const RPT_SOURCE_DEFS = [
  { key: 'start', label: '開團日模式' },
  { key: 'end', label: '結團日模式' },
  { key: 'all', label: '全部顯示' },
  { key: 'list', label: '現正開團中' },
  { key: 'now', label: '現正開團中卡片' },
  { key: 'recipes', label: '食譜頁', items: [
    { key: 'recipesing', label: '食材彈窗購買' },
    { key: 'recipesbrand', label: '品牌直接開團' },
    { key: 'recipeslist', label: '品牌清單下單' },
    { key: 'recipespromo', label: '食譜頁置頂宣傳' },
    { key: 'recipes', label: '（未細分）' }
  ] },
  { key: 'school', label: '開學清單頁', items: [
    { key: 'schooltop', label: '置頂開團中縮圖' },
    { key: 'schoolcard', label: '品項卡片彈窗' },
    { key: 'school', label: '（未細分）' }
  ] },
  { key: 'kidstop', label: '免費資源頂端' },
  { key: 'sticker', label: '姓名貼頁' },
  { key: 'labels', label: '開學姓名貼' },
  { key: 'ibon', label: 'ibon 頁' },
  { key: 'starcard', label: '集點卡' },
  { key: 'books', label: '繪本館' },
  { key: 'search', label: '搜尋' },
  { key: 'materialsdetail', label: '教材介紹頁' },
  { key: 'materialshall', label: '教材館' },
  { key: 'go', label: '導購中繼頁' },
  { key: 'blog', label: '部落格' }
];
// 每日版「來源代碼→中文名」（entity 的 source 欄去掉 src_／buy_ 前綴後的代碼；未知代碼顯示原代碼）
const RPT_SOURCE_LABELS = {
  start: '開團日模式', end: '結團日模式', all: '全部顯示', list: '現正開團中清單', now: '現正開團中卡片',
  recipes: '食譜頁', recipesing: '食材彈窗', recipesbrand: '品牌直接開團', recipeslist: '品牌清單',
  recipespromo: '食譜頁置頂宣傳', school: '開學清單', schooltop: '開學清單置頂', schoolcard: '開學清單卡片',
  kidstop: '免費資源頂端', sticker: '姓名貼頁', labels: '開學姓名貼', ibon: 'ibon 頁', starcard: '集點卡',
  books: '繪本館', search: '搜尋', materialsdetail: '教材介紹頁', materialshall: '教材館',
  go: '導購中繼頁', blog: '部落格'
};
// 純 evKey（無 page_/block_ 前綴、無 _src_/_intro/_recipe/_order/_code 後綴）：<id>_<YYYY-M-D>
const RPT_BASE_EVKEY_RE = /^(.+)_(\d{4}-\d{1,2}-\d{1,2})$/;
const RPT_TAB_KEYS = ['overview', 'pages', 'buy', 'perf'];
const RPT_TAB_LS_KEY = 'rpt_subtab';
const RPT_DAILY_MAX_DAYS = 92;          // stat-report-daily 單次最多 92 天
const RPT_DAILY_FRESH_MS = 5 * 60 * 1000; // 每日資料快取多久內不重抓
const RPT_NOTICE_NOT_READY = '每日明細需要更新資料庫，暫以累計資料顯示';

// ----- 模組層狀態 -----
// 目前排行榜資料（供文字過濾即時重繪用）＋展開中的列
let rptGroupRows = [];
let rptExpandedKeys = new Set();
// 每日彙總：ready null＝尚未載入、true＝可用、false＝後端未就緒或載入失敗
let rptState = { ready: null, loading: false, idx: null, from: '', to: '', earliest: '', error: '', loadedAt: 0 };
let rptTab = 'overview';
let rptTabRestored = false;              // 第一次進入時才從 localStorage 還原上次分頁
let rptPerfMode = '30d';                 // perf 分頁：'30d'＝近30日（每日資料）、'all'＝累計（statsMap）
let rptPageExpanded = new Set();         // 各頁流量：展開中的頁面代號
let rptRangeCache = {};                  // 購買點擊自訂區間（超出主視窗時）額外抓的資料
// 購買點擊分頁篩選狀態
let rptBuy = { preset: '30d', customFrom: '', customTo: '', q: '', src: null, ev: null, sortKey: '', sortDir: -1 };

// ===================================================================
// 純聚合函式（不碰 DOM，方便用 node 直接驗證邏輯）
// ===================================================================

// ----- 日期工具：一律台灣日期字串 YYYY-MM-DD -----
function rptTaipeiDateStr(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 預覽頁／測試用：window.RPT_TODAY_OVERRIDE='YYYY-MM-DD' 可固定「今天」（正式後台不會設定）
function rptToday() {
  if (typeof window !== 'undefined' && typeof window.RPT_TODAY_OVERRIDE === 'string' && window.RPT_TODAY_OVERRIDE) {
    return window.RPT_TODAY_OVERRIDE;
  }
  return rptTaipeiDateStr(Date.now());
}

function rptAddDays(ds, n) {
  const p = String(ds).split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000).toISOString().slice(0, 10);
}

function rptDateList(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = rptAddDays(d, 1)) out.push(d);
  return out;
}

function rptFmtMD(ds) {
  const p = String(ds).split('-');
  return (+p[1]) + '/' + (+p[2]);
}

function rptFmtNum(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}

// evKey 日期段正規化成不補零：<id>_<Y>-<M>-<D>（舊站標準；教材館等新頁面曾寫成 52_2026-09-08）
function rptNormEvKey(k) {
  const m = /^(.+)_(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(k));
  return m ? (m[1] + '_' + m[2] + '-' + (+m[3]) + '-' + (+m[4])) : String(k);
}

// 每日彙總「頁面流量」排除：會員資料卡漏斗 fanpf*、首頁入口卡片點擊 homecard*、左上角選單點擊 menu*、
// 繪本館按鈕／頁面點擊按鈕（labelsbuy；那些是 click 不是頁面，即使有人送 view 也不算流量）
function rptIsTrafficPage(key) {
  if (/^fanpf/.test(key)) return false;
  if (key.indexOf(RPT_HOME_CARD_PREFIX) === 0) return false;
  if (key.indexOf(RPT_MENU_PREFIX) === 0) return false;
  if (RPT_PAGE_CLICK_BUTTON_DEFS.some(b => b.key === key)) return false;
  return !RPT_BOOKS_BUTTON_DEFS.some(b => b.key === key);
}

function rptSourceLabel(code) {
  return RPT_SOURCE_LABELS[code] || code;
}

// ----- 每日索引：rows → 依 (實體, kind, source) 分序列 {日期: 次數} -----
// rows 每列 [stat_date, entity_type, entity_key, kind, source, cnt]
// 只掃一次；event 的 entity_key 在這裡統一正規化（補零日期＝不補零），同一團不會被拆成兩列
function rptBuildDailyIndex(rows) {
  const idx = { page: {}, event: {}, block: {}, pageViewTotal: {}, buyTotal: {}, hasBuy: false, buyFirst: '' };
  const add = (map, d, n) => { map[d] = (map[d] || 0) + n; };
  (rows || []).forEach(r => {
    if (!r) return;
    const date = r[0], type = r[1], key = r[2], kind = r[3], source = r[4] || '';
    const n = Number(r[5]) || 0;
    if (!date || !key) return;
    if (type === 'page') {
      const p = idx.page[key] || (idx.page[key] = { view: {}, click: {} });
      if (kind === 'view') {
        add(p.view, date, n);
        if (rptIsTrafficPage(key)) add(idx.pageViewTotal, date, n);
      } else if (kind === 'click') {
        add(p.click, date, n);
      }
    } else if (type === 'event') {
      const ek = rptNormEvKey(key);
      const e = idx.event[ek] || (idx.event[ek] = { view: {}, click: {}, src: {} });
      if (!source) {
        if (kind === 'view') add(e.view, date, n);
        else if (kind === 'click') add(e.click, date, n);
      } else if (kind === 'click') {
        const s = e.src[source] || (e.src[source] = {});
        add(s, date, n);
        if (source.indexOf('buy_') === 0) {
          idx.hasBuy = true;
          add(idx.buyTotal, date, n);
          if (!idx.buyFirst || date < idx.buyFirst) idx.buyFirst = date;
        }
      }
    } else if (type === 'block') {
      const b = idx.block[key] || (idx.block[key] = { view: {}, click: {} });
      if (kind === 'view') add(b.view, date, n);
      else if (kind === 'click') add(b.click, date, n);
    }
  });
  return idx;
}

// 區間加總（map = {日期: 次數}）
function rptSumRange(map, from, to) {
  if (!map) return 0;
  let s = 0;
  for (const d in map) { if (d >= from && d <= to) s += map[d]; }
  return s;
}

// 依日期陣列取每日值
function rptDailyValues(map, dates) {
  return dates.map(d => (map && map[d]) || 0);
}

// 購買網址點擊是 2026-09-20 才上線的精準計數：上線日（idx.buyFirst＝第一筆有資料的日子）之前沒有資料，
// 趨勢圖要用 null 斷線而不是畫成 0（雪莉 09-24：「19 號以前購買網址點擊為 0」看起來像沒人買）
function rptMaskBeforeBuyStart(values, dates, idx) {
  const first = idx && idx.buyFirst;
  if (!first) return values;
  return values.map((v, i) => (dates[i] < first ? null : v));
}

// 把 map 的區間值累加進 arr（dateIndex = {日期: 陣列位置}）
function rptAccumRange(map, arr, dateIndex) {
  if (!map) return;
  for (const d in map) { const i = dateIndex[d]; if (i !== undefined) arr[i] += map[d]; }
}

function rptPctChange(cur, prev) {
  if (!prev) return null;
  return (cur - prev) / prev * 100;
}

// 事件標題查找：優先完全比對 evKey（getMemoKey），退而以 id 比對，再退回 evKey 本身；標題內斷行壓成空白
function rptBuildTitleMap(events) {
  const exact = {}, byId = {};
  (Array.isArray(events) ? events : []).forEach(e => {
    let k = null;
    try { k = (typeof getMemoKey === 'function') ? getMemoKey(e) : null; } catch (err) { k = null; }
    const t = String(e.title || '').replace(/\s+/g, ' ').trim();
    if (k && t) exact[k] = t;
    const id = String(e.id);
    if (t && !(id in byId)) byId[id] = t;
  });
  return function titleOf(evKey) {
    if (exact[evKey]) return exact[evKey];
    const m = RPT_BASE_EVKEY_RE.exec(evKey);
    if (m && byId[m[1]]) return byId[m[1]];
    return evKey;
  };
}

// ----- 總覽（每日版） -----
// 頁面瀏覽：今日／昨日／近7日／近30日，各附與「前一等長期間」的百分比變動（今日只對昨日全天）
// 購買網址點擊：今日／近7日／近30日（buy_ 開頭的 event click 加總）；尚無任何 buy_ 資料 → hasBuy=false（畫面顯示「—」）
function rptComputeOverviewDaily(idx, today, earliest) {
  const y = rptAddDays(today, -1);
  const wins = {
    today: { f: today, t: today, pf: y, pt: y },
    yesterday: { f: y, t: y, pf: rptAddDays(today, -2), pt: rptAddDays(today, -2) },
    d7: { f: rptAddDays(today, -6), t: today, pf: rptAddDays(today, -13), pt: rptAddDays(today, -7) },
    d30: { f: rptAddDays(today, -29), t: today, pf: rptAddDays(today, -59), pt: rptAddDays(today, -30) }
  };
  const metric = (map, w, needFrom) => {
    const cur = rptSumRange(map, w.f, w.t);
    const prev = rptSumRange(map, w.pf, w.pt);
    // 前一期間有一部分早於資料起始日（或購買計數上線日）→ 比較不可靠，不顯示百分比
    const prevOk = (!earliest || w.pf >= earliest) && (!needFrom || (needFrom && w.pf >= needFrom));
    return { cur, prev, pct: prevOk ? rptPctChange(cur, prev) : null };
  };
  const views = {}, buy = {};
  Object.keys(wins).forEach(k => {
    views[k] = metric(idx.pageViewTotal, wins[k], '');
    buy[k] = metric(idx.buyTotal, wins[k], idx.buyFirst || '9999-99-99');
  });
  const dates = rptDateList(rptAddDays(today, -29), today);
  return {
    views, buy, hasBuy: !!idx.hasBuy,
    trend: { dates, views: rptDailyValues(idx.pageViewTotal, dates), buy: rptMaskBeforeBuyStart(rptDailyValues(idx.buyTotal, dates), dates, idx) }
  };
}

// ----- 各頁流量（每日版） -----
// 頁面清單＝已知代號（即使 0 流量也列）＋每日資料裡出現過的頁面＋累計統計裡出現過的頁面
function rptPageCumFromStats(stats, key) {
  const prefix = 'page_' + key + '_';
  let total = 0;
  Object.keys(stats || {}).forEach(k => {
    if (k.indexOf(prefix) === 0 && /^\d{4}-\d{1,2}-\d{1,2}$/.test(k.slice(prefix.length))) total += (stats[k].views || 0);
  });
  return total;
}

function rptComputePageTableDaily(idx, stats, today) {
  stats = stats || {};
  const keys = Object.keys(RPT_PAGE_LABELS);
  const seen = new Set(keys);
  Object.keys(idx.page).forEach(k => {
    if (!seen.has(k) && rptIsTrafficPage(k) && Object.keys(idx.page[k].view).length) { seen.add(k); keys.push(k); }
  });
  Object.keys(stats).forEach(k => {
    const m = /^page_([a-z0-9]+)_\d{4}-\d{1,2}-\d{1,2}$/.exec(k);
    if (m && !seen.has(m[1]) && rptIsTrafficPage(m[1]) && (stats[k].views || 0) > 0) { seen.add(m[1]); keys.push(m[1]); }
  });
  const y = rptAddDays(today, -1);
  const d7 = rptAddDays(today, -6), d30 = rptAddDays(today, -29);
  const dates30 = rptDateList(d30, today);
  return keys.map(key => {
    const map = (idx.page[key] || {}).view || {};
    const dailySum = rptSumRange(map, '0000-00-00', '9999-99-99');
    return {
      key,
      label: RPT_PAGE_LABELS[key] || key,
      known: !!RPT_PAGE_LABELS[key],
      today: rptSumRange(map, today, today),
      yesterday: rptSumRange(map, y, y),
      seven: rptSumRange(map, d7, today),
      thirty: rptSumRange(map, d30, today),
      total: Math.max(rptPageCumFromStats(stats, key), dailySum),
      dates: dates30,
      daily: rptDailyValues(map, dates30)
    };
  });
}

// ----- 首頁入口卡片點擊 -----
// 'YYYY-M-D'（statsMap 慣用不補零）→ 'YYYY-MM-DD'，方便字串比大小
function rptPadDate(ds) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(ds));
  return m ? (m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)) : '';
}

// idx 為 null（每日明細不可用，tableReady:false）→ 只算累計欄，其餘欄與點擊率為 null（畫面顯示「—」）
// 回傳 { hasData, since, daily, homeViews30, rows:[{key,label,today,yesterday,seven,thirty,total,ctr}], totalRow }
// hasData＝任何一張卡有點擊紀錄（每日資料或 statsMap 累計）；since＝最早有點擊的日期 YYYY-MM-DD
// opts（選填，預設＝首頁入口卡片）：{ defs, prefix, withCtr }——左上角選單點擊共用本函式（withCtr:false＝不算點擊率，ctr 恆 null）
function rptComputeHomeCards(idx, stats, today, opts) {
  opts = opts || {};
  const defs = opts.defs || RPT_HOME_CARD_DEFS;
  const keyPrefix = opts.prefix || RPT_HOME_CARD_PREFIX;
  const withCtr = opts.withCtr !== false;
  stats = stats || {};
  const daily = !!idx;
  const y = rptAddDays(today, -1);
  const d7 = rptAddDays(today, -6), d30 = rptAddDays(today, -29);
  const homeViews30 = (daily && withCtr) ? rptSumRange(((idx.page[RPT_HOME_VIEW_KEY] || {}).view), d30, today) : null;
  let since = '';
  const noteDate = (ds) => { const p = rptPadDate(ds); if (p && (!since || p < since)) since = p; };
  let hasData = false;

  const rows = defs.map(def => {
    const key = keyPrefix + def.key;
    // 累計：statsMap 的 page_homecard<代號>_<日期>.clicks 加總
    const prefix = 'page_' + key + '_';
    let cum = 0;
    Object.keys(stats).forEach(k => {
      if (k.indexOf(prefix) !== 0) return;
      const ds = k.slice(prefix.length);
      if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(ds)) return;
      const c = (stats[k] || {}).clicks || 0;
      if (c > 0) { cum += c; noteDate(ds); }
    });
    const row = { key: def.key, label: def.label, today: null, yesterday: null, seven: null, thirty: null, total: cum, ctr: null };
    if (daily) {
      const map = ((idx.page[key] || {}).click) || {};
      Object.keys(map).forEach(d => { if (map[d] > 0) noteDate(d); });
      row.today = rptSumRange(map, today, today);
      row.yesterday = rptSumRange(map, y, y);
      row.seven = rptSumRange(map, d7, today);
      row.thirty = rptSumRange(map, d30, today);
      row.total = Math.max(cum, rptSumRange(map, '0000-00-00', '9999-99-99'));
      row.ctr = (withCtr && homeViews30 > 0) ? row.thirty / homeViews30 * 100 : null;
    }
    if (row.total > 0) hasData = true;
    return row;
  });

  const sum = f => rows.reduce((s, r) => s + (r[f] || 0), 0);
  const totalRow = { key: 'total', label: '合計', today: null, yesterday: null, seven: null, thirty: null, total: sum('total'), ctr: null };
  if (daily) {
    ['today', 'yesterday', 'seven', 'thirty'].forEach(f => { totalRow[f] = sum(f); });
    totalRow.ctr = (withCtr && homeViews30 > 0) ? totalRow.thirty / homeViews30 * 100 : null;
  }
  return { hasData, since, daily, homeViews30, rows, totalRow };
}

// ----- 團購成效排行（每日版）：輸出形狀與 rptComputeGroupRanking 相同，可直接餵 rptRenderGroupRankTable -----
function rptComputeGroupRankingDaily(idx, from, to, titleOf) {
  const rows = [];
  Object.keys(idx.event).forEach(evKey => {
    const e = idx.event[evKey];
    const views = rptSumRange(e.view, from, to);
    let clicks = rptSumRange(e.click, from, to);
    const srcs = [];
    let entry = 0;
    Object.keys(e.src).forEach(code => {
      const n = rptSumRange(e.src[code], from, to);
      if (!n) return;
      if (code.indexOf('src_') === 0) { entry += n; srcs.push({ key: code, label: rptSourceLabel(code.slice(4)), count: n, items: null }); }
      else if (code.indexOf('buy_') === 0) { srcs.push({ key: code, label: rptSourceLabel(code.slice(4)) + '（購買網址）', count: n, items: null }); }
    });
    const btn = name => rptSumRange(e.src[name], from, to);
    const order = btn('order'), code = btn('code'), intro = btn('intro'), recipe = btn('recipe');
    if (!clicks) clicks = entry;
    if (!views && !clicks && !order && !code && !intro && !recipe) return;
    srcs.sort((a, b) => b.count - a.count);
    const m = RPT_BASE_EVKEY_RE.exec(evKey);
    rows.push({
      evKey, idPart: m ? m[1] : evKey, datePart: m ? m[2] : '',
      title: titleOf(evKey), views, clicks, intro, recipe, order, code, sources: srcs
    });
  });
  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

// 自訂區塊點擊（每日版）
function rptComputeBlockStatsDaily(idx, from, to, blocks) {
  blocks = Array.isArray(blocks) ? blocks : [];
  const rows = [];
  Object.keys(idx.block).forEach(id => {
    const clicks = rptSumRange(idx.block[id].click, from, to);
    if (!clicks) return;
    const block = blocks.find(b => String(b.id) === id);
    rows.push({ id, name: block ? (block.title || id) : id, clicks });
  });
  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

// ----- 購買點擊分頁的核心聚合 -----
// opts: { q（團名搜尋）, src（來源代碼篩選）, ev（evKey 篩選）, titleOf }
// 篩選語意（交叉篩選）：
//   依來源表 ← 套用 q、ev（不套 src，否則只剩一列）；
//   依團購表 ← 套用 q、src（不套 ev）；src 有值時「入口/購買」欄只計該來源，其餘欄（曝光/下單/折扣碼…）仍為該團全部；
//   按鈕種類、趨勢圖 ← 套用 q、ev、src（趨勢）／q、ev（按鈕）。
function rptComputeBuyView(idx, from, to, opts) {
  opts = opts || {};
  const q = String(opts.q || '').trim().toLowerCase();
  const srcF = opts.src || null, evF = opts.ev || null;
  const titleOf = opts.titleOf || (k => k);
  const dates = rptDateList(from, to);
  const dateIndex = {};
  dates.forEach((d, i) => { dateIndex[d] = i; });

  const all = [];
  Object.keys(idx.event).forEach(ek => {
    const e = idx.event[ek];
    const title = titleOf(ek);
    if (q && title.toLowerCase().indexOf(q) === -1 && ek.toLowerCase().indexOf(q) === -1) return;
    const src = {}, buyBy = {};
    let entry = 0, buy = 0;
    Object.keys(e.src).forEach(code => {
      const n = rptSumRange(e.src[code], from, to);
      if (!n) return;
      if (code.indexOf('src_') === 0) { src[code.slice(4)] = n; entry += n; }
      else if (code.indexOf('buy_') === 0) { buyBy[code.slice(4)] = n; buy += n; }
    });
    const btn = name => rptSumRange(e.src[name], from, to);
    all.push({
      evKey: ek, title,
      views: rptSumRange(e.view, from, to), clickTotal: rptSumRange(e.click, from, to),
      entry, buy, src, buyBy,
      order: btn('order'), code: btn('code'), intro: btn('intro'), recipe: btn('recipe')
    });
  });

  // 依來源
  const srcAcc = {};
  let entryTotal = 0, buyTotal = 0;
  all.forEach(r => {
    if (evF && r.evKey !== evF) return;
    Object.keys(r.src).forEach(c => { (srcAcc[c] || (srcAcc[c] = { code: c, entry: 0, buy: 0 })).entry += r.src[c]; entryTotal += r.src[c]; });
    Object.keys(r.buyBy).forEach(c => { (srcAcc[c] || (srcAcc[c] = { code: c, entry: 0, buy: 0 })).buy += r.buyBy[c]; buyTotal += r.buyBy[c]; });
  });
  const bySource = Object.keys(srcAcc).map(c => {
    const a = srcAcc[c];
    return { code: c, label: rptSourceLabel(c), entry: a.entry, buy: a.buy, share: entryTotal ? a.entry / entryTotal * 100 : 0 };
  }).sort((a, b) => (b.buy - a.buy) || (b.entry - a.entry));

  // 依團購
  const byEvent = [];
  all.forEach(r => {
    const entry = srcF ? (r.src[srcF] || 0) : r.entry;
    const buy = srcF ? (r.buyBy[srcF] || 0) : r.buy;
    if (srcF && !entry && !buy) return;
    const active = r.views || entry || buy || r.order || r.code || r.intro || r.recipe || r.clickTotal;
    if (!active) return;
    let conv = null;
    if (buy > 0 && r.views > 0) conv = { kind: 'buy', pct: buy / r.views * 100 };
    else if (r.order > 0 && r.views > 0) conv = { kind: 'legacy', pct: r.order / r.views * 100 };
    byEvent.push({
      evKey: r.evKey, title: r.title, views: r.views, entry, buy,
      order: r.order, code: r.code, intro: r.intro, recipe: r.recipe, conv
    });
  });

  // 按鈕種類（事件層級 order/code/intro/recipe：q＋ev；繪本館按鈕是頁面層級，只在沒選團時列）
  const btnAcc = {};
  RPT_EVENT_BUTTON_DEFS.forEach(b => { btnAcc[b.key] = { key: b.key, label: b.label, total: 0, daily: dates.map(() => 0) }; });
  all.forEach(r => {
    if (evF && r.evKey !== evF) return;
    const e = idx.event[r.evKey];
    RPT_EVENT_BUTTON_DEFS.forEach(b => {
      btnAcc[b.key].total += r[b.key];
      rptAccumRange(e.src[b.key], btnAcc[b.key].daily, dateIndex);
    });
  });
  const buttons = RPT_EVENT_BUTTON_DEFS.map(b => btnAcc[b.key]);
  const pageClickBtn = b => {
    const p = idx.page[b.key];
    const daily = dates.map(() => 0);
    if (p) rptAccumRange(p.click, daily, dateIndex);
    return { key: b.key, label: b.label, total: p ? rptSumRange(p.click, from, to) : 0, daily };
  };
  const booksButtons = evF ? [] : RPT_BOOKS_BUTTON_DEFS.map(pageClickBtn);
  // 其他頁面層級按鈕（開學姓名貼「購買標籤機」）：與繪本館按鈕同樣是頁面點擊、不屬於團購，選單一團時不列
  const pageButtons = evF ? [] : RPT_PAGE_CLICK_BUTTON_DEFS.map(pageClickBtn);

  // 每日趨勢（入口點擊＋購買網址點擊）：q、ev、src 全部套用
  const tEntry = dates.map(() => 0), tBuy = dates.map(() => 0);
  all.forEach(r => {
    if (evF && r.evKey !== evF) return;
    const e = idx.event[r.evKey];
    Object.keys(e.src).forEach(code => {
      const isSrc = code.indexOf('src_') === 0, isBuy = code.indexOf('buy_') === 0;
      if (!isSrc && !isBuy) return;
      if (srcF && code.slice(4) !== srcF) return;
      rptAccumRange(e.src[code], isBuy ? tBuy : tEntry, dateIndex);
    });
  });

  const evFiltered = all.filter(r => !evF || r.evKey === evF);
  return {
    dates, bySource, byEvent, buttons, booksButtons, pageButtons,
    trend: { dates, entry: tEntry, buy: rptMaskBeforeBuyStart(tBuy, dates, idx) },
    totals: {
      views: evFiltered.reduce((s, r) => s + r.views, 0),
      entry: srcF ? evFiltered.reduce((s, r) => s + (r.src[srcF] || 0), 0) : evFiltered.reduce((s, r) => s + r.entry, 0),
      buy: srcF ? evFiltered.reduce((s, r) => s + (r.buyBy[srcF] || 0), 0) : evFiltered.reduce((s, r) => s + r.buy, 0)
    },
    hasBuyInRange: all.some(r => r.buy > 0),
    hasBuyAny: !!idx.hasBuy
  };
}

// 團購列排序：key 為空＝預設（購買網址點擊 → 入口點擊）；conv 沒值排最後
function rptSortBuyEvents(rows, key, dir) {
  const d = dir || -1;
  const val = r => key === 'conv' ? (r.conv ? r.conv.pct : -1) : (r[key] || 0);
  const out = rows.slice();
  if (!key) out.sort((a, b) => (b.buy - a.buy) || (b.entry - a.entry) || (b.views - a.views));
  else out.sort((a, b) => ((val(a) - val(b)) * d) || (b.buy - a.buy) || (b.entry - a.entry));
  return out;
}

// 單一團展開：各來源（入口／購買）＋每日入口／購買點擊
function rptComputeEventDetail(idx, evKey, from, to) {
  const e = idx.event[evKey];
  const dates = rptDateList(from, to);
  const dateIndex = {};
  dates.forEach((d, i) => { dateIndex[d] = i; });
  const entryDaily = dates.map(() => 0), buyDaily = dates.map(() => 0);
  const acc = {};
  if (e) {
    Object.keys(e.src).forEach(code => {
      const isSrc = code.indexOf('src_') === 0, isBuy = code.indexOf('buy_') === 0;
      if (!isSrc && !isBuy) return;
      const c = code.slice(4);
      const n = rptSumRange(e.src[code], from, to);
      const a = acc[c] || (acc[c] = { code: c, label: rptSourceLabel(c), entry: 0, buy: 0 });
      if (isBuy) a.buy += n; else a.entry += n;
      rptAccumRange(e.src[code], isBuy ? buyDaily : entryDaily, dateIndex);
    });
  }
  const sources = Object.keys(acc).map(c => acc[c]).filter(a => a.entry || a.buy)
    .sort((a, b) => (b.buy - a.buy) || (b.entry - a.entry));
  return { dates, sources, entryDaily, buyDaily };
}

// ===================================================================
// 累計版純聚合函式（statsMap；tableReady:false 時的備援，也是「累計」模式）
// ===================================================================

function rptDateKeyOf(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function rptDaysAgoDate(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function rptSumViewsForKeys(stats, keys) {
  return keys.reduce((sum, k) => sum + (((stats[k] || {}).views) || 0), 0);
}

// 頁面瀏覽聚合：三個頁面 × 今日/近7日/近30日/累計（views 欄）
function rptComputePageViews(stats) {
  stats = stats || {};
  const todayKey = rptDateKeyOf(rptDaysAgoDate(0));
  const last7 = [];
  for (let i = 0; i < 7; i++) last7.push(rptDateKeyOf(rptDaysAgoDate(i)));
  const last30 = [];
  for (let i = 0; i < 30; i++) last30.push(rptDateKeyOf(rptDaysAgoDate(i)));

  return RPT_PAGE_DEFS.map(p => {
    const prefix = 'page_' + p.key + '_';
    const today = ((stats[prefix + todayKey] || {}).views) || 0;
    const seven = rptSumViewsForKeys(stats, last7.map(d => prefix + d));
    const thirty = rptSumViewsForKeys(stats, last30.map(d => prefix + d));
    let total = 0;
    Object.keys(stats).forEach(k => {
      if (k.indexOf(prefix) === 0) total += (stats[k].views || 0);
    });
    return { key: p.key, label: p.label, today, seven, thirty, total };
  });
}

// 繪本館按鈕點擊聚合：跟 rptComputePageViews 同四個時間窗，但讀 clicks 欄
function rptComputeBooksButtons(stats) {
  stats = stats || {};
  const todayKey = rptDateKeyOf(rptDaysAgoDate(0));
  const last7 = [];
  for (let i = 0; i < 7; i++) last7.push(rptDateKeyOf(rptDaysAgoDate(i)));
  const last30 = [];
  for (let i = 0; i < 30; i++) last30.push(rptDateKeyOf(rptDaysAgoDate(i)));

  const clicksOf = (k) => (((stats[k] || {}).clicks) || 0);
  return RPT_BOOKS_BUTTON_DEFS.map(p => {
    const prefix = 'page_' + p.key + '_';
    const today = clicksOf(prefix + todayKey);
    const seven = last7.reduce((s, d) => s + clicksOf(prefix + d), 0);
    const thirty = last30.reduce((s, d) => s + clicksOf(prefix + d), 0);
    let total = 0;
    Object.keys(stats).forEach(k => {
      if (k.indexOf(prefix) === 0) total += (stats[k].clicks || 0);
    });
    return { key: p.key, label: p.label, today, seven, thirty, total };
  });
}

// 頂部總覽卡片：今日/近7日/近30日頁面瀏覽合計＋全站累計點擊（所有 clicks 加總）
function rptComputeOverview(stats) {
  stats = stats || {};
  const pageRows = rptComputePageViews(stats);
  const todayViews = pageRows.reduce((s, r) => s + r.today, 0);
  const sevenViews = pageRows.reduce((s, r) => s + r.seven, 0);
  const thirtyViews = pageRows.reduce((s, r) => s + r.thirty, 0);
  let totalClicks = 0;
  Object.keys(stats).forEach(k => { totalClicks += ((stats[k] || {}).clicks || 0); });
  return { todayViews, sevenViews, thirtyViews, totalClicks };
}

// 團購成效排行：從 statsMap 找出所有「純 evKey」，一列一團一檔期
function rptComputeGroupRanking(stats, events) {
  stats = stats || {};
  events = Array.isArray(events) ? events : [];

  const evKeys = new Set();
  Object.keys(stats).forEach(k => {
    if (k.indexOf('page_') === 0 || k.indexOf('block_') === 0) return;
    if (RPT_BASE_EVKEY_RE.test(k)) evKeys.add(k);
  });

  const rows = [];
  evKeys.forEach(evKey => {
    const m = evKey.match(RPT_BASE_EVKEY_RE);
    const idPart = m ? m[1] : evKey;
    const datePart = m ? m[2] : '';
    let ev = null;
    events.some(e => {
      let k = null;
      try { k = (typeof getMemoKey === 'function') ? getMemoKey(e) : null; } catch (err) { k = null; }
      if (k === evKey) { ev = e; return true; }
      return false;
    });
    const title = ev ? (ev.title || idPart) : idPart;
    const st = stats[evKey] || {};
    const sources = RPT_SOURCE_DEFS.map(s => {
      if (s.items) {
        const items = s.items.map(i => ({
          key: i.key,
          label: i.label,
          count: ((stats[evKey + '_src_' + i.key] || {}).clicks) || 0
        }));
        const total = items.reduce((sum, i) => sum + i.count, 0);
        return { key: s.key, label: s.label, count: total, items };
      }
      return {
        key: s.key,
        label: s.label,
        count: ((stats[evKey + '_src_' + s.key] || {}).clicks) || 0,
        items: null
      };
    });
    rows.push({
      evKey,
      idPart,
      datePart,
      title,
      views: st.views || 0,
      clicks: st.clicks || 0,
      intro: ((stats[evKey + '_intro'] || {}).clicks) || 0,
      recipe: ((stats[evKey + '_recipe'] || {}).clicks) || 0,
      order: ((stats[evKey + '_order'] || {}).clicks) || 0,
      code: ((stats[evKey + '_code'] || {}).clicks) || 0,
      sources
    });
  });

  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

// 點擊來源總覽：各來源（頁面層）在全站的總點擊（跨所有 evKey 加總）；
// 食譜頁／開學清單頁再往下展開 items 細項
function rptSumClicksBySuffix(stats, code) {
  const suffix = '_src_' + code;
  let total = 0;
  Object.keys(stats).forEach(k => {
    if (k.indexOf('page_') === 0 || k.indexOf('block_') === 0) return;
    if (k.length > suffix.length && k.slice(-suffix.length) === suffix) {
      total += ((stats[k] || {}).clicks) || 0;
    }
  });
  return total;
}

function rptComputeSourceOverview(stats) {
  stats = stats || {};
  return RPT_SOURCE_DEFS.map(s => {
    if (s.items) {
      const items = s.items.map(i => ({
        key: i.key,
        label: i.label,
        count: rptSumClicksBySuffix(stats, i.key)
      }));
      const total = items.reduce((sum, i) => sum + i.count, 0);
      return { key: s.key, label: s.label, total, items };
    }
    return { key: s.key, label: s.label, total: rptSumClicksBySuffix(stats, s.key), items: null };
  });
}

// 自訂區塊：block_<id> 對回 customBlocks 的 title，對不到就顯示 id
function rptComputeBlockStats(stats, blocks) {
  stats = stats || {};
  blocks = Array.isArray(blocks) ? blocks : [];
  const rows = [];
  Object.keys(stats).forEach(k => {
    if (k.indexOf('block_') !== 0) return;
    const id = k.slice('block_'.length);
    const block = blocks.find(b => String(b.id) === id);
    rows.push({ id, name: block ? (block.title || id) : id, clicks: ((stats[k] || {}).clicks) || 0 });
  });
  rows.sort((a, b) => b.clicks - a.clicks);
  return rows;
}

// ===================================================================
// SVG 圖表（純字串產生，不引入外部函式庫）
// ===================================================================

// 取 4 等分刻度剛好整除的「好看上限」
function rptNiceMax(v) {
  if (!(v > 0)) return 4;
  if (v <= 4) return 4;
  if (v <= 8) return 8;
  if (v <= 12) return 12;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const mult = [1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10];
  for (let i = 0; i < mult.length; i++) { if (mult[i] * p >= v) return mult[i] * p; }
  return 10 * p;
}

function rptTickLabel(n) {
  if (n >= 10000) return (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 10) / 10);
}

// series: [{ name, cls('a'|'b'), axis('l'|'r'), values[] }]；有 axis:'r' 時畫雙 Y 軸
function rptLineChartSvg(dates, series, opts) {
  opts = opts || {};
  const W = 520, H = 220, L = 40, T = 14, B = 26;
  const dual = series.some(s => s.axis === 'r');
  const R = dual ? 40 : 14;
  const pw = W - L - R, ph = H - T - B, n = dates.length;
  const maxOf = axis => rptNiceMax(Math.max.apply(null, [0].concat(
    series.filter(s => (s.axis || 'l') === axis).map(s => Math.max.apply(null, [0].concat(s.values.filter(v => v != null)))))));
  const maxL = maxOf('l'), maxR = dual ? maxOf('r') : 0;
  const xAt = i => n <= 1 ? L + pw / 2 : L + pw * i / (n - 1);
  const yAt = (v, max) => T + ph - (v / max) * ph;
  let svg = '<svg class="rpt-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    escHtml(opts.label || '每日趨勢圖') + '">';
  for (let k = 0; k <= 4; k++) {
    const y = T + ph * k / 4;
    svg += '<line class="rpt-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/>';
    svg += '<text class="rpt-axis" x="' + (L - 5) + '" y="' + (y + 4) + '" text-anchor="end">' + rptTickLabel(maxL * (4 - k) / 4) + '</text>';
    if (dual) svg += '<text class="rpt-axis rpt-axis-b" x="' + (W - R + 5) + '" y="' + (y + 4) + '" text-anchor="start">' + rptTickLabel(maxR * (4 - k) / 4) + '</text>';
  }
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) {
    svg += '<text class="rpt-axis" x="' + xAt(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + rptFmtMD(dates[i]) + '</text>';
  }
  series.forEach(s => {
    const max = (s.axis === 'r') ? maxR : maxL;
    // null＝該日沒有資料（例如購買計數上線前）：線在這裡斷開、不畫點
    let seg = [];
    const flush = () => { if (seg.length) svg += '<polyline class="rpt-line rpt-line-' + (s.cls || 'a') + '" points="' + seg.join(' ') + '"/>'; seg = []; };
    s.values.forEach((v, i) => {
      if (v == null) { flush(); return; }
      seg.push(xAt(i).toFixed(1) + ',' + yAt(v, max).toFixed(1));
    });
    flush();
    if (n <= 35) {
      s.values.forEach((v, i) => {
        if (v == null) return;
        svg += '<circle class="rpt-dot rpt-dot-' + (s.cls || 'a') + '" cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(v, max).toFixed(1) + '" r="2.4"/>';
      });
    }
  });
  const colW = n <= 1 ? pw : pw / (n - 1);
  for (let i = 0; i < n; i++) {
    const tip = rptFmtMD(dates[i]) + '　' + series.map(s => s.name + ' ' + (s.values[i] == null ? '—' : rptFmtNum(s.values[i]))).join('｜');
    svg += '<rect class="rpt-hit" x="' + (xAt(i) - colW / 2).toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) +
      '" height="' + ph + '" data-tip="' + escHtml(tip) + '"><title>' + escHtml(tip) + '</title></rect>';
  }
  svg += '</svg>';
  const legend = '<div class="rpt-legend">' + series.map(s =>
    '<span class="rpt-legend-item"><i class="rpt-legend-dot rpt-dot-' + (s.cls || 'a') + '"></i>' + escHtml(s.name) +
    (dual ? (s.axis === 'r' ? '（右軸）' : '（左軸）') : '') + '</span>').join('') + '</div>';
  return '<div class="rpt-chart-wrap">' + legend + svg + '<div class="rpt-readout">點選或滑過圖表，查看當日數字</div></div>';
}

// 迷你長條圖（每日數字）
function rptMiniBarsSvg(dates, values, cls) {
  const W = 300, H = 44, n = values.length;
  if (!n) return '';
  const max = Math.max.apply(null, [1].concat(values));
  const bw = W / n;
  let svg = '<svg class="rpt-mini" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="每日數字">';
  values.forEach((v, i) => {
    const h = v > 0 ? Math.max(2, v / max * (H - 4)) : 0;
    const tip = rptFmtMD(dates[i]) + '　' + rptFmtNum(v);
    svg += '<rect class="rpt-mini-bg rpt-hit" x="' + (i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + H + '" data-tip="' + escHtml(tip) + '"><title>' + escHtml(tip) + '</title></rect>';
    if (h) svg += '<rect class="rpt-mini-bar rpt-bar-' + (cls || 'a') + '" x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + h.toFixed(1) + '" pointer-events="none"/>';
  });
  svg += '</svg>';
  return svg;
}

// ===================================================================
// DOM 渲染（呼叫上面的純函式取數字，再組 HTML）
// ===================================================================

function rptEl(id) { return document.getElementById(id); }

function rptCardHtml(label, value, extraHtml) {
  return '<div class="rpt-card"><div class="rpt-card-label">' + escHtml(label) +
    '</div><div class="rpt-card-value">' + value + '</div>' + (extraHtml || '') + '</div>';
}

function rptDeltaHtml(pct, vs) {
  if (pct === null || pct === undefined) return '<div class="rpt-card-delta">無可比較期間</div>';
  const cls = pct > 0.05 ? 'up' : (pct < -0.05 ? 'down' : '');
  const arrow = pct > 0.05 ? '▲' : (pct < -0.05 ? '▼' : '－');
  return '<div class="rpt-card-delta ' + cls + '">' + arrow + ' ' + Math.abs(pct).toFixed(1) + '%<span> 對比' + escHtml(vs) + '</span></div>';
}

// 累計版總覽（備援）
function rptRenderOverview(stats) {
  const el = rptEl('rptOverviewCards');
  if (!el) return;
  const o = rptComputeOverview(stats);
  el.innerHTML =
    rptCardHtml('今日頁面瀏覽', o.todayViews) +
    rptCardHtml('近7日頁面瀏覽', o.sevenViews) +
    rptCardHtml('近30日頁面瀏覽', o.thirtyViews) +
    rptCardHtml('全站累計點擊', o.totalClicks);
}

// 每日版總覽
function rptRenderOverviewDaily(stats) {
  const el = rptEl('rptOverviewCards');
  if (!el) return;
  const o = rptComputeOverviewDaily(rptState.idx, rptToday(), rptState.earliest);
  const oa = rptComputeOverview(stats);
  const buyCard = (label, m, vs) => o.hasBuy
    ? rptCardHtml(label, rptFmtNum(m.cur), vs === '昨日全天' ? '<div class="rpt-card-delta">今日尚未結束</div>' : rptDeltaHtml(m.pct, vs))
    : rptCardHtml(label, '—', '<div class="rpt-card-delta">新版精準計數上線後開始累積</div>');
  el.innerHTML =
    rptCardHtml('今日頁面瀏覽', rptFmtNum(o.views.today.cur), '<div class="rpt-card-delta">今日尚未結束（昨日全天 ' + rptFmtNum(o.views.yesterday.cur) + '）</div>') +
    rptCardHtml('昨日頁面瀏覽', rptFmtNum(o.views.yesterday.cur), rptDeltaHtml(o.views.yesterday.pct, '前日')) +
    rptCardHtml('近7日頁面瀏覽', rptFmtNum(o.views.d7.cur), rptDeltaHtml(o.views.d7.pct, '前7日')) +
    rptCardHtml('近30日頁面瀏覽', rptFmtNum(o.views.d30.cur), rptDeltaHtml(o.views.d30.pct, '前30日')) +
    buyCard('今日購買網址點擊', o.buy.today, '昨日全天') +
    buyCard('近7日購買網址點擊', o.buy.d7, '前7日') +
    buyCard('近30日購買網址點擊', o.buy.d30, '前30日') +
    rptCardHtml('全站累計點擊', rptFmtNum(oa.totalClicks), '<div class="rpt-card-delta">累計計數（含每日明細之前）</div>');

  const chart = rptEl('rptTrendChart');
  if (chart) {
    const series = [{ name: '頁面瀏覽', cls: 'a', axis: 'l', values: o.trend.views }];
    if (o.hasBuy) series.push({ name: '購買網址點擊', cls: 'b', axis: 'r', values: o.trend.buy });
    chart.innerHTML = rptLineChartSvg(o.trend.dates, series, { label: '近30日每日趨勢' }) +
      (o.hasBuy ? '' : '<div class="rpt-hint">購買網址點擊為新版精準計數，上線後才會出現第二條線。</div>');
  }
}

function rptRenderPageViewsTable(stats) {
  const el = rptEl('rptPageViewsTable');
  if (!el) return;
  const rows = rptComputePageViews(stats);
  const hasAny = rows.some(r => r.today || r.seven || r.thirty || r.total);
  if (!hasAny) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>頁面</th><th>今日</th><th>近7日</th><th>近30日</th><th>累計</th></tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr><td>' + escHtml(r.label) + '</td><td>' + r.today + '</td><td>' + r.seven +
      '</td><td>' + r.thirty + '</td><td>' + r.total + '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// 每日版各頁流量：點列展開近30日每日長條
function rptRenderPageViewsTableDaily(stats) {
  const el = rptEl('rptPageViewsTable');
  if (!el) return;
  const rows = rptComputePageTableDaily(rptState.idx, stats, rptToday());
  let html = '<table class="rpt-table"><thead><tr><th class="left">頁面</th><th>今日</th><th>昨日</th><th>近7日</th><th>近30日</th><th>累計</th></tr></thead><tbody>';
  rows.forEach(r => {
    const open = rptPageExpanded.has(r.key);
    html += '<tr class="rpt-row-clickable' + (open ? ' rpt-sel' : '') + '" data-pagekey="' + escHtml(r.key) + '">' +
      '<td class="left">' + escHtml(r.label) + (r.known ? '' : ' <span class="rpt-code">' + escHtml(r.key) + '</span>') + '</td>' +
      '<td>' + rptFmtNum(r.today) + '</td><td>' + rptFmtNum(r.yesterday) + '</td><td>' + rptFmtNum(r.seven) +
      '</td><td>' + rptFmtNum(r.thirty) + '</td><td>' + rptFmtNum(r.total) + '</td></tr>';
    if (open) {
      html += '<tr class="rpt-detail-row"><td colspan="6"><div class="rpt-detail-cap">近30日每日瀏覽（' + escHtml(rptFmtMD(r.dates[0])) + ' ～ ' + escHtml(rptFmtMD(r.dates[r.dates.length - 1])) + '）</div>' +
        rptMiniBarsSvg(r.dates, r.daily, 'a') + '<div class="rpt-readout rpt-readout-mini">點選或滑過長條，查看當日數字</div></td></tr>';
    }
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// 入口點擊表共用渲染（首頁入口卡片／左上角選單）：idx＝rptState.idx 或 null（每日明細不可用→只顯示累計欄）
// cfg: { elId, defs, prefix, withCtr, firstCol, emptyText, ctrNote }
function rptRenderClickTable(stats, cfg) {
  const el = rptEl(cfg.elId);
  if (!el) return;
  const idx = (rptState.ready === true && rptState.idx) ? rptState.idx : null;
  const h = rptComputeHomeCards(idx, stats, rptToday(), { defs: cfg.defs, prefix: cfg.prefix, withCtr: cfg.withCtr });
  if (!h.hasData) {
    el.innerHTML = '<div class="rpt-empty">' + escHtml(cfg.emptyText) + '</div>';
    return;
  }
  const num = v => (v === null ? '—' : rptFmtNum(v));
  const pct = v => (v === null ? '—' : v.toFixed(1) + '%');
  const tr = (r, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="left">' + escHtml(r.label) + '</td><td>' + num(r.today) +
    '</td><td>' + num(r.yesterday) + '</td><td>' + num(r.seven) + '</td><td>' + num(r.thirty) +
    '</td><td>' + num(r.total) + '</td>' + (cfg.withCtr ? '<td>' + pct(r.ctr) + '</td>' : '') + '</tr>';
  let html = '<table class="rpt-table"><thead><tr><th class="left">' + escHtml(cfg.firstCol) + '</th><th>今日</th><th>昨日</th><th>近7日</th><th>近30日</th><th>累計</th>' +
    (cfg.withCtr ? '<th>點擊率</th>' : '') + '</tr></thead><tbody>';
  h.rows.forEach(r => { html += tr(r, ''); });
  html += tr(h.totalRow, 'rpt-total-row');
  html += '</tbody></table>';
  html += '<div class="rpt-footnote">' + (h.since ? '自 ' + escHtml(rptFmtMD(h.since)) + ' 起計數。' : '') +
    (cfg.ctrNote || '') +
    (h.daily ? (cfg.ctrNote ? '。' : '') : (cfg.ctrNote ? '；' : '') + '每日明細暫不可用，僅顯示累計。') + '</div>';
  el.innerHTML = html;
}

// 首頁入口卡片點擊（各頁流量分頁、頁面表下方）
function rptRenderHomeCards(stats) {
  rptRenderClickTable(stats, {
    elId: 'rptHomeCardsTable', defs: RPT_HOME_CARD_DEFS, prefix: RPT_HOME_CARD_PREFIX, withCtr: true,
    firstCol: '入口卡片',
    emptyText: '首頁入口卡片點擊計數已上線，資料從上線當天開始累積',
    ctrNote: '點擊率＝近30日卡片點擊 ÷ 首頁（食譜大全）近30日瀏覽'
  });
}

// 左上角選單點擊（首頁入口卡片區塊下方；沒有點擊率）
function rptRenderMenuClicks(stats) {
  rptRenderClickTable(stats, {
    elId: 'rptMenuClicksTable', defs: RPT_MENU_DEFS, prefix: RPT_MENU_PREFIX, withCtr: false,
    firstCol: '選單項目',
    emptyText: '選單點擊計數已上線，資料從上線當天開始累積',
    ctrNote: ''
  });
}

function rptRenderBooksButtonsTable(stats) {
  const el = rptEl('rptBooksButtonsTable');
  if (!el) return;
  const rows = rptComputeBooksButtons(stats);
  const hasAny = rows.some(r => r.today || r.seven || r.thirty || r.total);
  if (!hasAny) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>按鈕</th><th>今日</th><th>近7日</th><th>近30日</th><th>累計</th></tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr><td>' + escHtml(r.label) + '</td><td>' + r.today + '</td><td>' + r.seven +
      '</td><td>' + r.thirty + '</td><td>' + r.total + '</td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptSourceItemsTagsHtml(items) {
  const shown = (items || []).filter(i => i.count > 0);
  if (!shown.length) return '';
  return shown.map(i => '<span style="opacity:.7;font-size:10.5px;">' + escHtml(i.label) + ' ' + i.count + '</span>').join('');
}

function rptRenderSourceTable(stats) {
  const el = rptEl('rptSourceTable');
  if (!el) return;
  const rows = rptComputeSourceOverview(stats);
  const hasAny = rows.some(r => r.total > 0);
  if (!hasAny) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>來源</th><th>總點擊</th></tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr><td>' + escHtml(r.label) + '</td><td>' + r.total + '</td></tr>';
    const subTags = rptSourceItemsTagsHtml(r.items);
    if (subTags) {
      html += '<tr class="rpt-detail-row"><td colspan="2"><div class="rpt-detail-tags">' + subTags + '</div></td></tr>';
    }
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// 每日版點擊來源總覽（近30日）：來源攤平＋入口／購買網址點擊
function rptRenderSourceTableDaily(titleOf) {
  const el = rptEl('rptSourceTable');
  if (!el) return;
  const to = rptToday(), from = rptAddDays(to, -29);
  const v = rptComputeBuyView(rptState.idx, from, to, { titleOf });
  if (!v.bySource.length) { el.innerHTML = '<div class="rpt-empty">近30日尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th class="left">來源</th><th>入口點擊</th>' +
    (v.hasBuyAny ? '<th>購買網址點擊</th>' : '') + '</tr></thead><tbody>';
  v.bySource.forEach(r => {
    html += '<tr><td class="left">' + escHtml(r.label) + '</td><td>' + rptFmtNum(r.entry) + '</td>' +
      (v.hasBuyAny ? '<td>' + (r.buy ? rptFmtNum(r.buy) : '—') + '</td>' : '') + '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptRenderBlockTable(stats) {
  const el = rptEl('rptBlockTable');
  if (!el) return;
  const rows = rptComputeBlockStats(stats, (typeof customBlocks !== 'undefined') ? customBlocks : []);
  if (!rows.length) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>區塊名稱</th><th>點擊數</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + escHtml(r.name) + '</td><td>' + r.clicks + '</td></tr>'; });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptRenderBlockTableDaily() {
  const el = rptEl('rptBlockTable');
  if (!el) return;
  const to = rptToday(), from = rptAddDays(to, -29);
  const rows = rptComputeBlockStatsDaily(rptState.idx, from, to, (typeof customBlocks !== 'undefined') ? customBlocks : []);
  if (!rows.length) { el.innerHTML = '<div class="rpt-empty">近30日尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>區塊名稱</th><th>點擊數</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + escHtml(r.name) + '</td><td>' + r.clicks + '</td></tr>'; });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptFormatDatePart(datePart) {
  return datePart ? datePart.replace(/-/g, '/') : '—';
}

function rptRenderGroupRankTable() {
  const el = rptEl('rptGroupRankTable');
  if (!el) return;

  if (!rptGroupRows.length) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }

  const filterInput = rptEl('rptGroupFilterInput');
  const filterText = filterInput ? filterInput.value.trim().toLowerCase() : '';
  const rows = filterText
    ? rptGroupRows.filter(r => String(r.title).toLowerCase().indexOf(filterText) !== -1)
    : rptGroupRows;

  if (!rows.length) {
    el.innerHTML = '<div class="rpt-empty">找不到符合「' + escHtml(filterText) + '」的團購</div>';
    return;
  }

  let html = '<table class="rpt-table"><thead><tr>' +
    '<th>團名</th><th>開團日</th><th>曝光</th><th>總點擊</th><th>介紹</th><th>食譜</th><th>下單</th><th>折扣碼</th>' +
    '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr class="rpt-row-clickable" data-evkey="' + escHtml(r.evKey) + '">' +
      '<td>' + escHtml(r.title) + '</td>' +
      '<td>' + escHtml(rptFormatDatePart(r.datePart)) + '</td>' +
      '<td>' + r.views + '</td>' +
      '<td>' + r.clicks + '</td>' +
      '<td>' + r.intro + '</td>' +
      '<td>' + r.recipe + '</td>' +
      '<td>' + r.order + '</td>' +
      '<td>' + r.code + '</td>' +
      '</tr>';
    if (rptExpandedKeys.has(r.evKey)) {
      const tagsHtml = r.sources.map(s => '<span>' + escHtml(s.label) + ' ' + s.count + '</span>').join('');
      const subTagsHtml = r.sources.map(s => rptSourceItemsTagsHtml(s.items)).join('');
      html += '<tr class="rpt-detail-row"><td colspan="8"><div class="rpt-detail-tags">' +
        (tagsHtml || '（無來源拆解資料）') + '</div>' +
        (subTagsHtml ? '<div class="rpt-detail-tags" style="margin-top:2px;">' + subTagsHtml + '</div>' : '') +
        '</td></tr>';
    }
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ----- 購買點擊分頁 -----

// 目前選定的區間 {from,to}（預設值每次依「今天」重算，不存死日期）
function rptResolveBuyRange() {
  const today = rptToday();
  if (rptBuy.preset === 'today') return { from: today, to: today };
  if (rptBuy.preset === '7d') return { from: rptAddDays(today, -6), to: today };
  if (rptBuy.preset === 'custom' && rptBuy.customFrom && rptBuy.customTo) {
    return { from: rptBuy.customFrom, to: rptBuy.customTo };
  }
  return { from: rptAddDays(today, -29), to: today };
}

// 取得涵蓋該區間的索引：主視窗（今天往前 92 天）內直接用；超出的另外抓一次並快取
function rptGetBuyIdx(range) {
  if (rptState.idx && range.from >= rptState.from && range.to <= rptState.to) return { idx: rptState.idx };
  const key = range.from + '|' + range.to;
  const c = rptRangeCache[key];
  if (c) return c.error ? { error: c.error } : { idx: c.idx };
  rptFetchRange(range, key);
  return { loading: true };
}

async function rptFetchRange(range, key) {
  if (rptRangeCache['_pending_' + key]) return;
  rptRangeCache['_pending_' + key] = true;
  try {
    const res = await postTask({ type: 'stat-report-daily', from: range.from, to: range.to });
    if (res && res.tableReady === false) rptRangeCache[key] = { error: RPT_NOTICE_NOT_READY };
    else if (!res || res.success !== true || !Array.isArray(res.rows)) rptRangeCache[key] = { error: '載入失敗：' + ((res && res.error) || '回應格式不符') };
    else rptRangeCache[key] = { idx: rptBuildDailyIndex(res.rows) };
  } catch (err) {
    rptRangeCache[key] = { error: '載入失敗：' + err.message };
  }
  delete rptRangeCache['_pending_' + key];
  rptRenderBuy();
}

function rptBuyTitleOf() {
  return rptBuildTitleMap((typeof allEvents !== 'undefined' && Array.isArray(allEvents)) ? allEvents : []);
}

function rptShareBar(pct) {
  return '<span class="rpt-share"><i style="width:' + Math.min(100, Math.max(0, pct)).toFixed(1) + '%"></i></span>';
}

function rptRenderBuyChips(titleOf) {
  const el = rptEl('rptBuyChips');
  if (!el) return;
  const chips = [];
  if (rptBuy.ev) chips.push('<button type="button" class="rpt-chip" data-clear="ev">團購：' + escHtml(titleOf(rptBuy.ev)) + ' ✕</button>');
  if (rptBuy.src) chips.push('<button type="button" class="rpt-chip" data-clear="src">來源：' + escHtml(rptSourceLabel(rptBuy.src)) + ' ✕</button>');
  if (rptBuy.q) chips.push('<button type="button" class="rpt-chip" data-clear="q">搜尋：' + escHtml(rptBuy.q) + ' ✕</button>');
  if (!chips.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="rpt-chips"><span class="rpt-chips-label">目前篩選</span>' + chips.join('') +
    '<button type="button" class="rpt-chip rpt-chip-clear" data-clear="all">清除全部</button></div>';
}

function rptRenderBuy() {
  const body = rptEl('rptBuyBody');
  if (!body) return;
  // 預設值同步到 UI
  const range = rptResolveBuyRange();
  document.querySelectorAll('.rpt-preset').forEach(b => b.classList.toggle('on', b.dataset.preset === rptBuy.preset));
  const customBox = rptEl('rptBuyCustom');
  if (customBox) customBox.hidden = rptBuy.preset !== 'custom';
  const chipsEl = rptEl('rptBuyChips');

  if (!(rptState.ready === true && rptState.idx)) {
    if (chipsEl) chipsEl.innerHTML = '';
    body.innerHTML = '<div class="rpt-empty">' + escHtml(rptState.ready === null ? '每日資料載入中…' : (rptState.error || RPT_NOTICE_NOT_READY)) +
      '<br><span class="rpt-hint">購買點擊分析需要每日明細，資料庫更新後會自動出現。</span></div>';
    return;
  }
  const got = rptGetBuyIdx(range);
  if (got.loading) { body.innerHTML = '<div class="rpt-empty">載入中…</div>'; return; }
  if (got.error) { body.innerHTML = '<div class="rpt-empty">' + escHtml(got.error) + '</div>'; return; }

  const titleOf = rptBuyTitleOf();
  rptRenderBuyChips(titleOf);
  const v = rptComputeBuyView(got.idx, range.from, range.to, { q: rptBuy.q, src: rptBuy.src, ev: rptBuy.ev, titleOf });
  const days = v.dates.length;
  const early = rptState.earliest && range.from < rptState.earliest;

  let html = '<div class="rpt-range-note">統計區間 ' + escHtml(range.from) + ' ～ ' + escHtml(range.to) + '（' + days + ' 天）' +
    (early ? '；每日明細最早只到 ' + escHtml(rptState.earliest) + '，更早的日子以 0 計' : '') + '</div>';

  // 摘要卡
  html += '<div class="rpt-overview-grid rpt-mini-cards">' +
    rptCardHtml('曝光', rptFmtNum(v.totals.views)) +
    rptCardHtml('入口點擊', rptFmtNum(v.totals.entry)) +
    rptCardHtml('購買網址點擊', v.hasBuyAny ? rptFmtNum(v.totals.buy) : '—',
      v.hasBuyAny ? '' : '<div class="rpt-card-delta">新版精準計數上線後開始累積</div>') + '</div>';

  // 趨勢
  const tSeries = [];
  const hasBuyLine = v.trend.buy.some(x => x > 0);
  tSeries.push({ name: '入口點擊', cls: 'a', axis: 'l', values: v.trend.entry });
  if (hasBuyLine) tSeries.push({ name: '購買網址點擊', cls: 'b', axis: 'r', values: v.trend.buy });
  html += '<div class="rpt-section"><div class="rpt-section-title">每日購買點擊趨勢</div>' +
    rptLineChartSvg(v.trend.dates, tSeries, { label: '每日購買點擊趨勢' }) +
    (hasBuyLine ? '' : '<div class="rpt-hint">此區間尚無購買網址點擊，先以入口點擊呈現。</div>') + '</div>';

  // 依來源
  html += '<div class="rpt-section"><div class="rpt-section-title">依來源<span class="rpt-title-note">點來源可篩選團購</span></div><div class="rpt-table-wrap">';
  if (!v.bySource.length) html += '<div class="rpt-empty">此區間沒有來源資料</div>';
  else {
    html += '<table class="rpt-table"><thead><tr><th class="left">來源</th><th>入口點擊</th><th>購買網址點擊</th><th>佔比</th></tr></thead><tbody>';
    v.bySource.forEach(r => {
      html += '<tr class="rpt-row-clickable' + (rptBuy.src === r.code ? ' rpt-sel' : '') + '" data-src="' + escHtml(r.code) + '">' +
        '<td class="left">' + escHtml(r.label) + '</td><td>' + rptFmtNum(r.entry) + '</td><td>' + (r.buy ? rptFmtNum(r.buy) : '—') +
        '</td><td class="rpt-share-cell">' + r.share.toFixed(1) + '%' + rptShareBar(r.share) + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div></div>';

  // 依團購
  const sortedEv = rptSortBuyEvents(v.byEvent, rptBuy.sortKey, rptBuy.sortDir);
  const th = (key, label) => '<th class="sortable' + (rptBuy.sortKey === key ? ' sorted' : '') + '" data-sort="' + key + '">' + label +
    (rptBuy.sortKey === key ? (rptBuy.sortDir < 0 ? ' ▾' : ' ▴') : '') + '</th>';
  html += '<div class="rpt-section"><div class="rpt-section-title">依團購<span class="rpt-title-note">點團購可篩選來源與按鈕；點欄位標題排序</span></div><div class="rpt-table-wrap">';
  if (!sortedEv.length) html += '<div class="rpt-empty">找不到符合條件的團購</div>';
  else {
    html += '<table class="rpt-table"><thead><tr><th class="left">團名</th>' + th('views', '曝光') + th('entry', '入口點擊') + th('buy', '購買網址點擊') +
      th('order', '下單按鈕') + th('code', '折扣碼') + th('intro', '介紹') + th('recipe', '食譜') + th('conv', '轉換率') + '</tr></thead><tbody>';
    sortedEv.forEach(r => {
      const sel = rptBuy.ev === r.evKey;
      const conv = r.conv ? r.conv.pct.toFixed(1) + '%' + (r.conv.kind === 'legacy' ? ' <span class="rpt-old">舊版</span>' : '') : '—';
      html += '<tr class="rpt-row-clickable' + (sel ? ' rpt-sel' : '') + '" data-evkey="' + escHtml(r.evKey) + '">' +
        '<td class="left">' + escHtml(r.title) + '</td><td>' + rptFmtNum(r.views) + '</td><td>' + rptFmtNum(r.entry) + '</td><td>' + (r.buy ? rptFmtNum(r.buy) : '—') +
        '</td><td>' + rptFmtNum(r.order) + '</td><td>' + rptFmtNum(r.code) + '</td><td>' + rptFmtNum(r.intro) + '</td><td>' + rptFmtNum(r.recipe) +
        '</td><td>' + conv + '</td></tr>';
      if (sel) {
        const d = rptComputeEventDetail(got.idx, r.evKey, range.from, range.to);
        const tags = d.sources.map(s => '<span>' + escHtml(s.label) + ' 入口 ' + rptFmtNum(s.entry) + (s.buy ? ' · 購買 ' + rptFmtNum(s.buy) : '') + '</span>').join('');
        html += '<tr class="rpt-detail-row"><td colspan="9"><div class="rpt-detail-cap">各來源</div><div class="rpt-detail-tags">' + (tags || '（此區間無來源資料）') + '</div>' +
          '<div class="rpt-detail-cap">每日入口點擊</div>' + rptMiniBarsSvg(d.dates, d.entryDaily, 'a') +
          (d.buyDaily.some(x => x > 0) ? '<div class="rpt-detail-cap">每日購買網址點擊</div>' + rptMiniBarsSvg(d.dates, d.buyDaily, 'b') : '') +
          '<div class="rpt-readout rpt-readout-mini">點選或滑過長條，查看當日數字</div></td></tr>';
      }
    });
    html += '</tbody></table>';
  }
  html += '</div></div>';

  // 按鈕種類
  html += '<div class="rpt-section"><div class="rpt-section-title">按鈕種類</div><div class="rpt-table-wrap">' +
    '<table class="rpt-table"><thead><tr><th class="left">按鈕</th><th>區間加總</th><th>每日</th></tr></thead><tbody>';
  v.buttons.concat(v.booksButtons, v.pageButtons).forEach(b => {
    html += '<tr><td class="left">' + escHtml(b.label) + '</td><td>' + rptFmtNum(b.total) + '</td><td class="rpt-mini-cell">' + rptMiniBarsSvg(v.dates, b.daily, 'a') + '</td></tr>';
  });
  html += '</tbody></table></div>' +
    (rptBuy.src ? '<div class="rpt-hint">按鈕種類不分來源，不受「來源」篩選影響。</div>' : '') +
    (rptBuy.ev ? '<div class="rpt-hint">已選單一團購：繪本館、開學姓名貼頁面按鈕不屬於團購，暫不列出。</div>' : '') +
    '<div class="rpt-readout rpt-readout-mini">點選或滑過長條，查看當日數字</div></div>';

  html += '<div class="rpt-footnote">入口點擊＝點了團購入口（可能只是開視窗）；購買網址點擊＝實際開啟購買連結（新版精準計數）。轉換率＝購買網址點擊 ÷ 曝光；尚無購買網址點擊的團退而顯示「下單按鈕 ÷ 曝光」並標「舊版」。</div>';
  body.innerHTML = html;
}

// ----- 分頁殼與各面板 -----

function rptSaveTab(tab) {
  try { localStorage.setItem(RPT_TAB_LS_KEY, tab); } catch (e) { /* 瀏覽器擋 storage 就不記 */ }
}

function rptLoadSavedTab() {
  try {
    const t = localStorage.getItem(RPT_TAB_LS_KEY);
    if (RPT_TAB_KEYS.indexOf(t) !== -1) return t;
  } catch (e) { /* ignore */ }
  return 'overview';
}

function rptSelectTab(tab, save) {
  if (RPT_TAB_KEYS.indexOf(tab) === -1) tab = 'overview';
  rptTab = tab;
  document.querySelectorAll('#viewReport .rpt-tab').forEach(b => b.classList.toggle('on', b.dataset.rptTab === tab));
  document.querySelectorAll('#viewReport .rpt-panel').forEach(p => p.classList.toggle('on', p.dataset.rptPanel === tab));
  if (save) rptSaveTab(tab);
}

function rptRenderNotice() {
  const el = rptEl('rptDailyNotice');
  if (!el) return;
  if (rptState.ready === false) {
    el.textContent = rptState.error ? ('每日明細載入失敗（' + rptState.error + '），暫以累計資料顯示') : RPT_NOTICE_NOT_READY;
    el.hidden = false;
  } else if (rptState.ready === null && rptState.loading) {
    el.textContent = '每日明細載入中…';
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

function rptRenderPerfModeUi() {
  const ok = rptState.ready === true;
  document.querySelectorAll('.rpt-perfmode').forEach(b => {
    b.classList.toggle('on', (ok ? rptPerfMode : 'all') === b.dataset.mode);
    if (b.dataset.mode === '30d') b.disabled = !ok;
  });
}

function rptRenderAllPanels() {
  const stats = (typeof statsMap !== 'undefined' && statsMap) ? statsMap : {};
  const events = (typeof allEvents !== 'undefined' && Array.isArray(allEvents)) ? allEvents : [];
  const ok = rptState.ready === true && !!rptState.idx;
  rptRenderNotice();

  // 總覽
  if (ok) rptRenderOverviewDaily(stats);
  else {
    rptRenderOverview(stats);
    const chart = rptEl('rptTrendChart');
    if (chart) chart.innerHTML = '<div class="rpt-empty">' + escHtml(rptState.ready === null ? '每日資料載入中…' : '每日趨勢需要每日明細，暫不顯示') + '</div>';
  }

  // 各頁流量
  const booksSec = rptEl('rptBooksSection');
  if (ok) {
    rptRenderPageViewsTableDaily(stats);
    if (booksSec) booksSec.hidden = true;   // 每日版的繪本館按鈕在「購買點擊 → 按鈕種類」
  } else {
    rptRenderPageViewsTable(stats);
    rptRenderBooksButtonsTable(stats);
    if (booksSec) booksSec.hidden = false;
  }

  // 首頁入口卡片點擊（每日明細可用→全欄；否則只累計）
  rptRenderHomeCards(stats);
  rptRenderMenuClicks(stats);

  // 購買點擊
  rptRenderBuy();

  // 團購成效
  rptRenderPerfModeUi();
  const titleOf = rptBuildTitleMap(events);
  if (ok && rptPerfMode === '30d') {
    const to = rptToday(), from = rptAddDays(to, -29);
    rptGroupRows = rptComputeGroupRankingDaily(rptState.idx, from, to, titleOf);
    rptRenderGroupRankTable();
    rptRenderSourceTableDaily(titleOf);
    rptRenderBlockTableDaily();
  } else {
    rptGroupRows = rptComputeGroupRanking(stats, events);
    rptRenderGroupRankTable();
    rptRenderSourceTable(stats);
    rptRenderBlockTable(stats);
  }
}

// 載入每日彙總（主視窗＝今天往前 92 天；含前一等長期間比較所需的 60 天）
async function rptLoadDaily() {
  if (rptState.loading) return;
  rptState.loading = true;
  rptRangeCache = {};
  const today = rptToday();
  const from = rptAddDays(today, -(RPT_DAILY_MAX_DAYS - 1));
  try {
    const res = await postTask({ type: 'stat-report-daily', from, to: today });
    if (!res || res.tableReady === false) {
      rptState.ready = false; rptState.idx = null; rptState.error = '';
    } else if (res.success !== true || !Array.isArray(res.rows)) {
      rptState.ready = false; rptState.idx = null; rptState.error = res.error || '回應格式不符';
    } else {
      rptState.idx = rptBuildDailyIndex(res.rows);
      rptState.from = from; rptState.to = today;
      rptState.earliest = res.earliest || '';
      rptState.ready = true; rptState.error = '';
    }
  } catch (err) {
    rptState.ready = false; rptState.idx = null; rptState.error = err.message || '未知錯誤';
  }
  rptState.loading = false;
  rptState.loadedAt = Date.now();
  rptRenderAllPanels();
}

// 進入分頁時視需要（沒載過／過期）重抓每日資料
function rptEnsureDaily() {
  if (rptState.loading) return;
  const age = Date.now() - rptState.loadedAt;
  const fresh = rptState.ready === true ? RPT_DAILY_FRESH_MS : 60 * 1000;
  if (rptState.ready === null || age > fresh) rptLoadDaily();
}

// 分頁切換進入「報表統計」時由 admin.js 的 switchView() 呼叫
function renderReportView() {
  if (!rptTabRestored) { rptTab = rptLoadSavedTab(); rptTabRestored = true; }
  rptSelectTab(rptTab, false);
  rptRenderAllPanels();
  rptEnsureDaily();
}

// ===================================================================
// 模組最外層：只掛 DOM 事件，不主動呼叫 admin.js 的函式
// （點擊/輸入事件的 callback 本體會在使用者互動當下才執行，那時 admin.js 早已載入完成）
// ===================================================================
(function rptWireEvents() {
  const refreshBtn = document.getElementById('rptRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      if (typeof setFormStatus === 'function') setFormStatus('rptRefreshStatus', '重新整理中…', '');
      try {
        const result = await postTask({ type: 'stat-report' });
        if (result && result.stats) statsMap = result.stats;
        rptState.loading = false;
        await rptLoadDaily();
        if (typeof setFormStatus === 'function') {
          setFormStatus('rptRefreshStatus', '已更新 · ' + new Date().toLocaleTimeString('zh-TW'), '');
        }
      } catch (err) {
        renderReportView();
        if (typeof setFormStatus === 'function') {
          setFormStatus('rptRefreshStatus', '更新失敗：' + err.message, 'error');
        }
      }
      refreshBtn.disabled = false;
    });
  }

  const filterInput = document.getElementById('rptGroupFilterInput');
  if (filterInput) {
    filterInput.addEventListener('input', () => rptRenderGroupRankTable());
  }

  // 事件委派：點一列展開/收合來源拆解，不用每次重繪都重新掛一次列監聽器
  const rankTableWrap = document.getElementById('rptGroupRankTable');
  if (rankTableWrap) {
    rankTableWrap.addEventListener('click', (e) => {
      const tr = e.target.closest ? e.target.closest('tr.rpt-row-clickable') : null;
      if (!tr) return;
      const key = tr.dataset.evkey;
      if (!key) return;
      if (rptExpandedKeys.has(key)) rptExpandedKeys.delete(key); else rptExpandedKeys.add(key);
      rptRenderGroupRankTable();
    });
  }

  // 子分頁切換
  const tabs = document.getElementById('rptTabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('.rpt-tab') : null;
      if (!b) return;
      rptSelectTab(b.dataset.rptTab, true);
    });
  }

  // 團購成效：近30日／累計
  const perfMode = document.getElementById('rptPerfModes');
  if (perfMode) {
    perfMode.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('.rpt-perfmode') : null;
      if (!b || b.disabled) return;
      rptPerfMode = b.dataset.mode;
      rptRenderAllPanels();
    });
  }

  // 各頁流量：點列展開近30日長條
  const pagesWrap = document.getElementById('rptPageViewsTable');
  if (pagesWrap) {
    pagesWrap.addEventListener('click', (e) => {
      const tr = e.target.closest ? e.target.closest('tr[data-pagekey]') : null;
      if (!tr) return;
      const key = tr.dataset.pagekey;
      if (rptPageExpanded.has(key)) rptPageExpanded.delete(key); else rptPageExpanded.add(key);
      if (rptState.ready === true && rptState.idx) {
        rptRenderPageViewsTableDaily((typeof statsMap !== 'undefined' && statsMap) ? statsMap : {});
      }
    });
  }

  // 購買點擊：預設區間／自訂區間／搜尋
  const presets = document.getElementById('rptBuyPresets');
  if (presets) {
    presets.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('.rpt-preset') : null;
      if (!b) return;
      rptBuy.preset = b.dataset.preset;
      if (rptBuy.preset === 'custom') {
        const r = rptResolveBuyRange();
        const f = rptEl('rptBuyFrom'), t = rptEl('rptBuyTo');
        if (f && !f.value) f.value = r.from;
        if (t && !t.value) t.value = r.to;
      }
      rptRenderBuy();
    });
  }
  const applyBtn = document.getElementById('rptBuyApply');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const f = rptEl('rptBuyFrom').value, t = rptEl('rptBuyTo').value;
      const st = rptEl('rptBuyRangeStatus');
      const say = (m) => { if (st) st.textContent = m; };
      if (!f || !t) { say('請選擇起訖日'); return; }
      const today = rptToday();
      const to = t > today ? today : t;
      if (f > to) { say('起日不能晚於迄日'); return; }
      if (rptDateList(f, to).length > RPT_DAILY_MAX_DAYS) { say('區間最多 ' + RPT_DAILY_MAX_DAYS + ' 天'); return; }
      say('');
      rptBuy.customFrom = f; rptBuy.customTo = to; rptBuy.preset = 'custom';
      rptRenderBuy();
    });
  }
  const buyQ = document.getElementById('rptBuyQ');
  if (buyQ) {
    buyQ.addEventListener('input', () => { rptBuy.q = buyQ.value.trim(); rptRenderBuy(); });
  }

  // 購買點擊：交叉篩選（點團／點來源／排序／清除）
  const buyBody = document.getElementById('rptBuyBody');
  if (buyBody) {
    buyBody.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest) return;
      if (t.closest('.rpt-hit')) return;   // 點迷你圖／趨勢圖只讀數字，不觸發篩選
      const thEl = t.closest('th[data-sort]');
      if (thEl) {
        const k = thEl.dataset.sort;
        if (rptBuy.sortKey === k) rptBuy.sortDir = -rptBuy.sortDir; else { rptBuy.sortKey = k; rptBuy.sortDir = -1; }
        rptRenderBuy();
        return;
      }
      const srcTr = t.closest('tr[data-src]');
      if (srcTr) {
        rptBuy.src = (rptBuy.src === srcTr.dataset.src) ? null : srcTr.dataset.src;
        rptRenderBuy();
        return;
      }
      const evTr = t.closest('tr[data-evkey]');
      if (evTr) {
        rptBuy.ev = (rptBuy.ev === evTr.dataset.evkey) ? null : evTr.dataset.evkey;
        rptRenderBuy();
      }
    });
  }
  const buyChips = document.getElementById('rptBuyChips');
  if (buyChips) {
    buyChips.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-clear]') : null;
      if (!b) return;
      const w = b.dataset.clear;
      if (w === 'ev' || w === 'all') rptBuy.ev = null;
      if (w === 'src' || w === 'all') rptBuy.src = null;
      if (w === 'q' || w === 'all') { rptBuy.q = ''; const q = rptEl('rptBuyQ'); if (q) q.value = ''; }
      rptRenderBuy();
    });
  }

  // 圖表／迷你長條：滑過或點選顯示當日數字（也有原生 <title> tooltip）
  const view = document.getElementById('viewReport');
  if (view) {
    const showTip = (e) => {
      const hit = e.target.closest ? e.target.closest('.rpt-hit') : null;
      if (!hit) return;
      const wrap = hit.closest('.rpt-chart-wrap') || hit.closest('.rpt-detail-row td') || hit.closest('.rpt-section') || hit.parentNode;
      const out = wrap && wrap.querySelector ? wrap.querySelector('.rpt-readout') : null;
      if (out) out.textContent = hit.getAttribute('data-tip') || '';
    };
    view.addEventListener('mouseover', showTip);
    view.addEventListener('click', showTip);
  }
})();
