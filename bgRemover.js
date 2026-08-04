// ===== 圖片去背器（bgRemover.js）=====
// 一條龍處理食材圖／品牌小圖：AI 去背 → 裁掉透明邊 → 縮圖 → 轉 WebP → 上傳圖片庫（或下載）。
// 取代原本「照片 App 調尺寸 → Canva 去背 → 轉檔改名 → 上傳」的多段手工流程。
//
// 去背引擎：@imgly/background-removal（跑在瀏覽器裡的 AI 模型）。
// - 第一次使用才從 CDN 動態載入，模型約 40MB，瀏覽器會快取，之後每張只要幾秒。
// - 圖片全程留在自己的瀏覽器裡運算，不會傳到任何去背服務，沒有外流疑慮。
// - CDN 網址鎖定版本號，套件改版不會影響到我們。
//
// 模組載入順序照專案鐵律排在 admin.js 之前；最外層只有宣告與 DOM 事件掛載，
// admin.js 的函式（postTask / hasPerm / setFormStatus / switchView）一律只在事件裡呼叫。

const BGR_ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
const BGR_MODEL = 'isnet_quint8'; // 最小的模型，對 400px 小圖品質足夠
const BGR_SITE_BASE = 'https://sheridondon.com.tw';
const BGR_WEBP_QUALITY = 0.92; // 去背圖邊緣有半透明羽化，壓太低會出現髒邊

