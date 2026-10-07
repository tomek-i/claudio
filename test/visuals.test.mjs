// The /visuals feed without a server: the spectrum measurement of the engine's tap, and the hub that cleans frames,
// builds the scene and fans both out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpectrumTap, BANDS } from '../apps/web/public/worklets/visuals-tap.js';
import { VisualsHub, MODES, cleanFrame, buildScene, lanAddress } from '../apps/server/lib/visuals.mjs';

const SR = 48000;
function measure(fn, seconds = 0.2) {
  const tap = new SpectrumTap(SR), n = Math.round(seconds * SR), L = new Float32Array(n), frames = [];
  for (let i = 0; i < n; i++) L[i] = fn(i / SR);
  // in 128-sample blocks, the way the audio thread delivers them
  for (let o = 0; o + 128 <= n; o += 128) tap.push(L.subarray(o, o + 128), null, 128, (f, into) => frames.push({ ...f, at: o + into }));
  return frames;
}
const loudest = (b) => b.indexOf(Math.max(...b));

test('spectrum tap: one frame per 1024 samples, level and peak of a sine, the band follows the pitch', () => {
  const frames = measure((t) => 0.5 * Math.sin(2 * Math.PI * 1000 * t));
  assert.equal(frames.length, Math.floor((Math.floor((0.2 * SR) / 128) * 128) / 1024));
  assert.deepEqual(frames.slice(0, 3).map((f) => f.at), [1024, 2048, 3072]);
  const f = frames.at(-1);
  assert.equal(f.b.length, BANDS);
  assert.ok(Math.abs(f.l - 0.5 / Math.SQRT2) < 0.01, `rms ${f.l}`);
  assert.ok(Math.abs(f.p - 0.5) < 0.01, `peak ${f.p}`);
  const at = (hz) => loudest(measure((t) => 0.5 * Math.sin(2 * Math.PI * hz * t)).at(-1).b);
  assert.equal(at(50), 1);
  assert.ok(at(50) < at(200) && at(200) < at(1000) && at(1000) < at(5000) && at(5000) < at(12000), 'bands run low to high');
  assert.equal(at(12000), BANDS - 1);
});

test('spectrum tap: a full-scale sine reads the top of the scale in its band, half the level reads 6 dB less, silence reads 0', () => {
  const top = (amp) => Math.max(...measure((t) => amp * Math.sin(2 * Math.PI * 1000 * t)).at(-1).b);
  assert.ok(top(1) >= 250 && top(1) <= 255, `full scale reads ${top(1)}`); // up to 1.4 dB short when the pitch falls between two bins
  assert.ok(Math.abs(top(1) - top(0.5) - (255 * 6.02) / 72) < 2, `6 dB is ${top(1) - top(0.5)} steps`);
  const quiet = measure(() => 0).at(-1);
  assert.equal(Math.max(...quiet.b), 0);
  assert.equal(quiet.l, 0);
});

test('spectrum tap: stereo is measured as its mono sum, peak as the louder channel', () => {
  const tap = new SpectrumTap(SR), L = new Float32Array(1024).fill(0.8), R = new Float32Array(1024).fill(-0.8);
  let f; tap.push(L, R, 1024, (x) => { f = x; });
  assert.equal(f.l, 0, 'opposite channels cancel in the sum');
  assert.ok(Math.abs(f.p - 0.8) < 1e-6);
});

test('cleanFrame: passes the frame shape on and nothing else', () => {
  const f = cleanFrame({ t: 12.34567, l: 0.5, p: 2, b: [1, 300, -4, 'x', ...Array(20).fill(9)], d: { A: [16.50049, 0.75], B: ['no', 1], Z: [1, 1] }, evil: 'x', decks: { A: {} } });
  assert.deepEqual(Object.keys(f), ['t', 'l', 'p', 'b', 'd']);
  assert.equal(f.t, 12.3457); assert.equal(f.p, 1);
  assert.equal(f.b.length, 16); assert.deepEqual(f.b.slice(0, 4), [1, 255, 0, 0]);
  assert.deepEqual(f.d, { A: [16.5, 0.75] });
  assert.equal(cleanFrame({ l: 1 }), null, 'a frame without a time is dropped');
  assert.equal(cleanFrame('x'), null);
});

