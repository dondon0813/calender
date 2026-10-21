// ===================================================================
// expenses.js — 公司支出報帳（帳務頁子分頁「公司支出」，權限 expenseEdit）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 subscriptions.js）。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('accounting')，
// 帳務頁若是只有 expenseEdit 的人，會呼叫 acctSwitchTab('expenses') → loadExpensesView()；
// 本檔排在後面的話，開機當下函式還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 掛載」，不直接呼叫 admin.js 內部函式；
// 跟 admin.js 共用的只有全域 currentToken 與共用 DOM（同 subscriptions.js 做法）。
//
// 規格正本：dondon-platform/docs/18-company-expenses.md
// 後端：POST/GET https://dondon-platform.vercel.app/api/expenses
// 檔案走私有 bucket：簽名直傳（expense-file-upload-url）＋短效簽名網址瀏覽（expense-file-url）
// ===================================================================

const EXP_API_URL = 'https://dondon-platform.vercel.app/api/expenses';

const EXP_CATEGORIES = [
  ['travel', '差旅'], ['sample', '樣品'], ['shipping', '運費'], ['packaging', '包材'],
  ['equipment', '拍攝器材'], ['ads', '廣告'], ['office', '辦公用品'], ['gift', '贈品'], ['other', '其他']
];
const EXP_CURRENCIES = ['TWD', 'JPY', 'USD', 'EUR', 'CNY', 'KRW', 'GBP'];
const EXP_CUR_SYMBOL = { TWD: 'NT$', JPY: '¥', USD: 'US$', EUR: '€', CNY: 'CN¥', KRW: '₩', GBP: '£' };
const EXP_RECEIPT_TYPES = [
  ['none', '無憑證'], ['invoice', '發票'], ['receipt', '收據'],
  ['foreign_receipt', '國外收據'], ['payment_proof', '付款證明']
];
const EXP_FILE_MAX_BYTES = 15 * 1024 * 1024;
const EXP_IMG_MAX_EDGE = 2000;
const EXP_ASSET_MAX_EDGE = 1600;   // 出差素材：長邊縮到 1600px（docs/20）
// 出差紀錄（docs/20）：素材類型、發文與產出類型、行程類別（沿用旅遊頁 food/transport/fun/shop/stay/other）
const EXP_ASSET_KINDS = [['product', '產品配圖'], ['travel', '旅遊分享'], ['story', '限動截圖'], ['video', '影片代表畫面']];
const EXP_POST_KINDS = [['post', '貼文'], ['reel', '影片'], ['story', '限動'], ['event', '開團'], ['tool', '工具與內容']];
const EXP_ITIN_CATS = [['food', '美食'], ['transport', '交通'], ['sight', '景點'], ['fun', '娛樂'], ['shop', '購物'], ['stay', '住宿'], ['other', '其他']];
const EXP_TRIP_SECS = [['basic', '基本'], ['itin', '行程'], ['assets', '素材'], ['posts', '發文與產出']];

let EXP_LOADED = false;
let EXP_TABLE_READY = true;
let EXP_LIST = [];
let EXP_TRIPS = [];
let EXP_BRANDS = [];
let EXP_EVENTS = [];
let EXP_FILTER = { month: '', category: '', trip: '', unreimbursed: false };
let EXP_EDIT_ID = null;       // 目前編輯中的支出 id；null＝新增
let EXP_TRIP_EDIT_ID = null;  // 目前編輯中的出差 id；null＝新增
let EXP_RECORDS_READY = true;  // false＝出差紀錄的新表／新欄位還沒 db push（後三區擋寫入）
let EXP_TRIP_SEC = 'basic';   // 出差視窗目前停在哪一區
let EXP_ASSET_EDIT_ID = null; // 目前編輯中的素材 id
let EXP_POST_EDIT_ID = null;  // 目前編輯中的發文／產出 id；null＝新增
let EXP_ASSET_UPLOADING = false;
let EXP_RECEIPT_UP = null;    // 支出視窗的收據上傳器
let EXP_TRIP_UP = null;       // 出差視窗的附件上傳器
const EXP_URL_CACHE = {};     // path → { url, at }；簽名網址 600 秒，這裡 500 秒內重用

// ===== 小工具（自帶，不依賴 admin.js）=====
function expEsc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function expCatLabel(v) { const f = EXP_CATEGORIES.find(c => c[0] === v); return f ? f[1] : (v || ''); }
function expToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function expMoney(cur, n) {
  const num = Number(n);
  if (!isFinite(num)) return '';
  return (EXP_CUR_SYMBOL[cur] || (cur + ' ')) + num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
// 這筆換算成台幣（TWD 直接用金額；外幣要有 twdAmount；否則 null＝未換算）
function expTwdOf(e) {
  if (e.currency === 'TWD') return Number(e.amount) || 0;
  if (e.twdAmount === null || e.twdAmount === undefined || e.twdAmount === '') return null;
  return Number(e.twdAmount);
}
function expIsOk(res) { return !!res && (res.ok === true || res.success === true); }
function expIsImageName(name) { return /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(String(name || '')); }

const EXP_ICON = {
  receipt: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h12v17l-2.5-1.6-1.8 1.6-1.7-1.6-1.7 1.6-1.8-1.6L6 20.5z"/><path d="M9 8.5h6"/><path d="M9 12h6"/></svg>',
  plus: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  refresh: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.6"/><path d="M20 4v4.6h-4.6"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.4"/><path d="M4 20v-4.6h4.6"/></svg>',
  clip: '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5l-7.6 7.6a4.5 4.5 0 0 1-6.4-6.4l8.2-8.2a3 3 0 0 1 4.2 4.2l-8.2 8.2a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3"/></svg>',
  x: '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.5 15h7"/><path d="M8.5 12h4"/></svg>',
  img: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/></svg>',
  pencil: '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4.2L16.5 4.3a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.2 19z"/><path d="M14.5 6.3l3.2 3.2"/></svg>',
  warn: '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5"/><path d="M12 17.3h.01"/></svg>'
};

// ===== 登入逾時（同 subscriptions.js 的處理）=====
function expForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API =====
// 後端可能還沒部署（回 404 HTML）或網路斷線：統一丟 Error，由呼叫端顯示橫幅，不讓頁面壞掉。
async function expApiGet() {
  const res = await fetch(EXP_API_URL + '?token=' + encodeURIComponent(currentToken || ''), { cache: 'no-store' });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('後端回應格式不對（HTTP ' + res.status + '），可能還沒部署'); }
  if (data && data.needLogin) { expForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}
async function expApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(EXP_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('後端回應格式不對（HTTP ' + res.status + '）'); }
  if (data && data.needLogin) { expForceRelogin(); throw new Error(data.error || '請重新登入'); }
  return data;
}

// ===== 檔案：縮圖、上傳、瀏覽 =====
function expLoadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('這個檔案不是可讀的圖片（' + file.name + '）')); };
    img.src = url;
  });
}
// 長邊縮到 2000px；能出 WebP 就 WebP，不行（舊 Safari）退 JPEG
async function expCompressImage(file, maxEdge) {
  const img = await expLoadImage(file);
  const scale = Math.min(1, (maxEdge || EXP_IMG_MAX_EDGE) / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const toBlob = type => new Promise(res => canvas.toBlob(res, type, 0.85));
  let blob = await toBlob('image/webp');
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await toBlob('image/jpeg'); ext = 'jpg'; }
  if (!blob) throw new Error('圖片處理失敗');
  return { blob, ext };
}
// 傳一個檔案，回傳可存進 receipts／attachments 的 {path,name,size,uploadedAt}（外加 localUrl 供當下預覽，存檔前會去掉）
async function expUploadOne(file, kind, tripId, maxEdge) {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isImg = !isPdf && (String(file.type).indexOf('image/') === 0 || expIsImageName(file.name));
  if (!isPdf && !isImg) throw new Error('只能上傳圖片或 PDF（' + file.name + '）');
  let blob = file, ext = 'pdf', name = file.name, localUrl = '';
  if (isImg) {
    const c = await expCompressImage(file, maxEdge);
    blob = c.blob; ext = c.ext;
    name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
    localUrl = URL.createObjectURL(blob);
  }
  if (blob.size > EXP_FILE_MAX_BYTES) throw new Error('檔案超過 15MB（' + file.name + '）');
  const payload = { kind, ext, size: blob.size };
  if (tripId) payload.tripId = tripId;
  const init = await expApiPost('expense-file-upload-url', payload);
  if (!expIsOk(init)) throw new Error((init && init.error) || '取得上傳網址失敗');
  const put = await fetch(init.signedUrl, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
  if (!put.ok) throw new Error('上傳失敗（' + put.status + '）');
  return { path: init.path, name, size: blob.size, uploadedAt: new Date().toISOString(), localUrl };
}
async function expSignedUrl(path) {
  const hit = EXP_URL_CACHE[path];
  if (hit && Date.now() - hit.at < 500000) return hit.url;
  const res = await expApiPost('expense-file-url', { path });
  if (!expIsOk(res) || !res.url) throw new Error((res && res.error) || '取得檔案網址失敗');
  EXP_URL_CACHE[path] = { url: res.url, at: Date.now() };
  return res.url;
}
// 點縮圖開新分頁：先同步開空白分頁再填網址，避免被瀏覽器當成彈出視窗擋掉
async function expOpenFile(item) {
  const w = window.open('', '_blank');
  try {
    const url = item.localUrl || await expSignedUrl(item.path);
    if (w) { w.location.href = url; } else { window.location.href = url; }
  } catch (err) {
    if (w) w.close();
    alert('開啟失敗：' + err.message);
  }
}

// 上傳器：管理一個視窗裡的「已存檔案＋上傳中檔案」縮圖列
function expCreateUploader(opts) {
  // opts: { box, input, kind, getTripId, onChange }
  const state = { items: [], seq: 0 };
  const box = document.getElementById(opts.box);
  const input = document.getElementById(opts.input);

  function render() {
    box.innerHTML = state.items.map((it, i) => {
      const isImg = expIsImageName(it.name);
      const busy = it.tmp && it.status === 'up';
      const err = it.tmp && it.status === 'err';
      const thumb = isImg
        ? '<img alt="" data-exp-thumb="' + i + '"' + (it.localUrl ? ' src="' + expEsc(it.localUrl) + '"' : '') + '>'
        : '<span class="exp-file-ic">' + EXP_ICON.pdf + '</span>';
      const fallbackIc = isImg && !it.localUrl ? '<span class="exp-file-ic" data-exp-ph="' + i + '">' + EXP_ICON.img + '</span>' : '';
      return '<div class="exp-file' + (err ? ' err' : '') + '" data-i="' + i + '" title="' + expEsc(it.name) + '">' +
        '<div class="exp-file-th">' + thumb + fallbackIc + (busy ? '<div class="exp-file-tag">上傳中</div>' : '') + (err ? '<div class="exp-file-tag">失敗</div>' : '') + '</div>' +
        '<div class="exp-file-nm">' + expEsc(it.name) + '</div>' +
        (busy ? '' : '<button type="button" class="exp-x" data-rm="' + i + '" aria-label="移除">' + EXP_ICON.x + '</button>') +
        '</div>';
    }).join('');
    // 已存的圖片補縮圖（要向後端要短效網址）
    state.items.forEach((it, i) => {
      if (it.tmp || !expIsImageName(it.name) || it.localUrl) return;
      expSignedUrl(it.path).then(url => {
        const img = box.querySelector('img[data-exp-thumb="' + i + '"]');
        if (!img) return;
        img.src = url;
        const ph = box.querySelector('[data-exp-ph="' + i + '"]');
        if (ph) ph.remove();
      }).catch(() => {});
    });
    if (opts.onChange) opts.onChange();
  }

  box.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      e.stopPropagation();
      const it = state.items[Number(rm.dataset.rm)];
      if (it && it.localUrl) { try { URL.revokeObjectURL(it.localUrl); } catch (x) {} }
      state.items.splice(Number(rm.dataset.rm), 1);
      render();
      return;
    }
    const tile = e.target.closest('.exp-file');
    if (tile) {
      const it = state.items[Number(tile.dataset.i)];
      if (it && !it.tmp) expOpenFile(it);
    }
  });

  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    for (const file of files) {
      const tmp = { tmp: true, status: 'up', name: file.name, id: ++state.seq };
      state.items.push(tmp);
      render();
      try {
        const done = await expUploadOne(file, opts.kind, opts.getTripId ? opts.getTripId() : null);
        const idx = state.items.indexOf(tmp);
        if (idx >= 0) state.items[idx] = done; else if (done.localUrl) { try { URL.revokeObjectURL(done.localUrl); } catch (x) {} }
      } catch (err) {
        tmp.status = 'err';
        tmp.name = file.name + '（' + err.message + '）';
      }
      render();
    }
  });

  return {
    setItems(list) { state.items = (Array.isArray(list) ? list : []).map(x => Object.assign({}, x)); render(); },
    // 存檔用：只回完整上傳完的，去掉暫存欄位
    getSaved() { return state.items.filter(x => !x.tmp).map(x => ({ path: x.path, name: x.name, size: x.size, uploadedAt: x.uploadedAt })); },
    busy() { return state.items.some(x => x.tmp && x.status === 'up'); },
    hasError() { return state.items.some(x => x.tmp && x.status === 'err'); },
    clearErrors() { state.items = state.items.filter(x => !(x.tmp && x.status === 'err')); render(); }
  };
}

