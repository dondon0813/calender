// ============================================================
// 一次性匯入：把「雪莉記帳分潤單」的歷史開團紀錄整理進系統
//
// ⚠️ 執行前務必先備份：打開記帳分潤單 → 檔案 → 建立副本
// ⚠️ 這支程式會寫入你的財務資料。用完請把這個檔案刪掉。
//
// 用法：
//   1. 先直接執行 開團帳務匯入_ONETIME()（此時 DRY_RUN = true）
//      → 它只會在「執行紀錄」印出打算做什麼，不會動到任何資料
//   2. 看過報告沒問題，把下面 DRY_RUN 改成 false，再執行一次
// ============================================================

var DRY_RUN = true;   // ← 確認報告沒問題後，改成 false 才會真的寫入

var SRC_ID = '1-BCvTONgwBlWuXINYSiDBqiVLLUYfCiEfSQ6AgxSrqM';   // 雪莉記帳分潤單
var SRC_SHEET = '帳務';
var ACCOUNTING_TITLE = '開團帳務';

var LOG = [];
function say_(s) { LOG.push(s); Logger.log(s); }

function 開團帳務匯入_ONETIME() {
  LOG = [];
  say_(DRY_RUN ? '===== 試算模式（不會寫入任何資料）=====' : '===== 實際執行模式 =====');
  var src = SpreadsheetApp.openById(SRC_ID).getSheetByName(SRC_SHEET);
  if (!src) throw new Error('找不到「' + SRC_SHEET + '」分頁');
  var data = src.getDataRange().getValues();

  var blocks = buildBlocks_(data);
  say_('讀到 ' + data.length + ' 列，切出 ' + blocks.length + ' 個結算區塊');

  step1_修年份_(src, data, blocks);
  var recs = step2_組出紀錄_(data, blocks);
  step3_補結算列_(src, data, blocks, recs);
  step4_新增品牌_();
  step5_建帳務表_(recs);

  say_('');
  say_(DRY_RUN ? '===== 試算結束。確認無誤後把 DRY_RUN 改成 false 再跑一次 ====='
               : '===== 全部完成 =====');
  return LOG.join('\n');
}

// ---------- 依「結算列」把資料切成區塊，並推導每塊的正確年月 ----------
// 年份不看標籤（標籤本身就有寫錯的），只取月份；年份靠「月份沒變大就跨年」推。
// 錨點：第一個月結算列是 5 月，其明細日期確定是 2024 年。
function buildBlocks_(data) {
  var blocks = [], cur = [];
  for (var i = 1; i < data.length; i++) {
    var d = String(data[i][1] || '').trim();
    var k = String(data[i][0] || '').trim();
    if (d.indexOf('結算') >= 0 || k.indexOf('結算') >= 0) {
      blocks.push({ row: i + 1, label: k.replace(/\.0$/, '') + ' ' + d, rows: cur, ym: null });
      cur = [];
    } else if (isDate_(data[i][1]) || String(data[i][2] || '').trim()) {
      cur.push(i);
    }
  }
  if (cur.length) blocks.push({ row: data.length, label: '(表尾未結算)', rows: cur, ym: null });
  var year = 2024, pm = null;
  for (var b = 0; b < blocks.length; b++) {
    var m = /(\d{1,2})月結算/.exec(blocks[b].label);
    if (!m) continue;
    var mon = parseInt(m[1], 10);
    if (pm !== null && mon <= pm) year++;
    blocks[b].ym = [year, mon];
    pm = mon;
  }
  return blocks;
}

function isDate_(v) {
  if (v instanceof Date) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
}
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  return String(v || '').trim();
}
// ⚠️ 刻意不去掉 % 符號：「20%」這種文字若被讀成數字 20，會被當成 2000% 的分潤率。
// 讓它回 null，交給上層丟進「分潤說明」欄由人判斷，跟先前產出的對照結果一致。
function n_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var x = parseFloat(String(v).replace(/[,\s]/g, ''));
  return isNaN(x) ? null : x;
}

// ---------- 步驟 1：修正年份 ----------
function step1_修年份_(sheet, data, blocks) {
  say_('');
  say_('【步驟1】修正日期年份');
  var fixes = [];
  for (var b = 0; b < blocks.length; b++) {
    if (!blocks[b].ym) continue;
    var y = blocks[b].ym[0], m = blocks[b].ym[1];
    for (var j = 0; j < blocks[b].rows.length; j++) {
      var i = blocks[b].rows[j];
      if (!isDate_(data[i][1])) continue;
      var s = ymd_(data[i][1]);
      var ry = parseInt(s.substring(0, 4), 10), rm = parseInt(s.substring(5, 7), 10);
      if (rm === m && ry !== y) {
        fixes.push({ row: i + 1, from: s, to: y + s.substring(4), name: String(data[i][2] || '') });
      }
    }
  }
  if (!fixes.length) { say_('  年份全部正確，不需修改（你可能已經自己改過了）'); return; }
  say_('  需要修正 ' + fixes.length + ' 筆：');
  var seen = {};
  for (var f = 0; f < fixes.length; f++) {
    var key = fixes[f].from.substring(0, 7) + ' → ' + fixes[f].to.substring(0, 7);
    seen[key] = (seen[key] || 0) + 1;
  }
  for (var kk in seen) say_('    ' + kk + '  ' + seen[kk] + ' 筆');
  // ⚠️ 記憶體裡的 data 一定要同步更新：後面步驟 2、3 都吃這份 data，
  // 不同步的話會拿到舊年份，整批紀錄的日期就錯了（試算模式也要更新，報告才準）
  for (var u = 0; u < fixes.length; u++) data[fixes[u].row - 1][1] = fixes[u].to;
  if (DRY_RUN) { say_('  （試算模式，未寫入試算表；但後續步驟已用修正後的年份計算）'); return; }
  for (var g = 0; g < fixes.length; g++) {
    sheet.getRange(fixes[g].row, 2).setValue(fixes[g].to);
  }
  say_('  ✅ 已寫入 ' + fixes.length + ' 筆年份修正');
}

