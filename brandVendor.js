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
  const cSec = document.getElementById('bvCommissionSection');
  const isCommission = bvSearchScope === 'commission';
  const isCategory = bvSearchScope === 'category';
  const catSec = document.getElementById('bvCategorySection');
  // 沒輸入關鍵字＝維持原本兩區都看得到；一旦搜尋就只留下被搜尋的那一區；分潤確認／品牌分類是獨立分頁
  if (vSec) vSec.style.display = !isCommission && !isCategory && (!kw || bvSearchScope === 'vendor') ? '' : 'none';
  if (bSec) bSec.style.display = !isCommission && !isCategory && (!kw || bvSearchScope === 'brand') ? '' : 'none';
  if (cSec) cSec.style.display = isCommission ? '' : 'none';
  if (catSec) catSec.style.display = isCategory ? '' : 'none';
  if (isCommission) { loadBrandCommissionReview(); return; }
  if (isCategory) { bvCatRender_(); return; }
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

// ===== 分潤確認清單（雪莉 09-29：一次派工讓曾曾逐一確認所有品牌分潤%，未對帳/即將結團優先）=====
let bvCommissionItems = null; // 快取，避免每次切分頁都重打 API；重新整理按鈕會清掉重抓
const BV_COMMISSION_TIER_LABEL = { 1: '① 帳務還在走對帳流程', 2: '② 即將結團（14 天內）', 3: '③ 開團中', 4: '④ 其他品牌' };

async function loadBrandCommissionReview(force) {
  const el = document.getElementById('bvCommissionList');
  const banner = document.getElementById('bvCommissionBanner');
  if (!el) return;
  if (!force && bvCommissionItems) { renderBrandCommissionList(bvCommissionItems); return; }
  el.innerHTML = '<div class="task-empty">載入中…</div>';
  try {
    const res = await postTask({ type: 'brand-commission-review' });
    if (res.ready === false) {
      if (banner) { banner.style.display = ''; banner.textContent = '⚠ 分潤生效日期／確認紀錄功能待雪莉執行 db push 後才能使用（migration 20260929130000）'; }
      el.innerHTML = '';
      return;
    }
    if (banner) banner.style.display = 'none';
    bvCommissionItems = res.items || [];
    renderBrandCommissionList(bvCommissionItems);
  } catch (err) {
    el.innerHTML = '<div class="task-empty">載入失敗：' + escHtml(err.message || String(err)) + '</div>';
  }
}

