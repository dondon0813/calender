// ===================================================================
// tools.js — 工具箱三件套：開團文案產生器＋抽獎小幫手＋食譜貼文產生器
//            （含轉檔小工具的介面佔位）
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('lotteryTool')
// → renderLotteryWinnerList()；本檔若排在後面，開機當下函式還不存在，整頁變磚。
//
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得在最外層直接呼叫 admin.js 的函式。
// 執行期依賴 admin.js 的全域：allEvents、escHtml、setFormStatus、copyText 等
// ——都在事件/函式內才會被讀到，載入順序安全。工具按鈕多半由 admin.html 的
// inline onclick 觸發（執行期），不受載入順序影響。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放檔案最前段） -----
// 抽獎工具：右欄還原到 lotteryTool 時開機就會讀到
let lotteryWinnerLog = []; // 新的在最前面：[{prize, winner}, ...]

// ===== 開團文案產生器 =====
function openCopyGenModal() {
  document.getElementById('menuPanel').classList.remove('show');
  const dateInput = document.getElementById('copyGenDate');
  if (!dateInput.value) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  document.getElementById('copyGenOutput').value = '';
  setFormStatus('copyGenStatus', '', '');
  document.getElementById('copyGenModal').classList.add('show');
}

function closeCopyGenModal() {
  document.getElementById('copyGenModal').classList.remove('show');
}

// 依選定日期，把「今日結單」與「現正開團中」的團拆開產生純文字文案
function generateCopyGenText() {
  const val = document.getElementById('copyGenDate').value; // YYYY-MM-DD
  if (!val) {
    setFormStatus('copyGenStatus', '請先選擇日期', 'error');
    return;
  }
  const [y, m, d] = val.split('-').map(Number);
  const targetDate = new Date(y, m - 1, d);

  const closingToday = [];
  const stillOpen = [];

  allEvents.forEach(ev => {
    const s = startOfDay(ev.start);
    const e = startOfDay(ev.displayEnd);
    if (targetDate < s || targetDate > e) return;
    if (targetDate.getTime() === e.getTime()) closingToday.push(ev);
    else stillOpen.push(ev);
  });

  closingToday.sort((a, b) => a.displayEnd - b.displayEnd);
  stillOpen.sort((a, b) => a.displayEnd - b.displayEnd);

  const dateLabel = `${m}/${d}`;
  const lines = [];

  if (closingToday.length) {
    lines.push(`✦ 今日結單 ${dateLabel} ✦`);
    closingToday.forEach(ev => {
      lines.push(plainTitle(ev.title || ''));   // 團名的「｜」在文案裡接回空白（plainTitle 在 admin.js）
      lines.push(ev.url || '');
    });
  }

  if (stillOpen.length) {
    if (lines.length) lines.push('');
    lines.push('✦ 現正開團中✦');
    stillOpen.forEach(ev => {
      lines.push(plainTitle(ev.title || ''));   // 團名的「｜」在文案裡接回空白（plainTitle 在 admin.js）
      lines.push(ev.url || '');
    });
  }

  const outputEl = document.getElementById('copyGenOutput');
  if (!lines.length) {
    outputEl.value = '';
    setFormStatus('copyGenStatus', '這天沒有進行中的團購', 'error');
    return;
  }

  outputEl.value = lines.join('\n');
  setFormStatus('copyGenStatus', '文案已產生 ✓', 'ok');
}

async function copyGenCopyText() {
  const outputEl = document.getElementById('copyGenOutput');
  const text = outputEl.value;
  if (!text) {
    setFormStatus('copyGenStatus', '請先產生文案再複製', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setFormStatus('copyGenStatus', '已複製到剪貼簿 ✓', 'ok');
  } catch (err) {
    outputEl.select();
    document.execCommand('copy');
    setFormStatus('copyGenStatus', '已複製到剪貼簿 ✓', 'ok');
  }
}

// ===== 抽獎小幫手 =====
// 設計原則：獎項清單／參加名單隨時可以編輯，不鎖住；每次抽獎都即時重新讀取最新的清單內容，
// 只用「中獎紀錄 lotteryWinnerLog」記錄已經抽出的結果，靠這份紀錄反推目前剩餘的獎項數量／機會，
// 這樣「重抽」只要把最後一筆紀錄拿掉再重抽一次就好，也方便隨時修改清單內容（例如多加機會）。
// lotteryWinnerLog 宣告在檔案最前段（開機期 TDZ），見 VIEW_ID_MAP 附近

// 把「名稱*數量」格式的多行文字解析成 [{name, count}]
function parseLotteryLines_(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const idx = line.lastIndexOf('*');
    if (idx === -1) return { name: line, count: 1 };
    const name = line.slice(0, idx).trim();
    const count = parseInt(line.slice(idx + 1).trim(), 10);
    return { name: name || line, count: (!count || count < 1) ? 1 : count };
  }).filter(x => x.name);
}

