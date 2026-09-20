// ===================================================================
// changelog.js — 雪莉更新日誌（官網育兒小幫手首頁 recipes.html 的「📣 雪莉更新日誌」）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 subscriptions.js）。
// 理由：admin.js 開機還原分頁時會同步呼叫 switchView，若分頁剛好停在 changelog、
// 本檔卻排在後面，loadChangelogView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」；跟 admin.js 共用的只有全域 currentToken 與共用 DOM。
//
// 資料：後端 site_changelogs（一條＝一列），一天一批、一行一條整批覆蓋（changelog-day-set）。
// 前台只顯示最新 5 條（日期新→舊，同一天照這裡打字的上下順序）。
// ===================================================================

const CHANGELOG_API_URL = 'https://dondon-platform.vercel.app/api/legacy';
const CHANGELOG_PUBLIC_LIMIT = 5; // 必須與後端 lib/legacy/changelog.ts PUBLIC_LIMIT 一致

let CHANGELOG_LOADED = false;   // 第一次進分頁才拉，之後切回來用快取；「重新整理」強制重拉
let CHANGELOG_DAYS = [];        // [{date:'YYYY-MM-DD', lines:[...]}]，日期新→舊
let CHANGELOG_DIRTY = false;    // 文字框有沒有未儲存的修改（換日期前提醒）

function clEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clDateLabel(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  const week = '日一二三四五六'[d.getDay()];
  const label = `${p[0]}/${p[1]}/${p[2]}（${week}）`;
  return dateStr === clTodayStr() ? `今天 ${label}` : label;
}

// 登入逾時：同 subscriptions.js 的 csForceRelogin
function clForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

async function clApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(CHANGELOG_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    clForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

function clSetStatus(text, isError) {
  const el = document.getElementById('changelogStatus');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? 'var(--c-danger, #B5485A)' : '';
}

/** 把選定日期那天已存的內容帶進文字框 */
function clFillFormFromDate() {
  const date = document.getElementById('changelogDate').value;
  const day = CHANGELOG_DAYS.find(d => d.date === date);
  document.getElementById('changelogLines').value = day ? day.lines.join('\n') : '';
  CHANGELOG_DIRTY = false;
  clSetStatus(day ? `這天已有 ${day.lines.length} 條，可以直接改` : '');
}

async function loadChangelogView(force) {
  const dateEl = document.getElementById('changelogDate');
  const listArea = document.getElementById('changelogListArea');
  if (!dateEl || !listArea) return;
  if (!dateEl.value) dateEl.value = clTodayStr();
  if (CHANGELOG_LOADED && !force) { renderChangelogList(); return; }
  listArea.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const data = await clApiPost('changelog-list');
    if (!data.success) {
      listArea.innerHTML = `<div class="task-empty">${clEscapeHtml(data.error || '讀取失敗')}</div>`;
      return;
    }
    document.getElementById('changelogNotReady').style.display = data.tableReady === false ? 'block' : 'none';
    CHANGELOG_DAYS = data.days || [];
    CHANGELOG_LOADED = true;
    if (!CHANGELOG_DIRTY) clFillFormFromDate();
    renderChangelogList();
  } catch (err) {
    listArea.innerHTML = `<div class="task-empty">${clEscapeHtml(err.message || '讀取失敗')}</div>`;
  }
}

function renderChangelogList() {
  const listArea = document.getElementById('changelogListArea');
  if (!CHANGELOG_DAYS.length) {
    listArea.innerHTML = '<div class="task-empty">還沒有任何更新日誌</div>';
    return;
  }
  let shown = 0; // 前台只顯示最新 5 條：依序數到第 5 條為止都標「前台顯示中」
  listArea.innerHTML = CHANGELOG_DAYS.map(day => {
    const items = day.lines.map(line => {
      const onFront = shown < CHANGELOG_PUBLIC_LIMIT;
      shown++;
      return `<li style="padding:4px 0; line-height:1.6;">${clEscapeHtml(line)}${onFront ? ' <span style="font-size:11px; font-weight:700; color:#8B6E5E; background:#F3E3E1; border-radius:999px; padding:1px 7px; white-space:nowrap;">前台顯示中</span>' : ''}</li>`;
    }).join('');
    return `
      <div style="background:#fff; border:1px solid #E6DCD2; border-radius:12px; padding:10px 14px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <strong style="flex:1; min-width:140px;">${clEscapeHtml(clDateLabel(day.date))}</strong>
          <button class="task-mini-btn" data-cl-edit="${clEscapeHtml(day.date)}">✏️ 編輯</button>
          <button class="task-mini-btn danger" data-cl-delete="${clEscapeHtml(day.date)}">🗑 刪除這天</button>
        </div>
        <ul style="margin:6px 0 0; padding-left:20px;">${items}</ul>
      </div>`;
  }).join('');
}

