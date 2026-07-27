// dondon cut — 剪輯台前端
//
// 核心觀念：畫面上看到的「成品」不是渲染出來的，是照 project.json 的 clips
// 依序跳段播放原片。所以修剪、換順序、刪除都是零等待，真正的 ffmpeg 只在匯出時跑一次。

const $ = (id) => document.getElementById(id);

const el = {
  picker: $('projectPicker'),
  saveState: $('saveState'),
  exportBtn: $('exportBtn'),
  burnSubs: $('burnSubs'),
  video: $('video'),
  videoHint: $('videoHint'),
  playBtn: $('playBtn'),
  curTime: $('curTime'),
  totalTime: $('totalTime'),
  clipHint: $('clipHint'),
  splitBtn: $('splitBtn'),
  deleteBtn: $('deleteBtn'),
  undoBtn: $('undoBtn'),
  sourceTrack: $('sourceTrack'),
  sourceKept: $('sourceKept'),
  sourceSel: $('sourceSel'),
  sourceHead: $('sourceHead'),
  addSelBtn: $('addSelBtn'),
  timeline: $('timeline'),
  clipLayer: $('clipLayer'),
  playhead: $('playhead'),
  transcript: $('transcript'),
  transcriptCount: $('transcriptCount'),
  keepSelBtn: $('keepSelBtn'),
  dropSelBtn: $('dropSelBtn'),
  clearSelBtn: $('clearSelBtn'),
  log: $('log'),
  logTitle: $('logTitle'),
  logBody: $('logBody'),
  logClose: $('logClose'),
  toast: $('toast'),
};

const state = {
  name: null,
  project: null,
  segments: [],
  picked: new Set(),
  lastPicked: null,
  selectedClip: null,
  activeIndex: -1,
  virtual: 0,
  playing: false,
  sourcePreview: false,
  pps: 24, // timeline 每秒幾個 px
  history: [],
  saveTimer: null,
  selRange: null,
};

// ---------------------------------------------------------------- 小工具

const fmt = (t) => {
  const s = Math.max(0, t || 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

const clips = () => state.project?.clips || [];
const clipDur = (c) => Math.max(0, c.out - c.in);
const totalDur = () => clips().reduce((s, c) => s + clipDur(c), 0);

/** 每個片段在「成品時間軸」上的起點 */
function offsets() {
  const out = [];
  let acc = 0;
  for (const c of clips()) {
    out.push(acc);
    acc += clipDur(c);
  }
  return out;
}

function toast(msg, ms = 2600) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add('hidden'), ms);
}

function uid() {
  return 'c' + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------- 存檔 / 復原

function snapshot() {
  state.history.push(JSON.stringify(clips()));
  if (state.history.length > 60) state.history.shift();
  el.undoBtn.disabled = false;
}

function undo() {
  const prev = state.history.pop();
  if (!prev) return;
  state.project.clips = JSON.parse(prev);
  el.undoBtn.disabled = !state.history.length;
  render();
  save();
  toast('已復原');
}

function markDirty() {
  el.saveState.textContent = '未存檔';
  el.saveState.className = 'save-state dirty';
}

function save() {
  if (!state.name || !state.project) return;
  markDirty();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(state.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.project),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      el.saveState.textContent = '已存檔';
      el.saveState.className = 'save-state';
    } catch (e) {
      el.saveState.textContent = '存檔失敗';
      el.saveState.className = 'save-state dirty';
      toast(`存檔失敗：${e.message}`);
    }
  }, 350);
}

// ---------------------------------------------------------------- 載入

async function loadProjects(preferred) {
  const { projects } = await (await fetch('/api/projects')).json();
  el.picker.innerHTML = '';
  if (!projects.length) {
    el.picker.innerHTML = '<option value="">（還沒有專案）</option>';
    el.videoHint.textContent = '把影片放進 media/ ，然後跑 npm run ingest media/檔名.mp4';
    return;
  }
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = `${p.name}（${p.clips} 段）`;
    el.picker.appendChild(o);
  }
  const pick = projects.some((p) => p.name === preferred) ? preferred : projects[0].name;
  el.picker.value = pick;
  await openProject(pick);
}

