// Saved sets (lib/sets.mjs): made and changed through `dj sets`, kept as files in sets/, and the active one is what
// Auto-DJ plays from after the queue: in order or by best fit, and when all of it has played, the library or nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startServer, FakeEngine, api, cli, waitUntil, sleep } from './server-harness.mjs';

const sc = scratch('sets', { port: 4863, config: { autoDJ: { enabled: true, leadSec: 45 } } });
let srv = await startServer(sc);
let eng = new FakeEngine(sc.base);
eng.noAutoFinish = true;
await eng.start();
after(async () => { await eng.stop(); srv.stop(); });

const { main, second, far, clash, bed } = sc.fx;
const end = (t) => Math.min(t.duration, t.audioEnd ?? t.duration);
const sets = (body) => api(sc.base, '/api/sets', body);
// A plays `main` with 60 s left (Auto-DJ's stage 1: cue the next track), B is empty or holds `onB`
async function liveWithMinuteLeft(onB) {
  eng.cmds.length = 0;
  await eng.set('B', { playing: false, audible: 0, trackId: null, loaded: false });
  if (onB) await eng.loadTrack('B', onB, { playing: false, audible: 0 });
  await eng.loadTrack('A', main, { playing: true, audible: 1, position: end(main) - 60 });
}
const nextLoad = () => waitUntil(() => eng.sent('load')[0], 5000);

test('dj sets makes, changes, lists and shows a set, kept as a file in sets/', async () => {
  let r = await cli(sc, ['sets', 'new', 'Warm Up', far.id, 'Fixture Clash']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Warm Up\s+2 tracks\s+pick fit, then library/);
  const file = path.join(sc.dir, 'sets', 'warm-up.json');
  assert.ok(fs.existsSync(file), 'sets/warm-up.json');
  r = await cli(sc, ['sets', 'add', 'Warm Up', second.id, 'no such track at all']);
  assert.match(r.out, /no match: no such track at all/);
  r = await cli(sc, ['sets', 'move', 'Warm Up', '3', '1']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).tracks.map((t) => t.id), [second.id, far.id, clash.id]);
  r = await cli(sc, ['sets', 'rm', 'Warm Up', '1']);
  r = await cli(sc, ['sets', 'pick', 'Warm Up', 'order']);
  assert.match(r.out, /pick order/);
  r = await cli(sc, ['sets', 'pick', 'Warm Up', 'random']);
  assert.notEqual(r.code, 0);
  r = await cli(sc, ['sets', 'new', 'warm-up']);
  assert.notEqual(r.code, 0, 'the same name twice');
  r = await cli(sc, ['sets']);
  assert.match(r.out, /Warm Up\s+2 tracks/);
  r = await cli(sc, ['sets', 'show', 'Warm Up']);
  assert.match(r.out, /1\..*Fixture Far/); assert.match(r.out, /2\..*Fixture Clash/);
  const st = await api(sc.base, '/api/sets?name=warm%20up');
  assert.equal(st.tracks[0].bpm.toFixed(0), String(Math.round(far.bpm)), 'tracks come with their analysis');
});

test('in order: Auto-DJ cues the set\'s next track, not the best fit from the library', async () => {
  const r = await cli(sc, ['sets', 'use', 'Warm Up']); // before the live deck reaches the cue point
  assert.match(r.out, /★ Warm Up/);
  await liveWithMinuteLeft();
  const load = await nextLoad();
  assert.ok(load, 'Auto-DJ loaded a track');
  assert.equal(load.args.deck, 'B');
  assert.equal(load.args.track.id, far.id, 'the first track of the set, though "second" fits better');
  const s = await api(sc.base, '/api/state');
  assert.equal(s.activeSet.name, 'Warm Up');
  assert.match(s.autoDJ.prepared.why, /next in the set "Warm Up"/);
});

test('best fit: the track of the set that fits the live deck; a track left on the deck does not jump the set', async () => {
  await sets({ action: 'add', name: 'Warm Up', tracks: [second.id] });
  await sets({ action: 'options', name: 'Warm Up', pick: 'fit' });
  await liveWithMinuteLeft(bed); // bed: a good fit, already on B, but not in the set
  const load = await nextLoad();
  assert.ok(load);
  assert.equal(load.args.track.id, second.id, 'same tempo, neighbouring key: the best of the set');
});

test('what has played is marked; at the end of the set Auto-DJ stops or carries on from the library', async () => {
  await sets({ action: 'use', name: 'Warm Up', restart: true });
  // each track of the set goes live in turn
  for (const t of [far, clash, second]) { await eng.loadTrack('A', t, { playing: true, audible: 1, position: 30 }); await sleep(450); }
  const view = (await api(sc.base, '/api/state')).activeSet;
  assert.deepEqual(view.played.sort(), [far.id, clash.id, second.id].sort());
  await sets({ action: 'options', name: 'Warm Up', then: 'stop' });
  await liveWithMinuteLeft();
  await sleep(1500);
  assert.equal(eng.sent('load').length, 0, 'then stop: nothing more is cued');
  const log = await api(sc.base, '/api/log?n=80');
  assert.ok(log.some((e) => /Every track of the set "Warm Up" has played: Auto-DJ stops here/.test(e.text)));
  await sets({ action: 'options', name: 'Warm Up', then: 'library' });
  const load = await nextLoad();
  assert.ok(load, 'then library: the best suggestion from the whole library');
  assert.ok(![far.id, clash.id, second.id, main.id].includes(load.args.track.id));
});

