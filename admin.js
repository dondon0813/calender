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
const SELF_DEFAULT_TASKS = ['顧客提問']; // 「安排工作」預設只有這些＋新增更多
const CUSTOMER_SOURCES = ['IG', 'FB', 'LINE群組', 'LINE官方帳號'];
const COLORS = 7;
const WD_LABEL = ['日','一','二','三','四','五','六'];

let allEvents = [];
let currentYear, currentMonth;
let currentMode = 'start';

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
      const start = parseDateStr(startRaw);
      const end = parseDateStr(endRaw);
      if (!start || !end || !title) return;
      const extend = parseExtendRaw(extendRaw, end);
      const displayEnd = computeDisplayEnd(end, extend);
      const earlyBird = String(earlyBirdRaw || '').split('/').map(s => s.trim()).filter(s => s !== '');
      events.push({ id, start, end, extend, displayEnd, title, tag, category, url, adminUrl, earlyBird });
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
      weekEl.appendChild(cell);
    });

    weekEvents.forEach(item => {
      const colorIdx = (item.ev.id - 1) % COLORS;
      const bar = document.createElement('div');
      bar.className = `ebar c${colorIdx} clickable`;
      bar.addEventListener('click', () => openAdminModal(item.ev));
      bar.style.gridColumn = `${item.colStart + 1} / ${item.colEnd + 2}`;
      bar.style.gridRow = `${item.lane + 2}`;
      bar.title = `${item.ev.title} (${fmtDateLabel(item.ev.start, item.ev.displayEnd)})（點擊查看內部資訊）`;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = item.ev.id;
      bar.appendChild(badge);

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
          const bar = document.createElement('div');
          const catClass = frozen ? 'cat-frozen' : `cat-${status}`;
          bar.className = `ebar ebar-wrap ${catClass} clickable`;
          bar.addEventListener('click', () => openAdminModal(ev));
          bar.title = `${ev.title} (${mode === 'start' ? '開團' : '結團'} ${fmtSingleDate(mode === 'start' ? ev.start : ev.displayEnd)})（點擊查看內部資訊）`;

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

          // 冷凍團：即將結單時顯示小紅點倒數天數
          if (frozen && (status === 'closingSoon')) {
            const daysLeft = Math.max(0, daysBetween(startOfDay(new Date()), startOfDay(ev.displayEnd)));
            const dot = document.createElement('span');
            dot.className = 'countdown-dot';
            dot.textContent = daysLeft;
            dot.title = daysLeft === 0 ? '今天結單' : `剩 ${daysLeft} 天結單`;
            bar.appendChild(dot);
          }

          stack.appendChild(bar);
        });
        cell.appendChild(stack);
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
function renderGroupStatusList(targetId) {
  const listEl = document.getElementById(targetId || 'groupStatusList');
  if (!listEl) return;
  listEl.innerHTML = '';

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
  buildSection('🌼現正團購中🌼', activeItems);

  if (!closingItems.length && !activeItems.length) {
    const empty = document.createElement('div');
    empty.className = 'gs-empty';
    empty.textContent = '目前沒有進行中的團購';
    listEl.appendChild(empty);
  }
}

function openAdminModal(ev) {
  currentModalEv = ev;
  const key = getMemoKey(ev);

  document.getElementById('adminModalBadge').textContent = `編號 ${ev.id}`;
  document.getElementById('adminModalTitle').textContent = ev.title;
  document.getElementById('adminModalMeta').textContent =
    `開團 ${fmtSingleDate(ev.start)}　結單 ${fmtSingleDate(ev.displayEnd)}` +
    (isFrozenEvent(ev) ? '　❄冷凍團' : '');

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
    if (currentUser) {
      renderTaskUI();
    }
    if (currentView === 'calendar' && typeof render === 'function') {
      render();
    }
    const taskModalEl = document.getElementById('taskModal');
    if (taskModalCtx && taskModalEl && taskModalEl.classList.contains('show')) {
      renderStageQuick();
    }
  } catch (err) {
    console.warn('後台資料讀取失敗：', err);
  }
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
  currentView = name;
  const map = { home: 'viewHome', calendar: 'viewCalendar', dispatch: 'viewDispatch', myTasks: 'viewMyTasks', memo: 'viewMemo', prItems: 'viewPrItems', groupStatus: 'viewGroupStatus', tools: 'viewTools', lotteryTool: 'viewLotteryTool', convertTool: 'viewConvertTool' };
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
  if (name === 'groupStatus') renderGroupStatusList('groupStatusList');
  if (name === 'lotteryTool') renderLotteryWinnerList();
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
let lotteryState = null; // null = 尚未開始；開始後存放獎項佇列、名單池、規則、中獎紀錄

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

function drawLottery() {
  if (!lotteryState) {
    const prizesRaw = parseLotteryLines_(document.getElementById('lotteryPrizesInput').value);
    const participantsRaw = parseLotteryLines_(document.getElementById('lotteryParticipantsInput').value);
    if (!prizesRaw.length) { alert('請先輸入獎項清單'); return; }
    if (!participantsRaw.length) { alert('請先輸入參加名單'); return; }
    const rule = document.getElementById('lotteryRuleSelect').value;

    // 抽獎順序：清單由上到下＝大獎到小獎，但實際抽獎從「最下面」開始抽到最上面
    const prizeQueue = prizesRaw.slice().reverse().map(p => ({ name: p.name, remaining: p.count }));

    // 依規則展開參加名單成「機會池」
    let pool;
    if (rule === 'removeName') {
      // 每人只留一筆資格，不論輸入幾次機會
      pool = participantsRaw.map(p => ({ name: p.name }));
    } else {
      pool = [];
      participantsRaw.forEach(p => {
        for (let i = 0; i < p.count; i++) pool.push({ name: p.name });
      });
    }

    lotteryState = {
      prizeQueue,
      pool,
      rule,
      wonPrizeByPerson: {}, // { 姓名: Set(已中過的獎項名稱) }，「移除一次機會(獎項不重複)」規則用
      winnerLog: []
    };

    document.getElementById('lotteryPrizesInput').disabled = true;
    document.getElementById('lotteryParticipantsInput').disabled = true;
    document.getElementById('lotteryRuleSelect').disabled = true;
  }

  performOneLotteryDraw_();
}

