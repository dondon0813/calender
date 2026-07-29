// ============================================================
// 一次性（第二階段）：把剩下 87 筆對不到廠商的帳務補完
//
// 做三件事：
//   1. 把 9 種錯字／填成品牌名的開票公司，併回既有廠商
//      （雪紡優格→雪坊優格、朵玫黎→朶玫黎、台東初鹿→樂奎…）
//      同時把這些寫法加進該廠商的「公司名稱」欄，以後查得到
//   2. 新建 48 家廠商（V049~V096），其中 32 家標「封存」
//      —— 封存＝資料留著但清單平常不顯示，給只合作過一次的用
//   3. 依開票公司回填帳務的廠商ID
//
// ⚠️ 執行前：確認「團購廠商資料庫」的 N 欄表頭已經打上「封存」，
//    沒有的話新建的廠商會少一欄、封存標記寫不進去。
//
// 用法：先跑一次看報告（P2_DRY_RUN = true），確認後改成 false 再跑。
// ============================================================

var P2_DRY_RUN = true;   // ← 確認報告沒問題後改成 false

function 廠商整理第二階段_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(P2_DRY_RUN ? '===== 試算模式（不會寫入）=====' : '===== 實際執行 =====');

  var vSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('團購廠商資料庫');
  if (!vSheet) throw new Error('找不到「團購廠商資料庫」分頁');
  var vData = vSheet.getDataRange().getValues();
  var vHeader = vData[0].map(function (h) { return String(h).trim(); });
  var iCompany = vHeader.indexOf('公司名稱');
  var iArchived = vHeader.indexOf('封存');
  if (iArchived < 0) say('  ⚠ 找不到「封存」欄，32 家一次性廠商會照建但標不了封存，' +
                         '清單上會全部跑出來。建議先去 N1 打上「封存」再跑。');

  // ---- 1. 別名併回既有廠商 ----
  say('');
  say('【1】錯字／品牌名 → 併回既有廠商');
  var rowOf = {};
  for (var i = 1; i < vData.length; i++) if (vData[i][0]) rowOf[String(vData[i][0]).trim()] = i + 1;
  var aliasJobs = [];
  Object.keys(ALIAS_TO_VENDOR).forEach(function (alias) {
    var vid = ALIAS_TO_VENDOR[alias][0];
    if (!rowOf[vid]) { say('  ⚠ ' + alias + ' 要併到 ' + vid + '，但找不到這個廠商，跳過'); return; }
    aliasJobs.push({ alias: alias, vid: vid, name: ALIAS_TO_VENDOR[alias][1], why: ALIAS_TO_VENDOR[alias][2] });
    say('  「' + alias + '」→ ' + vid + ' ' + ALIAS_TO_VENDOR[alias][1] + '（' + ALIAS_TO_VENDOR[alias][2] + '）');
  });
  if (!P2_DRY_RUN && iCompany >= 0) {
    // 把別名寫進「公司名稱」欄，之後用錯字搜尋也找得到。同一格可能要加好幾個，先彙總再寫
    var pending = {};
    aliasJobs.forEach(function (j) {
      if (!pending[j.vid]) pending[j.vid] = [];
      pending[j.vid].push(j.alias);
    });
    Object.keys(pending).forEach(function (vid) {
      var cell = vSheet.getRange(rowOf[vid], iCompany + 1);
      var cur = String(cell.getValue() || '').trim();
      pending[vid].forEach(function (a) { if (cur.indexOf(a) < 0) cur = cur ? cur + ',' + a : a; });
      cell.setValue(cur);
    });
    say('  ✅ 已把別名寫進 ' + Object.keys(pending).length + ' 家廠商的公司名稱欄');
  }

  // ---- 2. 新建廠商 ----
  say('');
  say('【2】新建廠商');
  var exist = {};
  for (var k = 1; k < vData.length; k++) if (vData[k][0]) exist[String(vData[k][0]).trim()] = true;
  var toAdd = PHASE2_VENDORS.filter(function (v) { return !exist[v[0]]; });
  var archCount = toAdd.filter(function (v) { return v[2]; }).length;
  say('  要新建 ' + toAdd.length + ' 家，其中 ' + archCount + ' 家標封存（平常不顯示）');
  toAdd.filter(function (v) { return !v[2]; }).forEach(function (v) {
    say('    ' + v[0] + ' ' + v[1] + (v[3].length > 1 ? '（合併寫法：' + v[3].join('、') + '）' : ''));
  });
  say('    …另外 ' + archCount + ' 家封存的不逐一列出');
  if (!P2_DRY_RUN && toAdd.length) {
    var now = new Date();
    var rows = toAdd.map(function (v) {
      var row = new Array(vHeader.length).fill('');
      row[0] = v[0]; row[1] = v[1]; row[2] = '廠商';
      row[6] = '從歷史帳務的開票公司建檔' + (v[3].length > 1 ? '。原始寫法：' + v[3].join('、') : '');
      row[7] = now; row[8] = now;
      if (iCompany >= 0) row[iCompany] = v[3].join(',');
      if (iArchived >= 0 && v[2]) row[iArchived] = '是';
      return row;
    });
    vSheet.getRange(vSheet.getLastRow() + 1, 1, rows.length, vHeader.length).setValues(rows);
    say('  ✅ 已新建 ' + rows.length + ' 家');
  }

  // ---- 3. 回填帳務 ----
  say('');
  say('【3】回填帳務廠商ID');
  var map = {};
  Object.keys(ALIAS_TO_VENDOR).forEach(function (a) { map[a] = ALIAS_TO_VENDOR[a][0]; });
  PHASE2_VENDORS.forEach(function (v) { v[3].forEach(function (raw) { map[raw] = v[0]; }); });

  var aSheet = SpreadsheetApp.openById(ACCOUNTING_SHEET_ID).getSheetByName(ACCOUNTING_SHEET_NAME);
  var aData = aSheet.getDataRange().getValues();
  var aHeader = aData[0].map(function (h) { return String(h).trim(); });
  var cVendor = aHeader.indexOf('廠商ID');
  var cCompany = aHeader.indexOf('開票公司');
  if (cVendor < 0 || cCompany < 0) throw new Error('開團紀錄找不到「廠商ID」或「開票公司」欄');

  var fills = [], already = 0, still = {}, noCompany = 0;
  for (var r2 = 1; r2 < aData.length; r2++) {
    if (!aData[r2][0]) continue;
    var comp = String(aData[r2][cCompany] || '').trim();
    if (!comp) { noCompany++; continue; }
    if (String(aData[r2][cVendor] || '').trim()) { already++; continue; }
    var vid2 = Object.prototype.hasOwnProperty.call(map, comp) ? map[comp] : null;
    if (!vid2) { still[comp] = (still[comp] || 0) + 1; continue; }
    fills.push({ row: r2 + 1, vid: vid2 });
  }
  var stillN = 0, stillList = [];
  for (var s in still) { stillN += still[s]; stillList.push(s + '(' + still[s] + ')'); }
  say('  可回填 ' + fills.length + ' 筆');
  say('  已經有廠商ID：' + already + ' 筆');
  say('  仍然對不到：' + stillN + ' 筆　' + (stillList.length ? stillList.join('、') : ''));
  say('  沒填開票公司：' + noCompany + ' 筆');
  say('  ── 核對：' + fills.length + ' + ' + already + ' + ' + stillN + ' + ' + noCompany +
      ' = ' + (fills.length + already + stillN + noCompany) + '（應等於 ' + (aData.length - 1) + '）');
  if (!P2_DRY_RUN && fills.length) {
    var col = aSheet.getRange(2, cVendor + 1, aData.length - 1, 1);
    var vals = col.getValues();
    fills.forEach(function (f) { vals[f.row - 2][0] = f.vid; });
    col.setValues(vals);
    say('  ✅ 已回填 ' + fills.length + ' 筆');
  }

  say('');
  say(P2_DRY_RUN ? '===== 試算結束，確認後把 P2_DRY_RUN 改成 false 再跑 =====' : '===== 完成 =====');
  return log.join('\n');
}
// ===== 第二階段廠商整理的資料 =====

