/* 自製選色器（雪莉 2026-09-30：iPhone 內建的「格線／光譜／滑桿」選色很難用）
   ─ 上方：Procreate 式圓盤——外圈拖色相，內圈拖飽和度（左→右）與亮度（上→下）
   ─ 下方：Adobe 式 HSB 三條滑桿（色相／飽和度／亮度），旁邊數字可以直接打
   ─ 色碼欄、改前改後對照（點「原本」還原）、最近用過的顏色
   掛法：頁面載入這支就好，所有 <input type="color"> 自動改用這個面板（包含之後動態加進來的）。
   原本的 input 仍是唯一的值來源：選色時改 input.value 並送出 input 事件，頁面原有的接線完全不用改；
   面板收起時再送一次 change。不想被接管的 input 加 data-native-color 屬性即可。 */
(function () {
  'use strict';
  if (window.__cpkLoaded) return;
  window.__cpkLoaded = true;

  const RECENT_KEY = 'cpk.recent.v1';
  const RECENT_MAX = 12;

  /* ---------- 色彩換算 ---------- */
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: max ? d / max : 0, v: max };
  }
  const hex2 = n => n.toString(16).padStart(2, '0');
  const rgbToHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
  function parseHex(str) {
    let t = String(str || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map(ch => ch + ch).join('');
    if (!/^[0-9a-f]{6}$/i.test(t)) return null;
    return [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
  }
  const hsvHex = (h, s, v) => rgbToHex.apply(null, hsvToRgb(h, s, v));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  /* 圓盤內圈：正方形（飽和度×亮度）用「橢圓格網映射」撐滿整個圓，
     四個角（純白、純色、黑）都落在圓周上摸得到（直接把正方形裁成圓會摸不到純白）。 */
  function discToSquare(u, v) {
    const u2 = u * u, v2 = v * v, t = 2 * Math.SQRT2;
    const x = 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 + t * u)) - 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 - t * u));
    const y = 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 + t * v)) - 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 - t * v));
    return [clamp(x, -1, 1), clamp(y, -1, 1)];
  }
  const squareToDisc = (x, y) => [x * Math.sqrt(1 - y * y / 2), y * Math.sqrt(1 - x * x / 2)];

  /* ---------- 樣式 ---------- */
  const css = `
.cpk-backdrop { position: fixed; inset: 0; z-index: 9998; background: transparent; }
.cpk-panel {
  position: fixed; z-index: 9999; box-sizing: border-box;
  width: 300px; padding: 14px 16px 16px;
  background: #fff; color: #5a4636;
  border-radius: 18px; box-shadow: 0 10px 36px rgba(90,60,40,.22), 0 0 0 1px rgba(90,60,40,.06);
  font-family: var(--font-body, system-ui, sans-serif); font-size: 13px;
  -webkit-user-select: none; user-select: none;
}
.cpk-panel.cpk-sheet {
  left: 0 !important; right: 0; bottom: 0; top: auto !important; width: auto;
  margin: 0 auto; max-width: 420px;
  border-radius: 20px 20px 0 0; padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
.cpk-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cpk-title { flex: 1; font-weight: 700; font-size: 14px; }
.cpk-done {
  border: 0; border-radius: 999px; padding: 6px 16px;
  background: var(--c-primary, #e98a9a); color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
}
.cpk-disc { position: relative; width: 220px; height: 220px; margin: 0 auto 12px; touch-action: none; }
.cpk-disc canvas { display: block; width: 220px; height: 220px; }
.cpk-knob {
  position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; box-sizing: border-box;
  border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 2px 6px rgba(0,0,0,.3);
  pointer-events: none;
}
.cpk-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.cpk-row > span { flex: 0 0 42px; color: #8a7565; font-size: 12px; }
.cpk-row input[type=range] {
  flex: 1; min-width: 0; height: 18px; margin: 0; border-radius: 999px;
  -webkit-appearance: none; appearance: none; background: #ddd; outline: none; touch-action: none;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.08);
}
.cpk-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%;
  background: #fff; border: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 2px 5px rgba(0,0,0,.3); cursor: pointer;
}
.cpk-row input[type=range]::-moz-range-thumb {
  width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 0;
  box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 2px 5px rgba(0,0,0,.3);
}
.cpk-row input[type=number], .cpk-hex {
  box-sizing: border-box; border: 1px solid #E6DCD2; border-radius: 8px; background: #fff; color: #5a4636;
  font-size: 13px; padding: 4px 6px; -webkit-appearance: none; appearance: none; -moz-appearance: textfield;
  -webkit-user-select: text; user-select: text;
}
.cpk-row input[type=number] { flex: 0 0 52px; width: 52px; text-align: right; }
.cpk-row input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.cpk-hex { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, Consolas, monospace; text-transform: uppercase; }
.cpk-hex:focus, .cpk-row input[type=number]:focus { border-color: #C99A9B; outline: none; }
.cpk-cmp { display: flex; flex: 0 0 92px; height: 30px; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
.cpk-cmp button { flex: 1; border: 0; padding: 0; cursor: pointer; font-size: 10px; -webkit-appearance: none; appearance: none; }
.cpk-recent { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cpk-recent:empty { display: none; }
.cpk-recent button {
  width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); -webkit-appearance: none; appearance: none;
}
.cpk-sub { color: #a89888; font-size: 11px; margin-top: 10px; }
`;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  (document.head || document.documentElement).appendChild(styleEl);

  /* ---------- 狀態 ---------- */
  let target = null, original = '', st = { h: 0, s: 0, v: 0 };
  let backdrop = null, panel = null, els = {};
  let dragMode = null, pending = false;
  const SIZE = 220, R_OUT = 110, RING = 20, GAP = 7, R_IN = R_OUT - RING - GAP;

  function readRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(c => parseHex(c)); } catch (e) { return []; } }
  function pushRecent(hex) {
    try {
      const list = readRecent().filter(c => c.toLowerCase() !== hex.toLowerCase());
      list.unshift(hex.toLowerCase());
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
    } catch (e) {}
  }

  function labelFor(input) {
    if (input.id) {
      const l = document.querySelector('label[for="' + input.id + '"]');
      if (l) return l.textContent.trim();
    }
    let p = input.previousElementSibling;
    while (p && p.tagName !== 'LABEL') p = p.previousElementSibling;
    return p ? p.textContent.trim() : '選擇顏色';
  }

  /* ---------- 建面板 ---------- */
  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'cpk-backdrop';
    backdrop.addEventListener('click', close);

    panel = document.createElement('div');
    panel.className = 'cpk-panel';
    panel.setAttribute('role', 'dialog');
    panel.innerHTML =
      '<div class="cpk-head"><div class="cpk-title"></div><button type="button" class="cpk-done">完成</button></div>' +
      '<div class="cpk-disc"><canvas></canvas><div class="cpk-knob cpk-knob-h"></div><div class="cpk-knob cpk-knob-sv"></div></div>' +
      '<div class="cpk-row"><span>色相</span><input type="range" min="0" max="360" step="1" data-k="h"><input type="number" min="0" max="360" data-n="h"></div>' +
      '<div class="cpk-row"><span>飽和度</span><input type="range" min="0" max="100" step="1" data-k="s"><input type="number" min="0" max="100" data-n="s"></div>' +
      '<div class="cpk-row"><span>亮度</span><input type="range" min="0" max="100" step="1" data-k="v"><input type="number" min="0" max="100" data-n="v"></div>' +
      '<div class="cpk-row"><span>色碼</span><input class="cpk-hex" type="text" maxlength="7" spellcheck="false" autocomplete="off">' +
      '<div class="cpk-cmp"><button type="button" class="cpk-old" title="點一下還原成原本的顏色">原本</button><button type="button" class="cpk-new" tabindex="-1">現在</button></div></div>' +
      '<div class="cpk-recent"></div>';

    els.title = panel.querySelector('.cpk-title');
    els.canvas = panel.querySelector('canvas');
    els.disc = panel.querySelector('.cpk-disc');
    els.knobH = panel.querySelector('.cpk-knob-h');
    els.knobSV = panel.querySelector('.cpk-knob-sv');
    els.ranges = {}; els.nums = {};
    panel.querySelectorAll('input[data-k]').forEach(r => { els.ranges[r.dataset.k] = r; });
    panel.querySelectorAll('input[data-n]').forEach(n => { els.nums[n.dataset.n] = n; });
    els.hex = panel.querySelector('.cpk-hex');
    els.old = panel.querySelector('.cpk-old');
    els.nw = panel.querySelector('.cpk-new');
    els.recent = panel.querySelector('.cpk-recent');

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.canvas.width = Math.round(SIZE * dpr);
    els.canvas.height = Math.round(SIZE * dpr);
    els.dpr = dpr;

    panel.querySelector('.cpk-done').addEventListener('click', close);

    // 三條滑桿
    Object.keys(els.ranges).forEach(k => {
      els.ranges[k].addEventListener('input', () => {
        const val = parseFloat(els.ranges[k].value);
        st[k] = k === 'h' ? val : val / 100;
        update(k === 'h');
      });
    });
    Object.keys(els.nums).forEach(k => {
      els.nums[k].addEventListener('input', () => {
        const val = parseFloat(els.nums[k].value);
        if (isNaN(val)) return;
        st[k] = k === 'h' ? clamp(val, 0, 360) : clamp(val, 0, 100) / 100;
        update(k === 'h', k);
      });
      els.nums[k].addEventListener('blur', () => syncUi());
    });
    els.hex.addEventListener('input', () => {
      const rgb = parseHex(els.hex.value);
      if (!rgb) return;
      setFromHex(rgbToHex.apply(null, rgb), 'hex');
    });
    els.hex.addEventListener('blur', () => syncUi());
    els.old.addEventListener('click', () => setFromHex(original));
    els.recent.addEventListener('click', e => {
      const b = e.target.closest('button[data-c]');
      if (b) setFromHex(b.dataset.c);
    });

    // 圓盤拖曳
    els.disc.addEventListener('pointerdown', e => {
      const p = discPoint(e);
      const d = Math.hypot(p.x, p.y);
      if (d >= R_IN + GAP / 2 && d <= R_OUT + 6) dragMode = 'h';
      else if (d < R_IN + GAP / 2) dragMode = 'sv';
      else return;
      e.preventDefault();
      try { els.disc.setPointerCapture(e.pointerId); } catch (err) {}
      discMove(p);
    });
    els.disc.addEventListener('pointermove', e => { if (dragMode) { e.preventDefault(); discMove(discPoint(e)); } });
    const end = () => { dragMode = null; };
    els.disc.addEventListener('pointerup', end);
    els.disc.addEventListener('pointercancel', end);

    document.addEventListener('keydown', e => { if (panel.isConnected && e.key === 'Escape') close(); });
    window.addEventListener('resize', () => { if (panel.isConnected) place(); });
  }

  function discPoint(e) {
    const r = els.canvas.getBoundingClientRect();
    // 以圓心為原點、CSS px（面板本身不會被縮放，保險起見仍依實際大小換算）
    const k = SIZE / r.width;
    return { x: (e.clientX - r.left) * k - SIZE / 2, y: (e.clientY - r.top) * k - SIZE / 2 };
  }
  function discMove(p) {
    if (dragMode === 'h') {
      let a = Math.atan2(p.x, -p.y) * 180 / Math.PI;
      if (a < 0) a += 360;
      st.h = a;
      update(true);
    } else if (dragMode === 'sv') {
      let u = p.x / R_IN, v = p.y / R_IN;
      const d = Math.hypot(u, v);
      if (d > 1) { u /= d; v /= d; }
      const sq = discToSquare(u, v);
      st.s = (sq[0] + 1) / 2;
      st.v = (1 - sq[1]) / 2;
      update(false);
    }
  }

  /* ---------- 畫圓盤 ---------- */
  function drawDisc() {
    const ctx = els.canvas.getContext('2d');
    const W = els.canvas.width, dpr = els.dpr;
    const img = ctx.createImageData(W, W);
    const data = img.data;
    const c = W / 2;
    const rOut = R_OUT * dpr, rRingIn = (R_OUT - RING) * dpr, rIn = R_IN * dpr;
    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        const dx = px + 0.5 - c, dy = py + 0.5 - c;
        const d = Math.sqrt(dx * dx + dy * dy);
        let rgb = null, alpha = 255;
        if (d <= rOut + 0.5 && d >= rRingIn - 0.5) {
          let a = Math.atan2(dx, -dy) * 180 / Math.PI;
          if (a < 0) a += 360;
          rgb = hsvToRgb(a, 1, 1);
          alpha = Math.round(255 * clamp(Math.min(rOut + 0.5 - d, d - rRingIn + 0.5), 0, 1));
        } else if (d <= rIn + 0.5) {
          let u = dx / rIn, v = dy / rIn;
          const n = Math.hypot(u, v);
          if (n > 1) { u /= n; v /= n; }
          const sq = discToSquare(u, v);
          rgb = hsvToRgb(st.h, (sq[0] + 1) / 2, (1 - sq[1]) / 2);
          alpha = Math.round(255 * clamp(rIn + 0.5 - d, 0, 1));
        }
        if (rgb) {
          const i = (py * W + px) * 4;
          data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = alpha;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- 同步畫面 ---------- */
  function syncUi(skipNum) {
    const hex = hsvHex(st.h, st.s, st.v);
    const vals = { h: Math.round(st.h), s: Math.round(st.s * 100), v: Math.round(st.v * 100) };
    Object.keys(vals).forEach(k => {
      els.ranges[k].value = vals[k];
      if (skipNum !== k || document.activeElement !== els.nums[k]) els.nums[k].value = vals[k];
    });
    if (skipNum !== 'hex' || document.activeElement !== els.hex) els.hex.value = hex.toUpperCase();
    els.ranges.h.style.background = 'linear-gradient(to right,#f00,#ff0 16.7%,#0f0 33.3%,#0ff 50%,#00f 66.7%,#f0f 83.3%,#f00)';
    els.ranges.s.style.background = 'linear-gradient(to right,' + hsvHex(st.h, 0, st.v) + ',' + hsvHex(st.h, 1, st.v) + ')';
    els.ranges.v.style.background = 'linear-gradient(to right,#000,' + hsvHex(st.h, st.s, 1) + ')';
    els.nw.style.background = hex;
    els.old.style.background = original;
    els.old.style.color = els.nw.style.color = 'transparent';

    // 旋鈕位置
    const a = st.h * Math.PI / 180, rm = R_OUT - RING / 2;
    els.knobH.style.left = (SIZE / 2 + Math.sin(a) * rm) + 'px';
    els.knobH.style.top = (SIZE / 2 - Math.cos(a) * rm) + 'px';
    els.knobH.style.background = hsvHex(st.h, 1, 1);
    const dp = squareToDisc(st.s * 2 - 1, 1 - st.v * 2);
    els.knobSV.style.left = (SIZE / 2 + dp[0] * R_IN) + 'px';
    els.knobSV.style.top = (SIZE / 2 + dp[1] * R_IN) + 'px';
    els.knobSV.style.background = hex;
  }

  let lastHue = null;
  function update(hueChanged, skipNum) {
    if (hueChanged || lastHue === null || Math.round(lastHue) !== Math.round(st.h)) {
      lastHue = st.h;
      drawDisc();
    }
    syncUi(skipNum);
    emit();
  }

  // 改值推回原本的 input：一個畫面格最多推一次，拖曳時頁面才不會重畫到卡
  function emit() {
    if (!target || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!target) return;
      const hex = hsvHex(st.h, st.s, st.v);
      if (target.value.toLowerCase() === hex) return;
      target.value = hex;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function setFromHex(hex, skipNum) {
    const rgb = parseHex(hex);
    if (!rgb) return;
    const n = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    // 灰階（飽和度 0）或全黑時色相沒有意義，保留目前的色相，滑桿才不會亂跳
    st = { h: (n.s && n.v) ? n.h : st.h, s: n.s, v: n.v };
    update(true, skipNum);
  }

  function renderRecent() {
    els.recent.innerHTML = readRecent().map(c =>
      '<button type="button" data-c="' + c + '" title="' + c.toUpperCase() + '" style="background:' + c + '"></button>').join('');
  }

  /* ---------- 定位：窄螢幕＝底部面板；寬螢幕＝跟著色票浮出 ---------- */
  function place() {
    const narrow = window.innerWidth < 700;
    panel.classList.toggle('cpk-sheet', narrow);
    if (narrow) { panel.style.left = ''; panel.style.top = ''; return; }
    const r = target.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let left = r.right + 10, top = r.top - 20;
    if (left + pw > window.innerWidth - 8) left = r.left - pw - 10;
    if (left < 8) left = clamp(r.left, 8, window.innerWidth - pw - 8);
    top = clamp(top, 8, Math.max(8, window.innerHeight - ph - 8));
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function open(input) {
    if (!panel) build();
    if (target) close();
    target = input;
    original = (parseHex(input.value) ? rgbToHex.apply(null, parseHex(input.value)) : '#000000');
    const n = rgbToHsv.apply(null, parseHex(original));
    st = { h: n.h, s: n.s, v: n.v };
    lastHue = null;
    els.title.textContent = labelFor(input);
    renderRecent();
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    drawDisc(); lastHue = st.h;
    syncUi();
    place();
  }

  function close() {
    if (!target) return;
    const t = target;
    const hex = hsvHex(st.h, st.s, st.v);
    // 收起前把最後一格也推出去（rAF 可能還沒跑）
    if (t.value.toLowerCase() !== hex) { t.value = hex; t.dispatchEvent(new Event('input', { bubbles: true })); }
    target = null;
    if (hex !== original.toLowerCase()) {
      pushRecent(hex);
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }
    backdrop.remove();
    panel.remove();
  }

  /* ---------- 接管所有 input[type=color] ---------- */
  function isOurs(el) {
    return el && el.tagName === 'INPUT' && el.type === 'color' && !el.disabled && !el.hasAttribute('data-native-color');
  }
  document.addEventListener('click', e => {
    const el = e.target;
    if (!isOurs(el)) return;
    e.preventDefault();          // 擋掉系統內建的選色視窗
    open(el);
  }, true);
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && isOurs(e.target)) { e.preventDefault(); open(e.target); }
  }, true);
})();
