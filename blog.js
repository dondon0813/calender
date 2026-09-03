// ===================================================================
// blog.js — 文章管理（部落格開團介紹文）後台
//
// 文章存新後端 blog_posts 表（dondon-platform migration 20260904000001），
// 文章頁在 https://dondon-platform.vercel.app/blog/<slug>（SSR 帶 og 標籤，
// 分享到 LINE/FB 會顯示該篇標題＋封面）。端點 /api/blog：
//   GET ?all=1&token=…（後台全量含草稿＋eventChoices）
//   POST blog-post-upsert / blog-post-delete / blog-image-upload（權限 blogEdit）
// 內文＝「段落積木」陣列：text／heading／image／button 四種，後端白名單整形。
//
// 載入順序鐵律：本檔必須排在 admin.html 裡的 admin.js「之前」（同 books.js／
// sheetdb.js）：admin.js 開機還原分頁會同步呼叫 loadBlogView，順序錯了整頁變磚。
// 最外層只有宣告與 DOM 事件掛載。
// ===================================================================

const BLOG_API_URL = 'https://dondon-platform.vercel.app/api/blog';
const BLOG_PAGE_BASE = 'https://dondon-platform.vercel.app/blog/';

let BLOG_LOADED = false;
let BLOG_TABLE_READY = true;
let BLOG_POSTS = [];
let BLOG_EVENT_CHOICES = [];
// 編輯中的狀態：null＝顯示列表。blocks 直接在這物件上改，存檔整包送出。
let BLOG_EDIT = null;

function blogEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function blogApiPost(type, extra) {
  const body = Object.assign({ type, token: currentToken }, extra || {});
  const res = await fetch(BLOG_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS 預檢（同 admin.js postTask）
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data && data.needLogin) {
    currentToken = null;
    localStorage.removeItem('admin_unlocked');
    localStorage.removeItem('admin_token');
    document.getElementById('passwordGate').style.display = 'flex';
    document.getElementById('mainWrap').style.visibility = 'hidden';
    throw new Error(data.error || '請重新登入');
  }
  return data;
}

// ===== 列表 =====

async function loadBlogView(force) {
  if (BLOG_LOADED && !force) { blogRenderList(); return; }
  const area = document.getElementById('blogListArea');
  if (area) area.innerHTML = '<div class="task-empty">讀取中…</div>';
  try {
    const res = await fetch(BLOG_API_URL + '?all=1&token=' + encodeURIComponent(currentToken), { cache: 'no-store' });
    const data = await res.json();
    if (data && data.needLogin) throw new Error('請重新登入');
    if (!data.success) throw new Error(data.error || '讀取失敗');
    BLOG_TABLE_READY = data.tableReady !== false;
    BLOG_POSTS = data.posts || [];
    BLOG_EVENT_CHOICES = data.eventChoices || [];
    BLOG_LOADED = true;
    blogRenderBanner();
    blogRenderList();
  } catch (err) {
    if (area) area.innerHTML = '<div class="task-empty">讀取失敗：' + blogEscape(err.message) + '</div>';
  }
}

function blogRenderBanner() {
  const box = document.getElementById('blogBanner');
  if (!box) return;
  box.innerHTML = BLOG_TABLE_READY ? '' :
    '<div style="background:#fff3cd; color:#8a6d3b; border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:10px;">' +
    '⚠️ 文章資料表尚未建立（要先請雪莉執行 db push），目前無法新增或儲存文章。</div>';
}

function blogFmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[2]) + '/' + Number(m[3]) : '';
}

