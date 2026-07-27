// 檢查這台電腦缺什麼。   npm run doctor

import os from 'node:os';
import { spawn } from 'node:child_process';

function which(cmd) {
  return new Promise((resolve) => {
    const probe = os.platform() === 'win32' ? 'where' : 'which';
    const child = spawn(probe, [cmd]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : null));
  });
}

const checks = [
  { cmd: 'node', need: true, why: '跑這個工具本身' },
  { cmd: 'ffmpeg', need: true, why: '抽縮圖、剪接、匯出' },
  { cmd: 'ffprobe', need: true, why: '讀影片長度' },
  { cmd: 'whisper', need: false, why: '產生逐字稿（openai-whisper）' },
  { cmd: 'whisper-cli', need: false, why: '產生逐字稿（whisper.cpp，需另設 WHISPER_CPP_MODEL）' },
];

console.log(`\n平台：${os.platform()} ${os.arch()}｜Node ${process.version}\n`);

let missingRequired = 0;
let hasWhisper = false;

for (const c of checks) {
  const found = await which(c.cmd);
  if (found) {
    console.log(`  ✓ ${c.cmd.padEnd(12)} ${found}`);
    if (c.cmd.startsWith('whisper')) hasWhisper = true;
  } else {
    console.log(`  ${c.need ? '✗' : '·'} ${c.cmd.padEnd(12)} 沒有 — ${c.why}`);
    if (c.need) missingRequired++;
  }
}

console.log('');
if (missingRequired) {
  console.log('缺少必要工具。Mac 跑 ./setup-mac.sh，Windows 用系統管理員開 PowerShell 跑 .\\setup-windows.ps1\n');
  process.exit(1);
}
if (!hasWhisper) {
  console.log('可以用了，但沒有 whisper＝沒有逐字稿，Claude 只能靠縮圖和靜音段判斷。');
  console.log('想要逐字稿：pip install -U openai-whisper\n');
} else {
  console.log('全部就緒。\n');
}
