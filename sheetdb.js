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
let RECIPE_DB_PHOTO_READY = false;  // 後端 recipe-db-list 回 photoReady===true 才可用一般圖片欄（false＝資料庫欄位待 db push）
let RECIPE_DB_GALLERY_READY = false; // recipe-db-list 回 galleryReady===true 才可編輯介紹圖（false＝待 db push）
let RECIPE_DB_HEATING_READY = false; // recipe-db-list 回 heatingReady===true 才可編輯加熱方式（false＝待 db push）
let ING_GROUPS = [];              // 合併顯示群組（ingredient-group-list）
let ING_GROUP_READY = false;        // ingredient-group-list 回 ready===true 才可新增／編輯合併組
let ING_GROUP_EDIT = null;          // 目前編輯中的組 { id|null, members:[{kind,itemId,label,name}] }
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
      { key: 'difficulty', label: '難易度', type: 'select', options: [['', '未設定'], ['1', '1（簡單）'], ['2', '2（中等）'], ['3', '3（進階）'], ['4', '4（困難）'], ['5', '5（挑戰）']] },
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
      { key: 'imageUrl', label: '去背小圖（網址）', ph: 'https://…', hint: '去背後的小圖；食材牆、食譜裡的食材格、貼文圖用這張' },
      { key: 'photoUrl', label: '一般圖片（正方形）', type: 'photo', ph: 'https://…', hint: '介紹視窗的大圖用這張；也可直接上傳，會自動置中裁成正方形' },
      { key: 'galleryUrls', label: '介紹圖（可多張，自動裁正方形）', type: 'gallery', hint: '介紹視窗主圖之後左右滑看的圖；第一張在最前面，可拖曳或按箭頭調順序' },
      { key: 'heating', label: '加熱方式', type: 'heating' },
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
      { key: 'imageUrl', label: '去背小圖（網址）', ph: 'https://…', hint: '去背後的小圖；食材牆、食譜裡的食材格、貼文圖用這張' },
      { key: 'photoUrl', label: '一般圖片（正方形）', type: 'photo', ph: 'https://…', hint: '介紹視窗的大圖用這張；也可直接上傳，會自動置中裁成正方形' },
      { key: 'galleryUrls', label: '介紹圖（可多張，自動裁正方形）', type: 'gallery', hint: '介紹視窗主圖之後左右滑看的圖；第一張在最前面，可拖曳或按箭頭調順序' },
      { key: 'heating', label: '加熱方式', type: 'heating' },
      { key: 'shopeeUrl', label: '蝦皮連結', ph: 'https://…' },
    ],
  },
};

