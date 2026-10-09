// ===================================================================
// promos.js — 團購優惠（本週優惠／整團優惠）後台：事件視窗「優惠」區 ＋ 「優惠總覽」分頁
// 設計正本：dondon-platform docs/15-event-promos-design.md（§0 定案、§1 名詞、§4 後台）
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 changelog.js）。
// 理由：admin.js 開機還原分頁時會同步呼叫 switchView，若分頁剛好停在 promos、
// 本檔卻排在後面，loadPromosView 還不存在，整頁變磚。
// 本檔最外層只有「宣告」與「DOM 事件掛載」；執行期才會用到 admin.js 的 postTask／hasEditPerm。
//
// 事件視窗與總覽頁共用同一組函式：promoMountPanel(container, opts) 負責
// 「快速新增（本週／整團）＋ 優惠清單（通知／編輯／刪除）」，admin.js 的事件視窗呼叫
// promoMountEventPanel；總覽頁每張團卡呼叫 promoMountPanel。優惠筆的存取獨立（promo-* API），
// 不進 event-update 的 payload。使用者文字一律 textContent／textNode，不進 innerHTML。
// ===================================================================

let PROMOS_LOADED = false;   // 總覽頁第一次進才拉，之後切回來用快取；「重新整理」強制重拉

// ---- 線條圖示（固定字串，可 innerHTML；使用者文字仍走 textNode）----
const PM_ICONS = {
  warn: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.3h.01" stroke-width="2.6"/></svg>',
  plus: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  bell: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17.5V11a6 6 0 0 1 12 0v6.5l1.5 1.5h-15z"/><path d="M10 21h4"/></svg>',
  pencil: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg>',
  trash: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12.5h9.4L17.5 7"/><path d="M10 11v6M14 11v6"/></svg>',
  check: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  refresh: '<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.6"/><path d="M20 4v4.6h-4.6"/><path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.4"/><path d="M4 20v-4.6h4.6"/></svg>'
};