// ===== 樣式 =====
function expInjectStyle() {
  if (document.getElementById('expStyle')) return;
  const st = document.createElement('style');
  st.id = 'expStyle';
  st.textContent = `
  .exp-ic{ width:15px; height:15px; vertical-align:-3px; flex:none; }
  .exp-banner{ background:#F5EFE9; color:#8B6E5E; border-radius:8px; padding:8px 12px; margin-bottom:10px; font-size:13px; line-height:1.7; }
  .exp-toolbar{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
  .exp-h{ font-size:13.5px; font-weight:800; color:var(--c-text-soft); margin:14px 0 8px; }
  .exp-trips{ display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:10px; }
  .exp-trip{ background:var(--c-surface); border-radius:12px; padding:12px 14px; cursor:pointer; min-width:0; }
  .exp-trip.on{ outline:2px solid var(--c-primary); }
  .exp-trip-t{ font-weight:800; font-size:14.5px; color:var(--c-text); word-break:break-all; }
  .exp-trip-m{ font-size:12.5px; color:var(--c-text-soft); margin-top:4px; line-height:1.6; }
  .exp-trip-b{ display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
  .exp-trip-total{ font-weight:800; font-variant-numeric:tabular-nums; color:var(--c-text); }
  .exp-filters{ display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
  .exp-filters label.exp-chk{ display:flex; align-items:center; gap:6px; font-size:13px; color:var(--c-text-soft); cursor:pointer; }
  .exp-input, .exp-filters select, .exp-modal select, .exp-modal textarea, .exp-modal input[type=text], .exp-modal input[type=number], .exp-modal input[type=date]{
    font:inherit; font-size:14px; padding:8px 10px; border-radius:10px;
    background:#fff; border:1px solid #E6DCD2; color:var(--c-text); box-sizing:border-box; max-width:100%;
  }
  .exp-input:focus, .exp-filters select:focus, .exp-modal select:focus, .exp-modal textarea:focus,
  .exp-modal input[type=text]:focus, .exp-modal input[type=number]:focus, .exp-modal input[type=date]:focus{ outline:none; border-color:#C99A9B; }
  .exp-month{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; font-size:13px; font-weight:800; color:var(--c-text-soft); padding:10px 4px 6px; border-bottom:1px solid var(--c-line); }
  .exp-month span.s{ font-weight:600; font-size:12.5px; }
  .exp-row{ display:grid; grid-template-columns:1fr auto; gap:4px 12px; padding:10px 6px; border-bottom:1px solid var(--c-line); cursor:pointer; align-items:start; }
  .exp-row:hover{ background:var(--c-surface); }
  .exp-r-l{ min-width:0; }
  .exp-r-top{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; font-size:12.5px; color:var(--c-text-soft); }
  .exp-pill{ display:inline-block; font-size:11.5px; font-weight:800; padding:2px 9px; border-radius:999px; background:var(--c-surface); color:var(--c-text-soft); }
  .exp-pill.warn{ background:#F3E3E1; color:#B5485A; }
  .exp-pill.ok{ background:var(--c-surface); color:var(--c-text-soft); }
  .exp-r-item{ font-weight:800; font-size:14.5px; color:var(--c-text); margin-top:3px; word-break:break-all; }
  .exp-r-sub{ font-size:12px; color:var(--c-text-soft); margin-top:2px; word-break:break-all; }
  .exp-r-r{ text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .exp-r-amt{ font-weight:800; font-size:14.5px; color:var(--c-text); }
  .exp-r-twd{ font-size:12px; color:var(--c-text-soft); margin-top:2px; }
  .exp-clipn{ display:inline-flex; align-items:center; gap:2px; }
  .exp-empty{ text-align:center; color:var(--c-text-soft); font-size:13.5px; padding:22px 8px; }
  /* 視窗 */
  .exp-modal .modal-box{ width:min(560px, 94vw); }
  .exp-modal .modal-close{ color:var(--c-muted); }
  .exp-modal .modal-close:hover{ color:var(--c-brown); }
  .exp-lb{ display:block; font-size:12.5px; font-weight:800; color:var(--c-text-soft); margin:12px 0 4px; }
  .exp-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .exp-grid3{ display:grid; grid-template-columns:1fr 110px 1fr; gap:8px; }
  .exp-modal .exp-grid2 > *, .exp-modal .exp-grid3 > *{ min-width:0; width:100%; }
  .exp-modal input[type=text], .exp-modal input[type=number], .exp-modal input[type=date], .exp-modal select, .exp-modal textarea{ width:100%; }
  .exp-modal input[type=checkbox]{ width:auto; margin:0; }
  .exp-inline{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .exp-files{ display:grid; grid-template-columns:repeat(auto-fill, minmax(86px, 1fr)); gap:8px; margin-top:6px; }
  .exp-file{ position:relative; background:var(--c-surface); border-radius:10px; padding:6px; cursor:pointer; min-width:0; }
  .exp-file.err{ background:#F3E3E1; }
  .exp-file-th{ position:relative; height:64px; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:8px; color:var(--c-text-soft); }
  .exp-file-th img{ max-width:100%; max-height:100%; object-fit:contain; }
  .exp-file-tag{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,.75); font-size:12px; font-weight:800; color:var(--c-text-soft); }
  .exp-file-nm{ font-size:11px; color:var(--c-text-soft); margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .exp-x{ position:absolute; top:3px; right:3px; width:22px; height:22px; border:none; border-radius:50%; background:rgba(255,255,255,.9); color:var(--c-muted); cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0; }
  .exp-x:hover{ color:var(--c-brown); }
  .exp-x .exp-ic{ width:12px; height:12px; vertical-align:0; }
  .exp-actions{ display:flex; gap:8px; align-items:center; margin-top:16px; flex-wrap:wrap; }
  .exp-upbtn{ display:inline-flex; align-items:center; gap:6px; }
  /* 出差紀錄（docs/20）：四區切換、行程、素材格、發文清單 */
  .exp-modal #expTripModal .modal-box{ width:min(780px, 94vw); }
  .exp-modal #expAssetModal .modal-box, .exp-modal #expPostModal .modal-box{ width:min(520px, 94vw); }
  .exp-tabs{ display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 12px; }
  .exp-banner.warn{ background:#FBF1D6; color:#8A6D1F; }
  .exp-impbox{ margin-top:14px; padding:12px; background:var(--c-surface); border-radius:12px; }
  .exp-impbox .exp-lb{ margin-top:0; }
  .exp-impres{ margin-top:10px; font-size:13px; line-height:1.7; color:var(--c-text); }
  .exp-impres ul{ margin:4px 0 0; padding-left:18px; color:#8A6D1F; }
  .exp-hint{ font-size:12.5px; color:var(--c-text-soft); line-height:1.7; }
  .exp-it-day{ font-size:13px; font-weight:800; color:var(--c-text-soft); padding:10px 4px 6px; border-bottom:1px solid var(--c-line); margin-top:6px; }
  .exp-it-row{ display:grid; grid-template-columns:52px 22px 1fr; gap:8px; padding:8px 4px; border-bottom:1px solid var(--c-line); align-items:start; font-size:13.5px; }
  .exp-it-time{ color:var(--c-text-soft); font-variant-numeric:tabular-nums; }
  .exp-it-ic{ color:var(--c-text-soft); display:flex; }
  .exp-it-ic .exp-ic{ width:17px; height:17px; vertical-align:0; }
  .exp-it-t{ font-weight:800; color:var(--c-text); word-break:break-all; }
  .exp-it-t a{ color:inherit; text-decoration:underline; text-decoration-color:#C99A9B; }
  .exp-it-p{ font-size:12.5px; color:var(--c-text-soft); margin-top:2px; word-break:break-all; }
  .exp-assets{ display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:10px; margin-top:6px; }
  .exp-as{ position:relative; background:var(--c-surface); border-radius:10px; padding:6px; cursor:pointer; min-width:0; }
  .exp-as.off{ opacity:.5; }
  .exp-as-th{ height:120px; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:8px; color:var(--c-text-soft); background:#fff; }
  .exp-as-th img{ max-width:100%; max-height:100%; object-fit:contain; }
  .exp-as-ty{ position:absolute; top:10px; left:10px; font-size:10.5px; font-weight:800; padding:1px 7px; border-radius:999px; background:rgba(255,255,255,.92); color:var(--c-text-soft); }
  .exp-as-nm{ font-size:11.5px; color:var(--c-text-soft); margin-top:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .exp-as-nm.warn{ color:#B5485A; }
  .exp-prow{ display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:10px 6px; border-bottom:1px solid var(--c-line); cursor:pointer; }
  .exp-prow:hover{ background:var(--c-surface); }
  .exp-prow .d{ font-size:12.5px; color:var(--c-text-soft); min-width:84px; font-variant-numeric:tabular-nums; }
  .exp-prow .t{ flex:1 1 180px; min-width:0; font-weight:800; font-size:14px; color:var(--c-text); word-break:break-all; }
  .exp-prow .s{ flex:1 1 100%; font-size:12px; color:var(--c-text-soft); padding-left:94px; word-break:break-all; }
  .exp-prow a.exp-lk{ color:var(--c-text-soft); display:inline-flex; }
  .exp-prow a.exp-lk:hover{ color:var(--c-brown); }
  .exp-suggest{ margin-top:6px; }
  .exp-prev{ margin-top:10px; height:160px; display:flex; align-items:center; justify-content:center; background:var(--c-surface); border-radius:10px; overflow:hidden; cursor:pointer; color:var(--c-text-soft); }
  .exp-prev img{ max-width:100%; max-height:100%; object-fit:contain; }
  @media (max-width:480px){
    .exp-prow .s{ padding-left:0; }
  }
  @media (min-width:720px){
    .exp-row{ grid-template-columns:1fr 150px; }
  }
  @media (max-width:480px){
    .exp-grid3{ grid-template-columns:1fr 96px; }
    .exp-grid3 > :nth-child(3){ grid-column:1 / 3; }
  }
  `;
  document.head.appendChild(st);
}