// A. 錯字／填成品牌名 → 併回既有廠商：{ 開票公司: [廠商ID, 該廠商名, 理由] }
var ALIAS_TO_VENDOR = {
  "雪紡優格": ["V003", "雪坊優格", "「紡」是「坊」的錯字"],
  "雪紡": ["V003", "雪坊優格", "同上，且是簡寫"],
  "朵玫黎": ["V010", "朶玫黎", "「朵」是「朶」的錯字"],
  "卜蜜兒": ["V013", "朴蜜兒", "「卜」是「朴」的錯字"],
  "臻尼森": ["V008", "榛尼森", "「臻」是「榛」的錯字"],
  "賽柏購": ["V005", "賽博購", "「柏」是「博」的錯字"],
  "皇唏有限公司": ["V040", "皇晞有限公司", "「唏」是「晞」的錯字"],
  "台東初鹿": ["V001", "樂奎有限公司", "初鹿保久乳是樂奎的品牌，這裡填的是品牌名"],
  "一噴淨": ["V023", "澄昂國際", "一噴淨是澄昂的品牌，這裡填的是品牌名"],
};

// B+C. 要新建的廠商：[廠商ID, 名稱, 是否封存, 開票公司的各種寫法(陣列)]
var PHASE2_VENDORS = [
  ["V049", "帝爾特", false, ["帝爾特", "蒂爾特"]],
  ["V050", "表參道餐飲", false, ["表參道餐飲", "表餐道餐飲", "表餐道"]],
  ["V051", "好研所股份有限公司", false, ["好研所", "好研所股份有限公司", "好妍所"]],
  ["V052", "雙子星計畫", false, ["雙子星計畫", "雙子計畫"]],
  ["V053", "眾志成有限公司", false, ["眾志成30279", "眾志成有限公司"]],
  ["V054", "榛樂軒", false, ["榛樂軒", "臻樂軒"]],
  ["V055", "伊頓國際", false, ["伊頓國際11909", "伊頓"]],
  ["V056", "為你創意", false, ["為你創意"]],
  ["V057", "胡同", false, ["胡同"]],
  ["V058", "野火顧問", false, ["野火顧問"]],
  ["V059", "磁力科學", false, ["磁力科學"]],
  ["V060", "多奇國際有限公司", false, ["多奇國際有限公司"]],
  ["V061", "寰宇中道健康", false, ["寰宇中道健康"]],
  ["V062", "銳錡有限公司", false, ["銳錡有限公司"]],
  ["V063", "毛寶", false, ["毛寶"]],
  ["V064", "辰曜生技", false, ["辰曜生技"]],
  ["V065", "蛋黃漫步", true,  ["蛋黃漫步"]],
  ["V066", "奧德行銷", true,  ["奧德行銷"]],
  ["V067", "多生來", true,  ["多生來"]],
  ["V068", "山泥有限公司", true,  ["山泥有限公司"]],
  ["V069", "品硯國際", true,  ["品硯國際"]],
  ["V070", "台灣微告", true,  ["台灣微告"]],
  ["V071", "貝比哺國際", true,  ["貝比哺國際"]],
  ["V072", "宇羽國際", true,  ["宇羽國際"]],
  ["V073", "拓勤企業", true,  ["拓勤企業"]],
  ["V074", "盛琦團購商行", true,  ["盛琦團購商行"]],
  ["V075", "溫室工作室", true,  ["溫室工作室"]],
  ["V076", "凱曜網路", true,  ["凱曜網路"]],
  ["V077", "侑子股份有限公司", true,  ["侑子股份有限公司"]],
  ["V078", "汎絡數位行銷", true,  ["汎絡數位行銷"]],
  ["V079", "威創策略行銷", true,  ["威創策略行銷"]],
  ["V080", "豆樂逗樂", true,  ["豆樂逗樂"]],
  ["V081", "皮蛋國際", true,  ["皮蛋國際"]],
  ["V082", "不老松", true,  ["不老松"]],
  ["V083", "丘瑀國際", true,  ["丘瑀國際"]],
  ["V084", "山淬股份有限公司", true,  ["山淬股份有限公司"]],
  ["V085", "黛蔻數位", true,  ["黛蔻數位"]],
  ["V086", "吉特國際", true,  ["吉特國際"]],
  ["V087", "凱創實業", true,  ["凱創實業"]],
  ["V088", "亞克科技開發", true,  ["亞克科技開發"]],
  ["V089", "囝趣", true,  ["囝趣"]],
  ["V090", "星品國際", true,  ["星品國際"]],
  ["V091", "摯拓創新", true,  ["摯拓創新"]],
  ["V092", "今達國際有限公司", true,  ["今達國際有限公司"]],
  ["V093", "卡樂米", true,  ["卡樂米"]],
  ["V094", "新詠國際貿易有限公司", true,  ["新詠國際貿易有限公司"]],
  ["V095", "圖萌思實業有限公司", true,  ["圖萌思實業有限公司"]],
  ["V096", "享呈佳有限公司", true,  ["享呈佳有限公司"]],
];