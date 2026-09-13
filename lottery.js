// ===================================================================
// lottery.js — 抽獎管理（抽獎活動＋得獎人，原本只能直接改試算表）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 subscriptions.js／
// books.js）。理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好
// 停在 lottery、本檔卻排在後面，開機當下 loadLotteryView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的內部函式；
// 跟 admin.js 共用的只有全域 currentToken／hasEditPerm／copyText／allEvents／
// openEventEditModal／switchView 等（同 books.js 的做法，呼叫前一律 typeof 防呆）。
//
// 對應設計正本：dondon-platform/docs/09-lottery-design.md §4/§5/§10。
// ===================================================================

const LOTTERY_API_URL = 'https://dondon-platform.vercel.app/api/lottery';

let LOTTERY_LOADED = false;
let LOTTERY_DRAWS = [];
let LOTTERY_STATS = {};
let LOTTERY_EVENT_CHOICES = [];
let LOTTERY_BRAND_CHOICES = [];
let LOTTERY_PENDING_DRAWS = [];   // 「待抽」來源 2：結團滿 2 週還沒建抽獎的虛擬卡（docs/09 §4.5）
let LOTTERY_SKIPPED_EVENTS = [];  // 「這團不抽」略過清單（{eventId,title}[]，篩選區底部可還原）
let LOTTERY_TABLE_READY = true;
let LOTTERY_CAN_EDIT = true;          // hasEditPerm('lotteryEdit') 的快取，每次載入/渲染時重算
let LOTTERY_VIEW = 'cards';           // 'cards'｜'todo'
let LOTTERY_FILTER = { status: 'all', brand: '', year: '', q: '', monthOnly: false };
let LOTTERY_EDIT_DRAW_ID = null;      // 目前 lotteryDrawModal 編輯中的活動 id；null＝新增
let LOTTERY_WINNER_EDIT = null;       // { drawId, winnerId }；winnerId=null＝新增
const LOTTERY_EXPANDED_OVERRIDE = {}; // 使用者手動展開/收合過的卡片，drawId -> true/false，蓋過自動展開規則