function blogRenderList() {
  const area = document.getElementById('blogListArea');
  const editArea = document.getElementById('blogEditArea');
  if (!area) return;
  if (editArea) editArea.style.display = 'none';
  area.style.display = '';
  if (!BLOG_POSTS.length) {
    area.innerHTML = '<div class="task-empty">還沒有文章，按上面的「＋ 新文章」開始寫第一篇！</div>';
    return;
  }
  let html = '';
  BLOG_POSTS.forEach((p, i) => {
    const statusBadge = p.isPublished
      ? '<span style="background:#3ddc84; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">已發布</span>'
      : '<span style="background:#ccc; color:#fff; border-radius:999px; padding:1px 9px; font-size:11px; font-weight:700;">草稿</span>';
    const pin = p.pinned ? '<span style="font-size:11px;">📌</span> ' : '';
    const ev = p.eventTitle ? '<span style="font-size:11px; color:var(--c-brown);">🔗 ' + blogEscape(p.eventTitle) + '</span>' : '';
    const cover = p.coverUrl
      ? '<img src="' + blogEscape(p.coverUrl) + '" alt="" style="width:64px; height:44px; object-fit:cover; border-radius:8px; flex:none; background:#f5f5f5;">'
      : '<div style="width:64px; height:44px; border-radius:8px; flex:none; background:#f8f0ea; display:flex; align-items:center; justify-content:center; font-size:18px;">📝</div>';
    html +=
      '<div style="display:flex; gap:10px; align-items:center; background:#fff; border:1px solid var(--c-border); border-radius:12px; padding:10px 12px; margin-bottom:8px; cursor:pointer;" onclick="blogOpenEdit(' + i + ')">' +
        cover +
        '<div style="flex:1; min-width:0;">' +
          '<div style="font-weight:700; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + pin + blogEscape(p.title) + '</div>' +
          '<div style="display:flex; gap:8px; align-items:center; margin-top:4px; flex-wrap:wrap;">' + statusBadge +
            (p.brand ? '<span style="font-size:11px; color:var(--c-text-light);">' + blogEscape(p.brand) + '</span>' : '') + ev +
            '<span style="font-size:11px; color:var(--c-text-light);">更新 ' + blogFmtDate(p.updatedAt) + '</span>' +
          '</div>' +
        '</div>' +
        (p.isPublished
          ? '<button class="task-mini-btn" style="flex:none;" onclick="event.stopPropagation(); blogCopyLink(' + i + ')">🔗 複製連結</button>'
          : '') +
      '</div>';
  });
  area.innerHTML = html;
}

function blogCopyLink(i) {
  const p = BLOG_POSTS[i];
  if (!p) return;
  const url = BLOG_PAGE_BASE + p.slug;
  (navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(url)
    : Promise.reject()
  ).then(() => alert('已複製文章連結：\n' + url), () => prompt('請手動複製文章連結：', url));
}

// ===== 編輯器 =====

function blogOpenEdit(i) {
  const p = BLOG_POSTS[i];
  BLOG_EDIT = p
    ? { id: p.id, slug: p.slug, title: p.title, coverUrl: p.coverUrl, excerpt: p.excerpt, brand: p.brand,
        tags: (p.tags || []).join(','), eventId: p.eventId || '', pinned: !!p.pinned, isPublished: !!p.isPublished,
        blocks: JSON.parse(JSON.stringify(p.blocks || [])) }
    : { id: null, slug: '', title: '', coverUrl: '', excerpt: '', brand: '', tags: '', eventId: '',
        pinned: false, isPublished: false, blocks: [{ type: 'text', text: '' }] };
  blogRenderEditor();
}

function blogCloseEdit() {
  BLOG_EDIT = null;
  blogRenderList();
}

