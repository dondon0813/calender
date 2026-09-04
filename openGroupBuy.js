// 全站共用「現正開團中」置頂橫列。獨立區塊，不依賴載入頁面的其他程式碼。
// 抓「全部」目前開團中的團購（不篩品牌），不像開學清單舊版只挑跟開學品項有關的品牌。
// 用法：頁面裡放一個容器
//   <div class="ogb-bar" id="openGroupBuyBar" style="display:none;" data-src="xxx"></div>
// 再引入 <script src="openGroupBuy.js"></script>（放哪裡都行，只要在容器 div 之後）。
// data-src 是統計來源代號（stat key 的 _src_xxx，只能小寫英數），各頁面填不同值方便報表分開看，
// 沒填就預設 'ogbtop'；style 見 shared.css 的 .ogb-* 規則。
// 2026-09-04 起與 index.html 行事曆同一套點擊邏輯：食物團（recipeBrand）／繪本團（BOOK_TEAM_BRANDS）
// ／有折扣碼的團，點小圖先跳選擇視窗（介紹／食譜大全／下單＋折扣碼點擊複製），其餘直接開團購連結。
// 視窗樣式靠 shared.css 的 .modal-* 與色彩變數，其餘 .ogbgc-* 規則由本檔自行注入，不依賴各頁面的 CSS。
(function () {
  // 步驟5正式切換（2026-08-20）：改打新後端，回退＝revert 本 commit
  const APPS_SCRIPT_URL = 'https://dondon-platform.vercel.app/api/legacy';
  const bar = document.getElementById('openGroupBuyBar');
  if (!bar) return;
  const SRC_CODE = (bar.dataset.src || '').replace(/[^a-z0-9]/g, '') || 'ogbtop';
  let BRAND_THUMBS = {};

  // ===== 選擇視窗（與 index.html 的 groupChoiceModal 同一套規則）=====
  const RECIPES_PAGE_URL = 'recipes.html';
  const PICTURE_BOOKS_PAGE_URL = 'picture-books.html';
  // 繪本團判定：團名含 match 字樣（不分大小寫）＝繪本團。這份清單與 index.html 的
  // BOOK_TEAM_BRANDS 是同一份規則的複本，改品牌時兩邊要一起改。
  const BOOK_TEAM_BRANDS = [
    { match: '禾流', brand: '禾流文創' },
    { match: 'kidsread', brand: 'Kidsread點讀筆' },
  ];
  function bookTeamBrandOf(title) {
    const t = String(title || '').toLowerCase();
    const hit = BOOK_TEAM_BRANDS.find(b => t.includes(b.match.toLowerCase()));
    return hit ? hit.brand : '';
  }
  // 有食譜品牌（食材／食譜入口）、折扣碼、或是繪本團（繪本館介紹入口），點擊時先跳選擇視窗
  function needsGroupModal(o) {
    return !!((o.recipeBrand && o.recipeBrand.trim()) || (o.discountCode && o.discountCode.trim()) || bookTeamBrandOf(o.title));
  }

  function normalizeBrandKey(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '');
  }
  function isValidUrl(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s.trim());
  }
  function parseDateStr(s) {
    if (!s) return null;
    s = String(s).trim();
    const gvizMatch = s.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (gvizMatch) return new Date(parseInt(gvizMatch[1]), parseInt(gvizMatch[2]), parseInt(gvizMatch[3]));
    const parts = s.split(/[\/\-]/).map(p => parseInt(p, 10));
    if (parts.length === 3) return new Date(parts[0], parts[1] - 1, parts[2]);
    return null;
  }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function fmtSingleDate(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
  function parseExtendRaw(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return { type: 'days', value: raw };
    const d = parseDateStr(raw);
    return d ? { type: 'date', value: d } : null;
  }
  function computeDisplayEnd(end, extend) {
    if (!extend) return end;
    const todayStart = startOfDay(new Date());
    const endStart = startOfDay(end);
    if (todayStart <= endStart) return end;
    if (extend.type === 'days') return new Date(end.getFullYear(), end.getMonth(), end.getDate() + extend.value);
    return extend.value;
  }
  function sendStat(key, field) {
    if (!key || !APPS_SCRIPT_URL) return;
    const type = field === 'click' ? 'stat-click' : 'stat-view';
    const payload = JSON.stringify({ type, key });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(APPS_SCRIPT_URL, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
      } else {
        fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: payload, keepalive: true }).catch(() => {});
      }
    } catch (e) { /* 統計失敗不影響瀏覽，安靜忽略 */ }
  }

  // ===== 折扣碼複製（與 index.html 同款：clipboard API 不可用時退回 execCommand）=====
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }
  function copyToClipboard(code) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(code).then(() => true).catch(() => legacyCopy(code));
    }
    return Promise.resolve(legacyCopy(code));
  }

  // ===== 選擇視窗 DOM／樣式（首次要用時才建立一次）=====
  // .modal-backdrop / .modal-box / .modal-close 與色彩變數來自 shared.css（8 個載入頁都有引），
  // 這裡只補 index.html 的 .gc-* 對應樣式（改名 .ogbgc-* 避免撞名）。
  let GC = null; // { backdrop, title, introBtn, recipeBtn, orderBtn, discount, codeBtn, codeText, codeHint, desc }
  function ensureChoiceModal() {
    if (GC) return GC;
    const style = document.createElement('style');
    style.textContent = `
      .ogbgc-box { text-align: center; }
      .ogbgc-title { font-weight: 800; font-size: 17px; color: var(--c-text); margin: 4px 0 18px; padding-right: 10px; }
      .ogbgc-btns { display: flex; flex-direction: column; gap: 10px; }
      .ogbgc-btn { display: block; text-align: center; text-decoration: none; font-weight: 800; font-size: 14px;
        border-radius: var(--r-pill); padding: 12px 14px; color: #fff; cursor: pointer; border: none; }
      .ogbgc-btn-intro { background: var(--c-cat-4); }
      .ogbgc-btn-recipe { background: var(--c-cat-1); }
      .ogbgc-btn-order { background: var(--c-primary); }
      .ogbgc-btn-order:hover { background: var(--c-primary-dark); }
      .ogbgc-discount { display: none; }
      .ogbgc-discount.show { display: block; margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--c-line); }
      .ogbgc-discount-label { font-size: 12px; font-weight: 800; color: var(--c-text-soft); letter-spacing: 1px; margin-bottom: 8px; }
      .ogbgc-code { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; width: 100%;
        padding: 11px 14px; border: 1px dashed var(--c-border); border-radius: var(--r-md); background: var(--c-bg-bottom);
        cursor: pointer; font-family: inherit; }
      .ogbgc-code:hover { border-color: var(--c-primary); }
      .ogbgc-code-text { font-size: 18px; font-weight: 800; letter-spacing: 2px; color: var(--c-text); line-height: 1.2; word-break: break-all; }
      .ogbgc-code-hint { font-size: 14px; font-weight: 700; color: #fff; background: var(--c-primary); border-radius: var(--r-pill); padding: 9px 18px; white-space: nowrap; }
      .ogbgc-remind { font-size: 13px; font-weight: 700; line-height: 1.5; color: var(--c-primary-dark); background: var(--c-bg-bottom); border-radius: var(--r-md); padding: 8px 12px; margin-top: 12px; }
      .ogbgc-discount-desc { font-size: 13px; line-height: 1.6; color: var(--c-text-soft); margin-top: 10px; white-space: pre-line; }
    `;
    document.head.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-box ogbgc-box">
        <button type="button" class="modal-close">✕</button>
        <h3 class="ogbgc-title"></h3>
        <div class="ogbgc-btns">
          <a class="ogbgc-btn ogbgc-btn-intro" target="_blank" rel="noopener noreferrer">📖 前往觀看介紹</a>
          <a class="ogbgc-btn ogbgc-btn-recipe" target="_blank" rel="noopener noreferrer">🍽 食譜大全</a>
          <a class="ogbgc-btn ogbgc-btn-order" target="_blank" rel="noopener noreferrer">🛒 前往下單</a>
        </div>
        <div class="ogbgc-discount">
          <div class="ogbgc-discount-label">專屬折扣碼</div>
          <button type="button" class="ogbgc-code">
            <span class="ogbgc-code-text"></span>
            <span class="ogbgc-code-hint">點擊複製</span>
          </button>
          <div class="ogbgc-discount-desc"></div>
          <div class="ogbgc-remind">💡 記得輸入折扣碼才能享有折扣</div>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    const q = sel => backdrop.querySelector(sel);
    GC = {
      backdrop,
      title: q('.ogbgc-title'),
      introBtn: q('.ogbgc-btn-intro'),
      recipeBtn: q('.ogbgc-btn-recipe'),
      orderBtn: q('.ogbgc-btn-order'),
      discount: q('.ogbgc-discount'),
      codeBtn: q('.ogbgc-code'),
      codeText: q('.ogbgc-code-text'),
      codeHint: q('.ogbgc-code-hint'),
      desc: q('.ogbgc-discount-desc'),
    };
    const close = () => backdrop.classList.remove('show');
    q('.modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    return GC;
  }

  function flashGcCopied(ok) {
    const gc = ensureChoiceModal();
    gc.codeHint.textContent = ok ? '已複製 ✓' : '請手動複製';
    setTimeout(() => { gc.codeHint.textContent = '點擊複製'; }, 2000);
  }

  // 與 index.html openGroupChoiceModal 同一套分支：
  // 食物團（recipeBrand）＝食材介紹＋食譜大全；繪本團＝介紹連繪本館品牌視角、無食譜鈕；
  // 都不是（只有折扣碼）＝只留「前往下單」。統計 key 也沿用 _intro/_recipe/_order/_code。
  function openChoiceModal(o) {
    const gc = ensureChoiceModal();
    const brand = (o.recipeBrand || '').trim();
    const code = (o.discountCode || '').trim();
    const bookBrand = bookTeamBrandOf(o.title);
    const baseKey = o.evKey;

    gc.title.textContent = o.title.replace(/｜/g, ' ');

    gc.introBtn.style.display = (brand || bookBrand) ? '' : 'none';
    gc.recipeBtn.style.display = brand ? '' : 'none';
    if (brand) {
      gc.introBtn.href = RECIPES_PAGE_URL + '?view=ingredients&brand=' + encodeURIComponent(brand);
      gc.introBtn.onclick = () => sendStat(baseKey + '_intro', 'click');
      gc.recipeBtn.href = RECIPES_PAGE_URL + '?view=recipes&brand=' + encodeURIComponent(brand);
      gc.recipeBtn.textContent = '🍽 ' + brand + ' 食譜大全';
      gc.recipeBtn.onclick = () => sendStat(baseKey + '_recipe', 'click');
    } else if (bookBrand) {
      gc.introBtn.href = PICTURE_BOOKS_PAGE_URL + '?brand=' + encodeURIComponent(bookBrand);
      gc.introBtn.onclick = () => sendStat(baseKey + '_intro', 'click');
    }

    gc.orderBtn.href = o.url;
    gc.orderBtn.onclick = () => {
      sendStat(baseKey + '_order', 'click');
      // 有折扣碼時，點「前往下單」順手幫使用者複製（不擋跳轉）
      if (code) copyToClipboard(code).then(flashGcCopied);
    };

    if (code) {
      gc.codeText.textContent = code;
      const desc = (o.discountDesc || '').trim();
      gc.desc.textContent = desc;
      gc.desc.style.display = desc ? '' : 'none';
      gc.codeHint.textContent = '點擊複製';
      gc.codeBtn.onclick = () => {
        copyToClipboard(code).then(ok => {
          if (ok) sendStat(baseKey + '_code', 'click');
          flashGcCopied(ok);
        });
      };
      gc.discount.classList.add('show');
    } else {
      gc.discount.classList.remove('show');
    }

    gc.backdrop.classList.add('show');
  }

  // 挑 4 欄或 5 欄：優先列數最少，列數打平時再挑最後一排最不零散的（waste 最小＝最後一排最滿）。
  // 6 個以下維持自由換行，不強制切格線。
  function pickGridClass(n) {
    if (n < 6) return '';
    let best = null;
    [4, 5].forEach(cols => {
      const rows = Math.ceil(n / cols);
      const waste = cols * rows - n;
      if (!best || rows < best.rows || (rows === best.rows && waste < best.waste)) {
        best = { cols, rows, waste };
      }
    });
    return 'ogb-grid' + best.cols;
  }

  // 小圖優先序：行事曆該檔 W 欄 > 品牌資料庫預設小圖（用標準化後的品牌名找是否為團名子字串）
  // 「一團多品牌」合併團名（例如「Nadle腳踏車/Jolly電動扭扭車」）可能同時命中兩個品牌，
  // 命中長度打平時不可用 Object.keys 的列舉順序硬選一個——那是試算表列順序，跟哪個品牌才是這次
  // 主打完全無關，選錯就會把另一個不相關品牌的圖放上去。打平就視為無法判斷，寧可不顯示小圖，
  // 也不要顯示錯的；真的要顯示就手動填行事曆該檔的 W 欄覆蓋掉。
  function resolveThumb(title, rowThumb) {
    if (isValidUrl(rowThumb)) return rowThumb;
    const key = normalizeBrandKey(title);
    let best = '', bestLen = 0, tied = false;
    Object.keys(BRAND_THUMBS).forEach(bk => {
      if (!bk || !key.includes(bk)) return;
      if (bk.length > bestLen) { best = bk; bestLen = bk.length; tied = false; }
      else if (bk.length === bestLen) { tied = true; }
    });
    return (best && !tied) ? BRAND_THUMBS[best] : '';
  }

  function parseOpenEvents(calText) {
    const jsonStr = calText.substring(calText.indexOf('{'), calText.lastIndexOf('}') + 1);
    const data = JSON.parse(jsonStr);
    const rows = data.table.rows;
    const today = startOfDay(new Date());
    const open = [];
    rows.forEach(row => {
      const c = row.c;
      if (!c || !c[0] || c[0].v === null || c[0].v === '') return;
      const id = c[0].v;
      const start = parseDateStr(c[1] ? c[1].v : null);
      const end = parseDateStr(c[2] ? c[2].v : null);
      const extend = parseExtendRaw(c[3] ? c[3].v : null);
      const title = c[4] ? String(c[4].v || '').trim() : '';
      const url = c[7] ? c[7].v : '';
      const recipeBrand = c[10] ? String(c[10].v || '').trim() : '';
      const rowThumb = c[22] ? String(c[22].v || '').trim() : '';
      const discountCode = c[23] ? String(c[23].v || '').trim() : '';
      const discountDesc = c[24] ? String(c[24].v || '').trim() : '';
      const publishedRaw = c[16] ? String(c[16].v || '').trim() : '';
      const published = publishedRaw === '' ? true : (publishedRaw === '是');
      if (!start || !end || !title || !published) return;
      const displayEnd = computeDisplayEnd(end, extend);
      if (startOfDay(start) > today || today > startOfDay(displayEnd)) return;
      const evKey = `${id}_${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
      open.push({ title, url, thumb: resolveThumb(title, rowThumb), end: displayEnd, recipeBrand, discountCode, discountDesc, evKey });
    });
    open.sort((a, b) => a.end - b.end);
    return open;
  }

  function renderOpenGroupBuyBar(open) {
    bar.innerHTML = '';
    if (!open.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';

    const title = document.createElement('div');
    title.className = 'ogb-title';
    title.textContent = '🟢 現正開團中';
    bar.appendChild(title);

    const list = document.createElement('div');
    const gridClass = pickGridClass(open.length);
    list.className = 'ogb-items' + (gridClass ? ' ' + gridClass : '');
    open.forEach(o => {
      // 團名用的「｜」是斷行點，橫排一行時換回空白
      const displayName = o.title.replace(/｜/g, ' ');
      const canLink = isValidUrl(o.url);
      const cell = document.createElement(canLink ? 'a' : 'div');
      cell.className = 'ogb-item';
      if (canLink) {
        cell.href = o.url;
        cell.target = '_blank';
        cell.rel = 'noopener noreferrer';
        cell.addEventListener('click', (e) => {
          sendStat(o.evKey + '_src_' + SRC_CODE, 'click');
          // 與首頁行事曆同規則：介紹團／折扣碼團先跳選擇視窗，不直接跳轉
          if (needsGroupModal(o)) {
            e.preventDefault();
            openChoiceModal(o);
          }
        });
      }

      const thumbBox = document.createElement('div');
      thumbBox.className = 'ogb-thumb';
      if (isValidUrl(o.thumb)) {
        const img = document.createElement('img');
        img.src = o.thumb;
        img.alt = displayName;
        img.loading = 'lazy';
        img.onerror = function () {
          thumbBox.innerHTML = '';
          const fb = document.createElement('span');
          fb.className = 'ogb-thumb-fallback';
          fb.textContent = displayName.charAt(0);
          thumbBox.appendChild(fb);
        };
        thumbBox.appendChild(img);
      } else {
        const fb = document.createElement('span');
        fb.className = 'ogb-thumb-fallback';
        fb.textContent = displayName.charAt(0);
        thumbBox.appendChild(fb);
      }
      cell.appendChild(thumbBox);

      const name = document.createElement('div');
      name.className = 'ogb-name';
      name.textContent = displayName;
      cell.appendChild(name);

      const end = document.createElement('div');
      end.className = 'ogb-end';
      end.textContent = fmtSingleDate(o.end) + ' 收單' + (o.discountCode ? '・折扣碼 ' + o.discountCode : '');
      cell.appendChild(end);

      list.appendChild(cell);
    });
    bar.appendChild(list);
  }

  // 有些頁面自己也會在載入時打同一支 Apps Script（recipes.html 就有兩支），
  // 加上這裡的 2 支，同時間對同一個 /exec 網址的請求數一多，Google 那邊偶爾會有幾支被打回 404
  // （已實測：稍等一下單獨重打就會成功，是併發問題不是網址壞掉）。失敗就退避重試，不要整條 bar 直接消失。
  async function fetchWithRetry(url, retries) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return res;
      } catch (e) { /* 網路層錯誤，進下一輪重試 */ }
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    throw new Error('fetch 重試後仍失敗：' + url);
  }

  async function init() {
    const [calRes, pubRes] = await Promise.all([
      fetchWithRetry(APPS_SCRIPT_URL + '?scope=calendar&t=' + Date.now(), 2),
      fetchWithRetry(APPS_SCRIPT_URL + '?scope=public&t=' + Date.now(), 2)
    ]);
    const calText = await calRes.text();
    const pubData = await pubRes.json();
    (pubData.brandThumbs || []).forEach(b => {
      const name = String(b['品牌名稱'] || '').trim();
      const url = String(b['去背小圖'] || '').trim();
      if (name && url) BRAND_THUMBS[normalizeBrandKey(name)] = url;
    });
    renderOpenGroupBuyBar(parseOpenEvents(calText));
  }
  init().catch(err => console.error('現正開團中載入失敗', err));
})();
