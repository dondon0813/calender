// ===================================================================
// books.js — 繪本後台（書籍/延伸教材 CRUD、封面與教材圖片去背上傳）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同其他模組，
// 例如 accounting.js）。理由：admin.js 開機還原分頁時會在最外層同步呼叫
// switchView，若分頁剛好停在 books、本檔卻排在後面，開機當下 loadBooksView
// 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得直接呼叫 admin.js 的函式。
//
// 前身是獨立頁面 picture-books-admin.html（2026-08-17 上線，繪本系統當時
// 搶先建在新資料庫、admin.html 還沒切過去，只好先自己開一頁）；2026-08-20
// admin.html 也切到新資料庫後，改成這裡的原生分頁，跟其他分頁共用同一套
// 登入 session（currentToken）與 switchView 機制，不再有獨立的登入頁面。
// ===================================================================

const BOOKS_API_URL = 'https://dondon-platform.vercel.app/api/books';
const MAX_MATERIAL_BYTES = 50 * 1024 * 1024;

let PACKAGE_DATA = null; // 最近一次 GET ?all=1 的整包資料
let CURRENT_BOOK = null; // 目前正在編輯的書（含 id）或 null＝新增中
let materialFormEditingId = null; // 目前教材表單是編輯哪個教材（null＝新增）
let materialFormEditingBookIds = null; // 編輯中教材的掛載書單（教材庫；null＝新增或舊資料沒帶）
let setFormEditingId = null; // 目前套組表單是編輯哪個套組（null＝新增）