async function openProject(name) {
  state.name = name;
  state.history = [];
  state.picked.clear();
  state.selectedClip = null;
  state.activeIndex = -1;
  state.virtual = 0;
  el.undoBtn.disabled = true;

  const proj = await (await fetch(`/api/project/${encodeURIComponent(name)}`)).json();
  if (proj.error) return toast(proj.error);
  state.project = proj;

  const tr = await (await fetch(`/api/transcript/${encodeURIComponent(name)}`)).json();
  state.segments = tr.segments || [];

  el.video.src = '/' + String(proj.source || '').replace(/^\/+/, '');
  el.videoHint.classList.add('hidden');
  el.saveState.textContent = '已存檔';
  el.saveState.className = 'save-state';

  fitZoom();
  renderTranscript();
  render();
  seekVirtual(0);
  localStorage.setItem('dondon-cut:last', name);
}

/** Claude 在 terminal 改了檔案 → 這裡把新版本吃進來 */
async function reloadFromDisk() {
  if (!state.name) return;
  const proj = await (await fetch(`/api/project/${encodeURIComponent(state.name)}`)).json();
  if (proj.error) return;
  if (JSON.stringify(proj.clips) === JSON.stringify(clips())) return;

  snapshot(); // 先把目前版本留在復原堆疊，Claude 改壞了你按一下就回來
  const at = state.virtual;
  state.project = proj;
  render();
  seekVirtual(Math.min(at, totalDur()));
  el.saveState.textContent = '已同步';
  el.saveState.className = 'save-state remote';
  toast('Claude 更新了剪輯（不喜歡就按復原）', 4000);
}

// ---------------------------------------------------------------- 播放引擎

function locate(v) {
  const offs = offsets();
  const cs = clips();
  for (let i = cs.length - 1; i >= 0; i--) {
    if (v >= offs[i] - 1e-6) return { index: i, into: Math.max(0, v - offs[i]) };
  }
  return cs.length ? { index: 0, into: 0 } : { index: -1, into: 0 };
}

function seekVirtual(v) {
  const total = totalDur();
  state.virtual = Math.max(0, Math.min(v, total));
  const { index, into } = locate(state.virtual);
  state.activeIndex = index;
  state.sourcePreview = false;
  if (index >= 0) {
    const c = clips()[index];
    el.video.currentTime = Math.min(c.in + into, Math.max(c.in, c.out - 0.03));
  }
  paint();
}

/** 直接看原片的某個時間點（例如點了一段已經被剪掉的逐字稿） */
function previewSource(t) {
  pause();
  state.sourcePreview = true;
  state.activeIndex = -1;
  el.video.currentTime = Math.max(0, Math.min(t, state.project.duration || t));
  paint();
}

function play() {
  if (!clips().length) return;
  if (state.sourcePreview) seekVirtual(state.virtual);
  state.playing = true;
  el.playBtn.textContent = '❚❚';
  el.video.play().catch(() => {
    state.playing = false;
    el.playBtn.textContent = '▶';
  });
}

function pause() {
  state.playing = false;
  el.playBtn.textContent = '▶';
  el.video.pause();
}

function tick() {
  requestAnimationFrame(tick);
  if (!state.project) return;

  if (state.sourcePreview) {
    paintPlayheads(null);
    return;
  }

  const cs = clips();
  const i = state.activeIndex;
  if (i < 0 || i >= cs.length) return;
  const c = cs[i];
  const t = el.video.currentTime;

  if (state.playing) {
    // 到了這一段的尾巴 → 跳到下一段的頭。這就是「不渲染的剪接」。
    if (t >= c.out - 0.03 || t < c.in - 0.35) {
      const next = i + 1;
      if (next < cs.length) {
        state.activeIndex = next;
        el.video.currentTime = cs[next].in;
      } else {
        pause();
        state.virtual = totalDur();
        paint();
        return;
      }
    }
  }

  const offs = offsets();
  const cur = clips()[state.activeIndex];
  if (cur) state.virtual = offs[state.activeIndex] + Math.max(0, el.video.currentTime - cur.in);
  paintPlayheads(cur);
}

// ---------------------------------------------------------------- 畫面

function fitZoom() {
  const w = el.timeline.clientWidth || 800;
  const total = totalDur() || state.project?.duration || 60;
  state.pps = Math.max(2, Math.min(200, (w - 8) / total));
}

