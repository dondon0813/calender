const MEMO_SHEET_NAME = '備忘錄';
const URL_SHEET_NAME = '後台網址';
const SETTINGS_SHEET_NAME = '設定';
const DEFAULT_PASSWORD = '0000';

const BRAND_SHEET_NAME = '品牌';
const INGREDIENT_SHEET_NAME = '食材';
const INGREDIENT_DB_SHEET_NAME = '食材資料庫';
const PRODUCT_DB_SHEET_NAME = '成品資料庫';
const RECIPE_SHEET_NAME = '食譜';
const SCHOOL_LIST_SHEET_NAME = '開學清單';

const LEGACY_PASSWORD_PEPPER = 'dondon0813_uihwfie68sd6sd4s_abc123xyz'; // 舊制單輪雜湊用；此值已隨原始碼公開洩漏，僅保留用於驗證舊資料，新雜湊一律改用 getPepper_()
const HASH_ITERATIONS = 5000;
const STAFF_SALT_LENGTH = 16;
const STAFF_COL_NAME = 1;
const STAFF_COL_HASH = 2;
const STAFF_COL_SALT = 3;
const STAFF_COL_NEWPW = 4;

const STAFF_SHEET_NAME = '員工名單';
const TASKNAME_SHEET_NAME = '任務名稱';
const TASK_SHEET_PREFIX = '任務_';
const DEFAULT_TASK_NAMES = ['簽署合約書', '團購安排', '廠商選品', '顧客提問', '贈品寄送', '照片提供'];
const VENDOR_SHEET_NAME = '廠商名單';
const PR_STATUS_SHEET_NAME = '公關品狀態';

const PR_LOCATION_SHEET_NAME = '公關品位置清單';
const PR_ITEM_SHEET_NAME = '公關品清單';

const SESSION_SHEET_NAME = 'Sessions';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 天：配合手機加到主畫面當 App 用，不必每天重登（2026-08-05 由 12 小時延長）
const SESSION_CACHE_PREFIX_ = 'sess_'; // getSessionUser_ 的 ScriptCache key 前綴
const SESSION_CACHE_TTL_SEC_ = 300;    // 5 分鐘；遠短於 session 效期，過期判斷仍以存進快取的建立時間為準

const PNOTE_FOLDER_SHEET_NAME = '個人備忘錄資料夾';
const PNOTE_SHEET_NAME = '個人備忘錄內容';

const SPNOTE_FOLDER_SHEET_NAME = '共用備忘錄資料夾';
const SPNOTE_SHEET_NAME = '共用備忘錄內容';

const MY_TASKNAME_SHEET_NAME = '我的任務名稱';

const TODO_SHEET_NAME = '待辦事項';
const TODO_CATEGORY_SHEET_NAME = '待辦主選項';
const DEFAULT_TODO_CATEGORIES = ['粉絲許願', '粉絲提問', '團購合作'];
const TODO_BRAND_CATEGORY = '團購合作';

const SOCIAL_LINK_SHEET_NAME = '社群連結';
const SOCIAL_LINK_KEYS = ['iconIg', 'iconTiktok', 'iconFb', 'iconEmail', 'iconColor'];

// 【新】廠商／品牌資料庫（團購合作用，記錄廠商付款方式、品牌聯絡窗口等，跟食譜用的「品牌」分頁是不同東西）
const VENDOR_DB_SHEET_NAME = '團購廠商資料庫';
const BRAND_DB_SHEET_NAME = '團購品牌資料庫';

const EVENT_SHEET_ID = '18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk';
const EVENT_SHEET_NAME = '';

// 【新】開團帳務（第三份試算表，獨立於後台表）。
// 刻意分開放：帳務含業績與分潤，是最敏感的資料；分享後台表給誰都不會連帶洩漏這份。
// 573 筆歷史紀錄由「匯入開團帳務_一次性.gs」在 2026-07-29 匯入。
const ACCOUNTING_SHEET_ID = '1Ba9oFudDTqHP7qAjZPPqp8csrMfscUlXlPPUA9Qy7Ug';
const ACCOUNTING_SHEET_NAME = '開團紀錄';
// 欄位順序（1-based），跟試算表表頭一致；改欄位順序時這裡要同步
const ACCT_COL = {
  ID: 1, DATE: 2, BRAND_ID: 3, BRAND_SPLIT: 4, RAW_NAME: 5, CONT_FROM: 6, VENDOR_ID: 7,
  COMPANY: 8, SALES: 9, RATE: 10, COMMISSION: 11, RATE_NOTE: 12, TAX_ADDED: 13, FEE: 14,
  STATUS: 15, PAY_TO: 16, PAY_DATE: 17, INVOICE: 18, NOTE: 19, IMPORT_NOTE: 20,
  // 稽核：金額是錢，改了要留痕跡才查得出是誰在什麼時候動的
  UPDATED_BY: 21, UPDATED_AT: 22,
  // 【新】對帳狀態（W 欄）：跟上面的稽核欄無關，是給 acctRecon 權限用的工作清單欄位
  RECON: 23
};
const ACCT_STATUSES = ['未成團', '進行中', '待結算', '已請款', '已入帳'];
// 對帳狀態：空白＝對帳完成／不在流程中。雙流程於「待開發票」合流：
// 開團流程：待回填→待核對業績→（合流）
// 稿酬流程：審稿中→審稿完成(待發布)→已發布→（合流）
// 共用後段：待開發票→待確認發票→等待匯款→待對帳→''（完成）
// 陣列僅作白名單枚舉，不代表推進順序；「下一階段」推進對照表在前端 accounting.js。
const ACCT_RECON_STATUSES = ['待回填', '待核對業績', '審稿中', '審稿完成(待發布)', '已發布', '待開發票', '待確認發票', '等待匯款', '待對帳'];

// ===== 【新】公開端點快取（2026-07-31 建立）=====
// 背景：Google 寄信警告「同時執行作業」逼近 1000 上限。原因是三個公開頁（行事曆／食譜／開學清單）
// 每個訪客打開都會打 scope=calendar 與 scope=public，而 scope=public 一次要讀
// 品牌庫（兩次）＋食材＋成品＋食譜＋開學清單＋自訂區塊＋社群連結，每個請求都重讀一次試算表、
// 動輒好幾秒。開學季流量一上來，這些慢執行就會堆疊成並行數爆量。
//
// 對策：把回傳的 JSON 字串放進 CacheService。命中快取的請求完全不碰試算表、毫秒級回覆，
// 並行數自然掉下來。
//
// ⚠️ 失效的兩條路，缺一不可：
//  1. 後台的寫入型動作結束時主動清（見 doPost 的 finally）→ 用後台改的東西，客人立刻看得到。
//  2. TTL 到期自動失效 → **食材資料庫／成品／食譜／開學清單這幾張表是直接在試算表裡編輯的，
//     不經過 doPost，沒有任何程式抓得到那個動作**，只能靠 TTL 兜底。所以 TTL 不可以拉長：
//     它就是「雪莉直接改試算表之後，前台最久多久才會更新」的上限。
const PUBLIC_CACHE_TTL_SEC = 90;
const CACHE_KEY_CALENDAR = 'pub_calendar_v1';
const CACHE_KEY_PUBLIC = 'pub_public_v1';
const CACHE_KEY_BLOCKS = 'pub_blocks_v1';
const PUBLIC_CACHE_KEYS = [CACHE_KEY_CALENDAR, CACHE_KEY_PUBLIC, CACHE_KEY_BLOCKS];
// 世代標記：用來擋「讀試算表讀到一半，有人存檔清了快取」的競態，見 cachedJsonResult_。
// 它不在 PUBLIC_CACHE_KEYS 裡，所以清快取時不會把自己清掉。
const CACHE_KEY_EPOCH = 'pub_cache_epoch';
const CACHE_EPOCH_TTL_SEC = 21600; // CacheService 允許的最長 TTL（6 小時）
// CacheService 單筆上限 100KB，是**位元組**不是字元；中文一個字 3 bytes，
// 所以切片以 25000 字元為單位（最壞情況 75KB），不要改大。
const CACHE_CHUNK_CHARS = 25000;
const CACHE_MAX_CHUNKS = 40;

// 快取讀取：回傳原始 JSON 字串（不 parse，因為要直接吐出去）。任何一片不見就整份當作沒有——
// 拼半份資料出去比沒有快取更糟。
function cacheGetJson_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const count = Number(cache.get(key));
    if (!count || count < 1) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(key + '_' + i);
    const parts = cache.getAll(keys);
    let out = '';
    for (let i = 0; i < count; i++) {
      const piece = parts[key + '_' + i];
      if (piece == null) return null;
      out += piece;
    }
    return out;
  } catch (err) {
    return null; // 快取壞掉一律當作沒快取，不能影響正常回應
  }
}

// 切片邊界不可以切在「代理對」中間。站上到處是 emoji（🛒、自訂區塊標題…），
// 一個 emoji 在 JS 字串裡是兩個 code unit；從中間切開會留下兩個孤兒 code unit，
// 存進快取再拼回來就變成壞字，而且命中快取時是原字串直接吐出、不會被發現，
// 客人端 res.json() 直接爆掉，整個 TTL 都在送壞資料。所以切點落在高位代理後面就往前退一格。
function safeChunkEnd_(str, end) {
  if (end >= str.length) return str.length;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) return end - 1;
  return end;
}

function cachePutJson_(key, jsonStr) {
  try {
    const pieces = [];
    let pos = 0;
    while (pos < jsonStr.length) {
      let end = safeChunkEnd_(jsonStr, Math.min(pos + CACHE_CHUNK_CHARS, jsonStr.length));
      if (end <= pos) end = Math.min(pos + CACHE_CHUNK_CHARS, jsonStr.length); // 保險：不可能切出空片段
      pieces.push(jsonStr.substring(pos, end));
      pos = end;
      if (pieces.length > CACHE_MAX_CHUNKS) {
        // 資料長大到塞不進快取時要留下痕跡，否則快取安靜失效、並行數又爆回去卻查不到原因
        console.warn('公開端點 ' + key + ' 的資料超過快取上限（' + jsonStr.length + ' 字元），這次不快取');
        return;
      }
    }
    if (!pieces.length) return;
    const map = {};
    for (let i = 0; i < pieces.length; i++) map[key + '_' + i] = pieces[i];
    const cache = CacheService.getScriptCache();
    cache.putAll(map, PUBLIC_CACHE_TTL_SEC);
    // 索引鍵最後才寫：先有切片再有索引，讀的人就不會拿到指向空片段的索引。
    cache.put(key, String(pieces.length), PUBLIC_CACHE_TTL_SEC);
  } catch (err) { /* 快取寫入失敗不影響這次回應 */ }
}

function getCacheEpoch_() {
  try { return CacheService.getScriptCache().get(CACHE_KEY_EPOCH) || ''; }
  catch (err) { return ''; }
}

function invalidatePublicCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const keys = [];
    PUBLIC_CACHE_KEYS.forEach(function (key) {
      keys.push(key);
      for (let i = 0; i < CACHE_MAX_CHUNKS; i++) keys.push(key + '_' + i);
    });
    cache.removeAll(keys);
    // 換一個世代標記，讓「正在讀試算表」的請求知道自己手上那份已經過期，不要寫回快取
    cache.put(CACHE_KEY_EPOCH, Utilities.getUuid(), CACHE_EPOCH_TTL_SEC);
  } catch (err) { /* 清不掉最多就是撐到 TTL 過期，不算致命 */ }
}

// 走快取的公開回應：命中就直接吐字串，沒命中才真的去讀試算表。
function cachedJsonResult_(cacheKey, builder) {
  const cached = cacheGetJson_(cacheKey);
  if (cached) return jsonTextResult_(cached);
  const epochBefore = getCacheEpoch_();
  const jsonStr = JSON.stringify(builder());
  // scope=public 讀完整份試算表要好幾秒，這期間若有人在後台存檔（已經清過快取了），
  // 我們手上這份就是舊資料——這次照樣回給對方，但**不寫進快取**，
  // 否則舊資料會被釘住一整個 TTL，等於那次存檔白清了。
  if (getCacheEpoch_() === epochBefore) cachePutJson_(cacheKey, jsonStr);
  return jsonTextResult_(jsonStr);
}

// ===== 共用工具 =====

function getKeyValueSheet_(name, headerLabel) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(['key', headerLabel, '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMemoSheet_() {
  return getKeyValueSheet_(MEMO_SHEET_NAME, '備忘錄內容');
}

function getUrlSheet_() {
  return getKeyValueSheet_(URL_SHEET_NAME, '後台網址');
}

function sheetToMap_(sheet) {
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const val = data[i][1];
    if (key) map[String(key)] = val || '';
  }
  return map;
}

function upsertKeyValue_(sheet, key, value) {
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    sheet.appendRow([key, value, new Date()]);
  } else {
    sheet.getRange(rowIndex, 2).setValue(value);
    sheet.getRange(rowIndex, 3).setValue(new Date());
  }
}

function getSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.appendRow(['password', DEFAULT_PASSWORD]);
    sheet.setFrozenRows(0);
  }
  return sheet;
}

function getPassword_() {
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === 'password') {
      return String(data[i][1] || DEFAULT_PASSWORD);
    }
  }
  return DEFAULT_PASSWORD;
}

function sheetRowsAsObjects_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined ? row[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

function getMergedIngredientsAndProducts_() {
  const ingredientRows = sheetRowsAsObjects_(INGREDIENT_DB_SHEET_NAME).map(function (row) {
    return {
      '食材ID': row['食材ID'] || '',
      '食材名稱': row['食材名稱'] || '',
      '英文名稱': row['英文名稱'] || '',
      '食材類型': row['食材類型'] || '',
      '分類': row['分類'] || '',
      '類型': '食材',
      '品牌': row['品牌'] || '',
      '圖片網址': row['圖片網址'] || '',
      '保存期限': row['保存期限'] || '',
      '成分': row['成分'] || '',
      '產地': row['產地'] || '',
      '內容物規格': row['內容物規格'] || '',
      '簡短介紹': row['簡短介紹'] || '',
      '簡稱': row['簡稱'] || '',
      // 這個食材專屬的蝦皮連結；空白＝沿用該品牌在「團購品牌資料庫」填的連結（本專案通用慣例：空白=預設、有填=覆寫）
      '蝦皮連結': row['蝦皮連結'] || ''
    };
  });

  const productRows = sheetRowsAsObjects_(PRODUCT_DB_SHEET_NAME).map(function (row) {
    return {
      '食材ID': row['成品ID'] || '',
      '食材名稱': row['成品名稱'] || '',
      '英文名稱': '',
      '食材類型': '品牌',
      '分類': '',
      '類型': '成品',
      '品牌': row['品牌'] || '',
      '圖片網址': row['圖片網址'] || '',
      '保存期限': row['保存期限'] || '',
      '成分': row['成分'] || '',
      '產地': row['產地'] || '',
      '內容物規格': row['內容物規格'] || '',
      '簡短介紹': row['簡短介紹'] || '',
      '簡稱': row['簡稱'] || '',
      '相關食材ID': row['相關食材ID'] || '',
      '可作食材': String(row['可作食材'] || '').trim() === '是',
      // 同上：這個成品專屬的蝦皮連結，空白就沿用品牌層級的
      '蝦皮連結': row['蝦皮連結'] || ''
    };
  });

  return ingredientRows.concat(productRows);
}

// ===== 請求內記憶化（per-request memo cache）=====
// GAS 每個請求都是全新的執行環境，這個頂層 var 只在單次 doGet/doPost 執行期間存活，
// 拿來記住「這次請求已經讀過的整表資料」，同一請求內重複呼叫就不用再打一次試算表。
// ⚠️ 回傳的是同一個參照：消費端不可就地修改（mutate）拿到的物件/陣列，只能讀取或另外複製後再改。
var REQ_CACHE_ = {};
function memo_(key, producer) {
  if (!Object.prototype.hasOwnProperty.call(REQ_CACHE_, key)) {
    REQ_CACHE_[key] = producer();
  }
  return REQ_CACHE_[key];
}
function memoClear_(key) {
  delete REQ_CACHE_[key];
}

// ===== 登入 Session 管理 =====

function getSessionSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SESSION_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SESSION_SHEET_NAME);
    sheet.appendRow(['token', '姓名', '建立時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function createSession_(name) {
  const sheet = getSessionSheet_();
  const token = Utilities.getUuid();
  sheet.appendRow([token, name, new Date()]);
  // 清理過期 session 會刪列，要有鎖才安全；登入本身不搶鎖，所以搶不到就跳過，留給下次登入清。
  const lock = LockService.getScriptLock();
  if (lock.tryLock(1000)) {
    try { cleanupExpiredSessions_(sheet); } catch (cleanErr) { /* 清理失敗不影響登入 */ }
    finally { try { lock.releaseLock(); } catch (e2) {} }
  }
  return token;
}

function getSessionUser_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const cacheKey = SESSION_CACHE_PREFIX_ + token;
  const cached = cache.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    // 快取命中仍要照原本語意檢查 12 小時效期（用存進去的建立時間算，不是憑 TTL 命中就放行）
    if (Date.now() - parsed.t <= SESSION_DURATION_MS) {
      return parsed.n;
    }
    cache.remove(cacheKey); // 過期了，順手清掉，跳到下面走全表掃描（理論上也掃不到，因為清理過期 session 會刪列）
  }
  const sheet = getSessionSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(token)) {
      const created = data[i][2];
      if (created instanceof Date && (Date.now() - created.getTime()) > SESSION_DURATION_MS) {
        return null;
      }
      const name = String(data[i][1]);
      const createdMs = created instanceof Date ? created.getTime() : Date.now();
      cache.put(cacheKey, JSON.stringify({ n: name, t: createdMs }), SESSION_CACHE_TTL_SEC_);
      return name;
    }
  }
  return null;
}

function cleanupExpiredSessions_(sheet) {
  const cache = CacheService.getScriptCache();
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const created = data[i][2];
    if (created instanceof Date && (Date.now() - created.getTime()) > SESSION_DURATION_MS) {
      cache.remove(SESSION_CACHE_PREFIX_ + String(data[i][0])); // 失效點①：session 列被清掉時同步清快取
      sheet.deleteRow(i + 1);
    }
  }
}

// ===== 密碼雜湊工具 =====

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, STAFF_SALT_LENGTH);
}

// 舊制單輪雜湊：已由 hashPasswordV2_ / verifyPassword_ 取代，新程式碼不應再呼叫；保留供對照與緊急排錯用
function hashPassword_(password, salt) {
  return sha256Hex_(String(password) + String(salt) + LEGACY_PASSWORD_PEPPER);
}

// 讀取 Script Properties 的 PASSWORD_PEPPER；未設定時 fallback 回 LEGACY_PASSWORD_PEPPER，不 throw
function getPepper_() {
  const p = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  return p || LEGACY_PASSWORD_PEPPER;
}

// pepper 指紋（sha256 前 8 碼），寫進雜湊字串裡以便日後判斷這筆雜湊當初是用哪把 pepper 產生的
function pepperFp_(pepper) {
  return sha256Hex_(String(pepper)).substring(0, 8);
}

// 新制：多輪雜湊。h0 = sha256(pw+salt+pepper)，之後 iterations-1 輪 h = sha256(h+salt)
// 格式：'v2$' + iterations + '$' + pepperFp + '$' + hex
function hashPasswordV2_(password, salt, iterations, pepper) {
  let h = sha256Hex_(String(password) + String(salt) + String(pepper));
  for (let i = 1; i < iterations; i++) {
    h = sha256Hex_(h + String(salt));
  }
  return 'v2$' + iterations + '$' + pepperFp_(pepper) + '$' + h;
}

// 密碼比對：v2 格式依內嵌的 iterations/pepper 指紋重算比對（指紋對得上現行 pepper 或舊 pepper 都接受）；
// 非 v2（舊制）用單輪 sha256(pw+salt+LEGACY_PASSWORD_PEPPER) 比對
function verifyPassword_(password, salt, storedHash) {
  const stored = String(storedHash || '');
  if (stored.indexOf('v2$') === 0) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const fp = parts[2];
    if (!iterations || !fp) return false;
    let pepper;
    if (fp === pepperFp_(getPepper_())) {
      pepper = getPepper_();
    } else if (fp === pepperFp_(LEGACY_PASSWORD_PEPPER)) {
      pepper = LEGACY_PASSWORD_PEPPER;
    } else {
      return false;
    }
    return hashPasswordV2_(password, salt, iterations, pepper) === stored;
  }
  return sha256Hex_(String(password) + String(salt) + LEGACY_PASSWORD_PEPPER) === stored;
}

