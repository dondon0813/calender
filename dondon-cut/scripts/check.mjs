// 檢查 project.json 有沒有寫壞。改完剪輯一定要跑這個。
//   npm run check <專案名字>

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv.slice(2).find((a) => !a.startsWith('-'));

if (!name) {
  console.error('用法：npm run check <專案名字>');
  process.exit(1);
}

const file = path.join(ROOT, 'projects', name, 'project.json');
let proj;
try {
  proj = JSON.parse(await fsp.readFile(file, 'utf8'));
} catch (e) {
  console.error(`讀不到或 JSON 壞了：${e.message}`);
  process.exit(1);
}

const errors = [];
const warnings = [];
const duration = Number(proj.duration) || 0;
const clips = proj.clips;

if (!Array.isArray(clips)) {
  console.error('clips 不是陣列');
  process.exit(1);
}
if (!clips.length) errors.push('clips 是空的，匯出會失敗');

const ids = new Set();
clips.forEach((c, i) => {
  const at = `clips[${i}]`;
  if (!c.id) errors.push(`${at} 沒有 id`);
  else if (ids.has(c.id)) errors.push(`${at} id 重複：${c.id}`);
  else ids.add(c.id);

  if (!Number.isFinite(c.in) || !Number.isFinite(c.out)) {
    errors.push(`${at} in/out 不是數字`);
    return;
  }
  if (c.in < 0) errors.push(`${at} in 是負數（${c.in}）`);
  if (c.out <= c.in) errors.push(`${at} out(${c.out}) 沒有大於 in(${c.in})`);
  if (duration && c.out > duration + 0.05) {
    errors.push(`${at} out(${c.out}) 超過影片長度(${duration})`);
  }
  if (c.out - c.in < 0.3) warnings.push(`${at} 只有 ${(c.out - c.in).toFixed(2)} 秒，會像閃一下`);
});

const total = clips.reduce((s, c) => s + Math.max(0, (c.out || 0) - (c.in || 0)), 0);

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;

console.log(`\n專案 ${name}`);
console.log(`  片段 ${clips.length} 個`);
console.log(`  原片 ${fmt(duration)} → 成品 ${fmt(total)}（保留 ${duration ? Math.round((total / duration) * 100) : 0}%）`);

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);

console.log('');
if (errors.length) {
  console.log('有問題，修好再叫使用者看。\n');
  process.exit(1);
}
console.log('沒問題。\n');