function frameUrl(t) {
  const iv = state.project?.frameInterval || 5;
  const idx = Math.max(1, Math.floor(t / iv) + 1);
  return `/projects/${encodeURIComponent(state.name)}/frames/${String(idx).padStart(5, '0')}.jpg`;
}

function render() {
  if (!state.project) return;
  el.totalTime.textContent = fmt(totalDur());
  renderClips();
  renderSource();
  markTranscript();
  el.deleteBtn.disabled = !state.selectedClip;
  el.picker.value = state.name;
}

function renderClips() {
  const offs = offsets();
  el.clipLayer.innerHTML = '';
  el.clipLayer.style.width = `${Math.max(el.timeline.clientWidth, totalDur() * state.pps + 4)}px`;

  clips().forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'clip' + (state.selectedClip === c.id ? ' selected' : '');
    d.style.left = `${offs[i] * state.pps}px`;
    d.style.width = `${Math.max(3, clipDur(c) * state.pps)}px`;
    d.style.backgroundImage = `url("${frameUrl(c.in)}")`;
    d.dataset.index = String(i);
    d.innerHTML =
      `<div class="clip-body"><em>${fmt(c.in)}→${fmt(c.out)}</em>${
        c.note ? escapeHtml(c.note) : ''
      }</div>` +
      '<div class="handle left"></div><div class="handle right"></div>';
    el.clipLayer.appendChild(d);
  });
}

function renderSource() {
  const total = state.project.duration || 1;
  const w = el.sourceTrack.clientWidth || 1;
  el.sourceKept.innerHTML = '';
  // 合併重疊區段，避免一堆半透明方塊疊出深淺不一的顏色
  const ranges = clips()
    .map((c) => [c.in, c.out])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.01) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  for (const [a, b] of merged) {
    const d = document.createElement('div');
    d.className = 'kept-block';
    d.style.left = `${(a / total) * w}px`;
    d.style.width = `${Math.max(1, ((b - a) / total) * w)}px`;
    el.sourceKept.appendChild(d);
  }
}

function paint() {
  paintPlayheads(state.activeIndex >= 0 ? clips()[state.activeIndex] : null);
}

function paintPlayheads(cur) {
  // playhead 是 #timeline 的絕對定位子元素，會跟著捲動一起移動，
  // 所以這裡用「內容座標」就好，不要再扣 scrollLeft。
  const x = state.virtual * state.pps;
  el.playhead.style.left = `${x}px`;

  // 只有播放中才自動捲動，不然使用者手動捲去看別的地方會被彈回來
  if (state.playing) {
    const view = el.timeline.clientWidth;
    if (x < el.timeline.scrollLeft + 20) {
      el.timeline.scrollLeft = Math.max(0, x - 20);
    } else if (x > el.timeline.scrollLeft + view - 40) {
      el.timeline.scrollLeft = x - view + 40;
    }
  }

  const total = state.project?.duration || 1;
  const raw = el.video.currentTime || 0;
  el.sourceHead.style.left = `${(raw / total) * (el.sourceTrack.clientWidth || 1)}px`;
  el.curTime.textContent = fmt(state.virtual);

  el.clipHint.textContent = state.sourcePreview
    ? `原片 ${fmt(raw)}（這段沒被留下）`
    : cur
      ? `第 ${state.activeIndex + 1}/${clips().length} 段 · 原片 ${fmt(raw)}`
      : '';

  highlightPlayingSegment(raw);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
}

// ---------------------------------------------------------------- 逐字稿

function renderTranscript() {
  lastPlayingSeg = -1; // DOM 重建了，快取要跟著失效
  el.transcriptCount.textContent = state.segments.length ? `${state.segments.length} 段` : '';
  if (!state.segments.length) {
    el.transcript.innerHTML =
      '<p class="muted pad">還沒有逐字稿。安裝 whisper 後重新 ingest 就會出現。</p>';
    return;
  }
  el.transcript.innerHTML = '';
  state.segments.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'seg';
    row.dataset.i = String(i);
    row.innerHTML =
      `<time title="點時間＝跳到這裡">${fmt(s.start)}</time>` +
      `<span title="點文字＝選取，Shift 點＝選一整段">${escapeHtml(s.text)}</span>`;
    el.transcript.appendChild(row);
  });
  markTranscript();
}

