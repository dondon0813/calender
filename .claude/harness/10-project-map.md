# 10 專案架構地圖

用途：**先查地圖，再 Grep 定位，最後才小窗口 Read**。本檔讓任何 session 不必探索 repo 就知道「什麼在哪、多大、誰讀誰」。
行號基準：2026-07-21（prItems.js 拆檔後）。行號會隨改動漂移——**用行號前先以 Grep 找函式名確認現在位置**；漂移超過 ±50 行時，依 `60-knowledge-protocol.md` 更新本檔。

## 1. 系統全景

```
使用者(客人/員工)
   │ https://dondon0813.github.io/calender/   ← repo 拼字就是 calender，不是 calendar！
   ▼
前端靜態頁（GitHub Pages，push main 後 ~1 分鐘自動部署）
   │ fetch(APPS_SCRIPT_URL + "?scope=calendar" / "?scope=public" / POST {type:...})
   ▼
Google Apps Script（Code.gs，**改完必須由使用者在 GAS 編輯器手動重新部署才生效**）
   │ SpreadsheetApp
   ▼
Google 試算表（兩份！）
 ├─ 行事曆表 SHEET_ID=18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk（活動資料）
 └─ 後台表（私人；員工帳密雜湊、Sessions token、廠商/品牌資料庫、任務、備忘錄等分頁）
```

- 主 Apps Script 部署 ID：`AKfycbzTxoqVO1nf--Q9s-lf1eIPdgrDpJgLsuAy1mAwgydYzb7ThAuygx79oFNsEH-kWD2R`（admin.js / recipes / school-list / school-labels 頂部常數 `APPS_SCRIPT_URL`；**index.html 例外**：常數名是 `STATS_BACKEND_URL` 且不在頂部，Grep 它才找得到）。
- **例外**：school-labels.html 另有第二個部署常數 `LABELS_API_URL`（school-labels.html:135 附近）。
- 資安鐵律：`scope=public` 與 `brands`/`brandThumbs` 是免登入端點，**只准輸出 品牌名稱／品牌介紹／去背小圖**，聯絡窗口、LINE、Email 等內部欄位絕不可外洩。

## 2. 檔案清單與大小警示

🔴＝禁止無 `limit` 整檔讀（有 hook 硬擋）；🟡＝建議窗口讀；🟢＝可整讀。

| 檔案 | 行數 | 用途 | 分級 |
|---|---|---|---|
| admin.js | 5001 | 後台前端邏輯主檔（見 §5 區塊索引；公關品清單、品牌廠商、圖片庫、計算機已拆出） | 🔴 |
| admin.html | 4440 | 員工後台頁（登入、行事曆編輯、任務、圖片庫、資料庫管理…） | 🔴 |
| Code.gs | 3104 | GAS 後端全部邏輯（見 §4 端點目錄） | 🔴 |
| recipes.html | 2639 | 公開食材/食譜庫＋育兒工具入口（腳本內嵌） | 🔴 |
| school-list.html | 1919 | 公開開學用品清單，可產 A4 圖（html2canvas）；含「現正開團中」列 | 🔴 |
| index.html | 1610 | 公開團購行事曆（客人版）＋瀏覽/點擊統計（腳本內嵌） | 🔴 |
| star-card.html | 874 | 兒童集點卡（純 CSS/emoji，無資料來源） | 🟡 |
| prItems.js | 549 | 公關品清單頁＋公關品明細模組（**必須排在 admin.js 之前載入**，見 §2 引用關係） | 🟢 |
| brandVendor.js | 465 | 廠商/品牌資料庫管理＋檢視彈窗＋排行事曆品牌比對（**同樣必須排在 admin.js 之前**） | 🟢 |
| imageLibrary.js | 486 | 圖片庫：瀏覽/上傳/改名/刪除/批次轉WebP/搬移（**同樣必須排在 admin.js 之前**；權限檢查在 admin.js 的 switchView） | 🟢 |
| calculator.js | 137 | 計算機＋稅率互算（完全自足，不讀 admin.js 全域；同樣排在 admin.js 之前） | 🟢 |
| memo.js | 420 | 備忘錄樹狀模組（依賴 admin.js 的 postTask/currentUser） | 🟢 |
| shared.css | 382 | 全站設計 tokens（:root 變數）＋共用元件 | 🟢 |
| school-labels.html | 311 | 標籤機導購頁（獨立 LABELS_API_URL） | 🟢 |
| kids.html | 153 | 兒童專區 hub（純連結頁） | 🟢 |
| apps-script-*.md ×3 | - | **歷史部署說明**（已完成的部署步驟紀錄，非現況文件） | 🟢 |

引用關係：admin.html → `prItems.js?v=N` → `brandVendor.js?v=N` → `imageLibrary.js?v=N` → `calculator.js?v=N` → `admin.js?v=N` → `memo.js?v=N`＋html2canvas(本地 vendor/)；school-list.html → html2canvas；全部頁面 → shared.css。改 admin.js/memo.js/prItems.js 時**記得把 admin.html 裡對應的 `?v=` 版本號 +1**（快取破解）。
**載入順序鐵律**：prItems.js / brandVendor.js / imageLibrary.js 等拆出模組必須排在 admin.js **之前**——admin.js 開機還原分頁會在最外層同步呼叫 `loadPrItems()`、`renderBrandVendorView()`、`ilLoad()` 等模組函式，順序錯了整頁變磚。新拆模組若同樣被開機路徑呼叫，一律照此模式排在 admin.js 之前，且模組最外層只准「宣告＋DOM 事件掛載」，不准直接呼叫 admin.js 的函式。

## 3. 前端資料流速查

