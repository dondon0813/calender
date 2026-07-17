# Apps Script 修改說明（讓行事曆改走 Apps Script，試算表可設私人 + 支援對應品項）

目標：
1. 讓前台不再直接讀公開試算表（gviz），改成透過 Apps Script 讀行事曆 → 試算表就能設「私人」，關掉密碼雜湊/登入 token 的外流風險。
2. 順便支援行事曆 **V 欄「對應品項」**（解決 UBMOM 水壺/雨衣誤判）。

前端 5 個讀行事曆的檔案我都已經改好了（把 `fetch(GVIZ_URL)` 換成 `?scope=calendar`）：
index.html、school-list.html、recipes.html、school-labels.html、admin.js。
你只要改 **Apps Script（.gs）這 4 個地方**，然後**重新部署（用「管理部署作業」更新現有部署，網址才不會變）**。

---

## 改法 1：EVENT_COL 加一欄 MATCH_ITEMS（對應品項＝V欄）

【找這段】
```js
const EVENT_COL = {
  ID: 1, START: 2, END: 3, EXTEND: 4, TITLE: 5, TAG: 6, CATEGORY: 7, URL: 8, ADMIN_URL: 9, EARLYBIRD: 10,
  RECIPE_BRAND: 11,
  COLOR: 12, ALLDAY: 13, START_TIME: 14, END_TIME: 15, IS_GROUPBUY: 16, PUBLISHED: 17,
  ICON_IG: 18, ICON_TIKTOK: 19, ICON_FB: 20, ICON_EMAIL: 21
};
```

【改成】（最後一行加逗號，並新增 MATCH_ITEMS: 22）
```js
const EVENT_COL = {
  ID: 1, START: 2, END: 3, EXTEND: 4, TITLE: 5, TAG: 6, CATEGORY: 7, URL: 8, ADMIN_URL: 9, EARLYBIRD: 10,
  RECIPE_BRAND: 11,
  COLOR: 12, ALLDAY: 13, START_TIME: 14, END_TIME: 15, IS_GROUPBUY: 16, PUBLISHED: 17,
  ICON_IG: 18, ICON_TIKTOK: 19, ICON_FB: 20, ICON_EMAIL: 21,
  MATCH_ITEMS: 22
};
```

---

## 改法 2：新增一個函式 getEventsAsGviz_()

在 `deleteEvent_()` 函式的後面（也就是「// ===== 【新】前台瀏覽次數／點擊次數統計 =====」這行的上面）
貼上這整段新函式：

```js
// 【新】把行事曆分頁包成跟 gviz 完全相同的格式，讓前台改走 Apps Script 讀取
// 前台原本吃 gviz 的 { table: { rows: [ { c: [ {v:...}, ... ] } ] } }，這裡照樣輸出
// 日期用 gviz 的 "Date(y,m,d)"（月份 0-based），前台的 parseDateStr 直接吃得下
function getEventsAsGviz_() {
  const sheet = getEventSheet_();
  const data = sheet.getDataRange().getValues();
  const COLS = EVENT_COL.MATCH_ITEMS; // 一路讀到 V 欄（含對應品項）
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[0] === '' || r[0] === null || r[0] === undefined) continue; // 沒有編號的空列跳過
    const c = [];
    for (let j = 0; j < COLS; j++) {
      let v = r[j];
      if (v instanceof Date) {
        v = 'Date(' + v.getFullYear() + ',' + v.getMonth() + ',' + v.getDate() + ')';
      }
      c.push((v === '' || v === null || v === undefined) ? null : { v: v });
    }
    rows.push({ c: c });
  }
  return { table: { rows: rows } };
}
```

---

## 改法 3：doGet 加上 scope=calendar 的處理

【找這段】（doGet 最上面）
```js
function doGet(e) {
  const scope = e && e.parameter ? e.parameter.scope : '';
  const token = e && e.parameter ? e.parameter.token : '';

  const publicResult = {
```

