// ===================================================================
// signdocs.js — 文件電子簽署（帳務頁子分頁「文件簽署」，權限 expenseEdit）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 expenses.js）。
// 理由：admin.js 開機還原分頁時可能同步呼叫 acctSwitchTab('signdocs') → loadSigndocsView()，
// 本檔排在後面的話，開機當下函式還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 掛載」，不直接呼叫 admin.js 內部函式；
// 跟 admin.js 共用的只有全域 currentToken 與共用 DOM。
//
// 規格正本：dondon-platform/docs/19-doc-signing.md
// 後端：POST/GET https://dondon-platform.vercel.app/api/signdocs
// PDF 渲染用 vendor/pdfjs.min.js、合成用 vendor/pdf-lib.min.js（沿用 contractSign.js 的動態載入做法）
// ===================================================================

const SD_API_URL = 'https://dondon-platform.vercel.app/api/signdocs';
const SD_PDF_MAX_BYTES = 20 * 1024 * 1024;
const SD_COLORS = ['#C4546B', '#3F8F7B', '#4F7FC4', '#C98A2B', '#8A5CB8', '#2F9AA8', '#B5693E', '#6B7F3A'];
const SD_STATUS = {
  draft: ['草稿', ''], sending: ['簽署中', 'sd-st-sending'], signed: ['已全員簽署', 'sd-st-signed'],
  completed: ['已完成', 'sd-st-done'], voided: ['已作廢', 'sd-st-void']
};

let SD_LOADED = false;
let SD_TABLE_READY = true;
let SD_LIST = [];
let SD_TRIPS = [];
let SD_CUR = null;            // 目前開啟詳情的文件 id；null＝清單
let SD_ED = null;             // 編輯器狀態（見 sdOpenDetail）
let SD_LINKS = {};            // signerId → url（原始連結只在送出／重新產生時回一次，只存在記憶體）
let SD_LIBS_PROMISE = null;
let SD_BUSY = false;

// ===== 小工具 =====
function sdEsc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sdIsOk(res) { return !!res && (res.ok === true || res.success === true); }
function sdFmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
}
function sdFmtDt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function sdFindDoc(id) { return SD_LIST.find(d => d.id === id) || null; }
function sdSignedCount(doc) { return (doc.signers || []).filter(s => s.status === 'signed').length; }
function sdUaSummary(ua) {
  ua = String(ua || '');
  if (!ua) return '';
  let os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  let br = /Line\//.test(ua) ? 'LINE' : /Instagram/.test(ua) ? 'Instagram' : /Edg\//.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' / ') || ua.slice(0, 40);
}

const SD_ICON = {
  sign: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4.2L16.5 4.3a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.2 19z"/><path d="M14.5 6.3l3.2 3.2"/><path d="M13 20.5h7"/></svg>',
  plus: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  refresh: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.6"/><path d="M20 4v4.6h-4.6"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.4"/><path d="M4 20v-4.6h4.6"/></svg>',
  back: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  warn: '<svg class="sd-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.3h.01"/></svg>',
  x: '<svg class="sd-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
  copy: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
  share: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 4L10.5 14"/><path d="M20.5 4l-6.2 16.5-3.8-6.5L4 10.2z"/></svg>',
  clip: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5l-7.6 7.6a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2a3 3 0 0 1 4.2 4.2l-8.2 8.2a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3"/></svg>',
  down: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></svg>'
};

function sdForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API（後端可能還沒部署：統一丟 Error，由呼叫端顯示橫幅）=====
async function sdApiGet() {
  const res = await fetch(SD_API_URL + '?token=' + encodeURIComponent(currentToken || ''), { cache: 'no-store' });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('後端回應格式不對（HTTP ' + res.status + '），可能還沒部署'); }
  if (data && data.needLogin) { sdForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}
async function sdApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(SD_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('後端回應格式不對（HTTP ' + res.status + '）'); }
  if (data && data.needLogin) { sdForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}
async function sdCall(type, extra) {
  const res = await sdApiPost(type, extra);
  if (!sdIsOk(res)) throw new Error((res && res.error) || '操作失敗');
  return res;
}

// ===== PDF 函式庫（沿用 contractSign.js 的 csEnsureLibs；沒載入時用同一套 vendor 路徑自載）=====
function sdEnsureLibs() {
  if (typeof PDFLib !== 'undefined' && typeof pdfjsLib !== 'undefined') {
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs.worker.min.js';
    return Promise.resolve();
  }
  if (typeof csEnsureLibs === 'function') return csEnsureLibs();
  if (SD_LIBS_PROMISE) return SD_LIBS_PROMISE;
  const load = src => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' 載入失敗'));
    document.head.appendChild(s);
  });
  SD_LIBS_PROMISE = Promise.all([
    typeof pdfjsLib !== 'undefined' ? Promise.resolve() : load('vendor/pdfjs.min.js'),
    typeof PDFLib !== 'undefined' ? Promise.resolve() : load('vendor/pdf-lib.min.js')
  ]).then(() => {
    if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs.worker.min.js';
  }).catch(err => { SD_LIBS_PROMISE = null; throw err; });
  return SD_LIBS_PROMISE;
}