function performOneLotteryDraw_() {
  const state = lotteryState;

  // 找出目前要抽的獎項（佇列裡第一個還有剩餘數量的）
  let prize = null;
  while (state.prizeQueue.length && !prize) {
    if (state.prizeQueue[0].remaining > 0) prize = state.prizeQueue[0];
    else state.prizeQueue.shift();
  }
  if (!prize) {
    finishLottery_();
    return;
  }

  // 依規則篩選這次可以抽的人
  let eligible = state.pool;
  if (state.rule === 'removeChanceUniquePrize') {
    eligible = state.pool.filter(p => !(state.wonPrizeByPerson[p.name] && state.wonPrizeByPerson[p.name].has(prize.name)));
    if (!eligible.length) eligible = state.pool; // 大家都中過這個獎了，就不設限，避免卡住
  }

  if (!eligible.length) {
    alert('目前沒有可以抽獎的參加者了');
    finishLottery_();
    return;
  }

  const winner = eligible[Math.floor(Math.random() * eligible.length)];
  prize.remaining -= 1;

  if (state.rule === 'removeName') {
    state.pool = state.pool.filter(p => p.name !== winner.name);
  } else if (state.rule === 'removeChance' || state.rule === 'removeChanceUniquePrize') {
    const realIdx = state.pool.indexOf(winner);
    if (realIdx !== -1) state.pool.splice(realIdx, 1);
    if (state.rule === 'removeChanceUniquePrize') {
      if (!state.wonPrizeByPerson[winner.name]) state.wonPrizeByPerson[winner.name] = new Set();
      state.wonPrizeByPerson[winner.name].add(prize.name);
    }
  }
  // rule === 'keepChance'：不做任何移除，機會池維持不變

  state.winnerLog.unshift({ prize: prize.name, winner: winner.name });

  document.getElementById('lotteryResultBox').style.display = '';
  document.getElementById('lotteryResultPrize').textContent = prize.name;
  document.getElementById('lotteryResultWinner').textContent = winner.name;
  renderLotteryWinnerList();

  document.getElementById('lotteryDrawBtn').textContent = '🎲 繼續抽獎';

  if (state.prizeQueue.every(p => p.remaining <= 0)) {
    finishLottery_();
  }
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
  if (!lotteryState || !lotteryState.winnerLog.length) {
    el.innerHTML = '<div class="task-empty">還沒有抽出任何獎項</div>';
    return;
  }
  lotteryState.winnerLog.forEach(entry => {
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
  if (lotteryState && !confirm('確定要重新設定嗎？目前的抽獎進度會清空')) return;
  lotteryState = null;
  document.getElementById('lotteryPrizesInput').value = '';
  document.getElementById('lotteryParticipantsInput').value = '';
  document.getElementById('lotteryPrizesInput').disabled = false;
  document.getElementById('lotteryParticipantsInput').disabled = false;
  document.getElementById('lotteryRuleSelect').disabled = false;
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

document.getElementById('menuSettingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsSubmitBtn').addEventListener('click', submitPasswordChange);

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
  if (taskName === '顧客提問') {
    const extra = {};
    if (val('ExtraSource')) extra['顧客來源'] = val('ExtraSource');
    if (val('ExtraCustomer')) extra['顧客名稱'] = val('ExtraCustomer');
    return Object.keys(extra).length ? extra : null;
  }
  if (taskName === '廠商選品') {
    const sel = val('ExtraVendor');
    const vendor = sel === '__other__' ? val('ExtraVendorOther') : sel;
    const extra = {};
    if (vendor) extra['廠商'] = vendor;
    if (val('ExtraUrl')) extra['選品網址'] = val('ExtraUrl');
    // 對應團購的 key（給行事曆公關品狀態同步用，不顯示在卡片摘要）
    const evKey = val('ExtraEvent');
    if (evKey) extra['團購key'] = evKey;
    return Object.keys(extra).length ? extra : null;
  }
  if (taskName === '團購安排') {
    return val('ExtraBrand') ? { '品牌或商品': val('ExtraBrand') } : null;
  }
  return null;
}

// 卡片上顯示的附加資訊小字（網址、內部key 太長或無意義就不放）
function extraSummary(task) {
  if (!task.extra) return '';
  return Object.keys(task.extra)
    .filter(k => k !== '選品網址' && k !== '團購key' && task.extra[k])
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
  nameLine.textContent = task.taskName || '';
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
  nameLine.textContent = task.taskName || '';
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
      `<span class="di-name">${escHtml(task.taskName || '')}${summary ? '<span style="color:#4a7fb5; font-size:11.5px;">（' + escHtml(summary) + '）</span>' : ''}${task.urgent ? ' 🚨' : ''}${task.date ? ' <span style="color:#a89888; font-size:11px;">📅 ' + escHtml(task.date) + '</span>' : ''}</span>` +
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
  document.getElementById('taskModalName').textContent = task.taskName || '';

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
    // 選品網址改用下方按鈕呈現，團購key 是內部用途，都不印成文字
    const keys = Object.keys(extra).filter(k => k !== '選品網址' && k !== '團購key' && extra[k]);
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