// 是否需要重新雜湊寫回：非 v2、或輪數不是目前設定、或 pepper 指紋不是目前設定 → true
function needsRehash_(storedHash) {
  const stored = String(storedHash || '');
  if (stored.indexOf('v2$') !== 0) return true;
  const parts = stored.split('$');
  if (parts.length !== 4) return true;
  const iterations = parseInt(parts[1], 10);
  const fp = parts[2];
  if (iterations !== HASH_ITERATIONS) return true;
  if (fp !== pepperFp_(getPepper_())) return true;
  return false;
}

// ===== 員工名單 =====

function getStaffSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STAFF_SHEET_NAME);
    sheet.appendRow(['姓名', '密碼雜湊', 'Salt', '新密碼(打這裡存檔後自動加密並清空)']);
    const salt1 = randomSalt_();
    const salt2 = randomSalt_();
    const pepper = getPepper_();
    sheet.appendRow(['雪莉', hashPasswordV2_(getPassword_(), salt1, HASH_ITERATIONS, pepper), salt1, '']);
    sheet.appendRow(['曾曾', hashPasswordV2_('0000', salt2, HASH_ITERATIONS, pepper), salt2, '']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getStaff_() {
  // 同一請求內多處會呼叫（doGet 組裝結果、getAllPermissions_/getAllRoles_ 逐員工查權限…），
  // 用 memo_ 記住這次請求已經讀過的員工名單，避免重複整表讀取。⚠️ 回傳共用參照，呼叫端不可 mutate。
  return memo_('staff', function () {
    const sheet = getStaffSheet_();
    const data = sheet.getDataRange().getValues();
    const staff = [];
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][STAFF_COL_NAME - 1] || '').trim();
      const hash = String(data[i][STAFF_COL_HASH - 1] || '').trim();
      const salt = String(data[i][STAFF_COL_SALT - 1] || '').trim();
      if (name) staff.push({ name: name, hash: hash, salt: salt });
    }
    return staff;
  });
}

// ===== 【新】管理員與員工權限 =====
const ADMIN_NAME = '雪莉';
const STAFF_PERM_SHEET_NAME = '員工權限';
const STAFF_ROLE_LABEL = '角色';

// 權限項目定義。**新增項目只要加在這裡**：試算表表頭、權限設定頁的開關都會自動長出來
// （getStaffPermSheet_ 會補欄、perm-list 會把 defs 一起吐給前端渲染）。
const PERM_DEFS = [
  { key: 'system',          label: '系統設定',     desc: '權限設定、社群連結等會動到系統的地方' },
  // label 沿用舊表既有的「圖片庫權限」欄名，改名會讓補欄邏輯多長一個孤兒欄位
  { key: 'imageLibrary',    label: '圖片庫權限',   desc: '會直接寫入 GitHub，改錯會影響前台' },
  { key: 'report',          label: '報表統計',     desc: '瀏覽量、點擊來源等統計報表' },
  { key: 'commission',      label: '分潤',         desc: '品牌資料庫的分潤%與分潤說明' },
  { key: 'revenue',         label: '業績',         desc: '開團紀錄的營業額／實收金額' },
  { key: 'brandVendorEdit', label: '品牌廠商編輯', desc: '關閉＝只能查看，不能新增或修改' },
  { key: 'calendarEdit',    label: '行事曆編輯',   desc: '關閉＝只能查看檔期，不能排團或改內容' },
  { key: 'acctRecon',       label: '帳務對帳',     desc: '對帳工作清單：可看未完成團的完整金額與分潤%，看不到歷史帳' }
];

// 角色預設值。選角色＝一次套上這組勾選，之後仍可針對個人單獨微調（微調結果存在該員工那一列）。
// ⚠️ 這裡只是「預設模板」，真正生效的是試算表每個人自己那一列的勾選值。
const ROLE_PRESETS = {
  '副管理員':    { system: false, imageLibrary: false, report: true,  commission: true,  revenue: true,  brandVendorEdit: true,  calendarEdit: true,  acctRecon: false },
  '經紀人/助理': { system: false, imageLibrary: false, report: false, commission: true,  revenue: false, brandVendorEdit: true,  calendarEdit: true,  acctRecon: true },
  '行銷人員':    { system: false, imageLibrary: false, report: true,  commission: false, revenue: false, brandVendorEdit: false, calendarEdit: true,  acctRecon: false },
  '美編/小編':   { system: false, imageLibrary: false, report: false, commission: false, revenue: false, brandVendorEdit: false, calendarEdit: false, acctRecon: false }
};
const ROLE_NAMES = Object.keys(ROLE_PRESETS);

function isAdmin_(name) {
  return String(name || '').trim() === ADMIN_NAME;
}

function getStaffPermSheet_() {
  // 補欄檢查本身要讀表頭＋可能寫入，同一請求內只需要做一次：memo 的是「已經補過欄的 sheet handle」，
  // 不是資料內容，所以快取 Sheet 物件參照本身沒有髒資料風險。
  return memo_('staffPermSheet', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(STAFF_PERM_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(STAFF_PERM_SHEET_NAME);
      sheet.appendRow(['姓名', STAFF_ROLE_LABEL].concat(PERM_DEFS.map(p => p.label)));
      sheet.setFrozenRows(1);
      return sheet;
    }
    // 舊表只有「姓名｜圖片庫權限」，這裡把缺的欄補上去（含角色欄），不動既有欄位順序
    const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => String(h).trim());
    [STAFF_ROLE_LABEL].concat(PERM_DEFS.map(p => p.label)).forEach(label => {
      if (header.indexOf(label) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(label);
        header.push(label);
      }
    });
    return sheet;
  });
}

// 【N+1 去除】原本 getStaffRole_ / getPermissionsFor_ 各自對每個人重讀一次「員工權限」整表。
// 改成這裡一次整表讀完（header + 姓名→列 的對照表），同一請求內重複呼叫都吃這份快取；
// getAllPermissions_ 因此從「每位員工各一次表格讀取」變成「全表只讀一次＋記憶體裡組資料」。
// 寫入（setStaffRole_ / setPermission_）之後一定要 memoClear_('staffPermTable') 讓下一次讀取重新整表讀，
// 否則同一請求內「先寫後讀」（例：perm-set-role 寫完馬上回傳最新權限）會讀到寫入前的舊快取。
function getStaffPermTable_() {
  return memo_('staffPermTable', function () {
    const sheet = getStaffPermSheet_();
    const data = sheet.getDataRange().getValues();
    const header = (data[0] || []).map(h => String(h).trim());
    const byName = {};
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      if (name) byName[name] = data[i];
    }
    return { header: header, byName: byName };
  });
}

function permsFromStaffPermRow_(header, row) {
  const result = {};
  PERM_DEFS.forEach(p => {
    const colIdx = header.indexOf(p.label);
    const val = (!row || colIdx === -1) ? '' : String(row[colIdx] || '').trim();
    result[p.key] = val === '是';
  });
  return result;
}

function getStaffRole_(name) {
  const table = getStaffPermTable_();
  const colIdx = table.header.indexOf(STAFF_ROLE_LABEL);
  const row = table.byName[name];
  if (!row || colIdx === -1) return '';
  return String(row[colIdx] || '').trim();
}

// 寫入路徑（setStaffRole_ / setPermission_）仍用這個：需要真正的列號才能 sheet.getRange(row, ...).setValue()，
// 且寫入不是同一請求內會被重複呼叫 N 次的熱路徑，維持逐次即時讀取，不套用 getStaffPermTable_ 的記憶化。
function findStaffPermRow_(sheet, name) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === name) return i + 1;
  }
  return -1;
}

function getPermissionsFor_(name) {
  if (isAdmin_(name)) {
    const result = {};
    PERM_DEFS.forEach(p => { result[p.key] = true; });
    return result;
  }
  const table = getStaffPermTable_();
  return permsFromStaffPermRow_(table.header, table.byName[name]);
}

function getAllPermissions_() {
  const table = getStaffPermTable_();
  const map = {};
  getStaff_().forEach(s => {
    if (isAdmin_(s.name)) return;
    map[s.name] = permsFromStaffPermRow_(table.header, table.byName[s.name]);
  });
  return map;
}

function getAllRoles_() {
  const table = getStaffPermTable_();
  const roleIdx = table.header.indexOf(STAFF_ROLE_LABEL);
  const map = {};
  getStaff_().forEach(s => {
    if (isAdmin_(s.name)) return;
    const row = table.byName[s.name];
    map[s.name] = (!row || roleIdx === -1) ? '' : String(row[roleIdx] || '').trim();
  });
  return map;
}

// 套用角色＝把該角色的預設值「寫進」該員工那一列的每一格。
// 刻意不做「空白＝繼承角色」的隱含邏輯：試算表上看到什麼就是什麼，之後單獨微調也只是改那一格。
function setStaffRole_(name, role) {
  const preset = ROLE_PRESETS[role];
  if (!preset) throw new Error('未知的角色：' + role);
  const sheet = getStaffPermSheet_();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  let row = findStaffPermRow_(sheet, name);
  if (row === -1) {
    const newRow = new Array(header.length).fill('');
    newRow[0] = name;
    sheet.appendRow(newRow);
    row = sheet.getLastRow();
  }
  const roleIdx = header.indexOf(STAFF_ROLE_LABEL);
  if (roleIdx !== -1) sheet.getRange(row, roleIdx + 1).setValue(role);
  PERM_DEFS.forEach(p => {
    const colIdx = header.indexOf(p.label);
    if (colIdx === -1) return;
    sheet.getRange(row, colIdx + 1).setValue(preset[p.key] ? '是' : '否');
  });
  memoClear_('staffPermTable'); // 寫完要讓同一請求內接下來的 getPermissionsFor_/getStaffRole_ 讀到新值
  return true;
}

function setPermission_(name, key, value) {
  const def = PERM_DEFS.find(p => p.key === key);
  if (!def) throw new Error('未知的權限項目：' + key);
  const sheet = getStaffPermSheet_();
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const colIdx = header.indexOf(def.label);
  let row = findStaffPermRow_(sheet, name);
  if (row === -1) {
    const newRow = new Array(header.length).fill('');
    newRow[0] = name;
    sheet.appendRow(newRow);
    row = sheet.getLastRow();
  }
  sheet.getRange(row, colIdx + 1).setValue(value ? '是' : '否');
  memoClear_('staffPermTable'); // 同上：避免同一請求內後續讀到寫入前的舊快取
  return true;
}

function isPasswordValid_(pw) {
  if (typeof pw !== 'string') return false;
  if (pw.length < 6) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

function findStaffRowByName_(name) {
  const sheet = getStaffSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][STAFF_COL_NAME - 1] || '').trim() === name) return i + 1;
  }
  return -1;
}

function setStaffPassword_(name, newPlainPassword) {
  const sheet = getStaffSheet_();
  const row = findStaffRowByName_(name);
  if (row === -1) return false;
  const salt = randomSalt_();
  const hash = hashPasswordV2_(newPlainPassword, salt, HASH_ITERATIONS, getPepper_());
  sheet.getRange(row, STAFF_COL_HASH).setValue(hash);
  sheet.getRange(row, STAFF_COL_SALT).setValue(salt);
  return true;
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== STAFF_SHEET_NAME) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();
    if (row === 1) return;
    if (col !== STAFF_COL_NEWPW) return;

    const newValue = String(sheet.getRange(row, STAFF_COL_NEWPW).getValue() || '').trim();
    if (!newValue) return;

    const name = String(sheet.getRange(row, STAFF_COL_NAME).getValue() || '').trim();
    if (!name) return;

    const salt = randomSalt_();
    const hash = hashPasswordV2_(newValue, salt, HASH_ITERATIONS, getPepper_());
    sheet.getRange(row, STAFF_COL_HASH).setValue(hash);
    sheet.getRange(row, STAFF_COL_SALT).setValue(salt);
    sheet.getRange(row, STAFF_COL_NEWPW).setValue('');
  } catch (err) {
    // 安靜失敗
  }
}

function migrateStaffPasswordsToHash_ONETIME() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STAFF_SHEET_NAME);
  if (!sheet) {
    Logger.log('找不到「員工名單」分頁，不需要搬家');
    return;
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 1) {
    Logger.log('員工名單是空的，不需要搬家');
    return;
  }
  const header = data[0].map(function (h) { return String(h).trim(); });
  if (header[1] === '密碼雜湊') {
    Logger.log('看起來已經轉換過了（第二欄標題是「密碼雜湊」），不需要重複執行');
    return;
  }

  const newRows = [['姓名', '密碼雜湊', 'Salt', '新密碼(打這裡存檔後自動加密並清空)']];
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    const name = String(data[i][0] || '').trim();
    const plainPassword = String(data[i][1] || '').trim();
    if (!name) continue;
    const salt = randomSalt_();
    const hash = hashPasswordV2_(plainPassword, salt, HASH_ITERATIONS, getPepper_());
    newRows.push([name, hash, salt, '']);
    count++;
  }

  sheet.clearContents();
  sheet.getRange(1, 1, newRows.length, 4).setValues(newRows);
  sheet.setFrozenRows(1);
  Logger.log('搬家完成，共處理 ' + count + ' 位員工，明文密碼已從表格中移除');
}

// ===== 任務名稱清單 =====

function getTaskNameSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TASKNAME_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TASKNAME_SHEET_NAME);
    sheet.appendRow(['任務名稱']);
    DEFAULT_TASK_NAMES.forEach(n => sheet.appendRow([n]));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getTaskNames_() {
  const sheet = getTaskNameSheet_();
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    const n = String(data[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

function addTaskName_(name) {
  const sheet = getTaskNameSheet_();
  const existing = getTaskNames_();
  if (existing.indexOf(name) !== -1) return;
  sheet.appendRow([name]);
}

// ===== 員工自己的任務名稱 =====

function getMyTaskNameSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MY_TASKNAME_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MY_TASKNAME_SHEET_NAME);
    sheet.appendRow(['姓名', '任務名稱', '建立時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getMyTaskNamesFor_(name) {
  const sheet = getMyTaskNameSheet_();
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === name) {
      const n = String(data[i][1] || '').trim();
      if (n) names.push(n);
    }
  }
  return names;
}

function addMyTaskName_(name, taskName) {
  const sheet = getMyTaskNameSheet_();
  const existing = getMyTaskNamesFor_(name);
  if (existing.indexOf(taskName) !== -1) return;
  sheet.appendRow([name, taskName, new Date()]);
}

function deleteMyTaskName_(name, taskName) {
  const sheet = getMyTaskNameSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const rowName = String(data[i][0] || '').trim();
    const rowTaskName = String(data[i][1] || '').trim();
    if (rowName === name && rowTaskName === taskName) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ===== 【新】待辦事項：主選項清單 =====

function getTodoCategorySheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TODO_CATEGORY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TODO_CATEGORY_SHEET_NAME);
    sheet.appendRow(['主選項名稱']);
    DEFAULT_TODO_CATEGORIES.forEach(n => sheet.appendRow([n]));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getTodoCategories_() {
  const sheet = getTodoCategorySheet_();
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    const n = String(data[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

function addTodoCategory_(name) {
  const sheet = getTodoCategorySheet_();
  const existing = getTodoCategories_();
  if (existing.indexOf(name) !== -1) return;
  sheet.appendRow([name]);
}

// ===== 【新】待辦事項本體 =====

function getTodoSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TODO_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TODO_SHEET_NAME);
    sheet.appendRow(['id', '主選項', '標題', '內容', '品牌', '合作階段', '團購開始日期', '團購結束日期', '月份', '重要程度', '已加入行事曆', '建立人', '建立時間', '更新時間']);
    sheet.setFrozenRows(1);
  }
  try {
    sheet.getRange(2, 9, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  } catch (fmtErr) { /* 格式設定失敗不影響主要功能，安靜略過 */ }
  return sheet;
}

function getTodos_() {
  const sheet = getTodoSheet_();
  const data = sheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    items.push({
      id: String(row[0]),
      category: String(row[1] || ''),
      title: String(row[2] || ''),
      content: String(row[3] || ''),
      brand: String(row[4] || ''),
      stage: String(row[5] || ''),
      groupStart: row[6] instanceof Date ? Utilities.formatDate(row[6], 'Asia/Taipei', 'yyyy-MM-dd') : String(row[6] || ''),
      groupEnd: row[7] instanceof Date ? Utilities.formatDate(row[7], 'Asia/Taipei', 'yyyy-MM-dd') : String(row[7] || ''),
      month: row[8] instanceof Date ? Utilities.formatDate(row[8], 'Asia/Taipei', 'yyyy-MM') : String(row[8] || ''),
      priority: String(row[9] || ''),
      addedToCalendar: String(row[10] || '').trim() === '是',
      createdBy: String(row[11] || ''),
      created: row[12] instanceof Date ? fmtDateTime_(row[12]) : String(row[12] || ''),
      updated: row[13] instanceof Date ? fmtDateTime_(row[13]) : String(row[13] || '')
    });
  }
  return items;
}

function findTodoRowById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function addTodo_(fields, byName) {
  const sheet = getTodoSheet_();
  const id = 'D' + Date.now();
  const now = new Date();
  sheet.appendRow([
    id,
    fields.category || '',
    fields.title || '',
    fields.content || '',
    fields.brand || '',
    fields.stage || '',
    fields.groupStart || '',
    fields.groupEnd || '',
    fields.month || '',
    fields.priority || '',
    '否',
    byName || '',
    now,
    now
  ]);
  return id;
}

const TODO_COL = {
  ID: 1, CATEGORY: 2, TITLE: 3, CONTENT: 4, BRAND: 5, STAGE: 6, GROUP_START: 7, GROUP_END: 8,
  MONTH: 9, PRIORITY: 10, ADDED_TO_CALENDAR: 11, CREATED_BY: 12, CREATED: 13, UPDATED: 14
};

function updateTodo_(id, fields) {
  const sheet = getTodoSheet_();
  const row = findTodoRowById_(sheet, id);
  if (row === -1) return false;
  if (fields.category !== undefined) sheet.getRange(row, TODO_COL.CATEGORY).setValue(fields.category);
  if (fields.title !== undefined) sheet.getRange(row, TODO_COL.TITLE).setValue(fields.title);
  if (fields.content !== undefined) sheet.getRange(row, TODO_COL.CONTENT).setValue(fields.content);
  if (fields.brand !== undefined) sheet.getRange(row, TODO_COL.BRAND).setValue(fields.brand);
  if (fields.stage !== undefined) sheet.getRange(row, TODO_COL.STAGE).setValue(fields.stage);
  if (fields.groupStart !== undefined) sheet.getRange(row, TODO_COL.GROUP_START).setValue(fields.groupStart);
  if (fields.groupEnd !== undefined) sheet.getRange(row, TODO_COL.GROUP_END).setValue(fields.groupEnd);
  if (fields.month !== undefined) sheet.getRange(row, TODO_COL.MONTH).setValue(fields.month);
  if (fields.priority !== undefined) sheet.getRange(row, TODO_COL.PRIORITY).setValue(fields.priority);
  if (fields.addedToCalendar !== undefined) sheet.getRange(row, TODO_COL.ADDED_TO_CALENDAR).setValue(fields.addedToCalendar ? '是' : '否');
  sheet.getRange(row, TODO_COL.UPDATED).setValue(new Date());
  return true;
}

function deleteTodo_(id) {
  const sheet = getTodoSheet_();
  const row = findTodoRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// ===== 廠商名單 =====

function getVendorSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VENDOR_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(VENDOR_SHEET_NAME);
    sheet.appendRow(['廠商名稱']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getVendors_() {
  const sheet = getVendorSheet_();
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    const n = String(data[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

// ===== 【新】團購廠商資料庫／團購品牌資料庫 =====
function getVendorDbSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VENDOR_DB_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(VENDOR_DB_SHEET_NAME);
    // J 公司名稱：開發票／匯款用的正式抬頭，跟廠商簡稱常常不一樣；一家廠商可能有多個（逗號分隔）
    // K/L/M 合作狀態：跟品牌資料庫同一套語意。廠商結束 ≠ 底下品牌全結束，兩層各自標記
    // N 封存：資料留著但平常不顯示。給「只合作過一兩次、之後可能用得到」的廠商用，
    // 跟「已結束合作」語意不同——那是談過但結束了，封存是還沒到需要放在檯面上的程度。
    sheet.appendRow(['id', '廠商名稱', '廠商類型', '匯款方式', '請款規則', '廠商聯絡窗口', '廠商備註', '建立時間', '更新時間', '公司名稱', '長期合作', '已結束合作', '結束原因', '封存']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getBrandDbSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BRAND_DB_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(BRAND_DB_SHEET_NAME);
    // 所屬廠商ID 可填多個，用逗號分隔（例：V001,V004）——同品牌跟不同廠商開不同聯名款
    // O「分潤%」存純數字（10 = 10%）供排序／統計；P「分潤說明」存自由文字（例：滿萬 12%、首團不抽）
    // Q/R/S 合作狀態三欄：長期合作＝主力品牌；兩欄都空＝一般合作；已結束＝曾經合作過但現在沒了
    // （「曾經是長期合作、後來結束」是兩欄都填「是」，這樣歷史也留得住）
    sheet.appendRow(['id', '所屬廠商ID', '品牌名稱', '去背小圖', 'LINE窗口', 'Email窗口', 'IG窗口', '品牌備註', '建立時間', '更新時間', '顯示於食材食譜', '品牌介紹', '品牌圖片', '蝦皮連結', '分潤%', '分潤說明', '長期合作', '已結束合作', '結束原因', '貼文文案模板']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getNextDbId_(sheet, prefix) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    const m = new RegExp('^' + prefix + '(\\d+)$').exec(id);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(3, '0');
}

function findDbRowById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function getVendorDbList_() {
  const sheet = getVendorDbSheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    list.push({
      id: String(row[0]),
      name: String(row[1] || ''),
      type: String(row[2] || ''),
      remittanceMethod: String(row[3] || ''),
      remittanceRule: String(row[4] || ''),
      contact: String(row[5] || ''),
      note: String(row[6] || ''),
      created: row[7] instanceof Date ? fmtDateTime_(row[7]) : String(row[7] || ''),
      updated: row[8] instanceof Date ? fmtDateTime_(row[8]) : String(row[8] || ''),
      companyNames: String(row[9] || ''),   // 開票抬頭，可多個
      longTerm: String(row[10] || '').trim() === '是',
      ended: String(row[11] || '').trim() === '是',
      endReason: String(row[12] || ''),
      archived: String(row[13] || '').trim() === '是'
    });
  }
  return list;
}

function addVendorDb_(fields) {
  const sheet = getVendorDbSheet_();
  const id = getNextDbId_(sheet, 'V');
  const now = new Date();
  sheet.appendRow([
    id,
    fields.name || '',
    fields.type || '',
    fields.remittanceMethod || '',
    fields.remittanceRule || '',
    fields.contact || '',
    fields.note || '',
    now, now,
    fields.companyNames || '',
    fields.longTerm || '',
    fields.ended || '',
    fields.endReason || '',
    fields.archived || ''
  ]);
  return id;
}

function updateVendorDb_(id, fields) {
  const sheet = getVendorDbSheet_();
  const row = findDbRowById_(sheet, id);
  if (row === -1) return false;
  const setIf = (col, val) => { if (val !== undefined) sheet.getRange(row, col).setValue(val); };
  setIf(2, fields.name);
  setIf(3, fields.type);
  setIf(4, fields.remittanceMethod);
  setIf(5, fields.remittanceRule);
  setIf(6, fields.contact);
  setIf(7, fields.note);
  setIf(10, fields.companyNames);
  setIf(11, fields.longTerm);
  setIf(12, fields.ended);
  setIf(13, fields.endReason);
  setIf(14, fields.archived);
  sheet.getRange(row, 9).setValue(new Date());
  return true;
}

function deleteVendorDb_(id) {
  const sheet = getVendorDbSheet_();
  const row = findDbRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// 「V001,V004」→ ['V001','V004']；空字串→[]
function splitIds_(val) {
  return String(val || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

// 分潤% 一律收斂成純數字（10 = 10%）。使用者可能打成「10%」或「 10 」，這裡先洗乾淨；
// 洗不出數字（空白、「另議」之類的文字）就回 ''，那種內容應該寫在「分潤說明」欄。
function normCommissionRate_(val) {
  if (val === '' || val === null || val === undefined) return '';
  const n = parseFloat(String(val).replace(/[%％\s,]/g, ''));
  return isNaN(n) ? '' : n;
}

function getBrandDbList_() {
  // buildPublicResult_ 同一請求內呼叫兩次＋getBrandDbListFor_ 再呼叫一次，用 memo_ 併成一次整表讀取。
  // ⚠️ 回傳共用參照：stripCommission_ 等消費端一律回傳複本，不可就地刪改這裡的物件。
  return memo_('brandDbList', function () {
    const sheet = getBrandDbSheet_();
    const data = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue;
      list.push({
        id: String(row[0]),
        vendorIds: splitIds_(row[1]),
        name: String(row[2] || ''),
        thumbUrl: String(row[3] || ''),   // 去背小圖（品牌預設，行事曆該檔可覆寫）
        lineContact: String(row[4] || ''),
        emailContact: String(row[5] || ''),
        igContact: String(row[6] || ''),
        note: String(row[7] || ''),
        created: row[8] instanceof Date ? fmtDateTime_(row[8]) : String(row[8] || ''),
        updated: row[9] instanceof Date ? fmtDateTime_(row[9]) : String(row[9] || ''),
        showInRecipe: String(row[10] || '').trim() === '是',
        intro: String(row[11] || ''),
        brandImageUrl: String(row[12] || ''),  // 品牌圖片（大合照／介紹頁用）
        shopeeUrl: String(row[13] || ''),  // 蝦皮連結（沒開團時前台食材/食譜頁導流用；空白＝不顯示按鈕）
        // 分潤：數字欄拿來排序／統計，說明欄放特殊條件；兩者都可留空。⚠️ 內部欄位，禁止進 scope=public
        commissionRate: normCommissionRate_(row[14]),
        commissionNote: String(row[15] || ''),
        // 合作狀態：兩個旗標都是 false ＝ 一般合作
        longTerm: String(row[16] || '').trim() === '是',
        ended: String(row[17] || '').trim() === '是',
        endReason: String(row[18] || ''),
        // 開團貼文文案模板（{網址}/{開團日}/{結團日}/{團名} 佔位）。⚠️ 內部欄位，禁止進 scope=public
        postTemplate: String(row[19] || '')
      });
    }
    return list;
  });
}

// ⚠️ 分潤是商業機密：沒有 commission 權限的人，後端**直接不回傳這兩個欄位**，
// 而不是靠前端隱藏（前端藏起來按 F12 就看得到，等於沒鎖）。
function stripCommission_(list) {
  return list.map(b => {
    const copy = {};
    Object.keys(b).forEach(k => {
      if (k === 'commissionRate' || k === 'commissionNote') return;
      copy[k] = b[k];
    });
    return copy;
  });
}

function getBrandDbListFor_(user) {
  const list = getBrandDbList_();
  if (isAdmin_(user)) return list;
  return getPermissionsFor_(user).commission ? list : stripCommission_(list);
}

// ===== 【新】開團帳務 =====

function getAccountingSheet_() {
  const ss = SpreadsheetApp.openById(ACCOUNTING_SHEET_ID);
  const sheet = ss.getSheetByName(ACCOUNTING_SHEET_NAME);
  if (!sheet) throw new Error('開團帳務試算表裡找不到「' + ACCOUNTING_SHEET_NAME + '」分頁');
  return sheet;
}

// 試算表的日期欄可能是 Date 物件也可能是字串，一律轉成 yyyy-MM-dd
function acctDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  return String(v || '').trim();
}

function getAccountingList_() {
  const sheet = getAccountingSheet_();
  const data = sheet.getDataRange().getValues();
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0]) continue;
    list.push({
      id: String(r[0]),
      date: acctDate_(r[1]),
      brandId: String(r[2] || ''),
      brandSplit: String(r[3] || ''),   // 聯團時手填的分攤，格式 B043:200000,B057:138150
      rawName: String(r[4] || ''),
      contFrom: String(r[5] || ''),     // 有值＝這是同一團重開表單的延續，統計開團數時不另計
      vendorId: String(r[6] || ''),
      company: String(r[7] || ''),
      sales: r[8] === '' ? '' : Number(r[8]),
      rate: r[9] === '' ? '' : Number(r[9]),
      commission: r[10] === '' ? '' : Number(r[10]),
      rateNote: String(r[11] || ''),
      taxAdded: String(r[12] || '').trim() === '是',
      fee: r[13] === '' ? '' : Number(r[13]),
      status: String(r[14] || ''),
      payTo: String(r[15] || ''),
      payDate: acctDate_(r[16]),
      invoice: String(r[17] || ''),
      note: String(r[18] || ''),
      importNote: String(r[19] || ''),
      updatedBy: String(r[20] || ''),
      updatedAt: r[21] instanceof Date ? fmtDateTime_(r[21]) : String(r[21] || ''),
      reconStatus: String(r[22] || '').trim()
    });
  }
  return list;
}

// ⚠️ 欄位級的權限遮蔽。業績與分潤的界線是「金額 vs 成數」，不是「銷售 vs 分潤」：
//   commission（分潤）＝ 只有成數：分潤%、分潤說明
//   revenue（業績）  ＝ 所有實際金額：銷售金額、分潤金額、稿酬、品牌金額分攤
// 經紀人/助理拿得到成數（才能幫忙算分潤），但看不到任何實際金額。
// 備註欄也歸業績：裡面有 118 筆寫著「總16800」「健保:635」這類金額，不遮就等於白鎖。
// 沒權限的欄位「整個 key 不回傳」，不是設成 0——前端藏起來按 F12 就看得到，等於沒鎖。
const ACCT_REVENUE_FIELDS = ['sales', 'commission', 'fee', 'brandSplit', 'note'];
const ACCT_COMMISSION_FIELDS = ['rate', 'rateNote'];

function stripAccounting_(list, canRevenue, canCommission) {
  if (canRevenue && canCommission) return list;
  return list.map(r => {
    const o = {};
    Object.keys(r).forEach(k => {
      if (!canRevenue && ACCT_REVENUE_FIELDS.indexOf(k) !== -1) return;
      if (!canCommission && ACCT_COMMISSION_FIELDS.indexOf(k) !== -1) return;
      o[k] = r[k];
    });
    return o;
  });
}

// 【新】acctRecon（帳務對帳）權限：只給「對帳未完成」（reconStatus 非空白）的列，
// 但那些列給完整金額與分潤%——因為要幫忙回填業績、跟會計核對，看不到成數/金額沒辦法做事。
// 沒有 revenue/commission 又沒有 acctRecon 的人，doPost 的閘門就擋掉了，不會進來這裡。
function getAccountingListFor_(user) {
  const list = getAccountingList_();
  if (isAdmin_(user)) return list;
  const p = getPermissionsFor_(user);
  const canRev = !!p.revenue;
  const canCom = !!p.commission;
  const canRecon = !!p.acctRecon;
  if (!canRev && !canCom && !canRecon) return []; // 理論上到不了這裡（doPost 閘門已擋），保險起見還是回空陣列
  // 列可見性：業績或分潤權限看得到全部列；只有 acctRecon 的人只看得到「對帳未完成」的列
  const visible = (canRev || canCom) ? list : list.filter(item => item.reconStatus !== '');
  // 欄位遮蔽改成逐列判斷：業績+分潤兩者都有才整列完全不遮（跟 stripAccounting_ 的短路邏輯一致），
  // 或者這人有 acctRecon 而且這列還沒對帳完成——對帳中的列要靠金額與分潤%回填業績、跟會計核對，
  // 遮起來沒辦法做事。已對帳完成的歷史列，沒有業績/分潤權限的人一律照 stripAccounting_ 原規則遮蔽。
  return visible.map(item => {
    const full = (canRev && canCom) || (canRecon && item.reconStatus !== '');
    return full ? item : stripAccounting_([item], canRev, canCom)[0];
  });
}

function findAcctRowById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function nextAcctId_(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const m = /^R(\d+)$/.exec(String(data[i][0] || ''));
    if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; }
  }
  return 'R' + String(max + 1).padStart(4, '0');
}

function acctRowFrom_(fields, id) {
  const row = new Array(23).fill('');
  row[0] = id;
  row[1] = fields.date || '';
  row[2] = fields.brandId || '';
  row[3] = fields.brandSplit || '';
  row[4] = fields.rawName || '';
  row[5] = fields.contFrom || '';
  row[6] = fields.vendorId || '';
  row[7] = fields.company || '';
  row[8] = fields.sales === undefined || fields.sales === '' ? '' : Number(fields.sales);
  row[9] = fields.rate === undefined || fields.rate === '' ? '' : Number(fields.rate);
  row[10] = fields.commission === undefined || fields.commission === '' ? '' : Number(fields.commission);
  row[11] = fields.rateNote || '';
  row[12] = fields.taxAdded ? '是' : '';
  row[13] = fields.fee === undefined || fields.fee === '' ? '' : Number(fields.fee);
  row[14] = fields.status || '';
  row[15] = fields.payTo || '';
  row[16] = fields.payDate || '';
  row[17] = fields.invoice || '';
  row[18] = fields.note || '';
  row[19] = fields.importNote || '';
  row[20] = fields.updatedBy || '';
  row[21] = fields.updatedAt || '';
  // 對帳狀態：值必須是空白或 ACCT_RECON_STATUSES 之一，非法值一律當空白（不擋整筆新增）。
  // 新增時若沒送 reconStatus，預設「待回填」——新開的團一律要走一次對帳流程。
  {
    const rs = fields.reconStatus === undefined ? '待回填' : fields.reconStatus;
    row[22] = (rs === '' || ACCT_RECON_STATUSES.indexOf(rs) !== -1) ? rs : '';
  }
  return row;
}

function addAccounting_(fields, user) {
  const sheet = getAccountingSheet_();
  const id = nextAcctId_(sheet);
  fields.updatedBy = user || '';
  fields.updatedAt = new Date();
  sheet.appendRow(acctRowFrom_(fields, id));
  return id;
}

// 只更新有送來的欄位；沒權限的欄位在 doPost 就已經被擋掉，不會進到 fields
function updateAccounting_(id, fields, user) {
  const sheet = getAccountingSheet_();
  const row = findAcctRowById_(sheet, id);
  if (row === -1) return false;
  const set = (col, val) => { if (val !== undefined) sheet.getRange(row, col).setValue(val); };
  // 金額欄一定要轉成數字再寫。前端送字串 "50000" 的話，儲存格會變成文字格式，
  // 試算表上的 SUM／樞紐分析會安靜地漏算這幾列，帳就對不起來了。
  const setNum = (col, val) => {
    if (val === undefined) return;
    if (val === '' || val === null) { sheet.getRange(row, col).setValue(''); return; }
    const n = Number(val);
    if (isNaN(n)) throw new Error('金額欄位只能填數字，收到：' + val);
    sheet.getRange(row, col).setValue(n);
  };
  set(ACCT_COL.DATE, fields.date);
  set(ACCT_COL.BRAND_ID, fields.brandId);
  set(ACCT_COL.BRAND_SPLIT, fields.brandSplit);
  set(ACCT_COL.RAW_NAME, fields.rawName);
  set(ACCT_COL.CONT_FROM, fields.contFrom);
  set(ACCT_COL.VENDOR_ID, fields.vendorId);
  set(ACCT_COL.COMPANY, fields.company);
  setNum(ACCT_COL.SALES, fields.sales);
  setNum(ACCT_COL.RATE, fields.rate);
  setNum(ACCT_COL.COMMISSION, fields.commission);
  set(ACCT_COL.RATE_NOTE, fields.rateNote);
  if (fields.taxAdded !== undefined) sheet.getRange(row, ACCT_COL.TAX_ADDED).setValue(fields.taxAdded ? '是' : '');
  setNum(ACCT_COL.FEE, fields.fee);
  set(ACCT_COL.STATUS, fields.status);
  set(ACCT_COL.PAY_TO, fields.payTo);
  set(ACCT_COL.PAY_DATE, fields.payDate);
  set(ACCT_COL.INVOICE, fields.invoice);
  set(ACCT_COL.NOTE, fields.note);
  set(ACCT_COL.RECON, fields.reconStatus); // 純文字欄，不走 setNum；值的合法性在 doPost 分支已驗證過
  sheet.getRange(row, ACCT_COL.UPDATED_BY).setValue(user || '');
  sheet.getRange(row, ACCT_COL.UPDATED_AT).setValue(new Date());
  return true;
}

function deleteAccounting_(id) {
  const sheet = getAccountingSheet_();
  const row = findAcctRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

function addBrandDb_(fields) {
  const sheet = getBrandDbSheet_();
  const id = getNextDbId_(sheet, 'B');
  const now = new Date();
  sheet.appendRow([
    id,
    (fields.vendorIds || []).join(','),
    fields.name || '',
    fields.thumbUrl || '',
    fields.lineContact || '',
    fields.emailContact || '',
    fields.igContact || '',
    fields.note || '',
    now, now,
    fields.showInRecipe || '',
    fields.intro || '',
    fields.brandImageUrl || '',
    fields.shopeeUrl || '',
    normCommissionRate_(fields.commissionRate),
    fields.commissionNote || '',
    fields.longTerm || '',
    fields.ended || '',
    fields.endReason || '',
    fields.postTemplate || ''
  ]);
  return id;
}

function updateBrandDb_(id, fields) {
  const sheet = getBrandDbSheet_();
  const row = findDbRowById_(sheet, id);
  if (row === -1) return false;
  const setIf = (col, val) => { if (val !== undefined) sheet.getRange(row, col).setValue(val); };
  if (fields.vendorIds !== undefined) sheet.getRange(row, 2).setValue(fields.vendorIds.join(','));
  setIf(3, fields.name);
  setIf(4, fields.thumbUrl);
  setIf(5, fields.lineContact);
  setIf(6, fields.emailContact);
  setIf(7, fields.igContact);
  setIf(8, fields.note);
  setIf(11, fields.showInRecipe);
  setIf(12, fields.intro);
  setIf(13, fields.brandImageUrl);
  setIf(14, fields.shopeeUrl);
  if (fields.commissionRate !== undefined) sheet.getRange(row, 15).setValue(normCommissionRate_(fields.commissionRate));
  setIf(16, fields.commissionNote);
  setIf(17, fields.longTerm);
  setIf(18, fields.ended);
  setIf(19, fields.endReason);
  setIf(20, fields.postTemplate);
  sheet.getRange(row, 10).setValue(new Date());
  return true;
}

function deleteBrandDb_(id) {
  const sheet = getBrandDbSheet_();
  const row = findDbRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// ===== 一次性：把行事曆現有合作品牌匯入「團購品牌資料庫」=====
// 在 Apps Script 編輯器選這個函式按執行即可。以「品牌名稱」比對，已存在就跳過，
// 所以重跑不會產生重複列。執行後看「執行紀錄」會列出新增/略過的品牌。
var BRAND_IMPORT_LIST_ = [
  { name: '年年姓名貼' },
  { name: 'Scoot&Ride' },
  { name: 'Silipot' },
  { name: 'Yookidoo' },
  { name: 'trixie', note: '常與 Yookidoo 合團' },
  { name: 'Mongdies' },
  { name: '雪坊優格' },
  { name: 'Stokke' },
  { name: 'Aspor' },
  { name: 'Pato Pato' },
  // 品牌名一律用「客人看得懂」的寫法（跟開學清單品牌推薦欄一致），不用原廠品牌名
  { name: 'B21pro', note: '標籤機（原廠品牌：精臣）。同時對應兩家廠商（不同 IP 聯名款），請到後台把兩家都勾起來' },
  { name: 'Kigo' },
  { name: 'Yaber' },
  { name: 'Aribebe' },
  { name: '永圻魚湯' },
  { name: 'Poled' },
  { name: 'Kidmory' },
  { name: 'KOM' },
  { name: '林貝兒' },
  { name: '伯尼寢具' },
  { name: 'Kolin' },
  { name: '卡蘿琳', note: '益生菌與軟糖／Q凍分開兩檔開團' },
  { name: '寶可樂收袋', note: '原廠品牌：HARU' },
  { name: 'Learning Resources' },
  { name: 'ifind' },
  { name: 'Picaboo' },
  { name: '兔比媽咪' },
  { name: 'recolte麗克特' },
  { name: '齒妍堂' },
  { name: '台東初鹿' },
  { name: 'LMG' },
  { name: 'Wewee!' },
  { name: 'MOMAX', vendorNames: ['樂奎'], note: '防偷拍定位器' },
  { name: '台灣好車隊' },
  { name: '森森星球' },
  { name: '安可堡泡泡' },
  { name: 'Lapo' },
  { name: '韓爸米餅' },
  { name: 'Horay' },
  { name: 'Jolly' },
  { name: 'Bonsons' },
  { name: 'Bruno' },
  { name: '美姬饅頭' },
  { name: '禾流文創' },
  { name: '森林麵食' },
  { name: '愛子伴桌' },
  { name: '島嶼生吐司' },
  { name: 'Mideer' },
  { name: '2angels' },
  { name: 'Parakito' },
  { name: '愛兒館' },
  { name: '媽媽友' },
  { name: 'LeapFrog' },
  { name: '童蒔樂' },
  { name: 'UBMOM' },
  { name: 'Nadle' },
  { name: '冊子' },
  { name: '賽爸爸' }
];

function importBrandsFromCalendar() {
  var existing = {};
  getBrandDbList_().forEach(function (b) { existing[b.name.trim()] = b.id; });

  var vendorByName = {};
  getVendorDbList_().forEach(function (v) { vendorByName[v.name.trim()] = v.id; });

  var added = [], skipped = [], noVendor = [];
  BRAND_IMPORT_LIST_.forEach(function (item) {
    var name = item.name.trim();
    if (existing[name]) { skipped.push(name); return; }

    var vendorIds = [];
    (item.vendorNames || []).forEach(function (vn) {
      var vid = vendorByName[vn.trim()];
      if (vid) vendorIds.push(vid);
      else noVendor.push(name + ' → ' + vn);
    });

    var id = addBrandDb_({
      vendorIds: vendorIds,
      name: name,
      note: item.note || '',
      showInRecipe: '',   // 預設不顯示在食材／食譜頁，要公開再自己勾
      intro: '',
      thumbUrl: '',
      brandImageUrl: ''
    });
    existing[name] = id;
    added.push(name);
  });

  Logger.log('新增 ' + added.length + ' 個品牌：' + added.join('、'));
  Logger.log('已存在略過 ' + skipped.length + ' 個：' + skipped.join('、'));
  if (noVendor.length) Logger.log('⚠ 找不到廠商，所屬廠商留空：' + noVendor.join('、'));
  return { added: added, skipped: skipped, noVendor: noVendor };
}

// ===== 品牌去背小圖：把 GitHub 上的圖片網址寫進「團購品牌資料庫」的「去背小圖」欄 =====
// 圖片放在 repo 的 images/brands/，push 之後執行 updateBrandThumbs() 即可，不必手動貼網址。
// 要加新品牌圖片：把圖片放進 images/brands/、在下面這張表加一行、重新部署後再跑一次。
var BRAND_THUMB_BASE_ = 'https://dondon0813.github.io/calender/images/brands/';
var BRAND_THUMB_MAP_ = {
  '寶可樂收袋': 'haru-bag.webp',
  'UBMOM': 'ubmom.webp',
  'Wewee!': 'wewee.webp',
  'Picaboo': 'picaboo.webp',
  'Aribebe': 'aribebe.webp',
  '伯尼寢具': 'bernie.webp',
  'KOM': 'kom.webp',
  '齒妍堂': 'lab52.webp'
};

function updateBrandThumbs() {
  var brands = getBrandDbList_();
  var byName = {};
  brands.forEach(function (b) { byName[b.name.trim()] = b; });

  var updated = [], missing = [], unchanged = [];
  Object.keys(BRAND_THUMB_MAP_).forEach(function (name) {
    var brand = byName[name];
    if (!brand) { missing.push(name); return; }
    var url = BRAND_THUMB_BASE_ + BRAND_THUMB_MAP_[name];
    if (brand.thumbUrl === url) { unchanged.push(name); return; }
    updateBrandDb_(brand.id, { thumbUrl: url });
    updated.push(name);
  });

  Logger.log('已更新 ' + updated.length + ' 個品牌的去背小圖：' + updated.join('、'));
  if (unchanged.length) Logger.log('網址相同、略過 ' + unchanged.length + ' 個：' + unchanged.join('、'));
  if (missing.length) Logger.log('⚠ 品牌資料庫裡找不到這些品牌，請先執行 importBrandsFromCalendar()：' + missing.join('、'));
  return { updated: updated, unchanged: unchanged, missing: missing };
}

function findBrandDbByExactName_(name) {
  const target = String(name || '').trim();
  if (!target) return null;
  const brand = getBrandDbList_().find(b => b.name.trim() === target);
  if (!brand) return null;
  const all = getVendorDbList_();
  const vendors = brand.vendorIds.map(function (vid) {
    return all.find(function (v) { return v.id === vid; });
  }).filter(Boolean);
  return { brand: brand, vendors: vendors };
}

// ===== 【新】公關品位置清單 =====

function getPrLocationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PR_LOCATION_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PR_LOCATION_SHEET_NAME);
    sheet.appendRow(['位置名稱']);
    ['辦公室', '倉庫', '我家'].forEach(n => sheet.appendRow([n]));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPrLocations_() {
  const sheet = getPrLocationSheet_();
  const data = sheet.getDataRange().getValues();
  const names = [];
  for (let i = 1; i < data.length; i++) {
    const n = String(data[i][0] || '').trim();
    if (n) names.push(n);
  }
  return names;
}

function addPrLocation_(name) {
  const sheet = getPrLocationSheet_();
  const existing = getPrLocations_();
  if (existing.indexOf(name) !== -1) return;
  sheet.appendRow([name]);
}

// ===== 【新】公關品清單 =====

const PR_ITEM_HEADERS = ['id', '名稱', '廠商', '品牌', '團購', '位置', '備註', '建立時間', '更新時間', '關聯key', '分類'];

function getPrItemSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PR_ITEM_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PR_ITEM_SHEET_NAME);
    sheet.appendRow(PR_ITEM_HEADERS);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // 舊表只有 10 欄時自動補第 11 欄「分類」：先確保格線夠寬再寫標題，
  // 否則後面 appendRow 帶 11 個值會直接中止
  if (sheet.getMaxColumns() < 11) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());
  }
  if (String(sheet.getRange(1, 11).getValue() || '').trim() === '') {
    sheet.getRange(1, 11).setValue('分類');
  }
  return sheet;
}