// ===== 加熱方式（食材／成品）=====
// 圖示正本在 dondon-platform lib/shared/heating-icons.mjs，recipes.html 與本檔各一份複本，三處一起改
const HEATING_METHODS = ['電鍋', '平底鍋', '烤箱', '氣炸鍋', '微波爐', '隔水加熱'];
const HEATING_ICON_SVG = {
  電鍋: '<path d="M10 21 C4.5 21 4.5 28 10 28" fill="none"/><path d="M38 21 C43.5 21 43.5 28 38 28" fill="none"/><path d="M10 18 V35 Q10 41 16 41 H32 Q38 41 38 35 V18 Z" fill="{F}"/><path d="M10 23.5 H38" stroke-width="1.6"/><path d="M8 18 H40"/><path d="M11.5 18 Q24 7.5 36.5 18" fill="{F}"/><circle cx="24" cy="10" r="2.6" fill="{W}"/><rect x="20.5" y="32" width="7" height="5" rx="1.6" fill="{W}"/>',
  平底鍋: '<path d="M5 24 H33 V26 A7 7 0 0 1 26 33 H12 A7 7 0 0 1 5 26 Z" fill="{F}"/><path d="M33 25.5 H44" stroke-width="3.2"/><ellipse cx="17" cy="21" rx="5" ry="2.2" fill="none"/><path d="M13 15 q1.5 -2 0 -4 M19 14 q1.5 -2 0 -4" stroke-width="1.6"/>',
  烤箱: '<rect x="6" y="8" width="36" height="32" rx="4" fill="{F}"/><path d="M6 15 H42" stroke-width="1.8"/><circle cx="12" cy="11.5" r="1.4"/><circle cx="18" cy="11.5" r="1.4"/><path d="M30 11.5 H37" stroke-width="1.6"/><path d="M14 19 H34" stroke-width="2.6"/><rect x="10" y="22" width="28" height="14" rx="2.5" fill="{W}"/><path d="M13 32 l3 -3 l3 3 l3 -3 l3 3 l3 -3 l3 3 l3 -3" stroke-width="1.5" fill="none"/><path d="M11 40 v2.5 M37 40 v2.5"/>',
  氣炸鍋: '<path d="M12 40 V18 A12 12 0 0 1 36 18 V40 Z" fill="{F}"/><circle cx="24" cy="16" r="3"/><rect x="15" y="24" width="18" height="12" rx="3" fill="{W}"/><rect x="20" y="28.5" width="8" height="3" rx="1.5"/><path d="M14 40 v2 M34 40 v2"/>',
  微波爐: '<rect x="4" y="13" width="40" height="23" rx="4" fill="{F}"/><rect x="8" y="17" width="23" height="15" rx="2.5" fill="{W}"/><ellipse cx="19.5" cy="28" rx="7" ry="1.8" fill="none" stroke-width="1.6"/><path d="M16 24 h7 v4" stroke-width="1.4" fill="none"/><path d="M35 16.5 V33"/><rect x="37.5" y="17.5" width="4" height="3" rx="0.8" stroke-width="1.4"/><circle cx="38.5" cy="24" r="0.6"/><circle cx="40.5" cy="24" r="0.6"/><circle cx="38.5" cy="27" r="0.6"/><circle cx="40.5" cy="27" r="0.6"/><circle cx="38.5" cy="30" r="0.6"/><circle cx="40.5" cy="30" r="0.6"/><path d="M9 36 v2.5 M39 36 v2.5"/>',
  隔水加熱: '<path d="M7 20 H41 V33 A7 7 0 0 1 34 40 H14 A7 7 0 0 1 7 33 Z" fill="{F}"/><path d="M7 23 H3.5 M41 23 H44.5"/><path d="M16 22 H32 V27 A4 4 0 0 1 28 31 H20 A4 4 0 0 1 16 27 Z" fill="{W}"/><path d="M10 35 q2.5 -2 5 0 t5 0 t5 0 t5 0 t5 0" stroke-width="1.6" fill="none"/><path d="M19 15 q1.5 -2 0 -4 M25 14 q1.5 -2 0 -4 M31 15 q1.5 -2 0 -4" stroke-width="1.6"/>',
};
function sdHeatingIcon(method, size) {
  const inner = HEATING_ICON_SVG[method] || '';
  return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" fill="none" stroke="#B07F83" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner.replace(/\{F\}/g, '#F6E6E3').replace(/\{W\}/g, '#ffffff') + '</svg>';
}
function sdHeatingFieldHtml(id, rec) {
  const ready = RECIPE_DB_HEATING_READY;
  const cur = {};
  (rec && Array.isArray(rec.heating) ? rec.heating : []).forEach(h => { if (h && HEATING_METHODS.indexOf(h.method) >= 0) cur[h.method] = String(h.time || ''); });
  const rows = HEATING_METHODS.map((m, i) => {
    const on = Object.prototype.hasOwnProperty.call(cur, m);
    return '<div class="sd-heat-row" style="display:flex; align-items:center; gap:8px; margin-top:6px;">' +
      '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0; min-width:112px;">' +
      '<input type="checkbox" class="sd-heat-chk" data-method="' + sdEscapeHtml(m) + '"' + (on ? ' checked' : '') + (ready ? '' : ' disabled') + ' style="width:auto; margin:0;">' +
      sdHeatingIcon(m, 24) + '<span>' + sdEscapeHtml(m) + '</span></label>' +
      '<input type="text" class="sd-heat-time" data-method="' + sdEscapeHtml(m) + '" maxlength="30" placeholder="時間（選填）例：10 分鐘" value="' + sdEscapeHtml(cur[m] || '') + '"' +
      (on && ready ? '' : ' disabled') + ' style="flex:1; min-width:0; border:1px solid #E6DCD2; border-radius:8px; padding:6px 10px; background:#fff;"></div>';
  }).join('');
  const note = ready ? '' : '<div style="font-size:12px; color:var(--c-text-light); margin-top:4px;">待 db push 後才能編輯加熱方式</div>';
  return '<div id="' + id + '" class="sd-heat-wrap">' + rows + '</div>' + note;
}
function sdInitHeatingField(id) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.querySelectorAll('.sd-heat-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const t = wrap.querySelector('.sd-heat-time[data-method="' + chk.dataset.method + '"]');
      t.disabled = !chk.checked;
      if (chk.checked) t.focus();
    });
  });
}
function sdHeatingValue(id) {
  const wrap = document.getElementById(id);
  const out = [];
  if (!wrap) return out;
  wrap.querySelectorAll('.sd-heat-chk').forEach(chk => {
    if (!chk.checked) return;
    const t = wrap.querySelector('.sd-heat-time[data-method="' + chk.dataset.method + '"]');
    out.push({ method: chk.dataset.method, time: (t.value || '').trim().slice(0, 30) });
  });
  return out;
}

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
    RECIPE_DB_PHOTO_READY = data.photoReady === true;
    RECIPE_DB_GALLERY_READY = data.galleryReady === true;
    RECIPE_DB_HEATING_READY = data.heatingReady === true;
    RECIPE_DB = {
      recipes: data.recipes || [],
      ingredients: data.ingredients || [],
      products: data.products || [],
    };
    return sdLoadGroups().then(() => {
      renderRecipeDbTabs();
      renderRecipeDbList();
    });
  }).catch(err => {
    area.innerHTML = '<div class="task-empty">讀取失敗：' + sdEscapeHtml(err.message || '') + '</div>';
  });
}

