// ============================================================
// memo.js — 「我的備忘錄」／「共用備忘錄」功能（樹狀結構版）
// 依賴 admin.js 已經定義好的：postTask()、setFormStatus()、copyText()、
// currentUser、currentView、switchView()
//
// pnoteScope 有兩種：
//   'personal' → 只有自己看得到、只能動自己的資料
//   'shared'   → 全體員工共用同一份，任何人都能新增/編輯/刪除
// 兩種模式共用同一套畫面跟程式邏輯，只差在打給後端的 scope 參數不同
//
// 版面說明：
//   - 資料夾用樹狀結構顯示，點資料夾列＝展開/收合（不會切換頁面）
//   - 資料夾右邊數字＝這個資料夾＋所有子資料夾裡的備忘錄總數
//   - 每個資料夾展開後，先顯示子資料夾，再顯示這個資料夾自己的備忘錄
//   - 桌面版（寬度>860px）：左側樹狀列表、右側編輯器，同時顯示
//   - 手機版（寬度<=860px）：點備忘錄後切到全螢幕編輯器，左上角有「返回列表」
//   - 上方搜尋欄：搜尋備忘錄內容文字，不分資料夾，結果會標示所在資料夾路徑
//   - 新增資料夾改成右上角圖示點擊後跳出浮動視窗，不佔用版面空間
// ============================================================

let pnoteScope = 'personal';

// 每個 scope 各自保存自己的資料，切換時不用重新打 API
const pnoteFoldersByScope = { personal: [], shared: [] }; // [{id, name, parentFolderId}]
const pnoteNotesByScope = { personal: [], shared: [] };   // [{id, folderId, text, updatedAt}]
const pnoteLoadedByScope = { personal: false, shared: false };

let pnoteExpandedIds = new Set(); // 目前展開中的資料夾 id（樹狀結構用）
let pnoteSelectedNoteId = null;   // 目前在編輯器裡打開的備忘錄 id
let pnoteSearchTerm = '';         // 搜尋關鍵字（非空時樹狀圖會換成搜尋結果列表）

function pnoteFolders() { return pnoteFoldersByScope[pnoteScope]; }
function pnoteNotes() { return pnoteNotesByScope[pnoteScope]; }

// ---------- 讀取資料 ----------
async function loadPnoteData(force) {
  if (pnoteLoadedByScope[pnoteScope] && !force) {
    renderPnoteHeader();
    renderMtree();
    renderEditor();
    return;
  }
  try {
    const result = await postTask({ type: 'pnote-list', scope: pnoteScope });
    pnoteFoldersByScope[pnoteScope] = Array.isArray(result.folders) ? result.folders : [];
    pnoteNotesByScope[pnoteScope] = Array.isArray(result.notes) ? result.notes : [];
    pnoteLoadedByScope[pnoteScope] = true;
    // 如果目前編輯器打開的那則備忘錄已經不存在了（例如被刪除），清空選取
    if (pnoteSelectedNoteId && !pnoteNotes().some(n => n.id === pnoteSelectedNoteId)) {
      pnoteSelectedNoteId = null;
    }
  } catch (err) {
    console.warn('備忘錄讀取失敗：', err);
  }
  renderPnoteHeader();
  renderMtree();
  renderEditor();
}

// ---------- 標題／說明文字／切換鈕 ----------
function renderPnoteHeader() {
  const isShared = pnoteScope === 'shared';
  document.getElementById('pnoteViewTitle').textContent = isShared ? '共用備忘錄' : '我的備忘錄';
  document.getElementById('pnoteHint').textContent = isShared
    ? '這裡的資料夾與備忘錄大家共用，任何員工都可以新增、編輯或刪除。'
    : '只有你自己看得到這裡的資料夾與備忘錄，適合放常常要複製貼上的文字片段。';
  document.getElementById('pnoteScopeLabel').textContent = isShared ? '共用' : '個人';
  document.getElementById('pnoteScopeSwitch').classList.toggle('on', isShared);
}

