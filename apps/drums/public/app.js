// The page: draws the beat the server holds, sends every edit to it (POST /api/op), and plays it. The state
// comes back on the server's event stream, so an edit made from the CLI shows here as it is made.
import { VOICES, LEVELS, LEVEL_NAMES, levelOf } from '/lib/kit.mjs';
import { stepSeconds, swingSteps, clampOffset, beatName, beatSteps } from '/lib/timing.mjs';
import { SLOTS } from '/lib/pattern.mjs';
import { FEELS, morph } from '/lib/groove.mjs';
import { Engine, renderWav } from './engine.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let state = null;          // what the server last said
let audition = null;       // a pattern being listened to without being kept (a held variation, a morph in progress)
let builtSteps = 0;        // the number of steps the grid was built for
let gestureCount = 0;
const dragging = new Set();   // controls being moved by hand: the state does not write over them
const current = () => state.slots[state.slot];
const newGesture = () => `g${Date.now()}-${++gestureCount}`;

const engine = new Engine(() => audition || current());

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
  render();
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
}

// ---- drawing

// The ruler: one empty mark per step, sized by the same rules as the pads below it (style.css), so its columns
// are the grid's columns at any width. The number of a beat is a button in the beat's first mark.
function buildRuler(steps) {
  const starts = new Set(beatSteps(steps));
  $('ruler').replaceChildren(
    el('div', { className: 'strip' }),
    el('div', { className: 'cells' }, ...Array.from({ length: steps }, (_, s) => {
      if (!starts.has(s)) return el('span', { className: 'tick' });
      const name = beatName(s);
      const b = el('button', { className: 'beatno', title: `Beat ${name}: click = play from here`, ariaLabel: `Play from beat ${name}` }, name);
      b.dataset.s = s;
      return el('span', { className: 'tick' }, b);
    })));
}

function buildGrid(pattern) {
  builtSteps = pattern.steps;
  buildRuler(pattern.steps);
  $('grid').replaceChildren(...pattern.tracks.map((track, i) => {
    const voice = VOICES.find((v) => v.id === track.voice);
    const range = (cls, key, min, max, step, title) => el('label', {}, key, el('input', { type: 'range', className: cls, min, max, step, title, ariaLabel: `${voice.name} ${title}` }));
    return el('div', { className: 'row' },
      el('div', { className: 'strip' },
        el('button', { className: 'tap', title: `Hear the ${voice.name.toLowerCase()} (key ${i + 1})` }, voice.name, el('small', {}, String(i + 1))),
        el('button', { className: 'ms m', title: 'Mute', ariaLabel: `Mute ${voice.name}` }, 'M'),
        el('button', { className: 'ms s', title: 'Solo', ariaLabel: `Solo ${voice.name}` }, 'S'),
        range('level', 'vol', 0, 100, 1, 'level'),
        range('tune', 'tune', -12, 12, 1, 'tune')),
      el('div', { className: 'cells' }, ...Array.from({ length: pattern.steps }, (_, s) => el('button', { className: `cell${s % 4 ? '' : ' beat'}` }, el('i')))));
  }));
  [...$('grid').children].forEach((row, i) => {
    row.dataset.voice = pattern.tracks[i].voice;
    row.dataset.group = VOICES[i].group;
    [...row.querySelectorAll('.cell')].forEach((cell, s) => { cell.dataset.s = s; });
  });
}

const describe = (voice, s, vel, off, bpm) => {
  if (!(vel > 0)) return `${voice} · step ${s + 1}`;
  const ms = Math.round(off * stepSeconds(bpm) * 1000);
  return `${voice} · step ${s + 1} · ${levelOf(vel)}${ms ? ` · ${Math.abs(ms)} ms ${ms > 0 ? 'late' : 'early'}` : ''}`;
};

// a control shows the state, except while it is being dragged or typed in
function setValue(input, value) {
  if (dragging.has(input) || (input.type !== 'range' && document.activeElement === input)) return;
  input.value = value;
}