// 合併顯示群組：讀不到（後端未上線／待 db push）不影響其他分頁，只是合併功能停用
function sdLoadGroups() {
  return sdApiPost('ingredient-group-list').then(data => {
    ING_GROUP_READY = !!(data && data.success && data.ready === true);
    ING_GROUPS = ING_GROUP_READY && Array.isArray(data.groups) ? data.groups : [];
  }).catch(() => { ING_GROUP_READY = false; ING_GROUPS = []; });
}

function renderRecipeDbTabs() {
  const box = document.getElementById('recipeDbTabs');
  const tabs = [
    ['recipe', '🍲 食譜', RECIPE_DB.recipes.length],
    ['ingredient', '🥕 食材', RECIPE_DB.ingredients.length],
    ['product', '📦 成品', RECIPE_DB.products.length],
    ['group', '🔗 合併顯示', ING_GROUPS.length],
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

// 品牌下拉選項：食材/成品分頁列自己表裡出現過的品牌；食譜分頁只列「目前真的有食譜在用」的品牌
// （不是兩表聯集——聯集會把食譜庫沒用到的品牌也列出來，選單一長串，雪莉 09-19 要求隱藏沒食譜的）。
// 換分頁時若原選擇不在新清單裡就退回「全部」。
function renderRecipeDbBrandFilter() {
  const sel = document.getElementById('recipeDbBrandFilter');
  sel.style.display = RECIPE_DB_TAB === 'group' ? 'none' : '';
  let brands;
  if (RECIPE_DB_TAB === 'recipe') {
    const used = new Set();
    RECIPE_DB.recipes.forEach(r => sdRecipeBrandsOf(r).forEach(b => used.add(b)));
    brands = Array.from(used).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  } else {
    const src = RECIPE_DB_TAB === 'ingredient' ? RECIPE_DB.ingredients : RECIPE_DB.products;
    brands = Array.from(new Set(src.map(r => String(r.brand || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }
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
  if (kind === 'group') { renderIngGroupList(area); return; }
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
// 一般圖片（正方形）欄位：貼網址或上傳檔案。上傳＝瀏覽器端 canvas 置中裁成正方形
// （長邊 >=1080 輸出 1080x1080，否則用短邊）→ webp（不支援退 jpeg）→ 沿用圖庫的
// image-upload（admin.js postTask；存 Supabase images bucket 的 ingredient-photos/，需「圖片庫」權限）。
// 不可放 Ingredients/：那個資料夾名稱＝雪莉自拍去背圖（recipes.html isOwnIngredientPhoto 舊路徑判斷）。
// ===================================================================
const SD_PHOTO_FOLDER = 'ingredient-photos';

function sdPhotoFieldHtml(id, f) {
  return '<input type="text" id="' + id + '" placeholder="' + sdEscapeHtml(f.ph || '') + '">' +
    '<div style="display:flex; align-items:center; gap:10px; margin-top:6px; flex-wrap:wrap;">' +
    '<img id="' + id + '_prev" alt="" style="width:64px; height:64px; object-fit:cover; border-radius:8px; background:var(--c-surface); display:none;">' +
    '<input type="file" id="' + id + '_file" accept="image/*" style="flex:1; min-width:0;">' +
    '</div>' +
    '<div id="' + id + '_msg" style="font-size:12px; color:var(--c-text-light); margin-top:2px;"></div>';
}

function sdInitPhotoField(id, ready) {
  if (ready === undefined) ready = RECIPE_DB_PHOTO_READY;
  const txt = document.getElementById(id);
  const file = document.getElementById(id + '_file');
  const prev = document.getElementById(id + '_prev');
  const msg = document.getElementById(id + '_msg');
  const refresh = () => {
    const v = txt.value.trim();
    if (v) { prev.src = v; prev.style.display = 'block'; } else { prev.removeAttribute('src'); prev.style.display = 'none'; }
  };
  prev.onerror = () => { prev.style.display = 'none'; };
  txt.addEventListener('input', refresh);
  refresh();
  if (!ready) {
    txt.disabled = true; file.disabled = true;
    msg.textContent = '這個圖片欄位尚未啟用（待 db push），目前無法儲存。';
    return;
  }
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    msg.textContent = '處理中…';
    file.disabled = true;
    try {
      const url = await sdUploadSquare(f, 'photo');
      txt.value = url;
      refresh();
      msg.textContent = '上傳完成，按「儲存」後才會寫入這筆資料。';
    } catch (err) {
      msg.textContent = '上傳失敗：' + (err && err.message || err);
    }
    file.value = '';
    file.disabled = false;
  });
}

// 共用：一張圖 → 置中裁正方形 → 上傳圖庫（ingredient-photos/）→ 回傳網址。需「圖片庫」權限
async function sdUploadSquare(file, tag) {
  if (typeof hasPerm === 'function' && !hasPerm('imageLibrary')) {
    throw new Error('上傳需要「圖片庫」權限；也可直接貼圖片網址');
  }
  const enc = await sdSquareEncode(file);
  const filename = (tag || 'photo') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + enc.ext;
  const res = await postTask({ type: 'image-upload', folder: SD_PHOTO_FOLDER, filename: filename, dataBase64: enc.base64 });
  const url = res && (res.download_url || res.url);
  if (!url) throw new Error('上傳回應沒有網址');
  return url;
}

// ===================================================================
// 介紹圖（多張）編輯器：多檔上傳、縮圖列可刪除、可拖曳或按箭頭調順序。
// 食材／成品表單與合併組視窗共用。controller：{ get() }
// ===================================================================
const SD_GALLERY = {};

function sdGalleryHtml(id) {
  return '<div id="' + id + '_list" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:6px;"></div>' +
    '<input type="file" id="' + id + '_file" accept="image/*" multiple>' +
    '<div id="' + id + '_msg" style="font-size:12px; color:var(--c-text-light); margin-top:2px;"></div>';
}

function sdInitGallery(id, urls, ready) {
  const listEl = document.getElementById(id + '_list');
  const file = document.getElementById(id + '_file');
  const msg = document.getElementById(id + '_msg');
  const state = { urls: (urls || []).filter(Boolean).slice() };
  SD_GALLERY[id] = { get: () => state.urls.slice() };
  let dragIdx = -1;

  function move(i, j) {
    if (j < 0 || j >= state.urls.length) return;
    const u = state.urls.splice(i, 1)[0];
    state.urls.splice(j, 0, u);
    draw();
  }
  function draw() {
    listEl.innerHTML = '';
    state.urls.forEach((u, i) => {
      const cell = document.createElement('div');
      cell.draggable = true;
      cell.style.cssText = 'width:76px; text-align:center; cursor:grab;';
      const img = document.createElement('img');
      img.src = u; img.alt = '';
      img.style.cssText = 'width:76px; height:76px; object-fit:cover; border-radius:8px; background:var(--c-surface); display:block;';
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex; justify-content:space-between; margin-top:3px; gap:2px;';
      const mk = (label, aria, fn, extra) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'task-mini-btn' + (extra || ''); b.textContent = label;
        b.setAttribute('aria-label', aria);
        b.style.cssText = 'padding:0 6px; min-width:0;';
        b.addEventListener('click', fn);
        return b;
      };
      bar.appendChild(mk('‹', '往前', () => move(i, i - 1)));
      bar.appendChild(mk('✕', '移除', () => { state.urls.splice(i, 1); draw(); }, ' x-btn'));
      bar.appendChild(mk('›', '往後', () => move(i, i + 1)));
      cell.appendChild(img); cell.appendChild(bar);
      cell.addEventListener('dragstart', e => { dragIdx = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) {} });
      cell.addEventListener('dragover', e => { e.preventDefault(); });
      cell.addEventListener('drop', e => { e.preventDefault(); if (dragIdx >= 0 && dragIdx !== i) move(dragIdx, i); dragIdx = -1; });
      listEl.appendChild(cell);
    });
  }
  draw();
  if (!ready) {
    file.disabled = true;
    msg.textContent = '介紹圖欄位尚未啟用（待 db push），目前無法儲存。';
    return;
  }
  file.addEventListener('change', async () => {
    const files = Array.from(file.files || []);
    if (!files.length) return;
    file.disabled = true;
    let done = 0;
    try {
      for (const f of files) {
        msg.textContent = '上傳中 ' + (done + 1) + '/' + files.length + '…';
        state.urls.push(await sdUploadSquare(f, 'gallery'));
        done++;
        draw();
      }
      msg.textContent = '上傳完成，按「儲存」後才會寫入。';
    } catch (err) {
      msg.textContent = '上傳失敗（已完成 ' + done + ' 張）：' + (err && err.message || err);
    }
    file.value = '';
    file.disabled = false;
  });
}

// 讀檔 → 置中裁正方形 → webp/jpeg base64
function sdSquareEncode(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const side = Math.min(w, h);
        const out = Math.max(w, h) >= 1080 ? 1080 : side;
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out, out);
        ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
        let dataUrl = canvas.toDataURL('image/webp', 0.85);
        let ext = '.webp';
        if (dataUrl.indexOf('data:image/webp') !== 0) { dataUrl = canvas.toDataURL('image/jpeg', 0.88); ext = '.jpg'; }
        URL.revokeObjectURL(url);
        resolve({ base64: dataUrl.split(',')[1], ext: ext });
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片')); };
    img.src = url;
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
    } else if (f.type === 'photo') {
      input = sdPhotoFieldHtml(id, f);
    } else if (f.type === 'gallery') {
      input = sdGalleryHtml(id);
    } else if (f.type === 'heating') {
      input = sdHeatingFieldHtml(id, rec);
    } else {
      input = '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" id="' + id + '" placeholder="' + sdEscapeHtml(f.ph || '') + '">';
    }
    const hint = f.hint ? '<div style="font-size:12px; color:var(--c-text-light); margin-top:2px;">' + sdEscapeHtml(f.hint) + '</div>' : '';
    return '<label for="' + id + '">' + sdEscapeHtml(f.label) + '</label>' + input + hint;
  });
  document.getElementById('sheetDbFormArea').innerHTML = parts.join('');

  // 填值（textarea/select/input；checkbox 已在產生 HTML 時處理）
  spec.fields.forEach(f => {
    if (f.type === 'checkbox' || f.type === 'gallery' || f.type === 'heating') return;
    const el = document.getElementById('sd_f_' + f.key);
    const val = rec ? rec[f.key] : undefined;
    el.value = val === undefined || val === null ? '' : String(val);
  });

  spec.fields.forEach(f => {
    if (f.type === 'photo') sdInitPhotoField('sd_f_' + f.key);
    if (f.type === 'heating') sdInitHeatingField('sd_f_' + f.key);
    if (f.type === 'gallery') sdInitGallery('sd_f_' + f.key, rec && Array.isArray(rec[f.key]) ? rec[f.key] : [], RECIPE_DB_GALLERY_READY);
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
    if (f.type === 'gallery') {
      if (RECIPE_DB_GALLERY_READY && SD_GALLERY['sd_f_' + f.key]) payload[f.key] = SD_GALLERY['sd_f_' + f.key].get();
      continue;
    }
    if (f.type === 'heating') {
      if (RECIPE_DB_HEATING_READY) payload[f.key] = sdHeatingValue('sd_f_' + f.key);
      continue;
    }
    const el = document.getElementById('sd_f_' + f.key);
    if (f.type === 'checkbox') { payload[f.key] = el.checked; continue; }
    if (f.type === 'photo' && !RECIPE_DB_PHOTO_READY) continue; // 欄位未建立：不送，避免後端報錯
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
document.getElementById('recipeDbAddBtn').addEventListener('click', () => {
  if (RECIPE_DB_TAB === 'group') openIngGroupModal(null); else openSheetDbEditModal(RECIPE_DB_TAB, null);
});
document.getElementById('recipeDbRefreshBtn').addEventListener('click', () => loadRecipeDbView(true));
document.getElementById('recipeDbSearch').addEventListener('input', () => { if (RECIPE_DB_LOADED) renderRecipeDbList(); });
document.getElementById('recipeDbBrandFilter').addEventListener('change', function () {
  RECIPE_DB_BRAND = this.value;
  if (RECIPE_DB_LOADED) renderRecipeDbList();
});


// ===================================================================
// 合併顯示：把幾個食材／成品併成一組，食材牆只出一張共同圖卡，介紹視窗內用口味切換。
// 後端 ingredient-group-list / -upsert / -delete；同一品項只能在一組（衝突由後端回錯誤訊息）。
// ===================================================================
function renderIngGroupList(area) {
  if (!ING_GROUP_READY) {
    area.innerHTML = '<div class="task-empty">合併顯示功能尚未啟用（待 db push），目前無法新增或編輯。</div>';
    return;
  }
  const q = (document.getElementById('recipeDbSearch').value || '').trim().toLowerCase();
  const list = ING_GROUPS.filter(g => !q ||
    String(g.name || '').toLowerCase().indexOf(q) !== -1 ||
    (g.members || []).some(m => String(m.name || '').toLowerCase().indexOf(q) !== -1 || String(m.label || '').toLowerCase().indexOf(q) !== -1));
  if (!list.length) {
    area.innerHTML = '<div class="task-empty">' + (ING_GROUPS.length ? '沒有符合的組' : '還沒有任何合併組，按右上「＋ 新增」建立') + '</div>';
    return;
  }
  area.innerHTML = '<div style="display:flex; flex-direction:column; gap:8px;">' + list.map(g => {
    const n = (g.members || []).length;
    const thumb = g.imageUrl
      ? '<img src="' + sdEscapeHtml(g.imageUrl) + '" alt="" style="width:56px; height:56px; object-fit:cover; border-radius:10px; background:var(--c-surface); flex:none;">'
      : '<div style="width:56px; height:56px; border-radius:10px; background:var(--c-surface); flex:none;"></div>';
    return '<div style="display:flex; align-items:center; gap:12px; padding:8px 10px; border-bottom:1px solid var(--c-line);">' + thumb +
      '<div style="flex:1; min-width:0;"><div style="font-weight:800;">' + sdEscapeHtml(g.name) + '</div>' +
      '<div style="font-size:12px; color:var(--c-text-light);">' + n + ' 個口味　' +
      sdEscapeHtml((g.members || []).map(m => m.label || m.name).filter(Boolean).join('、')) + '</div></div>' +
      '<button type="button" class="task-mini-btn sd-grp-edit" data-id="' + sdEscapeHtml(g.id) + '">編輯</button></div>';
  }).join('') + '</div>';
  area.querySelectorAll('.sd-grp-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = ING_GROUPS.find(x => x.id === btn.dataset.id);
      if (g) openIngGroupModal(g);
    });
  });
}

