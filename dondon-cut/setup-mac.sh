#!/bin/bash
# Mac 一鍵安裝。在終端機執行：  bash setup-mac.sh
set -u

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  ✓ %s\n' "$1"; }
bad() { printf '  ✗ %s\n' "$1"; }

say "dondon cut 環境安裝（Mac）"

# --- Homebrew -----------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "安裝 Homebrew（會要你輸入電腦密碼，輸入時畫面不會動是正常的）"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
    bad "Homebrew 安裝失敗，請把畫面訊息貼給 Claude"; exit 1; }
  # Apple Silicon 的 brew 裝在 /opt/homebrew，要先讓這個 session 找得到
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
else
  ok "Homebrew 已安裝"
fi

# --- ffmpeg -------------------------------------------------------------
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg 已安裝"
else
  say "安裝 ffmpeg（影片剪接引擎，檔案有點大，請耐心等）"
  brew install ffmpeg || { bad "ffmpeg 安裝失敗"; exit 1; }
fi

# --- Node ---------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  ok "Node.js 已安裝（$(node --version)）"
else
  say "安裝 Node.js"
  brew install node || { bad "Node.js 安裝失敗"; exit 1; }
fi

# --- whisper（逐字稿，可選但強烈建議）-----------------------------------
if command -v whisper >/dev/null 2>&1; then
  ok "whisper 已安裝"
else
  say "安裝 whisper（產生逐字稿，Claude 靠它讀懂你的影片）"
  if ! command -v python3 >/dev/null 2>&1; then
    brew install python
  fi
  # 新版 macOS 的 python 會擋全域 pip，--user 是最不會出事的裝法
  python3 -m pip install --user --upgrade openai-whisper 2>/dev/null \
    || python3 -m pip install --user --break-system-packages --upgrade openai-whisper \
    || bad "whisper 裝失敗（沒關係，其他功能都能用，逐字稿之後再補）"

  # pip --user 裝的執行檔常常不在 PATH 上，這裡幫忙補進去
  USER_BIN="$(python3 -c 'import site,os;print(os.path.join(site.USER_BASE,"bin"))' 2>/dev/null)"
  if [ -n "${USER_BIN:-}" ] && [ -d "$USER_BIN" ]; then
    case ":$PATH:" in
      *":$USER_BIN:"*) ;;
      *)
        SHELL_RC="$HOME/.zshrc"
        if ! grep -qs "$USER_BIN" "$SHELL_RC" 2>/dev/null; then
          printf '\nexport PATH="%s:$PATH"\n' "$USER_BIN" >> "$SHELL_RC"
          ok "已把 whisper 的路徑寫進 ~/.zshrc（請關掉終端機再開一次）"
        fi
        ;;
    esac
  fi
fi

say "檢查結果"
node scripts/doctor.mjs

say "接下來"
cat <<'EOF'
  1. 把影片放進 media/ 資料夾
  2. 終端機執行：  npm run ingest media/你的影片.mp4
  3. 另開一個終端機：  npm start      → 瀏覽器打開 http://localhost:5173
  4. 在 Claude Code 裡說：「幫我剪 <專案名字>」
EOF
