// The engine (public/engine.js) on a pretend audio context: what a note builds, how its envelopes are planned,
// voice stealing, the live scheduler and the offline render. No sound is made here; see fake-audio.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeContext, FakeOfflineContext } from './fake-audio.mjs';
import { Synth, Engine, renderWav } from '../public/engine.js';
import { initPatch, setParams } from '../lib/patch.mjs';
import { PRESETS, preset } from '../lib/presets.mjs';
import { emptySeq, normalizeSeq, parseRow } from '../lib/seq.mjs';
import { noteFreq } from '../lib/notes.mjs';
import { tau } from '../lib/envelope.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const patchWith = (values) => setParams(initPatch(), values);
const seqOf = (row, more = {}) => normalizeSeq({ ...emptySeq(), steps: parseRow(row), ...more });

test('a note builds its oscillators at the right pitches, through a filter, into the bus', () => {
  const ctx = new FakeContext();
  const synth = new Synth(ctx, patchWith({ 'osc1.octave': -1, 'osc2.level': 0.5, 'osc2.semi': 7, 'osc2.fine': 5, 'mix.sub': 0.4, 'mix.noise': 0.2, 'filter.cutoff': 1000, 'filter.keytrack': 1 }));
  const v = synth.noteOn(72, 1, 0.5);
  assert.equal(v.oscs.length, 3);                                      // two oscillators and the sub
  assert.equal(v.sources.length, 4);                                   // and the noise
  near(v.oscs[0].frequency.value, noteFreq(60));
  near(v.oscs[1].frequency.value, noteFreq(79));
  assert.equal(v.oscs[1].detune.value, 5);
  near(v.oscs[2].frequency.value, noteFreq(48));                       // the sub: an octave under oscillator 1
  assert.deepEqual(v.oscs.map((o) => o.type), ['sawtooth', 'sawtooth', 'sine']);
  assert.ok(v.sources.every((s) => s.started === 0.5 && s.stopped === null));
  near(v.filter.frequency.value, 2000);                                // an octave above middle C, tracked fully
  assert.deepEqual(v.filter.to, [v.amp]);
  assert.deepEqual(v.amp.to, [synth.bus]);
  assert.ok(synth.lfoPitch.to.includes(v.oscs[0].detune) && synth.lfoFilter.to.includes(v.filter.detune));
});

test('unison makes copies spread around the pitch; glide slides from the note before', () => {
  const ctx = new FakeContext();
  const synth = new Synth(ctx, patchWith({ 'voice.unison': 3, 'voice.detune': 20, 'voice.glide': 0.1 }));
  const a = synth.noteOn(60, 0.8, 0);
  assert.deepEqual(a.oscs.map((o) => o.detune.value), [-20, 0, 20]);
  near(a.levels.osc1.gain.value, 0.8 / Math.sqrt(3));
  assert.equal(a.oscs[0].frequency.events.length, 0);                  // the first note has nowhere to slide from
  const b = synth.noteOn(67, 0.8, 1);
  const [from, to] = b.oscs[0].frequency.events;
  near(from.value, noteFreq(60)); assert.equal(from.at, 1);
  near(to.value, noteFreq(67)); near(to.at, 1.1); assert.equal(to.kind, 'exp');
});

