// 員工系統更新公告（announce.js）
// 登入後有未讀公告 → 跳窗，按「我知道了」記已讀（存資料庫）；分頁「系統更新」可翻全部，有權限者可新增／修改／刪除。
// 依賴 admin.js 的 postTask（函式宣告，載入後才呼叫所以順序沒問題）。所有使用者文字一律 textContent。
(function () {
  'use strict';

  var css = [
    '.ann-badge{display:none;margin-left:auto;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#B5485A;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center;}',
    '.ann-item{background:#fff;border:1px solid #E6DCD2;border-radius:12px;padding:12px 14px;margin-bottom:10px;}', /* 白底：公告文字在奶茶底上不夠清楚（雪莉 10-10） */
    '.ann-item-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;}',
    '.ann-item-title{font-weight:700;font-size:15px;color:var(--c-text);}',
    '.ann-item-meta{font-size:12px;color:var(--c-muted,#a89888);}',
    '.ann-item-body{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.6;color:var(--c-text);}',
    '.ann-unread-tag{font-size:11px;font-weight:700;color:#fff;background:#B5485A;border-radius:6px;padding:1px 6px;}',
    '.ann-readers{margin-top:8px;font-size:12px;color:var(--c-muted,#a89888);line-height:1.6;}',
    '.ann-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
    '.ann-form{background:var(--c-surface,#fff);border:1px solid var(--c-line);border-radius:12px;padding:12px 14px;margin-bottom:14px;}',
    '.ann-form input[type=text],.ann-form textarea{width:100%;box-sizing:border-box;margin-bottom:8px;border:1px solid var(--c-line);border-radius:10px;padding:8px 10px;font-family:var(--font-body);font-size:14px;background:var(--c-input-bg,#fff);color:var(--c-text);}',
    '.ann-empty{color:var(--c-muted,#a89888);font-size:13px;padding:12px 0;}',
    '#annModal .modal-box{max-width:480px;width:calc(100% - 32px);max-height:80vh;overflow-y:auto;}',
    '#annModal .ann-item{margin-bottom:8px;}',
    '#annModal .ann-ok-btn{width:100%;margin-top:6px;}'
  ].join('\n');
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var autoShown = false;
  var lastCheckAt = 0;
  var unreadCount = 0;
  var listState = { items: [], canEdit: false, tableReady: true, editingId: null };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function setBadge(n) {
    unreadCount = n;
    ['annNavBadge', 'annMenuBadge'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.textContent = n > 99 ? '99+' : String(n);
      b.style.display = n > 0 ? 'inline-block' : 'none';
    });
  }

  // ---------- 跳窗 ----------
  function closeAnnModal() {
    var m = document.getElementById('annModal');
    if (m) m.classList.remove('show');
  }
  function showAnnModal(items) {
    var m = document.getElementById('annModal');
    if (!m) {
      m = el('div', 'modal-backdrop');
      m.id = 'annModal'; // 刻意不綁點灰底關閉
      var box = el('div', 'modal-box');
      var x = el('button', 'modal-close', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', '關閉');
      x.addEventListener('click', closeAnnModal);
      var h = el('h3', null, '系統更新');
      var list = el('div'); list.id = 'annModalList';
      var ok = el('button', 'task-submit-btn ann-ok-btn', '我知道了');
      ok.type = 'button'; ok.id = 'annModalOk';
      box.appendChild(x); box.appendChild(h); box.appendChild(list); box.appendChild(ok);
      m.appendChild(box);
      document.body.appendChild(m);
    }
    var listEl = document.getElementById('annModalList');
    listEl.textContent = '';
    items.forEach(function (it) { listEl.appendChild(buildItem(it, false)); });
    var okBtn = document.getElementById('annModalOk');
    okBtn.disabled = false;
    okBtn.onclick = async function () {
      okBtn.disabled = true;
      var ids = items.map(function (i) { return i.id; });
      try { await postTask({ type: 'announce-read', ids: ids }); } catch (e) { /* 唯讀檢視等：靜默忽略 */ }
      closeAnnModal();
      setBadge(Math.max(0, unreadCount - ids.length));
      if (isShown()) loadAnnounceView();
    };
    m.classList.add('show');
  }

  // ---------- 登入後檢查 ----------
  async function checkStaffAnnouncements() {
    var now = Date.now();
    if (now - lastCheckAt < 30000) return; // 節流：資料重整不重複打
    lastCheckAt = now;
    try {
      var r = await postTask({ type: 'announce-unread' });
      if (!r || r.tableReady === false) return;
      var items = r.items || [];
      setBadge(items.length);
      if (items.length && !autoShown) {
        autoShown = true;
        showAnnounceModalSafe(items);
      }
    } catch (e) { /* 靜默 */ }
  }
  function showAnnounceModalSafe(items) { try { showAnnModal(items); } catch (e) { /* 靜默 */ } }
  window.checkStaffAnnouncements = checkStaffAnnouncements;

  // ---------- 單則公告 DOM ----------
  function buildItem(it, withAdmin) {
    var box = el('div', 'ann-item');
    var head = el('div', 'ann-item-head');
    head.appendChild(el('span', 'ann-item-title', it.title || ''));
    if (withAdmin && it.read === false) head.appendChild(el('span', 'ann-unread-tag', '未讀'));
    var meta = fmtDate(it.createdAt) + (it.createdBy ? '　' + it.createdBy : '');
    head.appendChild(el('span', 'ann-item-meta', meta));
    box.appendChild(head);
    box.appendChild(el('div', 'ann-item-body', it.body || ''));
    if (!withAdmin) return box;

    if (listState.canEdit && (it.readBy || it.unreadBy)) {
      var rd = el('div', 'ann-readers');
      rd.appendChild(el('div', null, '已讀：' + ((it.readBy || []).join('、') || '無')));
      rd.appendChild(el('div', null, '未讀：' + ((it.unreadBy || []).join('、') || '無')));
      box.appendChild(rd);
    }
    var acts = el('div', 'ann-actions');
    if (it.read === false) {
      var rb = el('button', 'task-mini-btn', '標為已讀');
      rb.type = 'button';
      rb.addEventListener('click', async function () {
        rb.disabled = true;
        try {
          await postTask({ type: 'announce-read', ids: [it.id] });
          setBadge(Math.max(0, unreadCount - 1));
          loadAnnounceView();
        } catch (e) { rb.disabled = false; alert('標記失敗：' + e.message); }
      });
      acts.appendChild(rb);
    }
    if (listState.canEdit) {
      var eb = el('button', 'task-mini-btn', '修改');
      eb.type = 'button';
      eb.addEventListener('click', function () { listState.editingId = it.id; renderView(); });
      var db = el('button', 'task-mini-btn', '刪除');
      db.type = 'button';
      db.addEventListener('click', async function () {
        if (!confirm('確定刪除這則公告？員工的已讀紀錄也會一併消失。')) return;
        db.disabled = true;
        try { await postTask({ type: 'announce-delete', id: it.id }); loadAnnounceView(); }
        catch (e) { db.disabled = false; alert('刪除失敗：' + e.message); }
      });
      acts.appendChild(eb); acts.appendChild(db);
    }
    if (acts.childNodes.length) box.appendChild(acts);
    return box;
  }

  // 新增／修改表單
  function buildForm(editItem) {
    var f = el('div', 'ann-form');
    f.appendChild(el('div', 'ann-item-title', editItem ? '修改公告' : '新增公告'));
    var t = el('input'); t.type = 'text'; t.maxLength = 60; t.placeholder = '標題（60 字內）';
    t.style.marginTop = '8px';
    var b = el('textarea'); b.rows = 5; b.maxLength = 2000; b.placeholder = '內容（2000 字內，可換行）';
    if (editItem) { t.value = editItem.title || ''; b.value = editItem.body || ''; }
    var status = el('div', 'form-status');
    var btn = el('button', 'task-submit-btn', editItem ? '儲存修改' : '發布');
    btn.type = 'button';
    btn.addEventListener('click', async function () {
      var title = t.value.trim(), body = b.value.trim();
      if (!title || !body) { status.textContent = '標題和內容都要填'; return; }
      btn.disabled = true; status.textContent = '送出中…';
      try {
        var p = { type: 'announce-upsert', title: title, body: body };
        if (editItem) p.id = editItem.id;
        await postTask(p);
        listState.editingId = null;
        loadAnnounceView();
      } catch (e) { btn.disabled = false; status.textContent = '失敗：' + e.message; }
    });
    f.appendChild(t); f.appendChild(b); f.appendChild(btn);
    if (editItem) {
      var cb = el('button', 'task-mini-btn', '取消');
      cb.type = 'button'; cb.style.marginLeft = '8px';
      cb.addEventListener('click', function () { listState.editingId = null; renderView(); });
      f.appendChild(cb);
    }
    f.appendChild(status);
    return f;
  }

  function isShown() {
    return typeof isViewShown === 'function' && isViewShown('announce');
  }

  function renderView() {
    var area = document.getElementById('annListArea');
    if (!area) return;
    area.textContent = '';
    if (listState.tableReady === false) {
      area.appendChild(el('div', 'ann-empty', '系統更新公告功能待資料庫更新後啟用'));
      return;
    }
    if (listState.canEdit && !listState.editingId) area.appendChild(buildForm(null));
    if (!listState.items.length) { area.appendChild(el('div', 'ann-empty', '目前沒有公告')); return; }
    listState.items.forEach(function (it) {
      if (listState.canEdit && listState.editingId === it.id) area.appendChild(buildForm(it));
      else area.appendChild(buildItem(it, true));
    });
  }

  async function loadAnnounceView() {
    var area = document.getElementById('annListArea');
    if (area && !listState.items.length) { area.textContent = ''; area.appendChild(el('div', 'ann-empty', '讀取中…')); }
    try {
      var r = await postTask({ type: 'announce-list' });
      listState.tableReady = r.tableReady !== false;
      listState.canEdit = !!r.canEdit;
      listState.items = r.items || [];
      if (listState.tableReady) setBadge(listState.items.filter(function (i) { return i.read === false; }).length);
      renderView();
    } catch (e) {
      if (area) { area.textContent = ''; area.appendChild(el('div', 'ann-empty', '讀取失敗：' + e.message)); }
    }
  }
  window.loadAnnounceView = loadAnnounceView;
})();
