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

  // 09-26 雪莉改回帶網址：這顆是貼 LINE 用的，跟 FB 不能帶連結的政策無關（跟「貼文文案」品牌模板是兩個工具）
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

// ===== 轉檔小工具「轉音檔」分頁（2026-10-10）=====
// YouTube 擋雲端主機下載，所以這裡只排隊：網址存進後端 → 雪莉家裡電腦（dondon-platform scripts/music-worker.mjs）
// 每 15 秒來拿、抓好 mp3 上傳 → 這裡每 5 秒刷新，出現「下載 mp3」鈕。後端 lib/legacy/musicqueue.ts。
let convertAudioTimer = null;
let convertAudioLoading = false;

document.addEventListener('click', (e) => {
  const seg = e.target.closest('#convertSeg [data-convert-seg]');
  if (!seg) return;
  const mode = seg.getAttribute('data-convert-seg');
  document.querySelectorAll('#convertSeg [data-convert-seg]').forEach((s) => s.classList.toggle('on', s === seg));
  document.getElementById('convertImagePane').style.display = mode === 'image' ? '' : 'none';
  document.getElementById('convertAudioPane').style.display = mode === 'audio' ? '' : 'none';
  if (mode === 'audio') convertAudioRefresh();
});

function convertAudioEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 分頁還看得到才繼續輪詢（換頁或切回轉圖片就停）
function convertAudioVisible() {
  const pane = document.getElementById('convertAudioPane');
  return !!(pane && pane.offsetParent);
}

function convertAudioSchedule(ms) {
  clearTimeout(convertAudioTimer);
  convertAudioTimer = setTimeout(() => { if (convertAudioVisible()) convertAudioRefresh(); }, ms);
}

async function convertAudioRefresh() {
  if (convertAudioLoading) return;
  convertAudioLoading = true;
  try {
    const r = await postTask({ type: 'music-list' });
    convertAudioRender(r);
    const pending = (r.jobs || []).some((j) => j.status === 'queued' || j.status === 'working');
    convertAudioSchedule(pending ? 5000 : 30000);
  } catch (err) {
    document.getElementById('convertAudioWorker').textContent = '讀取失敗：' + err.message;
    convertAudioSchedule(30000);
  } finally {
    convertAudioLoading = false;
  }
}

function convertAudioRender(r) {
  const w = document.getElementById('convertAudioWorker');
  w.style.color = r.workerAlive ? 'var(--c-text-soft)' : 'var(--c-danger, #B5485A)';
  w.textContent = r.workerAlive ? '家裡電腦在線，可以下載' : '家裡電腦目前沒開（或下載程式沒在跑），網址會先排隊，電腦開了就會自動抓';
  const jobs = r.jobs || [];
  const box = document.getElementById('convertAudioList');
  if (!jobs.length) { box.innerHTML = ''; return; }
  const label = { queued: '排隊中', working: '抓取中…', done: '完成', error: '失敗' };
  box.innerHTML = jobs.map((j) => {
    const name = j.title || j.url;
    const sub = j.status === 'done'
      ? (j.size ? (j.size / 1048576).toFixed(1) + ' MB' : '')
      : j.status === 'error' ? convertAudioEsc(j.error) : '';
    const ops = (j.status === 'done' ? '<button class="task-mini-btn" data-audio-dl="' + j.id + '">下載 mp3</button>' : '') +
      (j.status !== 'working' ? '<button class="task-mini-btn x-btn" data-audio-del="' + j.id + '" title="移除">✕</button>' : '');
    return '<div style="display:flex; align-items:center; gap:8px; padding:9px 0; border-top:1px solid var(--c-line);">' +
      '<div style="flex:1; min-width:0;">' +
        '<div style="font-size:13.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + convertAudioEsc(name) + '</div>' +
        '<div style="font-size:12px; color:var(--c-text-soft);">' + label[j.status] + (sub ? '｜' + sub : '') + '</div>' +
      '</div>' + ops + '</div>';
  }).join('');
}