function renderBrandCommissionList(items) {
  const el = document.getElementById('bvCommissionList');
  if (!el) return;
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = '<div class="task-empty">沒有品牌資料</div>'; return; }
  let lastTier = null;
  items.forEach(b => {
    if (b.tier !== lastTier) {
      lastTier = b.tier;
      const head = document.createElement('div');
      head.style.cssText = 'text-align:center; margin:16px 0 8px; font-size:12.5px; color:var(--c-text-soft); font-weight:600;';
      head.textContent = BV_COMMISSION_TIER_LABEL[b.tier] || '';
      el.appendChild(head);
    }
    const row = document.createElement('div');
    row.className = 'cal-edit-day-panel';
    row.style.cssText = 'max-width:640px; margin:0 auto 8px; padding:10px 14px;';
    const teamsTxt = (b.teams || []).map(t => (t.date || '') + ' ' + (t.title || '')).join('　｜　');
    const confirmedTxt = b.commissionConfirmedAt ? `上次確認：${escHtml(b.commissionConfirmedAt)}${b.commissionConfirmedBy ? '（' + escHtml(b.commissionConfirmedBy) + '）' : ''}` : '尚未確認過';
    row.innerHTML =
      `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">` +
        `<b>${escHtml(b.name)}</b>` +
        `<span style="font-size:11px; color:var(--c-text-soft);">${confirmedTxt}</span>` +
      `</div>` +
      (teamsTxt ? `<div style="font-size:11.5px; color:var(--c-text-soft); margin-top:2px;">${escHtml(teamsTxt)}</div>` : '') +
      `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:8px;">` +
        `<label style="display:flex; align-items:center; gap:4px; font-size:12.5px;">分潤 <input type="number" class="bv-cr-rate" min="0" max="100" step="0.1" value="${b.commissionRate === '' ? '' : escHtml(b.commissionRate)}" style="width:70px;">%</label>` +
        `<label style="display:flex; align-items:center; gap:4px; font-size:12.5px;">生效日 <input type="date" class="bv-cr-date" value="${escHtml(b.commissionRateEffectiveDate || '')}"></label>` +
        `<button type="button" class="task-mini-btn bv-cr-confirm" style="font-size:12px; padding:6px 12px;">✅ 確認</button>` +
        `<span class="bv-cr-msg" style="font-size:11.5px;"></span>` +
      `</div>` +
      (b.commissionNote ? `<div style="font-size:11.5px; color:var(--c-text-soft); margin-top:4px;">說明：${escHtml(b.commissionNote)}</div>` : '');
    const rateInput = row.querySelector('.bv-cr-rate');
    const dateInput = row.querySelector('.bv-cr-date');
    const msgEl = row.querySelector('.bv-cr-msg');
    row.querySelector('.bv-cr-confirm').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      msgEl.textContent = '';
      try {
        const res = await postTask({
          type: 'brand-commission-confirm', id: b.id,
          commissionRate: rateInput.value.trim(), commissionRateEffectiveDate: dateInput.value.trim(),
        });
        if (res && res.success) { msgEl.textContent = '已確認'; msgEl.style.color = '#5a9a5a'; bvCommissionItems = null; }
      } catch (err) {
        msgEl.textContent = '失敗：' + (err.message || String(err));
        msgEl.style.color = '#c0392b';
      } finally {
        btn.disabled = false;
      }
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
    const isCommission = bvSearchScope === 'commission';
    if (input) {
      input.style.display = isCommission ? 'none' : '';
      if (!isCommission) { input.placeholder = bvSearchScope === 'vendor' ? '搜尋廠商…' : '搜尋品牌…'; input.focus(); }
    }
    if (bvSearchScope === 'category') bvCatLoad_();
    const clearBtn = document.getElementById('bvSearchClearBtn');
    if (clearBtn) clearBtn.style.display = isCommission ? 'none' : '';
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
  document.getElementById('vendorCustomerServiceInput').value = vendor ? (vendor.customerService || '') : '';
  // 訂單名單政策記在品牌上（2026-10-03）；廠商視窗只做「套用到底下所有品牌」批次填寫＋顯示最近一團的收單平台
  document.getElementById('vendorOrderListWrap').style.display = vendor ? '' : 'none';
  document.getElementById('vendorOrderListSelect').value = '';
  bvRenderVendorOrderList_(vendor);
  document.getElementById('vendorEditModal').classList.add('show');
}

const BV_ORDER_LIST_LABEL = { '': '未問過', provide: '願意提供', decline: '不提供' };
function bvOrderListLabel_(policy) { return BV_ORDER_LIST_LABEL[policy || ''] || '未問過'; }
function bvLastTeamText_(lt) {
  return lt ? '最近一團：' + String(lt.date || '').slice(0, 10) + ' ' + lt.title + '｜' + lt.platform : '還沒有綁定帳務的團';
}
function bvBrandsOfVendor_(vendorId) {
  return brandDb.filter(b => (b.vendorIds || []).indexOf(vendorId) !== -1);
}
// 廠商視窗：列出底下各品牌目前的訂單名單設定
function bvRenderVendorOrderList_(vendor) {
  if (!vendor) return;
  const brands = bvBrandsOfVendor_(vendor.id);
  const ready = !brands.some(b => b.orderListReady === false);
  const applyBtn = document.getElementById('vendorOrderListApplyBtn');
  document.getElementById('vendorOrderListSelect').disabled = !ready || !brands.length;
  applyBtn.disabled = !ready || !brands.length;
  document.getElementById('vendorOrderListBrands').textContent = !brands.length
    ? '底下還沒有品牌'
    : !ready ? '「訂單名單」欄位待 db push 後才能設定'
      : '目前：' + brands.map(b => b.name + '（' + bvOrderListLabel_(b.orderListPolicy) + '）').join('、');
  document.getElementById('vendorOrderListHint').textContent = bvLastTeamText_(vendor.lastTeam);
}
document.getElementById('vendorOrderListApplyBtn').addEventListener('click', async () => {
  if (!vendorEditCtx || vendorEditCtx.isNew) return;
  const vendor = vendorEditCtx.vendor;
  const policy = document.getElementById('vendorOrderListSelect').value;
  const count = bvBrandsOfVendor_(vendor.id).length;
  if (!count) return;
  if (!confirm('要把「' + vendor.name + '」底下 ' + count + ' 個品牌的訂單名單都改成「' + bvOrderListLabel_(policy) + '」嗎？')) return;
  const btn = document.getElementById('vendorOrderListApplyBtn');
  btn.disabled = true;
  setFormStatus('vendorEditStatus', '套用中…', '');
  try {
    const res = await postTask({ type: 'brand-db-order-list-apply', vendorId: vendor.id, policy });
    await fetchMemos();
    // 視窗還開著同一家廠商才重畫（fetchMemos 期間可能已被關掉）
    if (vendorEditCtx && !vendorEditCtx.isNew && vendorEditCtx.vendor.id === vendor.id) {
      bvRenderVendorOrderList_(vendorEditCtx.vendor);
      setFormStatus('vendorEditStatus', '已套用到 ' + ((res && res.count) || count) + ' 個品牌', 'ok');
    }
  } catch (err) {
    setFormStatus('vendorEditStatus', '套用失敗：' + err.message, 'error');
    btn.disabled = false;
  }
});
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
    note: document.getElementById('vendorNoteInput').value.trim(),
    customerService: document.getElementById('vendorCustomerServiceInput').value.trim()
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
  document.getElementById('brandCommissionEffectiveDateInput').value = brand ? (brand.commissionRateEffectiveDate || '') : '';
  document.getElementById('brandCommissionConfirmedHint').textContent = brand && brand.commissionConfirmedAt
    ? `上次確認：${brand.commissionConfirmedAt}${brand.commissionConfirmedBy ? '（' + brand.commissionConfirmedBy + '）' : ''}` : '';
  document.getElementById('brandLongTermInput').checked = brand ? !!brand.longTerm : false;
  document.getElementById('brandEndedInput').checked = brand ? !!brand.ended : false;
  document.getElementById('brandEndReasonInput').value = brand ? (brand.endReason || '') : '';
  bvSyncEndReason_();
  document.getElementById('brandNoteInput').value = brand ? brand.note : '';
  document.getElementById('brandShowInRecipeInput').checked = brand ? !!brand.showInRecipe : false;
  document.getElementById('brandIntroInput').value = brand ? (brand.intro || '') : '';
  document.getElementById('brandShopeeInput').value = brand ? (brand.shopeeUrl || '') : '';
  document.getElementById('brandPostTemplateInput').value = brand ? (brand.postTemplate || '') : '';
  document.getElementById('brandOpenChecklistInput').value = brand ? (brand.openChecklist || '') : '';
  document.getElementById('brandCustomerServiceInput').value = brand ? (brand.customerService || '') : '';
  bvRenderCategories_(brand);
  // 訂單名單政策（記在品牌上；migration 20261003150000）＋最近一團的收單平台＋同廠商其他品牌的答案
  const olSel = document.getElementById('brandOrderListSelect');
  olSel.value = brand ? (brand.orderListPolicy || '') : '';
  const olReady = !brandDb.some(b => b.orderListReady === false);
  olSel.disabled = !olReady;
  const olHint = [];
  if (!olReady) {
    olHint.push('「訂單名單」欄位待 db push 後才能設定');
  } else if (brand) {
    olHint.push(bvLastTeamText_(brand.lastTeam));
    const sibs = brandDb.filter(b => b.id !== brand.id && b.orderListPolicy
      && (b.vendorIds || []).some(vid => (brand.vendorIds || []).indexOf(vid) !== -1));
    if (sibs.length) olHint.push('同廠商其他品牌：' + sibs.map(b => b.name + '（' + bvOrderListLabel_(b.orderListPolicy) + '）').join('、'));
  }
  const olHintEl = document.getElementById('brandOrderListHint');
  olHintEl.textContent = '';
  olHint.forEach((line, i) => {
    if (i) olHintEl.appendChild(document.createElement('br'));
    olHintEl.appendChild(document.createTextNode(line));
  });
  document.getElementById('brandEditModal').classList.add('show');
}
// 品牌分類（可複選；brands.categories，migration 20261003180000）。
// 2026-10-03 雪莉定：新分類先另外做（舊功能不讀它），全部歸類完再一項一項正式取代舊的各自分類、規則照舊。
// 功能分類＝之後要接管舊規則的：冷凍冷藏（冷凍標籤、藍底；10-04 雪莉定冷凍冷藏同一類）、食譜食材（點團跳食譜）、
// 副食品成品、兒童餐具（之後每日餐盤頁面用）、繪本（點團跳繪本館）、教具（有出教材＝可設玩具點數；美術用品也歸這類）、玩具（沒出教材）。點數規則仍手動設，分類只是標記。
// 「繪本」「教具」「玩具」＝行事曆圖產生器「雪莉咚咚」帳號要列出的團（calendar-poster.html SHERI_DONDON_CATEGORIES，兩邊名稱要一致）
const BV_CATEGORY_GROUPS = [
  { label: '功能分類', items: ['冷凍冷藏', '食譜食材', '副食品成品', '兒童餐具', '繪本', '教具', '玩具'] },
  { label: '商品分類', items: ['食品', '保健', '生活用品', '家電3C', '美妝保養', '服飾'] }
];
const BV_BRAND_CATEGORIES = BV_CATEGORY_GROUPS.reduce((a, g) => a.concat(g.items), []);

