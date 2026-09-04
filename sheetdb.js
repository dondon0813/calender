// ===================================================================
// sheetdb.js — 食譜資料庫（食譜/食材/成品）＋開學清單 後台編輯
//
// 這四張表原本只能直接改 Google 試算表（Code.gs:93），recipes.html 與
// school-list.html 切換到新後端、試算表轉唯讀後，改由這兩個分頁維護。
// 後端端點在 /api/legacy：recipe-db-list / recipe|ingredient|product-upsert|-delete
// ／school-item-list|-upsert|-delete（權限 recipeEdit / schoolEdit）。
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 books.js／
// subscriptions.js）：admin.js 開機還原分頁會同步呼叫 loadRecipeDbView／
// loadSchoolListView，順序錯了整頁變磚。最外層只有宣告與 DOM 事件掛載。
// ===================================================================

const SHEETDB_API_URL = 'https://dondon-platform.vercel.app/api/legacy';

let RECIPE_DB_LOADED = false;
let RECIPE_DB = { recipes: [], ingredients: [], products: [] };
let RECIPE_DB_TAB = 'recipe';       // recipe | ingredient | product
let RECIPE_DB_BRAND = '';           // 品牌篩選；''＝全部
let SCHOOL_DB_LOADED = false;
let SCHOOL_DB_LIST = [];
let SHEETDB_EDIT = null;            // 目前 modal 編輯中的 { kind, id }；id=null＝新增

function sdEscapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sdForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

