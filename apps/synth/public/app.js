// The page: draws the patch and the sequence the server holds, sends every edit to it (POST /api/op), and makes
// the sound. The state comes back on the server's event stream, so an edit made from the CLI shows here, and is
// heard here, as it is made.
import { APP_NAME } from '../lib/app.mjs';
import { GROUPS, PANEL, SLOTS, paramsOf, format, toSlider, fromSlider, envOf } from '../lib/patch.mjs';
import { envLevel } from '../lib/envelope.mjs';
import { lowpassDb, qOf, dragTo, xOfFreq, yOfDb, freqOfX, CURVE } from '../lib/filter.mjs';
import { NOTE_MAX, isBlack, noteName, noteFreq } from '../lib/notes.mjs';
import { STEPS, VEL, tokens, rowText } from '../lib/seq.mjs';
import { ROWS, rollTop, pressCell, dragLength, removeNote, velocityAt } from '../lib/roll.mjs';
import { Engine, renderWav } from './engine.js';
import { mountAppsMenu } from './apps-menu.js';
import { createBrowser } from './browser.js';

mountAppsMenu(document.getElementById('appsBtn'), 'synth');

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let state = null;             // what the server last said
let autoStart = new URLSearchParams(location.search).has('desktop');   // start the sound with the first state (the desktop suite)
let gestureCount = 0;
const dragging = new Set();   // controls being moved by hand: the state does not write over them
const current = () => state.slots[state.slot];
const newGesture = () => `g${Date.now()}-${++gestureCount}`;

const engine = new Engine(() => ({ patch: current(), seq: state.seq }));
const browser = createBrowser({ state: () => state, current, send: (op) => send(op), hear: (name) => post('/api/play', { action: 'preset', name }).catch((err) => complain(err.message)) });

// ---- the link to the server

function setStatus(text, kind = 'on') {
  $('status').className = `status ${kind}`;
  $('statusText').textContent = text;
}

let errorTimer = null;
function complain(message) {
  setStatus(message, 'bad');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { errorTimer = null; setStatus('saved'); }, 4000);
}

async function post(route, body) {
  const res = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function take(next) {
  if (state && next.rev < state.rev) return;
  state = next;
  engine.setPatch(current());
  render();
  if (autoStart) { autoStart = false; startSound(); }
}

async function send(op) {
  try { take(await post('/api/op', op)); } catch (err) { complain(err.message); }
}

// for a control that is dragged: one edit on its way at a time, and the latest position after it
const latest = new Map();
async function sendLatest(key, op) {
  const slot = latest.get(key) || { busy: false, next: null };
  latest.set(key, slot);
  if (slot.busy) { slot.next = op; return; }
  slot.busy = true;
  await send(op);
  slot.busy = false;
  if (slot.next) { const next = slot.next; slot.next = null; sendLatest(key, next); }
}

function connect() {
  const events = new EventSource('/api/events');
  events.onmessage = (e) => { take(JSON.parse(e.data)); if (!errorTimer) setStatus('saved'); };
  events.onerror = () => setStatus('the server is not answering', 'bad');
  // `miniclaude play`, `miniclaude note` and `miniclaude stop`: Claude asking this page to sound
  events.addEventListener('play', (e) => {
    const ask = JSON.parse(e.data);
    if (!state) return;
    if (ask.action === 'seq') engine.start(ask.loops || Infinity);
    else if (ask.action === 'notes') { engine.sound(ask.notes, ask.seconds, ask.vel); flash(ask.notes, ask.seconds); }
    else if (ask.action === 'preset') engine.audition(ask.patch, ask.phrase);   // heard, not loaded
    else engine.panic();
  });
}

// ---- the panel, built from the schema

const controls = [];          // { def, input | buttons, output }
const SLIDER_STEPS = 1000;    // a slider that is not linear travels 0..1000 and the schema says what that means

// a slider is one undo step from the moment it is taken hold of until it is let go
function slide(input, op) {
  if (!input.gesture) { input.gesture = newGesture(); dragging.add(input); }
  sendLatest(input, { ...op, gesture: input.gesture });
}
function letGo(input) {
  input.gesture = null;
  dragging.delete(input);
}

function buildControl(def, groupName) {
  const id = `p-${def.id.replace('.', '-')}`;
  if (def.options) {
    const buttons = def.options.map((option) => {
      const b = el('button', { type: 'button' }, option);
      b.addEventListener('click', () => send({ op: 'set', param: def.id, value: option }));
      return b;
    });
    const seg = el('div', { className: 'seg', role: 'group', ariaLabel: `${groupName} ${def.label.toLowerCase()}` }, ...buttons);
    controls.push({ def, buttons });
    return el('div', { className: 'ctl' }, el('span', { className: 'label' }, def.label), seg);
  }
  const linear = def.curve === 'lin';
  const input = el('input', { type: 'range', id, min: linear ? def.min : 0, max: linear ? def.max : SLIDER_STEPS, step: linear ? def.step : 1, ariaLabel: `${groupName} ${def.label.toLowerCase()}` });
  const output = el('output', { htmlFor: id });
  const read = () => (linear ? Number(input.value) : fromSlider(def, input.value / SLIDER_STEPS));
  input.addEventListener('input', () => {
    output.textContent = format(def.id, read());
    slide(input, { op: 'set', param: def.id, value: read() });
  });
  input.addEventListener('change', () => letGo(input));
  controls.push({ def, input, output, linear });
  return el('div', { className: 'ctl' }, el('label', { htmlFor: id }, def.label), input, output);
}

// The panel is laid out as the sound travels (PANEL in lib/patch.mjs): four columns, each feeding the next
// (sources → filter → amp → out), and what moves the sound under them: the filter envelope and the LFO under the
// filter and the amp, the voice settings under the out (style.css places them).

function envelopeShape(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'shape');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.id = `shape-${id}`;
  svg.innerHTML = '<polyline fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
  return svg;
}