function togglePnoteScope() {
  pnoteScope = pnoteScope === 'personal' ? 'shared' : 'personal';
  pnoteExpandedIds = new Set();
  pnoteSelectedNoteId = null;
  pnoteSearchTerm = '';
  document.getElementById('pnoteSearchInput').value = '';
  document.getElementById('mtreeWrap').classList.remove('show-editor');
  loadPnoteData(false);
}

// ---------- 小工具 ----------
function pnoteFolderById(id) {
  return pnoteFolders().find(f => f.id === id) || null;
}

// 遞迴計算「這個資料夾＋所有子資料夾」裡的備忘錄總數
function pnoteFolderNoteCount(folderId) {
  let count = pnoteNotes().filter(n => (n.folderId || '') === folderId).length;
  pnoteFolders().filter(f => (f.parentFolderId || '') === folderId).forEach(f => {
    count += pnoteFolderNoteCount(f.id);
  });
  return count;
}

// 從某個資料夾往上一路找到根目錄，組成「A › B › C」的路徑字串（搜尋結果用）
function pnoteFolderPath(folderId) {
  if (!folderId) return '未分類';
  const trail = [];
  let cursor = folderId;
  let guard = 0;
  while (cursor && guard < 50) {
    const f = pnoteFolderById(cursor);
    if (!f) break;
    trail.unshift(f.name);
    cursor = f.parentFolderId;
    guard++;
  }
  return trail.length ? trail.join(' › ') : '未分類';
}

// 備忘錄標題：內容第一行，最多10個字，超過就截斷
function pnoteTitleOf(text) {
  const firstLine = String(text || '').split('\n')[0].trim();
  if (!firstLine) return '（空白備忘錄）';
  return firstLine.length > 10 ? firstLine.slice(0, 10) + '…' : firstLine;
}

// 把整棵資料夾樹攤平成帶縮排的選項清單，方便在下拉選單裡選任何一層
function buildPnoteFolderOptions(selectedFolderId) {
  const folders = pnoteFolders();
  const options = [];
  function walk(parentId, depth) {
    folders.filter(f => (f.parentFolderId || '') === parentId).forEach(f => {
      const indent = '　'.repeat(depth); // 全形空白縮排，中文對齊比較好看
      options.push(
        `<option value="${escapeHtml(f.id)}"${f.id === selectedFolderId ? ' selected' : ''}>${indent}📁 ${escapeHtml(f.name)}</option>`
      );
      walk(f.id, depth + 1);
    });
  }
  walk('', 0);
  return options;
}

// 小工具：避免使用者輸入的文字或名稱裡有特殊字元把 HTML 弄壞
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- 樹狀結構渲染 ----------
function renderMtree() {
  if (pnoteSearchTerm.trim()) {
    renderSearchResults();
  } else {
    const html = renderTreeLevel('');
    document.getElementById('mtreeTree').innerHTML = html ||
      '<div class="task-empty">這裡還沒有資料夾或備忘錄，點上面的圖示新增吧！</div>';
  }
  bindTreeEvents();
}

