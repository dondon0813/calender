// ===================================================================
// fans.js — 會員管理（粉絲會員系統後台，見 dondon-platform docs/07）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 subscriptions.js／books.js）。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好停在
// fanAdmin、本檔卻排在後面，開機當下 loadFanAdminView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的內部函式；
// 跟 admin.js 共用的只有全域 currentToken 變數與共用 DOM（同 books.js／subscriptions.js 的做法）。
// ===================================================================

const FANS_API_URL = 'https://dondon-platform.vercel.app/api/fans';

let FAN_ADMIN_LOADED = false;   // 第一次進分頁才拉未歸戶訂單，之後切回來用快取；「重新整理」強制重拉
let FAN_UNCLAIMED_LIST = [];    // 最近一次 fan-admin-unclaimed 的訂單清單
let FAN_TABLE_READY = true;     // 會員資料表是否已 db push（tableReady:false 時鎖住操作）

// ===== HTML 逃逸（自帶一份，不依賴 admin.js，同 books.js／subscriptions.js 的做法）=====
function faEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    : '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#fdeceb; color:#b23a2e; font-size:11px; white-space:nowrap;">' + faEscapeHtml(label) + '</span>';
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
  faApiPost('fan-admin-unclaimed').then(data => {
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    FAN_ADMIN_LOADED = true;
    if (data.tableReady === false) {
      FAN_TABLE_READY = false;
      FAN_UNCLAIMED_LIST = [];
      banner.innerHTML = '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">⚠️ 會員資料表尚未建立（待 db push）</div>';
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
    area.innerHTML = '<div class="task-empty">' + (FAN_UNCLAIMED_LIST.length ? '沒有符合搜尋的訂單' : '目前沒有未歸戶的訂單 🎉') + '</div>';
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

// ===== 會員查詢 =====
async function faSearchMembers() {
  const q = (document.getElementById('fanMemberSearchInput').value || '').trim();
  const area = document.getElementById('fanMemberArea');
  if (!q) { area.innerHTML = '<div class="task-empty">請輸入會員編號／暱稱／email 搜尋</div>'; return; }
  area.innerHTML = '<div class="task-empty">搜尋中…</div>';
  try {
    const data = await faApiPost('fan-admin-members', { q });
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">搜尋失敗：' + faEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    if (data.tableReady === false) {
      area.innerHTML = '<div class="task-empty">⚠️ 會員資料表尚未建立（待 db push）</div>';
      return;
    }
    renderFanMemberList(Array.isArray(data.members) ? data.members : []);
  } catch (err) {
    area.innerHTML = '<div class="task-empty">搜尋失敗：' + faEscapeHtml(err.message || '') + '</div>';
  }
}

function renderFanMemberList(members) {
  const area = document.getElementById('fanMemberArea');
  if (!members.length) {
    area.innerHTML = '<div class="task-empty">沒有符合的會員</div>';
    return;
  }
  const rows = members.map(m => {
    const emails = (m.emails || []).map(e =>
      faEscapeHtml(e.email) + (e.verified ? '' : '<span style="color:#a05a00;">（未驗證）</span>')
    ).join('<br>') || '—';
    return '<tr style="border-bottom:1px solid var(--c-line);">' +
      '<td style="padding:8px 10px; font-weight:800; white-space:nowrap;">' + faEscapeHtml(m.memberNo) + '</td>' +
      '<td style="padding:8px 10px;">' + faEscapeHtml(m.displayName) + '</td>' +
      '<td style="padding:8px 10px;">' + emails + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(m.ordersCount) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + faEscapeHtml(faMoney(m.totalSpent)) + '</td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:600px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">會員編號</th><th style="padding:8px 10px;">暱稱</th><th style="padding:8px 10px;">信箱</th>' +
    '<th style="padding:8px 10px;">訂單數</th><th style="padding:8px 10px;">累積消費</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
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
      area.innerHTML = '<div class="task-empty">⚠️ 會員資料表尚未建立（待 db push）</div>';
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

// ===== 子分頁切換（📥 未歸戶訂單／🔍 會員查詢／📊 顧客分析）=====
// 純顯示切換，不影響各區塊原有的載入邏輯（那套邏輯只認 DOM id，跟分頁容器無關）。
// 做法比照 books.js 的 switchPbaTab（admin.html 5077-5081 的 .pba-tab 樣式）。
const FAN_TAB_PANELS = {
  unclaimed: document.getElementById('fanTabPanelUnclaimed'),
  member: document.getElementById('fanTabPanelMember'),
  cust: document.getElementById('fanTabPanelCust'),
};
const FAN_TAB_BTNS = {
  unclaimed: document.getElementById('fanTabBtnUnclaimed'),
  member: document.getElementById('fanTabBtnMember'),
  cust: document.getElementById('fanTabBtnCust'),
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
document.getElementById('fanMemberSearchBtn').addEventListener('click', faSearchMembers);
document.getElementById('fanMemberSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') faSearchMembers(); });
document.getElementById('fanCustLoadBtn').addEventListener('click', () => faLoadCustomers());
document.getElementById('fanCustSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') faLoadCustomers(); });