// ===== 樣式（藕粉奶茶規則：輸入框白底＋#E6DCD2、聚焦 #C99A9B、表格線 --c-line、✕ 灰色）=====
function sdInjectStyle() {
  if (document.getElementById('sdStyle')) return;
  const st = document.createElement('style');
  st.id = 'sdStyle';
  st.textContent = `
  .sd-ic{ width:15px; height:15px; vertical-align:-3px; flex:none; }
  .sd-banner{ background:#F5EFE9; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:10px; font-size:13px; line-height:1.7; }
  .sd-toolbar{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; align-items:center; }
  .sd-h{ font-size:13.5px; font-weight:800; color:var(--c-text-soft); margin:14px 0 8px; }
  .sd-empty{ text-align:center; color:var(--c-text-soft); font-size:13.5px; padding:22px 8px; }
  .sd-row{ display:grid; grid-template-columns:1fr auto; gap:4px 12px; padding:11px 6px; border-bottom:1px solid var(--c-line); cursor:pointer; align-items:start; }
  .sd-row:hover{ background:var(--c-surface); }
  .sd-r-l{ min-width:0; }
  .sd-r-t{ font-weight:800; font-size:14.5px; color:var(--c-text); word-break:break-all; }
  .sd-r-m{ font-size:12.5px; color:var(--c-text-soft); margin-top:3px; line-height:1.6; word-break:break-all; }
  .sd-r-r{ text-align:right; font-size:12.5px; color:var(--c-text-soft); white-space:nowrap; }
  .sd-pill{ display:inline-block; font-size:11.5px; font-weight:800; padding:2px 9px; border-radius:999px; background:var(--c-surface); color:var(--c-text-soft); }
  .sd-pill.sd-st-sending{ background:#F3E9D8; color:#8B6E3E; }
  .sd-pill.sd-st-signed{ background:#E3EEE6; color:#4C7A5C; }
  .sd-pill.sd-st-done{ background:#E3EEE6; color:#3F6B50; }
  .sd-pill.sd-st-void{ background:#F3E3E1; color:#B5485A; }
  .sd-pill.sd-sg-ok{ background:#E3EEE6; color:#4C7A5C; }
  .sd-input, .sd-modal select, .sd-modal textarea, .sd-modal input[type=text], .sd-detail select, .sd-detail textarea, .sd-detail input[type=text], .sd-detail input[type=url]{
    font:inherit; font-size:14px; padding:8px 10px; border-radius:10px; width:100%;
    background:#fff; border:1px solid #E6DCD2; color:var(--c-text); box-sizing:border-box; max-width:100%;
  }
  .sd-input:focus, .sd-modal select:focus, .sd-modal textarea:focus, .sd-modal input[type=text]:focus,
  .sd-detail select:focus, .sd-detail textarea:focus, .sd-detail input[type=text]:focus, .sd-detail input[type=url]:focus{ outline:none; border-color:#C99A9B; }
  .sd-lb{ display:block; font-size:12.5px; font-weight:800; color:var(--c-text-soft); margin:12px 0 4px; }
  .sd-modal .modal-box{ width:min(520px, 94vw); }
  .sd-modal .modal-close{ color:var(--c-muted); }
  .sd-modal .modal-close:hover{ color:var(--c-brown); }
  .sd-actions{ display:flex; gap:8px; align-items:center; margin-top:16px; flex-wrap:wrap; }
  .sd-detail-head{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:10px; }
  .sd-detail-title{ font-size:16px; font-weight:800; color:var(--c-text); word-break:break-all; min-width:0; }
  .sd-meta-grid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
  .sd-meta-grid > *{ min-width:0; }
  .sd-meta-full{ grid-column:1 / 3; }
  .sd-readonly{ font-size:14px; color:var(--c-text); word-break:break-all; padding:4px 0; }
  /* 簽署人 */
  .sd-signers{ margin-top:8px; }
  .sd-signer{ display:grid; grid-template-columns:auto 1fr 1fr auto; gap:8px; align-items:center; padding:8px 6px; border-bottom:1px solid var(--c-line); border-radius:8px; }
  .sd-signer.sel{ background:var(--c-surface); }
  .sd-dot{ width:16px; height:16px; border-radius:50%; flex:none; cursor:pointer; box-shadow:0 0 0 2px transparent; }
  .sd-signer.sel .sd-dot{ box-shadow:0 0 0 2px #fff, 0 0 0 4px currentColor; }
  .sd-sg-fields{ grid-column:2 / 5; font-size:12px; color:var(--c-text-soft); }
  .sd-x{ width:26px; height:26px; border:none; border-radius:50%; background:transparent; color:var(--c-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
  .sd-x:hover{ color:var(--c-brown); }
  .sd-hint{ font-size:12.5px; color:var(--c-text-soft); line-height:1.7; margin:6px 0; }
  /* PDF 頁面與簽名框 */
  .sd-pages{ margin-top:10px; display:flex; flex-direction:column; gap:12px; align-items:center; width:100%; }
  .sd-page{ position:relative; width:100%; max-width:860px; background:#fff; border-radius:6px; box-shadow:0 1px 6px rgba(90,74,63,.18); overflow:hidden; user-select:none; -webkit-user-select:none; }
  .sd-page canvas{ display:block; width:100%; height:auto; }
  .sd-page.draw{ cursor:crosshair; }
  .sd-pageno{ position:absolute; left:6px; top:6px; font-size:11px; background:rgba(255,255,255,.85); color:var(--c-text-soft); padding:1px 7px; border-radius:999px; pointer-events:none; }
  .sd-box{ position:absolute; box-sizing:border-box; border:2px solid; border-radius:6px; touch-action:none; cursor:move; }
  .sd-box.ro{ cursor:default; }
  .sd-box-lb{ position:absolute; left:3px; top:1px; right:22px; font-size:11px; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }
  .sd-box-del{ position:absolute; right:0; top:0; width:22px; height:22px; border:none; background:transparent; color:var(--c-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
  .sd-box-del:hover{ color:var(--c-brown); }
  .sd-box-del .sd-ic{ width:12px; height:12px; vertical-align:0; }
  .sd-box-rz{ position:absolute; right:-1px; bottom:-1px; width:18px; height:18px; cursor:nwse-resize; touch-action:none; background:linear-gradient(135deg, transparent 50%, currentColor 50%); border-bottom-right-radius:5px; opacity:.8; }
  .sd-box.signed::after{ content:''; position:absolute; inset:0; background:repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,.5) 6px 12px); pointer-events:none; }
  /* 連結列 */
  .sd-link-row{ display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-top:6px; }
  .sd-link-row input{ flex:1 1 220px; min-width:0; font-size:12.5px !important; }
  .sd-sg-row{ padding:10px 6px; border-bottom:1px solid var(--c-line); }
  .sd-sg-top{ display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; }
  .sd-sg-name{ font-weight:800; font-size:14px; color:var(--c-text); word-break:break-all; }
  .sd-sg-sub{ font-size:12px; color:var(--c-text-soft); }
  .sd-progress{ font-size:13px; font-weight:800; color:var(--c-text-soft); }
  .sd-status{ font-size:13px; margin-top:8px; min-height:18px; color:var(--c-text-soft); }
  .sd-status.error{ color:#B5485A; }
  @media (max-width:560px){
    .sd-meta-grid{ grid-template-columns:1fr; }
    .sd-meta-full{ grid-column:1; }
    .sd-signer{ grid-template-columns:auto 1fr auto; }
    .sd-signer .sd-role{ grid-column:2 / 3; }
    .sd-sg-fields{ grid-column:2 / 4; }
  }
  @media (min-width:720px){ .sd-row{ grid-template-columns:1fr 190px; } }
  `;
  document.head.appendChild(st);
}

// ===== 骨架 =====
function sdShowBanner(html) {
  const b = document.getElementById('sdBanner');
  if (b) b.innerHTML = html ? '<div class="sd-banner">' + SD_ICON.warn + ' ' + html + '</div>' : '';
}
function sdBuildSkeleton() {
  const pane = document.getElementById('acctPaneSigndocs');
  if (!pane || pane.dataset.built) return;
  pane.dataset.built = '1';
  pane.innerHTML =
    '<div id="sdBanner"></div>' +
    '<div id="sdListView">' +
      '<div class="sd-toolbar">' +
        '<button type="button" class="task-mini-btn" id="sdAddBtn">' + SD_ICON.plus + '新增文件</button>' +
        '<button type="button" class="task-mini-btn" id="sdRefreshBtn">' + SD_ICON.refresh + '重新整理</button>' +
      '</div>' +
      '<div id="sdList"></div>' +
    '</div>' +
    '<div id="sdDetailView" class="sd-detail" style="display:none;"></div>';

  const wrap = document.createElement('div');
  wrap.className = 'sd-modal';
  wrap.innerHTML =
  '<div class="modal-backdrop" id="sdNewModal" onclick="if(event.target===this) closeSdNewModal()">' +
    '<div class="modal-box">' +
      '<button class="modal-close" type="button" onclick="closeSdNewModal()">✕</button>' +
      '<h3>新增待簽文件</h3>' +
      '<label class="sd-lb" for="sdnTitle">標題 *</label><input type="text" id="sdnTitle" placeholder="例如：日本出差計畫書">' +
      '<label class="sd-lb" for="sdnNote">備註</label><textarea id="sdnNote" rows="2"></textarea>' +
      '<label class="sd-lb" for="sdnTrip">綁出差（選填）</label><select id="sdnTrip"></select>' +
      '<label class="sd-lb">PDF 檔案 *（只收 PDF，20MB 以內）</label>' +
      '<label class="task-mini-btn" for="sdnFile" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;">' + SD_ICON.clip + '選擇 PDF</label>' +
      '<input type="file" id="sdnFile" accept="application/pdf,.pdf" style="display:none;">' +
      '<div class="sd-hint" id="sdnFileName">尚未選擇檔案</div>' +
      '<div class="sd-actions"><button type="button" class="task-submit-btn" id="sdnSaveBtn" style="margin-top:0;">建立</button></div>' +
      '<div class="sd-status" id="sdnStatus"></div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrap);

  document.getElementById('sdAddBtn').addEventListener('click', openSdNewModal);
  document.getElementById('sdRefreshBtn').addEventListener('click', () => loadSigndocsView(true));
  document.getElementById('sdnFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    document.getElementById('sdnFileName').textContent = f ? f.name : '尚未選擇檔案';
  });
  document.getElementById('sdnSaveBtn').addEventListener('click', sdCreateDoc);
  document.getElementById('sdList').addEventListener('click', e => {
    const row = e.target.closest('.sd-row');
    if (row) sdOpenDetail(row.dataset.id);
  });
}

