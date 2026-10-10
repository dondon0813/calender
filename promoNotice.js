// 品牌優惠訂閱＋提醒視窗（2026-10-09，設計正本 dondon-platform/docs/15-event-promos-design.md §5）
// 掛在官網前台 10 個頁面的 </head> 前（modalGuard.js 之後）。做兩件事：
//   1. window.DDPromo：訂閱狀態／橋接 RPC／localStorage 存取的唯一一份（index.html 與 openGroupBuy.js 的選擇視窗都呼叫它）
//   2. 開頁時檢查「我訂閱的品牌有沒有新的本週優惠通知」，有就跳提醒視窗（每則只跳一次）
// 登入狀態在 member.sheridondon.com.tw（不同網域），官網靠隱藏 iframe /fan-bridge 用 postMessage 代問，
// token 不離開會員網域。沒登入的人：訂閱清單與看過清單存這個瀏覽器的 localStorage，登入後自動合併進帳號。
// localStorage 鍵：dd_promo_subs=[{id,name,at}]、dd_promo_seen=[{id,at}]（60 天以上清掉）；
// sessionStorage 鍵：dd_promo_checked（這個分頁 session 查過提醒就不再查）。
(function () {
  'use strict';
  if (window.DDPromo) return;

  var API_URL = 'https://dondon-platform.vercel.app/api/legacy';
  var MEMBER_ORIGIN = 'https://member.sheridondon.com.tw';
  var MEMBER_LOGIN_URL = MEMBER_ORIGIN + '/member';
  var LS_SUBS = 'dd_promo_subs';
  var LS_SEEN = 'dd_promo_seen';
  var SS_CHECKED = 'dd_promo_checked';
  var SEEN_TTL_MS = 60 * 24 * 3600 * 1000;
  var BRIDGE_TIMEOUT_MS = 8000;

  // ---------- 儲存（storage 被擋時退回記憶體，當頁內仍可運作）----------
  var mem = {};
  function lsGet(key) {
    try { var v = localStorage.getItem(key); if (v !== null) return v; } catch (e) { /* 被擋 */ }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }
  function lsSet(key, val) {
    mem[key] = val;
    try { localStorage.setItem(key, val); } catch (e) { /* 被擋就只存記憶體 */ }
  }
  function lsDel(key) {
    delete mem[key];
    try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ }
  }
  function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return mem['ss_' + key] || null; } }
  function ssSet(key, val) { mem['ss_' + key] = val; try { sessionStorage.setItem(key, val); } catch (e) { /* 忽略 */ } }
  function readArr(key) {
    try { var a = JSON.parse(lsGet(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function localSubs() {
    return readArr(LS_SUBS).filter(function (s) { return s && typeof s.id === 'string' && s.id; });
  }
  function localSeen() {
    var cut = Date.now() - SEEN_TTL_MS;
    var all = readArr(LS_SEEN).filter(function (s) { return s && typeof s.id === 'string' && s.id; });
    var kept = all.filter(function (s) { return typeof s.at === 'number' ? s.at >= cut : true; });
    if (kept.length !== all.length) lsSet(LS_SEEN, JSON.stringify(kept)); // 順手清掉 60 天以上的
    return kept;
  }
  function todayTaipei() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }

  // ---------- 橋接 RPC ----------
  var bridgeWin = null;
  var bridgeLoaded = false; // 自建的橋要等 iframe 載入完成才送訊息（太早送會被瀏覽器警告、而且收不到）
  var rpcSeq = 0;
  var pending = {};

  function getBridgeWin() {
    if (bridgeWin) return bridgeWin;
    if (window.__ddFanBridgeWin) { bridgeWin = window.__ddFanBridgeWin; bridgeLoaded = true; return bridgeWin; } // 與頁面已有的橋（recipes.html 收藏橋）共用
    var ifr = document.createElement('iframe');
    ifr.src = MEMBER_ORIGIN + '/fan-bridge';
    ifr.title = '會員優惠通知連線';
    ifr.setAttribute('aria-hidden', 'true');
    ifr.tabIndex = -1;
    ifr.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    ifr.addEventListener('load', function () { bridgeLoaded = true; });
    (document.body || document.documentElement).appendChild(ifr);
    bridgeWin = ifr.contentWindow;
    window.__ddFanBridgeWin = bridgeWin;
    return bridgeWin;
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== MEMBER_ORIGIN || !e.data || !bridgeWin || e.source !== bridgeWin) return;
    if (e.data.src === 'dd-fav-reply' && Object.prototype.hasOwnProperty.call(pending, e.data.id)) {
      var p = pending[e.data.id];
      delete pending[e.data.id];
      p(e.data);
    } else if (e.data.src === 'dd-fav-ready') {
      // 橋剛準備好：立刻把還沒收到回覆的請求送一次（之前的送出可能發生在橋載入完成前而遺失）
      Object.keys(pending).forEach(function (id) { if (pending[id].send) pending[id].send(); });
    }
  });

  // 橋可能還沒載入完成（訊息會遺失），所以每秒重送直到收到回覆；重送的操作（查狀態／訂閱／看過／合併）都是冪等的
  function realRpc(msg, timeoutMs) {
    return new Promise(function (resolve) {
      var id = 'pn' + (++rpcSeq);
      var win = getBridgeWin();
      var timer = null;
      var retry = null;
      function finish(data) {
        clearTimeout(timer);
        clearInterval(retry);
        resolve(data);
      }
      var done = function (data) { finish(data); };
      done.send = function () {
        if (!bridgeLoaded) return;
        try { win.postMessage(Object.assign({ src: 'dd-fav', id: id }, msg), MEMBER_ORIGIN); } catch (err) { /* 等逾時 */ }
      };
      pending[id] = done;
      timer = setTimeout(function () { delete pending[id]; finish({ success: false, timeout: true }); }, timeoutMs || BRIDGE_TIMEOUT_MS);
      retry = setInterval(done.send, 1000);
      done.send();
    });
  }

  // ---------- 狀態 ----------
  var state = { loaded: false, loggedIn: false, bridgeOk: false, brandIds: [], notices: [] };
  var loading = null;
  var readyCbs = [];

  function applyState(res) {
    var ok = !!res && !res.timeout && typeof res.loggedIn === 'boolean';
    state.bridgeOk = ok;
    state.loggedIn = ok && res.loggedIn;
    state.brandIds = ok && Array.isArray(res.brandIds) ? res.brandIds.filter(function (x) { return typeof x === 'string'; }) : [];
    state.notices = ok && Array.isArray(res.notices) ? res.notices : [];
  }

  // 登入且本機有訂閱／看過紀錄 → 合併進帳號（冪等），成功才清掉本機兩個鍵，再重讀一次狀態
  function mergeLocalIfNeeded() {
    if (!state.loggedIn) return Promise.resolve();
    var subs = localSubs();
    var seen = localSeen();
    if (!subs.length && !seen.length) return Promise.resolve();
    return DDPromo._rpc({ op: 'promo-merge', brandIds: subs.map(function (s) { return s.id; }), noticeIds: seen.map(function (s) { return s.id; }) }, 10000)
      .then(function (res) {
        if (!res || !res.success) return;
        lsDel(LS_SUBS);
        lsDel(LS_SEEN);
        return DDPromo._rpc({ op: 'promo-state' }, BRIDGE_TIMEOUT_MS).then(applyState);
      });
  }

  function loadState(force) {
    if (loading && !force) return loading;
    loading = DDPromo._rpc({ op: 'promo-state' }, BRIDGE_TIMEOUT_MS)
      .then(function (res) { applyState(res); return mergeLocalIfNeeded(); })
      .catch(function () { applyState(null); })
      .then(function () {
        state.loaded = true;
        var cbs = readyCbs.splice(0, readyCbs.length);
        cbs.forEach(function (cb) { try { cb(); } catch (err) { /* 單一回呼出錯不影響其他 */ } });
      });
    return loading;
  }

  // ---------- 對外介面 ----------
  var DDPromo = {
    MEMBER_LOGIN_URL: MEMBER_LOGIN_URL,
    // 「登入會員」連結怎麼開（10-11，雪莉在會員 App 裡點了跳出帶網址列的新視窗、登入後又跳到行事曆）：
    //   被會員 App 首頁分頁內嵌（iframe）→ 整個 App 換到會員中心（_top、不帶 back，登入完就留在 App 裡）
    //   官網被加到主畫面當 App 開 → 同一個視窗開、登入後跳回這頁
    //   一般瀏覽器 → 照舊開新分頁、登入後跳回這頁
    setLoginLink: function (a) {
      if (!a) return;
      var embedded = false;
      try { embedded = window.self !== window.top; } catch (e) { embedded = true; }
      var standalone = false;
      try { standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { /* 忽略 */ }
      var back = MEMBER_LOGIN_URL + '?back=' + encodeURIComponent(location.href.split('#')[0]);
      if (embedded) { a.href = MEMBER_LOGIN_URL; a.target = '_top'; a.removeAttribute('rel'); }
      else if (standalone) { a.href = back; a.target = '_self'; a.removeAttribute('rel'); }
      else { a.href = back; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    },
    _rpc: realRpc, // 測試時可替換
    loggedIn: function () { return state.loggedIn; },
    isSubscribed: function (brandId) {
      if (!brandId) return false;
      if (state.loggedIn) return state.brandIds.indexOf(brandId) >= 0;
      return localSubs().some(function (s) { return s.id === brandId; });
    },
    // cb 在登入／訂閱狀態查到之後呼叫（已查到就立刻呼叫）；第一次呼叫才會去問橋
    onReady: function (cb) {
      if (typeof cb !== 'function') return;
      if (state.loaded) { try { cb(); } catch (err) { /* 忽略 */ } return; }
      readyCbs.push(cb);
      loadState();
    },
    // want 省略＝切換。回傳 Promise {subscribed, loggedIn}
    subscribe: function (brandId, name, want) {
      return loadState().then(function () {
        var target = typeof want === 'boolean' ? want : !DDPromo.isSubscribed(brandId);
        function viaLocal() {
          var subs = localSubs().filter(function (s) { return s.id !== brandId; });
          if (target) subs.push({ id: brandId, name: String(name || ''), at: Date.now() });
          lsSet(LS_SUBS, JSON.stringify(subs));
          return { subscribed: target, loggedIn: false };
        }
        if (!state.loggedIn) return viaLocal();
        return DDPromo._rpc({ op: 'promo-subscribe', brandId: brandId, want: target }, 10000).then(function (res) {
          if (res && res.needLogin) { state.loggedIn = false; return viaLocal(); } // 登入過期：先存本機，不擋
          if (res && res.success) {
            var has = state.brandIds.indexOf(brandId) >= 0;
            if (res.subscribed && !has) state.brandIds.push(brandId);
            if (!res.subscribed && has) state.brandIds = state.brandIds.filter(function (x) { return x !== brandId; });
            return { subscribed: !!res.subscribed, loggedIn: true };
          }
          return { subscribed: DDPromo.isSubscribed(brandId), loggedIn: true, error: true };
        });
      });
    },
    init: function (force) { return check(force); }
  };
  window.DDPromo = DDPromo;

  // ---------- 提醒視窗 ----------
  function validUrl(s) { return typeof s === 'string' && /^https?:\/\//i.test(s.trim()); }
  function sendBuyNoticeStat(evKey) {
    if (!evKey || typeof evKey !== 'string') return;
    var payload = JSON.stringify({ type: 'stat-click', key: evKey + '_buy_notice' });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API_URL, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
      else fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: payload, keepalive: true }).catch(function () {});
    } catch (e) { /* 統計失敗不影響瀏覽 */ }
  }

  function injectStyle() {
    if (document.getElementById('ddpnStyle')) return;
    var st = document.createElement('style');
    st.id = 'ddpnStyle';
    st.textContent =
      '.ddpn-box{text-align:center;max-height:86vh;overflow-y:auto;}' +
      '.ddpn-title{font-family:var(--font-round);font-weight:800;font-size:17px;color:var(--c-text);margin:4px 0 12px;padding-right:10px;}' +
      '.ddpn-item{padding:12px 0;}' +
      '.ddpn-item + .ddpn-item{border-top:1px dashed var(--c-line);}' +
      '.ddpn-brand{font-size:12px;font-weight:800;color:var(--c-text-soft);letter-spacing:1px;}' +
      '.ddpn-team{font-size:12px;color:var(--c-text-soft);margin-top:2px;}' +
      '.ddpn-label{display:inline-block;font-size:12px;font-weight:800;color:var(--c-text-invert);background:var(--c-primary);border-radius:var(--r-pill);padding:2px 10px;margin:6px 0 4px;}' +
      '.ddpn-body{font-size:14px;line-height:1.7;color:var(--c-text);white-space:pre-line;word-break:break-word;margin:2px 0 10px;}' +
      '.ddpn-go{display:block;text-align:center;text-decoration:none;font-family:var(--font-round);font-weight:800;font-size:14px;border-radius:var(--r-pill);padding:11px 14px;color:var(--c-text-invert);background:var(--c-primary);cursor:pointer;border:none;}' +
      '.ddpn-go:hover{background:var(--c-primary-dark);}' +
      '.ddpn-ok{display:block;width:100%;margin-top:6px;font-family:var(--font-round);font-weight:800;font-size:14px;border-radius:var(--r-pill);padding:11px 14px;color:var(--c-text-soft);background:var(--c-bg-bottom);cursor:pointer;border:none;}';
    document.head.appendChild(st);
  }

  var popupOpen = false;
  function showPopup(list) {
    if (popupOpen || !list.length || !document.body) return;
    popupOpen = true;
    injectStyle();

    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop ddpn-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    var box = document.createElement('div');
    box.className = 'modal-box ddpn-box';
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'modal-close';
    x.setAttribute('aria-label', '關閉');
    x.textContent = '✕';
    box.appendChild(x);

    list.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'ddpn-item';
      var brand = document.createElement('div');
      brand.className = 'ddpn-brand';
      brand.textContent = String(n.brandName || '');
      item.appendChild(brand);
      // 團名小字：同品牌同時有兩團時客人才分得出是哪一團（驗收建議）
      var tt = String(n.title || '').replace(/｜/g, ' ').trim();
      if (tt && tt !== String(n.brandName || '')) {
        var ttl = document.createElement('div');
        ttl.className = 'ddpn-team';
        ttl.textContent = tt;
        item.appendChild(ttl);
      }
      var label = document.createElement('div');
      label.className = 'ddpn-label';
      label.textContent = '本週優惠';
      item.appendChild(label);
      var body = document.createElement('div');
      body.className = 'ddpn-body';
      body.textContent = String(n.body || '');
      item.appendChild(body);
      if (validUrl(n.url)) {
        var go = document.createElement('a');
        go.className = 'ddpn-go';
        go.href = n.url;
        go.target = '_blank';
        go.rel = 'noopener noreferrer';
        go.textContent = '前往下單';
        go.addEventListener('click', function () { sendBuyNoticeStat(n.evKey); });
        item.appendChild(go);
      }
      box.appendChild(item);
    });

    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'ddpn-ok';
    ok.textContent = '知道了';
    box.appendChild(ok);
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    backdrop.classList.add('show');

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      backdrop.classList.remove('show');
      setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); popupOpen = false; }, 0);
      markSeen(list.map(function (n) { return n.id; }));
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    x.addEventListener('click', close);
    ok.addEventListener('click', close);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
  }

  function markSeen(ids) {
    ids = ids.filter(function (x) { return typeof x === 'string' && x; });
    if (!ids.length) return;
    if (state.loggedIn) {
      DDPromo._rpc({ op: 'promo-seen', ids: ids }, 10000).then(function (res) {
        if (res && res.success) return;
        // 帳號端沒寫成功（登入過期等）：先記在本機，之後登入合併
        writeLocalSeen(ids);
      });
    } else {
      writeLocalSeen(ids);
    }
  }
  function writeLocalSeen(ids) {
    var seen = localSeen();
    var have = {};
    seen.forEach(function (s) { have[s.id] = 1; });
    ids.forEach(function (id) { if (!have[id]) seen.push({ id: id, at: Date.now() }); });
    lsSet(LS_SEEN, JSON.stringify(seen));
  }

  // ---------- 開頁檢查 ----------
  function normalizeNotices(arr) {
    var today = todayTaipei();
    return (Array.isArray(arr) ? arr : []).filter(function (n) {
      return n && typeof n.id === 'string' && n.id && typeof n.body === 'string' && n.body.trim() &&
        !(typeof n.expiresAt === 'string' && n.expiresAt && n.expiresAt < today);
    });
  }

  function fetchPublicNotices() {
    return fetch(API_URL + '?scope=promonotices', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { notices: [] }; })
      .then(function (j) { return normalizeNotices(j && j.notices); });
  }

  function check(force) {
    if (!force && ssGet(SS_CHECKED)) return Promise.resolve();
    return loadState(force).then(function () {
      if (state.loggedIn) return normalizeNotices(state.notices);
      var subIds = {};
      localSubs().forEach(function (s) { subIds[s.id] = 1; });
      if (!Object.keys(subIds).length) return []; // 沒訂閱任何品牌就不必打 API
      var seenIds = {};
      localSeen().forEach(function (s) { seenIds[s.id] = 1; });
      return fetchPublicNotices().then(function (all) {
        return all.filter(function (n) {
          if (seenIds[n.id]) return false;
          return Array.isArray(n.brandIds) && n.brandIds.some(function (b) { return subIds[b]; });
        });
      });
    }).then(function (list) {
      ssSet(SS_CHECKED, '1');
      if (list && list.length) showPopup(list);
    }).catch(function () { ssSet(SS_CHECKED, '1'); });
  }

  function start() { setTimeout(function () { check(false); }, 600); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
