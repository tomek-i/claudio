import { DECKS, DECK_COLORS, RPS, VOL_MAX, volOfDb } from '../engine.js';
import './extra-decks.js'; // decks C + D must exist before the overview canvases are collected below
import { $, $$ } from './util.js';
import { mixer, ui, wave } from './state.js';
import { takeHold, scratchBy, letGo, bend } from './hand.js';
import { CUE_COLORS, hotcuesOf } from './deck.js';

// ---- canvas sizing + caches: nothing below is resized or rebuilt per frame.
// The overview / scroll canvases follow their CSS box; setting canvas.width reallocates the backing store.
function fitCanvas(c) {
  const w = Math.floor(c.clientWidth * devicePixelRatio), h = Math.floor(c.clientHeight * devicePixelRatio);
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}
const fitted = [$('#scroll'), ...$$('.overview')];
const canvasRO = new ResizeObserver((entries) => { for (const e of entries) fitCanvas(e.target); });
for (const c of fitted) { fitCanvas(c); canvasRO.observe(c); }
// a jog wheel is drawn square inside its box (object-fit: contain), so its backing store follows the shorter side
function fitJog(c) {
  const s = Math.floor(Math.min(c.clientWidth, c.clientHeight) * devicePixelRatio);
  if (s && c.width !== s) c.width = c.height = s;
}
const jogs = $$('.jogwheel');
// resized once the layout settles (dragging the divider changes the box every frame), not on every step
let jogFit = 0;
const jogRO = new ResizeObserver(() => { clearTimeout(jogFit); jogFit = setTimeout(() => jogs.forEach(fitJog), 120); });
for (const c of jogs) { fitJog(c); jogRO.observe(c); }
window.addEventListener('resize', () => { fitted.forEach(fitCanvas); jogs.forEach(fitJog); }); // browser zoom changes devicePixelRatio, not the CSS box
let fontsEpoch = 0; // cached layers with text are rebuilt once the web fonts arrive
document.fonts?.addEventListener('loadingdone', () => fontsEpoch++);
const peakMaxes = new WeakMap();
function peakMax(wf) {
  if (!wf?.peaks) return 1;
  let m = peakMaxes.get(wf);
  if (m == null) { m = Math.max(...wf.peaks) || 1; peakMaxes.set(wf, m); }
  return m;
}
const layer = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// the overview waveform only changes with the track or the canvas size: it is drawn once in its
// "ahead" and "played" colours, and each frame blits the two halves either side of the playhead
const overviewLayers = new WeakMap();
function overviewLayersFor(canvas, d, color, dur) {
  const t = d.track, w = canvas.width, h = canvas.height;
  let c = overviewLayers.get(canvas);
  if (c && c.wf === t.waveform && c.w === w && c.h === h && c.dur === dur && c.color === color && c.mixOut === t.mixOut && c.breakdowns === t.breakdowns) return c;
  c = { wf: t.waveform, w, h, dur, color, mixOut: t.mixOut, breakdowns: t.breakdowns, ahead: layer(w, h), played: layer(w, h) };
  const { peaks, lows } = t.waveform;
  const X = (sec) => (sec / dur) * w;
  const n = peaks.length, bw = w / n, mx = peakMax(t.waveform);
  for (const [cv, full, low] of [[c.ahead, '#5b5b70', color], [c.played, '#3a3a48', '#55555f']]) {
    const g = cv.getContext('2d');
    // breakdowns + outro shading
    g.fillStyle = '#ffffff08';
    for (const b of t.breakdowns || []) g.fillRect(X(b.start), 0, X(b.drop) - X(b.start), h);
    g.fillStyle = '#f2cc6012';
    g.fillRect(X(t.mixOut), 0, w - X(t.mixOut), h);
    for (let i = 0; i < n; i++) {
      const x = i * bw;
      const ph = (peaks[i] / mx) * h * 0.46, lh = (lows[i] / mx) * h * 0.46;
      g.fillStyle = full;
      g.fillRect(x, h / 2 - ph, Math.max(1, bw), ph * 2);
      g.fillStyle = low;
      g.fillRect(x, h / 2 - lh, Math.max(1, bw), lh * 2);
    }
  }
  overviewLayers.set(canvas, c);
  return c;
}

