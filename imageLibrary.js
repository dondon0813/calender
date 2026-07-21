// ===================================================================
// imageLibrary.js — 圖片庫：瀏覽／上傳／改名／刪除／批次轉WebP／搬移
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('imageLibrary')
// → ilLoadFolderOptions()/ilLoad()；本檔若排在後面，開機當下函式還不存在，整頁變磚。
//
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得在最外層直接呼叫 admin.js 的函式。
// 執行期依賴 admin.js 的全域：postTask、setFormStatus、isAdmin、myPermissions 等
// ——都在事件/函式內才會被讀到，載入順序安全。權限檢查仍在 admin.js 的 switchView。
// ===================================================================

// ===== 【新】圖片庫：瀏覽／上傳／改名／刪除／批次轉WebP =====

let ilFiles = [];          // 目前資料夾下的檔案清單（來自 image-list）
let ilSelected = new Set(); // 勾選的檔案 path，批次轉WebP／刪除／搬移共用同一組選取

function ilCurrentFolder() {
  const sel = document.getElementById('ilFolderSelect');
  if (sel.value === '__custom__') {
    return document.getElementById('ilCustomFolderInput').value.trim() || 'images';
  }
  return sel.value;
}

document.getElementById('ilFolderSelect').addEventListener('change', (e) => {
  document.getElementById('ilCustomFolderInput').style.display = e.target.value === '__custom__' ? 'inline-block' : 'none';
});
document.getElementById('ilRefreshBtn').addEventListener('click', () => { ilLoadFolderOptions().then(() => ilLoad()); });
document.getElementById('ilCustomFolderInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ilLoad();
});
document.getElementById('ilSearchInput').addEventListener('input', () => ilRenderGrid());

