/**
 * agent.gs — 「小龍」AI 員工後端（Google Apps Script）
 * ============================================================
 * 這是一個全新、獨立的 GAS 專案用檔案，與 dondon-calendar 現有的
 * Code.gs 完全分離、互不引用。不要把本檔貼進 Code.gs 所在的專案。
 *
 * 【部署步驟（給使用者看）】
 * 1. 前往 script.google.com，建立一個「新專案」。
 * 2. 把本檔內容整個貼進去（取代預設的 Code.gs 內容），檔名可保留 Code.gs
 *    或改成 agent.gs，皆可。
 * 3. 左側「專案設定」→「指令碼屬性」，新增兩筆：
 *      ANTHROPIC_API_KEY = 你的 Claude API 金鑰
 *      AGENT_TOKEN       = 你自訂的一組通關密語（前端呼叫 API 都要帶這個）
 * 4. 在編輯器上方選取函式 setup，按「執行」一次（第一次會要求授權，
 *    同意即可）。這會自動建立一份叫「小龍員工資料庫」的試算表。
 * 5. 點「部署」→「新增部署作業」→類型選「網頁應用程式」：
 *      執行身分：我（你自己）
 *      誰可以存取：任何人
 *    部署後會拿到一個網址，這就是前端 office.html 要打的 API 網址。
 * 6. 再選取函式 setupTriggers，執行一次，建立每天 08:00（台北時間）
 *    自動整理信箱的排程。
 * 7. 之後若修改本檔內容，「新增部署作業」或「管理部署作業→編輯→新版本」
 *    都要重新部署一次才會生效。
 *
 * 【與現有 Code.gs 的關係】
 * 完全無關。本檔不會讀寫任何後台私人表，對外部「行事曆表」
 * （SHEET_ID 見下方常數）只允許唯讀。
 */

// ============================================================
// 常數區
// ============================================================

// 預設模型。想省錢可改成 'claude-sonnet-5'（速度快、成本低）
// 或 'claude-haiku-4-5'（最便宜，適合單純任務）。
var MODEL = 'claude-opus-4-8';

var CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
var CLAUDE_API_VERSION = '2023-06-01';

// 雪莉的團購行事曆表（正式資料，唯讀！嚴禁寫入）。
var CALENDAR_SHEET_ID = '18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk';
var CALENDAR_SHEET_TAB_NAME = '行事曆';

// 小龍自己的資料庫試算表名稱（由 setup() 自動建立）。
var AGENT_SHEET_NAME = '小龍員工資料庫';

// Claude 工具呼叫迴圈的上限輪數，避免無限迴圈。
var MAX_TOOL_ROUNDS = 6;

// 計價表（USD / 1M tokens）。務必與 MODEL 常數挑選的模型對齊。
var PRICING = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 }
};

// 狀態快取（CacheService）設定。
var STATE_CACHE_KEY = 'xiaolong_agent_state_v1';
var STATE_CACHE_TTL_SECONDS = 600;

// ============================================================
// setup()：初始化小龍的資料庫試算表（可重複執行，冪等）
// ============================================================

function setup() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('AGENT_SHEET_ID');
  var ss = null;

  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (err) {
      ss = null; // 存的 ID 失效了，底下重新建立
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(AGENT_SHEET_NAME);
    props.setProperty('AGENT_SHEET_ID', ss.getId());
  }

  ensureSheetWithHeader_(ss, '狀態', ['key', 'value']);
  ensureSheetWithHeader_(ss, '用量', ['時間', '模型', 'input', 'output', 'costUSD', '動作']);
  var schedSheet = ensureSheetWithHeader_(ss, '排程', ['time', 'label', 'status', 'lastRun']);
  ensureSheetWithHeader_(ss, '小記', ['date', 'text']);

  var stateSheet = ss.getSheetByName('狀態');
  ensureStateRowExists_(stateSheet, 'mood', 'resting');
  ensureStateRowExists_(stateSheet, 'activity', '休息中');
  ensureStateRowExists_(stateSheet, 'updatedAt', new Date().toISOString());

  if (schedSheet.getLastRow() < 2) {
    schedSheet.appendRow(['08:00', '信件摘要', 'pending', '']);
  }

  Logger.log('setup 完成。小龍員工資料庫試算表 ID：' + ss.getId());
}