function render() {
  const p = current();
  if (p.steps !== builtSteps) buildGrid(p);
  const solo = p.tracks.some((t) => t.solo);
  [...$('grid').children].forEach((row, i) => {
    const t = p.tracks[i];
    const name = VOICES[i].name;
    row.classList.toggle('silent', solo ? !t.solo : t.mute);
    row.querySelector('.m').setAttribute('aria-pressed', t.mute);
    row.querySelector('.s').setAttribute('aria-pressed', t.solo);
    setValue(row.querySelector('.level'), Math.round(t.level * 100));
    setValue(row.querySelector('.tune'), t.tune);
    row.querySelectorAll('.cell').forEach((cell, s) => {
      const vel = t.vel[s];
      const on = vel > 0;
      cell.classList.toggle('on', on);
      cell.classList.toggle('accent', on && levelOf(vel) === 'accent');
      cell.style.setProperty('--v', vel);
      cell.style.setProperty('--o', on ? swingSteps(s, p.swing) + t.off[s] : 0);
      cell.title = describe(name, s, vel, t.off[s], p.bpm);
      cell.setAttribute('aria-label', cell.title);
      cell.setAttribute('aria-pressed', on);
    });
  });

  setValue($('bpm'), p.bpm);
  setValue($('swing'), Math.round(p.swing * 100));
  setValue($('name'), p.name);
  $('swingOut').textContent = `${Math.round(p.swing * 100)}% · ${(p.swing * 0.5 * stepSeconds(p.bpm) * 1000).toFixed(1)} ms late`;
  for (const b of $('steps').children) b.setAttribute('aria-pressed', Number(b.dataset.steps) === p.steps);
  for (const b of $('slots').children) b.setAttribute('aria-pressed', b.dataset.slot === state.slot);
  for (const b of $('morphTo').children) {
    b.hidden = b.dataset.slot === state.slot;
    if (b.hidden && b.getAttribute('aria-pressed') === 'true') pickMorphTarget(SLOTS.find((s) => s !== state.slot));
  }
  $('undo').disabled = !state.canUndo;
  $('redo').disabled = !state.canRedo;
  $('midi').href = `/api/export.mid?loops=${exportLoops(p)}`;
  if ($('preset').options.length === 1) $('preset').append(...state.presets.map((name) => el('option', { value: name }, name)));
  renderCandidates();
  renderNotes();
}

const exportLoops = (p) => (p.steps === 16 ? 4 : 2);

// a variation as a small picture of its grid
function thumbnail(p) {
  const rects = p.tracks.flatMap((t, row) => t.vel.map((v, s) => (v > 0 ? `<rect x="${s}" y="${row}" width="0.8" height="0.8" opacity="${0.4 + 0.6 * v}"/>` : '')));
  return `<svg viewBox="0 0 ${p.steps} ${p.tracks.length}" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${rects.join('')}</svg>`;
}

function renderCandidates() {
  const key = JSON.stringify(state.candidates);
  if (key === $('candidates').dataset.key) return;
  $('candidates').dataset.key = key;
  $('candidates').replaceChildren(...(state.candidates || []).map((p, i) => {
    const b = el('button', { title: 'Hold to hear it, click to keep it', ariaLabel: `Variation ${i + 1}` });
    b.innerHTML = `${thumbnail(p)}<span>${i + 1}</span>`;
    b.dataset.index = i;
    return b;
  }));
}

let shownNotes = -1;
function renderNotes() {
  const last = state.notes.at(-1)?.id ?? 0;
  if (last === shownNotes) return;
  shownNotes = last;
  $('notes').replaceChildren(...state.notes.map((n) => el('div', { className: n.from }, n.text)));
  $('notes').scrollTop = $('notes').scrollHeight;
}

// ---- the playhead

let shownStep = -1;
function frame() {
  const step = engine.playing && state ? Math.floor(Math.max(0, engine.position())) % (audition || current()).steps : -1;
  if (step !== shownStep) {
    for (const row of [$('ruler'), ...$('grid').children]) {      // the ruler's mark and the pads of that step: one lit column
      const cells = row.lastElementChild.children;
      cells[shownStep]?.classList.remove('now');
      cells[step]?.classList.add('now');
    }
    shownStep = step;
  }
  requestAnimationFrame(frame);
}