// ===== 骨架（子分頁容器＋兩個視窗，全由 JS 注入）=====
function expSelectOptions(list, sel) {
  return list.map(c => '<option value="' + expEsc(c[0]) + '"' + (c[0] === sel ? ' selected' : '') + '>' + expEsc(c[1]) + '</option>').join('');
}
function expBuildSkeleton() {
  const pane = document.getElementById('acctPaneExpenses');
  if (!pane || pane.dataset.built) return;
  pane.dataset.built = '1';
  pane.innerHTML =
    '<div id="expBanner"></div>' +
    '<div class="exp-toolbar">' +
      '<button type="button" class="task-mini-btn" id="expAddBtn">' + EXP_ICON.plus + '新增支出</button>' +
      '<button type="button" class="task-mini-btn" id="expAddTripBtn">' + EXP_ICON.plus + '新增出差</button>' +
      '<button type="button" class="task-mini-btn" id="expRefreshBtn">' + EXP_ICON.refresh + '重新整理</button>' +
    '</div>' +
    '<div class="exp-h">出差</div><div id="expTrips" class="exp-trips"></div>' +
    '<div class="exp-h">支出</div>' +
    '<div class="exp-filters" id="expFilters"></div>' +
    '<div id="expList"></div>';

  const catOpts = expSelectOptions(EXP_CATEGORIES, 'other');
  const curOpts = EXP_CURRENCIES.map(c => '<option value="' + c + '">' + c + '</option>').join('');
  const rtOpts = expSelectOptions(EXP_RECEIPT_TYPES, 'none');

  const wrap = document.createElement('div');
  wrap.className = 'exp-modal';
  wrap.innerHTML =
  // 支出視窗
  '<div class="modal-backdrop" id="expEditModal" onclick="if(event.target===this) closeExpEditModal()">' +
    '<div class="modal-box">' +
      '<button class="modal-close" type="button" onclick="closeExpEditModal()">✕</button>' +
      '<h3 id="expEditTitle">新增支出</h3>' +
      '<div class="exp-grid2">' +
        '<div><label class="exp-lb" for="expfDate">日期 *</label><input type="date" id="expfDate"></div>' +
        '<div><label class="exp-lb" for="expfCat">類別 *</label><select id="expfCat">' + catOpts + '</select></div>' +
      '</div>' +
      '<label class="exp-lb" for="expfItem">項目 *</label><input type="text" id="expfItem" placeholder="例如：東京來回機票">' +
      '<label class="exp-lb" for="expfVendor">店家／付給誰</label><input type="text" id="expfVendor" placeholder="例如：長榮航空">' +
      '<div class="exp-grid3">' +
        '<div><label class="exp-lb" for="expfAmount">金額 *</label><input type="number" id="expfAmount" step="0.01" min="0" inputmode="decimal"></div>' +
        '<div><label class="exp-lb" for="expfCur">幣別</label><select id="expfCur">' + curOpts + '</select></div>' +
        '<div id="expfTwdBox"><label class="exp-lb" for="expfTwd">換算台幣</label><input type="number" id="expfTwd" step="0.01" min="0" inputmode="decimal" placeholder="可留空"></div>' +
      '</div>' +
      '<label class="exp-lb" for="expfPaidBy">誰付的</label>' +
      '<select id="expfPaidBy"><option value="company">公司付</option><option value="personal">個人代墊</option></select>' +
      '<div id="expfPersonalBox" style="display:none;">' +
        '<label class="exp-lb" for="expfPayer">代墊者姓名</label><input type="text" id="expfPayer">' +
        '<div class="exp-inline" style="margin-top:8px;">' +
          '<label class="exp-inline" for="expfReimb" style="cursor:pointer;"><input type="checkbox" id="expfReimb"><span style="font-size:13.5px;">已歸墊</span></label>' +
          '<input type="date" id="expfReimbAt" style="width:auto;" aria-label="歸墊日期">' +
        '</div>' +
      '</div>' +
      '<label class="exp-lb" for="expfRType">憑證類型</label><select id="expfRType">' + rtOpts + '</select>' +
      '<label class="exp-lb">收據／憑證（圖片或 PDF）</label>' +
      '<label class="task-mini-btn exp-upbtn" for="expfFile" style="cursor:pointer;">' + EXP_ICON.clip + '選擇檔案</label>' +
      '<input type="file" id="expfFile" accept="image/*,application/pdf,.pdf" multiple style="display:none;">' +
      '<div class="exp-files" id="expfFiles"></div>' +
      '<label class="exp-lb" for="expfBrand">綁品牌（可打字搜尋）</label>' +
      '<input type="text" id="expfBrand" list="expBrandList" placeholder="不綁就留空" autocomplete="off"><datalist id="expBrandList"></datalist>' +
      '<label class="exp-lb" for="expfEvent">綁團購</label><select id="expfEvent"></select>' +
      '<label class="exp-lb" for="expfTrip">綁出差</label><select id="expfTrip"></select>' +
      '<label class="exp-lb" for="expfNote">備註</label><textarea id="expfNote" rows="2"></textarea>' +
      '<div class="exp-actions">' +
        '<button type="button" class="task-submit-btn" id="expSaveBtn" style="margin-top:0;">儲存</button>' +
        '<button type="button" class="task-mini-btn danger" id="expDeleteBtn" style="display:none; padding:0 18px;">刪除</button>' +
      '</div>' +
      '<div class="form-status" id="expEditStatus"></div>' +
    '</div>' +
  '</div>' +
  // 出差視窗（四區：基本／行程／素材／發文與產出）
  '<div class="modal-backdrop" id="expTripModal" onclick="if(event.target===this) closeExpTripModal()">' +
    '<div class="modal-box">' +
      '<button class="modal-close" type="button" onclick="closeExpTripModal()">✕</button>' +
      '<h3 id="expTripTitle">新增出差</h3>' +
      '<div class="exp-tabs" id="exptTabs"></div>' +
      '<div class="exp-sec" id="exptSecBasic">' +
        '<label class="exp-lb" for="exptTitle">標題 *</label><input type="text" id="exptTitle" placeholder="例如：2026 東京員工旅遊">' +
        '<div class="exp-grid2">' +
          '<div><label class="exp-lb" for="exptStart">開始日</label><input type="date" id="exptStart"></div>' +
          '<div><label class="exp-lb" for="exptEnd">結束日</label><input type="date" id="exptEnd"></div>' +
        '</div>' +
        '<label class="exp-lb" for="exptLoc">地點</label><input type="text" id="exptLoc">' +
        '<label class="exp-lb" for="exptNote">備註</label><textarea id="exptNote" rows="2"></textarea>' +
        '<label class="exp-lb">附件（計畫書／出差報告／同意書，PDF 或圖片）</label>' +
        '<label class="task-mini-btn exp-upbtn" for="exptFile" style="cursor:pointer;">' + EXP_ICON.clip + '選擇檔案</label>' +
        '<input type="file" id="exptFile" accept="image/*,application/pdf,.pdf" multiple style="display:none;">' +
        '<div class="exp-files" id="exptFiles"></div>' +
        '<div class="exp-impbox" id="exptImpBox">' +
          '<label class="exp-lb" for="exptImpSel">從旅遊頁匯入</label>' +
          '<div class="exp-hint" style="margin-bottom:8px;">把旅遊頁記的公司負擔支出、隨手拍照片、每日行程帶進這趟出差。已匯入過的不會重複、也不會覆蓋你改過的內容。</div>' +
          '<div class="exp-inline">' +
            '<select id="exptImpSel" style="flex:1 1 220px; width:auto; min-width:0;"></select>' +
            '<button type="button" class="task-mini-btn" id="exptImpBtn">' + EXP_ICON.refresh + '匯入</button>' +
          '</div>' +
          '<div class="exp-impres" id="exptImpRes"></div>' +
        '</div>' +
        '<div class="exp-actions">' +
          '<button type="button" class="task-submit-btn" id="expTripSaveBtn" style="margin-top:0;">儲存</button>' +
          '<button type="button" class="task-mini-btn danger" id="expTripDeleteBtn" style="display:none; padding:0 18px;">刪除</button>' +
        '</div>' +
        '<div class="form-status" id="expTripStatus"></div>' +
      '</div>' +
      '<div class="exp-sec" id="exptSecItin" style="display:none;"><div id="exptBnItin"></div><div id="exptItin"></div></div>' +
      '<div class="exp-sec" id="exptSecAssets" style="display:none;">' +
        '<div id="exptBnAssets"></div>' +
        '<div id="exptAssetTools" class="exp-inline">' +
          '<label class="task-mini-btn exp-upbtn" for="expaFile" style="cursor:pointer;">' + EXP_ICON.plus + '上傳素材</label>' +
          '<input type="file" id="expaFile" accept="image/*" multiple style="display:none;">' +
          '<span class="exp-hint" id="expaUpStatus"></span>' +
        '</div>' +
        '<div class="exp-hint" style="margin-top:6px;">手機拍的現場照、產品、限動／影片截圖都放這裡；點縮圖可標註品牌、產品與用在哪。</div>' +
        '<div id="exptAssets"></div>' +
      '</div>' +
      '<div class="exp-sec" id="exptSecPosts" style="display:none;">' +
        '<div id="exptBnPosts"></div>' +
        '<div class="exp-toolbar"><button type="button" class="task-mini-btn" id="exppAddBtn">' + EXP_ICON.plus + '新增發文／產出</button></div>' +
        '<div id="exptPosts"></div>' +
      '</div>' +
    '</div>' +
  '</div>' +
  // 素材編輯視窗
  '<div class="modal-backdrop" id="expAssetModal" onclick="if(event.target===this) closeExpAssetModal()">' +
    '<div class="modal-box">' +
      '<button class="modal-close" type="button" onclick="closeExpAssetModal()">✕</button>' +
      '<h3>編輯素材</h3>' +
      '<div class="exp-prev" id="expaPreview"></div>' +
      '<div class="exp-grid2">' +
        '<div><label class="exp-lb" for="expaDate">拍攝／日期</label><input type="date" id="expaDate"></div>' +
        '<div><label class="exp-lb" for="expaKind">類型</label><select id="expaKind">' + expSelectOptions(EXP_ASSET_KINDS, 'travel') + '</select></div>' +
      '</div>' +
      '<label class="exp-lb" for="expaBrand">品牌（必綁，可打字搜尋）</label>' +
      '<input type="text" id="expaBrand" list="expBrandList" placeholder="這張素材是拍哪個品牌" autocomplete="off">' +
      '<label class="exp-lb" for="expaProduct">產品</label><input type="text" id="expaProduct" placeholder="例如：藍莓寶寶餐包">' +
      '<label class="exp-lb" for="expaEvent">綁團購（可之後補）</label><select id="expaEvent"></select>' +
      '<div class="exp-suggest" id="expaSuggest"></div>' +
      '<label class="exp-lb" for="expaPost">用在哪篇發文／產出</label><select id="expaPost"></select>' +
      '<label class="exp-lb" for="expaUrl">影片原檔連結（雲端硬碟等，選填）</label><input type="text" id="expaUrl" placeholder="https://">' +
      '<label class="exp-lb" for="expaNote">備註</label><textarea id="expaNote" rows="2"></textarea>' +
      '<label class="exp-inline" for="expaInReport" style="cursor:pointer; margin-top:12px;"><input type="checkbox" id="expaInReport"><span style="font-size:13.5px;">放進出差紀錄表</span></label>' +
      '<div class="exp-actions">' +
        '<button type="button" class="task-submit-btn" id="expaSaveBtn" style="margin-top:0;">儲存</button>' +
        '<button type="button" class="task-mini-btn danger" id="expaDeleteBtn" style="padding:0 18px;">刪除</button>' +
      '</div>' +
      '<div class="form-status" id="expaStatus"></div>' +
    '</div>' +
  '</div>' +
  // 發文與產出編輯視窗
  '<div class="modal-backdrop" id="expPostModal" onclick="if(event.target===this) closeExpPostModal()">' +
    '<div class="modal-box">' +
      '<button class="modal-close" type="button" onclick="closeExpPostModal()">✕</button>' +
      '<h3 id="exppTitleH">新增發文／產出</h3>' +
      '<div class="exp-grid2">' +
        '<div><label class="exp-lb" for="exppDate">發布日期</label><input type="date" id="exppDate"></div>' +
        '<div><label class="exp-lb" for="exppKind">類型</label><select id="exppKind">' + expSelectOptions(EXP_POST_KINDS, 'post') + '</select></div>' +
      '</div>' +
      '<label class="exp-lb" for="exppTitle">標題 *</label><input type="text" id="exppTitle" placeholder="例如：東京出差 Day2 逛超市">' +
      '<label class="exp-lb" for="exppUrl">網址（貼文、影片、工具頁）</label><input type="text" id="exppUrl" placeholder="https://">' +
      '<label class="exp-lb" for="exppBrand">品牌（必綁，可打字搜尋）</label>' +
      '<input type="text" id="exppBrand" list="expBrandList" placeholder="這篇是介紹哪個品牌" autocomplete="off">' +
      '<label class="exp-lb" for="exppEvent">綁團購（可之後補）</label><select id="exppEvent"></select>' +
      '<div class="exp-suggest" id="exppSuggest"></div>' +
      '<label class="exp-lb" for="exppTraffic">流量／成效備註</label><textarea id="exppTraffic" rows="2" placeholder="例如：IG 觸及 3.2 萬、開團首日 80 單"></textarea>' +
      '<label class="exp-lb" for="exppNote">備註</label><textarea id="exppNote" rows="2"></textarea>' +
      '<div class="exp-actions">' +
        '<button type="button" class="task-submit-btn" id="exppSaveBtn" style="margin-top:0;">儲存</button>' +
        '<button type="button" class="task-mini-btn danger" id="exppDeleteBtn" style="display:none; padding:0 18px;">刪除</button>' +
      '</div>' +
      '<div class="form-status" id="exppStatus"></div>' +
    '</div>' +
  '</div>';
  document.body.appendChild(wrap);

  EXP_RECEIPT_UP = expCreateUploader({ box: 'expfFiles', input: 'expfFile', kind: 'receipt' });
  EXP_TRIP_UP = expCreateUploader({ box: 'exptFiles', input: 'exptFile', kind: 'trip', getTripId: () => EXP_TRIP_EDIT_ID });

  // 事件掛載
  document.getElementById('expAddBtn').addEventListener('click', () => { if (expBlocked()) return; openExpEditModal(null); });
  document.getElementById('expAddTripBtn').addEventListener('click', () => { if (expBlocked()) return; openExpTripModal(null); });
  document.getElementById('expRefreshBtn').addEventListener('click', () => loadExpensesView(true));
  document.getElementById('expfCur').addEventListener('change', expSyncCurrencyUi);
  document.getElementById('expfPaidBy').addEventListener('change', expSyncPaidUi);
  document.getElementById('expSaveBtn').addEventListener('click', expSaveExpense);
  document.getElementById('expDeleteBtn').addEventListener('click', expDeleteExpense);
  document.getElementById('expTripSaveBtn').addEventListener('click', expSaveTrip);
  document.getElementById('expTripDeleteBtn').addEventListener('click', expDeleteTrip);
  expWireRecords();

  document.getElementById('expList').addEventListener('click', e => {
    const row = e.target.closest('.exp-row');
    if (!row) return;
    const rec = EXP_LIST.find(x => x.id === row.dataset.id);
    if (rec) openExpEditModal(rec);
  });
  document.getElementById('expTrips').addEventListener('click', e => {
    const card = e.target.closest('.exp-trip');
    if (!card) return;
    const trip = EXP_TRIPS.find(x => x.id === card.dataset.id);
    if (!trip) return;
    if (e.target.closest('[data-act="edit"]')) { openExpTripModal(trip); return; }
    // 點卡片本身＝篩選底下支出（再點一次取消）
    EXP_FILTER.trip = EXP_FILTER.trip === trip.id ? '' : trip.id;
    renderExpTrips();
    renderExpFilters();
    renderExpList();
  });
  document.getElementById('expFilters').addEventListener('change', e => {
    const id = e.target.id;
    if (id === 'expFiltMonth') EXP_FILTER.month = e.target.value;
    else if (id === 'expFiltCat') EXP_FILTER.category = e.target.value;
    else if (id === 'expFiltTrip') EXP_FILTER.trip = e.target.value;
    else if (id === 'expFiltUnreimb') EXP_FILTER.unreimbursed = e.target.checked;
    else return;
    renderExpTrips();
    renderExpList();
  });
}