// ===== 載入 =====
function sdTripOptions(sel, withBlank) {
  return (withBlank ? '<option value="">不綁出差</option>' : '') +
    SD_TRIPS.map(t => '<option value="' + sdEsc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + sdEsc(t.title) + '</option>').join('');
}
function loadSigndocsView(forceReload) {
  sdInjectStyle();
  sdBuildSkeleton();
  if (SD_LOADED && !forceReload) { sdRenderCurrent(); return; }
  return sdReload();
}
function sdReload() {
  const listEl = document.getElementById('sdList');
  if (!listEl) return Promise.resolve();
  if (!SD_CUR) listEl.innerHTML = '<div class="sd-empty">讀取中…</div>';
  sdShowBanner('');
  return sdApiGet().then(data => {
    if (!sdIsOk(data)) {
      SD_LOADED = false;
      listEl.innerHTML = '';
      sdShowBanner('讀取失敗：' + sdEsc((data && data.error) || '未知錯誤'));
      return;
    }
    SD_LOADED = true;
    SD_TABLE_READY = data.tableReady !== false;
    SD_LIST = Array.isArray(data.documents) ? data.documents : [];
    SD_TRIPS = Array.isArray(data.tripChoices) ? data.tripChoices : [];
    if (!SD_TABLE_READY) sdShowBanner('文件簽署功能待 db push（資料表尚未建立），建好之後才能新增。');
    sdRenderCurrent();
  }).catch(err => {
    SD_LOADED = false;
    listEl.innerHTML = '';
    sdShowBanner('文件簽署暫時連不上後端：' + sdEsc(err.message || '') + '。請稍後按「重新整理」。');
  });
}
function sdRenderCurrent() {
  if (SD_CUR && sdFindDoc(SD_CUR)) { sdRenderDetail(); return; }
  SD_CUR = null; SD_ED = null;
  document.getElementById('sdListView').style.display = '';
  document.getElementById('sdDetailView').style.display = 'none';
  sdRenderList();
}
function sdRenderList() {
  const el = document.getElementById('sdList');
  if (!el) return;
  if (!SD_LIST.length) {
    el.innerHTML = '<div class="sd-empty">' + (SD_TABLE_READY ? '還沒有文件。按「新增文件」上傳要簽的 PDF。' : '') + '</div>';
    return;
  }
  el.innerHTML = SD_LIST.map(d => {
    const st = SD_STATUS[d.status] || [d.status, ''];
    const total = (d.signers || []).length;
    return '<div class="sd-row" data-id="' + sdEsc(d.id) + '" tabindex="0" role="button">' +
      '<div class="sd-r-l">' +
        '<div class="sd-r-t">' + sdEsc(d.title) + '</div>' +
        '<div class="sd-r-m">' + (d.tripTitle ? '出差：' + sdEsc(d.tripTitle) : '未綁出差') + '</div>' +
      '</div>' +
      '<div class="sd-r-r"><span class="sd-pill ' + st[1] + '">' + st[0] + '</span><br>' +
        '簽署 ' + sdSignedCount(d) + '/' + total + '<br>' + sdFmtDate(d.createdAt) + '</div>' +
    '</div>';
  }).join('');
}

// ===== 新增文件 =====
function openSdNewModal() {
  if (!SD_TABLE_READY) { alert('文件簽署功能待 db push，資料表建立後才能新增。'); return; }
  document.getElementById('sdnTitle').value = '';
  document.getElementById('sdnNote').value = '';
  document.getElementById('sdnTrip').innerHTML = sdTripOptions('', true);
  document.getElementById('sdnFile').value = '';
  document.getElementById('sdnFileName').textContent = '尚未選擇檔案';
  const st = document.getElementById('sdnStatus'); st.textContent = ''; st.className = 'sd-status';
  document.getElementById('sdnSaveBtn').disabled = false;
  document.getElementById('sdNewModal').classList.add('show');
}
function closeSdNewModal() { document.getElementById('sdNewModal').classList.remove('show'); }

