// ===================================================================
// contractSign.js — 線上合約用印小工具（純前端，零後端）
//
// 用途：上傳合約檔（PDF 或 JPG/PNG）→ 上傳自己拍的印章照片 → 在頁面上點位置
// 蓋章、可拖曳/縮放/刪除 → 匯出蓋好章的 PDF／JPG 下載，或用系統分享面板
// （手機可直接傳 LINE）。
//
// 鐵律：合約檔與印章圖只留在瀏覽器記憶體（Uint8Array / dataURL / DOM），不呼叫
// 任何 fetch／XHR，不寫入 Code.gs、不落地到任何試算表。按「全部重來」或離開
// 頁面即可讓瀏覽器回收這些資料。
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」（見 10 號檔 §2）。
// 本檔最外層只有「宣告」，不得在最外層直接呼叫 admin.js 的函式或掛 DOM
// listener——一律用 admin.html 的 inline onclick/onchange 觸發（執行期）。
// 執行期依賴 admin.js 的全域 setFormStatus(id, text, cls)。
//
// 依賴（vendor/，本地檔案，UMD，全域變數）：
//   pdfjsLib（vendor/pdfjs.min.js，pdfjs-dist 3.11.174 legacy）→ 讀取/渲染 PDF 頁面
//   PDFLib（vendor/pdf-lib.min.js，pdf-lib 1.17.1）→ 匯出蓋章後的 PDF、內嵌圖片
// 兩者都延後到使用者真的選了合約檔才動態載入（csEnsureLibs），其他人不用白白
// 多下載這兩包（pdfjs 約 370KB＋worker 1.1MB、pdf-lib 約 500KB）。
// ===================================================================

// ----- 模組層狀態（一律放檔案最前段方便維護；不在開機期被讀到） -----

// 動態載入 vendor 函式庫用的快取 Promise，避免重複插入 <script>
let csLibsLoadPromise = null;

// 目前載入的合約：
//   { bytes:Uint8Array, fileName, kind:'pdf'|'image', mimeType, pages:[...] }
// 每個 page 項目：{ canvas, cssW, cssH, pdfW, pdfH, el }
//   canvas       = 渲染出來的頁面畫布（解析度＝cssW/cssH × devicePixelRatio，維持清晰）
//   cssW / cssH  = 畫面上顯示的 CSS px 尺寸——蓋章座標（x/y/w/h）一律用這套座標系
//   pdfW / pdfH  = 匯出 PDF 時要對齊的原始頁面尺寸
//                  PDF 合約＝該頁 viewport(scale=1) 的未縮放尺寸（即 PDF 頁面點數）
//                  圖片合約＝圖片天然像素尺寸
//   el           = 該頁在畫面上的 .cs-page 容器 DOM（蓋章 div 掛在這底下）
let csContract = null;

// 印章資產：{ id, name, rawDataUrl, pngDataUrl, removeWhite, imgW, imgH }
//   rawDataUrl = 原圖轉存的 PNG dataURL（不去白底）
//   pngDataUrl = 去白底後的 PNG dataURL（透明背景）
//   removeWhite = 目前是否套用去白底版本（勾選框狀態，預設 true）
//   兩者都統一存成 PNG，匯出到 pdf-lib 時才能一律用 embedPng，不用分兩套流程。
let csStamps = [];

// 已蓋在頁面上的章：{ id, stampId, pageIndex, x, y, w, h, el, imgEl }
//   x/y/w/h 一律是該頁 CSS px 座標；el/imgEl 是對應的 DOM 節點（拖曳/縮放/合成都直接用）
let csPlacements = [];

let csActiveStampId = null;   // 目前選取、準備拿來蓋章的印章 id
let csSelectedPlacedId = null; // 目前選取（顯示刪除/縮放把手）的已蓋章 id
let csIdSeq = 1;               // 印章與已蓋章共用的流水號

// ===== 函式庫延後載入 =====

