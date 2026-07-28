// ============================================================
// 修正「分潤%」欄：14 筆混合成數的文字被誤讀成數字
//
// 背景：像「15%-18%」「20% 一般配件15%」這種混合成數，在匯入時被
// parseFloat 吃掉開頭的數字，變成 15 或 20（等於 1500%／2000%），
// 而且原文沒有進到「分潤說明」欄。
//
// ⚠️ 分潤金額（實際收到的錢）完全沒有錯，這支只補正「分潤%」與「分潤說明」兩欄。
//
// 用法：跟上一支一樣，先跑一次看報告（DRY_RUN = true），
//       確認沒問題再改成 false 跑第二次。用完把這個檔案刪掉。
// ============================================================

var FIX_DRY_RUN = true;   // ← 確認報告沒問題後改成 false

var ACC_ID = '1Ba9oFudDTqHP7qAjZPPqp8csrMfscUlXlPPUA9Qy7Ug';   // 開團帳務
var ACC_SHEET = '開團紀錄';

function 修正分潤欄_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(FIX_DRY_RUN ? '===== 試算模式（不會寫入）=====' : '===== 實際執行 =====');

  var sh = SpreadsheetApp.openById(ACC_ID).getSheetByName(ACC_SHEET);
  if (!sh) throw new Error('找不到「' + ACC_SHEET + '」分頁');
  var data = sh.getDataRange().getValues();
  var header = data[0].map(function (h) { return String(h).trim(); });
  var cId = header.indexOf('紀錄ID');
  var cRate = header.indexOf('分潤%');
  var cNote = header.indexOf('分潤說明');
  var cName = header.indexOf('原始名稱');
  if (cId < 0 || cRate < 0 || cNote < 0) throw new Error('找不到必要欄位，請確認表頭沒有被改過');

  var done = 0, skipped = 0, notFound = [];
  var seen = {};
  for (var i = 1; i < data.length; i++) {
    var rid = String(data[i][cId] || '').trim();
    if (!RATE_FIX[rid]) continue;
    seen[rid] = 1;
    var curRate = data[i][cRate];
    var curNote = String(data[i][cNote] || '').trim();
    // 只動「分潤%大於1」的列。正常成數是 0.1~0.3，大於 1 就是被誤讀的那種。
    if (!(Number(curRate) > 1)) { skipped++; continue; }
    say('  ' + rid + '  ' + String(data[i][cName] || '').substring(0, 24) +
        '：分潤% ' + curRate + ' → 清空，分潤說明 → 「' + RATE_FIX[rid] + '」' +
        (curNote ? '（原說明「' + curNote + '」會保留在後面）' : ''));
    if (!FIX_DRY_RUN) {
      sh.getRange(i + 1, cRate + 1).setValue('');
      sh.getRange(i + 1, cNote + 1).setValue(curNote ? curNote + ' / ' + RATE_FIX[rid] : RATE_FIX[rid]);
    }
    done++;
  }
  for (var k in RATE_FIX) if (!seen[k]) notFound.push(k);

  say('');
  say('  要修正 ' + done + ' 筆、已經是正確值而跳過 ' + skipped + ' 筆');
  if (notFound.length) say('  ⚠ 這些紀錄ID在表裡找不到：' + notFound.join('、'));

  // 順便體檢：還有沒有其他分潤%大於1的漏網之魚
  var others = [];
  for (var j = 1; j < data.length; j++) {
    var r2 = String(data[j][cId] || '').trim();
    if (RATE_FIX[r2]) continue;
    if (Number(data[j][cRate]) > 1) others.push(r2 + ' ' + String(data[j][cName] || '').substring(0, 20) + ' = ' + data[j][cRate]);
  }
  say('  全表體檢：其他分潤%大於1的列 ' + others.length + ' 筆' + (others.length ? '：' + others.join('、') : '（沒有，很好）'));
  say('  總列數（不含表頭）：' + (data.length - 1));

  say('');
  say(FIX_DRY_RUN ? '===== 試算結束，確認後把 FIX_DRY_RUN 改成 false 再跑 =====' : '===== 完成 =====');
  return log.join('\n');
}
// 修正 14 筆「分潤%」欄：混合成數的文字被讀成數字（例：15%-18% → 15）
// 分潤金額沒有錯，只有「分潤%」與「分潤說明」兩欄要補正
var RATE_FIX = {
  "R0051": "15+",   // QUUT
  "R0339": "15%-18%",   // ASPOR充電線製冷風扇
  "R0340": "15%-18%",   // 麗克特調理機
  "R0360": "15%-20%",   // ASPOR自拍及3C周邊
  "R0400": "10%,18%",   // 日本新年禮盒
  "R0416": "20%(稅另外)",   // 燕麥脆脆
  "R0442": "18%、15%",   // 日本麗克特全系列A01
  "R0448": "18%、15%",   // Yaber 小影霸 投影機
  "R0484": "15%-18%",   // Kidsread 點讀筆
  "R0504": "20%；30萬25%",   // 冊子粽子預購
  "R0517": "20%(稅外)",   // Simple yet燕麥脆脆
  "R0558": "25％",   // kolin 吸吸燙
  "R0559": "100萬以內15%；超過的部分20%",   // 卡蘿琳/豬軟糖/QQ凍
  "R0564": "20% 一般配件15%",   // Aspor 3C 快閃
};