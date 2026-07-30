// ============================================================
// 一次性：合併重複建檔的廠商 ＋ 補登開票抬頭別名
//
// 背景：
//   同一家公司會有兩筆廠商資料——一筆是使用者早期用「品牌名」手動建的，
//   一筆是 2026-07-29 匯入歷史帳時依「開票公司」自動建的。
//   例：V006 愛子伴桌（手動）與 V033 貝比富冷凍食品有限公司（自動）是同一家。
//   結果：品牌掛在 V006 底下，帳務卻掛在 V033，兩邊對不起來。
//
//   另外「一個廠商對多個開票抬頭」是常態（行銷公司自己開票 vs 幫品牌開品牌的抬頭），
//   那些抬頭要登記在廠商的「公司名稱」欄，之後依開票公司比對才認得是同一家。
//
// 做兩件事：
//   1. 合併 MERGE_JOBS 列的廠商：帳務廠商ID 改指、品牌所屬廠商改指、
//      別名與備註併過去、刪掉被併掉的那一列
//   2. 依 ALIAS_JOBS 補登開票抬頭到「公司名稱」欄（不動廠商筆數）
//
// ⚠️ 這支會同時改「後台表」和「開團帳務表」兩份試算表。
// 用法：先跑一次看報告（MERGE_DRY_RUN = true），確認後改成 false 再跑。
// ============================================================

var MERGE_DRY_RUN = true;   // ← 確認報告沒問題後改成 false

// 要合併的廠商：{ keep: 保留的廠商ID, merge: 要併掉的廠商ID, why: 理由 }
// keep 一律保留「看得懂是誰」的那一筆（通常是品牌名），被併掉的公司名會變成 keep 的抬頭別名。
var MERGE_JOBS = [
  { keep: 'V006', merge: 'V033', why: '愛子伴桌的團開票抬頭是貝比富，同一家' },
  { keep: 'V004', merge: 'V024', why: '森林麵食的團開票抬頭是唯進食品，同一家' }
];

// 只補「公司名稱」欄的抬頭別名（不新增也不刪除廠商）
// key = 廠商ID，值 = 要補進去的抬頭陣列
//
// 兩種都放在這裡，語意不同但作用一樣（讓比對認得）：
//   ・同一家的縮寫／全名／錯字 —— 例：雪坊＝雪坊優格的簡稱、雪紡＝錯字
//   ・行銷公司底下、由各品牌自己的廠商開的抬頭 —— 例：V011 吃土也要BUY 的
//     美姬饅頭走禾沐、B21pro 走寶媽咪／銳錡。這些抬頭本身也是獨立廠商，
//     一個抬頭同時登記在兩家名下是**刻意的**，因為那些團確實同時屬於兩邊。
//
// ⚠️ 沒放進來的（經使用者確認後刻意排除）：
//   ・V001 樂奎 ← 鼎珈國際／鼎珈：藍海饌 2025 以前是舊行銷公司鼎珈，2026 才改樂奎，
//     不是同一家，也不是樂奎底下開的票。
//   ・V010 朶玫黎 ← 宇羽國際：2024 早期單一團，抬頭不處理。
//   ・V012 精臣 ← 寶媽咪／銳錡／禾沐：B21pro 那幾團的開票方歸 V011 吃土也要BUY
//     （精臣是原廠品牌，不是開票方）。
var ALIAS_JOBS = {
  'V001': ['樂奎'],
  'V003': ['雪坊', '雪紡'],
  'V005': ['賽博購股份'],
  'V007': ['璟豐開發'],
  'V008': ['榛尼森國際有限公司'],
  'V011': ['禾沐', '禾沐生活', '寶媽咪', '銳錡有限公司'],
  'V013': ['朴蜜兒有限公司'],
  'V014': ['匯盛國際'],
  'V015': ['子熊'],
  'V017': ['杏豐'],
  'V018': ['淨毒五郎'],
  'V084': ['汎絡數位行銷']
};