// 狀態機（§3）：代碼 -> 顯示名／CSS 修飾字／進度條顏色 class
const LOT_STATUS_LABEL = {
  pending: '待聯絡', awaiting_info: '待回填資料', info_ready: '待寄出',
  handed_to_vendor: '廠商寄送中', done: '已完成', redrawn: '已重抽'
};
const LOT_STATUS_ORDER = ['pending', 'awaiting_info', 'info_ready', 'handed_to_vendor', 'done', 'redrawn'];
const LOT_SHIP_BY_LABEL = { self: '自寄', vendor: '廠商寄', none: '不用寄' };
// 篩選 chips：待聯絡刻意不列（§4.1 原文只有這六顆，全部／待回填／待寄出／廠商寄送中／已完成／已重抽）
const LOT_FILTER_CHIPS = [
  { key: 'all', label: '全部' },
  { key: 'pending_draw', label: '待抽' },
  { key: 'awaiting_info', label: '待回填' },
  { key: 'info_ready', label: '待寄出' },
  { key: 'handed_to_vendor', label: '廠商寄送中' },
  { key: 'done', label: '已完成' },
  { key: 'redrawn', label: '已重抽' }
];
// 待辦清單視圖不含已完成/已重抽（本來就篩掉了），chips 只留跟它相關的四顆
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
// YYYY-MM-DD -> M/D（給行事曆團下拉／卡頭日期用；解析不了原樣回傳）
function lotFmtMD(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dateStr;
  return Number(m[2]) + '/' + Number(m[3]);
}
// 卡頭抽獎日顯示：日期確定＝完整 YYYY-MM-DD；不確定＝只顯示 M/D＋⚠ 提醒
function lotFmtDrawDate(draw) {
  if (!draw.drawDate) return '';
  if (draw.dateUncertain) return '⚠ 抽獎日 ' + lotFmtMD(draw.drawDate) + '（年份待確認）';
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

// ===== 載入 =====
function loadLotteryView(forceReload) {
  if (LOTTERY_LOADED && !forceReload) return;
  const bodyEl = document.getElementById('lotBody');
  bodyEl.innerHTML = '<div class="task-empty">讀取中…</div>';
  document.getElementById('lotBanner').innerHTML = '';
  document.getElementById('lotTiles').innerHTML = '';
  document.getElementById('lotFilters').innerHTML = '';
  lotApiGet().then(data => {
    if (!data || !data.success) {
      bodyEl.innerHTML = '<div class="task-empty">讀取失敗：' + lotEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    LOTTERY_LOADED = true;
    LOTTERY_TABLE_READY = data.tableReady !== false;
    LOTTERY_DRAWS = Array.isArray(data.draws) ? data.draws : [];
    LOTTERY_STATS = data.stats || {};
    LOTTERY_EVENT_CHOICES = Array.isArray(data.eventChoices) ? data.eventChoices : [];
    LOTTERY_BRAND_CHOICES = Array.isArray(data.brandChoices) ? data.brandChoices : [];
    LOTTERY_PENDING_DRAWS = Array.isArray(data.pendingDraws) ? data.pendingDraws : [];
    LOTTERY_SKIPPED_EVENTS = Array.isArray(data.skippedEvents) ? data.skippedEvents : [];
    LOTTERY_CAN_EDIT = typeof hasEditPerm !== 'function' || hasEditPerm('lotteryEdit');
    document.getElementById('lotAddDrawBtn').style.display = LOTTERY_CAN_EDIT ? '' : 'none';
    renderLotteryBanner();
    if (!LOTTERY_TABLE_READY) {
      document.getElementById('lotTiles').innerHTML = '';
      document.getElementById('lotFilters').innerHTML = '';
      bodyEl.innerHTML = '';
      return;
    }
    renderLotteryTiles();
    renderLotteryFilters();
    renderLotteryBody();
  }).catch(err => {
    bodyEl.innerHTML = '<div class="task-empty">讀取失敗：' + lotEscapeHtml(err.message || '') + '</div>';
  });
}

function renderLotteryBanner() {
  const box = document.getElementById('lotBanner');
  if (!LOTTERY_TABLE_READY) {
    box.innerHTML = '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">' +
      '⚠️ 抽獎資料表尚未建立，請雪莉先在 PowerShell 執行 npx supabase db push。</div>';
  } else {
    box.innerHTML = '';
  }
}

// ===== 摘要磚（點磚套篩選）=====
function renderLotteryTiles() {
  const box = document.getElementById('lotTiles');
  const s = LOTTERY_STATS || {};
  const tile = (key, cls, n, label) =>
    '<div class="lot-tile ' + cls + (isTileActive(key) ? ' on' : '') + '" data-tile="' + key + '">' +
    '<div class="lot-tile-n">' + (n || 0) + '</div><div class="lot-tile-l">' + label + '</div></div>';
  function isTileActive(key) {
    if (key === 'month') return LOTTERY_FILTER.monthOnly;
    return LOTTERY_FILTER.status === key;
  }
  box.innerHTML =
    tile('awaiting_info', 'await', s.awaitingInfo, '待回填資料') +
    tile('info_ready', 'ready', s.infoReady, '待寄出') +
    tile('handed_to_vendor', 'vendor', s.handedToVendor, '廠商寄送中') +
    tile('pending_draw', 'pending', s.awaitingDraw, '待抽') +
    tile('month', 'month', s.drawsThisMonth, '本月抽獎團數');
  box.querySelectorAll('.lot-tile').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.tile;
      if (key === 'month') {
        LOTTERY_FILTER.monthOnly = !LOTTERY_FILTER.monthOnly;
      } else {
        LOTTERY_FILTER.status = (LOTTERY_FILTER.status === key) ? 'all' : key;
        LOTTERY_FILTER.monthOnly = false;
      }
      renderLotteryTiles();
      renderLotteryFilters();
      renderLotteryBody();
    });
  });
}

