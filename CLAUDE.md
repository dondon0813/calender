# dondon-calendar（雪莉與朵栗 團購/家庭管理站）

前端靜態頁（GitHub Pages，repo 拼字是 **calender**）＋ Google Apps Script 後端（Code.gs）＋ Google 試算表 ×2（前台行事曆表＋後台私人表）。使用者是非工程師，用繁體中文溝通，回報講結論與步驟。

## 三條鐵律（違反任何一條，先停下來）

1. **禁止整檔讀大檔**：admin.js / admin.html / Code.gs / recipes.html / school-list.html / index.html 一律「查地圖 → Grep 定位 → Read 帶 offset/limit（≤200 行）」。跨檔調查派 Explore subagent，不要親自掃。（有 hook 硬擋，被擋到就照錯誤訊息做。）
2. **沒過版本確認的驗證＝無效**：Code.gs 改動要等**使用者手動重新部署**才生效；GitHub Pages 有快取。驗證前必須照 `.claude/harness/50-deploy-verify.md` 做版本確認，否則你在對舊版本下結論。
3. **實作者不得自我驗證**：改動完成後派 fresh-context subagent 驗收（規則在 20 號檔）。公開端點（scope=public / brands / brandThumbs）只准輸出品牌名稱、介紹、去背小圖——多吐一個欄位就是資安事故。

## 檔案路由（先讀對的檔，不要全讀）

| 情境 | 讀這份 |
|---|---|
| 要動任何程式碼之前（找檔案、找函式、查資料流） | `.claude/harness/10-project-map.md` |
| 要派工給 subagent、選模型、失敗要不要升級 | `.claude/harness/20-model-dispatch.md`＋`40-delegation-templates.md`（現成模板） |
| 判斷「方向對不對／算不算完成／該不該問使用者」 | `.claude/harness/30-judgment-matrix.md` |
| 要 push、要驗證改動有沒有生效、要改試算表結構 | `.claude/harness/50-deploy-verify.md` |
| 踩到坑、發現 harness 文件與現實不符、想更新規則 | `.claude/harness/60-knowledge-protocol.md`（＋`lessons.md`） |
| 對這套制度的來龍去脈有疑問 | `.claude/harness/00-diagnosis.md`、`70-handover.md` |
| 使用者問「怎麼用 Opus 指揮 Sonnet」 | `.claude/harness/25-operator-guide.md`（給人看的） |

## 速查

- 主後端：`APPS_SCRIPT_URL`（admin.js / recipes / school-list / school-labels 頂部常數；index.html 例外叫 `STATS_BACKEND_URL`）；GET `?scope=calendar`（行事曆）、`?scope=public`（公開資料）、POST `{type:"..."}`（動作清單見 10 號檔 §4）。
- 行事曆表 SHEET_ID：`18DfV9xz58VvNDuKx7LD2aUewwBeN3abugK9BAl79rJk`。
- 改 admin.js / memo.js 後，admin.html 的 `?v=` 版本號要 +1。
- 線上驗證：`https://dondon0813.github.io/calender/<頁>.html?cb=<git short hash>`。
- 語法檢查：`node --check admin.js`、`node --check Code.gs`。
- 站上樣式改 `shared.css` 的 `:root` 變數，禁止在各頁硬寫色碼。
