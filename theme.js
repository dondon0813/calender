/* ============================================================
   全站色系開關（2026-09-20）
   決定官網前台頁面載入哪一套色系，各頁 <head> 最後一行都是 <script src="theme.js?v=N">。
     'lotus'   ＝ 藕粉奶茶（現行）→ 載入 theme-lotus.css
     'classic' ＝ 原本的粉橘色系  → 載入 theme-classic.css（原色其實就是 shared.css＋各頁自己的變數，
                                     這份只補「改版時動過標記」的地方，例如冷凍團的藍底雪花）
   ▶ 永久換色：改下面 SITE_THEME 一個字，然後把各頁的 theme.js?v= 加 1（Claude 可代勞）。
   ▶ 自己先試看：網址後面加 ?theme=classic 或 ?theme=lotus（只影響這台瀏覽器，會記住）；
                 加 ?theme=default 清掉記憶、回到 SITE_THEME。
   不涵蓋：後台（admin／office／file-inbox）、會員端（/member、/materials、/blog，在 Vercel）。
   ============================================================ */
(function () {
  var SITE_THEME = 'lotus';
  var CSS_VERSION = '5'; // theme-lotus.css／theme-classic.css 任一改動就加 1
  var theme = SITE_THEME;
  var m = /[?&]theme=(lotus|classic|default)(?![\w-])/.exec(location.search);
  if (m && m[1] !== 'default') theme = m[1]; // 就算下面 localStorage 被擋，當次載入也照網址生效
  try {
    if (m) {
      if (m[1] === 'default') localStorage.removeItem('site_theme');
      else localStorage.setItem('site_theme', m[1]);
    } else {
      var saved = localStorage.getItem('site_theme');
      if (saved === 'lotus' || saved === 'classic') theme = saved;
    }
  } catch (e) { /* localStorage 被擋就用預設 */ }
  document.documentElement.setAttribute('data-theme', theme);
  // 同步寫入 <link>：跟原本寫死在 <head> 一樣早載入，不會閃一下舊色
  document.write('<link rel="stylesheet" href="theme-' + theme + '.css?v=' + CSS_VERSION + '">');
})();
