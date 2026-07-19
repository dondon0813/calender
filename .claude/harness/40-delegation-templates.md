# 40 標準化派工 Prompt 模板

用法：複製對應模板 → 填 `【】` 空格 → 用 Agent 工具送出。**不得刪除模板中的任何區塊**；某欄真的不適用就填「無」。`模型`欄依 `20-model-dispatch.md` 第 2 節選。

通則（四份模板共用，已內建在模板文字裡）：
- 派工時把「已知事實」寫進去，省 subagent 重新探索的 token。
- 驗收條件必須可機械判定（能打 PASS/FAIL），禁止「品質良好」「適當處理」。
- 回報格式強制「結論先行＋行號引用＋單段代碼 ≤5 行」。

---

## 模板 A：搜尋研究（agentType: Explore，read-only）

```
你在 C:\Users\ASUS\Documents\Claude\dondon-calendar。先讀 .claude/harness/10-project-map.md 的 §【相關小節編號】。

【要查什麼：一句話。例：找出所有會寫入行事曆 W 欄(去背小圖)的路徑】
背景：【為什麼要查，查到要拿去做什麼】
已知事實：【列出已知，例：EVENT_COL.THUMB=23 定義在 Code.gs；前端統一走 postTask()】

硬規則：admin.js/admin.html/Code.gs/recipes.html/school-list.html/index.html 禁止整檔讀；
一律 Grep 找符號 → Read 帶 offset/limit(≤80 行) 確認。

回報格式（≤40 行 markdown）：
1. 直接回答（≤5 行）
2. 證據清單：每條一行「檔名:行號 — 這裡做了什麼」
3. 沒查到/不確定的部分（明確列出，不要含糊帶過）
禁止貼大段程式碼（單段 ≤5 行）。
```

## 模板 B：功能實作（model: sonnet）

```
你在 C:\Users\ASUS\Documents\Claude\dondon-calendar。先讀 .claude/harness/10-project-map.md §【小節】與 30-judgment-matrix.md 第 4 節（專案陷阱）。

目標：【要做什麼功能，一句話】
背景：【使用者的原始需求＋為什麼這樣設計】
改動範圍：只准動【檔案清單】；預估 diff 約【N】行。超出範圍或發現需要動其他檔 → 停下回報，不要擅自擴大。
已知事實／已定位置：【例：進入點在 admin.js 的 openEventEditModal (Grep 定位)；欄位語意 V=idx21】

驗收條件（你交付前自查，但最終驗收由另一個 agent 做）：
- [ ] 【具體條件 1，例：node --check admin.js 通過】
- [ ] 【具體條件 2，例：Grep 確認新函式只在 X、Y 兩處被呼叫】
- [ ] git diff 只含上述檔案，無 debug 殘留
- [ ] 若改了 admin.js/memo.js：admin.html 的 ?v= 已 +1

禁止事項：禁止整檔讀大檔（Grep+窗口讀）；禁止動公開端點輸出欄位；禁止改驗收條件。

回報格式：
1. 結論（做完/部分完成/被擋住，≤3 行）
2. 改動清單：檔名:行號範圍 — 改了什麼（每條一行）
3. 需要使用者做的事（重新部署/加欄/填資料，無則寫「無」）
4. 自查結果：驗收條件逐條 PASS/FAIL
```

## 模板 C：代碼重構（model: sonnet）

```
你在 C:\Users\ASUS\Documents\Claude\dondon-calendar。先讀 .claude/harness/10-project-map.md。

目標：【重構什麼，例：把 X 抽成共用函式】
鐵律：**等價重構——外部行為不得有任何改變**。你的任務不包含「順手修 bug」「順手改善」；發現 bug 記下來回報，不要修。
改動範圍：【檔案清單】

驗收條件：
- [ ] node --check 全部通過
- [ ] 重構前後行為等價的證明方式：【指定，例：對 렌더 輸出做 diff／把變數展開回字面值逐條比對（參 50-deploy-verify.md §5 三關驗證法）】
- [ ] 舊符號的所有呼叫點已 Grep 列出且全部改齊（附清單）
- [ ] diff 中不存在任何「行為變更」——只有搬移/改名/去重

回報格式：同模板 B，另加「等價性證明」一節（用了什麼方法、比對結果）。
```

## 模板 D：驗收審查（fresh-context 專用；model: sonnet，重大改動用 opus）

```
你是驗收員，在 C:\Users\ASUS\Documents\Claude\dondon-calendar。你沒有、也不需要實作過程的任何資訊——一切以檔案現況與實際執行結果為準。不要通靈實作者的意圖。

改動意圖：【一句話，實作者宣稱做了什麼】
涉及檔案：【清單】

逐條驗收（每條給 PASS/FAIL＋證據行號或指令輸出）：
- [ ] 【驗收條件 1（從派工單原封複製）】
- [ ] 【驗收條件 2】
- [ ] git diff 範圍檢查：只動了上列檔案，無夾帶
- [ ] 語法：node --check 【檔案】
- [ ] 波及面：Grep 【被改動的符號】，列出所有使用處，逐一確認相容
- [ ] 【若已部署】線上驗證：照 .claude/harness/50-deploy-verify.md 做版本確認後再驗

硬規則：只讀不寫——發現問題回報 FAIL＋原因，禁止順手修。
禁止整檔讀大檔（Grep+窗口讀）。

回報格式：
1. 總判定：ACCEPT / REJECT（一行）
2. 逐條 PASS/FAIL 表＋證據
3. REJECT 時：最小重現/定位資訊（檔名:行號、錯在哪），不寫修法
```
