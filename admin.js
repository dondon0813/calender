const SHEET_ID = "18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk";
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

// 請把 Google Apps Script 部署後的網址貼在這裡（步驟看聊天室裡的說明）
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzTxoqVO1nf--Q9s-lf1eIPdgrDpJgLsuAy1mAwgydYzb7ThAuygx79oFNsEH-kWD2R/exec";
// 在完成 Apps Script 設定前，先用這組密碼；設定好後密碼改用試算表管理，這組就不會再用到
const FALLBACK_PASSWORD = "0000";
let currentToken = null; // 登入後從後端拿到的通行證，之後每次呼叫後端都要帶著它  

let memoMap = {}; // { key: 備忘錄內容 }
let urlMap = {}; // { key: 後台網址 }
let currentModalEv = null;
let appPassword = null;

// ===== 身份與任務系統 =====
let currentUser = null;            // 目前登入者姓名
let staffList = [];                // [{ name, password }]
let taskNames = [];                // 派遣任務的任務名稱清單（共用）
let myTaskNames = [];               // 只有自己看得到的任務名稱（不進共用清單）
let tasksMap = {};                 // { 姓名: [{ id, taskName, content, urgent, status, ... }] }
let vendors = [];                  // 廠商名單（廠商選品的下拉選單）
let prStatusMap = {};              // { getMemoKey(ev): { status, url, location, updated } }
let prLocations = [];              // 【新】公關品位置清單（辦公室／倉庫／我家…可自訂新增）
let statsMap = {};                 // 【新】瀏覽/點擊次數統計 { getMemoKey(ev): { views, clicks, updated } }
let isAdmin = false;               // 【新】目前登入者是否為管理員（雪莉）
let myPermissions = {};            // 【新】目前登入者被開放的功能權限 { imageLibrary: bool, ... }
let allPermissions = {};           // 【新】（僅管理員拿得到）所有員工的權限狀態，給權限設定頁面用
let customBlocks = [];             // 【新】開團狀態清單的自訂區塊（文字按鈕等）
// 公關品狀態的六種狀態，用色塊底色區分（class 對應下方 CSS）
const PR_STATUS_LIST = ['尚未選品', '選品中', '已選品', '已寄出', '已收到', '已拍攝'];
const PR_STATUS_CLASS = {
  '尚未選品': 'st-none', '選品中': 'st-picking', '已選品': 'st-picked',
  '已寄出': 'st-sent', '已收到': 'st-received', '已拍攝': 'st-shot'
};
// 公關品狀態小圖示的顯示開關（放行事曆上方 toggle），記在 localStorage
let prChipOn = localStorage.getItem('admin_pr_chip_on') === '1';
let currentView = 'home';
let doneExpanded = false;
// 【新】待辦事項（所有人共用）
let todoCategories = [];
let todos = [];
let todoEditCtx = null; // { isNew, todo }
let selectedTodoPriority = '中';
const TODO_BRAND_CATEGORY = '團購合作'; // 這個主選項用品牌＋合作階段，其他主選項用標題＋內容
const TODO_PRIORITY_LIST = ['高', '中', '低', '不追'];
const TODO_PRIORITY_COLOR = { '高': '#FFDCD8', '中': '#FFE8D2', '低': '#E4F5DF', '不追': '#EFEBE5' };
const TODO_PRIORITY_TEXT_COLOR = { '高': '#C0392B', '中': '#B5601C', '低': '#4f7a3a', '不追': '#7A7166' };
const SELF_DEFAULT_TASKS = ['顧客提問']; // 「安排工作」預設只有這些＋新增更多
const CUSTOMER_SOURCES = ['IG', 'FB', 'LINE群組', 'LINE官方帳號'];
const COLORS = 7;
const WD_LABEL = ['日','一','二','三','四','五','六'];

let allEvents = [];
let currentYear, currentMonth;
let currentMode = 'start';

// ===== 行事曆編輯模式 =====
let calendarEditMode = false;
let calEditSelectedDate = null; // 目前在下方面板顯示的是哪一天
const EVENT_COLOR_PRESETS = ['#FF8FA3', '#FFB37A', '#9ACB85', '#6FC8C2', '#7AAEEB', '#B79AE8', '#F0C36D'];

const MODE_VISIBLE_DAYS = {
  all:   [0,1,2,3,4,5,6],
  start: [1,2,3,4,5],
  end:   [0,1,2,3,4],
  mytasks: [0,1,2,3,4,5,6]
};

function parseDateStr(s) {
  if (!s) return null;
  s = String(s).trim();
  const gvizMatch = s.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (gvizMatch) {
    return new Date(parseInt(gvizMatch[1]), parseInt(gvizMatch[2]), parseInt(gvizMatch[3]));
  }
  const parts = s.split(/[\/\-]/).map(p => parseInt(p, 10));
  if (parts.length === 3) return new Date(parts[0], parts[1] - 1, parts[2]);
  return null;
}

function fmtDateLabel(start, end) {
  const f = d => `${d.getMonth()+1}/${d.getDate()}`;
  return `${f(start)}–${f(end)}`;
}

function fmtSingleDate(d) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function daysBetween(a, b) {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((B - A) / 86400000);
}

// 將標題切成「詞」，盡量避免拆散同一個詞，再依每行最多字數組行
function segmentTitle(title) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter('zh', { granularity: 'word' });
      const parts = [];
      for (const s of seg.segment(title)) {
        if (s.segment && s.segment.trim() !== '') parts.push(s.segment);
      }
      if (parts.length) return parts;
    } catch (e) { /* fallback below */ }
  }
  return title.split('');
}

// 已知品牌/店家名稱清單：斷行時優先從這裡比對，
// 因為自動斷詞無法辨識專有名詞，容易切錯（例如「林貝兒米餅」會被拆成單字）。
// 之後遇到新品牌，請告訴 Claude 幫忙加進這個清單即可。
const KNOWN_BRANDS = ['林貝兒', '小影霸', '台東初鹿', '永圻魚湯', '雪坊優格', '兔比媽咪廚房'];

function wrapTitleLines(title, maxCharsPerLine) {
  // 若品名裡有手動指定的斷行符號（/ 或 、），優先照這裡斷行
  const manualParts = title.split(/[\/、]/).map(s => s.trim()).filter(s => s !== '');
  if (manualParts.length > 1) {
    const lines = [];
    manualParts.forEach(part => {
      lines.push(...wrapSegment(part, maxCharsPerLine));
    });
    return lines;
  }

  // 比對已知品牌名稱，優先把品牌獨立成一行
  const brand = KNOWN_BRANDS.find(b => title.startsWith(b));
  if (brand) {
    const rest = title.slice(brand.length).trim();
    const lines = [brand];
    if (rest) lines.push(...wrapSegment(rest, maxCharsPerLine));
    return lines;
  }

  return wrapSegment(title, maxCharsPerLine);
}

function wrapSegment(text, maxCharsPerLine) {
  const words = segmentTitle(text);
  const lines = [];
  let current = '';
  words.forEach(w => {
    if (current === '') {
      current = w;
    } else if (current.length + w.length <= maxCharsPerLine) {
      current += w;
    } else {
      lines.push(current);
      current = w;
    }
  });
  if (current) lines.push(current);
  return lines;
}

// 冷凍團判斷：優先讀取試算表第 6 欄（F欄，類別欄位，例如填「冷凍」）
// 若該欄位是空的，才用已知店家名稱比對做保底判斷
const FROZEN_KEYWORDS = ['永圻魚湯', '雪坊優格', '兔比媽咪廚房'];

function isFrozenEvent(ev) {
  const cat = (ev.category || '').toString().trim();
  if (cat !== '') {
    return cat.includes('冷凍');
  }
  return FROZEN_KEYWORDS.some(k => ev.title.includes(k));
}

// 內部版：所有團購不論是否已開團，點擊都會打開後台彈窗（不受開團日期限制）

// 解析「延長日期」欄位：可以是數字（延長天數）或日期（指定延長至該天）
function parseExtendRaw(raw, originalEnd) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return { type: 'days', value: raw };
  }
  const s = String(raw).trim();
  if (s === '') return null;
  if (/^\d+$/.test(s)) {
    return { type: 'days', value: parseInt(s, 10) };
  }
  const d = parseDateStr(s);
  if (d) return { type: 'date', value: d };
  return null;
}

// 計算「原本結束日期當天及之前」顯示原日期；隔天起才套用延長後日期
function computeDisplayEnd(end, extend) {
  if (!extend) return end;
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endStart = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (todayStart <= endStart) return end;
  if (extend.type === 'days') {
    return new Date(end.getFullYear(), end.getMonth(), end.getDate() + extend.value);
  }
  return extend.value;
}

// ===== 【新】社群小圖示：4 個內建圖示，前後台共用同一套渲染邏輯 =====
const EVENT_ICON_DEFS = [
  { key: 'iconIg', emoji: '📷', label: 'Instagram' },
  { key: 'iconTiktok', emoji: '🎵', label: 'TikTok' },
  { key: 'iconFb', emoji: '📘', label: 'Facebook' },
  { key: 'iconEmail', emoji: '✉️', label: 'Email／其他' }
];
function buildEventIconElements(ev) {
  return EVENT_ICON_DEFS.filter(d => ev[d.key]).map(d => {
    let href = ev[d.key];
    if (d.key !== 'iconEmail' && !/^https?:\/\//i.test(href)) href = 'https://' + href;
    const span = document.createElement('span');
    span.className = 'gs-card-icon';
    span.title = d.label;
    span.textContent = d.emoji;
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(href, '_blank', 'noopener');
    });
    return span;
  });
}