async function sdUploadSource(docId, file) {
  if (!(/\.pdf$/i.test(file.name) || file.type === 'application/pdf')) throw new Error('只能上傳 PDF');
  if (file.size > SD_PDF_MAX_BYTES) throw new Error('檔案超過 20MB');
  const init = await sdCall('signdoc-source-upload-url', { id: docId });
  const srcPath = init.path;
  const put = await fetch(init.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
  if (!put.ok) throw new Error('上傳失敗（' + put.status + '）');
  const done = await sdCall('signdoc-source-commit', { id: docId, path: srcPath });
  return done.document;
}
async function sdCreateDoc() {
  const st = document.getElementById('sdnStatus');
  const btn = document.getElementById('sdnSaveBtn');
  const title = document.getElementById('sdnTitle').value.trim();
  const file = document.getElementById('sdnFile').files[0];
  const fail = m => { st.textContent = m; st.className = 'sd-status error'; };
  if (!title) return fail('請填標題');
  if (!file) return fail('請選擇 PDF 檔案');
  btn.disabled = true; st.className = 'sd-status'; st.textContent = '建立中…';
  let created = null;
  try {
    const tripId = document.getElementById('sdnTrip').value || null;
    const res = await sdCall('signdoc-create', { title, note: document.getElementById('sdnNote').value.trim(), tripId });
    created = res.document;
    st.textContent = '上傳 PDF 中…';
    await sdUploadSource(created.id, file);
    closeSdNewModal();
    SD_CUR = created.id;
    await sdReload();
    sdOpenDetail(created.id);
  } catch (err) {
    fail((created ? '文件已建立，但 PDF 處理失敗：' : '') + err.message + (created ? '（可到清單開啟該文件重新上傳）' : ''));
    if (created) { SD_LOADED = false; sdReload(); }
  }
  btn.disabled = false;
}

// ===== 詳情／編輯器 =====
function sdOpenDetail(id) {
  const doc = sdFindDoc(id);
  if (!doc) return;
  SD_CUR = id;
  // 編輯器狀態：signers 帶顏色與暫時 key；fields 為 0–1 比例
  SD_ED = {
    docId: id,
    sel: 0,
    keySeq: 0,
    pages: [],
    pageCount: doc.pageCount || 0,
    renderToken: 0,
    signers: (doc.signers || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((s, i) => ({
      id: s.id, key: 'k' + (i + 1), name: s.name || '', role: s.role || '',
      fields: (s.fields || []).map(f => ({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }))
    }))
  };
  SD_ED.keySeq = SD_ED.signers.length;
  sdRenderDetail();
}
function sdBackToList() {
  SD_CUR = null; SD_ED = null;
  sdRenderCurrent();
}
function sdColorOf(i) { return SD_COLORS[i % SD_COLORS.length]; }
function sdSetStatus(msg, isErr) {
  const el = document.getElementById('sdDetailStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'sd-status' + (isErr ? ' error' : '');
}

function sdRenderDetail() {
  const doc = sdFindDoc(SD_CUR);
  if (!doc) { sdBackToList(); return; }
  if (!SD_ED || SD_ED.docId !== doc.id) { sdOpenDetail(doc.id); return; }
  const view = document.getElementById('sdDetailView');
  document.getElementById('sdListView').style.display = 'none';
  view.style.display = '';
  const st = SD_STATUS[doc.status] || [doc.status, ''];
  const draft = doc.status === 'draft';
  const total = (doc.signers || []).length;
  let html =
    '<div class="sd-detail-head">' +
      '<button type="button" class="task-mini-btn" id="sdBackBtn">' + SD_ICON.back + '返回清單</button>' +
      '<span class="sd-detail-title">' + sdEsc(doc.title) + '</span>' +
      '<span class="sd-pill ' + st[1] + '">' + st[0] + '</span>' +
      '<span class="sd-progress">簽署 ' + sdSignedCount(doc) + '/' + total + '</span>' +
    '</div>';

  // 基本資料
  if (draft) {
    html +=
      '<div class="sd-meta-grid">' +
        '<div><label class="sd-lb" for="sdTitle">標題 *</label><input type="text" id="sdTitle" value="' + sdEsc(doc.title) + '"></div>' +
        '<div><label class="sd-lb" for="sdTrip">綁出差</label><select id="sdTrip">' + sdTripOptions(doc.tripId || '', true) + '</select></div>' +
        '<div class="sd-meta-full"><label class="sd-lb" for="sdNote">備註</label><textarea id="sdNote" rows="2">' + sdEsc(doc.note || '') + '</textarea></div>' +
      '</div>' +
      '<div class="sd-toolbar" style="margin-top:10px;">' +
        '<label class="task-mini-btn" for="sdReplaceFile" style="cursor:pointer; display:inline-flex; align-items:center; gap:6px;">' + SD_ICON.clip + (doc.hasSource ? '更換 PDF' : '上傳 PDF') + '</label>' +
        '<input type="file" id="sdReplaceFile" accept="application/pdf,.pdf" style="display:none;">' +
        '<span class="sd-hint" style="margin:0;">' + (doc.hasSource ? '共 ' + (doc.pageCount || '?') + ' 頁' : '尚未上傳 PDF') + '</span>' +
      '</div>';
  } else {
    html +=
      '<div class="sd-meta-grid">' +
        '<div><div class="sd-lb">綁定出差</div><div class="sd-readonly">' + (doc.tripTitle ? sdEsc(doc.tripTitle) : '未綁') + '</div></div>' +
        '<div><div class="sd-lb">建立日／送出日</div><div class="sd-readonly">' + sdFmtDate(doc.createdAt) + (doc.sentAt ? '／' + sdFmtDt(doc.sentAt) : '') + '</div></div>' +
        (doc.note ? '<div class="sd-meta-full"><div class="sd-lb">備註</div><div class="sd-readonly">' + sdEsc(doc.note) + '</div></div>' : '') +
      '</div>';
  }

  // 簽署人
  if (draft) {
    html += '<div class="sd-h">簽署人</div>' +
      '<div class="sd-hint">點選一位簽署人後，在下方 PDF 頁面上按住滑鼠拖曳畫出簽名框（手機請按「在目前頁面加簽名框」再拖曳／縮放）。每人至少一個框，可多處。座標以頁面比例儲存。</div>' +
      '<div class="sd-signers" id="sdSigners"></div>' +
      '<div class="sd-toolbar" style="margin-top:8px;">' +
        '<button type="button" class="task-mini-btn" id="sdAddSignerBtn">' + SD_ICON.plus + '新增簽署人</button>' +
        '<button type="button" class="task-mini-btn" id="sdAddBoxBtn">' + SD_ICON.plus + '在目前頁面加簽名框</button>' +
      '</div>';
  } else {
    html += '<div class="sd-h">簽署進度</div><div id="sdSignerRows"></div>';
  }

  // 動作
  html += '<div class="sd-actions" id="sdActions"></div><div class="sd-status" id="sdDetailStatus"></div>';
  // PDF
  html += '<div class="sd-h">文件內容</div><div class="sd-pages" id="sdPages"><div class="sd-empty">載入 PDF 中…</div></div>';
  view.innerHTML = html;

  document.getElementById('sdBackBtn').addEventListener('click', sdBackToList);
  sdRenderActions(doc);
  if (draft) {
    sdRenderSignerList();
    document.getElementById('sdAddSignerBtn').addEventListener('click', sdAddSigner);
    document.getElementById('sdAddBoxBtn').addEventListener('click', sdAddBoxToVisiblePage);
    document.getElementById('sdReplaceFile').addEventListener('change', sdReplaceSource);
  } else {
    sdRenderSignerRows(doc);
  }
  if (doc.hasSource) sdLoadAndRenderPdf(doc);
  else document.getElementById('sdPages').innerHTML = '<div class="sd-empty">尚未上傳 PDF</div>';
}

// --- 簽署人（草稿）---
function sdRenderSignerList() {
  const el = document.getElementById('sdSigners');
  if (!el || !SD_ED) return;
  el.innerHTML = SD_ED.signers.map((s, i) => {
    const c = sdColorOf(i);
    return '<div class="sd-signer' + (i === SD_ED.sel ? ' sel' : '') + '" data-i="' + i + '" style="color:' + c + ';">' +
      '<span class="sd-dot" data-sel="' + i + '" style="background:' + c + ';" title="選取這位簽署人"></span>' +
      '<input type="text" class="sd-name" data-i="' + i + '" value="' + sdEsc(s.name) + '" placeholder="姓名 *" aria-label="姓名" style="color:var(--c-text);">' +
      '<input type="text" class="sd-role" data-i="' + i + '" value="' + sdEsc(s.role) + '" placeholder="角色（例如：家長）" aria-label="角色" style="color:var(--c-text);">' +
      '<button type="button" class="sd-x" data-rm="' + i + '" aria-label="刪除簽署人" title="刪除簽署人">' + SD_ICON.x + '</button>' +
      '<div class="sd-sg-fields">簽名框 ' + s.fields.length + ' 處' + (s.fields.length ? '' : '（尚未畫框）') + '</div>' +
    '</div>';
  }).join('') || '<div class="sd-empty">尚未新增簽署人</div>';
  el.querySelectorAll('.sd-signer').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('input') || e.target.closest('.sd-x')) return;
      SD_ED.sel = Number(row.dataset.i); sdRenderSignerList(); sdRenderBoxes();
    });
  });
  el.querySelectorAll('input.sd-name, input.sd-role').forEach(inp => {
    inp.addEventListener('focus', () => {
      const i = Number(inp.dataset.i);
      if (SD_ED.sel !== i) { SD_ED.sel = i; el.querySelectorAll('.sd-signer').forEach(r => r.classList.toggle('sel', Number(r.dataset.i) === i)); sdRenderBoxes(); }
    });
    inp.addEventListener('input', () => {
      const s = SD_ED.signers[Number(inp.dataset.i)];
      if (inp.classList.contains('sd-name')) s.name = inp.value; else s.role = inp.value;
      sdRenderBoxes();
    });
  });
  el.querySelectorAll('.sd-x').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const i = Number(b.dataset.rm);
    const s = SD_ED.signers[i];
    if (s.fields.length && !confirm('刪除簽署人「' + (s.name || '未命名') + '」和他的 ' + s.fields.length + ' 個簽名框？')) return;
    SD_ED.signers.splice(i, 1);
    if (SD_ED.sel >= SD_ED.signers.length) SD_ED.sel = Math.max(0, SD_ED.signers.length - 1);
    sdRenderSignerList(); sdRenderBoxes();
  }));
}
function sdAddSigner() {
  SD_ED.signers.push({ id: null, key: 'k' + (++SD_ED.keySeq), name: '', role: '', fields: [] });
  SD_ED.sel = SD_ED.signers.length - 1;
  sdRenderSignerList(); sdRenderBoxes();
  const inp = document.querySelector('#sdSigners .sd-signer.sel input.sd-name');
  if (inp) inp.focus();
}

