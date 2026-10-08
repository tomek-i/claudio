// The page: draws the patch and the sequence the server holds, sends every edit to it (POST /api/op), and makes
// the sound. The state comes back on the server's event stream, so an edit made from the CLI shows here, and is
// heard here, as it is made.
import { APP_NAME } from '../lib/app.mjs';
import { GROUPS, SLOTS, paramsOf, format, toSlider, fromSlider, envOf } from '../lib/patch.mjs';
import { envLevel } from '../lib/envelope.mjs';
import { NOTE_MAX, isBlack, noteName } from '../lib/notes.mjs';
import { STEPS, tokens, rowText } from '../lib/seq.mjs';
import { Engine, renderWav } from './engine.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let state = null;             // what the server last said
let gestureCount = 0;
const dragging = new Set();   // controls being moved by hand: the state does not write over them
const current = () => state.slots[state.slot];
const newGesture = () => `g${Date.now()}-${++gestureCount}`;

const engine = new Engine(() => ({ patch: current(), seq: state.seq }));

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

const SHARES_A_CARD = { master: 'reverb' };   // a section with one control sits under another: section → the card it joins

function buildPanel() {
  const cards = new Map();
  for (const group of GROUPS) {
    const host = cards.get(SHARES_A_CARD[group.id]);
    const card = host || el('section', { className: 'group', ariaLabel: group.name });
    card.dataset.family = group.family;
    cards.set(group.id, card);
    card.append(el('h2', {}, group.name), ...paramsOf(group.id).map((def) => buildControl(def, group.name)));
    if (group.id === 'fenv' || group.id === 'aenv') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'shape');
      svg.setAttribute('viewBox', '0 0 100 40');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.id = `shape-${group.id}`;
      svg.innerHTML = '<polyline fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
      card.append(svg);
    }
  }
  $('panel').replaceChildren(...new Set(cards.values()));
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
  if ($('preset').options.length === 1) {
    for (const kind of [...new Set(state.presets.map((s) => s.kind))]) {
      $('preset').append(el('optgroup', { label: kind }, ...state.presets.filter((s) => s.kind === kind).map((s) => el('option', { value: s.name }, s.name))));
    }
  }
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

// ---- the sequence

let selected = null;          // the step that the next note played is written to
let entry = { last: null, notes: [] };   // the step just written, so a second key held with the first makes a chord

function buildSteps() {
  $('steps').replaceChildren(...Array.from({ length: STEPS }, (_, s) => {
    const b = el('button', { type: 'button', className: 'step' }, el('span'), el('small', {}, String(s + 1)));
    b.dataset.s = s;
    return b;
  }));
}

function renderSteps() {
  const shown = tokens(state.seq);
  [...$('steps').children].forEach((b, s) => {
    const token = shown[s];
    b.firstChild.textContent = token === '.' ? '·' : token === '-' ? '—' : token.replace(/[!:].*$/, '').replaceAll('+', ' ');
    b.classList.toggle('on', token !== '.' && token !== '-');
    b.classList.toggle('tied', token === '-');
    b.classList.toggle('rest', token === '.');
    b.setAttribute('aria-pressed', s === selected);
    b.title = `Step ${s + 1}: ${token === '.' ? 'rest' : token === '-' ? 'tied to the note before' : token}`;
    b.setAttribute('aria-label', b.title);
  });
  setValue($('row'), rowText(state.seq));
  $('rest').disabled = $('tie').disabled = selected === null;
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
  const next = (selected + 1) % STEPS;
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
    const next = (s + (e.key === 'ArrowRight' ? 1 : STEPS - 1)) % STEPS;
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
$('rowForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('row').blur();
  send({ op: 'row', text: $('row').value });
});

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
  if (e.target.matches('input:not([type="range"]), select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
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
  const step = engine.playing && seq ? Math.floor(Math.max(0, engine.position())) % STEPS : -1;
  if (step !== shownStep) {
    $('steps').children[shownStep]?.classList.remove('now');
    $('steps').children[step]?.classList.add('now');
    shownStep = step;
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
$('preset').addEventListener('change', () => { if ($('preset').value) send({ op: 'preset', name: $('preset').value }); $('preset').value = ''; });
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
buildSteps();
buildKeys();
try { if (localStorage.getItem(FOLDED) === '1') foldKeys(true); } catch { /* storage is closed to the page: the keyboard shows */ }
let wide = innerWidth >= 700;
addEventListener('resize', () => { if ((innerWidth >= 700) !== wide) { wide = innerWidth >= 700; buildKeys(); } });
engine.onChange();             // a page just loaded cannot sound yet, whatever the one before it told the server
connect();
requestAnimationFrame(frame);
