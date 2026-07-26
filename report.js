// ===================================================================
// report.js — 「報表統計」主選單分頁（第 8 個 view）
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由跟 prItems.js / brandVendor.js 等既有模組一樣：admin.js 開機還原上次
// 停留的分頁時，switchView() 會同步呼叫 renderReportView()；本檔若排在
// admin.js 之後載入，開機當下函式還不存在，整頁會變磚。
//
// 資料層歸屬：statsMap／allEvents／customBlocks 的宣告與寫入都在 admin.js
// （loadData／fetchMemos 等處理），本檔只讀，不另外打後端——除了「重新整理」
// 按鈕會呼叫 postTask({type:'stat-report'}) 拉最新統計、直接更新 statsMap。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不直接呼叫 admin.js 的函式；
// 執行期（renderReportView 等函式被呼叫時）才會用到 admin.js 的全域：
// statsMap、allEvents、customBlocks、postTask、getMemoKey、setFormStatus、escHtml。
// ===================================================================

// ----- 模組層常數（開機期就會被讀到，一律放檔案最前段） -----
const RPT_PAGE_DEFS = [
  { key: 'index', label: '團購行事曆' },
  { key: 'recipes', label: '食譜大全' },
  { key: 'school', label: '開學清單' }
];
// 對應 index.html 的 attachStatTracking()：來源 key 固定是 evKey + '_src_' + mode
const RPT_SOURCE_DEFS = [
  { key: 'start', label: '開團日模式' },
  { key: 'end', label: '結團日模式' },
  { key: 'all', label: '全部顯示' },
  { key: 'list', label: '現正開團中' },
  { key: 'now', label: '現正開團中卡片' },
  { key: 'recipes', label: '食譜頁' },
  { key: 'school', label: '開學清單頁' }
];
// 純 evKey（無 page_/block_ 前綴、無 _src_/_intro/_recipe/_order/_code 後綴）：<id>_<YYYY-M-D>
const RPT_BASE_EVKEY_RE = /^(.+)_(\d{4}-\d{1,2}-\d{1,2})$/;

// ----- 模組層狀態：目前排行榜資料（供文字過濾即時重繪用）＋展開中的列 -----
let rptGroupRows = [];
let rptExpandedKeys = new Set();

// ===================================================================
// 純聚合函式（不碰 DOM，方便用 node 直接驗證邏輯）
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
    const sources = RPT_SOURCE_DEFS.map(s => ({
      key: s.key,
      label: s.label,
      count: ((stats[evKey + '_src_' + s.key] || {}).clicks) || 0
    }));
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

// 點擊來源總覽：七種來源各自的全站總點擊（跨所有 evKey 加總）
function rptComputeSourceOverview(stats) {
  stats = stats || {};
  return RPT_SOURCE_DEFS.map(s => {
    const suffix = '_src_' + s.key;
    let total = 0;
    Object.keys(stats).forEach(k => {
      if (k.indexOf('page_') === 0 || k.indexOf('block_') === 0) return;
      if (k.length > suffix.length && k.slice(-suffix.length) === suffix) {
        total += ((stats[k] || {}).clicks) || 0;
      }
    });
    return { key: s.key, label: s.label, total };
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
// DOM 渲染（呼叫上面的純函式取數字，再組 HTML）
// ===================================================================

function rptCardHtml(label, value) {
  return '<div class="rpt-card"><div class="rpt-card-label">' + escHtml(label) +
    '</div><div class="rpt-card-value">' + value + '</div></div>';
}

function rptRenderOverview(stats) {
  const el = document.getElementById('rptOverviewCards');
  if (!el) return;
  const o = rptComputeOverview(stats);
  el.innerHTML =
    rptCardHtml('今日頁面瀏覽', o.todayViews) +
    rptCardHtml('近7日頁面瀏覽', o.sevenViews) +
    rptCardHtml('近30日頁面瀏覽', o.thirtyViews) +
    rptCardHtml('全站累計點擊', o.totalClicks);
}

function rptRenderPageViewsTable(stats) {
  const el = document.getElementById('rptPageViewsTable');
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

function rptRenderSourceTable(stats) {
  const el = document.getElementById('rptSourceTable');
  if (!el) return;
  const rows = rptComputeSourceOverview(stats);
  const hasAny = rows.some(r => r.total > 0);
  if (!hasAny) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>來源</th><th>總點擊</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + escHtml(r.label) + '</td><td>' + r.total + '</td></tr>'; });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptRenderBlockTable(stats) {
  const el = document.getElementById('rptBlockTable');
  if (!el) return;
  const rows = rptComputeBlockStats(stats, (typeof customBlocks !== 'undefined') ? customBlocks : []);
  if (!rows.length) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }
  let html = '<table class="rpt-table"><thead><tr><th>區塊名稱</th><th>點擊數</th></tr></thead><tbody>';
  rows.forEach(r => { html += '<tr><td>' + escHtml(r.name) + '</td><td>' + r.clicks + '</td></tr>'; });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function rptFormatDatePart(datePart) {
  return datePart ? datePart.replace(/-/g, '/') : '—';
}

function rptRenderGroupRankTable() {
  const el = document.getElementById('rptGroupRankTable');
  if (!el) return;

  if (!rptGroupRows.length) { el.innerHTML = '<div class="rpt-empty">尚無資料</div>'; return; }

  const filterInput = document.getElementById('rptGroupFilterInput');
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
      html += '<tr class="rpt-detail-row"><td colspan="8"><div class="rpt-detail-tags">' +
        (tagsHtml || '（無來源拆解資料）') + '</div></td></tr>';
    }
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// 分頁切換進入「報表統計」時由 admin.js 的 switchView() 呼叫
function renderReportView() {
  const stats = (typeof statsMap !== 'undefined' && statsMap) ? statsMap : {};
  const events = (typeof allEvents !== 'undefined' && Array.isArray(allEvents)) ? allEvents : [];

  rptRenderOverview(stats);
  rptRenderPageViewsTable(stats);
  rptGroupRows = rptComputeGroupRanking(stats, events);
  rptRenderGroupRankTable();
  rptRenderSourceTable(stats);
  rptRenderBlockTable(stats);
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
        renderReportView();
        if (typeof setFormStatus === 'function') {
          setFormStatus('rptRefreshStatus', '已更新 · ' + new Date().toLocaleTimeString('zh-TW'), '');
        }
      } catch (err) {
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
})();