// ===== 載入 =====
function expBlocked() {
  if (!EXP_TABLE_READY) { alert('公司支出功能待 db push，資料表建好之後才能新增。'); return true; }
  if (!EXP_LOADED) { alert('資料還沒載入完成，請稍候或按「重新整理」。'); return true; }
  return false;
}
function expShowBanner(html) {
  const b = document.getElementById('expBanner');
  if (b) b.innerHTML = html ? '<div class="exp-banner">' + EXP_ICON.warn + ' ' + html + '</div>' : '';
}

// 把 GET 回應套進全域狀態（loadExpensesView 與出差視窗內的就地重整共用）
function expApplyData(data) {
  EXP_LOADED = true;
  EXP_TABLE_READY = data.tableReady !== false;
  EXP_RECORDS_READY = data.recordsReady !== false;
  EXP_LIST = Array.isArray(data.expenses) ? data.expenses : [];
  EXP_TRIPS = Array.isArray(data.trips) ? data.trips : [];
  EXP_BRANDS = Array.isArray(data.brandChoices) ? data.brandChoices : [];
  EXP_EVENTS = Array.isArray(data.eventChoices) ? data.eventChoices : [];
}

function loadExpensesView(forceReload) {
  expInjectStyle();
  expBuildSkeleton();
  if (EXP_LOADED && !forceReload) return;
  const listEl = document.getElementById('expList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="exp-empty">讀取中…</div>';
  expShowBanner('');
  expApiGet().then(data => {
    if (!expIsOk(data)) {
      EXP_LOADED = false;
      listEl.innerHTML = '';
      expShowBanner('讀取失敗：' + expEsc((data && data.error) || '未知錯誤'));
      return;
    }
    expApplyData(data);
    if (!EXP_TABLE_READY) expShowBanner('公司支出功能待 db push（資料表尚未建立），建好之後才能新增。');
    renderExpAll();
  }).catch(err => {
    EXP_LOADED = false;
    listEl.innerHTML = '';
    expShowBanner('公司支出暫時連不上後端：' + expEsc(err.message || '') + '。請稍後按「重新整理」。');
    const t = document.getElementById('expTrips');
    if (t) t.innerHTML = '';
  });
}

// ===== 渲染 =====
function renderExpAll() {
  renderExpTrips();
  renderExpFilters();
  renderExpList();
}

function renderExpTrips() {
  const box = document.getElementById('expTrips');
  if (!box) return;
  if (!EXP_TRIPS.length) {
    box.innerHTML = '<div class="exp-empty" style="grid-column:1 / -1; padding:10px;">還沒有出差紀錄</div>';
    return;
  }
  box.innerHTML = EXP_TRIPS.map(t => {
    const period = (t.startDate || t.endDate) ? expEsc((t.startDate || '?') + ' ～ ' + (t.endDate || '?')) : '未填期間';
    const att = Array.isArray(t.attachments) ? t.attachments.length : 0;
    return '<div class="exp-trip' + (EXP_FILTER.trip === t.id ? ' on' : '') + '" data-id="' + expEsc(t.id) + '">' +
      '<div class="exp-trip-t">' + expEsc(t.title) + '</div>' +
      '<div class="exp-trip-m">' + period + (t.location ? '　' + expEsc(t.location) : '') + '</div>' +
      '<div class="exp-trip-m">' + (t.expenseCount || 0) + ' 筆　<span class="exp-trip-total">' + expMoney('TWD', t.totalTwd || 0) + '</span>' +
        (att ? '　<span class="exp-clipn">' + EXP_ICON.clip + att + '</span>' : '') + '</div>' +
      (EXP_RECORDS_READY ? '<div class="exp-trip-m">素材 ' + (t.assetCount || 0) + '　發文與產出 ' + (t.postCount || 0) + '</div>' : '') +
      '<div class="exp-trip-b"><button type="button" class="task-mini-btn" data-act="edit">' + EXP_ICON.pencil + '編輯</button></div>' +
      '</div>';
  }).join('');
}

function renderExpFilters() {
  const box = document.getElementById('expFilters');
  if (!box) return;
  const months = [...new Set(EXP_LIST.map(e => (e.expenseDate || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  box.innerHTML =
    '<select id="expFiltMonth" aria-label="月份"><option value="">全部月份</option>' +
      months.map(m => '<option value="' + m + '"' + (EXP_FILTER.month === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>' +
    '<select id="expFiltCat" aria-label="類別"><option value="">全部類別</option>' +
      EXP_CATEGORIES.map(c => '<option value="' + c[0] + '"' + (EXP_FILTER.category === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') + '</select>' +
    '<select id="expFiltTrip" aria-label="出差"><option value="">全部出差</option>' +
      EXP_TRIPS.map(t => '<option value="' + expEsc(t.id) + '"' + (EXP_FILTER.trip === t.id ? ' selected' : '') + '>' + expEsc(t.title) + '</option>').join('') + '</select>' +
    '<label class="exp-chk"><input type="checkbox" id="expFiltUnreimb"' + (EXP_FILTER.unreimbursed ? ' checked' : '') + '>只看未歸墊</label>';
}

function expFiltered() {
  const f = EXP_FILTER;
  return EXP_LIST.filter(e => {
    if (f.month && (e.expenseDate || '').slice(0, 7) !== f.month) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.trip && e.tripId !== f.trip) return false;
    if (f.unreimbursed && !(e.paidBy === 'personal' && !e.reimbursed)) return false;
    return true;
  });
}

function renderExpList() {
  const box = document.getElementById('expList');
  if (!box) return;
  const rows = expFiltered();
  if (!rows.length) {
    box.innerHTML = '<div class="exp-empty">' + (EXP_LIST.length ? '沒有符合條件的支出' : '還沒有支出紀錄') + '</div>';
    return;
  }
  // 依月份分組（資料本來就依日期新→舊，這裡保序）
  const groups = [];
  rows.forEach(e => {
    const m = (e.expenseDate || '').slice(0, 7) || '未填日期';
    let g = groups[groups.length - 1];
    if (!g || g.month !== m) { g = { month: m, items: [] }; groups.push(g); }
    g.items.push(e);
  });
  box.innerHTML = groups.map(g => {
    let twd = 0, unconv = 0;
    g.items.forEach(e => { const v = expTwdOf(e); if (v === null) unconv++; else twd += v; });
    const sum = '<span class="s">' + g.items.length + ' 筆　台幣 ' + expMoney('TWD', twd) + (unconv ? '（另有 ' + unconv + ' 筆外幣未換算）' : '') + '</span>';
    return '<div class="exp-month"><span>' + expEsc(g.month) + '</span>' + sum + '</div>' + g.items.map(expRowHtml).join('');
  }).join('');
}

function expRowHtml(e) {
  const rc = Array.isArray(e.receipts) ? e.receipts.length : 0;
  const pills = [];
  pills.push('<span class="exp-pill">' + expEsc(expCatLabel(e.category)) + '</span>');
  if (e.paidBy === 'personal') {
    pills.push(e.reimbursed
      ? '<span class="exp-pill ok">代墊・已歸墊</span>'
      : '<span class="exp-pill warn">代墊・未歸墊' + (e.payerName ? '（' + expEsc(e.payerName) + '）' : '') + '</span>');
  }
  const binds = [];
  if (e.brandName) binds.push('品牌：' + e.brandName);
  if (e.eventTitle) binds.push('團購：' + e.eventTitle);
  if (e.tripTitle) binds.push('出差：' + e.tripTitle);
  const twd = expTwdOf(e);
  let twdLine = '';
  if (e.currency !== 'TWD') twdLine = '<div class="exp-r-twd">' + (twd === null ? '未換算台幣' : '約 ' + expMoney('TWD', twd)) + '</div>';
  return '<div class="exp-row" data-id="' + expEsc(e.id) + '" role="button" tabindex="0">' +
    '<div class="exp-r-l">' +
      '<div class="exp-r-top"><span>' + expEsc(e.expenseDate || '') + '</span>' + pills.join('') +
        (rc ? '<span class="exp-clipn" title="收據 ' + rc + ' 份">' + EXP_ICON.clip + rc + '</span>' : '') + '</div>' +
      '<div class="exp-r-item">' + expEsc(e.item) + '</div>' +
      (e.vendor ? '<div class="exp-r-sub">' + expEsc(e.vendor) + '</div>' : '') +
      (binds.length ? '<div class="exp-r-sub">' + binds.map(expEsc).join('　') + '</div>' : '') +
    '</div>' +
    '<div class="exp-r-r"><div class="exp-r-amt">' + expMoney(e.currency, e.amount) + '</div>' + twdLine + '</div>' +
    '</div>';
}

// ===== 支出視窗 =====
function expSyncCurrencyUi() {
  const foreign = document.getElementById('expfCur').value !== 'TWD';
  document.getElementById('expfTwdBox').style.visibility = foreign ? 'visible' : 'hidden';
}
function expSyncPaidUi() {
  document.getElementById('expfPersonalBox').style.display = document.getElementById('expfPaidBy').value === 'personal' ? 'block' : 'none';
}
function expFillBrandList() {
  document.getElementById('expBrandList').innerHTML = EXP_BRANDS.map(b => '<option value="' + expEsc(b.name) + '"></option>').join('');
}
function expFillEventSelect(sel, rec, elId) {
  let list = EXP_EVENTS.slice();
  if (rec && rec.eventId && !list.some(x => x.id === rec.eventId)) list.unshift({ id: rec.eventId, title: rec.eventTitle || '（已綁定的團購）', startDate: '' });
  document.getElementById(elId || 'expfEvent').innerHTML = '<option value="">不綁團購</option>' +
    list.map(x => '<option value="' + expEsc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' +
      expEsc((x.startDate ? x.startDate + ' ' : '') + x.title) + '</option>').join('');
}

function openExpEditModal(rec) {
  EXP_EDIT_ID = rec ? rec.id : null;
  document.getElementById('expEditTitle').textContent = rec ? '編輯支出' : '新增支出';
  document.getElementById('expDeleteBtn').style.display = rec ? 'inline-block' : 'none';
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('expfDate', rec ? rec.expenseDate : expToday());
  v('expfCat', rec ? rec.category : 'other');
  v('expfItem', rec ? rec.item : '');
  v('expfVendor', rec ? rec.vendor : '');
  v('expfAmount', rec ? rec.amount : '');
  v('expfCur', rec ? rec.currency : 'TWD');
  v('expfTwd', rec ? rec.twdAmount : '');
  v('expfPaidBy', rec ? rec.paidBy : 'company');
  v('expfPayer', rec ? rec.payerName : '');
  document.getElementById('expfReimb').checked = !!(rec && rec.reimbursed);
  v('expfReimbAt', rec ? rec.reimbursedAt : '');
  v('expfRType', rec ? rec.receiptType : 'none');
  v('expfBrand', rec ? (rec.brandName || '') : '');
  v('expfNote', rec ? rec.note : '');
  expFillBrandList();
  expFillEventSelect(rec ? rec.eventId : '', rec);
  document.getElementById('expfTrip').innerHTML = '<option value="">不綁出差</option>' +
    EXP_TRIPS.map(t => '<option value="' + expEsc(t.id) + '"' + (rec && rec.tripId === t.id ? ' selected' : '') + '>' + expEsc(t.title) + '</option>').join('');
  // 新增時，若目前篩選了某趟出差，順手預選
  if (!rec && EXP_FILTER.trip) document.getElementById('expfTrip').value = EXP_FILTER.trip;
  EXP_RECEIPT_UP.setItems(rec ? rec.receipts : []);
  expSyncCurrencyUi();
  expSyncPaidUi();
  const st = document.getElementById('expEditStatus');
  st.textContent = ''; st.className = 'form-status';
  document.getElementById('expEditModal').classList.add('show');
}
function closeExpEditModal() {
  document.getElementById('expEditModal').classList.remove('show');
  EXP_EDIT_ID = null;
}

async function expSaveExpense() {
  const val = id => document.getElementById(id).value.trim();
  const st = document.getElementById('expEditStatus');
  const fail = msg => { st.textContent = msg; st.className = 'form-status error'; };
  if (!val('expfDate')) return fail('請填日期');
  if (!val('expfItem')) return fail('請填項目');
  const amount = Number(val('expfAmount'));
  if (val('expfAmount') === '' || !isFinite(amount) || amount < 0) return fail('請填正確金額');
  if (EXP_RECEIPT_UP.busy()) return fail('收據還在上傳中，請稍候再儲存');
  if (EXP_RECEIPT_UP.hasError()) return fail('有收據上傳失敗，請先移除失敗的檔案（或重新選擇）再儲存');

  const cur = document.getElementById('expfCur').value;
  const twdRaw = val('expfTwd');
  const paidBy = document.getElementById('expfPaidBy').value;
  const reimbursed = paidBy === 'personal' && document.getElementById('expfReimb').checked;

  // 品牌：輸入的文字必須對到品牌清單的某一筆
  const brandName = val('expfBrand');
  let brandId = null;
  if (brandName) {
    const b = EXP_BRANDS.find(x => x.name === brandName) ||
      EXP_BRANDS.find(x => String(x.name).toLowerCase() === brandName.toLowerCase());
    if (!b) return fail('品牌「' + brandName + '」不在品牌庫，請從下拉選一個（或清空不綁）');
    brandId = b.id;
  }

  const payload = {
    expenseDate: val('expfDate'),
    category: document.getElementById('expfCat').value,
    item: val('expfItem'),
    vendor: val('expfVendor'),
    amount,
    currency: cur,
    twdAmount: (cur !== 'TWD' && twdRaw !== '' && isFinite(Number(twdRaw))) ? Number(twdRaw) : null,
    paidBy,
    payerName: paidBy === 'personal' ? val('expfPayer') : '',
    reimbursed,
    reimbursedAt: reimbursed && val('expfReimbAt') ? val('expfReimbAt') : null,
    receiptType: document.getElementById('expfRType').value,
    receipts: EXP_RECEIPT_UP.getSaved(),
    brandId,
    eventId: document.getElementById('expfEvent').value || null,
    tripId: document.getElementById('expfTrip').value || null,
    note: val('expfNote')
  };
  if (EXP_EDIT_ID) payload.id = EXP_EDIT_ID;

  const btn = document.getElementById('expSaveBtn');
  btn.disabled = true;
  st.textContent = '儲存中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-upsert', payload);
    if (!expIsOk(res)) throw new Error((res && res.error) || '儲存失敗');
    closeExpEditModal();
    loadExpensesView(true);
  } catch (err) {
    fail('儲存失敗：' + err.message);
  }
  btn.disabled = false;
}

async function expDeleteExpense() {
  if (!EXP_EDIT_ID) return;
  if (!confirm('確定要刪除這筆支出嗎？收據檔案也會一併刪除。')) return;
  const st = document.getElementById('expEditStatus');
  const btn = document.getElementById('expDeleteBtn');
  btn.disabled = true;
  st.textContent = '刪除中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-delete', { id: EXP_EDIT_ID });
    if (!expIsOk(res)) throw new Error((res && res.error) || '刪除失敗');
    closeExpEditModal();
    loadExpensesView(true);
  } catch (err) {
    st.textContent = '刪除失敗：' + err.message; st.className = 'form-status error';
  }
  btn.disabled = false;
}

// ===== 出差視窗 =====
function openExpTripModal(rec) {
  EXP_TRIP_EDIT_ID = rec ? rec.id : null;
  document.getElementById('expTripTitle').textContent = rec ? '編輯出差' : '新增出差';
  document.getElementById('expTripDeleteBtn').style.display = rec ? 'inline-block' : 'none';
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('exptTitle', rec ? rec.title : '');
  v('exptStart', rec ? rec.startDate : '');
  v('exptEnd', rec ? rec.endDate : '');
  v('exptLoc', rec ? rec.location : '');
  v('exptNote', rec ? rec.note : '');
  EXP_TRIP_UP.setItems(rec ? rec.attachments : []);
  const st = document.getElementById('expTripStatus');
  st.textContent = ''; st.className = 'form-status';
  EXP_TRIP_SEC = 'basic';
  document.getElementById('exptImpRes').innerHTML = '';
  expRenderTripSections();
  expLoadImportSources();
  document.getElementById('expTripModal').classList.add('show');
}
function closeExpTripModal() {
  document.getElementById('expTripModal').classList.remove('show');
  closeExpAssetModal();
  closeExpPostModal();
  EXP_TRIP_EDIT_ID = null;
}

async function expSaveTrip() {
  const val = id => document.getElementById(id).value.trim();
  const st = document.getElementById('expTripStatus');
  const fail = msg => { st.textContent = msg; st.className = 'form-status error'; };
  if (!val('exptTitle')) return fail('請填標題');
  if (val('exptStart') && val('exptEnd') && val('exptEnd') < val('exptStart')) return fail('結束日不能早於開始日');
  if (EXP_TRIP_UP.busy()) return fail('附件還在上傳中，請稍候再儲存');
  if (EXP_TRIP_UP.hasError()) return fail('有附件上傳失敗，請先移除失敗的檔案（或重新選擇）再儲存');
  const payload = {
    title: val('exptTitle'),
    startDate: val('exptStart') || null,
    endDate: val('exptEnd') || null,
    location: val('exptLoc'),
    note: val('exptNote'),
    attachments: EXP_TRIP_UP.getSaved()
  };
  if (EXP_TRIP_EDIT_ID) payload.id = EXP_TRIP_EDIT_ID;
  const btn = document.getElementById('expTripSaveBtn');
  btn.disabled = true;
  st.textContent = '儲存中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-trip-upsert', payload);
    if (!expIsOk(res)) throw new Error((res && res.error) || '儲存失敗');
    closeExpTripModal();
    loadExpensesView(true);
  } catch (err) {
    fail('儲存失敗：' + err.message);
  }
  btn.disabled = false;
}

async function expDeleteTrip() {
  if (!EXP_TRIP_EDIT_ID) return;
  if (!confirm('確定要刪除這趟出差嗎？附件檔案也會一併刪除。')) return;
  const st = document.getElementById('expTripStatus');
  const btn = document.getElementById('expTripDeleteBtn');
  btn.disabled = true;
  st.textContent = '刪除中…'; st.className = 'form-status';
  try {
    let res = await expApiPost('expense-trip-delete', { id: EXP_TRIP_EDIT_ID });
    if (res && res.ok === false && res.count) {
      // 底下還有支出：二次確認後 force（支出只是脫離出差，不會被刪）
      if (!confirm((res.error || '這趟出差底下還有支出') + '\n\n仍要刪除這趟出差嗎？（底下的支出不會被刪，只是不再歸在這趟出差）')) {
        st.textContent = ''; btn.disabled = false; return;
      }
      res = await expApiPost('expense-trip-delete', { id: EXP_TRIP_EDIT_ID, force: true });
    }
    if (!expIsOk(res)) throw new Error((res && res.error) || '刪除失敗');
    if (EXP_FILTER.trip === EXP_TRIP_EDIT_ID) EXP_FILTER.trip = '';
    closeExpTripModal();
    loadExpensesView(true);
  } catch (err) {
    st.textContent = '刪除失敗：' + err.message; st.className = 'form-status error';
  }
  btn.disabled = false;
}

// ===================================================================
// 出差紀錄（docs/20）：出差視窗四區（基本／行程／素材／發文與產出）＋從旅遊頁匯入
// 資料全來自 GET 的 trips[].itinerary／assets／posts；寫入打 expense-asset-*／expense-post-*／expense-trip-import
// recordsReady:false（新表還沒 db push）→ 行程／素材／發文三區顯示黃色橫幅並擋寫入
// ===================================================================
const EXP_ITIN_ICON = {
  food: '<path d="M7 3v7"/><path d="M4.5 3v4a2.5 2.5 0 0 0 5 0V3"/><path d="M7 10v11"/><path d="M17 3c-2.2 1.6-3 4-3 7h3v11"/>',
  transport: '<rect x="4" y="4" width="16" height="13" rx="3"/><path d="M4 11h16"/><circle cx="8.5" cy="19.5" r="1.2"/><circle cx="15.5" cy="19.5" r="1.2"/>',
  sight: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/>',
  fun: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/>',
  shop: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  stay: '<path d="M3.5 19V6"/><path d="M3.5 15h17v4"/><path d="M20.5 15v-2.5a3 3 0 0 0-3-3H10v5.5"/>',
  other: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'
};
function expItinIcon(cat) {
  const key = EXP_ITIN_ICON[cat] ? cat : 'other';
  return '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + EXP_ITIN_ICON[key] + '</svg>';
}
const EXP_LINK_ICON = '<svg class="exp-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

function expKindLabel(list, v) { const f = list.find(c => c[0] === v); return f ? f[1] : (v || ''); }
function expSafeHttp(u) { return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : ''; }
function expCurTrip() { return EXP_TRIPS.find(t => t.id === EXP_TRIP_EDIT_ID) || null; }
function expTripAssets(t) { return t && Array.isArray(t.assets) ? t.assets : []; }
function expTripPosts(t) { return t && Array.isArray(t.posts) ? t.posts : []; }
function expTripItin(t) { return t && Array.isArray(t.itinerary) ? t.itinerary : []; }
function expSortByDate(list, key) {
  return list.slice().sort((a, b) =>
    String(a[key] || '9999').localeCompare(String(b[key] || '9999')) || (Number(a.sort) || 0) - (Number(b.sort) || 0));
}
function expRecordsBlocked() {
  if (!EXP_RECORDS_READY) { alert('出差紀錄功能待 db push（migration 20261021120000），資料表建好之後才能新增或修改。'); return true; }
  return false;
}
function expWarnBanner(html) { return '<div class="exp-banner warn">' + EXP_ICON.warn + ' ' + html + '</div>'; }
function expNeedSaveHint() { return '<div class="exp-empty">請先在「基本」區儲存這趟出差，才能使用這一區。</div>'; }

// 品牌輸入文字 → 品牌 id（空字串＝不綁）
function expResolveBrand(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: true, id: null };
  const b = EXP_BRANDS.find(x => x.name === n) || EXP_BRANDS.find(x => String(x.name).toLowerCase() === n.toLowerCase());
  if (!b) return { ok: false, msg: '品牌「' + n + '」不在品牌庫，請從下拉選一個（或清空不綁）' };
  return { ok: true, id: b.id };
}
// 確保綁團下拉裡有這個選項（建議綁定的團可能不在 eventChoices 內）
function expEnsureEventOption(selId, id, title) {
  const sel = document.getElementById(selId);
  if (!sel || !id) return;
  if (!Array.from(sel.options).some(o => o.value === id)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = title || '（已綁定的團購）';
    sel.appendChild(o);
  }
  sel.value = id;
}
// 「建議綁 XX ›」按鈕：點了立刻寫 eventId（partial upsert），成功後把下拉同步成該團
function expRenderSuggest(boxId, rec, selId, upsertType) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const sg = rec && !rec.eventId && rec.suggestedEvent;
  if (!sg || !sg.id) { box.innerHTML = ''; return; }
  box.innerHTML = '<button type="button" class="task-mini-btn" data-sg="1">建議綁「' + expEsc(sg.title || '') +
    '」' + (sg.startDate ? '（' + expEsc(sg.startDate) + ' 開團）' : '') + ' ›</button>';
  box.querySelector('[data-sg]').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    if (expRecordsBlocked()) return;
    btn.disabled = true;
    try {
      const res = await expApiPost(upsertType, { id: rec.id, eventId: sg.id });
      if (!expIsOk(res)) throw new Error((res && res.error) || '綁定失敗');
      expEnsureEventOption(selId, sg.id, sg.title);
      rec.eventId = sg.id; rec.eventTitle = sg.title;
      box.innerHTML = '';
      expRefreshOpenTrip().catch(() => {});
    } catch (err) {
      btn.disabled = false;
      alert('綁定失敗：' + err.message);
    }
  });
}

