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
let acctTab = 'list';
let acctMetric = 'commission';

const ACCT_METRIC_LABEL = { commission: '分潤', sales: '銷售金額', fee: '稿酬' };

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
    acctFillPrintScope();
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

  // 其他分頁各自渲染，但摘要四格是共用的，所以上面一定要先算完
  if (acctTab === 'trend') { renderAcctTrend(); return; }
  if (acctTab === 'rank') { renderAcctRank(); return; }
  if (acctTab === 'print') { renderAcctPrint(); return; }

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

// ===== 月營收趨勢 =====
// 一次只畫一種金額。銷售是分潤的 6 倍量級，兩條畫同一張圖只有兩種下場：
// 用雙 Y 軸（比例被縮放扭曲、會誤導）或小的那條被壓成貼地的一條線。
function acctMonthly(list) {
  const m = new Map();
  list.forEach(r => {
    const ym = (r.date || '').slice(0, 7);
    if (!ym) return;
    if (!m.has(ym)) m.set(ym, { ym, sales: 0, commission: 0, fee: 0, n: 0, teams: 0, pend: 0 });
    const o = m.get(ym);
    o.sales += acctNum(r.sales);
    o.commission += acctNum(r.commission);
    o.fee += acctNum(r.fee);
    o.n++;
    if (!r.contFrom) o.teams++;
    if (r.status !== '已入帳' && r.status !== '已請款') o.pend += acctNum(r.commission);
  });
  return [...m.values()].sort((a, b) => a.ym.localeCompare(b.ym));
}

function renderAcctTrend() {
  const box = document.getElementById('acctChart');
  const note = document.getElementById('acctChartNote');
  if (!box) return;
  if (!acctCan.revenue) {
    box.innerHTML = '<div class="task-empty">你沒有查看業績金額的權限，看不到趨勢圖</div>';
    note.textContent = '';
    return;
  }
  const rows = acctMonthly(acctFiltered());
  if (!rows.length) { box.innerHTML = '<div class="task-empty">沒有資料</div>'; note.textContent = ''; return; }

  const key = acctMetric;
  const max = Math.max(...rows.map(r => r[key]), 1);
  const BAR = 30, GAP = 6, PADL = 62, PADT = 14, H = 210, PADB = 44;
  const W = PADL + rows.length * (BAR + GAP) + 12;
  const y = v => PADT + (H - (v / max) * H);

  // 格線：4 條，取好看的整數級距
  const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
  const ticks = [];
  for (let v = 0; v <= max; v += step / 2) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(max);

  let svg = `<svg viewBox="0 0 ${W} ${H + PADT + PADB}" width="${W}" height="${H + PADT + PADB}" role="img" aria-label="每月${ACCT_METRIC_LABEL[key]}長條圖">`;
  ticks.forEach(v => {
    svg += `<line x1="${PADL - 6}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="acct-grid"/>`;
    svg += `<text x="${PADL - 10}" y="${y(v) + 4}" class="acct-axis" text-anchor="end">${acctShort(v)}</text>`;
  });
  let lastYear = '';
  rows.forEach((r, i) => {
    const x = PADL + i * (BAR + GAP);
    const h = Math.max((r[key] / max) * H, r[key] > 0 ? 2 : 0);
    const top = PADT + (H - h);
    svg += `<rect class="acct-bar" x="${x}" y="${top}" width="${BAR}" height="${h}" rx="4"
             data-i="${i}"><title>${escHtml(r.ym)}　${ACCT_METRIC_LABEL[key]} ${acctMoney(r[key])}　${r.teams} 團</title></rect>`;
    const mm = String(parseInt(r.ym.slice(5, 7), 10));
    svg += `<text x="${x + BAR / 2}" y="${PADT + H + 15}" class="acct-axis" text-anchor="middle">${mm}</text>`;
    const yr = r.ym.slice(0, 4);
    if (yr !== lastYear) {
      svg += `<text x="${x}" y="${PADT + H + 33}" class="acct-axis-year">${yr}</text>`;
      lastYear = yr;
    }
  });
  svg += '</svg>';
  box.innerHTML = svg;

  const tot = rows.reduce((a, r) => a + r[key], 0);
  const best = rows.reduce((a, r) => (r[key] > a[key] ? r : a), rows[0]);
  note.innerHTML = `共 ${rows.length} 個月　合計 <b>${acctMoney(tot)}</b>　` +
    `平均每月 <b>${acctMoney(Math.round(tot / rows.length))}</b>　` +
    `最高 <b>${escHtml(best.ym)}</b> 的 <b>${acctMoney(best[key])}</b>　` +
    `<span class="acct-chart-hint">（滑過長條看該月數字）</span>`;
}