// ===== 篩選列 =====
function renderLotteryFilters() {
  const box = document.getElementById('lotFilters');
  const chipKeys = LOTTERY_VIEW === 'todo' ? LOT_TODO_CHIPS : LOT_FILTER_CHIPS.map(c => c.key);
  const chipsHtml = LOT_FILTER_CHIPS.filter(c => chipKeys.indexOf(c.key) !== -1).map(c =>
    '<span class="acct-tab' + (LOTTERY_FILTER.status === c.key ? ' on' : '') + '" data-chip="' + c.key + '">' + c.label + '</span>'
  ).join('');

  const years = Array.from(new Set(LOTTERY_DRAWS.map(d => d.drawDate ? String(d.drawDate).slice(0, 4) : '').filter(Boolean))).sort().reverse();
  const yearOptions = '<option value="">年份：全部</option>' + years.map(y => '<option value="' + y + '"' + (LOTTERY_FILTER.year === y ? ' selected' : '') + '>' + y + '</option>').join('');
  const brandOptions = '<option value="">品牌：全部</option>' + LOTTERY_BRAND_CHOICES.map(b =>
    '<option value="' + lotEscapeHtml(b.id) + '"' + (LOTTERY_FILTER.brand === b.id ? ' selected' : '') + '>' + lotEscapeHtml(b.name) + '</option>'
  ).join('');

  const skipCount = (LOTTERY_SKIPPED_EVENTS || []).length;
  const skipHtml = skipCount
    ? '<div class="lot-skip-wrap"><span class="lot-skip-toggle" id="lotSkipToggle">已略過 ' + skipCount + ' 團 ▾</span><div id="lotSkipList" class="lot-skip-list" style="display:none;"></div></div>'
    : '';

  box.innerHTML =
    chipsHtml +
    '<select id="lotBrandSelect">' + brandOptions + '</select>' +
    '<select id="lotYearSelect">' + yearOptions + '</select>' +
    '<input type="text" id="lotSearchInput" placeholder="搜尋 團名／獎品／得獎人／姓名／訂單編號" value="' + lotEscapeHtml(LOTTERY_FILTER.q) + '">' +
    '<div class="lot-seg"><span class="' + (LOTTERY_VIEW === 'cards' ? 'on' : '') + '" data-seg="cards">依團</span><span class="' + (LOTTERY_VIEW === 'todo' ? 'on' : '') + '" data-seg="todo">待辦清單</span></div>' +
    skipHtml;

  box.querySelectorAll('[data-chip]').forEach(el => {
    el.addEventListener('click', () => {
      LOTTERY_FILTER.status = el.dataset.chip;
      LOTTERY_FILTER.monthOnly = false;
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
  box.querySelectorAll('[data-seg]').forEach(el => {
    el.addEventListener('click', () => {
      LOTTERY_VIEW = el.dataset.seg;
      // 「待抽」chip 是依團視圖專屬（待辦清單頂端本來就固定顯示待抽列），切到待辦清單時重置避免篩到空
      if (LOTTERY_VIEW === 'todo' && LOTTERY_FILTER.status === 'pending_draw') LOTTERY_FILTER.status = 'all';
      renderLotteryTiles(); renderLotteryFilters(); renderLotteryBody();
    });
  });
  const skipToggle = document.getElementById('lotSkipToggle');
  if (skipToggle) {
    skipToggle.addEventListener('click', () => {
      const listEl = document.getElementById('lotSkipList');
      const show = listEl.style.display === 'none';
      listEl.style.display = show ? '' : 'none';
      if (show) renderLotterySkipList(listEl);
    });
  }
  document.getElementById('lotBrandSelect').addEventListener('change', function () {
    LOTTERY_FILTER.brand = this.value; renderLotteryBody();
  });
  document.getElementById('lotYearSelect').addEventListener('change', function () {
    LOTTERY_FILTER.year = this.value; renderLotteryBody();
  });
  let searchTimer = null;
  document.getElementById('lotSearchInput').addEventListener('input', function () {
    const val = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { LOTTERY_FILTER.q = val.trim(); renderLotteryBody(); }, 200);
  });
}

// ===== 篩選比對 =====
function lotMatchesDrawScope(draw) {
  if (LOTTERY_FILTER.brand && draw.brandId !== LOTTERY_FILTER.brand) return false;
  if (LOTTERY_FILTER.year && (!draw.drawDate || String(draw.drawDate).slice(0, 4) !== LOTTERY_FILTER.year)) return false;
  if (LOTTERY_FILTER.monthOnly) {
    const ym = lotToday().slice(0, 7);
    if (!draw.drawDate || String(draw.drawDate).slice(0, 7) !== ym) return false;
  }
  return true;
}
function lotMatchesWinner(draw, w) {
  if (LOTTERY_FILTER.status !== 'all' && w.status !== LOTTERY_FILTER.status) return false;
  const q = LOTTERY_FILTER.q.toLowerCase();
  if (q) {
    const hay = [draw.title, draw.eventTitle, w.prize, w.winnerHandle, w.name, w.orderNo].map(x => String(x || '')).join(' ').toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

// 篩選區底部「已略過 N 團」展開列表：可「還原」（POST lottery-event-unskip）
function renderLotterySkipList(listEl) {
  listEl.innerHTML = (LOTTERY_SKIPPED_EVENTS || []).map(x =>
    '<div class="lot-skip-row">' +
      '<span>' + lotEscapeHtml(x.title || '(找不到團名，可能已刪除)') + '</span>' +
      (LOTTERY_CAN_EDIT ? '<button class="lot-next-btn" data-role="unskip-event" data-event-id="' + lotEscapeHtml(x.eventId) + '">還原</button>' : '') +
    '</div>'
  ).join('') || '<div class="lot-empty-cell">（空）</div>';
  listEl.querySelectorAll('[data-role="unskip-event"]').forEach(el => {
    el.addEventListener('click', () => {
      lotApiPost('lottery-event-unskip', { eventId: el.dataset.eventId }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('還原失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
}

// ===== 主體渲染 =====
function renderLotteryBody() {
  if (LOTTERY_VIEW === 'todo') renderLotteryTodo();
  else renderLotteryCards();
}

function renderLotteryCards() {
  const box = document.getElementById('lotBody');
  const pendingMode = LOTTERY_FILTER.status === 'pending_draw';
  const visible = [];

  if (pendingMode) {
    // 來源 2：虛擬卡（結團滿 2 週還沒建抽獎，docs/09 §4.5）——其他 chip 下不出現
    // 搜尋框也要過濾虛擬卡（驗收建議：原本只過濾來源 1）
    const pq = LOTTERY_FILTER.q.toLowerCase();
    LOTTERY_PENDING_DRAWS.forEach(p => {
      if (pq && !((p.title || '').toLowerCase().includes(pq) || (p.brandName || '').toLowerCase().includes(pq))) return;
      visible.push({ pending: p });
    });
    // 來源 1：已建 draw 但 0 位非 redrawn 得獎人
    LOTTERY_DRAWS.forEach(draw => {
      if (!lotMatchesDrawScope(draw)) return;
      const nonRedrawn = (draw.winners || []).filter(w => w.status !== 'redrawn');
      if (nonRedrawn.length) return;
      const q = LOTTERY_FILTER.q.toLowerCase();
      if (q) {
        const hay = [draw.title, draw.eventTitle].map(x => String(x || '')).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      visible.push({ draw, winners: [] });
    });
  } else {
    LOTTERY_DRAWS.forEach(draw => {
      if (!lotMatchesDrawScope(draw)) return;
      const winners = (draw.winners || []).filter(w => lotMatchesWinner(draw, w));
      if (!winners.length) return;
      visible.push({ draw, winners });
    });
    // 依抽獎日新到舊排（沒有日期的排最後）
    visible.sort((a, b) => (b.draw.drawDate || '').localeCompare(a.draw.drawDate || ''));
  }

  if (!visible.length) {
    box.innerHTML = '<div class="task-empty">' + (pendingMode ? '目前沒有待抽的團 🎉' : '沒有符合條件的抽獎活動') + '</div>';
    return;
  }

  box.innerHTML = '<div class="lot-cards">' + visible.map(v => v.pending ? lotPendingCardHtml(v.pending) : lotCardHtml(v.draw, v.winners)).join('') + '</div>';
  lotBindCardEvents(box);
}

// 「待抽」來源 2 的虛擬卡：團名／結團日／已結團 N 天／品牌小圖＋「建立抽獎」「這團不抽」
function lotPendingCardHtml(p) {
  const thumb = p.brandThumb
    ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(p.brandThumb) + '" alt="">'
    : '<div class="lot-thumb-fallback">' + lotEscapeHtml(((p.brandName || p.title || '?').trim().charAt(0)) || '?') + '</div>';
  const metaParts = ['<span>結團 ' + lotFmtMD(p.endDate) + '</span>', '<span class="lot-warn">已結團 ' + p.daysSinceEnd + ' 天</span>'];
  if (p.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(p.brandName) + '</span>');
  return '<div class="lot-card lot-card-pending">' +
    '<div class="lot-card-head">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title"><span>' + lotEscapeHtml(p.title) + '</span></div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
    '</div>' +
    (LOTTERY_CAN_EDIT ? (
      '<div class="lot-card-foot">' +
        '<button class="task-mini-btn" data-role="pending-create" data-event-id="' + lotEscapeHtml(p.eventId) + '">＋ 建立抽獎</button>' +
        '<button class="task-mini-btn danger" data-role="pending-skip" data-event-id="' + lotEscapeHtml(p.eventId) + '">這團不抽</button>' +
      '</div>'
    ) : '') +
  '</div>';
}

// 「建立抽獎」「這團不抽」事件委派：依團卡片區與待辦清單頂端都會用到
function lotBindPendingActions(box) {
  box.querySelectorAll('[data-role="pending-create"]').forEach(el => {
    el.addEventListener('click', ev => {
      if (ev) ev.stopPropagation();
      const eventId = el.dataset.eventId;
      const p = (LOTTERY_PENDING_DRAWS || []).find(x => x.eventId === eventId);
      if (!p) return;
      const brandMatch = LOTTERY_BRAND_CHOICES.find(b => b.name === p.brandName);
      openLotteryDrawModal(null, { eventId: p.eventId, title: p.title, brandId: brandMatch ? brandMatch.id : '', drawDate: lotToday() });
    });
  });
  box.querySelectorAll('[data-role="pending-skip"]').forEach(el => {
    el.addEventListener('click', ev => {
      if (ev) ev.stopPropagation();
      if (!confirm('確定這團不用抽獎嗎？（之後可在篩選區「已略過」清單裡還原）')) return;
      lotApiPost('lottery-event-skip', { eventId: el.dataset.eventId }).then(res => {
        if (res && res.success) loadLotteryView(true); else alert('操作失敗：' + ((res && res.error) || '未知錯誤'));
      });
    });
  });
}

function lotHasUnfinished(draw) {
  return (draw.winners || []).some(w => w.status !== 'done' && w.status !== 'redrawn');
}

function lotCardHtml(draw, winners) {
  const total = (draw.winners || []).length;
  const doneCount = (draw.winners || []).filter(w => w.status === 'done').length;
  const auto = lotHasUnfinished(draw);
  const expanded = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, draw.id) ? LOTTERY_EXPANDED_OVERRIDE[draw.id] : auto;

  const thumb = draw.brandThumb
    ? '<img class="lot-thumb-img" src="' + lotEscapeHtml(draw.brandThumb) + '" alt="">'
    : '<div class="lot-thumb-fallback">' + lotEscapeHtml(((draw.brandName || draw.title || '?').trim().charAt(0)) || '?') + '</div>';

  const titleLabel = lotEscapeHtml(draw.eventTitle || draw.title || '(未命名活動)');
  const titleHtml = draw.eventId
    ? '<a href="#" class="lot-event-link" data-event-id="' + lotEscapeHtml(draw.eventId) + '">' + titleLabel + '</a>'
    : '<span>' + titleLabel + '</span>';

  const metaParts = [];
  if (draw.brandName) metaParts.push('<span>贊助：' + lotEscapeHtml(draw.brandName) + '</span>');
  const dateTxt = lotFmtDrawDate(draw);
  if (dateTxt) metaParts.push('<span class="' + (draw.dateUncertain ? 'lot-warn' : '') + '">' + dateTxt + '</span>');
  if (draw.lineKeyword) metaParts.push('<span class="lot-kw">L關鍵字：' + lotEscapeHtml(draw.lineKeyword) + '</span>');
  metaParts.push('<span>寄送：' + (LOT_SHIP_BY_LABEL[draw.shipBy] || '自寄') + '</span>');

  // 進度條：依各狀態筆數分段著色
  const counts = { done: 0, handed_to_vendor: 0, info_ready: 0, awaiting_info: 0, pending: 0, redrawn: 0 };
  (draw.winners || []).forEach(w => { if (counts[w.status] !== undefined) counts[w.status]++; });
  const barTotal = total || 1;
  const segHtml = ['done', 'handed_to_vendor', 'info_ready', 'awaiting_info', 'pending'].map(k => {
    const pct = Math.round((counts[k] / barTotal) * 100);
    if (!pct) return '';
    const clsMap = { done: 'lot-bar-done', handed_to_vendor: 'lot-bar-vendor', info_ready: 'lot-bar-ready', awaiting_info: 'lot-bar-await', pending: 'lot-bar-pending' };
    return '<i class="' + clsMap[k] + '" style="width:' + pct + '%"></i>';
  }).join('');

  const rowsHtml = winners.map(w => lotWinnerRowHtml(draw, w)).join('');

  return '<div class="lot-card" data-draw-id="' + lotEscapeHtml(draw.id) + '">' +
    '<div class="lot-card-head" data-role="toggle-card">' +
      thumb +
      '<div class="lot-head-main">' +
        '<div class="lot-head-title">' + titleHtml + '</div>' +
        '<div class="lot-meta">' + metaParts.join('') + '</div>' +
      '</div>' +
      '<div class="lot-progress">' +
        '<span class="lot-progress-txt">' + doneCount + ' / ' + total + ' 已完成</span>' +
        '<div class="lot-bar">' + segHtml + '</div>' +
        '<span class="lot-caret">' + (expanded ? '▲ 收合' : '▼ 展開') + '</span>' +
      '</div>' +
    '</div>' +
    (expanded ? (
      '<div class="lot-card-body"><table class="lot-table">' +
        '<thead><tr><th>獎品</th><th>得獎人</th><th>狀態</th><th>姓名</th><th>電話</th><th>地址</th><th>寄出日</th><th>運費</th><th>備註</th><th></th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table></div>' +
      '<div class="lot-card-foot">' +
        (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="add-winner" data-draw-id="' + lotEscapeHtml(draw.id) + '">＋ 加一位得獎人</button>' : '') +
        '<button class="task-mini-btn" data-role="copy-notify" data-draw-id="' + lotEscapeHtml(draw.id) + '">📋 複製通知文</button>' +
        '<span class="lot-spacer"></span>' +
        (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn" data-role="edit-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">✏️ 編輯活動</button>' : '') +
        (LOTTERY_CAN_EDIT ? '<button class="task-mini-btn danger" data-role="delete-draw" data-draw-id="' + lotEscapeHtml(draw.id) + '">🗑 刪除活動</button>' : '') +
      '</div>'
    ) : '') +
  '</div>';
}

function lotWinnerRowHtml(draw, w) {
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
    ? '<button class="task-mini-btn" style="padding:2px 8px;" data-role="edit-winner" data-winner-id="' + lotEscapeHtml(w.id) + '" data-draw-id="' + lotEscapeHtml(draw.id) + '">✏️</button>' +
      (w.status !== 'done' && w.status !== 'redrawn' ? '<button class="task-mini-btn" style="padding:2px 8px;" data-role="mark-shipped" data-winner-id="' + lotEscapeHtml(w.id) + '">✅寄出</button>' : '') +
      (w.status !== 'redrawn' ? '<button class="task-mini-btn danger" style="padding:2px 8px;" data-role="redraw-winner" data-winner-id="' + lotEscapeHtml(w.id) + '">🔁重抽</button>' : '')
    : '';

  return '<tr' + rowCls + '>' +
    '<td class="lot-td-prize">' + lotEscapeHtml(w.prize) + '</td>' +
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

// ===== 待辦清單視圖 =====
function renderLotteryTodo() {
  const box = document.getElementById('lotBody');
  const rows = [];
  LOTTERY_DRAWS.forEach(draw => {
    if (!lotMatchesDrawScope(draw)) return;
    (draw.winners || []).forEach(w => {
      if (w.status === 'done' || w.status === 'redrawn') return;
      if (!lotMatchesWinner(draw, w)) return;
      rows.push({ draw, w });
    });
  });
  rows.sort((a, b) => (a.draw.drawDate || '').localeCompare(b.draw.drawDate || ''));

  const pendingHtml = lotTodoPendingHtml();

  if (!rows.length) {
    box.innerHTML = pendingHtml + '<div class="task-empty">目前沒有待辦事項 🎉</div>';
    lotBindPendingActions(box);
    return;
  }

  const trHtml = rows.map(({ draw, w }) => {
    const stuck = lotDaysSince(draw.drawDate);
    const stuckTxt = stuck === null ? '—' : (stuck < 0 ? '未到' : stuck + ' 天');
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
      '<td>' + lotEscapeHtml(draw.eventTitle || draw.title) + '</td>' +
      '<td>' + lotEscapeHtml(w.prize) + '</td>' +
      '<td>' + (w.winnerHandle ? lotEscapeHtml(w.winnerHandle) : '<span class="lot-empty-cell">—</span>') + '</td>' +
      '<td><span class="lot-status-sel lot-s-' + lotEscapeHtml(w.status) + '" style="display:inline-block; cursor:default;">' + LOT_STATUS_LABEL[w.status] + '</span></td>' +
      '<td class="lot-todo-stuck">' + stuckTxt + '</td>' +
      '<td style="white-space:nowrap;">' + nextBtns + '</td>' +
    '</tr>';
  }).join('');

  box.innerHTML = pendingHtml + '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table class="lot-table" style="min-width:680px;">' +
    '<thead><tr><th>團</th><th>獎品</th><th>得獎人</th><th>狀態</th><th>卡了</th><th>下一步</th></tr></thead>' +
    '<tbody>' + trHtml + '</tbody></table></div>';
  lotBindTodoEvents(box);
  lotBindPendingActions(box);
}

// 待辦清單視圖頂端「待抽」列（docs/09 §4.5：來源 2，下一步＝建立抽獎；不受篩選 chip 影響，固定顯示）
function lotTodoPendingHtml() {
  if (!LOTTERY_PENDING_DRAWS || !LOTTERY_PENDING_DRAWS.length) return '';
  const rows = LOTTERY_PENDING_DRAWS.map(p =>
    '<tr>' +
      '<td>' + lotEscapeHtml(p.title) + '</td>' +
      '<td>結團 ' + lotFmtMD(p.endDate) + '（' + p.daysSinceEnd + ' 天前）</td>' +
      '<td>' + (p.brandName ? lotEscapeHtml(p.brandName) : '<span class="lot-empty-cell">—</span>') + '</td>' +
      '<td>' + (LOTTERY_CAN_EDIT ? '<button class="lot-next-btn" data-role="pending-create" data-event-id="' + lotEscapeHtml(p.eventId) + '">建立抽獎 ›</button>' : '') + '</td>' +
    '</tr>'
  ).join('');
  return '<div class="lot-todo-pending">' +
    '<div class="lot-todo-pending-title">⏰ 待抽（結團滿 2 週還沒建抽獎）</div>' +
    '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
      '<table class="lot-table" style="min-width:520px;"><thead><tr><th>團</th><th>結團</th><th>品牌</th><th>下一步</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '</div>' +
  '</div>';
}

// ===== 卡片區事件委派 =====
function lotBindCardEvents(box) {
  box.querySelectorAll('[data-role="toggle-card"]').forEach(el => {
    el.addEventListener('click', () => {
      const card = el.closest('.lot-card');
      const drawId = card.dataset.drawId;
      const draw = LOTTERY_DRAWS.find(d => d.id === drawId);
      const auto = draw ? lotHasUnfinished(draw) : false;
      const cur = Object.prototype.hasOwnProperty.call(LOTTERY_EXPANDED_OVERRIDE, drawId) ? LOTTERY_EXPANDED_OVERRIDE[drawId] : auto;
      LOTTERY_EXPANDED_OVERRIDE[drawId] = !cur;
      renderLotteryCards();
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
  box.querySelectorAll('.lot-event-link').forEach(el => {
    el.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); lotJumpToEvent(el.dataset.eventId); });
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
  lotBindPendingActions(box);
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
  if (!confirm('確定要刪除這個抽獎活動嗎？底下所有得獎人紀錄也會一併刪除，無法復原。')) return;
  lotApiPost('lottery-draw-delete', { id: drawId }).then(res => {
    if (res && res.success) loadLotteryView(true); else alert('刪除失敗：' + ((res && res.error) || '未知錯誤'));
  });
}
// 複製通知文：只用暱稱＋獎品，待聯絡／待回填資料的得獎人才列入，不含個資
function lotBuildNotifyText(draw) {
  return (draw.winners || [])
    .filter(w => w.status === 'pending' || w.status === 'awaiting_info')
    .map(w => { const h = String(w.winnerHandle || '').trim(); return (h.startsWith('@') ? h : '@' + h) + ' 恭喜抽中「' + (w.prize || '') + '」，請私訊姓名電話地址'; })
    .join('\n');
}
// 卡頭團名連到行事曆：eventChoices 對得到 legacyId、allEvents 裡也找得到才跳轉，否則提示找不到
function lotJumpToEvent(eventId) {
  const choice = LOTTERY_EVENT_CHOICES.find(c => c.id === eventId);
  const legacyId = choice && choice.legacyId;
  if (legacyId !== undefined && legacyId !== null && typeof allEvents !== 'undefined' && typeof openEventEditModal === 'function' && typeof switchView === 'function') {
    const ev = allEvents.find(e => String(e.id) === String(legacyId));
    if (ev) { switchView('calendar'); openEventEditModal(ev); return; }
  }
  alert('在目前行事曆資料中找不到這個團（可能已超出行事曆載入範圍）。');
}

// ===== 新增／編輯抽獎 modal =====
// prefill：只在 draw=null（新增）時用，來自「待抽」虛擬卡的「＋建立抽獎」鈕（docs/09 §4.5），
// 預帶 {eventId,title,brandId,drawDate}；不是既有活動，不會把 LOTTERY_EDIT_DRAW_ID 設成別的 id。
function openLotteryDrawModal(draw, prefill) {
  LOTTERY_EDIT_DRAW_ID = draw ? draw.id : null;
  const isNew = !draw;
  const pf = (!draw && prefill) ? prefill : null;
  document.getElementById('lotDrawModalTitle').textContent = isNew ? '➕ 新增抽獎' : '✏️ 編輯活動';
  document.getElementById('lotDrawDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  document.getElementById('lotDrawWinnerSection').style.display = isNew ? '' : 'none';

  const evSel = document.getElementById('lotDrawEventSelect');
  let evOptions = '<option value="">（不綁行事曆／自填標題）</option>' + LOTTERY_EVENT_CHOICES.map(c =>
    '<option value="' + lotEscapeHtml(c.id) + '">' + lotEscapeHtml(c.title) + '（' + lotFmtMD(c.startDate) + '~' + lotFmtMD(c.endDate) + '）</option>'
  ).join('');
  const boundEventId = draw ? draw.eventId : (pf ? pf.eventId : '');
  if (boundEventId && !LOTTERY_EVENT_CHOICES.some(c => c.id === boundEventId)) {
    evOptions += '<option value="' + lotEscapeHtml(boundEventId) + '">（目前綁定的團，已超過下拉範圍）</option>';
  }
  evSel.innerHTML = evOptions;
  evSel.value = boundEventId || '';

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

document.getElementById('lotDrawEventSelect').addEventListener('change', function () {
  const choice = LOTTERY_EVENT_CHOICES.find(c => c.id === this.value);
  if (!choice) return;
  if (choice.title) document.getElementById('lotDrawTitleInput').value = choice.title;
  if (choice.endDate) document.getElementById('lotDrawDateInput').value = String(choice.endDate).slice(0, 10);
  if (choice.brandName) {
    const match = LOTTERY_BRAND_CHOICES.find(b => b.name === choice.brandName);
    if (match) document.getElementById('lotDrawBrandSelect').value = match.id;
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
  const payload = {
    title,
    eventId: document.getElementById('lotDrawEventSelect').value || null,
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