function csEnsureLibs() {
  if (typeof PDFLib !== 'undefined' && typeof pdfjsLib !== 'undefined') return Promise.resolve();
  if (csLibsLoadPromise) return csLibsLoadPromise;

  function csLoadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src + ' 載入失敗'));
      document.head.appendChild(s);
    });
  }

  csLibsLoadPromise = Promise.all([
    (typeof pdfjsLib !== 'undefined') ? Promise.resolve() : csLoadScript('vendor/pdfjs.min.js'),
    (typeof PDFLib !== 'undefined') ? Promise.resolve() : csLoadScript('vendor/pdf-lib.min.js')
  ]).then(() => {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs.worker.min.js';
    }
  }).catch((err) => {
    csLibsLoadPromise = null; // 失敗允許下次重試
    throw err;
  });

  return csLibsLoadPromise;
}

// ===== 小工具函式 =====

function csReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function csLoadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片解碼失敗'));
    img.src = url;
  });
}

function csWaitImgReady(img) {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  });
}

function csBytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function csDataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function csDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csBaseFileName() {
  const name = (csContract && csContract.fileName) || '合約';
  return name.replace(/\.[^.]+$/, '');
}

function csDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csCanvasToJpgBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob); else reject(new Error('圖片產生失敗'));
    }, 'image/jpeg', quality);
  });
}

// ===== 合約檔載入 =====

async function csHandleContractFile(files) {
  const file = files && files[0];
  const inputEl = document.getElementById('csContractInput');
  if (!file) return;

  setFormStatus('csStatus', '合約載入中…', '');
  try {
    await csEnsureLibs();

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isImg = /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
    if (!isPdf && !isImg) {
      setFormStatus('csStatus', '只支援 PDF 或 JPG/PNG 檔案，請重新選擇', 'error');
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // 換合約前先清空上一份的頁面 DOM 與已蓋章紀錄（印章資產本身保留，方便換檔重蓋）
    document.getElementById('csPages').innerHTML = '';
    csPlacements = [];
    csSelectedPlacedId = null;
    csContract = null;

    if (isPdf) {
      await csLoadPdfContract(bytes, file.name);
    } else {
      const mimeType = file.type === 'image/png' || (!file.type && /\.png$/i.test(file.name))
        ? 'image/png' : 'image/jpeg';
      await csLoadImageContract(bytes, file.name, mimeType);
    }

    document.getElementById('csContractName').textContent = file.name;
    setFormStatus('csStatus', '合約已載入，先點選印章，再點合約上要蓋的位置', '');
  } catch (err) {
    console.error(err);
    csContract = null;
    setFormStatus('csStatus', '合約載入失敗：' + (err && err.message ? err.message : '請確認檔案是否損毀'), 'error');
  } finally {
    inputEl.value = '';
  }
}

async function csLoadPdfContract(bytes, fileName) {
  // pdfjs 的 {data} 參數會把傳入的 buffer transfer 給 worker（等於清空原 buffer），
  // 之後 pdf-lib 匯出還要用完整的原始 bytes，因此這裡一律傳副本，不動到 bytes 本體。
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdfDoc = await loadingTask.promise;

  const pagesEl = document.getElementById('csPages');
  const containerMaxW = Math.min(pagesEl.clientWidth || 760, 760) || 760;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pages = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = containerMaxW / baseViewport.width;
    const cssViewport = page.getViewport({ scale });
    const cssW = cssViewport.width;
    const cssH = cssViewport.height;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const renderViewport = page.getViewport({ scale: scale * dpr });
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;

    const pageIndex = i - 1;
    const pageWrap = document.createElement('div');
    pageWrap.className = 'cs-page';
    pageWrap.style.width = cssW + 'px';
    pageWrap.style.height = cssH + 'px';
    pageWrap.appendChild(canvas);
    pageWrap.addEventListener('click', (e) => csHandlePageClick(e, pageIndex, pageWrap));
    pagesEl.appendChild(pageWrap);

    // 注意：頁面若有 /Rotate 非 0（掃描件常見的橫躺頁），baseViewport 的座標軸會跟著轉，
    // 匯出時的座標換算（見 csBuildStampedPdfBytes）沒有特別處理旋轉，v1 先接受這個已知限制。
    pages.push({ canvas, cssW, cssH, pdfW: baseViewport.width, pdfH: baseViewport.height, el: pageWrap });
  }

  csContract = { bytes, fileName, kind: 'pdf', mimeType: 'application/pdf', pages };
}

