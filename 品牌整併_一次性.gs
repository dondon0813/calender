// ============================================================
// 一次性：品牌整併＋資料修正（使用者已逐項確認過的清單）
//
// 做五件事（資料表在檔案最下面，對應 A~E）：
//   A. 38 組品牌合併（來源→正典）：帳務品牌ID重指、正典補備註（含帳務原始寫法搬移）、
//      去背小圖／品牌圖片／蝦皮連結由來源補進正典的空欄、分潤%與分潤說明差異只報告不寫、
//      刪來源品牌列。另有 4 筆「單獨帳務改指」（不是整團併，只改那一筆的品牌ID）。
//      B60（注意 id 就是「B60」不是「B060」）：帳務無引用才刪除品牌列。
//   B. 9 個品牌改名（合併後才執行，因為改名要改在正典身上）。
//   C. 個別品牌欄位修正（所屬廠商ID／品牌備註 append／已結束合作）。
//   D. 帳務開票公司清理：錯字「黎子熊」→「梨子熊」；7 種雜訊值搬進備註欄後清空開票公司。
//      另外 R0535 的「原始名稱」單獨改字。
//   E. 廠商修正：V008 公司名稱補別名；V082 帳務／品牌都無引用才刪除廠商列。
//
// 寫入順序（重要）：
//   1. 帳務重指（品牌ID重指／單筆改指／R0535原始名稱／開票公司typo／開票公司→備註搬移）
//   2. 品牌／廠商欄位、備註、改名（不刪列）
//   3. 刪列（品牌列、廠商列），一定由下往上刪，且用執行前就讀好的原始列號
//
// 重跑安全：
//   - 帳務品牌ID若已經是目標值就跳過（不重複重指）。
//   - 品牌備註已含該來源 id 的併入標記、或已含帳務原始寫法內容，就不重複 append。
//   - 開票公司欄清空後，D 段的清理條件不會再成立，天然不會重跑。
//   - 品牌改名／欄位修正若目前值已等於目標值就跳過。
//   - 找不到預期的品牌/帳務列（例如已被前次執行處理掉）→ 跳過並列入報告，不中止。
//
// 用法：先執行一次（MERGE_DRY_RUN = true），看 Logger 報告；
//       確認無誤後把 MERGE_DRY_RUN 改成 false 再跑一次才會真的寫入。
//       用完把這個檔案刪掉。
// ============================================================

var MERGE_DRY_RUN = true;   // ← 確認報告沒問題後改成 false 才會真的寫入