export function drawOverview(canvas, d, color) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  const t = d.track;
  if (!t?.waveform || !w || !h) return;
  const dur = d.buffer?.duration || t.duration;
  const X = (sec) => (sec / dur) * w;
  const pos = wave.preview.get(d.name) ?? d.position();
  const { ahead, played } = overviewLayersFor(canvas, d, color, dur);
  // a bar counts as played from the moment the playhead enters it
  const n = t.waveform.peaks.length;
  const pw = Math.round((Math.max(0, Math.min(n, Math.ceil((pos / dur) * n))) / n) * w);
  if (pw > 0) g.drawImage(played, 0, 0, pw, h, 0, 0, pw, h);
  if (pw < w) g.drawImage(ahead, pw, 0, w - pw, h, pw, 0, w - pw, h);
  g.fillStyle = '#f2cc60';
  g.fillRect(X(t.mixOut), 0, 2 * devicePixelRatio, h);
  g.fillStyle = '#fff';
  g.beginPath(); const cx = X(d.cuePoint); g.moveTo(cx - 5, 0); g.lineTo(cx + 5, 0); g.lineTo(cx, 7); g.fill();
  // hot cue markers along the bottom edge
  g.font = `${9 * devicePixelRatio}px JetBrains Mono, monospace`;
  for (const [n, c] of Object.entries(hotcuesOf(t))) {
    if (!c || c.sec == null) continue;
    const x = X(c.sec);
    g.fillStyle = CUE_COLORS[n - 1] || '#fff';
    g.fillRect(x, h - 10 * devicePixelRatio, 2 * devicePixelRatio, 10 * devicePixelRatio);
    g.fillText(String(n), x + 3 * devicePixelRatio, h - 2 * devicePixelRatio);
  }
  g.fillStyle = '#fff';
  g.fillRect(X(pos) - 1, 0, 2 * devicePixelRatio, h);
  const lp = d.loop;
  if (lp) { g.fillStyle = '#7ee78733'; g.fillRect(X(lp.start), 0, X(lp.end) - X(lp.start), h); }
}

// the main waveform's time scale: ui.waveZoom CSS pixels per second of real time, one scale for every lane
export const WAVE_ZOOM = { def: 110, min: 40, max: 800 };
export const pxPerSec = () => (ui.waveZoom || WAVE_ZOOM.def) * devicePixelRatio;
// lanes = the loaded decks, top to bottom; each has a nudge strip along its bottom edge
const coarse = matchMedia('(pointer: coarse)');
function lanesOf(canvas) {
  const names = mixer ? DECKS.filter((n) => mixer.decks[n].track) : [], h = canvas.height / (names.length || 1);
  return { names, h, strip: Math.min(h / 5, (coarse.matches ? 16 : 10) * devicePixelRatio) };
}
// which lane a y (device pixels from the top of the canvas) is in, and whether it is on that lane's nudge strip
export function laneAt(canvas, y) {
  const { names, h, strip } = lanesOf(canvas), i = Math.floor(y / h);
  return names[i] ? { name: names[i], strip: y >= (i + 1) * h - strip } : null;
}