async function sdApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(SHEETDB_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS 預檢（同 admin.js postTask）
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    sdForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

// ===== 四種資料的欄位定義（key＝後端 camelCase；表單依此動態產生）=====
const SHEETDB_SPECS = {
  school: {
    label: '開學清單項目',
    upsertType: 'school-item-upsert', deleteType: 'school-item-delete',
    fields: [
      { key: 'itemName', label: '項目名稱 *', required: true, ph: '例如：餐袋' },
      { key: 'icon', label: '圖示（emoji）', ph: '例如：🍱' },
      { key: 'category', label: '分類', ph: '例如：用餐' },
      { key: 'brandRecommend', label: '品牌推薦', ph: '例如：小獅王辛巴' },
      { key: 'shopeeUrl', label: '蝦皮連結', ph: 'https://…' },
      { key: 'brandIntro', label: '品牌介紹', type: 'textarea', rows: 3 },
      { key: 'sortOrder', label: '排序（數字小的排前面）', type: 'number', hint: '留空＝新增時自動排最後、編輯時維持原值' },
      { key: 'visible', label: '在前台顯示', type: 'checkbox', def: true },
    ],
  },
  recipe: {
    label: '食譜',
    upsertType: 'recipe-upsert', deleteType: 'recipe-delete',
    fields: [
      { key: 'name', label: '食譜名稱 *', required: true },
      { key: 'ageRange', label: '適合月齡', ph: '例如：6M+' },
      { key: 'cookTime', label: '烹調時間', ph: '例如：15分鐘' },
      { key: 'difficulty', label: '難易度', type: 'select', options: [['', '未設定'], ['1', '1（簡單）'], ['2', '2（中等）'],['3', '3（進階）']] },
      { key: 'method', label: '料理方式', ph: '例如：電鍋' },
      { key: 'intro', label: '簡介', type: 'textarea', rows: 2 },
      { key: 'ingredientRefs', label: '使用食材', type: 'textarea', rows: 2, ph: 'ing001:50g/雞蛋:1顆/蔬菜', hint: '用 / 分隔、可帶 :分量。可填食材編號、食材名稱／簡稱，或分類詞（例如「蔬菜」＝該分類都可用）' },
      { key: 'steps', label: '做法步驟', type: 'textarea', rows: 5, hint: '一行一個步驟' },
      { key: 'tips', label: '小提醒', type: 'textarea', rows: 2 },
      { key: 'heroImageUrl', label: '成品圖片網址', ph: 'https://…', hint: '可先在「圖片庫」上傳，再把網址貼過來' },
      { key: 'stepImages', label: '步驟圖片', type: 'textarea', rows: 2, ph: '網址1|網址2|網址3', hint: '多張用 | 分隔，順序對應步驟。留空＝依主圖網址規則自動推算' },
      { key: 'videoUrl', label: '影片連結', ph: 'https://…' },
    ],
  },
  ingredient: {
    label: '食材',
    upsertType: 'ingredient-upsert', deleteType: 'ingredient-delete',
    fields: [
      { key: 'name', label: '食材名稱 *', required: true },
      { key: 'shortName', label: '簡稱（別名）', ph: '鮭魚片/魚片', hint: '多個別名用 / 分隔；食譜裡打別名也能對到這筆' },
      { key: 'nameEn', label: '英文名稱' },
      { key: 'kind', label: '食材類型', ph: '例如：一般／品牌' },
      { key: 'category', label: '分類', ph: '例如：蔬菜' },
      { key: 'brand', label: '品牌' },
      { key: 'spec', label: '內容物規格' },
      { key: 'shelfLife', label: '保存期限' },
      { key: 'composition', label: '成分' },
      { key: 'origin', label: '產地' },
      { key: 'intro', label: '簡短介紹', type: 'textarea', rows: 2 },
      { key: 'imageUrl', label: '圖片網址', ph: 'https://…' },
      { key: 'shopeeUrl', label: '蝦皮連結', ph: 'https://…', hint: '留空＝前台退回用品牌層的連結' },
    ],
  },
  product: {
    label: '成品',
    upsertType: 'product-upsert', deleteType: 'product-delete',
    fields: [
      { key: 'name', label: '成品名稱 *', required: true },
      { key: 'brand', label: '品牌' },
      { key: 'shortName', label: '簡稱（別名）', ph: '多個用 / 分隔' },
      { key: 'spec', label: '內容物規格' },
      { key: 'shelfLife', label: '保存期限' },
      { key: 'composition', label: '成分' },
      { key: 'origin', label: '產地' },
      { key: 'intro', label: '簡短介紹', type: 'textarea', rows: 2 },
      { key: 'relatedIngredientIds', label: '相關食材ID', ph: 'ing001/ing002', hint: '用 / 分隔' },
      { key: 'usableAsIngredient', label: '可作食材（食譜可以引用它）', type: 'checkbox' },
      { key: 'imageUrl', label: '圖片網址', ph: 'https://…' },
      { key: 'shopeeUrl', label: '蝦皮連結', ph: 'https://…' },
    ],
  },
};

// ===================================================================
// 開學清單分頁
// ===================================================================
function loadSchoolListView(forceReload) {
  if (SCHOOL_DB_LOADED && !forceReload) return;
  const area = document.getElementById('schoolListArea');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  sdApiPost('school-item-list').then(data => {
    if (!data || !data.success) throw new Error((data && data.error) || '未知錯誤');
    SCHOOL_DB_LOADED = true;
    SCHOOL_DB_LIST = Array.isArray(data.items) ? data.items : [];
    renderSchoolList();
  }).catch(err => {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + sdEscapeHtml(err.message || '') + '</div>';
  });
}

function renderSchoolList() {
  const area = document.getElementById('schoolListArea');
  if (!SCHOOL_DB_LIST.length) {
    area.innerHTML = '<div class="task-empty">還沒有任何開學清單項目</div>';
    return;
  }
  const rows = SCHOOL_DB_LIST.map(it => {
    const hiddenBadge = it.visible ? '' :
      '<span style="display:inline-block; padding:1px 7px; border-radius:999px; background:#eee; color:#666; font-size:11px; margin-left:6px;">🙈 隱藏中</span>';
    return '<tr style="border-bottom:1px solid var(--c-line);' + (it.visible ? '' : 'opacity:.55;') + '">' +
      '<td style="padding:8px 10px; white-space:nowrap; color:var(--c-text-light);">' + sdEscapeHtml(String(it.sortOrder)) + '</td>' +
      '<td style="padding:8px 10px; white-space:nowrap; color:var(--c-text-light);">' + sdEscapeHtml(it.no) + '</td>' +
      '<td style="padding:8px 10px; font-weight:800;">' + sdEscapeHtml((it.icon ? it.icon + ' ' : '') + it.itemName) + hiddenBadge + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(it.category) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(it.brandRecommend) + '</td>' +
      '<td style="padding:8px 10px;"><button type="button" class="task-mini-btn sd-school-edit" data-id="' + sdEscapeHtml(it.id) + '">✏️ 編輯</button></td>' +
      '</tr>';
  }).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:640px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' +
    '<th style="padding:8px 10px;">排序</th><th style="padding:8px 10px;">編號</th><th style="padding:8px 10px;">項目</th>' +
    '<th style="padding:8px 10px;">分類</th><th style="padding:8px 10px;">品牌推薦</th><th style="padding:8px 10px;"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  area.querySelectorAll('.sd-school-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = SCHOOL_DB_LIST.find(x => x.id === btn.dataset.id);
      if (rec) openSheetDbEditModal('school', rec);
    });
  });
}