async function loadData() {
  const statusEl = document.getElementById('status');
  statusEl.textContent = '資料載入中…';
  statusEl.classList.remove('error');
  try {
    const res = await fetch(GVIZ_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('網路錯誤 ' + res.status);
    const text = await res.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    const rows = data.table.rows;

    const events = [];
    rows.forEach((row) => {
      const c = row.c;
      if (!c || !c[0] || c[0].v === null || c[0].v === '') return;
      const id = c[0].v;
      const startRaw = c[1] ? c[1].v : null;
      const endRaw = c[2] ? c[2].v : null;
      const extendRaw = c[3] ? c[3].v : null;
      const title = c[4] ? c[4].v : '';
      const tag = c[5] ? c[5].v : '';
      const category = c[6] ? c[6].v : '';
      const url = c[7] ? c[7].v : '';
      const adminUrl = c[8] ? c[8].v : ''; // 後台網址，先保留不使用
      const earlyBirdRaw = c[9] ? c[9].v : '';
      // 新增欄位（L~U）：顏色／整日／開始時間／結束時間／團購／顯示於前台／4個社群圖示網址
      // 舊資料這幾欄是空的，全部視為向下相容的預設值（顏色沿用調色盤、整日、算團購編號、顯示於前台）
      // 欄位對照：J=早鳥禮(idx9)　K=食譜品牌(idx10，既有欄位，這裡不需要讀)
      // L=顏色(idx11)　M=整日(idx12)　N=開始時間(idx13)　O=結束時間(idx14)　P=團購(idx15)　Q=顯示於前台(idx16)
      // R=IG(idx17)　S=TikTok(idx18)　T=Facebook(idx19)　U=Email／其他(idx20)
      const colorRaw = c[11] ? c[11].v : '';
      const allDayRaw = c[12] ? String(c[12].v || '').trim() : '';
      const startTimeRaw = c[13] ? String(c[13].v || '').trim() : '';
      const endTimeRaw = c[14] ? String(c[14].v || '').trim() : '';
      const isGroupBuyRaw = c[15] ? String(c[15].v || '').trim() : '';
      const publishedRaw = c[16] ? String(c[16].v || '').trim() : '';
      const iconIg = c[17] ? String(c[17].v || '').trim() : '';
      const iconTiktok = c[18] ? String(c[18].v || '').trim() : '';
      const iconFb = c[19] ? String(c[19].v || '').trim() : '';
      const iconEmail = c[20] ? String(c[20].v || '').trim() : '';
      const start = parseDateStr(startRaw);
      const end = parseDateStr(endRaw);
      if (!start || !end || !title) return;
      const extend = parseExtendRaw(extendRaw, end);
      const displayEnd = computeDisplayEnd(end, extend);
      const earlyBird = String(earlyBirdRaw || '').split('/').map(s => s.trim()).filter(s => s !== '');
      const color = String(colorRaw || '').trim();
      const allDay = allDayRaw === '' ? true : (allDayRaw === '是');
      const isGroupBuy = isGroupBuyRaw === '' ? true : (isGroupBuyRaw === '是');
      const published = publishedRaw === '' ? true : (publishedRaw === '是');
      events.push({
        id, start, end, extend, displayEnd, title, tag, category, url, adminUrl, earlyBird,
        color, allDay, startTime: startTimeRaw, endTime: endTimeRaw, isGroupBuy, published,
        iconIg, iconTiktok, iconFb, iconEmail
      });
    });

    allEvents = events;
    statusEl.textContent = `已同步 ${events.length} 檔活動 · ${new Date().toLocaleString('zh-TW')}`;
    populateMonthSelect();
    render();
    renderGroupStatusList('groupStatusList');
    renderGroupStatusList('calGroupList');
  } catch (err) {
    statusEl.textContent = '讀取試算表失敗，請確認試算表已設定「知道連結的人可檢視」。(' + err.message + ')';
    statusEl.classList.add('error');
  }
}

function populateMonthSelect() {
  const sel = document.getElementById('monthSelect');
  const monthsSet = new Set();
  allEvents.forEach(ev => {
    let d = new Date(ev.start.getFullYear(), ev.start.getMonth(), 1);
    const endD = new Date(ev.displayEnd.getFullYear(), ev.displayEnd.getMonth(), 1);
    while (d <= endD) {
      monthsSet.add(`${d.getFullYear()}-${d.getMonth()}`);
      d.setMonth(d.getMonth() + 1);
    }
  });

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}`;
  monthsSet.add(todayKey); // 確保當月一定在選單裡，即使沒有資料

  let months = Array.from(monthsSet).map(s => {
    const [y, m] = s.split('-').map(Number);
    return { y, m };
  }).sort((a, b) => a.y - b.y || a.m - b.m);

  sel.innerHTML = '';
  months.forEach(({ y, m }) => {
    const opt = document.createElement('option');
    opt.value = `${y}-${m}`;
    opt.textContent = `${y}年 ${m + 1}月`;
    sel.appendChild(opt);
  });

  if (currentYear === undefined) {
    // 預設開啟「今天所在的月份」，而不是資料裡最早的月份
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
  }
  sel.value = `${currentYear}-${currentMonth}`;
  sel.onchange = () => {
    const [y, m] = sel.value.split('-').map(Number);
    currentYear = y; currentMonth = m;
    render();
  };
}

function renderWeekdayHeader() {
  const wdEl = document.getElementById('weekdays');
  const days = MODE_VISIBLE_DAYS[currentMode];
  wdEl.innerHTML = '';
  wdEl.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
  days.forEach(wd => {
    const div = document.createElement('div');
    div.className = `weekday wd-${wd}`;
    div.textContent = WD_LABEL[wd];
    wdEl.appendChild(div);
  });
}

function render() {
  if (currentYear === undefined) return;

  const isList = currentMode === 'list';
  document.getElementById('monthNum').textContent = isList ? '總覽' : (currentMonth + 1) + '月';
  document.getElementById('monthSelect').style.display = isList ? 'none' : '';
  document.getElementById('weekdays').style.display = isList ? 'none' : '';
  document.getElementById('grid').style.display = isList ? 'none' : '';
  document.getElementById('calGroupListWrap').style.display = isList ? '' : 'none';

  const legendEl = document.getElementById('legend');
  legendEl.classList.toggle('show', currentMode !== 'all' && currentMode !== 'mytasks' && !isList);

  // 公關品狀態小圖示只在開團日／結團日模式有意義，顯示開關並同步開關樣式
  const prWrap = document.getElementById('prToggleWrap');
  if (prWrap) {
    prWrap.classList.toggle('show', currentMode !== 'all' && currentMode !== 'mytasks' && !isList);
    document.getElementById('prSwitch').classList.toggle('on', prChipOn);
  }

  if (isList) {
    renderGroupStatusList('calGroupList');
    closeCalEditDayPanel();
    return;
  }

  renderWeekdayHeader();

  if (currentMode === 'all') {
    renderAllMode();
  } else if (currentMode === 'mytasks') {
    renderWorkMode();
  } else {
    renderSingleDayMode(currentMode);
  }

  // 切換模式／月份後，之前開著的當日活動面板內容可能已經過期，直接關掉
  closeCalEditDayPanel();
}

function renderAllMode() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  const firstOfMonth = new Date(currentYear, currentMonth, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const gridStart = new Date(currentYear, currentMonth, 1 - startOffset);
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const numWeeks = totalCells / 7;

  // 團購編號：只計算「團購」開關為開啟的活動，依開團日排序，這個月第幾團就是第幾號
  // （非團購活動，例如宅配、截稿日，不會佔用編號）
  const groupBuyNumberMap = computeMonthlyGroupBuyNumbers(currentYear, currentMonth);

  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }
    const weekEnd = weekDays[6];

    const weekEvents = allEvents
      .filter(ev => ev.displayEnd >= weekStart && ev.start <= weekEnd)
      .map(ev => {
        const colStart = Math.max(0, daysBetween(weekStart, ev.start));
        const colEnd = Math.min(6, daysBetween(weekStart, ev.displayEnd));
        return { ev, colStart, colEnd };
      })
      .sort((a, b) => a.colStart - b.colStart || (b.colEnd - b.colStart) - (a.colEnd - a.colStart));

    const laneEnd = [];
    weekEvents.forEach(item => {
      let lane = 0;
      while (lane < laneEnd.length && laneEnd[lane] >= item.colStart) lane++;
      laneEnd[lane] = item.colEnd;
      item.lane = lane;
    });
    const maxLanes = Math.max(1, laneEnd.length);

    const weekEl = document.createElement('div');
    weekEl.className = 'week';
    weekEl.style.gridTemplateColumns = 'repeat(7, minmax(0, 1fr))';
    weekEl.style.gridTemplateRows = `22px repeat(${maxLanes}, 21px) 4px`;

    weekDays.forEach((d, i) => {
      const cell = document.createElement('div');
      const dim = d.getMonth() !== currentMonth;
      const today = isSameDate(d, new Date());
      cell.className = 'daycell' + (dim ? ' dim' : '') + (today ? ' today' : '');
      cell.style.gridColumn = `${i + 1}`;
      const dn = document.createElement('div');
      dn.className = 'daynum';
      dn.textContent = d.getDate();
      cell.appendChild(dn);
      if (calendarEditMode) {
        cell.classList.add('editable');
        const dateCopy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        cell.addEventListener('click', () => openCalEditDayPanel(dateCopy));
      }
      weekEl.appendChild(cell);
    });

    weekEvents.forEach(item => {
      const gbNumber = groupBuyNumberMap.get(item.ev.id);
      // 團購活動：顏色跟著「這個月第幾團」走，色系也會每個月重新循環，跟編號對應一致
      // 非團購活動（沒有 gbNumber）：退回用活動本身的 id 做顏色循環，純粹只是視覺區分
      const colorIdx = gbNumber ? (gbNumber - 1) % COLORS : (item.ev.id - 1) % COLORS;
      const bar = document.createElement('div');
      bar.className = `ebar c${colorIdx} clickable`;
      if (item.ev.color) {
        bar.style.background = item.ev.color;
      }
      bar.addEventListener('click', () => openAdminModal(item.ev));
      bar.style.gridColumn = `${item.colStart + 1} / ${item.colEnd + 2}`;
      bar.style.gridRow = `${item.lane + 2}`;
      bar.title = `${item.ev.title} (${fmtDateLabel(item.ev.start, item.ev.displayEnd)})（點擊查看內部資訊）`;

      if (gbNumber) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = gbNumber;
        bar.appendChild(badge);
      } else if (item.ev.isGroupBuy === false) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '📌';
        badge.style.background = 'rgba(255,255,255,0.55)';
        bar.appendChild(badge);
      }

      const dateSpan = document.createElement('span');
      dateSpan.className = 'ev-date';
      dateSpan.textContent = fmtDateLabel(item.ev.start, item.ev.displayEnd);
      bar.appendChild(dateSpan);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'ev-title';
      titleSpan.textContent = item.ev.title;
      bar.appendChild(titleSpan);

      if (item.ev.tag) {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'ev-tag';
        tagSpan.textContent = item.ev.tag;
        bar.appendChild(tagSpan);
      }

      weekEl.appendChild(bar);
    });

    grid.appendChild(weekEl);
  }
}

// 計算「這個月」團購活動的編號：依開始日期排序，只算 isGroupBuy !== false 的活動
// 回傳 Map：eventId -> 第幾團（1 起算）
function computeMonthlyGroupBuyNumbers(year, month) {
  const map = new Map();
  const inMonth = allEvents.filter(ev => {
    if (ev.isGroupBuy === false) return false;
    return ev.start.getFullYear() === year && ev.start.getMonth() === month;
  }).sort((a, b) => a.start - b.start || a.id - b.id);
  inMonth.forEach((ev, idx) => map.set(ev.id, idx + 1));
  return map;
}

function renderSingleDayMode(mode) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  const visibleDays = MODE_VISIBLE_DAYS[mode];
  const colCount = visibleDays.length;

  const firstOfMonth = new Date(currentYear, currentMonth, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const gridStart = new Date(currentYear, currentMonth, 1 - startOffset);
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const numWeeks = totalCells / 7;

  const dateKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const eventsByDate = {};
  allEvents.forEach(ev => {
    const targetDate = mode === 'start' ? ev.start : ev.displayEnd;
    const wd = targetDate.getDay();
    if (!visibleDays.includes(wd)) return;
    const key = dateKey(targetDate);
    if (!eventsByDate[key]) eventsByDate[key] = [];
    eventsByDate[key].push(ev);
  });

  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }

    const weekEl = document.createElement('div');
    weekEl.className = 'week';
    weekEl.style.gridTemplateColumns = `repeat(${colCount}, minmax(0, 1fr))`;
    weekEl.style.gridTemplateRows = 'auto';

    visibleDays.forEach((wd, colIdx) => {
      const d = weekDays[wd];
      const dim = d.getMonth() !== currentMonth;
      const today = isSameDate(d, new Date());
      const cell = document.createElement('div');
      cell.className = 'daycell-list' + (dim ? ' dim' : '') + (today ? ' today' : '');
      cell.style.gridColumn = `${colIdx + 1}`;

      const dn = document.createElement('div');
      dn.className = 'daynum';
      dn.textContent = d.getDate();
      cell.appendChild(dn);

      const key = dateKey(d);
      const dayEvents = eventsByDate[key] || [];
      if (dayEvents.length) {
        const stack = document.createElement('div');
        stack.className = 'events-stack';
        dayEvents.forEach(ev => {
          const frozen = isFrozenEvent(ev);
          const status = getEventStatus(ev);
          const unpublished = ev.published === false;
          const bar = document.createElement('div');
          const catClass = unpublished ? 'cat-unpublished' : (frozen ? 'cat-frozen' : `cat-${status}`);
          bar.className = `ebar ebar-wrap ${catClass} clickable`;
          bar.addEventListener('click', (e) => {
            e.stopPropagation();
            openAdminModal(ev);
          });
          bar.title = `${ev.title} (${mode === 'start' ? '開團' : '結團'} ${fmtSingleDate(mode === 'start' ? ev.start : ev.displayEnd)})（點擊查看內部資訊）` + (unpublished ? '　🔔 尚未確認顯示於前台' : '');

          const titleSpan = document.createElement('span');
          titleSpan.className = 'ev-title ev-title-wrap';
          const lines = wrapTitleLines(ev.title, 4);
          lines.forEach((line, idx) => {
            if (idx > 0) titleSpan.appendChild(document.createElement('br'));
            titleSpan.appendChild(document.createTextNode(line));
          });
          bar.appendChild(titleSpan);

          // 後台行事曆改用公關品狀態小圖示，不再顯示 F 欄標籤（如抽免單）
          if (prChipOn) {
            const pr = prStatusMap[getMemoKey(ev)];
            const st = pr && pr.status ? pr.status : '尚未選品';
            const chip = document.createElement('span');
            chip.className = 'pr-chip pr-' + PR_STATUS_CLASS[st];
            chip.textContent = st;
            bar.appendChild(chip);
          }

          // 【拿掉】冷凍團倒數天數小圓點功能已依需求整個移除，冷凍團只保留藍色底+雪花浮水印

          stack.appendChild(bar);
        });
        cell.appendChild(stack);
      }

      if (calendarEditMode) {
        cell.classList.add('editable');
        const dateCopy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        cell.addEventListener('click', () => openCalEditDayPanel(dateCopy));
      }

      weekEl.appendChild(cell);
    });

    grid.appendChild(weekEl);
  }
}

// 把 <input type="date"> 存的 'YYYY-MM-DD' 字串轉成 Date 物件，格式不對就回傳 null
function parseYmd(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 行事曆「工作表」模式：不顯示團購，改成把自己安排好日期的工作排進對應日期，點擊會前往「我的任務」
function renderWorkMode() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';

  const visibleDays = MODE_VISIBLE_DAYS.mytasks;
  const colCount = visibleDays.length;

  const firstOfMonth = new Date(currentYear, currentMonth, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const gridStart = new Date(currentYear, currentMonth, 1 - startOffset);
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const numWeeks = totalCells / 7;

  const dateKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const tasksByDate = {};
  myTasks().forEach(t => {
    const d = parseYmd(t.date);
    if (!d) return; // 沒有指定日期的工作不會出現在這個檢視裡
    const key = dateKey(d);
    if (!tasksByDate[key]) tasksByDate[key] = [];
    tasksByDate[key].push(t);
  });

  for (let w = 0; w < numWeeks; w++) {
    const weekStart = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7);
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      weekDays.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    }

    const weekEl = document.createElement('div');
    weekEl.className = 'week';
    weekEl.style.gridTemplateColumns = `repeat(${colCount}, minmax(0, 1fr))`;
    weekEl.style.gridTemplateRows = 'auto';

    visibleDays.forEach((wd, colIdx) => {
      const d = weekDays[wd];
      const dim = d.getMonth() !== currentMonth;
      const today = isSameDate(d, new Date());
      const cell = document.createElement('div');
      cell.className = 'daycell-list' + (dim ? ' dim' : '') + (today ? ' today' : '');
      cell.style.gridColumn = `${colIdx + 1}`;

      const dn = document.createElement('div');
      dn.className = 'daynum';
      dn.textContent = d.getDate();
      cell.appendChild(dn);

      const key = dateKey(d);
      const dayTasks = tasksByDate[key] || [];
      if (dayTasks.length) {
        const stack = document.createElement('div');
        stack.className = 'events-stack';
        dayTasks.forEach(t => {
          const bar = document.createElement('div');
          const catClass = t.done ? 'cat-work-done' : (t.urgent ? 'cat-work-urgent' : 'cat-work');
          bar.className = `ebar ebar-wrap ${catClass} clickable`;
          bar.addEventListener('click', () => switchView('myTasks'));
          bar.title = (t.taskName || '') + (t.done ? '（已完成）' : '') + '（點擊前往我的任務）';

          const titleSpan = document.createElement('span');
          titleSpan.className = 'ev-title ev-title-wrap';
          const lines = wrapTitleLines(t.taskName || '', 4);
          lines.forEach((line, idx) => {
            if (idx > 0) titleSpan.appendChild(document.createElement('br'));
            titleSpan.appendChild(document.createTextNode(line));
          });
          bar.appendChild(titleSpan);

          stack.appendChild(bar);
        });
        cell.appendChild(stack);
      }

      weekEl.appendChild(cell);
    });

    grid.appendChild(weekEl);
  }
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isStarted(ev) {
  return startOfDay(new Date()) >= startOfDay(ev.start);
}

// 團購狀態：未開團 / 已開團 / 即將結單（結束前一天起）/ 已結團
function getEventStatus(ev) {
  const todayStart = startOfDay(new Date());
  const startD = startOfDay(ev.start);
  const endD = startOfDay(ev.displayEnd);
  if (todayStart < startD) return 'upcoming';
  if (todayStart > endD) return 'ended';
  const closeThreshold = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate() - 1);
  if (todayStart >= closeThreshold) return 'closingSoon';
  return 'active';
}

// ===== 內部後台彈窗 =====

function getMemoKey(ev) {
  const s = ev.start;
  return `${ev.id}_${s.getFullYear()}-${s.getMonth() + 1}-${s.getDate()}`;
}

// 開團狀態清單：結團倒數／現正團購中，卡片點擊直接開啟後台浮動視窗
// 【新】三個位置可以插入自訂區塊：before＝團購清單全部之前、between＝結團倒數與現正團購中之間、after＝團購清單全部之後
function renderGroupStatusList(targetId) {
  const listEl = document.getElementById(targetId || 'groupStatusList');
  if (!listEl) return;
  listEl.innerHTML = '';

  appendCustomBlocksAdmin(listEl, 'before');

  const todayStart = startOfDay(new Date());
  const closingItems = [];
  const activeItems = [];

  allEvents.forEach(ev => {
    const status = getEventStatus(ev);
    if (status === 'closingSoon') closingItems.push(ev);
    else if (status === 'active') activeItems.push(ev);
  });

  closingItems.sort((a, b) => a.displayEnd - b.displayEnd);
  activeItems.sort((a, b) => a.displayEnd - b.displayEnd);

  const buildCard = (ev) => {
    const daysLeft = daysBetween(todayStart, startOfDay(ev.displayEnd));
    const isToday = daysLeft === 0 && getEventStatus(ev) === 'closingSoon';
    const frozen = isFrozenEvent(ev);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gs-card' + (isToday ? ' gs-today' : '');
    card.addEventListener('click', () => openAdminModal(ev));

    const nameEl = document.createElement('div');
    nameEl.className = 'gs-card-name';
    nameEl.textContent = ev.title;
    card.appendChild(nameEl);

    const dateEl = document.createElement('div');
    dateEl.className = 'gs-card-date';
    dateEl.textContent = `${fmtSingleDate(ev.start)}–${fmtSingleDate(ev.displayEnd)}`;
    card.appendChild(dateEl);

    const icons = buildEventIconElements(ev);
    if (icons.length) {
      const iconsWrap = document.createElement('div');
      iconsWrap.className = 'gs-card-icons';
      icons.forEach(el => iconsWrap.appendChild(el));
      card.appendChild(iconsWrap);
    }

    if (frozen || isToday) {
      const badges = document.createElement('div');
      badges.className = 'gs-badges';
      if (frozen) {
        const frozenBadge = document.createElement('span');
        frozenBadge.className = 'gs-frozen-badge';
        frozenBadge.textContent = '❄冷藏冷凍團';
        badges.appendChild(frozenBadge);
      }
      if (isToday) {
        const todayBadge = document.createElement('span');
        todayBadge.className = 'gs-today-badge';
        todayBadge.textContent = '今日截止';
        badges.appendChild(todayBadge);
      }
      card.appendChild(badges);
    }

    return card;
  };

  const buildSection = (title, arr) => {
    if (!arr.length) return;
    const h = document.createElement('div');
    h.className = 'gs-section-title ' + (title.includes('倒數') ? 'gs-title-closing' : 'gs-title-active');
    h.textContent = title;
    listEl.appendChild(h);
    arr.forEach(ev => listEl.appendChild(buildCard(ev)));
  };

  buildSection('‼️結團倒數‼️', closingItems);
  appendCustomBlocksAdmin(listEl, 'between');
  buildSection('🌼現正團購中🌼', activeItems);

  if (!closingItems.length && !activeItems.length) {
    const empty = document.createElement('div');
    empty.className = 'gs-empty';
    empty.textContent = '目前沒有進行中的團購';
    listEl.appendChild(empty);
  }

  appendCustomBlocksAdmin(listEl, 'after');
}

// 【新】渲染活動彈窗裡的「📊 數據」瀏覽/點擊次數區塊
// 除了整體瀏覽/點擊，還會顯示團名彈窗「前往觀看介紹／食譜大全／前往下單」三顆按鈕各自的點擊次數
// （這三個統計 key 格式固定是 團購key + '_intro' / '_recipe' / '_order'，跟前台 index.html 送出的 key 一致）
function renderAdminStatsBox(key) {
  const box = document.getElementById('adminStatsBox');
  if (!box) return;
  const st = statsMap[key] || { views: 0, clicks: 0 };
  let html =
    `<span class="admin-stats-item">👀 瀏覽 <b>${st.views || 0}</b> 次</span>` +
    `<span class="admin-stats-item">🖱️ 點擊 <b>${st.clicks || 0}</b> 次</span>`;

  const introClicks = (statsMap[key + '_intro'] || {}).clicks || 0;
  const recipeClicks = (statsMap[key + '_recipe'] || {}).clicks || 0;
  const orderClicks = (statsMap[key + '_order'] || {}).clicks || 0;
  if (introClicks || recipeClicks || orderClicks) {
    html +=
      `<span class="admin-stats-item">📖 介紹 <b>${introClicks}</b> 次</span>` +
      `<span class="admin-stats-item">🍽 食譜 <b>${recipeClicks}</b> 次</span>` +
      `<span class="admin-stats-item">🛒 下單 <b>${orderClicks}</b> 次</span>`;
  }
  box.innerHTML = html;
}

function openAdminModal(ev) {
  currentModalEv = ev;
  const key = getMemoKey(ev);

  document.getElementById('adminModalBadge').textContent = `編號 ${ev.id}`;
  document.getElementById('adminModalTitle').textContent = ev.title;
  document.getElementById('adminModalMeta').textContent =
    `開團 ${fmtSingleDate(ev.start)}　結單 ${fmtSingleDate(ev.displayEnd)}` +
    (isFrozenEvent(ev) ? '　❄冷凍團' : '');

  renderAdminPublishBox(ev);
  renderAdminStatsBox(key);

  const ebBox = document.getElementById('adminEarlyBirdBox');
  const ebList = document.getElementById('adminEarlyBirdList');
  if (ev.earlyBird && ev.earlyBird.length) {
    ebList.innerHTML = '';
    ev.earlyBird.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      ebList.appendChild(li);
    });
    ebBox.style.display = 'block';
  } else {
    ebBox.style.display = 'none';
  }

  const goUrlEl = document.getElementById('adminGoUrl');
  if (ev.url) {
    goUrlEl.href = ev.url;
    goUrlEl.style.display = 'block';
  } else {
    goUrlEl.removeAttribute('href');
    goUrlEl.style.display = 'none';
  }

  const savedBackendUrl = urlMap[key] || '';
  const backendEl = document.getElementById('adminBackendUrl');
  if (savedBackendUrl) {
    backendEl.href = savedBackendUrl;
    backendEl.style.opacity = '1';
    backendEl.style.pointerEvents = 'auto';
  } else {
    backendEl.href = 'javascript:void(0)';
    backendEl.style.opacity = '0.5';
    backendEl.style.pointerEvents = 'none';
  }
  document.getElementById('backendUrlInput').value = savedBackendUrl;
  document.getElementById('backendUrlStatus').textContent = '';

  const memoEl = document.getElementById('memoText');
  memoEl.value = memoMap[key] || '';
  document.getElementById('memoStatus').textContent = '';

  renderPrPanel(key);

  document.getElementById('adminModal').classList.add('show');
}

// 前台顯示狀態小方塊 + 確認顯示按鈕
function renderAdminPublishBox(ev) {
  const box = document.getElementById('adminPublishBox');
  const text = document.getElementById('adminPublishText');
  const btn = document.getElementById('adminPublishBtn');
  const published = ev.published !== false; // 沒有這個欄位（舊資料）＝視為已發布
  box.classList.toggle('is-published', published);
  text.textContent = published ? '✅ 已顯示於前台' : '🔔 尚未確認顯示於前台';
  btn.style.display = published ? 'none' : 'inline-block';
}

document.getElementById('adminPublishBtn').addEventListener('click', async () => {
  if (!currentModalEv) return;
  const btn = document.getElementById('adminPublishBtn');
  btn.disabled = true;
  btn.textContent = '處理中…';
  try {
    await postTask({ type: 'event-update', id: currentModalEv.id, published: true });
    currentModalEv.published = true;
    renderAdminPublishBox(currentModalEv);
    render();
  } catch (err) {
    alert('更新失敗：' + err.message);
  }
  btn.disabled = false;
  btn.textContent = '✅ 確認顯示於前台';
});

document.getElementById('adminEditEventBtn').addEventListener('click', () => {
  if (!currentModalEv) return;
  closeAdminModal();
  openEventEditModal(currentModalEv);
});

// 依 key 渲染公關品狀態面板：狀態下拉、選品網址、位置的顯示與內容
function renderPrPanel(key) {
  const pr = prStatusMap[key] || { status: '', url: '', location: '' };
  const status = pr.status || '尚未選品';

  // 狀態下拉（若還沒建立選項就建立一次）
  const sel = document.getElementById('prStatusSelect');
  if (!sel.options.length) {
    PR_STATUS_LIST.forEach(s => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  }
  sel.value = status;

  const headChip = document.getElementById('prHeadChip');
  headChip.textContent = status;
  headChip.className = 'pr-head-chip pr-' + PR_STATUS_CLASS[status];

  // 選品網址
  document.getElementById('prUrlInput').value = pr.url || '';
  // 位置（下拉，可能含使用者之前存的自訂值）
  fillPrLocationSelect(document.getElementById('prLocationSelect'), pr.location || '');
  document.getElementById('prLocationNewRow').classList.remove('show');

  // 清空儲存提示
  ['prStatusSaveMsg', 'prUrlSaveMsg', 'prLocationSaveMsg'].forEach(id => {
    document.getElementById(id).textContent = '';
  });

  updatePrConditionalFields(status);

  // 面板預設收合，避免視窗過長
  document.getElementById('prPanel').classList.remove('open');
}

// 依狀態切換「選品網址」「位置」欄位的顯示
function updatePrConditionalFields(status) {
  const pickField = document.getElementById('prPickField');
  const locField = document.getElementById('prLocationField');

  // 選品中 → 顯示選品網址／可選品項
  pickField.style.display = (status === '選品中') ? 'block' : 'none';

  // 已收到 / 已拍攝 → 顯示位置
  locField.style.display = (status === '已收到' || status === '已拍攝') ? 'block' : 'none';

  // 前往選品按鈕：有有效網址才顯示
  const url = (document.getElementById('prUrlInput').value || '').trim();
  const goBtn = document.getElementById('prGoBtn');
  if (status === '選品中' && /^https?:\/\//i.test(url)) {
    goBtn.href = url;
    goBtn.style.display = 'inline-block';
  } else {
    goBtn.style.display = 'none';
  }
}

// 位置下拉共用小工具：填入清單＋「＋新增更多」，並保留目前值（即使不在清單裡也會顯示）
function fillPrLocationSelect(selectEl, currentValue) {
  if (!selectEl) return;
  const prev = currentValue !== undefined ? currentValue : selectEl.value;
  selectEl.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '請選擇位置…';
  selectEl.appendChild(ph);
  const opts = prLocations.slice();
  if (prev && opts.indexOf(prev) === -1) opts.unshift(prev); // 保留舊資料裡不在清單中的自訂值
  opts.forEach(loc => {
    const o = document.createElement('option');
    o.value = loc;
    o.textContent = loc;
    selectEl.appendChild(o);
  });
  const addMore = document.createElement('option');
  addMore.value = '__new__';
  addMore.textContent = '＋ 新增更多';
  selectEl.appendChild(addMore);
  selectEl.value = prev || '';
}

function setPrMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = ok === true ? '#7BAF7B' : (ok === false ? '#d9534f' : '#c9a892');
}

// 送出公關品狀態更新（樂觀更新，失敗還原）
async function savePrStatus(key, fields, msgElId) {
  const prev = prStatusMap[key] ? Object.assign({}, prStatusMap[key]) : { status: '', url: '', location: '' };
  prStatusMap[key] = Object.assign({}, prev, fields);
  const msgEl = msgElId ? document.getElementById(msgElId) : null;
  if (msgEl) { msgEl.textContent = '儲存中…'; msgEl.style.color = '#c9a892'; }
  // 若行事曆正顯示狀態小圖示，即時更新
  if (currentView === 'calendar' && prChipOn) render();
  try {
    await postTask(Object.assign({ type: 'pr-status', key }, fields));
    if (msgEl) { msgEl.textContent = '已儲存 ✓'; msgEl.style.color = '#7BAF7B'; }
  } catch (err) {
    prStatusMap[key] = prev;
    if (msgEl) { msgEl.textContent = '儲存失敗'; msgEl.style.color = '#d9534f'; }
    if (currentView === 'calendar' && prChipOn) render();
    throw err;
  }
}

// 派遣「廠商選品」時，用廠商名找出對應的團購，自動更新公關品狀態為「選品中」
// 找法：標題含廠商名的團購，優先「正在開團中」，否則取開團日最接近今天的一場
function syncPrStatusFromDispatch(taskName, extra) {
  if (taskName !== '廠商選品' || !extra) return Promise.resolve();
  const url = (extra['選品網址'] || '').trim();

  // 有指定對應團購 → 直接用它的 key，最精準
  const evKey = (extra['團購key'] || '').trim();
  if (evKey) {
    const fields = { status: '選品中' };
    if (url) fields.url = url;
    return savePrStatus(evKey, fields, null);
  }

  // 沒指定 → 退回用廠商名比對團購標題（相容舊做法）
  const vendor = (extra['廠商'] || '').trim();
  if (!vendor || !allEvents.length) return Promise.resolve();

  const matched = allEvents.filter(ev => ev.title && ev.title.indexOf(vendor) !== -1);
  if (!matched.length) return Promise.resolve();

  const todayStart = startOfDay(new Date());
  let target = matched.find(ev => {
    const s = startOfDay(ev.start), e = startOfDay(ev.displayEnd);
    return todayStart >= s && todayStart <= e;
  });
  if (!target) {
    target = matched.slice().sort((a, b) =>
      Math.abs(a.start - todayStart) - Math.abs(b.start - todayStart)
    )[0];
  }
  if (!target) return Promise.resolve();

  const key = getMemoKey(target);
  const fields = { status: '選品中' };
  if (url) fields.url = url;
  return savePrStatus(key, fields, null);
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('show');
  currentModalEv = null;
}

function copyText(text, btnEl) {
  if (!text) return;
  const done = () => {
    const original = btnEl.textContent;
    btnEl.textContent = '✅';
    setTimeout(() => { btnEl.textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  done();
}

// ===== 備忘錄：讀取／儲存（透過 Google Apps Script） =====

// 幫每一個要送給後端的物件自動帶上 token，之後所有 POST 都用這個包一下
function withToken(obj) {
  return Object.assign({ token: currentToken || '' }, obj);
}

async function fetchMemos() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    appPassword = FALLBACK_PASSWORD;
    return;
  }
  try {
    let noCacheUrl = APPS_SCRIPT_URL + (APPS_SCRIPT_URL.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
    if (currentToken) {
      noCacheUrl += '&token=' + encodeURIComponent(currentToken);
    }
    const res = await fetch(noCacheUrl, { cache: 'no-store' });
    const data = await res.json();

    // 未登入或登入逾時：後端只會回傳公開資料，把使用者踢回登入畫面
    if (data.unauthorized) {
      currentToken = null;
      currentUser = null;
      sessionStorage.removeItem('admin_unlocked');
      sessionStorage.removeItem('admin_user');
      sessionStorage.removeItem('admin_token');
      document.getElementById('passwordGate').style.display = 'flex';
      document.getElementById('mainWrap').style.visibility = 'hidden';
      return;
    }

    memoMap = data.memos || {};
    urlMap = data.urls || {};
    staffList = Array.isArray(data.staff) ? data.staff : [];
    taskNames = Array.isArray(data.taskNames) ? data.taskNames : [];
    myTaskNames = Array.isArray(data.myTaskNames) ? data.myTaskNames : [];
    tasksMap = data.tasks || {};
    vendors = Array.isArray(data.vendors) ? data.vendors : [];
    prStatusMap = data.prStatus || {};
    prLocations = Array.isArray(data.prLocations) ? data.prLocations : [];
    statsMap = data.stats || {};
    isAdmin = !!data.isAdmin;
    myPermissions = data.permissions || {};
    allPermissions = data.allPermissions || {};
    updatePermissionUI();
    customBlocks = Array.isArray(data.customBlocks) ? data.customBlocks : [];
    renderGroupStatusList('groupStatusList');
    renderGroupStatusList('calGroupList');
    todoCategories = Array.isArray(data.todoCategories) ? data.todoCategories : [];
    todos = Array.isArray(data.todos) ? data.todos : [];
    if (currentUser) {
      renderTaskUI();
    }
    if (currentView === 'todoList' && typeof renderTodoGroups === 'function') {
      renderTodoGroups();
    }
    if (currentView === 'calendar' && typeof render === 'function') {
      render();
    }
    // 若目前正打開活動彈窗，順便刷新一次數據顯示
    if (currentModalEv && document.getElementById('adminModal').classList.contains('show')) {
      renderAdminStatsBox(getMemoKey(currentModalEv));
    }
    const taskModalEl = document.getElementById('taskModal');
    if (taskModalCtx && taskModalEl && taskModalEl.classList.contains('show')) {
      renderStageQuick();
    }
  } catch (err) {
    console.warn('後台資料讀取失敗：', err);
  }
}

// 依目前登入者的身份／權限，切換相關功能入口的顯示與隱藏
function updatePermissionUI() {
  const showImageLib = isAdmin || !!myPermissions.imageLibrary;
  const iconEl = document.getElementById('toolIconImageLibrary');
  if (iconEl) iconEl.style.display = showImageLib ? '' : 'none';

  const permBtn = document.getElementById('settingsHubPermissionsBtn');
  if (permBtn) permBtn.style.display = isAdmin ? '' : 'none';
}

async function tryUnlock() {
  const nameInput = document.getElementById('gateNameInput');
  const input = document.getElementById('gatePasswordInput');
  const errEl = document.getElementById('gateError');
  const btn = document.getElementById('gateSubmitBtn');
  btn.disabled = true;
  errEl.textContent = '';

  const nameValue = nameInput.value.trim();
  if (!nameValue || !input.value) {
    errEl.textContent = '請輸入姓名與密碼';
    btn.disabled = false;
    return;
  }

  // 尚未設定後端網址：走原本的保底密碼，離線也能用
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    if (input.value === FALLBACK_PASSWORD) {
      currentUser = nameValue || '雪莉';
      currentToken = null;
      sessionStorage.setItem('admin_unlocked', '1');
      sessionStorage.setItem('admin_user', currentUser);
      document.getElementById('passwordGate').style.display = 'none';
      document.getElementById('mainWrap').style.visibility = 'visible';
      initAppUI();
    } else {
      errEl.textContent = '密碼錯誤，請再試一次';
      input.value = '';
      input.focus();
    }
    btn.disabled = false;
    return;
  }

  errEl.textContent = '登入中…';
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'login', name: nameValue, password: input.value })
    });
    const result = await res.json();

    if (result.success) {
      currentUser = result.name;
      currentToken = result.token;
      sessionStorage.setItem('admin_unlocked', '1');
      sessionStorage.setItem('admin_user', currentUser);
      sessionStorage.setItem('admin_token', currentToken);
      document.getElementById('passwordGate').style.display = 'none';
      document.getElementById('mainWrap').style.visibility = 'visible';
      await fetchMemos();
      initAppUI();
    } else {
      errEl.textContent = result.error || '姓名或密碼錯誤，請再試一次';
      input.value = '';
      input.focus();
    }
  } catch (err) {
    errEl.textContent = '連線失敗，請檢查網路後再試一次';
  }
  btn.disabled = false;
}

document.getElementById('gateSubmitBtn').addEventListener('click', tryUnlock);
document.getElementById('gatePasswordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
});

if (sessionStorage.getItem('admin_unlocked') === '1') {
  currentUser = sessionStorage.getItem('admin_user') || '雪莉';
  currentToken = sessionStorage.getItem('admin_token') || null;
  document.getElementById('passwordGate').style.display = 'none';
  document.getElementById('mainWrap').style.visibility = 'visible';
  fetchMemos().then(() => initAppUI()); // 重新用 token 跟後端要一次資料，順便確認 token 沒過期
} else {
  document.getElementById('gatePasswordInput').focus();
}
document.getElementById('refreshBtn').addEventListener('click', loadData);

// ===== 行事曆編輯模式：開關、當日活動面板 =====
document.getElementById('calEditToggleBtn').addEventListener('click', () => {
  calendarEditMode = !calendarEditMode;
  document.getElementById('calEditToggleBtn').classList.toggle('on', calendarEditMode);
  if (!calendarEditMode) closeCalEditDayPanel();
  render();
});

function closeCalEditDayPanel() {
  calEditSelectedDate = null;
  const panel = document.getElementById('calEditDayPanel');
  if (panel) panel.style.display = 'none';
}

function openCalEditDayPanel(date) {
  calEditSelectedDate = date;
  const panel = document.getElementById('calEditDayPanel');
  const title = document.getElementById('calEditDayTitle');
  const listEl = document.getElementById('calEditDayList');

  title.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（週${WD_LABEL[date.getDay()]}）活動`;
  listEl.innerHTML = '';

  const dayEvents = allEvents.filter(ev => {
    const s = startOfDay(ev.start);
    const e = startOfDay(ev.displayEnd);
    const target = startOfDay(date);
    return target >= s && target <= e;
  }).sort((a, b) => a.start - b.start);

  if (!dayEvents.length) {
    const empty = document.createElement('div');
    empty.className = 'cal-edit-day-empty';
    empty.textContent = '這天還沒有安排任何活動';
    listEl.appendChild(empty);
  } else {
    dayEvents.forEach(ev => {
      const row = document.createElement('div');
      row.className = 'cal-edit-day-row';
      row.addEventListener('click', () => openEventEditModal(ev));

      const swatch = document.createElement('span');
      swatch.className = 'cal-edit-day-swatch';
      swatch.style.background = ev.color || EVENT_COLOR_PRESETS[(ev.id - 1) % EVENT_COLOR_PRESETS.length];
      row.appendChild(swatch);

      const nameEl = document.createElement('span');
      nameEl.className = 'cal-edit-day-row-name';
      nameEl.textContent = ev.title;
      row.appendChild(nameEl);

      if (ev.published === false) {
        const tag = document.createElement('span');
        tag.className = 'cal-edit-day-row-tag';
        tag.textContent = '尚未確認顯示';
        row.appendChild(tag);
      }

      listEl.appendChild(row);
    });
  }

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('calEditDayCloseBtn').addEventListener('click', closeCalEditDayPanel);
document.getElementById('calEditDayAddBtn').addEventListener('click', () => {
  openEventEditModal(null, calEditSelectedDate);
});

// ===== 新增／編輯活動浮動視窗 =====
let eventEditCtx = null; // { isNew, ev }

function initEventColorPresets() {
  const box = document.getElementById('evColorPresets');
  if (!box) return;
  box.innerHTML = '';
  EVENT_COLOR_PRESETS.forEach(hex => {
    const sw = document.createElement('span');
    sw.className = 'ev-color-preset-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      document.getElementById('evColorInput').value = hex;
    });
    box.appendChild(sw);
  });
}
initEventColorPresets();

