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
let HALL_EVENT_CHOICES = [];  // {id, legacyId, title, startDate, endDate}
let HALL_EDIT = null;         // 編輯中的資源工作副本（含 rules/grants）；null＝顯示列表

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
    '<div style="background:#fff3cd; color:#8a6d3b; border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:10px;">' +
    '⚠️ 教材館資料表尚未建立（待 db push），目前無法新增或儲存資源。</div>';
}

// ===== 清單 =====
function hallRenderList() {
  const area = document.getElementById('hallListArea');
  const editArea = document.getElementById('hallEditArea');
  if (!area) return;
  if (editArea) editArea.style.display = 'none';
  area.style.display = '';
  if (!HALL_LIST.length) {
    area.innerHTML = '<div class="task-empty">還沒有任何資源，按上面的「＋ 新增資源」開始！</div>';
    return;
  }
  const html = HALL_LIST.map((r, i) => {
    const kindBadge = r.kind === 'game'
      ? '<span style="background:#eef2ff; color:#3949ab; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">🎮 遊戲</span>'
      : '<span style="background:#eef2ff; color:#3949ab; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">📄 檔案</span>';
    const freeBadge = r.isFree
      ? '<span style="background:#e6f4ea; color:#1e7a3c; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">免費</span>'
      : '<span style="background:#fdeceb; color:#b23a2e; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">付費</span>';
    const pubBadge = r.isPublished
      ? '<span style="background:#3ddc84; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已發布</span>'
      : '<span style="background:#ccc; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">草稿</span>';
    const cover = r.coverUrl
      ? '<img src="' + hallEscape(r.coverUrl) + '" alt="" style="width:64px; height:64px; object-fit:cover; border-radius:8px; flex:none; background:#f5f5f5;">'
      : '<div style="width:64px; height:64px; border-radius:8px; flex:none; background:#f0f0f8; display:flex; align-items:center; justify-content:center; font-size:22px;">' + (r.kind === 'game' ? '🎮' : '📄') + '</div>';
    const ruleCount = (r.rules || []).length;
    const grantCount = (r.grants || []).length;
    const pageUrl = HALL_MATERIALS_PAGE_BASE + encodeURIComponent(r.slug || '');
    return '<div style="display:flex; gap:10px; align-items:center; background:#fff; border:1px solid var(--c-border); border-radius:12px; padding:10px 12px; margin-bottom:8px;">' +
      cover +
      '<div style="flex:1; min-width:0; cursor:pointer;" onclick="hallOpenEdit(' + i + ')">' +
        '<div style="font-weight:700; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + hallEscape(r.title) + '</div>' +
        '<div style="font-size:11px; color:var(--c-text-light); margin-top:2px;">/' + hallEscape(r.slug) + '　排序 ' + hallEscape(r.sort) + '</div>' +
        '<div style="display:flex; gap:6px; align-items:center; margin-top:4px; flex-wrap:wrap;">' + kindBadge + freeBadge + pubBadge +
          '<span style="font-size:11px; color:var(--c-text-light);">規則 ' + ruleCount + '　開通 ' + grantCount + ' 人</span>' +
        '</div>' +
      '</div>' +
      '<a href="' + hallEscape(pageUrl) + '" target="_blank" class="task-mini-btn" style="flex:none; text-decoration:none;" onclick="event.stopPropagation();">🔗 前台頁</a>' +
      '<button type="button" class="task-mini-btn" style="flex:none;" onclick="hallOpenEdit(' + i + ')">✏️ 編輯</button>' +
      '<button type="button" class="task-mini-btn" style="flex:none; color:#c0392b;" onclick="hallDeleteFromList(' + i + ')">🗑</button>' +
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
        coverUrl: r.coverUrl || '', eventId: r.eventId || '', eventTitle: r.eventTitle || '',
        buyUrl: r.buyUrl || '', privatePath: r.privatePath || '', fileName: r.fileName || '',
        trialUrl: r.trialUrl || '', isPublished: !!r.isPublished, sort: r.sort || 0,
        rules: JSON.parse(JSON.stringify(r.rules || [])),
        grants: JSON.parse(JSON.stringify(r.grants || [])),
        codeRules: JSON.parse(JSON.stringify(r.codeRules || []))
      }
    : {
        id: null, slug: '', title: '', kind: 'game', isFree: false, intro: '', description: '',
        screenshots: [], coverUrl: '', eventId: '', eventTitle: '', buyUrl: '', privatePath: '',
        fileName: '', trialUrl: '', isPublished: false, sort: 0, rules: [], grants: [], codeRules: []
      };
  hallRenderEditor();
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

  const fullFileStatus = e.privatePath
    ? '已上傳：' + hallEscape(e.fileName || e.privatePath)
    : '尚未上傳';

  editArea.innerHTML =
    '<div style="background:#fff; border:1px solid var(--c-border); border-radius:14px; padding:16px 16px 20px; max-width:680px;">' +
      '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
        '<button type="button" class="task-mini-btn" onclick="hallCloseEdit()">← 返回教材館</button>' +
        '<div style="flex:1;"></div>' +
        (e.id ? '<button type="button" class="task-mini-btn" style="color:#c0392b;" onclick="hallDelete()">🗑 刪除</button>' : '') +
      '</div>' +

      label('名稱 *') +
      '<input id="hfTitle" style="' + inputStyle + '" value="' + hallEscape(e.title) + '" placeholder="例如：數字迷宮小遊戲">' +

      label('slug（網址代稱，小寫英數與 -，留空由後端自動產生）') +
      '<input id="hfSlug" style="' + inputStyle + '" value="' + hallEscape(e.slug) + '" placeholder="例如：number-maze">' +

      '<div style="display:flex; gap:10px;"><div style="flex:1;">' +
        label('類型') +
        '<select id="hfKind" style="' + inputStyle + '" onchange="hallKindChange(this.value)">' +
          '<option value="game"' + (e.kind === 'game' ? ' selected' : '') + '>🎮 遊戲</option>' +
          '<option value="file"' + (e.kind === 'file' ? ' selected' : '') + '>📄 檔案</option>' +
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

      label('卡片簡介（列表用一兩句話）') +
      '<textarea id="hfIntro" rows="2" style="' + inputStyle + '" placeholder="簡短介紹，會出現在資源卡片上">' + hallEscape(e.intro) + '</textarea>' +

      label('介紹內文（空行分段）') +
      '<textarea id="hfDescription" rows="5" style="' + inputStyle + '" placeholder="完整介紹文字，空一行換一段">' + hallEscape(e.description) + '</textarea>' +

      label('封面圖') +
      '<div style="display:flex; gap:8px; align-items:center;">' +
        '<div id="hfCoverPreview" style="width:96px; height:96px; border-radius:8px; background:#f8f0ea; flex:none; overflow:hidden; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--c-text-light);">' +
          (e.coverUrl ? '<img src="' + hallEscape(e.coverUrl) + '" style="width:100%; height:100%; object-fit:cover;">' : '尚未設定') + '</div>' +
        '<div style="flex:1; display:flex; flex-direction:column; gap:6px;">' +
          '<input id="hfCoverUrl" style="' + inputStyle + '" value="' + hallEscape(e.coverUrl) + '" placeholder="圖片網址，或用下面按鈕上傳" oninput="hallCoverUrlInput(this.value)">' +
          '<button type="button" class="task-mini-btn" onclick="hallPickImage(function(url){ HALL_EDIT.coverUrl = url; hallRenderEditor(); })">📤 上傳封面</button>' +
        '</div>' +
      '</div>' +

      label('截圖') +
      '<div id="hfScreenshots"></div>' +
      '<button type="button" class="task-mini-btn" onclick="hallPickImage(function(url){ HALL_EDIT.screenshots.push(url); hallRenderScreenshots(); })">＋ 新增截圖</button>' +

      label('綁定團購（純標記用，例如搭配某次開團的加購贈品；不綁定就跟團購無關）') +
      '<select id="hfEvent" style="' + inputStyle + '">' + evOptions.join('') + '</select>' +

      label('備用購買連結（可空）') +
      '<input id="hfBuyUrl" style="' + inputStyle + '" value="' + hallEscape(e.buyUrl) + '" placeholder="https://…">' +

      label('試玩版網址（可空）') +
      '<input id="hfTrialUrl" style="' + inputStyle + '" value="' + hallEscape(e.trialUrl) + '" placeholder="https://…">' +

      label('完整版檔案') +
      '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
        '<span style="font-size:13px;">' + fullFileStatus + '</span>' +
        (e.id
          ? '<button type="button" class="task-mini-btn" id="hfUploadFileBtn" onclick="hallUploadFullFile()">📤 上傳完整版檔案</button>'
          : '<span style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能上傳檔案</span>') +
      '</div>' +
      '<div id="hfFileNameWrap" style="display:' + (e.kind === 'file' ? '' : 'none') + ';">' +
        label('檔名（顯示用，上傳完整版檔案後自動帶入，可手動修改）') +
        '<input id="hfFileName" style="' + inputStyle + '" value="' + hallEscape(e.fileName) + '">' +
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
      '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:8px;">單筆訂單購買 n 組（n≥2）自動發 n−1 張可贈送兌換碼，買家在會員中心複製給朋友輸碼解鎖；每日收單自動產碼。</div>' +
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
            '<input id="hfGrantMemberNo" style="flex:1; min-width:120px; padding:7px 9px; border:1px solid var(--c-border); border-radius:8px;" placeholder="會員編號，如 D26090001">' +
            '<input id="hfGrantNote" style="flex:1; min-width:120px; padding:7px 9px; border:1px solid var(--c-border); border-radius:8px;" placeholder="備註（可空）">' +
            '<button type="button" class="task-mini-btn" onclick="hallAddGrant()">✅ 開通</button>' +
          '</div>' +
          '<div class="form-status" id="hfGrantsStatus"></div>'
        : '<div style="font-size:12px; color:var(--c-text-light);">請先儲存基本資料才能手動開通</div>') +
    '</div>';

  hallRenderScreenshots();
  hallRenderRules();
  hallRenderCodeRules();
  hallRenderGrants();
}

