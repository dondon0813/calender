// ===================================================================
// brandVendor.js — 團購廠商／品牌資料庫管理頁＋廠商/品牌檢視彈窗
//                  ＋排行事曆時的品牌資料庫比對（evTitleInput 連動）
//
// 載入順序鐵律：本檔必須在 admin.html 裡排在 admin.js「之前」。
// 理由：admin.js 開機還原分頁時會在最外層同步呼叫 switchView('brandVendor')
// → renderBrandVendorView()；本檔若排在後面，開機當下函式還不存在，整頁變磚。
//
// 本檔最外層只有「宣告」與「DOM 事件掛載」，不得在最外層直接呼叫 admin.js 的函式。
// 執行期依賴 admin.js 的全域：vendorDb / brandDb（宣告與寫入都在 admin.js 資料層，
// 本檔只讀）、allEvents、postTask、escHtml、fmtSingleDate、eventEditCtx、
// isViewShown、loadData 等——都在事件/函式內才會被讀到，載入順序安全。
// ===================================================================

// ----- 模組層狀態（開機期就會被讀到，一律放檔案最前段） -----
// 品牌廠商管理頁的搜尋列
let bvSearchScope = 'vendor';
// 封存廠商預設不顯示（只合作過一兩次的，資料留著但不佔版面）
let bvShowArchived = false;

// ===== 【新】團購廠商／品牌資料庫管理 =====

function vendorNameById_(id) {
  const v = vendorDb.find(x => x.id === id);
  return v ? v.name : '';
}

// 品牌可對應多家廠商，回傳「甲、乙」這樣的字串
function vendorNamesOf_(brand) {
  return (brand.vendorIds || []).map(vendorNameById_).filter(Boolean).join('、');
}

// 合作狀態：兩個旗標組合出三種狀態。已結束優先顯示，因為那是最需要一眼看到的
function bvCoopState_(brand) {
  if (brand.ended) return { text: '已結束', cls: 'ended' };
  if (brand.longTerm) return { text: '長期合作', cls: 'longterm' };
  return { text: '一般合作', cls: 'normal' };
}

// 「結束原因」只有勾了「已結束合作」才有意義，沒勾就收起來
function bvSyncEndReason_() {
  const on = document.getElementById('brandEndedInput').checked;
  document.getElementById('brandEndReasonWrap').style.display = on ? '' : 'none';
}
function bvSyncVendorEndReason_() {
  const on = document.getElementById('vendorEndedInput').checked;
  document.getElementById('vendorEndReasonWrap').style.display = on ? '' : 'none';
}

// 品牌自己沒標結束，但它的所屬廠商「全部」都結束了 → 這個品牌實際上也接不到團了，要提示。
// ⚠️ 只要還有一家廠商在合作就不算（例：藍海饌的鼎珈結束了，但改跟樂奎合作，品牌還活著）。
function bvAllVendorsEnded_(brand) {
  const ids = brand.vendorIds || [];
  if (!ids.length) return false;
  const vs = ids.map(id => vendorDb.find(v => v.id === id)).filter(Boolean);
  return vs.length > 0 && vs.every(v => v.ended);
}

// 有沒有分潤權限。沒權限的人後端根本不會回傳 commission* 欄位，
// 這裡再把 UI 收掉，避免出現空欄位讓人以為是「還沒填」。
function bvCanSeeCommission_() {
  return typeof hasPerm === 'function' ? hasPerm('commission') : true;
}

// 分潤顯示用：數字欄＋說明欄合成一句（例：10%（滿萬 12%））。兩欄都空就回 ''＝還沒登記分潤
function bvCommissionText_(brand) {
  const rate = brand.commissionRate;
  const hasRate = rate !== '' && rate !== null && rate !== undefined;
  const note = String(brand.commissionNote || '').trim();
  if (hasRate && note) return rate + '%（' + note + '）';
  if (hasRate) return rate + '%';
  return note;
}

// 品牌廠商頁搜尋：scope 決定搜尋對象，有關鍵字時只顯示該區塊
// bvSearchScope 宣告在檔案最前段（避免開機期 TDZ），見 VIEW_ID_MAP 附近

function bvSearchText_() {
  const el = document.getElementById('bvSearchInput');
  return el ? (el.value || '').trim().toLowerCase() : '';
}

// 把多個欄位串成一條可比對的字串
function bvMatch_(kw, fields) {
  if (!kw) return true;
  return fields.filter(Boolean).join(' ').toLowerCase().indexOf(kw) !== -1;
}

function renderBrandVendorView() {
  const kw = bvSearchText_();
  const vSec = document.getElementById('bvVendorSection');
  const bSec = document.getElementById('bvBrandSection');
  // 沒輸入關鍵字＝維持原本兩區都看得到；一旦搜尋就只留下被搜尋的那一區
  if (vSec) vSec.style.display = (!kw || bvSearchScope === 'vendor') ? '' : 'none';
  if (bSec) bSec.style.display = (!kw || bvSearchScope === 'brand') ? '' : 'none';
  renderVendorDbList();
  renderBrandDbList();
}