// ===== Toast =====
let toastTimer = null;
function showToast(msg, isError, durationMs) {
  const el = document.getElementById('pbaToast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), durationMs || 2600);
}

// ===== 登入逾時 =====
// 跟 admin.js 的 postTask() 用同一套處理方式（清 token、彈回密碼鎖），這樣繪本後台
// 逾時的體驗跟其他分頁完全一致——不是自己另外導頁或顯示登入表單。
function booksForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API 呼叫 =====
// timeoutMs 為選填（沒有共用逾時機制，之前所有呼叫都不帶逾時、行為不變；book-bg-remove 呼叫會帶 30 秒）。
async function apiPost(type, extra, timeoutMs) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(BOOKS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json();
  if (data && data.needLogin) {
    booksForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

async function loadPackage() {
  const res = await fetch(`${BOOKS_API_URL}?all=1&token=${encodeURIComponent(currentToken)}`, { cache: 'no-store' });
  const data = await res.json();
  if (!data || data.success !== true) {
    booksForceRelogin();
    return null;
  }
  // token 失效時後端會靜默降級成公開包（adminView=false），要當成未登入處理
  if (data.adminView !== true) {
    booksForceRelogin();
    return null;
  }
  return data;
}

// ===== 封面牆（預設畫面；模擬前台書牆，拖曳小圖改排序，放開即自動儲存）=====
function renderBookList() {
  const listEl = document.getElementById('bookList');
  listEl.innerHTML = '';
  const term = (document.getElementById('bookSearchInput').value || '').trim().toLowerCase();
  const hintEl = document.getElementById('bookGridHint');
  hintEl.textContent = term
    ? '搜尋中無法拖曳排序（清空搜尋後才是完整順序）'
    : '前台顯示順序＝這裡的順序。電腦按住封面拖曳、手機長按 0.3 秒後拖曳，放開自動儲存。';
  const books = (PACKAGE_DATA.books || []).filter(b => !term || (b.title || '').toLowerCase().includes(term));
  if (!books.length) {
    listEl.innerHTML = '<div class="pba-empty-list">沒有符合的繪本</div>';
    return;
  }
  books.forEach(b => {
    const card = document.createElement('div');
    card.className = 'pba-grid-card';
    card.dataset.bookId = b.id;

    if (b.cover_url) {
      const img = document.createElement('img');
      img.className = 'pba-grid-cover';
      img.src = b.cover_url;
      img.draggable = false;
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'pba-grid-cover placeholder';
      ph.textContent = '📖';
      card.appendChild(ph);
    }

    if (!b.is_published) {
      const badge = document.createElement('span');
      badge.className = 'pba-grid-badge pba-badge-draft';
      badge.textContent = '草稿';
      card.appendChild(badge);
    }

    const title = document.createElement('div');
    title.className = 'pba-grid-title';
    title.textContent = b.title;
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'pba-grid-meta';
    meta.textContent = `教材 ${(b.materials || []).length}・❤️ ${Number(b.likeCount) || 0}・👆 ${Number(b.clickCount) || 0}`;
    card.appendChild(meta);

    card.addEventListener('pointerdown', (e) => pbaDragPointerDown(e, card, b));
    listEl.appendChild(card);
  });
}

document.getElementById('bookSearchInput').addEventListener('input', renderBookList);

// ---- 拖曳排序 ----
// 點一下＝進編輯；拖曳（滑鼠移超過 6px；觸控長按 300ms，先動超過 10px＝在捲頁、放棄）＝改排序。
// 搜尋過濾中禁止拖曳（只看得到部分書，順序沒有意義）。放開後整批打 book-sort-set 存檔。
let pbaDrag = null;

function pbaDragPointerDown(e, card, book) {
  if (pbaDrag) return;
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  const filtering = !!(document.getElementById('bookSearchInput').value || '').trim();
  pbaDrag = {
    card, book, filtering,
    startX: e.clientX, startY: e.clientY,
    started: false, moved: false, timer: null,
    isTouch: e.pointerType !== 'mouse',
  };
  if (pbaDrag.isTouch && !filtering) {
    pbaDrag.timer = setTimeout(() => { if (pbaDrag && !pbaDrag.started && !pbaDrag.moved) pbaStartDrag(); }, 300);
  }
  document.addEventListener('pointermove', pbaDragMove);
  document.addEventListener('pointerup', pbaDragUp);
  document.addEventListener('pointercancel', pbaDragCancel);
}

function pbaBlockScroll(e) { e.preventDefault(); }

function pbaStartDrag() {
  pbaDrag.started = true;
  pbaDrag.card.classList.add('dragging');
  // 拖曳期間擋掉頁面捲動（touch-action 平常保持可捲，長按進入拖曳才鎖）
  document.addEventListener('touchmove', pbaBlockScroll, { passive: false });
}

function pbaDragMove(e) {
  if (!pbaDrag) return;
  const dx = e.clientX - pbaDrag.startX;
  const dy = e.clientY - pbaDrag.startY;
  const dist = Math.hypot(dx, dy);
  if (!pbaDrag.started) {
    if (!pbaDrag.isTouch && dist > 6 && !pbaDrag.filtering) pbaStartDrag();
    else if (dist > 10) { pbaDrag.moved = true; clearTimeout(pbaDrag.timer); } // 觸控在長按前就滑動＝捲頁
    if (!pbaDrag.started) return;
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest ? under.closest('.pba-grid-card') : null;
  if (!target || target === pbaDrag.card || target.parentElement !== pbaDrag.card.parentElement) return;
  const listEl = pbaDrag.card.parentElement;
  const cards = Array.from(listEl.children);
  const from = cards.indexOf(pbaDrag.card);
  const to = cards.indexOf(target);
  if (from < to) target.after(pbaDrag.card);
  else target.before(pbaDrag.card);
}

function pbaDragCleanup() {
  clearTimeout(pbaDrag && pbaDrag.timer);
  document.removeEventListener('pointermove', pbaDragMove);
  document.removeEventListener('pointerup', pbaDragUp);
  document.removeEventListener('pointercancel', pbaDragCancel);
  document.removeEventListener('touchmove', pbaBlockScroll);
  if (pbaDrag && pbaDrag.card) pbaDrag.card.classList.remove('dragging');
  pbaDrag = null;
}

function pbaDragCancel() {
  // 被系統中斷（例如瀏覽器接管捲動）：不存檔，重畫回資料裡的順序
  const started = pbaDrag && pbaDrag.started;
  pbaDragCleanup();
  if (started) renderBookList();
}

async function pbaDragUp(e) {
  if (!pbaDrag) return;
  const { card, book, started, moved } = pbaDrag;
  pbaDragCleanup();
  if (!started) {
    if (!moved) selectBook(book); // 沒拖＝單純點一下
    return;
  }
  const ids = Array.from(card.parentElement.querySelectorAll('.pba-grid-card')).map(el => el.dataset.bookId);
  const oldIds = (PACKAGE_DATA.books || []).map(b => b.id);
  if (ids.join() === oldIds.join()) return; // 拖了又放回原位
  // 先樂觀更新本地順序，失敗再畫回來
  const byId = {};
  (PACKAGE_DATA.books || []).forEach(b => { byId[b.id] = b; });
  PACKAGE_DATA.books = ids.map((id, i) => { const b = byId[id]; if (b) b.sort = i + 1; return b; }).filter(Boolean);
  try {
    const res = await apiPost('book-sort-set', { ids });
    if (!res || res.success !== true) {
      showToast('排序儲存失敗：' + ((res && res.error) || '未知錯誤'), true);
      PACKAGE_DATA.books = oldIds.map(id => byId[id]).filter(Boolean);
      renderBookList();
      return;
    }
    showToast('已更新排序');
  } catch (err) {
    showToast('排序儲存失敗（網路問題），已還原順序', true);
    PACKAGE_DATA.books = oldIds.map(id => byId[id]).filter(Boolean);
    renderBookList();
  }
}

// ---- 封面牆／編輯模式切換 ----
function showBookGrid() {
  CURRENT_BOOK = null;
  document.getElementById('bookEditWrap').style.display = 'none';
  document.getElementById('bookGridMode').style.display = '';
  renderBookList();
}

function openBookEditor(book) {
  CURRENT_BOOK = book || null;
  fillForm(book || null);
  renderMaterialsSection(book || null);
  document.getElementById('bookGridMode').style.display = 'none';
  document.getElementById('bookEditWrap').style.display = '';
  document.getElementById('bookEditWrap').scrollIntoView({ block: 'start' });
}

document.getElementById('bookBackBtn').addEventListener('click', showBookGrid);

// ===== 表單：品牌 / 年齡與主題 / 類型 選項渲染 =====
// 書團目前只有這兩家，其餘品牌不出現在下拉（2026-08-25 雪莉指定；要加品牌改這裡）
var BOOK_BRAND_WHITELIST = ['禾流文創', 'Kidsread點讀筆'];

function renderBrandOptions() {
  const sel = document.getElementById('fBrand');
  sel.innerHTML = '<option value="">無</option>';
  (PACKAGE_DATA.brands || []).filter(b => BOOK_BRAND_WHITELIST.includes(b.name)).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
}

// 編輯的書若掛著名單外的品牌，補一個選項，避免回填變空白、存檔時把品牌洗掉
function ensureBrandOption(brandId) {
  if (!brandId) return;
  const sel = document.getElementById('fBrand');
  if (sel.querySelector(`option[value="${brandId}"]`)) return;
  const src = (PACKAGE_DATA.brands || []).find(b => b.id === brandId);
  const opt = document.createElement('option');
  opt.value = brandId;
  opt.textContent = src ? src.name : '(未知品牌)';
  sel.appendChild(opt);
}

// ===== 子分類巢狀（2026-08-27 雪莉指定）=====
// 「單字書」「互動式書籍」資料上仍是一般分類，但屬於「語言學習」的子項目：
// 後台介面縮排顯示在母分類底下；前台（picture-books.html）掛子分類＝自動算語言學習，
// 點語言學習會依子分類分兩塊排版。要加新的子分類就改這裡＋picture-books.html 的 CATEGORY_SUBSECTIONS。
const CATEGORY_CHILDREN = { '語言學習': ['單字書', '互動式書籍'] };
const CATEGORY_PARENT_OF = {};
Object.keys(CATEGORY_CHILDREN).forEach(p => CATEGORY_CHILDREN[p].forEach(c => { CATEGORY_PARENT_OF[c] = p; }));

// 分類清單排序＋巢狀：子分類永遠緊跟在母分類後面（不管 sort 值），其餘照 sort；
// 母分類被刪掉時孤兒子分類仍列在最後（不憑空消失）
function orderedCategoryNames() {
  const all = (PACKAGE_DATA.categories || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(c => c.name);
  const out = [];
  all.forEach(name => {
    if (CATEGORY_PARENT_OF[name]) return; // 子分類由母分類帶入
    out.push(name);
    (CATEGORY_CHILDREN[name] || []).forEach(child => { if (all.includes(child)) out.push(child); });
  });
  all.forEach(name => { if (CATEGORY_PARENT_OF[name] && !out.includes(name)) out.push(name); });
  return out;
}

function renderCategoryCheckboxes() {
  const wrap = document.getElementById('fCategories');
  wrap.innerHTML = '';
  orderedCategoryNames().forEach(name => {
    const isSub = Boolean(CATEGORY_PARENT_OF[name]);
    const label = document.createElement('label');
    label.className = 'pba-checkbox-item';
    if (isSub) label.style.marginLeft = '18px';
    label.innerHTML = `<input type="checkbox" value="${pbaEscapeAttr(name)}"> ${isSub ? '↳ ' : ''}${pbaEscapeHtml(name)}`;
    wrap.appendChild(label);
  });
}

function renderTypeCheckboxes() {
  const wrap = document.getElementById('fTypes');
  wrap.innerHTML = '';
  (PACKAGE_DATA.types || []).forEach(t => {
    const label = document.createElement('label');
    label.className = 'pba-checkbox-item';
    label.innerHTML = `<input type="checkbox" value="${pbaEscapeAttr(t)}"> ${pbaEscapeHtml(t)}`;
    wrap.appendChild(label);
  });
}

function pbaEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pbaEscapeAttr(s) { return pbaEscapeHtml(s); }

function getCheckedValues(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)).map(el => el.value);
}
function setCheckedValues(containerId, values) {
  const set = new Set(values || []);
  document.querySelectorAll(`#${containerId} input[type=checkbox]`).forEach(el => {
    el.checked = set.has(el.value);
  });
}

// ===== 選書 / 新增書 =====
function selectBook(book) {
  openBookEditor(book);
}

document.getElementById('addBookBtn').addEventListener('click', () => openBookEditor(null));

function fillForm(book) {
  document.getElementById('formTitle').textContent = book ? '編輯繪本' : '新增繪本';
  document.getElementById('fTitle').value = book ? book.title || '' : '';
  document.getElementById('fAuthor').value = book ? book.author || '' : '';
  document.getElementById('fPublisher').value = book ? book.publisher || '' : '';
  document.getElementById('fSeries').value = book ? book.series_name || '' : '';
  document.getElementById('fDescription').value = book ? book.description || '' : '';
  renderVideoEditor(book);
  document.getElementById('fShopee').value = book ? book.shopee_url || '' : '';
  ensureBrandOption(book && book.brand_id);
  document.getElementById('fBrand').value = book && book.brand_id ? book.brand_id : '';
  setCheckedValues('fCategories', book ? book.categories || [] : []);
  setCheckedValues('fTypes', book ? book.types || [] : []);
  document.getElementById('fPublished').checked = book ? !!book.is_published : false;

  const coverUrl = book ? book.cover_url || '' : '';
  document.getElementById('fCoverUrl').value = coverUrl;
  setCoverPreview(coverUrl);
  document.getElementById('fCoverUploadStatus').textContent = '';
  document.getElementById('fCoverFile').value = '';
  document.getElementById('fCoverRemoveBg').value = 'none';
  pbiClearPending('fCoverPending');

  document.getElementById('deleteBookBtn').style.display = book ? 'inline-block' : 'none';
}

function setCoverPreview(url) {
  const img = document.getElementById('fCoverPreview');
  const ph = document.getElementById('fCoverPreviewPh');
  if (url) {
    img.src = url;
    img.style.display = 'block';
    ph.style.display = 'none';
  } else {
    img.style.display = 'none';
    ph.style.display = 'flex';
  }
}

// ===== AI 去背（沿用 bgRemover.js 的引擎與純函式，前綴改 pbi 避免以後兩檔同頁時撞名）=====
// 流程比照 bgRemover.js 的 bgrProcessItem：AI 去背 → 裁透明邊 → 縮圖 → 轉 WebP → 顯示預覽 → 處理完成即自動上傳（不再等使用者按確定，避免漏按導致存到舊圖）。
const PBI_ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const PBI_MODEL = 'isnet_quint8';
const PBI_WEBP_QUALITY = 0.92;
// 透明格棋盤底，讓人一眼看出「這塊真的是透明的」（抄自 bgRemover.js 的 BGR_CHECKER_BG）
const PBI_CHECKER_BG = 'background:repeating-conic-gradient(#e8e2da 0% 25%, #faf7f2 0% 50%) 0 0/16px 16px; border-radius:10px;';

let pbiEnginePromise = null; // 去背引擎只載一次
let pbiWebpChecked = false;
let pbiWebpOk = false;

// ===== 世代序號：避免處理中途切換書籍/教材造成圖片寫錯欄位 =====
// 每個待確認容器（fCoverPending / mThumbPending）各自維護一個序號。開始處理、重新選檔、
// 換書/換教材（pbiClearPending 被呼叫）都會讓序號前進；處理完成或準備寫回欄位前都要核對
// 「當初捕捉的序號 === 目前序號」，不符就丟棄結果（不顯示預覽、不上傳、不寫欄位）。
const pbiGen = {};
function pbiBumpGen(containerId) {
  pbiGen[containerId] = (pbiGen[containerId] || 0) + 1;
  return pbiGen[containerId];
}
function pbiCurrentGen(containerId) {
  return pbiGen[containerId] || 0;
}

// 處理中把對應的 file input 鎖住（disabled），避免使用者在還沒顯示待確認預覽前又選一次；
// 用計數器而非布林值，這樣同一個容器同時有兩段處理在跑時，要等全部跑完才解鎖。
const pbiBusyCount = {};
function pbiSetBusy(containerId, fileInput, delta) {
  pbiBusyCount[containerId] = Math.max(0, (pbiBusyCount[containerId] || 0) + delta);
  fileInput.disabled = pbiBusyCount[containerId] > 0;
}

function pbiResetContainer(containerId) {
  const wrap = document.getElementById(containerId);
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}

// 跟 bgRemover.js 一樣的做法：實測瀏覽器能不能真的輸出 WebP（iPhone Safari 會偷偷退回 PNG）
function pbiCheckWebp() {
  if (pbiWebpChecked) return pbiWebpOk;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  pbiWebpOk = canvas.toDataURL('image/webp', 0.8).indexOf('data:image/webp') === 0;
  pbiWebpChecked = true;
  return pbiWebpOk;
}

// 退回 PNG（而非 JPEG）：JPEG 沒有透明通道，canvas 匯出時會把透明像素填成黑色，
// 去背後的封面在不支援 WebP 匯出的瀏覽器（如舊版 iOS Safari）上會整片變黑底。跟 bgRemover.js 同一套做法。
function pbiEncodeCanvas(canvas) {
  const isWebp = pbiCheckWebp();
  const mime = isWebp ? 'image/webp' : 'image/png';
  const dataUrl = canvas.toDataURL(mime, PBI_WEBP_QUALITY);
  return { base64: dataUrl.split(',')[1], dataUrl: dataUrl, ext: isWebp ? '.webp' : '.png' };
}

// 去背引擎載入（只跑一次；失敗要把 promise 清掉，下次點才會重試而不是永遠卡在壞掉的 promise）
function pbiLoadEngine() {
  if (!pbiEnginePromise) {
    pbiEnginePromise = import(PBI_ENGINE_URL).catch((err) => {
      pbiEnginePromise = null;
      throw new Error('去背引擎載入失敗（請確認網路正常後再試一次）：' + err.message);
    });
  }
  return pbiEnginePromise;
}

// 把去背結果裁掉四周透明邊、縮到指定長邊。maxDim 為 0 表示保留原尺寸。
function pbiTrimAndScale(bitmap, maxDim, doTrim) {
  const src = document.createElement('canvas');
  src.width = bitmap.width;
  src.height = bitmap.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(bitmap, 0, 0);

  let box = { left: 0, top: 0, width: src.width, height: src.height };
  if (doTrim) {
    const data = sctx.getImageData(0, 0, src.width, src.height).data;
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if (data[(y * src.width + x) * 4 + 3] > 10) { // alpha 門檻：忽略幾乎全透明的雜點
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX) { // 全透明（去背失敗）就不裁，保留原圖讓人看得出有問題
      const pad = Math.max(4, Math.round(Math.max(maxX - minX, maxY - minY) * 0.02));
      box.left = Math.max(0, minX - pad);
      box.top = Math.max(0, minY - pad);
      box.width = Math.min(src.width, maxX + pad + 1) - box.left;
      box.height = Math.min(src.height, maxY + pad + 1) - box.top;
    }
  }

  let outW = box.width, outH = box.height;
  if (maxDim > 0 && Math.max(outW, outH) > maxDim) {
    const scale = maxDim / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, box.left, box.top, box.width, box.height, 0, 0, outW, outH);
  return out;
}

// ===== 「實心去背」：書本是矩形實心物，AI 常把封面內的淺色區當背景挖洞。
// 做法：只用 AI 結果找外框（凸包），框內全部保留、填回原圖像素，不理會 AI 挖的洞。=====

// Andrew monotone chain 凸包。points 至少要 3 點才有意義，回傳的點依逆時針/順時針其中一個方向排列（shoelace 算面積不受方向影響，取絕對值）。
function pbiCross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function pbiConvexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const n = pts.length;
  if (n < 3) return pts.slice();
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && pbiCross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && pbiCross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
function pbiPolygonArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area / 2);
}

// 從 AI 去背結果的 alpha 找「前景外框」的邊界點：逐列(row)取前景（alpha>=64）像素的最小/最大 x；
// 忽略前景像素數少於全圖最大列前景數 5% 的列，濾掉零星雜點列。
function pbiSolidBoundaryPoints(alphaData, w, h) {
  const rows = new Array(h);
  let maxCount = 0;
  for (let y = 0; y < h; y++) {
    let minX = -1, maxX = -1, count = 0;
    const rowBase = y * w;
    for (let x = 0; x < w; x++) {
      if (alphaData[(rowBase + x) * 4 + 3] >= 64) {
        count++;
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    rows[y] = { minX, maxX, count };
    if (count > maxCount) maxCount = count;
  }
  const threshold = maxCount * 0.05;
  const points = [];
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    if (r.count > 0 && r.count >= threshold) {
      points.push({ x: r.minX, y });
      points.push({ x: r.maxX, y });
    }
  }
  return points;
}

// 實心去背主流程：aiBitmap 是已經跑過 AI removeBackground 的結果。回傳 { canvas, effectiveMode }。
// effectiveMode 'solid' 成功；'solid-fallback-ai' 表示凸包太小（AI 幾乎沒抓到東西），退回純 AI 結果。
async function pbiSolidFromAi(file, aiBitmap, maxDim) {
  const origBitmap = await createImageBitmap(file);
  const w = origBitmap.width, h = origBitmap.height;

  const canvasA = document.createElement('canvas'); // AI 結果（縮放到原圖尺寸），只用來取 alpha
  canvasA.width = w; canvasA.height = h;
  canvasA.getContext('2d').drawImage(aiBitmap, 0, 0, w, h);

  const canvasB = document.createElement('canvas'); // 原圖像素，最終要填回去的內容
  canvasB.width = w; canvasB.height = h;
  canvasB.getContext('2d').drawImage(origBitmap, 0, 0);
  if (origBitmap.close) origBitmap.close();

  const alphaData = canvasA.getContext('2d').getImageData(0, 0, w, h).data;
  const boundaryPoints = pbiSolidBoundaryPoints(alphaData, w, h);
  const hull = boundaryPoints.length >= 3 ? pbiConvexHull(boundaryPoints) : [];
  const hullArea = hull.length >= 3 ? pbiPolygonArea(hull) : 0;
  const origArea = w * h;

  if (hull.length < 3 || hullArea < origArea * 0.08) {
    // 凸包太小＝AI 幾乎沒抓到東西，實心視為失敗，退回純 AI 結果
    const canvas = pbiTrimAndScale(aiBitmap, maxDim, true);
    return { canvas, effectiveMode: 'solid-fallback-ai' };
  }

  // 矩形吸附：書本是正拍矩形時，AI mask 常見角落被吃掉一小塊，凸包因此斜切角。
  // 用邊界點的外接矩形（bbox）跟凸包面積比較：凸包已經幾乎填滿 bbox（>=90%），
  // 代表本來就是矩形只是角落被咬掉，改用 bbox 四個直角當 clip 區域，找回完整直角；
  // 差距大就是歪拍/不規則物件，維持凸包，不要硬套矩形。
  let bboxMinX = boundaryPoints[0].x, bboxMaxX = boundaryPoints[0].x;
  let bboxMinY = boundaryPoints[0].y, bboxMaxY = boundaryPoints[0].y;
  boundaryPoints.forEach(p => {
    if (p.x < bboxMinX) bboxMinX = p.x;
    if (p.x > bboxMaxX) bboxMaxX = p.x;
    if (p.y < bboxMinY) bboxMinY = p.y;
    if (p.y > bboxMaxY) bboxMaxY = p.y;
  });
  const bboxArea = Math.max(1, bboxMaxX - bboxMinX) * Math.max(1, bboxMaxY - bboxMinY);
  const usedBbox = hullArea >= bboxArea * 0.90;
  // bboxMaxX/bboxMaxY 是「最後一個前景像素」的像素索引（0-based），該像素在幾何座標上要畫到 +1 才會被含進矩形，
  // 否則 clip 矩形的右/下邊界會卡在那個像素的左/上緣，把最右一欄、最下一列排除在外（角落變透明）。
  const clipPoly = usedBbox
    ? [{ x: bboxMinX, y: bboxMinY }, { x: bboxMaxX + 1, y: bboxMinY }, { x: bboxMaxX + 1, y: bboxMaxY + 1 }, { x: bboxMinX, y: bboxMaxY + 1 }]
    : hull;

  const clipCanvas = document.createElement('canvas'); // 透明底，clip 到（矩形吸附後的）多邊形，貼回原圖像素
  clipCanvas.width = w; clipCanvas.height = h;
  const cctx = clipCanvas.getContext('2d');
  cctx.save();
  cctx.beginPath();
  clipPoly.forEach((pt, i) => { if (i === 0) cctx.moveTo(pt.x, pt.y); else cctx.lineTo(pt.x, pt.y); });
  cctx.closePath();
  cctx.clip();
  cctx.drawImage(canvasB, 0, 0);
  cctx.restore();

  let canvas;
  if (usedBbox) {
    // 矩形分支邊界已經精確知道（bboxMinX..bboxMaxX / bboxMinY..bboxMaxY），整個矩形內都是剛貼上去的
    // 原圖不透明像素，直接照這個矩形裁切即可、四角就是矩形直角。不要再走 pbiTrimAndScale 的
    // alpha 掃描＋外擴 pad（那是給邊界不確定的凸包/AI 結果用的，套在已知矩形上只會多裁出一圈透明邊）。
    const bw = bboxMaxX - bboxMinX + 1;
    const bh = bboxMaxY - bboxMinY + 1;
    const cropped = document.createElement('canvas');
    cropped.width = bw; cropped.height = bh;
    cropped.getContext('2d').drawImage(clipCanvas, bboxMinX, bboxMinY, bw, bh, 0, 0, bw, bh);
    canvas = pbiTrimAndScale(cropped, maxDim, false); // 已經是精確裁切，這裡只負責視需要縮圖
  } else {
    canvas = pbiTrimAndScale(clipCanvas, maxDim, true);
  }
  // debugSolid 只供驗證/除錯用，非正式流程依賴此欄位
  return { canvas, effectiveMode: 'solid', debugSolid: { hullArea, bboxArea, ratio: hullArea / bboxArea, usedBbox } };
}

// 選檔後的處理：去背（依 mode）→ 裁邊 → 縮圖，回傳 { canvas, effectiveMode }。
// mode: 'removebg'（呼叫 remove.bg API 去背）｜'solid'（實心，AI 找外框、框內全保留原圖像素）｜'ai'（純 AI 去背，照 AI 結果的透明區）｜'none'（不去背，只縮圖轉檔，不裁邊）。
async function pbiProcessFile(file, maxDim, mode, statusElId) {
  const statusEl = document.getElementById(statusElId);
  statusEl.style.cssText = ''; // 清掉上一輪成功時套用的醒目樣式，避免殘留到這一輪的處理中文字
  statusEl.textContent = mode !== 'none' ? '處理中…（第一次會下載約 40MB 模型）' : '處理中…';
  try {
    if (mode === 'none') {
      const bitmap = await createImageBitmap(file);
      const canvas = pbiTrimAndScale(bitmap, maxDim, false);
      if (bitmap.close) bitmap.close();
      statusEl.textContent = '';
      return { canvas, effectiveMode: 'none' };
    }

    if (mode === 'removebg') {
      return await pbiRemoveBgViaApi(file, maxDim, statusElId);
    }

    const engine = await pbiLoadEngine();
    const outBlob = await engine.removeBackground(file, {
      model: PBI_MODEL,
      progress: (key, cur, tot) => {
        if (String(key).indexOf('fetch:') !== 0 || !tot) return;
        const pct = Math.min(100, Math.round((cur / tot) * 100));
        statusEl.textContent = '首次使用需下載 AI 模型（約 40MB，只需一次）… ' + pct + '%';
      }
    });
    const aiBitmap = await createImageBitmap(outBlob);

    let result;
    if (mode === 'solid') {
      result = await pbiSolidFromAi(file, aiBitmap, maxDim);
    } else {
      const canvas = pbiTrimAndScale(aiBitmap, maxDim, true);
      result = { canvas, effectiveMode: 'ai' };
    }
    if (aiBitmap.close) aiBitmap.close();
    statusEl.textContent = '';
    return result;
  } catch (err) {
    statusEl.textContent = '';
    throw err;
  }
}

// 在指定容器顯示「處理後預覽（棋盤格底）＋重選」。上傳由呼叫方（pbiHandleUpload）在顯示後自動觸發，這裡只負責畫面。
function pbiShowPendingPreview(containerId, canvas, handlers) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  wrap.style.display = 'block';

  const previewBox = document.createElement('div');
  previewBox.style.cssText = 'display:inline-block; ' + PBI_CHECKER_BG;
  const scale = Math.min(1, 120 / Math.max(canvas.width, canvas.height));
  const view = document.createElement('canvas');
  view.width = Math.max(1, Math.round(canvas.width * scale));
  view.height = Math.max(1, Math.round(canvas.height * scale));
  view.getContext('2d').drawImage(canvas, 0, 0, view.width, view.height);
  view.style.cssText = 'display:block; max-width:120px; max-height:120px; border-radius:10px;';
  previewBox.appendChild(view);
  wrap.appendChild(previewBox);

  const dims = document.createElement('div');
  dims.style.cssText = 'font-size:11px; color:var(--c-muted); margin-top:2px;';
  dims.textContent = canvas.width + '×' + canvas.height;
  wrap.appendChild(dims);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:8px; margin-top:6px;';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'pba-mini-btn';
  resetBtn.textContent = '重選';
  resetBtn.addEventListener('click', handlers.onReset);
  btnRow.appendChild(resetBtn);
  wrap.appendChild(btnRow);
}

function pbiClearPending(containerId) {
  pbiBumpGen(containerId); // 換書/換教材/使用者重選都要讓舊的處理結果失效
  pbiResetContainer(containerId);
}

// effectiveMode → 上傳成功狀態文字裡的括號註記
function pbiRemoveBgLabel(effectiveMode) {
  if (effectiveMode === 'removebg') return 'remove.bg 去背';
  if (effectiveMode === 'solid') return '實心去背';
  if (effectiveMode === 'solid-fallback-ai') return '已去背（實心失敗，改純 AI）';
  if (effectiveMode === 'ai') return '已去背';
  return '未去背';
}

// ===== remove.bg 去背（第三方 API，見 lib/books/bgremove.ts / POST book-bg-remove）=====

// 判斷 canvas 是否含有效透明像素（門檻比照 pbiTrimAndScale 的 alpha>10），決定送給 remove.bg 的來源圖用 PNG 還是 JPEG。
function pbiCanvasHasAlpha(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= 250) return true;
  }
  return false;
}