// 開始/結束時間改用簡約下拉選單（避免手機上原生時間選單無限滾動的輪盤）
// 上午/下午 + 小時(1~12) + 分鐘(每10分鐘一格 0~50)，都是有底有頂的固定清單
function initEventTimeSelects() {
  const hourIds = ['evStartHourInput', 'evEndHourInput'];
  const minuteIds = ['evStartMinuteInput', 'evEndMinuteInput'];
  hourIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    for (let h = 1; h <= 12; h++) {
      const opt = document.createElement('option');
      opt.value = String(h).padStart(2, '0');
      opt.textContent = String(h).padStart(2, '0');
      sel.appendChild(opt);
    }
  });
  minuteIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    for (let m = 0; m <= 50; m += 10) {
      const opt = document.createElement('option');
      opt.value = String(m).padStart(2, '0');
      opt.textContent = String(m).padStart(2, '0');
      sel.appendChild(opt);
    }
  });
}
initEventTimeSelects();

// 把 24 小時制的「HH:MM」字串套進 上午/下午＋小時＋分鐘 下拉選單；分鐘會自動對齊到最近的 10 分鐘格
function setEvTimeSelects(amPmId, hourId, minuteId, timeStr) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(timeStr || '').trim());
  let h24 = 9, mi = 0; // 沒有資料時預設上午9:00，比半夜0點合理
  if (m) {
    h24 = Math.min(23, Math.max(0, parseInt(m[1], 10) || 0));
    mi = Math.min(50, Math.round((parseInt(m[2], 10) || 0) / 10) * 10);
  }
  const amPm = h24 < 12 ? 'AM' : 'PM';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  document.getElementById(amPmId).value = amPm;
  document.getElementById(hourId).value = String(h12).padStart(2, '0');
  document.getElementById(minuteId).value = String(mi).padStart(2, '0');
}

// 把 上午/下午＋小時(1~12)＋分鐘 下拉選單的值，換算回 24 小時制的「HH:MM」字串存進試算表
function getEvTimeValue(amPmId, hourId, minuteId) {
  const amPm = document.getElementById(amPmId).value;
  let h12 = parseInt(document.getElementById(hourId).value, 10) || 12;
  let h24 = h12 % 12;
  if (amPm === 'PM') h24 += 12;
  return String(h24).padStart(2, '0') + ':' + document.getElementById(minuteId).value;
}