【改成】（在 token 那行下面，插入 scope === 'calendar' 的判斷）
```js
function doGet(e) {
  const scope = e && e.parameter ? e.parameter.scope : '';
  const token = e && e.parameter ? e.parameter.token : '';

  // 前台行事曆專用：回傳與 gviz 相同格式的活動資料（公開、免登入）
  if (scope === 'calendar') {
    return jsonResult_(getEventsAsGviz_());
  }

  const publicResult = {
```

---

## 改法 4（選配，建議做）：讓後台也能存「對應品項」

這樣未來你可以在後台直接編輯對應品項，不用手動開試算表。若你只想手動填 V 欄，這步可略過。

### 4a. addEvent_ 內，ICON_EMAIL 那行下面加一行

【找】
```js
  row[EVENT_COL.ICON_EMAIL - 1] = fields.iconEmail || '';

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
```
【改成】
```js
  row[EVENT_COL.ICON_EMAIL - 1] = fields.iconEmail || '';
  row[EVENT_COL.MATCH_ITEMS - 1] = fields.matchItems || '';

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
```

### 4b. updateEvent_ 內，iconEmail 那行下面加一行

【找】
```js
  if (fields.iconEmail !== undefined) sheet.getRange(row, EVENT_COL.ICON_EMAIL).setValue(fields.iconEmail);
  return true;
}
```
【改成】
```js
  if (fields.iconEmail !== undefined) sheet.getRange(row, EVENT_COL.ICON_EMAIL).setValue(fields.iconEmail);
  if (fields.matchItems !== undefined) sheet.getRange(row, EVENT_COL.MATCH_ITEMS).setValue(fields.matchItems);
  return true;
}
```

### 4c. doPost 的 event-add 內，iconEmail 那行下面加一行

【找】
```js
          iconEmail: body.iconEmail || ''
        });
        return jsonResult_({ success: true, id: id });
```
【改成】
```js
          iconEmail: body.iconEmail || '',
          matchItems: body.matchItems || ''
        });
        return jsonResult_({ success: true, id: id });
```

### 4d. doPost 的 event-update 內，iconEmail 那行下面加一行

【找】
```js
      if (body.iconEmail !== undefined) fields.iconEmail = String(body.iconEmail);
      const ok = updateEvent_(id, fields);
```
【改成】
```js
      if (body.iconEmail !== undefined) fields.iconEmail = String(body.iconEmail);
      if (body.matchItems !== undefined) fields.matchItems = String(body.matchItems);
      const ok = updateEvent_(id, fields);
```

---

## 改完之後的部署步驟（重要）

1. Apps Script 編輯器右上「部署」→「管理部署作業」。
2. 點現有部署右邊的鉛筆（編輯）→ 版本選「新版本」→ 部署。
   - ⚠️ 一定要「編輯現有部署」，不要「新增部署」，否則網址會變、全部網頁要重設。
3. 確認部署設定：「執行身分＝我(擁有者)」、「誰可以存取＝所有人」。
   （這樣 Apps Script 才能以你的身分讀「私人」試算表，再吐給前台。）

## 填「對應品項」＋設私人

1. 打開行事曆試算表，在 **V 欄**、**編號 85（快閃！UBMOM 韓系斗篷兒童雨衣）那一列**，填 `雨衣`。
   （建議 V1 標題打「對應品項」。日後同品牌多品項的特殊團就填這欄，用 `｜` 分隔多個。）
2. 測試前台 index.html / school-list.html 行事曆有正常顯示。
3. 都正常後，再把試算表分享權限改成 **私人（限本人）**，重新整理前台確認仍正常。

## 驗收
- 雨衣品項 → 顯示「現正開團中」
- 水壺、吃飯圍兜 → 不再誤判（顯示「目前尚無安排開團」）
- 客人版行事曆、後台行事曆都照常
- 試算表設私人後，陌生人再也打不開你的員工名單/Sessions 分頁 ✅