// 確保分頁存在且有表頭列；回傳該分頁物件。
function ensureSheetWithHeader_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(headers);
  }
  return sheet;
}

// 確保「狀態」分頁裡某個 key 已有一列資料（沒有才新增，避免重複執行時覆蓋）。
function ensureStateRowExists_(stateSheet, key, defaultValue) {
  var data = stateSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      return;
    }
  }
  stateSheet.appendRow([key, defaultValue]);
}

// ============================================================
// 取得小龍的資料庫試算表（setup() 執行過後才會有）
// ============================================================

function getAgentSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('AGENT_SHEET_ID');
  if (!sheetId) {
    throw new Error('尚未執行 setup()，找不到 AGENT_SHEET_ID，請先在 GAS 編輯器執行一次 setup()。');
  }
  return SpreadsheetApp.openById(sheetId);
}

// ============================================================
// doGet / doPost：對外 Web API 入口
// ============================================================

function doGet(e) {
  var params = (e && e.parameter) || {};
  var token = params.token;

  if (!checkToken_(token)) {
    return jsonOutput_({ ok: false, error: 'unauthorized' });
  }

  var scope = params.scope;

  if (scope === 'status') {
    try {
      return jsonOutput_(buildStatusResponse_());
    } catch (err) {
      return jsonOutput_({ ok: false, error: String(err) });
    }
  }

  return jsonOutput_({ ok: false, error: 'unknown scope' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: 'invalid JSON body' });
  }

  if (!checkToken_(body.token)) {
    return jsonOutput_({ ok: false, error: 'unauthorized' });
  }

  if (body.type === 'chat') {
    try {
      var message = body.message || '';
      var history = body.history || [];
      var result = runChat_(message, history);
      return jsonOutput_({ ok: true, reply: result.reply, usage: result.usage });
    } catch (err) {
      return jsonOutput_({ ok: false, error: String(err) });
    }
  }

  return jsonOutput_({ ok: false, error: 'unknown type' });
}

// 統一 JSON 回應包裝。
function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Token 驗證：與 Script Properties 的 AGENT_TOKEN 比對。
function checkToken_(token) {
  if (!token) {
    return false;
  }
  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty('AGENT_TOKEN');
  if (!expected) {
    return false;
  }
  return token === expected;
}

// ============================================================
// 狀態讀寫：CacheService（TTL 600 秒）＋ 試算表雙寫
// ============================================================

function getState_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(STATE_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      // 快取內容壞掉就當作 cache miss，往下讀試算表
    }
  }

  var ss = getAgentSpreadsheet_();
  var sheet = ss.getSheetByName('狀態');
  var data = sheet.getDataRange().getValues();

  var state = { mood: 'resting', activity: '休息中', updatedAt: new Date().toISOString() };
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var value = data[i][1];
    if (key === 'mood') {
      state.mood = value;
    } else if (key === 'activity') {
      state.activity = value;
    } else if (key === 'updatedAt') {
      state.updatedAt = value;
    }
  }

  cache.put(STATE_CACHE_KEY, JSON.stringify(state), STATE_CACHE_TTL_SECONDS);
  return state;
}

function setState_(mood, activity) {
  var ss = getAgentSpreadsheet_();
  var sheet = ss.getSheetByName('狀態');
  var data = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  var updates = { mood: mood, activity: activity, updatedAt: now };
  var keys = ['mood', 'activity', 'updatedAt'];

  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === key) {
        sheet.getRange(i + 1, 2).setValue(updates[key]);
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([key, updates[key]]);
    }
  }

  var state = { mood: mood, activity: activity, updatedAt: now };
  var cache = CacheService.getScriptCache();
  cache.put(STATE_CACHE_KEY, JSON.stringify(state), STATE_CACHE_TTL_SECONDS);
  return state;
}

// ============================================================
// 用量紀錄與成本計算
// ============================================================

function logUsage_(model, inputTokens, outputTokens, costUSD, action) {
  var ss = getAgentSpreadsheet_();
  var sheet = ss.getSheetByName('用量');
  sheet.appendRow([new Date().toISOString(), model, inputTokens, outputTokens, costUSD, action]);
}

function calcCost_(model, inputTokens, outputTokens) {
  var pricing = PRICING[model] || PRICING[MODEL];
  var inCost = (inputTokens * pricing.input) / 1000000;
  var outCost = (outputTokens * pricing.output) / 1000000;
  return inCost + outCost;
}