function togglePlay() {
  if (engine.playing) engine.stop(); else engine.start();
  $('play').setAttribute('aria-pressed', engine.playing);
  $('play').textContent = engine.playing ? 'Stop' : 'Play';
  post('/api/transport', { playing: engine.playing }).catch(() => {});   // the server's banner follows the playhead
}

// A number on the ruler: play from that beat. While it plays, the playhead moves there.
function playFrom(step) {
  engine.start(step);
  $('play').setAttribute('aria-pressed', true);
  $('play').textContent = 'Stop';
  post('/api/transport', { playing: true, from: step }).catch(() => {});
}
$('ruler').addEventListener('click', (e) => {
  const b = e.target.closest('.beatno');
  if (b) playFrom(Number(b.dataset.s));
});
// Space on a number is that button's own click, not the page's play / stop
$('ruler').addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });

// Something heard only while a button is held: it plays if nothing is playing, and stops again on release.
let startedForAudition = false;
function listen(pattern) {
  audition = pattern;
  if (pattern && !engine.playing) { togglePlay(); startedForAudition = true; }
  if (!pattern && startedForAudition) { startedForAudition = false; if (engine.playing) togglePlay(); }
}

// ---- the grid by hand

const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.cell');
const voiceOf = (cell) => cell.closest('.row').dataset.voice;
const trackOf = (cell) => current().tracks.find((t) => t.voice === voiceOf(cell));

function cycleLevel(cell) {
  const vel = trackOf(cell).vel[cell.dataset.s];
  const next = vel > 0 ? LEVEL_NAMES[(LEVEL_NAMES.indexOf(levelOf(vel)) + 1) % LEVEL_NAMES.length] : 'normal';
  send({ op: 'step', track: voiceOf(cell), step: Number(cell.dataset.s), vel: LEVELS[next] });
}

function nudge(cell, by) {
  const off = trackOf(cell).off[cell.dataset.s];
  send({ op: 'step', track: voiceOf(cell), step: Number(cell.dataset.s), off: clampOffset(off + by) });
}

let drag = null;
$('grid').addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || e.button !== 0) return;
  e.preventDefault();
  cell.focus();
  const track = trackOf(cell);
  const s = Number(cell.dataset.s);
  if (e.shiftKey) return cycleLevel(cell);
  $('grid').setPointerCapture(e.pointerId);
  if (e.altKey) {
    if (!(track.vel[s] > 0)) return;
    drag = { kind: 'nudge', cell, x: e.clientX, off: track.off[s], pitch: cell.offsetWidth + 3, gesture: newGesture() };
    return;
  }
  drag = { kind: 'paint', row: cell.closest('.row'), vel: track.vel[s] > 0 ? 0 : LEVELS.normal, done: new Set(), gesture: newGesture() };
  paint(cell);
});

function paint(cell) {
  if (!cell || cell.closest('.row') !== drag.row || drag.done.has(cell)) return;
  drag.done.add(cell);
  if ((trackOf(cell).vel[cell.dataset.s] > 0) === (drag.vel > 0)) return;
  if (drag.vel > 0) engine.tap(voiceOf(cell), trackOf(cell));
  send({ op: 'step', track: voiceOf(cell), step: Number(cell.dataset.s), vel: drag.vel, gesture: drag.gesture });
}

$('grid').addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (drag.kind === 'paint') return paint(cellAt(e.clientX, e.clientY));
  const off = clampOffset(drag.off + (e.clientX - drag.x) / drag.pitch);
  sendLatest('nudge', { op: 'step', track: voiceOf(drag.cell), step: Number(drag.cell.dataset.s), off, gesture: drag.gesture });
});
for (const type of ['pointerup', 'pointercancel']) $('grid').addEventListener(type, () => { drag = null; });