// 找出目前該抽哪個獎項（清單最下面先抽、最上面的大獎最後抽；已經抽完的獎項會自動跳過）
function findNextLotteryPrize_() {
  const prizesRaw = parseLotteryLines_(document.getElementById('lotteryPrizesInput').value);
  const queue = prizesRaw.slice().reverse(); // 由下到上
  for (const p of queue) {
    const consumed = lotteryWinnerLog.filter(w => w.prize === p.name).length;
    if (consumed < p.count) return { name: p.name, remaining: p.count - consumed };
  }
  return null;
}

// 依規則＋目前的中獎紀錄，算出這次抽獎可以抽的名單池（每個機會展開成一筆）
function getLotteryEligiblePool_(prizeName) {
  const participantsRaw = parseLotteryLines_(document.getElementById('lotteryParticipantsInput').value);
  const rule = document.getElementById('lotteryRuleSelect').value;

  if (rule === 'removeName') {
    const wonNames = new Set(lotteryWinnerLog.map(w => w.winner));
    return participantsRaw.filter(p => !wonNames.has(p.name)).map(p => p.name);
  }

  let pool = [];
  participantsRaw.forEach(p => {
    let count = p.count;
    if (rule !== 'keepChance') {
      const consumed = lotteryWinnerLog.filter(w => w.winner === p.name).length;
      count = Math.max(0, p.count - consumed);
    }
    for (let i = 0; i < count; i++) pool.push(p.name);
  });

  if (rule === 'removeChanceUniquePrize') {
    const wonThisPrize = new Set(lotteryWinnerLog.filter(w => w.prize === prizeName).map(w => w.winner));
    const filtered = pool.filter(name => !wonThisPrize.has(name));
    if (filtered.length) pool = filtered; // 篩選後還有人可抽才套用限制，避免大家都中過同個獎時卡住
  }

  return pool;
}

function drawLottery() {
  const prizesRaw = parseLotteryLines_(document.getElementById('lotteryPrizesInput').value);
  const participantsRaw = parseLotteryLines_(document.getElementById('lotteryParticipantsInput').value);
  if (!prizesRaw.length) { alert('請先輸入獎項清單'); return; }
  if (!participantsRaw.length) { alert('請先輸入參加名單'); return; }

  const prize = findNextLotteryPrize_();
  if (!prize) { finishLottery_(); return; }

  const pool = getLotteryEligiblePool_(prize.name);
  if (!pool.length) {
    alert('目前沒有可以抽獎的參加者了');
    return;
  }

  const winner = pool[Math.floor(Math.random() * pool.length)];
  lotteryWinnerLog.unshift({ prize: prize.name, winner: winner });

  document.getElementById('lotteryResultBox').style.display = '';
  document.getElementById('lotteryResultPrize').textContent = prize.name;
  document.getElementById('lotteryResultWinner').textContent = winner;
  renderLotteryWinnerList();

  document.getElementById('lotteryDrawBtn').disabled = false;
  document.getElementById('lotteryDrawBtn').textContent = '🎲 繼續抽獎';

  if (!findNextLotteryPrize_()) finishLottery_();
}

// 重抽：把最新一筆中獎紀錄收回，重新抽一次（方便「作弊」重來）
function redrawLottery() {
  if (!lotteryWinnerLog.length) {
    alert('還沒有抽過，請先按「開始抽獎」');
    return;
  }
  lotteryWinnerLog.shift();
  document.getElementById('lotteryDrawBtn').disabled = false;
  document.getElementById('lotteryDrawBtn').textContent = lotteryWinnerLog.length ? '🎲 繼續抽獎' : '🎲 開始抽獎';
  drawLottery();
}

function finishLottery_() {
  const btn = document.getElementById('lotteryDrawBtn');
  btn.textContent = '🎉 已抽完所有獎項';
  btn.disabled = true;
}

