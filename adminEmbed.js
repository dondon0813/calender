// 後台「被嵌入模式」（docs/22 §3.0，段 1）：新後台框框（dondon-platform /admin）用 iframe 載入
//   admin.html?embed=1&view=<分頁>&wide=<1|0>
// 本檔只在 embed=1 且真的被放在 iframe 裡時動作；其他情況（員工平常用的 admin.html）第一行就 return，零副作用。
//
// 做的事：
//  1. 藏起舊的外框（登入畫面、側欄、頂列、漢堡選單、頁尾、緊急／新任務橫幅），內容貼齊 iframe；舊的雙欄工作區照舊運作。
//  2. 開機依 view 參數切分頁；外框用 postMessage 叫舊頁切分頁／開關右欄／開設定。
//  3. 把狀態傳回外框：目前分頁（viewChanged）、登入者與權限（auth）、緊急／新任務／公告未讀（status）、登入失效（needLogin）。
//  4. 公告彈窗改由外框做：這裡把舊 checkStaffAnnouncements 關掉（外框自己查、自己彈）。
//  5. 「寬螢幕」判斷改聽外框：iframe 比視窗窄（扣掉側欄），舊的 (min-width:1200px) 媒體查詢會誤判，
//     所以改成外框說了算——蓋掉 matchMedia，並把樣式表裡 (min-width:1200px) 的規則整段開關。
// 訊息格式與外框那端（dondon-platform lib/admin/protocol.ts）一起改；一律帶 src／v，並驗 origin 與來源視窗。
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('embed') !== '1' || window.parent === window) return;

  var SRC = 'dondon-admin';
  var VER = 1;
  var wide = params.get('wide') === '1';
  var root = document.documentElement;
  root.classList.add('adm-embed');
  if (wide) root.classList.add('adm-wide');

  // ---------- 1. 嵌入模式樣式 ----------
  var css = [
    'html.adm-embed #passwordGate,html.adm-embed #sideNav,html.adm-embed .topbar,html.adm-embed .menu-wrap,',
    'html.adm-embed #mainContentCol > .footer,html.adm-embed #urgentBanner,html.adm-embed #newTaskBanner{display:none !important;}',
    'html.adm-embed body{padding:0 !important;background:transparent !important;}',
    'html.adm-embed .wrap,html.adm-embed #mainWrap{max-width:none !important;margin:0 !important;padding:0 !important;display:block !important;}',
    'html.adm-embed #mainContentCol{min-height:0 !important;display:block !important;}',
    // 頂列與內容之間原本的 12px 間距（.topbar 的 margin-bottom）搬進 iframe 當第一個元素：舊頁窄螢幕時它會跟分頁標題的 margin-top 疊合（取大的），
    // 放在 iframe 內才能照舊疊合；外框頂列因此不留下方間距
    'html.adm-embed #mainWrap::before{content:"";display:block;margin-top:12px;}',
    // 寬螢幕雙欄：兩欄各自內捲。舊頁的 calc(100vh - 150px)＝扣掉頂列／間距／頁尾等外框；外框搬走後，iframe 內只剩 12px 間距與 26px 頁尾前留白要扣
    'html.adm-embed.adm-wide #paneLeft,html.adm-embed.adm-wide #paneRight{max-height:calc(100vh - 38px) !important;}',
    'html.adm-embed.adm-wide #splitWorkspace.right-closed #paneLeft{max-height:none !important;}'
  ].join('\n');
  var st = document.createElement('style');
  st.id = 'admEmbStyle';
  st.textContent = css;
  (document.head || root).appendChild(st);

  // ---------- 5. 寬螢幕開關 ----------
  var WIDE_Q = '(min-width:1200px)';
  var wideListeners = [];
  function isWideQuery(q) { return String(q).replace(/\s+/g, '') === WIDE_Q; }
  var realMM = window.matchMedia ? window.matchMedia.bind(window) : null;
  window.matchMedia = function (q) {
    if (!isWideQuery(q)) return realMM ? realMM(q) : { matches: false, media: String(q), addEventListener: function () {}, removeEventListener: function () {}, addListener: function () {}, removeListener: function () {} };
    admEmbFlipRules();
    var mql = {
      media: String(q),
      onchange: null,
      addEventListener: function (t, fn) { if (t === 'change' && typeof fn === 'function') wideListeners.push(fn); },
      removeEventListener: function (t, fn) { wideListeners = wideListeners.filter(function (f) { return f !== fn; }); },
      addListener: function (fn) { if (typeof fn === 'function') wideListeners.push(fn); },
      removeListener: function (fn) { wideListeners = wideListeners.filter(function (f) { return f !== fn; }); },
      dispatchEvent: function () { return false; }
    };
    Object.defineProperty(mql, 'matches', { get: function () { return wide; } });
    return mql;
  };
  // 把所有樣式表裡「(min-width:1200px)」的媒體規則整段開關：外框說寬＝永遠成立，說窄＝還原原本的條件
  var wideRules = [];
  var scannedSheets = 0;
  function admEmbFlipRules() {
    var sheets = document.styleSheets;
    for (var i = scannedSheets; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; } // 跨網域樣式表讀不到，略過
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (r.type !== 4 || !r.media) continue; // 4 = CSSMediaRule
        if (String(r.media.mediaText).replace(/\s+/g, '') === WIDE_Q) wideRules.push(r);
      }
    }
    scannedSheets = sheets.length;
    wideRules.forEach(function (r) { r.media.mediaText = wide ? 'all' : '(min-width: 1200px)'; });
  }
  function admEmbSetWide(w) {
    w = !!w;
    if (w === wide) return;
    wide = w;
    root.classList.toggle('adm-wide', wide);
    admEmbFlipRules();
    var ev = { matches: wide, media: WIDE_Q };
    wideListeners.slice().forEach(function (fn) { try { fn(ev); } catch (e) { console.error('admEmb wide listener', e); } });
  }
  document.addEventListener('DOMContentLoaded', admEmbFlipRules);

  // ---------- 與外框傳話 ----------
  function post(msg) {
    try { window.parent.postMessage(Object.assign({ src: SRC, v: VER }, msg), location.origin); } catch (e) { /* 靜默 */ }
  }

  // ---------- 4. 公告：關掉舊頁自己的檢查（外框做） ----------
  try {
    Object.defineProperty(window, 'checkStaffAnnouncements', { configurable: true, get: function () { return function () {}; }, set: function () {} });
  } catch (e) { /* 靜默 */ }

  // ---------- 3. 狀態回報（給 admin.js 的兩個鉤子用） ----------
  var lastView = '';
  function admEmbReportView() {
    if (typeof currentView === 'undefined') return;
    var v = currentView || 'home';
    var r = (typeof currentRightView !== 'undefined' && currentRightView) ? currentRightView : '';
    var key = v + '|' + r;
    if (key === lastView) return;
    lastView = key;
    post({ type: 'viewChanged', view: v, rightView: r });
  }
  var lastAuth = '';
  function admEmbReportAuth() {
    if (typeof myPermissions === 'undefined') return;
    var msg = {
      type: 'auth',
      userName: (typeof currentUser !== 'undefined' && currentUser) ? String(currentUser) : '',
      isAdmin: typeof isAdmin !== 'undefined' ? !!isAdmin : false,
      permissions: myPermissions || {},
      mustChangePassword: typeof forcePasswordChange !== 'undefined' ? !!forcePasswordChange : false
    };
    var key = JSON.stringify(msg);
    if (key === lastAuth) return;
    lastAuth = key;
    post(msg);
  }
  /** admin.js 在 syncPaneRightPicker／updatePermissionUI 結尾呼叫（見該處註解）。非嵌入模式這個函式不存在 */
  window.admEmbHook = function (kind) {
    try {
      if (kind === 'view') admEmbReportView();
      else if (kind === 'auth') admEmbReportAuth();
    } catch (e) { console.error('admEmbHook', e); }
  };

  var lastStatus = '';
  function admEmbReportStatus() {
    var urgent = document.getElementById('urgentBanner');
    var nt = document.getElementById('newTaskBanner');
    var ab = document.getElementById('annNavBadge');
    var ntShown = !!(nt && nt.classList.contains('show'));
    var annTxt = ab ? (ab.textContent || '').trim() : '';
    var annN = null;
    if (annTxt !== '') annN = (ab.style.display === 'none') ? 0 : (parseInt(annTxt, 10) || 0);
    var msg = {
      type: 'status',
      urgent: !!(urgent && urgent.classList.contains('show')),
      newTaskCount: ntShown ? (parseInt(((nt.textContent || '').match(/\d+/) || ['1'])[0], 10) || 1) : 0,
      newTaskText: ntShown ? (nt.textContent || '').trim() : '',
      annUnread: annN
    };
    var key = JSON.stringify(msg);
    if (key === lastStatus) return;
    lastStatus = key;
    post(msg);
  }

  function admEmbWatch() {
    try {
      var mo = new MutationObserver(admEmbReportStatus);
      ['urgentBanner', 'newTaskBanner', 'annNavBadge'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) mo.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
      });
      // 強制改密碼視窗關掉後，把 mustChangePassword 的新狀態再報一次
      var sm = document.getElementById('settingsModal');
      if (sm) new MutationObserver(admEmbReportAuth).observe(sm, { attributes: true, attributeFilter: ['class'] });
      // 登入失效：舊程式清掉 token 後會把登入畫面顯示出來（admin.js fetchMemos／postTask）→ 通知外框回登入畫面
      var gate = document.getElementById('passwordGate');
      if (gate) new MutationObserver(function () {
        if (gate.style.display === 'flex') post({ type: 'needLogin' });
      }).observe(gate, { attributes: true, attributeFilter: ['style'] });
    } catch (e) { console.error('admEmbWatch', e); }
  }

  // ---------- 2. 開機與收訊息 ----------
  document.addEventListener('DOMContentLoaded', function () {
    admEmbWatch();
    if (localStorage.getItem('admin_unlocked') !== '1') post({ type: 'needLogin' }); // 沒登入過：外框直接回登入畫面
    var want = params.get('view');
    if (want && want !== 'home' && typeof VIEW_ID_MAP !== 'undefined' && VIEW_ID_MAP[want] && typeof switchView === 'function') {
      try { switchView(want, 'left'); } catch (e) { console.error('admEmb switchView', e); }
    }
    admEmbReportView();
    admEmbReportAuth();
    admEmbReportStatus();
    post({ type: 'ready' });
  });

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.src !== SRC || d.v !== VER) return;
    try {
      if (d.type === 'switchView') {
        if (typeof d.view === 'string' && typeof VIEW_ID_MAP !== 'undefined' && VIEW_ID_MAP[d.view] && typeof switchView === 'function') switchView(d.view, 'left');
      } else if (d.type === 'toggleRight') {
        if (wide && typeof toggleRightPaneFromSideNav === 'function') toggleRightPaneFromSideNav();
      } else if (d.type === 'openSettings') {
        if (typeof openSettingsHubModal === 'function') openSettingsHubModal();
      } else if (d.type === 'setWide') {
        admEmbSetWide(d.wide);
      }
    } catch (err) { console.error('admEmb message', err); }
  });
})();
