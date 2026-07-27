# Windows 一鍵安裝。
# 用法：按「開始」→ 打 powershell → 對「Windows PowerShell」按右鍵 →「以系統管理員身分執行」
#       然後在視窗裡打：
#           Set-ExecutionPolicy -Scope Process Bypass -Force
#           cd <這個資料夾的路徑>
#           .\setup-windows.ps1

$ErrorActionPreference = 'Continue'

function Say($t) { Write-Host "`n$t" -ForegroundColor Cyan }
function Ok($t)  { Write-Host "  [OK] $t" -ForegroundColor Green }
function Bad($t) { Write-Host "  [!!] $t" -ForegroundColor Red }
function Have($c) { $null -ne (Get-Command $c -ErrorAction SilentlyContinue) }

Say "dondon cut 環境安裝（Windows）"

if (-not (Have 'winget')) {
  Bad "找不到 winget（Windows 套件安裝程式）。"
  Write-Host "  請先到 Microsoft Store 搜尋並安裝『應用程式安裝程式 / App Installer』，再重跑這個檔案。"
  exit 1
}

# --- ffmpeg -------------------------------------------------------------
if (Have 'ffmpeg') {
  Ok "ffmpeg 已安裝"
} else {
  Say "安裝 ffmpeg（影片剪接引擎）"
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
}

# --- Node ---------------------------------------------------------------
if (Have 'node') {
  Ok "Node.js 已安裝 ($(node --version))"
} else {
  Say "安裝 Node.js"
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
}

# --- Python + whisper ---------------------------------------------------
if (Have 'whisper') {
  Ok "whisper 已安裝"
} else {
  if (-not (Have 'python')) {
    Say "安裝 Python（whisper 需要）"
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  }
  Say "安裝 whisper（產生逐字稿，Claude 靠它讀懂你的影片）"
  # winget 裝完新的程式要重開視窗 PATH 才會更新，這裡先把常見路徑臨時補上
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [System.Environment]::GetEnvironmentVariable('Path', 'User')
  if (Have 'python') {
    python -m pip install --upgrade pip
    python -m pip install --upgrade openai-whisper
  } else {
    Bad "Python 還沒進 PATH。請把這個視窗關掉、重新以系統管理員開啟 PowerShell，再跑一次這個檔案。"
  }
}

Say "檢查結果"
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')
if (Have 'node') { node scripts\doctor.mjs } else { Bad "Node 還沒進 PATH，請重開 PowerShell 再跑 npm run doctor" }

Say "接下來"
@"
  1. 把影片放進 media\ 資料夾
  2. 終端機執行：  npm run ingest media\你的影片.mp4
  3. 另開一個終端機：  npm start     → 瀏覽器打開 http://localhost:5173
  4. 在 Claude Code 裡說：「幫我剪 <專案名字>」

  註：剛裝完的程式要「關掉終端機再開一次」才找得到。
"@ | Write-Host