function blogRenderEditor() {
  const area = document.getElementById('blogListArea');
  const editArea = document.getElementById('blogEditArea');
  if (!editArea) return;
  if (area) area.style.display = 'none';
  editArea.style.display = '';
  const e = BLOG_EDIT;
  const evOptions = ['<option value="">（不綁定）</option>'].concat(BLOG_EVENT_CHOICES.map(c =>
    '<option value="' + blogEscape(c.id) + '"' + (c.id === e.eventId ? ' selected' : '') + '>' +
    blogEscape(c.title) + '（' + blogFmtDate(c.startDate) + '~' + blogFmtDate(c.endDate) + '）</option>'
  ));
  // 綁的團可能超過下拉的 60 天範圍（舊文），補一個「目前綁定」選項避免存檔時被洗掉
  if (e.eventId && !BLOG_EVENT_CHOICES.some(c => c.id === e.eventId)) {
    evOptions.push('<option value="' + blogEscape(e.eventId) + '" selected>（目前綁定的團，已超過下拉範圍）</option>');
  }
  const label = t => '<div style="font-size:12px; font-weight:700; color:var(--c-text-light); margin:12px 0 4px;">' + t + '</div>';
  const inputStyle = 'width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--c-border); border-radius:8px; font-size:14px; font-family:inherit;';
  editArea.innerHTML =
    '<div style="background:#fff; border:1px solid var(--c-border); border-radius:14px; padding:16px 16px 20px; max-width:680px;">' +
      '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
        '<button class="task-mini-btn" onclick="blogCloseEdit()">← 返回列表</button>' +
        '<div style="flex:1;"></div>' +
        (e.id ? '<button class="task-mini-btn" onclick="blogPreview()">👀 預覽</button>' : '') +
        (e.id ? '<button class="task-mini-btn" style="color:#c0392b;" onclick="blogDelete()">🗑 刪除</button>' : '') +
      '</div>' +
      label('文章標題 *') +
      '<input id="bfTitle" style="' + inputStyle + '" value="' + blogEscape(e.title) + '" placeholder="例如：禾流繪本團開團啦！雪莉家私藏書單">' +
      label('摘要（列表卡片＋分享預覽的說明文字）') +
      '<textarea id="bfExcerpt" rows="2" style="' + inputStyle + '" placeholder="一兩句話介紹這篇文章">' + blogEscape(e.excerpt) + '</textarea>' +
      label('封面圖（分享到 LINE／FB 顯示的預覽圖）') +
      '<div style="display:flex; gap:8px; align-items:center;">' +
        '<div id="bfCoverPreview" style="width:120px; height:63px; border-radius:8px; background:#f8f0ea; flex:none; overflow:hidden; display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--c-text-light);">' +
          (e.coverUrl ? '<img src="' + blogEscape(e.coverUrl) + '" style="width:100%; height:100%; object-fit:cover;">' : '尚未設定') + '</div>' +
        '<button class="task-mini-btn" onclick="blogPickImage(function(url){ BLOG_EDIT.coverUrl = url; blogRenderEditor(); })">📤 上傳封面</button>' +
        (e.coverUrl ? '<button class="task-mini-btn" onclick="BLOG_EDIT.coverUrl=\'\'; blogRenderEditor();">✕ 移除</button>' : '') +
      '</div>' +
      label('綁定團購活動（綁了文章會自動顯示開團狀態＋下單按鈕，結團自動收起）') +
      '<select id="bfEvent" style="' + inputStyle + '">' + evOptions.join('') + '</select>' +
      '<div style="display:flex; gap:10px;"><div style="flex:1;">' +
        label('品牌名（列表顯示用，可空）') +
        '<input id="bfBrand" style="' + inputStyle + '" value="' + blogEscape(e.brand) + '">' +
      '</div><div style="flex:1;">' +
        label('標籤（逗號分隔，可空）') +
        '<input id="bfTags" style="' + inputStyle + '" value="' + blogEscape(e.tags) + '" placeholder="繪本,育兒好物">' +
      '</div></div>' +
      label('網址代稱（文章網址最後一段；留空自動產生。只能小寫英數與 -）') +
      '<input id="bfSlug" style="' + inputStyle + '" value="' + blogEscape(e.slug) + '" placeholder="例如：heliu-books-2026">' +
      label('內文（由上到下一塊一塊排；圖片會自動縮圖上傳）') +
      '<div id="bfBlocks"></div>' +
      '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">' +
        '<button class="task-mini-btn" onclick="blogAddBlock(\'text\')">＋ 文字段</button>' +
        '<button class="task-mini-btn" onclick="blogAddBlock(\'heading\')">＋ 小標題</button>' +
        '<button class="task-mini-btn" onclick="blogAddBlock(\'image\')">＋ 圖片</button>' +
        '<button class="task-mini-btn" onclick="blogAddBlock(\'button\')">＋ 按鈕連結</button>' +
      '</div>' +
      '<div style="display:flex; gap:16px; align-items:center; margin-top:16px;">' +
        '<label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" id="bfPinned"' + (e.pinned ? ' checked' : '') + '> 📌 置頂</label>' +
        '<label style="font-size:13px; display:flex; gap:6px; align-items:center;"><input type="checkbox" id="bfPublished"' + (e.isPublished ? ' checked' : '') + '> ✅ 發布（勾了大家才看得到）</label>' +
      '</div>' +
      '<div style="display:flex; gap:8px; margin-top:14px;">' +
        '<button class="task-mini-btn" style="background:var(--c-primary, #FF8FA3); color:#fff; border-color:transparent; font-weight:700; padding:9px 22px;" id="bfSaveBtn" onclick="blogSave()">💾 儲存</button>' +
        '<button class="task-mini-btn" onclick="blogCloseEdit()">取消</button>' +
      '</div>' +
    '</div>';
  blogRenderBlocks();
}