// 一鍵修復：把已經有 webp 版本、但試算表網址還沒跟著換的欄位全部修好，不會重新轉檔
document.getElementById('ilRepairRefsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('ilRepairRefsBtn');
  btn.disabled = true;
  setFormStatus('ilRepairStatus', '掃描試算表中，圖片數量多的話可能要一點時間，請耐心等候…', '');
  try {
    const result = await postTask({ type: 'image-repair-webp-refs' });
    setFormStatus('ilRepairStatus', `完成，共修好 ${result.updated} 處試算表網址 ✓`, 'ok');
  } catch (err) {
    setFormStatus('ilRepairStatus', '修復失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

// 動態掃描 repo 實際的資料夾結構，填進資料夾下拉選單（取代原本寫死的固定清單，
// 這樣新增資料夾、或資料夾名稱大小寫跟原本猜的不一樣，都能正確被抓到）
async function ilLoadFolderOptions() {
  const sel = document.getElementById('ilFolderSelect');
  const moveSel = document.getElementById('ilMoveTargetSelect');
  const prevVal = sel.value === '__custom__' ? '' : sel.value;
  try {
    const result = await postTask({ type: 'image-folder-list' });
    const scanned = Array.isArray(result.folders) ? result.folders : [];
    // 保底一定要有 images 這個常用選項，即使掃描結果因故是空的也不會選單空白
    const folders = Array.from(new Set(['images'].concat(scanned))).sort();

    sel.innerHTML = '';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      sel.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = '自訂路徑…';
    sel.appendChild(customOpt);

    if (prevVal && folders.indexOf(prevVal) !== -1) sel.value = prevVal;

    // 搬移目標選單用同一份資料夾清單，多一個「搬到…」的預設空白選項
    moveSel.innerHTML = '<option value="">搬到…</option>';
    folders.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      moveSel.appendChild(opt);
    });
    const moveCustomOpt = document.createElement('option');
    moveCustomOpt.value = '__custom__';
    moveCustomOpt.textContent = '自訂路徑…';
    moveSel.appendChild(moveCustomOpt);
  } catch (err) {
    console.warn('資料夾清單讀取失敗，沿用目前選單：', err);
  }
}

async function ilLoad() {
  const grid = document.getElementById('ilGrid');
  grid.innerHTML = '<div class="il-empty">載入中…</div>';
  ilSelected.clear();
  document.getElementById('ilSelectAllCheckbox').checked = false;
  try {
    const result = await postTask({ type: 'image-list', path: ilCurrentFolder() });
    ilFiles = Array.isArray(result.files) ? result.files : [];
    ilRenderGrid();
  } catch (err) {
    grid.innerHTML = '<div class="il-empty">讀取失敗：' + escHtml(err.message) + '</div>';
  }
}

function ilIsWebp(name) {
  return /\.webp$/i.test(name);
}

function ilRenderGrid() {
  const grid = document.getElementById('ilGrid');
  const search = (document.getElementById('ilSearchInput').value || '').trim().toLowerCase();
  let items = ilFiles;
  if (search) items = items.filter(f => f.name.toLowerCase().includes(search));

  if (!items.length) {
    grid.innerHTML = '<div class="il-empty">這個資料夾裡沒有找到圖片</div>';
    return;
  }

  grid.innerHTML = '';
  items.forEach(f => {
    const card = document.createElement('div');
    card.className = 'il-card';

    const isWebp = ilIsWebp(f.name);

    // 每張圖都有勾選框，用來做批次刪除／批次搬移；WebP徽章跟勾選框可以同時存在
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'il-card-checkbox';
    cb.checked = ilSelected.has(f.path);
    cb.addEventListener('change', () => {
      if (cb.checked) ilSelected.add(f.path); else ilSelected.delete(f.path);
    });
    card.appendChild(cb);

    if (isWebp) {
      const badge = document.createElement('span');
      badge.className = 'il-card-webp-badge';
      badge.textContent = 'WebP';
      card.appendChild(badge);
    }

    const img = document.createElement('img');
    img.src = f.download_url;
    img.loading = 'lazy';
    card.appendChild(img);

    const body = document.createElement('div');
    body.className = 'il-card-body';

    const nameEl = document.createElement('div');
    nameEl.className = 'il-card-name';
    nameEl.textContent = f.name;
    body.appendChild(nameEl);

    const actions = document.createElement('div');
    actions.className = 'il-card-actions';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 複製';
    copyBtn.addEventListener('click', (e) => copyText(f.download_url, e.currentTarget));
    actions.appendChild(copyBtn);

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️ 改名';
    renameBtn.addEventListener('click', () => ilRenameFile(f));
    actions.appendChild(renameBtn);

    if (!isWebp) {
      const convertBtn = document.createElement('button');
      convertBtn.className = 'primary';
      convertBtn.textContent = '🔄 轉WebP';
      convertBtn.addEventListener('click', () => ilConvertOneToWebp(f));
      actions.appendChild(convertBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = '🗑 刪除';
    delBtn.addEventListener('click', () => ilDeleteFile(f));
    actions.appendChild(delBtn);

    body.appendChild(actions);
    card.appendChild(body);
    grid.appendChild(card);
  });
}

// 全選／取消全選：只作用在「目前有依搜尋條件顯示出來」的那些圖片，不會動到被篩掉、看不到的項目
document.getElementById('ilSelectAllCheckbox').addEventListener('change', (e) => {
  const search = (document.getElementById('ilSearchInput').value || '').trim().toLowerCase();
  let items = ilFiles;
  if (search) items = items.filter(f => f.name.toLowerCase().includes(search));
  if (e.target.checked) {
    items.forEach(f => ilSelected.add(f.path));
  } else {
    items.forEach(f => ilSelected.delete(f.path));
  }
  ilRenderGrid();
});

// 把一個 File 物件轉成壓縮過的 WebP，回傳不含 data: 前綴的 base64 字串
function ilLoadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ilLoadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // raw.githubusercontent.com 有開放 CORS，才能畫進 canvas 讀取像素
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 偵測目前瀏覽器實際上能不能把 canvas 轉出真正的 WebP（iPhone 的 Safari 目前不支援，
// 遇到不支援時 canvas.toDataURL 會偷偷退回 PNG，所以要實際測一次結果，不能只看瀏覽器名稱猜）
let ilWebpSupportChecked = false;
let ilWebpSupported = false;
function ilCheckWebpSupport() {
  if (ilWebpSupportChecked) return ilWebpSupported;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const dataUrl = canvas.toDataURL('image/webp', 0.8);
  ilWebpSupported = dataUrl.indexOf('data:image/webp') === 0;
  ilWebpSupportChecked = true;
  return ilWebpSupported;
}

// 把圖片畫進 canvas 並壓縮輸出：能轉 WebP 的瀏覽器輸出 WebP，不能轉的老實輸出 PNG
// （寧可格式退回 PNG，也不要把 PNG 內容硬取名成 .webp，不然檔名跟實際內容對不上，圖片會打不開）
function ilEncodeImage(img, quality, maxDim) {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  const supportsWebp = ilCheckWebpSupport();
  const mime = supportsWebp ? 'image/webp' : 'image/png';
  const dataUrl = canvas.toDataURL(mime, quality);
  return { base64: dataUrl.split(',')[1], ext: supportsWebp ? '.webp' : '.png', isWebp: supportsWebp };
}

// 檔名去掉副檔名，換成指定的新副檔名（例如 '.webp' 或 '.png'）
function ilSwapExt(filename, ext) {
  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  return base + ext;
}

document.getElementById('ilUploadBtn').addEventListener('click', async () => {
  const input = document.getElementById('ilUploadInput');
  const files = Array.from(input.files || []);
  if (!files.length) {
    setFormStatus('ilUploadStatus', '請先選擇要上傳的圖片', 'error');
    return;
  }
  const btn = document.getElementById('ilUploadBtn');
  btn.disabled = true;
  const folder = ilCurrentFolder();
  let okCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    setFormStatus('ilUploadStatus', `處理中… (${i + 1}/${files.length}) ${file.name}`, '');
    try {
      const img = await ilLoadImageFromFile(file);
      const encoded = ilEncodeImage(img, 0.82, 1600);
      const filename = ilSwapExt(file.name, encoded.ext);
      await postTask({ type: 'image-upload', folder, filename, dataBase64: encoded.base64 });
      okCount++;
    } catch (err) {
      setFormStatus('ilUploadStatus', `「${file.name}」上傳失敗：${err.message}`, 'error');
    }
  }

  const browserNote = ilCheckWebpSupport() ? '' : '（這個瀏覽器不支援轉WebP，已改存成PNG；要轉WebP請改用電腦的Chrome/Edge/Firefox）';
  setFormStatus('ilUploadStatus', `完成，成功上傳 ${okCount}/${files.length} 張 ✓${browserNote}`, okCount === files.length ? 'ok' : 'error');
  input.value = '';
  btn.disabled = false;
  await ilLoad();
});

async function ilRenameFile(f) {
  const currentName = f.name;
  const dot = currentName.lastIndexOf('.');
  const baseName = dot === -1 ? currentName : currentName.slice(0, dot);
  const newBase = prompt('輸入新的檔名（不用打副檔名）：', baseName);
  if (!newBase || !newBase.trim() || newBase.trim() === baseName) return;
  const ext = dot === -1 ? '' : currentName.slice(dot);
  const newFilename = newBase.trim() + ext;
  try {
    const result = await postTask({ type: 'image-rename', oldPath: f.path, newFilename });
    if (result.updatedRefs > 0) {
      alert(`改名成功，已自動更新 ${result.updatedRefs} 處試算表引用 ✓`);
    }
    await ilLoad();
  } catch (err) {
    alert('改名失敗：' + err.message);
  }
}

async function ilDeleteFile(f) {
  try {
    const usage = await postTask({ type: 'image-usage-check', path: f.path });
    const refs = usage.refs || [];
    let confirmMsg = `確定要刪除「${f.name}」嗎？刪除後無法復原。`;
    if (refs.length) {
      confirmMsg = `⚠️ 這張圖目前被 ${refs.length} 處試算表欄位引用（例如 ${refs[0].sheet} 分頁），刪除後那些地方的圖會消失。確定還是要刪除嗎？`;
    }
    if (!confirm(confirmMsg)) return;
    await postTask({ type: 'image-delete', path: f.path });
    await ilLoad();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function ilConvertOneToWebp(f) {
  if (!ilCheckWebpSupport()) {
    alert('這個瀏覽器沒辦法轉出真正的 WebP 格式（常見於 iPhone 的 Safari），麻煩改用電腦上的 Chrome、Edge 或 Firefox 瀏覽器來做這個轉檔。');
    return;
  }
  try {
    const img = await ilLoadImageFromUrl(f.download_url);
    const encoded = ilEncodeImage(img, 0.82, 1600);
    const result = await postTask({ type: 'image-add-webp-version', oldPath: f.path, dataBase64: encoded.base64 });
    if (result.updatedRefs > 0) {
      alert(`已新增 WebP 版本，並自動更新 ${result.updatedRefs} 處試算表引用 ✓（原圖保留未刪除）`);
    }
    await ilLoad();
  } catch (err) {
    alert(`「${f.name}」轉檔失敗：${err.message}`);
  }
}

document.getElementById('ilBatchConvertBtn').addEventListener('click', async () => {
  if (!ilCheckWebpSupport()) {
    setFormStatus('ilBatchStatus', '這個瀏覽器沒辦法轉出真正的WebP（常見於iPhone的Safari），請改用電腦的Chrome/Edge/Firefox', 'error');
    return;
  }
  const selected = ilFiles.filter(f => ilSelected.has(f.path));
  const targets = selected.filter(f => !ilIsWebp(f.name));
  const skipped = selected.length - targets.length;
  if (!targets.length) {
    setFormStatus('ilBatchStatus', selected.length ? '勾選的圖片都已經是WebP了，不用轉' : '請先勾選要轉檔的圖片', 'error');
    return;
  }
  const btn = document.getElementById('ilBatchConvertBtn');
  btn.disabled = true;
  let okCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    setFormStatus('ilBatchStatus', `轉檔中… (${i + 1}/${targets.length}) ${f.name}`, '');
    try {
      const img = await ilLoadImageFromUrl(f.download_url);
      const encoded = ilEncodeImage(img, 0.82, 1600);
      await postTask({ type: 'image-add-webp-version', oldPath: f.path, dataBase64: encoded.base64 });
      okCount++;
    } catch (err) {
      console.warn('批次轉檔失敗：', f.name, err);
    }
  }
  const skipNote = skipped ? `，略過 ${skipped} 張已是WebP的` : '';
  setFormStatus('ilBatchStatus', `完成，成功轉換 ${okCount}/${targets.length} 張 ✓（原圖皆保留）${skipNote}`, okCount === targets.length ? 'ok' : 'error');
  btn.disabled = false;
  ilSelected.clear();
  await ilLoad();
});

// 【新】批次刪除：勾選的圖片一次刪除，刪除前先統一檢查有沒有被試算表引用
document.getElementById('ilBatchDeleteBtn').addEventListener('click', async () => {
  const targets = ilFiles.filter(f => ilSelected.has(f.path));
  if (!targets.length) {
    setFormStatus('ilBatchStatus', '請先勾選要刪除的圖片', 'error');
    return;
  }
  const btn = document.getElementById('ilBatchDeleteBtn');
  btn.disabled = true;
  let totalRefs = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    setFormStatus('ilBatchStatus', `檢查引用中… (${i + 1}/${targets.length}) ${f.name}`, '');
    try {
      const usage = await postTask({ type: 'image-usage-check', path: f.path });
      totalRefs += (usage.refs || []).length;
    } catch (err) {
      console.warn('這張檢查失敗，略過繼續檢查下一張：', f.name, err);
    }
  }
  let confirmMsg = `確定要刪除這 ${targets.length} 張圖片嗎？此動作無法復原。`;
  if (totalRefs > 0) {
    confirmMsg = `⚠️ 這些圖片中總共有 ${totalRefs} 處被試算表欄位引用，刪除後那些地方的圖會消失。確定還是要刪除這 ${targets.length} 張嗎？`;
  }
  if (!confirm(confirmMsg)) {
    btn.disabled = false;
    setFormStatus('ilBatchStatus', '', '');
    return;
  }

  let okCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    setFormStatus('ilBatchStatus', `刪除中… (${i + 1}/${targets.length}) ${f.name}`, '');
    try {
      await postTask({ type: 'image-delete', path: f.path });
      okCount++;
    } catch (err) {
      console.warn('刪除失敗：', f.name, err);
    }
  }
  setFormStatus('ilBatchStatus', `完成，成功刪除 ${okCount}/${targets.length} 張 ✓`, okCount === targets.length ? 'ok' : 'error');
  btn.disabled = false;
  ilSelected.clear();
  await ilLoad();
});

// 【新】批次搬移：把勾選的圖片搬到另一個資料夾，檔名不變，試算表引用會自動更新
document.getElementById('ilMoveTargetSelect').addEventListener('change', (e) => {
  document.getElementById('ilMoveCustomFolderInput').style.display = e.target.value === '__custom__' ? 'inline-block' : 'none';
});

function ilMoveTargetFolder() {
  const sel = document.getElementById('ilMoveTargetSelect');
  if (sel.value === '__custom__') {
    return document.getElementById('ilMoveCustomFolderInput').value.trim();
  }
  return sel.value;
}

document.getElementById('ilBatchMoveBtn').addEventListener('click', async () => {
  const targets = ilFiles.filter(f => ilSelected.has(f.path));
  if (!targets.length) {
    setFormStatus('ilBatchStatus', '請先勾選要搬移的圖片', 'error');
    return;
  }
  const targetFolder = ilMoveTargetFolder();
  if (!targetFolder) {
    setFormStatus('ilBatchStatus', '請選擇要搬到哪個資料夾', 'error');
    return;
  }
  if (targetFolder === ilCurrentFolder()) {
    setFormStatus('ilBatchStatus', '目標資料夾跟目前資料夾相同，不用搬', 'error');
    return;
  }

  const btn = document.getElementById('ilBatchMoveBtn');
  btn.disabled = true;
  let okCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    setFormStatus('ilBatchStatus', `搬移中… (${i + 1}/${targets.length}) ${f.name}`, '');
    try {
      await postTask({ type: 'image-move', oldPath: f.path, newFolder: targetFolder });
      okCount++;
    } catch (err) {
      console.warn('搬移失敗：', f.name, err);
    }
  }
  setFormStatus('ilBatchStatus', `完成，成功搬移 ${okCount}/${targets.length} 張到「${targetFolder}」✓（試算表引用已自動更新）`, okCount === targets.length ? 'ok' : 'error');
  btn.disabled = false;
  ilSelected.clear();
  await ilLoad();
});