// 軸標籤用「萬」為單位，六位數字排在軸上會擠成一團
function acctShort(v) {
  if (v >= 10000) return Math.round(v / 10000 * 10) / 10 + '萬';
  return acctMoney(v);
}

// ===== 品牌排行 =====
function acctByBrand(list) {
  const m = new Map();
  list.forEach(r => {
    const id = r.brandId || '(未指定)';
    if (!m.has(id)) m.set(id, { id, teams: 0, n: 0, sales: 0, commission: 0, fee: 0, last: '' });
    const o = m.get(id);
    o.n++;
    if (!r.contFrom) o.teams++;
    o.sales += acctNum(r.sales);
    o.commission += acctNum(r.commission);
    o.fee += acctNum(r.fee);
    if ((r.date || '') > o.last) o.last = r.date || '';
  });
  // 沒有業績權限的人拿到的金額全是 undefined→0，用金額排序會退化成隨機順序，
  // 卻照樣印出 1、2、3 名，等於給了一份假排行。那種情況改用團數排。
  const arr = [...m.values()];
  if (!acctCan.revenue) return arr.sort((a, b) => b.teams - a.teams || b.n - a.n);
  return arr.sort((a, b) => (b.commission + b.fee) - (a.commission + a.fee));
}

function renderAcctRank() {
  const box = document.getElementById('acctRank');
  if (!box) return;
  const rows = acctByBrand(acctFiltered());
  if (!rows.length) { box.innerHTML = '<div class="task-empty">沒有資料</div>'; return; }
  const max = Math.max(...rows.map(r => r.commission + r.fee), 1);
  const head = `<div class="acct-rank-row head">
      <span>#</span><span>品牌${acctCan.revenue ? '' : '（依團數排序）'}</span><span>團數</span>
      <span>銷售金額</span><span>分潤＋稿酬</span><span>最近一團</span></div>`;
  box.innerHTML = head + rows.map((r, i) => {
    const income = r.commission + r.fee;
    const pct = acctCan.revenue ? (income / max * 100) : 0;
    return `<div class="acct-rank-row">
      <span class="acct-rank-no">${i + 1}</span>
      <span class="acct-rank-name">${escHtml(acctBrandName(r.id) || r.id)}</span>
      <span class="acct-rank-n">${r.teams}</span>
      <span class="acct-money">${acctCan.revenue ? escHtml(acctMoney(r.sales)) : '<span class="acct-hidden">•••</span>'}</span>
      <span class="acct-money strong">${acctCan.revenue ? escHtml(acctMoney(income)) : '<span class="acct-hidden">•••</span>'}
        ${acctCan.revenue ? `<i class="acct-rank-bar" style="width:${pct}%"></i>` : ''}</span>
      <span class="acct-rank-last">${escHtml(r.last || '—')}</span>
    </div>`;
  }).join('');
}