function buildCard(id) {
  const group = GROUPS.find((g) => g.id === id);
  const card = el('section', { className: 'group', ariaLabel: group.name });
  card.dataset.family = group.family;
  card.append(el('h2', {}, group.name));
  if (id === 'fenv' || id === 'aenv') card.append(envelopeShape(id));   // the shape first: what the sliders under it make
  if (id === 'filter') card.append(filterCurve());
  card.append(...paramsOf(id).map((def) => buildControl(def, group.name)));
  if (id === 'master') card.append(el('canvas', { id: 'meter', className: 'meter', width: 240, height: 10, ariaHidden: 'true', title: 'The level coming out' }));
  return card;
}

function buildColumn({ name, family, groups, className = '' }) {
  const col = el('div', { className: `col ${className}`.trim(), role: 'group', ariaLabel: name }, el('h3', {}, name), ...groups.map(buildCard));
  col.dataset.family = family;
  return col;
}

function buildPanel() {
  const arrow = () => el('span', { className: 'arrow', ariaHidden: 'true' }, '→');
  const flow = PANEL.flow.flatMap((c, i) => (i ? [arrow(), buildColumn(c)] : [buildColumn(c)]));
  $('panel').replaceChildren(...flow, ...PANEL.under.map(buildColumn));
}

// a canvas drawn at the size it is shown, in device pixels, so its lines stay sharp; false when it is not shown
function fit(canvas) {
  const dpr = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return false;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; canvas.drawn = null; }
  return true;
}

