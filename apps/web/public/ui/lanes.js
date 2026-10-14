// ------------------------------------------------------------------ the Automation tab: the set's recording as lanes
// One lane per control or deck part that the recording moves (lane-model.js), along the set's time from 0:00, with
// the playhead while it records or plays. A control's lane is a curve: drag a point (time and value; Shift: value
// only), double-click to add one, Delete to remove the one picked. Any other lane is a row of marks (play, stop, seek,
// loops, scratches, loads, key, FX, sampler hits): drag one along the time, or Delete it. Changes stay here until
// "save" (Ctrl+S) puts them in the set; "undo" (Ctrl+Z) and "revert" go back. Nothing can be changed while the
// recording records or plays. The canvas is only as wide as the view: what is on it is drawn for the stretch in view.
import { DECK_COLORS } from '../engine.js';
import { $, mmss, post, esc } from './util.js';
import { mixer, tracks } from './state.js';
import { addFeed } from './booth.js';
import { wireTransport, activeSetDetail } from './automation-ui.js';
import {
  isControlLane, laneLabel, laneSort, rangeOf, startValue, entriesOf, curve, valueAt, handlesOf,
  moveHandle, addPoint, removeHandle, shiftWhole, removeEntry, marksOf,
} from './lane-model.js';

const ROW = 44, RULER = 22, HIT = 7;
const cv = $('#lnCanvas'), ctx = cv.getContext('2d'), scroller = $('#lnScroll'), spacer = $('#lnSpacer');
let take = null, saved = null, setName = null, savedAt = null, lanes = [], extra = [], undo = [], dirty = false;
let pps = 20, zoomed = false, sel = null, drag = null, hover = null; // zoomed: by hand (else the whole recording fits the view)
const warn = (text) => addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${text}` });
const automation = () => mixer?.automation || null;
const busy = () => { const m = automation()?.mode; return !!m && m !== 'idle'; };
const duration = () => Math.max(take?.duration || 0, 10);

wireTransport($('#lnTransport'), $('#lnConfirm'));

// ---- the take: read when the set or its saved recording changes; kept while there are changes not saved
async function load(force = false) {
  const st = activeSetDetail();
  const name = st?.name || null, at = st?.automation?.savedAt || null;
  if (!force && name === setName && at === savedAt) return;
  if (dirty && name === setName && at !== savedAt) warn(`the lane changes to "${name}" that were not saved were replaced by the new recording`);
  setName = name; savedAt = at; sel = null; undo = []; dirty = false; extra = [];
  take = null;
  if (name && at) {
    try {
      const t = await fetch(`/api/sets/automation?name=${encodeURIComponent(name)}`).then((r) => r.json());
      if (t?.entries) take = t;
    } catch { /* shown as no recording */ }
  }
  saved = take && JSON.stringify(take);
  zoomed = false; refresh();
}
document.addEventListener('activeset:detail', () => load());
document.addEventListener('lower:open', () => { if (document.body.dataset.dock === 'automation') { load(); draw(); } });

function refresh() {
  const st = activeSetDetail();
  lanes = take ? [...new Set([...take.entries.map((e) => e.g), ...extra])].sort(laneSort) : [];
  $('#lnSet').textContent = st ? st.name : 'No set';
  $('#lnSub').textContent = !st ? '' : take ? `${mmss(take.duration)} · ${take.entries.length} moves · ${lanes.length} lane${lanes.length === 1 ? '' : 's'}${dirty ? ' · not saved' : ''}` : '';
  $('#lnEmpty').textContent = !st ? 'Choose a set in the Library tab (under "Up next") or make one: a recording belongs to a set.'
    : !take ? 'No recording in this set yet. ● rec records everything done on the decks and the mixer from here, as the set\'s 0:00.' : '';
  $('#lnEmpty').hidden = !!take;
  $('#lnBody').hidden = !take;
  $('#lnSave').disabled = !dirty || busy(); $('#lnRevert').disabled = !dirty || busy(); $('#lnUndo').disabled = !undo.length || busy();
  $('#lnSave').classList.toggle('on', dirty);
  // + lane: the controls that have no lane yet
  const have = new Set(lanes), ids = mixer ? Object.keys(mixer.controls()) : ['A.vol', 'A.filter', 'A.eq.low', 'A.eq.mid', 'A.eq.high', 'B.vol', 'B.filter', 'B.eq.low', 'B.eq.mid', 'B.eq.high', 'xfader', 'master'];
  const opts = ids.filter((g) => !have.has(g)).sort(laneSort).map((g) => { const l = laneLabel(g); return `<option value="${g}">${l.deck ? l.deck + ' · ' : ''}${esc(l.name)}</option>`; });
  $('#lnAdd').innerHTML = '<option value="">+ lane</option>' + opts.join('');
  $('#lnAdd').disabled = !take || busy();
  $('#lnNames').innerHTML = lanes.map((g) => {
    const l = laneLabel(g), c = l.deck ? DECK_COLORS[l.deck] : 'var(--dim)';
    return `<div class="ln-name" style="--c:${c}" title="${esc(g)}">${l.deck ? `<b>${l.deck}</b>` : ''}<span>${esc(l.name)}</span></div>`;
  }).join('');
  layout();
}

// ---- geometry: the spacer gives the scroll width; the canvas stays the size of the view
function layout() {
  if (!zoomed) fit();
  const w = Math.max(200, scroller.clientWidth), h = RULER + lanes.length * ROW;
  spacer.style.width = `${Math.ceil(duration() * pps) + 40}px`;
  spacer.style.height = "1px";
  const dpr = devicePixelRatio || 1;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`; }
  draw();
}
const x0 = () => scroller.scrollLeft;
const xOf = (t) => t * pps - x0();
const tOf = (x) => (x + x0()) / pps;
const rowOf = (y) => Math.floor((y - RULER) / ROW);
const yOf = (g, v) => { const [lo, hi] = rangeOf(g, mixer?.controls()), top = RULER + lanes.indexOf(g) * ROW; return top + 6 + (1 - (v - lo) / (hi - lo || 1)) * (ROW - 12); };
const vOf = (g, y) => { const [lo, hi] = rangeOf(g, mixer?.controls()), top = RULER + lanes.indexOf(g) * ROW; return lo + (1 - (y - top - 6) / (ROW - 12)) * (hi - lo); };
function fit() { if (take) pps = Math.max(2, Math.min(400, (Math.max(200, scroller.clientWidth) - 40) / duration())); }
function zoom(f, atX = scroller.clientWidth / 2) {
  const t = tOf(atX);
  zoomed = true;
  pps = Math.max(2, Math.min(400, pps * f));
  layout();
  scroller.scrollLeft = Math.max(0, t * pps - atX);
  draw();
}