const library = { tracks: new Map([['t1', { id: 't1', title: 'One', artist: 'X', camelot: '8A', energy: 7, bpm: 128, firstBeat: 0.2, introEnd: 30, outroStart: 200, breakdowns: [{ startBar: 32, endBar: 40, start: 60.2, drop: 75.2 }] }]]) };
const state = (patch = {}) => ({ live: 'A', decks: { A: { trackId: 't1', title: 'One', artist: 'X', camelot: '8A', effectiveCamelot: '8A', energy: 7, bpm: 128, firstBeat: 0.2, position: 12, playing: true, audible: 1, ...patch }, B: { trackId: null } } });

test('buildScene: the track facts of loaded decks, the key as it sounds, structure from the library', () => {
  const s = buildScene(state({ effectiveCamelot: '10A' }), library);
  assert.equal(s.live, 'A');
  assert.deepEqual(Object.keys(s.decks), ['A'], 'an empty deck is left out');
  assert.equal(s.decks.A.camelot, '10A', 'a shifted key shows as shifted');
  assert.deepEqual(s.decks.A.breakdowns, [[60.2, 75.2]]);
  assert.equal(s.decks.A.introEnd, 30); assert.equal(s.decks.A.outroStart, 200);
  assert.ok(!('position' in s.decks.A) && !('audible' in s.decks.A), 'nothing that changes every moment');
});

function viewer() { const got = []; return { got, write(chunk) { const m = /^event: (.*)\ndata: (.*)\n\n$/.exec(chunk); got.push({ event: m[1], data: JSON.parse(m[2]) }); } }; }

test('hub: hello on attach, frames fanned out to every viewer, scene only when it changes, viewer count reported', () => {
  const counts = [], hub = new VisualsHub({ library, onAudience: (a) => counts.push(a.viewers) });
  hub.setState(state());
  const a = viewer(), b = viewer();
  hub.attach('a', a);
  assert.equal(a.got[0].event, 'hello');
  assert.equal(a.got[0].data.mode, 'auto'); assert.deepEqual(a.got[0].data.modes, MODES);
  assert.equal(a.got[0].data.scene.decks.A.title, 'One', 'a late joiner gets the scene straight away');
  hub.attach('b', b);
  assert.equal(hub.push([{ t: 1, l: 0.2, p: 0.3, b: [1, 2], d: { A: [4, 1] } }, { nope: 1 }, { t: 1.02, l: 0.2, p: 0.3, b: [], d: {} }], 1000), 2);
  for (const v of [a, b]) { assert.equal(v.got.at(-1).event, 'frames'); assert.deepEqual(v.got.at(-1).data.map((f) => f.t), [1, 1.02]); }
  const before = a.got.length;
  assert.equal(hub.setState(state({ position: 13, audible: 0.9 })), false, 'the playhead moving is not a scene change');
  assert.equal(a.got.length, before);
  assert.equal(hub.setState(state({ effectiveCamelot: '9A' })), true);
  assert.equal(a.got.at(-1).event, 'scene'); assert.equal(a.got.at(-1).data.decks.A.camelot, '9A');
  hub.detach('a'); hub.detach('a'); hub.detach('b');
  assert.deepEqual(counts, [1, 2, 1, 0]);
  assert.equal(hub.push([{ t: 2 }], 1100), 1, 'frames with nobody watching are counted, not sent');
});

test('hub: mode is auto or a known mode, pushed to viewers; status counts frames a second', () => {
  const hub = new VisualsHub({ library }), a = viewer();
  hub.attach('a', a);
  assert.deepEqual(hub.setMode('Tunnel'), { ok: true, mode: 'tunnel', viewers: 1 });
  assert.deepEqual(a.got.at(-1), { event: 'mode', data: { mode: 'tunnel' } });
  assert.equal(hub.setMode('disco').ok, false);
  assert.equal(hub.mode, 'tunnel');
  assert.equal(hub.setMode('auto').mode, 'auto');
  assert.equal(hub.status(5000).lastFrameAgoMs, null);
  for (let i = 0; i < 90; i++) hub.push([{ t: i / 45 }], 5000 + i * 22);
  const st = hub.status(5000 + 89 * 22);
  assert.equal(st.frames, 90); assert.equal(st.viewers, 1); assert.equal(st.lastFrameAgoMs, 0);
  assert.ok(st.fps > 40 && st.fps <= 46, `fps ${st.fps}`);
  assert.equal(hub.status(5000 + 89 * 22 + 2500).fps, 0, 'old frames age out');
});