function coveredBy(seg) {
  const mid = (seg.start + seg.end) / 2;
  return clips().some((c) => mid >= c.in && mid <= c.out);
}

function markTranscript() {
  for (const row of el.transcript.querySelectorAll('.seg')) {
    const i = Number(row.dataset.i);
    const seg = state.segments[i];
    if (!seg) continue;
    row.classList.toggle('kept', coveredBy(seg));
    row.classList.toggle('dropped', !coveredBy(seg));
    row.classList.toggle('picked', state.picked.has(i));
  }
  const any = state.picked.size > 0;
  el.keepSelBtn.disabled = !any;
  el.dropSelBtn.disabled = !any;
}

// 每一格畫面都會呼叫，所以只在「換句話」的那一刻才動 DOM
let lastPlayingSeg = -1;
function highlightPlayingSegment(raw) {
  if (!state.segments.length) return;
  const i = state.segments.findIndex((s) => raw >= s.start && raw <= s.end);
  if (i === lastPlayingSeg) return;

  const prev = el.transcript.querySelector('.seg.playing');
  if (prev) prev.classList.remove('playing');
  lastPlayingSeg = i;
  if (i < 0) return;

  const row = el.transcript.querySelector(`.seg[data-i="${i}"]`);
  if (row) {
    row.classList.add('playing');
    if (state.playing) row.scrollIntoView({ block: 'nearest' });
  }
}

/** 把逐字稿選取的段落轉成「原片時間區間」，相鄰的合併起來 */
function pickedRanges() {
  const idx = [...state.picked].sort((a, b) => a - b);
  const out = [];
  for (const i of idx) {
    const s = state.segments[i];
    if (!s) continue;
    const last = out[out.length - 1];
    if (last && s.start - last.out <= 0.6) last.out = s.end;
    else out.push({ in: s.start, out: s.end });
  }
  return out;
}

// ---------------------------------------------------------------- 剪輯操作

function sortClipsByTimeline() {
  // clips 的順序就是成品順序，這裡不重排，只是保證數值合法
  for (const c of clips()) {
    c.in = Math.max(0, Math.min(c.in, state.project.duration));
    c.out = Math.max(c.in + 0.05, Math.min(c.out, state.project.duration));
  }
}

function addRange(a, b) {
  if (b - a < 0.1) return;
  snapshot();
  const insertAt = clips().findIndex((c) => c.in > a);
  const clip = { id: uid(), in: Number(a.toFixed(3)), out: Number(b.toFixed(3)), note: '' };
  if (insertAt < 0) clips().push(clip);
  else clips().splice(insertAt, 0, clip);
  sortClipsByTimeline();
  render();
  save();
}

function removeRange(a, b) {
  snapshot();
  const next = [];
  for (const c of clips()) {
    if (b <= c.in || a >= c.out) {
      next.push(c);
      continue;
    }
    if (a > c.in) next.push({ ...c, id: uid(), out: Number(a.toFixed(3)) });
    if (b < c.out) next.push({ ...c, id: uid(), in: Number(b.toFixed(3)) });
  }
  state.project.clips = next.filter((c) => clipDur(c) > 0.1);
  render();
  save();
}

function splitAtPlayhead() {
  const i = state.activeIndex;
  if (i < 0) return;
  const c = clips()[i];
  const at = el.video.currentTime;
  if (at <= c.in + 0.1 || at >= c.out - 0.1) return toast('游標太靠近片段邊緣，切不了');
  snapshot();
  const right = { ...c, id: uid(), in: Number(at.toFixed(3)) };
  c.out = Number(at.toFixed(3));
  clips().splice(i + 1, 0, right);
  state.selectedClip = right.id;
  render();
  save();
  toast('切好了');
}

function deleteSelected() {
  if (!state.selectedClip) return;
  snapshot();
  state.project.clips = clips().filter((c) => c.id !== state.selectedClip);
  state.selectedClip = null;
  render();
  seekVirtual(Math.min(state.virtual, totalDur()));
  save();
}

// ---------------------------------------------------------------- 滑鼠：成品軌