export function drawScroll(canvas) {
  const w = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#060608'; g.fillRect(0, 0, w, H);
  const { names: lanes, strip } = lanesOf(canvas);
  const pps = pxPerSec(); // pixels per real second
  const cx = w / 2, px = devicePixelRatio;
  if (!lanes.length) {
    g.fillStyle = '#333'; g.font = `${11 * devicePixelRatio}px JetBrains Mono`;
    g.fillText('load a track to see it here', 12, H / 2);
  }
  lanes.forEach((name, li) => {
    const d = mixer.decks[name], color = DECK_COLORS[name];
    const top = (li * H) / lanes.length, h = H / lanes.length, mid = top + h / 2;
    g.fillStyle = li % 2 ? '#0a0a0e' : '#08080b'; g.fillRect(0, top, w, h);
    g.fillStyle = '#ffffff99'; g.font = `600 ${10 * devicePixelRatio}px JetBrains Mono`;
    if (!d.zoom) { g.fillStyle = '#444'; g.fillText(`${name}  ${d.loading ? 'loading…' : 'building waveform…'}`, 8 * devicePixelRatio, mid); return; }
    const pos = wave.preview.get(name) ?? d.position(), rate = Math.abs(d.rate) || 1, z = d.zoom;
    const gain = 1 / peakMax(d.track?.waveform);
    const audible = d.playing ? Math.max(0.35, d.audible()) : 0.35;
    // beat grid
    const tLeft = pos - (cx / pps) * rate, tRight = pos + ((w - cx) / pps) * rate;
    for (let b = Math.ceil(d.beatAt(tLeft)); d.posOfBeat(b) < tRight; b++) {
      const x = cx + ((d.posOfBeat(b) - pos) / rate) * pps;
      g.fillStyle = b % 16 === 0 ? '#ffffff55' : b % 4 === 0 ? '#ffffff26' : '#ffffff0d';
      g.fillRect(x, top, b % 4 === 0 ? 2 : 1, h);
    }
    g.globalAlpha = audible;
    // bars are anchored to the track, not the screen: bar k always covers the same slice of audio, so the shape
    // slides as a whole instead of every column picking a new peak each frame. dt = track seconds per bar (~2 px).
    // It follows the rate and the zoom in octave steps only, so riding the tempo or zooming re-slices the audio at
    // an octave step and never while it scrolls.
    const dt = (2 / (WAVE_ZOOM.def * px)) * 2 ** Math.round(Math.log2((rate * WAVE_ZOOM.def * px) / pps));
    const X = (k) => Math.round(cx + ((k * dt - pos) / rate) * pps);
    for (let k = Math.floor(tLeft / dt), x = X(k); x < w; k++) {
      const x1 = X(k + 1), i = Math.floor(k * dt * z.perSec);
      if (i >= 0 && i < z.full.length) {
        const fh = Math.min(1, z.full[i] * gain) * h * 0.45, lh = Math.min(1, z.low[i] * gain * 1.2) * h * 0.45;
        g.fillStyle = '#9a9ab0'; g.fillRect(x, mid - fh, x1 - x, fh * 2);
        g.fillStyle = color; g.fillRect(x, mid - lh, x1 - x, lh * 2);
      }
      x = x1;
    }
    g.globalAlpha = 1;
    const lp = d.loop;
    if (lp) {
      const x0 = cx + ((lp.start - pos) / rate) * pps, x1 = cx + ((lp.end - pos) / rate) * pps;
      g.fillStyle = '#7ee78722'; g.fillRect(x0, top, x1 - x0, h);
    }
    // hot cues that are in view
    g.font = `600 ${9 * px}px JetBrains Mono`;
    for (const [n, c] of Object.entries(hotcuesOf(d.track))) {
      if (!c || c.sec == null || c.sec < tLeft || c.sec > tRight) continue;
      const x = cx + ((c.sec - pos) / rate) * pps;
      g.fillStyle = CUE_COLORS[n - 1] || '#fff';
      g.fillRect(x, top, 2 * px, h - strip); g.fillText(String(n), x + 4 * px, top + 12 * px);
    }
    // nudge strip: fixed to the screen, a band with ticks like the dimples on the jog ring; brighter under the hand
    const held = wave.held.get(name), lit = held === 'nudge' ? 2 : wave.strip === name ? 1 : 0;
    g.fillStyle = ['#ffffff0a', '#ffffff18', '#ffffff2c'][lit]; g.fillRect(0, top + h - strip, w, strip);
    g.fillStyle = ['#ffffff1c', '#ffffff40', color][lit];
    for (let x = (cx % (14 * px)) - 14 * px; x < w; x += 14 * px) g.fillRect(x, top + h - strip * 0.72, px, strip * 0.44);
    // the lane under the hand: a tint and a heavier playhead (dashed while it is a silent seek)
    if (held === 'scratch' || held === 'seek') {
      g.fillStyle = held === 'seek' ? '#e8a17f14' : '#ffffff10'; g.fillRect(0, top, w, h - strip);
      g.fillStyle = held === 'seek' ? '#e8a17f' : color;
      if (held === 'seek') for (let y = top; y < top + h - strip; y += 8 * px) g.fillRect(cx - 2 * px, y, 4 * px, 4 * px);
      else g.fillRect(cx - 2 * px, top, 4 * px, h - strip);
    }
    g.fillStyle = '#ffffff99'; g.font = `600 ${10 * devicePixelRatio}px JetBrains Mono`;
    g.fillText(name, 8 * devicePixelRatio, top + 14 * devicePixelRatio);
  });
  g.fillStyle = '#fff'; g.fillRect(cx - 1, 0, 2, H);
}

