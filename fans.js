// ===================================================================
// fans.js — 會員管理（粉絲會員系統後台，見 dondon-platform docs/07）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 subscriptions.js／books.js）。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好停在
// fanAdmin、本檔卻排在後面，開機當下 loadFanAdminView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的內部函式；
// 跟 admin.js 共用的只有全域 currentToken 變數與共用 DOM（同 books.js／subscriptions.js 的做法）。
//
// v4（2026-09-06）新增「🎁 點數與商城」子分頁：粉絲會員系統第二期管理介面——
// 入點規則／兌換券商品規則／教材商城定價／會員錢包工具（查詢＋手動調點＋手動給教材資格）／
// 認領嘗試紀錄，對應後端 dondon-platform docs/07 第二期設計。惰性載入（切到分頁才拉一次）。
// ===================================================================

const FANS_API_URL = 'https://dondon-platform.vercel.app/api/fans';

let FAN_ADMIN_LOADED = false;   // 第一次進分頁才拉未歸戶訂單，之後切回來用快取；「重新整理」強制重拉
let FAN_UNCLAIMED_LIST = [];    // 最近一次 fan-admin-unclaimed 的訂單清單
let FAN_TABLE_READY = true;     // 會員資料表是否已 db push（tableReady:false 時鎖住操作）

// ===== HTML 逃逸（自帶一份，不依賴 admin.js，同 books.js／subscriptions.js 的做法）=====
function faEscapeHtml(s) {
  // 注意不能寫 String(s || '')：數值 0 會變空白（錢包餘額 0、折點值 0 要照常顯示）
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 登入逾時 =====
// 跟 books.js／subscriptions.js 用同一套處理方式（清 token、彈回密碼鎖）。
function faForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API 呼叫（單一入口，全走 POST + type，同後端其他家族）=====
async function faApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(FANS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    faForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

// ===== 顯示輔助 =====
function faDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}
function faMoney(n) {
  const num = Number(n);
  if (!isFinite(num)) return '—';
  return 'NT$' + num.toLocaleString('en-US');
}
function faPaidBadge(order) {
  const ok = order.paid === true;
  const label = order.status || (ok ? '已付款' : '未付款');
  return ok
    ? '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#e6f4ea; color:#1e7a3c; font-size:11px; white-space:nowrap;">' + faEscapeHtml(label) + '</span>'
    : '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#F3E3E1; color:#B5485A; font-size:11px; white-space:nowrap;">' + faEscapeHtml(label) + '</span>';
}

// ===== 表尚未建立時鎖住操作 =====
function faSetControlsDisabled(disabled) {
  ['fanUnclaimedSearch', 'fanMemberSearchInput', 'fanMemberSearchBtn', 'fanCustSearch', 'fanCustSort', 'fanCustLoadBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
}

// ===== 載入：未歸戶訂單 =====
function loadFanAdminView(forceReload) {
  if (FAN_ADMIN_LOADED && !forceReload) return;
  const area = document.getElementById('fanUnclaimedArea');
  const banner = document.getElementById('fanAdminBanner');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  banner.innerHTML = '';
  faLoadClaimReports(!!forceReload); // 進分頁就抓一次：子分頁按鈕上的「待核對 N」紅點要靠它
  faApiPost('fan-admin-unclaimed').then(data => {
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    FAN_ADMIN_LOADED = true;
    if (data.tableReady === false) {
      FAN_TABLE_READY = false;
      FAN_UNCLAIMED_LIST = [];
      banner.innerHTML = '<div style="background:#F5EFE9; border:1px solid transparent; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">會員資料表尚未建立（待 db push）</div>';
      area.innerHTML = '<div class="task-empty">資料表尚未建立</div>';
      faSetControlsDisabled(true);
      return;
    }
    FAN_TABLE_READY = true;
    faSetControlsDisabled(false);
    FAN_UNCLAIMED_LIST = Array.isArray(data.orders) ? data.orders : [];
    renderFanUnclaimedList();
  }).catch(err => {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  });
}

// ===== 未歸戶訂單清單（前端過濾姓名／email／訂單編號）=====
function renderFanUnclaimedList() {
  const area = document.getElementById('fanUnclaimedArea');
  const q = (document.getElementById('fanUnclaimedSearch').value || '').trim().toLowerCase();
  const list = q
    ? FAN_UNCLAIMED_LIST.filter(o =>
        String(o.customerName || '').toLowerCase().includes(q) ||
        String(o.email || '').toLowerCase().includes(q) ||
        String(o.orderNo || '').toLowerCase().includes(q))
    : FAN_UNCLAIMED_LIST;

  if (!list.length) {
    area.innerHTML = '<div class="task-empty">' + (FAN_UNCLAIMED_LIST.length ? '沒有符合搜尋的訂單' : '目前沒有未歸戶的訂單') + '</div>';
    return;
  }

  const rows = list.map(o => {
    return '<tr style="border-bottom:1px solid var(--c-line);" data-id="' + faEscapeHtml(o.id) + '">' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(o.orderedAt)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(o.orderNo) + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(o.customerName) + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(o.email) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faMoney(o.amount)) + '</td>' +
      '<td style="padding:8px 10px;">' + faPaidBadge(o) + '</td>' +
      '<td style="padding:8px 10px;"><button type="button" class="task-mini-btn fa-assign-btn" data-id="' + faEscapeHtml(o.id) + '">歸戶</button></td>' +
      '</tr>';
  }).join('');

  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:720px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">下單日</th><th style="padding:8px 10px;">訂單編號</th><th style="padding:8px 10px;">姓名</th>' +
    '<th style="padding:8px 10px;">email</th><th style="padding:8px 10px;">金額</th><th style="padding:8px 10px;">付款狀態</th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-assign-btn').forEach(btn => {
    btn.addEventListener('click', () => faAssignOrder(btn.dataset.id));
  });
}

// ===== 手動歸戶 =====
async function faAssignOrder(orderId) {
  const input = prompt('請輸入要歸戶的會員編號（例如 D26090001，純數字也可）：');
  if (input === null) return; // 使用者取消
  const memberNo = input.trim();
  if (!memberNo) { alert('請輸入會員編號'); return; }
  try {
    const res = await faApiPost('fan-admin-assign', { orderId, memberNo });
    if (!res || !res.success) throw new Error((res && res.error) || '歸戶失敗');
    FAN_UNCLAIMED_LIST = FAN_UNCLAIMED_LIST.filter(o => o.id !== orderId);
    renderFanUnclaimedList();
    alert('歸戶成功');
  } catch (err) {
    alert('歸戶失敗：' + err.message);
  }
}

// ===== 會員總覽（2026-09-10 改版：不用搜尋直接看全清單＋統計＋篩選）=====
let FAN_MEMBER_LIST = [];      // fan-admin-member-overview 的全清單快取
let FAN_MEMBER_FILTER = 'all'; // 目前篩選鍵
let FAN_MEMBER_LOADED = false;