// 彙總「用量」分頁，算出今日（Asia/Taipei）與總計的花費/token 數。
function buildUsageSummary_() {
  var ss = getAgentSpreadsheet_();
  var sheet = ss.getSheetByName('用量');
  var data = sheet.getDataRange().getValues();
  var todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  var todayCost = 0;
  var todayInput = 0;
  var todayOutput = 0;
  var todayCalls = 0;
  var totalCost = 0;
  var totalTokens = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var timeValue = row[0];
    var inputTokens = Number(row[2]) || 0;
    var outputTokens = Number(row[3]) || 0;
    var cost = Number(row[4]) || 0;

    totalCost += cost;
    totalTokens += inputTokens + outputTokens;

    var rowDateStr = '';
    try {
      var d = (Object.prototype.toString.call(timeValue) === '[object Date]') ? timeValue : new Date(timeValue);
      if (!isNaN(d.getTime())) {
        rowDateStr = Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
      }
    } catch (err) {
      rowDateStr = '';
    }

    if (rowDateStr === todayStr) {
      todayCost += cost;
      todayInput += inputTokens;
      todayOutput += outputTokens;
      todayCalls += 1;
    }
  }

  return {
    today: {
      costUSD: todayCost,
      inputTokens: todayInput,
      outputTokens: todayOutput,
      calls: todayCalls
    },
    total: {
      costUSD: totalCost,
      tokens: totalTokens
    }
  };
}

// ============================================================
// 狀態 API：組出 ?scope=status 的完整回應
// ============================================================

function buildStatusResponse_() {
  var state = getState_();
  var ss = getAgentSpreadsheet_();

  var schedSheet = ss.getSheetByName('排程');
  var schedData = schedSheet.getDataRange().getValues();
  var schedules = [];
  for (var i = 1; i < schedData.length; i++) {
    var row = schedData[i];
    schedules.push({
      time: row[0],
      label: row[1],
      status: row[2],
      lastRun: row[3] ? row[3] : null
    });
  }

  return {
    ok: true,
    agent: {
      name: '小龍',
      mood: state.mood,
      activity: state.activity,
      updatedAt: state.updatedAt
    },
    schedules: schedules,
    usage: buildUsageSummary_(),
    lastDigest: getLastDigest_()
  };
}

function getLastDigest_() {
  try {
    var ss = getAgentSpreadsheet_();
    var sheet = ss.getSheetByName('小記');
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return null;
    }
    var last = data[data.length - 1];
    var dateValue = last[0];
    var dateStr;
    if (Object.prototype.toString.call(dateValue) === '[object Date]') {
      dateStr = Utilities.formatDate(dateValue, 'Asia/Taipei', 'yyyy-MM-dd');
    } else {
      dateStr = String(dateValue);
    }
    return { date: dateStr, text: String(last[1]) };
  } catch (err) {
    return null;
  }
}

// ============================================================
// Claude API 呼叫核心
// ============================================================

// 呼叫 Claude Messages API 一次（不含迴圈邏輯）。
// system: 字串；messages: 陣列；tools: 陣列或 null。
function callClaude_(system, messages, tools) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('Script Properties 尚未設定 ANTHROPIC_API_KEY。');
  }

  var payload = {
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: system,
    messages: messages
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(CLAUDE_API_URL, options);
  var httpCode = response.getResponseCode();
  var text = response.getContentText();

  var json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('Claude API 回應非 JSON（HTTP ' + httpCode + '）：' + text.substring(0, 300));
  }

  if (httpCode !== 200) {
    var errMsg = (json.error && json.error.message) ? json.error.message : text;
    throw new Error('Claude API 錯誤（HTTP ' + httpCode + '）：' + errMsg);
  }

  return json;
}