function hallKindChange(val) {
  if (HALL_EDIT) HALL_EDIT.kind = val;
  const wrap = document.getElementById('hfFileNameWrap');
  if (wrap) wrap.style.display = val === 'file' ? '' : 'none';
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
          '<img src="' + hallEscape(url) + '" style="width:100%; height:100%; object-fit:cover; border-radius:8px; background:#f5f5f5;">' +
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
    return '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; border:1px dashed var(--c-border); border-radius:8px; padding:8px; margin-bottom:6px;">' +
      '<select style="flex:1; min-width:140px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" onchange="hallRuleEventChange(' + i + ', this.value)">' + options.join('') + '</select>' +
      (isCustom
        ? '<input style="flex:1; min-width:100px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.eventLegacyId) + '" placeholder="團購 legacyId" oninput="HALL_EDIT.rules[' + i + '].eventLegacyId=this.value">'
        : '') +
      '<input style="flex:1; min-width:120px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.productMatch) + '" placeholder="品名關鍵字（留空＝該團任一已付款訂單即解鎖）" oninput="HALL_EDIT.rules[' + i + '].productMatch=this.value">' +
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
    active: r.active !== false
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
    return '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; border:1px dashed var(--c-border); border-radius:8px; padding:8px; margin-bottom:6px;">' +
      '<select style="flex:1; min-width:140px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" onchange="hallCodeRuleEventChange(' + i + ', this.value)">' + options.join('') + '</select>' +
      (isCustom
        ? '<input style="flex:1; min-width:100px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.eventLegacyId) + '" placeholder="團購 legacyId" oninput="HALL_EDIT.codeRules[' + i + '].eventLegacyId=this.value">'
        : '') +
      '<input style="flex:1; min-width:120px; padding:6px; border:1px solid var(--c-border); border-radius:6px;" value="' + hallEscape(r.productMatch) + '" placeholder="品名關鍵字（必填）" oninput="HALL_EDIT.codeRules[' + i + '].productMatch=this.value">' +
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
  HALL_EDIT.codeRules.push({ eventLegacyId: '', productMatch: '', active: true });
  hallRenderCodeRules();
}
function hallRemoveCodeRule(i) {
  if (!HALL_EDIT) return;
  HALL_EDIT.codeRules.splice(i, 1);
  hallRenderCodeRules();
}
async function hallSaveCodeRules() {
  if (!HALL_EDIT || !HALL_EDIT.id) return;
  const statusEl = document.getElementById('hfCodeRulesStatus');
  statusEl.textContent = '儲存中…';
  statusEl.className = 'form-status';
  const rules = (HALL_EDIT.codeRules || []).map(r => ({
    eventLegacyId: (r.eventLegacyId || '').trim(),
    productMatch: (r.productMatch || '').trim(),
    active: r.active !== false
  }));
  try {
    const res = await hallApiPost('fan-admin-hall-code-rule-set', { resourceId: HALL_EDIT.id, rules });
    if (!res || !res.success) throw new Error((res && res.error) || '儲存失敗');
    HALL_EDIT.codeRules = res.codeRules || [];
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
      if (st === 'redeemed') return '<span style="background:#e0e0e0; color:#555; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已使用</span>';
      if (st === 'revoked') return '<span style="background:#fdeceb; color:#b23a2e; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已收回</span>';
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
    buyUrl: document.getElementById('hfBuyUrl').value.trim(),
    fileName: document.getElementById('hfFileName').value.trim(),
    trialUrl: document.getElementById('hfTrialUrl').value.trim(),
    isPublished: document.getElementById('hfPublished').checked,
    sort: Number(document.getElementById('hfSort').value) || 0
  };
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
    const merged = Object.assign({}, saved, { rules: e.rules || [], grants: e.grants || [] });
    const idx = HALL_LIST.findIndex(x => x.id === merged.id);
    if (idx >= 0) HALL_LIST[idx] = Object.assign({}, HALL_LIST[idx], merged);
    else HALL_LIST.unshift(merged);
    e.id = merged.id;
    e.slug = merged.slug;
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

// ===== DOM 掛載（最外層只做這件事）=====
document.getElementById('hallAddBtn').addEventListener('click', () => {
  if (!HALL_TABLE_READY) { alert('教材館資料表尚未建立（待 db push），先請雪莉執行後再試。'); return; }
  hallOpenEdit(-1);
});
document.getElementById('hallRefreshBtn').addEventListener('click', () => loadHallView(true));