// ---------------------------------------------------------------- audio relay
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75];
const bytes = (...parts) => Buffer.from(parts.flat());
function listener() {
  const l = { head: null, body: [], ended: false, writableLength: 0 };
  l.writeHead = (code, headers) => { l.head = { code, headers }; };
  l.write = (b) => { l.body.push(Buffer.from(b)); };
  l.end = () => { l.ended = true; };
  l.all = () => Buffer.concat(l.body);
  return l;
}

test('audio: a listener starts at the stream header and the next cluster; later chunks follow whole', () => {
  const seen = [], hub = new VisualsHub({ library, onAudience: (a) => seen.push(a.listeners) });
  const early = listener();
  assert.equal(hub.listen('early', early), true);
  assert.equal(early.head, null, 'no answer until there is something to start with');
  // the recorder's first chunk: header, then the first cluster begins part-way through
  hub.pushAudio({ stream: 's1', t0: 12.5 }, bytes([1, 2, 3], CLUSTER, [10, 11]), 1000);
  assert.deepEqual(early.head, { code: 200, headers: { 'content-type': 'audio/webm', 'cache-control': 'no-store', 'x-audio-stream': 's1', 'x-audio-t0': '12.5' } });
  assert.deepEqual([...early.all()], [1, 2, 3, ...CLUSTER, 10, 11]);
  // a chunk is the tail of one cluster and the start of the next
  hub.pushAudio({ stream: 's1', t0: 12.5 }, bytes([12, 13], CLUSTER, [20]), 1300);
  assert.deepEqual([...early.all()].slice(-7), [12, 13, ...CLUSTER, 20], 'a live listener gets the chunk as it came');
  // a late joiner: the header again, then from the next cluster on, never the tail of the one in progress
  const late = listener();
  hub.listen('late', late);
  hub.pushAudio({ stream: 's1', t0: 12.5 }, bytes([21, 22]), 1600);
  assert.equal(late.head, null, 'no cluster starts in this chunk: keep waiting');
  hub.pushAudio({ stream: 's1', t0: 12.5 }, bytes([23], CLUSTER, [30, 31]), 1900);
  assert.deepEqual([...late.all()], [1, 2, 3, ...CLUSTER, 30, 31]);
  assert.equal(late.head.headers['x-audio-t0'], '12.5');
  assert.deepEqual(seen, [1, 2]);
  const st = hub.status(1900).audio;
  assert.equal(st.listeners, 2); assert.equal(st.offered, true); assert.equal(st.lastChunkAgoMs, 0); assert.ok(st.kbps >= 0);
  hub.unlisten('early'); hub.unlisten('late'); hub.unlisten('late');
  assert.deepEqual(seen, [1, 2, 1, 0]);
});

test('audio: a header split over two chunks is put together; a new recording restarts those listening', () => {
  const hub = new VisualsHub({ library }), a = listener();
  hub.listen('a', a);
  hub.pushAudio({ stream: 's1', t0: 1 }, bytes([1, 2]), 0);
  assert.equal(a.head, null);
  hub.pushAudio({ stream: 's1', t0: 1 }, bytes([3], CLUSTER, [9]), 300);
  assert.deepEqual([...a.all()], [1, 2, 3, ...CLUSTER, 9]);
  // the engine starts a new recording (its own header, its own timeline)
  const waiting = listener();
  hub.listen('w', waiting);
  hub.pushAudio({ stream: 's2', t0: 50 }, bytes([7, 7], CLUSTER, [1]), 600);
  assert.equal(a.ended, true, 'the listener on the old stream is let go, to join the new one');
  assert.equal(hub.listeners.has('a'), false);
  assert.deepEqual([...waiting.all()], [7, 7, ...CLUSTER, 1], 'one that was still waiting starts on the new stream');
  assert.equal(waiting.head.headers['x-audio-t0'], '50');
});

