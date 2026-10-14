// The decks and the mixer of a saved set (lib/sets.mjs): what is kept of the engine's state, and the commands that
// put it back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, restoreSteps, normalise } from '../apps/server/lib/sets.mjs';

const state = {
  master: { volume: 0.8, xfader: 0.25 },
  decks: {
    A: { trackId: 'aaa', title: 'One', artist: 'X', playing: true, position: 81.23456, cue: 12.5, rate: 1.02, keylock: true, keyShift: -1,
      vol: 1.2, trim: -3, filter: 0.3, echo: 0.1, eq: { low: -0.5, mid: 0, high: 0.2 }, stems: { loaded: true, vocals: 0, drums: 1, bass: 1, other: 1 },
      xfAssign: 'left', fx: { type: 'reverb', amount: 0.4 }, loop: { start: 80, end: 82, beats: 4 } },
    B: { trackId: 'bbb', title: 'Two', position: 0, cue: 0, rate: 1, keylock: false, keyShift: 0, vol: 1, trim: 0, filter: 0, echo: 0,
      eq: { low: 0, mid: 0, high: 0 }, stems: { loaded: false, vocals: 1, drums: 1, bass: 1, other: 1 }, xfAssign: 'right', fx: { type: 'none', amount: 0 }, loop: null },
    C: { trackId: null },
  },
};

test('a snapshot keeps the loaded decks, the master and the crossfader, and whether Auto-DJ is on', () => {
  const s = snapshotOf(state, { autoDJ: false });
  assert.deepEqual(Object.keys(s.decks), ['A', 'B'], 'an empty deck is not kept');
  assert.equal(s.autoDJ, false);
  assert.deepEqual(s.master, { volume: 0.8, xfader: 0.25 });
  assert.equal(s.decks.A.position, 81.235);
  assert.deepEqual(s.decks.A.loop, { start: 80, end: 82, beats: 4 });
  assert.equal(s.decks.A.stems.vocals, 0);
  assert.equal('loaded' in s.decks.A.stems, false);
  assert.equal(s.decks.B.keylock, false);
  assert.ok(normalise({ name: 'x', snapshot: s }).snapshot, 'kept by the set file');
});

test('restoring: load at the cue, every changed control, the loop, the position, then the mixer', () => {
  const { steps, missing } = restoreSteps(snapshotOf(state));
  assert.deepEqual(missing, []);
  const A = steps.filter((s) => s.args.deck === 'A').map((s) => [s.cmd, s.args]);
  assert.deepEqual(A, [
    ['load', { deck: 'A', track: 'aaa', cue: 12.5, force: true }],
    ['keylock', { deck: 'A', on: 'on' }],
    ['tempo', { deck: 'A', value: '2.000%' }],
    ['key', { deck: 'A', semitones: -1 }],
    ['eq', { deck: 'A', band: 'low', value: -0.5 }],
    ['eq', { deck: 'A', band: 'high', value: 0.2 }],
    ['filter', { deck: 'A', value: 0.3 }],
    ['trim', { deck: 'A', value: -3 }],
    ['vol', { deck: 'A', value: 1.2 }],
    ['echo', { deck: 'A', value: 0.1 }],
    ['stem', { deck: 'A', stem: 'vocals', value: 0 }],
    ['xfassign', { deck: 'A', side: 'left' }],
    ['deckfx', { deck: 'A', type: 'reverb', amount: 0.4 }],
    ['seek', { deck: 'A', position: 80 }],
    ['loop', { deck: 'A', beats: 4 }],
    ['seek', { deck: 'A', position: 81.235 }],
  ]);
  assert.ok(steps.find((s) => s.cmd === 'stem').optional, 'a deck without stems does not fail the set');
  const B = steps.filter((s) => s.args.deck === 'B').map((s) => s.cmd);
  assert.deepEqual(B, ['load', 'keylock', 'xfassign', 'seek'], 'controls at their default are left alone');
  assert.deepEqual(steps.slice(-2), [{ cmd: 'master', args: { value: 0.8 } }, { cmd: 'xfade', args: { value: 0.25 } }]);
});

test('a deck whose track is no longer in the library is left out and reported', () => {
  const { steps, missing } = restoreSteps(snapshotOf(state), (id) => id !== 'bbb');
  assert.deepEqual(missing, [{ deck: 'B', id: 'bbb', title: 'Two', artist: null }]);
  assert.ok(!steps.some((s) => s.args.deck === 'B'));
});
