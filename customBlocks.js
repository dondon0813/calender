// ===================================================================
// customBlocks.js — 開團狀態清單的自訂區塊（文字按鈕等）＋新增/編輯視窗
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 的 renderGroupStatusList()（開團狀態清單本體，留在主檔）
// 會呼叫本檔的 appendCustomBlocksAdmin()；開機還原分頁與資料載入後的重繪
// 都走那條路，本檔若排在後面，開機當下函式還不存在，整頁變磚。
//
// 資料層歸屬：customBlocks 陣列的宣告與寫入都在 admin.js（fetchMemos 回應
// 處理），本檔只讀。本檔最外層只有「宣告」與「DOM 事件掛載」，執行期依賴
// admin.js 的全域：customBlocks、postTask、fetchMemos、setFormStatus、escHtml 等。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放檔案最前段） -----
const CB_TITLE_SIZE_PX = { '小': '14px', '中': '17px', '大': '21px', '特大': '26px' };
const CB_BORDER_STYLE_CSS = { '無': 'none', '實線': 'solid', '虛線': 'dashed' };
const CB_ANIM_CLASS = { '無': '', '搖晃': 'cb-anim-shake', '跳動': 'cb-anim-bounce', '震動': 'cb-anim-vibrate' };

// ===== 【新】開團狀態清單：自訂區塊（文字按鈕等） =====
// CB_TITLE_SIZE_PX / CB_BORDER_STYLE_CSS / CB_ANIM_CLASS 宣告在檔案最前段（開機期 TDZ），見 VIEW_ID_MAP 附近

function appendCustomBlocksAdmin(listEl, position) {
  const items = customBlocks.filter(b => b.position === position).sort((a, b) => a.order - b.order);
  items.forEach((b, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'cb-admin-wrap';
    wrap.dataset.blockId = String(b.id);
    wrap.dataset.position = position;

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
    // 拖曳排序：按住彩色卡片拖（滑鼠移超過 6px；觸控長按 300ms），同一個位置區（before／between／after）內互換
    card.classList.add('cb-draggable');
    card.title = '按住拖曳可調整順序';
    card.addEventListener('pointerdown', (e) => cbDragPointerDown(e, wrap));
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

    // 上下移按鈕已移除（09-25 雪莉：改成直接拖曳區塊排序，見下方 cbDrag*）

    const editBtn = document.createElement('button');
    editBtn.className = 'task-mini-btn';
    editBtn.innerHTML = "<svg class=\"btn-ico\" style=\"margin:0\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z\"/></svg>";
    editBtn.title = '編輯這個區塊';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openBlockEditModal(b); });
    bar.appendChild(editBtn);

    const dupBtn = document.createElement('button');
    dupBtn.className = 'task-mini-btn';
    dupBtn.innerHTML = "<svg class=\"btn-ico\" style=\"margin:0\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1\"/></svg>";
    dupBtn.title = '複製這個區塊';
    dupBtn.addEventListener('click', (e) => { e.stopPropagation(); duplicateCustomBlock(b); });
    bar.appendChild(dupBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'task-mini-btn danger';
    delBtn.innerHTML = "<svg class=\"btn-ico\" style=\"margin:0\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 6h18\"/><path d=\"M8 6V4h8v2\"/><path d=\"M19 6l-1 14H6L5 6\"/><path d=\"M10 11v6M14 11v6\"/></svg>";
    delBtn.title = '刪除這個區塊';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCustomBlock(b); });
    bar.appendChild(delBtn);

    wrap.appendChild(bar);

    const statKey = 'block_' + b.id;
    const st = statsMap[statKey] || { views: 0, clicks: 0 };
    const statsBar = document.createElement('div');
    statsBar.className = 'gs-stats-bar cb-stats-bar';
    const cbClickItem = document.createElement('span');
    cbClickItem.className = 'gs-stat-item';
    cbClickItem.innerHTML = ICON_SVG_CLICK + `<span>${(st.clicks || 0).toLocaleString()}</span>`;
    statsBar.appendChild(cbClickItem);
    const cbViewItem = document.createElement('span');
    cbViewItem.className = 'gs-stat-item';
    cbViewItem.innerHTML = ICON_SVG_EYE + `<span>${(st.views || 0).toLocaleString()}</span>`;
    statsBar.appendChild(cbViewItem);
    wrap.appendChild(statsBar);

    listEl.appendChild(wrap);
  });
}

