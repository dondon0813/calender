// ===================================================================
// todoList.js — 待辦事項：分組清單、編輯彈窗、加入行事曆
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('todoList')
// → renderTodoGroups()；本檔若排在後面，開機當下函式還不存在，整頁變磚。
//
// 資料層歸屬：todos / todoCategories 的宣告與寫入都在 admin.js（loadData 的
// 回應處理），本檔只讀。本檔最外層只有「宣告」與「DOM 事件掛載」，
// 執行期依賴 admin.js 的全域：todos、todoCategories、postTask、loadData、
// escHtml、setFormStatus 等——都在事件/函式內才會被讀到，載入順序安全。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放檔案最前段） -----
let todoEditCtx = null; // { isNew, todo }
let selectedTodoPriority = '中';
const TODO_BRAND_CATEGORY = '團購合作'; // 這個主選項用品牌＋合作階段，其他主選項用標題＋內容
const TODO_PRIORITY_LIST = ['高', '中', '低', '不追'];
const TODO_PRIORITY_COLOR = { '高': '#FFDCD8', '中': '#FFE8D2', '低': '#E4F5DF', '不追': '#EFEBE5' };
const TODO_PRIORITY_TEXT_COLOR = { '高': '#C0392B', '中': '#B5601C', '低': '#4f7a3a', '不追': '#7A7166' };

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
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim());
  if (!m) return currentMonthKey().replace('-', '年') + '月'; // 【修復】格式異常時退回顯示當月，不再出現 NaN年undefined月
  return `${Number(m[1])}年${Number(m[2])}月`;
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
    upsertLocalTodo_(result.id, fields);
    return result.id;
  }
  const id = todoEditCtx.todo.id;
  await postTask(Object.assign({ type: 'todo-update', id }, fields));
  upsertLocalTodo_(id, fields);
  return id;
}

// 後端確認成功後，把這筆同步進本地 todos 陣列（畫面即時更新用，不等慢速的整份重抓）
function upsertLocalTodo_(id, fields) {
  const existing = todos.find(t => t.id === id);
  if (existing) {
    Object.assign(existing, fields);
  } else {
    todos.push(Object.assign({ id: id, addedToCalendar: false }, fields));
  }
}

document.getElementById('todoAddBtn').addEventListener('click', () => openTodoEditModal(null));

document.getElementById('todoSaveBtn').addEventListener('click', async () => {
  if (!todoEditCtx) return;
  const btn = document.getElementById('todoSaveBtn');
  btn.disabled = true;
  setFormStatus('todoEditStatus', '儲存中…', '');
  try {
    await collectAndSaveTodo_();
    // collectAndSaveTodo_ 已把這筆同步進本地清單：立刻重畫，不等慢速的整份重抓
    closeTodoEditModal();
    renderTodoGroups();
    fetchMemos(); // 背景同步校正，不 await
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
    const delId = todoEditCtx.todo.id;
    await postTask({ type: 'todo-delete', id: delId });
    // 後端已確認刪除：立刻從本地清單移除並重畫，不等慢速的整份重抓（那要好幾秒，看起來像沒反應）
    todos = todos.filter(t => t.id !== delId);
    closeTodoEditModal();
    renderTodoGroups();
    fetchMemos(); // 背景同步校正，不 await
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
    const localTodo = todos.find(t => t.id === id);
    if (localTodo) localTodo.addedToCalendar = true; // 本地同步旗標，畫面即時反應
    document.getElementById('todoAddedToCalendarNote').style.display = 'block';
    btn.style.display = 'none';
    setFormStatus('todoEditStatus', '已新增至行事曆 ✓ 記得之後到行事曆編輯模式按「確認顯示於前台」', 'ok');
    renderTodoGroups();
    fetchMemos(); // 背景同步校正，不 await
    if (typeof loadData === 'function') loadData();
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
        delBtn.disabled = true;
        delBtn.textContent = '刪除中…'; // 後端要幾秒，沒有提示會看起來像沒反應
        try {
          await postTask({ type: 'todo-delete', id: t.id });
          // 後端已確認刪除：立刻從本地清單移除並重畫，不等慢速的整份重抓
          todos = todos.filter(x => x.id !== t.id);
          renderTodoGroups();
          fetchMemos(); // 背景同步校正，不 await
        } catch (err) {
          delBtn.disabled = false;
          delBtn.textContent = '🗑 刪除';
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

