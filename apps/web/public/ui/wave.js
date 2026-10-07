import { $, $$, post } from './util.js';
import { mixer, ui, wave } from './state.js';
import { laneAt, pxPerSec, WAVE_ZOOM } from './canvas.js';
import { onUi, applyUi, saveUi, holdUi } from './prefs.js';
import { takeHold, scratchBy, letGo, stopCoast, bend, hush } from './hand.js';
import { addFeed } from './booth.js';
import { hotcuesOf, renderDeckMeta } from './deck.js';

// ------------------------------------------------------------------ gestures on the waveforms
// Main waveform (#scroll), per lane: drag = scratch (the audio under the pointer stays under it) · Alt-drag = move the
// playhead silently · Ctrl-drag, or a drag on the strip along the lane's bottom edge = nudge the tempo ·
// double-click = hot cue on the nearest beat · wheel / pinch = zoom (all lanes, ui.waveZoom).
// A playing deck is guarded (ui.waveGuard, the lock): its lane only scratches or seeks with Shift held.
// Overview (per deck): click = seek (controls.js) · drag = scrub silently, under the same guard.
const cv = $('#scroll'), lock = $('#waveGuard');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const css2sec = (d, dxCss) => (dxCss * devicePixelRatio / pxPerSec()) * (Math.abs(d.rate) || 1); // as the lane is drawn
const laneOf = (e) => { const r = cv.getBoundingClientRect(); return laneAt(cv, (e.clientY - r.top) * devicePixelRatio); };
const guarded = (d, e) => ui.waveGuard && d.playing && !e.shiftKey;
function refuse() { lock.classList.remove('flash'); void lock.offsetWidth; lock.classList.add('flash'); }

// ---- the guard and the zoom controls
onUi(() => {
  lock.setAttribute('aria-pressed', String(!!ui.waveGuard));
  lock.textContent = ui.waveGuard ? '🔒' : '🔓';
  lock.title = ui.waveGuard ? 'Playing decks are locked: their waveform only moves with Shift held. Click to unlock.' : 'Waveforms of playing decks can be dragged. Click to lock them.';
  $('#waveZoomReset').hidden = Math.abs(ui.waveZoom - WAVE_ZOOM.def) < 0.5;
});
lock.onclick = () => saveUi({ waveGuard: !ui.waveGuard });
$('#waveZoomReset').onclick = () => saveUi({ waveZoom: WAVE_ZOOM.def });

// zoom: straight onto the page and into localStorage, one POST once the gesture has stopped. Meanwhile a value
// arriving from the server does not pull the waveform back.
let zoomTimer = 0;
function zoomTo(v) {
  v = Math.round(clamp(v, WAVE_ZOOM.min, WAVE_ZOOM.max) * 10) / 10;
  if (v === ui.waveZoom) return;
  holdUi('waveZoom', true);
  ui.waveZoom = v; applyUi();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => { holdUi('waveZoom', false); saveUi({ waveZoom: ui.waveZoom }); }, 300);
}
cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomTo(ui.waveZoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
cv.addEventListener('contextmenu', (e) => e.preventDefault()); // Ctrl-click is a context click on macOS

// ---- drags on the main waveform
const gestures = new Map(); // pointerId -> { d, mode, x, t, started, ... }
let pinch = null;           // { a, b, xa, xb, zoom, ca, cb } while two fingers are down: pointer ids, start x, zoom at the start, current x
function finish(g, cancel = false) {
  if (!g.started) return;
  const d = g.d;
  if (g.mode === 'scratch') letGo(d, cancel || performance.now() - g.t > 90 ? 0 : g.v, ui.waveInertia);
  else if (g.mode === 'nudge') g.bend.end();
  else if (g.mode === 'seek') { wave.preview.delete(d.name); if (!cancel) d.seek(g.pos); hush(d, false); }
  wave.held.delete(d.name);
}
cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.pointerType === 'touch' && gestures.size === 1 && ![...gestures.values()][0].started) { // second finger: a pinch
    const [id, g] = [...gestures][0];
    pinch = { a: id, b: e.pointerId, xa: g.x, xb: e.clientX, zoom: ui.waveZoom };
    gestures.delete(id);
    return;
  }
  const at = laneOf(e), d = at && mixer.decks[at.name];
  if (!d?.buffer) return;
  // what this gesture is, fixed here for its whole length
  const mode = e.ctrlKey || at.strip ? (d.playing ? 'nudge' : 'none') : guarded(d, e) ? 'locked' : e.altKey ? 'seek' : 'scratch';
  gestures.set(e.pointerId, { d, mode, x: e.clientX, t: performance.now(), started: false, v: 0 });
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) {
    const start = Math.abs(pinch.xb - pinch.xa) || 1;
    if (e.pointerId === pinch.a) pinch.ca = e.clientX; else pinch.cb = e.clientX;
    return zoomTo(pinch.zoom * (Math.abs((pinch.cb ?? pinch.xb) - (pinch.ca ?? pinch.xa)) / start));
  }
  const g = gestures.get(e.pointerId);
  if (!g) return hover(e);
  const d = g.d, now = performance.now(), dx = e.clientX - g.x;
  if (!g.started) {
    if (Math.abs(dx) < 4) return; // a click or a double-click, not a drag: nothing is grabbed, nothing is heard
    g.started = true; g.t = now - 16; // the distance covered so far counts: the audio that was under the pointer stays under it
    if (g.mode === 'locked') { refuse(); g.mode = 'none'; }
    else if (g.mode === 'scratch' && !takeHold(d)) g.mode = 'none'; // the jog wheel has this deck
    else if (g.mode === 'seek') { stopCoast(d); g.pos = d.position(); hush(d, true); }
    else if (g.mode === 'nudge') { stopCoast(d); g.bend = bend(d); }
    if (g.mode !== 'none') wave.held.set(d.name, g.mode);
    cv.style.cursor = g.mode === 'nudge' ? 'ew-resize' : g.mode === 'none' ? 'not-allowed' : 'grabbing';
  }
  const dt = Math.max(4, now - g.t) / 1000, dur = d.buffer.duration;
  let dSec = -css2sec(d, dx); // pull left = forward in the track
  if (g.mode === 'scratch') {
    const pos = d.position();
    dSec = clamp(pos + dSec, 0, dur - 0.05) - pos; // the ends of the track stop the hand
    scratchBy(d, dSec, dt);
    g.v = 0.6 * (dSec / dt) + 0.4 * g.v;
  } else if (g.mode === 'seek') {
    g.pos = clamp(g.pos + dSec, 0, dur - 0.05);
    wave.preview.set(d.name, g.pos);
  } else if (g.mode === 'nudge') g.bend.by((dSec / dt) * 0.1);
  g.x = e.clientX; g.t = now;
});
function end(e, cancel) {
  if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) { pinch = null; return; }
  const g = gestures.get(e.pointerId);
  if (!g) return;
  gestures.delete(e.pointerId);
  finish(g, cancel);
  hover(e);
}
cv.addEventListener('pointerup', (e) => end(e, false));
cv.addEventListener('pointercancel', (e) => end(e, true));