// ---- the filter curve: what the low-pass lets through at each frequency (lib/filter.mjs), drawn for a note at
// middle C (key tracking moves it with the note). Dragging it sets the cutoff (across) and the resonance (up), as
// one undo step like a slider.
function filterCurve() {
  const canvas = el('canvas', { id: 'curve', className: 'curve', title: 'The filter: drag across for the cutoff, up for the resonance', ariaLabel: 'Filter curve: drag to set the cutoff and the resonance' });
  const at = (e) => { const r = canvas.getBoundingClientRect(); return dragTo((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
  const move = (e) => {
    const { cutoff, resonance } = at(e);
    curveDrag = { cutoff, resonance };
    drawCurve();
    slide(canvas, { op: 'set', values: { 'filter.cutoff': cutoff, 'filter.resonance': resonance } });
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    canvas.held = true;
    move(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (canvas.held) move(e); });
  for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, () => { canvas.held = false; curveDrag = null; letGo(canvas); drawCurve(); });
  return canvas;
}
let curveDrag = null;          // where a drag has put the cutoff and the resonance, ahead of the server's answer

function drawCurve() {
  const canvas = $('curve');
  if (!canvas || !state || !fit(canvas)) return;
  const p = current(), cutoff = curveDrag?.cutoff ?? p['filter.cutoff'], resonance = curveDrag?.resonance ?? p['filter.resonance'];
  const key = `${cutoff}/${resonance}/${canvas.width}`;
  if (canvas.drawn === key) return;
  canvas.drawn = key;
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, dpr = devicePixelRatio || 1;
  g.clearRect(0, 0, w, h);
  g.lineWidth = dpr;
  g.strokeStyle = '#262631';                            // 0 dB, and the octaves 100 Hz, 1 kHz, 10 kHz
  g.beginPath();
  g.moveTo(0, yOfDb(0) * h); g.lineTo(w, yOfDb(0) * h);
  for (const f of [100, 1000, 10000]) { g.moveTo(xOfFreq(f) * w, 0); g.lineTo(xOfFreq(f) * w, h); }
  g.stroke();
  const colour = getComputedStyle(canvas).color;
  g.beginPath();
  for (let i = 0; i <= w; i += 2) {
    const y = yOfDb(lowpassDb(freqOfX(i / w), cutoff, qOf(resonance))) * h;
    if (i) g.lineTo(i, y); else g.moveTo(i, y);
  }
  g.lineTo(w, h); g.lineTo(0, h); g.closePath();
  g.globalAlpha = 0.12; g.fillStyle = colour; g.fill();
  g.globalAlpha = 1; g.lineWidth = 1.5 * dpr; g.strokeStyle = colour; g.stroke();
  // the handle, at the cutoff and as high as the peak
  g.beginPath();
  g.arc(xOfFreq(cutoff) * w, yOfDb(Math.max(0, qOf(resonance))) * h, 4.5 * dpr, 0, Math.PI * 2);
  g.fillStyle = colour; g.fill();
}

// ---- the sound coming out: the waveform, steadied on a rising zero crossing and about three periods of the
// lowest note sounding wide (at oscillator 1's pitch), so a held note stands still; and the spectrum, 20 Hz to 20 kHz across
let scopeBuf = null, specBuf = null;
function drawScope(note) {
  const analyser = engine.analyser, wave = $('wave'), spec = $('spectrum');
  const waveOn = fit(wave), specOn = fit(spec);
  if (!waveOn && !specOn) return;
  const quiet = !analyser || !engine.awake;
  if (waveOn) {
    const g = wave.getContext('2d'), w = wave.width, h = wave.height, dpr = devicePixelRatio || 1;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#262631'; g.lineWidth = dpr;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    if (!quiet) {
      if (scopeBuf?.length !== analyser.fftSize) scopeBuf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(scopeBuf);
      const sr = engine.ctx.sampleRate;
      const p = current(), pitch = (note ?? 48) + 12 * p['osc1.octave'] + p['osc1.semi'];   // what oscillator 1 sounds
      const span = Math.round(Math.min(scopeBuf.length / 2, Math.max(256, (3 * sr) / noteFreq(pitch))));
      // the latest stretch with sound in it, and the rising zero crossing that starts it: a short note followed by
      // silence is shown, not the silence
      let all = 0;
      for (const v of scopeBuf) all = Math.max(all, Math.abs(v));
      let from = 0;
      for (let i = scopeBuf.length - span - 1; i > 0; i--) {
        if (!(scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0)) continue;
        let p = 0;
        for (let j = i; j < i + span; j += 4) p = Math.max(p, Math.abs(scopeBuf[j]));
        if (p >= all * 0.5) { from = i; break; }
      }
      let peak = 0;
      for (let i = from; i < from + span; i++) peak = Math.max(peak, Math.abs(scopeBuf[i]));
      const scale = (h / 2 - 3 * dpr) / Math.max(0.25, peak);   // a quiet sound is drawn bigger, up to four times
      g.strokeStyle = getComputedStyle(wave).color; g.lineWidth = 1.5 * dpr;
      g.beginPath();
      for (let i = 0; i < span; i++) {
        const x = (i / (span - 1)) * w, y = h / 2 - scopeBuf[from + i] * scale;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
  }
  if (specOn) {
    const g = spec.getContext('2d'), w = spec.width, h = spec.height;
    g.clearRect(0, 0, w, h);
    if (quiet) return;
    if (specBuf?.length !== analyser.frequencyBinCount) specBuf = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(specBuf);
    const bars = Math.max(16, Math.min(64, Math.floor(w / (6 * (devicePixelRatio || 1))))), binHz = engine.ctx.sampleRate / analyser.fftSize;
    const gap = Math.max(1, Math.round(w / bars / 5)), bw = w / bars;
    g.fillStyle = getComputedStyle(spec).color;
    for (let b = 0; b < bars; b++) {
      const lo = Math.floor(freqOfX(b / bars) / binHz), hi = Math.max(lo + 1, Math.floor(freqOfX((b + 1) / bars) / binHz));
      let sum = 0, n = 0;
      for (let i = lo; i < hi && i < specBuf.length; i++) { sum += 10 ** (specBuf[i] / 10); n++; }
      const db = n ? 10 * Math.log10(sum / n + 1e-30) : -Infinity;
      const level = Math.min(1, Math.max(0, (db + 110) / 100));       // -110 dB to -10 dB, bottom to top
      const bh = Math.round(level * h);
      if (bh > 0) g.fillRect(Math.round(b * bw), h - bh, Math.max(1, Math.round(bw) - gap), bh);
    }
  }
}

// the level coming out, as a bar: solid green, amber from -12 dB, red from -3 dB (the limiter is working)
const METER_FLOOR = -48;
let meterLevel = METER_FLOOR, meterBuf = null;
function drawMeter() {
  const canvas = $('meter'), analyser = engine.analyser;
  if (!canvas) return;
  let db = METER_FLOOR;
  if (analyser) {
    if (meterBuf?.length !== analyser.fftSize) meterBuf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(meterBuf);
    let peak = 0;
    for (const v of meterBuf) peak = Math.max(peak, Math.abs(v));
    db = Math.max(METER_FLOOR, 20 * Math.log10(peak + 1e-9));
  }
  meterLevel = Math.max(db, meterLevel - 1.2);            // up at once, down slowly
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  const x = (d) => Math.round(((d - METER_FLOOR) / -METER_FLOOR) * w);
  g.fillStyle = '#0d0d12'; g.fillRect(0, 0, w, h);
  const lit = x(meterLevel);
  for (const [from, to, colour] of [[METER_FLOOR, -12, '#9be564'], [-12, -3, '#f2cc60'], [-3, 0, '#ff5566']]) {
    const a = x(from), b = Math.min(lit, x(to));
    if (b > a) { g.fillStyle = colour; g.fillRect(a, 0, b - a, h); }
  }
}

// an envelope as a line: the key held until the level has settled, then let go
function drawEnvelope(id, patch) {
  const env = envOf(patch, id);
  const held = env.attack + env.decay + 0.25 * (env.attack + env.decay + env.release);
  const total = held + env.release;
  const points = Array.from({ length: 81 }, (_, i) => `${(i * 1.25).toFixed(2)},${(37 - 34 * envLevel(env, (i / 80) * total, held)).toFixed(2)}`);
  $(`shape-${id}`).firstChild.setAttribute('points', points.join(' '));
}

// ---- drawing

// a control shows the state, except while it is being dragged or typed in
function setValue(input, value) {
  if (dragging.has(input) || (input.type !== 'range' && document.activeElement === input)) return;
  input.value = value;
}

function render() {
  const p = current();
  for (const c of controls) {
    const value = p[c.def.id];
    if (c.buttons) { for (const b of c.buttons) b.setAttribute('aria-pressed', b.textContent === value); continue; }
    setValue(c.input, c.linear ? value : Math.round(toSlider(c.def, value) * SLIDER_STEPS));
    if (!dragging.has(c.input)) c.output.textContent = format(c.def.id, value);
    c.input.setAttribute('aria-valuetext', format(c.def.id, value));
  }
  drawEnvelope('fenv', p);
  drawEnvelope('aenv', p);
  drawCurve();

  setValue($('name'), p.name);
  setValue($('bpm'), state.seq.bpm);
  setValue($('gate'), Math.round(state.seq.gate * 100));
  setValue($('swing'), Math.round(state.seq.swing * 100));
  $('gateOut').textContent = `${Math.round(state.seq.gate * 100)}%`;
  $('swingOut').textContent = `${Math.round(state.seq.swing * 100)}%`;
  for (const b of $('slots').children) {
    b.setAttribute('aria-pressed', b.dataset.slot === state.slot);
    b.title = `Slot ${b.dataset.slot}: ${state.slots[b.dataset.slot].name}`;
  }
  $('undo').disabled = !state.canUndo;
  $('redo').disabled = !state.canRedo;
  browser.render();
  renderSteps();
  renderNotes();
}

let shownNotes = -1;
function renderNotes() {
  const last = state.notes.at(-1)?.id ?? 0;
  if (last === shownNotes) return;
  shownNotes = last;
  $('notes').replaceChildren(...state.notes.map((n) => el('div', { className: n.from }, n.text)));
  $('notes').scrollTop = $('notes').scrollHeight;
}

// ---- the sequence: a ruler of steps (the one chosen is where a key played is written) over a piano roll, with a
// lane of velocities under it, one, two or four bars long

let selected = null;          // the step that the next note played is written to
let entry = { last: null, notes: [] };   // the step just written, so a second key held with the first makes a chord
const length = () => state.seq.steps.length;

function buildSteps() {
  $('steps').replaceChildren(...Array.from({ length: length() }, (_, s) => {
    const label = s % 4 ? '' : s % STEPS ? String(s / 4 % 4 + 1) : String(s / STEPS + 1);   // the bar, then its beats
    const b = el('button', { type: 'button', className: `step${s % STEPS ? '' : ' bar'}${s % 4 ? '' : ' beat'}` }, label);
    b.dataset.s = s;
    return b;
  }));
  $('steps').style.setProperty('--n', length());
  $('rollbox').style.setProperty('--n', length());
}

function renderSteps() {
  if ($('steps').children.length !== length()) { buildSteps(); if (selected >= length()) selected = null; }
  const shown = tokens(state.seq);
  [...$('steps').children].forEach((b, s) => {
    const token = shown[s];
    b.classList.toggle('on', token !== '.' && token !== '-');
    b.setAttribute('aria-pressed', s === selected);
    b.title = `Step ${s + 1}${state.seq.bars > 1 ? ` (bar ${Math.floor(s / STEPS) + 1})` : ''}: ${token === '.' ? 'rest' : token === '-' ? 'tied to the note before' : token}`;
    b.setAttribute('aria-label', b.title);
  });
  for (const b of $('bars').children) b.setAttribute('aria-pressed', Number(b.dataset.bars) === state.seq.bars);
  setValue($('row'), rowText(state.seq));
  $('rest').disabled = $('tie').disabled = selected === null;
  drawRoll();
}

function select(step) {
  selected = step;
  entry = { last: null, notes: [] };
  if (state) renderSteps();
}

// what is done to the chosen step, after which the next one is chosen
function writeStep(op) {
  if (selected === null) return;
  send({ op: 'step', step: selected, ...op });
  const next = (selected + 1) % length();
  select(next);
  if ($('steps').contains(document.activeElement)) $('steps').children[next].focus();
}

$('steps').addEventListener('click', (e) => {
  const b = e.target.closest('.step');
  if (b) select(Number(b.dataset.s) === selected ? null : Number(b.dataset.s));
});
$('steps').addEventListener('keydown', (e) => {
  const b = e.target.closest('.step');
  if (!b || e.ctrlKey || e.metaKey || e.altKey) return;
  const s = Number(b.dataset.s);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const next = (s + (e.key === 'ArrowRight' ? 1 : length() - 1)) % length();
    $('steps').children[next].focus();
    if (selected !== null) select(next);
  } else if (e.key === 'Delete' || e.key === 'Backspace') { select(s); writeStep({ token: '.' }); }
  else if (e.key === '-') { select(s); writeStep({ token: '-' }); }
  else if (e.key === 'Escape') select(null);
  else return;
  e.preventDefault();
});
$('rest').addEventListener('click', () => writeStep({ token: '.' }));
$('tie').addEventListener('click', () => writeStep({ token: '-' }));
$('clearseq').addEventListener('click', () => send({ op: 'clearseq' }));
$('bars').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send({ op: 'seqparam', key: 'bars', value: Number(b.dataset.bars) }); });
$('rowForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('row').blur();
  send({ op: 'row', text: $('row').value });
});