function getPrItems_() {
  const sheet = getPrItemSheet_();
  const data = sheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    items.push({
      id: String(row[0]),
      name: String(row[1] || ''),
      vendor: String(row[2] || ''),
      brand: String(row[3] || ''),
      group: String(row[4] || ''),
      location: String(row[5] || ''),
      note: String(row[6] || ''),
      created: row[7] instanceof Date ? fmtDateTime_(row[7]) : String(row[7] || ''),
      updated: row[8] instanceof Date ? fmtDateTime_(row[8]) : String(row[8] || ''),
      evKey: String(row[9] || ''),  // 所屬團購；前端靠它把狀態接回「公關品狀態」表
      category: String(row[10] || '')  // 試用中／準備安排開團／暫不安排／公關分享禮；空白＝依團購時間自動分組
    });
  }
  return items;
}

function findPrItemRowById_(id) {
  const sheet = getPrItemSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function findPrItemRowByEvKey_(evKey) {
  if (!evKey) return -1;
  const sheet = getPrItemSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][9] || '') === evKey) return i + 1;
  }
  return -1;
}

function addPrItem_(fields) {
  const sheet = getPrItemSheet_();
  const id = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([
    id,
    fields.name || '',
    fields.vendor || '',
    fields.brand || '',
    fields.group || '',
    fields.location || '',
    fields.note || '',
    now,
    now,
    fields.evKey || '',
    fields.category || ''
  ]);
  return id;
}

function updatePrItem_(id, fields) {
  const sheet = getPrItemSheet_();
  const row = findPrItemRowById_(id);
  if (row === -1) return false;
  if (fields.name !== undefined) sheet.getRange(row, 2).setValue(fields.name);
  if (fields.vendor !== undefined) sheet.getRange(row, 3).setValue(fields.vendor);
  if (fields.brand !== undefined) sheet.getRange(row, 4).setValue(fields.brand);
  if (fields.group !== undefined) sheet.getRange(row, 5).setValue(fields.group);
  if (fields.location !== undefined) sheet.getRange(row, 6).setValue(fields.location);
  if (fields.note !== undefined) sheet.getRange(row, 7).setValue(fields.note);
  if (fields.evKey !== undefined) sheet.getRange(row, 10).setValue(fields.evKey);
  if (fields.category !== undefined) sheet.getRange(row, 11).setValue(fields.category);
  sheet.getRange(row, 9).setValue(new Date());
  return true;
}

function deletePrItem_(id) {
  const sheet = getPrItemSheet_();
  const row = findPrItemRowById_(id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

function upsertPrItemByEvKey_(evKey, fields) {
  const row = findPrItemRowByEvKey_(evKey);
  if (row === -1) {
    return addPrItem_(Object.assign({ evKey: evKey }, fields));
  }
  const sheet = getPrItemSheet_();
  if (fields.name !== undefined && fields.name) sheet.getRange(row, 2).setValue(fields.name);
  if (fields.vendor !== undefined && fields.vendor) sheet.getRange(row, 3).setValue(fields.vendor);
  if (fields.brand !== undefined) sheet.getRange(row, 4).setValue(fields.brand);
  if (fields.group !== undefined && fields.group) sheet.getRange(row, 5).setValue(fields.group);
  if (fields.location !== undefined) sheet.getRange(row, 6).setValue(fields.location);
  if (fields.note !== undefined) sheet.getRange(row, 7).setValue(fields.note);
  sheet.getRange(row, 9).setValue(new Date());
  return String(sheet.getRange(row, 1).getValue());
}

// ===== 【新】品牌社群連結 =====

function getSocialLinkSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SOCIAL_LINK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SOCIAL_LINK_SHEET_NAME);
    sheet.appendRow(['key', '網址', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSocialLinks_() {
  const sheet = getSocialLinkSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0] || '').trim();
    if (key) map[key] = String(data[i][1] || '');
  }
  return map;
}

function setSocialLinks_(fields) {
  const sheet = getSocialLinkSheet_();
  SOCIAL_LINK_KEYS.forEach(key => {
    if (fields[key] === undefined) return;
    upsertKeyValue_(sheet, key, fields[key]);
  });
  return true;
}

// ===== 【新】行事曆活動 CRUD =====
const EVENT_COL = {
  ID: 1, START: 2, END: 3, EXTEND: 4, TITLE: 5, TAG: 6, CATEGORY: 7, URL: 8, ADMIN_URL: 9, EARLYBIRD: 10,
  RECIPE_BRAND: 11,
  COLOR: 12, ALLDAY: 13, START_TIME: 14, END_TIME: 15, IS_GROUPBUY: 16, PUBLISHED: 17,
  // 【備用欄位】原本是「每個活動」各自的社群圖示，後來確認社群圖示應該走全域設定（社群連結設定→現正開團中最上方），
  // 這四欄已經沒有 UI 在寫入，故意留著沒刪，之後如果有其他跟活動相關的資料要存，可以直接借用這幾欄，不用申請新欄位
  ICON_IG: 18, ICON_TIKTOK: 19, ICON_FB: 20, ICON_EMAIL: 21,
  MATCH_ITEMS: 22,
  THUMB: 23,  // 去背小圖（這檔專用）；空白＝自動用品牌資料庫的品牌預設小圖
  DISCOUNT_CODE: 24,  // 折扣碼；有填就會在前台小視窗顯示可點擊複製的折扣碼
  DISCOUNT_DESC: 25   // 折扣說明（例如「滿 1000 折 100」）
};

function getEventSheet_() {
  const ss = SpreadsheetApp.openById(EVENT_SHEET_ID);
  if (EVENT_SHEET_NAME) {
    const named = ss.getSheetByName(EVENT_SHEET_NAME);
    if (named) return named;
  }
  return ss.getSheets()[0];
}

function findEventRowById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function getNextEventId_(sheet) {
  const data = sheet.getDataRange().getValues();
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const n = parseInt(data[i][0], 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

function parseYmdToDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 寫入「延長時間」欄（D 欄）。這欄可能被試算表沿用成日期格式（前一筆是「指定延長至某天」時），
// 直接 setValue(3) 會被顯示成 1900/1/2，而且 getValues() 讀回來變成 Date 物件，
// 前台的 parseExtendRaw 就會誤判成「延長至 1900 年」。所以寫數字時一律把格式改回純數字。
function setEventExtend_(sheet, row, val) {
  const cell = sheet.getRange(row, EVENT_COL.EXTEND);
  if (val === '' || val === undefined || val === null) {
    cell.setNumberFormat('0').clearContent();
    return;
  }
  const d = parseYmdToDate_(val); // 支援手動填「指定延長至 YYYY-MM-DD」
  if (d) {
    cell.setNumberFormat('yyyy-mm-dd').setValue(d);
    return;
  }
  const n = Number(val);
  cell.setNumberFormat('0').setValue(isNaN(n) ? '' : n);
}

function addEvent_(fields) {
  const sheet = getEventSheet_();
  const id = getNextEventId_(sheet);
  const startDate = parseYmdToDate_(fields.start);
  const endDate = parseYmdToDate_(fields.end);
  if (!startDate || !endDate) throw new Error('開始或結束日期格式不正確');

  const row = [];
  row[EVENT_COL.ID - 1] = id;
  row[EVENT_COL.START - 1] = startDate;
  row[EVENT_COL.END - 1] = endDate;
  // 延長欄先留空，下面統一交給 setEventExtend_ 寫（它同時支援天數與「延長至 YYYY-MM-DD」，
  // 這裡若直接 Number() 日期字串會變成 NaN 塞進 setValues）
  row[EVENT_COL.EXTEND - 1] = '';
  row[EVENT_COL.TITLE - 1] = fields.title || '';
  row[EVENT_COL.TAG - 1] = fields.tag || '';
  row[EVENT_COL.CATEGORY - 1] = fields.category || '';
  row[EVENT_COL.URL - 1] = fields.url || '';
  row[EVENT_COL.ADMIN_URL - 1] = '';
  row[EVENT_COL.EARLYBIRD - 1] = fields.earlyBird || '';
  row[EVENT_COL.RECIPE_BRAND - 1] = '';
  row[EVENT_COL.COLOR - 1] = fields.color || '';
  row[EVENT_COL.ALLDAY - 1] = fields.allDay ? '是' : '否';
  row[EVENT_COL.START_TIME - 1] = fields.allDay ? '' : (fields.startTime || '');
  row[EVENT_COL.END_TIME - 1] = fields.allDay ? '' : (fields.endTime || '');
  row[EVENT_COL.IS_GROUPBUY - 1] = fields.isGroupBuy ? '是' : '否';
  row[EVENT_COL.PUBLISHED - 1] = fields.published ? '是' : '否';
  row[EVENT_COL.ICON_IG - 1] = fields.iconIg || '';
  row[EVENT_COL.ICON_TIKTOK - 1] = fields.iconTiktok || '';
  row[EVENT_COL.ICON_FB - 1] = fields.iconFb || '';
  row[EVENT_COL.ICON_EMAIL - 1] = fields.iconEmail || '';
  row[EVENT_COL.MATCH_ITEMS - 1] = fields.matchItems || '';
  row[EVENT_COL.THUMB - 1] = fields.thumbUrl || '';
  row[EVENT_COL.DISCOUNT_CODE - 1] = fields.discountCode || '';
  row[EVENT_COL.DISCOUNT_DESC - 1] = fields.discountDesc || '';

  const newRow = sheet.getLastRow() + 1;
  sheet.getRange(newRow, 1, 1, row.length).setValues([row]);
  setEventExtend_(sheet, newRow, fields.extend); // 確保延長欄不會被沿用成日期格式
  return id;
}

function updateEvent_(id, fields) {
  const sheet = getEventSheet_();
  const row = findEventRowById_(sheet, id);
  if (row === -1) return false;

  if (fields.start !== undefined) {
    const d = parseYmdToDate_(fields.start);
    if (d) sheet.getRange(row, EVENT_COL.START).setValue(d);
  }
  if (fields.end !== undefined) {
    const d = parseYmdToDate_(fields.end);
    if (d) sheet.getRange(row, EVENT_COL.END).setValue(d);
  }
  if (fields.title !== undefined) sheet.getRange(row, EVENT_COL.TITLE).setValue(fields.title);
  if (fields.category !== undefined) sheet.getRange(row, EVENT_COL.CATEGORY).setValue(fields.category);
  if (fields.url !== undefined) sheet.getRange(row, EVENT_COL.URL).setValue(fields.url);
  if (fields.tag !== undefined) sheet.getRange(row, EVENT_COL.TAG).setValue(fields.tag);
  if (fields.earlyBird !== undefined) sheet.getRange(row, EVENT_COL.EARLYBIRD).setValue(fields.earlyBird);
  if (fields.extend !== undefined) setEventExtend_(sheet, row, fields.extend);
  if (fields.color !== undefined) sheet.getRange(row, EVENT_COL.COLOR).setValue(fields.color);
  if (fields.allDay !== undefined) {
    sheet.getRange(row, EVENT_COL.ALLDAY).setValue(fields.allDay ? '是' : '否');
    if (fields.allDay) {
      sheet.getRange(row, EVENT_COL.START_TIME).setValue('');
      sheet.getRange(row, EVENT_COL.END_TIME).setValue('');
    }
  }
  if (fields.allDay === false) {
    if (fields.startTime !== undefined) sheet.getRange(row, EVENT_COL.START_TIME).setValue(fields.startTime);
    if (fields.endTime !== undefined) sheet.getRange(row, EVENT_COL.END_TIME).setValue(fields.endTime);
  }
  if (fields.isGroupBuy !== undefined) sheet.getRange(row, EVENT_COL.IS_GROUPBUY).setValue(fields.isGroupBuy ? '是' : '否');
  if (fields.published !== undefined) sheet.getRange(row, EVENT_COL.PUBLISHED).setValue(fields.published ? '是' : '否');
  if (fields.iconIg !== undefined) sheet.getRange(row, EVENT_COL.ICON_IG).setValue(fields.iconIg);
  if (fields.iconTiktok !== undefined) sheet.getRange(row, EVENT_COL.ICON_TIKTOK).setValue(fields.iconTiktok);
  if (fields.iconFb !== undefined) sheet.getRange(row, EVENT_COL.ICON_FB).setValue(fields.iconFb);
  if (fields.iconEmail !== undefined) sheet.getRange(row, EVENT_COL.ICON_EMAIL).setValue(fields.iconEmail);
  if (fields.matchItems !== undefined) sheet.getRange(row, EVENT_COL.MATCH_ITEMS).setValue(fields.matchItems);
  if (fields.thumbUrl !== undefined) sheet.getRange(row, EVENT_COL.THUMB).setValue(fields.thumbUrl);
  if (fields.discountCode !== undefined) sheet.getRange(row, EVENT_COL.DISCOUNT_CODE).setValue(fields.discountCode);
  if (fields.discountDesc !== undefined) sheet.getRange(row, EVENT_COL.DISCOUNT_DESC).setValue(fields.discountDesc);
  return true;
}

// 修復已經被寫壞的「延長時間」欄：格式被沿用成日期時，數字 3 會被存成 1900 年初的某天。
// 試算表裡實際的數值仍然是 3（1899-12-30 為序號 0），所以換算回天數就能救回來。
// 在 Apps Script 編輯器直接執行這個函式即可，只會動到年份 < 2000 的異常列。
function repairEventExtendColumn() {
  const sheet = getEventSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return { fixed: [] };
  const range = sheet.getRange(2, EVENT_COL.EXTEND, last - 1, 1);
  const vals = range.getValues();
  const EPOCH = new Date(1899, 11, 30);
  const fixed = [];
  vals.forEach((r, i) => {
    const v = r[0];
    if (!(v instanceof Date) || v.getFullYear() >= 2000) return;
    const days = Math.round((v.getTime() - EPOCH.getTime()) / 86400000);
    const cell = sheet.getRange(i + 2, EVENT_COL.EXTEND);
    cell.setNumberFormat('0').setValue(days);
    fixed.push('第 ' + (i + 2) + ' 列：' + Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd') + ' → ' + days + ' 天');
  });
  Logger.log(fixed.length ? '已修復 ' + fixed.length + ' 列：\n' + fixed.join('\n') : '沒有需要修復的列');
  return { fixed: fixed };
}

// 診斷用：把行事曆前幾欄的實際值、型別、儲存格格式印出來，用來確認 1900 年是出現在哪一欄。
// 在 Apps Script 編輯器執行後看「執行紀錄」。
function dumpEventColumns() {
  const sheet = getEventSheet_();
  const last = Math.min(sheet.getLastRow(), 40);
  if (last < 2) { Logger.log('沒有資料列'); return; }
  const COLS = 6; // A~F：編號、開始、結束、延長、標題、標籤
  const vals = sheet.getRange(1, 1, last, COLS).getValues();
  const fmts = sheet.getRange(1, 1, last, COLS).getNumberFormats();
  Logger.log('分頁名稱：' + sheet.getName());
  Logger.log('標題列：' + vals[0].join(' | '));
  for (let i = 1; i < last; i++) {
    const parts = [];
    for (let j = 0; j < COLS; j++) {
      const v = vals[i][j];
      if (v === '' || v === null) continue;
      const type = (v instanceof Date) ? 'Date(' + v.getFullYear() + ')' : typeof v;
      parts.push(String.fromCharCode(65 + j) + '=[' + v + '] ' + type + ' 格式:' + fmts[i][j]);
    }
    Logger.log('第 ' + (i + 1) + ' 列  ' + parts.join('  '));
  }
}

function deleteEvent_(id) {
  const sheet = getEventSheet_();
  const row = findEventRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// 【新】把行事曆分頁包成跟 gviz 完全相同的格式，讓前台改走 Apps Script 讀取（試算表就能設私人）
// 前台原本吃 gviz 的 { table: { rows: [ { c: [ {v:...}, ... ] } ] } }，這裡照樣輸出
// 日期用 gviz 的 "Date(y,m,d)"（月份 0-based），前台的 parseDateStr 直接吃得下
function getEventsAsGviz_() {
  const sheet = getEventSheet_();
  const data = sheet.getDataRange().getValues();
  const COLS = EVENT_COL.DISCOUNT_DESC; // 一路讀到 Y 欄（含對應品項、去背小圖、折扣碼）
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[0] === '' || r[0] === null || r[0] === undefined) continue; // 沒有編號的空列跳過
    const c = [];
    for (let j = 0; j < COLS; j++) {
      let v = r[j];
      if (v instanceof Date) {
        v = 'Date(' + v.getFullYear() + ',' + v.getMonth() + ',' + v.getDate() + ')';
      }
      c.push((v === '' || v === null || v === undefined) ? null : { v: v });
    }
    rows.push({ c: c });
  }
  return { table: { rows: rows } };
}

// ===== 【新】前台瀏覽次數／點擊次數統計 =====
const STAT_SHEET_NAME = '瀏覽點擊統計';

function getStatSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STAT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STAT_SHEET_NAME);
    sheet.appendRow(['key', '瀏覽次數', '點擊次數', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getStatsMap_() {
  const sheet = getStatSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (!key) continue;
    map[String(key)] = {
      views: Number(data[i][1]) || 0,
      clicks: Number(data[i][2]) || 0,
      updated: data[i][3] ? fmtDateTime_(data[i][3]) : ''
    };
  }
  return map;
}

// 白名單涵蓋 index.html 實際會送出的 6 種 key 格式，範例：
//   block_B1737510000000        自訂區塊（block.id = 'B'+時間戳，見 index.html:780）
//   12_2026-7-22                團購活動瀏覽（ev.id + 西元年-月-日，月/日不補零，見 index.html:799-802）
//   12_2026-7-22_src_list       分表單來源點擊（mode 來自 modeSelect：all/start/end/list，見 index.html:848）
//   12_2026-7-22_intro          食材入口點擊（見 index.html:1559）
//   12_2026-7-22_recipe         食譜入口點擊（見 index.html:1563）
//   12_2026-7-22_order          下單按鈕點擊（見 index.html:1567）
//   12_2026-7-22_code           折扣碼複製點擊（見 index.html:1596）
const STAT_KEY_WHITELIST_RE = /^(block_[A-Za-z0-9]+|\d+_\d{4}-\d{1,2}-\d{1,2}(_(src_[a-z0-9]+|intro|recipe|order|code))?|page_[a-z0-9]+_\d{4}-\d{1,2}-\d{1,2})$/;
const STAT_KEY_ROW_CAP = 5000;

function isValidStatKey_(key) {
  if (typeof key !== 'string') return false;
  if (key.length === 0 || key.length > 80) return false;
  return STAT_KEY_WHITELIST_RE.test(key);
}

const STAT_BATCH_MAX_ITEMS = 60; // 一次最多收這麼多筆，避免有人拿這支端點灌爆試算表

// 批次累加統計：把同一批 key 的增量先在記憶體加總，再一次寫回試算表。
// items 格式：[{ key: '12_2026-7-31', field: 'views'|'clicks' }, ...]
// 回傳實際寫進去的 key 數量。
function incrementStats_(items) {
  const deltas = {};
  const order = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const key = String(it.key || '').trim();
    if (!isValidStatKey_(key)) continue;
    if (!deltas[key]) { deltas[key] = { views: 0, clicks: 0 }; order.push(key); }
    if (it.field === 'clicks') deltas[key].clicks++;
    else deltas[key].views++;
  }
  if (!order.length) return 0;

  const sheet = getStatSheet_();
  const lastRow = sheet.getLastRow();
  const data = lastRow > 1 ? sheet.getRange(1, 1, lastRow, 4).getValues() : [];
  const rowOf = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0]);
    if (k && rowOf[k] === undefined) rowOf[k] = i; // 0-based 資料索引，寫入時 +1
  }

  const now = new Date();
  const newRows = [];
  const existingCount = Math.max(0, data.length - 1);
  let minTouched = -1, maxTouched = -1; // 被動到的資料索引範圍（0-based，含頭尾）
  let written = 0;

  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const d = deltas[key];
    const idx = rowOf[key];
    if (idx === undefined) {
      // 既有 key 數已達上限就不再新增；既有 key 的累加不受此限制
      if (existingCount + newRows.length >= STAT_KEY_ROW_CAP) continue;
      newRows.push([key, d.views, d.clicks, now]);
      written++;
    } else {
      // 先改記憶體裡的副本，最後一次寫回。不要在迴圈裡逐列 setValues——
      // 那是握著統計鎖對試算表來回幾十次，其他人的統計會搶不到鎖而整批被丟掉。
      data[idx][1] = (Number(data[idx][1]) || 0) + d.views;
      data[idx][2] = (Number(data[idx][2]) || 0) + d.clicks;
      data[idx][3] = now;
      if (minTouched < 0 || idx < minTouched) minTouched = idx;
      if (idx > maxTouched) maxTouched = idx;
      written++;
    }
  }

  if (minTouched >= 0) {
    // 只寫「被動到的最小～最大列」這一段，不要整張表重寫：這張表上限 5000 列，
    // 整表 setValues 是一萬多格的寫入，只為了改一列而握著統計鎖跑一兩秒，
    // 反而比原本的逐列寫更糟。中間夾到的未動列填的是自己原本的值，等同沒動。
    const out = [];
    for (let i = minTouched; i <= maxTouched; i++) out.push([data[i][1], data[i][2], data[i][3]]);
    sheet.getRange(minTouched + 1, 2, out.length, 3).setValues(out);
  }
  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 4).setValues(newRows);
  }
  return written;
}