function mergeBrands_ONETIME() {
  var log = [];
  function say(s) { log.push(s); Logger.log(s); }
  say(MERGE_DRY_RUN ? '===== 試算模式（不會寫入任何資料）=====' : '===== 實際執行模式 =====');

  var hasValue = function (v) { return v !== '' && v !== null && v !== undefined; };
  var trim = function (v) { return String(v == null ? '' : v).trim(); };

  // ---------- 讀表 ----------
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var brandSheet = ss.getSheetByName(BRAND_DB_SHEET_NAME);
  var vendorSheet = ss.getSheetByName(VENDOR_DB_SHEET_NAME);
  if (!brandSheet) throw new Error('找不到「' + BRAND_DB_SHEET_NAME + '」分頁');
  if (!vendorSheet) throw new Error('找不到「' + VENDOR_DB_SHEET_NAME + '」分頁');
  var acctSheet = SpreadsheetApp.openById(ACCOUNTING_SHEET_ID).getSheetByName(ACCOUNTING_SHEET_NAME);
  if (!acctSheet) throw new Error('找不到「' + ACCOUNTING_SHEET_NAME + '」分頁（帳務表）');

  var bData = brandSheet.getDataRange().getValues();
  var bHeader = bData[0].map(function (h) { return String(h).trim(); });
  function bCol(name) {
    var idx = bHeader.indexOf(name);
    if (idx < 0) throw new Error('「' + BRAND_DB_SHEET_NAME + '」找不到「' + name + '」欄，表頭可能被改過');
    return idx;
  }
  var B = {
    ID: bCol('id'), VENDOR: bCol('所屬廠商ID'), NAME: bCol('品牌名稱'), THUMB: bCol('去背小圖'),
    NOTE: bCol('品牌備註'), UPDATED: bCol('更新時間'), IMAGE: bCol('品牌圖片'), SHOPEE: bCol('蝦皮連結'),
    RATE: bCol('分潤%'), RATE_NOTE: bCol('分潤說明'), ENDED: bCol('已結束合作')
  };

  var vData = vendorSheet.getDataRange().getValues();
  var vHeader = vData[0].map(function (h) { return String(h).trim(); });
  function vCol(name) {
    var idx = vHeader.indexOf(name);
    if (idx < 0) throw new Error('「' + VENDOR_DB_SHEET_NAME + '」找不到「' + name + '」欄，表頭可能被改過');
    return idx;
  }
  var V = { ID: vCol('id'), COMPANY: vCol('公司名稱'), UPDATED: vCol('更新時間') };

  var aData = acctSheet.getDataRange().getValues();

  function rowOf(data, colIdx) {
    var map = {};
    for (var i = 1; i < data.length; i++) {
      var id = trim(data[i][colIdx]);
      if (id) map[id] = i + 1; // 1-based 試算表列號
    }
    return map;
  }
  var brandRowOf = rowOf(bData, B.ID);
  var vendorRowOf = rowOf(vData, V.ID);

  var warnings = [];

  // ============================================================
  // 【規劃 1】帳務重指：品牌ID重指／單筆改指／R0535原始名稱／開票公司typo／開票公司→備註
  // ============================================================
  var reassignPlan = [];      // { row, recId, from, to, via }
  var acctSkip = 0;           // 已經是目標值，跳過
  var effectiveBrand = {};    // row → 這次跑完之後「有效」的品牌ID（給 B60 引用檢查用）
  var nameFixPlan = null;     // R0535
  var typoPlan = [];          // 開票公司「黎子熊」→「梨子熊」
  var toNotePlan = [];        // 開票公司雜訊值 → 搬進備註後清空
  var seenAcctIds = {};

  var INVOICE_TO_NOTE_SET = {};
  INVOICE_TO_NOTE_VALUES.forEach(function (v) { INVOICE_TO_NOTE_SET[v] = true; });

  for (var i = 1; i < aData.length; i++) {
    var recId = trim(aData[i][ACCT_COL.ID - 1]);
    if (!recId) continue;
    seenAcctIds[recId] = true;
    var row = i + 1;
    var curBrand = trim(aData[i][ACCT_COL.BRAND_ID - 1]);
    var curCompany = trim(aData[i][ACCT_COL.COMPANY - 1]);
    var curNote = trim(aData[i][ACCT_COL.NOTE - 1]);
    var curRawName = trim(aData[i][ACCT_COL.RAW_NAME - 1]);

    // -- 品牌ID重指：單筆改指優先，其次一般合併表 --
    effectiveBrand[row] = curBrand;
    if (Object.prototype.hasOwnProperty.call(SINGLE_RECORD_REASSIGN, recId)) {
      var target = SINGLE_RECORD_REASSIGN[recId];
      if (curBrand === target) {
        acctSkip++;
      } else {
        reassignPlan.push({ row: row, recId: recId, from: curBrand, to: target, via: '單筆改指' });
        effectiveBrand[row] = target;
      }
    } else if (Object.prototype.hasOwnProperty.call(BRAND_MERGE_MAP, curBrand)) {
      var target2 = BRAND_MERGE_MAP[curBrand];
      reassignPlan.push({ row: row, recId: recId, from: curBrand, to: target2, via: '合併表' });
      effectiveBrand[row] = target2;
    }

    // -- R0535 原始名稱 --
    if (recId === SINGLE_ACCT_NAME_FIX.id) {
      if (curRawName !== SINGLE_ACCT_NAME_FIX.newRawName) {
        nameFixPlan = { row: row, recId: recId, from: curRawName, to: SINGLE_ACCT_NAME_FIX.newRawName };
      }
    }

    // -- 開票公司 typo --
    if (curCompany === INVOICE_TYPO.from) {
      typoPlan.push({ row: row, recId: recId });
    }

    // -- 開票公司雜訊值 → 搬進備註、清空 --
    if (Object.prototype.hasOwnProperty.call(INVOICE_TO_NOTE_SET, curCompany)) {
      var alreadyHas = curNote.indexOf(curCompany) >= 0;
      toNotePlan.push({ row: row, recId: recId, value: curCompany, alreadyInNote: alreadyHas });
    }
  }

  if (!seenAcctIds[SINGLE_ACCT_NAME_FIX.id]) warnings.push('帳務找不到 ' + SINGLE_ACCT_NAME_FIX.id + '（R0535 原始名稱修正）');
  Object.keys(SINGLE_RECORD_REASSIGN).forEach(function (id) {
    if (!seenAcctIds[id]) warnings.push('帳務找不到 ' + id + '（單筆品牌改指）');
  });

  say('');
  say('【1】帳務重指');
  say('  品牌ID重指：' + reassignPlan.length + ' 筆（已是目標值跳過 ' + acctSkip + ' 筆）');
  reassignPlan.forEach(function (p) {
    say('    ' + p.recId + '　' + (p.from || '(空白)') + ' → ' + p.to + '　[' + p.via + ']');
  });
  say('  R0535 原始名稱：' + (nameFixPlan ? ('「' + nameFixPlan.from + '」→「' + nameFixPlan.to + '」') : '（已是目標值或找不到，跳過）'));
  say('  開票公司「' + INVOICE_TYPO.from + '」→「' + INVOICE_TYPO.to + '」：' + typoPlan.length + ' 筆　' +
      typoPlan.map(function (p) { return p.recId; }).join('、'));
  say('  開票公司雜訊值 → 搬進備註後清空：' + toNotePlan.length + ' 筆');
  toNotePlan.forEach(function (p) {
    say('    ' + p.recId + '　「' + p.value + '」' + (p.alreadyInNote ? '（備註已含此字串，只清空開票公司）' : '（append 進備註＋清空開票公司）'));
  });

  // ============================================================
  // 【規劃 2A】品牌合併：正典補備註／欄位搬移／分潤差異報告／標記來源列待刪
  // ============================================================
  var mergeActions = [];        // { src, canonical, srcRow, canonicalRow, noteAdds:[], fieldMoves:[{col,label,value}] }
  var deleteBrandRows = {};     // row(number) → 原因
  var rateDiffs = [];           // { src, canonical, field, srcVal, canVal }
  var fieldDiffs = [];          // { src, canonical, field, srcVal, canVal }

  var MOVE_FIELDS = [
    { col: B.THUMB, label: '去背小圖' },
    { col: B.IMAGE, label: '品牌圖片' },
    { col: B.SHOPEE, label: '蝦皮連結' }
  ];

  Object.keys(BRAND_MERGE_MAP).forEach(function (src) {
    var canonical = BRAND_MERGE_MAP[src];
    var srcRow = brandRowOf[src];
    var canonicalRow = brandRowOf[canonical];
    if (!srcRow) { warnings.push('品牌合併：來源 ' + src + ' 找不到，跳過（可能已被前次執行處理掉）'); return; }
    if (!canonicalRow) { warnings.push('品牌合併：正典 ' + canonical + ' 找不到，' + src + ' 無法併入，跳過'); return; }

    var srcVals = bData[srcRow - 1];
    var canVals = bData[canonicalRow - 1];
    var srcName = trim(srcVals[B.NAME]);
    var canNote = trim(canVals[B.NOTE]);
    var srcNote = trim(srcVals[B.NOTE]);

    var noteAdds = [];
    var marker = '[' + src + ']';
    if (canNote.indexOf(marker) < 0) {
      noteAdds.push('（併入：' + srcName + marker + '）');
    }
    var writeIdx = srcNote.indexOf('帳務原始寫法：');
    if (writeIdx >= 0) {
      var extracted = srcNote.substring(writeIdx);
      if (canNote.indexOf(extracted) < 0) noteAdds.push(extracted);
    }

    var fieldMoves = [];
    MOVE_FIELDS.forEach(function (f) {
      var srcV = srcVals[f.col], canV = canVals[f.col];
      if (hasValue(srcV) && !hasValue(canV)) {
        fieldMoves.push({ col: f.col, label: f.label, value: srcV });
      } else if (hasValue(srcV) && hasValue(canV) && trim(srcV) !== trim(canV)) {
        fieldDiffs.push({ src: src, canonical: canonical, field: f.label, srcVal: srcV, canVal: canV });
      }
    });

    if (hasValue(srcVals[B.RATE]) && trim(srcVals[B.RATE]) !== trim(canVals[B.RATE])) {
      rateDiffs.push({ src: src, canonical: canonical, field: '分潤%', srcVal: srcVals[B.RATE], canVal: canVals[B.RATE] });
    }
    if (hasValue(srcVals[B.RATE_NOTE]) && trim(srcVals[B.RATE_NOTE]) !== trim(canVals[B.RATE_NOTE])) {
      rateDiffs.push({ src: src, canonical: canonical, field: '分潤說明', srcVal: srcVals[B.RATE_NOTE], canVal: canVals[B.RATE_NOTE] });
    }

    mergeActions.push({ src: src, canonical: canonical, srcRow: srcRow, canonicalRow: canonicalRow, noteAdds: noteAdds, fieldMoves: fieldMoves });
    deleteBrandRows[srcRow] = '併入 ' + canonical;
  });

  say('');
  say('【2A】品牌合併（' + Object.keys(BRAND_MERGE_MAP).length + ' 組）');
  mergeActions.forEach(function (m) {
    say('  ' + m.src + ' → ' + m.canonical +
        (m.noteAdds.length ? '　備註+' + m.noteAdds.length + '段' : '') +
        (m.fieldMoves.length ? '　搬欄位：' + m.fieldMoves.map(function (f) { return f.label; }).join('、') : ''));
  });
  if (fieldDiffs.length) {
    say('  ── 欄位差異（正典已有值，不覆蓋，僅供人工複查）：');
    fieldDiffs.forEach(function (d) {
      say('    ' + d.src + '→' + d.canonical + '　' + d.field + '　來源=「' + d.srcVal + '」　正典=「' + d.canVal + '」');
    });
  }
  if (rateDiffs.length) {
    say('  ── 分潤差異（一律保留正典值，不寫入，僅列報告）：');
    rateDiffs.forEach(function (d) {
      say('    ' + d.src + '→' + d.canonical + '　' + d.field + '　來源=「' + d.srcVal + '」　正典=「' + d.canVal + '」');
    });
  }

  // ============================================================
  // 【規劃 2B】品牌改名
  // ============================================================
  var renamePlan = [];
  Object.keys(BRAND_RENAME_MAP).forEach(function (id) {
    var row = brandRowOf[id];
    if (!row) { warnings.push('品牌改名：找不到 ' + id + '，跳過'); return; }
    var curName = trim(bData[row - 1][B.NAME]);
    var target = BRAND_RENAME_MAP[id];
    if (curName === target) return; // 已是目標值，重跑安全
    renamePlan.push({ id: id, row: row, from: curName, to: target });
  });

  say('');
  say('【2B】品牌改名（' + Object.keys(BRAND_RENAME_MAP).length + ' 個，已是目標值的不列）');
  renamePlan.forEach(function (r) { say('  ' + r.id + '　「' + r.from + '」→「' + r.to + '」'); });

  // ============================================================
  // 【規劃 2C】個別品牌欄位修正
  // ============================================================
  var fieldFixPlan = [];
  BRAND_FIELD_FIXES.forEach(function (fx) {
    var row = brandRowOf[fx.id];
    if (!row) { warnings.push('品牌欄位修正：找不到 ' + fx.id + '，跳過'); return; }
    var actions = {};
    if (fx.vendorId !== undefined) {
      var curVendor = trim(bData[row - 1][B.VENDOR]);
      if (curVendor !== fx.vendorId) actions.vendorId = fx.vendorId;
    }
    if (fx.noteAppend !== undefined) {
      var curNote2 = trim(bData[row - 1][B.NOTE]);
      if (curNote2.indexOf(fx.noteAppend) < 0) actions.noteAppend = fx.noteAppend;
    }
    if (fx.ended) {
      var curEnded = trim(bData[row - 1][B.ENDED]);
      if (curEnded !== '是') actions.ended = '是';
    }
    if (Object.keys(actions).length) fieldFixPlan.push({ id: fx.id, row: row, actions: actions });
  });

  say('');
  say('【2C】個別品牌欄位修正');
  fieldFixPlan.forEach(function (f) {
    var parts = [];
    if (f.actions.vendorId !== undefined) parts.push('所屬廠商ID→' + f.actions.vendorId);
    if (f.actions.noteAppend !== undefined) parts.push('備註+「' + f.actions.noteAppend + '」');
    if (f.actions.ended !== undefined) parts.push('已結束合作→是');
    say('  ' + f.id + '　' + parts.join('；'));
  });

  // ============================================================
  // 【規劃 2E】廠商修正：V008 補別名
  // ============================================================
  var vendorAliasPlan = null;
  var v008Row = vendorRowOf[VENDOR_ALIAS_APPEND.vendorId];
  if (!v008Row) {
    warnings.push('廠商修正：找不到 ' + VENDOR_ALIAS_APPEND.vendorId + '，跳過補別名');
  } else {
    var v008Company = trim(vData[v008Row - 1][V.COMPANY]);
    if (v008Company.indexOf(VENDOR_ALIAS_APPEND.checkSubstring) < 0) {
      var newCompany = v008Company ? v008Company + ',' + VENDOR_ALIAS_APPEND.appendValue : VENDOR_ALIAS_APPEND.appendValue;
      vendorAliasPlan = { row: v008Row, from: v008Company, to: newCompany };
    }
  }

  say('');
  say('【2E】廠商修正');
  say('  ' + VENDOR_ALIAS_APPEND.vendorId + ' 補別名：' +
      (vendorAliasPlan ? ('「' + vendorAliasPlan.from + '」→「' + vendorAliasPlan.to + '」') : '（已含「' + VENDOR_ALIAS_APPEND.checkSubstring + '」或找不到廠商，跳過）'));

  // ============================================================
  // 【規劃 3】刪列：B60（帳務無引用才刪）／V082（帳務與品牌都無引用才刪）
  // ============================================================
  var b60Row = brandRowOf[BRAND_DELETE_IF_UNUSED];
  var b60Refs = [];
  if (b60Row) {
    Object.keys(effectiveBrand).forEach(function (r) {
      if (effectiveBrand[r] === BRAND_DELETE_IF_UNUSED) {
        var idx = Number(r) - 1;
        b60Refs.push(trim(aData[idx][ACCT_COL.ID - 1]));
      }
    });
    if (b60Refs.length === 0) {
      deleteBrandRows[b60Row] = BRAND_DELETE_IF_UNUSED + ' 無引用，刪除';
    } else {
      warnings.push(BRAND_DELETE_IF_UNUSED + ' 仍被帳務引用（' + b60Refs.join('、') + '），不刪除，請人工複查');
    }
  } else {
    warnings.push('找不到品牌 ' + BRAND_DELETE_IF_UNUSED + '（可能已被前次執行刪除）');
  }

  var v082Row = vendorRowOf[VENDOR_DELETE_IF_UNUSED];
  var v082BrandRefs = [], v082AcctRefs = [];
  if (v082Row) {
    for (var bi = 1; bi < bData.length; bi++) {
      var bRow = bi + 1;
      if (deleteBrandRows[bRow]) continue; // 這列這次會被刪掉，不算引用
      var vendorIds = trim(bData[bi][B.VENDOR]).split(',').map(function (s) { return s.trim(); });
      if (vendorIds.indexOf(VENDOR_DELETE_IF_UNUSED) >= 0) v082BrandRefs.push(trim(bData[bi][B.ID]));
    }
    for (var ai = 1; ai < aData.length; ai++) {
      if (trim(aData[ai][ACCT_COL.VENDOR_ID - 1]) === VENDOR_DELETE_IF_UNUSED) {
        v082AcctRefs.push(trim(aData[ai][ACCT_COL.ID - 1]));
      }
    }
    if (v082BrandRefs.length === 0 && v082AcctRefs.length === 0) {
      // 標記待刪，實際刪除在下面執行區
    } else {
      warnings.push(VENDOR_DELETE_IF_UNUSED + ' 仍被引用（品牌：' + v082BrandRefs.join('、') + '；帳務：' + v082AcctRefs.join('、') + '），不刪除，請人工複查');
    }
  } else {
    warnings.push('找不到廠商 ' + VENDOR_DELETE_IF_UNUSED + '（可能已被前次執行刪除）');
  }
  var v082Deletable = !!(v082Row && v082BrandRefs.length === 0 && v082AcctRefs.length === 0);

  say('');
  say('【3】刪列');
  say('  ' + BRAND_DELETE_IF_UNUSED + '：' + (deleteBrandRows[b60Row] ? '確認無引用，會刪除' : '不刪除（見上方警告或已不存在）'));
  say('  ' + VENDOR_DELETE_IF_UNUSED + '：' + (v082Deletable ? '確認無引用，會刪除' : '不刪除（見上方警告或已不存在）'));
  say('  品牌列總計待刪：' + Object.keys(deleteBrandRows).length + ' 列（含 ' + mergeActions.length + ' 個併入來源' + (deleteBrandRows[b60Row] ? ' + B60' : '') + '）');

  // ============================================================
  // 【統計與警告】
  // ============================================================
  say('');
  say('【統計】帳務品牌ID重指 ' + reassignPlan.length + '　R0535改字 ' + (nameFixPlan ? 1 : 0) +
      '　開票公司typo ' + typoPlan.length + '　開票公司搬備註 ' + toNotePlan.length +
      '　品牌合併 ' + mergeActions.length + '　品牌改名 ' + renamePlan.length +
      '　品牌欄位修正 ' + fieldFixPlan.length + '　廠商補別名 ' + (vendorAliasPlan ? 1 : 0) +
      '　品牌刪列 ' + Object.keys(deleteBrandRows).length + '　廠商刪列 ' + (v082Deletable ? 1 : 0));

  if (warnings.length) {
    say('');
    say('【警告／待人工複查】共 ' + warnings.length + ' 項：');
    warnings.forEach(function (w) { say('  ⚠ ' + w); });
  }

  if (MERGE_DRY_RUN) {
    say('');
    say('===== 試算結束，未寫入任何資料。確認報告沒問題後把 MERGE_DRY_RUN 改成 false 再跑一次 =====');
    return log.join('\n');
  }

  // ============================================================
  // 【執行 1】帳務重指
  // ============================================================
  reassignPlan.forEach(function (p) {
    acctSheet.getRange(p.row, ACCT_COL.BRAND_ID).setValue(p.to);
  });
  if (nameFixPlan) {
    acctSheet.getRange(nameFixPlan.row, ACCT_COL.RAW_NAME).setValue(nameFixPlan.to);
  }
  typoPlan.forEach(function (p) {
    acctSheet.getRange(p.row, ACCT_COL.COMPANY).setValue(INVOICE_TYPO.to);
  });
  toNotePlan.forEach(function (p) {
    if (!p.alreadyInNote) {
      var curNote3 = trim(acctSheet.getRange(p.row, ACCT_COL.NOTE).getValue());
      var newNote = curNote3 ? curNote3 + ' / ' + p.value : p.value;
      acctSheet.getRange(p.row, ACCT_COL.NOTE).setValue(newNote);
    }
    acctSheet.getRange(p.row, ACCT_COL.COMPANY).setValue('');
  });

  // ============================================================
  // 【執行 2】品牌／廠商欄位、備註、改名（不刪列）
  // ============================================================
  mergeActions.forEach(function (m) {
    var touched = false;
    if (m.noteAdds.length) {
      var canNote2 = trim(brandSheet.getRange(m.canonicalRow, B.NOTE + 1).getValue());
      m.noteAdds.forEach(function (a) { canNote2 = canNote2 ? canNote2 + ' ' + a : a; });
      brandSheet.getRange(m.canonicalRow, B.NOTE + 1).setValue(canNote2);
      touched = true;
    }
    m.fieldMoves.forEach(function (fm) {
      brandSheet.getRange(m.canonicalRow, fm.col + 1).setValue(fm.value);
      touched = true;
    });
    if (touched) brandSheet.getRange(m.canonicalRow, B.UPDATED + 1).setValue(new Date());
  });

  renamePlan.forEach(function (r) {
    brandSheet.getRange(r.row, B.NAME + 1).setValue(r.to);
    brandSheet.getRange(r.row, B.UPDATED + 1).setValue(new Date());
  });

  fieldFixPlan.forEach(function (f) {
    if (f.actions.vendorId !== undefined) brandSheet.getRange(f.row, B.VENDOR + 1).setValue(f.actions.vendorId);
    if (f.actions.noteAppend !== undefined) {
      var curNote4 = trim(brandSheet.getRange(f.row, B.NOTE + 1).getValue());
      brandSheet.getRange(f.row, B.NOTE + 1).setValue(curNote4 ? curNote4 + ' ' + f.actions.noteAppend : f.actions.noteAppend);
    }
    if (f.actions.ended !== undefined) brandSheet.getRange(f.row, B.ENDED + 1).setValue(f.actions.ended);
    brandSheet.getRange(f.row, B.UPDATED + 1).setValue(new Date());
  });

  if (vendorAliasPlan) {
    vendorSheet.getRange(vendorAliasPlan.row, V.COMPANY + 1).setValue(vendorAliasPlan.to);
    vendorSheet.getRange(vendorAliasPlan.row, V.UPDATED + 1).setValue(new Date());
  }

  // ============================================================
  // 【執行 3】刪列，由下往上
  // ============================================================
  var brandDeleteRowsSorted = Object.keys(deleteBrandRows).map(Number).sort(function (a, b) { return b - a; });
  brandDeleteRowsSorted.forEach(function (row) { brandSheet.deleteRow(row); });

  if (v082Deletable) {
    vendorSheet.deleteRow(v082Row);
  }

  say('');
  say('===== 完成：帳務重指 ' + reassignPlan.length + ' 筆、品牌刪列 ' + brandDeleteRowsSorted.length +
      ' 列、廠商刪列 ' + (v082Deletable ? 1 : 0) + ' 列 =====');
  return log.join('\n');
}