// 小龍的角色設定（system prompt）。
function buildSystemPrompt_() {
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd（EEEE）");
  return (
    '你是小龍，雪莉（Shirley）的 AI 經紀人兼員工，負責整理 Gmail 信箱、' +
    '協助規劃團購行事曆相關事務，並回答雪莉交辦的各種指令。' +
    '說話語氣親切、簡短、口語化，像貼心的同事，不要長篇大論，也不要過度客套。' +
    '今天的日期是 ' + today + '（Asia/Taipei 時區）。' +
    '你可以使用以下工具：搜尋信箱、讀取單封信件內文、建立 Gmail 草稿（僅建立草稿，' +
    '絕對不會、也不能直接寄出信件）、查詢團購行事曆（唯讀）、查看最近一篇信箱摘要小記。' +
    '需要資訊時主動使用工具，不需要每件小事都跟雪莉確認，盡量直接把事情完成，' +
    '完成後再簡短回報結果。'
  );
}

// 工具定義（input_schema 用 JSON Schema 格式）。
function getToolDefinitions_() {
  return [
    {
      name: 'search_gmail',
      description: '搜尋 Gmail 信件，回傳符合條件的信件清單（主旨、寄件人、日期、前 200 字摘要、messageId）。',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Gmail 搜尋語法，例如 "newer_than:1d"、"from:someone@example.com"、"is:unread"'
          },
          max_results: {
            type: 'integer',
            description: '最多回傳幾筆結果，預設 10，上限 10'
          }
        },
        required: ['query']
      }
    },
    {
      name: 'read_email',
      description: '讀取單一 Gmail 信件的純文字內文（最多回傳前 3000 字）。',
      input_schema: {
        type: 'object',
        properties: {
          message_id: {
            type: 'string',
            description: 'Gmail 訊息 ID（由 search_gmail 回傳的 messageId）'
          }
        },
        required: ['message_id']
      }
    },
    {
      name: 'create_gmail_draft',
      description: '在 Gmail 建立一封草稿信。只會建立草稿，不會寄出。',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '收件人 email' },
          subject: { type: 'string', description: '信件主旨' },
          body: { type: 'string', description: '信件內文（純文字）' }
        },
        required: ['to', 'subject', 'body']
      }
    },
    {
      name: 'get_calendar_events',
      description: '唯讀查詢雪莉的團購行事曆表，回傳未來 N 天內的開團活動（開團日期、品牌名稱、狀態）。',
      input_schema: {
        type: 'object',
        properties: {
          days_ahead: {
            type: 'integer',
            description: '往後查詢幾天內的活動，預設 14，上限 60'
          }
        },
        required: []
      }
    },
    {
      name: 'list_today_summary',
      description: '回傳最近一篇信箱摘要小記的內容（由每日自動摘要產生）。',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];
}

// 依工具名稱分派執行，回傳字串結果（供 tool_result 使用）。
function executeTool_(name, input) {
  input = input || {};
  if (name === 'search_gmail') {
    return toolSearchGmail_(input);
  }
  if (name === 'read_email') {
    return toolReadEmail_(input);
  }
  if (name === 'create_gmail_draft') {
    return toolCreateGmailDraft_(input);
  }
  if (name === 'get_calendar_events') {
    return toolGetCalendarEvents_(input);
  }
  if (name === 'list_today_summary') {
    return toolListTodaySummary_(input);
  }
  return '未知的工具名稱：' + name;
}

// ---- 工具實作 ----

function toolSearchGmail_(input) {
  var query = input.query || '';
  var maxResults = input.max_results;
  if (!maxResults || maxResults > 10) {
    maxResults = 10;
  }

  try {
    var threads = GmailApp.search(query, 0, maxResults);
    var results = [];
    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var j = 0; j < messages.length; j++) {
        if (results.length >= maxResults) {
          break;
        }
        var msg = messages[j];
        var plainBody = '';
        try {
          plainBody = msg.getPlainBody();
        } catch (bodyErr) {
          plainBody = '';
        }
        results.push({
          subject: msg.getSubject(),
          from: msg.getFrom(),
          date: msg.getDate().toISOString(),
          snippet: plainBody.substring(0, 200),
          messageId: msg.getId()
        });
      }
      if (results.length >= maxResults) {
        break;
      }
    }
    return JSON.stringify(results);
  } catch (err) {
    return JSON.stringify([]);
  }
}

function toolReadEmail_(input) {
  var messageId = input.message_id;
  if (!messageId) {
    return '缺少 message_id 參數。';
  }
  try {
    var msg = GmailApp.getMessageById(messageId);
    if (!msg) {
      return '找不到這封信件。';
    }
    var plainBody = msg.getPlainBody() || '';
    return plainBody.substring(0, 3000);
  } catch (err) {
    return '讀取信件失敗：' + String(err);
  }
}