function openIngGroupModal(group) {
  if (!ING_GROUP_READY) { alert('合併顯示功能尚未啟用（待 db push）'); return; }
  ING_GROUP_EDIT = {
    id: group ? group.id : null,
    members: group ? (group.members || []).map(m => ({ kind: m.kind, itemId: m.itemId, name: m.name || '', no: m.no || '', label: m.label || '' })) : [],
  };
  document.getElementById('ingGroupTitle').textContent = group ? '編輯合併組' : '新增合併組';
  document.getElementById('ingGroupDeleteBtn').style.display = group ? 'inline-block' : 'none';
  document.getElementById('ingGroupForm').innerHTML =
    '<label for="ig_name">組名 *</label><input type="text" id="ig_name" placeholder="例如：餐包">' +
    '<label for="ig_intro">共用介紹（選「全部」時顯示在口味下方；選了口味則顯示該品項自己的介紹）</label><textarea id="ig_intro" rows="3" maxlength="1000" placeholder="例如：寶寶餐包，無添加…"></textarea>' +
    '<label for="ig_image">共同圖（食材牆上這組的那張卡）</label>' + sdPhotoFieldHtml('ig_image', { ph: 'https://…' }) +
    '<label>組介紹圖（可多張，自動裁正方形）</label>' + sdGalleryHtml('ig_gallery') +
    '<label>成員（口味）</label><div id="ig_members"></div>' +
    '<div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">' +
    '<input type="text" id="ig_search" placeholder="搜尋食材／成品名稱…" style="flex:1; min-width:140px;">' +
    '<select id="ig_pick" style="flex:2; min-width:160px;"></select>' +
    '<button type="button" class="task-mini-btn" id="ig_addMember">加入</button></div>' +
    '<label for="ig_sort">排序（數字小的排前面）</label><input type="number" id="ig_sort" placeholder="留空＝新增時排最後、編輯時維持原值">';
  document.getElementById('ig_name').value = group ? (group.name || '') : '';
  document.getElementById('ig_intro').value = group ? (group.intro || '') : '';
  document.getElementById('ig_image').value = group ? (group.imageUrl || '') : '';
  document.getElementById('ig_sort').value = group && group.sort != null ? String(group.sort) : '';
  sdInitPhotoField('ig_image', true);
  sdInitGallery('ig_gallery', group && Array.isArray(group.galleryUrls) ? group.galleryUrls : [], true);
  renderIngGroupMembers();
  renderIngGroupPick();
  document.getElementById('ig_search').addEventListener('input', renderIngGroupPick);
  document.getElementById('ig_addMember').addEventListener('click', () => {
    const v = document.getElementById('ig_pick').value;
    if (!v) return;
    const parts = v.split('|');
    const kind = parts[0], itemId = parts.slice(1).join('|');
    const src = kind === 'product' ? RECIPE_DB.products : RECIPE_DB.ingredients;
    const it = src.find(x => x.id === itemId);
    if (!it) return;
    ING_GROUP_EDIT.members.push({ kind, itemId, name: it.name || '', no: it.no || '', label: '' });
    renderIngGroupMembers();
    renderIngGroupPick();
  });
  const st = document.getElementById('ingGroupStatus');
  st.textContent = ''; st.className = 'form-status';
  document.getElementById('ingGroupModal').classList.add('show');
}