// the same from the keyboard, on the focused step: Enter or Space writes, V changes the level, [ and ] move it
$('grid').addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || e.ctrlKey || e.metaKey) return;
  const track = trackOf(cell);
  const s = Number(cell.dataset.s);
  if (e.key === 'Enter' || e.key === ' ') send({ op: 'step', track: track.voice, step: s, vel: track.vel[s] > 0 ? 0 : LEVELS.normal });
  else if (e.key === 'v' || e.key === 'V') cycleLevel(cell);
  else if ((e.key === '[' || e.key === ']') && track.vel[s] > 0) nudge(cell, e.key === '[' ? -0.02 : 0.02);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') (e.key === 'ArrowRight' ? cell.nextElementSibling : cell.previousElementSibling)?.focus();
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const row = cell.closest('.row')[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling'];
    row?.querySelectorAll('.cell')[s]?.focus();
  } else return;
  e.preventDefault();
  e.stopPropagation();
});

// the strip at the left of each row
$('grid').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const track = current().tracks.find((t) => t.voice === row.dataset.voice);
  if (e.target.closest('.tap')) engine.tap(track.voice, track);
  else if (e.target.closest('.m')) send({ op: 'track', track: track.voice, key: 'mute', value: !track.mute });
  else if (e.target.closest('.s')) send({ op: 'track', track: track.voice, key: 'solo', value: !track.solo });
});

// a slider is one undo step from the moment it is taken hold of until it is let go
function slide(input, op) {
  if (!input.gesture) { input.gesture = newGesture(); dragging.add(input); }
  sendLatest(input, { ...op, gesture: input.gesture });
}
function letGo(input) {
  input.gesture = null;
  dragging.delete(input);
}

$('grid').addEventListener('input', (e) => {
  if (e.target.type !== 'range') return;
  const isLevel = e.target.classList.contains('level');
  const n = Number(e.target.value);
  slide(e.target, { op: 'track', track: e.target.closest('.row').dataset.voice, key: isLevel ? 'level' : 'tune', value: isLevel ? n / 100 : n });
});
$('grid').addEventListener('change', (e) => letGo(e.target));

// ---- the top bar

$('play').addEventListener('click', togglePlay);
$('bpm').addEventListener('change', () => send({ op: 'param', key: 'bpm', value: Number($('bpm').value) }));
$('name').addEventListener('change', () => send({ op: 'param', key: 'name', value: $('name').value }));
$('swing').addEventListener('input', () => slide($('swing'), { op: 'param', key: 'swing', value: $('swing').value / 100 }));
$('swing').addEventListener('change', () => letGo($('swing')));
$('steps').addEventListener('click', (e) => e.target.dataset.steps && send({ op: 'param', key: 'steps', value: Number(e.target.dataset.steps) }));
$('slots').append(...SLOTS.map((s) => { const b = el('button', { title: `Pattern ${s}` }, s); b.dataset.slot = s; return b; }));
$('slots').addEventListener('click', (e) => e.target.dataset.slot && send({ op: 'slot', slot: e.target.dataset.slot }));
$('preset').addEventListener('change', () => { if ($('preset').value) send({ op: 'preset', name: $('preset').value }); $('preset').value = ''; });
$('undo').addEventListener('click', () => send({ op: 'undo' }));
$('redo').addEventListener('click', () => send({ op: 'redo' }));
$('clear').addEventListener('click', () => send({ op: 'clear' }));

$('wav').addEventListener('click', async () => {
  const p = current();
  $('wav').disabled = true;
  try {
    const url = URL.createObjectURL(await renderWav(p, exportLoops(p)));
    el('a', { href: url, download: `${p.name.replace(/[^\w -]/g, '').trim() || 'beat'}.wav` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) { complain(`the WAV could not be made: ${err.message}`); }
  $('wav').disabled = false;
});

// hold: the beat as a plain grid would play it
function hold(button, patternFor) {
  button.addEventListener('pointerdown', (e) => { button.setPointerCapture(e.pointerId); listen(patternFor()); });
  for (const type of ['pointerup', 'pointercancel']) button.addEventListener(type, () => listen(null));
  button.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) listen(patternFor()); e.stopPropagation(); });
  button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') listen(null); });
}
hold($('straight'), () => {
  const p = structuredClone(current());
  p.swing = 0;
  for (const t of p.tracks) { t.off = t.off.map(() => 0); t.vel = t.vel.map((v) => (v > 0 ? LEVELS[levelOf(v)] : 0)); }
  return p;
});