// 單筆版保留給舊前端（沒清快取的瀏覽器還會送 stat-view／stat-click）
function incrementStat_(key, field) {
  return incrementStats_([{ key: key, field: field === 'clicks' ? 'clicks' : 'views' }]) > 0;
}

// ===== 【新】開團狀態清單：自訂區塊 =====
const CUSTOM_BLOCK_SHEET_NAME = '自訂區塊';
const CUSTOM_BLOCK_COL = {
  ID: 1, TYPE: 2, TITLE: 3, TITLE_SIZE: 4, SUBTITLE_ON: 5, SUBTITLE: 6, BTN_COLOR: 7,
  BORDER_STYLE: 8, BORDER_WIDTH: 9, BORDER_COLOR: 10, TEXT_COLOR: 11, URL: 12, ANIMATION: 13,
  POSITION: 14, ORDER: 15, ENABLED: 16, CREATED: 17, UPDATED: 18
};

function getCustomBlockSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CUSTOM_BLOCK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CUSTOM_BLOCK_SHEET_NAME);
    sheet.appendRow(['id', '類型', '標題', '標題尺寸', '副標開關', '副標', '按鈕底色',
      '邊框樣式', '邊框粗細', '邊框顏色', '文字顏色', '網址', '動態效果',
      '位置', '排序值', '顯示開關', '建立時間', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rowToCustomBlock_(row) {
  return {
    id: String(row[CUSTOM_BLOCK_COL.ID - 1]),
    type: String(row[CUSTOM_BLOCK_COL.TYPE - 1] || 'text_button'),
    title: String(row[CUSTOM_BLOCK_COL.TITLE - 1] || ''),
    titleSize: String(row[CUSTOM_BLOCK_COL.TITLE_SIZE - 1] || '中'),
    subtitleOn: String(row[CUSTOM_BLOCK_COL.SUBTITLE_ON - 1] || '').trim() === '是',
    subtitle: String(row[CUSTOM_BLOCK_COL.SUBTITLE - 1] || ''),
    buttonColor: String(row[CUSTOM_BLOCK_COL.BTN_COLOR - 1] || '#FF8FA3'),
    borderStyle: String(row[CUSTOM_BLOCK_COL.BORDER_STYLE - 1] || '無'),
    borderWidth: Number(row[CUSTOM_BLOCK_COL.BORDER_WIDTH - 1]) || 0,
    borderColor: String(row[CUSTOM_BLOCK_COL.BORDER_COLOR - 1] || '#FFFFFF'),
    textColor: String(row[CUSTOM_BLOCK_COL.TEXT_COLOR - 1] || '#FFFFFF'),
    url: String(row[CUSTOM_BLOCK_COL.URL - 1] || ''),
    animation: String(row[CUSTOM_BLOCK_COL.ANIMATION - 1] || '無'),
    position: String(row[CUSTOM_BLOCK_COL.POSITION - 1] || 'after'),
    order: Number(row[CUSTOM_BLOCK_COL.ORDER - 1]) || 0,
    enabled: String(row[CUSTOM_BLOCK_COL.ENABLED - 1] || '').trim() === '是',
    created: row[CUSTOM_BLOCK_COL.CREATED - 1] instanceof Date ? fmtDateTime_(row[CUSTOM_BLOCK_COL.CREATED - 1]) : String(row[CUSTOM_BLOCK_COL.CREATED - 1] || ''),
    updated: row[CUSTOM_BLOCK_COL.UPDATED - 1] instanceof Date ? fmtDateTime_(row[CUSTOM_BLOCK_COL.UPDATED - 1]) : String(row[CUSTOM_BLOCK_COL.UPDATED - 1] || '')
  };
}

function getAllCustomBlocks_() {
  const sheet = getCustomBlockSheet_();
  const data = sheet.getDataRange().getValues();
  const blocks = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    blocks.push(rowToCustomBlock_(data[i]));
  }
  blocks.sort((a, b) => (a.position === b.position ? a.order - b.order : 0));
  return blocks;
}

function getPublicCustomBlocks_() {
  return getAllCustomBlocks_().filter(b => b.enabled);
}

function findCustomBlockRowById_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function getMaxOrderInPosition_(position) {
  const blocks = getAllCustomBlocks_().filter(b => b.position === position);
  if (!blocks.length) return 0;
  return Math.max.apply(null, blocks.map(b => b.order));
}

function addCustomBlock_(fields) {
  const sheet = getCustomBlockSheet_();
  const id = 'B' + Date.now();
  const now = new Date();
  const position = ['before', 'between', 'after'].indexOf(fields.position) !== -1 ? fields.position : 'after';
  const order = getMaxOrderInPosition_(position) + 1;
  const row = [];
  row[CUSTOM_BLOCK_COL.ID - 1] = id;
  row[CUSTOM_BLOCK_COL.TYPE - 1] = fields.type || 'text_button';
  row[CUSTOM_BLOCK_COL.TITLE - 1] = fields.title || '';
  row[CUSTOM_BLOCK_COL.TITLE_SIZE - 1] = fields.titleSize || '中';
  row[CUSTOM_BLOCK_COL.SUBTITLE_ON - 1] = fields.subtitleOn ? '是' : '否';
  row[CUSTOM_BLOCK_COL.SUBTITLE - 1] = fields.subtitle || '';
  row[CUSTOM_BLOCK_COL.BTN_COLOR - 1] = fields.buttonColor || '#FF8FA3';
  row[CUSTOM_BLOCK_COL.BORDER_STYLE - 1] = fields.borderStyle || '無';
  row[CUSTOM_BLOCK_COL.BORDER_WIDTH - 1] = fields.borderWidth || 0;
  row[CUSTOM_BLOCK_COL.BORDER_COLOR - 1] = fields.borderColor || '#FFFFFF';
  row[CUSTOM_BLOCK_COL.TEXT_COLOR - 1] = fields.textColor || '#FFFFFF';
  row[CUSTOM_BLOCK_COL.URL - 1] = fields.url || '';
  row[CUSTOM_BLOCK_COL.ANIMATION - 1] = fields.animation || '無';
  row[CUSTOM_BLOCK_COL.POSITION - 1] = position;
  row[CUSTOM_BLOCK_COL.ORDER - 1] = order;
  row[CUSTOM_BLOCK_COL.ENABLED - 1] = fields.enabled === false ? '否' : '是';
  row[CUSTOM_BLOCK_COL.CREATED - 1] = now;
  row[CUSTOM_BLOCK_COL.UPDATED - 1] = now;
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return id;
}

function updateCustomBlock_(id, fields) {
  const sheet = getCustomBlockSheet_();
  const row = findCustomBlockRowById_(sheet, id);
  if (row === -1) return false;
  const setIf = (col, val) => { if (val !== undefined) sheet.getRange(row, col).setValue(val); };
  setIf(CUSTOM_BLOCK_COL.TITLE, fields.title);
  setIf(CUSTOM_BLOCK_COL.TITLE_SIZE, fields.titleSize);
  if (fields.subtitleOn !== undefined) sheet.getRange(row, CUSTOM_BLOCK_COL.SUBTITLE_ON).setValue(fields.subtitleOn ? '是' : '否');
  setIf(CUSTOM_BLOCK_COL.SUBTITLE, fields.subtitle);
  setIf(CUSTOM_BLOCK_COL.BTN_COLOR, fields.buttonColor);
  setIf(CUSTOM_BLOCK_COL.BORDER_STYLE, fields.borderStyle);
  setIf(CUSTOM_BLOCK_COL.BORDER_WIDTH, fields.borderWidth);
  setIf(CUSTOM_BLOCK_COL.BORDER_COLOR, fields.borderColor);
  setIf(CUSTOM_BLOCK_COL.TEXT_COLOR, fields.textColor);
  setIf(CUSTOM_BLOCK_COL.URL, fields.url);
  setIf(CUSTOM_BLOCK_COL.ANIMATION, fields.animation);
  if (fields.position !== undefined && ['before', 'between', 'after'].indexOf(fields.position) !== -1) {
    sheet.getRange(row, CUSTOM_BLOCK_COL.POSITION).setValue(fields.position);
    sheet.getRange(row, CUSTOM_BLOCK_COL.ORDER).setValue(getMaxOrderInPosition_(fields.position) + 1);
  }
  if (fields.enabled !== undefined) sheet.getRange(row, CUSTOM_BLOCK_COL.ENABLED).setValue(fields.enabled ? '是' : '否');
  sheet.getRange(row, CUSTOM_BLOCK_COL.UPDATED).setValue(new Date());
  return true;
}

function deleteCustomBlock_(id) {
  const sheet = getCustomBlockSheet_();
  const row = findCustomBlockRowById_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

function duplicateCustomBlock_(id) {
  const sheet = getCustomBlockSheet_();
  const row = findCustomBlockRowById_(sheet, id);
  if (row === -1) return false;
  const data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const original = rowToCustomBlock_(data);
  const newId = addCustomBlock_({
    type: original.type,
    title: original.title + '（複製）',
    titleSize: original.titleSize,
    subtitleOn: original.subtitleOn,
    subtitle: original.subtitle,
    buttonColor: original.buttonColor,
    borderStyle: original.borderStyle,
    borderWidth: original.borderWidth,
    borderColor: original.borderColor,
    textColor: original.textColor,
    url: original.url,
    animation: original.animation,
    position: original.position,
    enabled: false
  });
  return newId;
}

function moveCustomBlock_(id, direction) {
  const all = getAllCustomBlocks_();
  const target = all.find(b => b.id === id);
  if (!target) return false;
  const siblings = all.filter(b => b.position === target.position).sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex(b => b.id === id);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return false;
  const other = siblings[swapIdx];

  const sheet = getCustomBlockSheet_();
  const rowA = findCustomBlockRowById_(sheet, target.id);
  const rowB = findCustomBlockRowById_(sheet, other.id);
  if (rowA === -1 || rowB === -1) return false;
  sheet.getRange(rowA, CUSTOM_BLOCK_COL.ORDER).setValue(other.order);
  sheet.getRange(rowB, CUSTOM_BLOCK_COL.ORDER).setValue(target.order);
  return true;
}

// ===== 【一次性】用來觸發外部網路存取權限授權 =====
function testGithubAuth() {
  const res = UrlFetchApp.fetch('https://api.github.com', { muteHttpExceptions: true });
  Logger.log('狀態碼：' + res.getResponseCode());
}

// ===== 【新】GitHub 圖片庫 / 圖片上傳 =====
const GITHUB_OWNER = 'dondon0813';
const GITHUB_REPO = 'calender';
const GITHUB_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/' + GITHUB_BRANCH;

function getGithubToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('尚未設定 GITHUB_TOKEN，請到 Apps Script 的 Script Properties 新增');
  return token;
}

function githubFetch_(method, path, payload) {
  const encodedPath = path ? path.split('/').map(encodeURIComponent).join('/') : '';
  const url = GITHUB_API_BASE + '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents' +
    (encodedPath ? '/' + encodedPath : '');
  const options = {
    method: method,
    headers: {
      Authorization: 'Bearer ' + getGithubToken_(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { code: code, json: json };
}

function sanitizeFileName_(name) {
  const dotIdx = name.lastIndexOf('.');
  const base = dotIdx === -1 ? name : name.slice(0, dotIdx);
  const ext = dotIdx === -1 ? '' : name.slice(dotIdx);
  const safeBase = base.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 80);
  return (safeBase || 'img' + Date.now()) + ext.toLowerCase();
}

function listGithubFilesRecursive_(path) {
  const result = githubFetch_('GET', path);
  if (result.code === 404) return [];
  if (result.code >= 400) throw new Error('GitHub 讀取失敗（' + result.code + '）：' + (result.json && result.json.message || ''));
  const items = Array.isArray(result.json) ? result.json : [result.json];
  let files = [];
  items.forEach(function (item) {
    if (item.type === 'file') {
      files.push({ path: item.path, name: item.name, size: item.size, sha: item.sha, download_url: GITHUB_RAW_BASE + '/' + item.path });
    } else if (item.type === 'dir') {
      files = files.concat(listGithubFilesRecursive_(item.path));
    }
  });
  return files;
}

function listGithubFoldersRecursive_(path, maxDepth) {
  const result = githubFetch_('GET', path || '');
  if (result.code === 404) return [];
  if (result.code >= 400) throw new Error('GitHub 讀取失敗（' + result.code + '）：' + (result.json && result.json.message || ''));
  const items = Array.isArray(result.json) ? result.json : [result.json];
  let folders = [];
  items.forEach(function (item) {
    if (item.type === 'dir') {
      folders.push(item.path);
      if (maxDepth > 0) {
        folders = folders.concat(listGithubFoldersRecursive_(item.path, maxDepth - 1));
      }
    }
  });
  return folders;
}

function githubGetFileMeta_(path) {
  const result = githubFetch_('GET', path);
  if (result.code === 404) return null;
  if (result.code >= 400) throw new Error('GitHub 讀取失敗（' + result.code + '）：' + (result.json && result.json.message || ''));
  return result.json;
}

function githubPutFile_(path, base64Content, message, sha) {
  const payload = { message: message, content: base64Content, branch: GITHUB_BRANCH };
  if (sha) payload.sha = sha;
  const result = githubFetch_('PUT', path, payload);
  if (result.code >= 400) throw new Error('GitHub 上傳失敗（' + result.code + '）：' + (result.json && result.json.message || ''));
  return result.json;
}

function githubDeleteFile_(path, sha, message) {
  const result = githubFetch_('DELETE', path, { message: message, sha: sha, branch: GITHUB_BRANCH });
  if (result.code >= 400) throw new Error('GitHub 刪除失敗（' + result.code + '）：' + (result.json && result.json.message || ''));
  return true;
}

const IMAGE_REF_SHEETS = [
  { sheet: INGREDIENT_DB_SHEET_NAME, cols: ['圖片網址'] },
  { sheet: PRODUCT_DB_SHEET_NAME, cols: ['圖片網址'] },
  { sheet: RECIPE_SHEET_NAME, cols: ['成品圖片網址', '步驟圖片'] },
  { sheet: BRAND_SHEET_NAME, cols: ['圖片網址', 'Logo網址'] },
  { sheet: BRAND_DB_SHEET_NAME, cols: ['經典商品圖片網址'] }
];

function findImageReferences_(urlOrFragment) {
  const refs = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  IMAGE_REF_SHEETS.forEach(function (cfg) {
    const sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0].map(function (h) { return String(h).trim(); });
    cfg.cols.forEach(function (colName) {
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) return;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colIdx] || '').indexOf(urlOrFragment) !== -1) {
          refs.push({ sheet: cfg.sheet, row: i + 1, col: colName });
        }
      }
    });
  });
  return refs;
}