async function csLoadImageContract(bytes, fileName, mimeType) {
  const dataUrl = 'data:' + mimeType + ';base64,' + csBytesToBase64(bytes);
  const img = await csLoadImageFromUrl(dataUrl);

  const pagesEl = document.getElementById('csPages');
  const containerMaxW = Math.min(pagesEl.clientWidth || 760, 760) || 760;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = Math.min(1, containerMaxW / img.naturalWidth);
  const cssW = img.naturalWidth * scale;
  const cssH = img.naturalHeight * scale;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

  const pageWrap = document.createElement('div');
  pageWrap.className = 'cs-page';
  pageWrap.style.width = cssW + 'px';
  pageWrap.style.height = cssH + 'px';
  pageWrap.appendChild(canvas);
  pageWrap.addEventListener('click', (e) => csHandlePageClick(e, 0, pageWrap));
  pagesEl.appendChild(pageWrap);

  csContract = {
    bytes, fileName, kind: 'image', mimeType,
    pages: [{ canvas, cssW, cssH, pdfW: img.naturalWidth, pdfH: img.naturalHeight, el: pageWrap }]
  };
}

// ===== 印章資產（上傳／去白底／選取） =====

async function csHandleStampFiles(files) {
  if (!files || !files.length) return;
  const list = Array.from(files);
  setFormStatus('csStatus', '印章載入中…', '');
  try {
    for (const file of list) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
      await csAddStampFromFile(file);
    }
    setFormStatus('csStatus', '印章已加入，先點選印章，再點合約上要蓋的位置', '');
  } catch (err) {
    console.error(err);
    setFormStatus('csStatus', '印章載入失敗：' + (err && err.message ? err.message : '請確認檔案格式'), 'error');
  } finally {
    document.getElementById('csStampInput').value = '';
  }
}

async function csAddStampFromFile(file) {
  const originalDataUrl = await csReadFileAsDataUrl(file);
  const img = await csLoadImageFromUrl(originalDataUrl);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  const rawDataUrl = canvas.toDataURL('image/png'); // 統一轉存成 PNG，匯出時才能一律 embedPng
  const pngDataUrl = csRemoveWhiteBg(canvas);

  const stamp = {
    id: 'st' + (csIdSeq++),
    name: file.name,
    rawDataUrl,
    pngDataUrl,
    removeWhite: true, // 預設勾選：拍照印章通常帶白紙底，先幫忙去掉
    imgW: canvas.width,
    imgH: canvas.height
  };
  csStamps.push(stamp);
  csRenderStampList();
  if (!csActiveStampId) csSetActiveStamp(stamp.id);
}

// 去白底：min(r,g,b) > 245 直接全透明；215~245 之間線性漸變 alpha
// （拍照的白紙底光線不均，全有全無的門檻會啃到印泥邊緣或留白邊角，漸變比較自然）
function csRemoveWhiteBg(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const LO = 215, HI = 245;
  for (let i = 0; i < data.length; i += 4) {
    const minC = Math.min(data[i], data[i + 1], data[i + 2]);
    if (minC > HI) {
      data[i + 3] = 0;
    } else if (minC > LO) {
      const t = (minC - LO) / (HI - LO); // 0（保留）~1（全透明）
      data[i + 3] = Math.round(data[i + 3] * (1 - t));
    }
  }
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  outCanvas.getContext('2d').putImageData(imageData, 0, 0);
  return outCanvas.toDataURL('image/png');
}

