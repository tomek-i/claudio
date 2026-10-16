// Sequences of one, two or four bars (lib/seq.mjs) and the piano roll's edits (lib/roll.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, emptySeq, normalizeSeq, applySeqOp, rowText, seqText, notesInWindow, tokens } from '../lib/seq.mjs';
import { ROWS, rollTop, ownerOf, pressCell, dragLength, removeNote, velocityAt } from '../lib/roll.mjs';
import { lanesOf } from '../lib/banner.mjs';

const row = (text, seq = emptySeq()) => applySeqOp(seq, { op: 'row', text });
const TWO = 'C2 . C3 . | Eb2 . . . | . . . . | . . . . || G2 - - - | . . . . | . . . . | Bb2 . . C3';

test('a sequence saved before there were bars is one bar; bars are 1, 2 or 4', () => {
  const old = normalizeSeq({ bpm: 100, gate: 0.5, swing: 0, steps: Array(16).fill(null) });
  assert.equal(old.bars, 1);
  assert.equal(old.steps.length, 16);
  assert.equal(normalizeSeq({ ...emptySeq(), bars: 3 }).bars, 1, 'three bars is not a length');
  assert.throws(() => applySeqOp(emptySeq(), { op: 'seqparam', key: 'bars', value: 3 }), /1, 2, 4 bars/);
});

test('longer repeats the bars there are, shorter cuts the end, and a long row sets the length', () => {
  const one = row('C2 . C3 . | Eb2 . . . | . . . . | . . . .');
  const two = applySeqOp(one, { op: 'seqparam', key: 'bars', value: 2 });
  assert.equal(two.steps.length, 32);
  assert.deepEqual(two.steps[16], one.steps[0], 'bar 2 is bar 1 again');
  const four = applySeqOp(two, { op: 'seqparam', key: 'bars', value: 4 });
  assert.deepEqual(tokens(four).slice(48), tokens(one));
  assert.deepEqual(applySeqOp(four, { op: 'seqparam', key: 'bars', value: 1 }).steps, one.steps);
  // a row of 32 steps makes it two bars; a row of 16 in a two-bar sequence is repeated
  const typed = row(TWO);
  assert.equal(typed.bars, 2);
  assert.equal(rowText(typed), TWO);
  assert.equal(seqText(typed).split('\n').length, 3, 'a line per bar');
  assert.match(seqText(typed), /2 bars/);
  assert.deepEqual(tokens(row('C3 . . .', typed)).slice(16, 20), ['C3', '.', '.', '.']);
  assert.throws(() => row(Array(24).fill('.').join(' ')), /a row has 16 steps/);
  // a tie runs across the bar line
  const tied = row('. . . . | . . . . | . . . . | . . . C3 || - - . . | . . . . | . . . . | . . . .');
  assert.equal(tied.steps[15].len, 3);
});

test('two bars play in turn, then again', () => {
  const seq = row(TWO);
  const first = notesInWindow(seq, 0, 32).map((n) => [n.pos, n.note]);
  assert.deepEqual(first, [[0, 36], [2, 48], [4, 39], [16, 43], [28, 46], [31, 48]]);
  assert.deepEqual(notesInWindow(seq, 32, 36).map((n) => n.pos), [32, 34], 'the second time round starts at step 32');
  assert.equal(notesInWindow(seq, 32, 64, { lastLoop: 0 }).length, 0);
});

test('the roll: what a press does on an empty cell, on a chord, on a note; dragging; removing; velocity', () => {
  const seq = row(TWO);
  // an empty cell: a new note of one step
  assert.deepEqual(pressCell(seq, 1, 50), { step: 1, held: false, op: { op: 'note', step: 1, notes: [50], len: 1, vel: 0.8 } });
  // a cell on a step where a chord starts: added to it
  assert.deepEqual(pressCell(seq, 0, 40).op, { op: 'note', step: 0, notes: [36, 40] });
  // a note, where it starts or where it is held: taken hold of
  assert.deepEqual(pressCell(seq, 18, 43), { step: 16, held: true, op: null });
  assert.equal(ownerOf(seq, 20, 43), -1, 'past its end');
  // a drag sets the length, and stops at the next note
  const longer = applySeqOp(seq, dragLength(seq, 4, 9));
  assert.equal(longer.steps[4].len, 6);
  assert.equal(applySeqOp(seq, dragLength(seq, 4, 30)).steps[4].len, 12, 'held up to the G2 at step 17');
  assert.equal(applySeqOp(seq, dragLength(seq, 0, -5)).steps[0].len, 1);
  // let go on it: removed (a chord keeps its other notes)
  const chord = applySeqOp(seq, pressCell(seq, 0, 40).op);
  assert.deepEqual(applySeqOp(chord, removeNote(chord, 0, 36)).steps[0].notes, [40]);
  assert.equal(applySeqOp(seq, removeNote(seq, 4, 39)).steps[4], null);
  // a note added inside a held one cuts it there
  const cut = applySeqOp(seq, pressCell(seq, 18, 60).op);
  assert.equal(cut.steps[16].len, 2);
  assert.deepEqual(cut.steps[18].notes, [60]);
  // the lane: only where a note starts, from the bottom up
  assert.equal(velocityAt(seq, 1, 0.5), null);
  assert.equal(applySeqOp(seq, velocityAt(seq, 0, 0.75)).steps[0].vel, 0.25);
  assert.equal(velocityAt(seq, 0, 1.5).vel, 0.05);
});

test('the roll shows the notes in the middle, and the wheel moves it', () => {
  const seq = row(TWO);                                                 // C2 (36) to C3 (48)
  const top = rollTop(seq);
  assert.ok(top >= 48 && top - ROWS + 1 <= 36, `${top}: all of them in view`);
  assert.equal(rollTop(seq, 5), top + 5);
  assert.equal(rollTop(emptySeq()), 57 + ROWS / 2);
  assert.equal(rollTop(seq, 500), 127);
});

test('the banner shows the bar that is playing', () => {
  const seq = row(TWO);
  const lit = (bar) => lanesOf(seq, bar).flatMap((l) => l.cells).filter(Boolean).length;
  assert.equal(lanesOf(seq).every((l) => l.cells.length === STEPS), true);
  assert.notEqual(lit(0), lit(1));
});