// base64（remove.bg 回傳的 PNG）→ ImageBitmap
async function pbiBase64ToBitmap(base64, mime) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime || 'image/png' });
  return await createImageBitmap(blob);
}

// remove.bg 去背主流程：原檔縮到最長邊 1200（不去背、不裁邊）→ 轉 base64（有透明用 PNG，否則 JPEG）
// → 呼叫 book-bg-remove → 回來的透明 PNG 照舊流程裁邊＋縮到 maxDim。失敗（含逾時/例外）直接往外拋，
// 由呼叫方（pbiHandleUpload）決定要不要退回 solid。
async function pbiRemoveBgViaApi(file, maxDim, statusElId) {
  const statusEl = document.getElementById(statusElId);
  statusEl.style.cssText = '';
  statusEl.textContent = 'remove.bg 去背中…';

  const srcBitmap = await createImageBitmap(file);
  const srcCanvas = pbiTrimAndScale(srcBitmap, 1200, false);
  if (srcBitmap.close) srcBitmap.close();

  const hasAlpha = pbiCanvasHasAlpha(srcCanvas);
  const reqMime = hasAlpha ? 'image/png' : 'image/jpeg';
  const reqDataUrl = srcCanvas.toDataURL(reqMime, hasAlpha ? undefined : 0.92);
  const reqBase64 = reqDataUrl.split(',')[1];

  const res = await apiPost('book-bg-remove', { dataBase64: reqBase64, mime: reqMime, size: 'preview' }, 30000);
  if (!res || res.success !== true) {
    throw new Error((res && res.error) || 'remove.bg 去背失敗');
  }

  const outBitmap = await pbiBase64ToBitmap(res.dataBase64, res.mime || 'image/png');
  const canvas = pbiTrimAndScale(outBitmap, maxDim, true);
  if (outBitmap.close) outBitmap.close();
  statusEl.textContent = '';
  return { canvas, effectiveMode: 'removebg' };
}