function renderLotteryWinnerList() {
  const el = document.getElementById('lotteryWinnerList');
  if (!el) return;
  el.innerHTML = '';
  if (!lotteryWinnerLog.length) {
    el.innerHTML = '<div class="task-empty">還沒有抽出任何獎項</div>';
    return;
  }
  lotteryWinnerLog.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'lottery-winner-row';
    const prizeEl = document.createElement('span');
    prizeEl.className = 'lw-prize';
    prizeEl.textContent = entry.prize;
    const winnerEl = document.createElement('span');
    winnerEl.className = 'lw-winner';
    winnerEl.textContent = entry.winner;
    row.appendChild(prizeEl);
    row.appendChild(winnerEl);
    el.appendChild(row);
  });
}

function resetLottery() {
  if (lotteryWinnerLog.length && !confirm('確定要重新設定嗎？目前的抽獎進度會清空')) return;
  lotteryWinnerLog = [];
  document.getElementById('lotteryPrizesInput').value = '';
  document.getElementById('lotteryParticipantsInput').value = '';
  document.getElementById('lotteryRuleSelect').value = 'removeName';
  document.getElementById('lotteryResultBox').style.display = 'none';
  const btn = document.getElementById('lotteryDrawBtn');
  btn.textContent = '🎲 開始抽獎';
  btn.disabled = false;
  renderLotteryWinnerList();
}

// ===== 轉檔小工具（Word→PDF 已串接 Code.gs 實際轉檔；其餘格式仍是介面佔位）=====
function convertFileExt(file) {
  const m = /\.(\w+)$/.exec(file.name || '');
  return m ? m[1].toLowerCase() : '';
}

// 選檔當下就把目標格式鎖成 PDF：Word 目前只支援轉 PDF，避免使用者選了 Excel/JPG 卻送出去才被打回票
function convertOnFileChange() {
  const fileInput = document.getElementById('convertFileInput');
  const targetSelect = document.getElementById('convertTargetSelect');
  const file = fileInput.files && fileInput.files[0];
  const isWord = file && ['doc', 'docx'].includes(convertFileExt(file));
  Array.from(targetSelect.options).forEach(opt => {
    opt.disabled = isWord && opt.value !== 'pdf';
  });
  if (isWord) targetSelect.value = 'pdf';
  setFormStatus('convertStatus', '', '');
}

async function runConvertTool() {
  const fileInput = document.getElementById('convertFileInput');
  const target = document.getElementById('convertTargetSelect').value;
  if (!fileInput.files || !fileInput.files.length) {
    setFormStatus('convertStatus', '請先選擇要轉換的檔案', 'error');
    return;
  }
  const file = fileInput.files[0];
  const ext = convertFileExt(file);
  if (ext === 'doc' || ext === 'docx') {
    if (target !== 'pdf') {
      setFormStatus('convertStatus', 'Word 檔案目前只能轉成 PDF，請把「要轉成的格式」選 PDF', 'error');
      return;
    }
    await convertRunWordToPdf(file);
    return;
  }
  setFormStatus('convertStatus', '轉檔功能尚未串接，之後可以在這裡接上轉檔服務（目前選擇的檔案：' + file.name + ' → ' + target + '）', '');
}

function convertReadFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(',')[1] || '');
    reader.onerror = () => reject(new Error('讀取檔案失敗'));
    reader.readAsDataURL(file);
  });
}

function convertDownloadBase64Pdf(dataBase64, filename) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function convertRunWordToPdf(file) {
  const btn = document.querySelector('#viewConvertTool .task-submit-btn');
  if (btn) btn.disabled = true;
  setFormStatus('convertStatus', '轉檔中…（檔案較大時要等幾秒，請勿關閉頁面）', '');
  try {
    const dataBase64 = await convertReadFileAsBase64(file);
    const result = await postTask({ type: 'convert-word-to-pdf', filename: file.name, dataBase64 });
    const outFilename = result.filename || file.name.replace(/\.\w+$/, '') + '.pdf';
    convertDownloadBase64Pdf(result.dataBase64, outFilename);
    setFormStatus('convertStatus', '轉檔完成，已下載「' + outFilename + '」', 'ok');
  } catch (err) {
    setFormStatus('convertStatus', '轉檔失敗：' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ===== 食譜貼文產生器 =====
// 讀取跟 recipes.html 同一組食譜資料庫（透過同一個 APPS_SCRIPT_URL，scope=public）
// 這裡的變數都加 pg 前綴，避免跟其他功能的變數重複
let pgRecipes = [];
let pgIngredients = [];
let pgRecipeDbLoaded = false;
let pgRecipeDbLoading = false;
let pgSelectedRecipe = null;

const PG_PLACEHOLDER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='%23FFF1E6'/><text x='100' y='110' font-size='48' text-anchor='middle'>🍽</text></svg>";

async function pgLoadRecipeDb() {
  if (pgRecipeDbLoaded || pgRecipeDbLoading) return;
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) return;
  pgRecipeDbLoading = true;
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?scope=public&t=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    pgIngredients = (data.ingredients || []).filter(i => i['食材ID']);
    pgRecipes = (data.recipes || []).filter(r => r['食譜ID']);
    pgRecipeDbLoaded = true;
  } catch (err) {
    console.warn('食譜資料讀取失敗：', err);
  }
  pgRecipeDbLoading = false;
}

function pgIsValidUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
}