// ===================================================================
// 食譜資料庫分頁（食譜/食材/成品三張表共用一個清單區）
// ===================================================================
function loadRecipeDbView(forceReload) {
  if (RECIPE_DB_LOADED && !forceReload) { renderRecipeDbTabs(); renderRecipeDbList(); return; }
  const area = document.getElementById('recipeDbListArea');
  area.innerHTML = '<div class="task-empty">讀取中…</div>';
  sdApiPost('recipe-db-list').then(data => {
    if (!data || !data.success) throw new Error((data && data.error) || '未知錯誤');
    RECIPE_DB_LOADED = true;
    RECIPE_DB = {
      recipes: data.recipes || [],
      ingredients: data.ingredients || [],
      products: data.products || [],
    };
    renderRecipeDbTabs();
    renderRecipeDbList();
  }).catch(err => {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + sdEscapeHtml(err.message || '') + '</div>';
  });
}

function renderRecipeDbTabs() {
  const box = document.getElementById('recipeDbTabs');
  const tabs = [
    ['recipe', '🍲 食譜', RECIPE_DB.recipes.length],
    ['ingredient', '🥕 食材', RECIPE_DB.ingredients.length],
    ['product', '📦 成品', RECIPE_DB.products.length],
  ];
  box.innerHTML = tabs.map(([k, label, n]) => {
    const on = RECIPE_DB_TAB === k;
    return '<button type="button" class="task-mini-btn sd-rdb-tab" data-kind="' + k + '" style="' +
      (on ? 'background:var(--c-accent, #e8749d); color:#fff; border-color:transparent;' : '') +
      '">' + label + '（' + n + '）</button>';
  }).join('');
  box.querySelectorAll('.sd-rdb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      RECIPE_DB_TAB = btn.dataset.kind;
      renderRecipeDbTabs();
      renderRecipeDbList();
    });
  });
  renderRecipeDbBrandFilter();
}

// 食譜本身沒有品牌欄：用「使用食材」的每個詞去對食材/成品（編號／名稱／簡稱別名，
// 同 recipes.html getRecipeBrands 的比對層次），對到誰就算誰的品牌
function sdRecipeBrandsOf(recipe) {
  const tokens = String(recipe.ingredientRefs || '').split('/')
    .map(s => s.trim().split(':')[0].trim()).filter(Boolean);
  const all = RECIPE_DB.ingredients.concat(RECIPE_DB.products);
  const set = new Set();
  tokens.forEach(t => {
    all.forEach(i => {
      if (!i.brand) return;
      if (i.no === t || i.name === t ||
          String(i.shortName || '').split('/').map(s => s.trim()).indexOf(t) !== -1) {
        set.add(i.brand);
      }
    });
  });
  return set;
}

