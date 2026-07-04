// ============================================================
// memo.js — 「我的備忘錄」／「共用備忘錄」功能
// 依賴 admin.js 已經定義好的：postTask()、setFormStatus()、copyText()、
// currentUser、currentView、switchView()
//
// pnoteScope 有兩種：
//   'personal' → 只有自己看得到、只能動自己的資料
//   'shared'   → 全體員工共用同一份，任何人都能新增/編輯/刪除
// 兩種模式共用同一套畫面跟程式邏輯，只差在打給後端的 scope 參數不同
// ============================================================

let pnoteScope = 'personal';

// 每個 scope 各自保存自己的資料，切換時不用重新打 API
const pnoteFoldersByScope = { personal: [], shared: [] }; // [{id, name, parentFolderId}]
const pnoteNotesByScope = { personal: [], shared: [] };   // [{id, folderId, text, updatedAt}]
const pnoteLoadedByScope = { personal: false, shared: false };
const pnoteCurrentFolderByScope = { personal: '', shared: '' }; // '' 代表最上層

let pnoteExpandedIds = new Set(); // 目前展開成「可編輯」模式的備忘錄 id（切換資料夾/scope 時會清空，變回列表模式）

function pnoteFolders() { return pnoteFoldersByScope[pnoteScope]; }
function pnoteNotes() { return pnoteNotesByScope[pnoteScope]; }
function pnoteCurrentFolder() { return pnoteCurrentFolderByScope[pnoteScope]; }

// ---------- 讀取資料 ----------
async function loadPnoteData(force) {
  if (pnoteLoadedByScope[pnoteScope] && !force) {
    renderPnoteHeader();
    renderPnoteBreadcrumb();
    renderPnoteSubfolders();
    renderPnoteList();
    return;
  }
  setFormStatus('pnoteStatus', '載入中…', '');
  try {
    const result = await postTask({ type: 'pnote-list', scope: pnoteScope });
    pnoteFoldersByScope[pnoteScope] = Array.isArray(result.folders) ? result.folders : [];
    pnoteNotesByScope[pnoteScope] = Array.isArray(result.notes) ? result.notes : [];
    pnoteLoadedByScope[pnoteScope] = true;
    // 如果目前所在的資料夾已經不存在了（例如被刪除），退回最上層
    if (pnoteCurrentFolder() && !pnoteFolders().some(f => f.id === pnoteCurrentFolder())) {
      pnoteCurrentFolderByScope[pnoteScope] = '';
    }
    setFormStatus('pnoteStatus', '', '');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '備忘錄讀取失敗', 'error');
  }
  renderPnoteHeader();
  renderPnoteBreadcrumb();
  renderPnoteSubfolders();
  renderPnoteList();
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
  loadPnoteData(false);
}

// ---------- 麵包屑導覽 ----------
function pnoteFolderById(id) {
  return pnoteFolders().find(f => f.id === id) || null;
}

// 從目前資料夾往上一路找到根目錄，組成路徑陣列
function buildPnoteBreadcrumb() {
  const trail = [];
  let cursor = pnoteCurrentFolder();
  let guard = 0; // 避免萬一資料異常造成無窮迴圈
  while (cursor && guard < 50) {
    const f = pnoteFolderById(cursor);
    if (!f) break;
    trail.unshift(f);
    cursor = f.parentFolderId;
    guard++;
  }
  return trail;
}

function renderPnoteBreadcrumb() {
  const el = document.getElementById('pnoteBreadcrumb');
  const trail = buildPnoteBreadcrumb();
  const rootLabel = pnoteScope === 'shared' ? '共用備忘錄' : '全部';

  let html = `<button data-folder="">${escapeHtml(rootLabel)}</button>`;
  trail.forEach(f => {
    html += `<span class="pnote-crumb-sep">›</span><button data-folder="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`;
  });
  el.innerHTML = html;

  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => navigatePnoteFolder(btn.dataset.folder));
  });

  // 只有不在最上層時才能刪除「目前資料夾」
  const delBtn = document.getElementById('pnoteDeleteFolderBtn');
  if (delBtn) delBtn.style.display = pnoteCurrentFolder() ? 'inline-block' : 'none';
}

function navigatePnoteFolder(folderId) {
  pnoteCurrentFolderByScope[pnoteScope] = folderId || '';
  pnoteExpandedIds = new Set(); // 換資料夾時，備忘錄都收合回列表模式
  renderPnoteBreadcrumb();
  renderPnoteSubfolders();
  renderPnoteList();
}