// 處理完成後自動呼叫：轉檔 → 呼叫 book-image-upload → 網址加 ?v=timestamp 避免 CDN 快取舊圖。
// gen：呼叫方（pbiHandleUpload）捕捉的序號，若呼叫前／上傳中序號已經變了（使用者切走或重選），就整段放棄，不寫回欄位。
// 成功後刻意不清空預覽容器：保留棋盤格縮圖＋重選鈕，只把狀態文字換成醒目提示，讓使用者看得到「已上傳」再去按儲存。
async function pbiUploadCanvas(canvas, kind, buildFilename, statusElId, previewSetFn, hiddenInputId, pendingContainerId, gen, effectiveMode) {
  if (pbiCurrentGen(pendingContainerId) !== gen) return; // 呼叫時已經不是目前這筆（使用者已重選或切走）
  const statusEl = document.getElementById(statusElId);
  statusEl.style.cssText = '';
  statusEl.textContent = '上傳中…';
  try {
    const enc = pbiEncodeCanvas(canvas);
    const filename = buildFilename(enc.ext);
    const res = await apiPost('book-image-upload', { filename, dataBase64: enc.base64, kind });
    if (pbiCurrentGen(pendingContainerId) !== gen) return; // 上傳過程中使用者切走了，結果作廢，不寫回欄位
    if (!res || res.success !== true) {
      pbiResetContainer(pendingContainerId); // 上傳失敗，預覽清空，避免使用者誤以為已經上傳成功
      statusEl.textContent = '上傳失敗：' + ((res && res.error) || '未知錯誤');
      showToast('圖片上傳失敗', true);
      return;
    }
    const finalUrl = res.download_url + (res.download_url.indexOf('?') === -1 ? '?v=' : '&v=') + Date.now();
    document.getElementById(hiddenInputId).value = finalUrl;
    previewSetFn(finalUrl);
    statusEl.style.cssText = 'color:#1b7a3d; font-weight:700;';
    statusEl.textContent = '✅ 圖片已上傳（' + pbiRemoveBgLabel(effectiveMode) + '），記得按下方「儲存」';
    showToast('圖片上傳完成');
  } catch (err) {
    if (pbiCurrentGen(pendingContainerId) !== gen) return;
    pbiResetContainer(pendingContainerId); // 上傳失敗，預覽清空，避免使用者誤以為已經上傳成功
    statusEl.textContent = '上傳失敗：' + (err && err.message ? err.message : '未知錯誤');
    showToast('圖片上傳失敗', true);
  }
}

// 選檔的總流程：處理（依去背方式 select）→ 顯示待確認預覽。AI 引擎本身失敗（如模型下載失敗）時 toast 提示，並自動退回「不去背」重跑一次。
// 開始時捕捉世代序號 myGen；處理完成、準備顯示預覽、準備上傳前都要核對序號沒變，換書/換教材/重選都會讓舊結果作廢。
async function pbiHandleUpload(opts) {
  const { file, maxDim, kind, removeBgCheckboxId, statusElId, pendingContainerId, previewSetFn, hiddenInputId, fileInputId, buildFilename } = opts;
  const mode = document.getElementById(removeBgCheckboxId).value; // 'removebg' | 'solid' | 'ai' | 'none'
  const statusEl = document.getElementById(statusElId);
  const fileInput = document.getElementById(fileInputId);
  const myGen = pbiBumpGen(pendingContainerId);
  pbiResetContainer(pendingContainerId); // 蓋掉畫面上舊的待確認預覽（如果還在）
  pbiSetBusy(pendingContainerId, fileInput, 1);

  const showResult = (canvas, effectiveMode) => {
    if (pbiCurrentGen(pendingContainerId) !== myGen) return; // 處理完時已經不是目前這筆（切走了或又選了新檔），丟棄不顯示
    pbiShowPendingPreview(pendingContainerId, canvas, {
      onReset: () => {
        pbiClearPending(pendingContainerId);
        fileInput.value = '';
        statusEl.style.cssText = '';
        statusEl.textContent = '';
      }
    });
    pbiUploadCanvas(canvas, kind, buildFilename, statusElId, previewSetFn, hiddenInputId, pendingContainerId, myGen, effectiveMode); // 處理完成即自動上傳，不再等使用者確認
  };

  // remove.bg 失敗（或 solid 接手後又失敗）時，最終退回「不去背」的既有邏輯，抽出來給兩個分支共用。
  const fallbackToNone = async (reasonErr) => {
    showToast('去背失敗，這張先以原圖上傳（下一張會再嘗試去背）：' + (reasonErr && reasonErr.message ? reasonErr.message : '未知錯誤'), true, 8000);
    try {
      const result2 = await pbiProcessFile(file, maxDim, 'none', statusElId);
      showResult(result2.canvas, result2.effectiveMode);
    } catch (err2) {
      if (pbiCurrentGen(pendingContainerId) === myGen) {
        statusEl.textContent = '';
        showToast('處理失敗：' + (err2 && err2.message ? err2.message : '未知錯誤'), true);
        fileInput.value = '';
      }
    }
  };

  try {
    const { canvas, effectiveMode } = await pbiProcessFile(file, maxDim, mode, statusElId);
    showResult(canvas, effectiveMode);
  } catch (err) {
    if (mode === 'removebg') {
      // remove.bg 失敗（額度用完/金鑰錯誤/逾時等）：select 保持原選項不動，改走 solid 流程救這一張
      showToast('remove.bg 去背失敗，改用實心模式：' + (err && err.message ? err.message : '未知錯誤'), true, 8000);
      try {
        const result2 = await pbiProcessFile(file, maxDim, 'solid', statusElId);
        showResult(result2.canvas, result2.effectiveMode);
      } catch (err2) {
        // solid 也失敗，照既有退路退回「不去背」
        await fallbackToNone(err2);
      }
    } else if (mode !== 'none') {
      // 引擎本身失敗（如模型下載失敗）只影響這一次：select 保持原選項不動，下一張還是會照使用者設定嘗試去背
      await fallbackToNone(err);
    } else {
      if (pbiCurrentGen(pendingContainerId) === myGen) {
        statusEl.textContent = '';
        showToast('處理失敗：' + (err && err.message ? err.message : '未知錯誤'), true);
        fileInput.value = '';
      }
    }
  } finally {
    pbiSetBusy(pendingContainerId, fileInput, -1);
  }
}

document.getElementById('fCoverFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const bookId = CURRENT_BOOK ? CURRENT_BOOK.id : ('new-' + Date.now());
  pbiHandleUpload({
    file,
    maxDim: 800,
    kind: 'cover',
    removeBgCheckboxId: 'fCoverRemoveBg',
    statusElId: 'fCoverUploadStatus',
    pendingContainerId: 'fCoverPending',
    previewSetFn: setCoverPreview,
    hiddenInputId: 'fCoverUrl',
    fileInputId: 'fCoverFile',
    buildFilename: (ext) => `cover-${bookId}${ext}`
  });
});

// ===== 介紹影片編輯器（book_videos 獨立表，book-videos-set 整批覆蓋這本書的清單） =====
// 每列＝一支影片（網址必填＋小標題選填）；順序＝前台顯示順序。共用影片（掛多本書）顯示徽章，
// 從這本書刪掉該列只會解除這本書的掛載，其他書不受影響（後端 reconcile 規則）。
// 儲存時機＝跟「儲存」按鈕同一發（先 book-upsert 拿到 id，再 book-videos-set）。
let VIDEO_EDITOR_ORIGINAL = '[]'; // JSON 字串，判斷有沒有動過（videosReady=false 時用來警告）

function renderVideoEditor(book) {
  const wrap = document.getElementById('fVideoRows');
  wrap.innerHTML = '';
  const videos = book && Array.isArray(book.videos) ? book.videos : [];
  videos.forEach(v => addVideoRow(v));
  VIDEO_EDITOR_ORIGINAL = JSON.stringify(collectVideoRows());
  const notReady = PACKAGE_DATA && PACKAGE_DATA.videosReady === false;
  document.getElementById('fVideosNotReady').style.display = notReady ? 'block' : 'none';
}