// ---- drawing
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim() || '#888';
function draw() {
  if (!take || document.body.dataset.dock !== 'automation') return;
  const dpr = devicePixelRatio || 1, w = cv.width / dpr, h = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const t0 = tOf(0), t1 = tOf(w), line = css('--line'), dim = css('--dim'), faint = css('--faint'), text = css('--text');
  // ruler
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * pps >= 70) || 600;
  ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle';
  for (let s = Math.floor(t0 / step) * step; s <= t1; s += step) {
    const x = Math.round(xOf(s)) + 0.5;
    ctx.fillStyle = line; ctx.fillRect(x, RULER, 1, h - RULER);
    ctx.fillStyle = faint; ctx.fillText(step < 1 ? `${mmss(s)}.${Math.round((s % 1) * 10)}` : mmss(s), x + 3, RULER / 2);
  }
  const endX = xOf(take.duration);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; if (endX < w) ctx.fillRect(Math.max(0, endX), RULER, w - endX, h - RULER);
  // lanes
  lanes.forEach((g, i) => {
    const top = RULER + i * ROW;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.015)' : 'rgba(255,255,255,0.035)'; ctx.fillRect(0, top, w, ROW);
    ctx.fillStyle = line; ctx.fillRect(0, top + ROW - 1, w, 1);
    const l = laneLabel(g), color = l.deck ? DECK_COLORS[l.deck] : dim;
    const es = entriesOf(take, g);
    if (isControlLane(g)) {
      const bps = curve(es, startValue(g, activeSetDetail()?.snapshot));
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let x = 0; x <= w; x += 2) { const y = yOf(g, valueAt(bps, tOf(x))); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      for (const hd of handlesOf(es)) {
        const x = xOf(hd.t); if (x < -8 || x > w + 8) continue;
        const on = sel && sel.e === hd.e && sel.p === hd.p;
        ctx.fillStyle = on ? text : color; ctx.beginPath(); ctx.arc(x, yOf(g, hd.v), on ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
        if (on) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
      }
    } else {
      let lastX = -1e9;
      for (const m of marksOf(es, titleOf)) {
        const x = xOf(m.t); if ((m.end ? xOf(m.end) : x) < -60 || x > w + 4) continue;
        const on = sel && sel.e === m.e;
        if (m.end) { ctx.fillStyle = color + '33'; ctx.fillRect(x, top + 8, Math.max(2, xOf(m.end) - x), ROW - 16); }
        ctx.fillStyle = on ? text : m.kind === 'stop' ? '#ff6b6b' : m.kind === 'start' ? css('--ok') : color;
        ctx.fillRect(Math.round(x), top + 6, on ? 3 : 2, ROW - 12);
        if (m.label && x - lastX > 34) { ctx.fillStyle = on ? text : dim; ctx.fillText(m.label, x + 5, top + ROW / 2); lastX = x + ctx.measureText(m.label).width; }
      }
    }
  });
  // the playhead
  const st = automation()?.state();
  if (st && st.mode !== 'idle' && st.set === setName) {
    const x = Math.round(xOf(st.t)) + 0.5;
    ctx.fillStyle = st.mode === 'play' ? css('--ok') : '#ff5a5a'; ctx.fillRect(x, 0, 2, h);
    if (x > w - 60 && !drag) scroller.scrollLeft += w * 0.6; // keep it in view
  }
  if (hover) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; const tw = ctx.measureText(hover.text).width + 10;
    const hx = Math.min(w - tw - 2, hover.x + 10), hy = Math.max(2, hover.y - 22);
    ctx.fillRect(hx, hy, tw, 16); ctx.fillStyle = text; ctx.fillText(hover.text, hx + 5, hy + 8);
  }
}
const titleOf = (id) => tracks.get(id)?.title || id;
scroller.addEventListener('scroll', () => draw());
new ResizeObserver(() => { if (document.body.dataset.dock === 'automation') layout(); }).observe(scroller);
setInterval(() => { if (busy() && document.body.dataset.dock === 'automation') draw(); }, 100);
document.addEventListener('automation', () => { refresh(); draw(); });

