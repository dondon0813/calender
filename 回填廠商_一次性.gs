// ============================================================
// 一次性：回填開團帳務的「廠商ID」，並整理廠商資料庫
//
// 做三件事：
//   1. 既有廠商改名（V007 JOLLY → 璟豐、V008 伯尼寢具 → 榛尼森）
//      —— 那兩格原本填的是「品牌名」，真正的廠商是璟豐與榛尼森
//   2. 新建 30 家開票 3 次以上的廠商（V019~V048）
//   3. 依每筆的「開票公司」把帳務的廠商ID 補上
//
// ⚠️ 注意：開票公司 ≠ 廠商。同一個行銷公司底下的品牌，有的開行銷公司發票、
//    有的直接開品牌自己的公司發票（例：LMG 開「瑞久」，但接洽對象仍是榛尼森）。
//    所以這張對照表是「開票公司 → 實際接洽的廠商」，不是單純的公司名比對。
//
// 用法：先跑一次看報告（VENDOR_DRY_RUN = true），確認後改成 false 再跑。
//       用完把這個檔案刪掉。
// ============================================================

var VENDOR_DRY_RUN = true;   // ← 確認報告沒問題後改成 false

function 回填廠商_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(VENDOR_DRY_RUN ? '===== 試算模式（不會寫入）=====' : '===== 實際執行 =====');

  var vSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('團購廠商資料庫');
  if (!vSheet) throw new Error('找不到「團購廠商資料庫」分頁');
  var vData = vSheet.getDataRange().getValues();
  var vHeader = vData[0].map(function (h) { return String(h).trim(); });
  var iCompany = vHeader.indexOf('公司名稱');

  // ---- 1. 改名 ----
  say('');
  say('【1】既有廠商改名');
  var renames = [];
  for (var i = 1; i < vData.length; i++) {
    for (var j = 0; j < RENAME_VENDORS.length; j++) {
      if (String(vData[i][0]).trim() !== RENAME_VENDORS[j][0]) continue;
      var oldName = String(vData[i][1] || '').trim();
      if (oldName === RENAME_VENDORS[j][1]) { say('  ' + RENAME_VENDORS[j][0] + ' 已經是「' + oldName + '」，跳過'); continue; }
      renames.push({ row: i + 1, id: RENAME_VENDORS[j][0], from: oldName, to: RENAME_VENDORS[j][1], why: RENAME_VENDORS[j][2] });
      var curAlias = iCompany >= 0 ? String(vData[i][iCompany] || '').trim() : '';
      say('  ' + RENAME_VENDORS[j][0] + '：「' + oldName + '」→「' + RENAME_VENDORS[j][1] + '」（' + RENAME_VENDORS[j][2] + '）');
      say('      公司名稱欄：「' + (curAlias || '空白') + '」→「' +
          (curAlias.indexOf(oldName) >= 0 ? curAlias : (curAlias ? curAlias + ',' + oldName : oldName)) + '」');
    }
  }
  if (!renames.length) say('  沒有要改的');
  if (iCompany < 0 && renames.length) say('  ⚠ 找不到「公司名稱」欄，舊名沒地方存，改名後就用舊名搜尋不到了');
  if (!VENDOR_DRY_RUN) {
    renames.forEach(function (r) {
      // ⚠️ 先寫別名再改名。順序相反的話，萬一寫到一半逾時，重跑會判定「已經是新名字」
      // 而跳過，舊名就永久遺失、再也搜尋不到。
      if (iCompany >= 0) {
        var cell = vSheet.getRange(r.row, iCompany + 1);
        var cur = String(cell.getValue() || '').trim();
        if (cur.indexOf(r.from) < 0) cell.setValue(cur ? cur + ',' + r.from : r.from);
      }
      vSheet.getRange(r.row, 2).setValue(r.to);
      vSheet.getRange(r.row, 9).setValue(new Date());
    });
    say('  ✅ 已改名 ' + renames.length + ' 筆（舊名保留到「公司名稱」欄當別名）');
  }

  // ---- 2. 新建廠商 ----
  say('');
  say('【2】新建廠商');
  var exist = {};
  for (var k = 1; k < vData.length; k++) if (vData[k][0]) exist[String(vData[k][0]).trim()] = true;
  var toAdd = NEW_VENDORS.filter(function (v) { return !exist[v[0]]; });
  say('  要新建 ' + toAdd.length + ' 家' + (toAdd.length ? '（' + toAdd[0][0] + ' ~ ' + toAdd[toAdd.length - 1][0] + '）' : ''));
  toAdd.slice(0, 8).forEach(function (v) { say('    ' + v[0] + ' ' + v[1]); });
  if (toAdd.length > 8) say('    …其餘 ' + (toAdd.length - 8) + ' 家');
  if (!VENDOR_DRY_RUN && toAdd.length) {
    var now = new Date();
    var rowsOut = toAdd.map(function (v) {
      var row = new Array(vHeader.length).fill('');
      row[0] = v[0];              // id
      row[1] = v[1];              // 廠商名稱
      row[2] = '廠商';             // 類型：先給預設，之後你自己改行銷公司/代理商
      row[6] = '從歷史帳務的開票公司建檔。原始寫法：' + v[2];
      row[7] = now; row[8] = now;
      if (iCompany >= 0) row[iCompany] = v[2].split('、').join(',');
      return row;
    });
    vSheet.getRange(vSheet.getLastRow() + 1, 1, rowsOut.length, vHeader.length).setValues(rowsOut);
    say('  ✅ 已新建 ' + rowsOut.length + ' 家');
  }

  // ---- 3. 回填帳務的廠商ID ----
  say('');
  say('【3】回填帳務廠商ID');
  var aSheet = SpreadsheetApp.openById(ACCOUNTING_SHEET_ID).getSheetByName(ACCOUNTING_SHEET_NAME);
  if (!aSheet) throw new Error('找不到開團紀錄分頁');
  var aData = aSheet.getDataRange().getValues();
  var aHeader = aData[0].map(function (h) { return String(h).trim(); });
  var cVendor = aHeader.indexOf('廠商ID');
  var cCompany = aHeader.indexOf('開票公司');
  if (cVendor < 0 || cCompany < 0) throw new Error('開團紀錄找不到「廠商ID」或「開票公司」欄');

  // 自檢：對照表指到的廠商 ID 必須真的存在，否則會把孤兒 ID 寫進帳務
  var known = {};
  for (var e2 = 1; e2 < vData.length; e2++) if (vData[e2][0]) known[String(vData[e2][0]).trim()] = true;
  NEW_VENDORS.forEach(function (v) { known[v[0]] = true; });
  var orphan = {};
  Object.keys(COMPANY2VENDOR).forEach(function (c) { if (!known[COMPANY2VENDOR[c]]) orphan[COMPANY2VENDOR[c]] = true; });
  var orphanIds = Object.keys(orphan);
  if (orphanIds.length) {
    say('  ⚠ 對照表指到不存在的廠商ID：' + orphanIds.join('、') + '，這些不會被回填');
  }

  var fills = [], already = 0, conflict = [], noMatch = {}, noCompany = 0, blankId = 0;
  for (var r2 = 1; r2 < aData.length; r2++) {
    if (!aData[r2][0]) { blankId++; continue; }
    var comp = String(aData[r2][cCompany] || '').trim();
    if (!comp) { noCompany++; continue; }
    var vid = Object.prototype.hasOwnProperty.call(COMPANY2VENDOR, comp) ? COMPANY2VENDOR[comp] : null;
    var cur = String(aData[r2][cVendor] || '').trim();
    if (cur) {                                    // 已經有值就不覆蓋，但要提醒不一致
      already++;
      if (vid && vid !== cur) conflict.push(aData[r2][0] + ' ' + comp + '：現有 ' + cur + '、對照表說 ' + vid);
      continue;
    }
    if (!vid || !known[vid]) { noMatch[comp] = (noMatch[comp] || 0) + 1; continue; }
    fills.push({ row: r2 + 1, vid: vid });
  }
  say('  可回填 ' + fills.length + ' 筆');
  say('  已經有廠商ID、不覆蓋：' + already + ' 筆');
  if (conflict.length) {
    say('  ⚠ 其中 ' + conflict.length + ' 筆跟對照表結果不一致（保留你原本填的，只是提醒）：');
    conflict.slice(0, 8).forEach(function (c) { say('      ' + c); });
  }
  var nmCount = 0, nmList = [];
  for (var c in noMatch) { nmCount += noMatch[c]; if (nmList.length < 12) nmList.push(c + '(' + noMatch[c] + ')'); }
  say('  對不到廠商、維持空白：' + nmCount + ' 筆　' + (nmList.length ? '例：' + nmList.join('、') : ''));
  say('  沒填開票公司：' + noCompany + ' 筆' + (blankId ? '　空白列：' + blankId + ' 列' : ''));
  // 數字要封閉，否則有列被漏掉也看不出來
  say('  ── 核對：' + fills.length + ' + ' + already + ' + ' + nmCount + ' + ' + noCompany + ' + ' + blankId +
      ' = ' + (fills.length + already + nmCount + noCompany + blankId) + '（應等於 ' + (aData.length - 1) + '）');
  if (!VENDOR_DRY_RUN && fills.length) {
    // 逐格寫太慢，整欄一次寫回
    var col = aSheet.getRange(2, cVendor + 1, aData.length - 1, 1);
    var vals = col.getValues();
    fills.forEach(function (f) { vals[f.row - 2][0] = f.vid; });
    col.setValues(vals);
    say('  ✅ 已回填 ' + fills.length + ' 筆');
  }

  say('');
  say(VENDOR_DRY_RUN ? '===== 試算結束，確認後把 VENDOR_DRY_RUN 改成 false 再跑 =====' : '===== 完成 =====');
  return log.join('\n');
}
// 開票公司字串 → 廠商ID（使用者已在對照表確認）
// ⚠️ 開票公司 ≠ 廠商：同一行銷公司底下的品牌，有的開行銷公司發票、有的開品牌自己的
//    （例：LMG 開「瑞久」，但接洽對象仍是榛尼森）。這是「開票公司 → 實際接洽廠商」的對照。
var COMPANY2VENDOR = {
  "云成科技": "V038",
  "云成科技有限公司": "V038",
  "享品": "V022",
  "享品企業": "V022",
  "享品企業社": "V022",
  "佶特": "V043",
  "佶特國際": "V043",
  "優迪": "V009",
  "凱婕有限公司": "V035",
  "匯盛": "V014",
  "匯盛國際": "V014",
  "和興": "V025",
  "和興國際": "V025",
  "品圖": "V044",
  "品圖國際": "V044",
  "唯進食品": "V024",
  "子熊": "V015",
  "寶媽咪": "V021",
  "寶媽咪親子館": "V021",
  "彤樂國際": "V042",
  "彤樂國際企業社": "V042",
  "彩雲飛": "V034",
  "彩雲飛企業": "V034",
  "彩雲飛企業有限公司": "V034",
  "征程": "V032",
  "征程實業": "V032",
  "征程實業有限公司": "V032",
  "愛兒館": "V016",
  "拓華": "V026",
  "拓華生技": "V026",
  "易昇": "V041",
  "易昇網路有限公司": "V041",
  "朴蜜兒有限公司": "V013",
  "朶玫黎": "V010",
  "杏豐": "V017",
  "梨子熊": "V015",
  "榛尼森": "V008",
  "榛尼森國際": "V008",
  "榛尼森國際有限公司": "V008",
  "樂奎": "V001",
  "樂奎有限公司": "V001",
  "樂比比": "V002",
  "每日康": "V028",
  "每日康國際有限公司": "V028",
  "淨毒五郎": "V018",
  "澄昂": "V023",
  "澄昂國際": "V023",
  "玠積": "V030",
  "玠積國際": "V030",
  "瑞久": "V008",
  "瑞久有限": "V008",
  "瑞久有限公司": "V008",
  "璟豐": "V007",
  "璟豐開發": "V007",
  "白天睡覺晚上": "V048",
  "白天睡覺晚上工作室": "V048",
  "皇晞": "V040",
  "皇晞有限公司": "V040",
  "知音人": "V047",
  "知音人文化": "V047",
  "祝爾": "V029",
  "祝爾有限公司": "V029",
  "禾沐": "V019",
  "禾沐生活": "V019",
  "禾流": "V039",
  "禾流文創": "V039",
  "維維樂": "V027",
  "維維樂企業": "V027",
  "茶中文化": "V046",
  "貝比富": "V033",
  "貝比富冷凍食品有限公司": "V033",
  "賽博購": "V005",
  "賽博購股份": "V005",
  "錦達": "V020",
  "錦達貿易": "V020",
  "鐵味食品": "V036",
  "雪坊": "V003",
  "韓商173": "V045",
  "項晴": "V031",
  "項晴實業": "V031",
  "黎子熊": "V015",
  "鼎珈": "V037",
  "鼎珈國際": "V037",
};

