/* 收單狀態（後台行事曆清單小標籤＋檢視活動視窗區塊）
 * 資料：POST APPS_SCRIPT_URL { type:'event-harvest-status', token }
 *   → { success, ready, today, items:{ [eventId]: { kind, kindLabel, status, statusLabel, lastDay, orders, paid, parentId, parentTitle, error } } }
 * 拿不到資料（端點未上線／ready:false／失敗）一律靜默降級：items 設空物件、不彈窗、不顯示標籤。
 * 全域名稱一律 hv 前綴。 */
var hvState = { items: null, fetchedAt: 0, loading: false, error: '' };
var HV_TTL_MS = 5 * 60 * 1000;

function hvEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function hvMd(day) {
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(day || ''));
  return m ? (Number(m[2]) + '/' + Number(m[3])) : '';
}

function hvFetch(force) {
  if (hvState.loading) return;
  if (typeof currentToken === 'undefined' || !currentToken) return;
  if (!force && hvState.items && Date.now() - hvState.fetchedAt < HV_TTL_MS) return;
  hvState.loading = true;
  var done = function (items, err) {
    hvState.items = items;
    hvState.error = err || '';
    hvState.fetchedAt = Date.now();
    hvState.loading = false;
    if (typeof renderGroupStatusList === 'function') {
      try { renderGroupStatusList('calGroupList'); } catch (e) { /* 靜默 */ }
    }
    var box = document.getElementById('evViewHarvestBox');
    if (box && box.dataset.eventId) {
      hvRenderEventBox(box, box.dataset.eventId, { sectionEl: document.getElementById('evViewHarvestSection') });
    }
  };
  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ type: 'event-harvest-status', token: currentToken })
  }).then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.success && d.ready !== false && d.items && typeof d.items === 'object') done(d.items, '');
    else done({}, (d && d.error) || 'not ready');
  }).catch(function (e) {
    done({}, String(e && e.message || e));
  });
}

function hvShortKind(kind) {
  if (kind === 'gbf' || kind === 'meepshop') return '自動';
  if (kind === 'oneshop_login' || kind === 'shopline') return '登入';
  if (kind === 'oneshop_total') return '總數';
  return '其他';
}

function hvBadgeHtml(eventId) {
  if (!hvState.items) return '';
  var it = hvState.items[eventId];
  if (!it || it.kind === 'child') return '';
  var text;
  var st = it.status;
  if (it.kind === 'none') {
    text = '未填後台網址';
    if (st !== 'bad') st = 'info';
  } else if (it.kind === 'vendor') {
    text = '名單 ' + (Number(it.orders) || 0) + ' 筆';
    st = 'info';
  } else {
    text = hvShortKind(it.kind) + ' ' + (hvMd(it.lastDay) || '從未');
  }
  if (['ok', 'warn', 'bad', 'info'].indexOf(st) < 0) st = 'info';
  return '<span class="gs-harvest-badge hv-' + st + '" title="' + hvEsc(it.statusLabel || '') + '">' + hvEsc(text) + '</span>';
}

function hvRenderEventBox(box, eventId, opts) {
  if (!box) return;
  var sectionEl = opts && opts.sectionEl;
  box.dataset.eventId = String(eventId == null ? '' : eventId);
  if (!hvState.items) {
    if (sectionEl) sectionEl.style.display = '';
    box.innerHTML = '<div class="hv-line hv-dim">載入中…</div>';
    hvFetch();
    return;
  }
  var it = hvState.items[eventId];
  if (!it) {
    if (sectionEl) sectionEl.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  if (sectionEl) sectionEl.style.display = '';
  var st = ['ok', 'warn', 'bad', 'info'].indexOf(it.status) >= 0 ? it.status : 'info';
  var html = '<div class="hv-line">收單方式：' + hvEsc(it.kindLabel || '') + '</div>';
  if (it.kind === 'child') {
    html += '<div class="hv-line">訂單算在主團 #' + hvEsc(it.parentId) + ' ' + hvEsc(it.parentTitle || '') + '</div>';
  } else {
    html += '<div class="hv-line">狀態：<span class="hv-text-' + st + '">' + hvEsc(it.statusLabel || '') + '</span></div>';
    html += '<div class="hv-line">上次收單：' + hvEsc(hvMd(it.lastDay) || '從未') +
      '｜累計訂單 ' + (Number(it.orders) || 0) + ' 筆（已付款 ' + (Number(it.paid) || 0) + '）</div>';
  }
  if (it.error) html += '<div class="hv-line hv-dim">最近錯誤：' + hvEsc(it.error) + '</div>';
  box.innerHTML = html;
}
