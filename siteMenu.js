/* 右上角漢堡選單（2026-09-17 雪莉：原本各頁右上角「回首頁」小房子全部改成漢堡選單）。
 * 各頁 HTML 放 <button class="site-home-btn" id="siteMenuBtn">（沿用 shared.css 的圓鈕外觀與位置）＋載入本檔。
 * 選單內容＝首頁入口卡那些；最上面「加入會員」。要增刪項目只改下面 SITE_MENU_ITEMS。
 * 樣式由本檔自行注入（smn- 前綴），不依賴 shared.css 快取版本。
 * 內嵌在會員 App（iframe）裡時不顯示「加入會員」（已經是會員）。
 * 已登入會員（09-17 雪莉）：「加入會員」換成「會員中心＋會員編號・暱稱」卡片。登入狀態存在會員網域，
 * 用隱藏 iframe 載入 /fan-bridge 以 postMessage 問（op:'who'，只回編號＋暱稱，token 不離開會員網域；同 recipes.html 收藏橋接）。
 * 已登入結果在 sessionStorage 快取 5 分鐘（換頁不重問）；未登入不快取（剛登入回來馬上就會變）。 */
(function () {
  // 本機預覽（localhost）改連本機 next dev，正式站一律連會員網域
  var MEMBER_ORIGIN = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:3999' : 'https://member.sheridondon.com.tw';
  var MEMBER_URL = MEMBER_ORIGIN + '/member';
  var SS_MEMBER = 'smn_member_v1';
  var ICON = {
    home: '<path d="M3.8 11.2 12 4.6l8.2 6.6" /><path d="M6 9.8v8.9A1.8 1.8 0 0 0 7.8 20.5h8.4a1.8 1.8 0 0 0 1.8-1.8V9.8" /><path d="M10 20.5v-3.6a2 2 0 0 1 4 0v3.6" />',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17" /><path d="M8.5 3v4" /><path d="M15.5 3v4" /><path d="M12 18c-.3-.2-2.6-1.6-2.6-3.1a1.3 1.3 0 0 1 2.6-.6 1.3 1.3 0 0 1 2.6.6c0 1.5-2.3 2.9-2.6 3.1z" />',
    recipe: '<path d="M12 6.5c-1.8-1.4-4.6-2-8-1.8v13.2c3.4-.2 6.2.4 8 1.8 1.8-1.4 4.6-2 8-1.8V4.7c-3.4-.2-6.2.4-8 1.8z" /><path d="M12 6.5v13.2" /><path d="M6.6 9.2c1.2 0 2.3.3 3.1.7" /><path d="M6.6 12.2c1.2 0 2.3.3 3.1.7" /><path d="M17.4 9.2c-1.2 0-2.3.3-3.1.7" />',
    school: '<path d="M9.5 5a2.5 2.5 0 0 1 5 0" /><path d="M6 10.5a6 6 0 0 1 12 0V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19z" /><path d="M8.8 20.5v-3.7a1 1 0 0 1 1-1h4.4a1 1 0 0 1 1 1v3.7" /><path d="M9.3 11.5h5.4" />',
    books: '<rect x="4" y="4.5" width="5.5" height="16" rx="1.3" /><rect x="9.5" y="7" width="5" height="13.5" rx="1.3" /><path d="M15.6 9.4l2.5-.7a1 1 0 0 1 1.2.7l2.8 10.1-3.2.9z" /><path d="M6.75 8.5v2.5" /><path d="M2.5 20.5h19" />',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M12 8v13" /><path d="M12 8c-.9-2.6-4.6-3.6-4.6-1.3 0 1.1 2.3 1.3 4.6 1.3z" /><path d="M12 8c.9-2.6 4.6-3.6 4.6-1.3 0 1.1-2.3 1.3-4.6 1.3z" />',
    member: '<circle cx="12" cy="8.8" r="4.2" /><path d="M10.5 9.6c.8.7 2.2.7 3 0" /><path d="M4.8 20.3c.9-3.5 3.8-5.7 7.2-5.7s6.3 2.2 7.2 5.7" />',
    menu: '<path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />',
    close: '<path d="M6 6l12 12" /><path d="M18 6 6 18" />'
  };
  // view：recipes.html 內部畫面（在該頁時直接切換，不整頁重載）
  var SITE_MENU_ITEMS = [
    { label: '首頁', icon: 'home', href: 'recipes.html', page: 'recipes.html', view: 'home' },
    { label: '團購行事曆', icon: 'calendar', href: 'index.html?mode=start', page: 'index.html' },
    { label: '觀看食譜', icon: 'recipe', href: 'recipes.html?view=recipes', page: 'recipes.html', view: 'recipes' },
    { label: '開學清單', icon: 'school', href: 'school-list.html', page: 'school-list.html' },
    { label: '繪本館', icon: 'books', href: 'picture-books.html', page: 'picture-books.html' },
    { label: '免費資源', icon: 'gift', href: 'kids.html', page: 'kids.html' }
  ];

  function svg(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' +
      (size > 22 ? '2.06' : '1.8') + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }

  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }

  function currentPage() {
    // 網站根目錄（sheridondon.com.tw/）由 GitHub Pages 回 index.html
    return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }
  function currentRecipesView() {
    // recipes.html 的 currentView 是頂層 let（不掛在 window 上），用裸名稱讀
    try { if (typeof currentView === 'string') return currentView; } catch (e) { /* 忽略 */ }
    return new URLSearchParams(location.search).get('view') ? 'recipes' : 'home';
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 會員登入狀態（fan-bridge）----
  function readCachedMember() {
    try {
      var o = JSON.parse(sessionStorage.getItem(SS_MEMBER) || 'null');
      if (o && o.loggedIn && Date.now() - o.at < 5 * 60 * 1000) return o;
    } catch (e) { /* 私密模式等 */ }
    return null;
  }
  function askMember(done) {
    var ifr = document.createElement('iframe');
    var finished = false;
    var timer = setTimeout(function () { finish({ loggedIn: false }); }, 12000);
    function finish(res) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      setTimeout(function () { if (ifr.parentNode) ifr.parentNode.removeChild(ifr); }, 0);
      done(res);
    }
    function onMsg(e) {
      if (e.origin !== MEMBER_ORIGIN || e.source !== ifr.contentWindow || !e.data) return;
      if (e.data.src === 'dd-fav-ready') {
        try { ifr.contentWindow.postMessage({ src: 'dd-fav', id: 1, op: 'who' }, MEMBER_ORIGIN); } catch (err) { finish({ loggedIn: false }); }
      } else if (e.data.src === 'dd-fav-reply' && e.data.id === 1) {
        finish({ loggedIn: !!e.data.loggedIn, memberNo: e.data.memberNo || '', displayName: e.data.displayName || '' });
      }
    }
    window.addEventListener('message', onMsg);
    ifr.src = MEMBER_ORIGIN + '/fan-bridge';
    ifr.title = '會員登入狀態';
    ifr.setAttribute('aria-hidden', 'true');
    ifr.tabIndex = -1;
    ifr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(ifr);
  }

  function injectCss() {
    if (document.getElementById('smnStyle')) return;
    var css =
      '.smn-overlay{position:fixed;inset:0;z-index:1000;background:rgba(90,60,40,.28);opacity:0;pointer-events:none;transition:opacity .18s ease;}' +
      '.smn-overlay.on{opacity:1;pointer-events:auto;}' +
      '.smn-panel{position:fixed;top:66px;right:14px;z-index:1001;width:min(260px,calc(100vw - 28px));max-height:calc(100dvh - 86px);overflow-y:auto;' +
      'background:#fff;border:1px solid var(--c-border,#FFD3B6);border-radius:18px;box-shadow:0 10px 30px rgba(120,80,50,.18);padding:10px;' +
      'transform:translateY(-6px) scale(.98);transform-origin:top right;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;}' +
      '.smn-panel.on{opacity:1;transform:none;pointer-events:auto;}' +
      '.smn-join{display:flex;align-items:center;justify-content:center;gap:8px;margin:2px 2px 8px;padding:12px 10px;border-radius:999px;' +
      'background:var(--c-primary,#FF8FA3);color:#fff !important;font-weight:800;font-size:15px;text-decoration:none;box-shadow:0 3px 10px rgba(255,143,163,.35);}' +
      '.smn-join svg{flex:none;}' +
      '.smn-member{display:flex;align-items:center;gap:10px;margin:2px 2px 8px;padding:10px 12px;border-radius:16px;text-decoration:none;' +
      'background:linear-gradient(135deg,#FF8FA3 0%,#ffb199 100%);color:#fff !important;box-shadow:0 3px 10px rgba(255,143,163,.35);}' +
      '.smn-member-ico{flex:none;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;}' +
      '.smn-member-txt{flex:1;min-width:0;line-height:1.35;}' +
      '.smn-member-title{font-weight:800;font-size:15px;}' +
      '.smn-member-sub{font-size:12px;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.smn-member-arrow{flex:none;font-size:18px;font-weight:800;opacity:.9;}' +
      '.smn-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;color:var(--c-text,#5a4a3f) !important;' +
      'text-decoration:none;font-weight:700;font-size:15px;-webkit-tap-highlight-color:transparent;}' +
      '.smn-item svg{flex:none;color:var(--c-brown,#b5755a);}' +
      '.smn-item:hover,.smn-item:active{background:var(--c-bg-bottom,#FFF1E6);}' +
      '.smn-item.cur{background:#fff0f3;color:var(--c-pink-deep,#e0607e) !important;}' +
      '.smn-item.cur svg{color:var(--c-pink-deep,#e0607e);}';
    var st = document.createElement('style');
    st.id = 'smnStyle';
    st.textContent = css;
    document.head.appendChild(st);
  }

  // 選單最上面：未登入＝加入會員；已登入＝會員中心卡（編號・暱稱）
  function joinHtml(m) {
    if (m && m.loggedIn) {
      var sub = [m.memberNo, m.displayName].filter(Boolean).map(esc).join('・');
      return '<a class="smn-member" href="' + MEMBER_URL + '">' +
        '<span class="smn-member-ico">' + svg('member', 20) + '</span>' +
        '<span class="smn-member-txt"><span class="smn-member-title" style="display:block;">會員中心</span>' +
        (sub ? '<span class="smn-member-sub" style="display:block;">' + sub + '　您好 🩷</span>' : '') + '</span>' +
        '<span class="smn-member-arrow" aria-hidden="true">›</span></a>';
    }
    return '<a class="smn-join" href="' + MEMBER_URL + '">' + svg('member', 20) + '加入會員</a>';
  }

  function init() {
    var btn = document.getElementById('siteMenuBtn');
    if (!btn || btn.getAttribute('data-smn') === '1') return;
    btn.setAttribute('data-smn', '1');
    injectCss();

    var page = currentPage();
    var overlay = document.createElement('div');
    overlay.className = 'smn-overlay';
    var panel = document.createElement('nav');
    panel.className = 'smn-panel';
    panel.id = 'siteMenuPanel';
    panel.setAttribute('aria-label', '網站選單');

    var html = '';
    if (!embedded) html += '<div id="smnMemberSlot">' + joinHtml(readCachedMember()) + '</div>';
    SITE_MENU_ITEMS.forEach(function (it, i) {
      html += '<a class="smn-item" data-i="' + i + '" href="' + it.href + '">' + svg(it.icon, 20) + '<span>' + it.label + '</span></a>';
    });
    panel.innerHTML = html;
    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    // 沒有已登入快取才去問（頁面載入完、閒置時再問，不拖慢首屏）
    if (!embedded && !readCachedMember()) {
      var run = function () {
        askMember(function (res) {
          if (res.loggedIn) {
            try { sessionStorage.setItem(SS_MEMBER, JSON.stringify({ loggedIn: true, memberNo: res.memberNo, displayName: res.displayName, at: Date.now() })); } catch (e) { /* 忽略 */ }
          }
          var slot = document.getElementById('smnMemberSlot');
          if (slot) slot.innerHTML = joinHtml(res.loggedIn ? res : null);
        });
      };
      if (document.readyState === 'complete') setTimeout(run, 300);
      else window.addEventListener('load', function () { setTimeout(run, 300); });
    }

    function markCurrent() {
      var links = panel.querySelectorAll('.smn-item');
      for (var k = 0; k < links.length; k++) {
        var it = SITE_MENU_ITEMS[Number(links[k].getAttribute('data-i'))];
        var cur = it.page === page && (!it.view || it.view === currentRecipesView());
        links[k].classList.toggle('cur', cur);
      }
    }
    function setOpen(open) {
      if (open) markCurrent();
      overlay.classList.toggle('on', open);
      panel.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.style.zIndex = open ? '1002' : ''; // 開著時按鈕浮在遮罩上，可再點一次（✕）關閉
      btn.innerHTML = svg(open ? 'close' : 'menu', 24);
    }
    btn.setAttribute('aria-controls', 'siteMenuPanel');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setOpen(!panel.classList.contains('on'));
    });
    overlay.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    // 在 recipes.html 點「首頁／觀看食譜」：頁內直接切畫面（與原本小房子行為一致），不整頁重載
    panel.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.smn-item') : null;
      if (!a) return;
      var it = SITE_MENU_ITEMS[Number(a.getAttribute('data-i'))];
      if (it.view && page === 'recipes.html' && typeof window.switchView === 'function') {
        e.preventDefault();
        setOpen(false);
        window.switchView(it.view);
        window.scrollTo(0, 0);
        return;
      }
      setOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
