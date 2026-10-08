// The editor of the selected clip: a step grid for a drum clip, a piano roll for a synth clip. Both show the
// clip's content (`len` bars); the arrangement is where it is repeated.
import { STEPS_PER_BAR } from '/lib/project.mjs';
import { VOICES, LEVELS, LEVEL_NAMES, levelOf } from '/lib/kit.mjs';
import { LOW, HIGH, formatNotes, isBlackKey, noteName } from '/lib/notes.mjs';
import { $, el, ui, onRender, render, select, selected, send, commit, sendLatest, newGesture, setValue, engine } from './link.js';
import { colourOf, duplicate } from './arrange.js';

const STEP_W = 22;     // pixels to the sixteenth in the piano roll
const ROW_H = 14;      // and to the semitone
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

$('roll').style.setProperty('--step', `${STEP_W}px`);
$('roll').style.setProperty('--row', `${ROW_H}px`);

// ---- the step grid

let builtSteps = '';
function buildSteps(clip) {
  const steps = clip.len * STEPS_PER_BAR;
  $('steps').replaceChildren(...VOICES.map((voice) => {
    const row = el('div', { className: 'row' },
      el('div', { className: 'strip' }, el('button', { className: 'tap', title: `Hear the ${voice.name.toLowerCase()}` }, voice.name)),
      el('div', { className: 'cells' }, ...Array.from({ length: steps }, (_, s) => {
        const cell = el('button', { className: `cell${s % 4 ? '' : ' beat'}` }, el('i'));
        cell.dataset.s = s;
        return cell;
      })));
    row.dataset.voice = voice.id;
    return row;
  }));
}

function paintSteps(clip) {
  const key = `${clip.id} ${clip.len}`;
  if (key !== builtSteps) { builtSteps = key; buildSteps(clip); }
  [...$('steps').children].forEach((row, i) => {
    const vels = clip.rows[VOICES[i].id];
    row.querySelectorAll('.cell').forEach((cell, s) => {
      const vel = vels[s];
      cell.classList.toggle('on', vel > 0);
      cell.classList.toggle('accent', levelOf(vel) === 'accent');
      cell.style.setProperty('--v', vel);
      const label = `${VOICES[i].name}, bar ${Math.floor(s / STEPS_PER_BAR) + 1} step ${(s % STEPS_PER_BAR) + 1}${vel > 0 ? `, ${levelOf(vel)}` : ''}`;
      if (cell.title !== label) { cell.title = label; cell.setAttribute('aria-label', label); }
      cell.setAttribute('aria-pressed', vel > 0);
    });
  });
}

const voiceOf = (cell) => cell.closest('.row').dataset.voice;
const velAt = (cell) => selected().clip.rows[voiceOf(cell)][cell.dataset.s];
const stepOp = (cell, vel, gesture) => ({ op: 'clip.step', clip: ui.clip, voice: voiceOf(cell), step: Number(cell.dataset.s), vel, gesture });

function cycleLevel(cell) {
  const vel = velAt(cell);
  send(stepOp(cell, LEVELS[vel > 0 ? LEVEL_NAMES[(LEVEL_NAMES.indexOf(levelOf(vel)) + 1) % LEVEL_NAMES.length] : 'normal']));
}

let paint = null;
function paintCell(cell) {
  if (!cell || cell.closest('.row') !== paint.row || paint.done.has(cell)) return;
  paint.done.add(cell);
  if ((velAt(cell) > 0) === (paint.vel > 0)) return;
  if (paint.vel > 0) engine.preview(selected().track, voiceOf(cell));
  send(stepOp(cell, paint.vel, paint.gesture));
}

$('steps').addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || e.button !== 0) return;
  e.preventDefault();
  cell.focus();
  if (e.shiftKey) return cycleLevel(cell);
  $('steps').setPointerCapture(e.pointerId);
  paint = { row: cell.closest('.row'), vel: velAt(cell) > 0 ? 0 : LEVELS.normal, done: new Set(), gesture: newGesture() };
  paintCell(cell);
});
$('steps').addEventListener('pointermove', (e) => { if (paint) paintCell(document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell')); });
for (const type of ['pointerup', 'pointercancel']) $('steps').addEventListener(type, () => { paint = null; });

// the same from the keyboard, on the focused step: Enter writes, V changes the level, the arrows move
$('steps').addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || e.ctrlKey || e.metaKey) return;
  const s = Number(cell.dataset.s);
  if (e.key === 'Enter') send(stepOp(cell, velAt(cell) > 0 ? 0 : LEVELS.normal));
  else if (e.key === 'v' || e.key === 'V') cycleLevel(cell);
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') (e.key === 'ArrowRight' ? cell.nextElementSibling : cell.previousElementSibling)?.focus();
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    cell.closest('.row')[e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling']?.querySelectorAll('.cell')[s]?.focus();
  } else return;
  e.preventDefault();
  e.stopPropagation();
});

$('steps').addEventListener('click', (e) => {
  const tap = e.target.closest('.tap');
  if (tap) engine.preview(selected().track, tap.closest('.row').dataset.voice);
});