el.timeline.addEventListener('mousedown', (e) => {
  const clipEl = e.target.closest('.clip');
  const rect = el.clipLayer.getBoundingClientRect();

  if (!clipEl) {
    state.selectedClip = null;
    render();
    seekVirtual((e.clientX - rect.left) / state.pps);
    return;
  }

  const i = Number(clipEl.dataset.index);
  const c = clips()[i];
  state.selectedClip = c.id;
  render();

  const handle = e.target.closest('.handle');
  const startX = e.clientX;
  const orig = { in: c.in, out: c.out };
  let moved = false;

  const onMove = (ev) => {
    const dt = (ev.clientX - startX) / state.pps;
    if (Math.abs(ev.clientX - startX) > 3 && !moved) {
      moved = true;
      snapshot();
      if (!handle) clipEl.classList.add('dragging');
    }
    if (!moved) return;

    if (handle?.classList.contains('left')) {
      c.in = Math.max(0, Math.min(orig.in + dt, c.out - 0.1));
    } else if (handle?.classList.contains('right')) {
      c.out = Math.min(state.project.duration, Math.max(orig.out + dt, c.in + 0.1));
    } else {
      clipEl.style.transform = `translateX(${ev.clientX - startX}px)`;
      return;
    }
    renderClips();
    renderSource();
  };

  const onUp = (ev) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!moved) {
      seekVirtual(offsets()[i] + (ev.clientX - clipEl.getBoundingClientRect().left) / state.pps);
      return;
    }
    if (!handle) {
      // 放開的位置決定新的順序
      const x = ev.clientX - el.clipLayer.getBoundingClientRect().left;
      const offs = offsets();
      let target = clips().length - 1;
      for (let k = 0; k < clips().length; k++) {
        if (x < offs[k] + (clipDur(clips()[k]) * state.pps) / 2) {
          target = k;
          break;
        }
      }
      const [moving] = clips().splice(i, 1);
      clips().splice(Math.max(0, Math.min(target, clips().length)), 0, moving);
    }
    sortClipsByTimeline();
    render();
    seekVirtual(state.virtual);
    save();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  e.preventDefault();
});

// ---------------------------------------------------------------- 滑鼠：原片軌

el.sourceTrack.addEventListener('mousedown', (e) => {
  const rect = el.sourceTrack.getBoundingClientRect();
  const total = state.project?.duration || 1;
  const at = (x) => Math.max(0, Math.min(((x - rect.left) / rect.width) * total, total));
  const a = at(e.clientX);
  let b = a;
  let dragged = false;

  const paintSel = () => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    el.sourceSel.classList.remove('hidden');
    el.sourceSel.style.left = `${(lo / total) * rect.width}px`;
    el.sourceSel.style.width = `${((hi - lo) / total) * rect.width}px`;
    state.selRange = [lo, hi];
    el.addSelBtn.disabled = hi - lo < 0.2;
  };

  const onMove = (ev) => {
    b = at(ev.clientX);
    if (Math.abs(b - a) > 0.15) dragged = true;
    if (dragged) paintSel();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!dragged) {
      el.sourceSel.classList.add('hidden');
      state.selRange = null;
      el.addSelBtn.disabled = true;
      previewSource(a);
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  e.preventDefault();
});

el.addSelBtn.addEventListener('click', () => {
  if (!state.selRange) return;
  addRange(state.selRange[0], state.selRange[1]);
  el.sourceSel.classList.add('hidden');
  el.addSelBtn.disabled = true;
  state.selRange = null;
  toast('已加回');
});

// ---------------------------------------------------------------- 逐字稿互動

el.transcript.addEventListener('click', (e) => {
  const row = e.target.closest('.seg');
  if (!row) return;
  const i = Number(row.dataset.i);
  const seg = state.segments[i];

  if (e.target.tagName === 'TIME') {
    // 跳到這句話：留著的就在成品時間軸上找，剪掉的就直接看原片
    if (coveredBy(seg)) {
      const offs = offsets();
      const k = clips().findIndex((c) => seg.start >= c.in && seg.start <= c.out);
      if (k >= 0) return seekVirtual(offs[k] + (seg.start - clips()[k].in));
    }
    return previewSource(seg.start);
  }

  if (e.shiftKey && state.lastPicked !== null) {
    const [lo, hi] = [state.lastPicked, i].sort((a, b) => a - b);
    for (let k = lo; k <= hi; k++) state.picked.add(k);
  } else {
    if (state.picked.has(i)) state.picked.delete(i);
    else state.picked.add(i);
    state.lastPicked = i;
  }
  markTranscript();
});