function replaceImageReferences_(oldUrl, newUrl) {
  let count = 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  IMAGE_REF_SHEETS.forEach(function (cfg) {
    const sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0].map(function (h) { return String(h).trim(); });
    cfg.cols.forEach(function (colName) {
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) return;
      for (let i = 1; i < data.length; i++) {
        const val = String(data[i][colIdx] || '');
        if (val.indexOf(oldUrl) !== -1) {
          sheet.getRange(i + 1, colIdx + 1).setValue(val.split(oldUrl).join(newUrl));
          count++;
        }
      }
    });
  });
  return count;
}

function repairWebpReferences_() {
  const cache = {};
  let updated = 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  IMAGE_REF_SHEETS.forEach(function (cfg) {
    const sheet = ss.getSheetByName(cfg.sheet);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const headers = data[0].map(function (h) { return String(h).trim(); });
    cfg.cols.forEach(function (colName) {
      const colIdx = headers.indexOf(colName);
      if (colIdx === -1) return;
      for (let i = 1; i < data.length; i++) {
        const val = String(data[i][colIdx] || '');
        if (!val) continue;
        const newVal = repairWebpUrlsInText_(val, cache);
        if (newVal !== val) {
          sheet.getRange(i + 1, colIdx + 1).setValue(newVal);
          updated++;
        }
      }
    });
  });
  return { updated: updated };
}