// the cursor says what a drag here would do
function hover(e) {
  const at = e.pointerType === 'touch' ? null : laneOf(e), d = at && mixer?.decks[at.name];
  wave.strip = at?.strip && d?.playing ? at.name : null;
  cv.style.cursor = !d?.buffer ? '' : at.strip ? (d.playing ? 'ew-resize' : '') : e.ctrlKey ? (d.playing ? 'ew-resize' : '') : guarded(d, e) ? 'not-allowed' : 'grab';
}
cv.addEventListener('pointerleave', () => { wave.strip = null; });

// ---- double-click: a hot cue on the nearest beat, in the first free slot. The deck's own cue point is not touched.
cv.addEventListener('dblclick', async (e) => {
  const at = laneOf(e), d = at && mixer.decks[at.name];
  if (!d?.track || !d.buffer) return;
  const r = cv.getBoundingClientRect();
  const sec = d.position() + css2sec(d, e.clientX - (r.left + r.width / 2));
  const beat = Math.round(d.beatAt(clamp(sec, 0, d.buffer.duration - 0.05))), taken = hotcuesOf(d.track);
  const n = [1, 2, 3, 4, 5, 6, 7, 8].find((k) => !taken[k]);
  if (!n) return addFeed({ ts: Date.now(), kind: 'system', text: `⚠ All eight hot cues on ${d.name} are taken: clear one first (nothing was changed)` });
  try {
    const res = await post('/api/hotcue', { deck: d.name, n, action: 'set', position: d.posOfBeat(Math.max(0, beat)) });
    if (!res.ok) throw new Error(res.error || 'hot cue failed');
    d.track.hotcues = { ...hotcuesOf(d.track), [n]: { sec: res.result.sec, bar: res.result.bar, label: res.result.label || null } };
    renderDeckMeta(d);
  } catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${err.message}` }); }
});

// ---- overview: press and drag scrubs through the whole track in silence (a plain click still seeks, in controls.js)
for (const ov of $$('.overview')) {
  const d = () => mixer?.decks[ov.closest('.deck').dataset.deck];
  let g = null;
  const posAt = (e, dk) => { const r = ov.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * (dk.buffer.duration - 0.05); };
  ov.addEventListener('pointerdown', (e) => { const dk = d(); if (e.button === 0 && dk?.buffer) { g = { dk, x: e.clientX, on: false, locked: guarded(dk, e) }; ov.setPointerCapture(e.pointerId); } });
  ov.addEventListener('pointermove', (e) => {
    if (!g) return;
    if (!g.on) {
      if (Math.abs(e.clientX - g.x) < 4) return; // a shaky click is still a click
      if (g.locked) { refuse(); g = null; return; }
      g.on = true; stopCoast(g.dk); hush(g.dk, true); wave.held.set(g.dk.name, 'seek');
    }
    wave.preview.set(g.dk.name, posAt(e, g.dk));
  });
  const done = (e, cancel) => {
    if (!g) return;
    const { dk, on } = g; g = null;
    if (!on) return;
    ov.dataset.dragged = '1'; setTimeout(() => delete ov.dataset.dragged, 0); // the click that follows a drag is not a seek
    wave.preview.delete(dk.name); wave.held.delete(dk.name);
    if (!cancel) dk.seek(posAt(e, dk));
    hush(dk, false);
  };
  ov.addEventListener('pointerup', (e) => done(e, false));
  ov.addEventListener('pointercancel', (e) => done(e, true));
}