// ---- the piano roll

// the keys and the rows behind the notes are the same for every clip
const pitches = Array.from({ length: HIGH - LOW + 1 }, (_, i) => HIGH - i);
$('keys').append(...pitches.map((pitch) => {
  const key = el('button', { className: `key${isBlackKey(pitch) ? ' black' : ''}`, title: `Hear ${noteName(pitch)}` }, noteName(pitch));
  key.dataset.pitch = pitch;
  return key;
}));
$('sheet').prepend(...pitches.map((pitch) => el('div', { className: `rowbg${isBlackKey(pitch) ? ' black' : ''}${pitch % 12 ? '' : ' c'}` })));
$('sheet').style.setProperty('--rows', pitches.length);

let lastLen = 2;          // the length a new note gets: that of the note last touched
let shownClip = null;

const noteLabel = (n) => `${noteName(n.pitch)}, starts at ${n.start}, ${n.len} long, velocity ${Math.round(n.vel * 127)}`;

function paintRoll(clip) {
  const sheet = $('sheet');
  sheet.style.setProperty('--steps', clip.len * STEPS_PER_BAR);
  const have = new Map([...sheet.querySelectorAll('.note')].map((node) => [node.dataset.note, node]));
  for (const n of clip.notes) {
    let node = have.get(n.id);
    if (!node) {
      node = el('button', { className: 'note' }, el('i', { className: 'grip' }));
      node.dataset.note = n.id;
      sheet.append(node);
    }
    have.delete(n.id);
    node.style.left = `${n.start * STEP_W}px`;
    node.style.top = `${(HIGH - n.pitch) * ROW_H}px`;
    node.style.width = `${Math.max(5, n.len * STEP_W - 1)}px`;
    node.style.setProperty('--v', n.vel);
    const label = noteLabel(n);
    if (node.title !== label) { node.title = label; node.setAttribute('aria-label', label); }
  }
  for (const node of have.values()) node.remove();
  setValue($('notesText'), formatNotes(clip.notes));
  if (shownClip !== clip.id) {                       // a clip newly opened: scroll to where its notes are
    shownClip = clip.id;
    const middle = clip.notes.length ? (Math.max(...clip.notes.map((n) => n.pitch)) + Math.min(...clip.notes.map((n) => n.pitch))) / 2 : 60;
    $('roll').scrollTop = (HIGH - middle) * ROW_H - $('roll').clientHeight / 2;
    $('roll').scrollLeft = 0;
  }
}

const noteOf = (node) => selected().clip.notes.find((n) => n.id === node.dataset.note);
const noteOp = (id, change, gesture) => ({ op: 'note.set', clip: ui.clip, note: id, ...change, gesture });
const taken = (clip, pitch, start, except) => clip.notes.some((n) => n.id !== except && n.pitch === pitch && n.start === start);
const focusNote = (id) => $('sheet').querySelector(`[data-note="${id}"]`)?.focus();

async function addNote(pitch, start) {
  const { track, clip } = selected();
  if (taken(clip, pitch, start)) return;
  engine.preview(track, pitch);
  const state = await send({ op: 'note.add', clip: clip.id, pitch, start, len: Math.min(lastLen, clip.len * STEPS_PER_BAR - start), vel: 0.8 });
  if (state) focusNote(`n${state.project.ids.n}`);
}

function removeNote(node) {
  const next = node.nextElementSibling?.classList.contains('note') ? node.nextElementSibling : node.previousElementSibling;
  if (next?.classList.contains('note')) next.focus(); else $('notesText').focus();
  send({ op: 'note.del', clip: ui.clip, note: node.dataset.note });
}

let drag = null;
$('sheet').addEventListener('pointerdown', (e) => {
  const found = selected();
  if (!found || e.button !== 0) return;
  e.preventDefault();
  const node = e.target.closest('.note');
  if (!node) {
    const box = $('sheet').getBoundingClientRect();
    return addNote(clamp(HIGH - Math.floor((e.clientY - box.top) / ROW_H), LOW, HIGH), clamp(Math.floor((e.clientX - box.left) / STEP_W), 0, found.clip.len * STEPS_PER_BAR - 1));
  }
  const n = noteOf(node);
  node.focus();
  $('sheet').setPointerCapture(e.pointerId);
  lastLen = n.len;
  engine.preview(found.track, n.pitch);
  drag = { kind: e.target.closest('.grip') ? 'size' : 'move', id: n.id, x: e.clientX, y: e.clientY, start: n.start, pitch: n.pitch, len: n.len, heard: n.pitch, gesture: newGesture() };
});