// ---- the piano roll (lib/roll.mjs does the sums): a note per row, a step per column, the velocities under it.
// A click on an empty cell adds a note there (and a drag on from it sets how long it is), a drag on a note's row
// sets its length, a click on a note without dragging removes it, and the lane under it is drawn on for velocity.
// Each press is one undo step, however long the drag. The wheel moves the notes shown up and down.
const ROLL = { gutter: 38, row: 14, lane: 40, gap: 6 };
let rollShift = 0;            // semitones the wheel has moved the view
let rollHold = null;          // { mode: 'note' | 'vel', step, note, from, moved, gesture }
let rollFrom = '';            // what is drawn, so a frame that changes nothing draws nothing

function rollGeometry(canvas) {
  const dpr = devicePixelRatio || 1;
  const top = rollTop(state.seq, rollShift);
  const grid = ROWS * ROLL.row;
  return { dpr, top, grid, colW: (canvas.clientWidth - ROLL.gutter) / length(), laneTop: grid + ROLL.gap, height: grid + ROLL.gap + ROLL.lane };
}

// where a pointer is: the step, and the note (on the grid) or the height in the lane (0 top, 1 bottom)
function rollAt(e) {
  const canvas = $('roll'), r = canvas.getBoundingClientRect(), g = rollGeometry(canvas);
  const x = e.clientX - r.left - ROLL.gutter, y = e.clientY - r.top;
  const step = Math.min(length() - 1, Math.max(0, Math.floor(x / g.colW)));
  if (y >= g.laneTop) return { step, lane: (y - g.laneTop) / ROLL.lane, inGutter: x < 0 };
  return { step, note: g.top - Math.min(ROWS - 1, Math.max(0, Math.floor(y / ROLL.row))), inGutter: x < 0 };
}