function csRenderStampList() {
  const wrap = document.getElementById('csStampList');
  wrap.innerHTML = '';
  csStamps.forEach((stamp) => {
    const item = document.createElement('div');
    item.className = 'cs-stamp-item' + (stamp.id === csActiveStampId ? ' active' : '');
    item.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return; // 去白底勾選框自己的 click 不連帶切換選取
      csSetActiveStamp(stamp.id);
    };

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'cs-stamp-thumb-wrap';
    const img = document.createElement('img');
    img.src = stamp.removeWhite ? stamp.pngDataUrl : stamp.rawDataUrl;
    img.alt = stamp.name;
    thumbWrap.appendChild(img);
    item.appendChild(thumbWrap);

    const nameEl = document.createElement('div');
    nameEl.className = 'cs-stamp-name';
    nameEl.textContent = stamp.name;
    item.appendChild(nameEl);

    const cbLabel = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = stamp.removeWhite;
    cb.onchange = () => csToggleStampRemoveWhite(stamp.id, cb.checked);
    cbLabel.appendChild(cb);
    cbLabel.appendChild(document.createTextNode('去白底'));
    item.appendChild(cbLabel);

    wrap.appendChild(item);
  });
}

function csSetActiveStamp(id) {
  csActiveStampId = id;
  csRenderStampList();
}

function csToggleStampRemoveWhite(id, checked) {
  const stamp = csStamps.find((s) => s.id === id);
  if (!stamp) return;
  stamp.removeWhite = checked;
  csRenderStampList();
  // 已經蓋在頁面上的同一顆印章，跟著換成對應版本的圖
  csPlacements.filter((p) => p.stampId === id).forEach((p) => {
    if (p.imgEl) p.imgEl.src = checked ? stamp.pngDataUrl : stamp.rawDataUrl;
  });
}

// ===== 蓋章：點位置新增／拖曳／縮放／刪除 =====

function csHandlePageClick(e, pageIndex, pageWrap) {
  if (e.target.closest('.cs-placed')) return; // 點到已蓋的章由它自己的 click handler 處理
  csDeselectPlaced();

  if (!csActiveStampId) {
    setFormStatus('csStatus', '請先在上方點選一顆印章，再點頁面上要蓋章的位置', 'error');
    return;
  }
  const stamp = csStamps.find((s) => s.id === csActiveStampId);
  if (!stamp) { csActiveStampId = null; return; }

  const rect = pageWrap.getBoundingClientRect();
  const cssW = csContract.pages[pageIndex].cssW;
  const cssH = csContract.pages[pageIndex].cssH;
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  const w = cssW * 0.22;
  const h = w * (stamp.imgH / stamp.imgW);
  let x = clickX - w / 2;
  let y = clickY - h / 2;
  x = Math.max(0, Math.min(x, cssW - w));
  y = Math.max(0, Math.min(y, cssH - h));

  csAddPlacement(stamp, pageIndex, pageWrap, x, y, w, h);
  setFormStatus('csStatus', '已蓋章，可拖曳調整位置，右下角把手縮放，右上角 ✕ 刪除', '');
}

function csAddPlacement(stamp, pageIndex, pageWrap, x, y, w, h) {
  const id = 'pl' + (csIdSeq++);

  const div = document.createElement('div');
  div.className = 'cs-placed';
  div.style.left = x + 'px';
  div.style.top = y + 'px';
  div.style.width = w + 'px';
  div.style.height = h + 'px';

  const img = document.createElement('img');
  img.src = stamp.removeWhite ? stamp.pngDataUrl : stamp.rawDataUrl;
  img.draggable = false;
  img.alt = stamp.name;
  div.appendChild(img);

  const delBtn = document.createElement('span');
  delBtn.className = 'cs-placed-del';
  delBtn.textContent = '✕';
  delBtn.onclick = (e) => { e.stopPropagation(); csRemovePlacement(id); };
  div.appendChild(delBtn);

  const resizeHandle = document.createElement('span');
  resizeHandle.className = 'cs-placed-resize';
  resizeHandle.textContent = '◢';
  div.appendChild(resizeHandle);

  const placement = { id, stampId: stamp.id, pageIndex, x, y, w, h, el: div, imgEl: img };
  csPlacements.push(placement);
  pageWrap.appendChild(div);

  div.addEventListener('click', (e) => { e.stopPropagation(); csSelectPlaced(id); });
  csWirePlacedDrag(div, placement);
  csWireResizeHandle(resizeHandle, placement);

  csSelectPlaced(id);
}