/* ---------- 品牌分類總表（品牌廠商頁「🗂 品牌分類」分頁）----------
   一次列全部品牌勾分類。建議值＝後端依舊規則推算（brand-db-category-suggest：冷凍分類欄、食材表、成品表、
   繪本館、教材館…），還沒有任何分類的品牌會先「預勾」建議值但不存，標「未儲存」，雪莉看過按儲存才寫入。 */
let bvCatSuggest = null;      // { [brandId]: [{category, reasons}] }；null＝還沒讀
let bvCatDraft = {};          // { [brandId]: [分類...] } 畫面上改過、還沒存的
let bvCatFilter = 'all';      // all｜todo（還沒歸類）｜sug（有建議還沒採用）
let bvCatLoading = false;
async function bvCatLoad_() {
  if (bvCatSuggest || bvCatLoading) { bvCatRender_(); return; }
  bvCatLoading = true;
  bvCatRender_();
  try {
    const out = await postTask({ type: 'brand-db-category-suggest' });
    bvCatSuggest = {};
    (out.items || []).forEach(it => { bvCatSuggest[it.id] = it.suggestions || []; });
  } catch (e) {
    bvCatSuggest = null;
    alert('讀取分類建議失敗：' + e.message);
  }
  bvCatLoading = false;
  bvCatRender_();
}
// 預勾：還沒有任何分類、又有建議的品牌（每個品牌只預勾一次；品牌清單晚到也會補）
const bvCatPrefilled = new Set();
function bvCatPrefill_() {
  if (!bvCatSuggest) return;
  brandDb.forEach(b => {
    if (bvCatPrefilled.has(b.id)) return;
    const sug = bvCatSuggest[b.id] || [];
    if (!(b.categories || []).length && sug.length && !bvCatDraft[b.id]) bvCatDraft[b.id] = sug.map(x => x.category);
    if (sug.length) bvCatPrefilled.add(b.id);
  });
}
function bvCatCurrent_(b) { return bvCatDraft[b.id] || b.categories || []; }
function bvCatSame_(a, b) { return a.length === b.length && a.every(x => b.indexOf(x) !== -1); }
function bvCatDirtyIds_() {
  return Object.keys(bvCatDraft).filter(id => {
    const b = brandDb.find(x => x.id === id);
    return b && !bvCatSame_(bvCatDraft[id], b.categories || []);
  });
}
function bvCatRender_() {
  const box = document.getElementById('bvCategoryList');
  const bar = document.getElementById('bvCategoryBar');
  if (!box || !bar) return;
  const ready = !brandDb.some(b => b.categoriesReady === false);
  const canEdit = typeof hasEditPerm !== 'function' || hasEditPerm('brandVendorEdit');
  if (!ready) { bar.innerHTML = ''; box.innerHTML = '<div class="task-empty">「品牌分類」欄位還沒 db push</div>'; return; }
  if (bvCatLoading) { bar.innerHTML = ''; box.innerHTML = '<div class="task-empty">讀取分類建議中…</div>'; return; }
  bvCatPrefill_();
  const sugOf = b => (bvCatSuggest && bvCatSuggest[b.id]) || [];
  const kw = bvSearchText_();
  const all = brandDb.filter(b => !b.ended || (b.categories || []).length || bvCatDraft[b.id]);
  const todoN = all.filter(b => !bvCatCurrent_(b).length).length;
  const sugPending = b => sugOf(b).some(s => bvCatCurrent_(b).indexOf(s.category) === -1);
  const sugN = all.filter(sugPending).length;
  const dirty = bvCatDirtyIds_();
  const list = all
    .filter(b => bvCatFilter === 'all' || (bvCatFilter === 'todo' ? !bvCatCurrent_(b).length : sugPending(b)))
    .filter(b => bvMatch_(kw, [b.name, bvCatCurrent_(b).join(' ')]));
  const chip = (v, t) => `<button class="task-mini-btn${bvCatFilter === v ? ' on' : ''}" data-catf="${v}" style="font-size:12px; padding:6px 12px;">${t}</button>`;
  bar.innerHTML =
    `<div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; align-items:center;">` +
    chip('all', '全部 ' + all.length) + chip('todo', '還沒歸類 ' + todoN) + chip('sug', '有建議沒採用 ' + sugN) +
    (canEdit ? `<button class="task-submit-btn" id="bvCatSaveAll" style="width:auto; margin:0 0 0 8px; padding:7px 16px; font-size:13px;"${dirty.length ? '' : ' disabled'}>儲存全部變更（${dirty.length}）</button>` : '') +
    `</div><div class="form-status" id="bvCatStatus" style="text-align:center;"></div>`;
  bar.querySelectorAll('[data-catf]').forEach(btn => btn.addEventListener('click', () => { bvCatFilter = btn.dataset.catf; bvCatRender_(); }));
  const saveAll = document.getElementById('bvCatSaveAll');
  if (saveAll) saveAll.addEventListener('click', () => bvCatSave_(bvCatDirtyIds_()));

  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="task-empty">沒有符合的品牌</div>'; return; }
  list.forEach(b => {
    const cur = bvCatCurrent_(b);
    const isDirty = dirty.indexOf(b.id) !== -1;
    const sugs = sugOf(b);
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 12px; border-bottom:1px solid var(--c-line); ' + (isDirty ? 'background:#FFF6E8;' : '');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;';
    head.innerHTML = `<b style="font-size:14px;">${escHtml(b.name)}</b>` +
      (b.ended ? '<span style="font-size:11px; color:var(--c-text-soft);">（已結束合作）</span>' : '') +
      (isDirty ? '<span style="font-size:11px; color:#C07A1E;">未儲存</span>' : '') +
      (!cur.length ? '<span style="font-size:11px; color:var(--c-text-soft);">還沒歸類</span>' : '');
    if (canEdit && isDirty) {
      const sv = document.createElement('button');
      sv.className = 'task-mini-btn'; sv.textContent = '儲存'; sv.style.cssText = 'font-size:12px; padding:4px 12px; margin-left:auto;';
      sv.addEventListener('click', () => bvCatSave_([b.id]));
      head.appendChild(sv);
      const rv = document.createElement('button');
      rv.className = 'task-mini-btn'; rv.textContent = '還原'; rv.style.cssText = 'font-size:12px; padding:4px 12px;';
      rv.addEventListener('click', () => { bvCatDraft[b.id] = (b.categories || []).slice(); bvCatRender_(); });
      head.appendChild(rv);
    }
    row.appendChild(head);
    const extra = cur.filter(c => BV_BRAND_CATEGORIES.indexOf(c) === -1);
    BV_CATEGORY_GROUPS.concat(extra.length ? [{ label: '其他', items: extra }] : []).forEach(g => {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex; flex-wrap:wrap; align-items:center; gap:4px 12px; font-size:13px; margin:2px 0;';
      line.innerHTML = `<span style="font-size:11px; color:var(--c-text-soft); width:56px; flex:none;">${g.label}</span>`;
      g.items.forEach(c => {
        const sug = sugs.find(s => s.category === c);
        const lab = document.createElement('label');
        lab.style.cssText = 'display:inline-flex; align-items:center; gap:3px; margin:0; cursor:pointer; font-weight:normal;' +
          (sug ? ' border-bottom:1.5px dashed #E0A15A;' : '');
        if (sug) lab.title = '建議：' + sug.reasons.join('；');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = cur.indexOf(c) !== -1; cb.disabled = !canEdit;
        cb.style.cssText = 'width:auto; margin:0;';
        cb.addEventListener('change', () => {
          const next = bvCatCurrent_(b).filter(x => x !== c);
          if (cb.checked) next.push(c);
          bvCatDraft[b.id] = next;
          bvCatRender_();
        });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(c));
        line.appendChild(lab);
      });
      row.appendChild(line);
    });
    if (sugs.length) {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11.5px; color:#B07A3A; margin-top:4px; line-height:1.6;';
      hint.textContent = '建議依據：' + sugs.map(s => s.category + '（' + s.reasons.join('；') + '）').join('、');
      row.appendChild(hint);
    }
    box.appendChild(row);
  });
}
async function bvCatSave_(ids) {
  if (!ids.length) return;
  setFormStatus('bvCatStatus', '儲存中…（0/' + ids.length + '）', '');
  let ok = 0;
  const fails = [];
  for (const id of ids) {
    const b = brandDb.find(x => x.id === id);
    if (!b) continue;
    const cats = bvCatDraft[id].slice();
    try {
      await postTask({ type: 'brand-db-update', id, categories: cats });
      b.categories = cats;
      delete bvCatDraft[id];
      ok++;
      setFormStatus('bvCatStatus', '儲存中…（' + ok + '/' + ids.length + '）', '');
    } catch (e) {
      fails.push(b.name + '：' + e.message);
    }
  }
  bvCatRender_();
  setFormStatus('bvCatStatus', fails.length ? '已存 ' + ok + ' 個，失敗 ' + fails.length + ' 個：' + fails.join('、') : '已儲存 ' + ok + ' 個品牌', fails.length ? 'error' : 'success');
}
function bvRenderCategories_(brand) {
  const box = document.getElementById('brandCategoryBox');
  const hint = document.getElementById('brandCategoryHint');
  const ready = !brandDb.some(b => b.categoriesReady === false);
  const have = brand && Array.isArray(brand.categories) ? brand.categories : [];
  // 資料庫裡有、清單沒列的分類也顯示出來，存檔時才不會被洗掉
  const all = BV_BRAND_CATEGORIES.concat(have.filter(c => BV_BRAND_CATEGORIES.indexOf(c) === -1));
  box.innerHTML = '';
  box.dataset.ready = ready ? '1' : '0';
  all.forEach(c => {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:inline-flex; align-items:center; gap:4px; margin:0; cursor:pointer; font-weight:normal;';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = c; cb.checked = have.indexOf(c) !== -1; cb.disabled = !ready;
    cb.style.cssText = 'width:auto; margin:0;';
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(c));
    box.appendChild(lab);
  });
  hint.textContent = ready ? '' : '「品牌分類」欄位待 db push 後才能設定';
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
    commissionRateEffectiveDate: document.getElementById('brandCommissionEffectiveDateInput').value.trim(),
    longTerm: document.getElementById('brandLongTermInput').checked,
    ended: document.getElementById('brandEndedInput').checked,
    endReason: document.getElementById('brandEndReasonInput').value.trim(),
    note: document.getElementById('brandNoteInput').value.trim(),
    showInRecipe: document.getElementById('brandShowInRecipeInput').checked,
    intro: document.getElementById('brandIntroInput').value.trim(),
    shopeeUrl: document.getElementById('brandShopeeInput').value.trim(),
    // 只修頭尾空白，內文換行是貼文排版的一部分，不能動
    postTemplate: document.getElementById('brandPostTemplateInput').value.trim(),
    // 一行一條，換行是清單分隔，不能動
    openChecklist: document.getElementById('brandOpenChecklistInput').value.trim(),
    // 多行文字，換行保留
    customerService: document.getElementById('brandCustomerServiceInput').value.trim()
  };
  // 品牌分類：欄位未 push 時勾選框停用、不送
  const catBox = document.getElementById('brandCategoryBox');
  if (catBox.dataset.ready === '1') {
    payload.categories = Array.from(catBox.querySelectorAll('input[type=checkbox]:checked')).map(el => el.value);
  }
  // 欄位未 push 時下拉停用，不送（避免後端回「待 db push」擋掉整筆儲存）
  if (!document.getElementById('brandOrderListSelect').disabled) {
    payload.orderListPolicy = document.getElementById('brandOrderListSelect').value;
  }
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

  // 未來已排定的開團＝底下所有品牌的未來團合併；聯名團會同時比對到同廠商的兩個品牌，依事件 id 去重，依開團日排序
  const upcomingEl = document.getElementById('vendorDetailUpcomingList');
  if (upcomingEl) {
    const seen = new Set();
    const upcoming = [];
    brands.forEach(b => {
      getBrandGroupBuys_(b).upcoming.forEach(ev => {
        const key = ev.id != null ? 'id:' + ev.id : 'x:' + ev.title + '|' + ev.start;
        if (seen.has(key)) return;
        seen.add(key);
        upcoming.push(ev);
      });
    });
    upcoming.sort((a, b) => a.start - b.start);
    upcomingEl.innerHTML = '';
    if (!upcoming.length) {
      upcomingEl.innerHTML = '<div class="task-empty">目前沒有排定中的開團</div>';
    } else {
      upcoming.forEach(ev => upcomingEl.appendChild(renderBrandGroupBuyRow_(ev, closeVendorDetailModal)));
    }
  }

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
// closeModal：點團之前要關掉的彈窗（品牌檢視／廠商檢視共用這個列樣式）
function renderBrandGroupBuyRow_(ev, closeModal) {
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
      (closeModal || closeBrandDetailModal)();
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
  const vendorObjs = (brand.vendorIds || []).map(vid => vendorDb.find(v => v.id === vid)).filter(Boolean);
  const dst = bvCoopState_(brand);
  lines.push(`<div><b>合作狀態：</b>${dst.text}${brand.ended && brand.endReason ? '（' + escHtml(brand.endReason) + '）' : ''}</div>`);
  // 品牌本身還在，但所屬廠商全結束了＝實際上接不到團，提示但不自動改品牌狀態
  if (!brand.ended && bvAllVendorsEnded_(brand)) {
    lines.push('<div style="color:var(--c-danger); font-weight:800;">⚠ 所屬廠商都已結束合作，這個品牌目前接不到團</div>');
  }
  // 廠商名稱做成連結，點了跳到廠商檢視彈窗（跟廠商彈窗點品牌跳品牌檢視對稱）
  const vendorLinks = vendorObjs.map(v =>
    `<a href="javascript:void(0)" class="bv-vendor-link" data-vid="${escHtml(v.id)}" style="color:#4A6A8F; font-weight:800;">${escHtml(v.name)}</a>`
  ).join('、');
  lines.push(`<div><b>所屬廠商：</b>${vendorLinks || '－'}</div>`);
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
  document.querySelectorAll('#brandDetailBody .bv-vendor-link').forEach(a => {
    a.addEventListener('click', () => {
      const v = vendorDb.find(x => x.id === a.getAttribute('data-vid'));
      if (!v) return;
      closeBrandDetailModal();
      openVendorDetailModal(v);
    });
  });

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

    let html = `<div style="font-weight:900; color:#4A6A8F; margin-bottom:6px;">📇 比對到品牌資料庫：${escHtml(brand.name)}</div>`;
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
  window._evBrandMatchTimer = setTimeout(() => { renderEvBrandMatchInfo(); bvRenderEvChecklist(); bvRenderEvCsHint(); }, 300);
});

