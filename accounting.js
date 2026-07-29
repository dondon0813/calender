// ===================================================================
// accounting.js — 開團帳務（列表／篩選／新增編輯）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」。
// 理由同其他模組：admin.js 開機還原分頁時會在最外層同步呼叫 switchView，
// 本檔若排在後面，開機當下函式還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的函式。
//
// 權限：帳務欄位在後端就依權限遮蔽（沒權限的欄位整個 key 不存在），
// 所以這裡一律用 acctCan.revenue / acctCan.commission 判斷要不要渲染，
// 不要假設欄位一定有值。前端隱藏只是體驗，真正的鎖在 Code.gs。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放最前段）-----
let acctData = [];
let acctCan = { revenue: false, commission: false };
let acctStatuses = ['未成團', '進行中', '待結算', '已請款', '已入帳'];
let acctLoaded = false;
let acctEditCtx = null;

function acctNum(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function acctMoney(v) {
  if (v === '' || v === null || v === undefined) return '—';
  return acctNum(v).toLocaleString('en-US');
}
// 沒有該權限時後端根本不回傳這個 key，用這個統一顯示遮蔽符號
function acctCell(obj, key, can) {
  if (!can) return '<span class="acct-hidden" title="你沒有查看這個欄位的權限">•••</span>';
  return escHtml(acctMoney(obj[key]));
}

function acctBrandName(id) {
  const b = brandDb.find(x => x.id === id);
  return b ? b.name : (id || '');
}

async function loadAccounting(force) {
  if (acctLoaded && !force) return;
  const box = document.getElementById('acctList');
  if (box) box.innerHTML = '<div class="task-empty">載入中…</div>';
  try {
    const res = await postTask({ type: 'acct-list' });
    acctData = Array.isArray(res.items) ? res.items : [];
    acctCan = { revenue: !!res.canRevenue, commission: !!res.canCommission };
    if (Array.isArray(res.statuses) && res.statuses.length) acctStatuses = res.statuses;
    acctLoaded = true;
    acctFillFilters();
    renderAccountingView();
  } catch (err) {
    if (box) box.innerHTML = '<div class="task-empty">讀取失敗：' + escHtml(err.message) + '</div>';
  }
}

// 重建下拉選項會把使用者選的值洗掉（改完一筆回來就變成看全部），
// 所以填完要把原本選的值寫回去。
function acctFillFilters() {
  const keep = {};
  ['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus']
    .forEach(id => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
  acctFillFilterOptions_();
  Object.keys(keep).forEach(id => {
    const el = document.getElementById(id);
    if (!el || !keep[id]) return;
    // 選項可能已經不存在（例如那個品牌的紀錄被刪光），存在才寫回
    if ([...el.options].some(o => o.value === keep[id])) el.value = keep[id];
  });
}

function acctFillFilterOptions_() {
  const years = [...new Set(acctData.map(r => (r.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const ySel = document.getElementById('acctFilterYear');
  ySel.innerHTML = '<option value="">全部年份</option>' +
    years.map(y => `<option value="${y}">${y} 年</option>`).join('');

  const mSel = document.getElementById('acctFilterMonth');
  mSel.innerHTML = '<option value="">全部月份</option>' +
    Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
      .map(m => `<option value="${m}">${parseInt(m, 10)} 月</option>`).join('');

  // 只列出帳務裡真的出現過的品牌，避免下拉有 240 個選項卻大半沒資料
  const used = [...new Set(acctData.map(r => r.brandId).filter(Boolean))];
  used.sort((a, b) => acctBrandName(a).localeCompare(acctBrandName(b), 'zh-Hant'));
  document.getElementById('acctFilterBrand').innerHTML =
    '<option value="">全部品牌</option>' +
    used.map(id => `<option value="${escHtml(id)}">${escHtml(acctBrandName(id))}</option>`).join('');

  document.getElementById('acctFilterStatus').innerHTML =
    '<option value="">全部狀態</option>' +
    acctStatuses.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
}

function acctFiltered() {
  const y = document.getElementById('acctFilterYear').value;
  const m = document.getElementById('acctFilterMonth').value;
  const b = document.getElementById('acctFilterBrand').value;
  const s = document.getElementById('acctFilterStatus').value;
  const kw = (document.getElementById('acctFilterText').value || '').trim().toLowerCase();
  return acctData.filter(r => {
    const d = r.date || '';
    if (y && d.slice(0, 4) !== y) return false;
    if (m && d.slice(5, 7) !== m) return false;
    if (b && r.brandId !== b) return false;
    if (s && r.status !== s) return false;
    if (kw) {
      const hay = [r.rawName, acctBrandName(r.brandId), r.company, r.invoice, r.id]
        .filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    return true;
  }).sort((a, b2) => (b2.date || '').localeCompare(a.date || ''));
}

function renderAccountingView() {
  const list = acctFiltered();
  const sumBox = document.getElementById('acctSummary');
  const box = document.getElementById('acctList');
  if (!sumBox || !box) return;

  // 「實際團數」把「同團延續」（廠商中途重開表單、業績拆兩列）排除，避免重複計算
  const realTeams = list.filter(r => !r.contFrom).length;
  const sales = list.reduce((a, r) => a + acctNum(r.sales), 0);
  const comm = list.reduce((a, r) => a + acctNum(r.commission), 0);
  const fee = list.reduce((a, r) => a + acctNum(r.fee), 0);
  const pend = list.filter(r => r.status !== '已入帳' && r.status !== '已請款')
                   .reduce((a, r) => a + acctNum(r.commission), 0);

  const tile = (label, val, cls) =>
    `<div class="acct-tile ${cls || ''}"><b>${val}</b><span>${label}</span></div>`;
  const hidden = '<span class="acct-hidden">•••</span>';
  sumBox.innerHTML =
    tile('筆數', list.length) +
    tile('實際團數', realTeams) +
    tile('銷售金額', acctCan.revenue ? acctMoney(sales) : hidden, 'wide') +
    tile('分潤', acctCan.revenue ? acctMoney(comm) : hidden, 'wide') +
    tile('稿酬', acctCan.revenue ? acctMoney(fee) : hidden) +
    (acctCan.revenue && pend ? tile('其中未結算', acctMoney(pend), 'pend') : '');

  if (!list.length) {
    box.innerHTML = '<div class="task-empty">沒有符合條件的紀錄</div>';
    return;
  }
  box.innerHTML = list.map(r => {
    const st = r.status || '';
    const stCls = st === '已入帳' ? 'ok' : (st === '未成團' ? 'off' : 'wait');
    const hasRate = r.rate !== '' && r.rate !== undefined && r.rate !== null;
    const rate = !acctCan.commission ? '<span class="acct-hidden">•••</span>'
      : (hasRate ? Math.round(acctNum(r.rate) * 1000) / 10 + '%'
                 : (r.rateNote ? escHtml(r.rateNote) : '—'));
    return `<div class="acct-row" data-id="${escHtml(r.id)}">
      <span class="acct-date">${escHtml(r.date || '')}</span>
      <span class="acct-name">${escHtml(acctBrandName(r.brandId) || r.rawName)}
        ${r.contFrom ? '<span class="acct-cont" title="同一團廠商重開表單，業績拆成兩列">續</span>' : ''}
        <small>${escHtml(r.rawName || '')}</small></span>
      <span class="acct-rate">${rate}</span>
      <span class="acct-money">${acctCell(r, 'sales', acctCan.revenue)}</span>
      <span class="acct-money strong">${acctCell(r, 'commission', acctCan.revenue)}</span>
      <span class="acct-status ${stCls}">${escHtml(st || '—')}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('.acct-row').forEach(el => {
    el.addEventListener('click', () => {
      const rec = acctData.find(x => x.id === el.dataset.id);
      if (rec) openAcctEditModal(rec);
    });
  });
}

// ----- 新增／編輯 -----
function openAcctEditModal(rec) {
  acctEditCtx = { isNew: !rec, rec: rec };
  document.getElementById('acctEditTitle').textContent = rec ? '✏️ 編輯開團紀錄' : '➕ 新增開團紀錄';
  document.getElementById('acctDeleteBtn').style.display = (rec && isAdmin) ? 'inline-block' : 'none';
  setFormStatus('acctEditStatus', '', '');

  // 品牌下拉：全部品牌都能選（新團可能是還沒開過的品牌），已結束的標出來
  const brands = brandDb.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  document.getElementById('acctBrandSelect').innerHTML =
    '<option value="">－ 請選擇品牌 －</option>' +
    brands.map(b => `<option value="${escHtml(b.id)}">${escHtml(b.name)}${b.ended ? '（已結束合作）' : ''}</option>`).join('');
  document.getElementById('acctVendorSelect').innerHTML =
    '<option value="">－ 不指定 －</option>' +
    vendorDb.map(v => `<option value="${escHtml(v.id)}">${escHtml(v.name)}</option>`).join('');
  document.getElementById('acctStatusSelect').innerHTML =
    acctStatuses.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');

  const v = (id, val) => { document.getElementById(id).value = val === undefined || val === null ? '' : val; };
  v('acctDateInput', rec ? rec.date : new Date().toISOString().slice(0, 10));
  v('acctBrandSelect', rec ? rec.brandId : '');
  v('acctRawNameInput', rec ? rec.rawName : '');
  v('acctVendorSelect', rec ? rec.vendorId : '');
  v('acctCompanyInput', rec ? rec.company : '');
  v('acctSalesInput', rec ? rec.sales : '');
  // 試算表存的是小數（0.15），但輸入框跟品牌資料庫一樣用整數（15），
  // 兩邊填法不一致的話一定有人把 15 填成 1500%。轉換只在這一進一出兩個地方。
  v('acctRateInput', rec && rec.rate !== '' && rec.rate !== undefined && rec.rate !== null
      ? Math.round(acctNum(rec.rate) * 1000) / 10 : '');
  v('acctRateNoteInput', rec ? rec.rateNote : '');
  v('acctCommissionInput', rec ? rec.commission : '');
  v('acctFeeInput', rec ? rec.fee : '');
  v('acctStatusSelect', rec ? (rec.status || '待結算') : '待結算');
  v('acctPayToInput', rec ? rec.payTo : '');
  v('acctPayDateInput', rec ? rec.payDate : '');
  v('acctInvoiceInput', rec ? rec.invoice : '');
  v('acctNoteInput', rec ? rec.note : '');
  document.getElementById('acctTaxAddedInput').checked = rec ? !!rec.taxAdded : false;

  const audit = [];
  if (rec && rec.updatedBy) audit.push('最後修改：' + rec.updatedBy + '　' + (rec.updatedAt || ''));
  if (rec && rec.importNote) audit.push('匯入註記：' + rec.importNote);
  if (rec && rec.contFrom) audit.push('這是 ' + rec.contFrom + ' 同一團重開表單的延續');
  document.getElementById('acctAuditLine').innerHTML = audit.map(escHtml).join('<br>');

  document.getElementById('acctEditModal').classList.add('show');
}
function closeAcctEditModal() {
  document.getElementById('acctEditModal').classList.remove('show');
  acctEditCtx = null;
}

document.getElementById('acctSaveBtn').addEventListener('click', async () => {
  const brandId = document.getElementById('acctBrandSelect').value;
  const date = document.getElementById('acctDateInput').value;
  if (!date) { setFormStatus('acctEditStatus', '請選擇開團日期', 'error'); return; }
  if (!brandId) { setFormStatus('acctEditStatus', '請選擇品牌', 'error'); return; }

  const val = id => document.getElementById(id).value.trim();
  const payload = {
    date, brandId,
    rawName: val('acctRawNameInput') || acctBrandName(brandId),
    vendorId: document.getElementById('acctVendorSelect').value,
    company: val('acctCompanyInput'),
    status: document.getElementById('acctStatusSelect').value,
    payTo: val('acctPayToInput'),
    payDate: val('acctPayDateInput'),
    invoice: val('acctInvoiceInput')
  };
  // 沒權限的欄位連送都不送。後端也會擋，這裡只是不要送出使用者根本沒看到的空值
  if (acctCan.revenue) {
    payload.sales = val('acctSalesInput');
    payload.commission = val('acctCommissionInput');
    payload.fee = val('acctFeeInput');
    payload.note = val('acctNoteInput');
    payload.taxAdded = document.getElementById('acctTaxAddedInput').checked;
  }
  if (acctCan.commission) {
    // 輸入框是整數（15），存進試算表要換回小數（0.15）——跟載入時的換算對稱
    const rateIn = val('acctRateInput');
    payload.rate = rateIn === '' ? '' : Math.round(acctNum(rateIn) * 100) / 10000;
    payload.rateNote = val('acctRateNoteInput');
  }

  const btn = document.getElementById('acctSaveBtn');
  btn.disabled = true;
  setFormStatus('acctEditStatus', '儲存中…', '');
  try {
    if (acctEditCtx.isNew) await postTask(Object.assign({ type: 'acct-add' }, payload));
    else await postTask(Object.assign({ type: 'acct-update', id: acctEditCtx.rec.id }, payload));
    closeAcctEditModal();
    await loadAccounting(true);
  } catch (err) {
    setFormStatus('acctEditStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('acctDeleteBtn').addEventListener('click', async () => {
  if (!acctEditCtx || acctEditCtx.isNew) return;
  const r = acctEditCtx.rec;
  if (!confirm('確定要刪除「' + (r.date || '') + '　' + (r.rawName || acctBrandName(r.brandId)) + '」這筆帳務紀錄嗎？\n刪掉就沒了，統計數字也會跟著變。')) return;
  const btn = document.getElementById('acctDeleteBtn');
  btn.disabled = true;
  setFormStatus('acctEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'acct-delete', id: r.id });
    closeAcctEditModal();
    await loadAccounting(true);
  } catch (err) {
    setFormStatus('acctEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('acctAddBtn').addEventListener('click', () => openAcctEditModal(null));
document.getElementById('acctReloadBtn').addEventListener('click', () => loadAccounting(true));
['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderAccountingView);
});
document.getElementById('acctFilterText').addEventListener('input', renderAccountingView);
document.getElementById('acctFilterClear').addEventListener('click', () => {
  ['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus', 'acctFilterText']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderAccountingView();
});