// ---------- 步驟 2：把明細組成標準化紀錄 ----------
function step2_組出紀錄_(data, blocks) {
  say_('');
  say_('【步驟2】整理開團紀錄');
  var STATUS = { '已入帳': '已入帳', '未入帳': '已請款', '未成團': '未成團',
                 '匯老媽': '已入帳', '匯本人帳戶': '已入帳', '-': '', '': '' };
  var DEST = { '匯老媽': '老媽', '匯本人帳戶': '本人' };
  var CONT = { '重開': 1, '重新開團': 1, '續開': 1 };
  var today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  var recs = [], n = 0, lastId = '', lastDate = '', unmatched = {};
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var dRaw = String(r[1] || '').trim();
    var k = String(r[0] || '').trim();
    if (dRaw.indexOf('結算') >= 0 || k.indexOf('結算') >= 0) continue;
    var raw = String(r[2] || '').replace(/\\/g, '').trim();
    var d = ymd_(r[1]);
    var note = [], cont = '';
    if (!isDate_(r[1])) {
      if (!raw) continue;
      if (CONT[dRaw]) {
        // 沒有母紀錄可以延續（例如「重開」出現在第一筆）就跳過，
        // 否則會產生日期空白、又反過來變成後面列的母紀錄的壞資料
        if (!lastId || !lastDate) { say_('  ⚠ 第' + (i + 1) + '列「' + dRaw + '」前面沒有可延續的紀錄，已跳過'); continue; }
        cont = lastId; d = lastDate;
        note.push('原日期欄寫「' + dRaw + '」＝同一團重開表單、業績拆兩列；日期沿用 ' + lastId);
      } else {
        if (!lastDate) continue;
        d = lastDate;
        note.push('原日期欄寫「' + (dRaw || '空白') + '」，日期依前一筆推估，請確認');
      }
    }
    n++;
    var rid = 'R' + ('000' + n).slice(-4);
    var sales = n_(r[3]), rate = n_(r[4]), comm = n_(r[5]), fee = n_(r[6]);
    var stRaw = String(r[7] || '').trim();
    var status = (stRaw in STATUS) ? STATUS[stRaw] : stRaw;
    var dest = DEST[stRaw] || '';
    var rateNote = '';
    if (String(r[4] || '').trim() && rate === null) rateNote = String(r[4]).replace(/\n/g, '；').trim();
    if (!status) {
      if (d > today) status = '進行中';
      else status = '待結算';
    }
    if (sales && rate && comm) {
      var base = sales * rate, taxed = base * 1.05;
      if (Math.abs(comm - taxed) < Math.max(3, taxed * 0.004) &&
          Math.abs(comm - base) > Math.max(3, base * 0.004)) note.push('疑似稅外加');
    }
    var memo = [];
    for (var c = 14; c < Math.min(r.length, 24); c++) {
      var v = String(r[c] || '').replace(/\n/g, ' / ').trim();
      if (v && v.indexOf('曾曾把狀態') < 0) memo.push(v);
    }
    if (String(r[10] || '').trim()) memo.push(String(r[10]).trim());
    if (String(r[11] || '').trim()) memo.push('健保:' + String(r[11]).trim());
    if (String(r[12] || '').trim()) memo.push('自購:' + String(r[12]).trim());

    var bid = BRAND_MAP[raw] || '';
    if (!bid) unmatched[raw] = (unmatched[raw] || 0) + 1;

    recs.push([rid, d, bid, '', raw, cont, '', String(r[13] || '').trim(),
               sales === null ? '' : sales, rate === null ? '' : rate,
               comm === null ? '' : comm, rateNote, '', fee === null ? '' : fee,
               status, dest, ymd_(r[8]) || String(r[8] || '').trim(), String(r[9] || '').trim(),
               memo.join(' / '), note.join(' / ')]);
    if (!cont) { lastId = rid; lastDate = d; }
  }
  say_('  整理出 ' + recs.length + ' 筆開團紀錄');
  var miss = 0, missList = [];
  for (var u in unmatched) { miss++; if (missList.length < 10) missList.push(u + '(' + unmatched[u] + ')'); }
  if (miss) {
    say_('  ⚠ 有 ' + miss + ' 種寫法對不到品牌（品牌ID會留空，之後可在後台補）：');
    say_('    ' + missList.join('、'));
  } else {
    say_('  ✅ 全部對到品牌');
  }
  return recs;
}