// ===== 出差視窗：分區切換與渲染 =====
function expSwitchTripSec(sec) {
  EXP_TRIP_SEC = sec;
  expRenderTripSections();
}
function expRenderTripSections() {
  const t = expCurTrip();
  const tabs = document.getElementById('exptTabs');
  if (!tabs) return;
  const counts = { itin: expTripItin(t).length, assets: expTripAssets(t).length, posts: expTripPosts(t).length };
  tabs.innerHTML = EXP_TRIP_SECS.map(s =>
    '<button type="button" class="lot-status-chip' + (EXP_TRIP_SEC === s[0] ? ' on' : '') + '" data-sec="' + s[0] + '">' +
    expEsc(s[1]) + (t && s[0] !== 'basic' ? ' ' + counts[s[0]] : '') + '</button>').join('');
  const ids = { basic: 'exptSecBasic', itin: 'exptSecItin', assets: 'exptSecAssets', posts: 'exptSecPosts' };
  Object.keys(ids).forEach(k => { document.getElementById(ids[k]).style.display = k === EXP_TRIP_SEC ? 'block' : 'none'; });
  const warn = !EXP_RECORDS_READY ? expWarnBanner('出差紀錄功能待 db push（資料表尚未建立），建好之後才能新增或修改。') : '';
  ['exptBnItin', 'exptBnAssets', 'exptBnPosts'].forEach(id => { document.getElementById(id).innerHTML = warn; });
  if (EXP_TRIP_SEC === 'itin') expRenderItinerary(t);
  else if (EXP_TRIP_SEC === 'assets') expRenderAssets(t);
  else if (EXP_TRIP_SEC === 'posts') expRenderPosts(t);
}

