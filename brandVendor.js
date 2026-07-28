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

// ===== 【新】團購廠商／品牌資料庫管理 =====

function vendorNameById_(id) {
  const v = vendorDb.find(x => x.id === id);
  return v ? v.name : '';
}

// 品牌可對應多家廠商，回傳「甲、乙」這樣的字串
function vendorNamesOf_(brand) {
  return (brand.vendorIds || []).map(vendorNameById_).filter(Boolean).join('、');
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
  const list = vendorDb.filter(v => bvMatch_(kw, [v.id, v.name, v.type, v.note]));
  if (!list.length) {
    el.innerHTML = '<div class="bv-search-empty">找不到符合「' + escHtml(kw) + '」的廠商</div>';
    return;
  }
  list.forEach(v => {
    const brandCount = brandDb.filter(b => (b.vendorIds || []).indexOf(v.id) !== -1).length;
    const row = document.createElement('div');
    row.className = 'cal-edit-day-row';
    row.innerHTML =
      `<span class="cal-edit-day-swatch" style="background:#7AAEEB;"></span>` +
      `<span class="cal-edit-day-row-name">${escHtml(v.id)}　${escHtml(v.name)}${v.type ? '（' + escHtml(v.type) + '）' : ''}</span>` +
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
    // 右側標籤直接秀分潤，才能一眼掃出哪些品牌還沒登記（沒權限的人不顯示這個標籤）
    const commission = bvCanSeeCommission_() ? bvCommissionText_(b) : null;
    const tagHtml = !bvCanSeeCommission_() ? '' :
      `<span class="cal-edit-day-row-tag"${commission ? '' : ' style="opacity:.45;"'}>${commission ? '💰 ' + escHtml(commission) : '分潤未填'}</span>`;
    row.innerHTML =
      `<span class="cal-edit-day-swatch" style="background:#FF8FA3;"></span>` +
      `<span class="cal-edit-day-row-name">${escHtml(b.id)}　${escHtml(b.name)}${vendorName ? '（' + escHtml(vendorName) + '）' : ''}</span>` +
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
  if (typeof hasPerm === 'function' && !hasPerm('brandVendorEdit')) return;
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
  document.getElementById('brandNoteInput').value = brand ? brand.note : '';
  document.getElementById('brandShowInRecipeInput').checked = brand ? !!brand.showInRecipe : false;
  document.getElementById('brandIntroInput').value = brand ? (brand.intro || '') : '';
  document.getElementById('brandShopeeInput').value = brand ? (brand.shopeeUrl || '') : '';
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
    note: document.getElementById('brandNoteInput').value.trim(),
    showInRecipe: document.getElementById('brandShowInRecipeInput').checked,
    intro: document.getElementById('brandIntroInput').value.trim(),
    shopeeUrl: document.getElementById('brandShopeeInput').value.trim()
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

// ===== 【新】廠商資料檢視（唯讀）：非編輯模式點廠商，顯示資料＋底下的品牌 =====
let vendorDetailCtx = null;
function openVendorDetailModal(vendor) {
  vendorDetailCtx = vendor;
  document.getElementById('vendorDetailTitle').textContent = `🏭 ${vendor.name}${vendor.type ? '（' + vendor.type + '）' : ''}`;

  const lines = [];
  lines.push(`<div><b>廠商編號：</b>${escHtml(vendor.id)}</div>`);
  lines.push(`<div><b>類型：</b>${escHtml(vendor.type || '－')}</div>`);
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
function bvNormBrandKey_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
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
function getBrandGroupBuys_(brand) {
  const todayStart = startOfDay(new Date());
  const matched = allEvents.filter(ev => bvEventMatchesBrand_(ev, brand));
  const upcoming = matched.filter(ev => startOfDay(ev.displayEnd) >= todayStart).sort((a, b) => a.start - b.start);
  const past = matched.filter(ev => startOfDay(ev.displayEnd) < todayStart).sort((a, b) => b.start - a.start);
  return { upcoming, past };
}
function renderBrandGroupBuyRow_(ev) {
  const row = document.createElement('div');
  row.className = 'cal-edit-day-row';
  row.innerHTML =
    `<span class="cal-edit-day-swatch" style="background:${ev.color || '#7AAEEB'};"></span>` +
    `<span class="cal-edit-day-row-name">${fmtSingleDate(ev.start)}－${fmtSingleDate(ev.displayEnd)}　${escHtml(ev.title)}</span>`;
  row.addEventListener('click', () => {
    closeBrandDetailModal();
    if (brandVendorEditMode) openEventEditModal(ev);
    else openAdminModal(ev);
  });
  return row;
}

let brandDetailCtx = null;
function openBrandDetailModal(brand) {
  brandDetailCtx = brand;
  document.getElementById('brandDetailTitle').textContent = `🏷 ${brand.name}`;

  const lines = [];
  const vendorName = vendorNamesOf_(brand);
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
  // 每次打開都先收合「過去的團」，畫面維持乾淨
  document.getElementById('brandDetailPastToggle').classList.remove('open');
  document.getElementById('brandDetailPastBody').style.display = 'none';

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
function findGroupBuyDatesForBrand_(brand, excludeEventId) {
  return allEvents
    .filter(ev => ev.id !== excludeEventId && bvEventMatchesBrand_(ev, brand))
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
      // 同品牌不同產品會分團開，所以日期後面帶團名才分得出是哪一團
      html += '<div style="margin-top:6px;">🗓 過去開團：' +
        pastDates.map(ev => fmtSingleDate(ev.start) + '–' + fmtSingleDate(ev.displayEnd) + '（' + escHtml(ev.title) + '）').join('、') + '</div>';
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
