// 後台搬家「段 0」樣品載入器（dondon-platform docs/22 §3.1）。獨立檔，不改 admin.js。
// 網址沒有 ?proto=a 或 ?proto=b 時什麼都不做、不發任何請求（正式後台員工完全不受影響）。
//   ?proto=a：切到行事曆分頁時，把 #viewCalendar 原內容隱藏，改放 iframe（/admin-proto/calendar?embed=1），高度由內頁 postMessage 回報
//   ?proto=b：同樣時機隱藏原內容，改放 Shadow DOM 容器，載入 /admin-embed/calendar-proto.js 後呼叫 DondonAdminProto.mount(容器, shadowRoot)
// 所有名稱 admProto 前綴。
(function () {
  var admProtoMode = (function () {
    try { var m = /[?&]proto=(a|b)(?![\w-])/.exec(location.search); return m ? m[1] : ''; } catch (e) { return ''; }
  })();
  if (!admProtoMode) return;

  var admProtoMounted = false;

  function admProtoHideOriginal(view) {
    Array.prototype.forEach.call(view.children, function (c) {
      if (c.getAttribute('data-adm-proto')) return;
      c.setAttribute('data-adm-proto-hid', c.style.display || '');
      c.style.display = 'none';
    });
  }

  function admProtoMountA(view) {
    var iframe = document.createElement('iframe');
    iframe.setAttribute('data-adm-proto', 'a');
    iframe.src = '/admin-proto/calendar?embed=1';
    iframe.title = '行事曆（樣品 A）';
    iframe.style.cssText = 'width:100%;height:600px;border:0;display:block;background:transparent';
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin) return;
      if (ev.source !== iframe.contentWindow) return;
      var d = ev.data;
      if (!d || d.src !== 'dondon-admin-proto' || d.v !== 1 || d.type !== 'height') return;
      var h = Number(d.h);
      if (h > 0 && h < 20000) iframe.style.height = Math.ceil(h) + 'px';
    });
    view.appendChild(iframe);
  }

  function admProtoMountB(view) {
    // 自訂標籤名：外框的 div／span 等通用選擇器規則比對不到宿主；inline all:initial 切斷外框會往下繼承的樣式（letter-spacing、字級…）
    var host = document.createElement('dondon-admin-embed');
    host.setAttribute('data-adm-proto', 'b');
    host.style.cssText = 'all:initial;display:block';
    var shadow = host.attachShadow({ mode: 'open' });
    var box = document.createElement('div');
    shadow.appendChild(box);
    view.appendChild(host);
    function go() {
      try { window.DondonAdminProto.mount(box, shadow); }
      catch (e) { box.textContent = '樣品載入失敗：' + (e && e.message); }
    }
    if (window.DondonAdminProto) { go(); return; }
    var s = document.createElement('script');
    s.src = '/admin-embed/calendar-proto.js';
    s.onload = go;
    s.onerror = function () { box.textContent = '樣品載入失敗：calendar-proto.js'; };
    document.head.appendChild(s);
  }

  function admProtoTry() {
    var view = document.getElementById('viewCalendar');
    if (!view || admProtoMounted || !view.classList.contains('active')) return;
    admProtoMounted = true;
    admProtoHideOriginal(view);
    if (admProtoMode === 'a') admProtoMountA(view); else admProtoMountB(view);
  }

  function admProtoInit() {
    var view = document.getElementById('viewCalendar');
    if (!view) return;
    new MutationObserver(admProtoTry).observe(view, { attributes: true, attributeFilter: ['class'] });
    admProtoTry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', admProtoInit);
  else admProtoInit();
})();