// ---- jog wheels (CDJ style): the wheel stays put and the needle on its centre display turns with the
// playback position (33⅓ rpm at 1x), so loops, rolls, spinbacks and scratches are visible on it.
// everything but the needle is drawn once into a layer and rebuilt only when something it shows changes.
// the outer ring comes in two sizes (settings): wide with finger pockets, or slim with a beaded edge.
const PLATE = { large: 0.36, small: 0.42 }, DISPLAY = 0.2352; // top plate and centre display radius, as fractions of the canvas width (keyed by ui.jogRing: a large ring leaves a smaller plate)
const plateR = () => PLATE[ui.jogRing] || PLATE.large;
const jogLayers = new WeakMap();
function jogLayerFor(canvas, d, color) {
  const W = canvas.width, c = W / 2, k = W / 340, R = W * plateR(), D = W * DISPLAY, t = d.track;
  const title = (t?.title || 'DJ CLAUDE').slice(0, 16), bpm = t ? d.effBpm.toFixed(1) : '—', pct = (d.rate - 1) * 100;
  const pitch = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%${d.keylock ? ' KL' : ''}`;
  const key = [W, R, t ? color : '', title, bpm, pitch, d.playing, d.handActive, d.cuePoint.toFixed(2), fontsEpoch].join('|');
  let jog = jogLayers.get(canvas);
  if (jog?.key === key) return jog.cv;
  jog = { key, cv: layer(W, W) };
  const g = jog.cv.getContext('2d'), disc = (r) => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); };
  g.translate(c, c);
  // outer ring (drag it to nudge): matte black, bevelled at both edges. Wide: elongated finger pockets lying along the
  // ring with a row of small beads at each edge. Slim: one row of beads. Pockets are shaded at the top and catch the
  // light at the bottom.
  const large = R < W * PLATE.small, RO = large ? W * 0.465 : R + 11 * k, m = (R + RO) / 2;
  const rim = g.createRadialGradient(0, 0, R, 0, 0, RO);
  rim.addColorStop(0, '#101014'); rim.addColorStop(0.18, '#23232a'); rim.addColorStop(0.55, '#2c2c34'); rim.addColorStop(0.9, '#1a1a20'); rim.addColorStop(1, '#0c0c0f');
  g.fillStyle = rim; disc(RO); g.fill();
  const edge = g.createLinearGradient(0, -RO, 0, RO);
  edge.addColorStop(0, '#5a5a66'); edge.addColorStop(0.5, '#1c1c22'); edge.addColorStop(1, '#3a3a44');
  g.strokeStyle = edge; g.lineWidth = 1.5 * k; disc(RO - 0.75 * k); g.stroke();
  const bead = (x, y, r) => {
    const b = g.createLinearGradient(0, y - r, 0, y + r); b.addColorStop(0, '#050507'); b.addColorStop(1, '#55555f');
    g.fillStyle = b; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  if (large) {
    const n = 18, ry = (RO - R) * 0.27, rx = ((2 * Math.PI * m) / n) * 0.36;
    g.strokeStyle = '#000000b0'; g.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, x = Math.cos(a) * m, y = Math.sin(a) * m;
      const pocket = g.createLinearGradient(0, y - ry * 1.3, 0, y + ry * 1.3);
      pocket.addColorStop(0, '#050507'); pocket.addColorStop(0.5, '#15151b'); pocket.addColorStop(1, '#4a4a57');
      g.fillStyle = pocket; g.beginPath(); g.ellipse(x, y, rx, ry, a + Math.PI / 2, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const [rr, nb] of [[RO - (RO - R) * 0.1, 96], [R + (RO - R) * 0.11, 80]]) for (let i = 0; i < nb; i++) {
      const a = ((i + 0.5) / nb) * Math.PI * 2; bead(Math.cos(a) * rr, Math.sin(a) * rr, 1.15 * k);
    }
  } else {
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; bead(Math.cos(a) * m, Math.sin(a) * m, (RO - R) * 0.26); }
  }
  // top plate (drag it to scratch): a vinyl record, near black with fine grooves and the light catching it in two
  // opposite wedges
  const plate = g.createRadialGradient(0, 0, D, 0, 0, R);
  plate.addColorStop(0, '#0d0d11'); plate.addColorStop(1, '#060608');
  g.fillStyle = plate; disc(R); g.fill();
  g.lineWidth = Math.max(0.6, 0.7 * k);
  for (let r = D + 9 * k, i = 0; r < R - 5 * k; r += 1.7 * k, i++) { g.strokeStyle = `rgba(255,255,255,${i % 7 === 0 ? 0.07 : 0.028})`; disc(r); g.stroke(); }
  g.save(); disc(R - 3 * k); g.clip();
  const shine = g.createConicGradient(-Math.PI * 0.78, 0, 0), clear = 'rgba(255,255,255,0)';
  shine.addColorStop(0, clear); shine.addColorStop(0.06, 'rgba(255,255,255,0.13)'); shine.addColorStop(0.13, clear);
  shine.addColorStop(0.5, clear); shine.addColorStop(0.56, 'rgba(255,255,255,0.1)'); shine.addColorStop(0.63, clear); shine.addColorStop(1, clear);
  g.fillStyle = shine; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.restore();
  // a slim chrome bezel where the plate meets the ring
  const chrome = g.createLinearGradient(-R, -R, R, R);
  chrome.addColorStop(0, '#f4f4f8'); chrome.addColorStop(0.3, '#8a8a96'); chrome.addColorStop(0.5, '#e6e6ec'); chrome.addColorStop(0.72, '#5c5c68'); chrome.addColorStop(1, '#d8d8e0');
  g.strokeStyle = chrome; g.lineWidth = 2 * k; disc(R + 0.5 * k); g.stroke();
  g.strokeStyle = '#00000090'; g.lineWidth = 1; disc(R + 2 * k); g.stroke();
  // light ring in the deck colour, just inside the bezel: dim when stopped, lit when playing, brightest under the hand
  g.save();
  g.strokeStyle = t ? color : '#3a3a46'; g.globalAlpha = !t || d.handActive ? 1 : d.playing ? 0.9 : 0.4;
  if (t && (d.playing || d.handActive)) { g.shadowColor = color; g.shadowBlur = (d.handActive ? 16 : 9) * k; }
  g.lineWidth = (d.handActive ? 4 : 3) * k; disc(R - 4 * k); g.stroke();
  g.restore();
  // centre display with the needle's track and the cue point on it
  g.fillStyle = '#050507'; disc(D); g.fill();
  g.strokeStyle = '#000'; g.lineWidth = 3 * k; g.stroke();
  g.strokeStyle = '#32323e'; g.lineWidth = 1; disc(D + 2.5 * k); g.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
    g.strokeStyle = i % 12 === 0 ? '#ffffff66' : '#ffffff1c'; g.lineWidth = 1.5 * k;
    g.beginPath(); g.moveTo(x * D * 0.83, y * D * 0.83); g.lineTo(x * D * 0.93, y * D * 0.93); g.stroke();
  }
  if (t) { const a = d.cuePoint * RPS * Math.PI * 2 - Math.PI / 2; g.fillStyle = '#ff4d4d'; g.beginPath(); g.arc(Math.cos(a) * D * 0.88, Math.sin(a) * D * 0.88, 3.2 * k, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'center';
  g.fillStyle = '#8a8998'; g.font = `500 ${Math.round(11 * k)}px Space Grotesk, sans-serif`; g.fillText(title, 0, -D * 0.34, D * 1.15);
  g.fillStyle = t ? '#ecebf2' : '#55546a'; g.font = `600 ${Math.round(27 * k)}px JetBrains Mono, monospace`; g.fillText(bpm, 0, D * 0.1, D * 1.3);
  g.fillStyle = t ? color : '#55546a'; g.font = `600 ${Math.round(9 * k)}px JetBrains Mono, monospace`; g.fillText('BPM', 0, D * 0.3);
  g.fillStyle = '#8a8998'; g.font = `600 ${Math.round(11 * k)}px JetBrains Mono, monospace`; g.fillText(pitch, 0, D * 0.55, D * 1.1);
  jogLayers.set(canvas, jog);
  return jog.cv;
}

export function drawJog(canvas, d, color) {
  const g = canvas.getContext('2d'), W = canvas.width, c = W / 2, k = W / 340;
  g.clearRect(0, 0, W, W);
  g.drawImage(jogLayerFor(canvas, d, color), 0, 0);
  // needle: straight up at position 0
  const ang = d.position() * RPS * Math.PI * 2 - Math.PI / 2, r = W * DISPLAY * 0.88;
  g.strokeStyle = d.track ? '#fff' : '#55546a'; g.lineWidth = 5 * k;
  g.beginPath(); g.arc(c, c, r, ang - 0.17, ang + 0.17); g.stroke();
}

// drag the top plate = scratch (the playhead follows your hand, backwards too; SLIP keeps the track on the grid);
// drag the outer ring = nudge (pitch bend, settles back on release)
export function wireJog(canvas, d) {
  let drag = null;
  // the wheel is the square in the middle of the box; a drag keeps the centre it started with
  const centre = () => { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, half: Math.min(r.width, r.height) / 2 }; };
  const geo = (e, c = drag?.c || centre()) => ({ a: Math.atan2(e.clientY - c.y, e.clientX - c.x), rr: Math.hypot(e.clientX - c.x, e.clientY - c.y) / c.half });
  canvas.addEventListener('pointerdown', (e) => {
    if (!d.buffer) return;
    const g = geo(e), mode = g.rr > 2 * plateR() ? 'nudge' : 'scratch';
    if (g.rr > 1) return; // beside the wheel, not on it
    if (mode === 'scratch' && !takeHold(d)) return;
    drag = { mode, a: g.a, t: performance.now(), bend: mode === 'nudge' ? bend(d) : null, c: centre() };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const g = geo(e), now = performance.now();
    let da = g.a - drag.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    const dt = Math.max(4, now - drag.t) / 1000;
    if (drag.mode === 'scratch') scratchBy(d, da / (2 * Math.PI * RPS), dt);
    else drag.bend.by((da / dt) * 0.02);
    drag.a = g.a; drag.t = now;
  });
  const end = () => {
    if (!drag) return;
    if (drag.mode === 'scratch') letGo(d); else drag.bend.end();
    drag = null;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}

// ---- level meter. The height is the fader's own dB mapping (volOfDb), so a level reads off the scale printed beside
// the fader: 0 dB two thirds up, +6 dB at the top. Green, amber for the last 6 dB below 0 dB, red above it (a channel
// pushed past unity, or a clipping master). The level jumps up and falls back at 30 dB a second.
// ui.meterStyle: 'bar' is a smooth bar, 'led' a ladder of segments whose highest one stays lit for a second.
const M_FLOOR = -60, M_FALL = 30, M_HOLD = 1000, M_SEGS = 24;
const M_POS = (db) => Math.min(1, volOfDb(db) / VOL_MAX), M_AMBER = M_POS(-6), M_RED = M_POS(0);
const M_LIT = { g: '#3fd27a', a: '#f2cc60', r: '#ff4d5e' }, M_DARK = { g: '#12301f', a: '#33290f', r: '#3a1217' };
const meterBuf = new Float32Array(2048);
export function drawMeter(canvas, analyser) {
  const m = canvas.meter || (canvas.meter = { lvl: M_FLOOR, peak: M_FLOOR, peakAt: 0, at: 0, sized: 0 });
  const now = performance.now(), dt = Math.min(0.25, (now - m.at) / 1000); m.at = now;
  if (now - m.sized > 500) { // match the backing store to the size on screen, so the edges stay crisp
    m.sized = now;
    const dpr = window.devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
  }
  const buf = analyser.fftSize <= meterBuf.length ? meterBuf.subarray(0, analyser.fftSize) : new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let peak = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
  const db = Math.max(M_FLOOR, 20 * Math.log10(peak + 1e-6));
  m.lvl = Math.max(db, m.lvl - M_FALL * dt);
  if (m.lvl >= m.peak) { m.peak = m.lvl; m.peakAt = now; } else if (now - m.peakAt > M_HOLD) m.peak = Math.max(m.lvl, m.peak - M_FALL * dt);
  const led = ui.meterStyle === 'led', w = canvas.width, h = canvas.height;
  const lvl = m.lvl <= M_FLOOR ? 0 : M_POS(m.lvl), held = m.peak <= M_FLOOR ? 0 : M_POS(m.peak);
  const lit = led ? Math.round(lvl * M_SEGS) : Math.round(lvl * h), top = led ? Math.round(held * M_SEGS) : 0;
  const key = `${led}${lit}/${top}/${h}`; if (m.key === key) return; m.key = key;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!led) {
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, '#3fb66b'); grd.addColorStop(M_AMBER, '#3fb66b'); grd.addColorStop(M_RED, '#f2cc60'); grd.addColorStop(Math.min(1, M_RED + 0.08), '#ff5050'); grd.addColorStop(1, '#ff5050');
    g.fillStyle = grd; g.fillRect(0, h - lit, w, lit);
    return;
  }
  const gap = Math.max(1, Math.round(h / 160)), seg = (h + gap) / M_SEGS;
  for (let i = 0; i < M_SEGS; i++) {
    const at = (i + 0.5) / M_SEGS, c = at > M_RED ? 'r' : at > M_AMBER ? 'a' : 'g'; // where the middle of this segment sits on the scale
    const y0 = Math.round(h - (i + 1) * seg + gap), y1 = Math.round(h - i * seg);
    g.fillStyle = i < lit || (i === top - 1 && top > lit) ? M_LIT[c] : M_DARK[c];
    g.fillRect(1, y0, w - 2, Math.max(1, y1 - y0));
  }
}
