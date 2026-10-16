// The piano roll's sums (the page draws it, public/app.js): which notes it shows, and what a click or a drag on it
// does to the sequence, as the edit to send (applySeqOp's 'note'). Nothing here touches a page.
import { NOTE_MAX, NOTE_MIN } from './notes.mjs';
import { VEL } from './seq.mjs';

export const ROWS = 18;                    // notes shown at once: an octave and a half

// The highest note shown: the sequence's notes in the middle, moved by `shift` semitones (the mouse wheel). With
// no notes, around C3 to F4.
export function rollTop(seq, shift = 0) {
  const all = seq.steps.flatMap((s) => s?.notes || []);
  const mid = all.length ? Math.round((Math.max(...all) + Math.min(...all)) / 2) : 57;
  return Math.min(NOTE_MAX, Math.max(NOTE_MIN + ROWS - 1, mid + Math.floor(ROWS / 2) + shift));
}

// the step whose note `note` sounds at step `s` (where it starts, or a step it is held over), or -1
export function ownerOf(seq, s, note) {
  for (let i = s; i >= 0; i--) {
    const step = seq.steps[i];
    if (!step) continue;
    return i + step.len > s && step.notes.includes(note) ? i : -1;
  }
  return -1;
}

// A press on the cell of `note` at step `s`: the edit it makes, and what a drag from there goes on to change.
//   on a note: it is taken hold of (a drag sets its length; let go where it was taken, it is removed)
//   on an empty cell: the note is added, to the chord that starts there or as a new one-step note
export function pressCell(seq, s, note) {
  const owner = ownerOf(seq, s, note);
  if (owner >= 0) return { step: owner, held: true, op: null };
  const there = seq.steps[s];
  const notes = there ? [...there.notes, note].sort((a, b) => a - b) : [note];
  return { step: s, held: false, op: { op: 'note', step: s, notes, ...(there ? {} : { len: 1, vel: VEL.normal }) } };
}

// a drag that has reached step `to`: the length of the note at `step`
export const dragLength = (seq, step, to) => ({ op: 'note', step, len: Math.max(1, Math.min(seq.steps.length - step, to - step + 1)) });

// let go on the note it was taken hold of, without dragging: that pitch goes from the chord
export function removeNote(seq, step, note) {
  return { op: 'note', step, notes: (seq.steps[step]?.notes || []).filter((n) => n !== note) };
}

// the velocity lane: a press or a drag at height `y` (0 at the top, 1 at the bottom) over step `s`, or null when
// there is no note starting there
export function velocityAt(seq, s, y) {
  if (!seq.steps[s]) return null;
  return { op: 'note', step: s, vel: Math.round(Math.min(1, Math.max(0.05, 1 - y)) * 100) / 100 };
}