async function toggleCustomBlock(block) {
  const newVal = !block.enabled;
  block.enabled = newVal;
  renderGroupStatusList('calGroupList');
  try {
    await postTask({ type: 'block-update', id: block.id, enabled: newVal });
  } catch (err) {
    block.enabled = !newVal;
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

// ===== 拖曳排序（2026-09-25 雪莉：拿掉上下移按鈕，直接拖區塊）=====
// 做法比照繪本館封面牆（books.js pbaDrag*）：滑鼠移超過 6px 才算拖、觸控長按 300ms（先滑動超過 10px＝在捲頁，放棄）。
// 只能在同一個位置區（before／between／after）內排序；放開後整批打 block-sort 存檔，失敗就重畫回原順序。
let cbDrag = null;
function cbSiblings(wrap) {
  return Array.from(wrap.parentElement.querySelectorAll('.cb-admin-wrap[data-position="' + wrap.dataset.position + '"]'));
}
function cbDragPointerDown(e, wrap) {
  if (cbDrag) return;
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  if (cbSiblings(wrap).length < 2) return; // 只有一個區塊沒得排
  cbDrag = { wrap, startX: e.clientX, startY: e.clientY, started: false, moved: false, timer: null, isTouch: e.pointerType !== 'mouse',
    orderBefore: cbSiblings(wrap).map(w => w.dataset.blockId) };
  if (cbDrag.isTouch) cbDrag.timer = setTimeout(() => { if (cbDrag && !cbDrag.started && !cbDrag.moved) cbStartDrag(); }, 300);
  document.addEventListener('pointermove', cbDragMove);
  document.addEventListener('pointerup', cbDragUp);
  document.addEventListener('pointercancel', cbDragCancel);
}
function cbBlockScroll(e) { e.preventDefault(); }
function cbStartDrag() {
  cbDrag.started = true;
  cbDrag.wrap.classList.add('dragging');
  document.addEventListener('touchmove', cbBlockScroll, { passive: false });
}
function cbDragMove(e) {
  if (!cbDrag) return;
  const dist = Math.hypot(e.clientX - cbDrag.startX, e.clientY - cbDrag.startY);
  if (!cbDrag.started) {
    if (!cbDrag.isTouch && dist > 6) cbStartDrag();
    else if (dist > 10) { cbDrag.moved = true; clearTimeout(cbDrag.timer); }
    if (!cbDrag.started) return;
  }
  e.preventDefault();
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest ? under.closest('.cb-admin-wrap') : null;
  if (!target || target === cbDrag.wrap || target.dataset.position !== cbDrag.wrap.dataset.position || target.parentElement !== cbDrag.wrap.parentElement) return;
  const sibs = cbSiblings(cbDrag.wrap);
  if (sibs.indexOf(cbDrag.wrap) < sibs.indexOf(target)) target.after(cbDrag.wrap);
  else target.before(cbDrag.wrap);
}
function cbDragCleanup() {
  clearTimeout(cbDrag && cbDrag.timer);
  document.removeEventListener('pointermove', cbDragMove);
  document.removeEventListener('pointerup', cbDragUp);
  document.removeEventListener('pointercancel', cbDragCancel);
  document.removeEventListener('touchmove', cbBlockScroll);
  if (cbDrag && cbDrag.wrap) cbDrag.wrap.classList.remove('dragging');
  cbDrag = null;
}
function cbDragCancel() {
  const started = cbDrag && cbDrag.started;
  cbDragCleanup();
  if (started) fetchMemos();
}
async function cbDragUp() {
  if (!cbDrag) return;
  const { wrap, started, orderBefore } = cbDrag;
  cbDragCleanup();
  if (!started) return;
  const ids = cbSiblings(wrap).map(w => w.dataset.blockId);
  if (ids.join() === orderBefore.join()) return; // 拖了又放回原位
  // 本地先同步 order（避免其他重畫把順序畫回去），再打後端；失敗重抓回真實順序
  ids.forEach((id, i) => { const b = customBlocks.find(x => String(x.id) === id); if (b) b.order = i + 1; });
  try {
    const res = await postTask({ type: 'block-sort', ids });
    if (!res || res.success === false) throw new Error((res && res.error) || '排序存檔失敗');
  } catch (err) {
    alert('排序更新失敗：' + err.message);
    await fetchMemos();
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
  document.getElementById('blockEditTitle').textContent = isNew ? '新增文字按鈕' : '編輯文字按鈕';
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

