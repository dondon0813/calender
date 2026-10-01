// ===================================================================
// hall.js — 教材館（粉絲會員系統遊戲／教材解鎖商城後台）
//
// 端點沿用 fans.js 的 /api/fans（權限 fanEdit），全部 POST + type：
//   fan-admin-hall-list        → {success, tableReady, resources:[], eventChoices:[]}
//   fan-admin-hall-upsert      partial update，{id?}，回 {success, resource}（不含 rules/grants）
//   fan-admin-hall-delete      {id}
//   fan-admin-hall-rule-set    {resourceId, rules:[...]} 整批覆蓋 → {success, rules}
//   fan-admin-hall-grant-add   {resourceId, memberNo, note} → {success, grant}
//   fan-admin-hall-grant-delete {id}
//   fan-admin-hall-code-rule-set {resourceId, rules:[{eventLegacyId, productMatch, active}]}
//                              整批覆蓋 → {success, codeRules}（productMatch 必填，空的會被丟棄）
//   fan-admin-hall-code-sync   {} → {success, stats:{ordersChecked, issued, revoked, reactivated,
//                              warnings:[]}}（全租戶掃描，跟哪個資源無關；表未 push 回 tableReady:false）
//   fan-admin-hall-codes-list  {resourceId} → {success, tableReady, codes:[{id, code, seq, status,
//                              orderNo, buyerName, buyerEmail, redeemedBy, redeemedAt, createdAt}]}
//   fan-admin-hall-upload-url  {resourceId, fileName} → {success, path, signedUrl, token}
//                              （完整版檔案簽名直傳，PUT 之後再打 upsert 存 privatePath）
//   fan-admin-hall-image-upload {filename, dataBase64} → {success, url}（封面/截圖）
//
// 分頁掛載走 admin.js 慣例三處（VIEW_ID_MAP／VIEW_PERM_KEY／switchView 尾端呼叫
// loadHallView）＋admin.html 入口 data-view="hall"（同 books.js／fans.js）。最外層只有
// 宣告與 DOM 事件掛載；跟 admin.js 共用的只有全域 currentToken 變數。
// ===================================================================

const HALL_API_URL = 'https://dondon-platform.vercel.app/api/fans';
const HALL_MATERIALS_PAGE_BASE = 'https://dondon-platform.vercel.app/materials/';

let HALL_LOADED = false;      // 第一次進分頁才拉，之後切回來用快取；「重新整理」強制重拉
let HALL_TABLE_READY = true;  // 教材館資料表是否已 db push
let HALL_LIST = [];           // 最近一次 fan-admin-hall-list 的 resources
let HALL_KIND_TAB = 'file';   // 教材館子分頁過濾（file=教材分頁/game/audio；books.js setHallTab 控制）
let HALL_EVENT_CHOICES = [];  // {id, legacyId, title, startDate, endDate}
let HALL_BRAND_CHOICES = [];  // {id(brands uuid), name}：前台卡片品牌標籤用（2026-09-17）
let HALL_BRAND_READY = true;  // brand_id 欄位 migration 未 push＝false
let HALL_WM_READY = true; // watermark_member 欄位是否已 push
let HALL_BOOK_CHOICES = [];   // {id, title, kind('book'|'toy'), isPublished}：綁定繪本／玩具多選用
let HALL_BOOKIDS_READY = true; // book_ids 欄位 migration 未 push＝false
let HALL_FILES_READY = false; // 教材包（migration 20261002120000）：fan-admin-hall-list 回 filesReady===true 才算
let HALL_EDIT = null;       // 編輯中的資源工作副本（含 rules/grants）；null＝顯示列表

// ===== HTML 逃逸（自帶一份，不依賴 admin.js，同 books.js／fans.js 的做法）=====
function hallEscape(s) {
  // 注意不能寫 String(s || '')：數字 0（例如排序）會被吃掉變空白
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== 登入逾時 =====
// 跟 books.js／subscriptions.js／fans.js 用同一套處理方式（清 token、彈回密碼鎖）。
function hallForceRelogin() {
  currentToken = null;
  localStorage.removeItem('admin_unlocked');
  localStorage.removeItem('admin_token');
  document.getElementById('passwordGate').style.display = 'flex';
  document.getElementById('mainWrap').style.visibility = 'hidden';
}

// ===== API 呼叫（單一入口，全走 POST + type，同 fans.js） =====
async function hallApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(HALL_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    hallForceRelogin();
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

// ===== 日期輔助 =====
function hallFmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[2]) + '/' + Number(m[3]) : '';
}

// ===== 載入 =====
function loadHallView(forceReload) {
  if (HALL_LOADED && !forceReload) { hallRenderList(); return; }
  const area = document.getElementById('hallListArea');
  const banner = document.getElementById('hallBanner');
  if (area) area.innerHTML = '<div class="task-empty">讀取中…</div>';
  if (banner) banner.innerHTML = '';
  hallApiPost('fan-admin-hall-list').then(data => {
    if (!data || !data.success) {
      if (area) area.innerHTML = '<div class="task-empty">讀取失敗：' + hallEscape((data && data.error) || '未知錯誤') + '</div>';
      return;
    }
    HALL_LOADED = true;
    HALL_TABLE_READY = data.tableReady !== false;
    HALL_LIST = Array.isArray(data.resources) ? data.resources : [];
    HALL_EVENT_CHOICES = Array.isArray(data.eventChoices) ? data.eventChoices : [];
    HALL_BRAND_CHOICES = Array.isArray(data.brandChoices) ? data.brandChoices : [];
    HALL_BRAND_READY = data.brandReady !== false;
    HALL_WM_READY = data.watermarkReady !== false;
    HALL_BOOK_CHOICES = Array.isArray(data.bookChoices) ? data.bookChoices : [];
    HALL_BOOKIDS_READY = data.bookIdsReady !== false;
    HALL_FILES_READY = data.filesReady === true;
    hallRenderBanner();
    hallRenderList();
  }).catch(err => {
    if (area) area.innerHTML = '<div class="task-empty">讀取失敗：' + hallEscape(err.message || '') + '</div>';
  });
}

function hallRenderBanner() {
  const box = document.getElementById('hallBanner');
  if (!box) return;
  box.innerHTML = HALL_TABLE_READY ? '' :
    '<div style="background:#F3E3E1; color:#8a6d3b; border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:10px;">' +
    '⚠️ 教材館資料表尚未建立（待 db push），目前無法新增或儲存資源。</div>';
}

// ===== 清單 =====
function hallRenderList() {
  const area = document.getElementById('hallListArea');
  const editArea = document.getElementById('hallEditArea');
  if (!area) return;
  if (editArea) editArea.style.display = 'none';
  area.style.display = '';
  // 依教材館子分頁過濾（HALL_KIND_TAB 由 books.js setHallTab 控制：file/game/audio）；
  // i 一律保留 HALL_LIST 原索引（hallOpenEdit/hallDeleteFromList 都吃它）
  const rows = HALL_LIST.map((r, i) => ({ r, i })).filter(x => (x.r.kind || 'game') === HALL_KIND_TAB);
  if (!rows.length) {
    const kindName = HALL_KIND_TAB === 'file' ? '解鎖教材檔' : HALL_KIND_TAB === 'audio' ? '音檔' : '遊戲';
    area.innerHTML = '<div class="task-empty">還沒有' + kindName + '資源，按上面的「＋ 新增資源」開始！</div>';
    return;
  }
  const html = rows.map(({ r, i }) => {
    const kindBadge = '<span style="background:#E6ECF3; color:#3949ab; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">' +
      (r.kind === 'game' ? '🎮 遊戲' : r.kind === 'audio' ? '🎵 音檔' : '📄 檔案') + '</span>';
    const freeBadge = r.isFree
      ? '<span style="background:#e6f4ea; color:#1e7a3c; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">免費</span>'
      : '<span style="background:#F3E3E1; color:#B5485A; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">付費</span>';
    const pubBadge = r.isPublished
      ? '<span style="background:#3ddc84; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已發布</span>'
      : '<span style="background:#ccc; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">草稿</span>';
    const cover = r.coverUrl
      ? '<img src="' + hallEscape(r.coverUrl) + '" alt="" style="width:64px; height:64px; object-fit:cover; border-radius:8px; flex:none; background:#E6DCD2;">'
      : '<div style="width:64px; height:64px; border-radius:8px; flex:none; background:#E6DCD2; display:flex; align-items:center; justify-content:center; font-size:22px;">' + (r.kind === 'game' ? '🎮' : r.kind === 'audio' ? '🎵' : '📄') + '</div>';
    const ruleCount = (r.rules || []).length;
    const grantCount = (r.grants || []).length;
    const pageUrl = HALL_MATERIALS_PAGE_BASE + encodeURIComponent(r.slug || '');
    return '<div style="display:flex; gap:10px; align-items:center; background:var(--c-surface); border:1px solid var(--c-border); border-radius:12px; padding:10px 12px; margin-bottom:8px;">' +
      cover +
      '<div style="flex:1; min-width:0; cursor:pointer;" onclick="hallOpenEdit(' + i + ')">' +
        '<div style="font-weight:700; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + hallEscape(r.title) + '</div>' +
        '<div style="font-size:11px; color:var(--c-text-light); margin-top:2px;">/' + hallEscape(r.slug) + '　排序 ' + hallEscape(r.sort) + '</div>' +
        '<div style="display:flex; gap:6px; align-items:center; margin-top:4px; flex-wrap:wrap;">' + kindBadge + freeBadge + pubBadge +
          (function () { const b = r.brandId && HALL_BRAND_CHOICES.find(x => x.id === r.brandId); return b ? '<span style="background:#F3E3E1; color:#8B6E5E; border:1px solid #E5CFCD; border-radius:999px; padding:0 8px; font-size:11px; font-weight:700;">' + hallEscape(b.name) + '</span>' : ''; })() +
          (Array.isArray(r.bookIds) && r.bookIds.length ? '<span style="background:#F5EFE9; color:#8B6E5E; border-radius:999px; padding:0 8px; font-size:11px; font-weight:700;">綁 ' + r.bookIds.length + ' 本書</span>' : '') +
          '<span style="font-size:11px; color:var(--c-text-light);">規則 ' + ruleCount + '　開通 ' + grantCount + ' 人</span>' +
        '</div>' +
      '</div>' +
      '<a href="' + hallEscape(pageUrl) + '" target="_blank" class="task-mini-btn" style="flex:none; text-decoration:none;" onclick="event.stopPropagation();">🔗 前台頁</a>' +
      '<button type="button" class="task-mini-btn" style="flex:none;" onclick="hallOpenEdit(' + i + ')">✏️ 編輯</button>' +
      '<button type="button" class="task-mini-btn" style="flex:none; color:#B5485A;" onclick="hallDeleteFromList(' + i + ')">🗑</button>' +
    '</div>';
  }).join('');
  area.innerHTML = html;
}