function closeIngGroupModal() {
  document.getElementById('ingGroupModal').classList.remove('show');
  ING_GROUP_EDIT = null;
}

function renderIngGroupMembers() {
  const box = document.getElementById('ig_members');
  const ms = ING_GROUP_EDIT.members;
  if (!ms.length) { box.innerHTML = '<div style="font-size:12px; color:var(--c-text-light);">還沒有成員，從下方搜尋挑選加入</div>'; return; }
  box.innerHTML = '';
  ms.forEach((m, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:6px;';
    const tag = document.createElement('span');
    tag.style.cssText = 'font-size:11px; padding:1px 7px; border-radius:999px; background:var(--c-surface); white-space:nowrap; flex:none;';
    tag.textContent = m.kind === 'product' ? '成品' : '食材';
    const nm = document.createElement('span');
    nm.style.cssText = 'flex:1; min-width:0; font-size:13px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    nm.textContent = m.name || m.no;
    nm.title = m.name || '';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.placeholder = '口味名（例如：黑糖）'; inp.value = m.label || '';
    inp.style.cssText = 'width:130px; flex:none;';
    inp.addEventListener('input', () => { m.label = inp.value; });
    const mk = (label, aria, fn, extra) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'task-mini-btn' + (extra || ''); b.textContent = label;
      b.setAttribute('aria-label', aria); b.style.cssText = 'padding:0 8px; min-width:0;';
      b.addEventListener('click', fn);
      return b;
    };
    const swap = (j) => { if (j < 0 || j >= ms.length) return; const x = ms.splice(i, 1)[0]; ms.splice(j, 0, x); renderIngGroupMembers(); };
    row.appendChild(tag); row.appendChild(nm); row.appendChild(inp);
    row.appendChild(mk('↑', '上移', () => swap(i - 1)));
    row.appendChild(mk('↓', '下移', () => swap(i + 1)));
    row.appendChild(mk('✕', '移除', () => { ms.splice(i, 1); renderIngGroupMembers(); renderIngGroupPick(); }, ' x-btn'));
    box.appendChild(row);
  });
}

