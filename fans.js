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
  ['fanUnclaimedSearch', 'fanMemberSearchInput', 'fanMemberSearchBtn'].forEach(id => {
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

// ===== DOM 事件掛載 =====
document.getElementById('fanUnclaimedRefreshBtn').addEventListener('click', () => loadFanAdminView(true));
document.getElementById('fanUnclaimedSearch').addEventListener('input', () => { if (FAN_TABLE_READY) renderFanUnclaimedList(); });
document.getElementById('fanMemberSearchBtn').addEventListener('click', faSearchMembers);
document.getElementById('fanMemberSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') faSearchMembers(); });