// 遞迴渲染某一層：先列出這一層的資料夾（依名稱排序），展開的資料夾會遞迴渲染子層，
// 最後列出「屬於這一層本身」的備忘錄（未分類的備忘錄會出現在根目錄這一層的最後面）
function renderTreeLevel(parentId) {
  const folders = pnoteFolders()
    .filter(f => (f.parentFolderId || '') === parentId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const notes = pnoteNotes()
    .filter(n => (n.folderId || '') === parentId)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  let html = '';
  folders.forEach(f => {
    const open = pnoteExpandedIds.has(f.id);
    const count = pnoteFolderNoteCount(f.id);
    html += `
      <div class="mtree-node">
        <div class="mtree-folder-row" data-folder="${escapeHtml(f.id)}">
          <span class="mtree-arrow">${open ? '▼' : '▶'}</span>
          <span class="mtree-folder-icon">📁</span>
          <span class="mtree-folder-name">${escapeHtml(f.name)}</span>
          <span class="mtree-folder-count">${count}</span>
          <button class="mtree-folder-add" data-folder="${escapeHtml(f.id)}" title="在這個資料夾新增備忘錄">📝+</button>
          <button class="mtree-folder-del" data-folder="${escapeHtml(f.id)}" title="刪除這個資料夾">✕</button>
        </div>
        ${open ? `<div class="mtree-children">${renderTreeLevel(f.id)}</div>` : ''}
      </div>`;
  });
  notes.forEach(n => {
    const active = n.id === pnoteSelectedNoteId;
    html += `
      <div class="mtree-note-row${active ? ' active' : ''}" data-note="${escapeHtml(n.id)}">
        <span class="mtree-note-icon">📝</span>
        <span class="mtree-note-title">${escapeHtml(pnoteTitleOf(n.text))}</span>
      </div>`;
  });
  return html;
}

// 搜尋模式：不分資料夾，列出所有內容符合關鍵字的備忘錄，並標示所在資料夾路徑
function renderSearchResults() {
  const term = pnoteSearchTerm.trim().toLowerCase();
  const matches = pnoteNotes().filter(n => (n.text || '').toLowerCase().includes(term));
  const el = document.getElementById('mtreeTree');
  if (!matches.length) {
    el.innerHTML = '<div class="task-empty">找不到符合的備忘錄</div>';
    return;
  }
  matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  el.innerHTML = matches.map(n => {
    const active = n.id === pnoteSelectedNoteId;
    return `
      <div class="mtree-note-row${active ? ' active' : ''}" data-note="${escapeHtml(n.id)}">
        <span class="mtree-note-icon">📝</span>
        <span class="mtree-note-title">${escapeHtml(pnoteTitleOf(n.text))}</span>
        <span class="mtree-search-path">${escapeHtml(pnoteFolderPath(n.folderId))}</span>
      </div>`;
  }).join('');
}

// 事件用委派方式綁定（每次重繪都要重新綁）
function bindTreeEvents() {
  const el = document.getElementById('mtreeTree');
  el.querySelectorAll('.mtree-folder-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.mtree-folder-add') || e.target.closest('.mtree-folder-del')) return;
      const id = row.dataset.folder;
      if (pnoteExpandedIds.has(id)) pnoteExpandedIds.delete(id); else pnoteExpandedIds.add(id);
      renderMtree();
    });
  });
  el.querySelectorAll('.mtree-folder-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      quickAddNoteToFolder(btn.dataset.folder);
    });
  });
  el.querySelectorAll('.mtree-folder-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePnoteFolderById(btn.dataset.folder);
    });
  });
  el.querySelectorAll('.mtree-note-row').forEach(row => {
    row.addEventListener('click', () => openNoteInEditor(row.dataset.note));
  });
}

// ---------- 搜尋欄 ----------
document.getElementById('pnoteSearchInput').addEventListener('input', (e) => {
  pnoteSearchTerm = e.target.value;
  renderMtree();
});

// ---------- 開啟備忘錄到編輯器（桌面：右側面板／手機：切換全螢幕） ----------
function openNoteInEditor(id) {
  pnoteSelectedNoteId = id;
  renderEditor();
  renderMtree(); // 更新選取中的高亮
  document.getElementById('mtreeWrap').classList.add('show-editor'); // 手機版切到編輯畫面；桌面版CSS會忽略這個class
}

document.getElementById('mtreeBackBtn').addEventListener('click', () => {
  document.getElementById('mtreeWrap').classList.remove('show-editor');
});