async function hallDeleteFromList(i) {
  const r = HALL_LIST[i];
  if (!r) return;
  if (!confirm('確定要刪除「' + r.title + '」嗎？刪了就找不回來囉。')) return;
  try {
    const res = await hallApiPost('fan-admin-hall-delete', { id: r.id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    HALL_LIST = HALL_LIST.filter(x => x.id !== r.id);
    hallRenderList();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ===== 編輯器 =====
function hallOpenEdit(i) {
  const r = i >= 0 ? HALL_LIST[i] : null;
  HALL_EDIT = r
    ? {
        id: r.id, slug: r.slug || '', title: r.title || '', kind: r.kind || 'game',
        isFree: !!r.isFree, intro: r.intro || '', description: r.description || '',
        screenshots: Array.isArray(r.screenshots) ? r.screenshots.slice() : [],
        coverUrl: r.coverUrl || '', eventId: r.eventId || '', eventTitle: r.eventTitle || '', brandId: r.brandId || '',
        buyUrl: r.buyUrl || '', privatePath: r.privatePath || '', fileName: r.fileName || '',
        trialUrl: r.trialUrl || '', isPublished: !!r.isPublished, sort: r.sort || 0, watermarkMember: !!r.watermarkMember,
        bookIds: Array.isArray(r.bookIds) ? r.bookIds.slice() : [],
        availableFrom: r.availableFrom || '', tagsText: Array.isArray(r.tags) ? r.tags.join('，') : '', usageNote: r.usageNote || '',
        files: Array.isArray(r.files) ? r.files.slice() : [],
        rules: JSON.parse(JSON.stringify(r.rules || [])),
        grants: JSON.parse(JSON.stringify(r.grants || [])),
        codeRules: JSON.parse(JSON.stringify(r.codeRules || [])),
        codeRulesEffectiveFromSupported: hallCodeRulesSupportEffectiveFrom(r.codeRules)
      }
    : {
        // 新增預設類型跟著目前子分頁（教材分頁＝file）
        id: null, slug: '', title: '', kind: HALL_KIND_TAB || 'game', isFree: false, intro: '', description: '',
        screenshots: [], coverUrl: '', eventId: '', eventTitle: '', brandId: '', buyUrl: '', privatePath: '',
        fileName: '', trialUrl: '', isPublished: false, sort: 0, watermarkMember: false, bookIds: [], availableFrom: '', tagsText: '', usageNote: '', files: [], rules: [], grants: [], codeRules: [],
        codeRulesEffectiveFromSupported: true
      };
  hallRenderEditor();
}

// 重畫表單前把畫面上還沒存的輸入寫回工作副本（例如上傳封面後重畫，不能清掉剛改的欄位）
function hallSyncFormToEdit() {
  const e = HALL_EDIT;
  if (!e) return;
  const map = { hfTitle: 'title', hfSlug: 'slug', hfKind: 'kind', hfIntro: 'intro', hfDescription: 'description',
    hfCoverUrl: 'coverUrl', hfEvent: 'eventId', hfBrand: 'brandId', hfBuyUrl: 'buyUrl', hfFileName: 'fileName',
    hfTrialUrl: 'trialUrl', hfSort: 'sort', hfAvailableFrom: 'availableFrom', hfTags: 'tagsText', hfUsageNote: 'usageNote' };
  Object.keys(map).forEach(id => { const el = document.getElementById(id); if (el) e[map[id]] = el.value; });
  const free = document.getElementById('hfFree'); if (free) e.isFree = free.checked;
  const pub = document.getElementById('hfPublished'); if (pub) e.isPublished = pub.checked;
  const wm = document.getElementById('hfWatermark'); if (wm) e.watermarkMember = wm.checked;
}

// 綁定繪本／玩具：勾選當下直接寫進工作副本（Set 去重，維持陣列）
function hallToggleBook(id, checked) {
  if (!HALL_EDIT || !id) return;
  const set = new Set(Array.isArray(HALL_EDIT.bookIds) ? HALL_EDIT.bookIds : []);
  if (checked) set.add(id); else set.delete(id);
  HALL_EDIT.bookIds = Array.from(set);
}

// 搜尋只切換列的顯示，不重畫表單（避免失去焦點）
function hallBookFilter(q) {
  const kw = String(q || '').trim().toLowerCase();
  document.querySelectorAll('#hfBookList .hf-book-row').forEach(row => {
    row.style.display = (!kw || (row.dataset.title || '').indexOf(kw) >= 0) ? 'flex' : 'none';
  });
}

function hallCloseEdit() {
  HALL_EDIT = null;
  hallRenderList();
}

function hallRenderEditor() {
  const area = document.getElementById('hallListArea');
  const editArea = document.getElementById('hallEditArea');
  if (!editArea) return;
  if (area) area.style.display = 'none';
  editArea.style.display = '';
  const e = HALL_EDIT;
  const label = t => '<div style="font-size:12px; font-weight:700; color:var(--c-text-light); margin:12px 0 4px;">' + t + '</div>';
  const inputStyle = 'width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--c-border); border-radius:8px; font-size:14px; font-family:inherit;';

  const evOptions = ['<option value="">（不綁定）</option>'].concat(HALL_EVENT_CHOICES.map(c =>
    '<option value="' + hallEscape(c.id) + '"' + (c.id === e.eventId ? ' selected' : '') + '>' +
    hallEscape(c.title) + '（' + hallFmtDate(c.startDate) + '~' + hallFmtDate(c.endDate) + '）</option>'
  ));
  if (e.eventId && !HALL_EVENT_CHOICES.some(c => c.id === e.eventId)) {
    evOptions.push('<option value="' + hallEscape(e.eventId) + '" selected>' + (e.eventTitle ? hallEscape(e.eventTitle) : '（目前綁定的團，已超過下拉範圍）') + '</option>');
  }

  const brandOptions = ['<option value="">（不顯示品牌）</option>'].concat(HALL_BRAND_CHOICES.map(b =>
    '<option value="' + hallEscape(b.id) + '"' + (b.id === e.brandId ? ' selected' : '') + '>' + hallEscape(b.name) + '</option>'
  ));
  if (e.brandId && !HALL_BRAND_CHOICES.some(b => b.id === e.brandId)) {
    brandOptions.push('<option value="' + hallEscape(e.brandId) + '" selected>（目前品牌已不在品牌資料庫）</option>');
  }

  const fullFileStatus = e.privatePath
    ? '已上傳：' + hallEscape(e.fileName || e.privatePath)
    : '尚未上傳';

  editArea.innerHTML =
    '<div style="background:var(--c-surface); border:1px solid var(--c-border); border-radius:14px; padding:16px 16px 20px; max-width:680px;">' +
      '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
        '<button type="button" class="task-mini-btn" onclick="hallCloseEdit()">← 返回教材館</button>' +
        '<div style="flex:1;"></div>' +
        (e.id ? '<button type="button" class="task-mini-btn" style="color:#B5485A;" onclick="hallDelete()">🗑 刪除</button>' : '') +
      '</div>' +

      label('名稱 *') +
      '<input type="text" id="hfTitle" style="' + inputStyle + '" value="' + hallEscape(e.title) + '" placeholder="例如：數字迷宮小遊戲">' +

      label('slug（網址代稱，小寫英數與 -，留空由後端自動產生）') +
      '<input type="text" id="hfSlug" style="' + inputStyle + '" value="' + hallEscape(e.slug) + '" placeholder="例如：number-maze">' +

      '<div style="display:flex; gap:10px;"><div style="flex:1;">' +
        label('類型') +
        '<select id="hfKind" style="' + inputStyle + '" onchange="hallKindChange(this.value)">' +
          '<option value="game"' + (e.kind === 'game' ? ' selected' : '') + '>🎮 遊戲</option>' +
          '<option value="file"' + (e.kind === 'file' ? ' selected' : '') + '>📄 檔案（教材）</option>' +
          '<option value="audio"' + (e.kind === 'audio' ? ' selected' : '') + '>🎵 音檔（播放頁，行為同遊戲）</option>' +
        '</select>' +
      '</div><div style="flex:1;">' +
        label('排序（數字越小越前面）') +
        '<input id="hfSort" type="number" style="' + inputStyle + '" value="' + hallEscape(e.sort) + '">' +
      '</div></div>' +

      '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:12px;">' +
        '<input type="checkbox" id="hfFree"' + (e.isFree ? ' checked' : '') + ' style="width:auto; margin:0;"><span>💚 免費（不勾＝要靠下面的解鎖規則或手動開通才能玩／下載）</span>' +
      '</label>' +
      '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">' +
        '<input type="checkbox" id="hfPublished"' + (e.isPublished ? ' checked' : '') + ' style="width:auto; margin:0;"><span>✅ 發布（勾了會員才看得到這個資源）</span>' +
      '</label>' +
      '<label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-top:8px;">' +
        '<input type="checkbox" id="hfWatermark"' + (e.watermarkMember ? ' checked' : '') + ' style="width:auto; margin:0;"><span>🔖 下載時蓋會員編號浮水印（只對「教材」類的 PDF 有效；不勾＝客人拿到乾淨原檔）</span>' +
      '</label>' +
      (HALL_WM_READY ? '' : '<div style="font-size:11.5px; color:#B5485A; margin-top:4px;">⚠ 資料庫還沒更新，浮水印開關暫時存不進去（勾了存檔會提示，請雪莉執行 db push）</div>') +

      label('卡片簡介（列表用一兩句話）') +
      '<textarea id="hfIntro" rows="2" style="' + inputStyle + '" placeholder="簡短介紹，會出現在資源卡片上">' + hallEscape(e.intro) + '</textarea>' +

      label('介紹內文（空行分段）') +
      '<textarea id="hfDescription" rows="5" style="' + inputStyle + '" placeholder="完整介紹文字，空一行換一段">' + hallEscape(e.description) + '</textarea>' +

      label('封面圖') +
      '<div style="display:flex; gap:8px; align-items:center;">' +
        '<div id="hfCoverPreview" style="width:96px; height:96px; border-radius:8px; background:#F5EFE9; flex:none; overflow:hidden; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--c-text-light);">' +
          (e.coverUrl ? '<img src="' + hallEscape(e.coverUrl) + '" style="width:100%; height:100%; object-fit:cover;">' : '尚未設定') + '</div>' +
        '<div style="flex:1; display:flex; flex-direction:column; gap:6px;">' +
          '<input type="url" id="hfCoverUrl" style="' + inputStyle + '" value="' + hallEscape(e.coverUrl) + '" placeholder="圖片網址，或用下面按鈕上傳" oninput="hallCoverUrlInput(this.value)">' +
          '<button type="button" class="task-mini-btn" onclick="hallPickImage(function(url){ hallSyncFormToEdit(); HALL_EDIT.coverUrl = url; hallRenderEditor(); })">📤 上傳封面</button>' +
        '</div>' +
      '</div>' +

      label('截圖') +
      '<div id="hfScreenshots"></div>' +
      '<button type="button" class="task-mini-btn" onclick="hallPickImage(function(url){ HALL_EDIT.screenshots.push(url); hallRenderScreenshots(); })">＋ 新增截圖</button>' +

      label('品牌標籤（顯示在會員收藏庫、教材館、點數商城、我的兌換碼的卡片上）' + (HALL_BRAND_READY ? '' : '　<span style="color:#B5485A;">⚠ 資料庫待更新，選了也存不起來</span>')) +
      '<select id="hfBrand" style="' + inputStyle + '">' + brandOptions.join('') + '</select>' +

      label('📚 綁定繪本／玩具') +
      '<input id="hfBookSearch" type="search" style="' + inputStyle + ' margin-bottom:6px;" placeholder="搜尋書名…" oninput="hallBookFilter(this.value)">' +
      '<div id="hfBookList" style="max-height:180px; overflow:auto; border:1px solid var(--c-border); border-radius:8px; padding:4px 10px; background:#fff;">' +
        (HALL_BOOK_CHOICES.length ? HALL_BOOK_CHOICES.map(b => {
          const checked = (e.bookIds || []).indexOf(b.id) >= 0;
          return '<label class="hf-book-row" data-title="' + hallEscape(String(b.title || '').toLowerCase()) + '" style="display:flex; align-items:center; gap:8px; cursor:pointer; padding:4px 0; font-size:13px;">' +
            '<input type="checkbox" data-book-id="' + hallEscape(b.id) + '"' + (checked ? ' checked' : '') + ' style="width:auto; margin:0;" onchange="hallToggleBook(this.dataset.bookId, this.checked)">' +
            '<span>' + hallEscape(b.title) +
              (b.kind === 'toy' ? '<span style="color:var(--c-text-light); font-size:11.5px;">（玩具）</span>' : '') +
              (b.isPublished === false ? '<span style="color:var(--c-text-light); font-size:11.5px;">（草稿）</span>' : '') +
            '</span></label>';
        }).join('') : '<div style="font-size:12px; color:var(--c-text-light); padding:6px 0;">目前沒有繪本或玩具</div>') +
      '</div>' +
      '<div style="font-size:11.5px; color:var(--c-text-light); margin-top:4px;">綁定後，這本書的介紹視窗會出現這份教材的卡片（書和教材都已發布才顯示）</div>' +
      (HALL_BOOKIDS_READY ? '' : '<div style="font-size:11.5px; color:#B5485A; margin-top:4px;">⚠ 資料庫還沒更新，綁定暫時存不進去（請雪莉執行 db push）</div>') +

      label('綁定團購（純標記用，例如搭配某次開團的加購贈品；不綁定就跟團購無關）') +
      '<select id="hfEvent" style="' + inputStyle + '">' + evOptions.join('') + '</select>' +

      label('備用購買連結（可空）') +
      '<input type="url" id="hfBuyUrl" style="' + inputStyle + '" value="' + hallEscape(e.buyUrl) + '" placeholder="https://…">' +

      label('試玩版網址（可空）') +
      '<input type="url" id="hfTrialUrl" style="' + inputStyle + '" value="' + hallEscape(e.trialUrl) + '" placeholder="https://…">' +

      hallPackSectionHtml(e, label, inputStyle) +

      label('完整版檔案') +
      '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
        '<span style="font-size:13px;">' + fullFileStatus + '</span>' +
        (e.id
          ? '<button type="button" class="task-mini-btn" id="hfUploadFileBtn" onclick="hallUploadFullFile()">📤 上傳完整版檔案</button>'
          : '<span style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能上傳檔案</span>') +
      '</div>' +
      '<div id="hfFileNameWrap" style="display:' + (e.kind === 'file' ? '' : 'none') + ';">' +
        label('檔名（顯示用，上傳完整版檔案後自動帶入，可手動修改）') +
        '<input type="text" id="hfFileName" style="' + inputStyle + '" value="' + hallEscape(e.fileName) + '">' +
      '</div>' +

      '<div style="display:flex; gap:8px; margin-top:16px;">' +
        '<button type="button" class="task-submit-btn" id="hfSaveBtn" style="margin-top:0;" onclick="hallSave()">💾 儲存</button>' +
        '<button type="button" class="task-mini-btn" onclick="hallCloseEdit()">取消</button>' +
      '</div>' +
      '<div class="form-status" id="hfStatus"></div>' +

      '<hr style="margin:22px 0; border:none; border-top:1px solid var(--c-border);">' +
      '<h4 style="margin:0 0 8px; font-size:14px;">🔓 解鎖規則</h4>' +
      (e.id
        ? '<div id="hfRules"></div>' +
          '<div style="display:flex; gap:6px; margin-top:6px;">' +
            '<button type="button" class="task-mini-btn" onclick="hallAddRuleRow()">＋ 加一條</button>' +
            '<button type="button" class="task-mini-btn" onclick="hallSaveRules()">💾 儲存規則</button>' +
          '</div>' +
          '<div class="form-status" id="hfRulesStatus"></div>'
        : '<div style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能設定解鎖規則</div>') +

      '<hr style="margin:22px 0; border:none; border-top:1px solid var(--c-border);">' +
      '<h4 style="margin:0 0 8px; font-size:14px;">🎟️ 兌換碼規則</h4>' +
      '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:8px;">單筆訂單購買 n 組（n≥2）自動發 n−1 張可贈送兌換碼，買家在會員中心複製給朋友輸碼解鎖；每日收單自動產碼。生效日之前的舊訂單不會補發兌換碼，客人可用單品價格當優惠價兌換。</div>' +
      (e.id
        ? '<div id="hfCodeRules"></div>' +
          '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">' +
            '<button type="button" class="task-mini-btn" onclick="hallAddCodeRuleRow()">＋ 加一條</button>' +
            '<button type="button" class="task-mini-btn" onclick="hallSaveCodeRules()">💾 儲存兌換碼規則</button>' +
            '<button type="button" class="task-mini-btn" onclick="hallCodeSync()">🔄 立即同步產碼</button>' +
            '<button type="button" class="task-mini-btn" onclick="hallToggleCodesList()">📋 查看兌換碼</button>' +
          '</div>' +
          '<div class="form-status" id="hfCodeRulesStatus"></div>' +
          '<div class="form-status" id="hfCodeSyncStatus"></div>' +
          '<div id="hfCodesList" style="display:none; margin-top:10px;"></div>'
        : '<div style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能設定兌換碼規則</div>') +

      '<hr style="margin:22px 0; border:none; border-top:1px solid var(--c-border);">' +
      '<h4 style="margin:0 0 8px; font-size:14px;">🎟️ 手動開通</h4>' +
      (e.id
        ? '<div id="hfGrants"></div>' +
          '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">' +
            '<input type="text" id="hfGrantMemberNo" style="flex:1; min-width:120px; padding:7px 9px; border:1px solid var(--c-border); border-radius:8px;" placeholder="會員編號，如 D26090001">' +
            '<input type="text" id="hfGrantNote" style="flex:1; min-width:120px; padding:7px 9px; border:1px solid var(--c-border); border-radius:8px;" placeholder="備註（可空）">' +
            '<button type="button" class="task-mini-btn" onclick="hallAddGrant()">✅ 開通</button>' +
          '</div>' +
          '<div class="form-status" id="hfGrantsStatus"></div>'
        : '<div style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能手動開通</div>') +
    '</div>';

  hallRenderScreenshots();
  hallRenderFiles();
  hallRenderRules();
  hallRenderCodeRules();
  hallRenderGrants();
}

function hallKindChange(val) {
  if (HALL_EDIT) HALL_EDIT.kind = val;
  const wrap = document.getElementById('hfFileNameWrap');
  if (wrap) wrap.style.display = val === 'file' ? '' : 'none';
  const pack = document.getElementById('hfPackWrap');
  if (pack) pack.style.display = val === 'file' ? '' : 'none';
}

function hallCoverUrlInput(val) {
  if (!HALL_EDIT) return;
  HALL_EDIT.coverUrl = val;
  const prev = document.getElementById('hfCoverPreview');
  if (prev) prev.innerHTML = val ? '<img src="' + hallEscape(val) + '" style="width:100%; height:100%; object-fit:cover;">' : '尚未設定';
}

// ===== 截圖清單 =====
function hallRenderScreenshots() {
  const box = document.getElementById('hfScreenshots');
  if (!box || !HALL_EDIT) return;
  const list = HALL_EDIT.screenshots || [];
  box.innerHTML = list.length
    ? '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:6px;">' +
      list.map((url, i) =>
        '<div style="position:relative; width:96px; height:96px;">' +
          '<img src="' + hallEscape(url) + '" style="width:100%; height:100%; object-fit:cover; border-radius:8px; background:#E6DCD2;">' +
          '<button type="button" class="task-mini-btn" style="position:absolute; top:-8px; right:-8px; padding:0 6px; line-height:20px; border-radius:999px;" onclick="hallRemoveScreenshot(' + i + ')">✕</button>' +
        '</div>'
      ).join('') + '</div>'
    : '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">尚未新增截圖</div>';
}
function hallRemoveScreenshot(i) {
  if (!HALL_EDIT) return;
  HALL_EDIT.screenshots.splice(i, 1);
  hallRenderScreenshots();
}

// ===== 解鎖規則 =====
function hallRenderRules() {
  const box = document.getElementById('hfRules');
  if (!box || !HALL_EDIT) return;
  const rules = HALL_EDIT.rules || [];
  if (!rules.length) {
    box.innerHTML = '<div style="font-size:12px; color:var(--c-text-light);">還沒有規則（沒規則就只能靠手動開通，或依前台其他規則判斷）</div>';
    return;
  }
  const knownLegacyIds = HALL_EVENT_CHOICES.map(c => c.legacyId);
  box.innerHTML = rules.map((r, i) => {
    const isCustom = !!r.eventLegacyId && knownLegacyIds.indexOf(r.eventLegacyId) === -1;
    const options = ['<option value=""' + (!r.eventLegacyId ? ' selected' : '') + '>（任何團）</option>']
      .concat(HALL_EVENT_CHOICES.map(c =>
        '<option value="' + hallEscape(c.legacyId) + '"' + (c.legacyId === r.eventLegacyId ? ' selected' : '') + '>' + hallEscape(c.title) + '</option>'
      ))
      .concat(['<option value="__custom__"' + (isCustom ? ' selected' : '') + '>自訂輸入…</option>']);
    return '<div class="hall-rule-row" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; border:1px dashed var(--c-border); border-radius:8px; padding:8px; margin-bottom:6px;">' +
      '<select style="flex:1; min-width:140px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" onchange="hallRuleEventChange(' + i + ', this.value)">' + options.join('') + '</select>' +
      (isCustom
        ? '<input type="text" style="flex:1; min-width:100px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.eventLegacyId) + '" placeholder="團購 legacyId" oninput="HALL_EDIT.rules[' + i + '].eventLegacyId=this.value">'
        : '') +
      '<input type="text" style="flex:1; min-width:120px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.productMatch) + '" placeholder="品名關鍵字（留空＝該團任一已付款訂單即解鎖）" oninput="HALL_EDIT.rules[' + i + '].productMatch=this.value">' +
      '<label style="display:flex; align-items:center; gap:4px; font-size:12px;"><input type="checkbox"' + (r.active !== false ? ' checked' : '') + ' onchange="HALL_EDIT.rules[' + i + '].active=this.checked"> 啟用</label>' +
      '<button type="button" class="task-mini-btn" onclick="hallRemoveRule(' + i + ')">✕</button>' +
    '</div>';
  }).join('');
}
function hallRuleEventChange(i, val) {
  if (!HALL_EDIT) return;
  if (val === '__custom__') {
    const cur = HALL_EDIT.rules[i].eventLegacyId;
    const knownLegacyIds = HALL_EVENT_CHOICES.map(c => c.legacyId);
    HALL_EDIT.rules[i].eventLegacyId = (cur && knownLegacyIds.indexOf(cur) === -1) ? cur : '';
  } else {
    HALL_EDIT.rules[i].eventLegacyId = val;
  }
  hallRenderRules();
}
function hallAddRuleRow() {
  if (!HALL_EDIT) return;
  HALL_EDIT.rules.push({ eventLegacyId: '', productMatch: '', active: true });
  hallRenderRules();
}
function hallRemoveRule(i) {
  if (!HALL_EDIT) return;
  HALL_EDIT.rules.splice(i, 1);
  hallRenderRules();
}
async function hallSaveRules() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const statusEl = document.getElementById('hfRulesStatus');
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  const rules = (HALL_EDIT.rules || []).map(r => ({
    eventLegacyId: (r.eventLegacyId || '').trim(),
    productMatch: (r.productMatch || '').trim(),
    active: r.active !== false,
    includeFirst: r.includeFirst === true
  }));
  try {
    const res = await hallApiPost('fan-admin-hall-rule-set', { resourceId: HALL_EDIT.id, rules });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    HALL_EDIT.rules = res.rules || [];
    const idx = HALL_LIST.findIndex(x => x.id === HALL_EDIT.id);
    if (idx >= 0) HALL_LIST[idx].rules = HALL_EDIT.rules;
    statusEl.textContent = '已儲存';
    statusEl.className = 'form-status';
    hallRenderRules();
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
}

// ===== 兌換碼規則 =====
// 跟「解鎖規則」共用同一套下拉／自訂輸入寫法，差別是 productMatch 必填（後端會丟棄空的）。
// 判斷後端是否已支援 effectiveFrom（生效日）欄位：規則清單裡任一條帶有這個 key 就算支援；沒有任何規則時視為已支援。
function hallCodeRulesSupportEffectiveFrom(list) {
  if (!Array.isArray(list) || !list.length) return true;
  return list.some(function (r) { return r && Object.prototype.hasOwnProperty.call(r, 'effectiveFrom'); });
}
function hallTodayDateStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}
function hallRenderCodeRules() {
  const box = document.getElementById('hfCodeRules');
  if (!box || !HALL_EDIT) return;
  const rules = HALL_EDIT.codeRules || [];
  if (!rules.length) {
    box.innerHTML = '<div style="font-size:12px; color:var(--c-text-light);">還沒有兌換碼規則（沒規則就不會自動產碼）</div>';
    return;
  }
  const knownLegacyIds = HALL_EVENT_CHOICES.map(c => c.legacyId);
  box.innerHTML = rules.map((r, i) => {
    const isCustom = !!r.eventLegacyId && knownLegacyIds.indexOf(r.eventLegacyId) === -1;
    const options = ['<option value=""' + (!r.eventLegacyId ? ' selected' : '') + '>（任何團）</option>']
      .concat(HALL_EVENT_CHOICES.map(c =>
        '<option value="' + hallEscape(c.legacyId) + '"' + (c.legacyId === r.eventLegacyId ? ' selected' : '') + '>' + hallEscape(c.title) + '</option>'
      ))
      .concat(['<option value="__custom__"' + (isCustom ? ' selected' : '') + '>自訂輸入…</option>']);
    return '<div class="hall-rule-row" style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; border:1px dashed var(--c-border); border-radius:8px; padding:8px; margin-bottom:6px;">' +
      '<select style="flex:1; min-width:140px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" onchange="hallCodeRuleEventChange(' + i + ', this.value)">' + options.join('') + '</select>' +
      (isCustom
        ? '<input type="text" style="flex:1; min-width:100px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.eventLegacyId) + '" placeholder="團購 legacyId" oninput="HALL_EDIT.codeRules[' + i + '].eventLegacyId=this.value">'
        : '') +
      '<input type="text" style="flex:1; min-width:120px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.productMatch) + '" placeholder="品名關鍵字（必填）" oninput="HALL_EDIT.codeRules[' + i + '].productMatch=this.value">' +
      '<input type="number" min="0" style="width:96px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.excludeAmount == null ? '' : r.excludeAmount) + '" placeholder="單品價格" title="這個商品單買的價格（元）。填了：客人買大組合時，入點只扣這個單品價×件數，其他品項照常入點；留空＝命中品項整行都不入點" oninput="HALL_EDIT.codeRules[' + i + '].excludeAmount=this.value">' +
      '<input type="date" style="width:140px; padding:6px; border:1px solid #E6DCD2; border-radius:6px;" value="' + hallEscape(r.effectiveFrom || '') + '" title="教材上架日。這天之後下單的訂單照常送兌換碼；這天之前的舊訂單不補發、不扣點，客人可用單品價格當優惠價兌換。留空＝所有訂單都發碼（舊做法）" oninput="HALL_EDIT.codeRules[' + i + '].effectiveFrom=this.value">' +
      '<label style="display:flex; align-items:center; gap:4px; font-size:12px;" title="勾選＝每組發1張碼（買1組送1張，適合下單者已由解鎖規則涵蓋的團）；不勾＝買n組發n−1張"><input type="checkbox"' + (r.includeFirst ? ' checked' : '') + ' onchange="HALL_EDIT.codeRules[' + i + '].includeFirst=this.checked"> 含第1組</label>' +
      '<label style="display:flex; align-items:center; gap:4px; font-size:12px;"><input type="checkbox"' + (r.active !== false ? ' checked' : '') + ' onchange="HALL_EDIT.codeRules[' + i + '].active=this.checked"> 啟用</label>' +
      '<button type="button" class="task-mini-btn" onclick="hallRemoveCodeRule(' + i + ')">✕</button>' +
    '</div>';
  }).join('');
}
function hallCodeRuleEventChange(i, val) {
  if (!HALL_EDIT) return;
  if (val === '__custom__') {
    const cur = HALL_EDIT.codeRules[i].eventLegacyId;
    const knownLegacyIds = HALL_EVENT_CHOICES.map(c => c.legacyId);
    HALL_EDIT.codeRules[i].eventLegacyId = (cur && knownLegacyIds.indexOf(cur) === -1) ? cur : '';
  } else {
    HALL_EDIT.codeRules[i].eventLegacyId = val;
  }
  hallRenderCodeRules();
}
function hallAddCodeRuleRow() {
  if (!HALL_EDIT) return;
  HALL_EDIT.codeRules.push({ eventLegacyId: '', productMatch: '', active: true, includeFirst: false, excludeAmount: null, effectiveFrom: hallTodayDateStr() });
  hallRenderCodeRules();
}
function hallRemoveCodeRule(i) {
  if (!HALL_EDIT) return;
  HALL_EDIT.codeRules.splice(i, 1);
  hallRenderCodeRules();
}
async function hallSaveCodeRules() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const hasEffectiveFromNoAmount = (HALL_EDIT.codeRules || []).some(r =>
    r && r.effectiveFrom && (r.excludeAmount === '' || r.excludeAmount == null)
  );
  if (hasEffectiveFromNoAmount) {
    if (!confirm('有填生效日但沒填單品價格，舊訂單的客人將看不到優惠價。確定要儲存嗎？')) return;
  }
  const statusEl = document.getElementById('hfCodeRulesStatus');
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  const supportsEffectiveFrom = HALL_EDIT.codeRulesEffectiveFromSupported !== false;
  const rules = (HALL_EDIT.codeRules || []).map(r => {
    const rule = {
      eventLegacyId: (r.eventLegacyId || '').trim(),
      productMatch: (r.productMatch || '').trim(),
      active: r.active !== false,
      includeFirst: r.includeFirst === true,
      excludeAmount: r.excludeAmount === '' || r.excludeAmount == null ? null : Number(r.excludeAmount)
    };
    // 後端尚未支援 effectiveFrom（既有規則都沒有這個 key）時不送出，避免舊後端／欄位未建立時存檔失敗
    if (supportsEffectiveFrom) {
      rule.effectiveFrom = r.effectiveFrom ? r.effectiveFrom : null;
    }
    return rule;
  });
  try {
    const res = await hallApiPost('fan-admin-hall-code-rule-set', { resourceId: HALL_EDIT.id, rules });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    HALL_EDIT.codeRules = res.codeRules || [];
    HALL_EDIT.codeRulesEffectiveFromSupported = hallCodeRulesSupportEffectiveFrom(HALL_EDIT.codeRules);
    const idx = HALL_LIST.findIndex(x => x.id === HALL_EDIT.id);
    if (idx >= 0) HALL_LIST[idx].codeRules = HALL_EDIT.codeRules;
    statusEl.textContent = '已儲存';
    statusEl.className = 'form-status';
    hallRenderCodeRules();
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
}

// ===== 立即同步產碼（全租戶掃描，跟目前編輯中的資源無關）=====
async function hallCodeSync() {
  const statusEl = document.getElementById('hfCodeSyncStatus');
  if (!statusEl) return;
  statusEl.textContent = '同步中…';
  statusEl.className = 'form-status';
  try {
    const res = await hallApiPost('fan-admin-hall-code-sync', {});
    if (res && res.tableReady === false) {
      statusEl.textContent = '兌換碼資料表尚未建立（待 db push）';
      statusEl.className = 'form-status error';
      return;
    }
    if (!res || !res.success) throw new Error((res && res.error) || '同步失敗');
    const s = res.stats || {};
    let html = '核對 ' + (s.ordersChecked || 0) + ' 單｜補發 ' + (s.issued || 0) + '｜收回 ' + (s.revoked || 0) +
      (s.reactivated ? '｜恢復 ' + s.reactivated : '');
    if (Array.isArray(s.warnings) && s.warnings.length) {
      html += '<ul style="margin:6px 0 0 18px; padding:0;">' + s.warnings.map(w => '<li>' + hallEscape(w) + '</li>').join('') + '</ul>';
    }
    statusEl.innerHTML = html;
    statusEl.className = 'form-status';
  } catch (err) {
    statusEl.textContent = '同步失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
}

// ===== 查看兌換碼（只看目前編輯中的資源）=====
function hallToggleCodesList() {
  const box = document.getElementById('hfCodesList');
  if (!box) return;
  if (box.style.display === 'none') {
    box.style.display = '';
    hallLoadCodesList();
  } else {
    box.style.display = 'none';
  }
}
async function hallLoadCodesList() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const box = document.getElementById('hfCodesList');
  if (!box) return;
  box.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const res = await hallApiPost('fan-admin-hall-codes-list', { resourceId: HALL_EDIT.id });
    if (res && res.tableReady === false) {
      box.innerHTML = '<div class="task-empty">兌換碼資料表尚未建立（待 db push）</div>';
      return;
    }
    if (!res || !res.success) throw new Error((res && res.error) || '讀取失敗');
    const codes = Array.isArray(res.codes) ? res.codes : [];
    if (!codes.length) {
      box.innerHTML = '<div class="task-empty">尚未產生任何兌換碼</div>';
      return;
    }
    const statusBadge = st => {
      if (st === 'redeemed') return '<span style="background:#E6DCD2; color:#555; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已使用</span>';
      if (st === 'revoked') return '<span style="background:#F3E3E1; color:#B5485A; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已收回</span>';
      return '<span style="background:#e6f4ea; color:#1e7a3c; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">未使用</span>';
    };
    box.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12px;">' +
      '<thead><tr style="text-align:left; border-bottom:1px solid var(--c-border);">' +
        '<th style="padding:6px 8px;">碼</th><th style="padding:6px 8px;">狀態</th><th style="padding:6px 8px;">訂單編號</th>' +
        '<th style="padding:6px 8px;">訂購人</th><th style="padding:6px 8px;">兌換者</th><th style="padding:6px 8px;">兌換時間</th>' +
      '</tr></thead><tbody>' +
      codes.map(c => '<tr style="border-bottom:1px solid var(--c-border);">' +
        '<td style="padding:6px 8px; font-family:monospace; font-weight:700;">' + hallEscape(c.code) + '</td>' +
        '<td style="padding:6px 8px;">' + statusBadge(c.status) + '</td>' +
        '<td style="padding:6px 8px;">' + hallEscape(c.orderNo) + '</td>' +
        '<td style="padding:6px 8px;">' + hallEscape(c.buyerName) + '</td>' +
        '<td style="padding:6px 8px;">' + hallEscape(c.redeemedBy) + '</td>' +
        '<td style="padding:6px 8px;">' + hallEscape(c.redeemedAt) + '</td>' +
      '</tr>').join('') +
      '</tbody></table></div>';
  } catch (err) {
    box.innerHTML = '<div class="task-empty">讀取失敗：' + hallEscape(err.message || '') + '</div>';
  }
}

// ===== 手動開通 =====
function hallRenderGrants() {
  const box = document.getElementById('hfGrants');
  if (!box || !HALL_EDIT) return;
  const grants = HALL_EDIT.grants || [];
  box.innerHTML = grants.length
    ? grants.map(g =>
        '<div style="display:flex; gap:8px; align-items:center; padding:6px 0; border-bottom:1px solid var(--c-border); flex-wrap:wrap;">' +
          '<span style="font-weight:700;">' + hallEscape(g.memberNo) + '</span>' +
          (g.displayName ? '<span style="font-size:12px; color:var(--c-text-light);">' + hallEscape(g.displayName) + '</span>' : '') +
          (g.note ? '<span style="font-size:12px; color:var(--c-text-light);">' + hallEscape(g.note) + '</span>' : '') +
          '<div style="flex:1;"></div>' +
          '<button type="button" class="task-mini-btn" onclick="hallRemoveGrant(\'' + hallEscape(g.id) + '\')">移除</button>' +
        '</div>'
      ).join('')
    : '<div style="font-size:12px; color:var(--c-text-light);">目前沒有手動開通名單</div>';
}
async function hallAddGrant() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const memberNo = document.getElementById('hfGrantMemberNo').value.trim();
  const note = document.getElementById('hfGrantNote').value.trim();
  const statusEl = document.getElementById('hfGrantsStatus');
  if (!memberNo) { statusEl.textContent = '請輸入會員編號'; statusEl.className = 'form-status error'; return; }
  statusEl.textContent = '開通中…';
  statusEl.className = 'form-status';
  try {
    const res = await hallApiPost('fan-admin-hall-grant-add', { resourceId: HALL_EDIT.id, memberNo, note });
    if (!res || !res.success) throw new Error((res && res.error) || '開通失敗');
    HALL_EDIT.grants.push(res.grant);
    const idx = HALL_LIST.findIndex(x => x.id === HALL_EDIT.id);
    if (idx >= 0) HALL_LIST[idx].grants = HALL_EDIT.grants;
    document.getElementById('hfGrantMemberNo').value = '';
    document.getElementById('hfGrantNote').value = '';
    statusEl.textContent = '已開通';
    statusEl.className = 'form-status';
    hallRenderGrants();
  } catch (err) {
    statusEl.textContent = '開通失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
}
async function hallRemoveGrant(id) {
  if (!confirm('確定要移除這個人的開通資格嗎？')) return;
  try {
    const res = await hallApiPost('fan-admin-hall-grant-delete', { id });
    if (!res || !res.success) throw new Error((res && res.error) || '移除失敗');
    if (HALL_EDIT) HALL_EDIT.grants = HALL_EDIT.grants.filter(g => g.id !== id);
    const idx = HALL_EDIT ? HALL_LIST.findIndex(x => x.id === HALL_EDIT.id) : -1;
    if (idx >= 0) HALL_LIST[idx].grants = HALL_EDIT.grants;
    hallRenderGrants();
  } catch (err) {
    alert('移除失敗：' + err.message);
  }
}

// ===== 圖片：客戶端縮圖（最長邊 1600px、WebP）→ fan-admin-hall-image-upload（同 blog.js 做法）=====
function hallPickImage(onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const url = await hallUploadImage(file);
      onDone(url);
    } catch (err) {
      alert('圖片上傳失敗：' + err.message);
    }
  };
  input.click();
}
async function hallUploadImage(file) {
  const bitmap = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('讀不懂這個圖片檔'));
    img.src = URL.createObjectURL(file);
  });
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(bitmap.src);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.85));
  if (!blob) throw new Error('圖片轉檔失敗');
  const base64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('圖片編碼失敗'));
    fr.readAsDataURL(blob);
  });
  const filename = 'hall-' + Date.now() + '.webp';
  const res = await hallApiPost('fan-admin-hall-image-upload', { filename, dataBase64: base64 });
  if (!res || !res.success) throw new Error((res && res.error) || '上傳失敗');
  return res.url;
}

