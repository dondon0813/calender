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
  rewards: document.getElementById('fanTabPanelRewards'),
};
const FAN_TAB_BTNS = {
  unclaimed: document.getElementById('fanTabBtnUnclaimed'),
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
      banner.innerHTML = '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px;">⚠️ 第二期資料表尚未建立（待 db push）</div>';
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
  const currencies = (Array.isArray(data.currencies) ? data.currencies : []).filter(c => c.code !== 'star');
  const materials = Array.isArray(data.materials) ? data.materials : [];

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
  document.getElementById('fanShopMaterial').innerHTML = '<option value="">（請選擇教材）</option>' + materialOptionsNoBlank;
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
  document.getElementById('fanRuleEvent').value = rule.eventLegacyId;
  document.getElementById('fanRuleCurrency').value = rule.currencyCode;
  document.getElementById('fanRuleRateAmount').value = rule.rateAmount;
  document.getElementById('fanRuleRatePoints').value = rule.ratePoints;
  document.getElementById('fanRuleNote').value = rule.note || '';
  document.getElementById('fanRuleActive').checked = rule.active !== false;
}

function faResetRuleForm() {
  document.getElementById('fanRuleEditingId').value = '';
  document.getElementById('fanRuleEvent').value = '';
  document.getElementById('fanRuleCurrency').selectedIndex = 0;
  document.getElementById('fanRuleRateAmount').value = 100;
  document.getElementById('fanRuleRatePoints').value = '';
  document.getElementById('fanRuleNote').value = '';
  document.getElementById('fanRuleActive').checked = true;
}

async function faSaveRule() {
  const eventLegacyId = document.getElementById('fanRuleEvent').value;
  const currencyCode = document.getElementById('fanRuleCurrency').value;
  const rateAmount = Number(document.getElementById('fanRuleRateAmount').value);
  const ratePoints = Number(document.getElementById('fanRuleRatePoints').value);
  const note = document.getElementById('fanRuleNote').value.trim();
  const active = document.getElementById('fanRuleActive').checked;
  if (!eventLegacyId) { alert('請選擇團'); return; }
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
    '<th style="padding:8px 10px;">教材</th><th style="padding:8px 10px;">兌換價</th><th style="padding:8px 10px;">備註</th>' +
    '<th style="padding:8px 10px;"></th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';

  area.querySelectorAll('.fa-shop-edit').forEach(btn => btn.addEventListener('click', () => faEditShop(btn.dataset.id)));
  area.querySelectorAll('.fa-shop-del').forEach(btn => btn.addEventListener('click', () => faDeleteShop(btn.dataset.id)));
}

function faEditShop(id) {
  const s = (FAN_REWARDS_CFG.shopItems || []).find(x => String(x.id) === String(id));
  if (!s) return;
  document.getElementById('fanShopEditingId').value = s.id;
  document.getElementById('fanShopMaterial').value = s.materialId;
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
  const materialId = document.getElementById('fanShopMaterial').value;
  const currencyCode = document.getElementById('fanShopCurrency').value;
  const pointsPrice = Number(document.getElementById('fanShopPrice').value);
  const note = document.getElementById('fanShopNote').value.trim();
  const active = document.getElementById('fanShopActive').checked;
  if (!materialId) { alert('請選擇教材'); return; }
  if (!currencyCode) { alert('請選擇幣別'); return; }
  const mat = (FAN_REWARDS_CFG.materials || []).find(m => m.id === materialId);
  if (mat && !mat.isPremium && !confirm('加入商城後，「' + mat.title + '」會轉為會員專屬（私有），繪本館前台不再提供免費下載，確定繼續嗎？')) return;
  try {
    const res = await faApiPost('fan-admin-shop-upsert', { id, materialId, currencyCode, pointsPrice, note, active });
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
      area.innerHTML = '<div class="task-empty">⚠️ 第二期資料表尚未建立（待 db push）</div>';
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
    const deltaColor = delta > 0 ? '#1e7a3c' : (delta < 0 ? '#b23a2e' : 'inherit');
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
      area.innerHTML = '<div class="task-empty">⚠️ 第二期資料表尚未建立（待 db push）</div>';
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
        : '<span style="color:#b23a2e;">✗ 失敗</span>';
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