// ===== 客服（2026-09-16）=====
// 優先順序：事件客服＞品牌 customerService＞品牌所屬廠商 customerService。視窗裡提示「目前會沿用哪個」。
// 提示只依團名比對（後台畫面上的推測）；會員端實際解析另外優先看帳務列綁的品牌（lib/fans/customerservice.ts）。
function bvRenderEvCsHint() {
  const hint = document.getElementById('evCsBrandHint');
  const input = document.getElementById('evCustomerServiceInput');
  if (!hint || !input) return;
  const lines = [];
  if (typeof customerServiceReady !== 'undefined' && !customerServiceReady) {
    lines.push('⚠ 客服欄位還沒開通（資料庫待更新），目前填了也存不起來');
  } else if (!input.value.trim()) {
    const title = document.getElementById('evTitleInput').value.trim();
    const found = (title ? bvBrandsInTitle_(title) : []).map(b => {
      const own = String(b.customerService || '').trim();
      if (own) return { name: b.name, src: '品牌', cs: own };
      const seen = new Set();
      const vs = (b.vendorIds || []).map(id => vendorDb.find(v => v.id === id))
        .filter(v => {
          const cs = v ? String(v.customerService || '').trim() : '';
          if (!cs || seen.has(cs)) return false;
          seen.add(cs);
          return true;
        });
      if (!vs.length) return null;
      const cs = vs.length === 1 ? String(vs[0].customerService).trim()
        : vs.map(v => '【' + v.name + '】\n' + String(v.customerService).trim()).join('\n');
      return { name: b.name, src: '廠商', cs };
    }).filter(Boolean);
    if (found.length) {
      lines.push('目前沿用客服：');
      found.forEach(f => lines.push('【' + f.name + (f.src === '廠商' ? '（品牌沒填，用廠商的）' : '') + '】\n' + f.cs));
    } else {
      lines.push('目前沒有可沿用的客服（團名比對不到品牌，或品牌與廠商都沒填客服）');
    }
  }
  hint.textContent = lines.join('\n');
  hint.style.display = lines.length ? 'block' : 'none';
}
document.getElementById('evCustomerServiceInput').addEventListener('input', () => {
  clearTimeout(window._evCsHintTimer);
  window._evCsHintTimer = setTimeout(bvRenderEvCsHint, 300);
});

