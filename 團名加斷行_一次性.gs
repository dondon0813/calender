// ============================================================
// 一次性：把「品牌＋產品」的團名改寫成「品牌｜產品」
//
// 背景：團名在行事曆格子裡會自動斷行，常常斷在奇怪的位置（這也是以前
// yookidoo/trixie 要拆成兩列的原因）。改用「｜」明講斷在哪之後，
// 前台行事曆、後台行事曆、行事曆圖產生器都會照這個位置斷行；
// 橫排一行的地方（清單列、tooltip、彈窗標題、開團文案）會自動換回空白。
//
// 品牌名本身就含產品的（雪坊優格、韓爸米餅、美姬饅頭、禾流書團…）不改。
// 節日（中秋、國慶…）不改。
//
// 範圍：只改「開團日 2026/8/1 以後」的列；更早的歷史團不動。
// 已經含「｜」的列會自動跳過，重複執行不會出事。
//
// 用法：先跑一次看報告（DRY_RUN = true），確認沒問題再改成 false 跑第二次。
//       用完把這個檔案刪掉。
// ============================================================

var 團名斷行_DRY_RUN = true;   // ← 確認報告沒問題後改成 false

var 團名斷行_SHEET_ID = '18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk';   // 行事曆表
var 團名斷行_起始日 = new Date(2026, 7, 1);   // 2026/8/1（月份是 0-based）

var 團名斷行_COL_START = 2;   // B 欄 開始日期
var 團名斷行_COL_TITLE = 5;   // E 欄 活動名稱

// 舊團名（完全相符，前後空白會自動去掉） → 新團名
var 團名對照表 = [
  ['Lapo風扇',                  'Lapo｜風扇'],
  ['卡蘿琳益生菌',              '卡蘿琳｜益生菌'],
  ['Horay購物包',               'Horay｜購物包'],
  ['Jolly旋轉書櫃',             'Jolly｜旋轉書櫃'],
  ['Bonsons推車 拖把 垃圾桶',   'Bonsons｜推車 拖把 垃圾桶'],
  ['Bruno電烤盤',               'Bruno｜電烤盤'],
  ['台東初鹿保久乳',            '台東初鹿｜保久乳'],
  ['Parakito 防蚊',             'Parakito｜防蚊'],
  ['媽媽友美術用品',            '媽媽友｜美術用品'],
  ['Aspor充電線/腳架',          'Aspor｜充電線/腳架'],
  ['麗克特調理機',              '麗克特｜調理機'],
  ['冊子-中秋禮盒',             '冊子｜中秋禮盒'],
  ['UBMOM水壺',                 'UBMOM｜水壺'],
  ['kidsread點讀筆',            'kidsread｜點讀筆'],
  ['plantoys木玩',              'plantoys｜木玩'],
  ['Learning Resource益智桌遊', 'Learning Resource｜益智桌遊'],
  ['trixie書包',                'trixie｜書包'],
  ['yookidoo戲水玩具',          'yookidoo｜戲水玩具'],
  ['Giiker learning kid',       'Giiker｜learning kid'],
  ['ScienceBaby 磁力片',        'ScienceBaby｜磁力片'],
  ['KiGO 太陽眼鏡',             'KiGO｜太陽眼鏡'],
  ['吉伊卡哇標籤機',            '吉伊卡哇｜B21標籤機'],
  ['QA生活水杯',                'QA｜生活水杯'],
  // 一團兩品：拿掉型號 S900，兩個品項各佔一行
  ['Nadle腳踏車/Jolly電動扭扭車/S900', 'Nadle腳踏車｜Jolly扭扭車']
];

function 團名加斷行_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(團名斷行_DRY_RUN ? '===== 試算模式（不會寫入）=====' : '===== 實際執行 =====');

  var map = {};
  團名對照表.forEach(function (pair) { map[String(pair[0]).trim()] = pair[1]; });

  var sh = SpreadsheetApp.openById(團名斷行_SHEET_ID).getSheets()[0];
  var data = sh.getDataRange().getValues();

  var changed = 0, skippedOld = 0, skippedDone = 0;
  var hit = {};

  for (var i = 1; i < data.length; i++) {
    var title = String(data[i][團名斷行_COL_TITLE - 1] || '').trim();
    if (!title) continue;
    if (title.indexOf('｜') !== -1) { skippedDone++; continue; }   // 已經改過

    var newTitle = map[title];
    if (!newTitle) continue;

    var start = data[i][團名斷行_COL_START - 1];
    if (!(start instanceof Date)) continue;
    if (start < 團名斷行_起始日) { skippedOld++; continue; }        // 8 月以前的歷史團不動

    hit[title] = (hit[title] || 0) + 1;
    changed++;
    say('第 ' + (i + 1) + ' 列（' + Utilities.formatDate(start, 'Asia/Taipei', 'yyyy/MM/dd') + '）：' +
        title + '　→　' + newTitle);
    if (!團名斷行_DRY_RUN) {
      sh.getRange(i + 1, 團名斷行_COL_TITLE).setValue(newTitle);
    }
  }

  // 對照表裡沒對到任何一列的，多半是拼字不同或已經改過，列出來讓人確認
  var missed = Object.keys(map).filter(function (k) { return !hit[k]; });

  say('--------------------------------------------');
  say('改寫 ' + changed + ' 列' + (團名斷行_DRY_RUN ? '（試算，尚未寫入）' : '（已寫入）'));
  say('略過：8 月以前的歷史團 ' + skippedOld + ' 列、已經含「｜」的 ' + skippedDone + ' 列');
  if (missed.length) say('⚠ 對照表裡這些沒對到任何一列，請確認拼字：' + missed.join('、'));

  return log.join('\n');
}
