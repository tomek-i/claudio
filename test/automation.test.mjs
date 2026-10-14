// Automation (apps/web/public/automation-core.js): what the engine does is recorded on the take's own clock and played
// back on another mixer as it was done. Runs the real engine on the Web Audio mock (test/webaudio-mock.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, wav, server, SR } from './webaudio-mock.mjs';
const { Mixer } = await import('../apps/web/public/engine.js');
const { AutomationCore, laneOf, shiftEntry, mergeTake } = await import('../apps/web/public/automation-core.js');

const BPM = 128;
function addTrack(id, { seconds = 90, freq = 220 } = {}) {
  const t = {
    id, title: `Track ${id}`, artist: 'Test', bpm: BPM, camelot: '8A', key: 'Am', energy: 7, firstBeat: 0.05, mixIn: 0.05,
    mixOut: seconds - 20, duration: seconds, gainDb: 0, breakdowns: [], waveform: { peaks: [1], lows: [1] }, url: `/audio/${id}`,
  };
  server.tracks.set(id, t);
  server.files.set(`/audio/${id}`, wav(seconds, (x) => 0.4 * Math.sin(2 * Math.PI * freq * x)));
  return t;
}
async function rig(tracks) {
  const m = new Mixer();
  await m.ctx.resume(); await m.init();
  for (const [d, t] of Object.entries(tracks)) await m.decks[d].load(t);
  return m;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
// what is compared between the recording and its replay
function look(m) {
  const t = m.ctx.currentTime, out = { xfader: m.xfader.value(t), master: m.master.value(t) };
  for (const n of ['A', 'B']) {
    const d = m.decks[n], lp = d.loopAt(t);
    Object.assign(out, { [`${n}.pos`]: d.position(t), [`${n}.playing`]: d.playing, [`${n}.rate`]: d.rate, [`${n}.loop`]: lp ? lp.beats : 0,
      [`${n}.low`]: d.eq.low.value(t), [`${n}.filter`]: d.filter.value(t), [`${n}.vol`]: d.vol.value(t), [`${n}.keyShift`]: d.keyShift, [`${n}.fx`]: d.fx.type });
  }
  return out;
}
function same(a, b, msg) {
  for (const k of Object.keys(a)) {
    if (typeof a[k] === 'number') near(b[k], a[k], k.endsWith('.pos') ? 0.0005 : 0.005, `${msg} ${k}`);
    else assert.equal(b[k], a[k], `${msg} ${k}`);
  }
}
// let the audio clock run to `until`, one render quantum at a time, the player ticking as the page's worker does
const Q = 128 / SR;
function run(core, m, until) { while (m.ctx.currentTime < until - 1e-9) { core.tick(); render(Q); } }
const startOf = (m) => m.ctx.currentTime + 96 * Q; // 0:00 of a replay: 0.256 s ahead, on a quantum

test('lanes, and moving an entry between clocks', () => {
  assert.equal(laneOf({ k: 'set', id: 'A.eq.low' }), 'A.eq.low');
  assert.equal(laneOf({ k: 'ev', d: 'B' }), 'B.transport');
  assert.equal(laneOf({ k: 'param', id: 'A.cut' }), 'A.transport');
  assert.equal(laneOf({ k: 'param', id: 'echo.time' }), 'echo');
  assert.equal(laneOf({ k: 'note', pad: 2 }), 'pads');
  const ev = { k: 'ev', d: 'A', clear: 'transport', clearAt: 10, events: [{ t: 10.5, type: 'start', pos: 3 }, { t: 11, type: 'curve', pts: [{ t: 11, r: 1 }, { t: 12, r: 0 }] }] };
  assert.deepEqual(shiftEntry(ev, -10), { ...ev, clearAt: 0, events: [{ t: 0.5, type: 'start', pos: 3 }, { t: 1, type: 'curve', pts: [{ t: 1, r: 1 }, { t: 2, r: 0 }] }] });
  assert.deepEqual(shiftEntry({ k: 'param', id: 'echo.time', m: 'cancelScheduledValues', a: [5] }, 2).a, [7]);
  assert.deepEqual(shiftEntry({ k: 'param', id: 'echo.time', m: 'setValueAtTime', a: [0.3, 5] }, 2).a, [0.3, 7]);
});

test('overdub: a touched lane is replaced from the first touch on, the others are kept', () => {
  const old = { duration: 10, entries: [
    { at: 1, g: 'A.filter', k: 'set', id: 'A.filter', v: 0.1 }, { at: 5, g: 'A.filter', k: 'set', id: 'A.filter', v: 0.5 },
    { at: 6, g: 'A.vol', k: 'set', id: 'A.vol', v: 0.8 } ] };
  const fresh = [{ at: 4, g: 'A.filter', k: 'set', id: 'A.filter', v: -0.3 }];
  const t = mergeTake(old, fresh, new Map([['A.filter', 4]]), 12);
  assert.deepEqual(t.entries.map((e) => [e.at, e.g, e.v]), [[1, 'A.filter', 0.1], [4, 'A.filter', -0.3], [6, 'A.vol', 0.8]]);
  assert.equal(t.duration, 12);
});

test('a recorded performance plays back the same on another mixer: play, knobs, paths, loops, seek, tempo, key, FX', async () => {
  const t1 = addTrack('auto1'), t2 = addTrack('auto2', { freq: 330 });
  const M1 = await rig({ A: t1, B: t2 });
  const rec = new AutomationCore(M1);
  rec.record();
  const T0 = M1.ctx.currentTime;
  // what a DJ (or Claude, or Auto-DJ) does, at different moments
  M1.decks.A.play(); render(1);
  M1.decks.A.eq.low.set(-0.5); render(0.5);
  M1.decks.A.filter.automate([{ t: M1.ctx.currentTime + 0.1, v: 0 }, { t: M1.ctx.currentTime + 1.1, v: 0.6 }]); render(0.4);
  M1.decks.A.setLoop(4); render(1.2);
  M1.xfader.set(0.7); M1.decks.B.play(); render(0.8);
  M1.decks.A.setLoop(0); M1.decks.A.seek(20); render(0.6);
  M1.decks.A.setRate(1.02); M1.decks.B.setKeyShift(-2); M1.decks.B.fx.set('reverb', 0.4); render(0.7);
  M1.decks.B.vol.set(0.6); M1.decks.A.pause(); render(0.5);
  const dur = M1.ctx.currentTime - T0;
  const want = look(M1);
  const take = rec.stop();
  assert.ok(take.entries.length > 10, `entries: ${take.entries.length}`);
  near(take.duration, dur, 1e-3, 'duration');
  assert.ok(take.entries.every((e) => e.at >= 0 && e.at <= take.duration + 1e-3 && e.g), 'every entry is on the take clock, in a lane');
  const lanes = new Set(take.entries.map((e) => e.g));
  for (const g of ['A.transport', 'B.transport', 'A.eq.low', 'A.filter', 'xfader', 'B.key', 'B.fx', 'B.vol']) assert.ok(lanes.has(g), `lane ${g}`);
  const viaJson = JSON.parse(JSON.stringify(take)); // as it is saved and read back

  // another mixer, the same decks as at 0:00 (what opening the set does): the take plays them the same
  const M2 = await rig({ A: t1, B: t2 });
  const player = new AutomationCore(M2);
  const P0 = startOf(M2);
  player.play(viaJson, { start: P0 });
  run(player, M2, P0 + dur);
  same(want, look(M2), 'replay:');
  run(player, M2, P0 + dur + 0.2);
  assert.equal(player.tick(), true, 'the take has run out');
  assert.equal(M2.tap, null, 'playing does not record');
});

test('what plays at the moment recording starts starts at 0:00 on playback, where it was', async () => {
  const t1 = addTrack('auto3');
  const M1 = await rig({ A: t1 });
  M1.decks.A.seek(30); M1.decks.A.play(); render(2);
  const rec = new AutomationCore(M1);
  rec.record(); const T0 = M1.ctx.currentTime;
  const posAt0 = M1.decks.A.position(T0);
  render(1.5);
  M1.decks.A.filter.set(-0.4); render(0.5);
  const want = look(M1), dur = M1.ctx.currentTime - T0;
  const take = rec.stop();
  assert.deepEqual(take.entries[0].events.map((e) => e.type), ['start']);
  // the set's decks come back paused at the saved position
  const M2 = await rig({ A: t1 });
  M2.decks.A.seek(posAt0);
  const player = new AutomationCore(M2), P0 = startOf(M2);
  player.play(take, { start: P0 });
  run(player, M2, P0 + dur);
  same(want, look(M2), 'from a playing deck:');
});

test('recording over a take: the touched lane follows the new moves, the rest plays as recorded', async () => {
  const t1 = addTrack('auto4');
  const M1 = await rig({ A: t1 });
  const rec = new AutomationCore(M1);
  rec.record();
  M1.decks.A.play(); render(0.5);
  M1.decks.A.filter.set(0.5); M1.decks.A.vol.set(0.7); render(1);
  M1.decks.A.filter.set(-0.5); render(0.5);
  const take = rec.stop();

  const M2 = await rig({ A: t1 });
  const over = new AutomationCore(M2), P0 = startOf(M2);
  over.play(take, { start: P0, over: true });
  run(over, M2, P0 + 1.0); // past the first filter move, before the second
  M2.decks.A.filter.set(0.2); // touched: the filter lane is the new one from here
  run(over, M2, P0 + 2.0);
  assert.equal(M2.decks.A.filter.value(), 0.2, 'the old move at 1.5 s did not come back');
  near(M2.decks.A.vol.value(), 0.7, 1e-6, 'the untouched volume played as recorded');
  const merged = over.stop();
  const filters = merged.entries.filter((e) => e.g === 'A.filter').map((e) => e.v);
  assert.deepEqual(filters, [0.5, 0.2], 'the filter lane: the old move before the touch, then the new one');
  assert.ok(merged.entries.some((e) => e.g === 'A.vol'), 'the volume lane is kept');
});

test('a transition (mix) and scratching come back as they were done, not re-run', async () => {
  const t1 = addTrack('auto5'), t2 = addTrack('auto6', { freq: 330 });
  const M1 = await rig({ A: t1, B: t2 });
  M1.decks.A.seek(20);
  const rec = new AutomationCore(M1);
  rec.record(); const T0 = M1.ctx.currentTime;
  M1.decks.A.play(); render(1);
  M1.mix({ from: 'A', to: 'B', style: 'bassswap', bars: 2, at: 'bar' }); render(1);
  M1.decks.B.scratchPattern('baby', 2, M1.ctx.currentTime + 0.1); render(1.5);
  // by hand: grab, move back and forth, let go
  M1.decks.B.grab(); render(0.05);
  for (let i = 0; i < 6; i++) { M1.decks.B.handMove(i % 2 ? 0.05 : -0.05, i % 2 ? 1 : -1); render(0.03); }
  M1.decks.B.release(); render(2);
  const dur = M1.ctx.currentTime - T0, want = look(M1);
  const take = rec.stop();
  assert.ok(take.entries.some((e) => e.k === 'hand') && take.entries.some((e) => e.k === 'param' && e.id === 'B.cut'), 'the scratch and its fader cuts are in it');
  const M2 = await rig({ A: t1, B: t2 });
  M2.decks.A.seek(20);
  const player = new AutomationCore(M2), P0 = startOf(M2);
  player.play(JSON.parse(JSON.stringify(take)), { start: P0 });
  run(player, M2, P0 + dur);
  const got = look(M2);
  for (const k of ['A.playing', 'B.playing', 'A.low', 'B.low', 'A.vol', 'B.vol', 'xfader']) assert.equal(typeof got[k] === 'number' ? +got[k].toFixed(3) : got[k], typeof want[k] === 'number' ? +want[k].toFixed(3) : want[k], `after the mix: ${k}`);
  near(got['B.pos'], want['B.pos'], 0.02, 'B after the scratches (a hand scratch follows the hand messages as they came)');
});