// ===== 開團前檢查清單（2026-09-09）=====
// 品牌庫每個品牌可存「開團前檢查清單」（openChecklist，一行一條）：這個品牌每次開團
// 固定要確認的事（例：團購價比官網貴要先看）。排行事曆時依團名比對品牌自動列出，
// 逐項打勾，勾選狀態存在事件上（checklistState，key＝品牌名::項目文字），
// 由後台包 eventChecklistStates 帶回。清單原文永遠以品牌欄位為準——
// 品牌改了清單，舊團會自動出現新的未勾項目。

function bvChecklistItemsForTitle_(title) {
  if (!title) return [];
  const items = [];
  bvBrandsInTitle_(title).forEach(brand => {
    String(brand.openChecklist || '').split('\n').map(s => s.trim()).filter(Boolean).forEach(text => {
      items.push({ brand: brand.name, text, key: brand.name + '::' + text });
    });
  });
  return items;
}

// reset=true（剛開編輯視窗）只看已存的勾選狀態；不帶（打字改標題重畫）保留畫面上已勾的
function bvRenderEvChecklist(reset) {
  const box = document.getElementById('evChecklistBox');
  if (!box) return;
  const domState = {};
  if (!reset) {
    box.querySelectorAll('input[data-ck]').forEach(cb => { domState[cb.getAttribute('data-ck')] = cb.checked; });
  }
  const title = document.getElementById('evTitleInput').value.trim();
  const items = bvChecklistItemsForTitle_(title);
  if (!items.length) { box.style.display = 'none'; box.innerHTML = ''; return; }

  const evId = (typeof eventEditCtx !== 'undefined' && eventEditCtx && !eventEditCtx.isNew) ? String(eventEditCtx.ev.id) : '';
  const saved = (typeof eventChecklistStates !== 'undefined' && evId && eventChecklistStates[evId]) ? eventChecklistStates[evId] : {};
  // 聯名團同時對到多個品牌時，每一條前面標品牌名才分得出是誰的檢查項
  const multiBrand = new Set(items.map(i => i.brand)).size > 1;

  box.innerHTML = '<div style="font-weight:900; margin-bottom:4px;">📋 開團前檢查清單</div>' +
    items.map(i => {
      const checked = Object.prototype.hasOwnProperty.call(domState, i.key) ? domState[i.key] : !!saved[i.key];
      return '<label style="display:flex; align-items:flex-start; gap:6px; margin:4px 0; cursor:pointer;">' +
        '<input type="checkbox" data-ck="' + escHtml(i.key) + '"' + (checked ? ' checked' : '') + ' style="width:auto; margin:3px 0 0;">' +
        '<span>' + (multiBrand ? '［' + escHtml(i.brand) + '］' : '') + escHtml(i.text) + '</span></label>';
    }).join('');
  box.style.display = 'block';
}