// 日期輸入框旁邊顯示「XXXX年X月X日(週幾)」的提示文字
function fmtWeekdayHint(dateStr) {
  const d = parseYmd(dateStr);
  if (!d) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（週${WD_LABEL[d.getDay()]}）`;
}
function updateEvWeekdayHints() {
  document.getElementById('evStartWeekdayHint').textContent = fmtWeekdayHint(document.getElementById('evStartDateInput').value);
  document.getElementById('evEndWeekdayHint').textContent = fmtWeekdayHint(document.getElementById('evEndDateInput').value);
}
document.getElementById('evStartDateInput').addEventListener('change', updateEvWeekdayHints);
document.getElementById('evEndDateInput').addEventListener('change', updateEvWeekdayHints);

function setEvSwitch(id, on) {
  document.getElementById(id).classList.toggle('on', on);
}
function isEvSwitchOn(id) {
  return document.getElementById(id).classList.contains('on');
}

// 整日開關：關閉整日才需要設定時間，所以開啟時把時間欄隱藏起來
document.getElementById('evAllDaySwitch').addEventListener('click', () => {
  const on = !isEvSwitchOn('evAllDaySwitch');
  setEvSwitch('evAllDaySwitch', on);
  document.getElementById('evStartTimeWrap').style.display = on ? 'none' : '';
  document.getElementById('evEndTimeWrap').style.display = on ? 'none' : '';
});
document.getElementById('evGroupBuySwitch').addEventListener('click', () => {
  setEvSwitch('evGroupBuySwitch', !isEvSwitchOn('evGroupBuySwitch'));
});

// 「更多設定」可折疊區塊：標籤／延長時間／早鳥禮／網址／分類／前台顯示／社群圖示
document.getElementById('evMoreToggle').addEventListener('click', () => {
  const toggle = document.getElementById('evMoreToggle');
  const body = document.getElementById('evMoreBody');
  const open = toggle.classList.toggle('open');
  body.style.display = open ? 'block' : 'none';
  document.getElementById('evMoreArrow').textContent = open ? '▴' : '▾';
});

// ===== 【新】社群小圖示按鈕：新增／編輯活動視窗裡的 4 個圖示，點擊跳出 prompt 輸入網址 =====
let evIconValues = {};
function initEventIconButtons() {
  const box = document.getElementById('evIconRow');
  if (!box || box.dataset.bound) return;
  box.dataset.bound = '1';
  EVENT_ICON_DEFS.forEach(def => {
    const btn = box.querySelector(`[data-key="${def.key}"]`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const current = evIconValues[def.key] || '';
      const input = prompt(`輸入${def.label}網址（留空即可清除）：`, current);
      if (input === null) return; // 按取消不變更
      evIconValues[def.key] = input.trim();
      btn.classList.toggle('set', !!evIconValues[def.key]);
    });
  });
}
initEventIconButtons();

function setEventIconButtons(ev) {
  evIconValues = {
    iconIg: ev ? (ev.iconIg || '') : '',
    iconTiktok: ev ? (ev.iconTiktok || '') : '',
    iconFb: ev ? (ev.iconFb || '') : '',
    iconEmail: ev ? (ev.iconEmail || '') : ''
  };
  const box = document.getElementById('evIconRow');
  if (!box) return;
  EVENT_ICON_DEFS.forEach(def => {
    const btn = box.querySelector(`[data-key="${def.key}"]`);
    if (btn) btn.classList.toggle('set', !!evIconValues[def.key]);
  });
}

function ymdStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ev 為 null＝新增活動；prefillDate 是從「當日活動面板」的＋新增活動點進來時，預先帶入的日期
function openEventEditModal(ev, prefillDate) {
  const isNew = !ev;
  eventEditCtx = { isNew, ev };
  document.getElementById('eventEditTitle').textContent = isNew ? '➕ 新增活動' : '✏️ 編輯活動';
  document.getElementById('evDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  setFormStatus('evEditStatus', '', '');

  const defaultColor = ev ? (ev.color || EVENT_COLOR_PRESETS[(ev.id - 1) % EVENT_COLOR_PRESETS.length]) : EVENT_COLOR_PRESETS[0];
  document.getElementById('evTitleInput').value = ev ? ev.title : '';
  document.getElementById('evColorInput').value = defaultColor || '#FF8FA3';
  document.getElementById('evUrlInput').value = ev ? (ev.url || '') : '';
  document.getElementById('evCategoryInput').value = ev ? (ev.category || '') : '';
  document.getElementById('evTagInput').value = ev ? (ev.tag || '') : '';
  document.getElementById('evExtendInput').value = (ev && ev.extend && ev.extend.type === 'days') ? ev.extend.value : '';
  document.getElementById('evEarlyBirdInput').value = ev && ev.earlyBird && ev.earlyBird.length ? ev.earlyBird.join('\n') : '';
  document.getElementById('evPublishedInput').checked = ev ? (ev.published !== false) : false;
  setEventIconButtons(ev);

  // 每次打開都先收合「更多設定」，畫面維持乾淨
  document.getElementById('evMoreToggle').classList.remove('open');
  document.getElementById('evMoreBody').style.display = 'none';
  document.getElementById('evMoreArrow').textContent = '▾';

  const allDay = ev ? (ev.allDay !== false) : true;
  setEvSwitch('evAllDaySwitch', allDay);
  document.getElementById('evStartTimeWrap').style.display = allDay ? 'none' : '';
  document.getElementById('evEndTimeWrap').style.display = allDay ? 'none' : '';
  setEvSwitch('evGroupBuySwitch', ev ? (ev.isGroupBuy !== false) : true);

  const startDate = ev ? ev.start : (prefillDate || new Date());
  const endDate = ev ? ev.end : (prefillDate || new Date());
  document.getElementById('evStartDateInput').value = ymdStr(startDate);
  document.getElementById('evEndDateInput').value = ymdStr(endDate);
  setEvTimeSelects('evStartAmPmInput', 'evStartHourInput', 'evStartMinuteInput', ev ? ev.startTime : '');
  setEvTimeSelects('evEndAmPmInput', 'evEndHourInput', 'evEndMinuteInput', ev ? ev.endTime : '');
  updateEvWeekdayHints();

  document.getElementById('eventEditModal').classList.add('show');
}

function closeEventEditModal() {
  document.getElementById('eventEditModal').classList.remove('show');
  eventEditCtx = null;
}

document.getElementById('evSaveBtn').addEventListener('click', async () => {
  if (!eventEditCtx) return;
  const title = document.getElementById('evTitleInput').value.trim();
  if (!title) { setFormStatus('evEditStatus', '請輸入標題', 'error'); return; }
  const startDateStr = document.getElementById('evStartDateInput').value;
  const endDateStr = document.getElementById('evEndDateInput').value;
  if (!startDateStr || !endDateStr) { setFormStatus('evEditStatus', '請選擇開始與結束日期', 'error'); return; }

  const allDay = isEvSwitchOn('evAllDaySwitch');
  const isGroupBuy = isEvSwitchOn('evGroupBuySwitch');
  const published = document.getElementById('evPublishedInput').checked;
  const color = document.getElementById('evColorInput').value;
  const url = document.getElementById('evUrlInput').value.trim();
  const category = document.getElementById('evCategoryInput').value.trim();
  const tag = document.getElementById('evTagInput').value.trim();
  const extendRaw = document.getElementById('evExtendInput').value.trim();
  const extend = extendRaw === '' ? '' : (parseInt(extendRaw, 10) || 0);
  const earlyBird = document.getElementById('evEarlyBirdInput').value
    .split('\n').map(s => s.trim()).filter(s => s !== '').join('/');
  const startTime = allDay ? '' : getEvTimeValue('evStartAmPmInput', 'evStartHourInput', 'evStartMinuteInput');
  const endTime = allDay ? '' : getEvTimeValue('evEndAmPmInput', 'evEndHourInput', 'evEndMinuteInput');

  const payload = {
    title, start: startDateStr, end: endDateStr, color,
    allDay, isGroupBuy, published, url, category, tag, extend, earlyBird, startTime, endTime,
    iconIg: evIconValues.iconIg || '', iconTiktok: evIconValues.iconTiktok || '',
    iconFb: evIconValues.iconFb || '', iconEmail: evIconValues.iconEmail || ''
  };

  const btn = document.getElementById('evSaveBtn');
  btn.disabled = true;
  setFormStatus('evEditStatus', '儲存中…', '');
  try {
    if (eventEditCtx.isNew) {
      await postTask(Object.assign({ type: 'event-add' }, payload));
    } else {
      await postTask(Object.assign({ type: 'event-update', id: eventEditCtx.ev.id }, payload));
    }
    const reopenDate = calEditSelectedDate;
    closeEventEditModal();
    await loadData();
    if (reopenDate) openCalEditDayPanel(reopenDate);
  } catch (err) {
    setFormStatus('evEditStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('evDeleteBtn').addEventListener('click', async () => {
  if (!eventEditCtx || eventEditCtx.isNew) return;
  if (!confirm('確定要刪除「' + eventEditCtx.ev.title + '」這個活動嗎？刪除後就找不回來囉')) return;
  const btn = document.getElementById('evDeleteBtn');
  btn.disabled = true;
  setFormStatus('evEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'event-delete', id: eventEditCtx.ev.id });
    const reopenDate = calEditSelectedDate;
    closeEventEditModal();
    await loadData();
    if (reopenDate) openCalEditDayPanel(reopenDate);
  } catch (err) {
    setFormStatus('evEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

async function saveMemo() {
  if (!currentModalEv) return;
  const key = getMemoKey(currentModalEv);
  const text = document.getElementById('memoText').value;
  const statusEl = document.getElementById('memoStatus');
  const saveBtn = document.getElementById('saveMemoBtn');

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    statusEl.textContent = '尚未設定同步網址';
    statusEl.style.color = '#e0654f';
    return;
  }

  saveBtn.disabled = true;
  statusEl.textContent = '儲存中…';
  statusEl.style.color = '#a89888';
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免CORS預檢
      body: JSON.stringify(withToken({ type: 'memo', key, text }))
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '未知錯誤');
    memoMap[key] = text;
    statusEl.textContent = '已儲存 ✓';
    statusEl.style.color = '#9ACB85';
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.style.color = '#e0654f';
  }
  saveBtn.disabled = false;
}

async function saveBackendUrl() {
  if (!currentModalEv) return;
  const key = getMemoKey(currentModalEv);
  const text = document.getElementById('backendUrlInput').value.trim();
  const statusEl = document.getElementById('backendUrlStatus');
  const saveBtn = document.getElementById('saveBackendUrlBtn');

  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === 0) {
    statusEl.textContent = '尚未設定同步網址';
    statusEl.style.color = '#e0654f';
    return;
  }

  saveBtn.disabled = true;
  statusEl.textContent = '儲存中…';
  statusEl.style.color = '#a89888';
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(withToken({ type: 'url', key, text }))
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '未知錯誤');
    urlMap[key] = text;
    const backendEl = document.getElementById('adminBackendUrl');
    if (text) {
      backendEl.href = text;
      backendEl.style.opacity = '1';
      backendEl.style.pointerEvents = 'auto';
    } else {
      backendEl.href = 'javascript:void(0)';
      backendEl.style.opacity = '0.5';
      backendEl.style.pointerEvents = 'none';
    }
    statusEl.textContent = '已儲存 ✓';
    statusEl.style.color = '#9ACB85';
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.style.color = '#e0654f';
  }
  saveBtn.disabled = false;
}

document.getElementById('saveMemoBtn').addEventListener('click', saveMemo);
document.getElementById('saveBackendUrlBtn').addEventListener('click', saveBackendUrl);
document.getElementById('copyUrlBtn').addEventListener('click', (e) => {
  if (currentModalEv && currentModalEv.url) copyText(currentModalEv.url, e.currentTarget);
});
document.getElementById('copyMemoBtn').addEventListener('click', (e) => {
  copyText(document.getElementById('memoText').value, e.currentTarget);
});

document.getElementById('modeSelect').addEventListener('change', (e) => {
  currentMode = e.target.value;
  render();
});

// 公關品狀態顯示開關：切換後記到 localStorage 並重繪
document.getElementById('prToggleWrap').addEventListener('click', () => {
  prChipOn = !prChipOn;
  localStorage.setItem('admin_pr_chip_on', prChipOn ? '1' : '0');
  document.getElementById('prSwitch').classList.toggle('on', prChipOn);
  render();
});

// ===== 公關品狀態面板事件 =====
// 面板收折
document.getElementById('prPanelHead').addEventListener('click', () => {
  document.getElementById('prPanel').classList.toggle('open');
});

// 狀態下拉變更 → 立即儲存＋切換欄位顯示
document.getElementById('prStatusSelect').addEventListener('change', (e) => {
  if (!currentModalEv) return;
  const key = getMemoKey(currentModalEv);
  const status = e.target.value;
  const headChip = document.getElementById('prHeadChip');
  headChip.textContent = status;
  headChip.className = 'pr-head-chip pr-' + PR_STATUS_CLASS[status];
  updatePrConditionalFields(status);
  savePrStatus(key, { status }, 'prStatusSaveMsg').catch(() => {});
});

// 選品網址：輸入時更新前往按鈕，失焦或按儲存時儲存
document.getElementById('prUrlInput').addEventListener('input', () => {
  updatePrConditionalFields(document.getElementById('prStatusSelect').value);
});
function savePrUrl() {
  if (!currentModalEv) return;
  const key = getMemoKey(currentModalEv);
  savePrStatus(key, { url: document.getElementById('prUrlInput').value.trim() }, 'prUrlSaveMsg').catch(() => {});
}
document.getElementById('prUrlInput').addEventListener('blur', savePrUrl);
document.getElementById('prUrlSaveBtn').addEventListener('click', savePrUrl);

// 位置下拉：選到「＋新增更多」跳出輸入列，否則立即儲存
document.getElementById('prLocationSelect').addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    document.getElementById('prLocationNewRow').classList.add('show');
    return;
  }
  document.getElementById('prLocationNewRow').classList.remove('show');
  if (!currentModalEv) return;
  const key = getMemoKey(currentModalEv);
  savePrStatus(key, { location: e.target.value }, 'prLocationSaveMsg').catch(() => {});
});
document.getElementById('prLocationNewBtn').addEventListener('click', async () => {
  const input = document.getElementById('prLocationNewInput');
  const name = input.value.trim();
  if (!name) return;
  try {
    await postTask({ type: 'pr-location-add', name });
    if (prLocations.indexOf(name) === -1) prLocations.push(name);
    fillPrLocationSelect(document.getElementById('prLocationSelect'), name);
    document.getElementById('prLocationNewRow').classList.remove('show');
    input.value = '';
    if (currentModalEv) {
      const key = getMemoKey(currentModalEv);
      await savePrStatus(key, { location: name }, 'prLocationSaveMsg');
    }
  } catch (err) {
    setPrMsg('prLocationSaveMsg', err.message || '新增失敗', false);
  }
});

// ===== 分頁切換與選單 =====
function switchView(name) {
  if (name === 'imageLibrary' && !(isAdmin || myPermissions.imageLibrary)) {
    alert('你沒有圖片庫的使用權限，如果需要請跟雪莉申請開通。');
    return;
  }
  currentView = name;
  const map = { home: 'viewHome', calendar: 'viewCalendar', dispatch: 'viewDispatch', myTasks: 'viewMyTasks', memo: 'viewMemo', prItems: 'viewPrItems', todoList: 'viewTodoList', groupStatus: 'viewGroupStatus', tools: 'viewTools', lotteryTool: 'viewLotteryTool', convertTool: 'viewConvertTool', imageLibrary: 'viewImageLibrary', calculator: 'viewCalculator' };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', key === name);
  });
  document.querySelectorAll('.menu-item[data-view]').forEach(mi => {
    mi.classList.toggle('active', mi.dataset.view === name);
  });
  document.getElementById('menuPanel').classList.remove('show');
  if (name === 'myTasks') markTasksSeen();
  if (name === 'myTasks' || name === 'dispatch') renderTaskUI();
  if (name === 'calendar' && typeof render === 'function' && allEvents.length) render();
  // 備忘錄頁面的資料由 memo.js 負責讀取（第一次進入時才拉一次）
  if (name === 'memo' && typeof loadPnoteData === 'function') loadPnoteData();
  // 公關品狀態列表：進入時才拉一次
  if (name === 'prItems') {
    renderPriLocationSelect();
    loadPrItems();
  }
  if (name === 'todoList') renderTodoGroups();
  if (name === 'groupStatus') renderGroupStatusList('groupStatusList');
  if (name === 'lotteryTool') renderLotteryWinnerList();
  if (name === 'imageLibrary') { ilLoadFolderOptions().then(() => ilLoad()); }
}

document.getElementById('homeBtn').addEventListener('click', () => switchView('home'));

document.getElementById('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('menuPanel').classList.toggle('show');
});
document.addEventListener('click', (e) => {
  const panel = document.getElementById('menuPanel');
  if (panel.classList.contains('show') && !e.target.closest('.menu-wrap')) {
    panel.classList.remove('show');
  }
});
// 只有帶 data-view 的選單項目才會切換分頁；「設定」是另外開彈窗，不屬於分頁
document.querySelectorAll('.menu-item[data-view]').forEach(mi => {
  mi.addEventListener('click', () => switchView(mi.dataset.view));
});

function initAppUI() {
  document.getElementById('userChip').textContent = '👤 ' + currentUser;
  switchView('home');
  renderTaskUI();
}

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
      lines.push(ev.title || '');
      lines.push(ev.url || '');
    });
  }

  if (stillOpen.length) {
    if (lines.length) lines.push('');
    lines.push('✦ 現正開團中✦');
    stillOpen.forEach(ev => {
      lines.push(ev.title || '');
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
let lotteryWinnerLog = []; // 新的在最前面：[{prize, winner}, ...]

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

// ===== 轉檔小工具（介面先做好，實際轉檔之後再串接）=====
function runConvertTool() {
  const fileInput = document.getElementById('convertFileInput');
  const target = document.getElementById('convertTargetSelect').value;
  if (!fileInput.files || !fileInput.files.length) {
    setFormStatus('convertStatus', '請先選擇要轉換的檔案', 'error');
    return;
  }
  setFormStatus('convertStatus', '轉檔功能尚未串接，之後可以在這裡接上轉檔服務（目前選擇的檔案：' + fileInput.files[0].name + ' → ' + target + '）', '');
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

// 食材顯示用的簡短名稱：優先用「簡稱」（可能用 / 分隔多個，取第一個），沒填才用「食材名稱」
function pgIngredientFilterKey(ing) {
  const raw = String(ing['簡稱'] || '').trim();
  if (!raw) return ing['食材名稱'] || '';
  return raw.split('/')[0].trim();
}

// 依「使用食材ID」欄位（格式 ing001:50g/ing003:1包）比對出完整食材資料＋分量
function pgGetRecipeIngredients(recipe) {
  const tokens = String(recipe['使用食材ID'] || '').split('/').map(s => s.trim()).filter(Boolean);
  const result = [];
  tokens.forEach(token => {
    const [idOrName, qty] = token.split(':').map(s => (s || '').trim());
    let ing = pgIngredients.find(i => i['食材ID'] === idOrName);
    if (!ing && idOrName) {
      const nameMatches = pgIngredients.filter(i => i['食材名稱'] === idOrName);
      if (nameMatches.length) ing = nameMatches[0];
    }
    if (ing) {
      result.push(Object.assign({}, ing, { _quantity: qty || '' }));
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
function pgBuildBenefitTags(r, ingCount) {
  const tags = [];
  if (r['烹調時間']) tags.push(`⏱ ${r['烹調時間']}`);
  if (r['適合月齡']) tags.push(`👶 ${r['適合月齡']}`);
  const diff = parseInt(r['難易度'], 10);
  if (diff >= 1 && diff <= 5) tags.push(`⭐ ${'★'.repeat(diff)}${'☆'.repeat(5 - diff)}`);
  if (ingCount) tags.push(`🥕 ${ingCount}種食材`);
  while (tags.length < 4) tags.push('💗 手作安心');
  return tags.slice(0, 4);
}

function pgBuildPosterHtml(r) {
  const title = escHtml(r['食譜名稱'] || '');
  const heroImg = pgIsValidUrl(r['成品圖片網址']) ? r['成品圖片網址'] : PG_PLACEHOLDER_IMG;

  const fullIngList = pgGetRecipeIngredients(r);
  const ingList = fullIngList.slice(0, 8); // 固定版型上限：4欄 x 2排
  const benefitTags = pgBuildBenefitTags(r, fullIngList.length);

  const steps = pgGetStepLines(r).slice(0, 4); // 固定版型上限：橫向一排最多4格
  const manualStepImgsRaw = String(r['步驟圖片'] || '').trim();
  const manualStepImgs = manualStepImgsRaw ? manualStepImgsRaw.split('|').map(s => s.trim()) : [];
  const tips = pgGetTipLines(r).slice(0, 3); // 固定版型上限：最多3行

  const ingHtml = ingList.map(i => {
    const name = escHtml(pgIngredientFilterKey(i) || i['食材名稱'] || '');
    const qty = escHtml(i._quantity || '');
    const img = pgIsValidUrl(i['圖片網址']) ? i['圖片網址'] : PG_PLACEHOLDER_IMG;
    return `
      <div class="pgp-ing-tile">
        <img class="pgp-ing-photo" crossorigin="anonymous" src="${img}">
        <div class="pgp-ing-label">${name}${qty ? ' ' + qty : ''}</div>
      </div>`;
  }).join('');

  const stepHtml = steps.map((s, idx) => {
    const n = idx + 1;
    const manualUrl = manualStepImgs[idx];
    const autoUrl = pgBuildAutoStepImageUrl(r['成品圖片網址'], n);
    const imgUrl = pgIsValidUrl(manualUrl) ? manualUrl : (pgIsValidUrl(autoUrl) ? autoUrl : '');
    const captionRaw = s.length > 22 ? s.slice(0, 22) + '…' : s;
    const caption = escHtml(captionRaw);
    return `
      <div class="pgp-step-card">
        <div class="pgp-step-photo-wrap">
          ${imgUrl ? `<img class="pgp-step-photo" crossorigin="anonymous" src="${imgUrl}">` : `<div class="pgp-step-photo pgp-step-photo-empty">🍳</div>`}
          <span class="pgp-step-badge">${n}</span>
        </div>
        <div class="pgp-step-caption">${caption}</div>
      </div>`;
  }).join('');

  const benefitHtml = benefitTags.map(t => `<span class="pgp-benefit-tag">✅ ${escHtml(t)}</span>`).join('');

  const tipsHtml = tips.length ? `
    <div class="pgp-tip-bar">
      <span class="pgp-tip-icon">💡</span>
      <div>
        <div class="pgp-tip-head">小提醒</div>
        <ul class="pgp-tip-list">
          ${tips.map(t => `<li>${escHtml(t)}</li>`).join('')}
        </ul>
      </div>
    </div>` : '';

  return `
    <div class="pgp-poster">
      <span class="pgp-doodle" style="top:20px;left:20px;font-size:30px;">🌿</span>
      <span class="pgp-doodle" style="bottom:120px;left:24px;font-size:26px;">🐟</span>
      <span class="pgp-doodle" style="bottom:40px;right:340px;font-size:20px;">⭐</span>
      <span class="pgp-doodle" style="top:280px;right:24px;font-size:20px;">💗</span>

      <div class="pgp-header-row">
        <div class="pgp-header-text">
          <div class="pgp-tagline">🍼 寶寶副食品食譜分享</div>
          <div class="pgp-title">${title}</div>
        </div>
        <div class="pgp-hero-frame">
          <span class="pgp-hero-tape">手作食譜</span>
          <div class="pgp-hero-circle">
            <img class="pgp-hero-img" crossorigin="anonymous" src="${heroImg}">
          </div>
        </div>
      </div>

      <div class="pgp-benefit-row">${benefitHtml}</div>

      <div class="pgp-ing-section">
        <div class="pgp-section-label pgp-label-pink">準備食材</div>
        <div class="pgp-ing-grid">${ingHtml || '<div class="pgp-empty">（尚未提供食材）</div>'}</div>
      </div>

      <div class="pgp-step-section">
        <div class="pgp-section-label pgp-label-orange">簡單${steps.length || ''}步驟</div>
        <div class="pgp-step-grid">${stepHtml || '<div class="pgp-empty">（尚未提供做法）</div>'}</div>
      </div>

      ${tipsHtml}

      <div class="pgp-footer">🩷 雪莉與朵栗・@dondon0813 🩷</div>
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

  try {
    const canvas = await html2canvas(stage.firstElementChild, {
      width: 1080,
      height: 1350,
      scale: 1,
      useCORS: true,
      backgroundColor: '#FFF7EE'
    });
    const dataUrl = canvas.toDataURL('image/png');

    const imgEl = document.getElementById('pgOutputImg');
    imgEl.src = dataUrl;
    document.getElementById('pgOutputArea').style.display = 'block';
    document.getElementById('pgOutputImgWrap').style.display = 'block';
    document.getElementById('pgOutputTextWrap').style.display = 'none';

    const downloadBtn = document.getElementById('pgDownloadImgBtn');
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = (r['食譜名稱'] || '食譜貼文') + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    setFormStatus('pgStatus', '貼文圖已產生，可以下載囉 ✓（若食材圖片是外部網址，遇到跨網域限制可能會顯示空白，之後可以再調整）', 'ok');
  } catch (err) {
    setFormStatus('pgStatus', '圖片產生失敗：' + err.message, 'error');
  } finally {
    stage.innerHTML = '';
  }
}

// ===== 設定：修改密碼 =====
function openSettingsModal() {
  document.getElementById('menuPanel').classList.remove('show');
  document.getElementById('oldPasswordInput').value = '';
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('newPasswordInput2').value = '';
  setFormStatus('settingsStatus', '', '');
  document.getElementById('settingsModal').classList.add('show');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('show');
}

// 前端先做一次跟後端一樣的規則檢查：至少6碼、需含大寫、小寫、數字各一個
function isValidNewPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 6) return false;
  if (!/[A-Z]/.test(pw)) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  return true;
}

async function submitPasswordChange() {
  const oldPassword = document.getElementById('oldPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;
  const newPassword2 = document.getElementById('newPasswordInput2').value;
  const btn = document.getElementById('settingsSubmitBtn');

  if (!oldPassword || !newPassword || !newPassword2) {
    setFormStatus('settingsStatus', '請把三個欄位都填寫完整', 'error');
    return;
  }
  if (newPassword !== newPassword2) {
    setFormStatus('settingsStatus', '兩次輸入的新密碼不一致', 'error');
    return;
  }
  if (!isValidNewPassword(newPassword)) {
    setFormStatus('settingsStatus', '新密碼至少6碼，且需包含大寫、小寫英文與數字', 'error');
    return;
  }
  if (newPassword === oldPassword) {
    setFormStatus('settingsStatus', '新密碼不能跟舊密碼一樣', 'error');
    return;
  }

  btn.disabled = true;
  setFormStatus('settingsStatus', '送出中…', '');
  try {
    const result = await postTask({ type: 'change-password', oldPassword, newPassword });
    setFormStatus('settingsStatus', '密碼修改成功！', 'ok');
    document.getElementById('oldPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('newPasswordInput2').value = '';
    setTimeout(closeSettingsModal, 1200);
  } catch (err) {
    setFormStatus('settingsStatus', err.message || '修改失敗，請確認舊密碼是否正確', 'error');
  }
  btn.disabled = false;
}

document.getElementById('menuSettingsBtn').addEventListener('click', openSettingsHubModal);
document.getElementById('settingsSubmitBtn').addEventListener('click', submitPasswordChange);

function openSettingsHubModal() {
  document.getElementById('menuPanel').classList.remove('show');
  document.getElementById('settingsHubModal').classList.add('show');
}
function closeSettingsHubModal() {
  document.getElementById('settingsHubModal').classList.remove('show');
}
document.getElementById('settingsHubPasswordBtn').addEventListener('click', () => {
  closeSettingsHubModal();
  openSettingsModal();
});
document.getElementById('settingsHubPermissionsBtn').addEventListener('click', () => {
  closeSettingsHubModal();
  openPermissionsModal();
});

// ===== 【新】權限設定（只有管理員雪莉看得到入口，後端也會擋非管理員的請求） =====

function openPermissionsModal() {
  document.getElementById('menuPanel').classList.remove('show');
  document.getElementById('permissionsModal').classList.add('show');
  loadPermissionsList();
}

function closePermissionsModal() {
  document.getElementById('permissionsModal').classList.remove('show');
}

async function loadPermissionsList() {
  const box = document.getElementById('permList');
  box.innerHTML = '<div class="task-empty">載入中…</div>';
  try {
    const result = await postTask({ type: 'perm-list' });
    allPermissions = result.permissions || {};
    renderPermissionsList(result.staff || [], allPermissions);
  } catch (err) {
    box.innerHTML = '<div class="task-empty">讀取失敗：' + escHtml(err.message) + '</div>';
  }
}

function renderPermissionsList(staffNames, permissions) {
  const box = document.getElementById('permList');
  if (!staffNames.length) {
    box.innerHTML = '<div class="task-empty">目前沒有其他員工</div>';
    return;
  }
  box.innerHTML = '';
  staffNames.forEach(name => {
    const perm = permissions[name] || {};
    const row = document.createElement('div');
    row.className = 'perm-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'perm-row-name';
    nameEl.textContent = name;
    row.appendChild(nameEl);

    const toggleWrap = document.createElement('label');
    toggleWrap.className = 'perm-row-toggle';

    const label = document.createElement('span');
    label.className = 'pr-toggle-text';
    label.textContent = '圖片庫權限';
    toggleWrap.appendChild(label);

    const sw = document.createElement('span');
    sw.className = 'pr-switch' + (perm.imageLibrary ? ' on' : '');
    const knob = document.createElement('span');
    knob.className = 'pr-knob';
    sw.appendChild(knob);
    sw.addEventListener('click', () => togglePermission(name, 'imageLibrary', sw));
    toggleWrap.appendChild(sw);

    row.appendChild(toggleWrap);
    box.appendChild(row);
  });
}

async function togglePermission(name, key, switchEl) {
  const newVal = !switchEl.classList.contains('on');
  switchEl.classList.toggle('on', newVal); // 樂觀更新，失敗再改回來
  try {
    await postTask({ type: 'perm-set', name, key, value: newVal });
    if (!allPermissions[name]) allPermissions[name] = {};
    allPermissions[name][key] = newVal;
  } catch (err) {
    switchEl.classList.toggle('on', !newVal);
    alert('更新失敗：' + err.message);
  }
}

// ===== 任務系統共用 =====
function myTasks() {
  return (tasksMap[currentUser] || []).slice();
}

function hasUrgentPending() {
  return myTasks().some(t => t.urgent && taskStatus(t) !== '已完成');
}

// ===== 新任務提醒（記在這台裝置的瀏覽器裡，每個人分開記）=====
function seenKey() { return 'admin_seen_tasks_' + currentUser; }

function getSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]'));
  } catch (e) { return new Set(); }
}