test('the active set and what has played outlive a restart; dj sets off and delete', async () => {
  srv.stop(); await sleep(300);
  srv = await startServer(sc);
  const r = await api(sc.base, '/api/sets');
  assert.equal(r.active?.name, 'Warm Up');
  assert.equal(r.active.played.length, 3);
  let c = await cli(sc, ['sets', 'off']);
  assert.match(c.out, /no set/);
  assert.equal((await api(sc.base, '/api/state')).activeSet, null);
  assert.ok(!fs.existsSync(path.join(sc.dir, '.dj', 'active-set.json')));
  c = await cli(sc, ['sets', 'delete', 'Warm Up']);
  assert.match(c.out, /deleted "Warm Up"/);
  assert.equal((await api(sc.base, '/api/sets')).sets.length, 0);
});

test('dj sets save keeps the decks and the mixer; dj sets open puts them back, paused, and will not stop music unasked', async () => {
  await eng.stop(); eng = new FakeEngine(sc.base); eng.noAutoFinish = true; await eng.start(); // the server was restarted above
  await cli(sc, ['autodj', 'off']);
  eng.cmds.length = 0;
  await eng.loadTrack('A', main, { playing: false, audible: 0, position: 80, cue: 12.5, rate: 1.02, eq: { low: -0.5, mid: 0, high: 0 }, filter: 0.3, loop: { start: 80, end: 81.6, beats: 4 } });
  await eng.loadTrack('B', bed, { playing: false, audible: 0, position: 30 });
  eng.master = { volume: 0.8, xfader: 0.25 };
  await eng.push();
  let r = await cli(sc, ['sets', 'save', 'Friday']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Friday\s+2 tracks/, 'a new set gets the decks\' tracks');
  assert.match(r.out, /decks saved .*A Fixtures - Fixture Main @1:20 · B Fixtures - Fixture Bed @0:30/);
  const file = JSON.parse(fs.readFileSync(path.join(sc.dir, 'sets', 'friday.json'), 'utf8'));
  assert.equal(file.snapshot.decks.A.rate, 1.02);
  assert.equal(file.snapshot.autoDJ, false);
  assert.match((await cli(sc, ['sets'])).out, /Friday .*decks AB/);
  // the page saves its ui.* settings as they change: that must not turn Auto-DJ back on
  await api(sc.base, '/api/settings', { 'ui.touchHoldMs': 320 });
  assert.equal((await api(sc.base, '/api/state')).autoDJ.enabled, false, 'a ui setting leaves Auto-DJ alone');

  // something else is playing now: opening is refused, then forced
  await eng.loadTrack('A', far, { playing: true, audible: 1, position: 10 });
  await cli(sc, ['autodj', 'on']);
  r = await cli(sc, ['sets', 'open', 'Friday']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /deck A is playing: opening the set stops it \(add --force/);
  assert.equal(eng.sent('load').length, 0);
  r = await cli(sc, ['sets', 'open', 'Friday', '--force']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /decks A, B loaded, paused/);
  const sent = eng.cmds.map((c) => [c.cmd, c.args]);
  assert.deepEqual(sent[0], ['pause', { deck: 'A' }], 'the playing deck is stopped first');
  const of = (cmd, deck) => sent.filter(([c, a]) => c === cmd && a.deck === deck).map(([, a]) => a);
  assert.equal(of('load', 'A')[0].track.id, main.id);
  assert.equal(of('load', 'A')[0].cue, 12.5);
  assert.equal(of('load', 'A')[0].force, true, 'the deck counts as on air for a moment after its pause');
  assert.deepEqual(of('tempo', 'A'), [{ deck: 'A', value: '2.000%' }]);
  assert.deepEqual(of('eq', 'A'), [{ deck: 'A', band: 'low', value: -0.5 }]);
  assert.deepEqual(of('loop', 'A'), [{ deck: 'A', beats: 4 }]);
  assert.equal(of('seek', 'A').at(-1).position, 80);
  assert.equal(of('seek', 'B').at(-1).position, 30);
  assert.ok(sent.some(([c, a]) => c === 'master' && a.value === 0.8) && sent.some(([c, a]) => c === 'xfade' && a.value === 0.25));
  assert.ok(!eng.sent('play').length, 'nothing is started');
  const s = await api(sc.base, '/api/state');
  assert.equal(s.activeSet.name, 'Friday');
  await sleep(1200);
  assert.deepEqual((await api(sc.base, '/api/state')).activeSet.played, [], 'the tracks put back on the decks have not played');
  assert.equal(s.autoDJ.enabled, false, 'Auto-DJ as it was saved');
  const log = await api(sc.base, '/api/log?n=40');
  assert.ok(log.some((e) => e.text === '🗂 Opened the set "Friday": decks A, B loaded'));
  assert.ok(!log.some((e) => /^Load .*→ deck/.test(e.text) && e.ts > Date.now() - 5000), 'one line in the booth, not one per command');
});

test('a saved deck whose track has left the library is reported, the rest is opened', async () => {
  const f = path.join(sc.dir, 'sets', 'friday.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  st.snapshot.decks.B.trackId = 'gone0000';
  fs.writeFileSync(f, JSON.stringify(st));
  await eng.set('A', { playing: false, audible: 0 });
  eng.cmds.length = 0;
  const r = await api(sc.base, '/api/sets', { action: 'open', name: 'Friday' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.decks, ['A']);
  assert.equal(r.missing[0].deck, 'B');
  assert.ok(!eng.sent('load').some((c) => c.args.deck === 'B'));
});