async function convertAudioSubmit() {
  const input = document.getElementById('convertAudioUrl');
  const url = input.value.trim();
  if (!url) { setFormStatus('convertAudioStatus', '請先貼上 YouTube 網址', 'error'); return; }
  const btn = document.getElementById('convertAudioBtn');
  btn.disabled = true;
  try {
    const r = await postTask({ type: 'music-request', url });
    setFormStatus('convertAudioStatus', r.duplicate ? '這支已經在清單裡了' : '已加入，抓好後下面會出現「下載 mp3」', 'ok');
    input.value = '';
    convertAudioRefresh();
  } catch (err) {
    setFormStatus('convertAudioStatus', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', async (e) => {
  const dl = e.target.closest('[data-audio-dl]');
  const del = e.target.closest('[data-audio-del]');
  if (!dl && !del) return;
  const btn = dl || del;
  btn.disabled = true;
  try {
    if (dl) {
      const r = await postTask({ type: 'music-download-url', id: dl.getAttribute('data-audio-dl') });
      const a = document.createElement('a');
      a.href = r.url;
      a.download = r.fileName || 'music.mp3';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      await postTask({ type: 'music-delete', id: del.getAttribute('data-audio-del') });
      convertAudioRefresh();
    }
  } catch (err) {
    setFormStatus('convertAudioStatus', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

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

// 食材圖：去背小圖 || 一般圖片；新 key 不存在（後端未上線）時退回舊的 '圖片網址'
function pgIngCutoutUrl(i) {
  if (!i) return '';
  if (!('去背圖片網址' in i) && !('一般圖片網址' in i)) return i['圖片網址'] || '';
  return i['去背圖片網址'] || i['一般圖片網址'] || '';
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
        ing = nameMatches.find(i => i['去背圖片網址'] && pgIsValidUrl(pgToSameOriginUrl(i['去背圖片網址'])))
          || nameMatches.find(i => pgIsValidUrl(pgToSameOriginUrl(pgIngCutoutUrl(i))))
          || nameMatches[0];
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
  pgInitColorInputs();
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
    const imgRaw = pgToSameOriginUrl(pgIngCutoutUrl(i));
    const img = pgIsValidUrl(imgRaw) ? imgRaw : PG_PLACEHOLDER_IMG;
    return `
      <div class="pgp-ing-row">
        <div class="pgp-ing-photo-wrap" style="background-image:url('${escHtml(img)}')"><img class="pgp-ing-photo" crossorigin="anonymous" src="${img}"></div>
        <div class="pgp-ing-text"><span class="pgp-ing-name">${name}</span>${qty ? `<span class="pgp-ing-qty">${qty}</span>` : ''}</div>
      </div>`;
  }).join('');
  // 食材數量少（≤4個）時清單看起來太空，插入一張小插圖填補空間，
  // 跟其他食材列一起參與 .pgp-ing-list 的 space-between 排版
  // 10-12 雪莉：食材圖放大後 4 樣時貓咪下半被切掉 → 貓咪可往下超出食材欄，最低到步驟框虛線
  // （食材欄底 padding 6 + 步驟框 margin-top 20 = 26px）；剩餘空間不夠時貓咪等比例縮小，不壓到最後一樣食材。
  // 食材欄內容高 566（620 − 上 48 − 下 6），貓咪原圖 440×401、最大顯示 240 寬＝219 高。
  const ingSize = ingList.length <= 4 ? 110 : ingList.length === 5 ? 104 : 92;
  const catH = Math.min(219, 566 - ingList.length * ingSize - 8 + 26);
  const ingFillerHtml = (ingList.length >= 1 && ingList.length <= 4)
    ? `<div class="pgp-ing-filler" style="height:${Math.max(0, catH - 26)}px"><img crossorigin="anonymous" src="images/recipes/ing-filler-cat.webp" alt="" style="height:${catH}px"></div>`
    : '';

  const stepCards = steps.map((s, idx) => {
    const n = idx + 1;
    const manualUrl = pgToSameOriginUrl(manualStepImgs[idx]);
    const autoUrl = pgToSameOriginUrl(pgBuildAutoStepImageUrl(heroRaw, n));
    const imgUrl = pgIsValidUrl(manualUrl) ? manualUrl : (pgIsValidUrl(autoUrl) ? autoUrl : '');
    // 10-12 雪莉：不再截字加「…」（成品是圖片、點不開），太長由 pgLayoutSteps 縮字級
    const captionRaw = s;
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
    `<span class="pgp-step-arrow" style="left:${(100 / n * (i + 1)).toFixed(2)}%">${pgArrowSvg(PG_COLOR_DEFAULTS.circle)}</span>`).join('');
  const stepHtml = stepCards.join('') + arrowsHtml;

  // 小提醒字級：估算每條換成幾行（中文字算 1、英數算 0.55），框內可用高度約 148px，
  // 依序試 34／30／27／24px，挑第一個放得下的（10-12 雪莉：太長換行、不碰貓咪）
  const tipTextWidth = 645; // 1080 − 海報左右邊 36 − 框左 18 − 框右 345 − 愛心 36
  const tipUnits = s => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) < 256 ? 0.55 : 1), 0);
  const tipSize = [34, 30, 27, 24].find(fs => {
    const perLine = Math.floor(tipTextWidth / fs);
    const lines = tips.reduce((n, s) => n + Math.min(2, Math.max(1, Math.ceil(tipUnits(s) / perLine))), 0);
    return lines * fs * 1.15 + 8 * Math.max(tips.length - 1, 0) <= 148;
  }) || 24;
  const tipsHtml = tips.length ? `
    <div class="pgp-tip-bar" style="--pgp-tip-size:${tipSize}px">
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
          <div class="pgp-ing-list" style="--pgp-ing-size:${ingSize}px">${ingHtml || '<div class="pgp-empty">（尚未提供食材）</div>'}${ingFillerHtml}</div>
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

// 食材圖視覺大小統一（10-12 雪莉：吐司直式又沒留白，撐滿整格看起來特別大）：
// 不再單純「塞進正方形」，改成每張圖佔的面積一樣（格子的 70%），長寬各自不超過格子。
// 高度最多到格子 90%（10-12 雪莉定）。方形約 84%、直式吐司約 73%×90%、橫式起司約 95%×74%。圖片沒載入成功（讀不到原始尺寸）就維持原本 contain。
function pgNormalizeIngPhotos(root) {
  root.querySelectorAll('.pgp-ing-photo-wrap').forEach(wrap => {
    const img = wrap.querySelector('.pgp-ing-photo');
    const box = wrap.clientWidth;
    if (!img || !img.naturalWidth || !img.naturalHeight || !box) return;
    const r = img.naturalWidth / img.naturalHeight;
    let w = box * Math.sqrt(0.7 * r);
    let h = box * Math.sqrt(0.7 / r);
    const k = Math.min(1, box / w, box * 0.9 / h); // 高度上限 90%（10-12 雪莉定）
    w *= k; h *= k;
    const W = Math.round(w), H = Math.round(h);
    wrap.style.backgroundSize = `${W}px ${H}px`;
    // 10-12 雪莉：去背食材在成品圖邊緣一格一格（html2canvas 一次把 600px 原圖縮到 100px，鋸齒）。
    // 先用畫布一半一半縮到剛好的尺寸再當背景圖，截圖時就是 1:1 不再縮。跨網域圖片（讀不到像素）維持原圖。
    try {
      let src = img, sw = img.naturalWidth, sh = img.naturalHeight;
      while (sw / 2 >= W && sh / 2 >= H) {
        const c = document.createElement('canvas');
        c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
        const cx = c.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(src, 0, 0, c.width, c.height);
        src = c; sw = c.width; sh = c.height;
      }
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ox = out.getContext('2d');
      ox.imageSmoothingQuality = 'high';
      ox.drawImage(src, 0, 0, W, H);
      wrap.style.backgroundImage = `url('${out.toDataURL('image/png')}')`;
    } catch (err) { /* 畫布被跨網域圖片污染就不處理，沿用原圖 */ }
  });
}

// 步驟圖高度（10-12 雪莉選 B＋C）：文字區只留「最多字那格」的行數（1 或 2 行），
// 剩下的高度都給圖片，但圖片高不超過卡片寬（4 步驟不會變細長條）；步驟越少卡片越寬、圖可以越高。
// 數字圓圈貼圖片上緣、箭頭在圖片中線，跟著圖片高度一起移（原本寫死 185px 圖對應的 165／73）。
function pgLayoutSteps(root) {
  const grid = root.querySelector('.pgp-step-grid');
  const cards = grid ? [...grid.querySelectorAll('.pgp-step-card')] : [];
  if (!cards.length) return;
  // 文字不截斷（10-12 雪莉）：每格最多 3 行，放不下就整排一起縮字級 32→29→26→24
  const caps = cards.map(card => card.querySelector('.pgp-step-caption')).filter(Boolean);
  let fs = 32, maxLines = 1;
  // 使用者在編輯模式手動設過字級的格子（data-fixed-fs）不參與自動縮字
  const capFs = cap => parseFloat(cap.style.fontSize) || fs;
  const capLines = cap => Math.max(1, Math.round(cap.scrollHeight / (capFs(cap) * 1.4)));
  for (fs of [32, 29, 26, 24]) {
    caps.forEach(cap => { if (!cap.dataset.fixedFs) cap.style.fontSize = fs + 'px'; });
    maxLines = Math.max(1, ...caps.filter(c => !c.dataset.fixedFs).map(capLines));
    if (maxLines <= 3) break;
  }
  const textH = Math.max(...caps.map(cap => capLines(cap) * capFs(cap) * 1.4)) + 8;
  const photoH = Math.round(Math.max(110, Math.min(grid.clientHeight - textH, cards[0].clientWidth)));
  cards.forEach(card => {
    const wrap = card.querySelector('.pgp-step-photo-wrap');
    const badge = card.querySelector('.pgp-step-badge');
    if (wrap) wrap.style.height = photoH + 'px';
    // 數字圓圈放進步驟圖左上角（10-12 雪莉）：圖片上緣往下 12px、往右 12px，圓圈 40px
    if (badge) { badge.style.bottom = (photoH - 12 - 40) + 'px'; badge.style.left = '12px'; }
  });
  // 箭頭中心對準圖片中線（transform 往下 50%，所以 bottom 就是中心點高度）
  grid.querySelectorAll('.pgp-step-arrow').forEach(a => { a.style.bottom = Math.round(photoH / 2) + 'px'; });
}

// 標題微微彎曲（10-12 雪莉）：每個字拆成一格，依「離那一行中心多遠」往下移＋旋轉，排成中間高、兩邊低的拱形。
// 外框層與文字層排版完全一樣，用同一組位移才會對齊。每一行頭尾兩字下沉 TITLE_ARC_SAG px。

function pgArcTitle(root) {
  const layers = [root.querySelector('.pgp-title-outline'), root.querySelector('.pgp-title')].filter(Boolean);
  if (layers.length !== 2) return;
  layers.forEach(el => {
    // 編輯模式可能換過行（<br>）：逐行拆字，行與行之間保留 <br>
    const tmp = document.createElement('div');
    const lineTexts = el.innerHTML.split(/<br\s*\/?>/i).map(h => { tmp.innerHTML = h; return tmp.textContent; });
    const text = lineTexts.join('\n');
    el.textContent = '';
    // html2canvas 遇到「overflow:hidden（三行截斷）＋子元素有 transform」會把左半邊的字裁掉，拱形時改成一般區塊不截斷
    el.style.display = 'block';
    el.style.overflow = 'visible';
    [...text].forEach(ch => {
      if (ch === '\n') { el.appendChild(document.createElement('br')); return; }
      const sp = document.createElement('span');
      sp.textContent = ch;
      sp.style.display = 'inline-block';
      if (ch === ' ') sp.style.whiteSpace = 'pre';
      el.appendChild(sp);
    });
  });
  const spans = [...layers[1].querySelectorAll('span')];
  const outlineSpans = [...layers[0].querySelectorAll('span')];
  const lines = {};
  spans.forEach((sp, i) => { (lines[sp.offsetTop] = lines[sp.offsetTop] || []).push(i); });
  const TITLE_ARC_SAG = 26; // 10-12 雪莉：再彎一些（原 14）
  Object.values(lines).forEach(idxs => {
    const first = spans[idxs[0]], last = spans[idxs[idxs.length - 1]];
    const center = (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2;
    // 依這一行自己的半寬算：每一行頭尾兩字的中心都下沉 TITLE_ARC_SAG（下限 150 避免兩三個字的短行彎太誇張）
    const half = Math.max(150, center - first.offsetLeft - first.offsetWidth / 2);
    idxs.forEach(i => {
      const sp = spans[i];
      const dx = sp.offsetLeft + sp.offsetWidth / 2 - center;
      const y = TITLE_ARC_SAG * (dx / half) ** 2;
      const deg = Math.atan(2 * TITLE_ARC_SAG * dx / (half * half)) * 180 / Math.PI;
      const t = `translateY(${y.toFixed(1)}px) rotate(${deg.toFixed(2)}deg)`;
      sp.style.transform = t;
      if (outlineSpans[i]) outlineSpans[i].style.transform = t;
    });
  });
}

// ===== 貼文圖配色（10-12 雪莉：自己選色，存本機瀏覽器） =====
// label＝三張標籤圖（準備食材／簡單步驟／小提醒）的粉色底；circle＝「簡單○步驟」圈圈＋步驟圖 1234 圓圈；
// badge＝月齡標籤底色；title＝標題字色。標籤是 PNG 圖，換色＝在畫布上把粉色底（或橘圈）的像素改色相／飽和、保留明暗。
var PG_COLOR_DEFAULTS = { label: '#fdc4bc', circle: '#fc9474', badge: '#8fb035', title: '#ee8e36' };
var PG_COLOR_KEY = 'pg_poster_colors';
// 步驟箭頭：一整個箭頭外形，先畫一層粗白線（外框）再填色，白框沿外圍完整繞一圈、轉角圓角
function pgArrowSvg(color) {
  const d = 'M6 15 H30 V6 L52 22 L30 38 V29 H6 Z';
  return `<svg viewBox="0 0 58 44" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/><path d="${d}" fill="${color}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}
function pgGetColors() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PG_COLOR_KEY) || '{}') || {}; } catch (e) { saved = {}; }
  return Object.assign({}, PG_COLOR_DEFAULTS, saved);
}
function pgRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const M = Math.max(r, g, b), m = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (M + m) / 2;
  if (M !== m) {
    const d = M - m;
    s = l > 0.5 ? d / (2 - M - m) : d / (M + m);
    h = M === r ? ((g - b) / d + (g < b ? 6 : 0)) : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function pgHexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  return pgRgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
function pgHslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
// textFix：把圖裡的咖啡色字改成「簡單步驟」那張的深咖啡 #53220a（10-12 雪莉：準備食材／小提醒字色跟步驟一樣）
// { base: 這張圖原本字色, maxX: 只改左邊到這個比例（小提醒右邊的燈泡不動） }
async function pgRecolorImg(img, colors, withCircle, textFix) {
  if (!img || !img.naturalWidth) return;
  const needLabel = colors.label.toLowerCase() !== PG_COLOR_DEFAULTS.label;
  const needCircle = withCircle && colors.circle.toLowerCase() !== PG_COLOR_DEFAULTS.circle;
  if (!needLabel && !needCircle && !textFix) return;
  try {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const im = cx.getImageData(0, 0, W, H);
    const d = im.data;
    const baseLabelL = pgHexToHsl(PG_COLOR_DEFAULTS.label)[2], tLabel = pgHexToHsl(colors.label);
    const baseCircleL = pgHexToHsl(PG_COLOR_DEFAULTS.circle)[2], tCircle = pgHexToHsl(colors.circle);
    const tText = pgHexToHsl('#53220a'), baseTextL = textFix ? pgHexToHsl(textFix.base)[2] : 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const [h, s, l] = pgRgbToHsl(d[i], d[i + 1], d[i + 2]);
      let t = null, baseL = 0;
      // 粉色底：色相 340°～12°、亮度 > 0.62
      if (needLabel && (h >= 340 || h <= 12) && l > 0.62 && s > 0.25) { t = tLabel; baseL = baseLabelL; }
      // 咖啡色字（含反鋸齒邊緣）：色相 15°～45°、亮度 < 0.6
      else if (textFix && h >= 15 && h <= 45 && l < 0.6 && s > 0.2 && ((i / 4) % W) < W * textFix.maxX) { t = tText; baseL = baseTextL; }
      // 橘圈：色相 12°～28°、飽和 > 0.6、亮度 0.55～0.82，只看圖片中間 30%～70%（避開左邊星星裝飾）
      else if (needCircle && h > 12 && h < 28 && s > 0.6 && l > 0.55 && l < 0.82) {
        const x = (i / 4) % W;
        if (x > W * 0.3 && x < W * 0.7) { t = tCircle; baseL = baseCircleL; }
      }
      if (!t) continue;
      const [r, g, b] = pgHslToRgb(t[0], t[1], Math.max(0, Math.min(1, l + (t[2] - baseL))));
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    cx.putImageData(im, 0, 0);
    await new Promise(res => { img.onload = res; img.onerror = res; img.src = c.toDataURL('image/png'); });
  } catch (err) { /* 讀不到像素（跨網域）就維持原圖 */ }
}
async function pgApplyColors(root) {
  const colors = pgGetColors();
  const title = root.querySelector('.pgp-title');
  if (title) title.style.color = colors.title;
  const badge = root.querySelector('.pgp-age-badge');
  if (badge) badge.style.background = colors.badge;
  root.querySelectorAll('.pgp-step-badge').forEach(b => { b.style.background = colors.circle; });
  const poster = root.querySelector('.pgp-poster');
  if (poster) poster.querySelectorAll('.pgp-step-arrow').forEach(el => { el.innerHTML = pgArrowSvg(colors.circle); }); // 箭頭跟圈圈同色
  await pgRecolorImg(root.querySelector('.pgp-ing-badge-img'), colors, false, { base: '#7f5528', maxX: 1 });
  await pgRecolorImg(root.querySelector('.pgp-step-badge-img'), colors, true);
  await pgRecolorImg(root.querySelector('.pgp-tip-badge'), colors, false, { base: '#7a4d16', maxX: 0.72 });
}
// 配色選擇器：開視窗時帶入目前值；改色存本機，已經有產生的圖就自動重畫（0.6 秒內連續調整只畫最後一次）
var pgColorTimer = null, pgColorBound = false;
function pgInitColorInputs() {
  const colors = pgGetColors();
  const map = { label: 'pgColorLabel', circle: 'pgColorCircle', badge: 'pgColorBadge', title: 'pgColorTitle' };
  Object.entries(map).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = colors[k];
    if (!pgColorBound) el.addEventListener('input', () => {
      const cur = pgGetColors();
      cur[k] = el.value;
      try { localStorage.setItem(PG_COLOR_KEY, JSON.stringify(cur)); } catch (e) { /* 存不了就只用這一次 */ }
      clearTimeout(pgColorTimer);
      pgColorTimer = setTimeout(() => {
        const wrap = document.getElementById('pgOutputImgWrap');
        if (pgSelectedRecipe && wrap && wrap.style.display !== 'none') pgGeneratePoster();
      }, 600);
    });
  });
  pgColorBound = true;
}
function pgResetColors() {
  try { localStorage.removeItem(PG_COLOR_KEY); } catch (e) { /* ignore */ }
  pgInitColorInputs();
  const wrap = document.getElementById('pgOutputImgWrap');
  if (pgSelectedRecipe && wrap && wrap.style.display !== 'none') pgGeneratePoster();
}

