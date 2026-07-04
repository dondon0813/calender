// ============================================================
// memo.js — 「我的備忘錄」功能
// 依賴 admin.js 已經定義好的：postTask()、setFormStatus()、copyText()、
// currentUser、currentView、switchView()
// 每位登入的員工只會看到／異動自己的資料夾與備忘錄（後端依 token 對應的姓名做區隔）
// ============================================================

let pnoteFolders = [];        // [{ id, name }]
let pnoteNotes = [];          // [{ id, folderId, text, updatedAt }]
let currentPnoteFolder = 'all'; // 'all' 或某個資料夾 id
let pnoteLoaded = false;      // 是否已經跟後端拿過一次資料，避免每次切頁都重打

// ---------- 讀取資料 ----------
async function loadPnoteData(force) {
  if (pnoteLoaded && !force) {
    renderPnoteFolderBar();
    renderPnoteList();
    return;
  }
  setFormStatus('pnoteStatus', '載入中…', '');
  try {
    const result = await postTask({ type: 'pnote-list' });
    pnoteFolders = Array.isArray(result.folders) ? result.folders : [];
    pnoteNotes = Array.isArray(result.notes) ? result.notes : [];
    pnoteLoaded = true;
    if (currentPnoteFolder !== 'all' && !pnoteFolders.some(f => f.id === currentPnoteFolder)) {
      currentPnoteFolder = 'all';
    }
    setFormStatus('pnoteStatus', '', '');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '備忘錄讀取失敗', 'error');
  }
  renderPnoteFolderBar();
  renderPnoteList();
}

// ---------- 畫面渲染 ----------
function renderPnoteFolderBar() {
  const bar = document.getElementById('pnoteFolderBar');
  if (!bar) return;
  let html = `<button class="pnote-chip${currentPnoteFolder === 'all' ? ' active' : ''}" data-folder="all">全部</button>`;
  pnoteFolders.forEach(f => {
    html += `<button class="pnote-chip${currentPnoteFolder === f.id ? ' active' : ''}" data-folder="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`;
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.pnote-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentPnoteFolder = chip.dataset.folder === 'all' ? 'all' : chip.dataset.folder;
      renderPnoteFolderBar();
      renderPnoteList();
    });
  });

  // 「刪除這個資料夾」按鈕：只有選到特定資料夾時才顯示
  const delBtn = document.getElementById('pnoteDeleteFolderBtn');
  if (delBtn) {
    delBtn.style.display = currentPnoteFolder === 'all' ? 'none' : 'inline-block';
  }
}

function renderPnoteList() {
  const list = document.getElementById('pnoteList');
  if (!list) return;

  const notes = pnoteNotes
    .filter(n => currentPnoteFolder === 'all' || n.folderId === currentPnoteFolder)
    .slice()
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (!notes.length) {
    list.innerHTML = `<div class="task-empty">這裡還沒有備忘錄，點上面的「➕ 新增備忘錄」開始吧！</div>`;
    return;
  }

  list.innerHTML = notes.map(n => {
    const folderOptions = [`<option value="">未分類</option>`]
      .concat(pnoteFolders.map(f => `<option value="${escapeHtml(f.id)}"${f.id === n.folderId ? ' selected' : ''}>${escapeHtml(f.name)}</option>`))
      .join('');
    return `
      <div class="pnote-card" data-id="${escapeHtml(n.id)}">
        <textarea class="pnote-textarea" data-id="${escapeHtml(n.id)}" placeholder="輸入要保存的文字內容…">${escapeHtml(n.text || '')}</textarea>
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
  }).join('');

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
    const result = await postTask({ type: 'pnote-folder-add', name });
    input.value = '';
    await loadPnoteData(true);
    if (result.folder && result.folder.id) currentPnoteFolder = result.folder.id;
    renderPnoteFolderBar();
    renderPnoteList();
    setFormStatus('pnoteStatus', '資料夾已新增', 'ok');
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '新增資料夾失敗', 'error');
  }
}

async function deleteCurrentPnoteFolder() {
  if (currentPnoteFolder === 'all') return;
  const folder = pnoteFolders.find(f => f.id === currentPnoteFolder);
  const folderName = folder ? folder.name : '這個資料夾';
  if (!confirm(`確定要刪除資料夾「${folderName}」嗎？裡面的備忘錄會變成未分類，不會被刪除。`)) return;
  setFormStatus('pnoteStatus', '刪除中…', '');
  try {
    await postTask({ type: 'pnote-folder-delete', folderId: currentPnoteFolder });
    currentPnoteFolder = 'all';
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
    const folderId = currentPnoteFolder === 'all' ? '' : currentPnoteFolder;
    await postTask({ type: 'pnote-add', folderId, text: '' });
    await loadPnoteData(true);
    setFormStatus('pnoteStatus', '已新增一則空白備忘錄，寫完記得按「儲存」', 'ok');
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
    await postTask({ type: 'pnote-update', noteId, text: ta.value });
    const local = pnoteNotes.find(n => n.id === noteId);
    if (local) local.text = ta.value;
    if (statusEl) { statusEl.textContent = '已儲存 ✅'; statusEl.className = 'pnote-card-status ok'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message || '儲存失敗'; statusEl.className = 'pnote-card-status error'; }
  }
}

async function movePnoteToFolder(noteId, folderId) {
  try {
    await postTask({ type: 'pnote-update', noteId, folderId });
    const local = pnoteNotes.find(n => n.id === noteId);
    if (local) local.folderId = folderId;
    if (currentPnoteFolder !== 'all') renderPnoteList(); // 換資料夾後可能要從目前清單消失
  } catch (err) {
    setFormStatus('pnoteStatus', err.message || '搬移資料夾失敗', 'error');
    await loadPnoteData(true);
  }
}

async function deletePnote(noteId) {
  if (!confirm('確定要刪除這則備忘錄嗎？刪除後無法復原。')) return;
  try {
    await postTask({ type: 'pnote-delete', noteId });
    pnoteNotes = pnoteNotes.filter(n => n.id !== noteId);
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