// ===== 完整版檔案：簽名網址瀏覽器直傳（同 books.js material-upload-url 做法）=====
// 遊戲 HTML 檔可能到 4.7MB，一律走簽名直傳，不能 base64 塞進一般 API。
async function hallUploadFullFile() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const input = document.createElement('input');
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const btn = document.getElementById('hfUploadFileBtn');
    if (btn) { btn.disabled = true; btn.textContent = '上傳中…'; }
    try {
      const urlRes = await hallApiPost('fan-admin-hall-upload-url', { resourceId: HALL_EDIT.id, fileName: file.name });
      if (!urlRes || urlRes.success !== true) throw new Error((urlRes && urlRes.error) || '取得上傳網址失敗');
      const contentType = /\.html?$/i.test(file.name) ? 'text/html' : (file.type || 'application/octet-stream');
      const putRes = await fetch(urlRes.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      });
      if (!putRes.ok) throw new Error('檔案上傳失敗（' + putRes.status + '）');
      const upsertPayload = { id: HALL_EDIT.id, privatePath: urlRes.path };
      if (HALL_EDIT.kind === 'file') upsertPayload.fileName = file.name;
      const saveRes = await hallApiPost('fan-admin-hall-upsert', upsertPayload);
      if (!saveRes || !saveRes.success) throw new Error((saveRes && saveRes.error) || '儲存檔案路徑失敗');
      HALL_EDIT.privatePath = urlRes.path;
      HALL_EDIT.fileName = file.name;
      const idx = HALL_LIST.findIndex(x => x.id === HALL_EDIT.id);
      if (idx >= 0) Object.assign(HALL_LIST[idx], { privatePath: urlRes.path, fileName: file.name });
      hallRenderEditor();
      alert('完整版檔案上傳完成：' + file.name);
    } catch (err) {
      alert('上傳失敗：' + err.message);
      if (btn) { btn.disabled = false; btn.textContent = '📤 上傳完整版檔案'; }
    }
  };
  input.click();
}