// 中文 → 英文檔名對照表（照 images/Ingredients/ 既有命名慣例：小寫、連字號）。
// 表裡沒有的照樣可以自己打英文；這裡只是讓常用食材不用每次查翻譯。
const BGR_DICT = [
  ['紅蘿蔔', 'carrot'], ['胡蘿蔔', 'carrot'], ['白蘿蔔', 'daikon-radish'], ['蘋果', 'apple'],
  ['酪梨', 'avocado'], ['娃娃菜', 'baby-cabbage'], ['玉米筍', 'baby-corn'], ['香蕉', 'banana'],
  ['甜椒', 'bell-pepper'], ['青椒', 'green-bell-pepper'], ['黑芝麻', 'black-sesame'], ['黑芝麻粉', 'black-sesame-powder'],
  ['藍莓', 'blueberry'], ['青江菜', 'bok-choy'], ['高湯', 'broth'], ['洋菇', 'button-mushroom'],
  ['高麗菜', 'cabbage'], ['白花椰菜', 'cauliflower'], ['綠花椰菜', 'broccoli'], ['花椰菜', 'cauliflower'],
  ['起司', 'cheese'], ['起司片', 'cheese-slice'], ['小番茄', 'cherry-tomato'], ['栗子', 'chestnut'],
  ['玉米', 'corn'], ['玉米粒', 'corn-kernels'], ['小黃瓜', 'cucumber'], ['孜然粉', 'cumin-powder'],
  ['蝦皮', 'dried-baby-shrimp'], ['乾干貝', 'dried-scallop'], ['乾香菇', 'dried-shiitake-mushroom'], ['蝦米', 'dried-shrimp'],
  ['水餃皮', 'dumpling-wrapper'], ['毛豆', 'edamame'], ['雞蛋', 'egg'], ['蛋', 'egg'],
  ['茄子', 'eggplant'], ['金針菇', 'enoki-mushroom'], ['板豆腐', 'firm-tofu'], ['魚片', 'fish-fillet'],
  ['麵粉', 'flour'], ['大蒜', 'garlic'], ['蒜頭', 'garlic'], ['薑', 'ginger'],
  ['枸杞', 'goji-berry'], ['希臘優格', 'greek-yogurt'], ['優格', 'yogurt-plain'], ['蔥', 'green-onion'],
  ['蜂蜜', 'honey'], ['番茄醬', 'ketchup'], ['杏鮑菇', 'king-oyster-mushroom'], ['小松菜', 'komatsuna'],
  ['絲瓜', 'loofah'], ['芒果', 'mango'], ['牛奶', 'milk'], ['保久乳', 'milk-uht'],
  ['小米', 'millet'], ['燕麥', 'oatmeal'], ['秋葵', 'okra'], ['橄欖油', 'olive-oil'],
  ['洋蔥', 'onion'], ['柳橙', 'orange'], ['鳳梨', 'pineapple'], ['馬鈴薯', 'potato'],
  ['太白粉', 'potato-starch'], ['南瓜', 'pumpkin'], ['紫米', 'purple-rice'], ['紫地瓜', 'purple-sweet-potato'],
  ['鵪鶉蛋', 'quail-egg'], ['紅豆', 'red-bean'], ['紅棗', 'red-date'], ['火龍果', 'red-dragon-fruit'],
  ['米', 'rice'], ['白飯', 'white-rice'], ['鮭魚', 'salmon'], ['鹽', 'salt'],
  ['海苔', 'seasoned-seaweed'], ['麻油', 'sesame-oil'], ['香油', 'sesame-oil'], ['芝麻粉', 'sesame-powder'],
  ['香菇', 'shiitake-mushroom'], ['蝦子', 'shrimp'], ['蝦仁', 'shrimp'], ['菠菜', 'spinach'],
  ['草莓', 'strawberry'], ['糖', 'sugar'], ['地瓜', 'sweet-potato'], ['芋頭', 'taro'],
  ['豆腐', 'tofu'], ['番茄', 'tomato'], ['海帶芽', 'wakame'], ['空心菜', 'water-spinach'],
  ['白木耳', 'white-fungus'], ['白芝麻', 'white-sesame'], ['吻仔魚', 'whitebait'], ['冬瓜', 'winter-melon'],
  ['黑木耳', 'wood-ear-mushroom'], ['山藥', 'yam'], ['櫛瓜', 'zucchini'], ['莧菜', 'amaranth'],
  ['雞胸肉', 'chicken-breast'], ['雞腿肉', 'chicken-thigh'], ['雞肉', 'chicken'], ['豬肉', 'pork'],
  ['豬絞肉', 'ground-pork'], ['牛肉', 'beef'], ['羊肉', 'lamb'], ['蛤蜊', 'clam'],
  ['干貝', 'scallop'], ['蘆筍', 'asparagus'], ['芹菜', 'celery'], ['生菜', 'lettuce'],
  ['大白菜', 'napa-cabbage'], ['四季豆', 'green-bean'], ['豆芽菜', 'bean-sprout'], ['竹筍', 'bamboo-shoot'],
  ['蓮藕', 'lotus-root'], ['牛蒡', 'burdock'], ['奇異果', 'kiwi'], ['葡萄', 'grape'],
  ['西瓜', 'watermelon'], ['木瓜', 'papaya'], ['芭樂', 'guava'], ['檸檬', 'lemon'],
  ['奶油', 'butter'], ['醬油', 'soy-sauce'], ['味噌', 'miso'], ['麵條', 'noodle'],
  ['義大利麵', 'pasta'], ['米粉', 'rice-noodle'], ['冬粉', 'glass-noodle'], ['藜麥', 'quinoa'],
  ['核桃', 'walnut'], ['杏仁', 'almond'], ['腰果', 'cashew'], ['葡萄乾', 'raisin'],
  ['昆布', 'kombu'], ['海帶', 'kelp'], ['鱸魚', 'sea-bass'], ['鯖魚', 'mackerel'],
  ['鮪魚', 'tuna'], ['鱈魚', 'cod'], ['虱目魚', 'milkfish'], ['花枝', 'squid'],
  ['蚵仔', 'oyster'], ['培根', 'bacon'], ['火腿', 'ham'], ['香腸', 'sausage']
];