// ---- groove tools

$('feel').append(...Object.entries(FEELS).map(([id, f]) => el('option', { value: id, title: f.about }, id)));
$('feel').value = 'laidback';
$('humanize').addEventListener('click', () => send({ op: 'humanize', feel: $('feel').value, amount: $('feelAmount').value / 100 }));
$('quantize').addEventListener('click', () => send({ op: 'quantize' }));
$('vary').addEventListener('click', () => send({ op: 'vary', wild: $('wild').value / 100 }));
$('continue').addEventListener('click', () => send({ op: 'continue' }));

// a variation: held, it is heard; let go quickly (a click), it is kept
let heldAt = 0;
$('candidates').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.setPointerCapture(e.pointerId);
  b.classList.add('held');
  heldAt = performance.now();
  listen(state.candidates[b.dataset.index]);
});
for (const type of ['pointerup', 'pointercancel']) {
  $('candidates').addEventListener(type, (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.classList.remove('held');
    listen(null);
    if (type === 'pointerup' && performance.now() - heldAt < 350) send({ op: 'pick', index: Number(b.dataset.index) });
  });
}
$('candidates').addEventListener('click', (e) => {            // from the keyboard
  const b = e.target.closest('button');
  if (b && e.detail === 0) send({ op: 'pick', index: Number(b.dataset.index) });
});

// morph: the slider is heard as it moves and kept when it is let go
$('morphTo').append(...SLOTS.map((s) => { const b = el('button', {}, s); b.dataset.slot = s; return b; }));
function pickMorphTarget(slot) {
  for (const b of $('morphTo').children) b.setAttribute('aria-pressed', b.dataset.slot === slot);
}
pickMorphTarget('B');
$('morphTo').addEventListener('click', (e) => e.target.dataset.slot && pickMorphTarget(e.target.dataset.slot));
let morphFrom = null;
$('morph').addEventListener('input', () => {
  morphFrom ||= current();
  const to = state.slots[$('morphTo').querySelector('[aria-pressed="true"]').dataset.slot];
  listen({ ...morph(morphFrom, to, $('morph').value / 100), name: morphFrom.name });
});
$('morph').addEventListener('change', () => {
  if (audition && Number($('morph').value) > 0) send({ op: 'replace', pattern: audition });
  listen(null);
  morphFrom = null;
  $('morph').value = 0;
});

$('ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('askText').value.trim();
  if (!text) return;
  $('askText').value = '';
  try { await post('/api/ask', { text }); } catch (err) { complain(err.message); }
});

// ---- keys

addEventListener('keydown', (e) => {
  if (e.target.matches('input:not([type="range"]), select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); send({ op: e.shiftKey ? 'redo' : 'undo' }); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); send({ op: 'redo' }); }
  else if (mod || e.altKey) return;
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (/^[1-8]$/.test(e.key) && state) { const t = current().tracks[e.key - 1]; engine.tap(t.voice, t); }
});

// ---- the sound: a browser keeps a page silent until it is clicked, so a card asks for that click

let toldSound = null;      // what the server was last told
function soundChanged() {
  const on = engine.ctx?.state === 'running';
  $('soundLight').classList.toggle('on', on);
  $('soundText').textContent = on ? 'sound on' : 'sound off';
  if (on && !$('startOverlay').hidden) { $('startOverlay').hidden = true; $('play').focus(); }   // gone until the page is loaded again
  if (on === toldSound) return;
  toldSound = on;
  post('/api/transport', { awake: on }).catch(() => {});   // so `cl808 open` can say whether anything will be heard
}

function startSound() {
  try {
    engine.wake();
    engine.ctx.onstatechange = soundChanged;           // the browser says when the sound is on, and if it takes it away again
    soundChanged();
  } catch (err) { $('startMsg').textContent = `The sound could not be started: ${err.message}`; }
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

soundChanged();
connect();
requestAnimationFrame(frame);