function csSelectPlaced(id) {
  csSelectedPlacedId = id;
  csPlacements.forEach((p) => p.el.classList.toggle('selected', p.id === id));
}

function csDeselectPlaced() {
  csSelectedPlacedId = null;
  csPlacements.forEach((p) => p.el.classList.remove('selected'));
}

function csRemovePlacement(id) {
  const idx = csPlacements.findIndex((p) => p.id === id);
  if (idx === -1) return;
  csPlacements[idx].el.remove();
  csPlacements.splice(idx, 1);
  if (csSelectedPlacedId === id) csSelectedPlacedId = null;
}

// 拖曳移動：一律用 Pointer Events＋setPointerCapture，手機觸控與滑鼠共用同一套邏輯，
// 且移動到元素邊界外時事件仍會持續送到同一個目標，不用額外掛 document 層級的 listener。
function csWirePlacedDrag(div, placement) {
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  div.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cs-placed-resize') || e.target.closest('.cs-placed-del')) return;
    e.stopPropagation();
    csSelectPlaced(placement.id);
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = placement.x;
    startTop = placement.y;
    div.setPointerCapture(e.pointerId);
  });

  div.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const cssW = csContract.pages[placement.pageIndex].cssW;
    const cssH = csContract.pages[placement.pageIndex].cssH;
    let nx = startLeft + (e.clientX - startX);
    let ny = startTop + (e.clientY - startY);
    nx = Math.max(0, Math.min(nx, cssW - placement.w));
    ny = Math.max(0, Math.min(ny, cssH - placement.h));
    placement.x = nx;
    placement.y = ny;
    div.style.left = nx + 'px';
    div.style.top = ny + 'px';
  });

  function endDrag() { dragging = false; }
  div.addEventListener('pointerup', endDrag);
  div.addEventListener('pointercancel', endDrag);
}

// 縮放：拖右下角把手，等比例（依建立當下的寬高比）縮放，最小寬 30px，不可超出頁面邊界。
function csWireResizeHandle(handle, placement) {
  let resizing = false;
  let startX = 0, startW = 0, startH = 0;
  const ratio = placement.w / placement.h;
  const MIN_W = 30;

  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startW = placement.w;
    startH = placement.h;
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const cssW = csContract.pages[placement.pageIndex].cssW;
    const cssH = csContract.pages[placement.pageIndex].cssH;
    const dx = e.clientX - startX;

    let newW = Math.max(MIN_W, startW + dx);
    // 不可超出頁面右／下邊界，兩個限制取較嚴的一邊，再依比例反推另一邊
    newW = Math.min(newW, cssW - placement.x);
    let newH = newW / ratio;
    if (newH > cssH - placement.y) {
      newH = cssH - placement.y;
      newW = newH * ratio;
    }
    if (newW < MIN_W) { newW = MIN_W; newH = MIN_W / ratio; }

    placement.w = newW;
    placement.h = newH;
    placement.el.style.width = newW + 'px';
    placement.el.style.height = newH + 'px';
  });

  function endResize() { resizing = false; }
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);
}

// ===== 匯出：共用邏輯（產生蓋章後的 PDF bytes／合成單頁圖），供下載與分享共用 =====