function addVideoRow(video) {
  const wrap = document.getElementById('fVideoRows');
  const row = document.createElement('div');
  row.className = 'pba-video-row';
  row.style.cssText = 'display:flex; gap:6px; align-items:center; margin-bottom:6px;';

  const url = document.createElement('input');
  url.type = 'text';
  url.className = 'pba-video-url';
  url.placeholder = 'https://www.youtube.com/watch?v=...';
  url.value = video && video.url ? video.url : '';
  url.style.cssText = 'flex:2; min-width:0;';
  if (video && video.id) row.dataset.videoId = video.id;
  row.appendChild(url);

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'pba-video-title';
  title.placeholder = '小標題（選填）';
  title.maxLength = 60;
  title.value = video && video.title ? video.title : '';
  title.style.cssText = 'flex:1; min-width:0;';
  row.appendChild(title);

  const shared = video && Array.isArray(video.bookIds) ? video.bookIds.length : 0;
  if (shared > 1) {
    const badge = document.createElement('span');
    badge.style.cssText = 'flex:none; font-size:11px; font-weight:700; color:var(--c-muted); white-space:nowrap;';
    badge.textContent = `共用 ${shared} 本`;
    badge.title = '這支影片同時掛在其他書上；刪掉這列只會從這本書移除，其他書不受影響';
    row.appendChild(badge);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'pba-mini-btn danger';
  del.textContent = '✕';
  del.title = '移除這支影片';
  del.style.flex = 'none';
  del.addEventListener('click', () => row.remove());
  row.appendChild(del);

  wrap.appendChild(row);
}

document.getElementById('addVideoRowBtn').addEventListener('click', () => addVideoRow(null));

function collectVideoRows() {
  return Array.from(document.querySelectorAll('#fVideoRows .pba-video-row'))
    .map(row => ({
      id: row.dataset.videoId || '',
      url: row.querySelector('.pba-video-url').value.trim(),
      title: row.querySelector('.pba-video-title').value.trim()
    }))
    .filter(v => v.url);
}

/** 書存好後接著存影片；回 true＝沒問題（含「沒動過所以跳過」），false＝有變更但存不進去 */
async function saveVideosForBook(bookId) {
  const rows = collectVideoRows();
  const dirty = JSON.stringify(rows) !== VIDEO_EDITOR_ORIGINAL;
  if (PACKAGE_DATA && PACKAGE_DATA.videosReady === false) {
    if (dirty) showToast('影片資料表尚未建立（需先 npx supabase db push），影片變更未儲存', true);
    return !dirty;
  }
  if (!dirty) return true;
  const res = await apiPost('book-videos-set', { book_id: bookId, videos: rows });
  if (!res || res.success !== true) {
    showToast('影片儲存失敗：' + ((res && res.error) || '未知錯誤'), true);
    return false;
  }
  return true;
}

// ===== 儲存 / 刪除 書籍 =====
document.getElementById('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { showToast('請輸入書名', true); return; }

  const payload = {
    title,
    author: document.getElementById('fAuthor').value.trim(),
    publisher: document.getElementById('fPublisher').value.trim(),
    series_name: document.getElementById('fSeries').value.trim(),
    description: document.getElementById('fDescription').value,
    shopee_url: document.getElementById('fShopee').value.trim(),
    brand_id: document.getElementById('fBrand').value || null,
    categories: getCheckedValues('fCategories'),
    types: getCheckedValues('fTypes'),
    is_published: document.getElementById('fPublished').checked,
    cover_url: document.getElementById('fCoverUrl').value.trim()
  };
  if (CURRENT_BOOK) {
    payload.id = CURRENT_BOOK.id; // 編輯不送 sort（partial update 不動原值，順序只在封面牆拖曳改）
  } else {
    // 新書預設排最前面：比現有最小 sort 再小 1（拖曳存檔會把全部重新編成 1..n，不會一直變小）
    const sorts = (PACKAGE_DATA.books || []).map(b => Number(b.sort) || 0);
    payload.sort = sorts.length ? Math.min.apply(null, sorts) - 1 : 0;
  }

  try {
    const res = await apiPost('book-upsert', payload);
    if (!res || res.success !== true) {
      showToast('儲存失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    // 書本體存好 → 接著存影片清單（沒動過會自動跳過）；影片失敗不擋書的儲存，錯誤已 toast
    const videosOk = await saveVideosForBook(res.book.id);
    if (videosOk) showToast('已儲存');
    const pkg = await loadPackage();
    if (!pkg) return;
    PACKAGE_DATA = pkg;
    // 存完關閉編輯框、回封面牆（新書因 sort 最小會排在最前面；要補教材就再點一次封面）
    showBookGrid();
  } catch (err) {
    // needLogin 已在 apiPost 內處理，這裡不用重複提示
  }
});

document.getElementById('deleteBookBtn').addEventListener('click', async () => {
  if (!CURRENT_BOOK) return;
  if (!confirm(`確定要刪除《${CURRENT_BOOK.title}》嗎？此動作無法復原。`)) return;
  try {
    const res = await apiPost('book-delete', { id: CURRENT_BOOK.id });
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast('已刪除');
    const pkg = await loadPackage();
    if (!pkg) return;
    PACKAGE_DATA = pkg;
    showBookGrid();
  } catch (err) { /* needLogin 已處理 */ }
});

// ===== 延伸教材 =====
function renderMaterialsSection(book) {
  const hint = document.getElementById('materialsNeedSaveHint');
  const body = document.getElementById('materialsBody');
  closeMaterialForm();
  closeLibraryPicker();
  if (!book) {
    hint.style.display = 'block';
    body.style.display = 'none';
    return;
  }
  hint.style.display = 'none';
  body.style.display = 'block';
  renderMaterialList(book.materials || []);
}

function renderMaterialList(materials) {
  const listEl = document.getElementById('materialList');
  listEl.innerHTML = '';
  if (!materials.length) {
    listEl.innerHTML = '<div class="pba-empty-list">還沒有教材</div>';
    return;
  }
  materials.forEach(m => {
    const item = document.createElement('div');
    item.className = 'pba-material-item';

    if (m.thumb_url) {
      const img = document.createElement('img');
      img.className = 'pba-material-thumb';
      img.src = m.thumb_url;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'pba-material-thumb placeholder';
      ph.textContent = '📄';
      item.appendChild(ph);
    }

    const info = document.createElement('div');
    info.className = 'pba-material-info';
    const title = document.createElement('div');
    title.className = 'pba-material-title';
    title.textContent = m.title || '未命名教材';
    info.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'pba-material-sub';
    const printSizePrefix = m.print_size ? `建議尺寸：${m.print_size} ・ ` : '';
    const availablePrefix = m.available_from ? `${m.locked ? '🔒 ' : ''}${formatAvailableFrom(m.available_from)} 開放 ・ ` : '';
    // 教材庫：同一份教材掛幾本書（bookIds），共用時提示一下，下載數是全部書合併的
    const sharedSuffix = Array.isArray(m.bookIds) && m.bookIds.length > 1 ? ` ・ 📚 共用 ${m.bookIds.length} 本` : '';
    sub.textContent = `${availablePrefix}${printSizePrefix}${m.file_name || '未上傳檔案'} ・ ${formatBytes(m.file_size || 0)} ・ ⬇ ${Number(m.downloadCount) || 0} 次下載${sharedSuffix}`;
    info.appendChild(sub);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'pba-material-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'pba-mini-btn';
    editBtn.textContent = '編輯';
    editBtn.addEventListener('click', () => openMaterialForm(m));
    actions.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'pba-mini-btn danger';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', () => deleteMaterial(m));
    actions.appendChild(delBtn);
    item.appendChild(actions);

    listEl.appendChild(item);
  });
}

// YYYY-MM-DD → M/D（跨年或不同年則顯示 YYYY/M/D）
function formatAvailableFrom(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return String(s || '');
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return y === new Date().getFullYear() ? `${mo}/${d}` : `${y}/${mo}/${d}`;
}

function formatBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

document.getElementById('addMaterialBtn').addEventListener('click', () => openMaterialForm(null));
document.getElementById('cancelMaterialBtn').addEventListener('click', closeMaterialForm);

function openMaterialForm(material) {
  materialFormEditingId = material ? material.id : null;
  // 編輯共用教材時要原封不動帶回 bookIds（只送 book_id 會把其他書的掛載洗掉）
  materialFormEditingBookIds = material && Array.isArray(material.bookIds) ? material.bookIds.slice() : null;
  document.getElementById('materialForm').classList.add('show');
  document.getElementById('mTitle').value = material ? material.title || '' : '';
  document.getElementById('mDescription').value = material ? material.description || '' : '';
  document.getElementById('mPrintSize').value = material ? material.print_size || '' : '';
  document.getElementById('mAvailableFrom').value = material ? (material.available_from || '').slice(0, 10) : '';
  document.getElementById('mThumbUrl').value = material ? material.thumb_url || '' : '';
  document.getElementById('mFileUrl').value = material ? material.file_url || '' : '';
  document.getElementById('mFileName').value = material ? material.file_name || '' : '';
  document.getElementById('mFileSize').value = material ? material.file_size || 0 : 0;
  setMaterialThumbPreview(material ? material.thumb_url || '' : '');
  document.getElementById('mThumbUploadStatus').textContent = '';
  document.getElementById('mFileUploadStatus').textContent = material && material.file_name ? `已上傳：${material.file_name}` : '';
  document.getElementById('mThumbFile').value = '';
  document.getElementById('mFileInput').value = '';
  document.getElementById('mThumbRemoveBg').value = 'none';
  pbiClearPending('mThumbPending');
}

function closeMaterialForm() {
  materialFormEditingId = null;
  materialFormEditingBookIds = null;
  const form = document.getElementById('materialForm');
  if (form) form.classList.remove('show');
  document.getElementById('mThumbRemoveBg').value = 'none';
  pbiClearPending('mThumbPending');
}

function setMaterialThumbPreview(url) {
  const img = document.getElementById('mThumbPreview');
  const ph = document.getElementById('mThumbPreviewPh');
  if (url) { img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }
}

document.getElementById('mThumbFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!CURRENT_BOOK) {
    showToast('請先儲存書籍再上傳教材縮圖', true);
    e.target.value = '';
    return;
  }
  const bookId = CURRENT_BOOK.id;
  const matId = materialFormEditingId || Date.now();
  pbiHandleUpload({
    file,
    maxDim: 600,
    kind: 'thumb',
    removeBgCheckboxId: 'mThumbRemoveBg',
    statusElId: 'mThumbUploadStatus',
    pendingContainerId: 'mThumbPending',
    previewSetFn: setMaterialThumbPreview,
    hiddenInputId: 'mThumbUrl',
    fileInputId: 'mThumbFile',
    buildFilename: (ext) => `thumb-${bookId}-${matId}${ext}`
  });
});

document.getElementById('mFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('mFileUploadStatus');
  if (file.size > MAX_MATERIAL_BYTES) {
    statusEl.textContent = '檔案超過 50MB 上限，請換一個檔案';
    showToast('檔案超過 50MB 上限', true);
    e.target.value = '';
    return;
  }
  if (!CURRENT_BOOK) {
    statusEl.textContent = '請先儲存書籍再上傳教材檔案';
    showToast('請先儲存書籍', true);
    e.target.value = '';
    return;
  }
  statusEl.textContent = '上傳中…';
  try {
    const urlRes = await apiPost('material-upload-url', { book_id: CURRENT_BOOK.id, file_name: file.name });
    if (!urlRes || urlRes.success !== true) {
      statusEl.textContent = '取得上傳網址失敗：' + ((urlRes && urlRes.error) || '未知錯誤');
      showToast('教材上傳失敗', true);
      return;
    }
    const putRes = await fetch(urlRes.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!putRes.ok) {
      statusEl.textContent = '檔案上傳失敗（' + putRes.status + '）';
      showToast('教材上傳失敗', true);
      return;
    }
    document.getElementById('mFileUrl').value = urlRes.publicUrl;
    document.getElementById('mFileName').value = file.name;
    document.getElementById('mFileSize').value = file.size;
    statusEl.textContent = `上傳完成：${file.name}（${formatBytes(file.size)}）`;
    showToast('教材檔案上傳完成');
  } catch (err) {
    statusEl.textContent = '上傳失敗：' + (err && err.message ? err.message : '未知錯誤');
    showToast('教材上傳失敗', true);
  }
});

