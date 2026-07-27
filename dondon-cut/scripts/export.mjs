// 依 project.json 的 clips 真的把影片切出來。
//
//   npm run export <專案名字>
//   npm run export <專案名字> -- --subs     （順便把字幕燒進畫面）
//
// 產出 exports/<專案名字>.mp4 和 exports/<專案名字>.srt

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORTS_DIR = path.join(ROOT, 'exports');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd || ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => {
      err += d;
      // ffmpeg 的進度是走 stderr，直接透出去讓使用者看到有在動
      const line = String(d).trim().split(/\r?\n/).pop();
      if (line && /time=/.test(line)) process.stdout.write(`\r  ${line.slice(0, 110)}`);
    });
    child.on('error', (e) => reject(new Error(`無法執行 ${cmd}：${e.message}`)));
    child.on('close', (code) => {
      process.stdout.write('\n');
      if (code === 0) resolve(err);
      else reject(new Error(`${cmd} 失敗（exit ${code}）\n${err.slice(-2500)}`));
    });
  });
}

/** 這台電腦有沒有這個指令 */
function hasCommand(cmd) {
  return new Promise((resolve) => {
    const child = spawn(os.platform() === 'win32' ? 'where' : 'which', [cmd]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdout.resume();
    child.stderr.resume();
  });
}

function hasAudioStream(src) {
  // 注意：spawn 的 'error' 是非同步事件，try/catch 抓不到，一定要掛 handler，
  // 不然 ffprobe 不存在時整個程式會噴原始堆疊。
  return new Promise((resolve) => {
    const child = spawn(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', src],
      { cwd: ROOT },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.resume();
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(out.trim().length > 0));
  });
}

function srtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

/**
 * 逐字稿的時間是「原片時間」，剪完之後時間軸會位移。
 * 這裡把每一段字幕投影到輸出時間軸上；跨越剪接點的會被切成兩段。
 */
function buildSrt(segments, clips) {
  const out = [];
  let offset = 0;
  for (const clip of clips) {
    const len = clip.out - clip.in;
    for (const seg of segments) {
      const start = Math.max(seg.start, clip.in);
      const end = Math.min(seg.end, clip.out);
      if (end - start <= 0.08) continue; // 只剩一點點尾巴就不要了
      out.push({
        start: offset + (start - clip.in),
        end: offset + (end - clip.in),
        text: seg.text,
      });
    }
    offset += len;
  }
  return out
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

function buildFilter(clips, withAudio) {
  const parts = [];
  const labels = [];
  clips.forEach((c, i) => {
    parts.push(`[0:v]trim=start=${c.in}:end=${c.out},setpts=PTS-STARTPTS[v${i}]`);
    labels.push(`[v${i}]`);
    if (withAudio) {
      parts.push(`[0:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS[a${i}]`);
      labels.push(`[a${i}]`);
    }
  });
  // concat 要求 v/a 交錯排列：[v0][a0][v1][a1]…
  const ordered = [];
  for (let i = 0; i < clips.length; i++) {
    ordered.push(`[v${i}]`);
    if (withAudio) ordered.push(`[a${i}]`);
  }
  parts.push(
    `${ordered.join('')}concat=n=${clips.length}:v=1:a=${withAudio ? 1 : 0}` +
      (withAudio ? '[outv][outa]' : '[outv]'),
  );
  void labels;
  return parts.join(';');
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const name = argv.find((a) => !a.startsWith('--'));
  const burn = argv.includes('--subs');

  if (!name) {
    console.error('用法：npm run export <專案名字> [-- --subs]');
    process.exit(1);
  }

  if (!(await hasCommand('ffmpeg'))) {
    console.error('找不到 ffmpeg，沒辦法匯出。Mac 跑 bash setup-mac.sh，Windows 跑 .\\setup-windows.ps1');
    process.exit(1);
  }

  const dir = path.join(ROOT, 'projects', name);
  const projectFile = path.join(dir, 'project.json');
  if (!fs.existsSync(projectFile)) {
    console.error(`找不到專案：${name}（projects/ 底下沒有這個資料夾）`);
    process.exit(1);
  }

  const proj = JSON.parse(await fsp.readFile(projectFile, 'utf8'));
  const src = path.resolve(ROOT, proj.source);
  if (!fs.existsSync(src)) {
    console.error(`找不到原始影片：${proj.source}`);
    process.exit(1);
  }

  const clips = (proj.clips || [])
    .map((c) => ({ ...c, in: Number(c.in), out: Number(c.out) }))
    .filter((c) => Number.isFinite(c.in) && Number.isFinite(c.out) && c.out - c.in > 0.05);

  if (!clips.length) {
    console.error('這個專案沒有任何片段，沒東西可以匯出。');
    process.exit(1);
  }

  await fsp.mkdir(EXPORTS_DIR, { recursive: true });

  const total = clips.reduce((s, c) => s + (c.out - c.in), 0);
  console.log(`\n匯出「${name}」：${clips.length} 段，共 ${(total / 60).toFixed(1)} 分鐘`);

  // 字幕
  let srtName = null;
  try {
    const tr = JSON.parse(await fsp.readFile(path.join(dir, 'transcript.json'), 'utf8'));
    if (tr.segments?.length) {
      srtName = `${name}.srt`;
      await fsp.writeFile(path.join(EXPORTS_DIR, srtName), buildSrt(tr.segments, clips), 'utf8');
      console.log(`  字幕檔：exports/${srtName}`);
    }
  } catch {
    // 沒逐字稿就沒字幕，不是錯誤
  }
  if (burn && !srtName) {
    console.log('  ! 沒有逐字稿，無法燒字幕，改成只輸出影片');
  }

  const withAudio = await hasAudioStream(src);
  if (!withAudio) console.log('  ! 這支影片沒有音軌');

  const finalOut = path.join(EXPORTS_DIR, `${name}.mp4`);
  const stageOut = burn && srtName ? path.join(EXPORTS_DIR, `${name}.nosubs.mp4`) : finalOut;

  const args = [
    '-y', '-v', 'warning', '-stats',
    '-i', src,
    '-filter_complex', buildFilter(clips, withAudio),
    '-map', '[outv]',
  ];
  if (withAudio) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', stageOut);

  console.log('\n  剪接中…');
  await run('ffmpeg', args);

  if (burn && srtName) {
    console.log('  燒字幕中…');
    // 在 exports/ 底下執行，字幕就能用單純的檔名，省掉跨平台的路徑跳脫問題
    await run(
      'ffmpeg',
      [
        '-y', '-v', 'warning', '-stats',
        '-i', path.basename(stageOut),
        '-vf', `subtitles=${srtName}:force_style='FontSize=18,Outline=1,Shadow=0'`,
        '-c:a', 'copy',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        path.basename(finalOut),
      ],
      { cwd: EXPORTS_DIR },
    );
    await fsp.rm(stageOut, { force: true });
  }

  const st = await fsp.stat(finalOut);
  console.log(`\n完成 → exports/${name}.mp4（${(st.size / 1024 / 1024).toFixed(1)} MB）\n`);
}

main().catch((e) => {
  console.error(`\n匯出失敗：${e.message}\n`);
  process.exit(1);
});