// ===== 模組層狀態 =====
let bgrItems = [];          // 每張圖一筆：{ id, file, resultCanvas, status, uploaded }
let bgrEnginePromise = null; // 去背引擎只載一次
let bgrSeq = 0;
let bgrQueueRunning = false; // 逐張排隊處理，避免同時跑好幾個 AI 推論把記憶體吃爆
let bgrWebpChecked = false;
let bgrWebpOk = false;

// ===== 小工具函式 =====

// 檔名清洗：轉小寫、空白/底線改連字號、去掉英數與連字號以外的字元
function bgrSlug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// 跟 imageLibrary.js 一樣的做法：實測瀏覽器能不能真的輸出 WebP（iPhone Safari 會偷偷退回 PNG）
function bgrCheckWebp() {
  if (bgrWebpChecked) return bgrWebpOk;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  bgrWebpOk = canvas.toDataURL('image/webp', 0.8).indexOf('data:image/webp') === 0;
  bgrWebpChecked = true;
  return bgrWebpOk;
}

function bgrEncodeCanvas(canvas) {
  const isWebp = bgrCheckWebp();
  const mime = isWebp ? 'image/webp' : 'image/png';
  const dataUrl = canvas.toDataURL(mime, BGR_WEBP_QUALITY);
  return { base64: dataUrl.split(',')[1], dataUrl: dataUrl, ext: isWebp ? '.webp' : '.png' };
}

// 去背引擎載入（只跑一次；失敗要把 promise 清掉，下次點才會重試而不是永遠卡在壞掉的 promise）
function bgrLoadEngine() {
  if (!bgrEnginePromise) {
    bgrEnginePromise = import(BGR_ENGINE_URL).catch((err) => {
      bgrEnginePromise = null;
      throw new Error('去背引擎載入失敗（請確認網路正常後再試一次）：' + err.message);
    });
  }
  return bgrEnginePromise;
}

// 模型下載進度（只有第一次會看到；引擎會把模型快取起來）
function bgrEngineProgress(key, cur, tot) {
  if (String(key).indexOf('fetch:') !== 0 || !tot) return;
  const pct = Math.min(100, Math.round((cur / tot) * 100));
  setFormStatus('bgrEngineStatus', '首次使用需下載 AI 模型（約 40MB，只需一次，之後會記住）… ' + pct + '%', '');
}