function repairWebpUrlsInText_(text, cache) {
  const pattern = /(https?:\/\/(?:raw\.githubusercontent\.com\/dondon0813\/calender\/main|dondon0813\.github\.io\/calender)\/)([^\s"'|]+?\.(?:jpe?g|png|gif|bmp))/gi;
  return text.replace(pattern, function (match, prefix, path) {
    const dotIdx = path.lastIndexOf('.');
    const webpPath = path.slice(0, dotIdx) + '.webp';
    let exists;
    if (Object.prototype.hasOwnProperty.call(cache, webpPath)) {
      exists = cache[webpPath];
    } else {
      try {
        exists = !!githubGetFileMeta_(webpPath);
      } catch (e) {
        exists = false;
      }
      cache[webpPath] = exists;
    }
    return exists ? (prefix + webpPath) : match;
  });
}

// ===== 對外介面 =====

// 公開端點的資料組裝抽出來，讓 doGet 的三條公開路徑都能走 cachedJsonResult_()。
// ⚠️ 這是免登入公開範圍，白名單規則寫在各欄註解裡，加欄位前先讀。
function buildPublicResult_() {
  // 前台食材/食譜頁的品牌篩選＋品牌介紹：改由「團購品牌資料庫」勾選「顯示於食材食譜=是」的品牌提供。
  // ⚠️ 只輸出「品牌名稱／品牌介紹／蝦皮連結」三欄，其餘（LINE/Email/IG窗口、備註）不可外洩。
  // 「蝦皮連結」是刻意公開的欄位：它本來就是要給客人點的導購網址（沒開團時前台食材/食譜頁用它導流），
  // 與聯絡窗口那種內部資料性質不同；除了這三欄以外，任何新欄位一律不准加進來。
  const publicBrands = getBrandDbList_()
    .filter(b => b.showInRecipe && b.name)
    .map(b => ({ '品牌名稱': b.name, '品牌介紹': b.intro, '蝦皮連結': b.shopeeUrl }));

  // 前台開學清單「現正開團中」要用的品牌去背小圖：品牌名稱 → 去背小圖。
  // ⚠️ 同樣是免登入公開範圍，只輸出「品牌名稱／去背小圖」，不可帶出聯絡窗口等內部欄位。
  // 這裡刻意不看 showInRecipe（那是「食材/食譜頁顯示」的旗標，語意不同），
  // 改成「有填去背小圖才輸出」＝填了圖就等於願意公開這張圖。
  const publicBrandThumbs = getBrandDbList_()
    .filter(b => b.name && b.thumbUrl)
    .map(b => ({ '品牌名稱': b.name, '去背小圖': b.thumbUrl }));

  return {
    brands: publicBrands,
    brandThumbs: publicBrandThumbs,
    ingredients: getMergedIngredientsAndProducts_(),
    recipes: sheetRowsAsObjects_(RECIPE_SHEET_NAME),
    schoolList: sheetRowsAsObjects_(SCHOOL_LIST_SHEET_NAME),
    blocks: getPublicCustomBlocks_(),
    socialLinks: getSocialLinks_()
  };
}

function doGet(e) {
  REQ_CACHE_ = {}; // 防執行環境重用：每個請求一定從空快取開始
  const scope = e && e.parameter ? e.parameter.scope : '';
  const token = e && e.parameter ? e.parameter.token : '';

  // 前台行事曆專用：回傳與 gviz 相同格式的活動資料（公開、免登入）
  if (scope === 'calendar') {
    return cachedJsonResult_(CACHE_KEY_CALENDAR, getEventsAsGviz_);
  }

  // 首頁（index.html）的自訂區塊＋社群連結專用輕量端點。
  // 首頁本來是整包抓 scope=public，但它只用得到這兩樣，卻要害後端把品牌庫讀兩次、
  // 再加食材／成品／食譜／開學清單——那是同時執行作業爆量的主因之一。
  if (scope === 'blocks') {
    return cachedJsonResult_(CACHE_KEY_BLOCKS, function () {
      return { blocks: getPublicCustomBlocks_(), socialLinks: getSocialLinks_() };
    });
  }

  if (scope === 'public') {
    return cachedJsonResult_(CACHE_KEY_PUBLIC, buildPublicResult_);
  }

  const publicResult = buildPublicResult_();

  const user = getSessionUser_(token);
  if (!user) {
    return jsonResult_(Object.assign({}, publicResult, {
      unauthorized: true,
      error: '未登入或登入逾時，請重新登入'
    }));
  }

  const result = {
    currentUser: user,
    memos: sheetToMap_(getMemoSheet_()),
    urls: sheetToMap_(getUrlSheet_()),
    brands: publicResult.brands,
    ingredients: publicResult.ingredients,
    recipes: publicResult.recipes,
    schoolList: publicResult.schoolList,
    staff: getStaff_().map(s => ({ name: s.name })),
    taskNames: getTaskNames_(),
    myTaskNames: getMyTaskNamesFor_(user),
    tasks: getAllTasks_(),
    vendors: getVendors_(),
    prStatus: getPrStatusMap_(),
    prLocations: getPrLocations_(),
    todoCategories: getTodoCategories_(),
    todos: getTodos_(),
    stats: getStatsMap_(),
    isAdmin: isAdmin_(user),
    myRole: isAdmin_(user) ? '主管理員' : getStaffRole_(user),
    permissions: getPermissionsFor_(user),
    allPermissions: isAdmin_(user) ? getAllPermissions_() : {},
    customBlocks: getAllCustomBlocks_(),
    socialLinks: publicResult.socialLinks,
    vendorDb: getVendorDbList_(),
    brandDb: getBrandDbListFor_(user)   // 沒有分潤權限的人，這裡就不會有 commission* 欄位
  };

  return jsonResult_(result);
}

// 登入邏輯抽出來：它不進全域鎖，見 doPost 註解
function handleLogin_(body) {
  const name = String(body.name || '').trim();
  const password = String(body.password || '').trim();
  if (!password) return jsonResult_({ success: false, error: '請輸入密碼' });

  const staff = getStaff_();
  let matches;
  if (name) {
    matches = staff.filter(function (s) { return s.name === name && verifyPassword_(password, s.salt, s.hash); });
  } else {
    matches = staff.filter(function (s) { return verifyPassword_(password, s.salt, s.hash); });
  }

  if (matches.length === 0) {
    return jsonResult_({ success: false, error: '密碼錯誤' });
  }
  if (matches.length > 1) {
    return jsonResult_({ success: false, error: '有員工使用相同密碼，請到「員工名單」分頁設定成不同密碼' });
  }

  const token = createSession_(matches[0].name);
  if (needsRehash_(matches[0].hash)) {
    try { setStaffPassword_(matches[0].name, password); } catch (rehashErr) { /* 寫回失敗不影響登入成功 */ }
  }
  return jsonResult_({ success: true, token: token, name: matches[0].name, weakPassword: (password === DEFAULT_PASSWORD) });
}

// 純查詢的動作不必清公開端點快取——後台開著清單頁會一直打這些，每次都清就等於沒有快取。
// ⚠️ 只放「確定不寫任何資料」的 type。doPost 結尾有 memo/url 的 fall-through
//（不認得的 type 帶著 key 進來其實會寫資料），所以名單寧可短，不要放沒查證過的名字。
const READONLY_POST_TYPES_RE = /^(acct-list|brand-db-list|brand-db-lookup|vendor-db-list|perm-list|pnote-list|pr-item-list|image-list|image-folder-list|image-usage-check|stat-report)$/;

function doPost(e) {
  REQ_CACHE_ = {}; // 防執行環境重用：每個請求一定從空快取開始
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (parseErr) {
    return jsonResult_({ success: false, error: '請求格式錯誤' });
  }
  const type = String(body.type || '');

  // 登入不排隊搶全域鎖：圖片上傳／同步等長工作會佔住鎖數十秒，登入排隊超過等待時間就會回
  // 「鎖定逾時」把所有人擋在門外。登入只是讀員工名單＋append 一列 session，沒有需要序列化的讀改寫。
  if (type === 'login') {
    try {
      return handleLogin_(body);
    } catch (err) {
      return jsonResult_({ success: false, error: String(err) });
    }
  }

  // 瀏覽／點擊統計是前台每次載入都會打的純計數：搶不到鎖就直接放棄這一筆，
  // 不要排隊，否則公開頁流量會把鎖的隊伍塞滿，連帶拖垮後台操作。
  // stat-batch 是 2026-07-31 加的批次版：前台把 1.5 秒內累積的統計併成一次送，
  // 十幾次執行作業變一次。舊的單筆 stat-view／stat-click 保留，前台改版前後都收得到。
  if (type === 'stat-view' || type === 'stat-click' || type === 'stat-batch') {
    const statLock = LockService.getScriptLock();
    if (!statLock.tryLock(3000)) return jsonResult_({ success: false, busy: true });
    try {
      if (type === 'stat-batch') {
        const rawItems = Array.isArray(body.items) ? body.items.slice(0, STAT_BATCH_MAX_ITEMS) : [];
        if (!rawItems.length) return jsonResult_({ success: false, error: '缺少 items' });
        const writtenCount = incrementStats_(rawItems);
        // 整批 key 全部無效時回 false，跟單筆路徑的語意一致（前端不看回應，但除錯時不要被騙）
        return jsonResult_({ success: writtenCount > 0, written: writtenCount });
      }
      const statKey = String(body.key || '').trim();
      if (!statKey) return jsonResult_({ success: false, error: '缺少 key' });
      return jsonResult_({ success: incrementStat_(statKey, type === 'stat-click' ? 'clicks' : 'views') });
    } catch (err) {
      return jsonResult_({ success: false, error: String(err) });
    } finally {
      try { statLock.releaseLock(); } catch (e2) {}
    }
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return jsonResult_({ success: false, busy: true, error: '系統忙碌中（可能有人正在上傳圖片或同步資料），請等幾秒再操作一次' });
  }
  try {
    if (type === 'task-quick-add') {
      const secret = PropertiesService.getScriptProperties().getProperty('QUICK_ADD_SECRET');
      if (!secret || String(body.secret || '') !== secret) {
        return jsonResult_({ success: false, error: '驗證失敗' });
      }
      const to = String(body.to || '').trim();
      const source = String(body.source || '').trim();
      const customerName = String(body.customerName || '').trim();
      const question = String(body.question || '').trim();
      if (!to || !question) {
        return jsonResult_({ success: false, error: '缺少必要欄位' });
      }
      // 只允許寫入既有的任務分頁，避免打錯名字時自動建出新分頁
      if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TASK_SHEET_PREFIX + to)) {
        return jsonResult_({ success: false, error: '找不到派遣對象' });
      }
      const lines = [];
      if (source) lines.push('來源：' + source);
      if (customerName) lines.push('客人：' + customerName);
      lines.push('問題：' + question);
      const id = addTask_(to, '手機捷徑', '顧客提問', lines.join('\n'), false, null, '');
      return jsonResult_({ success: true, id: id });
    }

    const token = String(body.token || '');
    const currentUser = getSessionUser_(token);
    if (!currentUser) {
      return jsonResult_({ success: false, error: '未登入或登入逾時，請重新登入', needLogin: true });
    }

    // ===== 【新】權限閘門 =====
    // 集中在這裡擋，避免每個 if 分支各自漏擋。前端也會依權限藏入口，
    // 但那只是體驗；**真正的防線是這一段**——直接打 API 一樣過不去。
    const myPerms = getPermissionsFor_(currentUser);
    const allows_ = function (key) { return isAdmin_(currentUser) || !!myPerms[key]; };
    const PERM_RULES = [
      { re: /^stat-report$/,                          key: 'report',          msg: '你沒有報表統計的權限' },
      { re: /^(brand-db|vendor-db)-(add|update|delete)$/, key: 'brandVendorEdit', msg: '你只能查看品牌廠商資料，不能修改' },
      { re: /^event-(add|update|delete)$/,            key: 'calendarEdit',    msg: '你沒有行事曆的編輯權限' },
      { re: /^social-link-set$/,                      key: 'system',          msg: '你沒有系統設定的權限' }
    ];
    // 帳務：業績、分潤、acctRecon（對帳）三種權限，只要有其中一種就進得來（欄位/列層級再各自遮蔽）。
    // 三種都沒有的人，連清單都拿不到。
    // 用上面已經算好的 myPerms／allows_，不要再呼叫一次 getPermissionsFor_：
    // 那個函式每次都會整表掃描＋逐格讀取，一個請求重複算三次會拖慢所有人。
    if (/^acct-/.test(type) && !allows_('revenue') && !allows_('commission') && !allows_('acctRecon')) {
      return jsonResult_({ success: false, error: '你沒有查看開團帳務的權限，如果需要請跟雪莉申請開通。' });
    }
    for (let ri = 0; ri < PERM_RULES.length; ri++) {
      const rule = PERM_RULES[ri];
      if (rule.re.test(type) && !allows_(rule.key)) {
        return jsonResult_({ success: false, error: rule.msg + '，如果需要請跟雪莉申請開通。' });
      }
    }

    if (type === 'stat-report') {
      return jsonResult_({ success: true, ok: true, stats: getStatsMap_() });
    }

    if (type === 'change-password') {
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (!oldPassword || !newPassword) {
        return jsonResult_({ success: false, error: '請輸入舊密碼與新密碼' });
      }
      if (!isPasswordValid_(newPassword)) {
        return jsonResult_({ success: false, error: '新密碼至少需要6碼，並包含大寫英文、小寫英文、數字各一個' });
      }
      const staff = getStaff_();
      const me = staff.find(function (s) { return s.name === currentUser; });
      if (!me) {
        return jsonResult_({ success: false, error: '找不到使用者資料' });
      }
      if (!verifyPassword_(oldPassword, me.salt, me.hash)) {
        return jsonResult_({ success: false, error: '舊密碼不正確' });
      }
      setStaffPassword_(currentUser, newPassword);
      return jsonResult_({ success: true });
    }

    if (type === 'perm-list') {
      if (!isAdmin_(currentUser)) return jsonResult_({ success: false, error: '只有管理員能查看權限設定' });
      return jsonResult_({
        success: true,
        staff: getStaff_().map(s => s.name).filter(n => !isAdmin_(n)),
        permissions: getAllPermissions_(),
        // defs / roles 一起吐給前端，權限設定頁完全照這份渲染
        // ——以後要加權限項目只改 PERM_DEFS，前端不用動
        defs: PERM_DEFS,
        roleNames: ROLE_NAMES,
        rolePresets: ROLE_PRESETS,
        roles: getAllRoles_()
      });
    }

    if (type === 'perm-set') {
      if (!isAdmin_(currentUser)) return jsonResult_({ success: false, error: '只有管理員能修改權限設定' });
      const name = String(body.name || '').trim();
      const key = String(body.key || '').trim();
      if (!name || !key) return jsonResult_({ success: false, error: '缺少姓名或權限項目' });
      if (isAdmin_(name)) return jsonResult_({ success: false, error: '管理員本身不需要另外設定權限' });
      try {
        setPermission_(name, key, !!body.value);
        return jsonResult_({ success: true });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    // 套用角色：把該角色的預設值一次寫進那位員工的每一格，之後仍可單獨微調某一項
    if (type === 'perm-set-role') {
      if (!isAdmin_(currentUser)) return jsonResult_({ success: false, error: '只有管理員能修改權限設定' });
      const name = String(body.name || '').trim();
      const role = String(body.role || '').trim();
      if (!name || !role) return jsonResult_({ success: false, error: '缺少姓名或角色' });
      if (isAdmin_(name)) return jsonResult_({ success: false, error: '管理員本身不需要另外設定權限' });
      try {
        setStaffRole_(name, role);
        return jsonResult_({ success: true, permissions: getPermissionsFor_(name) });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'social-link-set') {
      const fields = {};
      SOCIAL_LINK_KEYS.forEach(key => {
        if (body[key] !== undefined) fields[key] = String(body[key]);
      });
      setSocialLinks_(fields);
      return jsonResult_({ success: true });
    }

    // 【新】團購廠商資料庫
    if (type === 'vendor-db-list') {
      return jsonResult_({ success: true, items: getVendorDbList_() });
    }
    if (type === 'vendor-db-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '請輸入廠商名稱' });
      const id = addVendorDb_({
        name: name,
        type: String(body.vendorType || ''),
        remittanceMethod: String(body.remittanceMethod || ''),
        remittanceRule: String(body.remittanceRule || ''),
        contact: String(body.contact || ''),
        note: String(body.note || ''),
        companyNames: String(body.companyNames || ''),
        longTerm: body.longTerm ? '是' : '',
        ended: body.ended ? '是' : '',
        endReason: String(body.endReason || ''),
        archived: body.archived ? '是' : ''
      });
      return jsonResult_({ success: true, id: id });
    }
    if (type === 'vendor-db-update') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少廠商資訊' });
      const fields = {};
      if (body.name !== undefined) fields.name = String(body.name);
      if (body.vendorType !== undefined) fields.type = String(body.vendorType);
      if (body.remittanceMethod !== undefined) fields.remittanceMethod = String(body.remittanceMethod);
      if (body.remittanceRule !== undefined) fields.remittanceRule = String(body.remittanceRule);
      if (body.contact !== undefined) fields.contact = String(body.contact);
      if (body.note !== undefined) fields.note = String(body.note);
      if (body.companyNames !== undefined) fields.companyNames = String(body.companyNames);
      if (body.longTerm !== undefined) fields.longTerm = body.longTerm ? '是' : '';
      if (body.ended !== undefined) fields.ended = body.ended ? '是' : '';
      if (body.endReason !== undefined) fields.endReason = String(body.endReason);
      if (body.archived !== undefined) fields.archived = body.archived ? '是' : '';
      const ok = updateVendorDb_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個廠商' });
    }
    if (type === 'vendor-db-delete') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少廠商資訊' });
      // 只把這家廠商從品牌的廠商清單移掉，其他廠商連結保留
      const brands = getBrandDbList_().filter(b => b.vendorIds.indexOf(id) !== -1);
      brands.forEach(b => updateBrandDb_(b.id, {
        vendorIds: b.vendorIds.filter(function (vid) { return vid !== id; })
      }));
      const ok = deleteVendorDb_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個廠商' });
    }

    // 【新】團購品牌資料庫
    // ===== 【新】開團帳務 =====
    if (type === 'acct-list') {
      return jsonResult_({
        success: true,
        items: getAccountingListFor_(currentUser),
        canRevenue: allows_('revenue'),
        canCommission: allows_('commission'),
        canRecon: allows_('acctRecon'),
        statuses: ACCT_STATUSES,
        reconStatuses: ACCT_RECON_STATUSES
      });
    }
    if (type === 'acct-add' || type === 'acct-update') {
      // acctRecon 但沒有 revenue：只能改「對帳未完成」的既有列，不能新增（新增等於能無中生有一筆歷史帳）。
      const reconOnly = !allows_('revenue') && allows_('acctRecon');
      if (type === 'acct-add' && !allows_('revenue')) {
        return jsonResult_({ success: false, error: '需要業績權限才能新增帳務' });
      }
      const fields = {};
      const put = (k, v) => { if (v !== undefined) fields[k] = v; };
      put('date', body.date === undefined ? undefined : String(body.date));
      put('brandId', body.brandId === undefined ? undefined : String(body.brandId));
      put('rawName', body.rawName === undefined ? undefined : String(body.rawName));
      put('contFrom', body.contFrom === undefined ? undefined : String(body.contFrom));
      put('vendorId', body.vendorId === undefined ? undefined : String(body.vendorId));
      put('company', body.company === undefined ? undefined : String(body.company));
      put('status', body.status === undefined ? undefined : String(body.status));
      put('payTo', body.payTo === undefined ? undefined : String(body.payTo));
      put('payDate', body.payDate === undefined ? undefined : String(body.payDate));
      put('invoice', body.invoice === undefined ? undefined : String(body.invoice));
      // 沒有對應權限就當作沒送，既有值不會被覆寫掉。
      // 界線同 stripAccounting_：金額全歸業績，成數才歸分潤。acctRecon（reconOnly）視同業績側，
      // 因為要幫忙回填業績、跟會計核對，沒有金額欄位沒辦法做事。
      if (allows_('revenue') || reconOnly) {
        put('sales', body.sales);
        put('commission', body.commission);
        put('fee', body.fee);
        // 稅外加是業績側的欄位（影響分潤金額怎麼算），要跟金額同一個權限
        if (body.taxAdded !== undefined) fields.taxAdded = !!body.taxAdded;
        put('brandSplit', body.brandSplit === undefined ? undefined : String(body.brandSplit));
        put('note', body.note === undefined ? undefined : String(body.note));
      }
      // 分潤%與分潤說明維持只認 commission，不因 acctRecon 放寬——經紀人助理本來就可能兩者都有，
      // 但 reconOnly（沒有 revenue）不代表就有 commission，兩個權限各自獨立判斷。
      if (allows_('commission')) {
        put('rate', body.rate);
        put('rateNote', body.rateNote === undefined ? undefined : String(body.rateNote));
      }
      // 對帳狀態：業績權限或 reconOnly 都能改；非法值整筆回錯誤，不靜默改成空白
      // （空白＝對帳完成，語意太重，不能因為打錯字就被默默標記完成）。
      if (body.reconStatus !== undefined && (allows_('revenue') || reconOnly)) {
        const rs = String(body.reconStatus);
        if (rs !== '' && ACCT_RECON_STATUSES.indexOf(rs) === -1) {
          return jsonResult_({ success: false, error: '對帳狀態不合法：' + rs });
        }
        fields.reconStatus = rs;
      }
      if (type === 'acct-add') {
        if (!fields.date) return jsonResult_({ success: false, error: '請選擇開團日期' });
        if (!fields.brandId) return jsonResult_({ success: false, error: '請選擇品牌' });
        return jsonResult_({ success: true, id: addAccounting_(fields, currentUser) });
      }
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少紀錄編號' });
      if (reconOnly) {
        // 伺服器端重讀目前的對帳狀態，不信前端送來的值：已完成對帳（空白）的列，
        // 只有業績權限才能再動，acctRecon-only 整筆擋掉，不寫任何欄位。
        const sheet = getAccountingSheet_();
        const row = findAcctRowById_(sheet, id);
        if (row === -1) return jsonResult_({ success: false, error: '找不到這筆紀錄' });
        const curRecon = String(sheet.getRange(row, ACCT_COL.RECON).getValue() || '').trim();
        if (curRecon === '') {
          return jsonResult_({ success: false, error: '此筆已完成對帳，僅業績權限可修改' });
        }
      }
      const ok = updateAccounting_(id, fields, currentUser);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆紀錄' });
    }
    if (type === 'acct-delete') {
      if (!isAdmin_(currentUser)) return jsonResult_({ success: false, error: '只有管理員能刪除帳務紀錄' });
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少紀錄編號' });
      const ok = deleteAccounting_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆紀錄' });
    }

    if (type === 'brand-db-list') {
      return jsonResult_({ success: true, items: getBrandDbListFor_(currentUser) });
    }
    if (type === 'brand-db-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '請輸入品牌名稱' });
      const id = addBrandDb_({
        vendorIds: Array.isArray(body.vendorIds) ? body.vendorIds.map(String) : splitIds_(body.vendorIds),
        name: name,
        thumbUrl: String(body.thumbUrl || ''),
        lineContact: String(body.lineContact || ''),
        emailContact: String(body.emailContact || ''),
        igContact: String(body.igContact || ''),
        note: String(body.note || ''),
        showInRecipe: body.showInRecipe ? '是' : '',
        intro: String(body.intro || ''),
        brandImageUrl: String(body.brandImageUrl || ''),
        shopeeUrl: String(body.shopeeUrl || ''),
        // 沒有分潤權限的人就算硬送這兩個欄位也寫不進去
        commissionRate: allows_('commission') ? body.commissionRate : '',
        commissionNote: allows_('commission') ? String(body.commissionNote || '') : '',
        longTerm: body.longTerm ? '是' : '',
        ended: body.ended ? '是' : '',
        endReason: String(body.endReason || ''),
        postTemplate: String(body.postTemplate || '')
      });
      return jsonResult_({ success: true, id: id });
    }
    if (type === 'brand-db-update') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少品牌資訊' });
      const fields = {};
      if (body.vendorIds !== undefined) {
        fields.vendorIds = Array.isArray(body.vendorIds) ? body.vendorIds.map(String) : splitIds_(body.vendorIds);
      }
      if (body.name !== undefined) fields.name = String(body.name);
      if (body.thumbUrl !== undefined) fields.thumbUrl = String(body.thumbUrl);
      if (body.lineContact !== undefined) fields.lineContact = String(body.lineContact);
      if (body.emailContact !== undefined) fields.emailContact = String(body.emailContact);
      if (body.igContact !== undefined) fields.igContact = String(body.igContact);
      if (body.note !== undefined) fields.note = String(body.note);
      if (body.showInRecipe !== undefined) fields.showInRecipe = body.showInRecipe ? '是' : '';
      if (body.intro !== undefined) fields.intro = String(body.intro);
      if (body.brandImageUrl !== undefined) fields.brandImageUrl = String(body.brandImageUrl);
      if (body.shopeeUrl !== undefined) fields.shopeeUrl = String(body.shopeeUrl);
      // 同上：沒權限就當作沒送，既有的分潤資料不會被覆寫掉
      if (allows_('commission')) {
        if (body.commissionRate !== undefined) fields.commissionRate = body.commissionRate;
        if (body.commissionNote !== undefined) fields.commissionNote = String(body.commissionNote);
      }
      if (body.longTerm !== undefined) fields.longTerm = body.longTerm ? '是' : '';
      if (body.ended !== undefined) fields.ended = body.ended ? '是' : '';
      if (body.endReason !== undefined) fields.endReason = String(body.endReason);
      if (body.postTemplate !== undefined) fields.postTemplate = String(body.postTemplate);
      const ok = updateBrandDb_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個品牌' });
    }
    if (type === 'brand-db-delete') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少品牌資訊' });
      const ok = deleteBrandDb_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個品牌' });
    }
    if (type === 'brand-db-lookup') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: true, match: null });
      const match = findBrandDbByExactName_(name);
      return jsonResult_({ success: true, match: match });
    }

    if (type === 'pnote-list') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      return jsonResult_({
        success: true,
        folders: getPnoteFoldersFor_(scope, currentUser),
        notes: getPnotesFor_(scope, currentUser)
      });
    }

    if (type === 'pnote-folder-add') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '請輸入資料夾名稱' });
      const parentFolderId = String(body.parentFolderId || '').trim();
      const id = addPnoteFolder_(scope, currentUser, name, parentFolderId);
      return jsonResult_({ success: true, folder: { id: id, name: name, parentFolderId: parentFolderId } });
    }

    if (type === 'pnote-folder-delete') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      const folderId = String(body.folderId || '').trim();
      if (!folderId) return jsonResult_({ success: false, error: '缺少資料夾資訊' });
      const ok = deletePnoteFolder_(scope, currentUser, folderId);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個資料夾' });
    }

    if (type === 'pnote-add') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      const folderId = String(body.folderId || '').trim();
      const id = addPnote_(scope, currentUser, folderId, body.text);
      return jsonResult_({ success: true, note: { id: id, folderId: folderId, text: String(body.text || '') } });
    }

    if (type === 'pnote-update') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      const noteId = String(body.noteId || '').trim();
      if (!noteId) return jsonResult_({ success: false, error: '缺少備忘錄資訊' });
      const fields = {};
      if (body.text !== undefined) fields.text = body.text;
      if (body.folderId !== undefined) fields.folderId = body.folderId;
      const ok = updatePnote_(scope, currentUser, noteId, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這則備忘錄' });
    }

    if (type === 'pnote-delete') {
      const scope = body.scope === 'shared' ? 'shared' : 'personal';
      const noteId = String(body.noteId || '').trim();
      if (!noteId) return jsonResult_({ success: false, error: '缺少備忘錄資訊' });
      const ok = deletePnote_(scope, currentUser, noteId);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這則備忘錄' });
    }

    if (type === 'task-add') {
      const to = String(body.to || '').trim();
      const taskName = String(body.taskName || '').trim();
      if (!to || !taskName) return jsonResult_({ success: false, error: '缺少派遣對象或任務名稱' });
      const dateStr = String(body.date || '').trim();
      const id = addTask_(to, currentUser, taskName, String(body.content || ''), !!body.urgent, body.extra, dateStr);
      return jsonResult_({ success: true, id: id });
    }

    if (type === 'task-urgent') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      if (!owner || !id) return jsonResult_({ success: false, error: '缺少任務資訊' });
      const ok = setTaskUrgent_(owner, id, !!body.urgent);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'task-done') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      if (!owner || !id) return jsonResult_({ success: false, error: '缺少任務資訊' });
      const ok = setTaskStatus_(owner, id, body.done ? '已完成' : '待完成');
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'task-status') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      const status = String(body.status || '').trim();
      if (!owner || !id) return jsonResult_({ success: false, error: '缺少任務資訊' });
      const ok = setTaskStatus_(owner, id, status);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務或狀態錯誤' });
    }

    if (type === 'task-memo') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      if (!owner || !id) return jsonResult_({ success: false, error: '缺少任務資訊' });
      const ok = setTaskMemo_(owner, id, body.text);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'task-stage-add') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      const text = String(body.text || '').trim();
      if (!owner || !id || !text) return jsonResult_({ success: false, error: '缺少階段內容' });
      const stageId = addTaskStage_(owner, id, text);
      return jsonResult_(stageId ? { success: true, stageId: stageId } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'task-stage-delete') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      const stageId = String(body.stageId || '').trim();
      if (!owner || !id || !stageId) return jsonResult_({ success: false, error: '缺少階段資訊' });
      const ok = deleteTaskStage_(owner, id, stageId);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆階段紀錄' });
    }

    if (type === 'task-bounce-add') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      const text = String(body.text || '').trim();
      if (!owner || !id || !text) return jsonResult_({ success: false, error: '缺少回派內容' });
      const ok = addTaskBounce_(owner, id, currentUser, text);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'task-delete') {
      const owner = String(body.owner || '').trim();
      const id = String(body.id || '').trim();
      if (!owner || !id) return jsonResult_({ success: false, error: '缺少任務資訊' });
      const ok = deleteTask_(owner, id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆任務' });
    }

    if (type === 'taskname-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '缺少任務名稱' });
      addTaskName_(name);
      return jsonResult_({ success: true });
    }

    if (type === 'my-taskname-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '缺少任務名稱' });
      if (getTaskNames_().indexOf(name) === -1) {
        addMyTaskName_(currentUser, name);
      }
      return jsonResult_({ success: true });
    }

    if (type === 'my-taskname-delete') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '缺少任務名稱' });
      const ok = deleteMyTaskName_(currentUser, name);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個任務名稱' });
    }

    if (type === 'pr-status') {
      const key = String(body.key || '').trim();
      if (!key) return jsonResult_({ success: false, error: '缺少團購 key' });
      const fields = {};
      if (body.status != null) fields.status = String(body.status);
      if (body.url != null) fields.url = String(body.url);
      if (body.location != null) fields.location = String(body.location);
      upsertPrStatus_(key, fields);
      return jsonResult_({ success: true });
    }

    if (type === 'pr-location-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '缺少位置名稱' });
      addPrLocation_(name);
      return jsonResult_({ success: true });
    }

    if (type === 'pr-item-list') {
      return jsonResult_({ success: true, items: getPrItems_() });
    }

    if (type === 'pr-item-add') {
      const fields = {
        name: String(body.name || '').trim(),
        vendor: String(body.vendor || '').trim(),
        brand: String(body.brand || '').trim(),
        group: String(body.group || '').trim(),
        location: String(body.location || '').trim(),
        note: String(body.note || '').trim(),
        evKey: String(body.evKey || '').trim(),
        category: String(body.category || '').trim()
      };
      if (!fields.name) return jsonResult_({ success: false, error: '請至少輸入名稱' });
      const id = addPrItem_(fields);
      return jsonResult_({ success: true, id: id });
    }

    if (type === 'pr-item-update') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少公關品資訊' });
      const fields = {};
      ['name', 'vendor', 'brand', 'group', 'location', 'note', 'evKey', 'category'].forEach(function (k) {
        if (body[k] !== undefined) fields[k] = String(body[k]);
      });
      const ok = updatePrItem_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆資料' });
    }

    if (type === 'pr-item-delete') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少公關品資訊' });
      const ok = deletePrItem_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆資料' });
    }

    if (type === 'pr-item-sync') {
      const evKey = String(body.evKey || '').trim();
      if (!evKey) return jsonResult_({ success: false, error: '缺少對應團購資訊' });
      const fields = {};
      ['name', 'vendor', 'brand', 'group', 'location', 'note'].forEach(function (k) {
        if (body[k] !== undefined) fields[k] = String(body[k]);
      });
      // 一場團購可以有多件公關品：已經建過就不再覆寫（避免蓋掉手動填的品牌／備註）
      const existing = findPrItemRowByEvKey_(evKey);
      if (existing !== -1) {
        const sheet = getPrItemSheet_();
        return jsonResult_({ success: true, id: String(sheet.getRange(existing, 1).getValue()), skipped: true });
      }
      const id = upsertPrItemByEvKey_(evKey, fields);
      return jsonResult_({ success: true, id: id });
    }

    if (type === 'todo-category-add') {
      const name = String(body.name || '').trim();
      if (!name) return jsonResult_({ success: false, error: '缺少主選項名稱' });
      addTodoCategory_(name);
      return jsonResult_({ success: true });
    }

    if (type === 'todo-add') {
      const category = String(body.category || '').trim();
      if (!category) return jsonResult_({ success: false, error: '請選擇主選項' });
      const fields = {
        category: category,
        title: String(body.title || ''),
        content: String(body.content || ''),
        brand: String(body.brand || ''),
        stage: String(body.stage || ''),
        groupStart: String(body.groupStart || ''),
        groupEnd: String(body.groupEnd || ''),
        month: String(body.month || ''),
        priority: String(body.priority || '')
      };
      const id = addTodo_(fields, currentUser);
      return jsonResult_({ success: true, id: id });
    }

    if (type === 'todo-update') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少待辦事項資訊' });
      const fields = {};
      ['category', 'title', 'content', 'brand', 'stage', 'groupStart', 'groupEnd', 'month', 'priority'].forEach(function (k) {
        if (body[k] !== undefined) fields[k] = String(body[k]);
      });
      if (body.addedToCalendar !== undefined) fields.addedToCalendar = !!body.addedToCalendar;
      const ok = updateTodo_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆待辦事項' });
    }

    if (type === 'todo-delete') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少待辦事項資訊' });
      const ok = deleteTodo_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這筆待辦事項' });
    }

    if (type === 'event-add') {
      const title = String(body.title || '').trim();
      if (!title) return jsonResult_({ success: false, error: '請輸入標題' });
      if (!body.start || !body.end) return jsonResult_({ success: false, error: '請選擇開始與結束日期' });
      try {
        const id = addEvent_({
          title: title,
          start: body.start,
          end: body.end,
          color: body.color || '',
          allDay: !!body.allDay,
          startTime: body.startTime || '',
          endTime: body.endTime || '',
          isGroupBuy: !!body.isGroupBuy,
          published: !!body.published,
          url: body.url || '',
          category: body.category || '',
          tag: body.tag || '',
          extend: body.extend === undefined ? '' : body.extend,
          earlyBird: body.earlyBird || '',
          iconIg: body.iconIg || '',
          iconTiktok: body.iconTiktok || '',
          iconFb: body.iconFb || '',
          iconEmail: body.iconEmail || '',
          matchItems: body.matchItems || '',
          thumbUrl: body.thumbUrl || '',
          discountCode: body.discountCode || '',
          discountDesc: body.discountDesc || ''
        });
        return jsonResult_({ success: true, id: id });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'event-update') {
      const id = body.id;
      if (id === undefined || id === null || id === '') return jsonResult_({ success: false, error: '缺少活動資訊' });
      const fields = {};
      if (body.title !== undefined) fields.title = String(body.title);
      if (body.start !== undefined) fields.start = body.start;
      if (body.end !== undefined) fields.end = body.end;
      if (body.color !== undefined) fields.color = String(body.color);
      if (body.allDay !== undefined) fields.allDay = !!body.allDay;
      if (body.startTime !== undefined) fields.startTime = String(body.startTime);
      if (body.endTime !== undefined) fields.endTime = String(body.endTime);
      if (body.isGroupBuy !== undefined) fields.isGroupBuy = !!body.isGroupBuy;
      if (body.published !== undefined) fields.published = !!body.published;
      if (body.tag !== undefined) fields.tag = String(body.tag);
      if (body.extend !== undefined) fields.extend = body.extend;
      if (body.earlyBird !== undefined) fields.earlyBird = String(body.earlyBird);
      if (body.url !== undefined) fields.url = String(body.url);
      if (body.category !== undefined) fields.category = String(body.category);
      if (body.iconIg !== undefined) fields.iconIg = String(body.iconIg);
      if (body.iconTiktok !== undefined) fields.iconTiktok = String(body.iconTiktok);
      if (body.iconFb !== undefined) fields.iconFb = String(body.iconFb);
      if (body.iconEmail !== undefined) fields.iconEmail = String(body.iconEmail);
      if (body.matchItems !== undefined) fields.matchItems = String(body.matchItems);
      if (body.thumbUrl !== undefined) fields.thumbUrl = String(body.thumbUrl);
      if (body.discountCode !== undefined) fields.discountCode = String(body.discountCode);
      if (body.discountDesc !== undefined) fields.discountDesc = String(body.discountDesc);
      const ok = updateEvent_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個活動' });
    }

    if (type === 'event-delete') {
      const id = body.id;
      if (id === undefined || id === null || id === '') return jsonResult_({ success: false, error: '缺少活動資訊' });
      const ok = deleteEvent_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個活動' });
    }

    if (type === 'block-add') {
      const title = String(body.title || '').trim();
      if (!title) return jsonResult_({ success: false, error: '請輸入標題' });
      try {
        const id = addCustomBlock_({
          type: body.blockType || 'text_button',
          title: title,
          titleSize: body.titleSize || '中',
          subtitleOn: !!body.subtitleOn,
          subtitle: body.subtitle || '',
          buttonColor: body.buttonColor || '#FF8FA3',
          borderStyle: body.borderStyle || '無',
          borderWidth: body.borderWidth || 0,
          borderColor: body.borderColor || '#FFFFFF',
          textColor: body.textColor || '#FFFFFF',
          url: body.url || '',
          animation: body.animation || '無',
          position: body.position || 'after',
          enabled: body.enabled !== false
        });
        return jsonResult_({ success: true, id: id });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'block-update') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少區塊資訊' });
      const fields = {};
      if (body.title !== undefined) fields.title = String(body.title);
      if (body.titleSize !== undefined) fields.titleSize = String(body.titleSize);
      if (body.subtitleOn !== undefined) fields.subtitleOn = !!body.subtitleOn;
      if (body.subtitle !== undefined) fields.subtitle = String(body.subtitle);
      if (body.buttonColor !== undefined) fields.buttonColor = String(body.buttonColor);
      if (body.borderStyle !== undefined) fields.borderStyle = String(body.borderStyle);
      if (body.borderWidth !== undefined) fields.borderWidth = body.borderWidth;
      if (body.borderColor !== undefined) fields.borderColor = String(body.borderColor);
      if (body.textColor !== undefined) fields.textColor = String(body.textColor);
      if (body.url !== undefined) fields.url = String(body.url);
      if (body.animation !== undefined) fields.animation = String(body.animation);
      if (body.position !== undefined) fields.position = String(body.position);
      if (body.enabled !== undefined) fields.enabled = !!body.enabled;
      const ok = updateCustomBlock_(id, fields);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個區塊' });
    }

    if (type === 'block-delete') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少區塊資訊' });
      const ok = deleteCustomBlock_(id);
      return jsonResult_(ok ? { success: true } : { success: false, error: '找不到這個區塊' });
    }

    if (type === 'block-duplicate') {
      const id = String(body.id || '').trim();
      if (!id) return jsonResult_({ success: false, error: '缺少區塊資訊' });
      const newId = duplicateCustomBlock_(id);
      return jsonResult_(newId ? { success: true, id: newId } : { success: false, error: '找不到這個區塊' });
    }

    if (type === 'block-move') {
      const id = String(body.id || '').trim();
      const direction = body.direction === 'up' ? 'up' : 'down';
      if (!id) return jsonResult_({ success: false, error: '缺少區塊資訊' });
      const ok = moveCustomBlock_(id, direction);
      return jsonResult_({ success: true, moved: ok });
    }

    if (type.indexOf('image-') === 0) {
      const perms = getPermissionsFor_(currentUser);
      if (!isAdmin_(currentUser) && !perms.imageLibrary) {
        return jsonResult_({ success: false, error: '你沒有圖片庫的使用權限' });
      }
    }

    if (type === 'image-folder-list') {
      try {
        return jsonResult_({ success: true, folders: listGithubFoldersRecursive_('', 2) });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-repair-webp-refs') {
      try {
        const result = repairWebpReferences_();
        return jsonResult_({ success: true, updated: result.updated });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-list') {
      const path = String(body.path || 'images').trim();
      try {
        return jsonResult_({ success: true, files: listGithubFilesRecursive_(path) });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-upload') {
      const folder = String(body.folder || 'images').replace(/^\/+|\/+$/g, '');
      const filenameRaw = String(body.filename || '').trim();
      const dataBase64 = String(body.dataBase64 || '');
      if (!filenameRaw || !dataBase64) return jsonResult_({ success: false, error: '缺少檔案內容' });
      const filename = sanitizeFileName_(filenameRaw);
      const fullPath = folder + '/' + filename;
      try {
        const existing = githubGetFileMeta_(fullPath);
        githubPutFile_(fullPath, dataBase64, '後台上傳圖片：' + fullPath, existing ? existing.sha : undefined);
        return jsonResult_({ success: true, path: fullPath, download_url: GITHUB_RAW_BASE + '/' + fullPath, overwritten: !!existing });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-usage-check') {
      const path = String(body.path || '').trim();
      if (!path) return jsonResult_({ success: false, error: '缺少圖片路徑' });
      return jsonResult_({ success: true, refs: findImageReferences_(path), url: GITHUB_RAW_BASE + '/' + path });
    }

    if (type === 'image-rename') {
      const oldPath = String(body.oldPath || '').trim();
      const newFilenameRaw = String(body.newFilename || '').trim();
      if (!oldPath || !newFilenameRaw) return jsonResult_({ success: false, error: '缺少檔案資訊' });
      try {
        const meta = githubGetFileMeta_(oldPath);
        if (!meta) return jsonResult_({ success: false, error: '找不到原始檔案' });
        const folder = oldPath.split('/').slice(0, -1).join('/');
        const newFilename = sanitizeFileName_(newFilenameRaw);
        const newPath = (folder ? folder + '/' : '') + newFilename;
        githubPutFile_(newPath, meta.content.replace(/\n/g, ''), '改名：' + oldPath + ' → ' + newPath);
        githubDeleteFile_(oldPath, meta.sha, '改名（刪除舊檔）：' + oldPath);
        const updatedCount = replaceImageReferences_(oldPath, newPath);
        return jsonResult_({ success: true, newPath: newPath, download_url: GITHUB_RAW_BASE + '/' + newPath, updatedRefs: updatedCount });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-delete') {
      const path = String(body.path || '').trim();
      if (!path) return jsonResult_({ success: false, error: '缺少圖片路徑' });
      try {
        const meta = githubGetFileMeta_(path);
        if (!meta) return jsonResult_({ success: false, error: '找不到這個檔案' });
        githubDeleteFile_(path, meta.sha, '後台刪除圖片：' + path);
        return jsonResult_({ success: true });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-move') {
      const oldPath = String(body.oldPath || '').trim();
      const newFolder = String(body.newFolder || '').trim().replace(/^\/+|\/+$/g, '');
      if (!oldPath || !newFolder) return jsonResult_({ success: false, error: '缺少檔案或目標資料夾' });
      try {
        const meta = githubGetFileMeta_(oldPath);
        if (!meta) return jsonResult_({ success: false, error: '找不到原始檔案' });
        const filename = oldPath.split('/').pop();
        const newPath = newFolder + '/' + filename;
        if (newPath === oldPath) return jsonResult_({ success: false, error: '目標資料夾跟原本相同' });
        githubPutFile_(newPath, meta.content.replace(/\n/g, ''), '搬移：' + oldPath + ' → ' + newPath);
        githubDeleteFile_(oldPath, meta.sha, '搬移（刪除舊檔）：' + oldPath);
        const updatedCount = replaceImageReferences_(oldPath, newPath);
        return jsonResult_({ success: true, newPath: newPath, download_url: GITHUB_RAW_BASE + '/' + newPath, updatedRefs: updatedCount });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    if (type === 'image-add-webp-version') {
      const oldPath = String(body.oldPath || '').trim();
      const dataBase64 = String(body.dataBase64 || '');
      if (!oldPath || !dataBase64) return jsonResult_({ success: false, error: '缺少檔案資訊' });
      try {
        const dotIdx = oldPath.lastIndexOf('.');
        const newPath = (dotIdx === -1 ? oldPath : oldPath.slice(0, dotIdx)) + '.webp';
        githubPutFile_(newPath, dataBase64, 'WebP 轉檔：' + oldPath + ' → ' + newPath);
        const updatedCount = replaceImageReferences_(oldPath, newPath);
        return jsonResult_({ success: true, newPath: newPath, download_url: GITHUB_RAW_BASE + '/' + newPath, updatedRefs: updatedCount });
      } catch (err) {
        return jsonResult_({ success: false, error: String(err) });
      }
    }

    const key = String(body.key || '').trim();
    const text = body.text || '';
    const kvType = body.type === 'url' ? 'url' : 'memo';

    if (!key) return jsonResult_({ success: false, error: 'missing key' });

    const sheet = kvType === 'url' ? getUrlSheet_() : getMemoSheet_();
    upsertKeyValue_(sheet, key, text);

    return jsonResult_({ success: true });
  } catch (err) {
    return jsonResult_({ success: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
    // 後台只要動過資料就把公開端點的快取清掉，客人下一次載入就是新的，不必等 TTL。
    // 寧可多清（最多就是下一個請求重讀一次試算表），也不要讓客人看到舊資料。
    if (!READONLY_POST_TYPES_RE.test(type)) {
      invalidatePublicCache_();
    }
  }
}

// ===== 任務系統 =====

function getTaskSheet_(ownerName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = TASK_SHEET_PREFIX + ownerName;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['id', '任務名稱', '內容', '緊急', '狀態', '派遣人', '建立時間', '完成時間', '備忘錄', '階段', '附加資料', '日期', '回派對話']);
    sheet.setFrozenRows(1);
  } else {
    if (!String(sheet.getRange(1, 9).getValue()).trim()) sheet.getRange(1, 9).setValue('備忘錄');
    if (!String(sheet.getRange(1, 10).getValue()).trim()) sheet.getRange(1, 10).setValue('階段');
    if (!String(sheet.getRange(1, 11).getValue()).trim()) sheet.getRange(1, 11).setValue('附加資料');
    if (!String(sheet.getRange(1, 12).getValue()).trim()) sheet.getRange(1, 12).setValue('日期');
    if (!String(sheet.getRange(1, 13).getValue()).trim()) sheet.getRange(1, 13).setValue('回派對話');
  }
  return sheet;
}

function fmtDateTime_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return Utilities.formatDate(d, 'Asia/Taipei', 'M/d HH:mm');
}

function getTasksFor_(ownerName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(TASK_SHEET_PREFIX + ownerName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const tasks = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    let status = String(row[4] || '').trim();
    if (status !== '處理中' && status !== '已完成' && status !== '回派中') status = '待完成';
    let stages = [];
    try {
      const parsed = JSON.parse(String(row[9] || '[]'));
      if (Array.isArray(parsed)) stages = parsed;
    } catch (errStage) { stages = []; }
    let extra = null;
    try {
      const parsedExtra = JSON.parse(String(row[10] || 'null'));
      if (parsedExtra && typeof parsedExtra === 'object') extra = parsedExtra;
    } catch (errExtra) { extra = null; }
    let bounces = [];
    try {
      const parsedBounce = JSON.parse(String(row[12] || '[]'));
      if (Array.isArray(parsedBounce)) bounces = parsedBounce;
    } catch (errBounce) { bounces = []; }
    tasks.push({
      id: String(row[0]),
      taskName: String(row[1] || ''),
      content: String(row[2] || ''),
      urgent: String(row[3]).trim() === '是',
      status: status,
      done: status === '已完成',
      from: String(row[5] || ''),
      created: row[6] instanceof Date ? fmtDateTime_(row[6]) : String(row[6] || ''),
      doneAt: row[7] instanceof Date ? fmtDateTime_(row[7]) : String(row[7] || ''),
      memo: String(row[8] || ''),
      stages: stages,
      extra: extra,
      date: row[11] instanceof Date ? Utilities.formatDate(row[11], 'Asia/Taipei', 'yyyy-MM-dd') : String(row[11] || ''),
      bounces: bounces
    });
  }
  return tasks;
}

function getAllTasks_() {
  const tasks = {};
  getStaff_().forEach(s => {
    tasks[s.name] = getTasksFor_(s.name);
  });
  return tasks;
}

function addTask_(to, from, taskName, content, urgent, extra, dateStr) {
  const sheet = getTaskSheet_(to);
  const id = 'T' + Date.now();
  const extraJson = extra && typeof extra === 'object' ? JSON.stringify(extra) : '';
  sheet.appendRow([id, taskName, content, urgent ? '是' : '否', '待完成', from, new Date(), '', '', '[]', extraJson, dateStr || '', '[]']);
  return id;
}

function setTaskUrgent_(owner, id, urgent) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  sheet.getRange(row, 4).setValue(urgent ? '是' : '否');
  return true;
}

function findTaskRow_(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function setTaskStatus_(owner, id, status) {
  if (status !== '待完成' && status !== '處理中' && status !== '已完成' && status !== '回派中') return false;
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  sheet.getRange(row, 5).setValue(status);
  sheet.getRange(row, 8).setValue(status === '已完成' ? new Date() : '');
  return true;
}

function setTaskMemo_(owner, id, text) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  sheet.getRange(row, 9).setValue(String(text || ''));
  return true;
}

function addTaskStage_(owner, id, text) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  let stages = [];
  try {
    const parsed = JSON.parse(String(sheet.getRange(row, 10).getValue() || '[]'));
    if (Array.isArray(parsed)) stages = parsed;
  } catch (errStage) { stages = []; }
  const stageId = 'S' + Date.now() + Math.floor(Math.random() * 1000);
  stages.push({ id: stageId, text: String(text || ''), time: fmtDateTime_(new Date()) });
  sheet.getRange(row, 10).setValue(JSON.stringify(stages));
  return stageId;
}

function deleteTaskStage_(owner, id, stageId) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  let stages = [];
  try {
    const parsed = JSON.parse(String(sheet.getRange(row, 10).getValue() || '[]'));
    if (Array.isArray(parsed)) stages = parsed;
  } catch (errStage) { stages = []; }
  const filtered = stages.filter(function (s) { return String(s.id) !== String(stageId); });
  if (filtered.length === stages.length) return false;
  sheet.getRange(row, 10).setValue(JSON.stringify(filtered));
  return true;
}

function addTaskBounce_(owner, id, fromName, text) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  let bounces = [];
  try {
    const parsed = JSON.parse(String(sheet.getRange(row, 13).getValue() || '[]'));
    if (Array.isArray(parsed)) bounces = parsed;
  } catch (errBounce) { bounces = []; }
  bounces.push({ from: fromName, text: String(text || ''), time: fmtDateTime_(new Date()) });
  sheet.getRange(row, 13).setValue(JSON.stringify(bounces));
  sheet.getRange(row, 5).setValue('回派中');
  return true;
}

function deleteTask_(owner, id) {
  const sheet = getTaskSheet_(owner);
  const row = findTaskRow_(sheet, id);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// ===== 備忘錄（個人／共用） =====

function getPnoteFolderSheetForScope_(scope) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = scope === 'shared' ? SPNOTE_FOLDER_SHEET_NAME : PNOTE_FOLDER_SHEET_NAME;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['id', '建立人', '資料夾名稱', '上層資料夾ID', '建立時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPnoteSheetForScope_(scope) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = scope === 'shared' ? SPNOTE_SHEET_NAME : PNOTE_SHEET_NAME;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['id', '建立人', '資料夾ID', '內容', '建立時間', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPnoteFoldersFor_(scope, name) {
  const sheet = getPnoteFolderSheetForScope_(scope);
  const data = sheet.getDataRange().getValues();
  const folders = [];
  for (let i = 1; i < data.length; i++) {
    const owner = String(data[i][1] || '').trim();
    if (scope === 'shared' || owner === name) {
      folders.push({
        id: String(data[i][0]),
        name: String(data[i][2] || ''),
        parentFolderId: String(data[i][3] || '')
      });
    }
  }
  return folders;
}

function getPnotesFor_(scope, name) {
  const sheet = getPnoteSheetForScope_(scope);
  const data = sheet.getDataRange().getValues();
  const notes = [];
  for (let i = 1; i < data.length; i++) {
    const owner = String(data[i][1] || '').trim();
    if (scope === 'shared' || owner === name) {
      notes.push({
        id: String(data[i][0]),
        folderId: String(data[i][2] || ''),
        text: String(data[i][3] || ''),
        updatedAt: data[i][5] instanceof Date ? fmtDateTime_(data[i][5]) : ''
      });
    }
  }
  return notes;
}

function addPnoteFolder_(scope, name, folderName, parentFolderId) {
  const sheet = getPnoteFolderSheetForScope_(scope);
  const id = Utilities.getUuid();
  sheet.appendRow([id, name, folderName, parentFolderId || '', new Date()]);
  return id;
}

function collectPnoteFolderIdsRecursive_(allFolders, rootId) {
  const result = [String(rootId)];
  let changed = true;
  while (changed) {
    changed = false;
    allFolders.forEach(f => {
      if (result.indexOf(f.id) === -1 && result.indexOf(f.parentFolderId) !== -1) {
        result.push(f.id);
        changed = true;
      }
    });
  }
  return result;
}

function deletePnoteFolder_(scope, name, folderId) {
  const allFolders = getPnoteFoldersFor_(scope, name);
  const target = allFolders.find(function (f) { return f.id === String(folderId); });
  if (!target) return false;

  const idsToDelete = collectPnoteFolderIdsRecursive_(allFolders, folderId);

  const folderSheet = getPnoteFolderSheetForScope_(scope);
  const data = folderSheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const rowId = String(data[i][0]);
    const owner = String(data[i][1] || '').trim();
    if (idsToDelete.indexOf(rowId) !== -1 && (scope === 'shared' || owner === name)) {
      folderSheet.deleteRow(i + 1);
    }
  }

  const noteSheet = getPnoteSheetForScope_(scope);
  const noteData = noteSheet.getDataRange().getValues();
  for (let i = 1; i < noteData.length; i++) {
    const owner = String(noteData[i][1] || '').trim();
    const folderIdOfNote = String(noteData[i][2] || '');
    if ((scope === 'shared' || owner === name) && idsToDelete.indexOf(folderIdOfNote) !== -1) {
      noteSheet.getRange(i + 1, 3).setValue('');
    }
  }
  return true;
}

function addPnote_(scope, name, folderId, text) {
  const sheet = getPnoteSheetForScope_(scope);
  const id = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([id, name, folderId || '', text || '', now, now]);
  return id;
}

function findPnoteRow_(sheet, scope, name, noteId) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const owner = String(data[i][1] || '').trim();
    if (String(data[i][0]) === String(noteId) && (scope === 'shared' || owner === name)) return i + 1;
  }
  return -1;
}