// ---------- 編輯器面板 ----------
function renderEditor() {
  const body = document.getElementById('mtreeEditorBody');
  if (!pnoteSelectedNoteId) {
    body.innerHTML = '<div class="task-empty">請選擇一則備忘錄，或點上方「📝＋」新增一則</div>';
    return;
  }
  const note = pnoteNotes().find(n => n.id === pnoteSelectedNoteId);
  if (!note) {
    pnoteSelectedNoteId = null;
    body.innerHTML = '<div class="task-empty">這則備忘錄已經不存在了</div>';
    return;
  }
  const folderOptions = [`<option value="">未分類（最上層）</option>`]
    .concat(buildPnoteFolderOptions(note.folderId))
    .join('');
  body.innerHTML = `
    <textarea class="pnote-textarea" id="mtreeTextarea" placeholder="輸入要保存的文字內容…（第一行會當成標題）">${escapeHtml(note.text || '')}</textarea>
    <div class="pnote-card-row">
      <select class="pnote-folder-select" id="mtreeFolderSelect">${folderOptions}</select>
      <div class="pnote-card-actions">
        <button class="pnote-btn pnote-btn-save" id="mtreeSaveBtn">💾 儲存</button>
        <button class="pnote-btn pnote-btn-copy" id="mtreeCopyBtn">📋 複製</button>
        <button class="pnote-btn pnote-btn-delete" id="mtreeDeleteBtn">🗑 刪除</button>
      </div>
    </div>
    <div class="pnote-card-status" id="mtreeCardStatus"></div>
  `;
  document.getElementById('mtreeSaveBtn').addEventListener('click', saveMtreeNote);
  document.getElementById('mtreeCopyBtn').addEventListener('click', (e) => {
    copyText(document.getElementById('mtreeTextarea').value, e.currentTarget);
  });
  document.getElementById('mtreeDeleteBtn').addEventListener('click', deleteMtreeNote);
  document.getElementById('mtreeFolderSelect').addEventListener('change', moveMtreeNote);
}

async function saveMtreeNote() {
  if (!pnoteSelectedNoteId) return;
  const ta = document.getElementById('mtreeTextarea');
  const statusEl = document.getElementById('mtreeCardStatus');
  if (statusEl) { statusEl.textContent = '儲存中…'; statusEl.className = 'pnote-card-status'; }
  try {
    await postTask({ type: 'pnote-update', scope: pnoteScope, noteId: pnoteSelectedNoteId, text: ta.value });
    const local = pnoteNotes().find(n => n.id === pnoteSelectedNoteId);
    if (local) local.text = ta.value;
    if (statusEl) { statusEl.textContent = '已儲存 ✅'; statusEl.className = 'pnote-card-status ok'; }
    renderMtree(); // 標題可能變了（取第一行），樹狀列表要跟著更新
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '儲存失敗'; statusEl.className = 'pnote-card-status error'; }
  }
}

async function moveMtreeNote() {
  if (!pnoteSelectedNoteId) return;
  const sel = document.getElementById('mtreeFolderSelect');
  const folderId = sel.value;
  try {
    await postTask({ type: 'pnote-update', scope: pnoteScope, noteId: pnoteSelectedNoteId, folderId });
    const local = pnoteNotes().find(n => n.id === pnoteSelectedNoteId);
    if (local) local.folderId = folderId;
    // 搬去別的資料夾後，確保該資料夾是展開的，這樣才看得到剛搬進去的備忘錄
    if (folderId) pnoteExpandedIds.add(folderId);
    renderMtree();
  } catch (err) {
    const statusEl = document.getElementById('mtreeCardStatus');
    if (statusEl) { statusEl.textContent = err.message || '搬移資料夾失敗'; statusEl.className = 'pnote-card-status error'; }
    await loadPnoteData(true);
  }
}

async function deleteMtreeNote() {
  if (!pnoteSelectedNoteId) return;
  if (!confirm('確定要刪除這則備忘錄嗎？刪除後無法復原。')) return;
  const id = pnoteSelectedNoteId;
  try {
    await postTask({ type: 'pnote-delete', scope: pnoteScope, noteId: id });
    pnoteNotesByScope[pnoteScope] = pnoteNotes().filter(n => n.id !== id);
    pnoteSelectedNoteId = null;
    document.getElementById('mtreeWrap').classList.remove('show-editor');
    renderMtree();
    renderEditor();
  } catch (err) {
    alert(err.message || '刪除失敗');
  }
}

