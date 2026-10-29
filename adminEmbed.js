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
//  6. 段 1c：新行事曆的抽獎區（新增抽獎／編輯／這團不抽／還原）請舊頁打開對應的抽獎視窗（lotAction，白名單四個動作），做完回報 lotDone。
//     （段 1a／1b 的 calEdit／calAction／editEvent 交接動作在段 1c 已原生化，v=5 移除。）
//  7. 第 2 波（v=6）：paneLayout 多回報右欄內容區位置（right）與左欄右內距（padRight），讓新元件（行事曆、品牌廠商）也能疊在右欄上；
//     新增 refreshData（新品牌廠商頁存檔後叫舊頁重抓資料）。
//  8. 第 4 波第 3 段（v=7）：帳務。oldTab＝新版帳務把公司支出／文件簽署子分頁交給舊版顯示（白名單 view=accounting、tab 限舊帳務子分頁代號，呼叫舊 acctSwitchTab）；
//     舊 acctSwitchTab 被呼叫就回報 oldTabChanged（外框據此決定交接中或回新版）；lotJump＝帳務明細抽獎小標點擊，呼叫舊 lotJumpToAcctTeamCard（切到抽獎管理並捲到該團）。
//  9. 第 5 波第 1 段（v=8）：抽獎管理。oldTab 白名單加 view=lottery（tab 限 draws／activities／announce／ship，呼叫舊 lotSwitchMainTab）；
//     舊 lotSwitchMainTab 被呼叫（含使用者在舊版點頂端子分頁、或點「待公告」磚）就回報 oldTabChanged（view=lottery）。新版只做「抽獎」子分頁，其餘三格交給這一頁。
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

  var lastLayout = '';
  function admEmbReportLayout() {
    var pl = document.getElementById('paneLeft');
    var sw = document.getElementById('splitWorkspace');
    if (!pl) return;
    var r = pl.getBoundingClientRect();
    var msg = {
      type: 'paneLayout',
      left: Math.round(r.left * 100) / 100,
      width: Math.round(r.width * 100) / 100,
      rightOpen: !!(sw && !sw.classList.contains('right-closed')),
      // 左欄右側的內距（桌機雙欄版型 14px）：新元件疊在左欄上時要留同樣的右內距，內容寬度才跟舊版一樣
      padRight: Math.round(parseFloat(window.getComputedStyle(pl).paddingRight) || 0)
    };
    // 第 2 波：右欄也可能放新元件 → 多報右欄「內容區」（右欄下拉選單以下）的位置：left 從左內距之後算起、寬度一路到右緣（含捲軸）
    var pr = document.getElementById('paneRight');
    var pk = document.getElementById('paneRightPicker');
    if (msg.rightOpen && pr) {
      var rr = pr.getBoundingClientRect();
      var cs = window.getComputedStyle(pr);
      var contentLeft = rr.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
      var top = rr.top;
      if (pk) {
        var kr = pk.getBoundingClientRect();
        top = kr.bottom + (parseFloat(window.getComputedStyle(pk).marginBottom) || 0);
      }
      msg.right = { left: Math.round(contentLeft * 100) / 100, top: Math.round(top * 100) / 100, width: Math.round((rr.right - contentLeft) * 100) / 100 };
    }
    var key = JSON.stringify(msg);
    if (key === lastLayout) return;
    lastLayout = key;
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
      // 段 1a：新行事曆疊在左欄上，需要知道左欄位置／大小（paneLayout）
      var pl = document.getElementById('paneLeft');
      var sw = document.getElementById('splitWorkspace');
      if (pl && typeof ResizeObserver === 'function') new ResizeObserver(admEmbReportLayout).observe(pl);
      // 第 2 波：右欄放新元件，右欄內容區的位置也要回報（右欄大小變、被捲動而下拉選單移位時都重報）
      var prr = document.getElementById('paneRight');
      if (prr) {
        if (typeof ResizeObserver === 'function') new ResizeObserver(admEmbReportLayout).observe(prr);
        prr.addEventListener('scroll', admEmbReportLayout, { passive: true });
      }
      if (sw) new MutationObserver(admEmbReportLayout).observe(sw, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', admEmbReportLayout);
      admEmbReportLayout();
      // 登入失效：舊程式清掉 token 後會把登入畫面顯示出來（admin.js fetchMemos／postTask）→ 通知外框回登入畫面
      var gate = document.getElementById('passwordGate');
      if (gate) new MutationObserver(function () {
        if (gate.style.display === 'flex') post({ type: 'needLogin' });
      }).observe(gate, { attributes: true, attributeFilter: ['style'] });
    } catch (e) { console.error('admEmbWatch', e); }
  }

  // ---------- 2. 開機與收訊息 ----------
  // 8. 帳務子分頁切換回報：包住舊 acctSwitchTab（accounting.js 的全域函式；內部呼叫也走全域名稱，所以包了一律回報）
  function admEmbWrapAcctTab() {
    if (typeof window.acctSwitchTab !== 'function' || window.acctSwitchTab.__admEmb) return;
    var orig = window.acctSwitchTab;
    var wrapped = function (tab) {
      var r = orig.apply(this, arguments);
      post({ type: 'oldTabChanged', view: 'accounting', tab: String(tab) });
      return r;
    };
    wrapped.__admEmb = true;
    window.acctSwitchTab = wrapped;
  }
  var ACCT_TABS = ['list', 'trend', 'rank', 'print', 'recon', 'expenses', 'signdocs'];
  // 9. 抽獎管理子分頁切換回報：包住舊 lotSwitchMainTab（lottery.js 的全域函式；內部呼叫也走全域名稱，所以包了一律回報）
  var LOT_TABS = ['draws', 'activities', 'announce', 'ship'];
  function admEmbWrapLotTab() {
    if (typeof window.lotSwitchMainTab !== 'function' || window.lotSwitchMainTab.__admEmb) return;
    var orig = window.lotSwitchMainTab;
    var wrapped = function (tab) {
      var r = orig.apply(this, arguments);
      post({ type: 'oldTabChanged', view: 'lottery', tab: LOT_TABS.indexOf(String(tab)) !== -1 ? String(tab) : 'draws' });
      return r;
    };
    wrapped.__admEmb = true;
    window.lotSwitchMainTab = wrapped;
  }

  document.addEventListener('DOMContentLoaded', function () {
    admEmbWrapAcctTab();
    admEmbWrapLotTab();
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
      } else if (d.type === 'lotAction') {
        admEmbLotAction(d);
      } else if (d.type === 'oldTab') {
        if (d.view === 'accounting' && ACCT_TABS.indexOf(d.tab) !== -1 && typeof window.acctSwitchTab === 'function') window.acctSwitchTab(d.tab);
        else if (d.view === 'lottery' && LOT_TABS.indexOf(d.tab) !== -1 && typeof window.lotSwitchMainTab === 'function') window.lotSwitchMainTab(d.tab);
      } else if (d.type === 'lotJump') {
        if (typeof d.legacyId === 'string' && d.legacyId && typeof lotJumpToAcctTeamCard === 'function') lotJumpToAcctTeamCard(d.legacyId);
      } else if (d.type === 'refreshData') {
        // 第 2 波：新品牌廠商頁改了資料，舊頁其他分頁讀的品牌／廠商資料要重抓（同舊 brandVendor.js 存檔後的 fetchMemos）
        if (typeof fetchMemos === 'function') Promise.resolve(fetchMemos()).catch(function () { /* 靜默 */ });
      }
    } catch (err) { console.error('admEmb message', err); }
  });

  // ---------- 6. 段 1c：新行事曆檢視／編輯視窗抽獎區的動作，改在舊版打開對應的抽獎視窗 ----------
  // 白名單四個動作：add＝新增這團的抽獎、edit＝編輯某一場（drawId）、nlSet＝這團不抽、nlClear＝還原。
  // 做法：不直接依賴 currentModalEv／eventEditCtx 這類全域，而是用舊版「行事曆視窗的抽獎區塊」同一份程式（lotRenderEventLotteryBox）
  // 在一個不顯示的暫時容器裡畫出該團的抽獎區塊，再點它裡面對應的按鈕——按鈕的處理函式（開抽獎視窗、預填團／帳務／品牌、這團不抽）就是舊版原本那支，一個字都沒複製。
  // 做完回報 lotDone：視窗關閉（存檔後 closeLotteryDrawModal）、「這團不抽」資料重載完成、或使用者取消確認。
  function admEmbLotDone() { post({ type: 'lotDone' }); }
  function admEmbLotAction(d) {
    var act = d.action;
    if (act !== 'add' && act !== 'edit' && act !== 'nlSet' && act !== 'nlClear') { admEmbLotDone(); return; }
    if (typeof lotRenderEventLotteryBox !== 'function') { alert('舊版抽獎功能載入失敗，請重新整理後再試。'); admEmbLotDone(); return; }
    var box = document.createElement('div');
    // 先重抓一次抽獎資料：iframe 內舊頁的抽獎資料只在第一次用到時載入，期間別人（或新版）新增的抽獎／團購選項不會自己進來
    Promise.resolve(typeof loadLotteryView === 'function' ? loadLotteryView(true) : null).catch(function () { /* 失敗就用舊資料 */ }).then(function () {
      return lotRenderEventLotteryBox(box, String(d.eventId), {});
    }).then(function () {
      var role = act === 'add' ? 'ev-add-draw' : act === 'edit' ? 'ev-edit-draw' : 'ev-nl-set';
      var no = act === 'nlSet' ? '1' : act === 'nlClear' ? '0' : null;
      var btns = [].slice.call(box.querySelectorAll('[data-role]')).filter(function (b) {
        if (b.dataset.role !== role) return false;
        if (no !== null && b.dataset.no !== no) return false;
        if (act === 'edit' && String(b.dataset.drawId) !== String(d.drawId)) return false;
        return true;
      });
      if (!btns.length && act === 'nlClear' && typeof LOTTERY_EVENT_CHOICES !== 'undefined' && typeof lotSetEventNoLottery === 'function') {
        // 「還原」按鈕只出現在舊版「已標不抽」清單（只含已發布的團）；未發布的團舊版畫不出按鈕，但新版看得到標記 → 直接用舊版同一支函式還原（等同按鈕的動作）
        var choice = LOTTERY_EVENT_CHOICES.filter(function (c) { return String(c.legacyId) === String(d.eventId); })[0];
        if (choice && choice.eventId && typeof LOT_DATA_CHANGED_CBS !== 'undefined') {
          var once2 = function () {
            var k = LOT_DATA_CHANGED_CBS.indexOf(once2);
            if (k >= 0) LOT_DATA_CHANGED_CBS.splice(k, 1);
            admEmbLotDone();
          };
          LOT_DATA_CHANGED_CBS.push(once2);
          lotSetEventNoLottery(choice.eventId, false);
          if (typeof LOT_EVBOX_REG !== 'undefined') LOT_EVBOX_REG.delete(box);
          return;
        }
      }
      if (!btns.length) {
        alert('舊版找不到對應的抽獎動作（資料可能剛被改過），請回到新版行事曆重新整理後再試一次。');
        if (typeof LOT_EVBOX_REG !== 'undefined') LOT_EVBOX_REG.delete(box);
        admEmbLotDone();
        return;
      }
      if (act === 'nlSet' || act === 'nlClear') {
        // 沒有視窗：舊版是 confirm（只有「設為不抽」會問）→ 打 API → loadLotteryView(true)。取消確認就直接回；否則等資料重載完成（LOT_DATA_CHANGED_CBS）再回
        var asked = false;
        var answered = true;
        var realConfirm = window.confirm;
        window.confirm = function (msg) { asked = true; answered = realConfirm.call(window, msg); return answered; };
        var armed = false;
        if (typeof LOT_DATA_CHANGED_CBS !== 'undefined') {
          var once = function () {
            var i = LOT_DATA_CHANGED_CBS.indexOf(once);
            if (i >= 0) LOT_DATA_CHANGED_CBS.splice(i, 1);
            admEmbLotDone();
          };
          LOT_DATA_CHANGED_CBS.push(once);
          armed = true;
        }
        try { btns[0].click(); } finally { window.confirm = realConfirm; }
        if (typeof LOT_EVBOX_REG !== 'undefined') LOT_EVBOX_REG.delete(box);
        if (asked && !answered) {
          if (armed) { var j = LOT_DATA_CHANGED_CBS.indexOf(once); if (j >= 0) LOT_DATA_CHANGED_CBS.splice(j, 1); }
          admEmbLotDone();
        }
        return;
      }
      // add / edit：舊版開 #lotteryDrawModal；等它關掉（class show 被移除）就回報
      var modal = document.getElementById('lotteryDrawModal');
      btns[0].click();
      if (typeof LOT_EVBOX_REG !== 'undefined') LOT_EVBOX_REG.delete(box);
      if (!modal || !modal.classList.contains('show')) { admEmbLotDone(); return; }
      var mo = new MutationObserver(function () {
        if (!modal.classList.contains('show')) { mo.disconnect(); admEmbLotDone(); }
      });
      mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
    }).catch(function (err) { console.error('admEmb lotAction', err); admEmbLotDone(); });
  }
})();