test('audio: switched off, nothing is offered, accepted or passed on; a slow listener is dropped, not buffered without end', () => {
  const hub = new VisualsHub({ library, audio: false }), v = viewer();
  hub.attach('v', v);
  assert.equal(v.got[0].data.audio, false);
  assert.equal(hub.listen('a', listener()), false);
  assert.equal(hub.pushAudio({ stream: 's', t0: 0 }, bytes(CLUSTER), 0), false);
  hub.setAudio(true);
  assert.deepEqual(v.got.at(-1), { event: 'audio', data: { offered: true, lowLatency: false } });
  const a = listener(), slow = listener();
  hub.listen('a', a); hub.listen('slow', slow);
  hub.pushAudio({ stream: 's', t0: 0 }, bytes([1], CLUSTER, [2]), 0);
  slow.writableLength = 5 << 20;
  hub.pushAudio({ stream: 's', t0: 0 }, bytes([3]), 300);
  assert.equal(slow.ended, true); assert.equal(hub.listeners.size, 1);
  assert.deepEqual([...a.all()].slice(-1), [3]);
  hub.setAudio(false);
  assert.equal(a.ended, true); assert.equal(hub.listeners.size, 0); assert.equal(hub.stream, null);
  assert.deepEqual(v.got.at(-1), { event: 'audio', data: { offered: false, lowLatency: false } });
  assert.equal(hub.status().audio.offered, false);
});

test('lanAddress: a real adapter on a home range before virtual ones; none when there is only loopback', () => {
  const ip = (address, internal = false) => ({ family: 'IPv4', address, internal });
  assert.equal(lanAddress({ 'vEthernet (Default Switch)': [ip('172.17.176.1')], WiFi: [{ family: 'IPv6', address: 'fe80::1', internal: false }, ip('192.168.1.101')], Loopback: [ip('127.0.0.1', true)] }), '192.168.1.101');
  assert.equal(lanAddress({ 'vEthernet (WSL)': [ip('172.20.0.1')] }), '172.20.0.1', 'a virtual adapter is better than nothing');
  assert.equal(lanAddress({ eth0: [ip('169.254.3.4')], lo: [ip('127.0.0.1', true)] }), null);
});

// ---------------------------------------------------------------- the page's feed (no browser: a stand-in event source)
globalThis.EventSource = class { addEventListener() {} };
const { Feed, blendHsl, sectionAt, hslToRgb } = await import('../apps/web/public/ui/visuals/feed.js');
const near = (a, b, eps = 0.02) => a.every((x, i) => Math.abs(x - b[i]) <= eps);

test('feed colours: two decks blend along the colour wheel, not through grey; opposite hues go to the louder', () => {
  const red = [0, 80, 60], yellow = [60, 80, 60], cyan = [180, 80, 60];
  assert.ok(near(blendHsl([[red, 1]]), hslToRgb(...red)));
  assert.ok(near(blendHsl([[red, 0.5], [yellow, 0.5]]), hslToRgb(30, 80, 60)), 'half way is orange');
  assert.ok(near(blendHsl([[red, 0.75], [yellow, 0.25]]), hslToRgb(13.9, 80, 60), 0.03));
  const mid = blendHsl([[red, 0.55], [cyan, 0.45]]);
  assert.ok(Math.max(...mid) - Math.min(...mid) > 0.4, 'still a colour, not grey');
  assert.ok(near(mid, hslToRgb(...red)));
  assert.equal(blendHsl([]), null);
});

test('feed sections: intro, breakdown, main and outro from the track structure', () => {
  const deck = { introEnd: 30, outroStart: 200, breakdowns: [[60, 75], [120, 136]] };
  assert.deepEqual([10, 40, 60, 74.9, 75, 130, 190, 200, 240].map((p) => sectionAt(deck, p)), ['intro', 'main', 'breakdown', 'breakdown', 'main', 'breakdown', 'main', 'outro', 'outro']);
  assert.equal(sectionAt(null, 5), 'main');
});

