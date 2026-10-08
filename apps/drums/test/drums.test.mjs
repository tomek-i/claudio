// The drum machine's timing, patterns, groove tools and MIDI export: the parts with no browser in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, VOICE_IDS } from '../lib/kit.mjs';
import { MAX_EARLY, beatName, beatSteps, hitPos, hitTime, hitsInWindow, stepSeconds, swingDelay } from '../lib/timing.mjs';
import { applyOp, emptyPattern, normalizePattern, parseRow, resize, toText } from '../lib/pattern.mjs';
import { FEELS, continuePattern, humanize, morph, variations } from '../lib/groove.mjs';
import { PRESETS, preset } from '../lib/presets.mjs';
import { PPQ, toMidi } from '../lib/midi.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const beat = (...lines) => applyOp(emptyPattern('test'), { op: 'write', lines });
const hits = (p) => p.tracks.flatMap((t) => t.vel.map((v, s) => (v > 0 ? `${t.voice}${s}` : null)).filter(Boolean));

test('at 90 BPM a sixteenth is 166.7 ms, and 50% swing puts every second step 41.7 ms late', () => {
  near(stepSeconds(90) * 1000, 166.667, 0.001);
  near(swingDelay(1, 0.5, 90) * 1000, 41.667, 0.001);
  assert.equal(swingDelay(2, 0.5, 90), 0);
  near(hitTime(3, { bpm: 90, swing: 0.5 }, 0.1), (3 + 0.25 + 0.1) * stepSeconds(90));
});

test('a hit is never more than 0.4 of a step early', () => {
  assert.equal(hitPos(4, 0, -0.9), 4 - MAX_EARLY);
  near(hitTime(4, { bpm: 90, swing: 0 }, -0.9), (4 - 0.4) * stepSeconds(90));
  assert.equal(normalizePattern({ tracks: [{ voice: 'kick', vel: [1], off: [-3] }] }).tracks[0].off[0], -MAX_EARLY);
});

test('the window finds each hit once, across the loop point, and early hits at the end of the loop before', () => {
  let p = beat('kick x...x...x...x...', 'hat .x.x.x.x.x.x.x.x');
  p = applyOp(p, { op: 'step', track: 'kick', step: 0, off: -0.2 });
  p.swing = 0.5;
  const all = [];
  for (let from = 0; from < 48; from += 0.37) all.push(...hitsInWindow(p, from, Math.min(48, from + 0.37)));
  assert.equal(all.length, 12 * 3);                // the first early kick is before the start; the fourth loop's is in
  assert.deepEqual(all.map((h) => h.pos), [...all.map((h) => h.pos)].sort((a, b) => a - b));
  assert.ok(all.some((h) => h.voice === 'kick' && Math.abs(h.pos - 15.8) < 1e-9));
  near(all.find((h) => h.voice === 'hat').pos, 1.25);
  assert.equal(hitsInWindow(p, 0, 100, { lastLoop: 0 }).length, 11);
});

test('the ruler: a beat every four steps, named bar.beat, with a second bar in a 32-step pattern', () => {
  assert.deepEqual(beatSteps(16).map(beatName), ['1.1', '1.2', '1.3', '1.4']);
  assert.deepEqual(beatSteps(32), [0, 4, 8, 12, 16, 20, 24, 28]);
  assert.deepEqual(beatSteps(32).map(beatName), ['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4']);
  assert.equal(beatName(11), '1.3');               // any step of a beat has the beat's name
  assert.equal(beatName(16), '2.1');
});

test('started on a beat, the steps before it are not played, and the loop comes round whole', () => {
  let p = beat('kick x...x...x...x...', 'hat ...x...x...x...x');
  p = applyOp(p, { op: 'step', track: 'hat', step: 7, off: 0.5 });      // late enough to sound inside the window before beat 3
  p = applyOp(p, { op: 'step', track: 'kick', step: 8, off: -0.3 });    // beat 3's own kick, pulled early: it is played
  p.swing = 0.5;
  const from = 8;
  assert.ok(hitsInWindow(p, from - MAX_EARLY, 16).some((h) => h.step === 7), 'without a start step the late hat is in the window');
  const first = hitsInWindow(p, from - MAX_EARLY, 16, { firstStep: from });
  assert.deepEqual(first.map((h) => `${h.voice}${h.step}`), ['kick8', 'hat11', 'kick12', 'hat15']);
  near(first[0].pos, 7.7);
  const second = hitsInWindow(p, 16, 32, { firstStep: from });
  assert.equal(second.length, 8);                  // every hit of the loop after, the ones before beat 3 too
  assert.deepEqual(hitsInWindow(p, 0, 48), hitsInWindow(p, 0, 48, { firstStep: 0 }));
});