function renderIngGroupPick() {
  const sel = document.getElementById('ig_pick');
  const q = (document.getElementById('ig_search').value || '').trim().toLowerCase();
  const inThis = new Set(ING_GROUP_EDIT.members.map(m => m.kind + '|' + m.itemId));
  const otherGroupOf = {};
  ING_GROUPS.forEach(g => {
    if (g.id === ING_GROUP_EDIT.id) return;
    (g.members || []).forEach(m => { otherGroupOf[m.kind + '|' + m.itemId] = g.name; });
  });
  const opts = [];
  [['ingredient', RECIPE_DB.ingredients], ['product', RECIPE_DB.products]].forEach(([kind, list]) => {
    list.forEach(it => {
      const key = kind + '|' + it.id;
      if (inThis.has(key)) return;
      const text = [it.name, it.brand, it.no].join(' ').toLowerCase();
      if (q && text.indexOf(q) === -1) return;
      const other = otherGroupOf[key];
      opts.push('<option value="' + sdEscapeHtml(key) + '"' + (other ? ' disabled' : '') + '>' +
        sdEscapeHtml((kind === 'product' ? '成品' : '食材') + '・' + (it.name || '') + (it.brand ? '（' + it.brand + '）' : '') + (other ? ' ── 已在「' + other + '」組' : '')) + '</option>');
    });
  });
  sel.innerHTML = '<option value="">' + (opts.length ? '選擇要加入的食材／成品（' + opts.length + '）' : '沒有符合的品項') + '</option>' + opts.slice(0, 300).join('');
}