// 品牌備註要補的說明（append 到既有備註後面，不覆蓋）。
// 用途：品牌換過行銷公司時，光看「所屬廠商」只會看到現在這家，
// 舊帳會被算到新廠商頭上而看不出原因。
var BRAND_NOTE_JOBS = {
  'B065': '2026 起改由樂奎（V001）承接；2025 以前的團是舊行銷公司鼎珈國際（V037）開票，' +
          '所以廠商統計裡樂奎會含到那 4 團（2024-09～2025-02）。'
};

// 廠商備註要補的說明（append 到既有備註後面，不覆蓋）。
// 用途：光看「公司名稱」欄只知道有這些抬頭，不知道哪個抬頭開的是哪一團。
var NOTE_JOBS = {
  'V011': '開票抬頭對應（2026-07 整理）：美姬饅頭走「禾沐／禾沐生活」（2024-10 起共 11 團）；' +
          'B21pro 標籤機每團抬頭不同——寶媽咪（2025-01-10、2025-05-12）、' +
          '銳錡有限公司（2025-10-22、2026-04-06）、禾沐（2026-06-26 三麗鷗聯名）。' +
          '這些抬頭都是各品牌自己的廠商，團本身都是吃土也要BUY 這家行銷公司底下的。'
};

var MERGE_ACCT_SHEET_ID = '1Ba9oFudDTqHP7qAjZPPqp8csrMfscUlXlPPUA9Qy7Ug';