// ---------- 子資料夾（像電腦檔案總管一樣，可以一直往下開） ----------
function renderPnoteSubfolders() {
  const el = document.getElementById('pnoteSubfolders');
  const children = pnoteFolders().filter(f => (f.parentFolderId || '') === pnoteCurrentFolder());

  if (!children.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = children.map(f =>
    `<span class="pnote-folder-item" data-folder="${escapeHtml(f.id)}">` +
    `📁 ${escapeHtml(f.name)}` +
    `<button class="pnote-folder-del" data-folder="${escapeHtml(f.id)}" title="刪除這個資料夾">✕</button>` +
    `</span>`
  ).join('');

  el.querySelectorAll('.pnote-folder-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.pnote-folder-del')) return; // 點到刪除鈕不要順便進去資料夾
      navigatePnoteFolder(item.dataset.folder);
    });
  });
  el.querySelectorAll('.pnote-folder-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePnoteFolderById(btn.dataset.folder);
    });
  });
}

// ---------- 備忘錄列表（預設列表模式，點了才展開變成可編輯） ----------
function renderPnoteList() {
  const list = document.getElementById('pnoteList');
  const notes = pnoteNotes()
    .filter(n => (n.folderId || '') === pnoteCurrentFolder())
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (!notes.length) {
    list.innerHTML = `<div class="task-empty">這裡還沒有備忘錄，點上面的「➕ 新增備忘錄」開始吧！</div>`;
    return;
  }

  list.innerHTML = notes.map(n => {
    if (pnoteExpandedIds.has(n.id)) {
      return renderPnoteExpandedCard(n);
    }
    return renderPnoteCollapsedRow(n);
  }).join('');

  list.querySelectorAll('.pnote-note-row').forEach(row => {
    row.addEventListener('click', () => {
      pnoteExpandedIds.add(row.dataset.id);
      renderPnoteList();
    });
  });
  list.querySelectorAll('.pnote-card-collapse').forEach(row => {
    row.addEventListener('click', () => {
      pnoteExpandedIds.delete(row.dataset.id);
      renderPnoteList();
    });
  });
  list.querySelectorAll('.pnote-btn-save').forEach(btn => {
    btn.addEventListener('click', () => savePnoteText(btn.dataset.id));
  });
  list.querySelectorAll('.pnote-btn-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = list.querySelector(`.pnote-textarea[data-id="${cssEscape(btn.dataset.id)}"]`);
      if (ta) copyText(ta.value, btn);
    });
  });
  list.querySelectorAll('.pnote-btn-delete').forEach(btn => {
    btn.addEventListener('click', () => deletePnote(btn.dataset.id));
  });
  list.querySelectorAll('.pnote-folder-select').forEach(sel => {
    sel.addEventListener('change', () => movePnoteToFolder(sel.dataset.id, sel.value));
  });
}

// 備忘錄標題：內容第一行，最多10個字，超過就截斷
function pnoteTitleOf(text) {
  const firstLine = String(text || '').split('\n')[0].trim();
  if (!firstLine) return '（空白備忘錄）';
  return firstLine.length > 10 ? firstLine.slice(0, 10) + '…' : firstLine;
}

function renderPnoteCollapsedRow(n) {
  return `
    <div class="pnote-note-row" data-id="${escapeHtml(n.id)}">
      <span class="pnote-arrow">▶</span>
      <span>${escapeHtml(pnoteTitleOf(n.text))}</span>
    </div>`;
}

function renderPnoteExpandedCard(n) {
  const folderOptions = [`<option value="">未分類（最上層）</option>`]
    .concat(buildPnoteFolderOptions(n.folderId))
    .join('');
  return `
    <div class="pnote-card" data-id="${escapeHtml(n.id)}">
      <div class="pnote-card-collapse" data-id="${escapeHtml(n.id)}">
        <span>▲ 收合</span>
      </div>
      <textarea class="pnote-textarea" data-id="${escapeHtml(n.id)}" placeholder="輸入要保存的文字內容…（第一行會當成標題）">${escapeHtml(n.text || '')}</textarea>
      <div class="pnote-card-row">
        <select class="pnote-folder-select" data-id="${escapeHtml(n.id)}">${folderOptions}</select>
        <div class="pnote-card-actions">
          <button class="pnote-btn pnote-btn-save" data-id="${escapeHtml(n.id)}">💾 儲存</button>
          <button class="pnote-btn pnote-btn-copy" data-id="${escapeHtml(n.id)}">📋 複製</button>
          <button class="pnote-btn pnote-btn-delete" data-id="${escapeHtml(n.id)}">🗑 刪除</button>
        </div>
      </div>
      <div class="pnote-card-status" id="pnoteCardStatus_${escapeHtml(n.id)}"></div>
    </div>`;
}

