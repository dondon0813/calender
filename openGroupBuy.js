// 全站共用「現正開團中」置頂橫列。獨立區塊，不依賴載入頁面的其他程式碼。
// 抓「全部」目前開團中的團購（不篩品牌），不像開學清單舊版只挑跟開學品項有關的品牌。
// 用法：頁面裡放一個容器
//   <div class="ogb-bar" id="openGroupBuyBar" style="display:none;" data-src="xxx"></div>
// 再引入 <script src="openGroupBuy.js"></script>（放哪裡都行，只要在容器 div 之後）。
// data-src 是統計來源代號（stat key 的 _src_xxx，只能小寫英數），各頁面填不同值方便報表分開看，
// 沒填就預設 'ogbtop'；style 見 shared.css 的 .ogb-* 規則。
// 簡化版：不做折扣碼小視窗（school-list.html 舊版有，這裡沒有），有折扣碼就直接把碼顯示在橫列上。
(function () {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTxoqVO1nf--Q9s-lf1eIPdgrDpJgLsuAy1mAwgydYzb7ThAuygx79oFNsEH-kWD2R/exec';
  const bar = document.getElementById('openGroupBuyBar');
  if (!bar) return;
  const SRC_CODE = (bar.dataset.src || '').replace(/[^a-z0-9]/g, '') || 'ogbtop';
  let BRAND_THUMBS = {};

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
      const rowThumb = c[22] ? String(c[22].v || '').trim() : '';
      const discountCode = c[23] ? String(c[23].v || '').trim() : '';
      const publishedRaw = c[16] ? String(c[16].v || '').trim() : '';
      const published = publishedRaw === '' ? true : (publishedRaw === '是');
      if (!start || !end || !title || !published) return;
      const displayEnd = computeDisplayEnd(end, extend);
      if (startOfDay(start) > today || today > startOfDay(displayEnd)) return;
      const evKey = `${id}_${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;
      open.push({ title, url, thumb: resolveThumb(title, rowThumb), end: displayEnd, discountCode, evKey });
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
        cell.addEventListener('click', () => { sendStat(o.evKey + '_src_' + SRC_CODE, 'click'); });
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
