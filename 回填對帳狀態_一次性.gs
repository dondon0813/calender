// ============================================================
// 一次性：把「開團帳務」歷史紀錄的舊狀態（O 欄）換算成新的「對帳狀態」（W 欄）
//
// 背景：對帳狀態（W 欄）原本一路空白，雙流程對帳功能上線後，只有新資料會照
// 對帳流程走。576 筆歷史紀錄要照舊狀態、銷售金額、稿酬三個欄位反推該落在
// 哪個對帳階段。對帳狀態白名單見 Code.gs 的 ACCT_RECON_STATUSES，本檔只負責
// 回填 W 欄、不新增任何狀態字串，寫入值必須跟 Code.gs 逐字元一致。
//
// 規則（O 欄舊狀態 ACCT_STATUSES／I 欄銷售金額／N 欄稿酬）：
//   已入帳、未成團             → 維持空白（沒帳可對／不用對帳）
//   已請款                     → 等待匯款
//   待結算、進行中：
//     銷售金額有值（含 0，0 也是有人填過的）→ 待核對業績
//     銷售金額空、稿酬也空                    → 待回填
//     銷售金額空、稿酬有值                    → 不寫，記進「待人工判斷」清單
//   其他狀態值或空白狀態                       → 不寫，記進「異常狀態」清單
//
// ⚠️ 只處理 W 欄（RECON）目前為空白的列：已有值的一律跳過並計數，
//    所以這支腳本可以重複執行，不會覆蓋已經人工確認過的對帳狀態。
//
// 用法：先執行一次（此時 RECON_BACKFILL_DRY_RUN = true），看 Logger 報告；
//       確認無誤後把 RECON_BACKFILL_DRY_RUN 改成 false 再跑一次才會真的寫入。
//       用完把這個檔案刪掉。
// ============================================================

var RECON_BACKFILL_DRY_RUN = true;   // ← 確認報告沒問題後改成 false 才會真的寫入

function backfillReconStatus_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(RECON_BACKFILL_DRY_RUN ? '===== 試算模式（不會寫入任何資料）=====' : '===== 實際執行模式 =====');

  var sheet = SpreadsheetApp.openById(ACCOUNTING_SHEET_ID).getSheetByName(ACCOUNTING_SHEET_NAME);
  if (!sheet) throw new Error('找不到「' + ACCOUNTING_SHEET_NAME + '」分頁');
  var data = sheet.getDataRange().getValues();
  var total = data.length - 1;

  var hasValue = function (v) { return v !== '' && v !== null && v !== undefined; };
  function dateStr(v) {
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
    return String(v || '').trim();
  }

  var toWrite = [];        // { row, value }
  var skipped = 0;         // W 欄已有值，跳過
  var doneBlank = 0;       // 已入帳／未成團，維持空白
  var toManual = [];       // 待人工判斷：銷售空、稿酬有值
  var toAbnormal = [];     // 其他值或空白狀態

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var w = row[ACCT_COL.RECON - 1];
    if (hasValue(w)) { skipped++; continue; }

    var id = String(row[ACCT_COL.ID - 1] || '').trim();
    var rawName = String(row[ACCT_COL.RAW_NAME - 1] || '').trim();
    var date = row[ACCT_COL.DATE - 1];
    var status = String(row[ACCT_COL.STATUS - 1] || '').trim();
    var sales = row[ACCT_COL.SALES - 1];
    var fee = row[ACCT_COL.FEE - 1];
    var salesHas = hasValue(sales);
    var feeHas = hasValue(fee);

    if (status === '已入帳' || status === '未成團') {
      doneBlank++;
      continue;
    }
    if (status === '已請款') {
      toWrite.push({ row: i + 1, value: '等待匯款' });
      continue;
    }
    if (status === '待結算' || status === '進行中') {
      if (salesHas) {
        toWrite.push({ row: i + 1, value: '待核對業績' });
      } else if (!feeHas) {
        toWrite.push({ row: i + 1, value: '待回填' });
      } else {
        toManual.push({ id: id, rawName: rawName, date: dateStr(date) });
      }
      continue;
    }
    // 其他值或空白狀態（不在 ACCT_STATUSES 五種已知值裡）
    toAbnormal.push({ id: id, statusRaw: status, rawName: rawName });
  }

  // 依「下一步要寫的值」分組計數
  var writeCounts = {};
  toWrite.forEach(function (w2) { writeCounts[w2.value] = (writeCounts[w2.value] || 0) + 1; });

  say('');
  say('【分類統計】共 ' + total + ' 列');
  say('  跳過（W 欄已有值）：' + skipped);
  say('  維持空白（已入帳／未成團，完成／無帳可對）：' + doneBlank);
  Object.keys(writeCounts).forEach(function (k) {
    say('  → 「' + k + '」：' + writeCounts[k] + ' 筆');
  });
  say('  待人工判斷（銷售空、稿酬有值）：' + toManual.length);
  say('  異常狀態（不寫入）：' + toAbnormal.length);
  say('  ── 核對：' + skipped + ' + ' + doneBlank + ' + ' + toWrite.length + ' + ' + toManual.length + ' + ' + toAbnormal.length +
      ' = ' + (skipped + doneBlank + toWrite.length + toManual.length + toAbnormal.length) + '（應等於 ' + total + '）');

  if (toManual.length) {
    say('');
    say('【待人工判斷清單】銷售金額空白、但稿酬有值——不確定該當純稿酬案（審稿中）還是業績還沒填（待回填），人工看過再決定：');
    toManual.forEach(function (m) {
      say('    ' + m.id + '　' + m.date + '　' + m.rawName);
    });
  }

  if (toAbnormal.length) {
    say('');
    say('【異常狀態清單】O 欄狀態不在「未成團／進行中／待結算／已請款／已入帳」五種已知值裡，或是空白，無法判斷對帳階段：');
    toAbnormal.forEach(function (a) {
      say('    ' + a.id + '　狀態=「' + (a.statusRaw || '(空白)') + '」　' + a.rawName);
    });
  }

  if (RECON_BACKFILL_DRY_RUN) {
    say('');
    say('===== 試算結束，未寫入任何資料。確認報告沒問題後把 RECON_BACKFILL_DRY_RUN 改成 false 再跑一次 =====');
    return log.join('\n');
  }

  // 只碰 W 欄：整欄讀出來改、整欄寫回去，比逐格 setValue 快很多
  if (toWrite.length) {
    var col = sheet.getRange(2, ACCT_COL.RECON, data.length - 1, 1);
    var vals = col.getValues();
    toWrite.forEach(function (w3) { vals[w3.row - 2][0] = w3.value; });
    col.setValues(vals);
  }

  say('');
  say('===== 完成，已寫入 ' + toWrite.length + ' 筆對帳狀態 =====');
  return log.join('\n');
}