// ===== 儲存／刪除 =====
async function hallSave() {
  const e = HALL_EDIT;
  if (!e) return;
  const title = document.getElementById('hfTitle').value.trim();
  const statusEl = document.getElementById('hfStatus');
  if (!title) { statusEl.textContent = '請填寫名稱'; statusEl.className = 'form-status error'; return; }
  const payload = {
    title,
    slug: document.getElementById('hfSlug').value.trim(),
    kind: document.getElementById('hfKind').value,
    isFree: document.getElementById('hfFree').checked,
    intro: document.getElementById('hfIntro').value,
    description: document.getElementById('hfDescription').value,
    screenshots: e.screenshots || [],
    coverUrl: document.getElementById('hfCoverUrl').value.trim(),
    eventId: document.getElementById('hfEvent').value,
    brandId: document.getElementById('hfBrand').value,
    buyUrl: document.getElementById('hfBuyUrl').value.trim(),
    fileName: document.getElementById('hfFileName').value.trim(),
    trialUrl: document.getElementById('hfTrialUrl').value.trim(),
    isPublished: document.getElementById('hfPublished').checked,
    sort: Number(document.getElementById('hfSort').value) || 0
  };
  payload.watermarkMember = document.getElementById('hfWatermark').checked;
  // 欄位未建立時不帶 bookIds，避免每次存檔都報錯
  if (HALL_BOOKIDS_READY) payload.bookIds = Array.isArray(e.bookIds) ? e.bookIds.slice() : [];
  // 教材包欄位（同一支 migration）：未 push 不帶，避免每次存檔都報錯
  if (HALL_FILES_READY && payload.kind === 'file' && document.getElementById('hfAvailableFrom')) {
    payload.availableFrom = document.getElementById('hfAvailableFrom').value || '';
    payload.tags = String(document.getElementById('hfTags').value || '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
    payload.usageNote = document.getElementById('hfUsageNote').value;
  }
  if (e.id) payload.id = e.id;

  const btn = document.getElementById('hfSaveBtn');
  if (btn) btn.disabled = true;
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  try {
    const res = await hallApiPost('fan-admin-hall-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    const saved = res.resource || {};
    // 契約說明：upsert 回應不含 rules/grants，前端保留原本工作副本的值
    const merged = Object.assign({}, saved, { rules: e.rules || [], grants: e.grants || [], files: e.files || [] });
    const idx = HALL_LIST.findIndex(x => x.id === merged.id);
    if (idx >= 0) HALL_LIST[idx] = Object.assign({}, HALL_LIST[idx], merged);
    else HALL_LIST.unshift(merged);
    // 工作副本改用存檔後的值（原本只同步 id/slug，重畫會把品牌等欄位跳回存檔前的值）
    ['id', 'slug', 'title', 'kind', 'isFree', 'intro', 'description', 'coverUrl', 'eventId', 'eventTitle', 'brandId',
      'buyUrl', 'privatePath', 'fileName', 'trialUrl', 'isPublished', 'sort', 'watermarkMember'].forEach(k => {
      if (merged[k] !== undefined) e[k] = merged[k];
    });
    if (Array.isArray(merged.screenshots)) e.screenshots = merged.screenshots.slice();
    if (Array.isArray(merged.bookIds)) e.bookIds = merged.bookIds.slice();
    if (merged.availableFrom !== undefined) e.availableFrom = merged.availableFrom || '';
    if (Array.isArray(merged.tags)) e.tagsText = merged.tags.join('，');
    if (merged.usageNote !== undefined) e.usageNote = merged.usageNote || '';
    document.getElementById('hfSlug').value = merged.slug || '';
    statusEl.textContent = '已儲存';
    statusEl.className = 'form-status';
    hallRenderEditor();
  } catch (err) {
    statusEl.textContent = '儲存失敗：' + err.message;
    statusEl.className = 'form-status error';
  }
  if (btn) btn.disabled = false;
}

async function hallDelete() {
  const e = HALL_EDIT;
  if (!e || !e.id) return;
  if (!confirm('確定要刪除「' + e.title + '」嗎？刪了就找不回來囉。')) return;
  try {
    const res = await hallApiPost('fan-admin-hall-delete', { id: e.id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    HALL_LIST = HALL_LIST.filter(x => x.id !== e.id);
    hallCloseEdit();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ===================================================================
// 教材包（docs/13 第 3、6 節）：資源編輯表單的「檔案清單」＋檔案編輯視窗
// 後端：fan-admin-hall-file-upload-url／file-upsert／file-delete／files-sort／file-preview-url
// 合成重用 books.js 的 mtplComposeCanvas／mtplCanvasBlob／mtplAssetBitmap／mtplFrameBitmap／mtplSettings（不複製合成邏輯）
// ===================================================================
const HALL_MIGRATION_PACK = '20261002120000';
const HALL_ICONS = {
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M12 5v14M5 12h14"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align:-3px;"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  zip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>'
};
const HALL_PACK_INPUT = 'padding:8px 10px; border:1px solid #E6DCD2; border-radius:8px; font-size:14px; font-family:inherit; box-sizing:border-box; background:#fff;';
const HALL_FILE_TYPE_NAME = { image: '圖片', pdf: 'PDF', zip: 'ZIP', html: 'HTML' };
const HALL_FILE_THUMB_CACHE = new Map(); // fileId|composedPlainPath → {url, at}（簽名網址 600 秒，快取 8 分鐘）

// ----- 資源表單裡的區塊 HTML（hallRenderEditor 呼叫）-----
function hallPackSectionHtml(e, label, inputStyle) {
  const st = inputStyle.replace('border:1px solid var(--c-border);', 'border:1px solid #E6DCD2;');
  const dis = HALL_FILES_READY ? '' : ' disabled';
  return '<div id="hfPackWrap" style="display:' + (e.kind === 'file' ? '' : 'none') + ';">' +
    '<hr style="margin:22px 0 4px; border:none; border-top:1px solid var(--c-line, #F3E2D3);">' +
    '<h4 style="margin:10px 0 0; font-size:14px;">教材包設定</h4>' +
    (HALL_FILES_READY ? '' : '<div style="background:#FFF4D6; color:#8a6d3b; border-radius:8px; padding:8px 12px; font-size:12.5px; margin-top:8px;">待 db push（migration ' + HALL_MIGRATION_PACK + '）：開放下載日、標籤、使用說明與檔案清單暫時無法儲存。</div>') +
    label('開放下載日（留空＝立即開放；未到日會員看到「M/D 開放下載」）') +
    '<input type="date" id="hfAvailableFrom" style="' + st + ' width:auto;" value="' + hallEscape(e.availableFrom) + '"' + dis + '>' +
    label('標籤（逗號分隔，例如：貼貼卡，幼兒）') +
    '<input type="text" id="hfTags" style="' + st + '" value="' + hallEscape(e.tagsText) + '" placeholder="用逗號分隔"' + dis + '>' +
    label('使用說明（例：把貼貼卡剪下來貼在底卡上）') +
    '<textarea id="hfUsageNote" rows="3" style="' + st + '" placeholder="給會員看的使用方式"' + dis + '>' + hallEscape(e.usageNote) + '</textarea>' +
    label('檔案清單（拖曳左側把手調整順序）') +
    '<div id="hfFilesBox"></div>' +
  '</div>';
}

// ----- 檔案清單 -----
function hallRenderFiles() {
  const box = document.getElementById('hfFilesBox');
  const e = HALL_EDIT;
  if (!box || !e) return;
  if (!e.id) { box.innerHTML = '<div style="font-size:12px; color:var(--c-text-light);">先儲存教材再加檔案</div>'; return; }
  const dis = HALL_FILES_READY ? '' : ' disabled';
  const files = (e.files || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  box.innerHTML =
    (HALL_FILES_READY ? '' : '<div style="background:#FFF4D6; color:#8a6d3b; border-radius:8px; padding:8px 12px; font-size:12.5px; margin-bottom:8px;">待 db push（migration ' + HALL_MIGRATION_PACK + '）</div>') +
    '<div id="hfFileRows">' + (files.length ? files.map(f => hallFileRowHtml(f, dis)).join('') : '<div style="font-size:12.5px; color:var(--c-text-light); padding:6px 0;">還沒有檔案，按下面「新增檔案」加入。</div>') + '</div>' +
    '<button type="button" class="task-mini-btn" style="margin-top:6px;"' + dis + ' onclick="hallFileOpenModal(null)">' + HALL_ICONS.plus + ' 新增檔案</button>';
  files.forEach(f => hallLoadFileThumb(f));
  hallBindFileDrag();
}

function hallFileRowHtml(f, dis) {
  const typeIcon = HALL_ICONS[f.fileType] || HALL_ICONS.pdf;
  return '<div class="hf-file-row" data-id="' + hallEscape(f.id) + '" style="display:flex; align-items:center; gap:10px; background:#fff; border:1px solid #E6DCD2; border-radius:10px; padding:8px 10px; margin-bottom:6px; touch-action:pan-y; user-select:none;">' +
    '<span style="color:var(--c-text-light); cursor:grab; flex:none;">' + HALL_ICONS.grip + '</span>' +
    '<div class="hf-file-thumb" data-fid="' + hallEscape(f.id) + '" style="width:48px; height:48px; border-radius:6px; background:#F5EFE9; flex:none; overflow:hidden; display:flex; align-items:center; justify-content:center; color:var(--c-text-light);">' + typeIcon + '</div>' +
    '<div style="flex:1; min-width:0;">' +
      '<div style="font-size:13.5px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + hallEscape(f.label || f.fileName || '（未命名）') + '</div>' +
      '<div style="font-size:11.5px; color:var(--c-text-light);">' + hallEscape(HALL_FILE_TYPE_NAME[f.fileType] || f.fileType) + (f.printSize ? '　' + hallEscape(f.printSize) : '') + '</div>' +
    '</div>' +
    '<button type="button" class="task-mini-btn" style="flex:none;"' + dis + ' onclick="hallFileOpenModal(\'' + hallEscape(f.id) + '\')">' + HALL_ICONS.edit + ' 編輯</button>' +
    '<button type="button" class="task-mini-btn" style="flex:none; color:#B5485A;"' + dis + ' onclick="hallFileDelete(\'' + hallEscape(f.id) + '\')">' + HALL_ICONS.trash + ' 刪除</button>' +
  '</div>';
}

async function hallFileThumbUrl(f) {
  if (f.fileType !== 'image' || !f.composedPlainPath) return '';
  const key = f.id + '|' + f.composedPlainPath;
  const hit = HALL_FILE_THUMB_CACHE.get(key);
  if (hit && Date.now() - hit.at < 8 * 60 * 1000) return hit.url;
  const res = await hallApiPost('fan-admin-hall-file-preview-url', { id: f.id, which: 'plain' });
  if (!res || !res.success || !res.url) return '';
  HALL_FILE_THUMB_CACHE.set(key, { url: res.url, at: Date.now() });
  return res.url;
}
function hallLoadFileThumb(f) {
  if (f.fileType !== 'image' || !f.composedPlainPath) return;
  hallFileThumbUrl(f).then(url => {
    if (!url) return;
    const el = document.querySelector('.hf-file-thumb[data-fid="' + f.id + '"]');
    if (el) el.innerHTML = '<img src="' + hallEscape(url) + '" alt="" draggable="false" ondragstart="event.preventDefault()" style="width:100%; height:100%; object-fit:cover;">';
  }).catch(() => {});
}

async function hallFileDelete(id) {
  if (!HALL_EDIT) return;
  const f = (HALL_EDIT.files || []).find(x => x.id === id);
  if (!f || !confirm('確定要刪除「' + (f.label || f.fileName || '這個檔案') + '」嗎？')) return;
  try {
    const res = await hallApiPost('fan-admin-hall-file-delete', { id });
    if (!res || !res.success) throw new Error((res && res.error) || '刪除失敗');
    hallFilesSetLocal(HALL_EDIT.files.filter(x => x.id !== id));
    hallRenderFiles();
  } catch (err) { alert('刪除失敗：' + err.message); }
}

// 檔案清單寫回工作副本與 HALL_LIST（讓返回清單再進來還是最新）
function hallFilesSetLocal(list) {
  if (!HALL_EDIT) return;
  HALL_EDIT.files = list;
  const idx = HALL_LIST.findIndex(x => x.id === HALL_EDIT.id);
  if (idx >= 0) HALL_LIST[idx].files = list.slice();
}

// ----- 拖曳排序（滑鼠拖曳／觸控長按 300ms；放開打 files-sort，失敗還原）-----
function hallBindFileDrag() {
  const rowsBox = document.getElementById('hfFileRows');
  if (!rowsBox) return;
  rowsBox.querySelectorAll('.hf-file-row').forEach(row => {
    let timer = null, startX = 0, startY = 0, dragging = false, pid = null;
    const onTouchMove = ev => { if (dragging) ev.preventDefault(); };
    const finish = async (commit) => {
      clearTimeout(timer);
      document.removeEventListener('touchmove', onTouchMove);
      if (!dragging) { pid = null; return; }
      dragging = false;
      row.style.opacity = ''; row.style.boxShadow = '';
      pid = null;
      if (!commit) { hallRenderFiles(); return; }
      const ids = Array.from(rowsBox.querySelectorAll('.hf-file-row')).map(r => r.dataset.id);
      const before = (HALL_EDIT.files || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0)).map(x => x.id);
      if (ids.join() === before.join()) return;
      const oldFiles = (HALL_EDIT.files || []).slice();
      try {
        const res = await hallApiPost('fan-admin-hall-files-sort', { resourceId: HALL_EDIT.id, ids });
        if (!res || !res.success) throw new Error((res && res.error) || '排序失敗');
        const byId = {}; oldFiles.forEach(x => { byId[x.id] = x; });
        hallFilesSetLocal(ids.map((id, i) => Object.assign({}, byId[id], { sort: i + 1 })));
      } catch (err) {
        alert('排序失敗，已還原：' + err.message);
        hallRenderFiles();
      }
    };
    const startDrag = () => {
      dragging = true;
      row.style.opacity = '0.75'; row.style.boxShadow = '0 4px 14px rgba(0,0,0,.18)';
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      try { row.setPointerCapture(pid); } catch (e) { /* ignore */ }
    };
    row.addEventListener('pointerdown', ev => {
      if (ev.target.closest('button')) return;
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      pid = ev.pointerId; startX = ev.clientX; startY = ev.clientY;
      if (ev.pointerType === 'mouse') return; // 滑鼠：移動超過 6px 才開始
      timer = setTimeout(startDrag, 300);     // 觸控：長按 300ms
    });
    row.addEventListener('pointermove', ev => {
      if (pid === null || ev.pointerId !== pid) return;
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!dragging) {
        if (ev.pointerType === 'mouse') { if (Math.hypot(dx, dy) > 6) startDrag(); }
        else if (Math.hypot(dx, dy) > 10) { clearTimeout(timer); pid = null; } // 先滑動＝捲頁，放棄
        if (!dragging) return;
      }
      const others = Array.from(rowsBox.querySelectorAll('.hf-file-row')).filter(r => r !== row);
      let target = null;
      for (const r of others) { const b = r.getBoundingClientRect(); if (ev.clientY < b.top + b.height / 2) { target = r; break; } }
      if (target) { if (row.nextSibling !== target) rowsBox.insertBefore(row, target); }
      else { const last = others[others.length - 1]; if (last && row.previousSibling !== last) rowsBox.insertBefore(row, last.nextSibling); }
    });
    row.addEventListener('pointerup', () => finish(true));
    row.addEventListener('pointercancel', () => finish(false));
  });
}

// ===================================================================
// 檔案編輯視窗
// ===================================================================
let HALL_FM = null; // {file, pendingFile, srcKey, srcPromise, seq, timer, saving, tplReady}

async function hallEnsurePackageData() {
  // books.js 的 PACKAGE_DATA（規格／框／模板設定來源）：沒進過繪本分頁就是 null。
  // 不用 books.js 的 loadPackage（失敗會 booksForceRelogin 把人登出），改自己 fetch 同一端點，失敗只回 false
  if (typeof PACKAGE_DATA !== 'undefined' && PACKAGE_DATA) return true;
  if (!currentToken || typeof BOOKS_API_URL === 'undefined') return false;
  try {
    const res = await fetch(BOOKS_API_URL + '?all=1&token=' + encodeURIComponent(currentToken), { cache: 'no-store' });
    const data = await res.json();
    if (data && data.success === true && data.adminView === true) {
      if (typeof HALL_RESOURCE_CHOICES !== 'undefined') { HALL_RESOURCE_CHOICES = Array.isArray(data.hallResourceChoices) ? data.hallResourceChoices : []; }
      if (typeof HALL_LINK_READY !== 'undefined') { HALL_LINK_READY = data.hallLinkReady !== false; }
      PACKAGE_DATA = data;
      return true;
    }
  } catch (err) { /* 載入失敗：合成設定不可用 */ }
  return false;
}

function hallFmExt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}
function hallFmTypeOfExt(ext) {
  return ['jpg', 'jpeg', 'png', 'webp'].indexOf(ext) >= 0 ? 'image' : ext === 'pdf' ? 'pdf' : ext === 'zip' ? 'zip' : '';
}
function hallFmIsImage() {
  const m = HALL_FM;
  if (m.pendingFile) return hallFmTypeOfExt(hallFmExt(m.pendingFile.name)) === 'image';
  return !!(m.file && m.file.fileType === 'image');
}
function hallFmHasSource() {
  return !!(HALL_FM.pendingFile || (HALL_FM.file && HALL_FM.file.cleanPath));
}
const hallFmVal = id => document.getElementById(id).value;
const hallFmChk = id => document.getElementById(id).checked;

let HALL_FM_OPENING = false;
async function hallFileOpenModal(fileId) {
  if (!HALL_EDIT || !HALL_EDIT.id || !HALL_FILES_READY) return;
  if (HALL_FM_OPENING || HALL_FM || document.getElementById('hallFileModal')) return;
  HALL_FM_OPENING = true;
  try { await hallFileOpenModalInner(fileId); } finally { HALL_FM_OPENING = false; }
}
async function hallFileOpenModalInner(fileId) {
  const file = fileId ? (HALL_EDIT.files || []).find(x => x.id === fileId) : null;
  if (fileId && !file) return;
  const pkgOk = await hallEnsurePackageData();
  const tplReady = pkgOk && typeof mtplReady === 'function' && mtplReady();
  HALL_FM = { file, pendingFile: null, srcKey: null, srcPromise: null, seq: 0, timer: null, saving: false, tplReady };
  const f = file || {};
  const specs = tplReady ? mtplSpecs() : [];
  const specOpts = '<option value="">（不選規格，直接手打尺寸）</option>' + specs.map(s =>
    '<option value="' + hallEscape(s.id) + '"' + (s.id === f.specId ? ' selected' : '') + '>' + hallEscape(s.name) +
    (s.widthMm && s.heightMm ? '（' + s.widthMm + '×' + s.heightMm + 'mm）' : '') + '</option>').join('');
  const lay = (id, text, on) => '<label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" id="' + id + '" style="width:auto;"' + (on ? ' checked' : '') + '> ' + text + '</label>';
  const sel = (id, opts, cur) => '<select id="' + id + '" style="' + HALL_PACK_INPUT + ' width:auto;">' + opts.map(o => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';
  const lb = t => '<div style="font-size:12px; font-weight:700; color:var(--c-text-light); margin:10px 0 4px;">' + t + '</div>';

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop show';
  bd.id = 'hallFileModal';
  bd.innerHTML =
    '<div class="modal-box" style="width:680px; max-width:94%; max-height:92vh; overflow:auto;">' +
      '<h3 style="margin:0 0 6px;">' + (file ? '編輯檔案' : '新增檔案') + '</h3>' +
      lb('小標題（會員看到的這一張的名稱）') +
      '<input type="text" id="hfmLabel" style="' + HALL_PACK_INPUT + ' width:100%;" value="' + hallEscape(f.label || '') + '" placeholder="例如：貼貼卡 第 1 張">' +
      lb('檔案（圖片 jpg／png／webp，或 PDF、ZIP）') +
      '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
        '<button type="button" class="task-mini-btn" id="hfmPickBtn">' + HALL_ICONS.plus + ' 選擇檔案</button>' +
        '<span id="hfmFileName" style="font-size:13px;">' + (file ? '目前：' + hallEscape(file.fileName || file.cleanPath || '（無）') : '尚未選擇') + '</span>' +
      '</div>' +
      lb('列印尺寸') +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<select id="hfmSpec" style="' + HALL_PACK_INPUT + ' flex:1; min-width:180px;">' + specOpts + '</select>' +
        '<input type="text" id="hfmPrintSize" style="' + HALL_PACK_INPUT + ' flex:1; min-width:140px;" value="' + hallEscape(f.printSize || '') + '" placeholder="例如：A4、4×6 吋">' +
      '</div>' +
      '<div id="hfmComposeWrap">' +
        (tplReady ? '' : '<div style="background:#FFF4D6; color:#8a6d3b; border-radius:8px; padding:8px 12px; font-size:12.5px; margin-top:10px;">模板資料未載入（或模板 migration 未 push）：規格／框／浮水印暫不可選，圖片會原樣轉成成品。</div>') +
        lb('合成圖層（只有圖片會合成；開團期間前台自動換開團版）') +
        '<div style="display:flex; flex-wrap:wrap; gap:6px 14px; font-size:13px;">' +
          lay('hfmLayerFrame', '外框', f.layerFrame) + lay('hfmLayerPromo', '團購資訊', f.layerPromo) + lay('hfmLayerWm', '浮水印', f.layerWatermark) +
          lay('hfmLayerQr', 'QR CODE', f.layerQr) + lay('hfmLayerCaption', '標題與說明', f.layerCaption) +
        '</div>' +
        '<div id="hfmFrameWrap" style="margin-top:8px;"><label style="font-size:12.5px; font-weight:700; margin-right:6px;">外框</label><select id="hfmFrame" style="' + HALL_PACK_INPUT + ' width:auto; max-width:100%;"><option value="">（選擇框）</option></select></div>' +
        '<div id="hfmCaptionWrap" style="margin-top:8px;"><label style="font-size:12.5px; font-weight:700;">說明文字（疊在圖底部，標題用上面的小標題）</label><textarea id="hfmCaption" rows="2" style="' + HALL_PACK_INPUT + ' width:100%; margin-top:4px;">' + hallEscape(f.captionText || '') + '</textarea></div>' +
        '<div id="hfmWmWrap" style="margin-top:8px;">' +
          '<label style="font-size:12.5px; font-weight:700; margin-right:6px;">浮水印位置</label>' +
          sel('hfmWmPos', [['left', '左'], ['center', '中'], ['right', '右']], f.watermarkPos || 'right') + ' ' +
          sel('hfmWmVPos', [['bottom', '下'], ['top', '上']], f.watermarkVpos || 'bottom') +
          '<label style="font-size:12.5px; font-weight:700; margin:0 6px 0 12px;">LOGO 版本</label>' +
          sel('hfmWmLogo', [['dark', '咖啡字（白底／淺底）'], ['light', '白字（彩色底／深底）'], ['blue', '藍字（白底／淺底）']], f.watermarkLogo || 'dark') +
        '</div>' +
        '<div id="hfmPromoWrap" style="margin-top:8px;">' +
          '<label style="font-size:12.5px; font-weight:700; margin-right:6px;">團購資訊顏色</label>' +
          '<input type="color" id="hfmPromoColor" value="' + hallEscape(f.promoColor || '#FF8FA3') + '" style="width:44px; height:30px; padding:0; vertical-align:middle; border:none; background:none;">' +
          '<label style="font-size:12.5px; font-weight:700; margin:0 6px 0 12px;">位置</label>' +
          sel('hfmPromoPos', [['left', '左下'], ['center', '中下'], ['right', '右下']], f.promoPos || 'center') +
        '</div>' +
        '<div id="hfmQrWrap" style="margin-top:8px;"><label style="font-size:12.5px; font-weight:700; margin-right:6px;">QR CODE 位置</label>' +
          sel('hfmQrPos', [['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']], f.qrPos || 'tr') + '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">' +
          '<button type="button" class="task-mini-btn" id="hfmDownloadBtn">' + HALL_ICONS.download + ' 下載測試檔</button>' +
        '</div>' +
        '<div id="hfmPreviewWrap" style="display:none; margin-top:10px; text-align:center; background:#F5EFE9; border-radius:10px; padding:8px;">' +
          '<img id="hfmPreviewImg" alt="" style="max-width:100%; max-height:420px; border-radius:6px;">' +
          '<div id="hfmPreviewLabel" style="font-size:11.5px; color:var(--c-text-light); margin-top:4px;"></div>' +
        '</div>' +
      '</div>' +
      '<div id="hfmStatus" style="font-size:12.5px; margin-top:10px; min-height:18px; color:var(--c-text-light);"></div>' +
      '<div style="display:flex; gap:8px; margin-top:12px;">' +
        '<button type="button" class="task-submit-btn" id="hfmSaveBtn" style="margin-top:0;">儲存</button>' +
        '<button type="button" class="task-mini-btn" id="hfmCancelBtn">取消</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(bd);

  hallFmSyncFrameSelect(f.frameId || '');
  hallFmSyncVisibility();
  hallFmApplyDisabled();
  document.getElementById('hfmCancelBtn').onclick = hallFmClose;
  document.getElementById('hfmPickBtn').onclick = hallFmPickFile;
  document.getElementById('hfmSaveBtn').onclick = hallFmSave;
  document.getElementById('hfmDownloadBtn').onclick = hallFmDownloadTest;
  document.getElementById('hfmSpec').onchange = () => {
    const spec = tplReady ? mtplSpecById(hallFmVal('hfmSpec')) : null;
    if (spec) document.getElementById('hfmPrintSize').value = spec.name; // 同繪本教材：選規格自動帶列印尺寸
    hallFmSyncFrameSelect(hallFmVal('hfmFrame'));
    hallFmSchedulePreview(250);
  };
  ['hfmLayerFrame', 'hfmLayerPromo', 'hfmLayerWm', 'hfmLayerQr', 'hfmLayerCaption'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { hallFmSyncVisibility(); hallFmSchedulePreview(250); });
  });
  ['hfmFrame', 'hfmWmPos', 'hfmWmVPos', 'hfmWmLogo', 'hfmPromoColor', 'hfmPromoPos', 'hfmQrPos'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => hallFmSchedulePreview(250));
  });
  document.getElementById('hfmPromoColor').addEventListener('input', () => hallFmSchedulePreview(250));
  document.getElementById('hfmCaption').addEventListener('input', () => hallFmSchedulePreview(500));
  document.getElementById('hfmLabel').addEventListener('input', () => hallFmSchedulePreview(500));
  hallFmSchedulePreview(0);
}

function hallFmClose() {
  if (HALL_FM && HALL_FM.saving) return;
  if (HALL_FM) { clearTimeout(HALL_FM.timer); HALL_FM.seq++; }
  const el = document.getElementById('hallFileModal');
  if (el) el.remove();
  HALL_FM = null;
}

function hallFmPickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,application/pdf,.zip,.pdf,.jpg,.jpeg,.png,.webp';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file || !HALL_FM) return;
    if (!hallFmTypeOfExt(hallFmExt(file.name))) { alert('只支援 jpg／png／webp／pdf／zip'); return; }
    HALL_FM.pendingFile = file;
    HALL_FM.srcKey = null; HALL_FM.srcPromise = null;
    document.getElementById('hfmFileName').textContent = '已選：' + file.name;
    const lbl = document.getElementById('hfmLabel');
    if (!lbl.value.trim()) lbl.value = file.name.replace(/\.[a-z0-9]+$/i, '');
    hallFmSyncVisibility();
    if (HALL_FM.tplReady) HALL_FM_TPL_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
    const ns = document.getElementById('hfmNoSourceNote'); if (ns) ns.remove();
    hallFmSchedulePreview(0);
  };
  input.click();
}