function markTasksSeen() {
  try {
    localStorage.setItem(seenKey(), JSON.stringify(myTasks().map(t => t.id)));
  } catch (e) { /* 無法儲存就算了，只影響提醒 */ }
  updateUrgentUI();
}

function newTaskCount() {
  const seen = getSeenIds();
  return myTasks().filter(t =>
    taskStatus(t) !== '已完成' && t.from !== currentUser && !seen.has(t.id)
  ).length;
}

function updateUrgentUI() {
  const urgent = hasUrgentPending();
  document.getElementById('urgentBanner').classList.toggle('show', urgent);
  document.getElementById('menuUrgentDot').style.display = urgent ? 'block' : 'none';
  document.getElementById('homeUrgentIcon').style.display = urgent ? 'block' : 'none';

  // 綠色新任務提醒：排在緊急橫幅後面；人在我的任務頁時不用再提醒
  const n = currentView === 'myTasks' ? 0 : newTaskCount();
  const banner = document.getElementById('newTaskBanner');
  banner.classList.toggle('show', n > 0);
  if (n > 0) banner.textContent = `🟢 你有 ${n} 個新任務，請點擊前往`;
}

async function postTask(payload) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免CORS預檢
    body: JSON.stringify(withToken(payload))
  });
  const result = await res.json();
  if (!result.success) {
    // token 過期或未登入時，把使用者踢回登入畫面，而不是只顯示錯誤訊息
    if (result.needLogin) {
      currentToken = null;
      sessionStorage.removeItem('admin_unlocked');
      sessionStorage.removeItem('admin_token');
      document.getElementById('passwordGate').style.display = 'flex';
      document.getElementById('mainWrap').style.visibility = 'hidden';
    }
    throw new Error(result.error || '未知錯誤');
  }
  return result;
}

function setFormStatus(id, text, cls) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'form-status' + (cls ? ' ' + cls : '');
}

// ===== 下拉選單建立 =====
function fillTaskNameSelect(selectEl, names) {
  const prev = selectEl.value;
  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '請選擇任務名稱…';
  selectEl.appendChild(placeholder);
  names.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    selectEl.appendChild(opt);
  });
  const addMore = document.createElement('option');
  addMore.value = '__new__';
  addMore.textContent = '＋ 新增更多';
  selectEl.appendChild(addMore);
  if (prev && [...selectEl.options].some(o => o.value === prev)) selectEl.value = prev;
}

function renderDispatchForm() {
  // 派遣對象：所有員工（包含自己，方便測試）
  const toSel = document.getElementById('dispatchTo');
  const prevTo = toSel.value;
  toSel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = '請選擇人員…';
  toSel.appendChild(ph);
  staffList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    toSel.appendChild(opt);
  });
  if (prevTo && [...toSel.options].some(o => o.value === prevTo)) toSel.value = prevTo;

  // 共用清單 + 自己額外加過的私人任務名稱（只有自己看得到）
  fillTaskNameSelect(document.getElementById('dispatchTaskName'), taskNames.concat(myTaskNames));
}

function renderSelfForm() {
  // 安排工作：預設只有「顧客提問」＋新增更多；自己之前加過的私人任務名稱也會出現
  fillTaskNameSelect(document.getElementById('selfTaskName'), SELF_DEFAULT_TASKS.concat(myTaskNames));
}

// 自己新增的任務名稱標籤（打錯字可以直接刪掉，不會一直卡在下拉選單裡）
function renderMyTaskNameTags() {
  [{ id: 'dispatchMyNamesTags' }, { id: 'selfMyNamesTags' }].forEach(({ id }) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.innerHTML = '';
    myTaskNames.forEach(name => {
      const tag = document.createElement('span');
      tag.className = 'my-taskname-tag';
      const label = document.createElement('span');
      label.textContent = name;
      tag.appendChild(label);
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '✕';
      delBtn.title = '刪除這個自訂任務名稱';
      delBtn.addEventListener('click', () => deleteMyTaskName(name));
      tag.appendChild(delBtn);
      box.appendChild(tag);
    });
  });
}

// 刪除自己加過的任務名稱（僅自己看得到的私人清單，共用清單不受影響）
async function deleteMyTaskName(name) {
  if (!confirm('確定要刪除任務名稱「' + name + '」嗎？之後在下拉選單就選不到了')) return;
  const idx = myTaskNames.indexOf(name);
  if (idx === -1) return;
  myTaskNames.splice(idx, 1);
  renderDispatchForm();
  renderSelfForm();
  renderMyTaskNameTags();
  try {
    await postTask({ type: 'my-taskname-delete', name });
  } catch (err) {
    myTaskNames.splice(idx, 0, name);
    renderDispatchForm();
    renderSelfForm();
    renderMyTaskNameTags();
    alert('刪除失敗：' + err.message);
  }
}

// 任務名稱選到「新增更多」時顯示輸入列
function bindTaskNameSelect(selectId, rowId, contentBlockId) {
  const sel = document.getElementById(selectId);
  const prefix = selectId.replace('TaskName', '');
  sel.addEventListener('change', () => {
    const isNew = sel.value === '__new__';
    document.getElementById(rowId).classList.toggle('show', isNew);
    document.getElementById(contentBlockId).style.display = (sel.value && !isNew) ? 'block' : 'none';
    renderExtraFields(prefix);
  });
}
bindTaskNameSelect('dispatchTaskName', 'dispatchNewNameRow', 'dispatchContentBlock');
bindTaskNameSelect('selfTaskName', 'selfNewNameRow', 'selfContentBlock');

// ===== 特定任務的附加欄位 =====
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 依選到的任務名稱，在任務內容上方長出對應的附加欄位
function renderExtraFields(prefix) {
  const container = document.getElementById(prefix + 'Extra');
  if (!container) return;
  const taskName = document.getElementById(prefix + 'TaskName').value;
  container.innerHTML = '';

  if (taskName === '顧客提問') {
    container.innerHTML =
      `<label for="${prefix}ExtraSource">顧客來源</label>` +
      `<select id="${prefix}ExtraSource">` +
      CUSTOMER_SOURCES.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('') +
      `</select>` +
      `<label for="${prefix}ExtraCustomer">顧客名稱</label>` +
      `<input type="text" id="${prefix}ExtraCustomer" placeholder="輸入顧客的名稱或帳號…">`;
  } else if (taskName === '廠商選品') {
    container.innerHTML =
      `<label for="${prefix}ExtraVendor">選擇廠商</label>` +
      `<select id="${prefix}ExtraVendor">` +
      `<option value="">請選擇廠商…</option>` +
      vendors.map(v => `<option value="${escHtml(v)}">${escHtml(v)}</option>`).join('') +
      `<option value="__other__">＋ 其他（自行輸入）</option>` +
      `</select>` +
      `<input type="text" id="${prefix}ExtraVendorOther" placeholder="輸入廠商名稱…" style="display:none; margin-top:8px;">` +
      `<label for="${prefix}ExtraEvent">對應團購（選品狀態會更新到這場）</label>` +
      `<select id="${prefix}ExtraEvent">` +
      `<option value="">不指定（先不更新行事曆）</option>` +
      buildEventOptions_() +
      `</select>` +
      `<label for="${prefix}ExtraUrl">選品網址</label>` +
      `<input type="text" id="${prefix}ExtraUrl" placeholder="貼上選品網址…">`;
    document.getElementById(prefix + 'ExtraVendor').addEventListener('change', (e) => {
      document.getElementById(prefix + 'ExtraVendorOther').style.display =
        e.target.value === '__other__' ? 'block' : 'none';
    });
  } else if (taskName === '團購安排') {
    container.innerHTML =
      `<label for="${prefix}ExtraBrand">品牌或商品</label>` +
      `<input type="text" id="${prefix}ExtraBrand" placeholder="輸入品牌或商品名稱…">`;
  }
}

// 廠商選品下拉：列出行事曆團購，值＝getMemoKey，顯示團名＋開團日；近期優先
function buildEventOptions_() {
  if (!allEvents.length) return '';
  const todayStart = startOfDay(new Date());
  const sorted = allEvents.slice().sort((a, b) =>
    Math.abs(a.start - todayStart) - Math.abs(b.start - todayStart)
  );
  return sorted.map(ev => {
    const key = getMemoKey(ev);
    const label = `${ev.title}（開團 ${fmtSingleDate(ev.start)}）`;
    return `<option value="${escHtml(key)}">${escHtml(label)}</option>`;
  }).join('');
}

// 送出時收集附加欄位的內容
function collectExtra(prefix, taskName) {
  const val = id => {
    const el = document.getElementById(prefix + id);
    return el ? el.value.trim() : '';
  };
  const extra = {};

  // 識別名稱／品牌：不限任務類型，所有任務都可以填，顯示在任務名稱後面方便辨識
  const brandEl = document.getElementById(prefix + 'BrandInput');
  const brandVal = brandEl ? brandEl.value.trim() : '';
  if (brandVal) extra['識別名稱'] = brandVal;

  if (taskName === '顧客提問') {
    if (val('ExtraSource')) extra['顧客來源'] = val('ExtraSource');
    if (val('ExtraCustomer')) extra['顧客名稱'] = val('ExtraCustomer');
  } else if (taskName === '廠商選品') {
    const sel = val('ExtraVendor');
    const vendor = sel === '__other__' ? val('ExtraVendorOther') : sel;
    if (vendor) extra['廠商'] = vendor;
    if (val('ExtraUrl')) extra['選品網址'] = val('ExtraUrl');
    // 對應團購的 key（給行事曆公關品狀態同步用，不顯示在卡片摘要）
    const evKey = val('ExtraEvent');
    if (evKey) extra['團購key'] = evKey;
  } else if (taskName === '團購安排') {
    if (val('ExtraBrand')) extra['品牌或商品'] = val('ExtraBrand');
  }

  return Object.keys(extra).length ? extra : null;
}

// 任務名稱後面加上識別名稱／品牌，方便在列表裡快速辨識（例如：簽署合約書 MNTL）
function taskDisplayName(task) {
  const base = task.taskName || '';
  const brand = task.extra && task.extra['識別名稱'] ? String(task.extra['識別名稱']).trim() : '';
  return brand ? `${base} ${brand}` : base;
}

// 卡片上顯示的附加資訊小字（網址、內部key 太長或無意義就不放；識別名稱已經併進標題，這裡也不重複顯示）
function extraSummary(task) {
  if (!task.extra) return '';
  return Object.keys(task.extra)
    .filter(k => k !== '選品網址' && k !== '團購key' && k !== '識別名稱' && task.extra[k])
    .map(k => task.extra[k])
    .join('・');
}

// 新增任務名稱（會同步寫入試算表的任務名稱分頁）
async function addTaskName(inputId, statusId, selectId) {
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if (!name) return;

  if (taskNames.includes(name)) {
    const sel = document.getElementById(selectId);
    sel.value = name;
    sel.dispatchEvent(new Event('change'));
    input.value = '';
    setFormStatus(statusId, '這是大家共用的既有名稱，已經幫你選好了', 'ok');
    return;
  }

  if (myTaskNames.includes(name) || SELF_DEFAULT_TASKS.includes(name)) {
    const sel = document.getElementById(selectId);
    sel.value = name;
    sel.dispatchEvent(new Event('change'));
    input.value = '';
    setFormStatus(statusId, '這個名稱你之前加過了，已經幫你選好了', 'ok');
    return;
  }

  setFormStatus(statusId, '新增任務名稱中…');
  try {
    await postTask({ type: 'my-taskname-add', name });
    myTaskNames.push(name);
    renderDispatchForm();
    renderSelfForm();
    renderMyTaskNameTags();
    const sel = document.getElementById(selectId);
    sel.value = name;
    sel.dispatchEvent(new Event('change'));
    input.value = '';
    setFormStatus(statusId, '已新增「' + name + '」（只有你自己看得到）✓', 'ok');
  } catch (err) {
    setFormStatus(statusId, '新增失敗：' + err.message, 'error');
  }
}
document.getElementById('dispatchNewNameBtn').addEventListener('click', () =>
  addTaskName('dispatchNewNameInput', 'dispatchStatus', 'dispatchTaskName'));
document.getElementById('selfNewNameBtn').addEventListener('click', () =>
  addTaskName('selfNewNameInput', 'selfStatus', 'selfTaskName'));