// 收集勾選狀態給存檔用；清單沒顯示（比對不到品牌或品牌沒設清單）回 null＝payload 不帶欄位、不動已存狀態
function bvCollectEvChecklist_() {
  const box = document.getElementById('evChecklistBox');
  if (!box || box.style.display === 'none') return null;
  const cbs = box.querySelectorAll('input[data-ck]');
  if (!cbs.length) return null;
  const state = {};
  let unchecked = 0;
  cbs.forEach(cb => {
    if (cb.checked) state[cb.getAttribute('data-ck')] = true;
    else unchecked++;
  });
  return { state, unchecked, total: cbs.length };
}

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

function openPostGenModalWith_(text, title) {
  postGenCtx_ = null;
  const h = document.getElementById('postGenTitle');
  if (h) h.textContent = title || '貼文文案';
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
  const h = document.getElementById('postGenTitle');
  if (h) h.textContent = '貼文文案';
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

// 連結文案（雪莉 09-24：貼文改附連結）：固定三行，不看品牌模板，有下單網址的團都能產。
// 團名沿用行事曆團名（「｜」接回空白），日期用開團日～結團日（含延長）。
function bvBuildLinkCopy_(ev) {
  const startLabel = bvPostDateLabel_(ev.start);
  const endLabel = bvPostDateLabel_(ev.displayEnd || ev.end);
  const dateRange = startLabel && endLabel ? startLabel + '～' + endLabel : (startLabel || endLabel);
  return [
    plainTitle(ev.title || '') + '開團中',
    '開團日期：' + dateRange,
    '下單連結：' + (ev.url || ''),
  ].join('\n');
}

// 活動檢視彈窗打開時由 openAdminModal 呼叫：比對到的品牌有存模板才顯示貼文按鈕；
// 連結按鈕只要這團有下單網址就顯示
function syncPostGenBtnForEvent_(ev) {
  const btn = document.getElementById('evPostGenBtn');
  if (btn) btn.style.display = ev && bvBrandsWithPostTemplate_(ev.title).length ? 'block' : 'none';
  const linkBtn = document.getElementById('evLinkGenBtn');
  if (linkBtn) linkBtn.style.display = ev && String(ev.url || '').trim() ? 'block' : 'none';
}

document.getElementById('evLinkGenBtn').addEventListener('click', () => {
  const ev = currentModalEv;
  if (!ev || !String(ev.url || '').trim()) return;
  openPostGenModalWith_(bvBuildLinkCopy_(ev), '連結文案');
});

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
