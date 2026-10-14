// Saved sets (lib/sets.mjs): made and changed through `dj sets`, kept as files in sets/, and the active one is what
// Auto-DJ plays from after the queue: in order or by best fit, and when all of it has played, the library or nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startServer, FakeEngine, api, cli, waitUntil, sleep } from './server-harness.mjs';

const sc = scratch('sets', { port: 4863, config: { autoDJ: { enabled: true, leadSec: 45 } } });
let srv = await startServer(sc);
const eng = new FakeEngine(sc.base);
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