function 廠商合併與別名補登_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(MERGE_DRY_RUN ? '===== 試算模式（不會寫入）=====' : '===== 實際執行 =====');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var vSheet = ss.getSheetByName('團購廠商資料庫');
  var bSheet = ss.getSheetByName('團購品牌資料庫');
  if (!vSheet) throw new Error('找不到「團購廠商資料庫」分頁');
  if (!bSheet) throw new Error('找不到「團購品牌資料庫」分頁');
  var aSheet = SpreadsheetApp.openById(MERGE_ACCT_SHEET_ID).getSheetByName('開團紀錄');
  if (!aSheet) throw new Error('找不到帳務表的「開團紀錄」分頁');

  var vData = vSheet.getDataRange().getValues();
  var vHead = vData[0].map(function (h) { return String(h).trim(); });
  var iVName = vHead.indexOf('廠商名稱');
  var iVComp = vHead.indexOf('公司名稱');
  var iVNote = vHead.indexOf('廠商備註');
  if (iVComp < 0) throw new Error('廠商表找不到「公司名稱」欄');

  var bData = bSheet.getDataRange().getValues();
  var bHead = bData[0].map(function (h) { return String(h).trim(); });
  var iBVendor = bHead.indexOf('所屬廠商ID');
  var iBName = bHead.indexOf('品牌名稱');
  if (iBVendor < 0) throw new Error('品牌表找不到「所屬廠商ID」欄');

  var aData = aSheet.getDataRange().getValues();
  var aHead = aData[0].map(function (h) { return String(h).trim(); });
  var iAVendor = aHead.indexOf('廠商ID');
  var iABrand = aHead.indexOf('品牌ID');
  var iAComp = aHead.indexOf('開票公司');
  if (iAVendor < 0) throw new Error('帳務表找不到「廠商ID」欄');

  // 廠商ID → 列號（1-based）
  var vRowOf = {};
  for (var i = 1; i < vData.length; i++) {
    var vid = String(vData[i][0]).trim();
    if (vid) vRowOf[vid] = i + 1;
  }

  // 抬頭字串 → 陣列（逗號／頓號都當分隔）
  function splitComps(s) {
    return String(s || '').split(/[,、，]/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x; });
  }

  // ---- 1. 合併 ----
  say('');
  say('【1】合併重複廠商');
  var vDeleteRows = [];          // 要刪的廠商列（最後由大到小刪，避免列號位移）
  var vWrites = [];              // { row, col, value }
  var bWrites = [];
  var aWrites = [];

  MERGE_JOBS.forEach(function (job) {
    var kRow = vRowOf[job.keep], mRow = vRowOf[job.merge];
    if (!kRow) { say('  ⚠ 找不到保留方 ' + job.keep + '，整組跳過'); return; }
    if (!mRow) { say('  ⚠ 找不到被併方 ' + job.merge + '，整組跳過（可能已經併過了）'); return; }

    var kName = String(vData[kRow - 1][iVName] || '').trim();
    var mName = String(vData[mRow - 1][iVName] || '').trim();
    say('  ' + job.merge + ' ' + mName + '  →  ' + job.keep + ' ' + kName + '（' + job.why + '）');

    // 1a. 抬頭別名：被併方的名稱＋它的公司名稱，全部併進保留方的「公司名稱」
    var comps = splitComps(vData[kRow - 1][iVComp]);
    var add = [mName].concat(splitComps(vData[mRow - 1][iVComp]));
    add.forEach(function (c) {
      if (c && comps.indexOf(c) === -1 && c !== kName) comps.push(c);
    });
    vWrites.push({ row: kRow, col: iVComp + 1, value: comps.join(',') });
    say('     公司名稱 → ' + comps.join(','));

    // 1b. 備註：被併方有寫東西才併，加註來源避免以後看不懂
    if (iVNote >= 0) {
      var mNote = String(vData[mRow - 1][iVNote] || '').trim();
      if (mNote) {
        var kNote = String(vData[kRow - 1][iVNote] || '').trim();
        var merged = (kNote ? kNote + ' / ' : '') + '（併自 ' + job.merge + ' ' + mName + '）' + mNote;
        vWrites.push({ row: kRow, col: iVNote + 1, value: merged });
        say('     備註併入：' + mNote);
      }
    }

    // 1c. 品牌的所屬廠商改指到保留方
    for (var bi = 1; bi < bData.length; bi++) {
      var ids = splitComps(bData[bi][iBVendor]);
      if (ids.indexOf(job.merge) === -1) continue;
      var newIds = [];
      ids.forEach(function (id) {
        var to = (id === job.merge) ? job.keep : id;
        if (newIds.indexOf(to) === -1) newIds.push(to);
      });
      bWrites.push({ row: bi + 1, col: iBVendor + 1, value: newIds.join(',') });
      say('     品牌 ' + String(bData[bi][0]) + ' ' + String(bData[bi][iBName] || '') +
          ' 所屬廠商 ' + ids.join(',') + ' → ' + newIds.join(','));
    }

    // 1d. 帳務的廠商ID 改指到保留方
    var n = 0;
    for (var ai = 1; ai < aData.length; ai++) {
      if (String(aData[ai][iAVendor]).trim() !== job.merge) continue;
      aWrites.push({ row: ai + 1, col: iAVendor + 1, value: job.keep });
      n++;
    }
    say('     帳務 ' + n + ' 筆的廠商ID → ' + job.keep);

    vDeleteRows.push({ row: mRow, id: job.merge, name: mName });
  });

  // ---- 2. 補登抬頭別名 ----
  say('');
  say('【2】補登開票抬頭到「公司名稱」欄');
  Object.keys(ALIAS_JOBS).forEach(function (vid) {
    var row = vRowOf[vid];
    if (!row) { say('  ⚠ 找不到 ' + vid + '，跳過'); return; }
    var name = String(vData[row - 1][iVName] || '').trim();
    // 這一列可能在【1】已經被排進 vWrites（保留方），要接在那個結果後面而不是覆蓋掉
    var pending = null;
    vWrites.forEach(function (w) { if (w.row === row && w.col === iVComp + 1) pending = w; });
    var comps = splitComps(pending ? pending.value : vData[row - 1][iVComp]);
    var added = [];
    ALIAS_JOBS[vid].forEach(function (c) {
      c = String(c).trim();
      if (c && comps.indexOf(c) === -1 && c !== name) { comps.push(c); added.push(c); }
    });
    if (!added.length) { say('  ' + vid + ' ' + name + '：都已登記，略過'); return; }
    say('  ' + vid + ' ' + name + ' 補上：' + added.join('、'));
    if (pending) pending.value = comps.join(',');
    else vWrites.push({ row: row, col: iVComp + 1, value: comps.join(',') });
  });

  // ---- 3. 補廠商備註 ----
  say('');
  say('【3】補廠商備註（哪個抬頭開的是哪一團）');
  if (iVNote < 0) {
    say('  ⚠ 廠商表找不到「廠商備註」欄，整段跳過');
  } else {
    Object.keys(NOTE_JOBS).forEach(function (vid) {
      var row = vRowOf[vid];
      if (!row) { say('  ⚠ 找不到 ' + vid + '，跳過'); return; }
      var name = String(vData[row - 1][iVName] || '').trim();
      var pending = null;
      vWrites.forEach(function (w) { if (w.row === row && w.col === iVNote + 1) pending = w; });
      var cur = String(pending ? pending.value : (vData[row - 1][iVNote] || '')).trim();
      if (cur.indexOf(NOTE_JOBS[vid]) !== -1) { say('  ' + vid + ' ' + name + '：備註已存在，略過'); return; }
      var merged = (cur ? cur + ' / ' : '') + NOTE_JOBS[vid];
      if (pending) pending.value = merged;
      else vWrites.push({ row: row, col: iVNote + 1, value: merged });
      say('  ' + vid + ' ' + name + ' 備註 → ' + merged);
    });
  }

  // ---- 3b. 補品牌備註 ----
  say('');
  say('【3b】補品牌備註（換過行銷公司的說明）');
  var iBNote = bHead.indexOf('品牌備註');
  if (iBNote < 0) {
    say('  ⚠ 品牌表找不到「品牌備註」欄，整段跳過');
  } else {
    var bRowOf = {};
    for (var bj = 1; bj < bData.length; bj++) {
      var bid2 = String(bData[bj][0]).trim();
      if (bid2) bRowOf[bid2] = bj + 1;
    }
    Object.keys(BRAND_NOTE_JOBS).forEach(function (bid) {
      var row = bRowOf[bid];
      if (!row) { say('  ⚠ 找不到品牌 ' + bid + '，跳過'); return; }
      var nm = String(bData[row - 1][iBName] || '').trim();
      var cur = String(bData[row - 1][iBNote] || '').trim();
      if (cur.indexOf(BRAND_NOTE_JOBS[bid]) !== -1) { say('  ' + bid + ' ' + nm + '：備註已存在，略過'); return; }
      var merged2 = (cur ? cur + ' / ' : '') + BRAND_NOTE_JOBS[bid];
      bWrites.push({ row: row, col: iBNote + 1, value: merged2 });
      say('  ' + bid + ' ' + nm + ' 備註 → ' + merged2);
    });
  }

  // ---- 4. 寫入 ----
  say('');
  say('【4】異動統計');
  say('  廠商表寫入 ' + vWrites.length + ' 格、刪除 ' + vDeleteRows.length + ' 列');
  say('  品牌表寫入 ' + bWrites.length + ' 格');
  say('  帳務表寫入 ' + aWrites.length + ' 格');

  if (MERGE_DRY_RUN) {
    say('');
    say('===== 試算結束，沒有寫入任何東西 =====');
    say('確認以上內容沒問題後，把檔案最上面的 MERGE_DRY_RUN 改成 false 再跑一次。');
    return log.join('\n');
  }

  vWrites.forEach(function (w) { vSheet.getRange(w.row, w.col).setValue(w.value); });
  bWrites.forEach(function (w) { bSheet.getRange(w.row, w.col).setValue(w.value); });
  aWrites.forEach(function (w) { aSheet.getRange(w.row, w.col).setValue(w.value); });

  // 刪列一定要由下往上，不然刪完上面那列、下面的列號就全部往上跑一格
  vDeleteRows.sort(function (a, b) { return b.row - a.row; });
  vDeleteRows.forEach(function (d) {
    vSheet.deleteRow(d.row);
    say('  已刪除廠商 ' + d.id + ' ' + d.name);
  });

  say('');
  say('===== 完成 =====');
  return log.join('\n');
}