// 把整棵資料夾樹攤平成帶縮排的選項清單，方便在「搬移資料夾」下拉選單裡選任何一層
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
// querySelector 用的 id 值裡可能有特殊字元時的簡易跳脫
function cssEscape(str) {
  return String(str).replace(/(["\\])/g, '\\$1');
}

// ---------- 資料夾操作 ----------
async function addPnoteFolder() {
  const input = document.getElementById('pnoteNewFolderInput');
  const name = (input.value || '').trim();
  if (!name) {
    setFormStatus('pnoteStatus', '請先輸入資料夾名稱', 'error');
    return;
  }
  setFormStatus('pnoteStatus', '新增中…', '');
  try {
    const parentFolderId = pnoteCurrentFolder();
    const result = await postTask({ type: 'pnote-folder-add', scope: pnoteScope, name, parentFolderId });
    input.value = '';
    await loadPnoteData(true);
    if (result.folder && result.folder.id) {
      navigatePnoteFolder(result.folder.id);
    }
    setFormStatus('pnoteStatus', '資料夾已新增', 'ok');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '新增資料夾失敗', 'error');
  }
}

// 刪除「目前所在」的資料夾（麵包屑旁邊那個按鈕）
async function deleteCurrentPnoteFolder() {
  const folderId = pnoteCurrentFolder();
  if (!folderId) return;
  await deletePnoteFolderById(folderId, true);
}

// 刪除指定的資料夾（連同底下所有子資料夾一起刪除；裡面的備忘錄不會被刪，會變成未分類）
async function deletePnoteFolderById(folderId, isCurrent) {
  const folder = pnoteFolderById(folderId);
  const folderName = folder ? folder.name : '這個資料夾';
  if (!confirm(`確定要刪除資料夾「${folderName}」嗎？裡面的子資料夾也會一起刪除，但備忘錄內容不會被刪除，會變成未分類。`)) return;

  const parentFolderId = folder ? (folder.parentFolderId || '') : '';
  setFormStatus('pnoteStatus', '刪除中…', '');
  try {
    await postTask({ type: 'pnote-folder-delete', scope: pnoteScope, folderId });
    if (isCurrent || pnoteCurrentFolder() === folderId) {
      pnoteCurrentFolderByScope[pnoteScope] = parentFolderId;
    }
    await loadPnoteData(true);
    setFormStatus('pnoteStatus', '資料夾已刪除', 'ok');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '刪除資料夾失敗', 'error');
  }
}

// ---------- 備忘錄操作 ----------
async function addPnote() {
  setFormStatus('pnoteStatus', '新增中…', '');
  try {
    const folderId = pnoteCurrentFolder();
    const result = await postTask({ type: 'pnote-add', scope: pnoteScope, folderId, text: '' });
    await loadPnoteData(true);
    // 剛新增的備忘錄直接展開，方便馬上輸入內容
    if (result.note && result.note.id) pnoteExpandedIds.add(result.note.id);
    renderPnoteList();
    setFormStatus('pnoteStatus', '已新增一則空白備忘錄', 'ok');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '新增備忘錄失敗', 'error');
  }
}

async function savePnoteText(noteId) {
  const ta = document.querySelector(`.pnote-textarea[data-id="${cssEscape(noteId)}"]`);
  if (!ta) return;
  const statusEl = document.getElementById('pnoteCardStatus_' + noteId);
  if (statusEl) { statusEl.textContent = '儲存中…'; statusEl.className = 'pnote-card-status'; }
  try {
    await postTask({ type: 'pnote-update', scope: pnoteScope, noteId, text: ta.value });
    const local = pnoteNotes().find(n => n.id === noteId);
    if (local) local.text = ta.value;
    if (statusEl) { statusEl.textContent = '已儲存 ✅'; statusEl.className = 'pnote-card-status ok'; }
    // 儲存後保持展開，不會被打斷；但標題列表如果剛好在別的地方看，內容已經同步
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '儲存失敗'; statusEl.className = 'pnote-card-status error'; }
  }
}

async function movePnoteToFolder(noteId, folderId) {
  try {
    await postTask({ type: 'pnote-update', scope: pnoteScope, noteId, folderId });
    const local = pnoteNotes().find(n => n.id === noteId);
    if (local) local.folderId = folderId;
    // 搬到別的資料夾後，如果目前畫面看的是舊資料夾，這則備忘錄就該從畫面上消失
    renderPnoteList();
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '搬移資料夾失敗', 'error');
    await loadPnoteData(true);
  }
}

async function deletePnote(noteId) {
  if (!confirm('確定要刪除這則備忘錄嗎？刪除後無法復原。')) return;
  try {
    await postTask({ type: 'pnote-delete', scope: pnoteScope, noteId });
    pnoteNotesByScope[pnoteScope] = pnoteNotes().filter(n => n.id !== noteId);
    pnoteExpandedIds.delete(noteId);
    renderPnoteList();
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '刪除失敗', 'error');
  }
}

// ---------- 綁定按鈕 ----------
// 這支檔案是用 <script src> 放在 </body> 前面載入，此時整個頁面的 HTML
// 都已經存在了，所以跟 admin.js 一樣直接綁定即可，不需要等 DOMContentLoaded
document.getElementById('pnoteNewFolderBtn').addEventListener('click', addPnoteFolder);
document.getElementById('pnoteNewFolderInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPnoteFolder();
});
document.getElementById('pnoteDeleteFolderBtn').addEventListener('click', deleteCurrentPnoteFolder);
document.getElementById('pnoteAddBtn').addEventListener('click', addPnote);
document.getElementById('pnoteScopeToggleWrap').addEventListener('click', togglePnoteScope);
