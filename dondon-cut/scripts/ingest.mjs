// 匯入一支影片，準備好 Claude 剪片需要的所有素材。
//
//   npm run ingest media/raw.mp4
//   npm run ingest media/raw.mp4 -- --trim-silence   （順便先把靜音段切掉）
//
// 產出 projects/<名字>/
//   project.json     ← 剪輯決策，Claude 和 UI 共同編輯的那份
//   transcript.json  ← 逐字稿（給程式讀）
//   transcript.md    ← 逐字稿（給 Claude 讀，帶時間碼）
//   silence.json     ← 靜音區間
//   frames/          ← 每 5 秒一張縮圖，Claude 可以直接看畫面

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAME_INTERVAL = 5; // 秒

// ---------------------------------------------------------------- 小工具

function run(cmd, args, { capture = 'none' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: ['ignore', capture === 'none' ? 'inherit' : 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    if (child.stdout) child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => {
      err += d;
      if (capture === 'none') process.stderr.write('');
    });
    child.on('error', (e) =>
      reject(new Error(`找不到或無法執行 ${cmd}：${e.message}`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${cmd} 失敗（exit ${code}）\n${err.slice(-2000)}`));
    });
  });
}

async function has(cmd) {
  const probe = os.platform() === 'win32' ? 'where' : 'which';
  try {
    await run(probe, [cmd], { capture: 'both' });
    return true;
  } catch {
    return false;
  }
}

function fmt(t) {
  const s = Math.max(0, t);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = (s % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

function slug(name) {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w一-鿿-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

// ---------------------------------------------------------------- 各步驟

async function probeDuration(src) {
  const { out } = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', src],
    { capture: 'both' },
  );
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error('讀不到影片長度，檔案可能壞了或格式不支援');
  return d;
}

async function makeFrames(src, dir) {
  await fsp.mkdir(dir, { recursive: true });
  await run(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-i', src,
      '-vf', `fps=1/${FRAME_INTERVAL},scale=200:-2`,
      '-q:v', '5',
      path.join(dir, '%05d.jpg'),
    ],
    { capture: 'both' },
  );
}

async function extractAudio(src, wav) {
  await run(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', wav],
    { capture: 'both' },
  );
}

async function detectSilence(wav, { noise = '-32dB', dur = 0.6 } = {}) {
  const { err } = await run(
    'ffmpeg',
    ['-v', 'info', '-i', wav, '-af', `silencedetect=n=${noise}:d=${dur}`, '-f', 'null', '-'],
    { capture: 'both' },
  );
  const ranges = [];
  let start = null;
  for (const line of err.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) start = parseFloat(s[1]);
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && start !== null) {
      ranges.push({ start: Math.max(0, start), end: parseFloat(e[1]) });
      start = null;
    }
  }
  return ranges;
}

/** 支援兩種 whisper：openai-whisper（whisper）與 whisper.cpp（whisper-cli）。都沒有就跳過。 */
async function transcribe(wav, dir) {
  const model = process.env.WHISPER_MODEL || 'small';
  const lang = process.env.WHISPER_LANG || 'zh';

  if (await has('whisper-cli')) {
    const modelPath = process.env.WHISPER_CPP_MODEL;
    if (!modelPath) {
      console.log('  ! 偵測到 whisper-cli，但沒設定 WHISPER_CPP_MODEL，跳過逐字稿');
      return null;
    }
    const outBase = path.join(dir, 'whisper-out');
    await run(
      'whisper-cli',
      ['-m', modelPath, '-f', wav, '-l', lang, '-oj', '-of', outBase],
      { capture: 'both' },
    );
    const raw = JSON.parse(await fsp.readFile(`${outBase}.json`, 'utf8'));
    const segs = (raw.transcription || []).map((t) => ({
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
      text: String(t.text || '').trim(),
    }));
    await fsp.rm(`${outBase}.json`, { force: true });
    return segs.filter((s) => s.text);
  }

  if (await has('whisper')) {
    await run(
      'whisper',
      [
        wav,
        '--model', model,
        '--language', lang,
        '--output_format', 'json',
        '--output_dir', dir,
        '--verbose', 'False',
      ],
      { capture: 'both' },
    );
    const jsonPath = path.join(dir, `${path.basename(wav, '.wav')}.json`);
    const raw = JSON.parse(await fsp.readFile(jsonPath, 'utf8'));
    await fsp.rm(jsonPath, { force: true });
    return (raw.segments || [])
      .map((s) => ({ start: s.start, end: s.end, text: String(s.text || '').trim() }))
      .filter((s) => s.text);
  }

  return null;
}

/** 依靜音區間反推「有聲音」的片段，並把太短的碎片丟掉、留一點呼吸空間。 */
function clipsFromSilence(silence, duration, { pad = 0.15, minLen = 0.8 } = {}) {
  const speech = [];
  let cursor = 0;
  for (const s of silence) {
    if (s.start > cursor) speech.push({ in: cursor, out: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) speech.push({ in: cursor, out: duration });

  return speech
    .map((c) => ({
      in: Math.max(0, c.in - pad),
      out: Math.min(duration, c.out + pad),
    }))
    .filter((c) => c.out - c.in >= minLen)
    .map((c, i) => ({
      id: `c${i + 1}`,
      in: Number(c.in.toFixed(3)),
      out: Number(c.out.toFixed(3)),
      note: '',
    }));
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const src = argv.find((a) => !a.startsWith('--'));
  const trimSilence = argv.includes('--trim-silence');
  const noTranscript = argv.includes('--no-transcript');

  if (!src) {
    console.error('用法：npm run ingest media/你的影片.mp4 [-- --trim-silence]');
    process.exit(1);
  }
  if (!fs.existsSync(src)) {
    console.error(`找不到檔案：${src}`);
    process.exit(1);
  }
  if (!(await has('ffmpeg')) || !(await has('ffprobe'))) {
    console.error('找不到 ffmpeg / ffprobe。先跑 setup-mac.sh 或 setup-windows.ps1。');
    process.exit(1);
  }

  const name = slug(path.basename(src));
  const dir = path.join(ROOT, 'projects', name);
  await fsp.mkdir(dir, { recursive: true });

  // source 存成相對於專案根目錄的路徑，換電腦也不會壞
  const relSource = path.relative(ROOT, path.resolve(src)).split(path.sep).join('/');

  console.log(`\n匯入「${name}」`);

  console.log('  [1/5] 讀影片長度…');
  const duration = await probeDuration(src);
  console.log(`        ${fmt(duration)}`);

  console.log('  [2/5] 抽縮圖…');
  await makeFrames(src, path.join(dir, 'frames'));

  console.log('  [3/5] 抽音軌…');
  const wav = path.join(dir, 'audio.wav');
  await extractAudio(src, wav);

  console.log('  [4/5] 偵測靜音段…');
  const silence = await detectSilence(wav);
  await fsp.writeFile(
    path.join(dir, 'silence.json'),
    JSON.stringify({ ranges: silence }, null, 2),
    'utf8',
  );
  console.log(`        找到 ${silence.length} 段靜音`);

  let segments = [];
  if (noTranscript) {
    console.log('  [5/5] 跳過逐字稿（--no-transcript）');
  } else {
    console.log('  [5/5] 產生逐字稿…（第一次會下載模型，可能要等幾分鐘）');
    const result = await transcribe(wav, dir).catch((e) => {
      console.log(`        逐字稿失敗，先略過：${e.message}`);
      return null;
    });
    if (result) {
      segments = result;
      console.log(`        ${segments.length} 段`);
    } else {
      console.log('        沒有安裝 whisper，略過（之後補裝再跑一次就好）');
    }
  }

  await fsp.writeFile(
    path.join(dir, 'transcript.json'),
    JSON.stringify({ segments }, null, 2),
    'utf8',
  );

  // 給 Claude 讀的版本：一行一段，帶時間碼
  const md = [
    `# ${name} 逐字稿`,
    ``,
    `影片長度 ${fmt(duration)}｜共 ${segments.length} 段`,
    ``,
    ...segments.map((s) => `[${fmt(s.start)} → ${fmt(s.end)}] ${s.text}`),
    ``,
  ].join('\n');
  await fsp.writeFile(path.join(dir, 'transcript.md'), md, 'utf8');

  const clips = trimSilence
    ? clipsFromSilence(silence, duration)
    : [{ id: 'c1', in: 0, out: Number(duration.toFixed(3)), note: '整段原片' }];

  const projectFile = path.join(dir, 'project.json');
  if (fs.existsSync(projectFile)) {
    const backup = path.join(dir, 'project.backup.json');
    await fsp.copyFile(projectFile, backup);
    console.log(`\n  ! 已有 project.json，舊的備份到 ${path.relative(ROOT, backup)}`);
  }

  await fsp.writeFile(
    projectFile,
    JSON.stringify(
      {
        version: 1,
        name,
        source: relSource,
        duration: Number(duration.toFixed(3)),
        frameInterval: FRAME_INTERVAL,
        clips,
        updatedBy: 'ingest',
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`\n完成。${clips.length} 個片段。`);
  console.log(`  剪輯台：http://localhost:5173  （選「${name}」）`);
  console.log(`  要我幫你剪：在 Claude Code 說「幫我剪 ${name}」\n`);
}

main().catch((e) => {
  console.error(`\n出錯了：${e.message}\n`);
  process.exit(1);
});