// 把去背結果裁掉四周透明邊、縮到指定長邊。maxDim 為 0 表示保留原尺寸。
function bgrTrimAndScale(bitmap, maxDim, doTrim) {
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

// 原始檔名先查對照表（例如選了「紅蘿蔔.jpg」直接帶出 carrot），查不到就清洗原檔名
function bgrSuggestName(originalName) {
  const base = String(originalName || '').replace(/\.[a-z0-9]+$/i, '').trim();
  for (let i = 0; i < BGR_DICT.length; i++) {
    if (base === BGR_DICT[i][0]) return BGR_DICT[i][1];
  }
  return bgrSlug(base);
}

// ===== 畫面 =====

function bgrItemEl(id, part) {
  return document.getElementById('bgr-' + part + '-' + id);
}

function bgrSetItemStatus(item, text, cls) {
  const el = bgrItemEl(item.id, 'status');
  if (!el) return;
  el.textContent = text;
  el.className = 'form-status' + (cls ? ' ' + cls : '');
  el.style.margin = '4px 0 0';
}

// 透明格棋盤底，讓人一眼看出「這塊真的是透明的」
const BGR_CHECKER_BG = 'background:repeating-conic-gradient(#e8e2da 0% 25%, #faf7f2 0% 50%) 0 0/16px 16px; border-radius:10px;';

function bgrRenderItemCard(item) {
  const list = document.getElementById('bgrList');
  const card = document.createElement('div');
  card.id = 'bgr-card-' + item.id;
  card.style.cssText = 'background:#fff; border-radius:14px; padding:14px 16px; margin:0 auto 12px; max-width:900px; box-shadow:0 1px 4px rgba(0,0,0,0.06);';
  card.innerHTML =
    '<div style="display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;">' +
      '<div style="flex:0 0 120px; text-align:center;">' +
        '<img id="bgr-orig-' + item.id + '" alt="原圖" style="max-width:120px; max-height:120px; border-radius:10px;">' +
        '<div style="font-size:11px; color:#a89a8a; margin-top:2px;">原圖</div>' +
      '</div>' +
      '<div style="flex:0 0 150px; text-align:center;">' +
        '<div id="bgr-result-' + item.id + '" style="display:inline-block; ' + BGR_CHECKER_BG + '">' +
          '<div style="width:120px; height:120px; display:flex; align-items:center; justify-content:center; font-size:12px; color:#a89a8a;">等待處理…</div>' +
        '</div>' +
        '<div style="font-size:11px; color:#a89a8a; margin-top:2px;">處理結果（格子＝透明）</div>' +
      '</div>' +
      '<div style="flex:1 1 260px; min-width:240px;">' +
        '<label style="font-size:12.5px; font-weight:800; color:#8a7462;">檔名（英文小寫，可打中文找建議）</label>' +
        '<input type="text" id="bgr-name-' + item.id + '" autocomplete="off" style="width:100%; box-sizing:border-box; margin:4px 0 2px;">' +
        '<div id="bgr-namehint-' + item.id + '" style="font-size:11.5px; color:#a89a8a;"></div>' +
        '<div id="bgr-sugg-' + item.id + '" style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;"></div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">' +
          '<button class="task-mini-btn" id="bgr-redo-' + item.id + '">🔁 重新處理</button>' +
          '<button class="task-mini-btn" id="bgr-dl-' + item.id + '" disabled>⬇ 下載</button>' +
          '<button class="task-mini-btn" id="bgr-up-' + item.id + '" disabled style="border-color:#9ACB85; color:#5C9147;">☁ 上傳到圖片庫</button>' +
        '</div>' +
        '<div class="form-status" id="bgr-status-' + item.id + '"></div>' +
        '<div id="bgr-url-' + item.id + '" style="margin-top:4px;"></div>' +
      '</div>' +
    '</div>';
  list.appendChild(card);

  // 原圖縮圖
  const reader = new FileReader();
  reader.onload = (e) => { const img = bgrItemEl(item.id, 'orig'); if (img) img.src = e.target.result; };
  reader.readAsDataURL(item.file);

  // 檔名輸入：即時顯示清洗後的最終檔名；打中文就列對照表建議
  const nameInput = bgrItemEl(item.id, 'name');
  nameInput.value = bgrSuggestName(item.file.name);
  const refreshNameHint = () => {
    const slug = bgrSlug(nameInput.value);
    const hint = bgrItemEl(item.id, 'namehint');
    if (hint) hint.textContent = slug ? '實際檔名：' + slug + (bgrCheckWebp() ? '.webp' : '.png') : '請輸入英文檔名（或點下面的建議）';
    const sugg = bgrItemEl(item.id, 'sugg');
    if (!sugg) return;
    sugg.innerHTML = '';
    const q = nameInput.value.trim();
    if (!/[一-鿿]/.test(q)) return;
    const hits = BGR_DICT.filter((d) => d[0].indexOf(q) !== -1 || q.indexOf(d[0]) !== -1).slice(0, 6);
    hits.forEach((d) => {
      const b = document.createElement('button');
      b.className = 'task-mini-btn';
      b.style.cssText = 'padding:2px 10px; font-size:12px;';
      b.textContent = d[0] + ' → ' + d[1];
      b.addEventListener('click', () => { nameInput.value = d[1]; refreshNameHint(); });
      sugg.appendChild(b);
    });
  };
  nameInput.addEventListener('input', refreshNameHint);
  refreshNameHint();

  bgrItemEl(item.id, 'redo').addEventListener('click', () => { bgrEnqueue(item); });
  bgrItemEl(item.id, 'dl').addEventListener('click', () => { bgrDownloadItem(item); });
  bgrItemEl(item.id, 'up').addEventListener('click', () => { bgrUploadItem(item); });
}

function bgrShowResultPreview(item) {
  const wrap = bgrItemEl(item.id, 'result');
  if (!wrap || !item.resultCanvas) return;
  const scale = Math.min(1, 150 / Math.max(item.resultCanvas.width, item.resultCanvas.height));
  const view = document.createElement('canvas');
  view.width = Math.max(1, Math.round(item.resultCanvas.width * scale));
  view.height = Math.max(1, Math.round(item.resultCanvas.height * scale));
  view.getContext('2d').drawImage(item.resultCanvas, 0, 0, view.width, view.height);
  view.style.cssText = 'display:block; max-width:150px; max-height:150px;';
  wrap.innerHTML = '';
  wrap.appendChild(view);
}

// ===== 處理流程（逐張排隊）=====

function bgrEnqueue(item) {
  if (item.status === 'working' || item.status === 'queued') return;
  item.status = 'queued';
  item.uploaded = false;
  bgrSetItemStatus(item, '排隊中…', '');
  bgrRunQueue();
}

async function bgrRunQueue() {
  if (bgrQueueRunning) return;
  bgrQueueRunning = true;
  try {
    let next;
    while ((next = bgrItems.find((it) => it.status === 'queued'))) {
      await bgrProcessItem(next);
    }
  } finally {
    bgrQueueRunning = false;
  }
}

async function bgrProcessItem(item) {
  item.status = 'working';
  const doRemove = document.getElementById('bgrRemoveToggle').checked;
  const maxDim = parseInt(document.getElementById('bgrSizeSelect').value, 10) || 0;
  bgrItemEl(item.id, 'dl').disabled = true;
  bgrItemEl(item.id, 'up').disabled = true;
  try {
    let bitmap;
    if (doRemove) {
      bgrSetItemStatus(item, '準備去背引擎…', '');
      const engine = await bgrLoadEngine();
      setFormStatus('bgrEngineStatus', '', '');
      bgrSetItemStatus(item, 'AI 去背中…（這張圖只在你的瀏覽器裡處理）', '');
      const outBlob = await engine.removeBackground(item.file, { model: BGR_MODEL, progress: bgrEngineProgress });
      bitmap = await createImageBitmap(outBlob);
    } else {
      bitmap = await createImageBitmap(item.file);
    }
    item.resultCanvas = bgrTrimAndScale(bitmap, maxDim, doRemove);
    if (bitmap.close) bitmap.close();
    bgrShowResultPreview(item);
    item.status = 'done';
    bgrSetItemStatus(item, '完成 ✓ ' + item.resultCanvas.width + '×' + item.resultCanvas.height +
      (doRemove ? '（已去背＋裁邊）' : '（未去背，只縮圖轉檔）'), 'ok');
    bgrItemEl(item.id, 'dl').disabled = false;
    bgrItemEl(item.id, 'up').disabled = false;
  } catch (err) {
    item.status = 'error';
    setFormStatus('bgrEngineStatus', '', '');
    bgrSetItemStatus(item, '處理失敗：' + err.message + '（可點「重新處理」再試）', 'error');
  }
}

// ===== 下載與上傳 =====

function bgrDownloadItem(item) {
  if (!item.resultCanvas) return;
  const slug = bgrSlug(bgrItemEl(item.id, 'name').value);
  if (!slug) {
    bgrSetItemStatus(item, '請先填英文檔名再下載', 'error');
    return;
  }
  const enc = bgrEncodeCanvas(item.resultCanvas);
  const a = document.createElement('a');
  a.href = enc.dataUrl;
  a.download = slug + enc.ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function bgrUploadItem(item) {
  if (!item.resultCanvas || item.status !== 'done') return;
  if (typeof hasPerm === 'function' && !hasPerm('imageLibrary')) {
    bgrSetItemStatus(item, '上傳需要「圖片庫」權限，如果需要請跟雪莉申請開通（仍可用「下載」把圖存下來）', 'error');
    return;
  }
  const slug = bgrSlug(bgrItemEl(item.id, 'name').value);
  if (!slug) {
    bgrSetItemStatus(item, '請先填英文檔名再上傳', 'error');
    return;
  }
  const folder = document.getElementById('bgrFolderSelect').value;
  const enc = bgrEncodeCanvas(item.resultCanvas);
  const filename = slug + enc.ext;
  const upBtn = bgrItemEl(item.id, 'up');
  upBtn.disabled = true;
  bgrSetItemStatus(item, '上傳中…', '');
  try {
    const result = await postTask({ type: 'image-upload', folder: folder, filename: filename, dataBase64: enc.base64 });
    item.uploaded = true;
    bgrSetItemStatus(item, '上傳完成 ✓ ' + folder + '/' + filename + (result.overwritten ? '（覆蓋了同名舊檔）' : ''), 'ok');
    const url = BGR_SITE_BASE + '/' + folder + '/' + filename;
    const urlWrap = bgrItemEl(item.id, 'url');
    urlWrap.innerHTML = '';
    const urlText = document.createElement('span');
    urlText.style.cssText = 'font-size:11.5px; color:#8a7462; word-break:break-all;';
    urlText.textContent = url;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'task-mini-btn';
    copyBtn.style.cssText = 'padding:2px 10px; font-size:12px; margin-left:6px;';
    copyBtn.textContent = '📋 複製網址';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = '已複製 ✓';
        setTimeout(() => { copyBtn.textContent = '📋 複製網址'; }, 1500);
      } catch (e) {
        // 剪貼簿被瀏覽器擋下時，至少讓人可以手動選取網址複製
        copyBtn.textContent = '請手動選取複製';
      }
    });
    urlWrap.appendChild(urlText);
    urlWrap.appendChild(copyBtn);
  } catch (err) {
    bgrSetItemStatus(item, '上傳失敗：' + err.message, 'error');
  }
  upBtn.disabled = false;
}