function renderVendorDbList() {
  const el = document.getElementById('vendorDbList');
  if (!el) return;
  el.innerHTML = '';
  if (!vendorDb.length) {
    el.innerHTML = '<div class="task-empty">還沒有廠商資料，點上面「＋新增廠商」開始建立吧</div>';
    return;
  }
  const kw = bvSearchScope === 'vendor' ? bvSearchText_() : '';
  // 封存的平常不顯示，但「有在搜尋」或「按了顯示封存」時要找得到——
  // 封存的意思是「不佔版面」，不是「查不到」，不然留著資料就沒意義了
  const showArchived = bvShowArchived || !!kw;
  const list = vendorDb
    .filter(v => showArchived || !v.archived)
    .filter(v => bvMatch_(kw, [v.id, v.name, v.type, v.note, v.companyNames]));
  const hiddenCount = vendorDb.filter(v => v.archived).length;
  const toggle = document.getElementById('bvArchivedToggle');
  if (toggle) {
    toggle.style.display = hiddenCount ? '' : 'none';
    toggle.textContent = (bvShowArchived ? '隱藏' : '顯示') + '封存的 ' + hiddenCount + ' 家';
    toggle.classList.toggle('on', bvShowArchived);
  }
  if (!list.length) {
    el.innerHTML = '<div class="bv-search-empty">找不到符合「' + escHtml(kw) + '」的廠商</div>';
    return;
  }
  list.forEach(v => {
    const brandCount = brandDb.filter(b => (b.vendorIds || []).indexOf(v.id) !== -1).length;
    const row = document.createElement('div');
    row.className = 'cal-edit-day-row';
    const vst = bvCoopState_(v);
    if (vst.cls === 'ended' || v.archived) row.style.opacity = '.5';
    row.innerHTML =
      `<span class="cal-edit-day-swatch" style="background:#7AAEEB;"></span>` +
      `<span class="cal-edit-day-row-name">${escHtml(v.id)}　${escHtml(v.name)}${v.type ? '（' + escHtml(v.type) + '）' : ''}` +
      `<span class="bv-coop ${vst.cls}">${vst.text}</span></span>` +
      `<span class="cal-edit-day-row-tag">${brandCount} 個品牌</span>`;
    row.addEventListener('click', () => {
      if (brandVendorEditMode) openVendorEditModal(v);
      else openVendorDetailModal(v);
    });
    el.appendChild(row);
  });
}

function renderBrandDbList() {
  const el = document.getElementById('brandDbList');
  if (!el) return;
  el.innerHTML = '';
  if (!brandDb.length) {
    el.innerHTML = '<div class="task-empty">還沒有品牌資料，點上面「＋新增品牌」開始建立吧</div>';
    return;
  }
  const kw = bvSearchScope === 'brand' ? bvSearchText_() : '';
  const list = brandDb.filter(b => bvMatch_(kw, [b.id, b.name, vendorNamesOf_(b), b.intro, b.note, b.commissionNote, b.commissionRate]));
  if (!list.length) {
    el.innerHTML = '<div class="bv-search-empty">找不到符合「' + escHtml(kw) + '」的品牌</div>';
    return;
  }
  list.forEach(b => {
    const row = document.createElement('div');
    row.className = 'cal-edit-day-row';
    const vendorName = vendorNamesOf_(b);
    const st = bvCoopState_(b);
    // 已結束合作的整列淡化，才不會跟現役品牌混在一起
    if (st.cls === 'ended') row.style.opacity = '.5';
    // 右側標籤直接秀分潤，才能一眼掃出哪些品牌還沒登記（沒權限的人不顯示這個標籤）。
    // 徽章只放短字（%數或截短的說明）——完整說明可能很長（歷史成數紀錄），放進徽章會把整列排版擠爆，
    // 全文改放 title 滑過顯示；編輯/詳情彈窗仍顯示全文。
    const commission = bvCanSeeCommission_() ? bvCommissionText_(b) : null;
    let commissionShort = '';
    if (commission) {
      const hasRate = b.commissionRate !== '' && b.commissionRate !== null && b.commissionRate !== undefined;
      const note = String(b.commissionNote || '').trim();
      commissionShort = hasRate ? b.commissionRate + '%' : (note.length > 8 ? note.slice(0, 8) + '…' : note);
    }
    const tagHtml = !bvCanSeeCommission_() ? '' :
      `<span class="cal-edit-day-row-tag"${commission ? ` title="${escHtml(commission)}"` : ' style="opacity:.45;"'}>${commission ? '💰 ' + escHtml(commissionShort) : '分潤未填'}</span>`;
    row.innerHTML =
      `<span class="cal-edit-day-swatch" style="background:#FF8FA3;"></span>` +
      `<span class="cal-edit-day-row-name">${escHtml(b.id)}　${escHtml(b.name)}${vendorName ? '（' + escHtml(vendorName) + '）' : ''}` +
      `<span class="bv-coop ${st.cls}">${st.text}</span></span>` +
      tagHtml;
    row.addEventListener('click', () => {
      if (brandVendorEditMode) openBrandEditModal(b);
      else openBrandDetailModal(b);
    });
    el.appendChild(row);
  });
}

// 品牌廠商頁的編輯模式開關：關閉時點列表只看資料，開啟才會跳出編輯視窗
let brandVendorEditMode = false;
document.getElementById('bvEditToggleWrap').addEventListener('click', () => {
  // 沒有品牌廠商編輯權限的人，開關已經藏起來了，這裡再擋一次（保險）
  if (typeof hasEditPerm === 'function' && !hasEditPerm('brandVendorEdit')) return;
  brandVendorEditMode = !brandVendorEditMode;
  document.getElementById('bvEditSwitch').classList.toggle('on', brandVendorEditMode);
});