// ============================================================
// 資料表
// ============================================================

// A. 品牌合併表：來源品牌ID → 正典品牌ID（38 組）
var BRAND_MERGE_MAP = {
  "B150": "B013", "B081": "B013",
  "B165": "B163",
  "B177": "B062",
  "B112": "B006",
  "B080": "B009", "B104": "B009",
  "B225": "B086",
  "B098": "B051",
  "B145": "B029", "B164": "B029",
  "B032": "B076", "B083": "B076", "B196": "B076",
  "B109": "B015", "B241": "B015", "B242": "B015",
  "B209": "B063",
  "B139": "B079", "B140": "B079",
  "B218": "B092",
  "B219": "B122",
  "B166": "B097", "B106": "B097",
  "B148": "B147", "B204": "B147",
  "B114": "B088", "B115": "B088", "B116": "B088", "B117": "B088",
  "B160": "B159",
  "B206": "B175",
  "B203": "B202",
  "B195": "B087",
  "B168": "B035", "B169": "B035",
  "B154": "B152",
  "B211": "B053"
};

// A（附）. 單筆帳務改指：不是整團併，只改這一筆紀錄的品牌ID
// R0003／R0060 目前是 B084；R0496／R0575 目前品牌ID空白
var SINGLE_RECORD_REASSIGN = {
  "R0003": "B013",
  "R0060": "B013",
  "R0496": "B015",
  "R0575": "B053"
};