// 食譜圖片網址如果是舊的 dondon0813.github.io（換自訂網域前存進試算表的舊連結），
// 改寫成目前網站實際的網域，避免變成跨網域讀取被瀏覽器擋下（html2canvas 需要同源
// 才能把圖片畫進畫布，不然截圖那塊會是空白，但頁面上直接顯示圖片不受影響，
// 所以只有「產生貼文圖」這個功能會出問題）。
function pgToSameOriginUrl(s) {
  if (typeof s !== 'string' || !s.trim()) return s;
  try {
    const u = new URL(s.trim(), location.href);
    if (u.hostname === 'dondon0813.github.io' && u.origin !== location.origin) {
      // GitHub Pages 專案頁換成自訂網域後，網址會變成網域根目錄，
      // 不會再有 /calender/ 這層路徑，要先把它去掉才能接上目前的網域。
      const path = u.pathname.replace(/^\/calender(?=\/|$)/, '') || '/';
      return location.origin + path + u.search + u.hash;
    }
  } catch (err) { /* 網址格式怪異就原樣返回，交給 pgIsValidUrl 判斷 */ }
  return s;
}

// 食材顯示用的簡短名稱：優先用「簡稱」（可能用 / 分隔多個，取第一個），沒填才用「食材名稱」
function pgIngredientFilterKey(ing) {
  const raw = String(ing['簡稱'] || '').trim();
  if (!raw) return ing['食材名稱'] || '';
  return raw.split('/')[0].trim();
}

// 食材的所有別名清單（簡稱可能用 / 分隔多個），沒填簡稱就用食材名稱當唯一別名。
// 跟 recipes.html 的 ingredientFilterKeys 同一套規則，比對「使用食材ID」欄位打的
// 簡稱（例如「優格」）時要用。
function pgIngredientFilterKeys(ing) {
  const raw = String(ing['簡稱'] || '').trim();
  if (!raw) return ing['食材名稱'] ? [ing['食材名稱']] : [];
  return raw.split('/').map(s => s.trim()).filter(Boolean);
}

