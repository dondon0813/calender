// 全站共用線條 SVG 圖示庫（2026-09-27）：取代各頁各自定義一份 icon dict 的做法
// （之前 changelog.js 的 CL_ICONS、lottery.js 的 lotIcon、picture-books.html 的 PB_LINE_ICONS、
//  index.html 的 GS_LINE_ICONS 等都各畫各的，同一個「垃圾桶」「行事曆」「禮物」在不同檔案長得不一樣）。
// 用法：<script src="lineIcons.js?v=1"></script>（放在 shared.css 之後、頁面自己的 js 之前）
//   LineIcons.html('trash')                     → 回傳一段 <svg>...</svg> 字串，可直接 innerHTML
//   LineIcons.html('trash', {size:18, className:'btn-ico'})
//   LineIcons.node('trash', {size:18})           → 回傳 DOM node，可直接 appendChild
// 只用固定圖示（無使用者資料），可以放心 innerHTML；使用者文字一律走 textNode，不要塞進這裡。
// 新增圖示：在 ICONS 裡加一組 key（值＝<svg> 內層 path/rect/circle 片段，不含外層 <svg> 標籤本身）。
// 既有頁面（changelog.js／lottery.js／picture-books.html 等）目前仍各自持有自己的 icon 定義，
// 沒有被這份retrofit——之後要動那些頁面時，優先改用這裡的版本，不要再各自新增一份。

(function (global) {
  var ICONS = {
    // ── 通用操作 ──
    close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    plusSquare: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 9v6"/><path d="M9 12h6"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 14h8v7H8z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
    undo: '<path d="M3 10h11a5 5 0 0 1 0 10h-3"/><path d="M7 6l-4 4 4 4"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M12 4v12"/><path d="M7 12l5 5 5-5"/><path d="M5 20h14"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l2.3-2.3a5 5 0 0 0-7-7L11 6"/><path d="M14 10a5 5 0 0 0-7 0L4.7 12.3a5 5 0 0 0 7 7L13 18"/>',
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    eye: '<path d="M2 12s3.6-6.2 10-6.2 10 6.2 10 6.2-3.6 6.2-10 6.2S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    warning: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v5"/><path d="M12 17.2v.1"/>',
    lightbulb: '<path d="M9 16.5h6M9.5 19.5h5"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3.5z"/>',
    chevronRight: '<polyline points="9 5 16 12 9 19"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronUp: '<path d="M6 15l6-6 6 6"/>',
    moreDots: '<circle cx="6" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="2" fill="currentColor" stroke="none"/>',

    // ── 內容分類 ──
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 3.5h6"/>',
    hourglass: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 3 7 5 8-2 1-5 3-5 8M17 3c0 5-3 7-5 8 2 1 5 3 5 8"/>',
    book: '<path d="M6 3.5h9l3 3v14H6z"/><path d="M15 3.5v3h3"/><path d="M8.5 12h7M8.5 15h7"/>',
    bookOpen: '<path d="M12 6.5c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5.5c-3-1-6-.5-8 1z"/><path d="M12 6.5v13"/>',
    note: '<path d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9z"/><path d="M13.5 3.5V9H19"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
    sheet: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    receipt: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/>',
    game: '<rect x="3" y="9" width="18" height="9" rx="4"/><path d="M8 12v3M6.5 13.5h3"/><circle cx="16" cy="12.2" r=".9" fill="currentColor" stroke="none"/><circle cx="18" cy="14.2" r=".9" fill="currentColor" stroke="none"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.8"/><circle cx="17.5" cy="16" r="2.8"/>',
    recipe: '<path d="M4 11a8 8 0 0 1 16 0z"/><path d="M3 11h18"/><path d="M8 21h8"/><path d="M9 21c0-2 1-3 1-5M15 21c0-2-1-3-1-5"/>',
    headphones: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>',
    joystick: '<rect x="9" y="13" width="6" height="6" rx="1"/><path d="M12 13V6"/><circle cx="12" cy="5" r="2"/>',

    // ── 狀態／情境 ──
    fire: '<path d="M12 21c-3.6 0-6.2-2.4-6.2-5.8 0-2.4 1.5-3.8 2.1-5.9.4.9 1.1 1.6 2 1.6-.4-2.5.9-4.9 2.8-6-.5 1.8.1 3.5 1.4 4.6 1.6 1.3 3.1 2.8 3.1 5.6 0 3.4-2.5 5.9-5.9 5.9z"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    heart: '<path d="M12 20s-7-4.4-9.3-8.8C1 8.2 2.2 4.9 5.5 4.3c2-.3 3.7.7 4.7 2.1C11.2 4.9 12.9 3.9 15 4.3c3.3.6 4.5 3.9 2.8 6.9C15.5 15.6 12 20 12 20z"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M4 9h16M12 9v11"/><path d="M12 9c-1.1-3-3-4-4.5-3S6 8 8 9M12 9c1.1-3 3-4 4.5-3S18 8 16 9"/>',
    gem: '<path d="M12 3 3 9l9 12 9-12z"/><path d="M3 9h18M8.5 9 12 21l3.5-12"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.4-4.3 4.8-6 8-6s6.6 1.7 8 6"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    truck: '<rect x="2" y="8" width="12" height="8" rx="1"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
    chat: '<path d="M4 5h16v11H8l-4 4z"/>',
    cart: '<path d="M3 4h2l2.4 12.5a2 2 0 0 0 2 1.5h8.2a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
    camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7 10 4h4l1.5 3"/><circle cx="12" cy="13.5" r="3.5"/>',
    share: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.1 10.8 15.9 7M8.1 13.2l7.8 3.8"/>',
    iosShare: '<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/>',
    fullscreen: '<path d="M4 9V6a2 2 0 0 1 2-2h3"/><path d="M20 9V6a2 2 0 0 0-2-2h-3"/><path d="M4 15v3a2 2 0 0 0 2 2h3"/><path d="M20 15v3a2 2 0 0 1-2 2h-3"/>',
  };

  /** 回傳一段 <svg>...</svg> 字串（固定圖示無使用者資料，可直接 innerHTML）。
   *  opts: {size=15, strokeWidth=1.8, className, fill='none'} */
  function html(name, opts) {
    opts = opts || {};
    var px = opts.size || 15;
    var sw = opts.strokeWidth || 1.8;
    var cls = opts.className ? ' class="' + opts.className + '"' : '';
    var inner = ICONS[name];
    if (!inner) return '';
    return '<svg' + cls + ' width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  /** 回傳 DOM node（可直接 appendChild），用法同 html()；圖示名稱打錯也回傳空 span，不回傳 null */
  function node(name, opts) {
    var span = document.createElement('span');
    span.innerHTML = html(name, opts) || '<span></span>';
    return span.firstChild;
  }

  global.LineIcons = { ICONS: ICONS, html: html, node: node };
})(typeof window !== 'undefined' ? window : this);
