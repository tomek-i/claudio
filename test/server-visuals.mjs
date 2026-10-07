// The /visuals feed on a scratch server: a viewer's event stream gets hello, scene, frames and mode; only the engine
// tab's frames are relayed; the engine is told when someone is watching; nothing a viewer can reach changes the decks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratch, startServer, api, cli, FakeEngine, waitUntil } from './server-harness.mjs';

const sc = scratch('visuals', { port: 4857, config: { autoDJ: { enabled: false } } });
const srv = await startServer(sc);
const eng = new FakeEngine(sc.base);
await eng.start();
const open = [];
after(async () => { for (const s of open) s.close(); await eng.stop(); srv.stop(); });

// a plain event-stream reader: every event it was sent, in order
async function stream(path) {
  const ctrl = new AbortController(), got = [];
  const res = await fetch(sc.base + path, { signal: ctrl.signal });
  (async () => {
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) got.push({ event, data: JSON.parse(data) });
      }
    }
  })().catch(() => {});
  const s = { got, close: () => ctrl.abort(), of: (event) => got.filter((g) => g.event === event).map((g) => g.data), status: res.status, type: res.headers.get('content-type') };
  open.push(s);
  return s;
}
const frame = (t, beat = 0) => ({ t, l: 0.3, p: 0.6, b: Array.from({ length: 16 }, (_, i) => 100 + i), d: { A: [beat, 1] } });
const post = (path, body) => fetch(sc.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('a viewer gets hello with the mode and the scene; the DJ page is told someone is watching', async () => {
  await eng.loadTrack('A', sc.fx.main);
  await eng.set('A', { playing: true, audible: 1 });
  const page = await stream('/api/events?client=dj-page');
  await waitUntil(() => page.of('hello').length);
  assert.deepEqual(page.of('hello')[0].visuals, { viewers: 0, listeners: 0 });
  const v = await stream('/api/visuals/events');
  assert.equal(v.status, 200); assert.match(v.type, /text\/event-stream/);
  const hello = (await waitUntil(() => v.of('hello')[0]));
  assert.equal(hello.mode, 'auto');
  assert.ok(hello.modes.length >= 3);
  assert.equal(hello.scene.live, 'A');
  assert.equal(hello.scene.decks.A.id, sc.fx.main.id);
  assert.equal(hello.scene.decks.A.camelot, sc.fx.main.camelot);
  assert.equal(hello.scene.decks.A.bpm, sc.fx.main.bpm);
  assert.ok(await waitUntil(() => page.of('visuals').some((e) => e.viewers === 1)), 'the engine tab hears about the viewer');
  assert.equal((await api(sc.base, '/api/visuals')).viewers, 1);
});

test('frames from the engine reach every viewer in order; frames from anyone else are refused', async () => {
  const [a, b] = [await stream('/api/visuals/events'), await stream('/api/visuals/events')];
  await waitUntil(() => a.of('hello').length && b.of('hello').length);
  const r = await (await post('/api/visuals/frames', { client: eng.client, frames: [frame(10, 32), frame(10.021, 32.045)] })).json();
  assert.deepEqual(r, { ok: true, frames: 2 });
  await post('/api/visuals/frames', { client: eng.client, frames: [frame(10.043, 32.09)] });
  for (const v of [a, b]) {
    const frames = await waitUntil(() => (v.of('frames').flat().length >= 3 ? v.of('frames').flat() : null));
    assert.deepEqual(frames.map((f) => f.t), [10, 10.021, 10.043]);
    assert.deepEqual(frames[0], { t: 10, l: 0.3, p: 0.6, b: frame(0).b, d: { A: [32, 1] } });
  }
  const bad = await (await post('/api/visuals/frames', { client: 'someone-else', frames: [frame(99)] })).json();
  assert.deepEqual(bad, { ok: false, frames: 0 });
  await post('/api/visuals/frames', { client: eng.client, frames: [frame(10.064)] });
  await waitUntil(() => a.of('frames').flat().some((f) => f.t === 10.064));
  assert.ok(!a.of('frames').flat().some((f) => f.t === 99), 'the refused frame was not relayed');
  const st = await api(sc.base, '/api/visuals');
  assert.equal(st.frames, 4); assert.ok(st.lastFrameAgoMs < 5000);
});

test('the scene follows the decks: a new track or a shifted key is sent once, the playhead moving is not', async () => {
  const v = await stream('/api/visuals/events');
  await waitUntil(() => v.of('hello').length);
  await eng.loadTrack('B', sc.fx.second);
  const scene = await waitUntil(() => v.of('scene').find((s) => s.decks.B));
  assert.equal(scene.decks.B.title, sc.fx.second.title);
  assert.equal(scene.decks.A.id, sc.fx.main.id);
  const n = v.of('scene').length;
  for (let i = 0; i < 4; i++) await eng.push();
  assert.equal(v.of('scene').length, n);
  await eng.set('A', { effectiveCamelot: '1B' });
  assert.equal((await waitUntil(() => v.of('scene').find((s) => s.decks.A.camelot === '1B'))).decks.A.camelot, '1B');
});

test('mode: set for every open page, unknown modes refused, late joiners get the current one', async () => {
  const v = await stream('/api/visuals/events');
  await waitUntil(() => v.of('hello').length);
  const ok = await post('/api/visuals/mode', { mode: 'tunnel' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await waitUntil(() => v.of('mode')[0]), { mode: 'tunnel' });
  const bad = await post('/api/visuals/mode', { mode: 'disco' });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /unknown mode/);
  const late = await stream('/api/visuals/events');
  assert.equal((await waitUntil(() => late.of('hello')[0])).mode, 'tunnel');
  await post('/api/visuals/mode', { mode: 'auto' });
  assert.deepEqual(await waitUntil(() => v.of('mode')[1]), { mode: 'auto' });
});

test('read-only: watching, frames and mode changes leave the decks as they were, and send the engine no command', async () => {
  const before = await api(sc.base, '/api/state');
  const cmds = eng.cmds.length;
  const v = await stream('/api/visuals/events');
  await waitUntil(() => v.of('hello').length);
  await post('/api/visuals/frames', { client: 'someone-else', frames: [frame(1)], state: { decks: {} }, cmd: 'pause', deck: 'A' });
  await post('/api/visuals/mode', { mode: 'particles', deck: 'A', cmd: 'pause' });
  const after = await api(sc.base, '/api/state');
  assert.equal(eng.cmds.length, cmds);
  assert.equal(after.decks.A.trackId, before.decks.A.trackId);
  assert.equal(after.decks.A.playing, true);
  assert.equal(after.live, before.live);
});

test('health: off with nobody watching, ok while frames flow; the viewer count drops when pages close', async () => {
  const check = async () => (await api(sc.base, '/api/health')).checks.find((c) => c.id === 'visuals');
  await post('/api/visuals/frames', { client: eng.client, frames: [frame(20)] });
  const on = await check();
  assert.equal(on.status, 'ok'); assert.match(on.detail, /viewers? · [\d.]+ frames a second · mode particles/);
  const page = await stream('/api/events?client=dj-page-2');
  for (const s of open.filter((x) => x !== page)) s.close();
  assert.ok(await waitUntil(async () => (await api(sc.base, '/api/visuals')).viewers === 0));
  assert.ok(await waitUntil(() => page.of('visuals').some((e) => e.viewers === 0)), 'the engine tab hears that the last viewer left');
  const off = await check();
  assert.equal(off.status, 'off'); assert.match(off.detail, /no \/visuals page is open/);
});

// ---------------------------------------------------------------- audio relay
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const chunk = (...parts) => Buffer.from(parts.flat());
const postAudio = (client, stream, t0, body) => fetch(`${sc.base}/api/visuals/audio?client=${client}&stream=${stream}&t0=${t0}`, { method: 'POST', body });
// a listener: resolves `head` when the server answers, collects the bytes that follow
function listen() {
  const ctrl = new AbortController(), l = { bytes: [], close: () => ctrl.abort(), done: false };
  l.head = fetch(sc.base + '/api/visuals/audio', { signal: ctrl.signal }).then((res) => {
    l.status = res.status; l.t0 = res.headers.get('x-audio-t0'); l.type = res.headers.get('content-type');
    (async () => { try { for await (const c of res.body) l.bytes.push(...c); } catch { /* closed */ } l.done = true; })();
    return res;
  });
  l.head.catch(() => {});
  open.push(l);
  return l;
}

test('audio relay: the engine is told someone listens; a late joiner starts at the header and the next cluster', async () => {
  const page = await stream('/api/events?client=dj-page-3');
  const a = listen();
  assert.ok(await waitUntil(() => page.of('visuals').some((e) => e.listeners === 1)), 'the engine tab hears about the listener');
  assert.equal((await postAudio('someone-else', 's1', 5, chunk([9], CLUSTER, [9]))).status, 200);
  assert.equal(a.status, undefined, 'audio from anyone but the engine is not relayed');
  await postAudio(eng.client, 's1', 41.25, chunk([1, 2, 3], CLUSTER, [10, 11]));
  await a.head;
  assert.equal(a.status, 200); assert.equal(a.type, 'audio/webm'); assert.equal(a.t0, '41.25');
  await postAudio(eng.client, 's1', 41.25, chunk([12], CLUSTER, [20]));
  assert.ok(await waitUntil(() => a.bytes.length === 15));
  assert.deepEqual(a.bytes, [1, 2, 3, ...CLUSTER, 10, 11, 12, ...CLUSTER, 20]);
  const late = listen();
  await waitUntil(async () => (await api(sc.base, '/api/visuals')).audio.listeners === 2);
  await postAudio(eng.client, 's1', 41.25, chunk([21], CLUSTER, [30]));
  await late.head;
  assert.ok(await waitUntil(() => late.bytes.length === 8));
  assert.deepEqual(late.bytes, [1, 2, 3, ...CLUSTER, 30], 'not the set from the beginning, and not the tail of a cluster');
  const health = (await api(sc.base, '/api/health')).checks.find((c) => c.id === 'visualsAudio');
  assert.equal(health.status, 'ok'); assert.match(health.detail, /2 listeners · \d+ kbit\/s/);
  a.close(); late.close();
  assert.ok(await waitUntil(() => page.of('visuals').some((e) => e.listeners === 0)), 'and hears when the last one left');
});

test('audio relay and recording are independent: starting and stopping a recording leaves a listener playing', async () => {
  const a = listen();
  await waitUntil(async () => (await api(sc.base, '/api/visuals')).audio.listeners === 1);
  await postAudio(eng.client, 's2', 0, chunk([5], CLUSTER, [1]));
  await a.head;
  const rec = await api(sc.base, '/api/record/start', { screen: false, mic: false });
  assert.ok(rec.id || rec.recording !== false, JSON.stringify(rec));
  await postAudio(eng.client, 's2', 0, chunk([2]));
  await fetch(`${sc.base}/api/record/chunk?seq=0&t=${Date.now()}`, { method: 'POST', body: chunk([7, 7, 7]) });
  await api(sc.base, '/api/record/stop', {});
  await postAudio(eng.client, 's2', 0, chunk([3]));
  assert.ok(await waitUntil(() => a.bytes.length === 8));
  assert.deepEqual(a.bytes, [5, ...CLUSTER, 1, 2, 3], 'the listener got every chunk and none of the recording\'s');
  assert.equal(a.done, false, 'and was not disconnected');
  a.close();
});

test('visuals.audio off: no audio is offered or sent, viewers are told, the picture still works', async () => {
  const v = await stream('/api/visuals/events');
  assert.equal((await waitUntil(() => v.of('hello')[0])).audio, true);
  const a = listen();
  await waitUntil(async () => (await api(sc.base, '/api/visuals')).audio.listeners === 1);
  await postAudio(eng.client, 's3', 0, chunk([5], CLUSTER, [1]));
  await a.head;
  const saved = await api(sc.base, '/api/settings', { 'visuals.audio': false });
  assert.deepEqual(saved.changed, ['visuals.audio']); assert.deepEqual(saved.restart, [], 'applies without a restart');
  assert.deepEqual(await waitUntil(() => v.of('audio')[0]), { offered: false });
  assert.ok(await waitUntil(() => a.done), 'the listener is disconnected');
  const refused = await fetch(sc.base + '/api/visuals/audio');
  assert.equal(refused.status, 403);
  assert.deepEqual(await (await postAudio(eng.client, 's3', 0, chunk([9]))).json(), { ok: false });
  assert.equal((await api(sc.base, '/api/health')).checks.find((c) => c.id === 'visualsAudio').status, 'off');
  await post('/api/visuals/frames', { client: eng.client, frames: [frame(30)] });
  assert.ok(await waitUntil(() => v.of('frames').flat().some((f) => f.t === 30)), 'frames still flow');
  const late = await stream('/api/visuals/events');
  assert.equal((await waitUntil(() => late.of('hello')[0])).audio, false);
  await api(sc.base, '/api/settings', { 'visuals.audio': true });
  assert.deepEqual(await waitUntil(() => v.of('audio')[1]), { offered: true });
});

test('dj visuals: shows the address for other devices, and changes the mode on every open page', async () => {
  const v = await stream('/api/visuals/events');
  await waitUntil(() => v.of('hello').length);
  const status = await cli(sc, ['visuals']);
  assert.match(status.out, /Visuals: mode \w+ · \d+ pages? open/);
  assert.match(status.out, /open http:\/\/[\d.]+:4857\/visuals|open http:\/\/localhost:4857\/visuals/);
  const set = await cli(sc, ['visuals', 'terrain']);
  assert.equal(set.code, 0); assert.match(set.out, /✓ visuals: terrain on \d+ pages?/);
  assert.ok(await waitUntil(() => v.of('mode').some((m) => m.mode === 'terrain')));
  const bad = await cli(sc, ['visuals', 'disco']);
  assert.notEqual(bad.code, 0); assert.match(bad.out, /unknown mode "disco"/);
  await cli(sc, ['visuals', 'auto']);
  assert.equal((await api(sc.base, '/api/visuals')).mode, 'auto');
});