function rollSend(key, op) { sendLatest(`roll:${key}`, { ...op, gesture: rollHold.gesture }); }

$('roll').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state) return;
  const at = rollAt(e);
  if (at.inGutter) return;
  e.preventDefault();
  $('roll').setPointerCapture(e.pointerId);
  rollHold = { gesture: newGesture(), moved: false, from: at.step };
  if (at.lane !== undefined) {
    rollHold.mode = 'vel';
    const op = velocityAt(state.seq, at.step, at.lane);
    if (op) rollSend(`vel${at.step}`, op);
    return;
  }
  const press = pressCell(state.seq, at.step, at.note);
  Object.assign(rollHold, { mode: 'note', step: press.step, note: at.note, held: press.held });
  if (press.op) { rollSend('note', press.op); engine.sound([at.note], 0.18, 0.7); }
});
$('roll').addEventListener('pointermove', (e) => {
  if (!rollHold) { $('roll').style.cursor = rollAt(e).inGutter ? 'default' : ''; return; }
  const at = rollAt(e);
  if (rollHold.mode === 'vel') {
    const op = velocityAt(state.seq, at.step, at.lane ?? 0);
    if (op) rollSend(`vel${at.step}`, op);
    return;
  }
  if (at.step === rollHold.from && !rollHold.moved) return;
  rollHold.moved = true;
  rollSend('note', dragLength(state.seq, rollHold.step, Math.max(rollHold.step, at.step)));
});
for (const type of ['pointerup', 'pointercancel']) {
  $('roll').addEventListener(type, () => {
    if (!rollHold) return;
    if (type === 'pointerup' && rollHold.mode === 'note' && rollHold.held && !rollHold.moved) rollSend('note', removeNote(state.seq, rollHold.step, rollHold.note));
    rollHold = null;
  });
}
$('roll').addEventListener('wheel', (e) => {
  e.preventDefault();
  rollShift += e.deltaY < 0 ? 1 : -1;
  drawRoll();
}, { passive: false });