// ---------- 步驟 3：補月結算列、修正金額 ----------
function step3_補結算列_(sheet, data, blocks, recs) {
  say_('');
  say_('【步驟3】月結算列');
  // 月結算把「當月所有紀錄」都算進去（含還沒入帳的），這樣才看得到當月大概的收入。
  // 但未結算的部分另外累計，寫進備註欄註記，避免把「已經收到」和「還沒收到」混為一談。
  var DONE = { '已入帳': 1, '已請款': 1 };
  var sum = {};
  for (var i = 0; i < recs.length; i++) {
    var ym = recs[i][1].substring(0, 7);
    if (!sum[ym]) sum[ym] = { s: 0, c: 0, f: 0, n: 0, pend: 0, pendN: 0 };
    var comm = Number(recs[i][10]) || 0;
    sum[ym].s += Number(recs[i][8]) || 0;
    sum[ym].c += comm;
    sum[ym].f += Number(recs[i][13]) || 0;
    sum[ym].n++;
    if (!DONE[recs[i][14]] && comm > 0) { sum[ym].pend += comm; sum[ym].pendN++; }
  }
  function pendNote_(a) {
    return a.pendN ? '含未結算 ' + a.pendN + ' 團 ' + fmt_(a.pend) + ' 元' : '';
  }
  // 現有結算列：檢查金額對不對
  var todo = [];
  for (var b = 0; b < blocks.length; b++) {
    if (!blocks[b].ym) continue;
    var ym = blocks[b].ym[0] + '-' + ('0' + blocks[b].ym[1]).slice(-2);
    if (!sum[ym]) continue;
    var cur = n_(data[blocks[b].row - 1][5]);
    var note = pendNote_(sum[ym]);
    if ((cur !== null && Math.round(cur) !== Math.round(sum[ym].c)) || note) {
      todo.push({ row: blocks[b].row, label: blocks[b].label, from: cur,
                  to: Math.round(sum[ym].c), note: note,
                  changed: cur !== null && Math.round(cur) !== Math.round(sum[ym].c) });
    }
  }
  var changed = 0;
  for (var t0 = 0; t0 < todo.length; t0++) if (todo[t0].changed) changed++;
  if (changed) {
    say_('  結算金額需要更正 ' + changed + ' 列：');
    for (var t = 0; t < todo.length; t++)
      if (todo[t].changed)
        say_('    第' + todo[t].row + '列 ' + todo[t].label + '：' + fmt_(todo[t].from) + ' → ' + fmt_(todo[t].to) +
             (todo[t].note ? '（' + todo[t].note + '）' : ''));
  } else say_('  現有結算列金額都正確');
  var noted = 0;
  for (var t1 = 0; t1 < todo.length; t1++) if (todo[t1].note) noted++;
  if (noted) {
    say_('  有未結算團的月份 ' + noted + ' 個，會在該結算列備註欄註記：');
    for (var t2 = 0; t2 < todo.length; t2++)
      if (todo[t2].note) say_('    ' + todo[t2].label + '：' + todo[t2].note);
  }

  // 缺的月份
  var have = {};
  for (var b2 = 0; b2 < blocks.length; b2++)
    if (blocks[b2].ym) have[blocks[b2].ym[0] + '-' + ('0' + blocks[b2].ym[1]).slice(-2)] = 1;
  // ⚠️ 只補「已經過完而且原本就漏掉」的月份。
  // 當月與未來月份還沒結算完，補上去等於憑空生出一個假的結算數字。
  var thisMonth = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
  var missing = [];
  for (var ym2 in sum)
    if (!have[ym2] && ym2 >= '2024-01' && ym2 < thisMonth && sum[ym2].c > 0) missing.push(ym2);
  missing.sort();
  var skipped = [];
  for (var ym4 in sum) if (!have[ym4] && ym4 >= thisMonth) skipped.push(ym4);
  if (skipped.length) say_('  （' + skipped.sort().join('、') + ' 是當月或未來，尚未結算，不補結算列）');
  if (missing.length) {
    say_('  缺少結算列的月份 ' + missing.length + ' 個（會補在該月最後一筆之後）：');
    for (var mi = 0; mi < missing.length; mi++) {
      var s = sum[missing[mi]];
      say_('    ' + missing[mi] + '  ' + s.n + '筆  銷售 ' + fmt_(s.s) + '  分潤 ' + fmt_(s.c) +
           '  稿酬 ' + fmt_(s.f) + (pendNote_(s) ? '  ← ' + pendNote_(s) : ''));
    }
  } else say_('  沒有缺少的月份');

  if (DRY_RUN) { say_('  （試算模式，未寫入）'); return; }
  for (var t3 = 0; t3 < todo.length; t3++) {
    if (todo[t3].changed) sheet.getRange(todo[t3].row, 6).setValue(todo[t3].to);
    // 未結算註記寫進備註欄（第15欄）；原本有內容就接在後面，不覆蓋
    if (todo[t3].note) {
      var cell = sheet.getRange(todo[t3].row, 15);
      var old = String(cell.getValue() || '').trim();
      if (old.indexOf('含未結算') < 0) cell.setValue(old ? old + ' / ' + todo[t3].note : todo[t3].note);
    }
  }
  // 由下往上插入，避免列號位移
  var ins = [];
  for (var mi2 = 0; mi2 < missing.length; mi2++) {
    var ym3 = missing[mi2], lastRow = 0;
    for (var i2 = 1; i2 < data.length; i2++) {
      if (!isDate_(data[i2][1])) continue;
      if (ymd_(data[i2][1]).substring(0, 7) === ym3) lastRow = i2 + 1;
    }
    if (lastRow) ins.push({ after: lastRow, ym: ym3 });
  }
  ins.sort(function (a, b) { return b.after - a.after; });
  for (var q = 0; q < ins.length; q++) {
    var s2 = sum[ins[q].ym];
    sheet.insertRowAfter(ins[q].after);
    var rr = ins[q].after + 1;
    sheet.getRange(rr, 1).setValue(ins[q].ym.substring(0, 4));
    sheet.getRange(rr, 2).setValue(parseInt(ins[q].ym.substring(5, 7), 10) + '月結算');
    sheet.getRange(rr, 4).setValue(Math.round(s2.s));
    sheet.getRange(rr, 6).setValue(Math.round(s2.c));
    if (s2.f) sheet.getRange(rr, 7).setValue(Math.round(s2.f));
    if (pendNote_(s2)) sheet.getRange(rr, 15).setValue(pendNote_(s2));
  }
  say_('  ✅ 更正 ' + changed + ' 列金額、加註記 ' + noted + ' 列、新增 ' + ins.length + ' 列結算');
}