- GET `?scope=calendar` → gviz 格式活動資料。呼叫處：index.html、admin.js（loadData 附近）、recipes.html、school-list.html、school-labels.html。
- GET `?scope=public` → 品牌（僅名稱/介紹）、brandThumbs、ingredients、recipes、schoolList、blocks、socialLinks。
- GET 帶 `token` → 完整後台資料（未登入回 public＋`unauthorized`）。
- POST `{type: "..."}` → 見 §4；admin.js 統一經 `postTask()` 發送；`login`/`stat-view`/`stat-click` 免登入，其餘需 token。
- 行事曆欄位語意——**注意兩套索引**：Code.gs 的 `EVENT_COL`（定義在 Code.gs:1213 附近）是 **1-based**（MATCH_ITEMS=22、THUMB=23）；前端 gviz 回來的 row 陣列是 **0-based**（V 欄對應品項=`c[21]`、W 欄去背小圖=`c[22]`、X 欄折扣碼=`c[23]`）。搞混一格就會把折扣碼當小圖輸出。「空白=預設、有填=覆寫」是本專案通用慣例（V、W 欄皆然）。

## 4. Code.gs 端點目錄（Grep 錨點）

- `doGet`（Code.gs:1877 附近）：scope=calendar → `getEventsAsGviz_()`；scope=public；帶 token → 全量。
- `doPost`（Code.gs:1952 附近）：以 `if (type === '...')` 分支。找某動作直接 Grep：`type === 'event-update'`。
- 動作家族（前綴）：`vendor-db-*`、`brand-db-*`、`pnote-*`（備忘錄）、`task-*`／`taskname-*`（任務）、`pr-*`（公關品）、`todo-*`、`event-*`、`block-*`（自訂區塊）、`image-*`（GitHub 圖片庫代理）、`perm-*`、`stat-*`、`login`、`change-password`、`social-link-set`。
- 函式群定位（Grep `^function 名稱`）：Session/驗證 `getSessionUser_`／`hashPassword_`；品牌庫 `getBrandDbList_`／`updateBrandThumbs`；活動 `addEvent_`／`getEventsAsGviz_`；GitHub 圖片代理 `githubFetch_`／`listGithubFilesRecursive_`；一次性工具 `importBrandsFromCalendar`、`migrateStaffPasswordsToHash_ONETIME`。
- 常數區在 Code.gs:1-54：分頁名稱、`DEFAULT_PASSWORD`、`PASSWORD_PEPPER`、`SESSION_DURATION_MS`(12h)、`EVENT_SHEET_ID`。

## 5. admin.js 功能區塊索引（以 `// =====` 分隔線切區）

找功能先 Grep 區塊標題或代表函式，別捲頁：行事曆渲染 `render`/`renderAllMode`（:427 起）；資料載入 `loadData`（:298）；活動編輯 `openEventEditModal`（:1715）；分頁切換 `switchView`（:2004）、開機接線 `initAppUI`（:2284）；任務系統 `postTask`（:3181，**所有 POST 的必經之路**）、`openTaskModal`（:3864）；待辦 `openTodoEditModal`（:4458）；開團狀態/自訂區塊 `appendCustomBlocksAdmin`（:4713 起）。
已拆出的模組：**公關品清單頁／公關品明細 → prItems.js**（loadPrItems / renderPrItemsList / ensurePrItemsLoaded / mountPriInline 等）；**廠商/品牌資料庫 → brandVendor.js**（renderBrandVendorView / openBrandEditModal / renderEvBrandMatchInfo / findGroupBuyDatesForBrand_ 等；vendorDb/brandDb 的宣告與寫入仍在 admin.js 資料層）；**圖片庫 → imageLibrary.js**（ilLoad / ilRenderGrid / 批次轉WebP等；權限檢查在 admin.js 的 switchView）；**計算機 → calculator.js**（calc* / 稅率互算，完全自足）。行事曆彈窗裡的「公關品狀態面板」仍在 admin.js（Grep `prStatusSelect`）。

## 6. 圖片資產規則與陷阱

- `icons/`：開學清單/標籤頁專用圖示（.png+.webp 成對）。`images/tools/`：後台工具圖示。`images/recipes/`：食譜 UI 圖。`images/brands/`：品牌去背小圖，**檔名=品牌代號**（見該資料夾 README.md），由 GAS `updateBrandThumbs()` 寫網址進試算表。`images/Ingredients/`：食材照片，由試算表「圖片網址」欄動態載入。
- **陷阱 1**：食材/品牌圖在試算表存的是**絕對網址**（github.io 或外部 cloudimg）→ 本機預覽也是抓線上圖，離線會「版面正常但圖全破」，且 onerror 會換 emoji 備援，不易察覺。
- **陷阱 2**：副檔名要跟實際檔案一致，`.png` 已大量移除只留 `.webp`；資料填錯副檔名＝線上 404。
- **陷阱 3**：品牌名比對走 `normalizeBrandKey()`（轉小寫＋去空格，school-list.html）；品牌命名一律用「客人看得懂的名稱」（`B21pro` 不是「精臣」），原廠名寫品牌備註。

## 7. 其他既定事實（避免重新推導）

- git 身分：dondon0813 / shirley7853@gmail.com；credential.helper=manager，**push 需 GCM 互動登入，放背景跑才會成功**。
- shared.css 遷移已完成：改配色/圓角/間距動 `:root` 變數，禁止在各頁硬寫色碼；新頁面先 `<link>` shared.css 再寫頁面專屬 style；`max-width` 用 `--wrap-max` 覆寫。
- 試算表結構變更鐵律：**先在試算表加好欄位，再跑 GAS 函式**（appendRow 欄數不符會直接中止）。
- 使用者（Shirley）非工程師，溝通用繁體中文、講結論與步驟，不貼大段程式碼。