test('feed: reads between two frames, runs the beat on past the newest one, and follows a clock it is given', () => {
  const feed = new Feed();
  feed.scene = { live: 'A', decks: { A: { id: 't1', camelot: '8A', energy: 8, bpm: 120, firstBeat: 0, introEnd: 1, outroStart: 300, breakdowns: [] } } };
  const fr = (t, beat, l) => ({ t, l, p: l, b: new Array(16).fill(Math.round(l * 255)), d: { A: [beat, 1] } });
  // 120 BPM: two beats a second. The engine's clock reads 10 s when this page's reads 5000 ms.
  feed.take([fr(10, 20, 0.2), fr(10.02, 20.04, 0.4)], 5020);
  const mid = feed.at(10.01);
  assert.ok(Math.abs(mid.l - 0.3) < 1e-9); assert.ok(Math.abs(mid.decks.A[0] - 20.02) < 1e-9);
  const past = feed.at(10.12);
  assert.ok(Math.abs(past.decks.A[0] - 20.24) < 1e-6, 'the beat keeps its tempo past the newest frame');
  assert.ok(past.l < 0.4 && past.stale > 0, 'the level fades');
  // as live as possible: a little behind the newest frame
  const live = feed.drawTime(5020);
  assert.ok(live < 10.02 && live > 10.02 - 0.3, `draws ${live}`);
  feed.offsetMs = 100;
  assert.ok(Math.abs(feed.drawTime(5020) - live - 0.1) < 1e-9, 'the viewer\'s own offset shifts the picture');
  // locked to the sound the viewer hears
  feed.clock = () => 9.5;
  assert.ok(Math.abs(feed.drawTime(5020) - 9.6) < 1e-9);
  feed.clock = () => null; // the sound dropped: back to live
  assert.ok(Math.abs(feed.drawTime(5020) - live - 0.1) < 1e-9);
  feed.offsetMs = 0; feed.clock = null;
  const sig = feed.update(5020, 0.016);
  assert.equal(sig.idle, false); assert.equal(sig.live, 'A'); assert.equal(sig.trackId, 't1'); assert.equal(sig.section, 'main');
  assert.ok(Math.abs(sig.bpm - 120) < 0.5, `bpm ${sig.bpm}`);
  assert.ok(sig.beatPhase >= 0 && sig.beatPhase < 1 && sig.barPhase >= 0 && sig.barPhase < 1);
  // frames stop: the picture goes idle instead of freezing on the last one
  assert.equal(feed.update(5020 + 4000, 0.016).idle, true);
  // the engine restarted and its clock began again: old frames are dropped
  feed.take([fr(0.5, 1, 0.3)], 12000);
  assert.equal(feed.frames.length, 1);
});

// ---------------------------------------------------------------- lining the sound up with the frames
const { Sync } = await import('../apps/web/public/ui/visuals/audio.js');