// 品牌下拉選項：食材/成品分頁列自己表裡出現過的品牌；食譜分頁列兩表聯集
// （食譜的品牌是從食材對出來的）。換分頁時若原選擇不在新清單裡就退回「全部」。
function renderRecipeDbBrandFilter() {
  const sel = document.getElementById('recipeDbBrandFilter');
  const src = RECIPE_DB_TAB === 'ingredient' ? RECIPE_DB.ingredients
    : RECIPE_DB_TAB === 'product' ? RECIPE_DB.products
    : RECIPE_DB.ingredients.concat(RECIPE_DB.products);
  const brands = Array.from(new Set(src.map(r => String(r.brand || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  if (brands.indexOf(RECIPE_DB_BRAND) === -1) RECIPE_DB_BRAND = '';
  sel.innerHTML = '<option value="">🏷️ 全部品牌</option>' +
    brands.map(b => '<option value="' + sdEscapeHtml(b) + '">' + sdEscapeHtml(b) + '</option>').join('');
  sel.value = RECIPE_DB_BRAND;
}

function sdRecipeDbRows() {
  const kind = RECIPE_DB_TAB;
  let list = kind === 'recipe' ? RECIPE_DB.recipes : kind === 'ingredient' ? RECIPE_DB.ingredients : RECIPE_DB.products;
  if (RECIPE_DB_BRAND) {
    list = kind === 'recipe'
      ? list.filter(r => sdRecipeBrandsOf(r).has(RECIPE_DB_BRAND))
      : list.filter(r => String(r.brand || '').trim() === RECIPE_DB_BRAND);
  }
  const q = (document.getElementById('recipeDbSearch').value || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter(r =>
    [r.no, r.name, r.brand, r.shortName, r.category, r.kind].some(v => String(v || '').toLowerCase().indexOf(q) !== -1)
  );
}

function renderRecipeDbList() {
  const area = document.getElementById('recipeDbListArea');
  const kind = RECIPE_DB_TAB;
  const list = sdRecipeDbRows();
  if (!list.length) {
    area.innerHTML = '<div class="task-empty">沒有符合的資料</div>';
    return;
  }
  let head, row;
  if (kind === 'recipe') {
    head = '<th style="padding:8px 10px;">編號</th><th style="padding:8px 10px;">食譜名稱</th><th style="padding:8px 10px;">適合月齡</th><th style="padding:8px 10px;">料理方式</th><th style="padding:8px 10px;"></th>';
    row = r => '<td style="padding:8px 10px; white-space:nowrap; color:var(--c-text-light);">' + sdEscapeHtml(r.no) + '</td>' +
      '<td style="padding:8px 10px; font-weight:800;">' + sdEscapeHtml(r.name) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(r.ageRange) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(r.method) + '</td>';
  } else if (kind === 'ingredient') {
    head = '<th style="padding:8px 10px;">編號</th><th style="padding:8px 10px;">食材名稱</th><th style="padding:8px 10px;">分類</th><th style="padding:8px 10px;">品牌</th><th style="padding:8px 10px;"></th>';
    row = r => '<td style="padding:8px 10px; white-space:nowrap; color:var(--c-text-light);">' + sdEscapeHtml(r.no) + '</td>' +
      '<td style="padding:8px 10px; font-weight:800;">' + sdEscapeHtml(r.name) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(r.category) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(r.brand) + '</td>';
  } else {
    head = '<th style="padding:8px 10px;">編號</th><th style="padding:8px 10px;">成品名稱</th><th style="padding:8px 10px;">品牌</th><th style="padding:8px 10px;">可作食材</th><th style="padding:8px 10px;"></th>';
    row = r => '<td style="padding:8px 10px; white-space:nowrap; color:var(--c-text-light);">' + sdEscapeHtml(r.no) + '</td>' +
      '<td style="padding:8px 10px; font-weight:800;">' + sdEscapeHtml(r.name) + '</td>' +
      '<td style="padding:8px 10px;">' + sdEscapeHtml(r.brand) + '</td>' +
      '<td style="padding:8px 10px;">' + (r.usableAsIngredient ? '✅' : '') + '</td>';
  }
  const rowsHtml = list.map(r =>
    '<tr style="border-bottom:1px solid var(--c-line);">' + row(r) +
    '<td style="padding:8px 10px;"><button type="button" class="task-mini-btn sd-rdb-edit" data-id="' + sdEscapeHtml(r.id) + '">✏️ 編輯</button></td></tr>'
  ).join('');
  area.innerHTML = '<div style="overflow-x:auto; border:1px solid var(--c-border-light); border-radius:10px;">' +
    '<table style="width:100%; border-collapse:collapse; font-size:13px; min-width:640px;">' +
    '<thead><tr style="background:var(--c-bg-bottom); text-align:left;">' + head + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';
  area.querySelectorAll('.sd-rdb-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const all = kind === 'recipe' ? RECIPE_DB.recipes : kind === 'ingredient' ? RECIPE_DB.ingredients : RECIPE_DB.products;
      const rec = all.find(x => x.id === btn.dataset.id);
      if (rec) openSheetDbEditModal(kind, rec);
    });
  });
}

// ===================================================================
// 共用編輯 modal（表單欄位依 SHEETDB_SPECS 動態產生）
// ===================================================================
function openSheetDbEditModal(kind, rec) {
  const spec = SHEETDB_SPECS[kind];
  SHEETDB_EDIT = { kind, id: rec ? rec.id : null };
  document.getElementById('sheetDbEditTitle').textContent =
    (rec ? '✏️ 編輯' : '➕ 新增') + spec.label + (rec && rec.no ? '（' + rec.no + '）' : '');
  document.getElementById('sheetDbDeleteBtn').style.display = rec ? 'inline-block' : 'none';

  const parts = spec.fields.map(f => {
    const id = 'sd_f_' + f.key;
    const val = rec ? rec[f.key] : undefined;
    let input;
    if (f.type === 'textarea') {
      input = '<textarea id="' + id + '" rows="' + (f.rows || 2) + '" placeholder="' + sdEscapeHtml(f.ph || '') + '"></textarea>';
    } else if (f.type === 'checkbox') {
      const on = rec ? Boolean(val) : Boolean(f.def);
      return '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:12px;">' +
        '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + ' style="width:auto; margin:0;"><span>' + sdEscapeHtml(f.label) + '</span></label>';
    } else if (f.type === 'select') {
      input = '<select id="' + id + '">' + f.options.map(([v, t]) =>
        '<option value="' + sdEscapeHtml(v) + '">' + sdEscapeHtml(t) + '</option>').join('') + '</select>';
    } else {
      input = '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" id="' + id + '" placeholder="' + sdEscapeHtml(f.ph || '') + '">';
    }
    const hint = f.hint ? '<div style="font-size:12px; color:var(--c-text-light); margin-top:2px;">' + sdEscapeHtml(f.hint) + '</div>' : '';
    return '<label for="' + id + '">' + sdEscapeHtml(f.label) + '</label>' + input + hint;
  });
  document.getElementById('sheetDbFormArea').innerHTML = parts.join('');

  // 填值（textarea/select/input；checkbox 已在產生 HTML 時處理）
  spec.fields.forEach(f => {
    if (f.type === 'checkbox') return;
    const el = document.getElementById('sd_f_' + f.key);
    const val = rec ? rec[f.key] : undefined;
    el.value = val === undefined || val === null ? '' : String(val);
  });

  const statusEl = document.getElementById('sheetDbEditStatus');
  statusEl.textContent = '';
  statusEl.className = 'form-status';
  document.getElementById('sheetDbEditModal').classList.add('show');
}

function closeSheetDbEditModal() {
  document.getElementById('sheetDbEditModal').classList.remove('show');
  SHEETDB_EDIT = null;
}

document.getElementById('sheetDbSaveBtn').addEventListener('click', async () => {
  if (!SHEETDB_EDIT) return;
  const { kind, id } = SHEETDB_EDIT;
  const spec = SHEETDB_SPECS[kind];
  const statusEl = document.getElementById('sheetDbEditStatus');

  const payload = {};
  for (const f of spec.fields) {
    const el = document.getElementById('sd_f_' + f.key);
    if (f.type === 'checkbox') { payload[f.key] = el.checked; continue; }
    const v = el.value.trim();
    if (f.required && !v) {
      statusEl.textContent = '請填寫「' + f.label.replace(' *', '') + '」';
      statusEl.className = 'form-status error';
      return;
    }
    // 數字欄留空＝不送（新增時交給後端自動排、編輯時維持原值）
    if (f.type === 'number' && v === '') continue;
    payload[f.key] = v;
  }
  if (id) payload.id = id;

  const btn = document.getElementById('sheetDbSaveBtn');
  btn.disabled = true;
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  try {
    const res = await sdApiPost(spec.upsertType, payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    const reloadKind = kind;
    closeSheetDbEditModal();
    if (reloadKind === 'school') loadSchoolListView(true); else loadRecipeDbView(true);
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
  btn.disabled = false;
});

document.getElementById('sheetDbDeleteBtn').addEventListener('click', async () => {
  if (!SHEETDB_EDIT || !SHEETDB_EDIT.id) return;
  const { kind, id } = SHEETDB_EDIT;
  const spec = SHEETDB_SPECS[kind];
  if (!confirm('確定要刪除這筆' + spec.label + '嗎？前台會立刻看不到它。')) return;

  const statusEl = document.getElementById('sheetDbEditStatus');
  const btn = document.getElementById('sheetDbDeleteBtn');
  btn.disabled = true;
  statusEl.textContent = '刪除中…';
  statusEl.className = 'form-status';
  try {
    let res = await sdApiPost(spec.deleteType, { id });
    // 食材/成品還被食譜引用：後端會擋下並列出是哪些食譜，再確認一次才強制刪
    if (res && !res.success && res.referencedBy) {
      if (!confirm(res.error + '\n\n仍要強制刪除嗎？（那些食譜會顯示不出這個食材）')) {
        statusEl.textContent = '已取消刪除';
        statusEl.className = 'form-status';
        btn.disabled = false;
        return;
      }
      res = await sdApiPost(spec.deleteType, { id, force: true });
    }
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    const reloadKind = kind;
    closeSheetDbEditModal();
    if (reloadKind === 'school') loadSchoolListView(true); else loadRecipeDbView(true);
  } catch (err) {
    statusEl.textContent = '刪除失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
  btn.disabled = false;
});

document.getElementById('schoolListAddBtn').addEventListener('click', () => openSheetDbEditModal('school', null));
document.getElementById('schoolListRefreshBtn').addEventListener('click', () => loadSchoolListView(true));
document.getElementById('recipeDbAddBtn').addEventListener('click', () => openSheetDbEditModal(RECIPE_DB_TAB, null));
document.getElementById('recipeDbRefreshBtn').addEventListener('click', () => loadRecipeDbView(true));
document.getElementById('recipeDbSearch').addEventListener('input', () => { if (RECIPE_DB_LOADED) renderRecipeDbList(); });
document.getElementById('recipeDbBrandFilter').addEventListener('change', function () {
  RECIPE_DB_BRAND = this.value;
  if (RECIPE_DB_LOADED) renderRecipeDbList();
});