function blogRenderBlocks() {
  const box = document.getElementById('bfBlocks');
  if (!box) return;
  const inputStyle = 'width:100%; box-sizing:border-box; padding:7px 9px; border:1px solid var(--c-border); border-radius:8px; font-size:14px; font-family:inherit;';
  const names = { text: '📄 文字段', heading: '🔖 小標題', image: '🖼 圖片', button: '🛒 按鈕連結' };
  box.innerHTML = BLOG_EDIT.blocks.map((b, i) => {
    let inner = '';
    if (b.type === 'text') {
      inner = '<textarea rows="4" style="' + inputStyle + '" placeholder="這一段的內容（Enter 換行）" oninput="BLOG_EDIT.blocks[' + i + '].text=this.value">' + blogEscape(b.text || '') + '</textarea>';
    } else if (b.type === 'heading') {
      inner = '<input style="' + inputStyle + '" placeholder="小標題文字" value="' + blogEscape(b.text || '') + '" oninput="BLOG_EDIT.blocks[' + i + '].text=this.value">';
    } else if (b.type === 'image') {
      inner =
        (b.url
          ? '<img src="' + blogEscape(b.url) + '" style="max-width:200px; max-height:130px; border-radius:8px; display:block; margin-bottom:6px;">'
          : '<div style="font-size:12px; color:var(--c-text-light); margin-bottom:6px;">尚未選擇圖片</div>') +
        '<button class="task-mini-btn" onclick="blogPickImage(function(url){ BLOG_EDIT.blocks[' + i + '].url = url; blogRenderBlocks(); })">📤 ' + (b.url ? '換一張' : '選擇圖片') + '</button>' +
        '<input style="' + inputStyle + ' margin-top:6px;" placeholder="圖片說明（可空，顯示在圖片下方）" value="' + blogEscape(b.caption || '') + '" oninput="BLOG_EDIT.blocks[' + i + '].caption=this.value">';
    } else if (b.type === 'button') {
      inner =
        '<input style="' + inputStyle + '" placeholder="按鈕文字（例如：🛒 前往下單）" value="' + blogEscape(b.label || '') + '" oninput="BLOG_EDIT.blocks[' + i + '].label=this.value">' +
        '<input style="' + inputStyle + ' margin-top:6px;" placeholder="按鈕連結網址 https://…" value="' + blogEscape(b.url || '') + '" oninput="BLOG_EDIT.blocks[' + i + '].url=this.value">';
    }
    return '<div style="border:1px dashed var(--c-border); border-radius:10px; padding:10px; margin-bottom:8px; background:#fffdfb;">' +
      '<div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">' +
        '<span style="font-size:12px; font-weight:700; color:var(--c-brown, #b5755a);">' + names[b.type] + '</span>' +
        '<div style="flex:1;"></div>' +
        '<button class="task-mini-btn" ' + (i === 0 ? 'disabled' : '') + ' onclick="blogMoveBlock(' + i + ',-1)">↑</button>' +
        '<button class="task-mini-btn" ' + (i === BLOG_EDIT.blocks.length - 1 ? 'disabled' : '') + ' onclick="blogMoveBlock(' + i + ',1)">↓</button>' +
        '<button class="task-mini-btn" style="color:#c0392b;" onclick="blogRemoveBlock(' + i + ')">✕</button>' +
      '</div>' + inner + '</div>';
  }).join('') || '<div style="font-size:12px; color:var(--c-text-light);">還沒有內容，用下面的按鈕加入第一塊。</div>';
}

function blogAddBlock(type) {
  const b = type === 'image' ? { type: 'image', url: '', caption: '' }
    : type === 'button' ? { type: 'button', url: '', label: '🛒 前往下單' }
    : { type: type, text: '' };
  BLOG_EDIT.blocks.push(b);
  blogRenderBlocks();
}