function expWeekday(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return '週' + '日一二三四五六'[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
}
function expDayNo(t, iso) {
  if (!t || !t.startDate || !iso) return '';
  const a = new Date(t.startDate + 'T00:00:00'), b = new Date(iso + 'T00:00:00');
  const n = Math.round((b - a) / 86400000) + 1;
  return n >= 1 && n <= 60 ? 'Day ' + n + '　' : '';
}

function expRenderItinerary(t) {
  const box = document.getElementById('exptItin');
  if (!t) { box.innerHTML = expNeedSaveHint(); return; }
  const list = expTripItin(t).slice().sort((a, b) =>
    String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));
  if (!list.length) {
    box.innerHTML = '<div class="exp-empty">還沒有行程。請先到「基本」區用「從旅遊頁匯入」帶進每日行程。</div>';
    return;
  }
  const groups = [];
  list.forEach(it => {
    const d = it.date || '';
    let g = groups[groups.length - 1];
    if (!g || g.date !== d) { g = { date: d, items: [] }; groups.push(g); }
    g.items.push(it);
  });
  box.innerHTML = groups.map(g =>
    '<div class="exp-it-day">' + expEsc(expDayNo(t, g.date)) + (g.date ? expEsc(g.date) + '（' + expWeekday(g.date) + '）' : '未填日期') + '</div>' +
    g.items.map(it => {
      const url = expSafeHttp(it.url);
      const title = url ? '<a href="' + expEsc(url) + '" target="_blank" rel="noopener">' + expEsc(it.title || '') + '</a>' : expEsc(it.title || '');
      return '<div class="exp-it-row">' +
        '<span class="exp-it-time">' + expEsc(it.time || '—') + '</span>' +
        '<span class="exp-it-ic" title="' + expEsc(expKindLabel(EXP_ITIN_CATS, it.cat)) + '">' + expItinIcon(it.cat) + '</span>' +
        '<span><div class="exp-it-t">' + title + '</div>' + (it.place ? '<div class="exp-it-p">' + expEsc(it.place) + '</div>' : '') + '</span>' +
        '</div>';
    }).join('')
  ).join('');
}