function drawRoll() {
  const canvas = $('roll');
  if (!state || !canvas.clientWidth) return;
  const g = rollGeometry(canvas);
  canvas.style.height = `${g.height}px`;
  const w = Math.round(canvas.clientWidth * g.dpr), h = Math.round(g.height * g.dpr);
  const key = JSON.stringify([state.seq.steps, g.top, w, h, selected, rollShownStep]);
  if (key === rollFrom) return;
  rollFrom = key;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext('2d'), css = getComputedStyle(canvas);
  c.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const x0 = ROLL.gutter, colW = g.colW, gridW = colW * length();
  // the rows: black keys darker, every C marked, each named in the gutter
  c.font = '10px ui-monospace, Consolas, monospace';
  c.textBaseline = 'middle';
  for (let r = 0; r < ROWS; r++) {
    const note = g.top - r, y = r * ROLL.row;
    c.fillStyle = isBlack(note) ? '#0b0b0f' : '#121218';
    c.fillRect(x0, y, gridW, ROLL.row);
    if (note % 12 === 0) { c.fillStyle = '#262631'; c.fillRect(x0, y + ROLL.row - 1, gridW, 1); }
    c.fillStyle = note % 12 === 0 ? '#ecebf2' : isBlack(note) ? '#5d5c6e' : '#8a899c';
    c.fillText(noteName(note), 4, y + ROLL.row / 2);
  }
  // the columns: steps faint, beats stronger, bars strongest; the chosen step and the playhead lit
  for (let s = 0; s <= length(); s++) {
    c.fillStyle = s % STEPS === 0 ? '#4a4a5a' : s % 4 === 0 ? '#2e2e3a' : '#1b1b23';
    c.fillRect(x0 + s * colW - (s === length() ? 1 : 0), 0, 1, g.grid);
  }
  const lit = (s, colour) => { c.fillStyle = colour; c.fillRect(x0 + s * colW, 0, colW, g.grid); };
  if (selected !== null) lit(selected, 'rgba(54, 214, 231, 0.10)');
  if (rollShownStep >= 0) lit(rollShownStep, 'rgba(236, 235, 242, 0.08)');
  // the notes, brighter for a higher velocity, and the ones above or below the view as a mark at its edge
  const accent = css.getPropertyValue('--low').trim() || '#ff7a45';
  state.seq.steps.forEach((step, s) => {
    if (!step) return;
    for (const note of step.notes) {
      const r = g.top - note;
      c.globalAlpha = 0.45 + 0.55 * step.vel;
      c.fillStyle = accent;
      if (r < 0 || r >= ROWS) { c.fillRect(x0 + s * colW + 1, r < 0 ? 0 : g.grid - 2, Math.max(2, step.len * colW - 2), 2); continue; }
      c.fillRect(x0 + s * colW + 1, r * ROLL.row + 1, Math.max(3, step.len * colW - 2), ROLL.row - 2);
    }
  });
  c.globalAlpha = 1;
  // the velocity lane: a bar for each step a note starts on, a dash for the rest
  c.fillStyle = '#0d0d12';
  c.fillRect(x0, g.laneTop, gridW, ROLL.lane);
  c.fillStyle = '#5d5c6e';
  c.fillText('vel', 4, g.laneTop + ROLL.lane / 2);
  state.seq.steps.forEach((step, s) => {
    const x = x0 + s * colW + Math.max(1, colW * 0.2), bw = Math.max(2, colW * 0.6);
    if (!step) { c.fillStyle = '#262631'; c.fillRect(x, g.laneTop + ROLL.lane - 2, bw, 2); return; }
    const bh = Math.max(2, step.vel * (ROLL.lane - 4));
    c.fillStyle = step.vel >= VEL.accent ? accent : '#a09fb0';
    c.fillRect(x, g.laneTop + ROLL.lane - bh, bw, bh);
  });
}
let rollShownStep = -1;

// ---- playing notes: the keys on the screen, the computer's keys, MIDI

const down = new Set();       // the notes held by hand
let lit = new Set();          // the keys drawn as down: held ones, and what the sequence or Claude is sounding
const flashed = new Map();    // note → when its light goes out (notes Claude asked for)
let octave = 3;               // the octave of the lowest key on the screen and of the Z key

function press(note, vel = 0.8) {
  if (note < 0 || note > NOTE_MAX || down.has(note) || !state) return;
  const chord = entry.last !== null && down.size > 0;
  down.add(note);
  engine.noteOn(note, vel);
  if (selected === null && !chord) return;
  if (chord) {                                         // another key while the first is still down: the same step
    entry.notes.push(note);
    send({ op: 'step', step: entry.last, notes: entry.notes });
  } else {
    const step = selected;
    writeStep({ notes: [note] });
    entry = { last: step, notes: [note] };
  }
}

function lift(note) {
  if (!down.delete(note)) return;
  engine.noteOff(note);
  if (!down.size) entry = { last: null, notes: [] };
}

function flash(notes, seconds) {
  for (const note of notes) flashed.set(note, performance.now() + seconds * 1000);
}

function buildKeys() {
  const octaves = innerWidth < 700 ? 2 : 3;
  const first = (octave + 1) * 12;
  const notes = Array.from({ length: octaves * 12 + 1 }, (_, i) => first + i).filter((n) => n <= NOTE_MAX);
  const whites = notes.filter((n) => !isBlack(n)).length;
  let white = 0;
  $('keys').replaceChildren(...notes.map((note) => {
    const black = isBlack(note);
    const key = el('button', { type: 'button', className: `key ${black ? 'black' : 'white'}`, tabIndex: -1, ariaLabel: noteName(note) }, note % 12 === 0 ? noteName(note) : '');
    key.dataset.note = note;
    if (black) { key.style.left = `${(white / whites) * 100}%`; key.style.width = `${(0.6 / whites) * 100}%`; } else white++;
    return key;
  }));
  $('octOut').textContent = `${noteName(first)} to ${noteName(notes.at(-1))}`;
  lit = new Set();
}