document.getElementById('saveMaterialBtn').addEventListener('click', async () => {
  if (!CURRENT_BOOK) { showToast('請先儲存書籍', true); return; }
  const title = document.getElementById('mTitle').value.trim();
  if (!title) { showToast('請輸入教材標題', true); return; }
  // 掛載書單：新增＝掛在目前這本書；編輯＝保留原本的掛載（共用教材不能被洗成單本），
  // 保險再把目前這本書併進去（正常情況本來就在裡面）
  const bookIds = materialFormEditingId && materialFormEditingBookIds
    ? Array.from(new Set(materialFormEditingBookIds.concat(CURRENT_BOOK.id)))
    : [CURRENT_BOOK.id];
  const payload = {
    book_ids: bookIds,
    title,
    description: document.getElementById('mDescription').value,
    print_size: document.getElementById('mPrintSize').value.trim(),
    available_from: document.getElementById('mAvailableFrom').value || '',
    thumb_url: document.getElementById('mThumbUrl').value.trim(),
    file_url: document.getElementById('mFileUrl').value.trim(),
    file_name: document.getElementById('mFileName').value,
    file_size: Number(document.getElementById('mFileSize').value) || 0,
    sort: 0
  };
  if (materialFormEditingId) payload.id = materialFormEditingId;

  try {
    const res = await apiPost('material-upsert', payload);
    if (!res || res.success !== true) {
      showToast('儲存教材失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast('教材已儲存');
    await refreshCurrentBookAfterMaterialChange();
    closeMaterialForm();
  } catch (err) { /* needLogin 已處理 */ }
});

async function deleteMaterial(material) {
  // 共用教材（掛多本書）：預設只從這本書移除掛載，檔案與其他書都保留；
  // 只剩這一本書掛著時才是真刪除（material-delete，檔案紀錄整筆消失）
  const shared = Array.isArray(material.bookIds) ? material.bookIds : [];
  const isShared = CURRENT_BOOK && shared.length > 1 && shared.includes(CURRENT_BOOK.id);
  try {
    let res;
    if (isShared) {
      if (!confirm(`教材《${material.title || '未命名'}》同時掛在另外 ${shared.length - 1} 本書。\n要從《${CURRENT_BOOK.title}》移除嗎？（其他書照常保留，檔案不會刪除）`)) return;
      res = await apiPost('material-upsert', { id: material.id, book_ids: shared.filter(id => id !== CURRENT_BOOK.id) });
    } else {
      if (!confirm(`確定要刪除教材《${material.title || '未命名'}》嗎？`)) return;
      res = await apiPost('material-delete', { id: material.id });
    }
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast(isShared ? '已從這本書移除（其他書保留）' : '已刪除教材');
    await refreshCurrentBookAfterMaterialChange();
  } catch (err) { /* needLogin 已處理 */ }
}

// ===== 教材庫（從既有教材掛進這本書，不重複上傳檔案） =====
document.getElementById('addFromLibraryBtn').addEventListener('click', () => {
  const picker = document.getElementById('materialLibraryPicker');
  if (picker.style.display === 'none') {
    picker.style.display = 'block';
    document.getElementById('materialLibrarySearch').value = '';
    renderLibraryList();
  } else {
    closeLibraryPicker();
  }
});

function closeLibraryPicker() {
  const picker = document.getElementById('materialLibraryPicker');
  if (picker) picker.style.display = 'none';
}

document.getElementById('materialLibrarySearch').addEventListener('input', renderLibraryList);

function renderLibraryList() {
  const listEl = document.getElementById('materialLibraryList');
  listEl.innerHTML = '';
  if (!CURRENT_BOOK) return;
  const term = (document.getElementById('materialLibrarySearch').value || '').trim().toLowerCase();
  const bookTitleById = new Map((PACKAGE_DATA.books || []).map(b => [b.id, b.title]));
  const candidates = (PACKAGE_DATA.materialsLibrary || [])
    .filter(m => !(Array.isArray(m.bookIds) && m.bookIds.includes(CURRENT_BOOK.id)))
    .filter(m => !term || (m.title || '').toLowerCase().includes(term));
  if (!candidates.length) {
    listEl.innerHTML = '<div class="pba-empty-list">沒有可加入的教材（其他書的教材會出現在這裡）</div>';
    return;
  }
  candidates.forEach(m => {
    const item = document.createElement('div');
    item.className = 'pba-material-item';

    if (m.thumb_url) {
      const img = document.createElement('img');
      img.className = 'pba-material-thumb';
      img.src = m.thumb_url;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'pba-material-thumb placeholder';
      ph.textContent = '📄';
      item.appendChild(ph);
    }

    const info = document.createElement('div');
    info.className = 'pba-material-info';
    const title = document.createElement('div');
    title.className = 'pba-material-title';
    title.textContent = m.title || '未命名教材';
    info.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'pba-material-sub';
    const owners = (Array.isArray(m.bookIds) ? m.bookIds : []).map(id => bookTitleById.get(id) || '').filter(Boolean);
    sub.textContent = owners.length ? `目前掛在：${owners.join('、')}` : '目前沒掛任何書';
    info.appendChild(sub);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'pba-material-actions';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pba-mini-btn';
    addBtn.textContent = '加入';
    addBtn.addEventListener('click', () => linkLibraryMaterial(m));
    actions.appendChild(addBtn);
    item.appendChild(actions);

    listEl.appendChild(item);
  });
}

async function linkLibraryMaterial(material) {
  if (!CURRENT_BOOK) return;
  const bookIds = (Array.isArray(material.bookIds) ? material.bookIds : []).concat(CURRENT_BOOK.id);
  try {
    const res = await apiPost('material-upsert', { id: material.id, book_ids: Array.from(new Set(bookIds)) });
    if (!res || res.success !== true) {
      showToast('加入失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast(`已把《${material.title || '未命名教材'}》掛進這本書`);
    await refreshCurrentBookAfterMaterialChange();
    renderLibraryList();
  } catch (err) { /* needLogin 已處理 */ }
}

async function refreshCurrentBookAfterMaterialChange() {
  const pkg = await loadPackage();
  if (!pkg) return;
  PACKAGE_DATA = pkg;
  const refreshed = (PACKAGE_DATA.books || []).find(b => CURRENT_BOOK && b.id === CURRENT_BOOK.id);
  if (refreshed) {
    CURRENT_BOOK = refreshed;
    renderMaterialList(refreshed.materials || []);
  }
  renderBookList();
}

// ===== 繪本館優惠活動（一行一條，整批覆蓋） =====
function renderPromotions() {
  const ta = document.getElementById('promoTextarea');
  if (!ta) return;
  ta.value = (PACKAGE_DATA.promotions || []).map(p => p.text || '').filter(Boolean).join('\n');
  document.getElementById('promoStatus').textContent = '';
}

document.getElementById('savePromoBtn').addEventListener('click', async () => {
  const ta = document.getElementById('promoTextarea');
  const statusEl = document.getElementById('promoStatus');
  const items = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  statusEl.textContent = '儲存中…';
  try {
    const res = await apiPost('book-promotions-set', { items });
    if (!res || res.success !== true) {
      statusEl.textContent = '';
      showToast('儲存優惠失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    PACKAGE_DATA.promotions = res.promotions || [];
    renderPromotions();
    statusEl.textContent = `已儲存 ${items.length} 條`;
    showToast('優惠活動已儲存');
  } catch (err) { statusEl.textContent = ''; /* needLogin 已處理 */ }
});

// ===== 優惠活動子分頁左右導覽（🎁 優惠活動／📦 套組設定）=====
// 純顯示切換，不動 promoTextarea 的內容/事件——切分頁不影響已輸入未儲存的優惠文字。
const PBA_PROMO_PANELS = {
  text: document.getElementById('pbaPromoSubpanelText'),
  sets: document.getElementById('pbaPromoSubpanelSets'),
};
const PBA_PROMO_NAV_BTNS = {
  text: document.getElementById('pbaPromoNavBtnText'),
  sets: document.getElementById('pbaPromoNavBtnSets'),
};
function switchPbaPromoTab(tab) {
  Object.keys(PBA_PROMO_PANELS).forEach(key => {
    PBA_PROMO_PANELS[key].style.display = key === tab ? '' : 'none';
    PBA_PROMO_NAV_BTNS[key].classList.toggle('on', key === tab);
  });
}
PBA_PROMO_NAV_BTNS.text.addEventListener('click', () => switchPbaPromoTab('text'));
PBA_PROMO_NAV_BTNS.sets.addEventListener('click', () => switchPbaPromoTab('sets'));

// ===== 套組設定（繪本館頁面頂端「⭐ 套組名稱」橫滑書封小圖排）=====
// 可見性（visible）與「開團中/即將開團」判斷全在後端算好，這裡只負責 CRUD 表單。
// PACKAGE_DATA.sets 表還沒 db push 前可能是 undefined，一律當空陣列處理，不炸頁面。
function renderSetList() {
  const el = document.getElementById('setList');
  if (!el) return;
  el.innerHTML = '';
  const sets = (PACKAGE_DATA.sets || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (!sets.length) {
    el.innerHTML = '<div class="pba-empty-list">尚無資料或表未建立</div>';
    return;
  }
  sets.forEach(s => {
    const row = document.createElement('div');
    row.className = 'pba-set-row';

    const main = document.createElement('div');
    main.className = 'pba-set-row-main';
    const name = document.createElement('div');
    name.className = 'pba-set-row-name';
    name.textContent = s.title || '未命名套組';
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'pba-set-row-meta';
    const evtSpan = document.createElement('span');
    evtSpan.textContent = `綁定團：${s.eventTitle || '—'}`;
    meta.appendChild(evtSpan);
    const showNowSpan = document.createElement('span');
    showNowSpan.textContent = `⚡ 馬上顯示：${s.showNow ? '開' : '關'}`;
    meta.appendChild(showNowSpan);
    const visSpan = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = 'pba-set-dot' + (s.visible ? ' on' : '');
    visSpan.appendChild(dot);
    visSpan.appendChild(document.createTextNode(s.visible ? ' 目前可見' : ' 目前不可見'));
    meta.appendChild(visSpan);
    main.appendChild(meta);
    row.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'pba-set-row-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'pba-mini-btn';
    editBtn.textContent = '編輯';
    editBtn.addEventListener('click', () => openSetForm(s));
    actions.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'pba-mini-btn danger';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', () => deleteSet(s));
    actions.appendChild(delBtn);
    row.appendChild(actions);

    el.appendChild(row);
  });
}

function renderSetBookCheckboxes(selectedIds) {
  const wrap = document.getElementById('sBooks');
  if (!wrap) return;
  wrap.innerHTML = '';
  const selectedSet = new Set(selectedIds || []);
  const books = (PACKAGE_DATA.books || []).slice().sort((a, b) => {
    const aSel = selectedSet.has(a.id) ? 0 : 1;
    const bSel = selectedSet.has(b.id) ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
  });
  if (!books.length) {
    wrap.innerHTML = '<div class="pba-empty-list">還沒有書籍</div>';
    return;
  }
  books.forEach(b => {
    const label = document.createElement('label');
    label.className = 'pba-checkbox-item';
    label.innerHTML = `<input type="checkbox" value="${pbaEscapeAttr(b.id)}"> ${pbaEscapeHtml(b.title || '未命名')}`;
    wrap.appendChild(label);
  });
}

function renderSetEventOptions(selectedId) {
  const sel = document.getElementById('sEvent');
  if (!sel) return;
  sel.innerHTML = '<option value="">不綁定</option>';
  (PACKAGE_DATA.setEventChoices || []).forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    const range = (e.startDate && e.endDate) ? `（${formatAvailableFrom(e.startDate)}–${formatAvailableFrom(e.endDate)}）` : '';
    opt.textContent = `${e.title || '未命名團購'}${range}`;
    sel.appendChild(opt);
  });
  sel.value = selectedId || '';
}

document.getElementById('addSetBtn').addEventListener('click', () => openSetForm(null));
document.getElementById('cancelSetBtn').addEventListener('click', closeSetForm);

function openSetForm(set) {
  setFormEditingId = set ? set.id : null;
  document.getElementById('setFormTitle').textContent = set ? '編輯套組' : '新增套組';
  document.getElementById('sTitle').value = set ? set.title || '' : '';
  document.getElementById('sIntro').value = set ? set.intro || '' : '';
  renderSetBookCheckboxes(set ? set.bookIds || [] : []);
  setCheckedValues('sBooks', set ? set.bookIds || [] : []);
  renderSetEventOptions(set ? set.eventId || '' : '');
  document.getElementById('sShowNow').checked = !!(set && set.showNow);
  document.getElementById('deleteSetBtn').style.display = set ? '' : 'none';
  document.getElementById('setForm').classList.add('show');
}

function closeSetForm() {
  setFormEditingId = null;
  const form = document.getElementById('setForm');
  if (form) form.classList.remove('show');
}

document.getElementById('saveSetBtn').addEventListener('click', async () => {
  const title = document.getElementById('sTitle').value.trim();
  if (!title) { showToast('請輸入套組名稱', true); return; }
  const payload = {
    title,
    intro: document.getElementById('sIntro').value.trim(),
    bookIds: getCheckedValues('sBooks'),
    eventId: document.getElementById('sEvent').value || null,
    showNow: document.getElementById('sShowNow').checked
  };
  if (setFormEditingId) payload.id = setFormEditingId;
  try {
    const res = await apiPost('book-set-upsert', payload);
    if (!res || res.success !== true) {
      showToast('儲存套組失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    const saved = res.set;
    if (saved) {
      PACKAGE_DATA.sets = PACKAGE_DATA.sets || [];
      const idx = PACKAGE_DATA.sets.findIndex(s => s.id === saved.id);
      if (idx >= 0) PACKAGE_DATA.sets[idx] = saved; else PACKAGE_DATA.sets.push(saved);
    }
    renderSetList();
    showToast('套組已儲存');
    closeSetForm();
  } catch (err) { /* needLogin 已處理 */ }
});

document.getElementById('deleteSetBtn').addEventListener('click', () => {
  if (!setFormEditingId) return;
  const set = (PACKAGE_DATA.sets || []).find(s => s.id === setFormEditingId);
  deleteSet(set || { id: setFormEditingId, title: document.getElementById('sTitle').value.trim() });
});

async function deleteSet(set) {
  if (!confirm(`確定要刪除套組「${set.title || '未命名'}」嗎？`)) return;
  try {
    const res = await apiPost('book-set-delete', { id: set.id });
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    PACKAGE_DATA.sets = (PACKAGE_DATA.sets || []).filter(s => s.id !== set.id);
    if (setFormEditingId === set.id) closeSetForm();
    renderSetList();
    showToast('套組已刪除');
  } catch (err) { /* needLogin 已處理 */ }
}

// ===== 滿額贈（累積達標，門檻金額由小到大；後端已排好序） =====
// PACKAGE_DATA.gifts 表還沒 db push 前可能是 undefined，一律當空陣列處理，不炸頁面。
function pbaFormatMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US');
}

function renderGiftList() {
  const el = document.getElementById('giftList');
  if (!el) return;
  el.innerHTML = '';
  const gifts = (PACKAGE_DATA.gifts || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (!gifts.length) {
    el.innerHTML = '<div class="pba-empty-list">尚無資料或表未建立</div>';
    return;
  }
  gifts.forEach(g => {
    const item = document.createElement('div');
    item.className = 'pba-material-item';

    if (g.imageUrl) {
      const img = document.createElement('img');
      img.className = 'pba-material-thumb';
      img.src = g.imageUrl;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'pba-material-thumb placeholder';
      ph.textContent = '🎁';
      item.appendChild(ph);
    }

    const info = document.createElement('div');
    info.className = 'pba-material-info';
    const title = document.createElement('div');
    title.className = 'pba-material-title';
    title.textContent = g.title || '未命名贈品';
    info.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'pba-material-sub';
    const noteSuffix = g.note ? ` ・ ${g.note}` : '';
    sub.textContent = `滿 $${pbaFormatMoney(g.amount)}${noteSuffix}`;
    info.appendChild(sub);
    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'pba-material-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'pba-mini-btn';
    editBtn.textContent = '編輯';
    editBtn.addEventListener('click', () => openGiftForm(g));
    actions.appendChild(editBtn);
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'pba-mini-btn danger';
    delBtn.textContent = '刪除';
    delBtn.addEventListener('click', () => deleteGift(g));
    actions.appendChild(delBtn);
    item.appendChild(actions);

    el.appendChild(item);
  });
}

let giftFormEditingId = null;

function setGiftImagePreview(url) {
  const img = document.getElementById('gImagePreview');
  const ph = document.getElementById('gImagePreviewPh');
  if (url) { img.src = url; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }
}

document.getElementById('addGiftBtn').addEventListener('click', () => openGiftForm(null));
document.getElementById('cancelGiftBtn').addEventListener('click', closeGiftForm);

function openGiftForm(gift) {
  giftFormEditingId = gift ? gift.id : null;
  document.getElementById('giftFormTitle').textContent = gift ? '編輯滿額贈' : '新增滿額贈';
  document.getElementById('gTitle').value = gift ? gift.title || '' : '';
  document.getElementById('gAmount').value = gift ? gift.amount || '' : '';
  document.getElementById('gNote').value = gift ? gift.note || '' : '';
  document.getElementById('gImageUrl').value = gift ? gift.imageUrl || '' : '';
  setGiftImagePreview(gift ? gift.imageUrl || '' : '');
  document.getElementById('gImageUploadStatus').textContent = '';
  document.getElementById('gImageFile').value = '';
  document.getElementById('gImageRemoveBg').value = 'none';
  pbiClearPending('gImagePending');
  document.getElementById('deleteGiftBtn').style.display = gift ? '' : 'none';
  document.getElementById('giftForm').classList.add('show');
}

function closeGiftForm() {
  giftFormEditingId = null;
  const form = document.getElementById('giftForm');
  if (form) form.classList.remove('show');
  document.getElementById('gImageRemoveBg').value = 'none';
  pbiClearPending('gImagePending');
}

document.getElementById('gImageFile').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const giftId = giftFormEditingId || Date.now();
  pbiHandleUpload({
    file,
    maxDim: 600,
    kind: 'gift',
    removeBgCheckboxId: 'gImageRemoveBg',
    statusElId: 'gImageUploadStatus',
    pendingContainerId: 'gImagePending',
    previewSetFn: setGiftImagePreview,
    hiddenInputId: 'gImageUrl',
    fileInputId: 'gImageFile',
    buildFilename: (ext) => `gift-${giftId}${ext}`
  });
});

document.getElementById('saveGiftBtn').addEventListener('click', async () => {
  const title = document.getElementById('gTitle').value.trim();
  if (!title) { showToast('請輸入贈品名稱', true); return; }
  const amountRaw = document.getElementById('gAmount').value.trim();
  const amount = Number(amountRaw);
  if (!amountRaw || !Number.isInteger(amount) || amount <= 0) {
    showToast('金額必須是正整數', true);
    return;
  }
  const payload = {
    title,
    amount,
    note: document.getElementById('gNote').value.trim(),
    imageUrl: document.getElementById('gImageUrl').value.trim()
  };
  if (giftFormEditingId) payload.id = giftFormEditingId;
  try {
    const res = await apiPost('book-gift-upsert', payload);
    if (!res || res.success !== true) {
      showToast('儲存滿額贈失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    const saved = res.gift;
    if (saved) {
      PACKAGE_DATA.gifts = PACKAGE_DATA.gifts || [];
      const idx = PACKAGE_DATA.gifts.findIndex(g => g.id === saved.id);
      if (idx >= 0) PACKAGE_DATA.gifts[idx] = saved; else PACKAGE_DATA.gifts.push(saved);
    }
    renderGiftList();
    showToast('滿額贈已儲存');
    closeGiftForm();
  } catch (err) { /* needLogin 已處理 */ }
});

document.getElementById('deleteGiftBtn').addEventListener('click', () => {
  if (!giftFormEditingId) return;
  const gift = (PACKAGE_DATA.gifts || []).find(g => g.id === giftFormEditingId);
  deleteGift(gift || { id: giftFormEditingId, title: document.getElementById('gTitle').value.trim() });
});

async function deleteGift(gift) {
  if (!confirm(`確定要刪除滿額贈「${gift.title || '未命名'}」嗎？`)) return;
  try {
    const res = await apiPost('book-gift-delete', { id: gift.id });
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    PACKAGE_DATA.gifts = (PACKAGE_DATA.gifts || []).filter(g => g.id !== gift.id);
    if (giftFormEditingId === gift.id) closeGiftForm();
    renderGiftList();
    showToast('滿額贈已刪除');
  } catch (err) { /* needLogin 已處理 */ }
}

// ===== 年齡與主題／類型標籤 清單管理（⚙️ 繪本館設定子分頁；2026-08-27 從書籍編輯表單底部搬出）=====
const OPEN_TAG = { categories: null, types: null }; // 各區展開中的名稱（重繪後保持展開狀態）

// 兩區設定（欄位名＝picture_books 上的陣列欄；checkboxGroup＝書籍編輯表單對應勾選群）。
// canEditNames＝名稱可否增刪：類型表 book_types 是 2026-08-27 的 migration，
// 尚未 db push 時後台包 typesReady=false，先在前端擋掉（後端 handler 也會擋，雙保險）。
const TAG_SECTIONS = {
  categories: {
    containerId: 'categoryManageList',
    checkboxGroup: 'fCategories',
    emptyText: '還沒有年齡與主題',
    hintText: '點封面把書加入或移出這個分類（粉紅框✓＝已加入）',
    canEditNames: () => true,
    deleteTag: (name) => deleteCategory(name),
    tagNames: () => orderedCategoryNames(),
    labelOf: (name) => (CATEGORY_PARENT_OF[name] ? '↳ ' : '') + name, // 子分類縮排掛在母分類底下
    indentOf: (name) => Boolean(CATEGORY_PARENT_OF[name]),
  },
  types: {
    containerId: 'typeManageList',
    checkboxGroup: 'fTypes',
    emptyText: '目前沒有類型',
    hintText: '點封面把書加入或移出這個類型（粉紅框✓＝已加入）',
    canEditNames: () => !PACKAGE_DATA || PACKAGE_DATA.typesReady !== false,
    deleteTag: (name) => deleteType(name),
    tagNames: () => (PACKAGE_DATA.types || []).slice(),
  },
};

function renderCategoryManageList() { renderTagManageCards('categories'); }
function renderTypeManageList() {
  renderTagManageCards('types');
  // 表未 push 保險絲：顯示警告、擋新增（刪除鈕在 renderTagManageCards 內依 canEditNames 不產生）
  const notReady = PACKAGE_DATA && PACKAGE_DATA.typesReady === false;
  document.getElementById('typesNotReady').style.display = notReady ? '' : 'none';
  document.getElementById('newTypeInput').disabled = notReady;
  document.getElementById('addTypeBtn').disabled = notReady;
}

function renderTagManageCards(field) {
  const cfg = TAG_SECTIONS[field];
  const el = document.getElementById(cfg.containerId);
  el.innerHTML = '';
  const tagNames = cfg.tagNames();
  if (!tagNames.length) {
    el.innerHTML = `<div class="pba-empty-list">${cfg.emptyText}</div>`;
    return;
  }
  const books = (PACKAGE_DATA.books || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  tagNames.forEach(tagName => {
    const inTag = books.filter(b => (b[field] || []).includes(tagName));
    const isOpen = OPEN_TAG[field] === tagName;

    const card = document.createElement('div');
    card.className = 'pba-cat-card' + (isOpen ? ' open' : '');
    if (cfg.indentOf && cfg.indentOf(tagName)) card.style.marginLeft = '18px';

    const head = document.createElement('div');
    head.className = 'pba-cat-manage-row';
    const name = document.createElement('span');
    const displayName = cfg.labelOf ? cfg.labelOf(tagName) : tagName;
    name.textContent = `${isOpen ? '▾' : '▸'} ${displayName}（${inTag.length} 本）`;
    head.appendChild(name);
    if (cfg.canEditNames()) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'pba-mini-btn danger';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); cfg.deleteTag(tagName); });
      head.appendChild(delBtn);
    }
    head.addEventListener('click', () => {
      OPEN_TAG[field] = isOpen ? null : tagName;
      renderTagManageCards(field);
    });
    card.appendChild(head);

    // 展開內容：全部書的封面選取牆（仿封面牆圖卡；2026-08-27 取代 chip＋下拉，雪莉指定）
    const body = document.createElement('div');
    body.className = 'pba-cat-books';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11.5px; color:var(--c-muted); margin-bottom:8px; line-height:1.6;';
    hint.textContent = cfg.hintText;
    body.appendChild(hint);
    if (!books.length) {
      const empty = document.createElement('div');
      empty.className = 'pba-empty-list';
      empty.textContent = '還沒有任何繪本';
      body.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'pba-tag-grid';
      books.forEach(b => {
        const bookCard = document.createElement('div');
        bookCard.className = 'pba-tag-card' + ((b[field] || []).includes(tagName) ? ' on' : '');
        if (b.cover_url) {
          const img = document.createElement('img');
          img.className = 'pba-grid-cover';
          img.src = b.cover_url;
          img.draggable = false;
          bookCard.appendChild(img);
        } else {
          const ph = document.createElement('div');
          ph.className = 'pba-grid-cover placeholder';
          ph.textContent = '📖';
          bookCard.appendChild(ph);
        }
        if (!b.is_published) {
          const badge = document.createElement('span');
          badge.className = 'pba-grid-badge pba-badge-draft';
          badge.textContent = '草稿';
          bookCard.appendChild(badge);
        }
        const check = document.createElement('span');
        check.className = 'pba-tag-check';
        check.textContent = '✓';
        bookCard.appendChild(check);
        const t = document.createElement('div');
        t.className = 'pba-grid-title';
        t.textContent = b.title;
        bookCard.appendChild(t);
        bookCard.addEventListener('click', async () => {
          bookCard.classList.add('busy'); // 防連點；成功會整區重繪，失敗時解鎖讓她再試
          await setBookTag(field, b, tagName, !(b[field] || []).includes(tagName));
          bookCard.classList.remove('busy');
        });
        grid.appendChild(bookCard);
      });
      body.appendChild(grid);
    }
    card.appendChild(body);
    el.appendChild(card);
  });
}

/** 從標籤側把書加入/移出：book-upsert partial update 只送 id＋該陣列欄位，其餘欄位不動 */
async function setBookTag(field, book, tagName, add) {
  const next = (book[field] || []).filter(n => n !== tagName);
  if (add) next.push(tagName);
  try {
    const res = await apiPost('book-upsert', { id: book.id, [field]: next });
    if (!res || res.success !== true) {
      showToast((add ? '加入' : '移除') + '失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    book[field] = next; // book 是 PACKAGE_DATA.books 裡的同一個物件，直接改本地資料
    // 若那本書的編輯表單剛好開著，把表單勾選同步過來，避免之後按儲存蓋回舊勾選
    if (CURRENT_BOOK && CURRENT_BOOK.id === book.id) setCheckedValues(TAG_SECTIONS[field].checkboxGroup, next);
    renderTagManageCards(field);
    showToast(add ? `已把《${book.title}》加入「${tagName}」` : `已把《${book.title}》移出「${tagName}」`);
  } catch (err) { /* needLogin 已處理 */ }
}

document.getElementById('addCategoryBtn').addEventListener('click', async () => {
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if (!name) { showToast('請輸入年齡與主題名稱', true); return; }
  try {
    const res = await apiPost('book-category-add', { name });
    if (!res || res.success !== true) {
      showToast('新增失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    input.value = '';
    showToast('年齡與主題已新增');
    await refreshCategoriesOnly();
  } catch (err) { /* needLogin 已處理 */ }
});

async function deleteCategory(name) {
  if (!confirm(`確定要刪除年齡與主題「${name}」嗎？`)) return;
  try {
    const res = await apiPost('book-category-delete', { name });
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast('年齡與主題已刪除');
    await refreshCategoriesOnly();
  } catch (err) { /* needLogin 已處理 */ }
}

async function refreshCategoriesOnly() {
  const pkg = await loadPackage();
  if (!pkg) return;
  PACKAGE_DATA = pkg;
  renderCategoryManageList();
  const prevChecked = getCheckedValues('fCategories');
  renderCategoryCheckboxes();
  setCheckedValues('fCategories', prevChecked);
}

// ---- 類型名稱增刪（book_types 表，2026-08-27 起可後台管理；比照分類那組）----
document.getElementById('addTypeBtn').addEventListener('click', async () => {
  const input = document.getElementById('newTypeInput');
  const name = input.value.trim();
  if (!name) { showToast('請輸入類型名稱', true); return; }
  try {
    const res = await apiPost('book-type-add', { name });
    if (!res || res.success !== true) {
      showToast('新增失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    input.value = '';
    showToast('類型已新增');
    await refreshTypesOnly();
  } catch (err) { /* needLogin 已處理 */ }
});

async function deleteType(name) {
  if (!confirm(`確定要刪除類型「${name}」嗎？\n（已勾這個類型的書不會被改動，只是前台篩選不再出現這個選項）`)) return;
  try {
    const res = await apiPost('book-type-delete', { name });
    if (!res || res.success !== true) {
      showToast('刪除失敗：' + ((res && res.error) || '未知錯誤'), true);
      return;
    }
    showToast('類型已刪除');
    await refreshTypesOnly();
  } catch (err) { /* needLogin 已處理 */ }
}

async function refreshTypesOnly() {
  const pkg = await loadPackage();
  if (!pkg) return;
  PACKAGE_DATA = pkg;
  renderTypeManageList();
  const prevChecked = getCheckedValues('fTypes');
  renderTypeCheckboxes();
  setCheckedValues('fTypes', prevChecked);
}

// ===== 進分頁時載入（admin.js 的 switchView('books') 呼叫）=====
// 跟開團帳務一樣：第一次切過去才拉資料，之後切回來用快取；要強制重拉就按重新整理。
let booksViewLoaded = false;
async function loadBooksView(force) {
  if (booksViewLoaded && !force) return;
  const pkg = await loadPackage();
  if (!pkg) return;
  PACKAGE_DATA = pkg;
  booksViewLoaded = true;
  pbiLoadEngine().catch(() => {}); // 進分頁就背景預載去背引擎，降低第一次選檔時失敗機率
  renderBrandOptions();
  renderCategoryCheckboxes();
  renderTypeCheckboxes();
  renderCategoryManageList();
  renderTypeManageList();
  renderPromotions();
  renderSetList();
  renderGiftList();
  showBookGrid(); // 預設畫面＝封面牆（含 renderBookList）
}

document.getElementById('booksRefreshBtn').addEventListener('click', () => loadBooksView(true));

// ===== 子分頁切換（📖 繪本管理／🎁 優惠活動／⚙️ 繪本館設定）=====
// 純顯示切換，不影響既有的優惠載入/儲存流程（那套邏輯只認 DOM id，跟分頁容器無關）。
const PBA_TAB_PANELS = {
  manage: document.getElementById('pbaTabPanelManage'),
  promo: document.getElementById('pbaTabPanelPromo'),
  settings: document.getElementById('pbaTabPanelSettings'),
};
const PBA_TAB_BTNS = {
  manage: document.getElementById('pbaTabBtnManage'),
  promo: document.getElementById('pbaTabBtnPromo'),
  settings: document.getElementById('pbaTabBtnSettings'),
};
function switchPbaTab(tab) {
  Object.keys(PBA_TAB_PANELS).forEach(key => {
    PBA_TAB_PANELS[key].style.display = key === tab ? '' : 'none';
    PBA_TAB_BTNS[key].classList.toggle('on', key === tab);
  });
  // 進設定頁時重繪兩份標籤清單：書可能剛在編輯表單改過勾選，本數/清單要反映最新狀態
  if (tab === 'settings') { renderCategoryManageList(); renderTypeManageList(); }
}
PBA_TAB_BTNS.manage.addEventListener('click', () => switchPbaTab('manage'));
PBA_TAB_BTNS.promo.addEventListener('click', () => switchPbaTab('promo'));
PBA_TAB_BTNS.settings.addEventListener('click', () => switchPbaTab('settings'));