test('sync: finds how far the guessed time is from the truth, follows it as it drifts, and ignores silence', () => {
  // the "music": a loudness curve with a beat and a slower swell; frames carry it on the engine clock
  const loud = (t) => 0.2 + 0.15 * Math.max(0, Math.sin(t * 2 * Math.PI * 2)) ** 4 + 0.05 * Math.sin(t * 0.9) + 0.03 * Math.sin(t * 7.3);
  const levelAt = (t) => (t < 0 || t > 400 ? null : loud(t));
  const sync = new Sync();
  // the player's timeline runs 0.3 % slow, starting 80 ms out: the true time is guess + offset(guess)
  const offset = (g) => 0.08 + 0.003 * (g - 100);
  let worst = 0, shift = 0;
  for (let g = 100; g < 160; g += 1 / 60) {
    shift = sync.add(g, loud(g + offset(g)), levelAt, 1 / 60);
    if (g > 110) worst = Math.max(worst, Math.abs(shift - offset(g)));
  }
  assert.ok(sync.target != null && sync.quality > 0.9, `quality ${sync.quality}`);
  assert.ok(Math.abs(shift - offset(160)) < 0.012, `ends ${((shift - offset(160)) * 1000).toFixed(1)} ms out`);
  assert.ok(worst < 0.02, `never more than a frame or so out once locked: ${(worst * 1000).toFixed(1)} ms`);
  // music that repeats every beat matches a beat early or late almost as well: a fresh lock takes the shift nearest
  // to the stream's own timeline, not one half a second away
  const fresh = new Sync();
  for (let g = 200; g < 210; g += 1 / 60) shift = fresh.add(g, loud(g + 0.04), levelAt, 1 / 60);
  assert.ok(Math.abs(shift - 0.04) < 0.012, `fresh lock: ${shift}`);
  // silence says nothing: the last answer is kept
  const quiet = new Sync();
  for (let g = 100; g < 110; g += 1 / 60) quiet.add(g, 0, levelAt, 1 / 60);
  assert.equal(quiet.target, null);
  const before = sync.base.shift;
  for (let g = 160; g < 170; g += 1 / 60) sync.add(g, 0, () => 0, 1 / 60);
  assert.equal(sync.base.shift, before);
});

test('feed: when frames start arriving later than they first did (a hidden engine tab), the picture follows instead of going idle', () => {
  const feed = new Feed();
  feed.scene = { live: 'A', decks: { A: { id: 't1', camelot: '8A', energy: 8, bpm: 120, firstBeat: 0, breakdowns: [] } } };
  const fr = (t) => ({ t, l: 0.3, p: 0.5, b: new Array(16).fill(120), d: { A: [t * 2, 1] } });
  let now = 1000, t = 50;
  const run = (seconds, delayMs, batch) => {
    for (let i = 0; i < seconds * 50; i += batch) {
      const list = []; for (let k = 0; k < batch; k++) { list.push(fr(t)); t += 0.02; }
      now += 20 * batch;
      feed.take(list, now + delayMs);
      for (let k = 0; k < batch; k++) feed.update(now + delayMs - 20 * (batch - 1 - k), 0.02);
    }
  };
  run(3, 5, 1);            // the first seconds: every frame arrives 5 ms after its audio
  assert.equal(feed.sig.idle, false);
  run(10, 2500, 25);       // then 2.5 s later, in batches of half a second
  assert.equal(feed.sig.idle, false, 'still drawing');
  assert.ok(Math.abs(feed.sig.level - 0.3) < 0.05, `level ${feed.sig.level}`);
  run(8, 5, 1);            // and quick again: the picture comes back to live
  const behind = (now + 5 - feed.lead) / 1000 - (t - 0.02);
  assert.ok(Math.abs(behind) < 0.05, `back to live: ${behind}`);
});

// ---------------------------------------------------------------- the morph's quality tiers
const { pickTier, lowerTier, TIERS, tierBytes } = await import('../apps/web/public/ui/visuals/morph.js');

test('morph tiers: chosen from the adapter, never one whose buffers do not fit, the address can force one', () => {
  const big = { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 2 ** 31 };
  assert.deepEqual(TIERS, { low: 250000, medium: 1000000, high: 4000000 });
  assert.equal(pickTier({ info: { vendor: 'nvidia', architecture: 'turing' }, limits: big }), 'high');
  assert.equal(pickTier({ info: { vendor: 'amd' }, limits: big }), 'high');
  assert.equal(pickTier({ info: { vendor: 'apple' }, limits: big }), 'medium');
  assert.equal(pickTier({ info: { vendor: 'intel', architecture: 'gen-12lp' }, limits: big }), 'low');
  assert.equal(pickTier({ info: {}, limits: big }), 'low', 'unknown graphics start low');
  // a buffer is 16 bytes an element: 4 M elements need 64 MB, 1 M need 16 MB
  const mid = { maxStorageBufferBindingSize: 32 * 2 ** 20, maxBufferSize: 256 * 2 ** 20 };
  assert.equal(pickTier({ info: { vendor: 'nvidia' }, limits: mid }), 'medium', 'high does not fit');
  assert.equal(pickTier({ info: { vendor: 'nvidia' }, limits: mid, want: 'high' }), 'medium', 'not even when asked for');
  assert.equal(pickTier({ info: { vendor: 'nvidia' }, limits: { maxStorageBufferBindingSize: 2 ** 31, maxBufferSize: 8 * 2 ** 20 } }), 'low', 'the smaller of the two limits counts');
  assert.equal(pickTier({ info: {}, limits: { maxStorageBufferBindingSize: 1024 } }), null, 'nothing fits: no morphing modes');
  for (const t of ['low', 'medium', 'high']) assert.equal(pickTier({ info: { vendor: 'intel' }, limits: big, want: t }), t, `?quality=${t}`);
  assert.equal(pickTier({ info: { vendor: 'nvidia' }, limits: big, want: 'ultra' }), 'high', 'an unknown name is ignored');
  assert.deepEqual(['high', 'medium', 'low'].map(lowerTier), ['medium', 'low', null], 'one step down at a time, and no lower than low');
  assert.equal(tierBytes('high'), 640000000);
});