function hallFmSyncFrameSelect(selectedFrameId) {
  const sel = document.getElementById('hfmFrame');
  if (!sel) return;
  const specId = hallFmVal('hfmSpec');
  const frames = HALL_FM.tplReady ? mtplFrames().filter(f => !specId || f.specId === specId) : [];
  sel.innerHTML = '<option value="">（選擇框）</option>' + frames.map(f => {
    const spec = mtplSpecById(f.specId);
    return '<option value="' + hallEscape(f.id) + '">' + hallEscape((f.name || '框') + (spec ? '（' + spec.name + '）' : '')) + '</option>';
  }).join('');
  if (selectedFrameId && frames.some(f => f.id === selectedFrameId)) sel.value = selectedFrameId;
}

// 模板沒就緒：規格／框／圖層／浮水印等控制項全部停用（圖片存檔另有擋，避免洗掉設定）
const HALL_FM_TPL_IDS = ['hfmSpec', 'hfmLayerFrame', 'hfmLayerPromo', 'hfmLayerWm', 'hfmLayerQr', 'hfmLayerCaption', 'hfmFrame', 'hfmCaption',
  'hfmWmPos', 'hfmWmVPos', 'hfmWmLogo', 'hfmPromoColor', 'hfmPromoPos', 'hfmQrPos'];