async function clSaveDay(date, linesText) {
  const btn = document.getElementById('changelogSaveBtn');
  btn.disabled = true;
  clSetStatus('儲存中…');
  try {
    const data = await clApiPost('changelog-day-set', { date, lines: linesText });
    if (!data.success) { clSetStatus(data.error || '儲存失敗', true); return false; }
    CHANGELOG_DIRTY = false;
    await loadChangelogView(true);
    clSetStatus(data.lines && data.lines.length ? `✅ 已儲存 ${data.lines.length} 條` : '✅ 已刪除這天的日誌');
    return true;
  } catch (err) {
    clSetStatus(err.message || '儲存失敗', true);
    return false;
  } finally {
    btn.disabled = false;
  }
}

// ===== DOM 事件掛載 =====
document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('changelogDate');
  const linesEl = document.getElementById('changelogLines');
  if (!dateEl || !linesEl) return;

  let prevDate = dateEl.value;
  dateEl.addEventListener('focus', () => { prevDate = dateEl.value; });
  dateEl.addEventListener('change', () => {
    if (CHANGELOG_DIRTY && !confirm('文字框有還沒儲存的修改，換日期會被蓋掉，確定要換嗎？')) {
      dateEl.value = prevDate;
      return;
    }
    prevDate = dateEl.value;
    clFillFormFromDate();
  });
  linesEl.addEventListener('input', () => { CHANGELOG_DIRTY = true; });

  document.getElementById('changelogTodayBtn').addEventListener('click', () => {
    if (dateEl.value === clTodayStr()) return;
    if (CHANGELOG_DIRTY && !confirm('文字框有還沒儲存的修改，換日期會被蓋掉，確定要換嗎？')) return;
    dateEl.value = clTodayStr();
    prevDate = dateEl.value;
    clFillFormFromDate();
  });

  document.getElementById('changelogSaveBtn').addEventListener('click', async () => {
    const date = dateEl.value;
    if (!date) { clSetStatus('請先選日期', true); return; }
    const saveBtn = document.getElementById('changelogSaveBtn');
    const newLines = linesEl.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // 覆蓋保護（2026-09-17 雪莉誤蓋 9/16 日誌後加）：存檔前重抓資料庫「這天現在的內容」，
    // 不信任畫面快取（可能是其他分頁／其他人剛存過）；只要有舊條目會被拿掉就逐條列出來確認。
    saveBtn.disabled = true;
    clSetStatus('確認這天目前內容…');
    let serverLines;
    try {
      const data = await clApiPost('changelog-list');
      if (!data.success) throw new Error(data.error || '讀取失敗');
      const day = (data.days || []).find(d => d.date === date);
      serverLines = day ? day.lines : [];
    } catch (err) {
      saveBtn.disabled = false;
      clSetStatus(`無法確認這天目前的內容，為了避免覆蓋已先停止儲存：${err.message || err}`, true);
      return;
    }
    saveBtn.disabled = false;
    clSetStatus('');
    if (!newLines.length && !serverLines.length) { clSetStatus('請先輸入更新內容（一行一條）', true); return; }
    const removed = serverLines.filter(l => !newLines.includes(String(l).trim()));
    if (removed.length) {
      const list = removed.map(l => `・${l}`).join('\n');
      const head = newLines.length
        ? `⚠️ ${clDateLabel(date)} 已經有內容，儲存後下面 ${removed.length} 條會被移除：`
        : `⚠️ 文字框是空的，儲存會刪除 ${clDateLabel(date)} 的全部 ${removed.length} 條：`;
      if (!confirm(`${head}\n\n${list}\n\n刪掉就救不回來。確定要儲存嗎？\n（想保留舊的，請按取消，把舊內容一起打進文字框再存）`)) {
        clSetStatus('已取消儲存，資料沒有變動');
        return;
      }
    }
    clSaveDay(date, linesEl.value);
  });

  document.getElementById('changelogRefreshBtn').addEventListener('click', () => loadChangelogView(true));

  document.getElementById('changelogListArea').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-cl-edit]');
    if (editBtn) {
      if (CHANGELOG_DIRTY && !confirm('文字框有還沒儲存的修改，會被蓋掉，確定嗎？')) return;
      dateEl.value = editBtn.dataset.clEdit;
      prevDate = dateEl.value;
      clFillFormFromDate();
      linesEl.focus();
      linesEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const delBtn = e.target.closest('[data-cl-delete]');
    if (delBtn) {
      const date = delBtn.dataset.clDelete;
      const day = CHANGELOG_DAYS.find(d => d.date === date);
      const list = day ? '\n\n' + day.lines.map(l => `・${l}`).join('\n') : '';
      if (!confirm(`確定刪除 ${clDateLabel(date)} 的全部日誌？刪掉就救不回來。${list}`)) return;
      // 文字框正在編輯「別天」且還沒存：刪除後重新載入會蓋掉文字框，先記下來再放回去
      const keepText = (CHANGELOG_DIRTY && dateEl.value !== date) ? linesEl.value : null;
      clSaveDay(date, '').then(ok => {
        if (keepText !== null) {
          linesEl.value = keepText;
          CHANGELOG_DIRTY = true;
        } else if (ok && dateEl.value === date) {
          clFillFormFromDate();
        }
      });
    }
  });
});