function updatePnote_(scope, name, noteId, fields) {
  const sheet = getPnoteSheetForScope_(scope);
  const row = findPnoteRow_(sheet, scope, name, noteId);
  if (row === -1) return false;
  if (fields.text !== undefined) sheet.getRange(row, 4).setValue(String(fields.text));
  if (fields.folderId !== undefined) sheet.getRange(row, 3).setValue(String(fields.folderId));
  sheet.getRange(row, 6).setValue(new Date());
  return true;
}

function deletePnote_(scope, name, noteId) {
  const sheet = getPnoteSheetForScope_(scope);
  const row = findPnoteRow_(sheet, scope, name, noteId);
  if (row === -1) return false;
  sheet.deleteRow(row);
  return true;
}

// ===== 公關品狀態 =====

function getPrStatusSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PR_STATUS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PR_STATUS_SHEET_NAME);
    sheet.appendRow(['key', '狀態', '選品網址', '倉庫位置', '更新時間']);
    sheet.setFrozenRows(1);
  }
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const need = ['key', '狀態', '選品網址', '倉庫位置', '更新時間'];
  if (header.length < need.length) {
    sheet.getRange(1, 1, 1, need.length).setValues([need]);
  }
  return sheet;
}

function getPrStatusMap_() {
  const sheet = getPrStatusSheet_();
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (!key) continue;
    map[String(key)] = {
      status: data[i][1] || '',
      url: data[i][2] || '',
      location: data[i][3] || '',
      updated: data[i][4] ? fmtDateTime_(data[i][4]) : ''
    };
  }
  return map;
}

function upsertPrStatus_(key, fields) {
  const sheet = getPrStatusSheet_();
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) { rowIndex = i + 1; break; }
  }
  const now = new Date();
  if (rowIndex === -1) {
    sheet.appendRow([
      key,
      fields.status != null ? fields.status : '',
      fields.url != null ? fields.url : '',
      fields.location != null ? fields.location : '',
      now
    ]);
  } else {
    if (fields.status != null) sheet.getRange(rowIndex, 2).setValue(fields.status);
    if (fields.url != null) sheet.getRange(rowIndex, 3).setValue(fields.url);
    if (fields.location != null) sheet.getRange(rowIndex, 4).setValue(fields.location);
    sheet.getRange(rowIndex, 5).setValue(now);
  }
  return true;
}

function jsonResult_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 已經是 JSON 字串時用這個（快取拿出來的東西不必 parse 完再 stringify 回去）
function jsonTextResult_(jsonStr) {
  return ContentService
    .createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}