// 依「使用食材ID」欄位（格式 ing001:50g/ing003:1包，也可以直接打簡稱例如「優格」）
// 比對出完整食材資料＋分量。跟 recipes.html 的 getRecipeIngredients 同一套規則：
// 食材ID → 食材名稱 → 簡稱，一層一層往下比對；原本這裡少了「簡稱」這一層，導致
// 食譜打簡稱（例如「優格」）時完全比對不到資料、變成純文字項目、沒有圖片網址，
// 貼文圖就會破圖（食譜頁面因為有比對簡稱，所以顯示正常）。
// 同一簡稱對到多個品項（例如兩個品牌都叫「優格」）時，優先挑「有圖片網址」的那個，
// 避免隨機選到沒圖的那筆又破圖；recipes.html 是用開團狀態挑，但貼文產生器這裡
// 沒有載入團購行事曆資料，用「有沒有圖片」當簡化版的挑選依據就夠了。
function pgGetRecipeIngredients(recipe) {
  const tokens = String(recipe['使用食材ID'] || '').split('/').map(s => s.trim()).filter(Boolean);
  const result = [];
  tokens.forEach(token => {
    const [idOrName, qty] = token.split(':').map(s => (s || '').trim());
    let ing = pgIngredients.find(i => i['食材ID'] === idOrName);
    let matchedByAlias = false; // 是不是靠「簡稱」比對到的（不是完整食材名稱、也不是ID）
    if (!ing && idOrName) {
      let nameMatches = pgIngredients.filter(i => i['食材名稱'] === idOrName);
      if (!nameMatches.length) {
        nameMatches = pgIngredients.filter(i => pgIngredientFilterKeys(i).includes(idOrName));
        matchedByAlias = nameMatches.length > 0;
      }
      if (nameMatches.length === 1) {
        ing = nameMatches[0];
      } else if (nameMatches.length > 1) {
        ing = nameMatches.find(i => pgIsValidUrl(pgToSameOriginUrl(i['圖片網址']))) || nameMatches[0];
      }
    }
    if (ing) {
      // 靠簡稱比對到的話，顯示名稱要用食譜實際打的那個詞（例如「優格」），不要
      // 自動換成資料庫裡那個品項自己的簡稱清單第一個別名（可能更長，例如
      // 「低脂優格/優格」的話會變成顯示「低脂優格」），跟 recipes.html 同一套規則。
      const displayKey = matchedByAlias ? idOrName : '';
      result.push(Object.assign({}, ing, { _quantity: qty || '', _displayKey: displayKey }));
    } else if (idOrName) {
      result.push({ 食材名稱: idOrName, _quantity: qty || '', _generic: true });
    }
  });
  return result;
}

// 依主圖網址自動推算步驟圖片網址（跟 recipes.html 用同一套規則）
function pgBuildAutoStepImageUrl(mainImgUrl, stepNumber) {
  if (!pgIsValidUrl(mainImgUrl)) return '';
  const marker = '/images/';
  const idx = mainImgUrl.lastIndexOf(marker);
  if (idx === -1) return '';
  const prefix = mainImgUrl.slice(0, idx);
  const rest = mainImgUrl.slice(idx + marker.length);
  const lastSlash = rest.lastIndexOf('/');
  const filename = lastSlash === -1 ? rest : rest.slice(lastSlash + 1);
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return '';
  const base = filename.slice(0, dotIdx);
  const ext = filename.slice(dotIdx);
  return `${prefix}/images/recipes/stepimage/${base}${stepNumber}${ext}`;
}

function pgGetStepLines(recipe) {
  const stepsRaw = String(recipe['做法步驟'] || '').replace(/\\n/g, '\n');
  return stepsRaw.split('\n').map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim()).filter(Boolean);
}

function pgGetTipLines(recipe) {
  const tipRaw = String(recipe['小提醒'] || '').replace(/\\n/g, '\n').trim();
  if (!tipRaw) return [];
  return tipRaw.split('\n').map(s => s.trim()).filter(Boolean);
}

function openRecipePostModal() {
  document.getElementById('menuPanel').classList.remove('show');
  pgSelectedRecipe = null;
  document.getElementById('pgSearchInput').value = '';
  document.getElementById('pgPickerView').style.display = 'block';
  document.getElementById('pgActionView').style.display = 'none';
  document.getElementById('pgOutputArea').style.display = 'none';
  document.getElementById('recipePostModal').classList.add('show');

  const grid = document.getElementById('pgRecipeGrid');
  grid.innerHTML = '<div class="task-empty">食譜載入中…</div>';
  pgLoadRecipeDb().then(() => pgRenderRecipeGrid(''));
}

function closeRecipePostModal() {
  document.getElementById('recipePostModal').classList.remove('show');
}

document.getElementById('pgSearchInput').addEventListener('input', (e) => {
  pgRenderRecipeGrid(e.target.value.trim());
});

function pgRenderRecipeGrid(searchText) {
  const grid = document.getElementById('pgRecipeGrid');
  grid.innerHTML = '';
  if (!pgRecipeDbLoaded) {
    grid.innerHTML = '<div class="task-empty">食譜載入中…</div>';
    return;
  }
  let items = pgRecipes;
  if (searchText) {
    items = items.filter(r => String(r['食譜名稱'] || '').includes(searchText));
  }
  if (!items.length) {
    grid.innerHTML = '<div class="task-empty">沒有找到符合的食譜</div>';
    return;
  }
  items.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'recipe-reco-card';
    card.addEventListener('click', () => pgSelectRecipe(recipe));

    const img = document.createElement('img');
    img.src = pgIsValidUrl(recipe['成品圖片網址']) ? recipe['成品圖片網址'] : PG_PLACEHOLDER_IMG;
    img.onerror = () => { img.src = PG_PLACEHOLDER_IMG; };
    card.appendChild(img);

    const body = document.createElement('div');
    body.className = 'rrc-body';
    const name = document.createElement('div');
    name.className = 'rrc-name';
    name.textContent = recipe['食譜名稱'] || '';
    body.appendChild(name);

    if (recipe['適合月齡']) {
      const tags = document.createElement('div');
      tags.className = 'rrc-tags';
      tags.innerHTML = `<span class="mini-tag" style="background:#E4F5DF;color:#5C9147;">👶 ${escHtml(recipe['適合月齡'])}</span>`;
      body.appendChild(tags);
    }

    card.appendChild(body);
    grid.appendChild(card);
  });
}

