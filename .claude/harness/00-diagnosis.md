# 00 Harness 漏水診斷書

撰寫：Fable 5，2026-07-19。本檔是整套 harness 的依據：三大痛點各對應一個「物理級阻斷方案」，並標注由哪份檔案承接。後續模型讀本檔的目的是理解「為什麼有這些規則」，日常作業不必重讀。

## 1. 診斷範圍與基準數據

檢查對象：全域 `~/.claude/`、全域 `~/.claude.json`、專案 `.claude/`、auto-memory、5 個歷史 session 軌跡、專案原始碼量化。

**診斷結論：這個環境在制度層面是裸機。**
- 全域與專案都沒有 CLAUDE.md、沒有 settings.json（診斷前）、沒有 hooks / 自訂 commands / 自訂 agents。
- 本機無 MCP 設定（`mcpServers` 為空）；Gmail / Google Drive / Canva / Chrome 等工具來自 claude.ai 連接器，headless 場景不保證存在。
- 既有資產只有兩樣：品質不錯的 auto-memory（5 檔）＋累積 72 條一次性核可的 `settings.local.json`。

**專案量化基準（2026-07-19）：**

| 檔案 | 行數 | 大小 | 分級 |
|---|---|---|---|
| admin.js | 5727 | 240KB | 🔴 禁止整檔讀 |
| admin.html | 4051 | 138KB | 🔴 禁止整檔讀 |
| Code.gs | 3076 | 122KB | 🔴 禁止整檔讀 |
| recipes.html | 2639 | 94KB | 🔴 禁止整檔讀 |
| school-list.html | 1805 | 60KB | 🔴 禁止整檔讀 |
| index.html | 1610 | 55KB | 🔴 禁止整檔讀 |
| star-card.html | 874 | 31KB | 🟡 建議窗口讀 |
| 其餘（kids/labels/shared.css/memo.js） | <430 | <20KB | 🟢 可整讀 |

（行數以 2026-07-19 為準，含空行；之後以 `(Get-Content 檔名 -Encoding UTF8).Count` 重新量測為準——**必須帶 `-Encoding UTF8`**，PowerShell 5.1 對無 BOM 的 UTF-8 中文檔會誤判編碼而嚴重少算。）

## 2. 痛點一：巨型檔案整檔讀取（最大 token 漏水源）

**現象**：admin.js 整檔約 6 萬 token；即使 Read 預設只取 2000 行，一次也吃約 2.5 萬 token。弱模型的習性是「先把檔案讀進來再想」，讀兩三個大檔就佔掉半個 context window，之後的推理品質全面下降、開始忘記前面的指示——這就是「失焦」的物理成因。

**物理阻斷（三層）**：
1. **Hook 硬擋**：`.claude/hooks/guard-big-read.ps1`（PreToolUse/Read）——對 >50KB 的文字檔，未帶 `limit`（或 limit>400）的 Read 一律擋下，錯誤訊息直接教正確做法。模型想犯錯也犯不了。
2. **地圖替代探索**：`10-project-map.md` 提供每檔用途、符號行號、資料流。先查地圖再 Grep 定位，Read 只開 ≤200 行小窗口。
3. **派工替代親讀**：跨多檔的掃描/搜尋一律派 Explore subagent（規則在 `20-model-dispatch.md`），主對話只收精簡結論。

## 3. 痛點二：零專案文件，每個 session 重新探索

**現象**：過去 5 個 session 的軌跡顯示，每次開場都在重新推導同樣的事實：repo 名拼字是 **calender**（不是 calendar）、前台行事曆表與後台私人表是**兩份不同試算表**、行事曆 V 欄／W 欄語意、部署要靠使用者手動操作……這些知識只存在 auto-memory，而 auto-memory 不進版控、會被壓縮精簡、換機器就消失。每次重新探索 = 重複燒 token ＋ 重複犯已犯過的錯。