function hallFmApplyDisabled() {
  if (!HALL_FM) return;
  if (!HALL_FM.tplReady) HALL_FM_TPL_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
  // 既有檔案沒有原檔：只能改小標題／列印尺寸
  if (HALL_FM.file && !HALL_FM.file.cleanPath) {
    const note = document.createElement('div');
    note.id = 'hfmNoSourceNote';
    note.style.cssText = 'font-size:11.5px; color:#8a6d3b; margin-top:4px;';
    note.textContent = '這張沒有原檔，要改浮水印請重新上傳原圖';
    const nm = document.getElementById('hfmFileName');
    if (nm && nm.parentNode) nm.parentNode.parentNode.insertBefore(note, nm.parentNode.nextSibling);
    HALL_FM_TPL_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
  }
}
function hallFmNoSourceLabelOnly() {
  return !!(HALL_FM.file && !HALL_FM.file.cleanPath && !HALL_FM.pendingFile);
}

function hallFmSyncVisibility() {
  const wrap = document.getElementById('hfmComposeWrap');
  if (wrap) wrap.style.display = hallFmIsImage() ? '' : 'none';
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('hfmFrameWrap', hallFmChk('hfmLayerFrame'));
  show('hfmCaptionWrap', hallFmChk('hfmLayerCaption'));
  show('hfmWmWrap', hallFmChk('hfmLayerWm'));
  show('hfmPromoWrap', hallFmChk('hfmLayerPromo'));
  show('hfmQrWrap', hallFmChk('hfmLayerQr'));
}