// A（附）. 帳務無引用才刪除的品牌：注意 id 就是「B60」不是「B060」
var BRAND_DELETE_IF_UNUSED = "B60";

// B. 品牌改名（合併後執行；B084 不刪除，改名後繼續用）
var BRAND_RENAME_MAP = {
  "B009": "Scoot&Ride奧地利滑步車",
  "B029": "美國教育玩具",
  "B127": "Daiichi",
  "B194": "日本禮盒團",
  "B079": "Kidsread點讀筆",
  "B202": "毛寶",
  "B035": "Wewee",
  "B152": "Oster",
  "B084": "Kinyo風扇"
};

// C. 個別品牌欄位修正
var BRAND_FIELD_FIXES = [
  { id: "B131", vendorId: "V002" },
  { id: "B035", vendorId: "V064" },
  { id: "B152", noteAppend: "疑似接洽對象：丸獸（見R0286）" },
  { id: "B111", vendorId: "V045", noteAppend: "代理商韓商173；米餅已結束代理；旗下另有 jellypop" },
  { id: "B090", ended: true, noteAppend: "廠商 Hibebe（米餅/兒童碗），已結束合作" }
];

// D. 帳務單筆「原始名稱」修正
var SINGLE_ACCT_NAME_FIX = { id: "R0535", newRawName: "點點筆學習本專案" };

// D. 開票公司錯字修正
var INVOICE_TYPO = { from: "黎子熊", to: "梨子熊" };

// D. 開票公司雜訊值：搬進備註欄後清空
var INVOICE_TO_NOTE_VALUES = [
  "後五碼12440", "掛布60元", "7/11發老爸", "18360兩筆一起",
  "轉了2847過來", "9/1開17713", "匯款金額6687"
];

// E. 廠商公司名稱補別名
var VENDOR_ALIAS_APPEND = { vendorId: "V008", checkSubstring: "瑞久", appendValue: "瑞久,瑞久有限,瑞久有限公司" };

// E. 帳務與品牌都無引用才刪除的廠商
var VENDOR_DELETE_IF_UNUSED = "V082";