function toolCreateGmailDraft_(input) {
  var to = input.to;
  var subject = input.subject || '';
  var body = input.body || '';

  if (!to) {
    return '缺少收件人（to）參數，無法建立草稿。';
  }

  try {
    GmailApp.createDraft(to, subject, body);
    return '草稿已建立';
  } catch (err) {
    return '建立草稿失敗：' + String(err);
  }
}

// 唯讀查詢團購行事曆表。任何情況都不對此試算表做寫入操作。
function toolGetCalendarEvents_(input) {
  var daysAhead = input.days_ahead;
  if (!daysAhead || daysAhead > 60) {
    daysAhead = 14;
  }

  try {
    var calSs = SpreadsheetApp.openById(CALENDAR_SHEET_ID);
    var calSheet = calSs.getSheetByName(CALENDAR_SHEET_TAB_NAME);
    if (!calSheet) {
      var allSheets = calSs.getSheets();
      calSheet = allSheets.length > 0 ? allSheets[0] : null;
    }
    if (!calSheet) {
      return JSON.stringify([]);
    }

    var data = calSheet.getDataRange().getValues();
    var now = new Date();
    var cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rawDate = row[0];
      var brand = row[1];
      var status = row[2];

      var eventDate;
      if (Object.prototype.toString.call(rawDate) === '[object Date]') {
        eventDate = rawDate;
      } else if (rawDate) {
        eventDate = new Date(rawDate);
      } else {
        continue;
      }

      if (isNaN(eventDate.getTime())) {
        continue;
      }

      if (eventDate >= now && eventDate <= cutoff) {
        results.push({
          date: Utilities.formatDate(eventDate, 'Asia/Taipei', 'yyyy-MM-dd'),
          brand: brand || '',
          status: status || ''
        });
      }
    }

    return JSON.stringify(results);
  } catch (err) {
    // 容錯：任何讀取問題都回空陣列，不 throw。
    return JSON.stringify([]);
  }
}

function toolListTodaySummary_(input) {
  try {
    var ss = getAgentSpreadsheet_();
    var sheet = ss.getSheetByName('小記');
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return '目前沒有任何小記紀錄。';
    }
    var last = data[data.length - 1];
    var dateValue = last[0];
    var dateStr;
    if (Object.prototype.toString.call(dateValue) === '[object Date]') {
      dateStr = Utilities.formatDate(dateValue, 'Asia/Taipei', 'yyyy-MM-dd');
    } else {
      dateStr = String(dateValue);
    }
    return '（' + dateStr + '）' + String(last[1]);
  } catch (err) {
    return '目前沒有任何小記紀錄。';
  }
}

// ============================================================
// 聊天核心：Claude API 多輪工具呼叫迴圈
// ============================================================

function runChat_(message, history) {
  var system = buildSystemPrompt_();
  var tools = getToolDefinitions_();

  var messages = [];
  history = history || [];
  for (var h = 0; h < history.length; h++) {
    var item = history[h];
    if (item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') {
      messages.push({ role: item.role, content: item.content });
    }
  }
  messages.push({ role: 'user', content: String(message || '') });

  var totalInputTokens = 0;
  var totalOutputTokens = 0;
  var totalCostUSD = 0;
  var replyText = '';

  setState_('working', '正在思考回覆…');

  try {
    for (var round = 0; round < MAX_TOOL_ROUNDS; round++) {
      var response = callClaude_(system, messages, tools);

      var usage = response.usage || {};
      var inputTokens = usage.input_tokens || 0;
      var outputTokens = usage.output_tokens || 0;
      var costUSD = calcCost_(MODEL, inputTokens, outputTokens);

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalCostUSD += costUSD;
      logUsage_(MODEL, inputTokens, outputTokens, costUSD, 'chat');

      if (response.stop_reason === 'refusal') {
        replyText = '這個請求我無法處理';
        break;
      }

      var content = response.content || [];
      var textParts = [];
      for (var c = 0; c < content.length; c++) {
        if (content[c].type === 'text') {
          textParts.push(content[c].text);
        }
      }
      replyText = textParts.join('\n');

      if (response.stop_reason !== 'tool_use') {
        break;
      }

      // 把 assistant 的完整內容（含 thinking blocks）原封不動放回 messages。
      messages.push({ role: 'assistant', content: content });

      var toolResults = [];
      for (var t = 0; t < content.length; t++) {
        var block = content[t];
        if (block.type === 'tool_use') {
          var toolOutput;
          try {
            toolOutput = executeTool_(block.name, block.input);
          } catch (toolErr) {
            toolOutput = '工具執行發生錯誤：' + String(toolErr);
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: String(toolOutput)
          });
        }
      }

      // 同一輪的所有 tool_result 放進同一則 user message。
      messages.push({ role: 'user', content: toolResults });
    }
  } finally {
    setState_('resting', '休息中');
  }

  return {
    reply: replyText,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUSD: totalCostUSD
    }
  };
}

