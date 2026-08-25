// ===================================================================
// subscriptions.js — 訂閱管理（信用卡訂閱個人財務工具）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 books.js）。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，若分頁剛好停在
// cardSub、本檔卻排在後面，開機當下 loadCardSubView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的內部函式；
// 跟 admin.js 共用的只有全域 currentToken 變數與共用 DOM（同 books.js 的做法）。
// ===================================================================

const SUBS_API_URL = 'https://dondon-platform.vercel.app/api/subscriptions';

let CARD_SUB_LOADED = false;   // 第一次進分頁才拉，之後切回來用快取；「重新整理」強制重拉
let CARD_SUB_LIST = [];        // 最近一次 GET 的訂閱清單
let CARD_SUB_EDIT_ID = null;   // 目前編輯中的訂閱 id；null＝新增中

// ===== HTML 逃逸（自帶一份，不依賴 admin.js，同 books.js 的 pbaEscapeHtml）=====
function csEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 登入逾時 =====
// 跟 books.js 的 booksForceRelogin 用同一套處理方式（清 token、彈回密碼鎖）。
function csForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API 呼叫 =====
async function csApiGet() {
  const url = SUBS_API_URL + '?token=' + encodeURIComponent(currentToken || '');
  const res = await fetch(url);
  const data = await res.json();
  if (data && data.needLogin) {
    csForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}
async function csApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(SUBS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    csForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

// ===== 日期輔助 =====
// nextBillingDate（YYYY-MM-DD）距今天數，負數＝已過期
function csDaysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - today) / 86400000);
}
// cardExpiry（YYYY-MM）以「該月最後一天」當到期日，回傳距今天數
function csCardExpiryDaysUntil(ym) {
  const parts = String(ym).split('-').map(Number);
  const y = parts[0], m = parts[1];
  const lastDay = new Date(y, m, 0); // new Date(y, m, 0) = 第 m 個月的最後一天（m 是 1-12）
  lastDay.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((lastDay - today) / 86400000);
}