// ----- 素材 -----
function expRenderAssets(t) {
  const tools = document.getElementById('exptAssetTools');
  const box = document.getElementById('exptAssets');
  if (!t) { tools.style.display = 'none'; box.innerHTML = expNeedSaveHint(); return; }
  tools.style.display = EXP_RECORDS_READY ? 'flex' : 'none';
  const list = expSortByDate(expTripAssets(t), 'assetDate');
  if (!list.length) { box.innerHTML = '<div class="exp-empty">還沒有素材。按「上傳素材」選照片，或用基本區的「從旅遊頁匯入」帶進隨手拍。</div>'; return; }
  const noBrand = list.filter(a => !a.brandId).length;
  const groups = [];
  list.forEach(a => {
    const d = a.assetDate || '';
    let g = groups[groups.length - 1];
    if (!g || g.date !== d) { g = { date: d, items: [] }; groups.push(g); }
    g.items.push(a);
  });
  box.innerHTML =
    (noBrand ? '<div class="exp-hint" style="margin-top:8px;">還有 ' + noBrand + ' 張素材沒綁品牌（紅字標示）。</div>' : '') +
    groups.map(g =>
      '<div class="exp-it-day">' + (g.date ? expEsc(g.date) + '（' + expWeekday(g.date) + '）' : '未填日期') + '　' + g.items.length + ' 張</div>' +
      '<div class="exp-assets">' + g.items.map(a =>
        '<div class="exp-as' + (a.inReport === false ? ' off' : '') + '" data-id="' + expEsc(a.id) + '" role="button" tabindex="0" title="' + expEsc(a.name || '') + '">' +
          '<div class="exp-as-th">' + (a.path ? '<img alt="" data-exp-apath="' + expEsc(a.path) + '">' : EXP_ICON.img) + '</div>' +
          '<span class="exp-as-ty">' + expEsc(expKindLabel(EXP_ASSET_KINDS, a.kind)) + '</span>' +
          '<div class="exp-as-nm' + (a.brandId ? '' : ' warn') + '">' + expEsc(a.brandId ? (a.brandName || '') + (a.product ? '・' + a.product : '') : '未綁品牌') + '</div>' +
        '</div>').join('') + '</div>').join('');
  // 縮圖：簽名網址 600 秒，最多同時 4 張一起要
  const imgs = Array.from(box.querySelectorAll('img[data-exp-apath]'));
  let idx = 0;
  const worker = async () => {
    while (idx < imgs.length) {
      const img = imgs[idx++];
      try { img.src = await expSignedUrl(img.dataset.expApath); } catch (e) { /* 縮圖載不到就留空 */ }
    }
  };
  for (let i = 0; i < 4; i++) worker();
}

function expFileDate(file, t) {
  const d = new Date(file.lastModified || 0);
  if (!isFinite(d.getTime()) || !file.lastModified) return '';
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (t && t.startDate && iso < t.startDate) return '';
  if (t && t.endDate && iso > t.endDate) return '';
  return iso;
}
async function expUploadAssets(files) {
  const t = expCurTrip();
  if (!t) { alert('請先儲存這趟出差，再上傳素材。'); return; }
  if (expRecordsBlocked() || EXP_ASSET_UPLOADING) return;
  const st = document.getElementById('expaUpStatus');
  EXP_ASSET_UPLOADING = true;
  let ok = 0; const errs = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    st.textContent = '上傳中 ' + (i + 1) + '／' + files.length + '…';
    try {
      if (!(String(f.type).indexOf('image/') === 0 || expIsImageName(f.name))) throw new Error('素材只能上傳圖片（影片請截一張代表畫面）');
      const up = await expUploadOne(f, 'asset', t.id, EXP_ASSET_MAX_EDGE);
      if (up.localUrl) { try { URL.revokeObjectURL(up.localUrl); } catch (x) {} }
      const res = await expApiPost('expense-asset-upsert', {
        tripId: t.id, path: up.path, name: up.name, size: up.size,
        assetDate: expFileDate(f, t) || null, kind: 'travel', inReport: true
      });
      if (!expIsOk(res)) throw new Error((res && res.error) || '建立素材失敗');
      ok++;
    } catch (err) {
      errs.push(f.name + '：' + err.message);
    }
  }
  EXP_ASSET_UPLOADING = false;
  st.textContent = '完成 ' + ok + ' 張' + (errs.length ? '，失敗 ' + errs.length + ' 張' : '');
  if (errs.length) alert('以下素材上傳失敗：\n\n' + errs.join('\n'));
  try { await expRefreshOpenTrip(); } catch (err) { st.textContent += '（重新整理失敗：' + err.message + '）'; }
}

function expFillPostSelect(sel, tripId) {
  const t = EXP_TRIPS.find(x => x.id === tripId);
  const posts = expSortByDate(expTripPosts(t), 'postDate');
  document.getElementById('expaPost').innerHTML = '<option value="">不指定</option>' +
    posts.map(p => '<option value="' + expEsc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' +
      expEsc((p.postDate ? p.postDate + ' ' : '') + '[' + expKindLabel(EXP_POST_KINDS, p.kind) + '] ' + (p.title || '')) + '</option>').join('');
}
function openExpAssetModal(rec) {
  if (!rec) return;
  EXP_ASSET_EDIT_ID = rec.id;
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('expaDate', rec.assetDate);
  v('expaKind', rec.kind || 'travel');
  v('expaBrand', rec.brandName || '');
  v('expaProduct', rec.product);
  v('expaUrl', rec.externalUrl);
  v('expaNote', rec.note);
  document.getElementById('expaInReport').checked = rec.inReport !== false;
  expFillBrandList();
  expFillEventSelect(rec.eventId || '', rec, 'expaEvent');
  expFillPostSelect(rec.postId || '', rec.tripId || EXP_TRIP_EDIT_ID);
  expRenderSuggest('expaSuggest', rec, 'expaEvent', 'expense-asset-upsert');
  const prev = document.getElementById('expaPreview');
  if (rec.path) {
    prev.innerHTML = '<span class="exp-hint">載入預覽…</span>';
    prev.onclick = () => expOpenFile({ path: rec.path });
    expSignedUrl(rec.path).then(url => {
      if (EXP_ASSET_EDIT_ID !== rec.id) return;
      prev.innerHTML = '<img alt="" src="' + expEsc(url) + '">';
    }).catch(() => { prev.innerHTML = '<span class="exp-hint">預覽載入失敗</span>'; });
  } else {
    prev.innerHTML = '<span class="exp-hint">這筆素材沒有圖檔</span>';
    prev.onclick = null;
  }
  const st = document.getElementById('expaStatus');
  st.textContent = ''; st.className = 'form-status';
  document.getElementById('expAssetModal').classList.add('show');
}
function closeExpAssetModal() {
  const m = document.getElementById('expAssetModal');
  if (m) m.classList.remove('show');
  EXP_ASSET_EDIT_ID = null;
}
async function expSaveAsset() {
  if (!EXP_ASSET_EDIT_ID || expRecordsBlocked()) return;
  const val = id => document.getElementById(id).value.trim();
  const st = document.getElementById('expaStatus');
  const fail = msg => { st.textContent = msg; st.className = 'form-status error'; };
  const br = expResolveBrand(val('expaBrand'));
  if (!br.ok) return fail(br.msg);
  const url = val('expaUrl');
  if (url && !expSafeHttp(url)) return fail('影片原檔連結要以 http:// 或 https:// 開頭');
  const payload = {
    id: EXP_ASSET_EDIT_ID,
    assetDate: val('expaDate') || null,
    kind: document.getElementById('expaKind').value,
    brandId: br.id,
    product: val('expaProduct'),
    eventId: document.getElementById('expaEvent').value || null,
    postId: document.getElementById('expaPost').value || null,
    externalUrl: url,
    note: val('expaNote'),
    inReport: document.getElementById('expaInReport').checked
  };
  const btn = document.getElementById('expaSaveBtn');
  btn.disabled = true;
  st.textContent = '儲存中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-asset-upsert', payload);
    if (!expIsOk(res)) throw new Error((res && res.error) || '儲存失敗');
    closeExpAssetModal();
    await expRefreshOpenTrip();
  } catch (err) {
    fail('儲存失敗：' + err.message);
  }
  btn.disabled = false;
}
async function expDeleteAsset() {
  if (!EXP_ASSET_EDIT_ID || expRecordsBlocked()) return;
  if (!confirm('確定要刪除這張素材嗎？圖檔也會一併刪除。')) return;
  const st = document.getElementById('expaStatus');
  const btn = document.getElementById('expaDeleteBtn');
  btn.disabled = true;
  st.textContent = '刪除中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-asset-delete', { id: EXP_ASSET_EDIT_ID });
    if (!expIsOk(res)) throw new Error((res && res.error) || '刪除失敗');
    closeExpAssetModal();
    await expRefreshOpenTrip();
  } catch (err) {
    st.textContent = '刪除失敗：' + err.message; st.className = 'form-status error';
  }
  btn.disabled = false;
}