// ---- 小工具：DOM ----
function pmEl(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

// 圖示＋文字按鈕（文字走 textNode）
function pmBtn(label, iconKey, extraCls) {
  const b = pmEl('button', 'task-mini-btn' + (extraCls ? ' ' + extraCls : ''));
  b.type = 'button';
  if (iconKey && PM_ICONS[iconKey]) {
    const span = document.createElement('span');
    span.innerHTML = PM_ICONS[iconKey];
    b.appendChild(span.firstChild);
    b.appendChild(document.createTextNode(' '));
  }
  b.appendChild(document.createTextNode(label));
  return b;
}

function pmIconNode(iconKey) {
  const span = document.createElement('span');
  span.innerHTML = PM_ICONS[iconKey] || '';
  return span.firstChild;
}

function pmDateInput(value) {
  const inp = document.createElement('input');
  inp.type = 'date';
  inp.className = 'promo-date';
  inp.value = value || '';
  return inp;
}

function pmTextarea(rows, placeholder, value) {
  const ta = document.createElement('textarea');
  ta.rows = rows;
  ta.className = 'promo-textarea';
  if (placeholder) ta.placeholder = placeholder;
  ta.value = value || '';
  return ta;
}

// ---- 小工具：日期（一律以台北時間判日，字串 YYYY-MM-DD 運算，避開時區漂移）----
function pmTaipeiToday() {
  // en-CA 的日期格式就是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function pmParseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

function pmAddDays(ymd, n) {
  const p = pmParseYmd(ymd);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
}

function pmDow(ymd) {
  const p = pmParseYmd(ymd);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : 0;
}

function pmMd(ymd) {
  const p = pmParseYmd(ymd);
  return p ? `${p.m}/${p.d}` : '';
}

/** 預設優惠日＝本週六、週日（今天已是週六＝今天起兩天、週日＝只剩今天）；結束日更早就截到結束日 */
function pmDefaultWeekend(endYmd) {
  const today = pmTaipeiToday();
  const dow = pmDow(today);
  let from;
  let to;
  if (dow === 0) { from = today; to = today; }
  else { from = pmAddDays(today, 6 - dow); to = pmAddDays(from, 1); }
  if (pmParseYmd(endYmd)) {
    if (to > endYmd) to = endYmd;
    if (from > endYmd) from = endYmd;
  }
  return { from, to };
}

/** 通知時間 M/D HH:mm（台北時間） */
function pmFmtNoticeTime(iso) {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return '';
  const parts = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(t).forEach(x => { parts[x.type] = x.value; });
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.month}/${parts.day} ${hh}:${parts.minute}`;
}

// ---- 小工具：優惠筆顯示 ----
function pmWhenText(p) {
  if (p.kind === 'long') return '整團';
  if (p.promoFrom && p.promoTo) {
    return p.promoFrom === p.promoTo ? pmMd(p.promoFrom) : `${pmMd(p.promoFrom)}–${pmMd(p.promoTo)}`;
  }
  if (p.promoFrom) return `${pmMd(p.promoFrom)} 起`;
  return p.label || '—';
}

const PM_STATE_LABEL = { scheduled: '未到', showing: '顯示中', active: '優惠中', expired: '已過期' };

// ---- API ----
async function promoApi(type, extra) {
  const res = await postTask(Object.assign({ type }, extra || {}));
  if (!res || res.success === false) throw new Error((res && res.error) || '操作失敗');
  return res;
}

function pmCanEdit() {
  return typeof hasEditPerm !== 'function' || hasEditPerm('calendarEdit');
}

// ---- 共用面板：快速新增 ＋ 清單 ----
/**
 * opts:
 *   eventId      事件 legacy 編號（ev.id）
 *   promos       （選填）已有的優惠清單，有就不再打 promo-list
 *   tableReady   （選填）搭配 promos 使用
 *   getEndDate   （選填）回傳事件結束日 YYYY-MM-DD，用來截預設優惠日
 *   withLong     是否顯示「整團優惠」新增區
 */
function promoMountPanel(container, opts) {
  const state = {
    eventId: opts.eventId,
    promos: opts.promos || [],
    tableReady: opts.tableReady !== false,
    getEndDate: opts.getEndDate || (() => ''),
    withLong: !!opts.withLong,
    editingId: null,
    busyIds: new Set(),
    loaded: !!opts.promos,
    readOnly: !pmCanEdit(),
    el: {}
  };
  container._pm = state;
  container.textContent = '';

  // 表未建立橫幅
  const banner = pmEl('div', 'promo-notready');
  banner.style.display = 'none';
  banner.appendChild(pmIconNode('warn'));
  banner.appendChild(document.createTextNode(' 優惠資料表還沒建立，要先執行一次 db push 才能新增。'));
  container.appendChild(banner);
  state.el.banner = banner;

  const status = pmEl('div', 'form-status promo-status');
  state.el.status = status;

  if (!state.readOnly) {
    container.appendChild(pmBuildWeeklyForm(state));
    if (state.withLong) container.appendChild(pmBuildLongForm(state));
  }
  container.appendChild(status);

  const list = pmEl('div', 'promo-list');
  state.el.list = list;
  container.appendChild(list);

  pmApplyReady(state);
  if (state.loaded) pmRenderList(container);
  else promoReload(container);
  return state;
}

function pmApplyReady(state) {
  state.el.banner.style.display = state.tableReady ? 'none' : 'block';
  (state.el.addBtns || []).forEach(b => { b.disabled = !state.tableReady; });
}

function pmSetStatus(state, text, isError, iconKey) {
  const el = state.el.status;
  el.textContent = '';
  if (iconKey) { el.appendChild(pmIconNode(iconKey)); el.appendChild(document.createTextNode(' ')); }
  if (text) el.appendChild(document.createTextNode(text));
  el.style.color = isError ? 'var(--c-danger, #B5485A)' : '';
}

/** 重打 promo-list 並重畫清單（只重畫清單，不動上面已打的字） */
async function promoReload(container) {
  const state = container._pm;
  if (!state) return;
  state.el.list.textContent = '';
  state.el.list.appendChild(pmEl('div', 'task-empty', '讀取中…'));
  try {
    const res = await promoApi('promo-list', { eventId: state.eventId });
    if (container._pm !== state) return; // 視窗已換成別的事件
    state.promos = res.promos || [];
    state.tableReady = res.tableReady !== false;
    state.loaded = true;
    pmApplyReady(state);
    pmRenderList(container);
  } catch (err) {
    if (container._pm !== state) return;
    state.el.list.textContent = '';
    state.el.list.appendChild(pmEl('div', 'task-empty', err.message || '讀取失敗'));
  }
}

function pmBuildWeeklyForm(state) {
  const box = pmEl('div', 'promo-form');
  box.appendChild(pmEl('div', 'promo-form-title', '本週優惠'));
  const ta = pmTextarea(2, '例如：本週六日奶酥買一送一（一行一段，前台保留換行）');
  box.appendChild(ta);
  const row = pmEl('div', 'promo-form-row');
  row.appendChild(pmEl('span', 'promo-form-label', '優惠日'));
  const wk = pmDefaultWeekend(state.getEndDate());
  const from = pmDateInput(wk.from);
  const to = pmDateInput(wk.to);
  row.appendChild(from);
  row.appendChild(pmEl('span', 'promo-form-label', '到'));
  row.appendChild(to);
  const btn = pmBtn('新增這週', 'plus', 'promo-add-btn');
  row.appendChild(btn);
  box.appendChild(row);
  box.appendChild(pmEl('div', 'promo-form-hint', '打上去就開始顯示（預告優惠日有優惠），顯示到優惠日最後一天。'));
  state.el.addBtns = (state.el.addBtns || []).concat([btn]);

  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { pmSetStatus(state, '請先輸入本週優惠的內容', true); return; }
    if (from.value && to.value && from.value > to.value) { pmSetStatus(state, '優惠日的起日不能晚於迄日', true); return; }
    if (from.value && state.promos.some(p => p.kind === 'weekly' && p.promoFrom === from.value)) {
      if (!confirm('這週已有一筆，要另外再加一筆嗎？')) return;
    }
    btn.disabled = true;
    pmSetStatus(state, '新增中…');
    try {
      const res = await promoApi('promo-upsert', {
        eventId: state.eventId, kind: 'weekly', text,
        promoFrom: from.value || null, promoTo: to.value || null
      });
      ta.value = '';
      await pmAfterChange(state, '已新增本週優惠（還沒通知粉絲，要通知請按該筆的「確認並通知」）');
      if (res.warning) alert('注意：' + res.warning);
    } catch (err) {
      pmSetStatus(state, err.message || '新增失敗', true);
    } finally {
      btn.disabled = !state.tableReady;
    }
  });
  return box;
}

function pmBuildLongForm(state) {
  const box = pmEl('div', 'promo-form');
  box.appendChild(pmEl('div', 'promo-form-title', '整團優惠'));
  const ta = pmTextarea(2, '例如：滿 1000 免運（整團期間都有效，不帶日期）');
  box.appendChild(ta);
  const row = pmEl('div', 'promo-form-row');
  const btn = pmBtn('新增', 'plus', 'promo-add-btn');
  row.appendChild(btn);
  box.appendChild(row);
  state.el.addBtns = (state.el.addBtns || []).concat([btn]);

  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { pmSetStatus(state, '請先輸入整團優惠的內容', true); return; }
    btn.disabled = true;
    pmSetStatus(state, '新增中…');
    try {
      const res = await promoApi('promo-upsert', { eventId: state.eventId, kind: 'long', text });
      ta.value = '';
      await pmAfterChange(state, '已新增整團優惠');
      if (res.warning) alert('注意：' + res.warning);
    } catch (err) {
      pmSetStatus(state, err.message || '新增失敗', true);
    } finally {
      btn.disabled = !state.tableReady;
    }
  });
  return box;
}

/** 變動後：重抓這一團的清單並重畫，再顯示結果訊息 */
async function pmAfterChange(state, okMessage) {
  const container = state.el.list.parentNode;
  await promoReload(container);
  if (container._pm === state) pmSetStatus(state, okMessage || '', false, okMessage ? 'check' : '');
}

function pmRenderList(container) {
  const state = container._pm;
  const list = state.el.list;
  list.textContent = '';
  if (!state.promos.length) {
    list.appendChild(pmEl('div', 'promo-empty', '這一團還沒有任何優惠'));
    return;
  }
  state.promos.forEach(p => {
    list.appendChild(state.editingId === p.id ? pmBuildEditRow(state, p) : pmBuildRow(state, p));
  });
}

function pmBuildRow(state, p) {
  const row = pmEl('div', 'promo-row' + (p.state === 'expired' ? ' is-expired' : ''));

  const main = pmEl('div', 'promo-row-main');
  main.appendChild(pmEl('span', 'promo-when promo-when-' + (p.kind === 'long' ? 'long' : 'weekly'), pmWhenText(p)));
  main.appendChild(pmEl('span', 'promo-text', p.text || ''));
  // 優惠日超過結團日（後端 beyondEnd）：前台永遠不會顯示，狀態改標紅字提醒
  main.appendChild(p.beyondEnd
    ? pmEl('span', 'promo-state promo-state-beyond', '超過結團日')
    : pmEl('span', 'promo-state promo-state-' + (p.state || 'scheduled'), PM_STATE_LABEL[p.state] || p.state || ''));
  row.appendChild(main);

  if (state.readOnly) return row;

  const actions = pmEl('div', 'promo-row-actions');
  const notifyBtn = pmBtn('確認並通知', 'bell');
  actions.appendChild(notifyBtn);
  if (p.lastNotice && p.lastNotice.confirmedAt) {
    let t = '已通知 ' + pmFmtNoticeTime(p.lastNotice.confirmedAt);
    if (p.noticeCount > 1) t += `（共 ${p.noticeCount} 則）`;
    actions.appendChild(pmEl('span', 'promo-notified', t));
  }
  const editBtn = pmBtn('編輯', 'pencil');
  const delBtn = pmBtn('刪除', 'trash', 'danger');
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  row.appendChild(actions);

  const busy = state.busyIds.has(p.id);
  notifyBtn.disabled = busy || !state.tableReady;

  notifyBtn.addEventListener('click', async () => {
    if (state.busyIds.has(p.id)) return;
    if (p.lastNotice && !confirm('已經通知過，要再發一次嗎？')) return;
    state.busyIds.add(p.id);
    notifyBtn.disabled = true;
    pmSetStatus(state, '通知中…');
    try {
      const res = await promoApi('promo-notify', { promoId: p.id });
      const n = res.notice || {};
      const who = n.brandName ? `${n.brandName}（登入訂閱 ${n.subscriberCount || 0} 人）` : `登入訂閱 ${n.subscriberCount || 0} 人`;
      state.busyIds.delete(p.id);
      await pmAfterChange(state, '已通知：' + who);
    } catch (err) {
      state.busyIds.delete(p.id);
      notifyBtn.disabled = !state.tableReady;
      pmSetStatus(state, err.message || '通知失敗', true);
    }
  });

  editBtn.addEventListener('click', () => {
    state.editingId = p.id;
    pmRenderList(state.el.list.parentNode);
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm('確定刪除這筆優惠嗎？\n\n' + (p.text || '') + '\n\n刪掉就救不回來（已發出的通知不受影響）。')) return;
    delBtn.disabled = true;
    pmSetStatus(state, '刪除中…');
    try {
      await promoApi('promo-delete', { id: p.id });
      await pmAfterChange(state, '已刪除');
    } catch (err) {
      delBtn.disabled = false;
      pmSetStatus(state, err.message || '刪除失敗', true);
    }
  });
  return row;
}

function pmBuildEditRow(state, p) {
  const row = pmEl('div', 'promo-row is-editing');
  const ta = pmTextarea(2, '', p.text || '');
  row.appendChild(ta);

  let showFrom = null;
  let from = null;
  let to = null;
  if (p.kind === 'weekly') {
    const r1 = pmEl('div', 'promo-form-row');
    r1.appendChild(pmEl('span', 'promo-form-label', '優惠日'));
    from = pmDateInput(p.promoFrom);
    to = pmDateInput(p.promoTo);
    r1.appendChild(from);
    r1.appendChild(pmEl('span', 'promo-form-label', '到'));
    r1.appendChild(to);
    row.appendChild(r1);
    const r2 = pmEl('div', 'promo-form-row');
    r2.appendChild(pmEl('span', 'promo-form-label', '顯示從'));
    showFrom = pmDateInput(p.showFrom);
    r2.appendChild(showFrom);
    row.appendChild(r2);
  }

  const actions = pmEl('div', 'promo-row-actions');
  const saveBtn = pmBtn('儲存', 'check');
  const cancelBtn = pmBtn('取消', 'close');
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  row.appendChild(actions);

  cancelBtn.addEventListener('click', () => {
    state.editingId = null;
    pmRenderList(state.el.list.parentNode);
  });

  saveBtn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { pmSetStatus(state, '優惠內容不能是空的（要移除請按刪除）', true); return; }
    if (from && to && from.value && to.value && from.value > to.value) { pmSetStatus(state, '優惠日的起日不能晚於迄日', true); return; }
    saveBtn.disabled = true;
    pmSetStatus(state, '儲存中…');
    try {
      // 整組欄位都帶（沒改的照原值），不論後端是 partial 還是整列覆蓋都不會把沒改的欄位洗掉
      const res = await promoApi('promo-upsert', {
        id: p.id, eventId: state.eventId, kind: p.kind, text,
        showFrom: showFrom ? (showFrom.value || null) : (p.showFrom || null),
        promoFrom: from ? (from.value || null) : (p.promoFrom || null),
        promoTo: to ? (to.value || null) : (p.promoTo || null),
        sort: p.sort
      });
      state.editingId = null;
      await pmAfterChange(state, '已儲存修改（已發出的通知內容不會跟著變）');
      if (res.warning) alert('注意：' + res.warning);
    } catch (err) {
      saveBtn.disabled = false;
      pmSetStatus(state, err.message || '儲存失敗', true);
    }
  });
  return row;
}

// ---- 事件編輯視窗入口（admin.js openEventEditModal 呼叫）----
function promoMountEventPanel(ev, isNew) {
  const box = document.getElementById('evPromoBox');
  if (!box) return;
  box._pm = null;
  box.textContent = '';
  if (isNew || !ev) {
    box.appendChild(pmEl('div', 'promo-form-hint', '先儲存事件後才能設定優惠'));
    return;
  }
  promoMountPanel(box, {
    eventId: ev.id,
    withLong: true,
    getEndDate: () => {
      const inp = document.getElementById('evEndDateInput');
      return inp ? inp.value : '';
    }
  });
}

// ---- 優惠總覽分頁 ----
async function loadPromosView(force) {
  const area = document.getElementById('promosListArea');
  if (!area) return;
  if (PROMOS_LOADED && !force) return;
  area.textContent = '';
  area.appendChild(pmEl('div', 'task-empty', '讀取中…'));
  const notReady = document.getElementById('promosNotReady');
  try {
    const res = await promoApi('promo-overview');
    if (notReady) notReady.style.display = res.tableReady === false ? 'block' : 'none';
    PROMOS_LOADED = true;
    renderPromosOverview(res.teams || [], res.tableReady !== false);
  } catch (err) {
    area.textContent = '';
    area.appendChild(pmEl('div', 'task-empty', err.message || '讀取失敗'));
  }
}

function renderPromosOverview(teams, tableReady) {
  const area = document.getElementById('promosListArea');
  area.textContent = '';
  if (!teams.length) {
    area.appendChild(pmEl('div', 'task-empty', tableReady ? '目前沒有開團中或即將開團的團購' : ''));
    return;
  }
  // 開團中在前（同狀態保持後端給的順序）
  const sorted = teams.map((t, i) => ({ t, i }))
    .sort((a, b) => ((a.t.status === 'open' ? 0 : 1) - (b.t.status === 'open' ? 0 : 1)) || (a.i - b.i))
    .map(x => x.t);
  sorted.forEach(team => area.appendChild(pmBuildTeamCard(team, tableReady)));
}

function pmBuildTeamCard(team, tableReady) {
  const card = pmEl('div', 'promo-card');

  const head = pmEl('div', 'promo-card-head');
  head.appendChild(pmEl('strong', 'promo-card-title', team.title || ''));
  head.appendChild(pmEl('span', 'promo-badge promo-badge-' + (team.status === 'open' ? 'open' : 'upcoming'), team.status === 'open' ? '開團中' : '即將開團'));
  card.appendChild(head);

  const range = pmMd(team.startDate) + '～' + pmMd(team.displayEnd || team.endDate);
  card.appendChild(pmEl('div', 'promo-card-sub', '開團期間 ' + range + (team.displayEnd && team.endDate && team.displayEnd !== team.endDate ? '（含延長）' : '')));

  const meta = pmEl('div', 'promo-card-meta');
  if (team.earlyBird && team.earlyBird.length) {
    const line = pmEl('div', 'promo-meta-line');
    line.appendChild(pmEl('span', 'promo-meta-key', '早鳥禮'));
    line.appendChild(pmEl('span', 'promo-meta-val', team.earlyBird.join('／')));
    meta.appendChild(line);
  }
  if (team.discountCode) {
    const line = pmEl('div', 'promo-meta-line');
    line.appendChild(pmEl('span', 'promo-meta-key', '折扣碼'));
    line.appendChild(pmEl('span', 'promo-meta-val', team.discountCode + (team.discountDesc ? '　' + team.discountDesc : '')));
    meta.appendChild(line);
  }
  const brandLine = pmEl('div', 'promo-meta-line');
  brandLine.appendChild(pmEl('span', 'promo-meta-key', '品牌'));
  if (team.brandName) {
    brandLine.appendChild(pmEl('span', 'promo-meta-val', team.brandName));
    brandLine.appendChild(pmEl('span', 'promo-meta-small', `登入訂閱 ${team.subscriberCount || 0} 人`));
  } else {
    brandLine.appendChild(pmEl('span', 'promo-meta-val promo-meta-warn', '這團對不到品牌，通知沒人收得到'));
  }
  meta.appendChild(brandLine);
  card.appendChild(meta);

  const body = pmEl('div', 'promo-card-body');
  card.appendChild(body);
  promoMountPanel(body, {
    eventId: team.eventLegacyId,
    promos: team.promos || [],
    tableReady,
    withLong: false,
    getEndDate: () => team.displayEnd || team.endDate || ''
  });
  return card;
}

// ===== DOM 事件掛載 =====
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('promosRefreshBtn');
  if (btn) btn.addEventListener('click', () => loadPromosView(true));
});