// ---------- 新增備忘錄（直接加進指定資料夾，並立刻打開編輯器） ----------
async function quickAddNoteToFolder(folderId) {
  try {
    const result = await postTask({ type: 'pnote-add', scope: pnoteScope, folderId, text: '' });
    await loadPnoteData(true);
    if (folderId) pnoteExpandedIds.add(folderId); // 確保該資料夾展開，才能在樹狀圖看到新備忘錄
    if (result.note && result.note.id) openNoteInEditor(result.note.id);
  } catch (err) {
    alert('新增備忘錄失敗：' + err.message);
  }
}

// 上方工具列的「📝＋」：新增到最上層（未分類），之後可以用編輯器裡的下拉選單搬到想要的資料夾
document.getElementById('pnoteAddNoteBtn').addEventListener('click', () => quickAddNoteToFolder(''));

// ---------- 資料夾操作 ----------
// 刪除指定的資料夾（連同底下所有子資料夾一起刪除；裡面的備忘錄不會被刪，會變成未分類）
async function deletePnoteFolderById(folderId) {
  const folder = pnoteFolderById(folderId);
  const folderName = folder ? folder.name : '這個資料夾';
  if (!confirm(`確定要刪除資料夾「${folderName}」嗎？裡面的子資料夾也會一起刪除，但備忘錄內容不會被刪除，會變成未分類。`)) return;
  try {
    await postTask({ type: 'pnote-folder-delete', scope: pnoteScope, folderId });
    pnoteExpandedIds.delete(folderId);
    await loadPnoteData(true);
  } catch (err) {
    alert(err.message || '刪除資料夾失敗');
  }
}

// ---------- 新增資料夾浮動視窗 ----------
function openPnoteFolderModal() {
  document.getElementById('pnoteFolderNameInput').value = '';
  const sel = document.getElementById('pnoteFolderParentSelect');
  sel.innerHTML = '<option value="">最上層（不放進任何資料夾）</option>' + buildPnoteFolderOptions('');
  setFormStatus('pnoteFolderModalStatus', '', '');
  document.getElementById('pnoteFolderModal').classList.add('show');
  document.getElementById('pnoteFolderNameInput').focus();
}

function closePnoteFolderModal() {
  document.getElementById('pnoteFolderModal').classList.remove('show');
}

async function submitPnoteFolderModal() {
  const name = document.getElementById('pnoteFolderNameInput').value.trim();
  if (!name) {
    setFormStatus('pnoteFolderModalStatus', '請輸入資料夾名稱', 'error');
    return;
  }
  const parentFolderId = document.getElementById('pnoteFolderParentSelect').value;
  const btn = document.getElementById('pnoteFolderModalSubmitBtn');
  btn.disabled = true;
  setFormStatus('pnoteFolderModalStatus', '新增中…', '');
  try {
    await postTask({ type: 'pnote-folder-add', scope: pnoteScope, name, parentFolderId });
    await loadPnoteData(true);
    if (parentFolderId) pnoteExpandedIds.add(parentFolderId);
    renderMtree();
    closePnoteFolderModal();
  } catch (err) {
    setFormStatus('pnoteFolderModalStatus', err.message || '新增資料夾失敗', 'error');
  }
  btn.disabled = false;
}

document.getElementById('pnoteAddFolderBtn').addEventListener('click', openPnoteFolderModal);
document.getElementById('pnoteFolderModalSubmitBtn').addEventListener('click', submitPnoteFolderModal);
document.getElementById('pnoteFolderNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPnoteFolderModal();
});

// ---------- 綁定 scope 切換 ----------
document.getElementById('pnoteScopeToggleWrap').addEventListener('click', togglePnoteScope);