// ---- picking and editing
function pick(x, y) {
  const g = lanes[rowOf(y)]; if (!g || y < RULER) return null;
  const es = entriesOf(take, g);
  if (isControlLane(g)) {
    let best = null, bd = HIT;
    for (const hd of handlesOf(es)) { const d = Math.hypot(xOf(hd.t) - x, yOf(g, hd.v) - y); if (d <= bd) { bd = d; best = { ...hd, g }; } }
    return best;
  }
  let best = null, bd = HIT;
  for (const m of marksOf(es, titleOf)) { const d = Math.abs(xOf(m.t) - x); if (d <= bd) { bd = d; best = { e: m.e, t: m.t, g, mark: true }; } }
  return best;
}
const before = () => { undo.push(JSON.stringify(take)); if (undo.length > 60) undo.shift(); };
const changed = () => { dirty = JSON.stringify(take) !== saved; refresh(); };
const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const label = (h) => (h.mark ? `${mmss(h.t)}` : `${laneLabel(h.g).name} ${h.v.toFixed(2)} · ${mmss(h.t)}.${String(Math.floor((h.t % 1) * 100)).padStart(2, '0')}`);

cv.addEventListener('pointerdown', (e) => {
  if (!take || busy()) return;
  const { x, y } = pos(e), h = pick(x, y);
  sel = h; hover = null;
  if (h) {
    drag = { h, x0: x, t0: h.t, startTake: JSON.stringify(take), moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch { /* a pointer the browser does not track (a scripted one): no capture */ }
  }
  draw();
});
cv.addEventListener('pointermove', (e) => {
  const { x, y } = pos(e);
  if (!drag) { const h = take && pick(x, y); hover = h ? { x, y, text: label(h) } : null; cv.style.cursor = h ? 'grab' : 'default'; draw(); return; }
  if (!drag.moved) { if (Math.abs(x - drag.x0) < 2 && !e.shiftKey) return; drag.moved = true; before(); }
  const t = e.shiftKey ? drag.t0 : Math.max(0, tOf(x));
  if (drag.h.mark) { const moved = shiftWhole(take, drag.h.e, t - drag.h.t); drag.h = { ...drag.h, e: moved, t }; sel = drag.h; }
  else { drag.h = { ...moveHandle(take, drag.h, t, vOf(drag.h.g, y), rangeOf(drag.h.g, mixer?.controls())), g: drag.h.g }; sel = drag.h; }
  hover = { x, y, text: label(drag.h) };
  draw();
});
const endDrag = () => { if (drag?.moved) changed(); drag = null; };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { hover = null; draw(); });
cv.addEventListener('dblclick', (e) => {
  if (!take || busy()) return;
  const { x, y } = pos(e), g = lanes[rowOf(y)];
  if (!g || !isControlLane(g) || pick(x, y)) return;
  before();
  sel = { ...addPoint(take, g, tOf(x), vOf(g, y), rangeOf(g, mixer?.controls())), g };
  changed();
});
cv.addEventListener('wheel', (e) => { if (!e.ctrlKey || !take) return; e.preventDefault(); zoom(e.deltaY < 0 ? 1.25 : 0.8, pos(e).x); }, { passive: false });
document.addEventListener('keydown', (e) => {
  if (document.body.dataset.dock !== 'automation' || !take || e.target.closest?.('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !busy()) {
    e.preventDefault(); before();
    if (sel.mark) removeEntry(take, sel.e); else removeHandle(take, sel);
    sel = null; changed();
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && undo.length && !busy()) { e.preventDefault(); take = JSON.parse(undo.pop()); sel = null; changed(); }
  else if (e.key === 's' && (e.ctrlKey || e.metaKey) && dirty) { e.preventDefault(); save(); }
});

// ---- the buttons
async function save() {
  if (!dirty || busy() || !setName) return;
  const r = await post('/api/sets/automation', { name: setName, take }).catch((e) => ({ ok: false, error: e.message }));
  if (!r.ok) return warn(`the lanes were not saved: ${r.error}`);
  saved = JSON.stringify(take); dirty = false; savedAt = r.automation.savedAt; undo = [];
  refresh();
}
$('#lnSave').onclick = save;
$('#lnRevert').onclick = () => { if (!saved) return; take = JSON.parse(saved); undo = []; sel = null; dirty = false; extra = []; refresh(); };
$('#lnUndo').onclick = () => { if (!undo.length) return; take = JSON.parse(undo.pop()); sel = null; changed(); };
$('#lnIn').onclick = () => zoom(1.5);
$('#lnOut').onclick = () => zoom(1 / 1.5);
$('#lnFit').onclick = () => { zoomed = false; layout(); scroller.scrollLeft = 0; draw(); };
$('#lnAdd').onchange = (e) => { const g = e.target.value; if (g) { extra.push(g); refresh(); } e.target.value = ''; };
$('#lnExports').onclick = () => post('/api/folder/open', { what: 'exports' }).then((r) => { if (!r.ok) warn(r.error); }).catch(() => {});
