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
let acctCan = { revenue: false, commission: false, recon: false };
let acctStatuses = ['未成團', '進行中', '待結算', '已請款', '已入帳'];
// 對帳狀態白名單；後端沒回時用這組 fallback（跟 Code.gs 的 ACCT_RECON_STATUSES 保持逐字元一致）
let acctReconStatuses = ['待回填', '待核對業績', '審稿中', '審稿完成(待發布)', '已發布', '待開發票', '待確認發票', '等待匯款', '待對帳'];
// 對帳狀態「下一階段」推進對照表：雙流程（開團／稿酬）在「待開發票」合流，不是照陣列順序推進。
// 開團流程：待回填→待核對業績→（合流）；稿酬流程：審稿中→審稿完成(待發布)→已發布→（合流）；
// 共用後段：待開發票→待確認發票→等待匯款→待對帳→''（完成，呼叫端 confirm 後才送空字串）。
// 不在這張表裡的狀態（含空白）＝已經是流程終點，「下一階段」按鈕不動作。
const ACCT_RECON_NEXT = {
  '待回填': '待核對業績',
  '待核對業績': '待開發票',
  '審稿中': '審稿完成(待發布)',
  '審稿完成(待發布)': '已發布',
  '已發布': '待開發票',
  '待開發票': '待確認發票',
  '待確認發票': '等待匯款',
  '等待匯款': '待對帳'
};
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

// 同一份資料有兩個入口（帳務分頁、品牌檢視彈窗），一律走這裡。
// ⚠️ 不要另外寫一份 fetch：曾經那樣做，補拉完只設了 acctLoaded 卻沒建篩選 UI，
// 結果先看品牌摘要再進帳務分頁時整頁是空的，還得按重新整理才會出來。
let acctLoadingPromise = null;

function loadAccounting(force) {
  if (acctLoaded && !force) return Promise.resolve();
  // 兩個入口同時觸發時共用同一個請求，不要打兩次後端
  if (acctLoadingPromise && !force) return acctLoadingPromise;

  const box = document.getElementById('acctList');
  if (box && !acctLoaded) box.innerHTML = '<div class="task-empty">載入中…</div>';

  acctLoadingPromise = postTask({ type: 'acct-list' }).then(res => {
    acctData = Array.isArray(res.items) ? res.items : [];
    acctCan = { revenue: !!res.canRevenue, commission: !!res.canCommission, recon: !!res.canRecon };
    if (Array.isArray(res.statuses) && res.statuses.length) acctStatuses = res.statuses;
    if (Array.isArray(res.reconStatuses) && res.reconStatuses.length) acctReconStatuses = res.reconStatuses;
    acctLoaded = true;
    acctFillFilters();
    acctFillPrintScope();
    // 只有對帳權限、沒有業績/分潤權限的助理：其他分頁對她來說是空白頁（沒資料也沒按鈕），
    // 直接帶去唯一看得到的對帳分頁。只在還停在預設分頁時才自動切，避免蓋掉她自己選的分頁。
    if (!acctCan.revenue && !acctCan.commission && acctCan.recon && acctTab === 'list') {
      acctSwitchTab('recon');
    } else {
      renderAccountingView();
    }
  }).catch(err => {
    if (box) box.innerHTML = '<div class="task-empty">讀取失敗：' + escHtml(err.message) + '</div>';
    throw err;
  }).finally(() => { acctLoadingPromise = null; });

  return acctLoadingPromise;
}

// 重建下拉選項會把使用者選的值洗掉（改完一筆回來就變成看全部），
// 所以填完要把原本選的值寫回去。
function acctFillFilters() {
  const keep = {};
  ['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus', 'acctFilterRecon']
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

  document.getElementById('acctFilterRecon').innerHTML =
    '<option value="">全部對帳狀態</option>' +
    '<option value="__pending__">未完成（進行中）</option>' +
    acctReconStatuses.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
}