// 要新建的廠商：[廠商ID, 廠商名稱, 這家在帳務裡出現過的各種開票公司寫法]
// 名稱取「最完整的那個寫法」，不是被後綴規則砍過的殘骸
var NEW_VENDORS = [
  ["V019", "禾沐生活", "禾沐、禾沐生活"],
  ["V020", "錦達貿易", "錦達、錦達貿易"],
  ["V021", "寶媽咪親子館", "寶媽咪、寶媽咪親子館"],
  ["V022", "享品企業社", "享品、享品企業、享品企業社"],
  ["V023", "澄昂國際", "澄昂、澄昂國際"],
  ["V024", "唯進食品", "唯進食品"],
  ["V025", "和興國際", "和興、和興國際"],
  ["V026", "拓華生技", "拓華、拓華生技"],
  ["V027", "維維樂企業", "維維樂、維維樂企業"],
  ["V028", "每日康國際有限公司", "每日康、每日康國際有限公司"],
  ["V029", "祝爾有限公司", "祝爾、祝爾有限公司"],
  ["V030", "玠積國際", "玠積、玠積國際"],
  ["V031", "項晴實業", "項晴、項晴實業"],
  ["V032", "征程實業有限公司", "征程、征程實業、征程實業有限公司"],
  ["V033", "貝比富冷凍食品有限公司", "貝比富、貝比富冷凍食品有限公司"],
  ["V034", "彩雲飛企業有限公司", "彩雲飛、彩雲飛企業、彩雲飛企業有限公司"],
  ["V035", "凱婕有限公司", "凱婕有限公司"],
  ["V036", "鐵味食品", "鐵味食品"],
  ["V037", "鼎珈國際", "鼎珈、鼎珈國際"],
  ["V038", "云成科技有限公司", "云成科技、云成科技有限公司"],
  ["V039", "禾流文創", "禾流、禾流文創"],
  ["V040", "皇晞有限公司", "皇晞、皇晞有限公司"],
  ["V041", "易昇網路有限公司", "易昇、易昇網路有限公司"],
  ["V042", "彤樂國際企業社", "彤樂國際、彤樂國際企業社"],
  ["V043", "佶特國際", "佶特、佶特國際"],
  ["V044", "品圖國際", "品圖、品圖國際"],
  ["V045", "韓商173", "韓商173"],
  ["V046", "茶中文化", "茶中文化"],
  ["V047", "知音人文化", "知音人、知音人文化"],
  ["V048", "白天睡覺晚上工作室", "白天睡覺晚上、白天睡覺晚上工作室"],
];

// 既有廠商改名：[廠商ID, 新名稱, 理由]
var RENAME_VENDORS = [
  ["V007", "璟豐", "JOLLY 是品牌，璟豐開發股份有限公司才是廠商"],
  ["V008", "榛尼森", "伯尼寢具是品牌，榛尼森才是接洽的行銷公司"],
];