// ===== 派遣任務 =====
document.getElementById('dispatchSubmitBtn').addEventListener('click', async () => {
  const to = document.getElementById('dispatchTo').value;
  const taskName = document.getElementById('dispatchTaskName').value;
  const content = document.getElementById('dispatchContent').value.trim();
  const date = document.getElementById('dispatchDate').value; // 可不填，格式 YYYY-MM-DD
  const urgent = document.getElementById('dispatchUrgent').checked;
  const btn = document.getElementById('dispatchSubmitBtn');

  if (!to) { setFormStatus('dispatchStatus', '請先選擇要派遣給誰', 'error'); return; }
  if (!taskName || taskName === '__new__') { setFormStatus('dispatchStatus', '請選擇任務名稱', 'error'); return; }

  btn.disabled = true;
  setFormStatus('dispatchStatus', '派遣中…');
  try {
    const extra = collectExtra('dispatch', taskName);
    await postTask({ type: 'task-add', to, from: currentUser, taskName, content, urgent, extra, date });
    // 派遣「廠商選品」時，自動把對應團購的公關品狀態設為「選品中」並帶入選品網址
    await syncPrStatusFromDispatch(taskName, extra);
    setFormStatus('dispatchStatus', '已派遣給 ' + to + ' ✓', 'ok');
    document.getElementById('dispatchContent').value = '';
    document.getElementById('dispatchDate').value = '';
    document.getElementById('dispatchUrgent').checked = false;
    document.getElementById('dispatchBrandInput').value = '';
    document.getElementById('dispatchTaskName').value = '';
    renderExtraFields('dispatch'); // 清空附加欄位
    await fetchMemos(); // 立刻同步最新任務
    // 派遣完成後回到派遣任務頁面上方，方便馬上派下一個
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    setFormStatus('dispatchStatus', '派遣失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

// ===== 安排工作（給自己）=====
document.getElementById('selfSubmitBtn').addEventListener('click', async () => {
  const taskName = document.getElementById('selfTaskName').value;
  const content = document.getElementById('selfContent').value.trim();
  const date = document.getElementById('selfDate').value; // 可不填，格式 YYYY-MM-DD
  const btn = document.getElementById('selfSubmitBtn');

  if (!taskName || taskName === '__new__') { setFormStatus('selfStatus', '請選擇任務名稱', 'error'); return; }

  btn.disabled = true;
  setFormStatus('selfStatus', '安排中…');
  try {
    const extra = collectExtra('self', taskName);
    await postTask({ type: 'task-add', to: currentUser, from: currentUser, taskName, content, urgent: false, extra, date });
    await syncPrStatusFromDispatch(taskName, extra);
    setFormStatus('selfStatus', '已加入待完成清單 ✓', 'ok');
    document.getElementById('selfContent').value = '';
    document.getElementById('selfDate').value = '';
    document.getElementById('selfBrandInput').value = '';
    renderExtraFields('self'); // 清空附加欄位
    await fetchMemos();
  } catch (err) {
    setFormStatus('selfStatus', '安排失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

// ===== 我的任務清單 =====

// 把後端傳來的時間字串縮短成「7/3 14:20」，遇到又臭又長的時區格式也能處理
function shortTime(s) {
  if (!s) return '';
  s = String(s);
  if (s.indexOf('GMT') !== -1 || s.length > 20) {
    const d = new Date(s);
    if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  // 已經是 yyyy/M/d HH:mm 的話把年份拿掉
  return s.replace(/^\d{4}\//, '');
}

function shortDateOnly(s) {
  const t = shortTime(s);
  return t.split(' ')[0] || '';
}

function taskStatus(t) {
  if (t.status) return t.status;
  return t.done ? '已完成' : '待完成';
}

function statusTagHtml(status) {
  if (status === '已完成') return '<span class="task-status-tag st-done">已完成</span>';
  if (status === '處理中') return '<span class="task-status-tag st-working">⏳ 處理中</span>';
  if (status === '回派中') return '<span class="task-status-tag st-bounce">🔁 回派中</span>';
  return '<span class="task-status-tag st-pending">待完成</span>';
}

// 樂觀更新：先改畫面再存檔，失敗才還原，這樣按下去立刻有反應
async function changeTaskStatus(owner, task, newStatus) {
  const oldStatus = taskStatus(task);
  if (oldStatus === newStatus) return;
  task.status = newStatus;
  task.done = newStatus === '已完成';
  if (newStatus === '已完成' && !task.doneAt) {
    const now = new Date();
    task.doneAt = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
  if (newStatus !== '已完成') task.doneAt = '';
  renderTaskUI();
  if (taskModalCtx && taskModalCtx.task === task) renderTaskModalStatus();
  try {
    await postTask({ type: 'task-status', owner, id: task.id, status: newStatus });
  } catch (err) {
    task.status = oldStatus;
    task.done = oldStatus === '已完成';
    renderTaskUI();
    if (taskModalCtx && taskModalCtx.task === task) renderTaskModalStatus();
    alert('狀態更新失敗：' + err.message);
  }
}

async function deleteTask(owner, task) {
  if (!confirm('確定要刪除「' + (task.taskName || '') + '」這筆任務嗎？刪除後就找不回來囉')) return;
  const arr = tasksMap[owner] || [];
  const idx = arr.indexOf(task);
  if (idx !== -1) arr.splice(idx, 1);
  renderTaskUI();
  try {
    await postTask({ type: 'task-delete', owner, id: task.id });
  } catch (err) {
    if (idx !== -1) arr.splice(idx, 0, task);
    renderTaskUI();
    alert('刪除失敗：' + err.message);
  }
}

function buildPendingItem(task) {
  const status = taskStatus(task);
  const item = document.createElement('div');
  item.className = 'task-item' + (task.urgent ? ' urgent' : '');

  const check = document.createElement('div');
  check.className = 'task-check';
  check.title = '標記為已完成';
  check.addEventListener('click', (e) => {
    e.stopPropagation();
    changeTaskStatus(currentUser, task, '已完成');
  });
  item.appendChild(check);

  const body = document.createElement('div');
  body.className = 'task-body';
  body.style.cursor = 'pointer';
  body.addEventListener('click', () => openTaskModal(currentUser, task, false));

  const nameLine = document.createElement('div');
  nameLine.className = 'task-name-line';
  nameLine.textContent = taskDisplayName(task);
  if (task.urgent) {
    const tag = document.createElement('span');
    tag.className = 'task-urgent-tag';
    tag.textContent = '🚨 緊急';
    nameLine.appendChild(tag);
  }
  if (status === '處理中') {
    const wt = document.createElement('span');
    wt.className = 'task-status-tag st-working';
    wt.textContent = '⏳ 處理中';
    nameLine.appendChild(wt);
  }
  if (status === '回派中') {
    const bt = document.createElement('span');
    bt.className = 'task-status-tag st-bounce';
    bt.textContent = '🔁 回派中';
    nameLine.appendChild(bt);
  }
  // 刪除按鈕：僅「自己安排」的任務可以刪除，別人派給你的任務不能刪；放在名稱這一行的最右邊
  if (!task.from || task.from === currentUser) {
    const delBtn = document.createElement('button');
    delBtn.className = 'task-mini-btn danger';
    delBtn.textContent = '✕';
    delBtn.title = '刪除這個任務';
    delBtn.style.marginLeft = 'auto';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTask(currentUser, task);
    });
    nameLine.appendChild(delBtn);
  }
  body.appendChild(nameLine);

  const summary = extraSummary(task);
  if (summary) {
    const extraLine = document.createElement('div');
    extraLine.className = 'task-extra-line';
    extraLine.textContent = '📎 ' + summary;
    body.appendChild(extraLine);
  }

  if (task.content) {
    const contentEl = document.createElement('div');
    contentEl.className = 'task-content-text';
    contentEl.textContent = task.content;
    body.appendChild(contentEl);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const fromText = task.from && task.from !== currentUser ? task.from + ' 派遣' : '自己安排';
  meta.textContent = fromText + (task.created ? '・' + shortTime(task.created) : '') + (task.date ? '・📅 ' + task.date : '');
  body.appendChild(meta);
  item.appendChild(body);

  // 處理中快速切換按鈕
  const workBtn = document.createElement('button');
  workBtn.className = 'task-mini-btn working' + (status === '處理中' ? ' on' : '');
  workBtn.textContent = status === '處理中' ? '⏳' : '▶';
  workBtn.title = status === '處理中' ? '改回待完成' : '標記為處理中';
  workBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    changeTaskStatus(currentUser, task, status === '處理中' ? '待完成' : '處理中');
  });
  item.appendChild(workBtn);

  return item;
}

function buildDoneItem(task) {
  const item = document.createElement('div');
  item.className = 'task-item done-item';

  const check = document.createElement('div');
  check.className = 'task-check';
  check.textContent = '✓';
  check.style.background = '#9ACB85';
  check.style.borderColor = '#9ACB85';
  item.appendChild(check);

  const body = document.createElement('div');
  body.className = 'task-body';
  body.style.cursor = 'pointer';
  body.addEventListener('click', () => openTaskModal(currentUser, task, false));

  const nameLine = document.createElement('div');
  nameLine.className = 'task-name-line';
  nameLine.textContent = taskDisplayName(task);
  body.appendChild(nameLine);

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  meta.textContent = '完成於 ' + shortTime(task.doneAt) + (task.date ? '・📅 ' + task.date : '');
  body.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'done-item-actions';
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'task-mini-btn restore';
  restoreBtn.textContent = '↩ 加回去';
  restoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    changeTaskStatus(currentUser, task, '待完成');
  });
  const delBtn = document.createElement('button');
  delBtn.className = 'task-mini-btn danger';
  delBtn.textContent = '🗑 刪除';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(currentUser, task);
  });
  actions.appendChild(restoreBtn);
  actions.appendChild(delBtn);
  body.appendChild(actions);

  item.appendChild(body);
  return item;
}

const expandedDoneDates = new Set(); // 展開中的日期分組
let doneDatesInitialized = false;

function renderMyTaskLists() {
  const pendingEl = document.getElementById('pendingList');
  const doneEl = document.getElementById('doneGroups');
  pendingEl.innerHTML = '';
  doneEl.innerHTML = '';

  const tasks = myTasks();
  const pending = tasks.filter(t => taskStatus(t) !== '已完成')
    .sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const done = tasks.filter(t => taskStatus(t) === '已完成');

  // --- 待完成 ---
  if (!pending.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = '目前沒有待完成的任務，太棒了 🎉';
    pendingEl.appendChild(empty);
  } else {
    pending.forEach(t => pendingEl.appendChild(buildPendingItem(t)));
  }

  // --- 已完成：依完成日期分組，新的在上，同一天可摺疊 ---
  if (!done.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = '還沒有已完成的任務';
    doneEl.appendChild(empty);
    return;
  }

  const groups = {};
  done.forEach(t => {
    const d = shortDateOnly(t.doneAt) || '未知日期';
    (groups[d] = groups[d] || []).push(t);
  });
  // 日期新的排前面（用 M/d 轉數字比較）
  const dateVal = d => {
    const m = /^(\d+)\/(\d+)$/.exec(d);
    return m ? (+m[1]) * 100 + (+m[2]) : -1;
  };
  const dates = Object.keys(groups).sort((a, b) => dateVal(b) - dateVal(a));

  // 第一次渲染時預設展開最新一天
  if (!doneDatesInitialized && dates.length) {
    expandedDoneDates.add(dates[0]);
    doneDatesInitialized = true;
  }

  dates.forEach(d => {
    const list = groups[d].slice().sort((a, b) => shortTime(b.doneAt).localeCompare(shortTime(a.doneAt)));
    const head = document.createElement('div');
    head.className = 'done-group-head';
    const open = expandedDoneDates.has(d);
    head.innerHTML = `<span>${open ? '▼' : '▶'} ${d}</span><span>${list.length} 項</span>`;
    head.addEventListener('click', () => {
      if (expandedDoneDates.has(d)) expandedDoneDates.delete(d); else expandedDoneDates.add(d);
      renderMyTaskLists();
    });
    doneEl.appendChild(head);
    if (open) list.forEach(t => doneEl.appendChild(buildDoneItem(t)));
  });
}

// ===== 已派遣的任務（派遣任務頁下方）=====
function renderDispatchedList() {
  const el = document.getElementById('dispatchedList');
  el.innerHTML = '';

  const items = [];
  Object.keys(tasksMap).forEach(owner => {
    if (owner === currentUser) return; // 派給自己的在「我的任務」看
    (tasksMap[owner] || []).forEach(t => {
      if (t.from === currentUser) items.push({ owner, task: t });
    });
  });

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';
    empty.textContent = '目前沒有派遣出去的任務';
    el.appendChild(empty);
    return;
  }

  // 未完成在前、緊急在前
  items.sort((a, b) => {
    const doneA = taskStatus(a.task) === '已完成' ? 1 : 0;
    const doneB = taskStatus(b.task) === '已完成' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return (b.task.urgent ? 1 : 0) - (a.task.urgent ? 1 : 0);
  });

  items.forEach(({ owner, task }) => {
    const row = document.createElement('div');
    row.className = 'dispatched-item' + (task.urgent && taskStatus(task) !== '已完成' ? ' urgent' : '');
    const summary = extraSummary(task);
    row.innerHTML =
      `<span class="di-to">👤 ${escHtml(owner)}</span>` +
      `<span class="di-name">${escHtml(taskDisplayName(task))}${summary ? '<span style="color:#4a7fb5; font-size:11.5px;">（' + escHtml(summary) + '）</span>' : ''}${task.urgent ? ' 🚨' : ''}${task.date ? ' <span style="color:#a89888; font-size:11px;">📅 ' + escHtml(task.date) + '</span>' : ''}</span>` +
      statusTagHtml(taskStatus(task));
    row.addEventListener('click', () => openTaskModal(owner, task, true));

    // 刪除按鈕：這裡的任務都是自己派遣出去的，可以直接刪除；放在名稱右邊、狀態標籤前面
    if (!task.from || task.from === currentUser) {
      const delBtn = document.createElement('button');
      delBtn.className = 'task-mini-btn danger';
      delBtn.textContent = '✕';
      delBtn.title = '刪除這個任務';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(owner, task);
      });
      const nameEl = row.querySelector('.di-name');
      nameEl.insertAdjacentElement('afterend', delBtn);
    }

    el.appendChild(row);
  });
}

// ===== 任務浮動視窗：狀態／階段／回派／備忘錄 =====
let taskModalCtx = null; // { owner, task, isDispatchView }
let stageSectionOpen = true;

function openTaskModal(owner, task, isDispatchView) {
  taskModalCtx = { owner, task, isDispatchView };

  document.getElementById('taskModalBadge').textContent = isDispatchView ? '📤 派遣給 ' + owner : '📋 任務內容';
  document.getElementById('taskModalName').textContent = taskDisplayName(task);

  const metaParts = [];
  if (task.from) metaParts.push(task.from === owner ? owner + ' 自己安排' : '由 ' + task.from + ' 派遣');
  if (task.created) metaParts.push(shortTime(task.created) + ' 建立');
  if (task.date) metaParts.push('📅 ' + task.date);
  if (task.urgent) metaParts.push('🚨 緊急');
  document.getElementById('taskModalMeta').textContent = metaParts.join('・');

  const contentEl = document.getElementById('taskModalContent');
  if (task.content) {
    contentEl.textContent = task.content;
    contentEl.style.display = 'block';
  } else {
    contentEl.style.display = 'none';
  }

  // 附加資訊（顧客來源／廠商／品牌等）
  const extraEl = document.getElementById('taskModalExtra');
  const extra = task.extra || null;
  if (extra && Object.keys(extra).length) {
    // 選品網址改用下方按鈕呈現，團購key 是內部用途，識別名稱已經併進標題，都不印成文字
    const keys = Object.keys(extra).filter(k => k !== '選品網址' && k !== '團購key' && k !== '識別名稱' && extra[k]);
    if (keys.length) {
      extraEl.innerHTML = keys
        .map(k => `<b>${escHtml(k)}：</b>${escHtml(extra[k])}`)
        .join('<br>');
      extraEl.style.display = 'block';
    } else {
      extraEl.style.display = 'none';
    }
  } else {
    extraEl.style.display = 'none';
  }

  // 有選品網址就顯示「前往選品」按鈕（沒帶 http 前綴的自動補上）
  const goRow = document.getElementById('taskModalGoRow');
  let goUrl = extra && extra['選品網址'] ? String(extra['選品網址']).trim() : '';
  if (goUrl && !/^https?:\/\//i.test(goUrl)) goUrl = 'https://' + goUrl;
  if (goUrl) {
    document.getElementById('taskModalGoBtn').href = goUrl;
    goRow.style.display = 'flex';
  } else {
    goRow.style.display = 'none';
  }

  renderTaskUrgentBtn();
  document.getElementById('taskMemoText').value = task.memo || '';
  setFormStatus('taskMemoStatus', '');
  document.getElementById('stageInput').value = '';
  setFormStatus('stageStatus', '');
  document.getElementById('bounceInput').value = '';
  setFormStatus('bounceStatus', '');

  // 階段紀錄區塊每次打開都重設為展開
  stageSectionOpen = true;
  document.getElementById('stageSectionBody').style.display = 'block';
  document.getElementById('stageSectionArrow').textContent = '▼';

  renderTaskModalStatus();
  renderStageList();
  renderStageQuick();
  renderBounceList();
  document.getElementById('taskModal').classList.add('show');
}

document.getElementById('stageSectionHead').addEventListener('click', () => {
  stageSectionOpen = !stageSectionOpen;
  document.getElementById('stageSectionBody').style.display = stageSectionOpen ? 'block' : 'none';
  document.getElementById('stageSectionArrow').textContent = stageSectionOpen ? '▼' : '▶';
});

// 選品任務的公關品狀態切換：六種狀態，當前高亮，點哪顆就切到那個狀態
// 與行事曆／團購後台面板同一份 prStatusMap，兩邊串聯同步
function renderStageQuick() {
  const box = document.getElementById('stageQuick');
  const locField = document.getElementById('taskPrLocationField');
  if (!taskModalCtx || taskModalCtx.task.taskName !== '廠商選品') {
    box.style.display = 'none';
    box.innerHTML = '';
    locField.style.display = 'none';
    return;
  }
  const task = taskModalCtx.task;
  const evKey = task.extra && task.extra['團購key'] ? String(task.extra['團購key']).trim() : '';
  // 目前狀態以對應團購的公關品狀態為準（行事曆那邊改了這裡也會跟著顯示）
  const cur = (evKey && prStatusMap[evKey] && prStatusMap[evKey].status) || '尚未選品';

  const label = evKey
    ? '公關品狀態（與行事曆同步）：'
    : '公關品狀態：（此任務未指定對應團購，改這裡不會更新行事曆）';

  box.innerHTML = '<span class="stage-quick-label">' + escHtml(label) + '</span>' +
    PR_STATUS_LIST.map(s => {
      const active = s === cur ? ' active' : '';
      return `<button type="button" class="stage-quick-btn pr-${PR_STATUS_CLASS[s]}${active}" data-stage="${escHtml(s)}">${escHtml(s)}</button>`;
    }).join('');
  box.style.display = 'flex';
  box.querySelectorAll('.stage-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => setTaskPrStatus(btn.dataset.stage));
  });

  // 已收到／已拍攝才出現位置下拉，並同步進公關品清單
  document.getElementById('taskPrLocationNewRow').classList.remove('show');
  if (evKey && (cur === '已收到' || cur === '已拍攝')) {
    const curLocation = (prStatusMap[evKey] && prStatusMap[evKey].location) || '';
    fillPrLocationSelect(document.getElementById('taskPrLocationSelect'), curLocation);
    setPrMsg('taskPrLocationSaveMsg', '');
    locField.style.display = 'block';
  } else {
    locField.style.display = 'none';
  }
}

// 點狀態按鈕：把對應團購的公關品狀態切到該狀態，並在任務裡留一筆階段紀錄
async function setTaskPrStatus(stage) {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  const evKey = task.extra && task.extra['團購key'] ? String(task.extra['團購key']).trim() : '';

  // 1) 先切換對應團購的公關品狀態（行事曆／後台面板即時反映）
  if (evKey) {
    savePrStatus(evKey, { status: stage }, null).catch(() => {});
  }
  // 立即更新按鈕高亮／位置下拉
  renderStageQuick();

  // 2) 到「已收到」／「已拍攝」時，自動新增或更新一筆公關品清單（只有指定了對應團購才能自動同步）
  if (evKey && (stage === '已收到' || stage === '已拍攝')) {
    const curLocation = (prStatusMap[evKey] && prStatusMap[evKey].location) || '';
    syncPrItemFromTask(evKey, curLocation);
  }

  // 3) 順手在任務裡留一筆階段紀錄，方便追進度（樂觀更新）
  const now = new Date();
  const stageObj = { id: 'L' + Date.now(), text: stage, time: `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}` };
  task.stages = task.stages || [];
  task.stages.push(stageObj);
  renderStageList();
  setFormStatus('stageStatus', '狀態已更新為「' + stage + '」✓', 'ok');
  try {
    const result = await postTask({ type: 'task-stage-add', owner, id: task.id, text: stage });
    if (result && result.stageId) stageObj.id = result.stageId;
  } catch (err) {
    const i = task.stages.indexOf(stageObj);
    if (i !== -1) task.stages.splice(i, 1);
    renderStageList();
    setFormStatus('stageStatus', '階段紀錄儲存失敗：' + err.message, 'error');
  }
}

// 廠商選品任務進到「已收到」／「已拍攝」時，自動同步到公關品清單（只有指定了對應團購才會執行）
async function syncPrItemFromTask(evKey, location) {
  const ev = allEvents.find(e => getMemoKey(e) === evKey);
  const task = taskModalCtx ? taskModalCtx.task : null;
  const vendor = task && task.extra ? (task.extra['廠商'] || '') : '';
  const fields = { evKey, name: ev ? ev.title : '', vendor, group: ev ? ev.title : '' };
  if (location) fields.location = location;
  try {
    await postTask(Object.assign({ type: 'pr-item-sync' }, fields));
    prItemsLoaded = false; // 之後開公關品狀態列表時要重新拉一次
  } catch (err) {
    console.warn('公關品清單同步失敗：', err);
  }
}

// 位置下拉變更：選到「＋新增更多」跳出輸入列，否則直接儲存
document.getElementById('taskPrLocationSelect').addEventListener('change', async (e) => {
  if (e.target.value === '__new__') {
    document.getElementById('taskPrLocationNewRow').classList.add('show');
    return;
  }
  document.getElementById('taskPrLocationNewRow').classList.remove('show');
  await saveTaskPrLocation(e.target.value);
});
document.getElementById('taskPrLocationNewBtn').addEventListener('click', async () => {
  const input = document.getElementById('taskPrLocationNewInput');
  const name = input.value.trim();
  if (!name) return;
  try {
    await postTask({ type: 'pr-location-add', name });
    if (prLocations.indexOf(name) === -1) prLocations.push(name);
    fillPrLocationSelect(document.getElementById('taskPrLocationSelect'), name);
    document.getElementById('taskPrLocationNewRow').classList.remove('show');
    input.value = '';
    await saveTaskPrLocation(name);
  } catch (err) {
    setPrMsg('taskPrLocationSaveMsg', err.message || '新增失敗', false);
  }
});

async function saveTaskPrLocation(location) {
  if (!taskModalCtx) return;
  const task = taskModalCtx.task;
  const evKey = task.extra && task.extra['團購key'] ? String(task.extra['團購key']).trim() : '';
  if (!evKey) return;
  setPrMsg('taskPrLocationSaveMsg', '儲存中…');
  try {
    await savePrStatus(evKey, { location }, null);
    await syncPrItemFromTask(evKey, location);
    setPrMsg('taskPrLocationSaveMsg', '已儲存 ✓', true);
  } catch (err) {
    setPrMsg('taskPrLocationSaveMsg', '儲存失敗', false);
  }
}

function renderTaskModalStatus() {
  if (!taskModalCtx) return;
  const status = taskStatus(taskModalCtx.task);
  const pills = [
    ['pillPending', '待完成', 'active-pending'],
    ['pillWorking', '處理中', 'active-working'],
    ['pillDone', '已完成', 'active-done']
  ];
  pills.forEach(([id, st, cls]) => {
    const el = document.getElementById(id);
    el.className = 'status-pill' + (status === st ? ' ' + cls : '');
  });
}

// 緊急切換按鈕：已派遣的任務一直沒被處理，可以再標緊急提醒對方
function renderTaskUrgentBtn() {
  if (!taskModalCtx) return;
  const btn = document.getElementById('taskUrgentBtn');
  const on = !!taskModalCtx.task.urgent;
  btn.className = 'urgent-toggle-btn' + (on ? ' on' : '');
  btn.textContent = on ? '🚨 已標記緊急（點擊取消）' : '🚨 標記為緊急提醒';
}

document.getElementById('taskUrgentBtn').addEventListener('click', async () => {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  const newUrgent = !task.urgent;
  // 樂觀更新：先改畫面再存檔
  task.urgent = newUrgent;
  renderTaskUrgentBtn();
  renderTaskUI();
  try {
    await postTask({ type: 'task-urgent', owner, id: task.id, urgent: newUrgent });
  } catch (err) {
    task.urgent = !newUrgent;
    renderTaskUrgentBtn();
    renderTaskUI();
    alert('緊急標記更新失敗：' + err.message);
  }
});

['pillPending', 'pillWorking', 'pillDone'].forEach((id, idx) => {
  const statuses = ['待完成', '處理中', '已完成'];
  document.getElementById(id).addEventListener('click', () => {
    if (!taskModalCtx) return;
    changeTaskStatus(taskModalCtx.owner, taskModalCtx.task, statuses[idx]);
  });
});

function renderStageList() {
  if (!taskModalCtx) return;
  const el = document.getElementById('stageList');
  el.innerHTML = '';
  const stages = taskModalCtx.task.stages || [];
  if (!stages.length) {
    el.innerHTML = '<div class="task-empty" style="padding:8px 0;">還沒有階段紀錄</div>';
    return;
  }
  stages.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'stage-item';
    const dot = document.createElement('span');
    dot.className = 'stage-dot';
    dot.textContent = '●';
    const text = document.createElement('span');
    text.textContent = s.text || '';
    const time = document.createElement('span');
    time.className = 'stage-time';
    time.textContent = s.time || '';
    const del = document.createElement('button');
    del.className = 'stage-del';
    del.textContent = '✕';
    del.title = '刪除這條階段紀錄';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStage(s, idx);
    });
    row.appendChild(dot);
    row.appendChild(text);
    row.appendChild(time);
    row.appendChild(del);
    el.appendChild(row);
  });
}