document.getElementById('ingGroupSaveBtn').addEventListener('click', async () => {
  if (!ING_GROUP_EDIT) return;
  const st = document.getElementById('ingGroupStatus');
  const name = document.getElementById('ig_name').value.trim();
  if (!name) { st.textContent = '請填寫組名'; st.className = 'form-status error'; return; }
  if (!ING_GROUP_EDIT.members.length) { st.textContent = '至少要有一個成員'; st.className = 'form-status error'; return; }
  const payload = {
    name,
    intro: document.getElementById('ig_intro').value.trim(),
    imageUrl: document.getElementById('ig_image').value.trim(),
    galleryUrls: SD_GALLERY['ig_gallery'].get(),
    members: ING_GROUP_EDIT.members.map(m => ({ kind: m.kind, itemId: m.itemId, label: String(m.label || '').trim() })),
  };
  const sortV = document.getElementById('ig_sort').value.trim();
  if (sortV !== '') payload.sort = Number(sortV);
  if (ING_GROUP_EDIT.id) payload.id = ING_GROUP_EDIT.id;
  const btn = document.getElementById('ingGroupSaveBtn');
  btn.disabled = true; st.textContent = '儲存中…'; st.className = 'form-status';
  try {
    const res = await sdApiPost('ingredient-group-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    closeIngGroupModal();
    await sdLoadGroups();
    renderRecipeDbTabs(); renderRecipeDbList();
  } catch (err) {
    alert(err.message || '儲存失敗');
    st.textContent = '儲存失敗：' + err.message; st.className = 'form-status error';
  }
  btn.disabled = false;
});

document.getElementById('ingGroupDeleteBtn').addEventListener('click', async () => {
  if (!ING_GROUP_EDIT || !ING_GROUP_EDIT.id) return;
  if (!confirm('確定要刪除這個合併組嗎？成員品項不會被刪，前台會恢復各自一張卡。')) return;
  const st = document.getElementById('ingGroupStatus');
  try {
    const res = await sdApiPost('ingredient-group-delete', { id: ING_GROUP_EDIT.id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    closeIngGroupModal();
    await sdLoadGroups();
    renderRecipeDbTabs(); renderRecipeDbList();
  } catch (err) {
    alert(err.message || '刪除失敗');
    st.textContent = '刪除失敗：' + err.message; st.className = 'form-status error';
  }
});