// 品牌廠商頁搜尋列接線
document.querySelectorAll('.bv-scope-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    bvSearchScope = btn.dataset.scope;
    document.querySelectorAll('.bv-scope-btn').forEach(b => b.classList.toggle('on', b === btn));
    const input = document.getElementById('bvSearchInput');
    if (input) {
      input.placeholder = bvSearchScope === 'vendor' ? '搜尋廠商…' : '搜尋品牌…';
      input.focus();
    }
    renderBrandVendorView();
  });
});
document.getElementById('bvSearchInput').addEventListener('input', () => renderBrandVendorView());
document.getElementById('bvSearchClearBtn').addEventListener('click', () => {
  document.getElementById('bvSearchInput').value = '';
  renderBrandVendorView();
});

let vendorEditCtx = null;

function openVendorEditModal(vendor) {
  vendorEditCtx = { isNew: !vendor, vendor };
  document.getElementById('vendorEditTitle').textContent = vendor ? '✏️ 編輯廠商' : '➕ 新增廠商';
  document.getElementById('vendorDeleteBtn').style.display = vendor ? 'inline-block' : 'none';
  setFormStatus('vendorEditStatus', '', '');
  document.getElementById('vendorNameInput').value = vendor ? vendor.name : '';
  document.getElementById('vendorTypeSelect').value = vendor ? (vendor.type || '廠商') : '廠商';
  document.getElementById('vendorRemitMethodInput').value = vendor ? vendor.remittanceMethod : '';
  document.getElementById('vendorRemitRuleInput').value = vendor ? vendor.remittanceRule : '';
  document.getElementById('vendorContactInput').value = vendor ? vendor.contact : '';
  document.getElementById('vendorCompanyNamesInput').value = vendor ? (vendor.companyNames || '') : '';
  document.getElementById('vendorLongTermInput').checked = vendor ? !!vendor.longTerm : false;
  document.getElementById('vendorEndedInput').checked = vendor ? !!vendor.ended : false;
  document.getElementById('vendorEndReasonInput').value = vendor ? (vendor.endReason || '') : '';
  document.getElementById('vendorArchivedInput').checked = vendor ? !!vendor.archived : false;
  bvSyncVendorEndReason_();
  document.getElementById('vendorNoteInput').value = vendor ? vendor.note : '';
  document.getElementById('vendorEditModal').classList.add('show');
}
function closeVendorEditModal() {
  document.getElementById('vendorEditModal').classList.remove('show');
  vendorEditCtx = null;
}
document.getElementById('vendorSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('vendorNameInput').value.trim();
  if (!name) { setFormStatus('vendorEditStatus', '請輸入廠商名稱', 'error'); return; }
  const payload = {
    name,
    vendorType: document.getElementById('vendorTypeSelect').value,
    remittanceMethod: document.getElementById('vendorRemitMethodInput').value.trim(),
    remittanceRule: document.getElementById('vendorRemitRuleInput').value.trim(),
    contact: document.getElementById('vendorContactInput').value.trim(),
    companyNames: document.getElementById('vendorCompanyNamesInput').value.trim(),
    longTerm: document.getElementById('vendorLongTermInput').checked,
    ended: document.getElementById('vendorEndedInput').checked,
    endReason: document.getElementById('vendorEndReasonInput').value.trim(),
    archived: document.getElementById('vendorArchivedInput').checked,
    note: document.getElementById('vendorNoteInput').value.trim()
  };
  const btn = document.getElementById('vendorSaveBtn');
  btn.disabled = true;
  setFormStatus('vendorEditStatus', '儲存中…', '');
  try {
    if (vendorEditCtx.isNew) {
      await postTask(Object.assign({ type: 'vendor-db-add' }, payload));
    } else {
      await postTask(Object.assign({ type: 'vendor-db-update', id: vendorEditCtx.vendor.id }, payload));
    }
    closeVendorEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('vendorEditStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
document.getElementById('vendorDeleteBtn').addEventListener('click', async () => {
  if (!vendorEditCtx || vendorEditCtx.isNew) return;
  if (!confirm('確定要刪除「' + vendorEditCtx.vendor.name + '」這個廠商嗎？底下的品牌不會被刪除，只會解除連結')) return;
  const btn = document.getElementById('vendorDeleteBtn');
  btn.disabled = true;
  setFormStatus('vendorEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'vendor-db-delete', id: vendorEditCtx.vendor.id });
    closeVendorEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('vendorEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});

let brandEditCtx = null;

// 複選版：currentIds 是陣列。不選＝不指定廠商
function fillVendorSelect(selectEl, currentIds) {
  const selected = currentIds || [];
  selectEl.innerHTML = '';
  vendorDb.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.id + '　' + v.name;
    opt.selected = selected.indexOf(v.id) !== -1;
    selectEl.appendChild(opt);
  });
}

function getSelectedVendorIds(selectEl) {
  return Array.from(selectEl.selectedOptions).map(o => o.value).filter(Boolean);
}

function openBrandEditModal(brand) {
  brandEditCtx = { isNew: !brand, brand };
  document.getElementById('brandEditTitle').textContent = brand ? '✏️ 編輯品牌' : '➕ 新增品牌';
  document.getElementById('brandDeleteBtn').style.display = brand ? 'inline-block' : 'none';
  setFormStatus('brandEditStatus', '', '');
  fillVendorSelect(document.getElementById('brandVendorSelect'), brand ? brand.vendorIds : []);
  document.getElementById('brandNameInput').value = brand ? brand.name : '';
  document.getElementById('brandThumbInput').value = brand ? (brand.thumbUrl || '') : '';
  document.getElementById('brandBrandImageInput').value = brand ? (brand.brandImageUrl || '') : '';
  document.getElementById('brandLineInput').value = brand ? brand.lineContact : '';
  document.getElementById('brandEmailInput').value = brand ? brand.emailContact : '';
  document.getElementById('brandIgInput').value = brand ? brand.igContact : '';
  document.getElementById('brandCommissionRateInput').value = brand && brand.commissionRate !== '' && brand.commissionRate !== undefined ? brand.commissionRate : '';
  document.getElementById('brandCommissionNoteInput').value = brand ? (brand.commissionNote || '') : '';
  document.getElementById('brandLongTermInput').checked = brand ? !!brand.longTerm : false;
  document.getElementById('brandEndedInput').checked = brand ? !!brand.ended : false;
  document.getElementById('brandEndReasonInput').value = brand ? (brand.endReason || '') : '';
  bvSyncEndReason_();
  document.getElementById('brandNoteInput').value = brand ? brand.note : '';
  document.getElementById('brandShowInRecipeInput').checked = brand ? !!brand.showInRecipe : false;
  document.getElementById('brandIntroInput').value = brand ? (brand.intro || '') : '';
  document.getElementById('brandShopeeInput').value = brand ? (brand.shopeeUrl || '') : '';
  document.getElementById('brandPostTemplateInput').value = brand ? (brand.postTemplate || '') : '';
  document.getElementById('brandEditModal').classList.add('show');
}
function closeBrandEditModal() {
  document.getElementById('brandEditModal').classList.remove('show');
  brandEditCtx = null;
}
document.getElementById('brandSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('brandNameInput').value.trim();
  if (!name) { setFormStatus('brandEditStatus', '請輸入品牌名稱', 'error'); return; }
  const payload = {
    vendorIds: getSelectedVendorIds(document.getElementById('brandVendorSelect')),
    name,
    thumbUrl: document.getElementById('brandThumbInput').value.trim(),
    brandImageUrl: document.getElementById('brandBrandImageInput').value.trim(),
    lineContact: document.getElementById('brandLineInput').value.trim(),
    emailContact: document.getElementById('brandEmailInput').value.trim(),
    igContact: document.getElementById('brandIgInput').value.trim(),
    // 分潤% 留空就送空字串（等於「還沒談定」），後端不會硬塞 0
    commissionRate: document.getElementById('brandCommissionRateInput').value.trim(),
    commissionNote: document.getElementById('brandCommissionNoteInput').value.trim(),
    longTerm: document.getElementById('brandLongTermInput').checked,
    ended: document.getElementById('brandEndedInput').checked,
    endReason: document.getElementById('brandEndReasonInput').value.trim(),
    note: document.getElementById('brandNoteInput').value.trim(),
    showInRecipe: document.getElementById('brandShowInRecipeInput').checked,
    intro: document.getElementById('brandIntroInput').value.trim(),
    shopeeUrl: document.getElementById('brandShopeeInput').value.trim(),
    // 只修頭尾空白，內文換行是貼文排版的一部分，不能動
    postTemplate: document.getElementById('brandPostTemplateInput').value.trim()
  };
  const btn = document.getElementById('brandSaveBtn');
  btn.disabled = true;
  setFormStatus('brandEditStatus', '儲存中…', '');
  try {
    if (brandEditCtx.isNew) {
      await postTask(Object.assign({ type: 'brand-db-add' }, payload));
    } else {
      await postTask(Object.assign({ type: 'brand-db-update', id: brandEditCtx.brand.id }, payload));
    }
    closeBrandEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('brandEditStatus', '儲存失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
document.getElementById('brandDeleteBtn').addEventListener('click', async () => {
  if (!brandEditCtx || brandEditCtx.isNew) return;
  if (!confirm('確定要刪除「' + brandEditCtx.brand.name + '」這個品牌嗎？')) return;
  const btn = document.getElementById('brandDeleteBtn');
  btn.disabled = true;
  setFormStatus('brandEditStatus', '刪除中…', '');
  try {
    await postTask({ type: 'brand-db-delete', id: brandEditCtx.brand.id });
    closeBrandEditModal();
    await fetchMemos();
  } catch (err) {
    setFormStatus('brandEditStatus', '刪除失敗：' + err.message, 'error');
  }
  btn.disabled = false;
});
document.getElementById('vendorDbAddBtn').addEventListener('click', () => openVendorEditModal(null));
document.getElementById('brandDbAddBtn').addEventListener('click', () => openBrandEditModal(null));
document.getElementById('brandEndedInput').addEventListener('change', bvSyncEndReason_);
document.getElementById('vendorEndedInput').addEventListener('change', bvSyncVendorEndReason_);
document.getElementById('bvArchivedToggle').addEventListener('click', () => {
  bvShowArchived = !bvShowArchived;
  renderVendorDbList();
});

// ===== 【新】廠商資料檢視（唯讀）：非編輯模式點廠商，顯示資料＋底下的品牌 =====
let vendorDetailCtx = null;
function openVendorDetailModal(vendor) {
  vendorDetailCtx = vendor;
  document.getElementById('vendorDetailTitle').textContent = `🏭 ${vendor.name}${vendor.type ? '（' + vendor.type + '）' : ''}`;

  const lines = [];
  lines.push(`<div><b>廠商編號：</b>${escHtml(vendor.id)}</div>`);
  const vst = bvCoopState_(vendor);
  lines.push(`<div><b>合作狀態：</b>${vst.text}${vendor.ended && vendor.endReason ? '（' + escHtml(vendor.endReason) + '）' : ''}` +
    `${vendor.archived ? '　<span class="bv-coop ended">已封存</span>' : ''}</div>`);
  lines.push(`<div><b>類型：</b>${escHtml(vendor.type || '－')}</div>`);
  if (vendor.companyNames) lines.push(`<div><b>公司名稱：</b>${escHtml(vendor.companyNames)}</div>`);
  if (vendor.remittanceMethod) lines.push(`<div><b>匯款方式：</b>${escHtml(vendor.remittanceMethod)}</div>`);
  if (vendor.remittanceRule) lines.push(`<div><b>請款／匯款規則：</b>${escHtml(vendor.remittanceRule)}</div>`);
  if (vendor.contact) lines.push(`<div><b>聯絡窗口：</b>${escHtml(vendor.contact)}</div>`);
  if (vendor.note) lines.push(`<div><b>備註：</b>${escHtml(vendor.note)}</div>`);
  document.getElementById('vendorDetailBody').innerHTML = lines.join('');

  const brands = brandDb.filter(b => (b.vendorIds || []).indexOf(vendor.id) !== -1);
  const listEl = document.getElementById('vendorDetailBrandList');
  listEl.innerHTML = '';
  if (!brands.length) {
    listEl.innerHTML = '<div class="task-empty">這個廠商底下還沒有連結任何品牌</div>';
  } else {
    brands.forEach(b => {
      const row = document.createElement('div');
      row.className = 'cal-edit-day-row';
      row.innerHTML =
        `<span class="cal-edit-day-swatch" style="background:#FF8FA3;"></span>` +
        `<span class="cal-edit-day-row-name">${escHtml(b.name)}</span>`;
      row.addEventListener('click', () => {
        closeVendorDetailModal();
        openBrandDetailModal(b);
      });
      listEl.appendChild(row);
    });
  }

  // 帳務摘要由 accounting.js 負責（它排在本檔之後載入，執行期一定在）
  const vAcctBox = document.getElementById('vendorDetailAcct');
  if (vAcctBox) vAcctBox.innerHTML = '';
  if (typeof renderVendorAcctSummary === 'function') renderVendorAcctSummary(vendor.id);

  document.getElementById('vendorDetailModal').classList.add('show');
}
function closeVendorDetailModal() {
  document.getElementById('vendorDetailModal').classList.remove('show');
  vendorDetailCtx = null;
}
document.getElementById('vendorDetailEditBtn').addEventListener('click', () => {
  if (!vendorDetailCtx) return;
  const vendor = vendorDetailCtx;
  closeVendorDetailModal();
  openVendorEditModal(vendor);
});

// ===== 品牌比對共用工具 =====
// 行事曆標題多半是「品牌＋產品名」（例：林貝兒米餅、Jolly 推車），
// 所以比對一律用「正規化後標題包含品牌名」的模糊比對，跟前台 school-list 同一套規則。
// 標點一併去掉：品牌正式名稱帶符號（「Wewee!」「Scoot&Ride」）而團名沒打符號時，只去空格會比對不到。
function bvNormBrandKey_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '');
}

// 找出標題裡包含的所有品牌（一團可對到多品牌，例：聯名團標題同時含兩個品牌名）。
// 若比對到的某品牌名是另一個比對到品牌名的一部分（例：B21 vs B21pro），只留長的那個，避免誤配。
function bvBrandsInTitle_(title) {
  const key = bvNormBrandKey_(title);
  if (!key) return [];
  const matched = brandDb.filter(b => {
    const bk = bvNormBrandKey_(b.name);
    return bk && key.indexOf(bk) !== -1;
  });
  return matched.filter(b => {
    const bk = bvNormBrandKey_(b.name);
    return !matched.some(o => {
      const ok = bvNormBrandKey_(o.name);
      return ok.length > bk.length && ok.indexOf(bk) !== -1;
    });
  });
}

function bvEventMatchesBrand_(ev, brand) {
  return bvBrandsInTitle_(ev.title).some(b => b.id === brand.id);
}

// ===== 【新】品牌資料檢視（唯讀）：非編輯模式點品牌，顯示資料＋所屬廠商＋未來／過去的開團 =====
// 過去開團＝行事曆比對到的團＋帳務裡有這個品牌、但行事曆已經找不到對應檔期的團（見 accounting.js 的 acctPastGroupBuysForBrand_）。
function getBrandGroupBuys_(brand) {
  const todayStart = startOfDay(new Date());
  const calendarMatches = allEvents.filter(ev => bvEventMatchesBrand_(ev, brand));
  const acctOnly = typeof acctPastGroupBuysForBrand_ === 'function' ? acctPastGroupBuysForBrand_(brand, calendarMatches) : [];
  const matched = calendarMatches.concat(acctOnly);
  const upcoming = matched.filter(ev => startOfDay(ev.displayEnd) >= todayStart).sort((a, b) => a.start - b.start);
  const past = matched.filter(ev => startOfDay(ev.displayEnd) < todayStart).sort((a, b) => b.start - a.start);
  return { upcoming, past };
}
function renderBrandGroupBuyRow_(ev) {
  const row = document.createElement('div');
  row.className = 'cal-edit-day-row';
  const dateLabel = isSameDate(ev.start, ev.displayEnd) ? fmtSingleDate(ev.start) : (fmtSingleDate(ev.start) + '－' + fmtSingleDate(ev.displayEnd));
  // 帳務補進來的團沒有真正的行事曆事件可以點開編輯，只標示來源，不掛點擊
  const tag = ev.fromAccounting ? '　<span style="opacity:.6;">（僅帳務紀錄，行事曆已無此團）</span>' : '';
  row.innerHTML =
    `<span class="cal-edit-day-swatch" style="background:${ev.color || '#7AAEEB'};"></span>` +
    `<span class="cal-edit-day-row-name">${dateLabel}　${escHtml(ev.title)}${tag}</span>`;
  if (!ev.fromAccounting) {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      closeBrandDetailModal();
      if (brandVendorEditMode) openEventEditModal(ev);
      else openAdminModal(ev);
    });
  }
  return row;
}

// 畫「即將開團」「過去開團」兩個清單；抽成函式是因為帳務資料可能是非同步補到的，
// 要能在同一個品牌還開著時重畫一次（見 openBrandDetailModal）。回傳 upcoming 供貼文文案按鈕判斷。
function bvRenderBrandGroupBuyLists_(brand) {
  const { upcoming, past } = getBrandGroupBuys_(brand);

  const upcomingEl = document.getElementById('brandDetailUpcomingList');
  upcomingEl.innerHTML = '';
  if (!upcoming.length) {
    upcomingEl.innerHTML = '<div class="task-empty">目前沒有排定中的開團</div>';
  } else {
    upcoming.forEach(ev => upcomingEl.appendChild(renderBrandGroupBuyRow_(ev)));
  }

  document.getElementById('brandDetailPastCount').textContent = past.length;
  const pastEl = document.getElementById('brandDetailPastList');
  pastEl.innerHTML = '';
  if (!past.length) {
    pastEl.innerHTML = '<div class="task-empty">還沒有過去的開團紀錄</div>';
  } else {
    past.forEach(ev => pastEl.appendChild(renderBrandGroupBuyRow_(ev)));
  }

  document.getElementById('brandDetailPostGenBtn').style.display =
    String(brand.postTemplate || '').trim() && upcoming.length ? 'block' : 'none';

  return upcoming;
}

let brandDetailCtx = null;
function openBrandDetailModal(brand) {
  brandDetailCtx = brand;
  document.getElementById('brandDetailTitle').textContent = `🏷 ${brand.name}`;

  const lines = [];
  const vendorName = vendorNamesOf_(brand);
  const dst = bvCoopState_(brand);
  lines.push(`<div><b>合作狀態：</b>${dst.text}${brand.ended && brand.endReason ? '（' + escHtml(brand.endReason) + '）' : ''}</div>`);
  // 品牌本身還在，但所屬廠商全結束了＝實際上接不到團，提示但不自動改品牌狀態
  if (!brand.ended && bvAllVendorsEnded_(brand)) {
    lines.push('<div style="color:var(--c-danger); font-weight:800;">⚠ 所屬廠商都已結束合作，這個品牌目前接不到團</div>');
  }
  lines.push(`<div><b>所屬廠商：</b>${vendorName ? escHtml(vendorName) : '－'}</div>`);
  // 分潤沒填也要顯示「尚未登記」，不然會分不出「沒填」和「這個彈窗不顯示分潤」
  if (bvCanSeeCommission_()) {
    const commission = bvCommissionText_(brand);
    lines.push(`<div><b>分潤：</b>${commission ? escHtml(commission) : '尚未登記'}</div>`);
  }
  if (brand.lineContact) lines.push(`<div><b>LINE窗口：</b>${escHtml(brand.lineContact)}</div>`);
  if (brand.emailContact) lines.push(`<div><b>Email窗口：</b>${escHtml(brand.emailContact)}</div>`);
  if (brand.igContact) lines.push(`<div><b>IG窗口：</b>${escHtml(brand.igContact)}</div>`);
  if (brand.intro) lines.push(`<div><b>品牌介紹：</b>${escHtml(brand.intro)}</div>`);
  if (brand.shopeeUrl) lines.push(`<div><b>蝦皮連結：</b><a href="${escHtml(brand.shopeeUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(brand.shopeeUrl)}</a></div>`);
  if (brand.note) lines.push(`<div><b>備註：</b>${escHtml(brand.note)}</div>`);
  document.getElementById('brandDetailBody').innerHTML = lines.join('');

  bvRenderBrandGroupBuyLists_(brand);

  // 每次打開都先收合「過去的團」，畫面維持乾淨
  document.getElementById('brandDetailPastToggle').classList.remove('open');
  document.getElementById('brandDetailPastBody').style.display = 'none';

  // 帳務摘要由 accounting.js 負責（它排在本檔之後載入，執行期一定在）。
  // 非同步：第一次打開會去拉帳務資料，拉回來前先顯示載入中。
  const acctBox = document.getElementById('brandDetailAcct');
  if (acctBox) acctBox.innerHTML = '';
  if (typeof renderBrandAcctSummary === 'function') renderBrandAcctSummary(brand.id);
  // 過去開團清單也依賴帳務資料（acctPastGroupBuysForBrand_）：第一次開帳務可能還沒載入過，
  // 這裡沒資料就先用行事曆比對到的畫，帳務拉回來後同一個品牌還開著就重畫一次補上。
  if (typeof loadAccounting === 'function' && !acctLoaded) {
    loadAccounting().then(() => {
      if (brandDetailCtx && brandDetailCtx.id === brand.id) bvRenderBrandGroupBuyLists_(brand);
    }).catch(() => {});
  }

  document.getElementById('brandDetailModal').classList.add('show');
}
function closeBrandDetailModal() {
  document.getElementById('brandDetailModal').classList.remove('show');
  brandDetailCtx = null;
}
document.getElementById('brandDetailEditBtn').addEventListener('click', () => {
  if (!brandDetailCtx) return;
  const brand = brandDetailCtx;
  closeBrandDetailModal();
  openBrandEditModal(brand);
});
document.getElementById('brandDetailPastToggle').addEventListener('click', () => {
  const toggle = document.getElementById('brandDetailPastToggle');
  const open = !toggle.classList.contains('open');
  toggle.classList.toggle('open', open);
  document.getElementById('brandDetailPastBody').style.display = open ? '' : 'none';
});

// ===== 【新】排行事曆時：團名跟品牌資料庫模糊比對（標題包含品牌名），自動帶出參考資訊 =====
// 過去開團＝行事曆比對到的團＋帳務裡有這個品牌、但行事曆已經找不到對應檔期的團
// （行事曆表是活表，團開完常被清掉；帳務才是永久紀錄。見 accounting.js 的 acctPastGroupBuysForBrand_）。
function findGroupBuyDatesForBrand_(brand, excludeEventId) {
  const calendarMatches = allEvents.filter(ev => ev.id !== excludeEventId && bvEventMatchesBrand_(ev, brand));
  const acctOnly = typeof acctPastGroupBuysForBrand_ === 'function' ? acctPastGroupBuysForBrand_(brand, calendarMatches) : [];
  return calendarMatches.concat(acctOnly)
    .sort((a, b) => b.start - a.start)
    .slice(0, 8);
}

function renderEvBrandMatchInfo() {
  const box = document.getElementById('evBrandMatchInfo');
  if (!box) return;
  const title = document.getElementById('evTitleInput').value.trim();
  const excludeId = eventEditCtx && !eventEditCtx.isNew ? eventEditCtx.ev.id : null;

  if (!title) { box.style.display = 'none'; box.innerHTML = ''; return; }
  // 一團可比對到多個品牌（聯名團），每個品牌各出一個資訊區塊
  const matchedBrands = bvBrandsInTitle_(title);
  if (!matchedBrands.length) { box.style.display = 'none'; box.innerHTML = ''; return; }

  // 帳務資料可能這個 session 還沒載過（要開過帳務分頁或品牌檢視彈窗才會拉），
  // 沒資料時「過去開團」會先漏掉帳務補的那些團，拉回來後同一個標題還在就重畫一次。
  if (typeof loadAccounting === 'function' && !acctLoaded) {
    loadAccounting().then(renderEvBrandMatchInfo).catch(() => {});
  }

  const blocks = matchedBrands.map(brand => {
    const vendors = (brand.vendorIds || []).map(vid => vendorDb.find(v => v.id === vid)).filter(Boolean);
    const pastDates = findGroupBuyDatesForBrand_(brand, excludeId);

    let html = `<div style="font-weight:900; color:#4a7fb5; margin-bottom:6px;">📇 比對到品牌資料庫：${escHtml(brand.name)}</div>`;
    const lines = [];
    const commission = bvCanSeeCommission_() ? bvCommissionText_(brand) : '';
    if (commission) lines.push('分潤：' + commission);
    if (brand.lineContact) lines.push('LINE窗口：' + brand.lineContact);
    if (brand.emailContact) lines.push('Email窗口：' + brand.emailContact);
    if (brand.igContact) lines.push('IG窗口：' + brand.igContact);
    vendors.forEach(vendor => {
      const prefix = vendors.length > 1 ? '［' + vendor.name + '］' : '';
      lines.push('所屬廠商：' + vendor.name + (vendor.type ? '（' + vendor.type + '）' : ''));
      if (vendor.remittanceMethod) lines.push(prefix + '匯款方式：' + vendor.remittanceMethod);
      if (vendor.remittanceRule) lines.push(prefix + '請款規則：' + vendor.remittanceRule);
      if (vendor.contact) lines.push(prefix + '廠商窗口：' + vendor.contact);
    });
    if (brand.note) lines.push('品牌備註：' + brand.note);
    if (lines.length) html += lines.map(l => escHtml(l)).join('<br>');
    if (pastDates.length) {
      // 同品牌不同產品會分團開，所以日期後面帶團名才分得出是哪一團；
      // 帳務補的團沒有結束日、只有單一日期，且標註來源避免跟行事曆團搞混
      html += '<div style="margin-top:6px;">🗓 過去開團：' +
        pastDates.map(ev => {
          const dateLabel = isSameDate(ev.start, ev.displayEnd) ? fmtSingleDate(ev.start) : (fmtSingleDate(ev.start) + '–' + fmtSingleDate(ev.displayEnd));
          return dateLabel + '（' + escHtml(ev.title) + (ev.fromAccounting ? '・帳務紀錄' : '') + '）';
        }).join('、') + '</div>';
    }
    return html;
  });

  box.innerHTML = blocks.join('<div style="border-top:1px dashed rgba(0,0,0,.25); margin:8px 0;"></div>');
  box.style.display = 'block';
}

document.getElementById('evTitleInput').addEventListener('input', () => {
  clearTimeout(window._evBrandMatchTimer);
  window._evBrandMatchTimer = setTimeout(renderEvBrandMatchInfo, 300);
});

// ===== 產生貼文文案 =====
// 按鈕有兩顆：活動「檢視」彈窗（#evPostGenBtn，在 adminModal 裡）與品牌檢視彈窗（#brandDetailPostGenBtn）。
// 顯示條件：對應品牌有存「貼文文案模板」；品牌檢視那顆另外要求有進行中/即將開的團。

function bvBrandsWithPostTemplate_(title) {
  if (!title) return [];
  return bvBrandsInTitle_(title).filter(b => String(b.postTemplate || '').trim());
}

// 貼文用日期：Date → M/D（例：8/4）
function bvPostDateLabel_(d) {
  return d instanceof Date && !isNaN(d) ? (d.getMonth() + 1) + '/' + d.getDate() : '';
}

// 把模板佔位符換成當團資料。brand 來自 brandDb，ev 是行事曆活動物件
function bvBuildPostCopy_(brand, ev) {
  const url = ev.url || '';
  const startLabel = bvPostDateLabel_(ev.start);
  const endLabel = bvPostDateLabel_(ev.displayEnd || ev.end);
  const dateRange = startLabel && endLabel ? startLabel + ' ～ ' + endLabel : (startLabel || endLabel);
  const title = plainTitle(ev.title || '');
  let text = String(brand.postTemplate);
  // 正式佔位符
  text = text.split('{網址}').join(url)
    .split('{開團日}').join(startLabel)
    .split('{結團日}').join(endLabel)
    .split('{團名}').join(title);
  // 舊模板裡的人話佔位也吃得懂，直接貼既有文案不用先改成大括號
  text = text.split('<<這邊填入當團網址>>').join(url)
    .split('（放連結）').join(url)
    .split('（放日期）～（放日期）').join(dateRange);
  return text;
}

let postGenCtx_ = null; // { brands, ev }：多品牌時記住候選清單，供切換選項重新產生文案

function openPostGenModalWith_(text) {
  postGenCtx_ = null;
  document.getElementById('postGenBrandSelect').style.display = 'none';
  document.getElementById('postGenOutput').value = text;
  setFormStatus('postGenStatus', '', '');
  document.getElementById('postGenModal').classList.add('show');
}

// 聯名團比對到多個「有存模板」的品牌時，顯示下拉讓使用者自己選要用哪個品牌的文案
function openPostGenModalForBrands_(brands, ev) {
  const select = document.getElementById('postGenBrandSelect');
  if (brands.length <= 1) {
    openPostGenModalWith_(brands.length ? bvBuildPostCopy_(brands[0], ev) : '');
    return;
  }
  postGenCtx_ = { brands, ev };
  select.innerHTML = brands.map((b, i) => '<option value="' + i + '">' + escHtml(b.name) + '</option>').join('');
  select.selectedIndex = 0;
  select.style.display = 'block';
  document.getElementById('postGenOutput').value = bvBuildPostCopy_(brands[0], ev);
  setFormStatus('postGenStatus', '', '');
  document.getElementById('postGenModal').classList.add('show');
}

document.getElementById('postGenBrandSelect').addEventListener('change', function () {
  if (!postGenCtx_) return;
  const brand = postGenCtx_.brands[Number(this.value)];
  if (!brand) return;
  document.getElementById('postGenOutput').value = bvBuildPostCopy_(brand, postGenCtx_.ev);
});

// 活動檢視彈窗打開時由 openAdminModal 呼叫：比對到的品牌有存模板才顯示按鈕
function syncPostGenBtnForEvent_(ev) {
  const btn = document.getElementById('evPostGenBtn');
  if (!btn) return;
  btn.style.display = ev && bvBrandsWithPostTemplate_(ev.title).length ? 'block' : 'none';
}

document.getElementById('evPostGenBtn').addEventListener('click', () => {
  const ev = currentModalEv;
  if (!ev) return;
  const brands = bvBrandsWithPostTemplate_(ev.title);
  if (!brands.length) return;
  openPostGenModalForBrands_(brands, ev);
});

document.getElementById('brandDetailPostGenBtn').addEventListener('click', () => {
  const brand = brandDetailCtx;
  if (!brand || !String(brand.postTemplate || '').trim()) return;
  // upcoming 依開團日排序，進行中的團 displayEnd >= 今天所以也在裡面且排最前
  const ev = getBrandGroupBuys_(brand).upcoming[0];
  if (!ev) return;
  openPostGenModalWith_(bvBuildPostCopy_(brand, ev));
});

document.getElementById('postGenCopyBtn').addEventListener('click', async () => {
  const ta = document.getElementById('postGenOutput');
  if (!ta.value) return;
  try {
    await navigator.clipboard.writeText(ta.value);
  } catch (e) {
    ta.focus();
    ta.select();
    document.execCommand('copy');
  }
  setFormStatus('postGenStatus', '已複製到剪貼簿 ✓', 'ok');
});

function closePostGenModal() {
  document.getElementById('postGenModal').classList.remove('show');
}
