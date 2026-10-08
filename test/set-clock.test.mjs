// The rule behind the set timer in the header: when a set starts, what keeps it going and what ends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceSet, SET_GAP_MS } from '../apps/server/lib/set-clock.mjs';

const MIN = 60 * 1000, T0 = 1_700_000_000_000;

test('no set until music is on air; the first music since the server started begins one', () => {
  assert.equal(advanceSet(null, false, T0), null);
  assert.deepEqual(advanceSet(null, true, T0), { start: T0, last: T0 });
});

test('music keeps the start and moves the last time it was heard', () => {
  let set = advanceSet(null, true, T0);
  set = advanceSet(set, true, T0 + 5 * MIN);
  assert.deepEqual(set, { start: T0, last: T0 + 5 * MIN });
});

test('a silence shorter than 30 minutes is part of the set', () => {
  let set = advanceSet(null, true, T0);
  set = advanceSet(set, false, T0 + 29 * MIN);
  assert.deepEqual(set, { start: T0, last: T0 });
  set = advanceSet(set, true, T0 + SET_GAP_MS - 1);
  assert.equal(set.start, T0);
});

test('30 minutes of silence end the set, with or without anyone asking in between', () => {
  const set = advanceSet(null, true, T0);
  assert.equal(advanceSet(set, false, T0 + SET_GAP_MS), null);
  assert.equal(advanceSet(advanceSet(set, false, T0 + 10 * MIN), false, T0 + 40 * MIN), null);
});

test('music after such a silence starts a new set at that moment', () => {
  const set = advanceSet(null, true, T0);
  const later = T0 + 45 * MIN;
  assert.deepEqual(advanceSet(set, true, later), { start: later, last: later });
});

test('the silence is counted from the last music, not from the start of the set', () => {
  let set = advanceSet(null, true, T0);
  for (let m = 1; m <= 120; m++) set = advanceSet(set, true, T0 + m * MIN); // a two hour set
  assert.equal(advanceSet(set, false, T0 + 140 * MIN).start, T0);
  assert.equal(advanceSet(set, false, T0 + 150 * MIN), null);
});

test('the set passed in is not changed, and the gap can be given', () => {
  const set = Object.freeze({ start: T0, last: T0 });
  assert.deepEqual(advanceSet(set, true, T0 + MIN), { start: T0, last: T0 + MIN });
  assert.equal(advanceSet(set, false, T0 + MIN, MIN), null);
});