// ===== 貼文圖文字編輯（10-12 雪莉：點圖上文字直接改字／換行／字級／顏色／拖曳位置） =====
// 只改這張圖、不動食譜資料庫；調整依食譜 ID 記在本機瀏覽器，同一道食譜下次產生自動套用。
// 每段文字一個 key：title、age、ing-0…、step-0…、tip-0…、footer；值 { text, fs, color, dx, dy }（都可省略）。
var PG_EDIT_KEY = 'pg_poster_edits';
function pgRecipeKey() { return pgSelectedRecipe ? String(pgSelectedRecipe['食譜ID'] || pgSelectedRecipe['食譜名稱'] || '') : ''; }
function pgGetAllEdits() {
  try { return JSON.parse(localStorage.getItem(PG_EDIT_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function pgGetEdits() { return pgGetAllEdits()[pgRecipeKey()] || {}; }
function pgSaveEdits(edits) {
  const all = pgGetAllEdits();
  const k = pgRecipeKey();
  if (!k) return;
  if (Object.keys(edits).length) all[k] = edits; else delete all[k];
  try { localStorage.setItem(PG_EDIT_KEY, JSON.stringify(all)); } catch (e) { /* 存不了就只用這一次 */ }
}
// 可編輯的文字清單（標題有外框層，改字／字級要兩層一起改）
function pgEditTargets(root) {
  const list = [];
  const title = root.querySelector('.pgp-title');
  if (title) list.push({ key: 'title', el: title, twin: root.querySelector('.pgp-title-outline'), label: '標題' });
  const age = root.querySelector('.pgp-age-badge');
  if (age) list.push({ key: 'age', el: age, label: '月齡' });
  root.querySelectorAll('.pgp-ing-text').forEach((el, i) => list.push({ key: 'ing-' + i, el, label: '食材', spans: true }));
  root.querySelectorAll('.pgp-step-caption').forEach((el, i) => list.push({ key: 'step-' + i, el, label: '步驟' }));
  root.querySelectorAll('.pgp-tip-item span').forEach((el, i) => list.push({ key: 'tip-' + i, el, label: '小提醒' }));
  const footer = root.querySelector('.pgp-footer');
  if (footer) list.push({ key: 'footer', el: footer, label: '頁尾' });
  return list;
}
function pgTextToHtml(text) { return escHtml(text).replace(/\n/g, '<br>'); }
// 把某一段的調整套到畫面上（產圖與編輯畫面共用）
function pgApplyOneEdit(tg, e) {
  if (!e) return;
  const els = tg.twin ? [tg.el, tg.twin] : [tg.el];
  if (typeof e.text === 'string') {
    els.forEach(el => {
      el.innerHTML = tg.spans ? `<span class="pgp-ing-name">${pgTextToHtml(e.text)}</span>` : pgTextToHtml(e.text);
    });
  }
  if (e.fs) {
    els.forEach(el => {
      el.style.fontSize = e.fs + 'px';
      el.dataset.fixedFs = '1';
      if (tg.spans) el.querySelectorAll('span').forEach(s => { s.style.fontSize = e.fs + 'px'; });
    });
  }
  if (e.color) {
    tg.el.style.color = e.color;
    if (tg.spans) tg.el.querySelectorAll('span').forEach(s => { s.style.color = e.color; });
  }
  if (e.dx || e.dy) {
    // 絕對定位（標題、月齡）用 margin 位移；其他用 position:relative＋left/top，都不影響旁邊排版
    els.forEach(el => {
      if (getComputedStyle(el).position === 'absolute') {
        el.style.marginLeft = (e.dx || 0) + 'px';
        el.style.marginTop = (e.dy || 0) + 'px';
      } else {
        el.style.position = 'relative';
        el.style.left = (e.dx || 0) + 'px';
        el.style.top = (e.dy || 0) + 'px';
      }
    });
  }
}
function pgApplyEdits(root, edits) {
  pgEditTargets(root).forEach(tg => pgApplyOneEdit(tg, edits[tg.key]));
}

// 編輯畫面：全螢幕蓋一層，海報依視窗縮放顯示；點文字＝直接打字（Enter 換行），上方工具列調字級／顏色／重置，
// 文字旁的「移動」把手拖曳改位置。按「完成」關掉並重新產圖。
var pgEditor = null;
async function pgOpenTextEditor() {
  const r = pgSelectedRecipe;
  if (!r) return;
  if (pgEditor) pgCloseTextEditor(false);
  const ov = document.createElement('div');
  ov.id = 'pgEditOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(60,45,35,.55);display:flex;flex-direction:column;align-items:center;';
  ov.innerHTML = `
    <div style="width:100%;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.12);">
      <strong style="color:#5A4A42;font-size:14px;">編輯貼文圖文字</strong>
      <span id="pgEdTarget" style="font-size:12px;color:#7D6A5F;">點圖上的文字開始編輯（Enter 換行）</span>
      <span style="flex:1"></span>
      <button class="task-mini-btn" data-ed="smaller" title="字變小">A−</button>
      <button class="task-mini-btn" data-ed="bigger" title="字變大">A+</button>
      <span style="font-size:12px;color:#7D6A5F;display:flex;align-items:center;gap:4px;">顏色<input type="color" id="pgEdColor" tabindex="-1" style="width:36px;height:28px;padding:0;border:1px solid #E6DCD2;border-radius:6px;"></span>
      <button class="task-mini-btn" data-ed="reset" title="這一段回到原本">重置這段</button>
      <button class="task-mini-btn" data-ed="resetAll">全部重置</button>
      <button class="task-submit-btn" data-ed="done" style="width:auto;margin:0;padding:8px 18px;">完成</button>
    </div>
    <div id="pgEdScroll" style="flex:1;width:100%;overflow:auto;display:flex;justify-content:center;padding:16px 0;">
      <div id="pgEdScaler" style="transform-origin:top left;">
        <div id="pgEdStage" style="width:1080px;height:1350px;--c-bg-bottom:#FFF1E6;--c-border-light:#FFE3CC;--c-text:#5a4a3f;--c-text-soft:#8a7462;"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const stage = ov.querySelector('#pgEdStage');
  stage.innerHTML = pgBuildPosterHtml(r);
  const imgs = Array.from(stage.querySelectorAll('img'));
  await Promise.all(imgs.map(img => new Promise(res => { if (img.complete) return res(); img.addEventListener('load', res); img.addEventListener('error', res); })));
  await pgApplyColors(stage);
  const edits = Object.assign({}, pgGetEdits());
  pgApplyEdits(stage, edits);
  pgNormalizeIngPhotos(stage);
  pgLayoutSteps(stage);
  pgPlaceMascot(stage);
  // 縮放到視窗高度（編輯畫面不做標題拱形，方便直接打字；產圖時才彎）
  const scaler = ov.querySelector('#pgEdScaler');
  const fit = () => {
    const avail = ov.querySelector('#pgEdScroll').clientHeight - 32;
    const s = Math.min(1, Math.max(0.3, avail / 1350), (window.innerWidth - 24) / 1080);
    scaler.style.transform = `scale(${s})`;
    scaler.style.width = (1080 * s) + 'px';
    scaler.style.height = (1350 * s) + 'px';
    pgEditor.scale = s;
  };
  pgEditor = { ov, stage, edits, current: null, scale: 1, fit };
  fit();
  // 剛插入畫面時版面高度可能還沒算好（量到 0 會變原尺寸顯示），下一個畫面更新後再量一次
  requestAnimationFrame(() => { if (pgEditor) fit(); });
  setTimeout(() => { if (pgEditor) fit(); }, 150);
  window.addEventListener('resize', fit);

  const targets = pgEditTargets(stage);
  const handle = document.createElement('div');
  handle.title = '按住拖曳移動位置';
  handle.textContent = '✥ 移動';
  handle.style.cssText = 'position:absolute;z-index:20;display:none;padding:4px 10px;background:#5A4A42;color:#fff;border-radius:999px;font-size:22px;cursor:move;user-select:none;touch-action:none;';
  stage.querySelector('.pgp-poster').appendChild(handle);
  const placeHandle = () => {
    const tg = pgEditor.current;
    if (!tg) { handle.style.display = 'none'; return; }
    const pr = stage.querySelector('.pgp-poster').getBoundingClientRect();
    const er = tg.el.getBoundingClientRect();
    const s = pgEditor.scale;
    handle.style.display = 'block';
    handle.style.left = ((er.left - pr.left) / s) + 'px';
    handle.style.top = Math.max(0, (er.top - pr.top) / s - 44) + 'px';
  };
  const saveText = tg => {
    const text = tg.el.innerText.replace(/\n+$/, '');
    const e = edits[tg.key] || {};
    e.text = text;
    edits[tg.key] = e;
    if (tg.twin) tg.twin.innerHTML = pgTextToHtml(text);
    pgSaveEdits(edits);
  };
  const select = tg => {
    if (pgEditor.current && pgEditor.current !== tg) pgEditor.current.el.style.outline = '';
    pgEditor.current = tg;
    tg.el.style.outline = '3px dashed #C99A9B';
    tg.el.style.outlineOffset = '4px';
    ov.querySelector('#pgEdTarget').textContent = '正在編輯：' + tg.label;
    ov.querySelector('#pgEdColor').value = /^#[0-9a-f]{6}$/i.test((edits[tg.key] || {}).color || '') ? edits[tg.key].color : '#5a4a3f';
    // 10-12 雪莉回報：點文字後按 Enter 跳出選色器 → 選取時一定把游標放回這段文字，不讓焦點留在選色框
    if (document.activeElement !== tg.el) tg.el.focus();
    placeHandle();
  };
  targets.forEach(tg => {
    tg.el.setAttribute('contenteditable', 'true');
    tg.el.style.cursor = 'text';
    if (tg.el.style.webkitLineClamp !== undefined) tg.el.style.webkitLineClamp = 'unset';
    // 10-12 雪莉回報：點步驟文字游標卻跑到最下面頁尾。步驟文字／標題是 display:-webkit-box（多行截斷用），
    // 放在縮放過的畫面裡，Chrome 點擊定位游標可能算錯、跑到別的可編輯區 → 編輯畫面一律改成一般區塊
    if (getComputedStyle(tg.el).display === '-webkit-box') tg.el.style.display = 'block';
    tg.el.addEventListener('focus', () => select(tg));
    tg.el.addEventListener('pointerdown', () => select(tg));
    tg.el.addEventListener('input', () => { if (pgEditor.current !== tg) select(tg); saveText(tg); pgLayoutSteps(stage); pgPlaceMascot(stage); placeHandle(); });
    // 貼上只收純文字，避免帶進別處的格式
    tg.el.addEventListener('paste', ev => {
      ev.preventDefault();
      document.execCommand('insertText', false, (ev.clipboardData || window.clipboardData).getData('text'));
    });
  });
  // 10-12 雪莉回報「點步驟文字游標跑到頁尾」實測原因：點在文字旁的空白（不是剛好點在字上）時，
  // 瀏覽器會把游標塞進附近另一個可編輯區。改成：點在步驟格／食材列／小提醒列的空白＝選那一格的文字；
  // 點在其他非文字地方＝攔下預設行為，游標不動。
  const caretToEnd = el => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  stage.addEventListener('mousedown', ev => {
    if (ev.target === handle || ev.target.closest('[contenteditable="true"]')) return;
    ev.preventDefault();
    const owner = ev.target.closest('.pgp-step-card, .pgp-ing-row, .pgp-tip-item');
    const ed = owner && owner.querySelector('.pgp-step-caption, .pgp-ing-text, .pgp-tip-item span');
    const tg = ed && targets.find(x => x.el === ed);
    if (tg) { caretToEnd(tg.el); select(tg); }
  }, true);
  // 保險：點完之後游標如果不在被點的那段文字裡（瀏覽器定位算錯），強制把游標放到那段文字最後面
  stage.addEventListener('click', ev => {
    const hit = ev.target.closest('[contenteditable="true"]');
    if (!hit) return;
    const sel = window.getSelection();
    const inHit = sel && sel.anchorNode && hit.contains(sel.anchorNode);
    if (document.activeElement === hit && inHit) return;
    hit.focus();
    const range = document.createRange();
    range.selectNodeContents(hit);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const tg = targets.find(x => x.el === hit);
    if (tg) select(tg);
  });
  const reapply = tg => {
    // 重畫這一段：先清掉樣式再套目前的調整
    const els = tg.twin ? [tg.el, tg.twin] : [tg.el];
    els.forEach(el => { ['fontSize', 'color', 'marginLeft', 'marginTop', 'left', 'top'].forEach(p => { el.style[p] = ''; }); delete el.dataset.fixedFs; });
    pgApplyOneEdit(tg, edits[tg.key]);
    pgLayoutSteps(stage);
    pgPlaceMascot(stage);
    placeHandle();
  };
  const curFs = tg => parseFloat(getComputedStyle(tg.spans ? (tg.el.querySelector('span') || tg.el) : tg.el).fontSize) || 32;
  ov.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-ed]');
    if (!btn) return;
    const act = btn.dataset.ed;
    const tg = pgEditor.current;
    if (act === 'done') { pgCloseTextEditor(true); return; }
    if (act === 'resetAll') {
      if (!confirm('這道食譜的文字調整全部清掉、回到原本？')) return;
      Object.keys(edits).forEach(k => delete edits[k]);
      pgSaveEdits(edits);
      pgCloseTextEditor(false);
      pgOpenTextEditor();
      return;
    }
    if (!tg) { ov.querySelector('#pgEdTarget').textContent = '先點一下圖上要調整的文字'; return; }
    if (act === 'smaller' || act === 'bigger') {
      const e = edits[tg.key] || {};
      e.fs = Math.max(12, Math.min(200, Math.round(curFs(tg) + (act === 'bigger' ? 2 : -2))));
      edits[tg.key] = e;
      pgSaveEdits(edits);
      reapply(tg);
    } else if (act === 'reset') {
      delete edits[tg.key];
      pgSaveEdits(edits);
      pgCloseTextEditor(false);
      pgOpenTextEditor();
    }
  });
  // 選色框：Enter 不打開選色器；選完顏色游標回到正在編輯的文字
  ov.querySelector('#pgEdColor').addEventListener('keydown', ev => { if (ev.key === 'Enter') ev.preventDefault(); });
  ov.querySelector('#pgEdColor').addEventListener('change', () => { if (pgEditor && pgEditor.current) pgEditor.current.el.focus(); });
  ov.querySelector('#pgEdColor').addEventListener('input', ev => {
    const tg = pgEditor.current;
    if (!tg) return;
    const e = edits[tg.key] || {};
    e.color = ev.target.value;
    edits[tg.key] = e;
    pgSaveEdits(edits);
    reapply(tg);
  });
  // 拖曳把手：移動量除以縮放比例換回海報實際像素
  let drag = null;
  handle.addEventListener('pointerdown', ev => {
    const tg = pgEditor.current;
    if (!tg) return;
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const e = edits[tg.key] || {};
    drag = { x: ev.clientX, y: ev.clientY, dx: e.dx || 0, dy: e.dy || 0, tg };
  });
  handle.addEventListener('pointermove', ev => {
    if (!drag) return;
    const s = pgEditor.scale;
    const e = edits[drag.tg.key] || {};
    e.dx = Math.round(drag.dx + (ev.clientX - drag.x) / s);
    e.dy = Math.round(drag.dy + (ev.clientY - drag.y) / s);
    edits[drag.tg.key] = e;
    reapply(drag.tg);
  });
  const endDrag = () => { if (drag) { pgSaveEdits(edits); drag = null; } };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}
function pgCloseTextEditor(regenerate) {
  if (!pgEditor) return;
  window.removeEventListener('resize', pgEditor.fit);
  pgEditor.ov.remove();
  pgEditor = null;
  if (regenerate) pgGeneratePoster();
}

// 右下角大貓咪（10-12 雪莉選 A＋B）：縮到 300px，並跟著小提醒框上下移動——頭頂比框上緣高 40px，
// 框變矮時貓咪一起往下（身體超出海報底部的部分自然被裁掉），不再蓋住步驟圖。沒有小提醒就維持貼底。
function pgPlaceMascot(root) {
  const m = root.querySelector('.pgp-mascot');
  const tip = root.querySelector('.pgp-tip-bar');
  if (!m) return;
  m.style.width = '300px';
  if (tip) { m.style.top = (tip.offsetTop - 40) + 'px'; m.style.bottom = 'auto'; }
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
  await pgApplyColors(stage);
  pgApplyEdits(stage, pgGetEdits());
  pgNormalizeIngPhotos(stage);
  pgLayoutSteps(stage);
  pgPlaceMascot(stage);
  pgArcTitle(stage);

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