function blogMoveBlock(i, dir) {
  const arr = BLOG_EDIT.blocks;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  blogRenderBlocks();
}

function blogRemoveBlock(i) {
  const b = BLOG_EDIT.blocks[i];
  const hasContent = b && ((b.text && b.text.trim()) || b.url);
  if (hasContent && !confirm('確定要刪除這一塊嗎？')) return;
  BLOG_EDIT.blocks.splice(i, 1);
  blogRenderBlocks();
}

// ===== 圖片：客戶端縮圖（最長邊 1600px、WebP）→ blog-image-upload =====

function blogPickImage(onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const url = await blogUploadImage(file);
      onDone(url);
    } catch (err) {
      alert('圖片上傳失敗：' + err.message);
    }
  };
  input.click();
}

async function blogUploadImage(file) {
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
  const filename = 'blog-' + Date.now() + '.webp';
  const res = await blogApiPost('blog-image-upload', { filename, dataBase64: base64 });
  if (!res.success) throw new Error(res.error || '上傳失敗');
  return res.download_url;
}

// ===== 儲存／刪除／預覽 =====

async function blogSave() {
  const e = BLOG_EDIT;
  if (!e) return;
  const btn = document.getElementById('bfSaveBtn');
  const payload = {
    title: document.getElementById('bfTitle').value.trim(),
    slug: document.getElementById('bfSlug').value.trim(),
    excerpt: document.getElementById('bfExcerpt').value.trim(),
    coverUrl: e.coverUrl || '',
    eventId: document.getElementById('bfEvent').value,
    brand: document.getElementById('bfBrand').value.trim(),
    tags: document.getElementById('bfTags').value,
    pinned: document.getElementById('bfPinned').checked,
    isPublished: document.getElementById('bfPublished').checked,
    blocks: e.blocks,
  };
  if (!payload.title) { alert('請先填文章標題'); return; }
  if (e.id) payload.id = e.id;
  if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }
  try {
    const res = await blogApiPost('blog-post-upsert', payload);
    if (!res.success) throw new Error(res.error || '儲存失敗');
    const saved = res.post;
    const idx = BLOG_POSTS.findIndex(p => p.id === saved.id);
    if (idx >= 0) BLOG_POSTS[idx] = saved; else BLOG_POSTS.unshift(saved);
    // 記住 id/slug（第一次儲存後就能預覽），停留在編輯畫面讓她繼續寫
    e.id = saved.id;
    e.slug = saved.slug;
    document.getElementById('bfSlug').value = saved.slug;
    if (btn) { btn.disabled = false; btn.textContent = '💾 儲存'; }
    blogRenderEditor();
    const note = saved.isPublished
      ? '已儲存並發布！文章連結：\n' + BLOG_PAGE_BASE + saved.slug
      : '已儲存（目前是草稿，勾「發布」大家才看得到）';
    alert(note);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '💾 儲存'; }
    alert('儲存失敗：' + err.message);
  }
}

async function blogDelete() {
  const e = BLOG_EDIT;
  if (!e || !e.id) return;
  if (!confirm('確定要刪除這篇文章嗎？刪了就找不回來囉。')) return;
  try {
    const res = await blogApiPost('blog-post-delete', { id: e.id });
    if (!res.success) throw new Error(res.error || '刪除失敗');
    BLOG_POSTS = BLOG_POSTS.filter(p => p.id !== e.id);
    blogCloseEdit();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

function blogPreview() {
  const e = BLOG_EDIT;
  if (!e || !e.id) return;
  const url = BLOG_PAGE_BASE + encodeURIComponent(e.slug) +
    (e.isPublished ? '' : '?preview=1&token=' + encodeURIComponent(currentToken));
  window.open(url, '_blank');
}

// ===== DOM 掛載（最外層只做這件事）=====

document.getElementById('blogAddBtn').addEventListener('click', () => {
  if (!BLOG_TABLE_READY) { alert('文章資料表尚未建立（待 db push），先請雪莉執行後再試。'); return; }
  blogOpenEdit(-1);
});
document.getElementById('blogRefreshBtn').addEventListener('click', () => loadBlogView(true));