**物理阻斷**：
1. `CLAUDE.md` 每個 session 自動載入，只放鐵律與路由（弱模型需要明確、強模型需要留白，所以入口極短）。
2. `10-project-map.md` 承載架構事實，**進版控**、可被驗證、換機器不丟。
3. `60-knowledge-protocol.md` 規定新知識往哪落檔，auto-memory 降級為「工作進度暫存」。

## 4. 痛點三：部署斷點——對舊版本做驗證

**現象**：本專案的部署鏈有兩個模型摸不到的斷點：
- **Code.gs**：改完 commit 只是進了 git；實際生效必須由**使用者**在 Apps Script 編輯器手動「編輯現有部署」重新部署。模型改完 → curl 端點 → 打到的是**舊部署** → 得出錯誤結論。
- **GitHub Pages**：push 後要 ~1 分鐘重建，另有 CDN 快取；不帶 cache-buster 的 curl 可能拿到舊檔。

這是本環境「假完成／假失敗」結論的最大來源，對弱模型尤其致命——它們傾向把「curl 有回應」當成「改動生效」。

**物理阻斷**：`50-deploy-verify.md` 的機械規則——**驗證前必先執行「版本確認步驟」**（前端：curl 帶 `?cb=<git short hash>` 比對指紋；後端：先向使用者確認「已重新部署」或用行為探針確認新欄位存在），未通過版本確認的驗證結果一律視為無效，不得寫進回報。

## 5. 次要問題清單

| 問題 | 處置 |
|---|---|
| settings.local.json 累積 72 條一次性核可（含大量已失效的 session 專屬路徑、過廣的 `git commit *`） | 已清理（留 .bak），常用允許收進專案 `settings.json` |
| 無任何 deny 規則：`git push --force`、`git reset --hard`、`git clean -f` 無阻擋 | 已在 `settings.json` 加 deny（擋常見寫法；deny 是前綴比對，蓋不住所有變體，故 push 不入 allow、一律經確認） |
| 部署狀態無單一事實來源（三份 apps-script-*.md 散落根目錄，寫的是歷史步驟不是現況） | `50-deploy-verify.md` 為部署 SOP 唯一入口；舊說明檔標記為歷史文件 |
| 圖片走絕對網址，本機預覽破圖易誤判 | 已寫入 `10-project-map.md` 陷阱區 |
| README.md 僅 2 行 | 不處理（對外門面由使用者決定） |

## 6. 誠實條款：本 Harness 的能力極限

**拆解＋隔離驗證能逼近高階品質的**：機械正確性（語法、資料流、欄位索引）、等價重構（有 diff 可比對）、回歸驗證（有舊行為當基準）。這類工作 Sonnet 在本 harness 下可穩定產出。

**弱模型注定失敗、harness 救不了的**：
1. **視覺美感與品味**（配色協調、文案語氣、版面「好不好看」）——沒有可計算的判準。**應對標準**：弱模型禁止自行定案，必須產出 2–3 個具體選項（附截圖或線上預覽網址）交使用者選；不得用「我覺得更美觀」當理由改既有視覺。
2. **語意設計決策**（例：某旗標欄位可否挪用到新場景、公開端點可以多吐哪個欄位）——錯了就是資安或資料語意事故。**應對標準**：觸發 `30-judgment-matrix.md` 的熔斷提問，禁止自行推斷。
3. **跨 session 的一致性品味**（命名風格、抽象層級的拿捏）——會緩慢漂移。**應對標準**：靠 `60-knowledge-protocol.md` 的定期精簡與 `70-handover.md` 的退化預警，只能減速、不能根除。

**本 harness 防不了的**：使用者直接改試算表結構而未告知（模型只能靠行為探針事後發現）；Claude Code 產品行為變更（hook 語法、工具名）；hook 被手動停用。遇到「規則引用的東西不存在」時，依 `60-knowledge-protocol.md` 回報並修檔，不要硬套。

**不確定就查，查不到就標註 `【未驗證】`，禁止編造。** 本套文件中所有標 `【未驗證】` 的條目，都是撰寫當下無法實測確認的。