function setOctave(to) {
  octave = Math.min(6, Math.max(0, to));
  for (const note of [...down]) lift(note);
  buildKeys();
}

// a finger or the mouse on the keys: it can slide from key to key, and lower on a key is louder
const pointers = new Map();   // pointer → the note it holds

// The keyboard folds away, and this browser remembers it. The computer's keys and MIDI play all the same.
const FOLDED = 'miniclaude.keysHidden';
function foldKeys(hidden) {
  for (const note of pointers.values()) lift(note);    // a key under a finger goes with the keyboard
  pointers.clear();
  $('keys').hidden = hidden;
  $('board').classList.toggle('folded', hidden);
  $('fold').setAttribute('aria-expanded', !hidden);
  $('fold').textContent = hidden ? 'Show keys' : 'Hide keys';
  $('fold').title = hidden ? 'Bring the keyboard back' : 'Fold the keyboard away: the page gets its room, the typing keys still play';
}
$('fold').addEventListener('click', () => {
  const hidden = !$('keys').hidden;
  foldKeys(hidden);
  try { localStorage.setItem(FOLDED, hidden ? '1' : '0'); } catch { /* a browser that keeps nothing: it is shown again next time */ }
});
function keyUnder(e) {
  const key = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.key');
  if (!key || !$('keys').contains(key)) return null;
  const box = key.getBoundingClientRect();
  return { note: Number(key.dataset.note), vel: Math.min(1, Math.max(0.3, 0.3 + 0.7 * ((e.clientY - box.top) / box.height))) };
}
$('keys').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  $('keys').setPointerCapture(e.pointerId);
  const key = keyUnder(e);
  if (!key) return;
  pointers.set(e.pointerId, key.note);
  press(key.note, key.vel);
});
$('keys').addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const key = keyUnder(e);
  const was = pointers.get(e.pointerId);
  if (!key || key.note === was) return;
  lift(was);
  pointers.set(e.pointerId, key.note);
  press(key.note, key.vel);
});
for (const type of ['pointerup', 'pointercancel']) {
  $('keys').addEventListener(type, (e) => {
    if (!pointers.has(e.pointerId)) return;
    lift(pointers.get(e.pointerId));
    pointers.delete(e.pointerId);
  });
}

// two rows of the computer's keys as a piano, by where the key is and not by what is printed on it
const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP'];
const KEY_NOTE = new Map([...LOWER.map((code, i) => [code, i]), ...UPPER.map((code, i) => [code, i + 12])]);
const typed = new Map();      // key code → the note it started, so an octave change does not leave it sounding

addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); return browser.save(); }   // from a text box too
  if (e.target.matches('input:not([type="range"]), select, textarea')) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); send({ op: e.shiftKey ? 'redo' : 'undo' }); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); send({ op: 'redo' }); }
  else if (mod || e.altKey) return;
  else if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); togglePlay(); }
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight') setOctave(octave + (e.code === 'BracketLeft' ? -1 : 1));
  else if (KEY_NOTE.has(e.code)) {
    e.preventDefault();
    if (e.repeat || typed.has(e.code)) return;
    const note = (octave + 1) * 12 + KEY_NOTE.get(e.code);
    typed.set(e.code, note);
    press(note);
  }
});
addEventListener('keyup', (e) => {
  if (!typed.has(e.code)) return;
  lift(typed.get(e.code));
  typed.delete(e.code);
});
addEventListener('blur', () => {                       // a key let go while another window has the keyboard is never heard of
  for (const note of [...down]) lift(note);
  typed.clear();
  pointers.clear();
});

// a MIDI keyboard, where the browser has Web MIDI
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { $('midi').textContent = 'No MIDI in this browser'; $('midi').disabled = true; return; }
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      const inputs = [...access.inputs.values()];
      for (const input of inputs) {
        input.onmidimessage = ({ data: [status, note, vel] }) => {
          const kind = status & 0xf0;
          if (kind === 0x90 && vel > 0) press(note, vel / 127);
          else if (kind === 0x80 || kind === 0x90) lift(note);
        };
      }
      $('midi').textContent = inputs.length ? `MIDI: ${inputs.map((i) => i.name).join(', ').slice(0, 40)}` : 'MIDI: nothing plugged in';
    };
    access.onstatechange = hook;
    hook();
  } catch {
    $('midi').textContent = 'MIDI was not allowed';
  }
}
$('midi').addEventListener('click', connectMidi);
navigator.permissions?.query({ name: 'midi' }).then((p) => { if (p.state === 'granted') connectMidi(); }).catch(() => {});

// ---- the playhead, and the keys that are sounding