// ===== 載入 =====
function loadCardSubView(forceReload) {
  if (CARD_SUB_LOADED && !forceReload) return;
  const area = document.getElementById('cardSubListArea');
  const alerts = document.getElementById('cardSubAlerts');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  alerts.innerHTML = '';
  csApiGet().then(data => {
    if (!data || !data.success) {
      area.innerHTML = '<div class="task-empty">讀取失敗：' + csEscapeHtml((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    CARD_SUB_LOADED = true;
    if (!data.tableReady) {
      CARD_SUB_LIST = [];
      area.innerHTML = '<div class="task-empty">⚠️ 資料表尚未建立，請先在 PowerShell 執行 npx supabase db push</div>';
      return;
    }
    CARD_SUB_LIST = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    renderCardSubAlerts();
    renderCardSubList();
  }).catch(err => {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + csEscapeHtml(err.message || '') + '</div>';
  });
}

// ===== 提醒橫幅：扣款倒數（紅）／卡片到期（橘）=====
function renderCardSubAlerts() {
  const box = document.getElementById('cardSubAlerts');
  const billingLines = [];
  const expiryLines = [];
  CARD_SUB_LIST.forEach(s => {
    if (s.nextBillingDate) {
      const days = csDaysUntil(s.nextBillingDate);
      if (days <= 7) {
        const label = days < 0 ? '已到期' : (days === 0 ? '今天到期' : days + ' 天後扣款');
        billingLines.push('⏰ ' + csEscapeHtml(s.siteName) + '　' + label + '（' + csEscapeHtml(s.nextBillingDate) + '）');
      }
    }
    if (s.cardExpiry) {
      const days = csCardExpiryDaysUntil(s.cardExpiry);
      if (days <= 60) {
        expiryLines.push('💳 ' + csEscapeHtml(s.siteName) + '　卡片 ' + csEscapeHtml(s.cardExpiry) + ' 到期，記得換卡改綁');
      }
    }
  });
  let html = '';
  if (billingLines.length) {
    html += '<div style="background:#fdeceb; border:1px solid #f1998f; color:#b23a2e; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px; line-height:1.8;">' +
      billingLines.join('<br>') + '</div>';
  }
  if (expiryLines.length) {
    html += '<div style="background:#fff6e6; border:1px solid #ffdb99; color:#a05a00; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:13px; line-height:1.8;">' +
      expiryLines.join('<br>') + '</div>';
  }
  box.innerHTML = html;
}

// ===== 清單表格 =====
function renderCardSubList() {
  const area = document.getElementById('cardSubListArea');
  if (!CARD_SUB_LIST.length) {
    area.innerHTML = '<div class="task-empty">還沒有任何訂閱紀錄</div>';
    return;
  }
  const rows = CARD_SUB_LIST.map(s => {
    let rowStyle = 'border-bottom:1px solid var(--c-line);';
    if (s.nextBillingDate && csDaysUntil(s.nextBillingDate) <= 7) rowStyle += 'background:#fdeceb;';
    else if (s.cardExpiry && csCardExpiryDaysUntil(s.cardExpiry) <= 60) rowStyle += 'background:#fff6e6;';
    return '<tr style="' + rowStyle + '" data-id="' + csEscapeHtml(s.id) + '">' +
      '<td style="padding:8px 10px; font-weight:800;">' + csEscapeHtml(s.siteName) + '</td>' +
      '<td style="padding:8px 10px;">' + csEscapeHtml(s.sitePurpose) + '</td>' +
      '<td style="padding:8px 10px;">' + csEscapeHtml(s.cardName) + '</td>' +
      '<td style="padding:8px 10px;">' + csEscapeHtml(s.bank) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + csEscapeHtml(s.cardExpiry) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + csEscapeHtml(s.nextBillingDate) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap;">' + csEscapeHtml(s.fee) + '</td>' +
      '<td style="padding:8px 10px;"><button type="button" class="task-mini-btn cs-edit-btn" data-id="' + csEscapeHtml(s.id) + '">✏️ 編輯</button></td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:720px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">網站</th><th style="padding:8px 10px;">用途</th><th style="padding:8px 10px;">卡片</th>' +
    '<th style="padding:8px 10px;">銀行</th><th style="padding:8px 10px;">卡片到期</th><th style="padding:8px 10px;">下次扣款</th>' +
    '<th style="padding:8px 10px;">費用</th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  area.querySelectorAll('.cs-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = CARD_SUB_LIST.find(x => x.id === btn.dataset.id);
      if (rec) openCardSubEditModal(rec);
    });
  });
}

// ===== 新增／編輯 modal =====
function openCardSubEditModal(rec) {
  CARD_SUB_EDIT_ID = rec ? rec.id : null;
  document.getElementById('cardSubEditTitle').textContent = rec ? '✏️ 編輯訂閱' : '➕ 新增訂閱';
  document.getElementById('cardSubDeleteBtn').style.display = rec ? 'inline-block' : 'none';

  const v = (id, val) => { document.getElementById(id).value = val === undefined || val === null ? '' : val; };
  v('cardSubSiteName', rec ? rec.siteName : '');
  v('cardSubSitePurpose', rec ? rec.sitePurpose : '');
  v('cardSubCardName', rec ? rec.cardName : '');
  v('cardSubBank', rec ? rec.bank : '');
  v('cardSubCardExpiry', rec ? rec.cardExpiry : '');
  v('cardSubNextBilling', rec ? rec.nextBillingDate : '');
  v('cardSubFee', rec ? rec.fee : '');
  v('cardSubNote', rec ? rec.note : '');

  const statusEl = document.getElementById('cardSubEditStatus');
  statusEl.textContent = '';
  statusEl.className = 'form-status';

  document.getElementById('cardSubEditModal').classList.add('show');
}
function closeCardSubEditModal() {
  document.getElementById('cardSubEditModal').classList.remove('show');
  CARD_SUB_EDIT_ID = null;
}

document.getElementById('cardSubAddBtn').addEventListener('click', () => openCardSubEditModal(null));
document.getElementById('cardSubRefreshBtn').addEventListener('click', () => loadCardSubView(true));

document.getElementById('cardSubSaveBtn').addEventListener('click', async () => {
  const val = id => document.getElementById(id).value.trim();
  const siteName = val('cardSubSiteName');
  const statusEl = document.getElementById('cardSubEditStatus');
  if (!siteName) {
    statusEl.textContent = '請填寫訂閱網站名稱';
    statusEl.className = 'form-status error';
    return;
  }
  const payload = {
    siteName,
    sitePurpose: val('cardSubSitePurpose'),
    cardName: val('cardSubCardName'),
    bank: val('cardSubBank'),
    cardExpiry: val('cardSubCardExpiry'),
    nextBillingDate: val('cardSubNextBilling'),
    fee: val('cardSubFee'),
    note: val('cardSubNote')
  };
  if (CARD_SUB_EDIT_ID) payload.id = CARD_SUB_EDIT_ID;

  const btn = document.getElementById('cardSubSaveBtn');
  btn.disabled = true;
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  try {
    const res = await csApiPost('sub-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    closeCardSubEditModal();
    loadCardSubView(true);
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
  btn.disabled = false;
});

document.getElementById('cardSubDeleteBtn').addEventListener('click', async () => {
  if (!CARD_SUB_EDIT_ID) return;
  if (!confirm('確定要刪除這筆訂閱紀錄嗎？')) return;

  const statusEl = document.getElementById('cardSubEditStatus');
  const btn = document.getElementById('cardSubDeleteBtn');
  btn.disabled = true;
  statusEl.textContent = '刪除中…';
  statusEl.className = 'form-status';
  try {
    const res = await csApiPost('sub-delete', { id: CARD_SUB_EDIT_ID });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    closeCardSubEditModal();
    loadCardSubView(true);
  } catch (err) {
    statusEl.textContent = '刪除失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
  btn.disabled = false;
});