// ===== 列印報表 =====
function acctFillPrintScope() {
  const sel = document.getElementById('acctPrintScope');
  if (!sel) return;
  const keep = sel.value;
  const years = [...new Set(acctData.map(r => (r.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const months = [...new Set(acctData.map(r => (r.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  sel.innerHTML = '<option value="all">全部期間</option>' +
    years.map(y => `<option value="Y${y}">${y} 年（整年）</option>`).join('') +
    months.map(m => `<option value="M${m}">${m.slice(0, 4)} 年 ${parseInt(m.slice(5), 10)} 月</option>`).join('');
  if (keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;
}

function renderAcctPrint() {
  const box = document.getElementById('acctPrintArea');
  if (!box) return;
  const scope = document.getElementById('acctPrintScope').value || 'all';
  let list = acctData, title = '全部期間';
  if (scope.startsWith('Y')) {
    const y = scope.slice(1);
    list = acctData.filter(r => (r.date || '').startsWith(y));
    title = y + ' 年';
  } else if (scope.startsWith('M')) {
    const ym = scope.slice(1);
    list = acctData.filter(r => (r.date || '').startsWith(ym));
    title = ym.slice(0, 4) + ' 年 ' + parseInt(ym.slice(5), 10) + ' 月';
  }
  const sales = list.reduce((a, r) => a + acctNum(r.sales), 0);
  const comm = list.reduce((a, r) => a + acctNum(r.commission), 0);
  const fee = list.reduce((a, r) => a + acctNum(r.fee), 0);
  const teams = list.filter(r => !r.contFrom).length;
  const pend = list.filter(r => r.status !== '已入帳' && r.status !== '已請款');
  const pendSum = pend.reduce((a, r) => a + acctNum(r.commission), 0);
  const money = v => acctCan.revenue ? acctMoney(v) : '－';

  const months = acctMonthly(list);
  const brands = acctByBrand(list).slice(0, 20);
  const today = new Date().toISOString().slice(0, 10);

  box.innerHTML = `
    <div class="acct-print-head">
      <h2>開團帳務報表</h2>
      <div class="acct-print-meta">${escHtml(title)}　·　列印日期 ${today}</div>
    </div>
    <table class="acct-print-kv">
      <tr><th>開團數</th><td>${teams} 團（紀錄 ${list.length} 筆）</td>
          <th>銷售金額</th><td>${money(sales)}</td></tr>
      <tr><th>分潤</th><td>${money(comm)}</td>
          <th>稿酬</th><td>${money(fee)}</td></tr>
      <tr><th>收入合計</th><td class="strong">${money(comm + fee)}</td>
          <th>其中未結算</th><td>${money(pendSum)}（${pend.length} 團）</td></tr>
    </table>

    <h3>各月明細</h3>
    <table class="acct-print-table">
      <thead><tr><th>月份</th><th>團數</th><th>銷售金額</th><th>分潤</th><th>稿酬</th><th>未結算</th></tr></thead>
      <tbody>${months.map(m => `<tr>
        <td>${escHtml(m.ym)}</td><td>${m.teams}</td>
        <td>${money(m.sales)}</td><td>${money(m.commission)}</td>
        <td>${money(m.fee)}</td><td>${m.pend ? money(m.pend) : '－'}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><th>合計</th><th>${teams}</th><th>${money(sales)}</th>
        <th>${money(comm)}</th><th>${money(fee)}</th><th>${money(pendSum)}</th></tr></tfoot>
    </table>

    <h3>品牌排行（前 20）</h3>
    <table class="acct-print-table">
      <thead><tr><th>#</th><th>品牌</th><th>團數</th><th>銷售金額</th><th>分潤＋稿酬</th></tr></thead>
      <tbody>${brands.map((b, i) => `<tr>
        <td>${i + 1}</td><td>${escHtml(acctBrandName(b.id) || b.id)}</td><td>${b.teams}</td>
        <td>${money(b.sales)}</td><td>${money(b.commission + b.fee)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="acct-print-foot">雪莉與朵栗 · 開團帳務系統　${escHtml(title)}　產生於 ${today}</div>`;
}

// ----- 分頁切換 -----
function acctSwitchTab(tab) {
  acctTab = tab;
  document.querySelectorAll('.acct-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('acctPaneList').style.display = tab === 'list' ? '' : 'none';
  document.getElementById('acctPaneTrend').style.display = tab === 'trend' ? '' : 'none';
  document.getElementById('acctPaneRank').style.display = tab === 'rank' ? '' : 'none';
  document.getElementById('acctPanePrint').style.display = tab === 'print' ? '' : 'none';
  // 列印報表自己有範圍選單，不吃上面的篩選列，避免兩套範圍打架
  document.querySelector('.acct-filters').style.display = tab === 'print' ? 'none' : '';
  document.getElementById('acctSummary').style.display = tab === 'print' ? 'none' : '';
  // 只有真的在列印分頁才掛這個 class，否則在別頁按 Ctrl+P 會印出空白紙（見 @media print 註解）
  document.body.classList.toggle('acct-printing', tab === 'print');
  renderAccountingView();
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

document.querySelectorAll('.acct-tab').forEach(btn => {
  btn.addEventListener('click', () => acctSwitchTab(btn.dataset.tab));
});
document.querySelectorAll('.acct-metric').forEach(btn => {
  btn.addEventListener('click', () => {
    acctMetric = btn.dataset.metric;
    document.querySelectorAll('.acct-metric').forEach(b => b.classList.toggle('on', b === btn));
    renderAcctTrend();
  });
});
document.getElementById('acctPrintScope').addEventListener('change', renderAcctPrint);
document.getElementById('acctPrintBtn').addEventListener('click', () => window.print());
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