// 產生蓋好章的 PDF 完整位元組（pdf-lib）。下載 PDF、分享 PDF 都走這支，只算一次。
async function csBuildStampedPdfBytes() {
  await csEnsureLibs();
  const { PDFDocument } = PDFLib;

  let doc;
  if (csContract.kind === 'pdf') {
    doc = await PDFDocument.load(csContract.bytes, { ignoreEncryption: true });
  } else {
    doc = await PDFDocument.create();
    const pageData = csContract.pages[0];
    const page = doc.addPage([pageData.pdfW, pageData.pdfH]);
    const embeddedBg = csContract.mimeType === 'image/png'
      ? await doc.embedPng(csContract.bytes)
      : await doc.embedJpg(csContract.bytes);
    page.drawImage(embeddedBg, { x: 0, y: 0, width: pageData.pdfW, height: pageData.pdfH });
  }

  // 同一顆印章資產（含去白底狀態）只 embedPng 一次，重複蓋很多次也不會重複佔檔案大小
  const embedCache = new Map();
  for (const placement of csPlacements) {
    const stamp = csStamps.find((s) => s.id === placement.stampId);
    if (!stamp) continue;

    const cacheKey = stamp.id + '|' + (stamp.removeWhite ? '1' : '0');
    let embedded = embedCache.get(cacheKey);
    if (!embedded) {
      const dataUrl = stamp.removeWhite ? stamp.pngDataUrl : stamp.rawDataUrl;
      embedded = await doc.embedPng(csDataUrlToBytes(dataUrl));
      embedCache.set(cacheKey, embedded);
    }

    const page = doc.getPage(placement.pageIndex);
    const pageData = csContract.pages[placement.pageIndex];
    const k = page.getWidth() / pageData.cssW; // CSS px → PDF 點數的縮放比
    // PDF 座標原點在左下角、畫面座標原點在左上角，y 軸要翻轉：
    // 用「頁高 - (章的上緣 y + 章高 h) × k」換算成章底部到頁面底部的距離
    page.drawImage(embedded, {
      x: placement.x * k,
      y: page.getHeight() - (placement.y + placement.h) * k,
      width: placement.w * k,
      height: placement.h * k
    });
  }

  return doc.save();
}

// 合成單頁「底圖＋章」到一張 canvas（存圖片、分享圖片都用得到）。
// 章的座標存的是 CSS px，頁面 canvas 的實際解析度是 CSS px 的 devicePixelRatio 倍，
// 畫上去前要用 srcCanvas.width / cssW 換算回實際像素，否則章的位置/大小會跟畫面對不上。
async function csComposePageCanvas(pageIndex) {
  const pageData = csContract.pages[pageIndex];
  const srcCanvas = pageData.canvas;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = srcCanvas.width;
  outCanvas.height = srcCanvas.height;
  const ctx = outCanvas.getContext('2d');

  // JPG 沒有透明通道，先鋪白底再畫合約內容（保險用；合約掃描檔本來也多半是白底）
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  ctx.drawImage(srcCanvas, 0, 0);

  const scale = srcCanvas.width / pageData.cssW; // canvas 實際像素 ÷ CSS px 尺寸
  const placements = csPlacements.filter((p) => p.pageIndex === pageIndex);
  for (const p of placements) {
    if (!p.imgEl) continue;
    await csWaitImgReady(p.imgEl);
    ctx.drawImage(p.imgEl, p.x * scale, p.y * scale, p.w * scale, p.h * scale);
  }

  return outCanvas;
}

function csRequireContract() {
  if (!csContract) {
    setFormStatus('csStatus', '請先選擇合約檔', 'error');
    return false;
  }
  return true;
}