function pgSelectRecipe(recipe) {
  pgSelectedRecipe = recipe;
  document.getElementById('pgPickerView').style.display = 'none';
  document.getElementById('pgActionView').style.display = 'block';
  document.getElementById('pgOutputArea').style.display = 'none';
  document.getElementById('pgSelectedName').textContent = recipe['食譜名稱'] || '';
  const imgEl = document.getElementById('pgSelectedImg');
  imgEl.src = pgIsValidUrl(recipe['成品圖片網址']) ? recipe['成品圖片網址'] : PG_PLACEHOLDER_IMG;
  imgEl.onerror = () => { imgEl.src = PG_PLACEHOLDER_IMG; };
  setFormStatus('pgStatus', '', '');
}

function pgBackToPicker() {
  document.getElementById('pgPickerView').style.display = 'block';
  document.getElementById('pgActionView').style.display = 'none';
  document.getElementById('pgOutputArea').style.display = 'none';
}

// ---- 貼文文案（固定套版：食譜介紹／食材／做法／小提醒）----
function pgGenerateText() {
  const r = pgSelectedRecipe;
  if (!r) return;
  const lines = [];

  lines.push(`🍽 ${r['食譜名稱'] || ''}`);
  lines.push('');

  const intro = String(r['簡介'] || '').trim();
  if (intro) {
    lines.push(intro);
    lines.push('');
  }

  const metaParts = [];
  if (r['烹調時間']) metaParts.push(`⏱ ${r['烹調時間']}`);
  if (r['適合月齡']) metaParts.push(`👶 ${r['適合月齡']}`);
  if (metaParts.length) {
    lines.push(metaParts.join('　'));
    lines.push('');
  }

  lines.push('—— 準備食材 ——');
  const ingList = pgGetRecipeIngredients(r);
  if (ingList.length) {
    ingList.forEach(i => {
      const name = pgIngredientFilterKey(i) || i['食材名稱'] || '';
      lines.push(`・${name}${i._quantity ? ' ' + i._quantity : ''}`);
    });
  } else {
    lines.push('（尚未提供食材清單）');
  }
  lines.push('');

  lines.push('—— 簡單做法 ——');
  const steps = pgGetStepLines(r);
  if (steps.length) {
    steps.forEach((s, idx) => lines.push(`${idx + 1}. ${s}`));
  } else {
    lines.push('（尚未提供做法）');
  }

  const tips = pgGetTipLines(r);
  if (tips.length) {
    lines.push('');
    lines.push('—— 小提醒 ——');
    tips.forEach(t => lines.push(`💡 ${t}`));
  }

  lines.push('');
  lines.push('🩷 雪莉與朵栗・@dondon0813 🩷');

  document.getElementById('pgOutputText').value = lines.join('\n');
  document.getElementById('pgOutputArea').style.display = 'block';
  document.getElementById('pgOutputTextWrap').style.display = 'block';
  document.getElementById('pgOutputImgWrap').style.display = 'none';
  setFormStatus('pgStatus', '文案已產生 ✓', 'ok');
}