// ---------------------------------------------------------------- low-latency audio: signalling and the session description
const { musicSdp, opusParams } = await import('../apps/web/public/ui/visuals/sdp.js');

test('musicSdp: the Opus line asks for stereo, the bitrate and no DTX, keeping what was there; other codecs are left alone', () => {
  const sdp = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9', 'a=rtpmap:111 opus/48000/2', 'a=rtcp-fb:111 transport-cc', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', 'a=fmtp:63 111/111', 'a=rtpmap:9 G722/8000', ''].join('\r\n');
  const out = musicSdp(sdp, 160);
  assert.deepEqual(opusParams(out), { minptime: '10', useinbandfec: '1', stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '160000', usedtx: '0' });
  assert.ok(out.includes('a=fmtp:63 111/111\r\n'), 'the other format lines are untouched');
  assert.equal(out.split('\r\n').length, sdp.split('\r\n').length, 'no line added or lost');
  // a line that already says otherwise is corrected, not duplicated
  const again = musicSdp(out.replace('usedtx=0', 'usedtx=1').replace('stereo=1', 'stereo=0'), 192);
  assert.equal(opusParams(again).usedtx, '0'); assert.equal(opusParams(again).stereo, '1'); assert.equal(opusParams(again).maxaveragebitrate, '192000');
  assert.equal(again.match(/usedtx/g).length, 1);
  // no format line yet: one is added after the codec
  const bare = musicSdp('m=audio 9 RTP 96\r\na=rtpmap:96 opus/48000/2\r\na=mid:0\r\n', 128);
  assert.equal(bare, 'm=audio 9 RTP 96\r\na=rtpmap:96 opus/48000/2\r\na=fmtp:96 stereo=1;sprop-stereo=1;maxaveragebitrate=128000;usedtx=0\r\na=mid:0\r\n');
  assert.equal(musicSdp('m=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n'), 'm=audio 9 RTP 0\r\na=rtpmap:0 PCMU/8000\r\n', 'no Opus: unchanged');
  assert.equal(opusParams('nothing'), null);
});