// ----- 合成輸入（mtplComposeCanvas 的 o 與 books.js mtplFormComposeInputs 同欄位）-----
async function hallFmSourceBitmap() {
  const m = HALL_FM;
  const key = m.pendingFile ? m.pendingFile : (m.file ? 'id:' + m.file.id + ':' + m.file.cleanPath : null);
  if (!key) throw new Error('請先選擇圖片檔');
  if (key !== m.srcKey || !m.srcPromise) {
    const p = m.pendingFile
      ? createImageBitmap(m.pendingFile)
      : hallApiPost('fan-admin-hall-file-preview-url', { id: m.file.id, which: 'clean' }).then(res => {
          if (!res || !res.success || !res.url) throw new Error((res && res.error) || '取不到乾淨原檔');
          return fetch(res.url).then(r => { if (!r.ok) throw new Error('原檔載入失敗（' + r.status + '）'); return r.blob(); }).then(b => createImageBitmap(b));
        });
    m.srcKey = key; m.srcPromise = p;
    p.catch(() => { if (m.srcPromise === p) { m.srcKey = null; m.srcPromise = null; } });
  }
  return m.srcPromise;
}

async function hallFmComposeInputs() {
  const tpl = HALL_FM.tplReady;
  const raw = { frame: hallFmChk('hfmLayerFrame'), promo: hallFmChk('hfmLayerPromo'), watermark: hallFmChk('hfmLayerWm'),
    qr: hallFmChk('hfmLayerQr'), caption: hallFmChk('hfmLayerCaption') };
  const layers = tpl ? raw : { frame: false, promo: false, watermark: false, qr: false, caption: false };
  const frameId = hallFmVal('hfmFrame') || '';
  if (layers.frame && !frameId) throw new Error('勾了「外框」但還沒選框');
  const src = await hallFmSourceBitmap();
  const s = tpl ? mtplSettings() : {};
  const frameImg = layers.frame ? await mtplFrameBitmap(frameId) : null;
  const wmLogo = mtplWmLogoValue(hallFmVal('hfmWmLogo'));
  const logoUrl = tpl ? mtplLogoUrlFor(s, wmLogo) : '';
  const logoImg = layers.watermark && logoUrl ? await mtplAssetBitmap(logoUrl).catch(() => null) : null;
  const qrImg = layers.qr && s.qrUrl ? await mtplAssetBitmap(s.qrUrl).catch(() => null) : null;
  return {
    src, layers,
    o: {
      frameImg, logoImg, qrImg, layers,
      caption: { title: hallFmVal('hfmLabel').trim(), desc: hallFmVal('hfmCaption').trim() },
      watermarkPos: hallFmVal('hfmWmPos'),
      watermarkVPos: hallFmVal('hfmWmVPos') === 'top' ? 'top' : 'bottom',
      watermarkLogo: wmLogo,
      promoColor: /^#[0-9A-Fa-f]{6}$/.test(hallFmVal('hfmPromoColor')) ? hallFmVal('hfmPromoColor').toUpperCase() : '#FF8FA3',
      promoPos: hallFmVal('hfmPromoPos'),
      qrPos: hallFmVal('hfmQrPos'),
      longEdgeMm: tpl ? mtplLongEdgeMm(hallFmVal('hfmSpec') || '') : 297,
      watermarkText: s.watermarkText || '', promoText: s.promoText || ''
    }
  };
}