test('muted rows are silent, and a solo silences the rest', () => {
  let p = beat('kick x...............', 'snare ....x...........', 'hat x.x.............');
  assert.equal(hitsInWindow(applyOp(p, { op: 'track', track: 'hat', key: 'mute', value: true }), 0, 16).length, 2);
  p = applyOp(p, { op: 'track', track: 'snare', key: 'solo', value: true });
  assert.deepEqual(hitsInWindow(p, 0, 16).map((h) => h.voice), ['snare']);
});

test('rows are read and written as text', () => {
  assert.deepEqual(parseRow('hihat: x.o.|g.X.|....|....').vel.slice(0, 8), [0.8, 0, 0.55, 0, 0.3, 0, 1, 0]);
  assert.throws(() => parseRow('kick x.x'), /16 or 32/);
  assert.throws(() => parseRow('gong x...x...x...x...'), /no voice/);
  const p = applyOp(beat('kick x...x...x...x...', 'snare ....X.......X..g'), { op: 'step', track: 'snare', step: 4, off: 0.12 });
  const text = toText(p);
  assert.match(text, /kick\s+x\.\.\.x\.\.\.x\.\.\.x\.\.\./);
  assert.match(text, /snare\s+\.\.\.\.X\.\.\.\.\.\.\.X\.\.g\s+off the grid: 5 \+\d+ms/);
  assert.equal(p.tracks.length, VOICE_IDS.length);
});

test('16 steps become 32 by playing the bar twice; a 32-step row makes the pattern 32 steps', () => {
  const p = beat('kick x..x............');
  assert.deepEqual(hits(resize(p, 32)), ['kick0', 'kick3', 'kick16', 'kick19']);
  assert.deepEqual(hits(resize(resize(p, 32), 16)), hits(p));
  assert.equal(applyOp(p, { op: 'write', lines: [`snare ${'....x...'.repeat(4)}`] }).steps, 32);
});

test('quantize is what a plain grid does: offsets gone, four velocity levels', () => {
  const p = humanize(beat('kick x...x...x...x...', 'hat xxxxxxxxxxxxxxxx'), { feel: 'drunk', amount: 1, seed: 3 });
  assert.ok(p.tracks.some((t) => t.off.some((o) => o !== 0)));
  const q = applyOp(p, { op: 'quantize' });
  assert.ok(q.tracks.every((t) => t.off.every((o) => o === 0)));
  assert.ok(q.tracks.every((t) => t.vel.every((v) => v === 0 || Object.values(LEVELS).includes(v))));
});

test('humanize moves hits and never adds or removes one; the same seed gives the same beat', () => {
  const p = beat('kick x......x..x.....', 'snare ....X.......X..g', 'hat x.x.x.x.x.x.x.x.');
  for (const feel of Object.keys(FEELS)) {
    const h = humanize(p, { feel, amount: 1, seed: 11 });
    assert.deepEqual(hits(h), hits(p), feel);
    assert.deepEqual(h, humanize(p, { feel, amount: 1, seed: 11 }));
    assert.deepEqual(humanize(h, { feel, amount: 1, seed: 11 }), h, 'a second pass starts from the grid');
    assert.equal(h.tracks[0].off[0], 0, 'the first kick holds the time');
  }
  const laid = humanize(p, { feel: 'laidback', amount: 1, seed: 5 }).tracks.find((t) => t.voice === 'snare');
  assert.ok(laid.off[4] > 0 && laid.off[12] > 0, 'a laid-back snare is late');
  assert.throws(() => humanize(p, { feel: 'wonky' }), /no feel/);
});