function fmt_(x) { return Utilities.formatString('%s', Math.round(Number(x) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

// ---------- 步驟 4：新增品牌、標記長期合作 ----------
function step4_新增品牌_() {
  say_('');
  say_('【步驟4】品牌資料庫');
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('團購品牌資料庫');
  if (!sheet) { say_('  ⚠ 找不到「團購品牌資料庫」分頁，跳過'); return; }
  var d = sheet.getDataRange().getValues();
  var header = d[0].map(function (h) { return String(h).trim(); });
  var iLong = header.indexOf('長期合作');
  if (iLong < 0) { say_('  ⚠ 找不到「長期合作」欄，請先照之前的步驟加欄位'); return; }
  var exist = {};
  for (var i = 1; i < d.length; i++) if (d[i][0]) exist[String(d[i][0]).trim()] = i + 1;

  var toAdd = [], toMark = [];
  for (var j = 0; j < NEW_BRANDS.length; j++)
    if (!exist[NEW_BRANDS[j][0]]) toAdd.push(NEW_BRANDS[j]);
  for (var id in exist) {
    var isNew = false;
    for (var k = 0; k < NEW_BRANDS.length; k++) if (NEW_BRANDS[k][0] === id) { isNew = true; break; }
    if (!isNew && String(d[exist[id] - 1][iLong] || '').trim() !== '是') toMark.push(id);
  }
  say_('  要新增品牌 ' + toAdd.length + ' 個（' + (toAdd.length ? toAdd[0][0] + ' ~ ' + toAdd[toAdd.length - 1][0] : '無') + '）');
  say_('  要標記長期合作 ' + toMark.length + ' 個既有品牌');
  if (DRY_RUN) { say_('  （試算模式，未寫入）'); return; }
  for (var m = 0; m < toMark.length; m++) sheet.getRange(exist[toMark[m]], iLong + 1).setValue('是');
  var now = new Date();
  var rowsOut = toAdd.map(function (b) {
    var row = new Array(header.length).fill('');
    row[0] = b[0]; row[2] = b[1]; row[7] = b[2]; row[8] = now; row[9] = now;
    return row;
  });
  if (rowsOut.length)
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsOut.length, header.length).setValues(rowsOut);
  say_('  ✅ 新增 ' + rowsOut.length + ' 個品牌、標記 ' + toMark.length + ' 個長期合作');
}

// ---------- 步驟 5：建立帳務試算表並寫入 ----------
function step5_建帳務表_(recs) {
  say_('');
  say_('【步驟5】建立「' + ACCOUNTING_TITLE + '」試算表');
  var HDR = ['紀錄ID', '日期', '品牌ID', '品牌金額分攤', '原始名稱', '同團延續', '廠商ID', '開票公司',
             '銷售金額', '分潤%', '分潤金額', '分潤說明', '稅外加', '稿酬', '狀態', '匯款去向',
             '匯款日期', '發票', '備註', '匯入註記'];
  say_('  將寫入 ' + recs.length + ' 筆 x ' + HDR.length + ' 欄');
  // 防呆：已經有同名檔案就不再建一個。同名的兩份帳務表事後根本分不出哪個是對的。
  var dup = DriveApp.getFilesByName(ACCOUNTING_TITLE);
  if (dup.hasNext()) {
    var f = dup.next();
    say_('  ⚠ 你的雲端硬碟已經有一個「' + ACCOUNTING_TITLE + '」了，為避免建出兩份同名檔案，這一步跳過。');
    say_('    既有檔案 ID：' + f.getId());
    say_('    如果那份是舊的、要重建，請先把它改名或丟到垃圾桶再跑一次。');
    return;
  }
  if (DRY_RUN) {
    say_('  （試算模式，不建立檔案）');
    say_('  前 3 筆預覽：');
    for (var i = 0; i < Math.min(3, recs.length); i++)
      say_('    ' + recs[i][0] + ' ' + recs[i][1] + ' ' + recs[i][2] + ' ' + recs[i][4] + ' 分潤=' + recs[i][10]);
    return;
  }
  var ss = SpreadsheetApp.create(ACCOUNTING_TITLE);
  var sh = ss.getActiveSheet();
  sh.setName('開團紀錄');
  sh.getRange(1, 1, 1, HDR.length).setValues([HDR]);
  sh.getRange(2, 1, recs.length, HDR.length).setValues(recs);
  sh.setFrozenRows(1);
  say_('  ✅ 已建立，請把下面這串 ID 給 Claude：');
  say_('  ' + ss.getId());
  say_('  網址：' + ss.getUrl());
}
// 廠商原始寫法 → 品牌ID（368 種寫法，已由使用者在對照表確認）
var BRAND_MAP = {
  "01初鹿保久乳": "B112",
  "01韓爸米餅": "B041",
  "173涼墊補貨團": "B113",
  "1月美姬饅頭": "B046",
  "2026 ASPOR手持風扇系列A01": "B015",
  "2angels": "B050",
  "ACE兒童機能軟糖": "B114",
  "ACE新年團": "B115",
  "ACE聖誕軟糖": "B116",
  "ACE軟糖": "B088",
  "ASPOR充電線製冷風扇": "B015",
  "ASPOR自拍及3C周邊": "B015",
  "Ace無糖軟糖": "B117",
  "Ace軟糖": "B088",
  "Airbebe兒童睡墊": "B118",
  "Apramo Flippa 攜帶式餐椅": "B119",
  "Ariati軟磁鐵": "B089",
  "Ariati軟磁鐵+QUUT": "B089",
  "Aribebe 幼兒園睡袋": "B020",
  "Aribebe 睡袋": "B020",
  "Aribebe兒童睡袋": "B020",
  "Arlin's調理機": "B120",
  "Aspor 3C": "B015",
  "Aspor 3C 快閃": "B015",
  "Aspor支架": "B015",
  "B21 Pro三麗鷗標籤機": "B017",
  "Bebe amico推車": "B121",
  "Bellebaby磁力積木": "B122",
  "Bonsons推車": "B044",
  "Bonsons方塊推車": "B044",
  "Bonson手推車": "B044",
  "Bruno電烤盤": "B045",
  "CURIOS 學習教材": "B123",
  "Classic world木製玩具": "B124",
  "Cyberbuy": "B125",
  "DIKE風扇": "B126",
  "Daiichi風扇涼墊": "B127",
  "Dauson lab": "B128",
  "Ed.inter": "B129",
  "Eyeup益智桌遊": "B130",
  "FUNY三麗鷗兒童相機": "B062",
  "FUNY製冷風扇": "B131",
  "Fabelab墨鏡": "B132",
  "Finish": "B133",
  "Floss&Rock": "B134",
  "Funny兒童相機": "B062",
  "G-Plus果汁機": "B135",
  "Giiker learning kid": "B136",
  "Globber推車": "B137",
  "HARU 寶可樂收袋": "B028",
  "HARU寶可樂收袋": "B028",
  "HiBebe米餅": "B090",
  "Hibebe": "B090",
  "IFind定位器": "B030",
  "Ianbaby": "B138",
  "JOLLY小熊旋轉書櫃": "B043",
  "JOLLY小熊旋轉書櫃【預購團】": "B043",
  "KOM 三色碗": "B023",
  "Kidmory 電動牙刷": "B022",
  "Kidmory電動牙刷": "B022",
  "Kids read點讀筆": "B139",
  "Kidsmory牙刷": "B022",
  "Kidsread 點讀筆": "B140",
  "Kidsread點讀筆": "B079",
  "Kigo 太陽眼鏡": "B018",
  "Kigo太陽眼鏡": "B018",
  "Kigo眼鏡": "B018",
  "Kinyo小圓鍋": "B141",
  "Kinyo飲水機": "B142",
  "Kokozi故事機": "B143",
  "LASSIG泳裝(廠商寄)": "B061",
  "LMG": "B034",
  "LMG不沾鍋": "B034",
  "LMG🍳": "B034",
  "LOHOY兒童雨傘": "B144",
  "LR益智桌遊+NL數學教具": "B145",
  "LaPo風扇": "B040",
  "Label Label Tryco木頭玩具": "B146",
  "Lassig泳裝": "B061",
  "Learning Resource 益智桌遊": "B029",
  "MNTL磁力片": "B091",
  "Magblox磁力片": "B092",
  "Mamarino姓名貼": "B147",
  "Mamarino水晶姓名貼": "B148",
  "Mideer": "B049",
  "Mideer 益智玩具/拼圖": "B049",
  "Mideer玩具": "B049",
  "Minitutu": "B149",
  "Monee": "B070",
  "Monee餐具": "B070",
  "Mongdies兒童防曬": "B013",
  "Mongdies物理防曬": "B013",
  "Mongdies防曬": "B013",
  "Mongdise防曬護膚": "B150",
  "Moulin Roty": "B093",
  "Moulin roty 故事手電筒": "B093",
  "Moyuum": "B071",
  "My creative box": "B151",
  "Nadle 腳踏車& Jolly 扭扭車": "B043",
  "OSter果汁機貼文": "B152",
  "Ooly+MCB+寶盒+絨球": "B153",
  "Oster氣炸烤箱": "B154",
  "PANASONIC電動牙刷": "B155",
  "Parakito 防蚊": "B051",
  "Parakito寶寶防蚊": "B051",
  "Parakito防蚊": "B051",
  "Partipost": "B094",
  "Pato Pato 遊戲地墊": "B016",
  "Pato Pato地墊": "B016",
  "Picaboo": "B031",
  "Picaboo 學習餐具": "B031",
  "Picaboo兒童餐具": "B031",
  "Plafarm 收納盒/櫃子/推車": "B156",
  "Plantoys": "B072",
  "Playtoys": "B157",
  "Poled": "B021",
  "Poled 風扇涼墊": "B021",
  "Poled風扇推車": "B021",
  "Preparation 沛樂生活保鮮盒": "B158",
  "Prepara保鮮盒": "B159",
  "Prepare保鮮盒": "B160",
  "QUUT": "B095",
  "QUUT玩水玩具": "B095",
  "Rico濕紙巾": "B161",
  "Runny yolk": "B162",
  "SB磁力片": "B163",
  "STEAM教具": "B164",
  "Science Baby磁吸積木\nSB磁力片": "B165",
  "Scoor&ride 滑步車": "B009",
  "Scoot&Ride 滑步車": "B009",
  "Scoot&Ride奧地利滑步車": "B009",
  "Silipot矽膠廚具": "B010",
  "Silipot矽膠用品": "B010",
  "Simple yet燕麥脆脆": "B097",
  "Simpleyet燕麥": "B166",
  "Stokke": "B014",
  "Stokke Jetkids騎行箱": "B014",
  "Trixie": "B012",
  "UBMOM 兒童水壺": "B056",
  "UBmom兒童水杯": "B056",
  "Ubmom": "B056",
  "Ubmom兒童水壺保溫杯": "B056",
  "Vespa電動車": "B167",
  "Wewee 乳液/防曬": "B168",
  "Wewee 無香乳液": "B169",
  "YAMADA電暖器": "B170",
  "Yaber 小影霸 投影機": "B019",
  "Yaber 小影霸投影機": "B019",
  "Yookidoo 洗澡玩具+Trixie": "B011",
  "Zip top矽膠袋": "B171",
  "ZuuTii廚房用品": "B096",
  "beaba調理機": "B172",
  "dyson洗地機": "B173",
  "evorie水杯": "B078",
  "iFind定位器": "B030",
  "ifind 定位器": "B030",
  "jellycat": "B174",
  "jolly推車": "B043",
  "kidsread點讀筆": "B079",
  "kolin 吸吸燙": "B026",
  "monee": "B070",
  "patopato 地墊": "B016",
  "patopato地墊": "B016",
  "plantoys": "B072",
  "simple yet燕麥": "B097",
  "【預購】日本麗克特泡泡給皂機A01": "B196",
  "ㄅㄆㄇ注音積木": "B175",
  "一噴淨": "B064",
  "一噴淨 (6/1開始算)": "B064",
  "一噴淨結算": "B064",
  "一家人洗沐": "B176",
  "三麗鷗兒童相機": "B177",
  "伯尼": "B025",
  "伯尼寢具": "B025",
  "保可樂收袋": "B028",
  "優迪泳具": "B178",
  "優迪防蚊": "B098",
  "兔比媽咪": "B005",
  "兔比媽咪/副食品": "B005",
  "兔比媽咪副食品": "B005",
  "兔比媽咪年菜": "B005",
  "兔比媽咪廚房": "B005",
  "冊子": "B058",
  "冊子年菜預購團": "B058",
  "冊子月餅禮盒": "B058",
  "冊子粽子預購": "B058",
  "初鹿": "B006",
  "初鹿保久乳": "B006",
  "午茶夫人": "B099",
  "卜蜜兒silipot": "B010",
  "卜蜜兒烤模": "B179",
  "卡多摩": "B180",
  "卡羅林益生菌": "B181",
  "卡蘿林益生菌": "B027",
  "卡蘿琳/豬軟糖/QQ凍": "B182",
  "卡蘿琳益生菌": "B027",
  "台東初鹿": "B006",
  "台東初鹿保久乳": "B006",
  "吃土標籤機": "B183",
  "唐太盅": "B067",
  "唐太盅燉湯": "B067",
  "大地之愛": "B184",
  "奧地利滑步車": "B080",
  "好日照": "B185",
  "好食道麥片": "B186",
  "媽媽友": "B053",
  "媽媽友美術用品": "B053",
  "學習塔": "B187",
  "安可保泡泡": "B039",
  "安可堡泡泡": "B039",
  "寶可樂收袋": "B028",
  "寶寶菓": "B188",
  "寶寶防曬": "B081",
  "小V鬆餅機": "B068",
  "小v鬆餅機": "B068",
  "小樽行李箱": "B082",
  "小樽行李箱/吸塵器/捲髮棒": "B082",
  "山水吸塵器": "B100",
  "島嶼生吐司": "B048",
  "帕洛防蚊": "B051",
  "年年姓名貼": "B008",
  "廣源良": "B189",
  "念念印刷": "B190",
  "愛兒館": "B052",
  "愛子伴桌": "B004",
  "愛波尚飲": "B191",
  "慢享清潔用品": "B192",
  "手機支架": "B101",
  "推車": "B102",
  "旋轉清潔刷": "B193",
  "日本新年禮盒": "B194",
  "日本青森蘋果汁+敲敲提拉米蘇": "B195",
  "日本麗克特": "B032",
  "日本麗克特全系列 漲價前(有三團)": "B083",
  "日本麗克特全系列A01": "B083",
  "日本麗克特全系列A02 漲價後(有三團)": "B083",
  "暖風機": "B197",
  "曠野文農": "B066",
  "曠野文農1團": "B066",
  "曠野文農2團": "B066",
  "曠野文農3團": "B066",
  "林貝兒": "B024",
  "林貝兒米餅": "B024",
  "林貝兒米餅NFC果汁": "B024",
  "柏工坊": "B198",
  "栢工坊印章": "B199",
  "梁心水產": "B200",
  "森林麵食": "B002",
  "樂天小熊置物籃": "B201",
  "樂夫人": "B073",
  "樂收袋": "B028",
  "樂比比": "B084",
  "樂比比kinyo風扇": "B084",
  "樂比比寶寶防曬": "B084",
  "標籤機": "B017",
  "歌林濾水壺": "B103",
  "毛寶 影片授權一年費用 (無團)": "B202",
  "毛寶 影片費用 (無團)": "B203",
  "水晶姓名貼": "B204",
  "水根行": "B205",
  "永圻魚湯": "B001",
  "永圻魚湯1團": "B001",
  "永圻魚湯2團": "B001",
  "注音積木": "B206",
  "洗衣機": "B207",
  "海濤客": "B208",
  "淨毒5郎清潔用品": "B209",
  "淨毒五郎": "B063",
  "清淨海": "B069",
  "清淨海洗衣球": "B069",
  "清淨海洗衣球  (快閃)": "B069",
  "清淨海洗衣球(25先開)": "B069",
  "渦輪扇": "B210",
  "滑步車": "B104",
  "滿意寶寶": "B105",
  "無團-合作兩本書": "B211",
  "燕麥脆脆": "B106",
  "特福不沾鍋": "B212",
  "猩猩之握": "B213",
  "玩具特價A+B": "B214",
  "玩具特價團": "B215",
  "發現茶": "B074",
  "百朗空氣清淨機": "B107",
  "益智桌遊教具": "B216",
  "盛光(慢磨機)": "B217",
  "磁力片": "B218",
  "磁力積木": "B219",
  "禾流": "B047",
  "禾流文創": "B047",
  "禾流文化": "B047",
  "禾流聖誕繪本": "B220",
  "童心好食館": "B221",
  "童蒔樂": "B055",
  "童蒔樂兒童燴料": "B055",
  "童蒔樂寶寶燴料": "B055",
  "童蒔樂燴廖": "B055",
  "童蒔樂（品牌結束最後團）": "B055",
  "精臣標籤機": "B017",
  "美姬": "B046",
  "美姬饅頭": "B046",
  "美姬饅頭 中秋節": "B046",
  "美姬饅頭 聖誕節": "B046",
  "美姬饅頭 萬聖節": "B046",
  "美姬饅頭(端午)": "B046",
  "胡同年菜": "B222",
  "胡同肉粽": "B223",
  "芍品軒": "B085",
  "花莯然茶包": "B224",
  "芳姿滴雞精": "B225",
  "芳滋滴雞精": "B226",
  "芳茲": "B086",
  "芳茲滴雞精": "B086",
  "芽比兔小馬桶": "B227",
  "芽比兔挖耳棒": "B108",
  "芽比兔挖耳棒馬桶": "B108",
  "藍海饌": "B065",
  "藍海饌牛肉麵": "B065",
  "蛋捲夾": "B228",
  "蝦皮": "B229",
  "製冷風扇": "B109",
  "製冷風扇A02": "B109",
  "谷溜谷溜": "B230",
  "豆油伯": "B110",
  "豆豆鮮生": "B231",
  "賽博購米餅": "B232",
  "賽博購鬆餅": "B233",
  "賽爸爸": "B003",
  "賽爸爸日韓精選補貨團": "B003",
  "賽爸爸日韓食品": "B003",
  "賽爸爸日韓食品史萊姆": "B003",
  "賽爸爸食品": "B003",
  "起司公爵": "B075",
  "醋覓": "B234",
  "防偷拍定位器": "B235",
  "防曬噴霧": "B236",
  "防曬快閃團": "B237",
  "降臨曆": "B238",
  "陶瓷電暖器A01": "B239",
  "雪坊": "B007",
  "雪坊優格": "B007",
  "雪坊優格13團": "B007",
  "雪坊優格14團": "B007",
  "雪坊優格15團": "B007",
  "雪坊優格16團": "B007",
  "雪坊優格1團": "B007",
  "雪坊優格2團": "B007",
  "雪坊優格3團": "B007",
  "雪坊優格4團": "B007",
  "雪紡優格": "B007",
  "青森蘋果汁": "B087",
  "韓商173（jellypop涼墊)": "B111",
  "韓商173（米餅）": "B111",
  "韓國Mongdies兒童防曬護理": "B013",
  "韓國磁力積木": "B240",
  "韓爸米餅": "B041",
  "風扇9月後台": "B241",
  "風扇A03": "B242",
  "飛利浦吹風機": "B243",
  "飛利浦壁掛暖風": "B244",
  "香草軟積木": "B245",
  "麗克特": "B032",
  "麗克特果汁機": "B076",
  "麗克特櫻花季": "B076",
  "麗克特系列": "B076",
  "麗克特調理機": "B076",
  "黃金盾": "B077",
  "黃金盾抗菌專家": "B077",
  "齒妍堂": "B033",
};

// 要新增的品牌：[品牌ID, 品牌名稱, 品牌備註]
var NEW_BRANDS = [
  ["B064", "一噴淨", "帳務原始寫法：一噴淨、一噴淨 (6/1開始算)、一噴淨結算"],
  ["B065", "藍海饌", "帳務原始寫法：藍海饌、藍海饌牛肉麵"],
  ["B066", "曠野文農", "帳務原始寫法：曠野文農、曠野文農1團、曠野文農2團、曠野文農3團"],
  ["B067", "唐太盅", "帳務原始寫法：唐太盅、唐太盅燉湯"],
  ["B068", "小v鬆餅機", "帳務原始寫法：小V鬆餅機、小v鬆餅機"],
  ["B069", "清淨海", "帳務原始寫法：清淨海、清淨海洗衣球、清淨海洗衣球  (快閃)、清淨海洗衣球(25先開)"],
  ["B070", "Monee", "帳務原始寫法：Monee、Monee餐具、monee"],
  ["B071", "Moyuum", ""],
  ["B072", "plantoys", "帳務原始寫法：Plantoys、plantoys"],
  ["B073", "樂夫人", ""],
  ["B074", "發現茶", ""],
  ["B075", "起司公爵", ""],
  ["B076", "麗克特", "帳務原始寫法：麗克特果汁機、麗克特櫻花季、麗克特系列、麗克特調理機"],
  ["B077", "黃金盾", "帳務原始寫法：黃金盾、黃金盾抗菌專家"],
  ["B078", "evorie水杯", ""],
  ["B079", "kidsread點讀筆", "帳務原始寫法：Kidsread點讀筆、kidsread點讀筆"],
  ["B080", "奧地利滑步車", ""],
  ["B081", "寶寶防曬", ""],
  ["B082", "小樽行李箱", "帳務原始寫法：小樽行李箱、小樽行李箱/吸塵器/捲髮棒"],
  ["B083", "日本麗克特全", "帳務原始寫法：日本麗克特全系列 漲價前(有三團)、日本麗克特全系列A01、日本麗克特全系列A02 漲價後(有三團)"],
  ["B084", "樂比比", "帳務原始寫法：樂比比、樂比比kinyo風扇、樂比比寶寶防曬"],
  ["B085", "芍品軒", ""],
  ["B086", "芳茲", "帳務原始寫法：芳茲、芳茲滴雞精"],
  ["B087", "青森蘋果汁", ""],
  ["B088", "Ace軟糖", "帳務原始寫法：ACE軟糖、Ace軟糖"],
  ["B089", "Ariati軟磁鐵", "帳務原始寫法：Ariati軟磁鐵、Ariati軟磁鐵+QUUT"],
  ["B090", "Hibebe", "帳務原始寫法：HiBebe米餅、Hibebe"],
  ["B091", "MNTL磁力片", ""],
  ["B092", "Magblox磁力片", ""],
  ["B093", "Moulin Roty", "帳務原始寫法：Moulin Roty、Moulin roty 故事手電筒"],
  ["B094", "Partipost", ""],
  ["B095", "QUUT", "帳務原始寫法：QUUT、QUUT玩水玩具"],
  ["B096", "ZuuTii廚房用品", ""],
  ["B097", "simple yet燕麥", "帳務原始寫法：Simple yet燕麥脆脆、simple yet燕麥"],
  ["B098", "優迪防蚊", ""],
  ["B099", "午茶夫人", ""],
  ["B100", "山水吸塵器", ""],
  ["B101", "手機支架", ""],
  ["B102", "推車", ""],
  ["B103", "歌林濾水壺", ""],
  ["B104", "滑步車", ""],
  ["B105", "滿意寶寶", ""],
  ["B106", "燕麥脆脆", ""],
  ["B107", "百朗空氣清淨機", ""],
  ["B108", "芽比兔挖耳棒", "帳務原始寫法：芽比兔挖耳棒、芽比兔挖耳棒馬桶"],
  ["B109", "製冷風扇", "帳務原始寫法：製冷風扇、製冷風扇A02"],
  ["B110", "豆油伯", ""],
  ["B111", "韓商173", "帳務原始寫法：韓商173（jellypop涼墊)、韓商173（米餅）"],
  ["B112", "01初鹿保久乳", ""],
  ["B113", "173涼墊", ""],
  ["B114", "ACE兒童機能軟糖", ""],
  ["B115", "ACE新年團", ""],
  ["B116", "ACE聖誕軟糖", ""],
  ["B117", "Ace無糖軟糖", ""],
  ["B118", "Airbebe兒童睡墊", ""],
  ["B119", "Apramo Flippa 攜帶式餐椅", ""],
  ["B120", "Arlin's調理機", ""],
  ["B121", "Bebe amico推車", ""],
  ["B122", "Bellebaby磁力積木", ""],
  ["B123", "CURIOS 學習教材", ""],
  ["B124", "Classic world木製玩具", ""],
  ["B125", "Cyberbuy", ""],
  ["B126", "DIKE風扇", ""],
  ["B127", "Daiichi風扇涼墊", ""],
  ["B128", "Dauson lab", ""],
  ["B129", "Ed.inter", ""],
  ["B130", "Eyeup益智桌遊", ""],
  ["B131", "FUNY製冷風扇", ""],
  ["B132", "Fabelab墨鏡", ""],
  ["B133", "Finish", ""],
  ["B134", "Floss&Rock", ""],
  ["B135", "G-Plus果汁機", ""],
  ["B136", "Giiker learning kid", ""],
  ["B137", "Globber推車", ""],
  ["B138", "Ianbaby", ""],
  ["B139", "Kids read點讀筆", ""],
  ["B140", "Kidsread 點讀筆", ""],
  ["B141", "Kinyo小圓鍋", ""],
  ["B142", "Kinyo飲水機", ""],
  ["B143", "Kokozi故事機", ""],
  ["B144", "LOHOY兒童雨傘", ""],
  ["B145", "LR益智桌遊+NL數學教具", ""],
  ["B146", "Label Label Tryco木頭玩具", ""],
  ["B147", "Mamarino姓名貼", ""],
  ["B148", "Mamarino水晶姓名貼", ""],
  ["B149", "Minitutu", ""],
  ["B150", "Mongdise防曬護膚", ""],
  ["B151", "My creative box", ""],
  ["B152", "OSter果汁機貼文", ""],
  ["B153", "Ooly+MCB+寶盒+絨球", ""],
  ["B154", "Oster氣炸烤箱", ""],
  ["B155", "PANASONIC電動牙刷", ""],
  ["B156", "Plafarm 收納盒/櫃子/推車", ""],
  ["B157", "Playtoys", ""],
  ["B158", "Preparation 沛樂生活保鮮盒", ""],
  ["B159", "Prepara保鮮盒", ""],
  ["B160", "Prepare保鮮盒", ""],
  ["B161", "Rico濕紙巾", ""],
  ["B162", "Runny yolk", ""],
  ["B163", "SB磁力片", ""],
  ["B164", "STEAM教具", ""],
  ["B165", "Science Baby磁吸積木 SB磁力片", ""],
  ["B166", "Simpleyet燕麥", ""],
  ["B167", "Vespa電動車", ""],
  ["B168", "Wewee 乳液/防曬", ""],
  ["B169", "Wewee 無香乳液", ""],
  ["B170", "YAMADA電暖器", ""],
  ["B171", "Zip top矽膠袋", ""],
  ["B172", "beaba調理機", ""],
  ["B173", "dyson洗地機", ""],
  ["B174", "jellycat", ""],
  ["B175", "ㄅㄆㄇ注音積木", ""],
  ["B176", "一家人洗沐", ""],
  ["B177", "三麗鷗兒童相機", ""],
  ["B178", "優迪泳具", ""],
  ["B179", "卜蜜兒烤模", ""],
  ["B180", "卡多摩", ""],
  ["B181", "卡羅林益生菌", ""],
  ["B182", "卡蘿琳/豬軟糖/QQ凍", ""],
  ["B183", "吃土標籤機", ""],
  ["B184", "大地之愛", ""],
  ["B185", "好日照", ""],
  ["B186", "好食道麥片", ""],
  ["B187", "學習塔", ""],
  ["B188", "寶寶菓", ""],
  ["B189", "廣源良", ""],
  ["B190", "念念印刷", ""],
  ["B191", "愛波尚飲", ""],
  ["B192", "慢享清潔用品", ""],
  ["B193", "旋轉清潔刷", ""],
  ["B194", "日本新年禮盒", ""],
  ["B195", "日本青森蘋果汁+敲敲提拉米蘇", ""],
  ["B196", "日本麗克特泡泡給皂機A01", ""],
  ["B197", "暖風機", ""],
  ["B198", "柏工坊", ""],
  ["B199", "栢工坊印章", ""],
  ["B200", "梁心水產", ""],
  ["B201", "樂天小熊置物籃", ""],
  ["B202", "毛寶 影片授權一年費用", ""],
  ["B203", "毛寶 影片費用", ""],
  ["B204", "水晶姓名貼", ""],
  ["B205", "水根行", ""],
  ["B206", "注音積木", ""],
  ["B207", "洗衣機", ""],
  ["B208", "海濤客", ""],
  ["B209", "淨毒5郎清潔用品", ""],
  ["B210", "渦輪扇", ""],
  ["B211", "無團-合作兩本書", ""],
  ["B212", "特福不沾鍋", ""],
  ["B213", "猩猩之握", ""],
  ["B214", "玩具特價A+B", ""],
  ["B215", "玩具特價團", ""],
  ["B216", "益智桌遊教具", ""],
  ["B217", "盛光", ""],
  ["B218", "磁力片", ""],
  ["B219", "磁力積木", ""],
  ["B220", "禾流聖誕繪本", ""],
  ["B221", "童心好食館", ""],
  ["B222", "胡同年菜", ""],
  ["B223", "胡同肉粽", ""],
  ["B224", "花莯然茶包", ""],
  ["B225", "芳姿滴雞精", ""],
  ["B226", "芳滋滴雞精", ""],
  ["B227", "芽比兔小馬桶", ""],
  ["B228", "蛋捲夾", ""],
  ["B229", "蝦皮", ""],
  ["B230", "谷溜谷溜", ""],
  ["B231", "豆豆鮮生", ""],
  ["B232", "賽博購米餅", ""],
  ["B233", "賽博購鬆餅", ""],
  ["B234", "醋覓", ""],
  ["B235", "防偷拍定位器", ""],
  ["B236", "防曬噴霧", ""],
  ["B237", "防曬團", ""],
  ["B238", "降臨曆", ""],
  ["B239", "陶瓷電暖器A01", ""],
  ["B240", "韓國磁力積木", ""],
  ["B241", "風扇9月後台", ""],
  ["B242", "風扇A03", ""],
  ["B243", "飛利浦吹風機", ""],
  ["B244", "飛利浦壁掛暖風", ""],
  ["B245", "香草軟積木", ""],
];