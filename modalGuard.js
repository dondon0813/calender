// 視窗灰底守門（2026-09-26 雪莉：在輸入框拖曳選字、放開時滑到灰底，整個視窗跳掉、打的字白費；幾乎全站都有）
// 原理：瀏覽器的 click 目標＝按下與放開兩點的共同祖先。按下在輸入框、放開在灰底 → click 落在灰底 →
// 各頁「點灰底關閉」（onclick="if(event.target===this) close…()" 或 addEventListener 同義寫法）誤觸。
// 做法：記住 pointerdown 的目標；click 若落在灰底類元素、但按下點不是它本身（而是它裡面的東西），
// 在 document 的 capture 階段 stopPropagation，行內 onclick 與 addEventListener 都收不到這次 click。
// 真的點在灰底（按下、放開都在灰底）照常關閉。掛在每一頁 </head> 前，載入順序無關。
(function () {
  var down = null;
  var BACKDROP = '[class*="backdrop"],[class*="overlay"],.modal';
  function remember(e) { down = e.target; }
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('mousedown', remember, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!down || down === t || !(t instanceof Element) || !(down instanceof Node)) return;
    if (!t.matches(BACKDROP)) return;
    if (!t.contains(down)) return; // 按下點在灰底裡（輸入框／內框），放開在灰底 → 攔下
    e.stopPropagation();
  }, true);
  document.addEventListener('pointerup', function () { setTimeout(function () { down = null; }, 0); }, true);
})();