test('variations differ from the beat, keep its bones when tame, and change more when wild', () => {
  const p = PRESETS[0];
  const changed = (v) => v.tracks.reduce((n, t, i) => n + t.vel.filter((x, s) => (x > 0) !== (p.tracks[i].vel[s] > 0)).length, 0);
  const tame = variations(p, { wild: 0.2, seed: 9 });
  const wild = variations(p, { wild: 1, seed: 9 });
  assert.equal(tame.length, 4);
  for (const v of tame) {
    assert.notDeepEqual(v, p);
    assert.ok(v.tracks[0].vel[0] > 0 && v.tracks[1].vel[4] > 0 && v.tracks[1].vel[12] > 0, 'kick on one and the backbeat stay');
  }
  assert.ok(wild.reduce((n, v) => n + changed(v), 0) > tame.reduce((n, v) => n + changed(v), 0));
  assert.deepEqual(variations(p, { wild: 0.5, seed: 4 }), variations(p, { wild: 0.5, seed: 4 }));
});

test('continue writes a second bar that starts like the first and ends in a fill', () => {
  const p = PRESETS[0];
  const c = continuePattern(p, { seed: 2 });
  assert.equal(c.steps, 32);
  assert.deepEqual(c.tracks.map((t) => t.vel.slice(0, 16)), p.tracks.map((t) => t.vel));
  assert.notDeepEqual(c.tracks.map((t) => t.vel.slice(28)), p.tracks.map((t) => t.vel.slice(12)));
  assert.equal(continuePattern(c, { seed: 2 }).steps, 32);
});

test('a morph is the first beat at 0, the second at 1, and changes a few hits at a time between', () => {
  const [a, b] = [preset('boom bap'), preset('house')];
  assert.deepEqual({ ...morph(a, b, 0), name: '' }, { ...a, name: '' });
  assert.deepEqual({ ...morph(a, b, 1), name: '' }, { ...b, name: '' });
  const only = (x, y) => hits(x).filter((h) => !hits(y).includes(h));
  let fromA = only(a, b).length;
  let fromB = 0;
  for (let t = 0.1; t <= 1; t += 0.1) {
    const m = morph(a, b, t);
    const [keptA, gotB] = [hits(m).filter((h) => only(a, b).includes(h)).length, hits(m).filter((h) => only(b, a).includes(h)).length];
    assert.ok(keptA <= fromA && gotB >= fromB, 'hits leave and arrive, and never come back');
    [fromA, fromB] = [keptA, gotB];
  }
  near(morph(a, b, 0.5).bpm, 107);
});

test('every preset is a full pattern with a name of its own', () => {
  assert.equal(PRESETS.length, 8);
  assert.equal(new Set(PRESETS.map((p) => p.name)).size, 8);
  for (const p of PRESETS) {
    assert.deepEqual(normalizePattern(p), p);
    assert.ok(hits(p).length >= 8, p.name);
  }
  assert.equal(preset('trap').bpm, 140);
  assert.throws(() => preset('polka'), /no preset/);
});

test('the MIDI file has every hit, with the swing in its note positions', () => {
  const p = { ...beat('kick x...............', 'hat .x..............'), bpm: 120, swing: 0.5 };
  const bytes = toMidi(p, { loops: 2 });
  assert.equal(Buffer.from(bytes.slice(0, 4)).toString(), 'MThd');
  assert.equal((bytes[12] << 8) | bytes[13], PPQ);
  assert.equal((bytes[18] << 24 | bytes[19] << 16 | bytes[20] << 8 | bytes[21]) + 22, bytes.length);
  // walk the track: delta times are one or two bytes here
  const ons = [];
  let i = 22;
  let tick = 0;
  while (i < bytes.length) {
    let delta = 0;
    while (bytes[i] & 0x80) delta = (delta << 7) | (bytes[i++] & 0x7f);
    delta = (delta << 7) | bytes[i++];
    tick += delta;
    if (bytes[i] === 0xff) { i += 3 + bytes[i + 2]; continue; }
    if (bytes[i] === 0x99) ons.push([tick, bytes[i + 1]]);
    i += 3;
  }
  assert.deepEqual(ons, [[0, 36], [150, 42], [1920, 36], [2070, 42]]);   // step 2 is 120 ticks, and 30 late
  assert.equal(tick, 2 * 16 * 120);
});