async function faLoadMemberOverview(force) {
  const area = document.getElementById('fanMemberArea');
  if (FAN_MEMBER_LOADED && !force) return;
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await faApiPost('fan-admin-member-overview', {});
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    if (data.tableReady === false) {
      area.innerHTML = '<div class="task-empty">會員資料表尚未建立（待 db push）</div>';
      return;
    }
    FAN_MEMBER_LIST = Array.isArray(data.members) ? data.members : [];
    Object.keys(FAN_MEMBER_ORDERS_CACHE).forEach(k => delete FAN_MEMBER_ORDERS_CACHE[k]); // 重新整理＝訂單快取一併作廢
    FAN_MEMBER_LOADED = true;
    renderFanMemberStats(data.stats || {});
    renderFanBirthdayReminders();
    renderFanMemberFilters();
    renderFanMemberList();
  } catch (err) {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanMemberStats(s) {
  const box = document.getElementById('fanMemberStats');
  const tile = (label, val) =>
    '<div style="background:var(--c-bg-bottom); border:1px solid var(--c-border-light); border-radius:10px; padding:8px 14px; text-align:center;">' +
    '<div style="font-size:18px; font-weight:900;">' + faEscapeHtml(String(val ?? 0)) + '</div>' +
    '<div style="font-size:11px; color:var(--c-text-light);">' + label + '</div></div>';
  box.innerHTML =
    tile('總註冊', s.total) + tile('本週新增', s.newThisWeek) + tile('有訂單', s.withOrders) +
    tile('行銷同意', s.marketingConsent) + tile('填了生日', s.withBirthday) + tile('填了電話', s.withPhone) +
    tile('填了LINE', s.withLine) + tile('填了寶貝', s.withChildren) + tile('綁多信箱', s.multiEmail) +
    tile('已分級', s.tiered) + faProfileFillHtml(s);
}

// 個人資料填寫率（09-17 雪莉：密碼／信箱收進「⚙️ 設定」、未填資料在會員中心顯示可關閉的資料卡，追蹤新註冊的填寫比例有沒有降低）
// 後端 profileFill＝以改版上線時間分兩組；pfPrompt＝資料卡漏斗次數（每台裝置各算一次，非人數）
function faProfileFillHtml(s) {
  const f = s.profileFill, p = s.pfPrompt;
  if (!f) return '';
  const pct = (g) => g.total ? Math.round(g.filled / g.total * 100) + '%' : '—';
  const cut = String(f.cutoff || '').slice(5, 10).replace('-', '/');
  let h = '<div style="flex-basis:100%; background:var(--c-bg-bottom); border:1px solid var(--c-border-light); border-radius:10px; padding:10px 14px; font-size:13px; line-height:1.8;">' +
    '<b>個人資料填寫率</b>（填了生日／電話／LINE／寶貝任一項）<br>' +
    cut + ' 改版前註冊：<b>' + pct(f.before) + '</b>（' + f.before.filled + '／' + f.before.total + ' 人）　' +
    cut + ' 改版後註冊：<b>' + pct(f.after) + '</b>（' + f.after.filled + '／' + f.after.total + ' 人）';
  if (p) {
    h += '<br><span style="color:var(--c-text-light);">會員中心資料卡：顯示 ' + p.shown + ' 次｜按 ✕ ' + p.dismiss + ' 次｜在卡片儲存 ' + p.savepopup +
      ' 次｜在設定頁儲存 ' + p.savesettings + ' 次（次數以裝置計）</span>';
  }
  return h + '</div>';
}

// 會員總覽用的線條小圖示（emoji 改 SVG，2026-09-25）
function faIco(name, cls) {
  const P = {
    cake: '<path d="M4 20.5h16"/><path d="M5 20.5v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 15.5c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0"/><path d="M8.5 11.5v-3M12 11.5v-3M15.5 11.5v-3"/><path d="M8.5 6.5c-.6-.8-.6-1.6 0-2.3.6.7.6 1.5 0 2.3zM12 6.5c-.6-.8-.6-1.6 0-2.3.6.7.6 1.5 0 2.3zM15.5 6.5c-.6-.8-.6-1.6 0-2.3.6.7.6 1.5 0 2.3z"/>',
    baby: '<circle cx="12" cy="13" r="7.5"/><path d="M9.5 12.5h.01M14.5 12.5h.01" stroke-width="2.6"/><path d="M9.8 16c1.2 1 3.2 1 4.4 0"/><path d="M12 5.5c0-1.5.8-2.3 2-2.3"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
    chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/>',
    gift: '<rect x="3.5" y="9.5" width="17" height="11" rx="2"/><path d="M3.5 13.5h17"/><path d="M12 9.5v11"/><path d="M12 9.5c-1.2-2.8-4.3-4.4-5.3-2.8S9.2 9.5 12 9.5z"/><path d="M12 9.5c1.2-2.8 4.3-4.4 5.3-2.8S14.8 9.5 12 9.5z"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    chevRight: '<path d="M9 6l6 6-6 6"/>',
  };
  return '<svg class="' + (cls || 'fa-ico') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
}

// ===== 生日提醒（只提醒「已分級標註」的會員：本人生日＋寶貝生日月，14 天內）=====
// 會員生日格式 MM-DD 或 YYYY-MM-DD（取月日）；寶貝只有出生年月（YYYY-MM）＝以該月 1 號當提醒日。
function faDaysUntil(md) {
  const m = /^(\d{2})-(\d{2})$/.exec(md);
  if (!m) return null;
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  const target = thisYear >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
    ? thisYear : new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  return Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400e3);
}
function faChildAge(birthYm) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(birthYm || ''));
  if (!m) return '';
  const months = (new Date().getFullYear() - Number(m[1])) * 12 + (new Date().getMonth() + 1 - Number(m[2]));
  if (months < 0) return '';
  return months < 24 ? months + '個月' : Math.floor(months / 12) + '歲' + (months % 12 ? months % 12 + '個月' : '');
}
function renderFanBirthdayReminders() {
  const box = document.getElementById('fanMemberBirthdays');
  const lines = [];
  for (const m of FAN_MEMBER_LIST) {
    if (!m.adminTier) continue;
    const who = m.memberNo + ' ' + m.displayName + '（' + m.adminTier + '）';
    const bd = /(\d{2}-\d{2})$/.exec(String(m.birthday || ''));
    if (bd) {
      const d = faDaysUntil(bd[1]);
      if (d !== null && d <= 14) lines.push({ d, html: '<a href="#" class="fa-bday-link" data-uid="' + faEscapeHtml(m.userId) + '">' + faIco('cake') + faEscapeHtml(who) + ' 生日 ' + bd[1].replace('-', '/') + (d === 0 ? '（今天！）' : '（' + d + ' 天後）') + '</a>' });
    }
    (m.children || []).forEach((c, i) => {
      const ym = /^(\d{4})-(\d{2})$/.exec(String(c.birthYm || ''));
      if (!ym) return;
      const d = faDaysUntil(ym[2] + '-01');
      if (d !== null && d <= 14) lines.push({ d, html: '<a href="#" class="fa-bday-link" data-uid="' + faEscapeHtml(m.userId) + '">' + faIco('baby') + faEscapeHtml(who) + ' 寶貝' + (m.children.length > 1 ? (i + 1) : '') + ' 生日月 ' + Number(ym[2]) + ' 月（' + faEscapeHtml(faChildAge(c.birthYm) || '') + '）' + '</a>' + '' + (d === 0 ? '（本月）' : '（' + d + ' 天後進入）') });
    });
  }
  if (!lines.length) { box.innerHTML = ''; return; }
  lines.sort((a, b) => a.d - b.d);
  box.innerHTML = '<div style="background:#F3E3E1; border:1.5px dashed var(--c-primary); border-radius:10px; padding:10px 14px; margin-bottom:10px; font-size:13px; line-height:2;">' +
    '<b>' + faIco('gift') + '生日提醒（已分級會員，14 天內）</b><br>' + lines.map(l => l.html).join('<br>') + '</div>';
  // 點一行＝展開那位會員的資料（雪莉 09-25）：清掉篩選與搜尋確保列在清單裡，展開後捲到那一列
  box.querySelectorAll('.fa-bday-link').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    faOpenMemberInOverview(a.dataset.uid);
  }));
}
function faOpenMemberInOverview(uid) {
  if (!uid) return;
  FAN_MEMBER_FILTER = 'all';
  const search = document.getElementById('fanMemberSearchInput');
  if (search) search.value = '';
  FAN_MEMBER_OPEN = uid;
  renderFanMemberFilters();
  renderFanMemberList();
  const row = document.querySelector('#fanMemberArea .fa-mem-row[data-uid="' + uid + '"]');
  if (row && row.scrollIntoView) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const FAN_MEMBER_FILTER_DEFS = [
  ['all', '全部'], ['orders', '有訂單'], ['new', '本週'], ['marketing', '行銷同意'],
  ['birthday', '生日'], ['phone', '電話'], ['line', 'LINE'], ['children', '寶貝'], ['tiered', '已分級'],
];
function renderFanMemberFilters() {
  const box = document.getElementById('fanMemberFilters');
  box.innerHTML = FAN_MEMBER_FILTER_DEFS.map(([key, label]) =>
    '<button type="button" class="task-mini-btn fa-mem-filter" data-key="' + key + '"' +
    (FAN_MEMBER_FILTER === key ? ' style="background:var(--c-primary); color:#fff;"' : '') + '>' + label + '</button>'
  ).join('');
  box.querySelectorAll('.fa-mem-filter').forEach(btn => btn.addEventListener('click', () => {
    FAN_MEMBER_FILTER = btn.dataset.key;
    renderFanMemberFilters();
    renderFanMemberList();
  }));
}

function faMemberMatchesFilter(m) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
  switch (FAN_MEMBER_FILTER) {
    case 'orders': return m.ordersCount > 0;
    case 'new': return String(m.createdAt) >= weekAgo;
    case 'marketing': return !!m.marketingConsent;
    case 'birthday': return !!m.birthday;
    case 'phone': return !!m.phone;
    case 'line': return !!(m.lineId || m.lineNickname);
    case 'children': return m.childrenCount > 0;
    case 'tiered': return !!m.adminTier;
    default: return true;
  }
}

let FAN_MEMBER_OPEN = ''; // 目前展開詳情的會員 userId

function renderFanMemberList() {
  const area = document.getElementById('fanMemberArea');
  const q = (document.getElementById('fanMemberSearchInput').value || '').trim().toLowerCase();
  const list = FAN_MEMBER_LIST.filter(m =>
    faMemberMatchesFilter(m) &&
    (!q || String(m.memberNo).toLowerCase().includes(q) ||
      String(m.displayName).toLowerCase().includes(q) ||
      String(m.primaryEmail).toLowerCase().includes(q))
  );
  if (!list.length) { area.innerHTML = '<div class="task-empty">沒有符合條件的會員</div>'; return; }
  const rows = list.map(m => {
    const badges = [];
    if (m.birthday) badges.push('<span title="生日：' + faEscapeHtml(m.birthday) + '">' + faIco('cake') + '</span>');
    if (m.phone) badges.push('<span title="電話：' + faEscapeHtml(m.phone) + '">' + faIco('phone') + '</span>');
    if (m.lineId || m.lineNickname) badges.push('<span title="LINE：' + faEscapeHtml([m.lineId, m.lineNickname].filter(Boolean).join('／')) + '">' + faIco('chat') + '</span>');
    if (m.childrenCount > 0) badges.push('<span title="寶貝 ' + m.childrenCount + ' 位">' + faIco('baby') + '×' + m.childrenCount + '</span>');
    if (m.marketingConsent) badges.push('<span title="同意收到行銷訊息">' + faIco('mail') + '</span>');
    const emailNote = m.emailsCount > 1 ? '<span style="color:#8B6E5E; font-size:11px;">（+' + (m.emailsCount - 1) + ' 信箱）</span>' : '';
    const tierBadge = m.adminTier
      ? ' <span style="background:var(--c-primary); color:#fff; border-radius:999px; padding:1px 8px; font-size:11px;">' + faEscapeHtml(m.adminTier) + '</span>' : '';
    const open = FAN_MEMBER_OPEN === m.userId;
    let html = '<tr class="fa-mem-row" data-uid="' + faEscapeHtml(m.userId) + '" style="border-bottom:1px solid var(--c-line); cursor:pointer;' + (open ? ' background:var(--c-bg-bottom);' : '') + '">' +
      '<td style="padding:8px 10px; font-weight:800; white-space:nowrap;">' + (open ? faIco('chevDown') : faIco('chevRight')) + faEscapeHtml(m.memberNo) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(m.displayName) + tierBadge + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(m.primaryEmail) + emailNote + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(String(m.createdAt || '').slice(0, 10)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap; text-align:right;">' + faEscapeHtml(m.ordersCount) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap; text-align:right;">' + faEscapeHtml(faMoney(m.totalSpent)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap; font-size:13px; color:var(--c-text-soft);">' + (badges.join(' ') || '<span style="color:var(--c-text-light); font-size:12px;">—</span>') + '</td>' +
      '</tr>';
    if (open) html += faMemberDetailRow(m);
    return html;
  }).join('');
  area.innerHTML =
    '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">顯示 ' + list.length + '／' + FAN_MEMBER_LIST.length + ' 位（依註冊新→舊，點列展開完整資料與分級標註）</div>' +
    '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:720px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">編號</th><th style="padding:8px 10px;">暱稱</th><th style="padding:8px 10px;">主要信箱</th>' +
    '<th style="padding:8px 10px;">註冊日</th><th style="padding:8px 10px; text-align:right;">訂單</th>' +
    '<th style="padding:8px 10px; text-align:right;">累積消費</th><th style="padding:8px 10px;">已填資料</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  area.querySelectorAll('.fa-mem-row').forEach(tr => tr.addEventListener('click', () => {
    FAN_MEMBER_OPEN = FAN_MEMBER_OPEN === tr.dataset.uid ? '' : tr.dataset.uid;
    renderFanMemberList();
  }));
  const saveBtn = document.getElementById('faMemTierSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', (e) => { e.stopPropagation(); faSaveMemberTier(saveBtn.dataset.uid); });
  const detail = area.querySelector('.fa-mem-detail');
  if (detail) detail.addEventListener('click', (e) => e.stopPropagation());
  if (FAN_MEMBER_OPEN) faLoadMemberOrders(FAN_MEMBER_OPEN);
}