// ----- 發文與產出 -----
function expRenderPosts(t) {
  const box = document.getElementById('exptPosts');
  document.getElementById('exppAddBtn').style.display = t ? '' : 'none';
  if (!t) { box.innerHTML = expNeedSaveHint(); return; }
  const list = expSortByDate(expTripPosts(t), 'postDate');
  if (!list.length) { box.innerHTML = '<div class="exp-empty">還沒有發文或產出。貼文、影片、限動、開團、工具頁都可以記在這裡。</div>'; return; }
  box.innerHTML = list.map(p => {
    const url = expSafeHttp(p.url);
    const subs = [];
    subs.push(p.brandId ? '品牌：' + (p.brandName || '') : '未綁品牌');
    if (p.eventTitle) subs.push('團購：' + p.eventTitle);
    else if (p.suggestedEvent && p.suggestedEvent.title) subs.push('建議綁：' + p.suggestedEvent.title);
    if (p.trafficNote) subs.push('成效：' + p.trafficNote);
    return '<div class="exp-prow" data-id="' + expEsc(p.id) + '" role="button" tabindex="0">' +
      '<span class="d">' + expEsc(p.postDate || '未填日期') + '</span>' +
      '<span class="exp-pill">' + expEsc(expKindLabel(EXP_POST_KINDS, p.kind)) + '</span>' +
      '<span class="t">' + expEsc(p.title || '') + '</span>' +
      (url ? '<a class="exp-lk" href="' + expEsc(url) + '" target="_blank" rel="noopener" title="開啟連結" aria-label="開啟連結">' + EXP_LINK_ICON + '</a>' : '') +
      '<span class="s">' + subs.map(expEsc).join('　') + '</span>' +
      '</div>';
  }).join('');
}
function openExpPostModal(rec) {
  EXP_POST_EDIT_ID = rec ? rec.id : null;
  document.getElementById('exppTitleH').textContent = rec ? '編輯發文／產出' : '新增發文／產出';
  document.getElementById('exppDeleteBtn').style.display = rec ? 'inline-block' : 'none';
  const v = (id, val) => { document.getElementById(id).value = (val === undefined || val === null) ? '' : val; };
  v('exppDate', rec ? rec.postDate : expToday());
  v('exppKind', rec ? rec.kind : 'post');
  v('exppTitle', rec ? rec.title : '');
  v('exppUrl', rec ? rec.url : '');
  v('exppBrand', rec ? (rec.brandName || '') : '');
  v('exppTraffic', rec ? rec.trafficNote : '');
  v('exppNote', rec ? rec.note : '');
  expFillBrandList();
  expFillEventSelect(rec ? rec.eventId : '', rec, 'exppEvent');
  expRenderSuggest('exppSuggest', rec, 'exppEvent', 'expense-post-upsert');
  const st = document.getElementById('exppStatus');
  st.textContent = ''; st.className = 'form-status';
  document.getElementById('expPostModal').classList.add('show');
}
function closeExpPostModal() {
  const m = document.getElementById('expPostModal');
  if (m) m.classList.remove('show');
  EXP_POST_EDIT_ID = null;
}
async function expSavePost() {
  if (expRecordsBlocked()) return;
  const t = expCurTrip();
  if (!t) return;
  const val = id => document.getElementById(id).value.trim();
  const st = document.getElementById('exppStatus');
  const fail = msg => { st.textContent = msg; st.className = 'form-status error'; };
  if (!val('exppTitle')) return fail('請填標題');
  const br = expResolveBrand(val('exppBrand'));
  if (!br.ok) return fail(br.msg);
  const url = val('exppUrl');
  if (url && !expSafeHttp(url)) return fail('網址要以 http:// 或 https:// 開頭');
  const payload = {
    tripId: t.id,
    postDate: val('exppDate') || null,
    kind: document.getElementById('exppKind').value,
    title: val('exppTitle'),
    url,
    brandId: br.id,
    eventId: document.getElementById('exppEvent').value || null,
    trafficNote: val('exppTraffic'),
    note: val('exppNote')
  };
  if (EXP_POST_EDIT_ID) payload.id = EXP_POST_EDIT_ID;
  const btn = document.getElementById('exppSaveBtn');
  btn.disabled = true;
  st.textContent = '儲存中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-post-upsert', payload);
    if (!expIsOk(res)) throw new Error((res && res.error) || '儲存失敗');
    closeExpPostModal();
    await expRefreshOpenTrip();
  } catch (err) {
    fail('儲存失敗：' + err.message);
  }
  btn.disabled = false;
}
async function expDeletePost() {
  if (!EXP_POST_EDIT_ID || expRecordsBlocked()) return;
  if (!confirm('確定要刪除這筆發文／產出嗎？（素材不會被刪，只是不再指向它）')) return;
  const st = document.getElementById('exppStatus');
  const btn = document.getElementById('exppDeleteBtn');
  btn.disabled = true;
  st.textContent = '刪除中…'; st.className = 'form-status';
  try {
    const res = await expApiPost('expense-post-delete', { id: EXP_POST_EDIT_ID });
    if (!expIsOk(res)) throw new Error((res && res.error) || '刪除失敗');
    closeExpPostModal();
    await expRefreshOpenTrip();
  } catch (err) {
    st.textContent = '刪除失敗：' + err.message; st.className = 'form-status error';
  }
  btn.disabled = false;
}

// ----- 從旅遊頁匯入 -----
async function expLoadImportSources() {
  const box = document.getElementById('exptImpBox');
  const sel = document.getElementById('exptImpSel');
  const btn = document.getElementById('exptImpBtn');
  const tripId = EXP_TRIP_EDIT_ID;
  if (!tripId) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  sel.disabled = true; btn.disabled = true;
  sel.innerHTML = '<option value="">讀取旅遊頁清單…</option>';
  try {
    const res = await expApiPost('expense-trip-sources', {});
    if (EXP_TRIP_EDIT_ID !== tripId) return;
    if (!expIsOk(res)) throw new Error((res && res.error) || '讀取失敗');
    const list = Array.isArray(res.sources) ? res.sources : [];
    if (!list.length) { sel.innerHTML = '<option value="">（找不到旅遊頁資料）</option>'; return; }
    const cur = expCurTrip();
    const want = cur && cur.sourceKey ? cur.sourceKey : '';
    sel.innerHTML = list.map(s =>
      '<option value="' + expEsc(s.key) + '"' + (s.key === want ? ' selected' : '') + '>' +
      expEsc((s.title || s.key) + '　' + (s.start || '?') + '～' + (s.end || '?') + '（' + (s.itemCount || 0) + ' 筆記帳）') + '</option>').join('');
    sel.disabled = false; btn.disabled = false;
  } catch (err) {
    if (EXP_TRIP_EDIT_ID !== tripId) return;
    sel.innerHTML = '<option value="">（讀不到旅遊頁清單）</option>';
    document.getElementById('exptImpRes').innerHTML = '<span style="color:#B5485A;">讀取旅遊頁清單失敗：' + expEsc(err.message) + '</span>';
  }
}
async function expRunImport() {
  const tripId = EXP_TRIP_EDIT_ID;
  if (!tripId || expRecordsBlocked()) return;
  const sel = document.getElementById('exptImpSel');
  const btn = document.getElementById('exptImpBtn');
  const out = document.getElementById('exptImpRes');
  const key = sel.value;
  if (!key) { out.innerHTML = '<span style="color:#B5485A;">請先選一份旅遊頁資料</span>'; return; }
  const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : key;
  if (!confirm('從旅遊頁「' + label + '」匯入到這趟出差？\n\n' +
    '．只會新增尚未匯入的支出和素材；已匯入過的不會被覆蓋\n' +
    '．只匯入公司負擔的部分（個人消費不匯）\n' +
    '．行程會整批更新成旅遊頁目前的內容')) return;
  btn.disabled = true; sel.disabled = true;
  const oldHtml = btn.innerHTML;
  btn.textContent = '匯入中…';
  out.innerHTML = '';
  try {
    const res = await expApiPost('expense-trip-import', { tripId, sourceKey: key });
    if (!expIsOk(res)) throw new Error((res && res.error) || '匯入失敗');
    const ad = res.added || {}, sk = res.skipped || {};
    const warns = Array.isArray(res.warnings) ? res.warnings : [];
    out.innerHTML =
      '<div>新增 ' + (ad.expenses || 0) + ' 筆支出、' + (ad.assets || 0) + ' 張素材；行程 ' + (res.itinerary || 0) + ' 條。</div>' +
      '<div class="exp-hint">已存在而略過：支出 ' + (sk.expenses || 0) + ' 筆、素材 ' + (sk.assets || 0) + ' 張。</div>' +
      (warns.length ? '<div style="margin-top:4px;">警告 ' + warns.length + ' 則：</div><ul>' + warns.map(w => '<li>' + expEsc(w) + '</li>').join('') + '</ul>' : '');
    await expRefreshOpenTrip();
  } catch (err) {
    out.innerHTML = '<span style="color:#B5485A;">匯入失敗：' + expEsc(err.message) + '</span>';
  }
  btn.innerHTML = oldHtml;
  btn.disabled = false; sel.disabled = false;
}

// 就地重新抓資料（不關視窗）：更新清單與出差視窗各區；基本區日期欄是空的才補（匯入可能補了期間）
async function expRefreshOpenTrip() {
  const data = await expApiGet();
  if (!expIsOk(data)) throw new Error((data && data.error) || '重新整理失敗');
  expApplyData(data);
  renderExpAll();
  const t = expCurTrip();
  if (t) {
    const fillBlank = (id, val) => { const el = document.getElementById(id); if (el && !el.value && val) el.value = val; };
    fillBlank('exptStart', t.startDate);
    fillBlank('exptEnd', t.endDate);
    expRenderTripSections();
  }
}

// 事件掛載（骨架建好後呼叫一次）
function expWireRecords() {
  document.getElementById('exptTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-sec]');
    if (b) expSwitchTripSec(b.dataset.sec);
  });
  document.getElementById('exptImpBtn').addEventListener('click', expRunImport);
  document.getElementById('expaFile').addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) expUploadAssets(files);
  });
  document.getElementById('exptAssets').addEventListener('click', e => {
    const tile = e.target.closest('.exp-as');
    if (!tile) return;
    const rec = expTripAssets(expCurTrip()).find(a => a.id === tile.dataset.id);
    if (rec) openExpAssetModal(rec);
  });
  document.getElementById('exptPosts').addEventListener('click', e => {
    if (e.target.closest('a.exp-lk')) return;
    const row = e.target.closest('.exp-prow');
    if (!row) return;
    const rec = expTripPosts(expCurTrip()).find(p => p.id === row.dataset.id);
    if (rec) openExpPostModal(rec);
  });
  document.getElementById('exppAddBtn').addEventListener('click', () => { if (!expRecordsBlocked()) openExpPostModal(null); });
  document.getElementById('expaSaveBtn').addEventListener('click', expSaveAsset);
  document.getElementById('expaDeleteBtn').addEventListener('click', expDeleteAsset);
  document.getElementById('exppSaveBtn').addEventListener('click', expSavePost);
  document.getElementById('exppDeleteBtn').addEventListener('click', expDeletePost);
}

// 支出列可用鍵盤 Enter 開啟（列是 role=button）
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const cl = e.target && e.target.classList;
  const row = cl && (cl.contains('exp-row') || cl.contains('exp-as') || cl.contains('exp-prow')) ? e.target : null;
  if (row) row.click();
});