// --- PDF 渲染 ---
async function sdFetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下載檔案失敗（' + r.status + '）');
  return new Uint8Array(await r.arrayBuffer());
}
async function sdLoadAndRenderPdf(doc) {
  const box = document.getElementById('sdPages');
  const token = ++SD_ED.renderToken;
  try {
    await sdEnsureLibs();
    const u = await sdCall('signdoc-file-url', { id: doc.id, which: 'source' });
    const bytes = await sdFetchBytes(u.url);
    if (!SD_ED || token !== SD_ED.renderToken) return;
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (!SD_ED || token !== SD_ED.renderToken) return;
    box.innerHTML = '';
    SD_ED.pages = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const targetW = Math.min(860, Math.max(320, box.clientWidth || 860));
      const vp = page.getViewport({ scale: (targetW * dpr) / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (!SD_ED || token !== SD_ED.renderToken) return;
      const el = document.createElement('div');
      el.className = 'sd-page';
      el.dataset.page = String(p - 1);
      el.appendChild(canvas);
      const no = document.createElement('div');
      no.className = 'sd-pageno'; no.textContent = '第 ' + p + ' 頁';
      el.appendChild(no);
      box.appendChild(el);
      SD_ED.pages.push({ el });
    }
    SD_ED.pageCount = pdf.numPages;
    if (doc.status === 'draft') sdBindDraw();
    sdRenderBoxes();
  } catch (err) {
    box.innerHTML = '<div class="sd-empty">PDF 載入失敗：' + sdEsc(err.message || '') + '</div>';
  }
}

// --- 簽名框 ---
function sdRound(n) { return Math.round(n * 10000) / 10000; }
function sdClampField(f) {
  f.w = Math.min(1, Math.max(0.02, f.w)); f.h = Math.min(1, Math.max(0.01, f.h));
  f.x = Math.min(1 - f.w, Math.max(0, f.x)); f.y = Math.min(1 - f.h, Math.max(0, f.y));
  f.x = sdRound(f.x); f.y = sdRound(f.y);
  f.w = sdRound(Math.min(f.w, 1 - f.x)); f.h = sdRound(Math.min(f.h, 1 - f.y));
}
function sdRenderBoxes() {
  if (!SD_ED) return;
  const doc = sdFindDoc(SD_ED.docId);
  const draft = doc && doc.status === 'draft';
  SD_ED.pages.forEach(pg => pg.el.querySelectorAll('.sd-box').forEach(b => b.remove()));
  SD_ED.signers.forEach((s, si) => {
    const c = sdColorOf(si);
    const dsigner = doc && doc.signers ? doc.signers.find(x => x.id === s.id) : null;
    const done = dsigner && dsigner.status === 'signed';
    s.fields.forEach((f, fi) => {
      const pg = SD_ED.pages[f.page];
      if (!pg) return;
      const b = document.createElement('div');
      b.className = 'sd-box' + (draft ? '' : ' ro') + (done ? ' signed' : '');
      b.style.cssText = 'left:' + f.x * 100 + '%;top:' + f.y * 100 + '%;width:' + f.w * 100 + '%;height:' + f.h * 100 + '%;border-color:' + c + ';background:' + c + '26;color:' + c + ';' +
        (draft && si !== SD_ED.sel ? 'opacity:.75;' : '');
      b.dataset.si = String(si); b.dataset.fi = String(fi);
      b.innerHTML = '<span class="sd-box-lb">' + sdEsc(s.name || '（未命名）') + (s.role ? '・' + sdEsc(s.role) : '') + (done ? '（已簽）' : '') + '</span>' +
        (draft ? '<button type="button" class="sd-box-del" aria-label="刪除簽名框">' + SD_ICON.x + '</button><div class="sd-box-rz"></div>' : '');
      pg.el.appendChild(b);
      if (draft) sdBindBox(b, pg.el);
    });
  });
  if (draft) sdUpdateFieldCounts();
}
function sdUpdateFieldCounts() {
  document.querySelectorAll('#sdSigners .sd-signer').forEach(row => {
    const s = SD_ED.signers[Number(row.dataset.i)];
    const el = row.querySelector('.sd-sg-fields');
    if (s && el) el.textContent = '簽名框 ' + s.fields.length + ' 處' + (s.fields.length ? '' : '（尚未畫框）');
  });
}
function sdBindBox(b, pageEl) {
  const si = Number(b.dataset.si), fi = Number(b.dataset.fi);
  const field = () => SD_ED.signers[si] && SD_ED.signers[si].fields[fi];
  const del = b.querySelector('.sd-box-del');
  del.addEventListener('pointerdown', e => e.stopPropagation());
  del.addEventListener('click', e => {
    e.stopPropagation();
    SD_ED.signers[si].fields.splice(fi, 1);
    sdRenderBoxes();
  });
  function startDrag(e, mode) {
    e.preventDefault(); e.stopPropagation();
    if (SD_ED.sel !== si) { SD_ED.sel = si; sdRenderSignerList(); }
    const f = field(); if (!f) return;
    const rect = pageEl.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const orig = { x: f.x, y: f.y, w: f.w, h: f.h };
    try { e.target.setPointerCapture(e.pointerId); } catch (x) {}
    const target = e.target;
    function move(ev) {
      const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
      if (mode === 'move') { f.x = orig.x + dx; f.y = orig.y + dy; f.w = orig.w; f.h = orig.h; }
      else { f.x = orig.x; f.y = orig.y; f.w = orig.w + dx; f.h = orig.h + dy; }
      sdClampField(f);
      b.style.left = f.x * 100 + '%'; b.style.top = f.y * 100 + '%';
      b.style.width = f.w * 100 + '%'; b.style.height = f.h * 100 + '%';
    }
    function up() {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      sdRenderBoxes();
    }
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }
  b.addEventListener('pointerdown', e => {
    if (e.target.closest('.sd-box-del')) return;
    startDrag(e, e.target.classList.contains('sd-box-rz') ? 'resize' : 'move');
  });
}
// 滑鼠在頁面空白處拖曳畫框（觸控裝置請用「在目前頁面加簽名框」，避免擋住捲動）
function sdBindDraw() {
  SD_ED.pages.forEach((pg, pageIdx) => {
    pg.el.classList.add('draw');
    pg.el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (e.target.closest('.sd-box')) return;
      const s = SD_ED.signers[SD_ED.sel];
      if (!s) { sdSetStatus('請先新增並選取一位簽署人，再畫簽名框', true); return; }
      e.preventDefault();
      sdSetStatus('');
      const rect = pg.el.getBoundingClientRect();
      const x0 = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y0 = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const f = { page: pageIdx, x: x0, y: y0, w: 0.001, h: 0.001 };
      const c = sdColorOf(SD_ED.sel);
      const ghost = document.createElement('div');
      ghost.className = 'sd-box';
      ghost.style.cssText = 'border-color:' + c + ';background:' + c + '26;pointer-events:none;';
      pg.el.appendChild(ghost);
      function move(ev) {
        const x1 = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const y1 = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
        f.x = Math.min(x0, x1); f.y = Math.min(y0, y1); f.w = Math.abs(x1 - x0); f.h = Math.abs(y1 - y0);
        ghost.style.left = f.x * 100 + '%'; ghost.style.top = f.y * 100 + '%';
        ghost.style.width = f.w * 100 + '%'; ghost.style.height = f.h * 100 + '%';
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ghost.remove();
        if (f.w >= 0.03 && f.h >= 0.015) {
          sdClampField(f);
          s.fields.push({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h });
        }
        sdRenderBoxes();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  });
}
function sdVisiblePageIndex() {
  const mid = window.innerHeight / 2;
  let best = 0, bestScore = -Infinity;
  SD_ED.pages.forEach((pg, i) => {
    const r = pg.el.getBoundingClientRect();
    const overlap = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    const score = overlap > 0 ? overlap : -Math.abs((r.top + r.bottom) / 2 - mid);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}
function sdAddBoxToVisiblePage() {
  if (!SD_ED || !SD_ED.pages.length) { sdSetStatus('PDF 還沒載入完成', true); return; }
  const s = SD_ED.signers[SD_ED.sel];
  if (!s) { sdSetStatus('請先新增並選取一位簽署人', true); return; }
  sdSetStatus('');
  const f = { page: sdVisiblePageIndex(), x: 0.55, y: 0.8, w: 0.3, h: 0.07 };
  sdClampField(f);
  s.fields.push(f);
  sdRenderBoxes();
}

async function sdReplaceSource(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (SD_BUSY) return;
  SD_BUSY = true;
  try {
    sdSetStatus('上傳 PDF 中…');
    const newDoc = await sdUploadSource(SD_ED.docId, file);
    // 頁數變少時，超出的框會被後端擋，這裡先在本機剔除
    const pc = newDoc && newDoc.pageCount;
    if (pc) SD_ED.signers.forEach(s => { s.fields = s.fields.filter(f => f.page < pc); });
    await sdReload();
    sdRenderDetail();
    sdSetStatus('PDF 已更新（請重新確認簽名框位置，並按「儲存」）');
  } catch (err) {
    sdSetStatus('更換失敗：' + err.message, true);
  }
  SD_BUSY = false;
}

// --- 動作列 ---
function sdRenderActions(doc) {
  const el = document.getElementById('sdActions');
  if (!el) return;
  const btn = (id, cls, label, ico) => '<button type="button" class="' + cls + '" id="' + id + '"' + (cls.indexOf('task-submit-btn') >= 0 ? ' style="margin-top:0;"' : '') + '>' + (ico || '') + label + '</button>';
  let h = '';
  if (doc.status === 'draft') {
    h += btn('sdSaveBtn', 'task-submit-btn', '儲存') + btn('sdSendBtn', 'task-mini-btn', '送出簽署', SD_ICON.share) + btn('sdVoidBtn', 'task-mini-btn', '作廢') + btn('sdDelBtn', 'task-mini-btn danger', '刪除');
  } else if (doc.status === 'sending') {
    h += btn('sdVoidBtn', 'task-mini-btn', '作廢') + btn('sdSrcBtn', 'task-mini-btn', '下載原檔', SD_ICON.down);
  } else if (doc.status === 'signed') {
    h += btn('sdCompleteBtn', 'task-submit-btn', '產生完成版 PDF') + btn('sdVoidBtn', 'task-mini-btn', '作廢') + btn('sdSrcBtn', 'task-mini-btn', '下載原檔', SD_ICON.down);
  } else if (doc.status === 'completed') {
    h += btn('sdSignedBtn', 'task-submit-btn', '下載完成版', SD_ICON.down) + btn('sdSrcBtn', 'task-mini-btn', '下載原檔', SD_ICON.down);
  } else if (doc.status === 'voided') {
    h += btn('sdSrcBtn', 'task-mini-btn', '下載原檔', SD_ICON.down) + btn('sdDelBtn', 'task-mini-btn danger', '刪除');
  }
  el.innerHTML = h;
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('sdSaveBtn', () => sdSaveDraft(true));
  on('sdSendBtn', sdSend);
  on('sdVoidBtn', sdVoid);
  on('sdDelBtn', sdDelete);
  on('sdCompleteBtn', sdComplete);
  on('sdSrcBtn', () => sdOpenFile('source'));
  on('sdSignedBtn', () => sdOpenFile('signed'));
}
async function sdOpenFile(which, signerId) {
  const w = window.open('', '_blank');
  try {
    const res = await sdCall('signdoc-file-url', { id: SD_CUR, which, signerId });
    if (w) w.location.href = res.url; else window.location.href = res.url;
  } catch (err) {
    if (w) w.close();
    alert('開啟失敗：' + err.message);
  }
}

// --- 儲存草稿 ---
function sdCollectDraft() {
  const title = document.getElementById('sdTitle').value.trim();
  const signers = SD_ED.signers.map((s, i) => {
    const o = { name: s.name.trim(), role: s.role.trim(), sort: i, fields: s.fields.map(f => ({ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h })) };
    if (s.id) o.id = s.id;
    return o;
  });
  return {
    title, note: document.getElementById('sdNote').value.trim(),
    tripId: document.getElementById('sdTrip').value || null, signers
  };
}
async function sdSaveDraft(showOk) {
  if (SD_BUSY) return false;
  const p = sdCollectDraft();
  if (!p.title) { sdSetStatus('請填標題', true); return false; }
  if (p.signers.some(s => !s.name)) { sdSetStatus('每位簽署人都要填姓名', true); return false; }
  SD_BUSY = true;
  sdSetStatus('儲存中…');
  try {
    const res = await sdCall('signdoc-update', Object.assign({ id: SD_ED.docId }, p));
    const doc = res.document;
    // 用回傳資料更新清單與簽署人 id（依 sort 對應）
    const idx = SD_LIST.findIndex(d => d.id === doc.id);
    if (idx >= 0) SD_LIST[idx] = doc;
    const sorted = (doc.signers || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
    SD_ED.signers.forEach((s, i) => { if (sorted[i]) s.id = sorted[i].id; });
    sdSetStatus(showOk ? '已儲存' : '');
    SD_BUSY = false;
    return true;
  } catch (err) {
    sdSetStatus('儲存失敗：' + err.message, true);
    SD_BUSY = false;
    return false;
  }
}

// --- 送出簽署 ---
async function sdSend() {
  if (SD_ED.signers.length < 1) { sdSetStatus('請至少新增一位簽署人', true); return; }
  const bad = SD_ED.signers.find(s => !s.fields.length);
  if (bad) { sdSetStatus('「' + (bad.name || '未命名') + '」還沒有簽名框，每位簽署人至少要畫一處', true); return; }
  if (!confirm('送出後文件會鎖定（原檔與簽名位置不能再改），並產生每位簽署人的專屬連結（7 天有效）。確定送出？')) return;
  if (!(await sdSaveDraft(false))) return;
  SD_BUSY = true;
  sdSetStatus('送出中…');
  try {
    const res = await sdCall('signdoc-send', { id: SD_ED.docId });
    SD_LINKS = {};
    (res.links || []).forEach(l => { SD_LINKS[l.signerId] = l.url; });
    const idx = SD_LIST.findIndex(d => d.id === res.document.id);
    if (idx >= 0) SD_LIST[idx] = res.document;
    SD_BUSY = false;
    sdRenderDetail();
    sdSetStatus('已送出。連結只會顯示這一次，請複製或用 LINE 傳給簽署人；之後可按「重新產生連結」。');
  } catch (err) {
    SD_BUSY = false;
    sdSetStatus('送出失敗：' + err.message, true);
  }
}

// --- 送出後的簽署人列 ---
function sdLineShareUrl(name, title, url) {
  return 'https://line.me/R/share?text=' + encodeURIComponent(name + '您好，請點連結簽署《' + title + '》：' + url);
}
function sdRenderSignerRows(doc) {
  const el = document.getElementById('sdSignerRows');
  if (!el) return;
  const rows = (doc.signers || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  el.innerHTML = rows.map(s => {
    const url = SD_LINKS[s.id];
    const signed = s.status === 'signed';
    let h = '<div class="sd-sg-row" data-id="' + sdEsc(s.id) + '">' +
      '<div class="sd-sg-top"><span class="sd-sg-name">' + sdEsc(s.name) + (s.role ? '（' + sdEsc(s.role) + '）' : '') + '</span>' +
      '<span class="sd-pill ' + (signed ? 'sd-sg-ok' : '') + '">' + (signed ? '已簽署' : '待簽署') + '</span>' +
      '<span class="sd-sg-sub">' + (signed ? '簽署時間 ' + sdFmtDt(s.signedAt) : (s.viewedAt ? '已開啟 ' + sdFmtDt(s.viewedAt) : '尚未開啟') + (s.tokenExpiresAt ? '・連結期限 ' + sdFmtDt(s.tokenExpiresAt) : '')) + '</span></div>';
    if (!signed && doc.status === 'sending') {
      if (url) {
        h += '<div class="sd-link-row"><input type="url" readonly value="' + sdEsc(url) + '" aria-label="簽署連結" onfocus="this.select()">' +
          '<button type="button" class="task-mini-btn" data-act="copy" data-id="' + sdEsc(s.id) + '">' + SD_ICON.copy + '複製</button>' +
          '<button type="button" class="task-mini-btn" data-act="line" data-id="' + sdEsc(s.id) + '">' + SD_ICON.share + 'LINE 分享</button>' +
          '<button type="button" class="task-mini-btn" data-act="relink" data-id="' + sdEsc(s.id) + '">' + SD_ICON.refresh + '重新產生連結</button></div>';
      } else {
        h += '<div class="sd-link-row"><span class="sd-sg-sub">連結只在送出時顯示一次。</span>' +
          '<button type="button" class="task-mini-btn" data-act="relink" data-id="' + sdEsc(s.id) + '">' + SD_ICON.refresh + '重新產生連結</button></div>';
      }
    }
    if (signed && (doc.status === 'signed' || doc.status === 'sending' || doc.status === 'completed')) {
      h += '<div class="sd-link-row"><button type="button" class="task-mini-btn" data-act="sigimg" data-id="' + sdEsc(s.id) + '">' + SD_ICON.down + '查看簽名圖</button></div>';
    }
    return h + '</div>';
  }).join('') || '<div class="sd-empty">沒有簽署人</div>';
  el.onclick = async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    const s = (doc.signers || []).find(x => x.id === id);
    if (!s) return;
    if (act === 'copy') { await sdCopy(SD_LINKS[id]); sdSetStatus('已複製 ' + s.name + ' 的連結'); }
    else if (act === 'line') { window.open(sdLineShareUrl(s.name, doc.title, SD_LINKS[id]), '_blank'); }
    else if (act === 'sigimg') { sdOpenFile('signature', id); }
    else if (act === 'relink') {
      if (!confirm('重新產生「' + s.name + '」的連結？舊連結會立即失效。')) return;
      try {
        const res = await sdCall('signdoc-relink', { signerId: id });
        SD_LINKS[id] = res.link.url;
        await sdReload();
        sdRenderDetail();
        sdSetStatus('已產生新連結');
      } catch (err) { sdSetStatus('重新產生失敗：' + err.message, true); }
    }
  };
}
async function sdCopy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (x) {}
    ta.remove();
  }
}

// --- 作廢／刪除 ---
async function sdVoid() {
  if (!confirm('作廢後所有簽署連結立即失效，無法恢復。確定作廢？')) return;
  try {
    await sdCall('signdoc-void', { id: SD_CUR });
    await sdReload(); sdRenderCurrent();
  } catch (err) { sdSetStatus('作廢失敗：' + err.message, true); }
}
async function sdDelete() {
  if (!confirm('刪除這份文件（含原檔）？無法復原。')) return;
  try {
    await sdCall('signdoc-delete', { id: SD_CUR });
    SD_CUR = null; SD_ED = null;
    await sdReload(); sdRenderCurrent();
  } catch (err) { sdSetStatus('刪除失敗：' + err.message, true); }
}

// ===== 產生完成版 PDF =====
function sdWrapText(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of String(text)) {
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}
function sdLoadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('簽名圖載入失敗'));
    img.src = src;
  });
}
// 簽署紀錄頁：A4 直式（595×842 pt）× 2 倍解析度，中文用 canvas 畫；回傳 PNG bytes 陣列（內容多時自動分頁）
async function sdBuildRecordPages(doc, signers, sha, completedAt) {
  const S = 2, W = 595 * S, H = 842 * S, M = 48 * S;
  const FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif';
  const pages = [];
  let canvas, ctx, y;
  function newPage() {
    canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top';
    y = M;
    pages.push(canvas);
  }
  const font = (px, bold) => (bold ? '700 ' : '400 ') + px * S + 'px ' + FONT;
  function line(text, px, opt) {
    opt = opt || {};
    ctx.font = font(px, opt.bold); ctx.fillStyle = opt.color || '#3E3430';
    const lines = sdWrapText(ctx, text, W - 2 * M - (opt.indent || 0) * S);
    lines.forEach(l => { ctx.fillText(l, M + (opt.indent || 0) * S, y); y += px * S * 1.5; });
    y += (opt.gap || 0) * S;
  }
  newPage();
  line('簽署紀錄', 22, { bold: true, gap: 6 });
  ctx.fillStyle = '#E6DCD2'; ctx.fillRect(M, y, W - 2 * M, 2 * S); y += 10 * S;
  line('文件標題', 11, { color: '#8B6E5E' });
  line(doc.title, 14, { bold: true, gap: 6 });
  line('原始文件 SHA-256', 11, { color: '#8B6E5E' });
  ctx.font = '400 ' + 11 * S + 'px Consolas,"Courier New",monospace'; ctx.fillStyle = '#3E3430';
  const shaS = String(sha || '');
  ctx.fillText(shaS.slice(0, 32), M, y); y += 11 * S * 1.5;
  ctx.fillText(shaS.slice(32), M, y); y += 11 * S * 1.5 + 8 * S;
  ctx.fillStyle = '#E6DCD2'; ctx.fillRect(M, y, W - 2 * M, 1 * S); y += 12 * S;

  const BLOCK = 118 * S;
  for (const s of signers) {
    if (y + BLOCK > H - M - 30 * S) newPage();
    const top = y;
    line(s.name + (s.role ? '（' + s.role + '）' : ''), 14, { bold: true });
    line('簽署時間：' + sdFmtDt(s.signedAt).replace(/\//g, '-') + '（台灣時間）', 11);
    line('IP：' + (s.signerIp || '—'), 11);
    line('裝置：' + (sdUaSummary(s.signerUa) || '—'), 11);
    if (s.sigImg) {
      const boxW = 150 * S, boxH = 70 * S;
      const sc = Math.min(boxW / s.sigImg.naturalWidth, boxH / s.sigImg.naturalHeight);
      const iw = s.sigImg.naturalWidth * sc, ih = s.sigImg.naturalHeight * sc;
      const bx = W - M - boxW, by = top;
      ctx.strokeStyle = '#E6DCD2'; ctx.lineWidth = 1 * S; ctx.strokeRect(bx, by, boxW, boxH);
      ctx.drawImage(s.sigImg, bx + (boxW - iw) / 2, by + (boxH - ih) / 2, iw, ih);
    }
    y = Math.max(y, top + 84 * S) + 8 * S;
    ctx.fillStyle = '#F3E2D3'; ctx.fillRect(M, y, W - 2 * M, 1 * S); y += 12 * S;
  }
  if (y + 40 * S > H - M) newPage();
  y += 6 * S;
  line('完成時間：' + sdFmtDt(completedAt).replace(/\//g, '-') + '（台灣時間）', 11, { bold: true });
  line('本頁由系統於全員簽署完成後自動產生，簽名位置見前頁。', 10, { color: '#8B6E5E' });
  const out = [];
  for (const c of pages) {
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    out.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return out;
}

async function sdBuildSignedPdf(assets, doc) {
  const { PDFDocument } = PDFLib;
  const srcBytes = await sdFetchBytes(assets.sourceUrl);
  const pdf = await PDFDocument.load(srcBytes);
  const signers = [];
  for (const s of (assets.signers || [])) {
    let png = null, img = null;
    if (s.signedAt) {
      const failMsg = (s.name || '簽署人') + ' 的簽名圖讀取失敗，請稍後再試或重新產生連結請對方重簽';
      if (!s.signatureUrl) throw new Error(failMsg);
      try {
        const bytes = await sdFetchBytes(s.signatureUrl);
        png = await pdf.embedPng(bytes);
        img = await sdLoadImg(URL.createObjectURL(new Blob([bytes], { type: 'image/png' })));
      } catch (e) {
        throw new Error(failMsg);
      }
    }
    signers.push(Object.assign({}, s, { png, sigImg: img }));
  }
  const pageCount = pdf.getPageCount();
  for (const s of signers) {
    if (!s.png) continue;
    for (const f of (s.fields || [])) {
      if (f.page < 0 || f.page >= pageCount) continue;
      const pg = pdf.getPage(f.page);
      const { width: pw, height: ph } = pg.getSize();
      const bw = f.w * pw, bh = f.h * ph;
      const sc = Math.min(bw / s.png.width, bh / s.png.height);
      const dw = s.png.width * sc, dh = s.png.height * sc;
      const bx = f.x * pw, by = ph - (f.y + f.h) * ph;
      pg.drawImage(s.png, { x: bx + (bw - dw) / 2, y: by + (bh - dh) / 2, width: dw, height: dh });
    }
  }
  const completedAt = new Date().toISOString();
  const recs = await sdBuildRecordPages(doc, signers, (assets.document && assets.document.sourceSha256) || doc.sourceSha256, completedAt);
  for (const pngBytes of recs) {
    const im = await pdf.embedPng(pngBytes);
    const page = pdf.addPage([595, 842]);
    page.drawImage(im, { x: 0, y: 0, width: 595, height: 842 });
  }
  signers.forEach(s => { if (s.sigImg && s.sigImg.src) { try { URL.revokeObjectURL(s.sigImg.src); } catch (e) {} } });
  return { bytes: await pdf.save(), pageCount: pdf.getPageCount() };
}
async function sdComplete() {
  if (SD_BUSY) return;
  const doc = sdFindDoc(SD_CUR);
  if (!doc) return;
  SD_BUSY = true;
  const btn = document.getElementById('sdCompleteBtn');
  if (btn) btn.disabled = true;
  try {
    await sdEnsureLibs();
    sdSetStatus('取得簽名資料…');
    const assets = await sdCall('signdoc-sign-assets', { id: doc.id });
    sdSetStatus('合成 PDF 中（放簽名圖、畫簽署紀錄頁）…');
    const out = await sdBuildSignedPdf(assets, doc);
    sdSetStatus('上傳完成版…');
    const blob = new Blob([out.bytes], { type: 'application/pdf' });
    const init = await sdCall('signdoc-signed-upload-url', { id: doc.id });
    const put = await fetch(init.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: blob });
    if (!put.ok) throw new Error('上傳失敗（' + put.status + '）');
    await sdCall('signdoc-complete', { id: doc.id, path: init.path });
    // 自動下載
    const a = document.createElement('a');
    const dl = URL.createObjectURL(blob);
    a.href = dl; a.download = doc.title.replace(/[\\/:*?"<>|]/g, '_') + '（已簽署）.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(dl), 10000);
    SD_BUSY = false;
    await sdReload(); sdRenderCurrent();
    sdSetStatus('完成版已產生並下載' + (doc.tripId ? '，已加進該出差附件' : '') + '。');
  } catch (err) {
    SD_BUSY = false;
    if (btn) btn.disabled = false;
    sdSetStatus('產生失敗：' + err.message, true);
  }
}

// 清單列可用鍵盤 Enter 開啟
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const row = e.target && e.target.classList && e.target.classList.contains('sd-row') ? e.target : null;
  if (row) row.click();
});