// 展開列：完整個資＋分級標註編輯（前台看不到分級，僅後台）
function faMemberDetailRow(m) {
  const kids = (m.children || []).map((c, i) =>
    '寶貝' + (i + 1) + '：' + faEscapeHtml(c.gender || '') + '・' + faEscapeHtml(c.birthYm || '未填年月') +
    (faChildAge(c.birthYm) ? '（' + faEscapeHtml(faChildAge(c.birthYm)) + '）' : '')
  ).join('<br>') || '—';
  const emails = (m.emails || []).map(e => faEscapeHtml(e.email) + (e.isPrimary ? '（主要）' : '')).join('<br>') || '—';
  const info = (label, val) =>
    '<div style="min-width:160px;"><div style="font-size:11px; color:var(--c-text-light);">' + label + '</div>' +
    '<div style="font-weight:700;">' + (val || '—') + '</div></div>';
  return '<tr class="fa-mem-detail"><td colspan="7" style="padding:12px 16px; background:#F5EFE9; border-bottom:2px solid var(--c-line);">' +
    '<div style="display:flex; gap:18px; flex-wrap:wrap; margin-bottom:10px;">' +
    info('生日', faEscapeHtml(m.birthday)) +
    info('電話', faEscapeHtml(m.phone)) +
    info('LINE 帳號', faEscapeHtml(m.lineId)) +
    info('社群暱稱', faEscapeHtml(m.lineNickname)) +
    info('行銷同意', m.marketingConsent ? '同意' : '未同意') +
    info('寶貝', kids) +
    info('綁定信箱', emails) +
    '</div>' +
    '<div style="border-top:1px dashed var(--c-border-light); padding:10px 0;">' +
    '<div style="font-size:12px; font-weight:800; margin-bottom:6px;">訂單紀錄</div>' +
    '<div id="faMemOrdersBox" data-uid="' + faEscapeHtml(m.userId) + '"><div style="font-size:12px; color:var(--c-text-light);">讀取中…</div></div>' +
    '</div>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; border-top:1px dashed var(--c-border-light); padding-top:10px;">' +
    '<span style="font-size:12px; font-weight:800;">⭐ 分級標註（僅後台可見）</span>' +
    '<input type="text" id="faMemTierInput" list="faMemTierPresets" value="' + faEscapeHtml(m.adminTier) + '" placeholder="例如 VIP／高級" style="width:120px;">' +
    '<datalist id="faMemTierPresets"><option value="VIP"><option value="高級"><option value="一般"><option value="黑名單"></datalist>' +
    '<input type="text" id="faMemNoteInput" value="' + faEscapeHtml(m.adminNote) + '" placeholder="內部備註（客人看不到）" style="flex:1; min-width:200px;">' +
    '<button type="button" class="task-mini-btn" id="faMemTierSaveBtn" data-uid="' + faEscapeHtml(m.userId) + '">儲存</button>' +
    '</div>' +
    '</td></tr>';
}

// ===== 展開列的訂單紀錄（2026-09-20；後端 fan-admin-member-orders）=====
// 每位會員抓一次就快取（清單重畫很頻繁：搜尋、篩選、存分級都會重畫）；按「重新整理」整個總覽重抓時一併清掉。
const FAN_MEMBER_ORDERS_CACHE = {};
const FAN_CLAIMED_VIA_LABELS = { email: 'email 自動', claim: '客人認領', manual: '後台手動' };