async function pgCopyText() {
  const ta = document.getElementById('pgOutputText');
  const text = ta.value;
  if (!text) {
    setFormStatus('pgStatus', '請先產生文案再複製', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setFormStatus('pgStatus', '已複製到剪貼簿 ✓', 'ok');
  } catch (err) {
    ta.select();
    document.execCommand('copy');
    setFormStatus('pgStatus', '已複製到剪貼簿 ✓', 'ok');
  }
}

// ---- 4:5 貼文圖（沿用現有食譜海報樣式，固定版型：所有食譜都套同一套結構） ----
function pgBuildPosterHtml(r) {
  const title = escHtml(r['食譜名稱'] || '');
  const heroRaw = pgToSameOriginUrl(r['成品圖片網址']);
  const heroImg = pgIsValidUrl(heroRaw) ? heroRaw : PG_PLACEHOLDER_IMG;
  const ageLabel = escHtml(String(r['適合月齡'] || '').trim());

  const fullIngList = pgGetRecipeIngredients(r);
  const ingList = fullIngList.slice(0, 6); // 固定版型上限：右側直式清單，最多6項才能完整顯示不被裁切

  const steps = pgGetStepLines(r).slice(0, 4); // 固定版型上限：橫向一排最多4格
  const manualStepImgsRaw = String(r['步驟圖片'] || '').trim();
  const manualStepImgs = manualStepImgsRaw ? manualStepImgsRaw.split('|').map(s => s.trim()) : [];
  const tips = pgGetTipLines(r).slice(0, 3); // 固定版型上限：最多3行

  const ingHtml = ingList.map(i => {
    const name = escHtml(i._displayKey || pgIngredientFilterKey(i) || i['食材名稱'] || '');
    const qty = escHtml(i._quantity || '');
    const imgRaw = pgToSameOriginUrl(i['圖片網址']);
    const img = pgIsValidUrl(imgRaw) ? imgRaw : PG_PLACEHOLDER_IMG;
    return `
      <div class="pgp-ing-row">
        <div class="pgp-ing-photo-wrap" style="background-image:url('${escHtml(img)}')"><img class="pgp-ing-photo" crossorigin="anonymous" src="${img}"></div>
        <div class="pgp-ing-text"><span class="pgp-ing-name">${name}</span>${qty ? `<span class="pgp-ing-qty">${qty}</span>` : ''}</div>
      </div>`;
  }).join('');
  // 食材數量少（≤4個）時清單看起來太空，插入一張小插圖填補空間，
  // 跟其他食材列一起參與 .pgp-ing-list 的 space-between 排版
  const ingFillerHtml = (ingList.length >= 1 && ingList.length <= 4)
    ? `<div class="pgp-ing-filler"><img crossorigin="anonymous" src="images/recipes/ing-filler-cat.webp" alt=""></div>`
    : '';

  const stepCards = steps.map((s, idx) => {
    const n = idx + 1;
    const manualUrl = pgToSameOriginUrl(manualStepImgs[idx]);
    const autoUrl = pgToSameOriginUrl(pgBuildAutoStepImageUrl(heroRaw, n));
    const imgUrl = pgIsValidUrl(manualUrl) ? manualUrl : (pgIsValidUrl(autoUrl) ? autoUrl : '');
    const captionRaw = s.length > 22 ? s.slice(0, 22) + '…' : s;
    // 步驟文字有逗號的話，做成圖片時把逗號刪掉、改成換行（例如「雞蛋南瓜蒸15分，
    // 花椰菜3分鐘」變成兩行），比逗號直接印出來更好讀
    const caption = captionRaw.split(/[,，]/).map(part => escHtml(part.trim())).filter(Boolean).join('<br>');
    const stepImgSrc = imgUrl || PG_PLACEHOLDER_IMG;
    return `
      <div class="pgp-step-card">
        <div class="pgp-step-caption-wrap"><div class="pgp-step-caption">${caption}</div></div>
        <span class="pgp-step-badge">${n}</span>
        <div class="pgp-step-photo-wrap" style="background-image:url('${escHtml(stepImgSrc)}')">
          <img class="pgp-step-photo" crossorigin="anonymous" src="${stepImgSrc}">
        </div>
      </div>`;
  });
  // 箭頭改用 position:absolute 疊在卡片交界處（見 admin.html 對應 CSS 註解），
  // 不再穿插進 flex 排版裡佔位，用百分比 left 對齊每個交界點。
  const n = stepCards.length;
  const arrowsHtml = Array.from({ length: Math.max(n - 1, 0) }, (_, i) =>
    `<span class="pgp-step-arrow" style="left:${(100 / n * (i + 1)).toFixed(2)}%"></span>`).join('');
  const stepHtml = stepCards.join('') + arrowsHtml;

  const tipsHtml = tips.length ? `
    <div class="pgp-tip-bar">
      <img class="pgp-tip-badge" crossorigin="anonymous" src="images/recipes/reminder.png" alt="小提醒">
      <div class="pgp-tip-grid">
        ${tips.map(t => `<div class="pgp-tip-item"><img crossorigin="anonymous" src="images/recipes/heart.png" alt=""><span>${escHtml(t)}</span></div>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="pgp-poster">
      <div class="pgp-main-row">
        <div class="pgp-hero-wrap" style="background-image:url('${escHtml(heroImg)}')">
          <img class="pgp-hero-img" crossorigin="anonymous" src="${heroImg}">
          <div class="pgp-title-outline">${title}</div>
          <div class="pgp-title">${title}</div>
          ${ageLabel ? `<div class="pgp-age-badge">${ageLabel}</div>` : ''}
        </div>
        <div class="pgp-side-card">
          <img class="pgp-ing-badge-img" crossorigin="anonymous" src="images/recipes/ingredients.png" alt="準備食材">
          <div class="pgp-ing-list">${ingHtml || '<div class="pgp-empty">（尚未提供食材）</div>'}${ingFillerHtml}</div>
        </div>
      </div>

      <div class="pgp-step-section">
        <div class="pgp-step-badge-outer">
          <div class="pgp-step-badge-wrap">
            <img class="pgp-step-badge-img" crossorigin="anonymous" src="images/recipes/ricipesteps.png" alt="簡單步驟">
            <span class="pgp-step-badge-count">${steps.length || ''}</span>
          </div>
        </div>
        <div class="pgp-step-grid">${stepHtml || '<div class="pgp-empty">（尚未提供做法）</div>'}</div>
      </div>

      ${tipsHtml}

      <img class="pgp-mascot" crossorigin="anonymous" src="images/recipes/mascot-cat.webp" alt="">

      <div class="pgp-footer">雪莉與朵栗・IG@dondon0813</div>
    </div>
  `;
}

async function pgGeneratePoster() {
  const r = pgSelectedRecipe;
  if (!r) return;
  if (typeof html2canvas === 'undefined') {
    setFormStatus('pgStatus', '圖片產生工具尚未載入，請重新整理頁面再試一次', 'error');
    return;
  }
  setFormStatus('pgStatus', '海報產生中…請稍候', '');

  const stage = document.getElementById('pgPosterStage');
  stage.innerHTML = pgBuildPosterHtml(r);

  // 等所有圖片載入完成（或失敗）才截圖，避免拍到空白圖
  const imgs = Array.from(stage.querySelectorAll('img'));
  await Promise.all(imgs.map(img => new Promise(resolve => {
    if (img.complete) return resolve();
    img.addEventListener('load', resolve);
    img.addEventListener('error', resolve);
  })));

  // 標題用的自訂字體檔案較大，沒等載入完成就截圖會先拍到系統預設字體
  try {
    await document.fonts.load("50px 'Tsuhsianti'");
    await document.fonts.ready;
  } catch (err) { /* 字體載入失敗就用退回字體截圖，不擋流程 */ }

  try {
    const canvas = await html2canvas(stage.firstElementChild, {
      width: 1080,
      height: 1350,
      scale: 1,
      useCORS: true,
      backgroundColor: '#FFF7EE'
    });
    // 改用 toBlob+objectURL（不是 toDataURL），跟姓名貼產生器同一招：手機瀏覽器對
    // <a download> 配 data: 網址常常沒反應，配 blob: 網址才能正常跳出檢視/下載。
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('圖片轉檔失敗');
    const url = URL.createObjectURL(blob);

    const imgEl = document.getElementById('pgOutputImg');
    imgEl.src = url;
    document.getElementById('pgOutputArea').style.display = 'block';
    document.getElementById('pgOutputImgWrap').style.display = 'block';
    document.getElementById('pgOutputTextWrap').style.display = 'none';

    // 下載按鈕改成固定存在的 <a download>（不是每次點擊才動態建立/點擊/移除），
    // 直接設定 href/download，同樣跟姓名貼產生器一致的做法。
    const downloadBtn = document.getElementById('pgDownloadImgBtn');
    downloadBtn.href = url;
    downloadBtn.download = (r['食譜名稱'] || '食譜貼文') + '.png';

    setFormStatus('pgStatus', '貼文圖已產生，可以下載囉 ✓', 'ok');
  } catch (err) {
    setFormStatus('pgStatus', '圖片產生失敗：' + err.message, 'error');
  } finally {
    stage.innerHTML = '';
  }
}