$('sheet').addEventListener('pointermove', (e) => {
  const found = drag && selected();
  const n = found?.clip.notes.find((other) => other.id === drag.id);
  if (!n) return;
  const steps = found.clip.len * STEPS_PER_BAR;
  const by = Math.round((e.clientX - drag.x) / STEP_W);
  if (drag.kind === 'size') {
    const len = clamp(drag.len + by, 1, steps - n.start);
    lastLen = len;
    if (len !== n.len) sendLatest('note', noteOp(n.id, { len }, drag.gesture));
    return;
  }
  const start = clamp(drag.start + by, 0, Math.max(0, steps - n.len));   // the whole note stays inside the content
  const pitch = clamp(drag.pitch - Math.round((e.clientY - drag.y) / ROW_H), LOW, HIGH);
  if ((start === n.start && pitch === n.pitch) || taken(found.clip, pitch, start, n.id)) return;
  if (pitch !== drag.heard) { drag.heard = pitch; engine.preview(found.track, pitch); }
  sendLatest('note', noteOp(n.id, { start, pitch }, drag.gesture));
});
for (const type of ['pointerup', 'pointercancel']) $('sheet').addEventListener(type, () => { drag = null; });

$('sheet').addEventListener('dblclick', (e) => { const node = e.target.closest('.note'); if (node) removeNote(node); });
$('sheet').addEventListener('contextmenu', (e) => {
  const node = e.target.closest('.note');
  if (!node) return;
  e.preventDefault();
  removeNote(node);
});

// the same from the keyboard, on the focused note
$('sheet').addEventListener('keydown', (e) => {
  const node = e.target.closest('.note');
  const found = node && selected();
  if (!found || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = noteOf(node);
  const steps = found.clip.len * STEPS_PER_BAR;
  const side = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  const up = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
  let change = null;
  if (side && e.shiftKey) change = { len: clamp(n.len + side, 1, steps - n.start) };
  else if (side) change = { start: clamp(n.start + side, 0, Math.max(0, steps - n.len)) };
  else if (up) change = { pitch: clamp(n.pitch + up * (e.shiftKey ? 12 : 1), LOW, HIGH) };
  else if (e.key === '[' || e.key === ']') change = { vel: clamp(n.vel + (e.key === ']' ? 0.1 : -0.1), 0.1, 1) };
  else if (e.key === 'Delete' || e.key === 'Backspace') removeNote(node);
  else return;
  e.preventDefault();
  e.stopPropagation();
  if (!change || taken(found.clip, change.pitch ?? n.pitch, change.start ?? n.start, n.id)) return;
  if (change.len) lastLen = change.len;
  if (change.pitch) engine.preview(found.track, change.pitch);
  send(noteOp(n.id, change));
});

$('keys').addEventListener('click', (e) => {
  const key = e.target.closest('.key');
  if (key && selected()) engine.preview(selected().track, Number(key.dataset.pitch));
});

// the notes as text: what is written replaces the clip's notes (the line is put back in order when it is taken)
$('notesForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (await send({ op: 'clip.notes', clip: ui.clip, notes: $('notesText').value })) { $('notesText').stale = true; render(); }
});

// ---- the bar above the editor

$('clipLen').addEventListener('change', () => commit($('clipLen'), { op: 'clip.len', clip: ui.clip, len: Number($('clipLen').value) }));
$('clipDup').addEventListener('click', () => duplicate(ui.clip));
$('clipClear').addEventListener('click', () => send({ op: 'clip.clear', clip: ui.clip }));
$('clipDel').addEventListener('click', () => send({ op: 'clip.del', clip: ui.clip }));

onRender(() => {
  const found = selected();
  if (!found && ui.clip) return select(null);        // the selected clip is gone (deleted, or undone)
  const drums = found?.track.kind === 'drums';
  $('noClip').hidden = !!found;
  $('steps').hidden = $('drumHint').hidden = !found || !drums;
  $('rollWrap').hidden = $('rollHint').hidden = !found || drums;
  $('clipLenField').hidden = !found;
  for (const id of ['clipDup', 'clipClear', 'clipDel']) $(id).disabled = !found;
  if (!found) { $('clipTitle').textContent = 'Clip'; shownClip = null; return; }
  const { track, clip } = found;
  $('clipTitle').textContent = `${clip.id} · ${track.name} · ${clip.bars === 1 ? `bar ${clip.bar + 1}` : `bars ${clip.bar + 1}–${clip.bar + clip.bars}`}`;
  setValue($('clipLen'), clip.len);
  $(drums ? 'steps' : 'sheet').style.setProperty('--c', colourOf(track));
  if (drums) paintSteps(clip); else paintRoll(clip);
});

// ---- the playhead inside the clip: `pos` is the song position in sixteenths, or −1 when nothing plays

let nowStep = -1;
export function editorFrame(pos) {
  const found = selected();
  let local = -1;
  if (found && pos >= 0) {
    const start = found.clip.bar * STEPS_PER_BAR;
    if (pos >= start && pos < start + found.clip.bars * STEPS_PER_BAR) local = (pos - start) % (found.clip.len * STEPS_PER_BAR);
  }
  const roll = found?.track.kind === 'synth' && local >= 0;
  $('rollHead').hidden = !roll;
  if (roll) $('rollHead').style.transform = `translateX(${local * STEP_W}px)`;
  const step = found?.track.kind === 'drums' ? Math.floor(local) : -1;
  if (step === nowStep) return;
  for (const row of $('steps').children) {
    const cells = row.lastElementChild.children;
    cells[nowStep]?.classList.remove('now');
    cells[step]?.classList.add('now');
  }
  nowStep = step;
}