test('the envelopes are planned as the envelope maths says, and a release starts from where the level is', () => {
  const ctx = new FakeContext();
  const synth = new Synth(ctx, patchWith({ 'aenv.attack': 0.1, 'aenv.decay': 0.4, 'aenv.sustain': 0.5, 'aenv.release': 0.2, 'filter.env': 2, 'fenv.attack': 0.01 }));
  const v = synth.play(60, 1, 1, 2);                                   // let go in the sustain
  const amp = v.amp.gain.events;
  assert.deepEqual(amp.map((e) => e.kind), ['set', 'ramp', 'target', 'set', 'target']);
  near(amp[1].value, v.peak); near(amp[1].at, 1.1);
  near(amp[2].value, v.peak * 0.5); near(amp[2].tau, tau(0.4));
  near(amp[3].value, v.peak * 0.5, 1e-4); assert.equal(amp[3].at, 3);
  assert.equal(amp[4].value, 0); near(amp[4].tau, tau(0.2));
  assert.equal(v.releaseAt, 3);
  near(v.end, 3 + 0.4 + 0.02);
  assert.ok(v.sources.every((s) => s.stopped === v.end));
  assert.equal(v.filter.detune.events[1].value, 2400);                 // two octaves, in cents

  const short = synth.play(64, 1, 5, 0.05);                            // let go half way up the attack
  assert.deepEqual(short.amp.gain.events.map((e) => e.kind), ['set', 'ramp', 'target']);
  near(short.amp.gain.events[1].value, short.peak * 0.5); near(short.amp.gain.events[1].at, 5.05);
  assert.equal(short.amp.gain.events[2].value, 0);

  const softer = synth.noteOn(60, 0.3, 8);
  assert.ok(softer.peak < v.peak);
  synth.noteOff(softer, 8);                                            // let go at once: still held for 5 ms
  near(softer.releaseAt, 8.005);
  synth.noteOff(softer, 9);                                            // a second release changes nothing
  near(softer.releaseAt, 8.005);
});

test('a ninth note cuts the oldest voice short, and every preset plays without a complaint from the context', () => {
  for (const { patch } of PRESETS) {
    const ctx = new FakeContext();
    const synth = new Synth(ctx, patch);
    const voices = Array.from({ length: 8 }, (_, i) => synth.noteOn(48 + i, 0.8, i * 0.01));
    const ninth = synth.noteOn(72, 0.8, 1);
    assert.equal(voices[0].end, 1.03, patch.name);
    assert.ok(voices[0].sources.every((s) => s.stopped === 1.03));
    assert.deepEqual(voices[0].amp.gain.events.at(-1), { kind: 'target', value: 0, at: 1, tau: 0.004 });
    assert.ok(voices.slice(1).every((v) => v.end === Infinity) && ninth.end === Infinity);
    synth.noteOff(voices[0], 2);                                       // its key comes up later: nothing more happens
    assert.equal(voices[0].end, 1.03);
    ctx.currentTime = 1.5;
    synth.silence();
    assert.ok(synth.voices.every((v) => v.end <= 1.53));
    ctx.currentTime = 3;
    synth.prune();
    assert.equal(synth.voices.length, 0);
    assert.equal(synth.lfoPitch.to.length, 0, 'the ended voices are unhooked from the LFO');
  }
});

test('a patch change reaches the effects, the LFO and the notes that are sounding', () => {
  const ctx = new FakeContext();
  const synth = new Synth(ctx, initPatch());
  assert.equal(synth.master.gain.value, 0.7 ** 2);
  assert.equal(synth.delaySend.gain.value, 0);
  assert.equal(synth.lfoPitch.gain.value, 0);
  const firstReverb = synth.reverb;
  assert.equal(firstReverb.buffer.length, 2 * 44100);
  assert.ok(firstReverb.buffer.getChannelData(1).some((x) => x !== 0));
  const v = synth.noteOn(60, 0.8, 0);
  ctx.currentTime = 1;
  synth.setPatch(patchWith({ 'filter.cutoff': 500, 'filter.keytrack': 0, 'delay.mix': 0.4, 'lfo.dest': 'amp', 'lfo.depth': 0.5, 'lfo.shape': 'square', 'reverb.size': 4, 'osc1.level': 0.4 }));
  assert.deepEqual(v.filter.frequency.events.at(-1), { kind: 'target', value: 500, at: 1, tau: 0.02 });
  assert.equal(v.levels.osc1.gain.events.at(-1).value, 0.4);
  assert.equal(synth.delaySend.gain.events.at(-1).value, 0.4);
  assert.equal(synth.lfoAmp.gain.events.at(-1).value, 0.25);
  assert.equal(synth.bus.gain.events.at(-1).value, 0.75);              // the tremolo swings between 0.5 and 1
  assert.equal(synth.lfo.type, 'square');
  assert.notEqual(synth.reverb, firstReverb);
  assert.equal(synth.reverb.buffer.length, 4 * 44100);
  assert.deepEqual(synth.reverbSend.to, [synth.reverb]);
});