function acctFiltered() {
  const y = document.getElementById('acctFilterYear').value;
  const m = document.getElementById('acctFilterMonth').value;
  const b = document.getElementById('acctFilterBrand').value;
  const s = document.getElementById('acctFilterStatus').value;
  const rc = document.getElementById('acctFilterRecon').value;
  const kw = (document.getElementById('acctFilterText').value || '').trim().toLowerCase();
  return acctData.filter(r => {
    const d = r.date || '';
    if (y && d.slice(0, 4) !== y) return false;
    if (m && d.slice(5, 7) !== m) return false;
    if (b && r.brandId !== b) return false;
    if (s && r.status !== s) return false;
    if (rc === '__pending__' && !r.reconStatus) return false;
    if (rc && rc !== '__pending__' && r.reconStatus !== rc) return false;
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
  if (acctTab === 'recon') { renderAcctRecon(); return; }

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
    const rc = r.reconStatus || '';
    const rcCls = rc ? 'wait' : 'ok';
    const rcLabel = rc ? escHtml(rc) : '—';
    return `<div class="acct-row" data-id="${escHtml(r.id)}">
      <span class="acct-date">${escHtml(r.date || '')}</span>
      <span class="acct-name">${escHtml(acctBrandName(r.brandId) || r.rawName)}
        ${r.contFrom ? '<span class="acct-cont" title="同一團廠商重開表單，業績拆成兩列">續</span>' : ''}
        <small>${escHtml(r.rawName || '')}</small></span>
      <span class="acct-rate">${rate}</span>
      <span class="acct-money">${acctCell(r, 'sales', acctCan.revenue)}</span>
      <span class="acct-money strong">${acctCell(r, 'commission', acctCan.revenue)}</span>
      <span class="acct-status ${stCls}">${escHtml(st || '—')}</span>
      <span class="acct-status ${rcCls} acct-recon-col">${rcLabel}</span>
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

// ===== 對帳（acctRecon 角色的工作佇列）=====
// 這裡的金額直接顯示、不走 acctCell 遮蔽：對帳權限的人（acctRecon-only）沒有
// acctCan.revenue/commission，但後端契約保證這裡的列本來就含完整金額與 rate，
// 遮起來反而讓她沒辦法做事。老闆本人 acctCan 全開，行為不變。
function acctReconEstimate(rec, salesVal) {
  const hasRate = rec.rate !== '' && rec.rate !== undefined && rec.rate !== null && !isNaN(Number(rec.rate));
  if (!hasRate || salesVal === '' || salesVal === undefined || salesVal === null) return null;
  return Math.round(acctNum(salesVal) * Number(rec.rate));
}

// 階段徽章配色（每階段一色）。顏色語意：紅=助理要動手（最醒目）、灰=長等待（最低調）、
// 紫=審稿、綠=已發布、金=發票、藍=等錢、珊瑚=最後對帳。要調色只改這張表（class 定義在 admin.html）。
const ACCT_RECON_BADGE_GROUP = {
  '待回填': 'red',
  '待核對業績': 'muted',
  '審稿中': 'purple', '審稿完成(待發布)': 'purple',
  '已發布': 'mint',
  '待開發票': 'gold', '待確認發票': 'gold',
  '等待匯款': 'blue',
  '待對帳': 'coral'
};
function acctReconBadgeGroup_(status) {
  return ACCT_RECON_BADGE_GROUP[status] || 'muted';
}

function acctReconTodayStr_() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 行事曆事件（admin.js 的 allEvents）按「正規化後的品牌名」建一次索引，
// 576 筆帳務逐筆查表就好，不要每一筆都重新掃一次全部事件（bvBrandsInTitle_ 本身就是 O(brandDb)）。
// 依賴 brandVendor.js 的 bvNormBrandKey_ / bvBrandsInTitle_（先載入），
// 與 admin.js 的 allEvents（執行期一定在，理由同本檔其他跨模組呼叫）。
function acctReconBuildEventIndex_() {
  const map = new Map();
  if (typeof allEvents === 'undefined' || !Array.isArray(allEvents)) return map;
  if (typeof bvBrandsInTitle_ !== 'function') return map;
  allEvents.forEach(ev => {
    bvBrandsInTitle_(ev.title).forEach(b => {
      const key = bvNormBrandKey_(b.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    });
  });
  return map;
}

// 這筆帳務對應到哪個行事曆檔期（同品牌、日期落在 start~displayEnd 之間，含首尾）。
// 找不到就回 null，呼叫端走 fallback。
function acctReconFindEvent_(r, eventIndex) {
  const brand = brandDb.find(x => x.id === r.brandId);
  if (!brand || typeof bvNormBrandKey_ !== 'function') return null;
  const evs = eventIndex.get(bvNormBrandKey_(brand.name));
  if (!evs || !evs.length) return null;
  const d = parseDateStr(r.date);
  if (!d || typeof startOfDay !== 'function') return null;
  const dd = startOfDay(d);
  return evs.find(ev => startOfDay(ev.start) <= dd && dd <= startOfDay(ev.displayEnd)) || null;
}

// 判斷一筆帳務是不是「已結團」（＝對帳清單預設要不要顯示），刻意不用 r.status——
// 那欄要人手動更新，常常忘記改，靠不住。順序：
// ①比對到品牌對應的檔期 → 用檔期結束日（含延長，跟 getBrandGroupBuys_ 同一套 displayEnd）判斷；
// ②比對不到（歷史舊團、品牌改過名、事件被刪）→ fallback 用帳務日期本身跟今天比。
function acctReconIsClosed_(r, todayStr, eventIndex) {
  const ev = acctReconFindEvent_(r, eventIndex);
  if (ev) {
    const todayD = parseDateStr(todayStr);
    return startOfDay(ev.displayEnd) < startOfDay(todayD);
  }
  return (r.date || '') <= todayStr; // fallback：對不到檔期就看日期本身
}

// 收合清單的展開狀態、「顯示未結團／未開團」勾選狀態，都要跨重繪保留——
// 使用者勾 checkbox 或換分頁再回來時，不該把剛展開的列通通收回去。
let acctReconOpenIds = new Set();
let acctReconShowAll = false;

function renderAcctRecon() {
  const box = document.getElementById('acctReconList');
  if (!box) return;
  // 後端對助理已經只回未完成的列，但老闆是全量資料，前端自己也要濾一次
  const all = acctData.filter(r => r.reconStatus)
    .slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (!all.length) {
    box.innerHTML = '<div class="task-empty">目前沒有待對帳的紀錄</div>';
    return;
  }

  const todayStr = acctReconTodayStr_();
  const eventIndex = acctReconBuildEventIndex_();
  const isClosed = r => acctReconIsClosed_(r, todayStr, eventIndex);
  const hiddenCount = all.filter(r => !isClosed(r)).length;
  const list = acctReconShowAll ? all : all.filter(isClosed);

  const toolbarHtml = `<label class="acct-recon-toolbar">
      <input type="checkbox" id="acctReconShowAllChk"${acctReconShowAll ? ' checked' : ''}>
      顯示未結團／未開團（${hiddenCount}）
    </label>`;
  const bindToolbar = () => {
    const chk = document.getElementById('acctReconShowAllChk');
    if (chk) chk.addEventListener('change', () => { acctReconShowAll = chk.checked; renderAcctRecon(); });
  };

  if (!list.length) {
    box.innerHTML = toolbarHtml + '<div class="task-empty">目前沒有待對帳的紀錄' +
      (hiddenCount ? '（另有 ' + hiddenCount + ' 團還沒開團或還在進行中，勾選上方可查看）' : '') + '</div>';
    bindToolbar();
    return;
  }

  // 每個月份還顯示幾團未對完＋幾團還沒回填業績（月份條用；清單本身都是未完成的列，所以就是該月筆數）
  const monthCounts = new Map();
  const monthPendingFill = new Map();
  list.forEach(r => {
    const key = (r.date || '').slice(0, 7);
    monthCounts.set(key, (monthCounts.get(key) || 0) + 1);
    if (r.reconStatus === '待回填') monthPendingFill.set(key, (monthPendingFill.get(key) || 0) + 1);
  });

  let lastMonth = null;
  const rowsHtml = list.map(r => {
    const monthKey = (r.date || '').slice(0, 7);
    let monthBar = '';
    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      const [y, m] = monthKey.split('-');
      const pf = monthPendingFill.get(monthKey) || 0;
      const pfHtml = pf ? `<span class="acct-recon-month-pending">　・${pf} 團未回填業績</span>` : '';
      monthBar = `<div class="acct-recon-month-bar">${y}年${Number(m)}月　還有 ${monthCounts.get(monthKey)} 團未對完${pfHtml}</div>`;
    }

    const hasRate = r.rate !== '' && r.rate !== undefined && r.rate !== null && !isNaN(Number(r.rate));
    const rateTxt = hasRate ? (Math.round(Number(r.rate) * 1000) / 10 + '%')
      : (r.rateNote ? escHtml(r.rateNote) : '—');
    const salesVal = (r.sales === undefined || r.sales === null) ? '' : r.sales;
    const commVal = (r.commission === undefined || r.commission === null) ? '' : r.commission;
    const est = acctReconEstimate(r, salesVal);
    const warn = est !== null && commVal !== '' && Math.abs(acctNum(commVal) - est) > Math.max(est * 0.02, 5);
    const badgeGroup = acctReconBadgeGroup_(r.reconStatus);
    const isOpen = acctReconOpenIds.has(r.id);

    return `${monthBar}<div class="acct-recon-row${isOpen ? ' open' : ''}" data-id="${escHtml(r.id)}">
      <div class="acct-recon-summary">
        <span class="acct-recon-date">${escHtml((r.date || '').slice(5))}</span>
        <span class="acct-recon-brand">${escHtml(acctBrandName(r.brandId) || r.rawName || '')}</span>
        <span class="acct-recon-badge acct-recon-badge-${badgeGroup}">${escHtml(r.reconStatus)}</span>
        <span class="acct-recon-warn"${warn ? '' : ' style="display:none"'} title="分潤金額跟試算差異超標，回頭check一下">⚠</span>
      </div>
      <div class="acct-recon-detail">
        <div class="acct-recon-head"><span class="acct-rate">分潤 ${rateTxt}</span></div>
        <div class="acct-recon-grid">
          <label>對帳狀態
            <select class="acct-recon-status">
              ${acctReconStatuses.map(s => `<option value="${escHtml(s)}"${s === r.reconStatus ? ' selected' : ''}>${escHtml(s)}</option>`).join('')}
            </select>
          </label>
          <label>銷售金額
            ${r.sales !== undefined ? `<input type="number" class="acct-recon-sales" step="1" value="${escHtml(salesVal)}">` : '<span class="acct-recon-est">—</span>'}
          </label>
          <label>分潤金額
            ${r.commission !== undefined ? `<input type="number" class="acct-recon-commission" step="1" value="${escHtml(commVal)}">
            <span class="acct-recon-est${warn ? ' warn' : ''}">${est !== null ? '試算 $' + est.toLocaleString('en-US') : ''}</span>` : '<span class="acct-recon-est">—</span>'}
          </label>
          <label>發票號碼
            ${r.invoice !== undefined ? `<input type="text" class="acct-recon-invoice" value="${escHtml(r.invoice || '')}">` : '<span class="acct-recon-est">—</span>'}
          </label>
          <label>備註
            ${r.note !== undefined ? `<input type="text" class="acct-recon-note" value="${escHtml(r.note || '')}">` : '<span class="acct-recon-est">—</span>'}
          </label>
        </div>
        <div class="acct-recon-actions">
          <button class="task-mini-btn acct-recon-save">💾 儲存</button>
          <button class="task-mini-btn acct-recon-next">下一階段 ▶</button>
          <span class="form-status acct-recon-msg"></span>
        </div>
      </div>
    </div>`;
  }).join('');

  box.innerHTML = toolbarHtml + '<div class="acct-recon-list">' + rowsHtml + '</div>';
  bindToolbar();

  box.querySelectorAll('.acct-recon-row').forEach(rowEl => {
    const id = rowEl.dataset.id;
    const rec = acctData.find(x => x.id === id);
    if (!rec) return;

    // 收合／展開：只是 toggle class 靠 CSS 顯示，不重繪清單，其他列的展開狀態與
    // 輸入到一半的字才不會被洗掉。展開狀態記進模組層的 Set，換分頁/勾 checkbox 重繪時還原。
    rowEl.querySelector('.acct-recon-summary').addEventListener('click', () => {
      rowEl.classList.toggle('open');
      if (rowEl.classList.contains('open')) acctReconOpenIds.add(id);
      else acctReconOpenIds.delete(id);
    });

    const salesEl = rowEl.querySelector('.acct-recon-sales');
    const commEl = rowEl.querySelector('.acct-recon-commission');
    const estEl = rowEl.querySelector('.acct-recon-est');
    const warnFlagEl = rowEl.querySelector('.acct-recon-warn');
    const msgEl = rowEl.querySelector('.acct-recon-msg');

    // 試算只是提示，跟著輸入即時重算，但絕對不會反過來改寫分潤金額欄。
    // 金額欄沒權限時（後端沒回傳該 key）根本不會渲染輸入框，這裡就不用掛。
    if (salesEl && commEl && estEl) {
      const refreshEst = () => {
        const est = acctReconEstimate(rec, salesEl.value);
        if (est === null) {
          estEl.textContent = ''; estEl.classList.remove('warn');
          if (warnFlagEl) warnFlagEl.style.display = 'none';
          return;
        }
        estEl.textContent = '試算 $' + est.toLocaleString('en-US');
        const w = commEl.value !== '' && Math.abs(acctNum(commEl.value) - est) > Math.max(est * 0.02, 5);
        estEl.classList.toggle('warn', w);
        if (warnFlagEl) warnFlagEl.style.display = w ? '' : 'none';
      };
      salesEl.addEventListener('input', refreshEst);
      commEl.addEventListener('input', refreshEst);
    }

    const setMsg = (text, cls) => {
      msgEl.textContent = text;
      msgEl.className = 'form-status acct-recon-msg' + (cls ? ' ' + cls : '');
    };

    // 儲存跟下一階段都送同一組欄位，差別只在 reconStatus 要不要被強制推進；
    // 這樣「下一階段」不會把使用者剛改好還沒按儲存的金額/發票/備註弄丟。
    // 沒權限的欄位（後端沒回傳該 key）連輸入框都不會渲染，這裡自然也不會送——
    // 雙重條件（資料有 key 且輸入框存在）是保險絲，防止任何一邊漏掉時覆寫看不見的真實值。
    const gather = () => {
      const payload = {
        type: 'acct-update',
        id: rec.id,
        reconStatus: rowEl.querySelector('.acct-recon-status').value
      };
      const invEl = rowEl.querySelector('.acct-recon-invoice');
      const noteEl = rowEl.querySelector('.acct-recon-note');
      if (rec.sales !== undefined && salesEl) payload.sales = salesEl.value;
      if (rec.commission !== undefined && commEl) payload.commission = commEl.value;
      if (rec.invoice !== undefined && invEl) payload.invoice = invEl.value;
      if (rec.note !== undefined && noteEl) payload.note = noteEl.value;
      return payload;
    };

    const applyLocal = (payload) => {
      if ('sales' in payload) rec.sales = payload.sales === '' ? '' : acctNum(payload.sales);
      if ('commission' in payload) rec.commission = payload.commission === '' ? '' : acctNum(payload.commission);
      if ('invoice' in payload) rec.invoice = payload.invoice;
      if ('note' in payload) rec.note = payload.note;
      rec.reconStatus = payload.reconStatus;
    };

    // 局部更新這一列的徽章文字/配色跟警示旗標；成功後不整頁重繪，
    // 其他列的展開狀態與使用者打到一半的輸入值才不會被洗掉。
    const updateRowBadge = () => {
      const badgeEl = rowEl.querySelector('.acct-recon-badge');
      const group = acctReconBadgeGroup_(rec.reconStatus);
      badgeEl.className = 'acct-recon-badge acct-recon-badge-' + group;
      badgeEl.textContent = rec.reconStatus;
      const est2 = acctReconEstimate(rec, rec.sales);
      const commVal2 = (rec.commission === undefined || rec.commission === null) ? '' : rec.commission;
      const w = est2 !== null && commVal2 !== '' && Math.abs(acctNum(commVal2) - est2) > Math.max(est2 * 0.02, 5);
      if (warnFlagEl) warnFlagEl.style.display = w ? '' : 'none';
    };

    rowEl.querySelector('.acct-recon-save').addEventListener('click', async () => {
      const payload = gather();
      setMsg('儲存中…', '');
      try {
        await postTask(payload);
        applyLocal(payload);
        updateRowBadge();
        setMsg('已儲存 ✓', 'ok');
      } catch (err) {
        setMsg('儲存失敗：' + err.message, 'error');
      }
    });

    rowEl.querySelector('.acct-recon-next').addEventListener('click', async () => {
      const payload = gather();
      const cur = payload.reconStatus;
      if (cur === '待對帳') {
        if (!confirm('標記為對帳完成？完成後此列會從對帳清單消失')) return;
        payload.reconStatus = '';
      } else if (Object.prototype.hasOwnProperty.call(ACCT_RECON_NEXT, cur)) {
        payload.reconStatus = ACCT_RECON_NEXT[cur];
      } else {
        return; // 不在對照表裡（含空白）＝流程終點，不動作
      }
      setMsg('處理中…', '');
      try {
        await postTask(payload);
        applyLocal(payload);
        if (payload.reconStatus === '') {
          // 完成了，這筆已經不屬於對帳清單：局部拿掉這一列就好，不用整頁重繪
          acctReconOpenIds.delete(id);
          rowEl.remove();
        } else {
          updateRowBadge();
          setMsg('已更新 ✓', 'ok');
        }
      } catch (err) {
        setMsg('更新失敗：' + err.message, 'error');
      }
    });
  });
}

// ===== 品牌檢視彈窗裡的帳務摘要 =====
// brandVendor.js 排在本檔之前載入，所以它不能在最外層引用這裡的東西，
// 但執行期（使用者點開品牌）本檔早就載完了，呼叫得到。
async function renderBrandAcctSummary(brandId) {
  const box = document.getElementById('brandDetailAcct');
  if (!box) return;
  if (typeof hasPerm === 'function' && !hasPerm('revenue|commission')) { box.innerHTML = ''; return; }

  // 使用者可能在等待期間關掉彈窗或改看別的品牌，資料回來時要確認畫的還是同一個
  const stillSame = () => brandDetailCtx && brandDetailCtx.id === brandId;
  if (!acctLoaded) {
    box.innerHTML = '<div class="bda-loading">帳務資料載入中…</div>';
    try {
      await loadAccounting();          // 共用主載入路徑，篩選與報表 UI 一併建好
    } catch (err) {
      if (stillSame()) box.innerHTML = '<div class="bda-loading">帳務資料讀取失敗：' + escHtml(err.message) + '</div>';
      return;
    }
    if (!stillSame()) return;
  }

  const rows = acctData.filter(r => r.brandId === brandId);
  if (!rows.length) {
    box.innerHTML = '<div class="bda-wrap"><div class="bda-title">💰 開團帳務</div>' +
      '<div class="bda-empty">這個品牌還沒有帳務紀錄</div></div>';
    return;
  }
  const teams = rows.filter(r => !r.contFrom).length;
  const sales = rows.reduce((a, r) => a + acctNum(r.sales), 0);
  const income = rows.reduce((a, r) => a + acctNum(r.commission) + acctNum(r.fee), 0);
  const sorted = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const last = sorted[0];
  const pend = rows.filter(r => r.status !== '已入帳' && r.status !== '已請款');
  // 有成數的紀錄才拿來算平均，混合成數那種（分潤%空白、寫在分潤說明）不能算進去
  const rated = rows.filter(r => r.rate !== '' && r.rate !== undefined && r.rate !== null);
  const avgRate = rated.length
    ? Math.round(rated.reduce((a, r) => a + acctNum(r.rate), 0) / rated.length * 1000) / 10 : null;
  const hid = '<span class="acct-hidden">•••</span>';

  box.innerHTML = `<div class="bda-wrap">
    <div class="bda-title">💰 開團帳務</div>
    <div class="bda-grid">
      <div><b>${teams}</b><span>開團次數</span></div>
      <div><b>${acctCan.revenue ? acctMoney(sales) : hid}</b><span>總銷售</span></div>
      <div><b>${acctCan.revenue ? acctMoney(income) : hid}</b><span>總收入</span></div>
      <div><b>${acctCan.commission ? (avgRate === null ? '—' : avgRate + '%') : hid}</b><span>平均分潤</span></div>
    </div>
    <div class="bda-line">最近一團：${escHtml(last.date || '—')}　${escHtml(last.rawName || '')}</div>
    ${pend.length ? `<div class="bda-line warn">還有 ${pend.length} 團未結算</div>` : ''}
    <div class="bda-recent">${sorted.slice(0, 5).map(r => `<div class="bda-row">
        <span>${escHtml(r.date || '')}</span>
        <span class="bda-row-name">${escHtml(r.rawName || '')}</span>
        <span>${acctCan.revenue ? escHtml(acctMoney(acctNum(r.commission) + acctNum(r.fee))) : hid}</span>
      </div>`).join('')}</div>
    ${rows.length > 5 ? `<div class="bda-more">共 ${rows.length} 筆，完整紀錄請到「開團帳務」分頁</div>` : ''}
  </div>`;
}

// ===== 廠商檢視彈窗裡的帳務摘要 =====
// 封存的廠商在品牌資料庫沒有連結，光看「不老松」這種公司名根本不知道是幹嘛的。
// 靠帳務反查「這家幫我開過哪些品牌的團」才有意義。
async function renderVendorAcctSummary(vendorId) {
  const box = document.getElementById('vendorDetailAcct');
  if (!box) return;
  if (typeof hasPerm === 'function' && !hasPerm('revenue|commission')) { box.innerHTML = ''; return; }

  const stillSame = () => vendorDetailCtx && vendorDetailCtx.id === vendorId;
  if (!acctLoaded) {
    box.innerHTML = '<div class="bda-loading">帳務資料載入中…</div>';
    try {
      await loadAccounting();
    } catch (err) {
      if (stillSame()) box.innerHTML = '<div class="bda-loading">帳務資料讀取失敗：' + escHtml(err.message) + '</div>';
      return;
    }
    if (!stillSame()) return;
  }

  // 帳務的「廠商」欄記的是**這一團實際跟誰請款／誰開的發票**，
  // 品牌資料庫的「所屬廠商」記的是**這個品牌歸哪家廠商管**，兩者常常不是同一個：
  //   ・行銷公司自己有發票，但幫旗下某些品牌開的是品牌自己的抬頭（吃土也要BUY → 禾沐生活）
  //   ・同一家公司在帳務裡用開票抬頭建檔、在品牌那邊用品牌名建檔（愛子伴桌 V006 ↔ 貝比富 V033）
  // 一個廠商對到多個公司名稱是常態，不是資料錯誤。只認廠商欄的話，
  // 「底下明明掛著品牌、品牌點進去也看得到過去的團」的廠商會顯示成 0 筆，自相矛盾。
  // 所以這裡取聯集：廠商欄指到我 ∪ 我底下品牌的團，另外標示哪幾團是別的抬頭開的。
  const myBrandIds = new Set(
    (typeof brandDb !== 'undefined' ? brandDb : [])
      .filter(b => (b.vendorIds || []).indexOf(vendorId) !== -1)
      .map(b => b.id)
  );
  const rows = acctData.filter(r => r.vendorId === vendorId || (r.brandId && myBrandIds.has(r.brandId)));
  if (!rows.length) {
    box.innerHTML = '<div class="bda-wrap"><div class="bda-title">💰 開團帳務</div>' +
      '<div class="bda-empty">這個廠商還沒有帳務紀錄（底下的品牌也沒有開過團）</div></div>';
    return;
  }
  // 不是靠廠商欄、而是靠品牌關聯撈進來的團：錢實際上記在別的抬頭下，要讓使用者看得出來
  const viaBrand = rows.filter(r => r.vendorId !== vendorId);
  const teams = rows.filter(r => !r.contFrom).length;
  const income = rows.reduce((a, r) => a + acctNum(r.commission) + acctNum(r.fee), 0);
  const sorted = rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const hid = '<span class="acct-hidden">•••</span>';

  // 這家幫忙開過哪些品牌 —— 這才是「這家是幹嘛的」的答案
  const byBrand = new Map();
  rows.forEach(r => {
    const key = r.brandId || '(未指定品牌)';
    if (!byBrand.has(key)) byBrand.set(key, { n: 0, income: 0, last: '' });
    const o = byBrand.get(key);
    o.n++;
    o.income += acctNum(r.commission) + acctNum(r.fee);
    if ((r.date || '') > o.last) o.last = r.date || '';
  });
  const brandRows = [...byBrand.entries()].sort((a, b) => b[1].income - a[1].income || b[1].n - a[1].n);
  // 開票公司也列出來：同一家廠商可能有好幾種抬頭，對帳時很有用
  const comps = [...new Set(rows.map(r => r.company).filter(Boolean))];
  // 帳務出現過、但廠商資料的「公司名稱」欄還沒登記的抬頭 → 標出來提醒去補。
  // 補進去之後，之後依開票公司做的自動比對才認得這是同一家。
  const knownComps = new Set(
    String((vendorDetailCtx && vendorDetailCtx.companyNames) || '')
      .split(/[,、，]/).map(s => s.trim()).filter(Boolean)
  );
  knownComps.add(String((vendorDetailCtx && vendorDetailCtx.name) || '').trim());
  const newComps = comps.filter(c => !knownComps.has(c));

  box.innerHTML = `<div class="bda-wrap">
    <div class="bda-title">💰 開團帳務</div>
    <div class="bda-grid" style="grid-template-columns:repeat(3,1fr);">
      <div><b>${teams}</b><span>開團次數</span></div>
      <div><b>${byBrand.size}</b><span>合作品牌數</span></div>
      <div><b>${acctCan.revenue ? acctMoney(income) : hid}</b><span>總收入</span></div>
    </div>
    <div class="bda-recent">
      <div class="bda-sub">合作過的品牌</div>
      ${brandRows.map(([bid, o]) => `<div class="bda-row">
        <span class="bda-row-name">${escHtml(acctBrandName(bid) || bid)}</span>
        <span>${o.n} 團</span>
        <span>${acctCan.revenue ? escHtml(acctMoney(o.income)) : hid}</span>
      </div>`).join('')}
    </div>
    <div class="bda-line" style="margin-top:8px;">最近一團：${escHtml(sorted[0].date || '—')}　${escHtml(sorted[0].rawName || '')}</div>
    ${comps.length ? `<div class="bda-line">開票抬頭：${escHtml(comps.join('、'))}</div>` : ''}
    ${viaBrand.length ? `<div class="bda-line">其中 ${viaBrand.length} 團的帳掛在別的抬頭下，是靠底下的品牌關聯進來的</div>` : ''}
    ${newComps.length ? `<div class="bda-line warn">這些抬頭還沒登記到本廠商的「公司名稱」欄：${escHtml(newComps.join('、'))}</div>` : ''}
  </div>`;
}

// ----- 分頁切換 -----
function acctSwitchTab(tab) {
  acctTab = tab;
  document.querySelectorAll('.acct-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.getElementById('acctPaneList').style.display = tab === 'list' ? '' : 'none';
  document.getElementById('acctPaneTrend').style.display = tab === 'trend' ? '' : 'none';
  document.getElementById('acctPaneRank').style.display = tab === 'rank' ? '' : 'none';
  document.getElementById('acctPanePrint').style.display = tab === 'print' ? '' : 'none';
  document.getElementById('acctPaneRecon').style.display = tab === 'recon' ? '' : 'none';
  // 列印報表自己有範圍選單、對帳是獨立工作佇列，兩者都不吃上面的篩選列/摘要
  document.querySelector('.acct-filters').style.display = (tab === 'print' || tab === 'recon') ? 'none' : '';
  document.getElementById('acctSummary').style.display = (tab === 'print' || tab === 'recon') ? 'none' : '';
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
  document.getElementById('acctReconStatusSelect').innerHTML =
    '<option value="">完成（不需要對帳）</option>' +
    acctReconStatuses.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');

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
  v('acctReconStatusSelect', rec ? (rec.reconStatus || '') : (acctReconStatuses[0] || ''));
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
    payload.reconStatus = document.getElementById('acctReconStatusSelect').value;
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
['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus', 'acctFilterRecon'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderAccountingView);
});
document.getElementById('acctFilterText').addEventListener('input', renderAccountingView);
document.getElementById('acctFilterClear').addEventListener('click', () => {
  ['acctFilterYear', 'acctFilterMonth', 'acctFilterBrand', 'acctFilterStatus', 'acctFilterRecon', 'acctFilterText']
    .forEach(id => { document.getElementById(id).value = ''; });
  renderAccountingView();
});