function csSetExportButtonsDisabled(disabled) {
  ['csExportPdfBtn', 'csExportImgBtn', 'csShareBtn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

// ===== 匯出：下載 PDF =====

async function csExportPdf() {
  if (!csRequireContract()) return;
  csSetExportButtonsDisabled(true);
  setFormStatus('csStatus', '匯出 PDF 中…', '');
  try {
    const bytes = await csBuildStampedPdfBytes();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    csDownloadBlob(blob, csBaseFileName() + '_已用印.pdf');
    setFormStatus('csStatus', 'PDF 已下載', '');
  } catch (err) {
    console.error(err);
    setFormStatus('csStatus', '匯出 PDF 失敗：' + (err && err.message ? err.message : '請稍後再試'), 'error');
  } finally {
    csSetExportButtonsDisabled(false);
  }
}

// ===== 匯出：存成圖片（JPG）=====
// 單頁：檔名_已用印.jpg；多頁：檔名_已用印_p1.jpg、_p2.jpg…逐頁觸發下載。

async function csExportImages() {
  if (!csRequireContract()) return;
  csSetExportButtonsDisabled(true);
  setFormStatus('csStatus', '合成圖片中…', '');
  try {
    const baseName = csBaseFileName();
    const pageCount = csContract.pages.length;
    for (let i = 0; i < pageCount; i++) {
      const canvas = await csComposePageCanvas(i);
      const blob = await csCanvasToJpgBlob(canvas, 0.92);
      const filename = pageCount > 1
        ? baseName + '_已用印_p' + (i + 1) + '.jpg'
        : baseName + '_已用印.jpg';
      csDownloadBlob(blob, filename);
      if (i < pageCount - 1) await csDelay(300); // 連續觸發多個下載，部分瀏覽器會擋，錯開時間比較穩
    }
    setFormStatus('csStatus', pageCount > 1 ? ('已下載 ' + pageCount + ' 張圖片') : '圖片已下載', '');
  } catch (err) {
    console.error(err);
    setFormStatus('csStatus', '存成圖片失敗：' + (err && err.message ? err.message : '請稍後再試'), 'error');
  } finally {
    csSetExportButtonsDisabled(false);
  }
}

// ===== 匯出：分享（Web Share API，手機可直接傳 LINE 等 App）=====
// 優先分享蓋好章的 PDF；裝置的分享面板不接受 PDF 就退而分享合成好的 JPG 圖片；
// 完全不支援分享（常見於桌機瀏覽器）就提示改用下載按鈕，不當成錯誤。
// 使用者自己在分享面板按取消（AbortError）也不算錯誤。

async function csShareViaWebShare() {
  if (!csRequireContract()) return;

  if (typeof navigator.share !== 'function') {
    setFormStatus('csStatus', '此裝置不支援直接分享，請改用下載按鈕', 'error');
    return;
  }

  csSetExportButtonsDisabled(true);
  setFormStatus('csStatus', '準備分享內容中…', '');
  try {
    const baseName = csBaseFileName();
    const pdfBytes = await csBuildStampedPdfBytes();
    const pdfFile = new File([pdfBytes], baseName + '_已用印.pdf', { type: 'application/pdf' });

    const canCheckShare = typeof navigator.canShare === 'function';
    let shareFiles = null;

    if (!canCheckShare || navigator.canShare({ files: [pdfFile] })) {
      shareFiles = [pdfFile];
    } else {
      // 這台裝置的分享面板不接受 PDF，退而分享合成好的 JPG 圖片
      const pageCount = csContract.pages.length;
      const jpgFiles = [];
      for (let i = 0; i < pageCount; i++) {
        const canvas = await csComposePageCanvas(i);
        const blob = await csCanvasToJpgBlob(canvas, 0.92);
        const filename = pageCount > 1
          ? baseName + '_已用印_p' + (i + 1) + '.jpg'
          : baseName + '_已用印.jpg';
        jpgFiles.push(new File([blob], filename, { type: 'image/jpeg' }));
      }
      if (navigator.canShare({ files: jpgFiles })) {
        shareFiles = jpgFiles;
      }
    }

    if (!shareFiles) {
      setFormStatus('csStatus', '此裝置不支援直接分享，請改用下載按鈕', 'error');
      return;
    }

    await navigator.share({ files: shareFiles, title: baseName });
    setFormStatus('csStatus', '已開啟分享面板', '');
  } catch (err) {
    if (err && err.name === 'AbortError') {
      // 使用者自己在分享面板按取消，不算錯誤，狀態列清空即可
      setFormStatus('csStatus', '', '');
    } else {
      console.error(err);
      setFormStatus('csStatus', '分享失敗：' + (err && err.message ? err.message : '請改用下載按鈕'), 'error');
    }
  } finally {
    csSetExportButtonsDisabled(false);
  }
}

// ===== 全部重來 =====
// 「用完即刪」的承諾：清空全部狀態＋DOM＋file input 值，讓瀏覽器可以回收這些記憶體。

function csResetAll() {
  csContract = null;
  csStamps = [];
  csPlacements = [];
  csActiveStampId = null;
  csSelectedPlacedId = null;

  document.getElementById('csPages').innerHTML = '';
  document.getElementById('csStampList').innerHTML = '';
  document.getElementById('csContractName').textContent = '';
  document.getElementById('csContractInput').value = '';
  document.getElementById('csStampInput').value = '';

  csSetExportButtonsDisabled(false);
  setFormStatus('csStatus', '已全部清除', '');
}