async function faLoadMemberOrders(userId) {
  const box = document.getElementById('faMemOrdersBox');
  if (!box || box.dataset.uid !== userId) return;
  if (FAN_MEMBER_ORDERS_CACHE[userId]) { renderFanMemberOrders(userId); return; }
  try {
    const data = await faApiPost('fan-admin-member-orders', { userId });
    if (!data || !data.success) throw new Error((data && data.error) || '未知錯誤');
    FAN_MEMBER_ORDERS_CACHE[userId] = data;
    renderFanMemberOrders(userId);
  } catch (err) {
    const b = document.getElementById('faMemOrdersBox');
    if (b && b.dataset.uid === userId) b.innerHTML = '<div style="font-size:12px; color:#B5485A;">訂單讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanMemberOrders(userId) {
  const box = document.getElementById('faMemOrdersBox');
  const data = FAN_MEMBER_ORDERS_CACHE[userId];
  if (!box || box.dataset.uid !== userId || !data) return; // 等回應期間已切到別的會員就不畫
  const orders = Array.isArray(data.orders) ? data.orders : [];
  if (!orders.length) { box.innerHTML = '<div style="font-size:12px; color:var(--c-text-light);">這位會員名下還沒有訂單</div>'; return; }
  const rows = orders.map((o, i) => {
    const items = (o.items || []).map(it =>
      '<div style="display:flex; gap:8px; justify-content:space-between; padding:2px 0;">' +
      '<span>' + (it.isGift ? faIco('gift') : '') + faEscapeHtml(it.name) + ' × ' + faEscapeHtml(it.qty) + '</span>' +
      '<span style="white-space:nowrap; color:var(--c-text-light);">' + faEscapeHtml(faMoney(it.lineTotal)) + '</span></div>'
    ).join('') || '<div style="color:var(--c-text-light);">（這筆訂單沒有品項明細）</div>';
    return '<tr class="fa-mo-row" data-idx="' + i + '" style="border-top:1px solid var(--c-line); cursor:pointer;">' +
      '<td style="padding:6px 8px; white-space:nowrap;">' + faEscapeHtml(faDate(o.orderedAt)) + '</td>' +
      '<td style="padding:6px 8px;">' + faEscapeHtml(o.eventTitle || '—') + '</td>' +
      '<td style="padding:6px 8px; white-space:nowrap;">' + faEscapeHtml(o.orderNo) + '</td>' +
      '<td style="padding:6px 8px; white-space:nowrap; text-align:right;">' + faEscapeHtml(faMoney(o.amount)) + '</td>' +
      '<td style="padding:6px 8px;">' + faPaidBadge({ paid: o.paid, status: o.statusLabel }) + '</td>' +
      '<td style="padding:6px 8px; white-space:nowrap; font-size:12px; color:var(--c-text-light);">' + faEscapeHtml(FAN_CLAIMED_VIA_LABELS[o.claimedVia] || o.claimedVia || '') + '</td>' +
      '<td style="padding:6px 8px; white-space:nowrap; font-size:12px; color:var(--c-text-light);">' + (o.items || []).length + ' 項 ▾</td>' +
      '</tr>' +
      '<tr class="fa-mo-items" data-idx="' + i + '" style="display:none;"><td colspan="7" style="padding:6px 16px 10px; font-size:12px; background:#fff;">' + items +
      (o.email ? '<div style="margin-top:4px; color:var(--c-text-light);">下單 email：' + faEscapeHtml(o.email) + '</div>' : '') +
      '</td></tr>';
  }).join('');
  box.innerHTML =
    '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">共 ' + orders.length + ' 筆、跟過 ' + (data.teamsCount || 0) + ' 團，已付款累積 ' + faEscapeHtml(faMoney(data.totalSpent)) + '（點訂單列看品項）</div>' +
    '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:8px; background:#fff;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:640px;">' +
    '<thead><tr style="text-align:left; font-size:11px; color:var(--c-text-light);"><th style="padding:6px 8px;">下單日</th><th style="padding:6px 8px;">團購</th><th style="padding:6px 8px;">訂單編號</th><th style="padding:6px 8px; text-align:right;">金額</th><th style="padding:6px 8px;">狀態</th><th style="padding:6px 8px;">歸戶方式</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
  box.querySelectorAll('.fa-mo-row').forEach(tr => tr.addEventListener('click', () => {
    const it = box.querySelector('.fa-mo-items[data-idx="' + tr.dataset.idx + '"]');
    if (it) it.style.display = it.style.display === 'none' ? '' : 'none';
  }));
}

async function faSaveMemberTier(userId) {
  const tier = (document.getElementById('faMemTierInput').value || '').trim();
  const note = (document.getElementById('faMemNoteInput').value || '').trim();
  try {
    const res = await faApiPost('fan-admin-member-tier-set', { userId, adminTier: tier, adminNote: note });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    const m = FAN_MEMBER_LIST.find(x => x.userId === userId);
    if (m) { m.adminTier = tier; m.adminNote = note; }
    renderFanBirthdayReminders();
    renderFanMemberList();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

// ===== 顧客分析 =====
let FAN_CUST_LIST = [];   // 最近一次 fan-admin-customers 的顧客清單（依 idx 對應展開列）

async function faLoadCustomers() {
  const area = document.getElementById('fanCustArea');
  const q = (document.getElementById('fanCustSearch').value || '').trim();
  const sort = document.getElementById('fanCustSort').value || 'totalSpent';
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await faApiPost('fan-admin-customers', Object.assign({ sort, limit: 100 }, q ? { q } : {}));
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    if (data.tableReady === false) {
      area.innerHTML = '<div class="task-empty">會員資料表尚未建立（待 db push）</div>';
      return;
    }
    FAN_CUST_LIST = Array.isArray(data.customers) ? data.customers : [];
    renderFanCustList(data.totalCustomers);
  } catch (err) {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanCustList(totalCustomers) {
  const area = document.getElementById('fanCustArea');
  if (!FAN_CUST_LIST.length) {
    area.innerHTML = '<div class="task-empty">沒有符合的顧客</div>';
    return;
  }
  const countLine = '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">共 ' +
    faEscapeHtml(totalCustomers != null ? totalCustomers : FAN_CUST_LIST.length) + ' 位顧客（僅含跟團買體系訂單）</div>';

  const rows = FAN_CUST_LIST.map((c, idx) => {
    const memberBadge = c.isMember
      ? '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#e6f4ea; color:#1e7a3c; font-size:11px; white-space:nowrap;">✓ 會員</span>'
      : '';
    return '<tr class="fa-cust-row" data-email="' + faEscapeHtml(c.email) + '" data-idx="' + idx + '" style="border-bottom:1px solid var(--c-line); cursor:pointer;">' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(c.name || '—') + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(c.email) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faMoney(c.totalSpent)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(c.paidCount) + '/' + faEscapeHtml(c.ordersCount) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(c.teamsCount) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(c.lastOrderAt)) + '</td>' +
      '<td style="padding:8px 10px;">' + memberBadge + '</td>' +
      '</tr>' +
      '<tr class="fa-cust-detail-row" data-detail-for="' + idx + '" style="display:none;">' +
      '<td colspan="7" style="padding:0; background:var(--c-bg-bottom);"><div class="fa-cust-detail-inner" style="padding:10px 14px;"></div></td>' +
      '</tr>';
  }).join('');

  area.innerHTML = countLine + '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:760px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">姓名</th><th style="padding:8px 10px;">email</th><th style="padding:8px 10px;">累積消費</th>' +
    '<th style="padding:8px 10px;">訂單數</th><th style="padding:8px 10px;">跟團數</th><th style="padding:8px 10px;">最近下單</th><th style="padding:8px 10px;">會員</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-cust-row').forEach(row => {
    row.addEventListener('click', () => faToggleCustDetail(row));
  });
}

// 點列展開/收合顧客明細（一次只保留一位展開，避免表格過長）
async function faToggleCustDetail(row) {
  const idx = row.dataset.idx;
  const tbody = row.parentElement;
  const detailRow = tbody.querySelector('.fa-cust-detail-row[data-detail-for="' + idx + '"]');
  if (!detailRow) return;

  const isOpen = detailRow.style.display !== 'none';
  if (isOpen) {
    detailRow.style.display = 'none';
    return;
  }
  tbody.querySelectorAll('.fa-cust-detail-row').forEach(r => { if (r !== detailRow) r.style.display = 'none'; });
  detailRow.style.display = '';
  const inner = detailRow.querySelector('.fa-cust-detail-inner');
  inner.innerHTML = '<div class="task-empty">讀取中…</div>';

  try {
    const data = await faApiPost('fan-admin-customer-detail', { email: row.dataset.email });
    if (!data || !data.success) {
      inner.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if (!orders.length) {
      inner.innerHTML = '<div class="task-empty">沒有訂單紀錄</div>';
      return;
    }
    const orderRows = orders.map(o => {
      const claimedMark = o.claimed
        ? '<span style="color:#1e7a3c;">✓ 已歸戶' + (o.claimedVia ? '（' + faEscapeHtml(o.claimedVia) + '）' : '') + '</span>'
        : '<span style="color:var(--c-text-light);">未歸戶</span>';
      return '<tr style="border-bottom:1px solid var(--c-line);">' +
        '<td style="padding:6px 10px;">' + faEscapeHtml(o.eventTitle || '—') + '</td>' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(o.orderedAt)) + '</td>' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faMoney(o.amount)) + '</td>' +
        '<td style="padding:6px 10px;">' + faPaidBadge(o) + '</td>' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + claimedMark + '</td>' +
        '</tr>';
    }).join('');
    inner.innerHTML = '<div style="overflow-x:auto;">' +
      '<table style="width:100%; border-collapse:collapse; font-size:12.5px; min-width:600px;">' +
      '<thead><tr style="text-align:left;"><th style="padding:6px 10px;">團名</th><th style="padding:6px 10px;">日期</th>' +
      '<th style="padding:6px 10px;">金額</th><th style="padding:6px 10px;">付款</th><th style="padding:6px 10px;">歸戶</th></tr></thead>' +
      '<tbody>' + orderRows + '</tbody></table></div>';
  } catch (err) {
    inner.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

// ===================================================================
// ===== 📮 認領回報（2026-09-20；後端 fan-admin-claim-reports／-resolve／-sync）=====
// 客人認領時系統對不到的訂單先留紀錄；匯入後自動比對，這裡處理對不上的。
// 一次抓全部狀態（後端上限 500 筆）在前端分狀態，切 chip 不用重抓。
// ===================================================================
let FAN_CLAIMS_LIST = [];
let FAN_CLAIMS_STATS = { pending: 0, matched: 0, rejected: 0 };
let FAN_CLAIMS_FILTER = 'pending';
let FAN_CLAIMS_LOADED = false;
let FAN_CLAIMS_BUSY = false;

const FAN_CLAIMS_FILTER_DEFS = [['pending', '待核對'], ['matched', '已加入'], ['rejected', '已駁回'], ['all', '全部']];
const FAN_CLAIMS_PLATFORM_LABELS = { gbf: '跟團買', shopline: 'Shopline', oneshop: '1shop', vendor: '廠商名單', manual: '人工建立' };

function renderFanClaimsBadge() {
  const el = document.getElementById('fanClaimsBadge');
  if (!el) return;
  const n = FAN_CLAIMS_STATS.pending || 0;
  el.innerHTML = n ? ' <span style="display:inline-block; min-width:16px; padding:0 5px; border-radius:999px; background:#B07F83; color:#fff; font-size:11px; line-height:16px; text-align:center;">' + n + '</span>' : '';
}

async function faLoadClaimReports(force) {
  if (FAN_CLAIMS_LOADED && !force) return;
  const area = document.getElementById('fanClaimsArea');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await faApiPost('fan-admin-claim-reports', { status: 'all' });
    if (data && data.tableReady === false) { // 後端表缺失時 success 也是 false，要先判這個
      area.innerHTML = '<div class="task-empty">認領回報資料表尚未建立（待 db push）</div>';
      return;
    }
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    FAN_CLAIMS_LIST = Array.isArray(data.reports) ? data.reports : [];
    FAN_CLAIMS_STATS = Object.assign({ pending: 0, matched: 0, rejected: 0 }, data.stats || {});
    FAN_CLAIMS_LOADED = true;
    renderFanClaimsBadge();
    renderFanClaimsFilters();
    renderFanClaimsList();
  } catch (err) {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanClaimsFilters() {
  const box = document.getElementById('fanClaimsFilters');
  const s = FAN_CLAIMS_STATS;
  const counts = { pending: s.pending, matched: s.matched, rejected: s.rejected, all: s.pending + s.matched + s.rejected };
  box.innerHTML = FAN_CLAIMS_FILTER_DEFS.map(([key, label]) =>
    '<button type="button" class="task-mini-btn fa-claims-filter" data-key="' + key + '"' +
    (FAN_CLAIMS_FILTER === key ? ' style="background:var(--c-primary); color:#fff;"' : '') + '>' + label + ' ' + counts[key] + '</button>'
  ).join('');
  box.querySelectorAll('.fa-claims-filter').forEach(btn => btn.addEventListener('click', () => {
    FAN_CLAIMS_FILTER = btn.dataset.key;
    renderFanClaimsFilters();
    renderFanClaimsList();
  }));
}

function faClaimsVisibleList() {
  const q = (document.getElementById('fanClaimsSearch').value || '').trim().toLowerCase();
  return FAN_CLAIMS_LIST.filter(r => {
    if (FAN_CLAIMS_FILTER !== 'all' && r.status !== FAN_CLAIMS_FILTER) return false;
    if (!q) return true;
    return [r.orderNo, r.buyerName, r.buyerEmail, r.member, r.eventTitle].some(v => String(v || '').toLowerCase().includes(q));
  });
}

// 客人填的值 vs 訂單上的值：不一樣的那格標紅，一眼看出差在哪（遮罩欄位含 * 不標，交給「四項全符」判斷）
function faClaimsDiffCell(orderVal, reportVal, isMoney) {
  const o = String(orderVal === null || orderVal === undefined ? '' : orderVal);
  const text = isMoney ? faMoney(orderVal) : o;
  const masked = o.indexOf('*') !== -1;
  const same = isMoney ? Number(orderVal) === Number(reportVal) : o.trim().toLowerCase() === String(reportVal || '').trim().toLowerCase();
  const style = (!masked && !same) ? ' style="padding:6px 8px; color:#B5485A; font-weight:600;"' : ' style="padding:6px 8px;"';
  return '<td' + style + '>' + faEscapeHtml(text || '—') + '</td>';
}

function faClaimsStatusBadge(r) {
  if (r.status === 'matched') {
    return '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#e6f4ea; color:#1e7a3c; font-size:11px;">已加入' +
      (r.resolvedBy === 'auto' ? '（系統自動）' : r.resolvedBy ? '（' + faEscapeHtml(r.resolvedBy) + '）' : '') + '</span>';
  }
  if (r.status === 'rejected') {
    return '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#F3E3E1; color:#B5485A; font-size:11px;">已駁回' +
      (r.resolvedBy ? '（' + faEscapeHtml(r.resolvedBy) + '）' : '') + '</span>';
  }
  return '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#F5EFE9; color:#8B6E5E; font-size:11px;">待核對</span>';
}

// 2026-09-23 雪莉需求：系統裡沒這筆訂單、但找廠商核對過確認正確 → 也要能「加入這筆」。
// 後端 canCreate＝待核對且同團沒有同編號訂單；按了會用客人填的四項建一筆「人工建立」訂單歸到該會員（入點），
// 這個編號從此在系統裡＝別人再回報同編號會顯示已歸戶、不能再用；之後收單抓到正式訂單會自動合併成同一筆。
function faClaimsCreateBtnHtml(r) {
  if (!r.canCreate) return '';
  return '<div style="padding:4px 0 2px;"><button type="button" class="task-mini-btn fa-claims-create" data-id="' + faEscapeHtml(r.id) + '">廠商核對無誤，加入這筆</button>' +
    '<span style="font-size:11px; color:var(--c-text-light); margin-left:8px;">會用客人填的資料建立訂單並入點；這個編號之後不能再被別人回報使用</span></div>';
}

function faClaimsCardHtml(r) {
  const cands = Array.isArray(r.candidates) ? r.candidates : [];
  let candHtml;
  if (!cands.length) {
    candHtml = '<div style="font-size:12px; color:var(--c-text-light); padding:6px 0;">系統裡還沒有這個編號的訂單（可能還沒匯入，或是要請廠商核對）</div>' + faClaimsCreateBtnHtml(r);
  } else {
    const rows = cands.map(c => {
      let who = '';
      if (c.claimedBySelf) who = '已歸到這位會員';
      else if (c.claimedByMemberNo) who = '已歸到 ' + c.claimedByMemberNo;
      const canMatch = r.status === 'pending' && (!c.claimedByMemberNo || c.claimedBySelf);
      return '<tr style="border-top:1px solid var(--c-line);">' +
        '<td style="padding:6px 8px; white-space:nowrap;">' + (c.fullMatch ? '<span title="四項全部相符" style="color:#1e7a3c; font-weight:600;">★ 全符</span>' : '<span style="color:var(--c-text-light);">不符</span>') + '</td>' +
        '<td style="padding:6px 8px;">' + faEscapeHtml(c.eventTitle || '') + '<div style="font-size:11px; color:var(--c-text-light);">' + faEscapeHtml(FAN_CLAIMS_PLATFORM_LABELS[c.platform] || c.platform || '') + '｜' + faEscapeHtml(faDate(c.orderedAt)) + '｜' + (c.paid ? '已付款' : '未付款') + '</div></td>' +
        faClaimsDiffCell(c.amount, r.amount, true) +
        faClaimsDiffCell(c.customerName, r.buyerName, false) +
        faClaimsDiffCell(c.email, r.buyerEmail, false) +
        '<td style="padding:6px 8px; white-space:nowrap; font-size:12px;">' + faEscapeHtml(who) + '</td>' +
        '<td style="padding:6px 8px; white-space:nowrap;">' + (canMatch ? '<button type="button" class="task-mini-btn fa-claims-match" data-id="' + faEscapeHtml(r.id) + '" data-order="' + faEscapeHtml(c.orderId) + '">加入這筆</button>' : '') + '</td>' +
        '</tr>';
    }).join('');
    candHtml = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:13px; min-width:640px;">' +
      '<thead><tr style="text-align:left; font-size:11px; color:var(--c-text-light);"><th style="padding:4px 8px;">比對</th><th style="padding:4px 8px;">系統裡的訂單</th><th style="padding:4px 8px;">金額</th><th style="padding:4px 8px;">姓名</th><th style="padding:4px 8px;">email</th><th></th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' + faClaimsCreateBtnHtml(r);
  }

  let actions = '';
  if (r.status === 'pending') actions = '<button type="button" class="task-mini-btn fa-claims-reject" data-id="' + faEscapeHtml(r.id) + '">駁回</button>';
  else if (r.status === 'rejected') actions = '<button type="button" class="task-mini-btn fa-claims-reopen" data-id="' + faEscapeHtml(r.id) + '">退回待核對</button>';

  return '<div style="border:1px solid var(--c-border-light); border-radius:10px; padding:10px 12px; margin-bottom:8px; background:#fff;">' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:6px;">' +
      faClaimsStatusBadge(r) +
      '<b style="font-size:14px;">' + faEscapeHtml(r.orderNo) + '</b>' +
      '<span style="font-size:12px; color:var(--c-text-light);">會員 ' + faEscapeHtml(r.member) + '｜' + faEscapeHtml(faDate(r.createdAt)) + ' 回報</span>' +
      '<span style="margin-left:auto;">' + actions + '</span>' +
    '</div>' +
    '<div style="font-size:13px; margin-bottom:6px;">客人填的：<b>' + faEscapeHtml(faMoney(r.amount)) + '</b>｜' + faEscapeHtml(r.buyerName) + '｜' + faEscapeHtml(r.buyerEmail) + '</div>' +
    (r.hint ? '<div style="font-size:12px; color:#8B6E5E; margin-bottom:6px;">系統線索：' + faEscapeHtml(r.hint) + '</div>' : '') +
    (r.note ? '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">備註（客人看得到）：' + faEscapeHtml(r.note) + '</div>' : '') +
    candHtml +
    '</div>';
}

function renderFanClaimsList() {
  const area = document.getElementById('fanClaimsArea');
  const list = faClaimsVisibleList();
  if (!list.length) {
    const empty = FAN_CLAIMS_FILTER === 'pending' && !FAN_CLAIMS_STATS.pending ? '目前沒有待核對的回報' : '沒有符合條件的回報';
    area.innerHTML = '<div class="task-empty">' + empty + '</div>';
    return;
  }
  // 依團分組（同一團的單要一起拿去問廠商）
  const groups = [];
  const byTitle = {};
  list.forEach(r => {
    const title = r.eventTitle || '（未選團）';
    if (!byTitle[title]) { byTitle[title] = { title, items: [] }; groups.push(byTitle[title]); }
    byTitle[title].items.push(r);
  });
  area.innerHTML = groups.map(g =>
    '<div style="margin:14px 0 6px; font-size:14px; font-weight:600;">' + faEscapeHtml(g.title) + ' <span style="font-weight:400; font-size:12px; color:var(--c-text-light);">' + g.items.length + ' 筆</span></div>' +
    g.items.map(faClaimsCardHtml).join('')
  ).join('');

  area.querySelectorAll('.fa-claims-match').forEach(btn => btn.addEventListener('click', () => faResolveClaimReport(btn.dataset.id, 'match', btn.dataset.order)));
  area.querySelectorAll('.fa-claims-create').forEach(btn => btn.addEventListener('click', () => faResolveClaimReport(btn.dataset.id, 'create')));
  area.querySelectorAll('.fa-claims-reject').forEach(btn => btn.addEventListener('click', () => faResolveClaimReport(btn.dataset.id, 'reject')));
  area.querySelectorAll('.fa-claims-reopen').forEach(btn => btn.addEventListener('click', () => faResolveClaimReport(btn.dataset.id, 'reopen')));
}

async function faResolveClaimReport(id, action, orderId) {
  if (FAN_CLAIMS_BUSY) return;
  const r = FAN_CLAIMS_LIST.find(x => x.id === id);
  if (!r) return;
  const extra = { id, action };
  if (action === 'match') {
    const c = (r.candidates || []).find(x => x.orderId === orderId);
    const warn = c && !c.fullMatch ? '\n\n注意：這筆訂單和客人填的資料「不完全相符」，請確認真的是同一個人。' : '';
    if (!confirm('把訂單 ' + r.orderNo + ' 加入會員 ' + r.member + ' 名下？（會同時入點）' + warn)) return;
    extra.orderId = orderId;
  } else if (action === 'create') {
    if (!confirm('系統裡沒有這筆訂單。確定廠商已核對無誤，要用客人填的資料建立訂單嗎？\n\n訂單 ' + r.orderNo + '｜' + faMoney(r.amount) + '｜' + r.buyerName + '｜' + r.buyerEmail + '\n團購：' + (r.eventTitle || '（未選團）') + '\n加入會員 ' + r.member + ' 名下（會同時入點；沒有品項＝不會發兌換碼）。\n\n建立後這個訂單編號就被使用掉，其他人不能再用同一編號回報。')) return;
  } else if (action === 'reject') {
    const note = prompt('駁回原因（客人在「我的訂單」看得到，可留空）：', '');
    if (note === null) return;
    extra.note = note.trim();
  }
  FAN_CLAIMS_BUSY = true;
  try {
    const res = await faApiPost('fan-admin-claim-report-resolve', extra);
    if (!res || !res.success) throw new Error((res && res.error) || '處理失敗');
    if (action === 'match' || action === 'create') { FAN_ADMIN_LOADED = false; } // 未歸戶清單少了一筆，下次切回去重抓
    await faLoadClaimReports(true);
  } catch (err) {
    alert('處理失敗：' + err.message);
  } finally {
    FAN_CLAIMS_BUSY = false;
  }
}

async function faSyncClaimReports() {
  if (FAN_CLAIMS_BUSY) return;
  const btn = document.getElementById('fanClaimsSyncBtn');
  FAN_CLAIMS_BUSY = true;
  btn.disabled = true;
  try {
    const res = await faApiPost('fan-admin-claim-reports-sync', {});
    if (!res || !res.success) throw new Error((res && res.error) || '比對失敗');
    const s = res.stats || {};
    await faLoadClaimReports(true);
    alert('比對完成：核對 ' + (s.checked || 0) + ' 筆、自動加入 ' + (s.matched || 0) + ' 筆' + ((s.warnings || []).length ? '\n\n注意：\n' + s.warnings.join('\n') : ''));
  } catch (err) {
    alert('比對失敗：' + err.message);
  } finally {
    FAN_CLAIMS_BUSY = false;
    btn.disabled = false;
  }
}

// 匯出目前畫面上的清單（預設＝待核對）給廠商核對；帶 BOM 讓 Excel 直接開不亂碼
function faExportClaimReports() {
  const list = faClaimsVisibleList();
  if (!list.length) { alert('目前清單是空的，沒有東西可以匯出'); return; }
  const cell = v => {
    let s = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // 防 Excel 把客人填的內容當公式執行
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = [['團購', '訂單編號', '金額', '姓名', 'email', '回報日', '狀態'].map(cell).join(',')];
  const statusLabel = { pending: '待核對', matched: '已加入', rejected: '已駁回' };
  list.forEach(r => lines.push([r.eventTitle, r.orderNo, r.amount, r.buyerName, r.buyerEmail, faDate(r.createdAt), statusLabel[r.status] || r.status].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = '認領回報-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ===== 子分頁切換（📥 未歸戶訂單／📮 認領回報／🔍 會員查詢／📊 顧客分析）=====
// 純顯示切換，不影響各區塊原有的載入邏輯（那套邏輯只認 DOM id，跟分頁容器無關）。
// 做法比照 books.js 的 switchPbaTab（admin.html 5077-5081 的 .pba-tab 樣式）。
const FAN_TAB_PANELS = {
  unclaimed: document.getElementById('fanTabPanelUnclaimed'),
  claims: document.getElementById('fanTabPanelClaims'),
  member: document.getElementById('fanTabPanelMember'),
  cust: document.getElementById('fanTabPanelCust'),
  rewards: document.getElementById('fanTabPanelRewards'),
};
const FAN_TAB_BTNS = {
  unclaimed: document.getElementById('fanTabBtnUnclaimed'),
  claims: document.getElementById('fanTabBtnClaims'),
  member: document.getElementById('fanTabBtnMember'),
  cust: document.getElementById('fanTabBtnCust'),
  rewards: document.getElementById('fanTabBtnRewards'),
};
function switchFanTab(tab, skipSave) {
  if (!FAN_TAB_PANELS[tab]) tab = 'unclaimed';
  Object.keys(FAN_TAB_PANELS).forEach(key => {
    FAN_TAB_PANELS[key].style.display = key === tab ? '' : 'none';
    FAN_TAB_BTNS[key].classList.toggle('on', key === tab);
  });
  if (!skipSave) {
    try { sessionStorage.setItem('fanAdminSubTab', tab); } catch (e) { /* 私密模式等情況忽略 */ }
  }
  if (tab === 'rewards') loadFanRewards(false);
  if (tab === 'claims') faLoadClaimReports(false);
  if (tab === 'member') faLoadMemberOverview(false); // 切到會員總覽自動載入（有快取不重抓）
}
Object.keys(FAN_TAB_BTNS).forEach(key => {
  FAN_TAB_BTNS[key].addEventListener('click', () => switchFanTab(key));
});
// 開機還原上次停留的子分頁；讀不到（私密模式等）就用預設的未歸戶訂單
(function restoreFanTab() {
  let saved = null;
  try { saved = sessionStorage.getItem('fanAdminSubTab'); } catch (e) { /* 忽略 */ }
  switchFanTab(saved || 'unclaimed', true);
})();

// ===== DOM 事件掛載 =====
document.getElementById('fanUnclaimedRefreshBtn').addEventListener('click', () => loadFanAdminView(true));
document.getElementById('fanUnclaimedSearch').addEventListener('input', () => { if (FAN_TABLE_READY) renderFanUnclaimedList(); });
document.getElementById('fanMemberSearchBtn').addEventListener('click', () => faLoadMemberOverview(true));
document.getElementById('fanMemberSearchInput').addEventListener('input', () => { if (FAN_MEMBER_LOADED) renderFanMemberList(); });
document.getElementById('fanClaimsSearch').addEventListener('input', () => { if (FAN_CLAIMS_LOADED) renderFanClaimsList(); });
document.getElementById('fanClaimsSyncBtn').addEventListener('click', () => faSyncClaimReports());
document.getElementById('fanClaimsExportBtn').addEventListener('click', () => faExportClaimReports());
document.getElementById('fanCustLoadBtn').addEventListener('click', () => faLoadCustomers());
document.getElementById('fanCustSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') faLoadCustomers(); });

// ===================================================================
// ===== 🎁 點數與商城（粉絲會員系統第二期，惰性載入：切到分頁才拉一次）=====
// ===================================================================

let FAN_REWARDS_LOADED = false;  // 第一次進分頁才拉設定，之後切回來用快取；「重新載入設定」強制重拉
let FAN_REWARDS_CFG = null;      // 最近一次 fan-admin-rewards-config 的完整回應
let FAN_REWARDS_READY = true;    // 第二期資料表是否已 db push

// ----- 表未建立時鎖住整個分頁的操作（保留「重新載入設定」讓雪莉重試）-----
function faSetRewardsControlsDisabled(disabled) {
  const panel = document.getElementById('fanTabPanelRewards');
  if (!panel) return;
  panel.querySelectorAll('button, input, select').forEach(el => {
    if (el.id === 'fanRewardsReloadBtn') return;
    el.disabled = disabled;
  });
}

// ----- 小工具：用目前設定查名稱 -----
function faCurrencyName(code) {
  if (!FAN_REWARDS_CFG) return code || '—';
  const found = (FAN_REWARDS_CFG.currencies || []).find(c => c.code === code);
  return found ? found.name : (code || '—');
}
function faMaterialTitle(id) {
  if (!id || !FAN_REWARDS_CFG) return '—';
  const found = (FAN_REWARDS_CFG.materials || []).find(m => m.id === id);
  return found ? found.title : '—';
}

// ----- 載入設定（四份下拉來源＋三張規則清單）-----
function loadFanRewards(force) {
  if (FAN_REWARDS_LOADED && !force) return;
  const banner = document.getElementById('fanRewardsBanner');
  banner.innerHTML = '<div class="task-empty">讀取中…</div>';
  faApiPost('fan-admin-rewards-config').then(data => {
    if (!data || !data.success) {
      banner.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    FAN_REWARDS_LOADED = true;
    if (data.tableReady === false) {
      FAN_REWARDS_READY = false;
      FAN_REWARDS_CFG = data;
      banner.innerHTML = '<div style="background:#F5EFE9; border:1px solid transparent; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">第二期資料表尚未建立（待 db push）</div>';
      ['fanRuleListArea', 'fanVruleListArea', 'fanShopListArea'].forEach(id => {
        document.getElementById(id).innerHTML = '<div class="task-empty">資料表尚未建立</div>';
      });
      faSetRewardsControlsDisabled(true);
      return;
    }
    FAN_REWARDS_READY = true;
    FAN_REWARDS_CFG = data;
    banner.innerHTML = '';
    faSetRewardsControlsDisabled(false);
    faFillRewardsSelects(data);
    renderFanRuleList(Array.isArray(data.rules) ? data.rules : []);
    renderFanVruleList(Array.isArray(data.voucherRules) ? data.voucherRules : []);
    renderFanShopList(Array.isArray(data.shopItems) ? data.shopItems : []);
  }).catch(err => {
    banner.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  });
}

function faFillRewardsSelects(data) {
  const eventChoices = Array.isArray(data.eventChoices) ? data.eventChoices : [];
  // 停用的幣別（active=false，例如先藏起來的繪本點數）不進下拉——後端存檔也會擋停用幣別
  const currencies = (Array.isArray(data.currencies) ? data.currencies : []).filter(c => c.code !== 'star' && c.active !== false);
  const materials = Array.isArray(data.materials) ? data.materials : [];
  const hallResources = Array.isArray(data.hallResources) ? data.hallResources : [];

  const eventOptions = '<option value="">（請選擇團）</option>' + eventChoices.map(ev =>
    '<option value="' + faEscapeHtml(ev.id) + '">' + faEscapeHtml(ev.title) +
    '（' + faEscapeHtml(String(ev.startDate || '').slice(0, 10)) + '）</option>'
  ).join('');
  ['fanRuleEvent', 'fanVruleEvent'].forEach(id => { document.getElementById(id).innerHTML = eventOptions; });

  const currencyOptions = currencies.map(c =>
    '<option value="' + faEscapeHtml(c.code) + '">' + faEscapeHtml(c.name) + '</option>'
  ).join('');
  ['fanRuleCurrency', 'fanVruleCurrency', 'fanShopCurrency', 'fanAdjCurrency'].forEach(id => {
    document.getElementById(id).innerHTML = currencyOptions;
  });

  const materialOptionsNoBlank = materials.map(m =>
    '<option value="' + faEscapeHtml(m.id) + '">' + faEscapeHtml(m.title) + (m.isPremium ? '（已私有）' : '') + '</option>'
  ).join('');
  document.getElementById('fanVruleMaterial').innerHTML =
    '<option value="">（不綁教材，只能折點）</option>' + materialOptionsNoBlank;
  // 商城上架下拉：教材＋教材館遊戲同一個選單（值帶 m:/h: 前綴，faSaveShop 依前綴分流）
  const shopMaterialOptions = materials.map(m =>
    '<option value="m:' + faEscapeHtml(m.id) + '">' + faEscapeHtml(m.title) + (m.isPremium ? '（已私有）' : '') + '</option>'
  ).join('');
  const shopHallOptions = hallResources.map(h =>
    '<option value="h:' + faEscapeHtml(h.id) + '">' + faEscapeHtml(h.title) + (h.isPublished ? '' : '（未發布）') + '</option>'
  ).join('');
  document.getElementById('fanShopMaterial').innerHTML =
    '<option value="">（請選擇教材或遊戲）</option>' +
    '<optgroup label="教材">' + shopMaterialOptions + '</optgroup>' +
    (shopHallOptions ? '<optgroup label="遊戲／教材館">' + shopHallOptions + '</optgroup>' : '');
  document.getElementById('fanGrantMaterial').innerHTML = '<option value="">（請選擇教材）</option>' + materialOptionsNoBlank;
}

// ----- 區塊 A：入點規則 -----
function renderFanRuleList(rules) {
  const area = document.getElementById('fanRuleListArea');
  if (!rules.length) { area.innerHTML = '<div class="task-empty">尚未設定任何入點規則</div>'; return; }
  const rows = rules.map(r => {
    const rowStyle = r.active === false ? 'border-bottom:1px solid var(--c-line); opacity:.55;' : 'border-bottom:1px solid var(--c-line);';
    const badge = r.active === false ? '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#eee; color:#777; font-size:11px; margin-left:6px;">停用</span>' : '';
    return '<tr style="' + rowStyle + '">' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(r.eventTitle || '—') + badge + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faCurrencyName(r.currencyCode)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">每 $' + faEscapeHtml(r.rateAmount) + ' 得 ' + faEscapeHtml(r.ratePoints) + ' 點</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(r.note || '') + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-rule-edit" data-id="' + faEscapeHtml(r.id) + '">編輯</button></td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-rule-del" data-id="' + faEscapeHtml(r.id) + '">刪除</button></td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:600px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">團</th><th style="padding:8px 10px;">幣別</th><th style="padding:8px 10px;">比率</th>' +
    '<th style="padding:8px 10px;">備註</th><th style="padding:8px 10px;"></th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-rule-edit').forEach(btn => btn.addEventListener('click', () => faEditRule(btn.dataset.id)));
  area.querySelectorAll('.fa-rule-del').forEach(btn => btn.addEventListener('click', () => faDeleteRule(btn.dataset.id)));
}

function faEditRule(id) {
  const rule = (FAN_REWARDS_CFG.rules || []).find(r => String(r.id) === String(id));
  if (!rule) return;
  document.getElementById('fanRuleEditingId').value = rule.id;
  // 非數字＝品牌規則 → 回填關鍵字欄；數字＝指定團 → 回填下拉
  const isBrand = !/^\d+$/.test(String(rule.eventLegacyId));
  document.getElementById('fanRuleBrand').value = isBrand ? rule.eventLegacyId : '';
  document.getElementById('fanRuleEvent').value = isBrand ? '' : rule.eventLegacyId;
  document.getElementById('fanRuleCurrency').value = rule.currencyCode;
  document.getElementById('fanRuleRateAmount').value = rule.rateAmount;
  document.getElementById('fanRuleRatePoints').value = rule.ratePoints;
  document.getElementById('fanRuleNote').value = rule.note || '';
  document.getElementById('fanRuleActive').checked = rule.active !== false;
}

function faResetRuleForm() {
  document.getElementById('fanRuleEditingId').value = '';
  document.getElementById('fanRuleBrand').value = '';
  document.getElementById('fanRuleEvent').value = '';
  document.getElementById('fanRuleCurrency').selectedIndex = 0;
  document.getElementById('fanRuleRateAmount').value = 100;
  document.getElementById('fanRuleRatePoints').value = '';
  document.getElementById('fanRuleNote').value = '';
  document.getElementById('fanRuleActive').checked = true;
}

async function faSaveRule() {
  // 品牌關鍵字優先（2026-09-09 雪莉定案「規則跟品牌」）：填了就存品牌規則，
  // 團名含關鍵字的每一團自動適用；沒填才用指定團下拉
  const brandKey = document.getElementById('fanRuleBrand').value.trim();
  const eventLegacyId = brandKey || document.getElementById('fanRuleEvent').value;
  const currencyCode = document.getElementById('fanRuleCurrency').value;
  const rateAmount = Number(document.getElementById('fanRuleRateAmount').value);
  const ratePoints = Number(document.getElementById('fanRuleRatePoints').value);
  const note = document.getElementById('fanRuleNote').value.trim();
  const active = document.getElementById('fanRuleActive').checked;
  if (brandKey && /^\d+$/.test(brandKey)) { alert('品牌關鍵字不能是純數字（會被當成團編號），請含品牌文字'); return; }
  if (brandKey && document.getElementById('fanRuleEvent').value) { alert('品牌關鍵字與指定團只能擇一（要用指定團請先清空品牌關鍵字）'); return; }
  if (!eventLegacyId) { alert('請填品牌關鍵字或選擇團'); return; }
  if (!currencyCode) { alert('請選擇幣別'); return; }
  try {
    const res = await faApiPost('fan-admin-rule-upsert', { eventLegacyId, currencyCode, rateAmount, ratePoints, active, note });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    alert('已儲存');
    faResetRuleForm();
    loadFanRewards(true);
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function faDeleteRule(id) {
  if (!confirm('確定要刪除這條入點規則嗎？')) return;
  try {
    const res = await faApiPost('fan-admin-rule-delete', { id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    loadFanRewards(true);
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ----- 區塊 B：兌換券商品規則 -----
function renderFanVruleList(voucherRules) {
  const area = document.getElementById('fanVruleListArea');
  if (!voucherRules.length) { area.innerHTML = '<div class="task-empty">尚未設定任何兌換券商品規則</div>'; return; }
  const rows = voucherRules.map(v => {
    const rowStyle = v.active === false ? 'border-bottom:1px solid var(--c-line); opacity:.55;' : 'border-bottom:1px solid var(--c-line);';
    const badge = v.active === false ? '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#eee; color:#777; font-size:11px; margin-left:6px;">停用</span>' : '';
    return '<tr style="' + rowStyle + '">' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(v.eventTitle || '—') + badge + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(v.productMatch) + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(v.materialTitle || '（不綁教材）') + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faCurrencyName(v.currencyCode)) + ' ' + faEscapeHtml(v.pointValue) + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(v.note || '') + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-vrule-edit" data-id="' + faEscapeHtml(v.id) + '">編輯</button></td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-vrule-del" data-id="' + faEscapeHtml(v.id) + '">刪除</button></td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:700px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">團</th><th style="padding:8px 10px;">品名關鍵字</th><th style="padding:8px 10px;">綁定教材</th>' +
    '<th style="padding:8px 10px;">折點值</th><th style="padding:8px 10px;">備註</th><th style="padding:8px 10px;"></th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-vrule-edit').forEach(btn => btn.addEventListener('click', () => faEditVrule(btn.dataset.id)));
  area.querySelectorAll('.fa-vrule-del').forEach(btn => btn.addEventListener('click', () => faDeleteVrule(btn.dataset.id)));
}

function faEditVrule(id) {
  const v = (FAN_REWARDS_CFG.voucherRules || []).find(x => String(x.id) === String(id));
  if (!v) return;
  document.getElementById('fanVruleEditingId').value = v.id;
  document.getElementById('fanVruleEvent').value = v.eventLegacyId;
  document.getElementById('fanVruleMatch').value = v.productMatch || '';
  document.getElementById('fanVruleMaterial').value = v.materialId || '';
  document.getElementById('fanVruleCurrency').value = v.currencyCode;
  document.getElementById('fanVruleValue').value = v.pointValue;
  document.getElementById('fanVruleNote').value = v.note || '';
  document.getElementById('fanVruleActive').checked = v.active !== false;
}

function faResetVruleForm() {
  document.getElementById('fanVruleEditingId').value = '';
  document.getElementById('fanVruleEvent').value = '';
  document.getElementById('fanVruleMatch').value = '';
  document.getElementById('fanVruleMaterial').selectedIndex = 0;
  document.getElementById('fanVruleCurrency').selectedIndex = 0;
  document.getElementById('fanVruleValue').value = '';
  document.getElementById('fanVruleNote').value = '';
  document.getElementById('fanVruleActive').checked = true;
}

async function faSaveVrule() {
  const id = document.getElementById('fanVruleEditingId').value || '';
  const eventLegacyId = document.getElementById('fanVruleEvent').value;
  const productMatch = document.getElementById('fanVruleMatch').value.trim();
  const materialId = document.getElementById('fanVruleMaterial').value || '';
  const currencyCode = document.getElementById('fanVruleCurrency').value;
  const pointValue = Number(document.getElementById('fanVruleValue').value);
  const note = document.getElementById('fanVruleNote').value.trim();
  const active = document.getElementById('fanVruleActive').checked;
  if (!eventLegacyId) { alert('請選擇團'); return; }
  if (!productMatch) { alert('請輸入商品關鍵字'); return; }
  if (!currencyCode) { alert('請選擇幣別'); return; }
  if (materialId) {
    const mat = (FAN_REWARDS_CFG.materials || []).find(m => m.id === materialId);
    if (mat && !mat.isPremium && !confirm('綁定教材後，「' + mat.title + '」會轉為會員專屬（私有），繪本館前台不再提供免費下載，確定繼續嗎？')) return;
  }
  try {
    const res = await faApiPost('fan-admin-voucher-rule-upsert', { id, eventLegacyId, productMatch, materialId, currencyCode, pointValue, note, active });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    alert('已儲存');
    faResetVruleForm();
    loadFanRewards(true);
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function faDeleteVrule(id) {
  if (!confirm('確定要刪除這條兌換券商品規則嗎？')) return;
  try {
    const res = await faApiPost('fan-admin-voucher-rule-delete', { id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    loadFanRewards(true);
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ----- 區塊 C：教材商城定價 -----
function renderFanShopList(shopItems) {
  const area = document.getElementById('fanShopListArea');
  if (!shopItems.length) { area.innerHTML = '<div class="task-empty">尚未設定任何商城品項</div>'; return; }
  const rows = shopItems.map(s => {
    const rowStyle = s.active === false ? 'border-bottom:1px solid var(--c-line); opacity:.55;' : 'border-bottom:1px solid var(--c-line);';
    const badge = s.active === false ? '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#eee; color:#777; font-size:11px; margin-left:6px;">停用</span>' : '';
    return '<tr style="' + rowStyle + '">' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(s.materialTitle || faMaterialTitle(s.materialId)) + badge + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faCurrencyName(s.currencyCode)) + ' ' + faEscapeHtml(s.pointsPrice) + ' 點</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(s.note || '') + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-shop-edit" data-id="' + faEscapeHtml(s.id) + '">編輯</button></td>' +
      '<td style="padding:8px 10px; white-space:nowrap;"><button type="button" class="task-mini-btn fa-shop-del" data-id="' + faEscapeHtml(s.id) + '">刪除</button></td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:520px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">商品（教材／遊戲）</th><th style="padding:8px 10px;">兌換價</th><th style="padding:8px 10px;">備註</th>' +
    '<th style="padding:8px 10px;"></th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-shop-edit').forEach(btn => btn.addEventListener('click', () => faEditShop(btn.dataset.id)));
  area.querySelectorAll('.fa-shop-del').forEach(btn => btn.addEventListener('click', () => faDeleteShop(btn.dataset.id)));
}

function faEditShop(id) {
  const s = (FAN_REWARDS_CFG.shopItems || []).find(x => String(x.id) === String(id));
  if (!s) return;
  document.getElementById('fanShopEditingId').value = s.id;
  document.getElementById('fanShopMaterial').value = s.hallResourceId ? ('h:' + s.hallResourceId) : ('m:' + s.materialId);
  document.getElementById('fanShopCurrency').value = s.currencyCode;
  document.getElementById('fanShopPrice').value = s.pointsPrice;
  document.getElementById('fanShopNote').value = s.note || '';
  document.getElementById('fanShopActive').checked = s.active !== false;
}

function faResetShopForm() {
  document.getElementById('fanShopEditingId').value = '';
  document.getElementById('fanShopMaterial').selectedIndex = 0;
  document.getElementById('fanShopCurrency').selectedIndex = 0;
  document.getElementById('fanShopPrice').value = '';
  document.getElementById('fanShopNote').value = '';
  document.getElementById('fanShopActive').checked = true;
}

async function faSaveShop() {
  const id = document.getElementById('fanShopEditingId').value || '';
  const picked = document.getElementById('fanShopMaterial').value; // m:<教材id> 或 h:<遊戲id>
  const currencyCode = document.getElementById('fanShopCurrency').value;
  const pointsPrice = Number(document.getElementById('fanShopPrice').value);
  const note = document.getElementById('fanShopNote').value.trim();
  const active = document.getElementById('fanShopActive').checked;
  if (!picked) { alert('請選擇教材或遊戲'); return; }
  if (!currencyCode) { alert('請選擇幣別'); return; }
  const materialId = picked.startsWith('m:') ? picked.slice(2) : '';
  const hallResourceId = picked.startsWith('h:') ? picked.slice(2) : '';
  if (materialId) {
    const mat = (FAN_REWARDS_CFG.materials || []).find(m => m.id === materialId);
    if (mat && !mat.isPremium && !confirm('加入商城後，「' + mat.title + '」會轉為會員專屬（私有），繪本館前台不再提供免費下載，確定繼續嗎？')) return;
  }
  try {
    const res = await faApiPost('fan-admin-shop-upsert', { id, materialId, hallResourceId, currencyCode, pointsPrice, note, active });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    alert('已儲存');
    faResetShopForm();
    loadFanRewards(true);
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

async function faDeleteShop(id) {
  if (!confirm('確定要刪除這個商城品項嗎？')) return;
  try {
    const res = await faApiPost('fan-admin-shop-delete', { id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    loadFanRewards(true);
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ----- 區塊 D：會員錢包工具 -----
const FAN_VOUCHER_STATUS_LABELS = {
  pending: '未使用',
  material: '已換教材',
  points: '已折點',
  cancelled: '已取消/到期',
};

async function faLoadFanWallet() {
  const memberNo = document.getElementById('fanWalletMemberNo').value.trim();
  const area = document.getElementById('fanWalletArea');
  if (!memberNo) { alert('請輸入會員編號'); return; }
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await faApiPost('fan-admin-member-wallet', { memberNo });
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    if (data.tableReady === false) {
      area.innerHTML = '<div class="task-empty">第二期資料表尚未建立（待 db push）</div>';
      return;
    }
    renderFanWallet(data);
  } catch (err) {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanWallet(data) {
  const area = document.getElementById('fanWalletArea');
  const wallets = Array.isArray(data.wallets) ? data.wallets : [];
  const ledger = Array.isArray(data.ledger) ? data.ledger : [];
  const vouchers = Array.isArray(data.vouchers) ? data.vouchers : [];
  const redemptions = Array.isArray(data.redemptions) ? data.redemptions : [];

  const header = '<div style="font-weight:800; margin-bottom:8px;">' +
    faEscapeHtml(data.displayName || '—') + '（' + faEscapeHtml(data.memberNo) + '）</div>';

  const walletCards = wallets.length
    ? '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">' + wallets.map(w => {
        const expiring = Array.isArray(w.expiring) && w.expiring.length
          ? '<div style="font-size:11px; color:var(--c-text-light); margin-top:4px;">' +
            w.expiring.map(e => faEscapeHtml(e.amount) + '點／' + faEscapeHtml(faDate(e.expiresAt))).join('、') + ' 即將到期</div>'
          : '';
        return '<div style="border:1px solid var(--c-border-light); border-radius:10px; padding:10px 14px; min-width:140px;">' +
          '<div style="font-size:12px; color:var(--c-text-light);">' + faEscapeHtml(w.name) + '</div>' +
          '<div style="font-size:20px; font-weight:800;">' + faEscapeHtml(w.available) + '</div>' +
          expiring + '</div>';
      }).join('') + '</div>'
    : '<div class="task-empty">尚無任何點數</div>';

  const ledgerRows = ledger.map(l => {
    const delta = Number(l.delta) || 0;
    const deltaStr = (delta > 0 ? '+' : '') + delta;
    const deltaColor = delta > 0 ? '#1e7a3c' : (delta < 0 ? '#B5485A' : 'inherit');
    return '<tr style="border-bottom:1px solid var(--c-line);">' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(l.createdAt)) + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(l.currencyName) + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap; color:' + deltaColor + ';">' + faEscapeHtml(deltaStr) + '</td>' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(l.kindLabel || '') + '</td>' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(l.note || '') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(l.orderNo || '') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(l.expiresAt ? faDate(l.expiresAt) : '—') + '</td>' +
      '</tr>';
  }).join('');
  const ledgerTable = ledger.length
    ? '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px; margin-bottom:14px;">' +
      '<table style="width:100%; border-collapse:collapse; font-size:12.5px; min-width:700px;">' +
      '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
      '<th style="padding:6px 10px;">日期</th><th style="padding:6px 10px;">幣別</th><th style="padding:6px 10px;">增減</th>' +
      '<th style="padding:6px 10px;">種類</th><th style="padding:6px 10px;">備註</th><th style="padding:6px 10px;">訂單</th><th style="padding:6px 10px;">到期</th>' +
      '</tr></thead><tbody>' + ledgerRows + '</tbody></table></div>'
    : '<div class="task-empty" style="margin-bottom:14px;">尚無點數紀錄</div>';

  const voucherRows = vouchers.map(v => {
    const statusLabel = FAN_VOUCHER_STATUS_LABELS[v.status] || v.status || '—';
    return '<tr style="border-bottom:1px solid var(--c-line);">' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(v.itemName || '') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(v.orderNo || '') + '</td>' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(v.materialTitle || '（不綁教材）') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(v.currencyName || '') + ' ' + faEscapeHtml(v.pointValue) + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(statusLabel) + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(v.expiresAt ? faDate(v.expiresAt) : '—') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(v.createdAt)) + '</td>' +
      '</tr>';
  }).join('');
  const voucherTable = vouchers.length
    ? '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px; margin-bottom:14px;">' +
      '<table style="width:100%; border-collapse:collapse; font-size:12.5px; min-width:700px;">' +
      '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
      '<th style="padding:6px 10px;">品名</th><th style="padding:6px 10px;">訂單</th><th style="padding:6px 10px;">綁定教材</th>' +
      '<th style="padding:6px 10px;">折點值</th><th style="padding:6px 10px;">狀態</th><th style="padding:6px 10px;">到期</th><th style="padding:6px 10px;">建立</th>' +
      '</tr></thead><tbody>' + voucherRows + '</tbody></table></div>'
    : '<div class="task-empty" style="margin-bottom:14px;">尚無兌換券</div>';

  const redemptionRows = redemptions.map(r => {
    return '<tr style="border-bottom:1px solid var(--c-line);">' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(r.materialTitle || '') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(r.pointsSpent) + ' ' + faEscapeHtml(r.currencyName || '') + '</td>' +
      '<td style="padding:6px 10px;">' + faEscapeHtml(r.source || '') + '</td>' +
      '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(r.createdAt)) + '</td>' +
      '</tr>';
  }).join('');
  const redemptionTable = redemptions.length
    ? '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
      '<table style="width:100%; border-collapse:collapse; font-size:12.5px; min-width:500px;">' +
      '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
      '<th style="padding:6px 10px;">教材</th><th style="padding:6px 10px;">花費</th><th style="padding:6px 10px;">來源</th><th style="padding:6px 10px;">時間</th>' +
      '</tr></thead><tbody>' + redemptionRows + '</tbody></table></div>'
    : '<div class="task-empty">尚無兌換紀錄</div>';

  area.innerHTML = header + walletCards +
    '<h4 style="margin:10px 0 6px; font-size:13px;">點數紀錄</h4>' + ledgerTable +
    '<h4 style="margin:10px 0 6px; font-size:13px;">兌換券</h4>' + voucherTable +
    '<h4 style="margin:10px 0 6px; font-size:13px;">教材兌換紀錄</h4>' + redemptionTable;
}

async function faAdjustPoints() {
  const memberNo = document.getElementById('fanWalletMemberNo').value.trim();
  if (!memberNo) { alert('請先在上方輸入並查詢會員編號'); return; }
  const currencyCode = document.getElementById('fanAdjCurrency').value;
  const delta = Number(document.getElementById('fanAdjDelta').value);
  const note = document.getElementById('fanAdjNote').value.trim();
  if (!currencyCode) { alert('請選擇幣別'); return; }
  if (!delta) { alert('請輸入要調整的點數（可為負數）'); return; }
  if (!note) { alert('請填寫調整原因'); return; }
  if (!confirm('確定要為 ' + memberNo + ' 的 ' + faCurrencyName(currencyCode) + ' 調整 ' + (delta > 0 ? '+' : '') + delta + ' 點？')) return;
  try {
    const res = await faApiPost('fan-admin-point-adjust', { memberNo, currencyCode, delta, note });
    if (!res || !res.success) throw new Error((res && res.error) || '調整失敗');
    alert('已調整');
    document.getElementById('fanAdjDelta').value = '';
    document.getElementById('fanAdjNote').value = '';
    faLoadFanWallet();
  } catch (err) {
    alert('調整失敗：' + err.message);
  }
}

async function faGrantMaterial() {
  const memberNo = document.getElementById('fanWalletMemberNo').value.trim();
  if (!memberNo) { alert('請先在上方輸入並查詢會員編號'); return; }
  const materialId = document.getElementById('fanGrantMaterial').value;
  if (!materialId) { alert('請選擇教材'); return; }
  const matTitle = faMaterialTitle(materialId);
  if (!confirm('確定要給 ' + memberNo + ' 「' + matTitle + '」的教材下載資格嗎？')) return;
  try {
    const res = await faApiPost('fan-admin-grant-material', { memberNo, materialId });
    if (!res || !res.success) throw new Error((res && res.error) || '給予失敗');
    alert('已給予');
    faLoadFanWallet();
  } catch (err) {
    alert('給予失敗：' + err.message);
  }
}

// ----- 區塊 E：認領嘗試紀錄 -----
async function faLoadFanAttempts() {
  const area = document.getElementById('fanAttemptsArea');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await faApiPost('fan-admin-claim-attempts');
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    if (data.tableReady === false) {
      area.innerHTML = '<div class="task-empty">第二期資料表尚未建立（待 db push）</div>';
      return;
    }
    const attempts = Array.isArray(data.attempts) ? data.attempts : [];
    if (!attempts.length) {
      area.innerHTML = '<div class="task-empty">尚無認領嘗試紀錄</div>';
      return;
    }
    const rows = attempts.map(a => {
      const mark = a.success
        ? '<span style="color:#1e7a3c;">✓ 成功</span>'
        : '<span style="color:#B5485A;">✗ 失敗</span>';
      return '<tr style="border-bottom:1px solid var(--c-line);">' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(faDate(a.createdAt)) + '</td>' +
        '<td style="padding:6px 10px;">' + faEscapeHtml(a.member || '') + '</td>' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + faEscapeHtml(a.orderNo || '') + '</td>' +
        '<td style="padding:6px 10px; white-space:nowrap;">' + mark + '</td>' +
        '</tr>';
    }).join('');
    area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
      '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:520px;">' +
      '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
      '<th style="padding:8px 10px;">時間</th><th style="padding:8px 10px;">嘗試的會員</th><th style="padding:8px 10px;">訂單編號</th><th style="padding:8px 10px;">結果</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (err) {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

// ----- 重算全部點數 -----
async function faSyncRewards() {
  if (!confirm('確定要重新計算全部會員點數嗎？這會依目前規則對所有已歸戶訂單重新收斂點數（含扣回異動），可能需要一些時間。')) return;
  try {
    const res = await faApiPost('fan-admin-rewards-sync');
    if (!res || !res.success) throw new Error((res && res.error) || '重算失敗');
    const s = res.stats || {};
    let msg = '重算完成：\n新增入點 ' + (s.granted || 0) + ' 筆\n調整 ' + (s.adjusted || 0) + ' 筆\n扣回 ' + (s.clawed || 0) + ' 筆\n' +
      '兌換券發出 ' + (s.vouchersIssued || 0) + ' 筆\n兌換券取消 ' + (s.vouchersCancelled || 0) + ' 筆\n' +
      '兌換券扣回點數 ' + (s.voucherPointsClawed || 0) + ' 筆\n（共檢查訂單 ' + (s.ordersChecked || 0) + ' 筆）';
    if (Array.isArray(s.warnings) && s.warnings.length) {
      msg += '\n\n警告：\n' + s.warnings.join('\n');
    }
    alert(msg);
  } catch (err) {
    alert('重算失敗：' + err.message);
  }
}

// ===== DOM 事件掛載（🎁 點數與商城）=====
document.getElementById('fanRewardsReloadBtn').addEventListener('click', () => loadFanRewards(true));
document.getElementById('fanRewardsSyncBtn').addEventListener('click', () => faSyncRewards());
document.getElementById('fanRuleSaveBtn').addEventListener('click', () => faSaveRule());
document.getElementById('fanRuleResetBtn').addEventListener('click', () => faResetRuleForm());
document.getElementById('fanVruleSaveBtn').addEventListener('click', () => faSaveVrule());
document.getElementById('fanVruleResetBtn').addEventListener('click', () => faResetVruleForm());
document.getElementById('fanShopSaveBtn').addEventListener('click', () => faSaveShop());
document.getElementById('fanShopResetBtn').addEventListener('click', () => faResetShopForm());
document.getElementById('fanWalletLoadBtn').addEventListener('click', () => faLoadFanWallet());
document.getElementById('fanWalletMemberNo').addEventListener('keydown', (e) => { if (e.key === 'Enter') faLoadFanWallet(); });
document.getElementById('fanAdjBtn').addEventListener('click', () => faAdjustPoints());
document.getElementById('fanGrantBtn').addEventListener('click', () => faGrantMaterial());
document.getElementById('fanAttemptsLoadBtn').addEventListener('click', () => faLoadFanAttempts());