el.keepSelBtn.addEventListener('click', () => {
  const ranges = pickedRanges();
  if (!ranges.length) return;
  snapshot();
  state.project.clips = ranges.map((r) => ({
    id: uid(),
    in: Number(Math.max(0, r.in - 0.1).toFixed(3)),
    out: Number(Math.min(state.project.duration, r.out + 0.1).toFixed(3)),
    note: '',
  }));
  state.picked.clear();
  render();
  seekVirtual(0);
  save();
  toast(`只留下 ${ranges.length} 段`);
});

el.dropSelBtn.addEventListener('click', () => {
  const ranges = pickedRanges();
  if (!ranges.length) return;
  for (const r of ranges.slice().reverse()) removeRange(r.in, r.out);
  state.picked.clear();
  render();
  toast('已移除');
});

el.clearSelBtn.addEventListener('click', () => {
  state.picked.clear();
  markTranscript();
});

// ---------------------------------------------------------------- 按鈕 / 鍵盤

el.playBtn.addEventListener('click', () => (state.playing ? pause() : play()));
el.splitBtn.addEventListener('click', splitAtPlayhead);
el.deleteBtn.addEventListener('click', deleteSelected);
el.undoBtn.addEventListener('click', undo);
el.picker.addEventListener('change', () => openProject(el.picker.value));
el.logClose.addEventListener('click', () => el.log.classList.add('hidden'));

for (const b of document.querySelectorAll('[data-nudge]')) {
  b.addEventListener('click', () => seekVirtual(state.virtual + Number(b.dataset.nudge)));
}
for (const b of document.querySelectorAll('[data-zoom]')) {
  b.addEventListener('click', () => {
    state.pps = Math.max(1, Math.min(300, state.pps * (b.dataset.zoom === 'in' ? 1.5 : 1 / 1.5)));
    render();
    paint();
  });
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    return undo();
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      return state.playing ? pause() : play();
    case 'ArrowLeft':
      e.preventDefault();
      return seekVirtual(state.virtual - (e.shiftKey ? 5 : 1));
    case 'ArrowRight':
      e.preventDefault();
      return seekVirtual(state.virtual + (e.shiftKey ? 5 : 1));
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      return deleteSelected();
  }
  if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    splitAtPlayhead();
  }
});

window.addEventListener('resize', () => {
  renderSource();
  paint();
});

// ---------------------------------------------------------------- 匯出

el.exportBtn.addEventListener('click', async () => {
  if (!state.name) return;
  el.exportBtn.disabled = true;
  el.logTitle.textContent = '匯出中…';
  el.logBody.textContent = '';
  el.log.classList.remove('hidden');
  try {
    const res = await fetch(`/api/export/${encodeURIComponent(state.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ burnSubtitles: el.burnSubs.checked }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (e) {
    el.exportBtn.disabled = false;
    toast(`匯出失敗：${e.message}`);
  }
});

// ---------------------------------------------------------------- 事件串流

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'project-changed' && msg.name === state.name) reloadFromDisk();
    if (msg.type === 'job-log') {
      el.logBody.textContent += msg.line + '\n';
      el.logBody.scrollTop = el.logBody.scrollHeight;
    }
    if (msg.type === 'job-done') {
      el.exportBtn.disabled = false;
      el.logTitle.textContent = msg.code === 0 ? '完成' : `失敗（代碼 ${msg.code}）`;
      toast(msg.code === 0 ? `匯出完成 → exports/${state.name}.mp4` : '匯出失敗，看看工作紀錄');
    }
  };
  es.onerror = () => {
    /* EventSource 會自己重連 */
  };
}

// ---------------------------------------------------------------- 啟動

el.video.addEventListener('loadedmetadata', () => {
  if (state.project && !state.project.duration) {
    state.project.duration = el.video.duration;
    render();
  }
});
el.video.addEventListener('ended', () => pause());

requestAnimationFrame(tick);
connectEvents();
loadProjects(localStorage.getItem('dondon-cut:last') || undefined).catch((e) =>
  toast(`載入失敗：${e.message}`),
);