// ===== DOM 事件掛載（模組最外層只做這件事）=====

document.getElementById('bgrFileInput').addEventListener('change', () => {
  const input = document.getElementById('bgrFileInput');
  const files = Array.from(input.files || []);
  input.value = ''; // 清掉才能重選同一個檔
  files.forEach((file) => {
    const item = { id: ++bgrSeq, file: file, resultCanvas: null, status: 'new', uploaded: false };
    bgrItems.push(item);
    bgrRenderItemCard(item);
    bgrEnqueue(item);
  });
});

document.getElementById('bgrUploadAllBtn').addEventListener('click', async () => {
  const ready = bgrItems.filter((it) => it.status === 'done' && !it.uploaded);
  if (!ready.length) {
    setFormStatus('bgrUploadAllStatus', '沒有可上傳的圖（處理完成且還沒上傳過的才會上傳）', 'error');
    return;
  }
  const btn = document.getElementById('bgrUploadAllBtn');
  btn.disabled = true;
  for (let i = 0; i < ready.length; i++) {
    setFormStatus('bgrUploadAllStatus', '上傳中… (' + (i + 1) + '/' + ready.length + ')', '');
    await bgrUploadItem(ready[i]);
  }
  const okCount = ready.filter((it) => it.uploaded).length;
  setFormStatus('bgrUploadAllStatus', '完成，成功上傳 ' + okCount + '/' + ready.length + ' 張 ✓', okCount === ready.length ? 'ok' : 'error');
  btn.disabled = false;
});

document.getElementById('bgrClearBtn').addEventListener('click', () => {
  bgrItems = [];
  document.getElementById('bgrList').innerHTML = '';
  setFormStatus('bgrUploadAllStatus', '', '');
  setFormStatus('bgrEngineStatus', '', '');
});