test('signalling: off by default; a place per viewer up to the cap; messages pass both ways; leaving frees the place', () => {
  const toEngine = [], seen = [];
  const hub = new VisualsHub({ library, maxListeners: 2, onSignal: (m) => toEngine.push(m), onAudience: (a) => seen.push(a.rtc) });
  const v = [viewer(), viewer(), viewer()];
  v.forEach((x, i) => hub.attach(`v${i}`, x));
  assert.equal(v[0].got[0].data.lowLatency, false);
  assert.deepEqual(hub.signalFromViewer('v0', { type: 'join' }), { ok: false, reason: 'off' });
  assert.deepEqual(v[0].got.at(-1), { event: 'rtc', data: { type: 'refuse', reason: 'off' } });
  assert.equal(toEngine.length, 0, 'the engine is not asked for anything while it is off');
  hub.setRtc({ lowLatency: true, maxListeners: 2, audioBitrate: 192 });
  assert.deepEqual(v[1].got.at(-1), { event: 'audio', data: { offered: true, lowLatency: true } });
  assert.equal(hub.signalFromViewer('nobody', { type: 'join' }).ok, false);
  assert.equal(hub.signalFromViewer('v0', { type: 'join' }).ok, true);
  assert.deepEqual(toEngine.at(-1), { type: 'join', viewer: 'v0', bitrate: 192 });
  assert.equal(hub.signalFromViewer('v1', { type: 'join' }).ok, true);
  assert.deepEqual(hub.signalFromViewer('v2', { type: 'join' }), { ok: false, reason: 'full' }, 'the third is beyond the cap');
  assert.deepEqual(v[2].got.at(-1).data, { type: 'refuse', reason: 'full' });
  assert.equal(hub.signalFromViewer('v0', { type: 'join' }).ok, true, 'asking again does not take a second place');
  assert.equal(hub.status().audio.rtcListeners, 2);
  // engine -> viewer, viewer -> engine
  assert.equal(hub.signalFromEngine({ viewer: 'v0', type: 'offer', sdp: 'OFFER' }).ok, true);
  assert.deepEqual(v[0].got.at(-1), { event: 'rtc', data: { type: 'offer', sdp: 'OFFER' } });
  assert.equal(hub.signalFromEngine({ viewer: 'v2', type: 'offer', sdp: 'X' }).ok, false, 'not to a viewer without a place');
  assert.equal(hub.signalFromViewer('v0', { type: 'answer', sdp: 'ANSWER' }).ok, true);
  assert.deepEqual(toEngine.at(-1), { type: 'answer', viewer: 'v0', sdp: 'ANSWER' });
  assert.equal(hub.signalFromViewer('v0', { type: 'ice', candidate: { candidate: 'c', sdpMid: '0' } }).ok, true);
  assert.deepEqual(toEngine.at(-1), { type: 'ice', viewer: 'v0', candidate: { candidate: 'c', sdpMid: '0' } });
  hub.signalFromEngine({ viewer: 'v0', type: 'ice', candidate: { candidate: 'e' } });
  assert.deepEqual(v[0].got.at(-1).data, { type: 'ice', candidate: { candidate: 'e' } });
  assert.equal(hub.signalFromViewer('v2', { type: 'answer', sdp: 'X' }).ok, false);
  assert.equal(hub.signalFromViewer('v0', { type: 'answer', sdp: 'x'.repeat(30000) }).ok, false, 'an oversized message is not passed on');
  assert.equal(hub.signalFromViewer('v0', { type: 'pause', deck: 'A' }).ok, false, 'nothing but signalling');
  // lowering the cap leaves those listening alone, and keeps new ones out
  hub.setRtc({ lowLatency: true, maxListeners: 1 });
  assert.equal(hub.rtc.size, 2);
  // a viewer closing its page frees its place and the engine hangs up
  hub.detach('v1');
  assert.deepEqual(toEngine.at(-1), { type: 'leave', viewer: 'v1' });
  assert.equal(hub.signalFromViewer('v2', { type: 'join' }).ok, false, 'one is listening and the cap is now one');
  hub.signalFromViewer('v0', { type: 'leave' });
  assert.deepEqual(toEngine.at(-1), { type: 'leave', viewer: 'v0' });
  assert.equal(hub.signalFromViewer('v2', { type: 'join' }).ok, true);
  // switching low latency off, or audio off, ends every direct connection
  hub.setRtc({ lowLatency: false });
  assert.deepEqual(v[2].got.slice(-2).map((g) => g.data), [{ type: 'bye' }, { offered: true, lowLatency: false }]);
  assert.deepEqual(toEngine.at(-1), { type: 'leave', viewer: 'v2' });
  assert.equal(hub.rtc.size, 0);
  hub.setRtc({ lowLatency: true }); hub.signalFromViewer('v0', { type: 'join' });
  hub.setAudio(false);
  assert.equal(hub.rtc.size, 0); assert.deepEqual(hub.signalFromViewer('v0', { type: 'join' }), { ok: false, reason: 'off' });
  assert.equal(seen.at(-1), 0);
});
