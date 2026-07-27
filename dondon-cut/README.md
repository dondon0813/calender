# dondon cut

跟 Claude 一起剪片的本機工具。

**它的核心想法：Claude 不碰畫面，只改一份 `project.json`。**
那份 JSON 記的是「留哪幾段」，網頁照著它跳段播放原片 —— 所以預覽不用渲染、拖曳是即時的，
真正的 ffmpeg 只在你按「匯出」時跑一次。Claude 改它、你也改它，兩邊即時同步。

```
Claude 讀逐字稿 → 寫 clips ──┐
                              ├──→ project.json ──→ 網頁即時預覽 ──→ 匯出 mp4
你在時間軸上拖曳微調 ─────────┘
```

---

## 一、第一次安裝（只做一次）

**Mac**

```bash
bash setup-mac.sh
```

**Windows**：按「開始」→ 打 `powershell` → 對「Windows PowerShell」按右鍵 →
**以系統管理員身分執行**，然後貼上：

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
cd C:\你放這個資料夾的路徑
.\setup-windows.ps1
```

裝完後**把終端機關掉重開一次**（新裝的程式要重開才找得到），然後檢查：

```bash
npm run doctor
```

看到 `全部就緒` 就成功了。缺 whisper 也還是能用，只是 Claude 少了逐字稿這個最強的線索。

---

## 二、每次剪片的流程

**1. 影片丟進 `media/`**

**2. 匯入**（抽縮圖、抽音軌、找靜音、產逐字稿）

```bash
npm run ingest media/開箱影片.mp4
```

第一次跑 whisper 會下載模型，可能要等幾分鐘，之後就快了。
想直接把停頓和靜音先切掉：

```bash
npm run ingest media/開箱影片.mp4 -- --trim-silence
```

**3. 打開剪輯台**（另開一個終端機視窗，讓它一直開著）

```bash
npm start
```

瀏覽器打開 http://localhost:5173

**4. 叫 Claude 剪**

在 Claude Code 裡直接說人話：

> 幫我剪 開箱影片，把講錯話重講的部分刪掉，開場廢話砍到 10 秒以內

Claude 改完存檔的瞬間，**你的瀏覽器會自己更新**。不喜歡就按「復原」。

**5. 自己微調**

| 你想做的事 | 怎麼做 |
|---|---|
| 播放／暫停 | 空白鍵 |
| 前後移動 | ← → （按著 Shift 一次 5 秒） |
| 修剪片段長度 | 拖片段的**左右邊緣** |
| 換片段順序 | 拖片段的**中間** |
| 在游標處切一刀 | `S` |
| 刪掉片段 | 點選片段 → `Delete` |
| 復原 | `Ctrl/Cmd + Z` |
| 把剪掉的內容加回來 | 在上面那條「原片」軌**拖曳框選** → 按「加回這段」 |
| 跳到某句話 | 右邊逐字稿，點**時間** |
| 用逐字稿剪 | 點**文字**選取（Shift 可選一整段）→「只留選取」或「移除選取」 |

**6. 匯出**

右上角「匯出影片」。要字幕就先勾「燒字幕」。
成品在 `exports/`，字幕檔 `.srt` 也會一併產出（想在剪映之類的軟體另外調字幕可以直接拿去用）。

---

## 三、怎麼跟 Claude 講話最有效

Claude 看得到的是：**逐字稿（含時間碼）**、**每 5 秒一張縮圖**、**靜音區間**。
所以「靠語意判斷」的指令最準：

- ✅「把我講錯重來的段落刪掉，留後面那次」
- ✅「開場太長，濃縮成 3 句話以內」
- ✅「只留下講價格和成分的部分」
- ✅「每段之間的空白留 0.3 秒就好」
- ⚠️「這顆鏡頭有點糊，換掉」← 只能靠縮圖粗略判斷，不一定準
- ❌「卡在音樂節拍上」← 目前做不到

---

## 四、出問題時

| 症狀 | 處理 |
|---|---|
| `npm start` 說連接埠被佔用 | `PORT=6000 npm start`，改開 http://localhost:6000 |
| 網頁一片黑、影片不動 | 影片必須在 `media/` 裡面。不要用 `media/` 以外的路徑 ingest |
| 剪接點會停頓一下 | 正常。預覽是即時跳段，會有幾格延遲；**匯出的成品是準的** |
| 沒有逐字稿 | `npm run doctor` 看 whisper 有沒有裝到 |
| 逐字稿是簡體 | `WHISPER_LANG=zh` 已預設；想更準用 `WHISPER_MODEL=medium npm run ingest ...`（比較慢） |
| Claude 改壞了 | 按「復原」。或 `git diff` 看它動了什麼 |

---

## 五、資料夾長怎樣

```
media/              ← 你的原始影片（不進 git）
projects/<名字>/
  project.json      ← 剪輯決策。Claude 和網頁共同編輯的那一份
  transcript.json   ← 逐字稿（程式讀）
  transcript.md     ← 逐字稿（Claude 讀，帶時間碼）
  silence.json      ← 靜音區間
  frames/           ← 每 5 秒一張縮圖（不進 git）
exports/            ← 匯出的成品（不進 git）
```

`project.json` 和逐字稿**有進 git**，體積很小。所以你隨時可以回頭看某支片當初怎麼剪的。