test('the live scheduler plays each note of the sequence once, on time, and stops after the loops asked for', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const ctx = new FakeContext();
  const seq = seqOf('C2 . C3 - | Eb2+G2 . . G2 | . . . . | . . . Bb2', { bpm: 120, gate: 0.5 });
  const engine = new Engine(() => ({ patch: preset('pluck'), seq }));
  engine.ctx = ctx;                                                    // a real page makes its own AudioContext in wake()
  engine.miniclaude = new Synth(ctx, preset('pluck'));
  const played = [];
  const { play } = engine.miniclaude;
  engine.miniclaude.play = (note, vel, time, seconds) => { played.push([Number((time - 0.08).toFixed(4)), note, Number(seconds.toFixed(4))]); return play.call(engine.miniclaude, note, vel, time, seconds); };
  let changes = 0;
  engine.onChange = () => changes++;
  engine.start(2);
  assert.equal(engine.playing, true);
  for (let i = 0; i < 400 && engine.playing; i++) { ctx.currentTime += 0.013; t.mock.timers.tick(25); }
  assert.equal(engine.playing, false);
  assert.equal(changes, 2);
  const bar = [[0, 36, 0.0625], [0.25, 48, 0.1875], [0.5, 39, 0.0625], [0.5, 43, 0.0625], [0.875, 43, 0.0625], [1.875, 46, 0.0625]];
  assert.deepEqual(played, [...bar, ...bar.map(([at, note, len]) => [at + 2, note, len])]);

  engine.noteOn(60);                                                   // a key by hand
  engine.noteOn(60);
  assert.equal(engine.held.size, 1);
  const voice = engine.held.get(60);
  engine.noteOff(60);
  assert.notEqual(voice.releaseAt, Infinity);
  engine.sound([60, 64, 67], 1.5);
  assert.equal(engine.miniclaude.voices.filter((v) => v.end > ctx.currentTime + 1).length, 3);
  engine.panic();
  assert.ok(engine.miniclaude.voices.every((v) => v.end <= ctx.currentTime + 0.03));
});

test('the offline render lays the same notes out on its own context and returns a WAV of the right length', async (t) => {
  globalThis.OfflineAudioContext = FakeOfflineContext;
  t.after(() => { delete globalThis.OfflineAudioContext; });
  const patch = patchWith({ 'aenv.release': 0.25, 'reverb.mix': 0, 'delay.mix': 0 });
  const seq = seqOf('C2 . C3 - | Eb2+G2 . . G2 | . . . . | . . . Bb2', { bpm: 120 });
  const wav = await renderWav(patch, seq, 2);
  const seconds = 2 * 2 + 0.5 + 0.5;                                   // two bars at 120, and the tail
  assert.equal(wav.type, 'audio/wav');
  assert.equal(wav.size, 44 + Math.ceil(seconds * 44100) * 4);
  const ctx = FakeOfflineContext.last;
  const starts = ctx.of('oscillator').filter((o) => o.type === 'sawtooth').map((o) => o.started).sort((a, b) => a - b);
  assert.deepEqual(starts, [0, 0.25, 0.5, 0.5, 0.875, 1.875, 2, 2.25, 2.5, 2.5, 2.875, 3.875]);
  assert.ok(ctx.of('oscillator').every((o) => o.stopped !== null || o.type === 'sine'));   // only the LFO runs on
  const long = await renderWav(preset('warm pad'), seq, 1);
  assert.equal(long.size, 44 + Math.ceil((2 + 8) * 44100) * 4);        // a long release and a big room: the tail is capped
});