function hallFmSchedulePreview(delay) {
  const m = HALL_FM;
  if (!m) return;
  clearTimeout(m.timer);
  m.timer = setTimeout(hallFmRenderPreview, delay);
}

async function hallFmRenderPreview() {
  const m = HALL_FM;
  if (!m || !hallFmIsImage() || !hallFmHasSource()) return;
  const seq = ++m.seq;
  const wrap = document.getElementById('hfmPreviewWrap');
  try {
    const { src, o, layers } = await hallFmComposeInputs();
    if (!HALL_FM || seq !== HALL_FM.seq) return;
    const canvas = mtplComposeCanvas(src, o, layers.promo);
    const pv = document.createElement('canvas');
    const scale = Math.min(1, 900 / canvas.width);
    pv.width = Math.round(canvas.width * scale); pv.height = Math.round(canvas.height * scale);
    pv.getContext('2d').drawImage(canvas, 0, 0, pv.width, pv.height);
    document.getElementById('hfmPreviewImg').src = pv.toDataURL('image/jpeg', 0.85);
    document.getElementById('hfmPreviewLabel').textContent = (layers.promo ? '預覽＝開團版（結團後前台自動換平時版）' : '預覽＝成品') + '・改選項會自動更新';
    wrap.style.display = '';
    const st = document.getElementById('hfmStatus');
    if (st.textContent.indexOf('預覽失敗') === 0) st.textContent = '';
  } catch (err) {
    if (!HALL_FM || seq !== HALL_FM.seq) return;
    document.getElementById('hfmStatus').textContent = '預覽失敗：' + (err && err.message ? err.message : '未知錯誤');
  }
}

async function hallFmDownloadTest() {
  if (!HALL_FM || !hallFmIsImage()) return;
  if (!hallFmHasSource()) { alert('請先選擇圖片檔'); return; }
  const btn = document.getElementById('hfmDownloadBtn');
  const st = document.getElementById('hfmStatus');
  btn.disabled = true; st.textContent = '產生下載測試檔中…';
  try {
    const { src, o, layers } = await hallFmComposeInputs();
    const base = (hallFmVal('hfmLabel').trim() || '教材').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    const variants = layers.promo ? [[false, '平時版'], [true, '開團版']] : [[false, '成品']];
    for (let i = 0; i < variants.length; i++) {
      const blob = await mtplCanvasBlob(mtplComposeCanvas(src, o, variants[i][0]));
      mtplTriggerDownload(blob, base + '-' + variants[i][1] + '-測試.jpg');
      if (i < variants.length - 1) await new Promise(r => setTimeout(r, 600));
    }
    st.textContent = '已下載測試檔（不上傳、不存檔）';
  } catch (err) {
    st.textContent = '下載測試失敗：' + (err && err.message ? err.message : '未知錯誤');
  } finally { btn.disabled = false; }
}

// 簽名網址直傳（同 hallUploadFullFile 寫法）
async function hallFmUpload(purpose, blobOrFile, ext, contentType) {
  const urlRes = await hallApiPost('fan-admin-hall-file-upload-url', { resourceId: HALL_EDIT.id, purpose, ext });
  if (!urlRes || urlRes.success !== true) throw new Error((urlRes && urlRes.error) || '取得上傳網址失敗');
  const put = await fetch(urlRes.signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blobOrFile });
  if (!put.ok) throw new Error('檔案上傳失敗（' + put.status + '）');
  return urlRes.path;
}

async function hallFmSave() {
  const m = HALL_FM;
  if (!m || m.saving) return;
  const st = document.getElementById('hfmStatus');
  const btn = document.getElementById('hfmSaveBtn');
  const labelOnly = hallFmNoSourceLabelOnly();
  if (!labelOnly && !hallFmHasSource()) { alert('請先選擇檔案'); return; }
  const pendingExt = m.pendingFile ? hallFmExt(m.pendingFile.name) : '';
  const fileType = m.pendingFile ? hallFmTypeOfExt(pendingExt) : m.file.fileType;
  const isImg = fileType === 'image';
  if (isImg && !labelOnly && !m.tplReady) { alert('模板資料載入失敗，請重新整理後再存（避免洗掉浮水印設定）'); return; }
  m.saving = true; btn.disabled = true;
  const step = t => { st.textContent = t; };
  try {
    const payload = { label: hallFmVal('hfmLabel').trim(), printSize: hallFmVal('hfmPrintSize').trim(), fileType };
    if (m.file) payload.id = m.file.id;
    else {
      payload.resourceId = HALL_EDIT.id;
      payload.sort = (HALL_EDIT.files || []).reduce((mx, x) => Math.max(mx, Number(x.sort) || 0), 0) + 1;
    }
    if (labelOnly) {
      // 沒有原檔：只改小標題／列印尺寸，不重新合成
      delete payload.fileType;
    } else if (m.pendingFile) {
      step('上傳原檔中…');
      const ct = m.pendingFile.type || (pendingExt === 'pdf' ? 'application/pdf' : pendingExt === 'zip' ? 'application/zip' : 'application/octet-stream');
      payload.cleanPath = await hallFmUpload('clean', m.pendingFile, pendingExt, ct);
      payload.fileName = m.pendingFile.name;
      payload.fileSize = m.pendingFile.size;
    }
    if (labelOnly) {
      // 不送 layer*／spec／frame／composed*
    } else if (isImg) {
      const { src, o, layers } = await hallFmComposeInputs();
      Object.assign(payload, {
        specId: hallFmVal('hfmSpec') || '', frameId: hallFmVal('hfmFrame') || '',
        layerFrame: layers.frame, layerPromo: layers.promo, layerWatermark: layers.watermark,
        layerQr: layers.qr, layerCaption: layers.caption,
        captionText: hallFmVal('hfmCaption'), watermarkPos: o.watermarkPos, watermarkVpos: o.watermarkVPos,
        watermarkLogo: o.watermarkLogo, promoColor: o.promoColor, promoPos: o.promoPos, qrPos: o.qrPos
      });
      step('合成平時版…');
      const plainBlob = await mtplCanvasBlob(mtplComposeCanvas(src, o, false));
      step('上傳平時版…');
      payload.composedPlainPath = await hallFmUpload('composed-plain', plainBlob, 'jpg', 'image/jpeg');
      if (layers.promo) {
        step('合成開團版…');
        const openBlob = await mtplCanvasBlob(mtplComposeCanvas(src, o, true));
        step('上傳開團版…');
        payload.composedOpenPath = await hallFmUpload('composed-open', openBlob, 'jpg', 'image/jpeg');
      } else payload.composedOpenPath = '';
    } else if (m.pendingFile) {
      // 換成非圖片檔：清掉舊成品與圖層
      Object.assign(payload, { composedPlainPath: '', composedOpenPath: '', layerFrame: false, layerPromo: false, layerWatermark: false, layerQr: false, layerCaption: false });
    }
    step('儲存中…');
    const res = await hallApiPost('fan-admin-hall-file-upsert', payload);
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    const saved = res.file;
    const list = (HALL_EDIT.files || []).slice();
    const idx = list.findIndex(x => x.id === saved.id);
    if (idx >= 0) list[idx] = saved; else list.push(saved);
    hallFilesSetLocal(list);
    m.saving = false;
    hallFmClose();
    hallRenderFiles();
  } catch (err) {
    m.saving = false; btn.disabled = false;
    st.textContent = '';
    alert('儲存失敗：' + (err && err.message ? err.message : '未知錯誤'));
  }
}

// ===== DOM 掛載（最外層只做這件事）=====
document.getElementById('hallAddBtn').addEventListener('click', () => {
  if (!HALL_TABLE_READY) { alert('教材館資料表尚未建立（待 db push），先請雪莉執行後再試。'); return; }
  hallOpenEdit(-1);
});
document.getElementById('hallRefreshBtn').addEventListener('click', () => loadHallView(true));