let shownStep = -1;
function frame() {
  const seq = state?.seq;
  const step = engine.playing && seq ? Math.floor(Math.max(0, engine.position())) % seq.steps.length : -1;
  if (step !== shownStep) {
    $('steps').children[shownStep]?.classList.remove('now');
    $('steps').children[step]?.classList.add('now');
    shownStep = rollShownStep = step;
    drawRoll();
  }
  const now = performance.now();
  const sounding = new Set(down);
  for (const [note, until] of flashed) { if (until > now) sounding.add(note); else flashed.delete(note); }
  if (step >= 0) {                                     // the note on this step, or the one tied over it
    const owner = seq.steps.findLast((s, i) => s && i <= step && i + s.len > step);
    for (const note of owner?.notes || []) sounding.add(note);
  }
  if (sounding.size !== lit.size || [...sounding].some((n) => !lit.has(n))) {
    for (const key of $('keys').children) key.classList.toggle('down', sounding.has(Number(key.dataset.note)));
    lit = sounding;
  }
  drawMeter();
  drawScope(sounding.size ? Math.min(...sounding) : engine.miniclaude?.lastNote);
  if (!curveDrag) drawCurve();                         // a resized window redraws it
  requestAnimationFrame(frame);
}

function togglePlay() {
  if (engine.playing) engine.stop(); else engine.start();
}

// the play button and the sound light follow the engine, and the server is told (so `miniclaude play` can say
// whether anything will be heard)
engine.onChange = () => {
  const on = engine.awake;
  $('play').setAttribute('aria-pressed', engine.playing);
  $('play').textContent = engine.playing ? 'Stop' : 'Play';
  $('soundLight').classList.toggle('on', on);
  $('soundText').textContent = on ? 'sound on' : 'sound off';
  if (on && !$('startOverlay').hidden) { $('startOverlay').hidden = true; $('play').focus(); }   // gone until the page is loaded again
  post('/api/transport', { playing: engine.playing, awake: on }).catch(() => {});
};

// ---- the sound: a browser keeps a page silent until it is clicked, so a card asks for that click

function startSound() {
  if (!state) { $('startMsg').textContent = 'The server has not answered yet, and the synth is built from the patch it holds. Try again in a moment.'; return; }
  try {
    engine.wake();
    engine.onChange();                                 // a context made in a click may be running at once, with no change to hear of
  } catch (err) { $('startMsg').textContent = `The sound could not be started: ${err.message}`; $('startOverlay').hidden = false; }
}
$('startBtn').addEventListener('click', startSound);
// While the card is up the keys are its own: Enter and Space start the sound, Tab stays on the one button, and the
// page's shortcuts behind it are not reached. A click beside the button leaves the focus on it.
$('startOverlay').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startSound(); }
  else if (e.key === 'Tab') e.preventDefault();
});
$('startOverlay').addEventListener('mousedown', (e) => { if (e.target !== $('startBtn')) e.preventDefault(); });
$('startBtn').focus();
// The desktop suite (apps/desktop) loads the page with ?desktop: it may play sound without a click, so the card is
// never shown there and the sound starts by itself, as soon as there is a patch to play.
if (autoStart) $('startOverlay').hidden = true;

// ---- the bars

$('play').addEventListener('click', togglePlay);
$('bpm').addEventListener('change', () => send({ op: 'seqparam', key: 'bpm', value: Number($('bpm').value) }));
$('name').addEventListener('change', () => send({ op: 'name', value: $('name').value }));
for (const key of ['gate', 'swing']) {
  $(key).addEventListener('input', () => {
    $(`${key}Out`).textContent = `${$(key).value}%`;
    slide($(key), { op: 'seqparam', key, value: $(key).value / 100 });
  });
  $(key).addEventListener('change', () => letGo($(key)));
}
$('slots').append(...SLOTS.map((s) => { const b = el('button', { type: 'button' }, s); b.dataset.slot = s; return b; }));
$('slots').addEventListener('click', (e) => e.target.dataset.slot && send({ op: 'slot', slot: e.target.dataset.slot }));
$('init').addEventListener('click', () => send({ op: 'init' }));
$('undo').addEventListener('click', () => send({ op: 'undo' }));
$('redo').addEventListener('click', () => send({ op: 'redo' }));
$('octDown').addEventListener('click', () => setOctave(octave - 1));
$('octUp').addEventListener('click', () => setOctave(octave + 1));

$('wav').addEventListener('click', async () => {
  const p = current();
  $('wav').disabled = true;
  try {
    const url = URL.createObjectURL(await renderWav(p, state.seq, 2));
    el('a', { href: url, download: `${p.name.replace(/[^\w -]/g, '').trim() || 'patch'}.wav` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) { complain(`the WAV could not be made: ${err.message}`); }
  $('wav').disabled = false;
});

$('ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('askText').value.trim();
  if (!text) return;
  $('askText').value = '';
  try { await post('/api/ask', { text }); } catch (err) { complain(err.message); }
});

document.title = APP_NAME;
buildPanel();
buildKeys();
try { if (localStorage.getItem(FOLDED) === '1') foldKeys(true); } catch { /* storage is closed to the page: the keyboard shows */ }
let wide = innerWidth >= 700;
addEventListener('resize', () => { if ((innerWidth >= 700) !== wide) { wide = innerWidth >= 700; buildKeys(); } drawRoll(); });
engine.onChange();             // a page just loaded cannot sound yet, whatever the one before it told the server
connect();
requestAnimationFrame(frame);