async function deleteStage(stage, idx) {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  if (!confirm('確定要刪除這條階段紀錄嗎？')) return;
  const stageId = stage.id;
  const removed = task.stages.splice(idx, 1)[0];
  renderStageList();
  if (!stageId) return; // 舊資料沒有 id，只能從畫面移除，沒法同步刪除試算表裡的紀錄
  try {
    await postTask({ type: 'task-stage-delete', owner, id: task.id, stageId });
  } catch (err) {
    task.stages.splice(idx, 0, removed);
    renderStageList();
    alert('刪除失敗：' + err.message);
  }
}

document.getElementById('taskMemoSaveBtn').addEventListener('click', async () => {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  const text = document.getElementById('taskMemoText').value;
  const btn = document.getElementById('taskMemoSaveBtn');
  btn.disabled = true;
  setFormStatus('taskMemoStatus', '儲存中…');
  try {
    await postTask({ type: 'task-memo', owner, id: task.id, text });
    task.memo = text;
    setFormStatus('taskMemoStatus', '已儲存 ✓', 'ok');
  } catch (err) {
    setFormStatus('taskMemoStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('stageAddBtn').addEventListener('click', addStage);
document.getElementById('stageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addStage();
});

async function addStage() {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  const input = document.getElementById('stageInput');
  const text = input.value.trim();
  if (!text) return;
  const btn = document.getElementById('stageAddBtn');
  btn.disabled = true;
  setFormStatus('stageStatus', '新增中…');
  // 樂觀更新：先加到畫面
  const now = new Date();
  const stage = { id: 'L' + Date.now(), text, time: `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}` };
  task.stages = task.stages || [];
  task.stages.push(stage);
  renderStageList();
  input.value = '';
  try {
    const result = await postTask({ type: 'task-stage-add', owner, id: task.id, text });
    if (result && result.stageId) stage.id = result.stageId;
    setFormStatus('stageStatus', '已新增 ✓', 'ok');
  } catch (err) {
    const i = task.stages.indexOf(stage);
    if (i !== -1) task.stages.splice(i, 1);
    renderStageList();
    input.value = text;
    setFormStatus('stageStatus', '新增失敗：' + err.message, 'error');
  }
  btn.disabled = false;
}

// ===== 回派對話 =====
function renderBounceList() {
  if (!taskModalCtx) return;
  const el = document.getElementById('bounceList');
  const bounces = taskModalCtx.task.bounces || [];
  if (!bounces.length) {
    el.innerHTML = '<div class="task-empty" style="padding:8px 0;">還沒有回派紀錄</div>';
    return;
  }
  el.innerHTML = bounces.map(b =>
    `<div class="bounce-item"><span class="bounce-from">${escHtml(b.from || '')}</span>${escHtml(b.text || '')}<span class="bounce-time">${escHtml(b.time || '')}</span></div>`
  ).join('');
}

document.getElementById('bounceAddBtn').addEventListener('click', addBounce);
document.getElementById('bounceInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBounce();
});

async function addBounce() {
  if (!taskModalCtx) return;
  const { owner, task } = taskModalCtx;
  const input = document.getElementById('bounceInput');
  const text = input.value.trim();
  if (!text) return;
  const btn = document.getElementById('bounceAddBtn');
  btn.disabled = true;
  setFormStatus('bounceStatus', '送出中…');

  const now = new Date();
  const bounceObj = { from: currentUser, text, time: `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}` };
  const oldStatus = taskStatus(task);
  task.bounces = task.bounces || [];
  task.bounces.push(bounceObj);
  task.status = '回派中';
  task.done = false;
  renderBounceList();
  renderTaskModalStatus();
  renderTaskUI();
  input.value = '';
  try {
    await postTask({ type: 'task-bounce-add', owner, id: task.id, text });
    setFormStatus('bounceStatus', '已回派 ✓', 'ok');
  } catch (err) {
    task.bounces.pop();
    task.status = oldStatus;
    task.done = oldStatus === '已完成';
    renderBounceList();
    renderTaskModalStatus();
    renderTaskUI();
    input.value = text;
    setFormStatus('bounceStatus', '回派失敗：' + err.message, 'error');
  }
  btn.disabled = false;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  if (id === 'taskModal') taskModalCtx = null;
}

function renderTaskUI() {
  renderDispatchForm();
  renderSelfForm();
  renderMyTaskNameTags();
  renderMyTaskLists();
  renderDispatchedList();
  updateUrgentUI();
}

// ===== 公關品狀態列表（首頁「公關品狀態」卡片頁面） =====
let prItemsLoaded = false;
let prItemsCache = [];

function cssEscapeAdmin(str) { return String(str).replace(/(["\\])/g, '\\$1'); }

function renderPriLocationSelect() {
  fillPrLocationSelect(document.getElementById('priLocation'), '');
}

document.getElementById('priLocation').addEventListener('change', (e) => {
  document.getElementById('priLocationNewRow').classList.toggle('show', e.target.value === '__new__');
});
document.getElementById('priLocationNewBtn').addEventListener('click', async () => {
  const input = document.getElementById('priLocationNewInput');
  const name = input.value.trim();
  if (!name) return;
  try {
    await postTask({ type: 'pr-location-add', name });
    if (prLocations.indexOf(name) === -1) prLocations.push(name);
    fillPrLocationSelect(document.getElementById('priLocation'), name);
    document.getElementById('priLocationNewRow').classList.remove('show');
    input.value = '';
  } catch (err) {
    setFormStatus('priAddStatus', '新增位置失敗：' + err.message, 'error');
  }
});

async function loadPrItems(force) {
  if (prItemsLoaded && !force) { renderPrItemsList(); return; }
  const listEl = document.getElementById('priList');
  listEl.innerHTML = '<div class="task-empty">載入中…</div>';
  try {
    const result = await postTask({ type: 'pr-item-list' });
    prItemsCache = Array.isArray(result.items) ? result.items : [];
    prItemsLoaded = true;
  } catch (err) {
    listEl.innerHTML = '<div class="task-empty">讀取失敗：' + escHtml(err.message) + '</div>';
    return;
  }
  renderPrItemsList();
}

function renderPrItemsList() {
  const listEl = document.getElementById('priList');
  if (!prItemsCache.length) {
    listEl.innerHTML = '<div class="task-empty">目前沒有公關品紀錄</div>';
    return;
  }
  const sorted = prItemsCache.slice().sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
  listEl.innerHTML = sorted.map(it => `
    <div class="pri-card" data-id="${escHtml(it.id)}">
      <div class="pri-card-title">${escHtml(it.name || '（未命名）')}</div>
      <div class="pri-card-meta">廠商：${escHtml(it.vendor || '—')}　團購：${escHtml(it.group || '—')}</div>
      <div class="pri-card-row">
        <input type="text" class="pri-edit-brand" data-id="${escHtml(it.id)}" placeholder="品牌" value="${escHtml(it.brand || '')}">
        <select class="pri-edit-location" data-id="${escHtml(it.id)}"></select>
      </div>
      <div class="pri-card-row">
        <input type="text" class="pri-edit-note" data-id="${escHtml(it.id)}" placeholder="備註" value="${escHtml(it.note || '')}" style="flex:1 1 100%;">
      </div>
      <div class="pri-card-actions">
        <button class="pnote-btn pnote-btn-save pri-save-btn" data-id="${escHtml(it.id)}">💾 儲存</button>
        <button class="pnote-btn pnote-btn-delete pri-delete-btn" data-id="${escHtml(it.id)}">🗑 刪除</button>
        <span class="pri-card-status" id="priStatus_${escHtml(it.id)}"></span>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.pri-edit-location').forEach(sel => {
    const id = sel.dataset.id;
    const item = prItemsCache.find(x => x.id === id);
    fillPrLocationSelect(sel, item ? item.location : '');
    sel.addEventListener('change', (e) => {
      if (e.target.value === '__new__') {
        const name = prompt('請輸入新的位置選項：');
        if (name && name.trim()) {
          const trimmed = name.trim();
          postTask({ type: 'pr-location-add', name: trimmed }).then(() => {
            if (prLocations.indexOf(trimmed) === -1) prLocations.push(trimmed);
            fillPrLocationSelect(e.target, trimmed);
          }).catch(err => alert('新增位置失敗：' + err.message));
        } else {
          e.target.value = '';
        }
      }
    });
  });
  listEl.querySelectorAll('.pri-save-btn').forEach(btn => {
    btn.addEventListener('click', () => savePrItemEdit(btn.dataset.id));
  });
  listEl.querySelectorAll('.pri-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deletePrItemRow(btn.dataset.id));
  });
}

async function savePrItemEdit(id) {
  const card = document.querySelector(`.pri-card[data-id="${cssEscapeAdmin(id)}"]`);
  if (!card) return;
  const brand = card.querySelector('.pri-edit-brand').value.trim();
  const location = card.querySelector('.pri-edit-location').value;
  const note = card.querySelector('.pri-edit-note').value.trim();
  const statusEl = document.getElementById('priStatus_' + id);
  if (statusEl) { statusEl.textContent = '儲存中…'; statusEl.className = 'pri-card-status'; }
  try {
    await postTask({ type: 'pr-item-update', id, brand, location, note });
    const local = prItemsCache.find(x => x.id === id);
    if (local) { local.brand = brand; local.location = location; local.note = note; }
    if (statusEl) { statusEl.textContent = '已儲存 ✓'; statusEl.className = 'pri-card-status ok'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '儲存失敗'; statusEl.className = 'pri-card-status error'; }
  }
}

async function deletePrItemRow(id) {
  if (!confirm('確定要刪除這筆公關品紀錄嗎？')) return;
  try {
    await postTask({ type: 'pr-item-delete', id });
    prItemsCache = prItemsCache.filter(x => x.id !== id);
    renderPrItemsList();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

document.getElementById('priAddBtn').addEventListener('click', async () => {
  const name = document.getElementById('priName').value.trim();
  const vendor = document.getElementById('priVendor').value.trim();
  const brand = document.getElementById('priBrand').value.trim();
  const group = document.getElementById('priGroup').value.trim();
  const locSel = document.getElementById('priLocation').value;
  const location = locSel === '__new__' ? '' : locSel;
  const note = document.getElementById('priNote').value.trim();
  if (!name) { setFormStatus('priAddStatus', '請至少輸入名稱', 'error'); return; }
  const btn = document.getElementById('priAddBtn');
  btn.disabled = true;
  setFormStatus('priAddStatus', '新增中…');
  try {
    const result = await postTask({ type: 'pr-item-add', name, vendor, brand, group, location, note });
    prItemsCache.unshift({ id: result.id, name, vendor, brand, group, location, note, created: '', updated: '' });
    renderPrItemsList();
    ['priName', 'priVendor', 'priBrand', 'priGroup', 'priNote'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('priLocation').value = '';
    setFormStatus('priAddStatus', '已新增 ✓', 'ok');
  } catch (err) {
    setFormStatus('priAddStatus', '新增失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

loadData();
fetchMemos();
setInterval(loadData, 60000);
setInterval(fetchMemos, 60000);

// ===== 【新】待辦事項 =====

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function addMonthsToKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m - 1) + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

function fillTodoMonthSelect(selected) {
  const sel = document.getElementById('todoMonthSelect');
  const cur = currentMonthKey();
  const monthsSet = new Set([cur]);
  for (let i = 1; i <= 12; i++) monthsSet.add(addMonthsToKey(cur, i));
  todos.forEach(t => { if (t.month) monthsSet.add(t.month); });
  if (selected) monthsSet.add(selected);
  const months = Array.from(monthsSet).sort();
  sel.innerHTML = '';
  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = fmtMonthLabel(m);
    sel.appendChild(opt);
  });
  sel.value = selected || cur;
}

function ensureTodoMonthOption(monthKey) {
  const sel = document.getElementById('todoMonthSelect');
  if ([...sel.options].some(o => o.value === monthKey)) return;
  const opt = document.createElement('option');
  opt.value = monthKey;
  opt.textContent = fmtMonthLabel(monthKey);
  const opts = Array.from(sel.options);
  const target = opts.find(o => monthKey < o.value);
  if (target) sel.insertBefore(opt, target); else sel.appendChild(opt);
}

function fillTodoCategorySelect(selected) {
  const sel = document.getElementById('todoCategorySelect');
  sel.innerHTML = '';
  todoCategories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
  const addMore = document.createElement('option');
  addMore.value = '__new__';
  addMore.textContent = '＋ 新增更多';
  sel.appendChild(addMore);
  if (selected && [...sel.options].some(o => o.value === selected)) sel.value = selected;
  else if (todoCategories.length) sel.value = todoCategories[0];
}

function updateTodoFieldsVisibility() {
  const isBrand = document.getElementById('todoCategorySelect').value === TODO_BRAND_CATEGORY;
  document.getElementById('todoGenericFields').style.display = isBrand ? 'none' : 'block';
  document.getElementById('todoBrandFields').style.display = isBrand ? 'block' : 'none';
}

document.getElementById('todoCategorySelect').addEventListener('change', (e) => {
  const isNew = e.target.value === '__new__';
  document.getElementById('todoCategoryNewRow').classList.toggle('show', isNew);
  if (!isNew) updateTodoFieldsVisibility();
});

document.getElementById('todoCategoryNewBtn').addEventListener('click', async () => {
  const input = document.getElementById('todoCategoryNewInput');
  const name = input.value.trim();
  if (!name) return;
  if (todoCategories.indexOf(name) !== -1) {
    fillTodoCategorySelect(name);
    document.getElementById('todoCategoryNewRow').classList.remove('show');
    updateTodoFieldsVisibility();
    input.value = '';
    return;
  }
  try {
    await postTask({ type: 'todo-category-add', name });
    todoCategories.push(name);
    fillTodoCategorySelect(name);
    document.getElementById('todoCategoryNewRow').classList.remove('show');
    updateTodoFieldsVisibility();
    input.value = '';
  } catch (err) {
    setFormStatus('todoEditStatus', '新增主選項失敗：' + err.message, 'error');
  }
});

document.getElementById('todoStageSelect').addEventListener('change', () => {
  const show = document.getElementById('todoStageSelect').value === '確定日期';
  document.getElementById('todoCalendarFields').style.display = show ? 'block' : 'none';
});

// 重要程度快選按鈕：高／中／低／不追是會存起來的狀態；「改到下個月」是一次性動作，
// 點了會把月份選單往後移一個月，但不會把「改到下個月」本身存成重要程度
function renderTodoPriorityQuick(activePriority) {
  const box = document.getElementById('todoPriorityQuick');
  box.innerHTML = '';
  TODO_PRIORITY_LIST.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stage-quick-btn' + (p === activePriority ? ' active' : '');
    btn.style.background = TODO_PRIORITY_COLOR[p];
    btn.style.color = TODO_PRIORITY_TEXT_COLOR[p];
    btn.textContent = p;
    btn.addEventListener('click', () => {
      selectedTodoPriority = p;
      renderTodoPriorityQuick(p);
    });
    box.appendChild(btn);
  });
  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'stage-quick-btn';
  moveBtn.style.background = '#EFE4FB';
  moveBtn.style.color = '#7A5AC8';
  moveBtn.textContent = '➡️ 改到下個月';
  moveBtn.addEventListener('click', () => {
    const monthSel = document.getElementById('todoMonthSelect');
    const next = addMonthsToKey(monthSel.value, 1);
    ensureTodoMonthOption(next);
    monthSel.value = next;
    setFormStatus('todoEditStatus', '已改到下個月，記得按「儲存」才會生效 ✓', 'ok');
  });
  box.appendChild(moveBtn);
}

function openTodoEditModal(todo) {
  const isNew = !todo;
  todoEditCtx = { isNew, todo };
  document.getElementById('todoEditTitle').textContent = isNew ? '➕ 新增待辦事項' : '✏️ 編輯待辦事項';
  document.getElementById('todoDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  setFormStatus('todoEditStatus', '', '');
  document.getElementById('todoCategoryNewRow').classList.remove('show');

  fillTodoCategorySelect(todo ? todo.category : (todoCategories[0] || ''));
  updateTodoFieldsVisibility();

  document.getElementById('todoTitleInput').value = todo ? todo.title : '';
  document.getElementById('todoContentInput').value = todo ? todo.content : '';
  document.getElementById('todoBrandInput').value = todo ? todo.brand : '';
  document.getElementById('todoStageSelect').value = todo && todo.stage ? todo.stage : '洽談中';
  document.getElementById('todoGroupStartInput').value = todo ? (todo.groupStart || '') : '';
  document.getElementById('todoGroupEndInput').value = todo ? (todo.groupEnd || '') : '';
  document.getElementById('todoCalendarFields').style.display = document.getElementById('todoStageSelect').value === '確定日期' ? 'block' : 'none';
  document.getElementById('todoAddedToCalendarNote').style.display = (todo && todo.addedToCalendar) ? 'block' : 'none';
  document.getElementById('todoAddToCalendarBtn').style.display = (todo && todo.addedToCalendar) ? 'none' : 'block';

  fillTodoMonthSelect(todo ? todo.month : currentMonthKey());

  selectedTodoPriority = (todo && todo.priority) ? todo.priority : '中';
  renderTodoPriorityQuick(selectedTodoPriority);

  document.getElementById('todoEditModal').classList.add('show');
}

function closeTodoEditModal() {
  document.getElementById('todoEditModal').classList.remove('show');
  todoEditCtx = null;
}

// 收集表單內容並存檔（新增或更新），回傳這筆待辦事項的 id；共用給「儲存」跟「一鍵新增至行事曆」
async function collectAndSaveTodo_() {
  const category = document.getElementById('todoCategorySelect').value;
  if (!category || category === '__new__') throw new Error('請選擇主選項');
  const isBrand = category === TODO_BRAND_CATEGORY;

  const fields = { category, month: document.getElementById('todoMonthSelect').value, priority: selectedTodoPriority };
  if (isBrand) {
    const brand = document.getElementById('todoBrandInput').value.trim();
    if (!brand) throw new Error('請輸入品牌');
    fields.brand = brand;
    fields.stage = document.getElementById('todoStageSelect').value;
    fields.groupStart = document.getElementById('todoGroupStartInput').value;
    fields.groupEnd = document.getElementById('todoGroupEndInput').value;
    fields.title = '';
    fields.content = '';
  } else {
    const title = document.getElementById('todoTitleInput').value.trim();
    if (!title) throw new Error('請輸入標題');
    fields.title = title;
    fields.content = document.getElementById('todoContentInput').value.trim();
    fields.brand = '';
    fields.stage = '';
    fields.groupStart = '';
    fields.groupEnd = '';
  }

  if (todoEditCtx.isNew) {
    const result = await postTask(Object.assign({ type: 'todo-add' }, fields));
    todoEditCtx = { isNew: false, todo: { id: result.id } };
    return result.id;
  }
  const id = todoEditCtx.todo.id;
  await postTask(Object.assign({ type: 'todo-update', id }, fields));
  return id;
}

document.getElementById('todoAddBtn').addEventListener('click', () => openTodoEditModal(null));

document.getElementById('todoSaveBtn').addEventListener('click', async () => {
  if (!todoEditCtx) return;
  const btn = document.getElementById('todoSaveBtn');
  btn.disabled = true;
  setFormStatus('todoEditStatus', '儲存中…', '');
  try {
    await collectAndSaveTodo_();
    closeTodoEditModal();
    await fetchMemos();
    renderTodoGroups();
  } catch (err) {
    setFormStatus('todoEditStatus', err.message || '儲存失敗', 'error');
  }
  btn.disabled = false;
});

document.getElementById('todoDeleteBtn').addEventListener('click', async () => {
  if (!todoEditCtx || todoEditCtx.isNew) return;
  if (!confirm('確定要刪除這筆待辦事項嗎？刪除後就找不回來囉')) return;
  const btn = document.getElementById('todoDeleteBtn');
  btn.disabled = true;
  setFormStatus('todoEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'todo-delete', id: todoEditCtx.todo.id });
    closeTodoEditModal();
    await fetchMemos();
    renderTodoGroups();
  } catch (err) {
    setFormStatus('todoEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

// 團購合作進到「確定日期」階段：一鍵把這筆待辦事項的品牌／日期新增到行事曆（預設尚未確認顯示於前台，
// 之後記得去行事曆編輯模式按「確認顯示於前台」）
document.getElementById('todoAddToCalendarBtn').addEventListener('click', async () => {
  if (!todoEditCtx) return;
  const brand = document.getElementById('todoBrandInput').value.trim();
  const start = document.getElementById('todoGroupStartInput').value;
  const end = document.getElementById('todoGroupEndInput').value;
  if (!brand) { setFormStatus('todoEditStatus', '請先輸入品牌', 'error'); return; }
  if (!start || !end) { setFormStatus('todoEditStatus', '請選擇開團與結團日期', 'error'); return; }

  const btn = document.getElementById('todoAddToCalendarBtn');
  btn.disabled = true;
  setFormStatus('todoEditStatus', '新增至行事曆中…', '');
  try {
    const id = await collectAndSaveTodo_();
    await postTask({
      type: 'event-add', title: brand, start: start, end: end,
      allDay: true, isGroupBuy: true, published: false,
      color: '', category: '', url: '', tag: '', extend: '', earlyBird: ''
    });
    await postTask({ type: 'todo-update', id: id, addedToCalendar: true });
    document.getElementById('todoAddedToCalendarNote').style.display = 'block';
    btn.style.display = 'none';
    setFormStatus('todoEditStatus', '已新增至行事曆 ✓ 記得之後到行事曆編輯模式按「確認顯示於前台」', 'ok');
    await fetchMemos();
    if (typeof loadData === 'function') loadData();
    renderTodoGroups();
  } catch (err) {
    setFormStatus('todoEditStatus', '新增至行事曆失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

function todoPriorityRank(p) {
  const idx = TODO_PRIORITY_LIST.indexOf(p);
  return idx === -1 ? 99 : idx;
}

function todoDisplayName(t) {
  const label = t.category === TODO_BRAND_CATEGORY ? (t.brand || '（未命名品牌）') : (t.title || '（未命名）');
  return `${t.category || '待辦'}：${label}`;
}

function renderTodoGroups() {
  const box = document.getElementById('todoGroups');
  if (!box) return;
  box.innerHTML = '';

  if (!todos.length) {
    box.innerHTML = '<div class="todo-empty">目前沒有待辦事項，點上面「＋新增待辦事項」開始記錄吧</div>';
    return;
  }

  const byMonth = {};
  todos.forEach(t => {
    const key = t.month || currentMonthKey();
    (byMonth[key] = byMonth[key] || []).push(t);
  });
  const months = Object.keys(byMonth).sort();

  months.forEach(monthKey => {
    const items = byMonth[monthKey].slice().sort((a, b) => {
      const r = todoPriorityRank(a.priority) - todoPriorityRank(b.priority);
      if (r !== 0) return r;
      return (a.created || '').localeCompare(b.created || '');
    });

    const group = document.createElement('div');
    group.className = 'todo-month-group';
    const head = document.createElement('div');
    head.className = 'todo-month-head';
    head.textContent = fmtMonthLabel(monthKey);
    group.appendChild(head);

    items.forEach(t => {
      const item = document.createElement('div');
      item.className = 'todo-item';

      const headRow = document.createElement('div');
      headRow.className = 'todo-item-head';

      if (TODO_PRIORITY_LIST.indexOf(t.priority) !== -1) {
        const dot = document.createElement('span');
        dot.className = 'todo-dot todo-dot-' + t.priority;
        dot.title = '重要程度：' + t.priority;
        headRow.appendChild(dot);
      }

      const nameEl = document.createElement('span');
      nameEl.className = 'todo-item-name';
      nameEl.textContent = todoDisplayName(t);
      headRow.appendChild(nameEl);

      const arrow = document.createElement('span');
      arrow.className = 'todo-item-arrow';
      arrow.textContent = '▾';
      headRow.appendChild(arrow);

      item.appendChild(headRow);

      const body = document.createElement('div');
      body.className = 'todo-item-body';
      const lines = [];
      if (t.category === TODO_BRAND_CATEGORY) {
        if (t.stage) lines.push('合作階段：' + t.stage);
        if (t.groupStart && t.groupEnd) lines.push('日期：' + t.groupStart + ' ～ ' + t.groupEnd);
        if (t.addedToCalendar) lines.push('✅ 已加入行事曆');
      } else if (t.content) {
        lines.push(t.content);
      }
      lines.push((t.createdBy ? t.createdBy + '　' : '') + (t.created || ''));
      body.textContent = lines.join('\n');

      const actions = document.createElement('div');
      actions.className = 'todo-item-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'task-mini-btn';
      editBtn.textContent = '✏️ 編輯';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTodoEditModal(t); });
      const delBtn = document.createElement('button');
      delBtn.className = 'task-mini-btn danger';
      delBtn.textContent = '🗑 刪除';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('確定要刪除這筆待辦事項嗎？')) return;
        try {
          await postTask({ type: 'todo-delete', id: t.id });
          await fetchMemos();
          renderTodoGroups();
        } catch (err) {
          alert('刪除失敗：' + err.message);
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      body.appendChild(actions);

      item.appendChild(body);
      item.addEventListener('click', () => item.classList.toggle('open'));
      group.appendChild(item);
    });

    box.appendChild(group);
  });
}

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

// ===== 【新】計算機：基本四則運算 + 稅率互算（稅率固定 5%） =====

let calcDisplayValue = '0';
let calcPrevValue = null;
let calcOperator = null;
let calcWaitingForOperand = false;

function calcRenderDisplay() {
  const el = document.getElementById('calcDisplay');
  if (el) el.textContent = calcDisplayValue;
}

function calcFormatNumber(n) {
  if (!isFinite(n)) return '錯誤';
  // 避免浮點數運算誤差跑出一長串小數（例如 0.1+0.2 變成 0.30000000000000004）
  const rounded = Math.round(n * 1e8) / 1e8;
  return String(rounded);
}

function calcInputDigit(d) {
  if (calcWaitingForOperand) {
    calcDisplayValue = d;
    calcWaitingForOperand = false;
  } else {
    calcDisplayValue = calcDisplayValue === '0' ? d : calcDisplayValue + d;
  }
  calcRenderDisplay();
}

function calcInputDecimal() {
  if (calcWaitingForOperand) {
    calcDisplayValue = '0.';
    calcWaitingForOperand = false;
    calcRenderDisplay();
    return;
  }
  if (calcDisplayValue.indexOf('.') === -1) {
    calcDisplayValue += '.';
    calcRenderDisplay();
  }
}

function calcClear() {
  calcDisplayValue = '0';
  calcPrevValue = null;
  calcOperator = null;
  calcWaitingForOperand = false;
  calcRenderDisplay();
}

function calcBackspace() {
  if (calcWaitingForOperand) return;
  calcDisplayValue = calcDisplayValue.length > 1 ? calcDisplayValue.slice(0, -1) : '0';
  calcRenderDisplay();
}

function calcInputPercent() {
  const val = parseFloat(calcDisplayValue);
  if (isNaN(val)) return;
  calcDisplayValue = calcFormatNumber(val / 100);
  calcRenderDisplay();
}

function calcCompute(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function calcPerformOperation(nextOperator) {
  const inputValue = parseFloat(calcDisplayValue);
  if (isNaN(inputValue)) return;

  if (calcPrevValue === null) {
    calcPrevValue = inputValue;
  } else if (calcOperator) {
    const result = calcCompute(calcPrevValue, inputValue, calcOperator);
    calcDisplayValue = calcFormatNumber(result);
    calcPrevValue = result;
    calcRenderDisplay();
  }

  calcWaitingForOperand = true;
  calcOperator = nextOperator === '=' ? null : nextOperator;
}

// ---- 稅率互算：未稅金額／稅額／含稅金額，輸入任一欄自動算另外兩欄（四捨五入到整數元） ----
const TAX_RATE = 0.05;

function taxRound(n) {
  return Math.round(n);
}

(function bindTaxCalcInputs() {
  const preEl = document.getElementById('taxPreInput');
  const amtEl = document.getElementById('taxAmtInput');
  const incEl = document.getElementById('taxIncInput');
  if (!preEl || !amtEl || !incEl) return;

  preEl.addEventListener('input', () => {
    const pre = parseFloat(preEl.value);
    if (isNaN(pre)) { amtEl.value = ''; incEl.value = ''; return; }
    const amt = taxRound(pre * TAX_RATE);
    amtEl.value = amt;
    incEl.value = taxRound(pre + amt);
  });

  amtEl.addEventListener('input', () => {
    const amt = parseFloat(amtEl.value);
    if (isNaN(amt)) { preEl.value = ''; incEl.value = ''; return; }
    const pre = taxRound(amt / TAX_RATE);
    preEl.value = pre;
    incEl.value = taxRound(pre + amt);
  });

  incEl.addEventListener('input', () => {
    const inc = parseFloat(incEl.value);
    if (isNaN(inc)) { preEl.value = ''; amtEl.value = ''; return; }
    const pre = taxRound(inc / (1 + TAX_RATE));
    const amt = taxRound(inc - pre);
    preEl.value = pre;
    amtEl.value = amt;
  });
})();
// ===== 【新】開團狀態清單：自訂區塊（文字按鈕等） =====
const CB_TITLE_SIZE_PX = { '小': '14px', '中': '17px', '大': '21px', '特大': '26px' };
const CB_BORDER_STYLE_CSS = { '無': 'none', '實線': 'solid', '虛線': 'dashed' };
const CB_ANIM_CLASS = { '無': '', '搖晃': 'cb-anim-shake', '跳動': 'cb-anim-bounce', '震動': 'cb-anim-vibrate' };

function appendCustomBlocksAdmin(listEl, position) {
  const items = customBlocks.filter(b => b.position === position).sort((a, b) => a.order - b.order);
  items.forEach((b, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'cb-admin-wrap';

    const card = document.createElement('div');
    card.className = 'cb-card' + (CB_ANIM_CLASS[b.animation] ? ' ' + CB_ANIM_CLASS[b.animation] : '') + (b.enabled ? '' : ' cb-disabled');
    card.style.background = b.buttonColor || '#FF8FA3';
    card.style.color = b.textColor || '#FFFFFF';
    const borderCss = CB_BORDER_STYLE_CSS[b.borderStyle] || 'none';
    card.style.border = borderCss === 'none' ? 'none' : `${b.borderWidth || 2}px ${borderCss} ${b.borderColor || '#FFFFFF'}`;

    const titleEl = document.createElement('div');
    titleEl.className = 'cb-title';
    titleEl.style.fontSize = CB_TITLE_SIZE_PX[b.titleSize] || '17px';
    titleEl.textContent = b.title || '';
    card.appendChild(titleEl);

    if (b.subtitleOn && b.subtitle) {
      const subEl = document.createElement('div');
      subEl.className = 'cb-subtitle';
      subEl.textContent = b.subtitle;
      card.appendChild(subEl);
    }
    wrap.appendChild(card);

    const bar = document.createElement('div');
    bar.className = 'cb-admin-bar';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'pr-toggle show';
    toggleLabel.title = '前台是否顯示這個區塊';
    const toggleText = document.createElement('span');
    toggleText.className = 'pr-toggle-text';
    toggleText.textContent = '顯示';
    const toggleSwitch = document.createElement('span');
    toggleSwitch.className = 'pr-switch' + (b.enabled ? ' on' : '');
    toggleSwitch.innerHTML = '<span class="pr-knob"></span>';
    toggleSwitch.addEventListener('click', (e) => { e.stopPropagation(); toggleCustomBlock(b); });
    toggleLabel.appendChild(toggleText);
    toggleLabel.appendChild(toggleSwitch);
    bar.appendChild(toggleLabel);

    const upBtn = document.createElement('button');
    upBtn.className = 'task-mini-btn';
    upBtn.textContent = '↑';
    upBtn.title = '往上移';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCustomBlock(b, 'up'); });
    bar.appendChild(upBtn);

    const downBtn = document.createElement('button');
    downBtn.className = 'task-mini-btn';
    downBtn.textContent = '↓';
    downBtn.title = '往下移';
    downBtn.disabled = idx === items.length - 1;
    downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveCustomBlock(b, 'down'); });
    bar.appendChild(downBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'task-mini-btn';
    editBtn.textContent = '✏️';
    editBtn.title = '編輯這個區塊';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openBlockEditModal(b); });
    bar.appendChild(editBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'task-mini-btn';
    dupBtn.textContent = '📋';
    dupBtn.title = '複製這個區塊';
    dupBtn.addEventListener('click', (e) => { e.stopPropagation(); duplicateCustomBlock(b); });
    bar.appendChild(dupBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-mini-btn danger';
    delBtn.textContent = '🗑';
    delBtn.title = '刪除這個區塊';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCustomBlock(b); });
    bar.appendChild(delBtn);

    wrap.appendChild(bar);

    const statKey = 'block_' + b.id;
    const st = statsMap[statKey] || { views: 0, clicks: 0 };
    const statsEl = document.createElement('div');
    statsEl.className = 'cb-admin-stats';
    statsEl.textContent = `👀 瀏覽 ${st.views || 0} 次・🖱️ 點擊 ${st.clicks || 0} 次`;
    wrap.appendChild(statsEl);

    listEl.appendChild(wrap);
  });
}

async function toggleCustomBlock(block) {
  const newVal = !block.enabled;
  block.enabled = newVal;
  renderGroupStatusList('groupStatusList');
  renderGroupStatusList('calGroupList');
  try {
    await postTask({ type: 'block-update', id: block.id, enabled: newVal });
  } catch (err) {
    block.enabled = !newVal;
    renderGroupStatusList('groupStatusList');
    renderGroupStatusList('calGroupList');
    alert('更新失敗：' + err.message);
  }
}

async function moveCustomBlock(block, direction) {
  try {
    await postTask({ type: 'block-move', id: block.id, direction });
    await fetchMemos();
  } catch (err) {
    alert('排序更新失敗：' + err.message);
  }
}

async function duplicateCustomBlock(block) {
  try {
    await postTask({ type: 'block-duplicate', id: block.id });
    await fetchMemos();
    alert('已複製一份，預設先關閉顯示，記得編輯後再打開顯示開關');
  } catch (err) {
    alert('複製失敗：' + err.message);
  }
}

async function deleteCustomBlock(block) {
  if (!confirm('確定要刪除「' + (block.title || '') + '」這個區塊嗎？刪除後就找不回來囉')) return;
  try {
    await postTask({ type: 'block-delete', id: block.id });
    await fetchMemos();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ===== 文字按鈕區塊 新增／編輯 視窗 =====
let blockEditCtx = null; // { isNew, block }

function updateBlockPreview() {
  const preview = document.getElementById('blockPreview');
  if (!preview) return;
  preview.innerHTML = '';
  const fake = {
    title: document.getElementById('blkTitleInput').value || '按鈕文字',
    titleSize: document.getElementById('blkTitleSizeSelect').value,
    subtitleOn: isEvSwitchOn('blkSubtitleSwitch'),
    subtitle: document.getElementById('blkSubtitleInput').value,
    buttonColor: document.getElementById('blkButtonColorInput').value,
    borderStyle: document.getElementById('blkBorderStyleSelect').value,
    borderWidth: parseInt(document.getElementById('blkBorderWidthInput').value, 10) || 0,
    borderColor: document.getElementById('blkBorderColorInput').value,
    textColor: document.getElementById('blkTextColorInput').value,
    animation: document.getElementById('blkAnimationSelect').value
  };
  const card = document.createElement('div');
  card.className = 'cb-card' + (CB_ANIM_CLASS[fake.animation] ? ' ' + CB_ANIM_CLASS[fake.animation] : '');
  card.style.background = fake.buttonColor;
  card.style.color = fake.textColor;
  const borderCss = CB_BORDER_STYLE_CSS[fake.borderStyle] || 'none';
  card.style.border = borderCss === 'none' ? 'none' : `${fake.borderWidth}px ${borderCss} ${fake.borderColor}`;
  const titleEl = document.createElement('div');
  titleEl.className = 'cb-title';
  titleEl.style.fontSize = CB_TITLE_SIZE_PX[fake.titleSize] || '17px';
  titleEl.textContent = fake.title;
  card.appendChild(titleEl);
  if (fake.subtitleOn && fake.subtitle) {
    const subEl = document.createElement('div');
    subEl.className = 'cb-subtitle';
    subEl.textContent = fake.subtitle;
    card.appendChild(subEl);
  }
  card.style.width = '260px';
  preview.appendChild(card);
}

function openBlockEditModal(block) {
  const isNew = !block;
  blockEditCtx = { isNew, block };
  document.getElementById('blockEditTitle').textContent = isNew ? '➕ 新增文字按鈕' : '✏️ 編輯文字按鈕';
  document.getElementById('blkDeleteBtn').style.display = isNew ? 'none' : 'inline-block';
  document.getElementById('blkSaveBtn').textContent = isNew ? '➕ 新增按鈕' : '💾 儲存變更';
  setFormStatus('blkEditStatus', '', '');

  document.getElementById('blkTitleInput').value = block ? block.title : '';
  document.getElementById('blkTitleSizeSelect').value = block ? block.titleSize : '中';
  setEvSwitch('blkSubtitleSwitch', block ? !!block.subtitleOn : false);
  document.getElementById('blkSubtitleRow').style.display = (block && block.subtitleOn) ? 'block' : 'none';
  document.getElementById('blkSubtitleInput').value = block ? block.subtitle : '';
  document.getElementById('blkButtonColorInput').value = block ? block.buttonColor : '#FF8FA3';
  document.getElementById('blkBorderStyleSelect').value = block ? block.borderStyle : '無';
  document.getElementById('blkBorderWidthInput').value = block ? (block.borderWidth || 2) : 2;
  document.getElementById('blkBorderColorInput').value = block ? block.borderColor : '#FFFFFF';
  document.getElementById('blkTextColorInput').value = block ? block.textColor : '#FFFFFF';
  document.getElementById('blkUrlInput').value = block ? block.url : '';
  document.getElementById('blkAnimationSelect').value = block ? block.animation : '無';
  document.getElementById('blkPositionSelect').value = block ? block.position : 'after';
  document.getElementById('blkBorderFieldsWrap').style.display = ((block ? block.borderStyle : '無') !== '無') ? 'flex' : 'none';

  updateBlockPreview();
  document.getElementById('blockEditModal').classList.add('show');
}

function closeBlockEditModal() {
  document.getElementById('blockEditModal').classList.remove('show');
  blockEditCtx = null;
}

document.getElementById('blkSubtitleSwitch').addEventListener('click', () => {
  const on = !isEvSwitchOn('blkSubtitleSwitch');
  setEvSwitch('blkSubtitleSwitch', on);
  document.getElementById('blkSubtitleRow').style.display = on ? 'block' : 'none';
  updateBlockPreview();
});
document.getElementById('blkBorderStyleSelect').addEventListener('change', (e) => {
  document.getElementById('blkBorderFieldsWrap').style.display = e.target.value === '無' ? 'none' : 'flex';
  updateBlockPreview();
});
['blkTitleInput', 'blkTitleSizeSelect', 'blkSubtitleInput', 'blkButtonColorInput', 'blkBorderWidthInput',
  'blkBorderColorInput', 'blkTextColorInput', 'blkAnimationSelect'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateBlockPreview);
});

document.getElementById('blkSaveBtn').addEventListener('click', async () => {
  const title = document.getElementById('blkTitleInput').value.trim();
  if (!title) { setFormStatus('blkEditStatus', '請輸入標題', 'error'); return; }

  const payload = {
    title,
    titleSize: document.getElementById('blkTitleSizeSelect').value,
    subtitleOn: isEvSwitchOn('blkSubtitleSwitch'),
    subtitle: document.getElementById('blkSubtitleInput').value.trim(),
    buttonColor: document.getElementById('blkButtonColorInput').value,
    borderStyle: document.getElementById('blkBorderStyleSelect').value,
    borderWidth: parseInt(document.getElementById('blkBorderWidthInput').value, 10) || 0,
    borderColor: document.getElementById('blkBorderColorInput').value,
    textColor: document.getElementById('blkTextColorInput').value,
    url: document.getElementById('blkUrlInput').value.trim(),
    animation: document.getElementById('blkAnimationSelect').value,
    position: document.getElementById('blkPositionSelect').value
  };

  const btn = document.getElementById('blkSaveBtn');
  btn.disabled = true;
  setFormStatus('blkEditStatus', '儲存中…', '');
  try {
    if (blockEditCtx.isNew) {
      payload.enabled = true;
      await postTask(Object.assign({ type: 'block-add', blockType: 'text_button' }, payload));
    } else {
      await postTask(Object.assign({ type: 'block-update', id: blockEditCtx.block.id }, payload));
    }
    closeBlockEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('blkEditStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

document.getElementById('blkDeleteBtn').addEventListener('click', async () => {
  if (!blockEditCtx || blockEditCtx.isNew) return;
  if (!confirm('確定要刪除「' + (blockEditCtx.block.title || '') + '」這個區塊嗎？')) return;
  const btn = document.getElementById('blkDeleteBtn');
  btn.disabled = true;
  setFormStatus('blkEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'block-delete', id: blockEditCtx.block.id });
    closeBlockEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('blkEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