// ============================================================
// 每日信箱摘要（排程觸發）
// ============================================================

function dailyDigest() {
  setState_('working', '正在整理信箱…');

  try {
    var threads = GmailApp.search('newer_than:1d', 0, 25);
    var mails = [];
    for (var i = 0; i < threads.length && mails.length < 25; i++) {
      var messages = threads[i].getMessages();
      for (var j = 0; j < messages.length && mails.length < 25; j++) {
        var msg = messages[j];
        var plainBody = '';
        try {
          plainBody = msg.getPlainBody();
        } catch (bodyErr) {
          plainBody = '';
        }
        mails.push({
          subject: msg.getSubject(),
          from: msg.getFrom(),
          snippet: plainBody.substring(0, 200)
        });
      }
    }

    var mailListText = '';
    for (var k = 0; k < mails.length; k++) {
      mailListText += (k + 1) + '. 主旨：' + mails[k].subject + '｜寄件人：' + mails[k].from + '｜摘要：' + mails[k].snippet + '\n';
    }
    if (!mailListText) {
      mailListText = '（過去 24 小時內沒有新信件）';
    }

    var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    var system =
      '你是小龍，雪莉的 AI 經紀人兼員工。請根據以下今天的信件清單，' +
      '用繁體中文寫一份簡短的每日信箱摘要：重要的信、需要處理的待辦事項要特別點出來；' +
      '純廣告/行銷/電子報信件可以略過或用一句話帶過即可，不用逐封分析。' +
      '今天的日期是 ' + today + '（Asia/Taipei 時區）。';

    var messages = [
      { role: 'user', content: '以下是過去 24 小時內收到的信件清單：\n' + mailListText }
    ];

    var response = callClaude_(system, messages, null);

    var usage = response.usage || {};
    var inputTokens = usage.input_tokens || 0;
    var outputTokens = usage.output_tokens || 0;
    var costUSD = calcCost_(MODEL, inputTokens, outputTokens);
    logUsage_(MODEL, inputTokens, outputTokens, costUSD, 'dailyDigest');

    var summaryText;
    if (response.stop_reason === 'refusal') {
      summaryText = '這個請求我無法處理';
    } else {
      var content = response.content || [];
      var textParts = [];
      for (var c = 0; c < content.length; c++) {
        if (content[c].type === 'text') {
          textParts.push(content[c].text);
        }
      }
      summaryText = textParts.join('\n');
      if (!summaryText) {
        summaryText = '（本次沒有產生摘要內容）';
      }
    }

    var ss = getAgentSpreadsheet_();
    var noteSheet = ss.getSheetByName('小記');
    noteSheet.appendRow([today, summaryText]);

    var schedSheet = ss.getSheetByName('排程');
    var schedData = schedSheet.getDataRange().getValues();
    var nowIso = new Date().toISOString();
    for (var r = 1; r < schedData.length; r++) {
      if (schedData[r][1] === '信件摘要') {
        schedSheet.getRange(r + 1, 3).setValue('done');
        schedSheet.getRange(r + 1, 4).setValue(nowIso);
        break;
      }
    }
  } finally {
    setState_('resting', '休息中');
  }
}

// ============================================================
// 排程觸發器：每日 08:00（Asia/Taipei）跑 dailyDigest
// ============================================================

function setupTriggers() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'dailyDigest') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }

  ScriptApp.newTrigger('dailyDigest')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone('Asia/Taipei')
    .create();

  Logger.log('已建立每日 08:00（Asia/Taipei）的 dailyDigest 觸發器。');
}
