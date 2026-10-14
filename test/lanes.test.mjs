// The lanes of an automation take as the Automation tab shows and edits them (apps/web/public/ui/lane-model.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './webaudio-mock.mjs'; // lane-model → automation-core → engine.js
const M = await import('../apps/web/public/ui/lane-model.js');

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);
const takeOf = () => ({ version: 1, duration: 20, entries: [
  { at: 0, g: 'A.transport', k: 'ev', d: 'A', clear: 'transport', clearAt: 0, events: [{ t: 0.1, type: 'start', pos: 30 }] },
  { at: 2, g: 'A.filter', k: 'set', id: 'A.filter', v: 0.5 },
  { at: 4, g: 'A.filter', k: 'auto', id: 'A.filter', pts: [{ t: 5, v: 0.5 }, { t: 7, v: -0.5, shape: 'linear' }, { t: 9, v: 0, shape: 'linear' }] },
  { at: 8, g: 'A.filter', k: 'set', id: 'A.filter', v: 0.2 }, // cuts the path at 8
  { at: 6, g: 'A.key', k: 'key', d: 'A', shift: -2 },
  { at: 10, g: 'A.transport', k: 'ev', d: 'A', clear: null, clearAt: null, events: [{ t: 10.01, type: 'loop', loop: { start: 40, end: 42, beats: 4 } }] },
] });

test('lanes: which are curves, their names and their order', () => {
  assert.equal(M.isControlLane('A.filter'), true);
  assert.equal(M.isControlLane('xfader'), true);
  for (const g of ['A.transport', 'B.key', 'A.xf', 'C.fx', 'echo', 'pads']) assert.equal(M.isControlLane(g), false, g);
  assert.deepEqual(M.laneLabel('A.eq.low'), { deck: 'A', name: 'EQ low' });
  assert.deepEqual(M.laneLabel('xfader'), { deck: null, name: 'crossfader' });
  assert.deepEqual(['xfader', 'B.vol', 'A.filter', 'A.transport', 'pads', 'A.vol'].sort(M.laneSort), ['A.transport', 'A.vol', 'A.filter', 'B.vol', 'xfader', 'pads']);
});

test('a control lane is the curve the engine follows: sets ramp in 12 ms, paths bend, a later entry cuts a path', () => {
  const take = takeOf(), es = M.entriesOf(take, 'A.filter');
  const v0 = M.startValue('A.filter', { decks: { A: { filter: -0.25 } } });
  assert.equal(v0, -0.25, 'from the saved decks');
  const bps = M.curve(es, v0);
  near(M.valueAt(bps, 1), -0.25, 1e-9, 'before anything: the saved value');
  near(M.valueAt(bps, 2.006), 0.125, 1e-6, 'half way through the 12 ms of the set');
  near(M.valueAt(bps, 4.5), 0.5, 1e-9, 'the path holds until it starts');
  near(M.valueAt(bps, 6), 0, 1e-9, 'linear between its points');
  near(M.valueAt(bps, 7.5), -0.375, 1e-9);
  near(M.valueAt(bps, 8.012), 0.2, 1e-9, 'the set at 8 cut the path');
  near(M.valueAt(bps, 15), 0.2, 1e-9, 'and nothing of the path after it comes back');
  assert.equal(M.startValue('xfader', { master: { xfader: 0.3 } }), 0.3);
  assert.deepEqual(M.rangeOf('A.trim'), [-12, 12]);
  assert.deepEqual(M.rangeOf('A.filter', { 'A.filter': { range: [-1, 1] } }), [-1, 1]);
});

test('handles: drag a set and a path point (kept between its neighbours, the value in range), add one, remove them', () => {
  const take = takeOf(), hs = M.handlesOf(M.entriesOf(take, 'A.filter'));
  assert.deepEqual(hs.map((h) => [h.t, h.v]), [[2, 0.5], [5, 0.5], [7, -0.5], [9, 0], [8, 0.2]]);
  let h = M.moveHandle(take, hs[0], 3, 2, [-1, 1]);
  assert.deepEqual([h.t, h.v], [3, 1], 'value clamped to the range');
  h = M.moveHandle(take, hs[2], 20, -0.7, [-1, 1]);
  assert.equal(h.t, 8.999, 'a path point stays before the next one');
  h = M.moveHandle(take, M.handlesOf(M.entriesOf(take, 'A.filter'))[1], 3.5, 0.4, [-1, 1]);
  assert.equal(h.e.at, 3.5, 'the first point of a path moved earlier takes the path with it');
  const added = M.addPoint(take, 'A.filter', 12, 0.9, [-1, 1]);
  assert.deepEqual([added.e.k, added.e.at, added.e.v], ['set', 12, 0.9]);
  assert.ok(take.entries.every((e, i, a) => i === 0 || a[i - 1].at <= e.at), 'kept in time order');
  const path = take.entries.find((e) => e.k === 'auto');
  M.removeHandle(take, { e: path, p: 1 });
  assert.equal(path.pts.length, 2);
  M.removeHandle(take, { e: path, p: 0 });
  assert.equal(path.k, 'set', 'a path left with one point is a move to it');
  assert.equal(path.v, 0);
  M.removeHandle(take, { e: added.e, p: -1 });
  assert.ok(!take.entries.includes(added.e));
});

test('marks: what the other lanes show, moved as a whole', () => {
  const take = takeOf();
  const marks = M.marksOf(M.entriesOf(take, 'A.transport'));
  assert.deepEqual(marks.map((m) => [m.t, m.label]), [[0.1, '▶'], [10.01, 'loop 4']]);
  assert.deepEqual(M.marksOf(M.entriesOf(take, 'A.key')).map((m) => m.label), ['key -2']);
  const loop = take.entries.find((e) => e.events?.[0]?.type === 'loop');
  const moved = M.shiftWhole(take, loop, 2);
  assert.equal(moved.at, 12);
  assert.equal(moved.events[0].t, 12.01, 'its events move with it');
  const first = take.entries.find((e) => e.g === 'A.transport');
  const back = M.shiftWhole(take, first, -5);
  assert.equal(back.at, 0, 'not before 0:00');
  M.removeEntry(take, moved);
  assert.equal(M.entriesOf(take, 'A.transport').length, 1);
  assert.deepEqual(M.marksOf([{ at: 3, k: 'load', d: 'B', track: 'x1' }], (id) => `T${id}`).map((m) => m.label), ['load Tx1']);
});
