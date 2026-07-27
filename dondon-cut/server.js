// dondon-cut 本機伺服器
// 只用 Node 內建模組，不需要 npm install。
//   node server.js            → http://localhost:5173
//   PORT=6000 node server.js  → 換連接埠

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROJECTS_DIR = path.join(ROOT, 'projects');
const MEDIA_DIR = path.join(ROOT, 'media');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.srt': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// ---------------------------------------------------------------- 工具

/** 把 urlPath 解析到 base 之下，擋掉 ../ 之類的路徑逃逸。回傳 null 代表非法。 */
function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.resolve(base, decoded);
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function readJsonBody(req, limitBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (!total) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 靜態檔案 / 影片：支援 Range，否則 <video> 沒辦法拖曳快轉。 */
async function serveFile(req, res, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  if (stat.isDirectory()) return sendText(res, 404, 'Not found');

  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) {
        // bytes=-N → 最後 N bytes
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else {
        if (start === null) start = 0;
        if (end === null || end >= stat.size) end = stat.size - 1;
      }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------- 專案

function projectDir(name) {
  if (!/^[A-Za-z0-9._一-鿿-]+$/.test(name)) return null;
  return path.join(PROJECTS_DIR, name);
}

async function listProjects() {
  let entries;
  try {
    entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(PROJECTS_DIR, e.name, 'project.json');
    try {
      const proj = JSON.parse(await fsp.readFile(file, 'utf8'));
      out.push({
        name: e.name,
        source: proj.source || '',
        duration: proj.duration || 0,
        clips: Array.isArray(proj.clips) ? proj.clips.length : 0,
      });
    } catch {
      // 資料夾在但 project.json 壞了/還沒產生 — 跳過，不要讓整個清單掛掉
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 寫檔用「先寫暫存再 rename」，避免 Claude 和 UI 同時寫時讀到半截 JSON。 */
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

// ---------------------------------------------------------------- SSE：檔案變動推播
// Claude 在 terminal 改了 project.json，瀏覽器要立刻看到 —— 這就是「串流協作」的那條線。

const sseClients = new Set();
const mtimeCache = new Map();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

async function pollProjects() {
  try {
    const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    const seen = new Set();
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(PROJECTS_DIR, e.name, 'project.json');
      seen.add(e.name);
      try {
        const st = await fsp.stat(file);
        const key = `${st.mtimeMs}:${st.size}`;
        const prev = mtimeCache.get(e.name);
        mtimeCache.set(e.name, key);
        if (prev !== undefined && prev !== key) {
          broadcast({ type: 'project-changed', name: e.name });
        }
      } catch {
        mtimeCache.delete(e.name);
      }
    }
    for (const name of [...mtimeCache.keys()]) {
      if (!seen.has(name)) mtimeCache.delete(name);
    }
  } catch {
    // projects/ 還不存在，忽略
  }
}

// ---------------------------------------------------------------- 背景工作（匯入 / 匯出）

const jobs = new Map();
let jobSeq = 0;

function startJob(label, cmd, args) {
  const id = String(++jobSeq);
  const job = { id, label, lines: [], done: false, code: null };
  jobs.set(id, job);
  broadcast({ type: 'job-start', id, label });

  const child = spawn(cmd, args, { cwd: ROOT });
  const push = (text) => {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line) continue;
      job.lines.push(line);
      if (job.lines.length > 500) job.lines.shift();
      broadcast({ type: 'job-log', id, line });
    }
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (err) => {
    push(`啟動失敗：${err.message}`);
  });
  child.on('close', (code) => {
    job.done = true;
    job.code = code;
    broadcast({ type: 'job-done', id, code });
  });
  return job;
}

// ---------------------------------------------------------------- 路由

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    // --- 事件串流
    if (p === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      sseClients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* 連線已斷，下面的 close 會收掉 */
        }
      }, 20000);
      req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(res);
      });
      return;
    }

    // --- 專案清單
    if (p === '/api/projects' && req.method === 'GET') {
      return sendJson(res, 200, { projects: await listProjects() });
    }

    // --- 單一專案的 project.json
    const projMatch = /^\/api\/project\/([^/]+)$/.exec(p);
    if (projMatch) {
      const name = decodeURIComponent(projMatch[1]);
      const dir = projectDir(name);
      if (!dir) return sendJson(res, 400, { error: 'bad project name' });
      const file = path.join(dir, 'project.json');

      if (req.method === 'GET') {
        try {
          return sendJson(res, 200, JSON.parse(await fsp.readFile(file, 'utf8')));
        } catch {
          return sendJson(res, 404, { error: 'project not found' });
        }
      }
      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (!body || !Array.isArray(body.clips)) {
          return sendJson(res, 400, { error: 'clips 必須是陣列' });
        }
        body.updatedBy = 'ui';
        body.updatedAt = new Date().toISOString();
        await writeJsonAtomic(file, body);
        // 自己寫的不必再推播回來，更新快取避免 poll 誤判
        try {
          const st = await fsp.stat(file);
          mtimeCache.set(name, `${st.mtimeMs}:${st.size}`);
        } catch {
          /* 剛寫完就被刪，下一輪 poll 會處理 */
        }
        return sendJson(res, 200, { ok: true });
      }
      return sendText(res, 405, 'Method not allowed');
    }

    // --- 逐字稿
    const trMatch = /^\/api\/transcript\/([^/]+)$/.exec(p);
    if (trMatch && req.method === 'GET') {
      const dir = projectDir(decodeURIComponent(trMatch[1]));
      if (!dir) return sendJson(res, 400, { error: 'bad project name' });
      try {
        const raw = await fsp.readFile(path.join(dir, 'transcript.json'), 'utf8');
        return sendJson(res, 200, JSON.parse(raw));
      } catch {
        return sendJson(res, 200, { segments: [] });
      }
    }

    // --- 匯出
    const exMatch = /^\/api\/export\/([^/]+)$/.exec(p);
    if (exMatch && req.method === 'POST') {
      const name = decodeURIComponent(exMatch[1]);
      if (!projectDir(name)) return sendJson(res, 400, { error: 'bad project name' });
      const body = (await readJsonBody(req)) || {};
      const args = [path.join('scripts', 'export.mjs'), name];
      if (body.burnSubtitles) args.push('--subs');
      const job = startJob(`匯出 ${name}`, process.execPath, args);
      return sendJson(res, 200, { jobId: job.id });
    }

    // --- 工作紀錄（重新整理後撈回歷史）
    const jobMatch = /^\/api\/job\/([^/]+)$/.exec(p);
    if (jobMatch && req.method === 'GET') {
      const job = jobs.get(jobMatch[1]);
      if (!job) return sendJson(res, 404, { error: 'no such job' });
      return sendJson(res, 200, job);
    }

    // --- 原始影片（要 Range）
    if (p.startsWith('/media/')) {
      const f = safeJoin(MEDIA_DIR, p.slice('/media/'.length));
      if (!f) return sendText(res, 403, 'Forbidden');
      return serveFile(req, res, f);
    }

    // --- 專案資產（縮圖等）
    if (p.startsWith('/projects/')) {
      const f = safeJoin(PROJECTS_DIR, p.slice('/projects/'.length));
      if (!f) return sendText(res, 403, 'Forbidden');
      return serveFile(req, res, f);
    }

    // --- 匯出成品
    if (p.startsWith('/exports/')) {
      const f = safeJoin(EXPORTS_DIR, p.slice('/exports/'.length));
      if (!f) return sendText(res, 403, 'Forbidden');
      return serveFile(req, res, f);
    }

    // --- 前端
    const rel = p === '/' ? 'index.html' : p;
    const f = safeJoin(PUBLIC_DIR, rel);
    if (!f) return sendText(res, 403, 'Forbidden');
    return serveFile(req, res, f);
  } catch (err) {
    return sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

for (const dir of [PROJECTS_DIR, MEDIA_DIR, EXPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

setInterval(pollProjects, 700).unref();
pollProjects();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  剪片台已啟動 →  http://localhost:${PORT}\n`);
  console.log('  把影片放進 media/ ，然後在另一個終端機跑：');
  console.log('    npm run ingest media/你的影片.mp4\n');
});
