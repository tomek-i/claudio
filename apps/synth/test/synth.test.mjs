// The parts of the synth that are plain arithmetic: notes, envelopes, the patch schema, the presets, the
// sequencer and who loses a voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteFreq, noteName, parseNote, isBlack } from '../lib/notes.mjs';
import { envLevel, envEnd, tau } from '../lib/envelope.mjs';
import { PARAMS, GROUPS, initPatch, normalizePatch, setParams, paramDef, format, toSlider, fromSlider, patchText, paramsText, groupOf } from '../lib/patch.mjs';
import { PRESETS, KINDS, preset } from '../lib/presets.mjs';
import { STEPS, emptySeq, normalizeSeq, parseRow, rowText, seqText, applySeqOp, notesInWindow, stepSeconds } from '../lib/seq.mjs';
import { voiceToSteal, MAX_VOICES } from '../lib/voices.mjs';
import { encodeWav } from '../lib/wav.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const seqOf = (row, more = {}) => normalizeSeq({ ...emptySeq(), steps: parseRow(row), ...more });

test('a note is a frequency and a name', () => {
  assert.equal(noteFreq(69), 440);
  near(noteFreq(60), 261.6256, 1e-3);
  near(noteFreq(81), 880);
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(0), 'C-1');
  assert.equal(noteName(127), 'G9');
  for (const [text, note] of [['C4', 60], ['c4', 60], ['A4', 69], ['Eb2', 39], ['F#3', 54], ['Db3', 49], ['C-1', 0], ['36', 36]]) assert.equal(parseNote(text), note, text);
  for (let n = 0; n <= 127; n++) assert.equal(parseNote(noteName(n)), n);
  for (const bad of ['H2', 'C', 'C10', '200', 'x']) assert.throws(() => parseNote(bad), /note|range/, bad);
  assert.deepEqual([60, 61, 62, 63, 64].map(isBlack), [false, true, false, true, false]);
});

test('an envelope rises, settles on the sustain level and dies away from wherever it was let go', () => {
  const env = { attack: 0.1, decay: 0.4, sustain: 0.5, release: 0.2 };
  assert.equal(envLevel(env, 0), 0);
  assert.equal(envLevel(env, -1), 0);
  near(envLevel(env, 0.05), 0.5);
  near(envLevel(env, 0.1), 1);
  near(envLevel(env, 0.1 + tau(0.4)), 0.5 + 0.5 / Math.E);
  near(envLevel(env, 5), 0.5, 1e-4);
  // let go in the sustain: from 0.5 down
  near(envLevel(env, 3, 3), 0.5, 1e-4);
  near(envLevel(env, 3 + tau(0.2), 3), 0.5 / Math.E, 1e-4);
  // let go half way up the attack: the release starts from 0.5, not from the top
  near(envLevel(env, 0.05, 0.05), 0.5);
  assert.ok(envLevel(env, 0.06, 0.05) < 0.5);
  assert.ok(envLevel(env, envEnd(env, 3), 3) < 0.001);
  // it never jumps
  let last = 0;
  for (let t = 0; t < 4; t += 0.001) { const v = envLevel(env, t, 2); assert.ok(Math.abs(v - last) < 0.02, `a jump at ${t}`); last = v; }
});

test('the schema: every parameter has a section, a default in range, and a slider that comes back to its value', () => {
  assert.equal(PARAMS.length, 37);
  assert.equal(new Set(PARAMS.map((p) => p.id)).size, PARAMS.length);
  for (const def of PARAMS) {
    assert.ok(GROUPS.some((g) => g.id === groupOf(def.id)), def.id);
    if (def.options) { assert.ok(def.options.includes(def.def), def.id); continue; }
    assert.ok(def.def >= def.min && def.def <= def.max, def.id);
    assert.equal(fromSlider(def, 0), def.min, def.id);
    assert.equal(fromSlider(def, 1), def.max, def.id);
    for (const value of [def.min, def.def, def.max]) near(fromSlider(def, toSlider(def, value)), value, def.step, def.id);
    assert.ok(format(def.id, def.def).length > 0);
  }
  const cutoff = paramDef('filter.cutoff');
  near(fromSlider(cutoff, 0.5), Math.sqrt(20 * 18000), 1);          // half way along is half way in octaves
  assert.equal(format('filter.cutoff', 320), '320 Hz');
  assert.equal(format('filter.cutoff', 2400), '2.40 kHz');
  assert.equal(format('aenv.attack', 0.005), '5 ms');
  assert.equal(format('aenv.release', 2.2), '2.20 s');
  assert.equal(format('osc2.fine', 7), '+7 ct');
  assert.equal(format('filter.resonance', 0.78), '78%');
});

test('a patch is made well-formed: missing values are defaults, numbers are pulled into range', () => {
  const patch = normalizePatch({ name: '  Mine  ', 'filter.cutoff': 999999, 'osc1.wave': 'banana', 'osc1.octave': 1.4, 'aenv.attack': 'x', 'lfo.dest': 'filter', extra: 1 });
  assert.equal(patch.name, 'Mine');
  assert.equal(patch['filter.cutoff'], 18000);
  assert.equal(patch['osc1.wave'], 'saw');
  assert.equal(patch['osc1.octave'], 1);
  assert.equal(patch['aenv.attack'], 0.005);
  assert.equal(patch['lfo.dest'], 'filter');
  assert.equal(patch.extra, undefined);
  assert.deepEqual(Object.keys(patch), ['name', ...PARAMS.map((p) => p.id)]);
  assert.deepEqual(normalizePatch(patch), patch);
  assert.throws(() => normalizePatch(null), /not a patch/);
});

test('setting parameters: by full name or by a last part that is not shared, in percent, refused with a reason', () => {
  const init = initPatch();
  const patch = setParams(init, { 'filter.cutoff': '800', resonance: '60%', 'osc2.wave': 'Square', glide: 0.1 });
  assert.equal(patch['filter.cutoff'], 800);
  assert.equal(patch['filter.resonance'], 0.6);
  assert.equal(patch['osc2.wave'], 'square');
  assert.equal(patch['voice.glide'], 0.1);
  assert.equal(init['filter.cutoff'], 2400);                           // the patch given is not touched
  assert.throws(() => setParams(init, { level: 0.5 }), /which "level"\? osc1\.level, osc2\.level/);
  assert.throws(() => setParams(init, { 'filter.cutof': 1 }), /filter has: cutoff, resonance, env, keytrack/);
  assert.throws(() => setParams(init, { 'wobble.rate': 1 }), /the sections are/);
  assert.throws(() => setParams(init, { 'filter.cutoff': 5 }), /goes from 20 to 18000 Hz/);
  assert.throws(() => setParams(init, { 'filter.cutoff': 'bright' }), /needs a number/);
  assert.throws(() => setParams(init, { 'osc1.wave': 'pulse' }), /one of: sine, triangle, saw, square/);
  assert.throws(() => setParams(init, {}), /nothing to set/);
});

test('a patch as text names every parameter the way `set` takes it', () => {
  const text = patchText(preset('acid bass'));
  assert.match(text, /^osc1 {4}wave saw {3}octave -1 {3}semi 0 {3}fine 0 {3}level 0\.8$/m);
  assert.match(text, /^filter {2}cutoff 320 {3}resonance 0\.78 {3}env 3\.6 {3}keytrack 0\.3$/m);
  assert.equal(text.split('\n').length, GROUPS.length);
  assert.equal(patchText(initPatch(), ['lfo']), 'lfo     rate 5   shape sine   depth 0   dest pitch');
  assert.equal(paramsText().split('\n').length, PARAMS.length);
});

test('the presets are well-formed, differ from each other and cover every kind', () => {
  assert.ok(PRESETS.length >= 10);
  assert.deepEqual([...new Set(PRESETS.map((p) => p.kind))].sort(), [...KINDS].sort());
  assert.equal(new Set(PRESETS.map((p) => JSON.stringify({ ...p.patch, name: '' }))).size, PRESETS.length);
  for (const { patch } of PRESETS) {
    assert.deepEqual(normalizePatch(patch), patch, patch.name);
    assert.ok(patch['osc1.level'] + patch['osc2.level'] + patch['mix.sub'] + patch['mix.noise'] > 0, `${patch.name} makes a sound`);
  }
  assert.equal(preset('warm').name, 'Warm pad');
  assert.equal(preset('PLUCK').name, 'Pluck');
  assert.throws(() => preset('trombone'), /there are: Acid bass/);
});

test('a row of text is sixteen steps, and comes back as the same text', () => {
  const row = 'C2 . C3 - | Eb2+G2 . C3! G2:50 | C2 - - - | . G2 Bb2 -';
  const seq = seqOf(row);
  assert.deepEqual(seq.steps[0], { notes: [36], vel: 0.8, len: 1 });
  assert.deepEqual(seq.steps[2], { notes: [48], vel: 0.8, len: 2 });
  assert.equal(seq.steps[3], null);
  assert.deepEqual(seq.steps[4], { notes: [39, 43], vel: 0.8, len: 1 });
  assert.equal(seq.steps[6].vel, 1);
  assert.equal(seq.steps[7].vel, 0.5);
  assert.equal(seq.steps[8].len, 4);
  assert.equal(rowText(seq), row);
  assert.deepEqual(parseRow(rowText(seq)), seq.steps);
  assert.match(seqText(seq), /^seq {5}120 bpm {3}gate 0\.6 {3}swing 0\n {8}C2 \. C3 -/);
  // a short row is repeated
  assert.equal(rowText(seqOf('C2 . G2 -')), 'C2 . G2 - | C2 . G2 - | C2 . G2 - | C2 . G2 -');
  assert.equal(rowText(seqOf('.')), '. . . . | . . . . | . . . . | . . . .');
  assert.throws(() => parseRow('C2 D2 E2'), /16 steps/);
  assert.throws(() => parseRow('- C2 . .'), /tie/);
  assert.throws(() => parseRow('C2 . - .'), /tie/);
  assert.throws(() => parseRow('C2 H2 . .'), /not a note/);
  assert.throws(() => parseRow('C2:0 . . .'), /velocity/);
});

test('edits to the sequence: one step, a tie, the tempo, transposing', () => {
  let seq = seqOf('C2 . . . | . . . . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'step', step: 4, token: 'Eb2+G2!' });
  seq = applySeqOp(seq, { op: 'step', step: 5, token: '-' });
  seq = applySeqOp(seq, { op: 'step', step: 6, token: '-' });
  assert.equal(rowText(seq), 'C2 . . . | Eb2+G2! - - . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'step', step: 5, notes: [50] });        // a note written into a tie ends the tie there
  assert.equal(rowText(seq), 'C2 . . . | Eb2+G2! D3 . . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'step', step: 3, token: '-' });          // a tie reaches back over rests to the note before
  assert.equal(rowText(seq), 'C2 - - - | Eb2+G2! D3 . . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'step', step: 2, token: '.' });          // a rest written into a tie ends it too
  assert.equal(rowText(seq), 'C2 - . . | Eb2+G2! D3 . . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'transpose', by: 12 });
  assert.equal(rowText(seq), 'C3 - . . | Eb3+G3! D4 . . | . . . . | . . . .');
  seq = applySeqOp(seq, { op: 'seqparam', key: 'bpm', value: 999 });
  assert.equal(seq.bpm, 240);
  assert.equal(applySeqOp(seq, { op: 'seqparam', key: 'gate', value: 0.9 }).gate, 0.9);
  assert.equal(rowText(applySeqOp(seq, { op: 'clearseq' })), rowText(emptySeq()));
  assert.throws(() => applySeqOp(emptySeq(), { op: 'step', step: 0, token: '-' }), /no note before step 1/);
  assert.throws(() => applySeqOp(seq, { op: 'step', step: 16, token: 'C2' }), /a step is 1 to 16/);
  assert.throws(() => applySeqOp(seq, { op: 'transpose', by: 100 }), /out of range/);
  assert.throws(() => applySeqOp(seq, { op: 'seqparam', key: 'bpm', value: 'fast' }), /needs a number/);
  assert.throws(() => applySeqOp(seq, { op: 'nope' }), /no such edit/);
});

test('which notes start in a window: once each, however the window is cut up, loop after loop', () => {
  const seq = seqOf('C2 . C3 - | Eb2+G2 . . G2 | . . . . | . . . Bb2', { gate: 0.5 });
  const first = notesInWindow(seq, 0, STEPS);
  assert.deepEqual(first.map((n) => [n.pos, n.note]), [[0, 36], [2, 48], [4, 39], [4, 43], [7, 43], [15, 46]]);
  assert.equal(first[0].len, 0.5);                                     // one step, held for the gate
  assert.equal(first[1].len, 1.5);                                     // tied over one more
  assert.deepEqual(notesInWindow(seq, 16, 17).map((n) => n.pos), [16]);
  assert.equal(notesInWindow(seq, 0, 64).length, 24);
  assert.equal(notesInWindow(seq, 0, 64, { lastLoop: 1 }).length, 12);
  // a scheduler asks in small uneven slices and must get every note exactly once
  const sliced = [];
  for (let from = 0, to; from < 48; from = to) { to = Math.min(48, from + 0.37 + (from % 1.3)); sliced.push(...notesInWindow(seq, from, to)); }
  assert.deepEqual(sliced.map((n) => [n.pos, n.note]), notesInWindow(seq, 0, 48).map((n) => [n.pos, n.note]));
  // swing: the off steps are late by half a step at 100%
  const swung = notesInWindow({ ...seq, swing: 1 }, 0, 16);
  assert.deepEqual(swung.map((n) => n.pos), [0, 2, 4, 4, 7.5, 15.5]);
  assert.equal(stepSeconds(120), 0.125);
});

test('the ninth note takes a voice: one that is dying away first, otherwise the oldest', () => {
  const held = (start) => ({ start, releaseAt: Infinity, end: Infinity });
  const voices = Array.from({ length: MAX_VOICES }, (_, i) => held(i));
  assert.equal(voiceToSteal(voices.slice(1), 10), null);               // seven: there is room
  assert.equal(voiceToSteal(voices, 10), voices[0]);                   // eight held: the oldest goes
  voices[5] = { start: 5, releaseAt: 8, end: 12 };
  voices[6] = { start: 6, releaseAt: 7, end: 12 };
  assert.equal(voiceToSteal(voices, 10), voices[6]);                   // the one let go longest ago
  assert.equal(voiceToSteal(voices, 12), null);                        // both have ended by then
  assert.equal(voiceToSteal(voices, 7.5), voices[6]);                  // at 7.5 only that one has been let go
  assert.equal(voiceToSteal(voices, 6.5), voices[0]);                  // before any release: the oldest again
});

test('a WAV file has its header and its samples', () => {
  const wav = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), new Float32Array([0, 0.5, -0.5, 0]), 44100));
  assert.equal(wav.byteLength, 44 + 16);
  assert.equal(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4)), 'RIFF');
  assert.equal(wav.getUint32(24, true), 44100);
  assert.equal(wav.getUint16(22, true), 2);
  assert.equal(wav.getInt16(44 + 4, true), 32767);
  assert.equal(wav.getInt16(44 + 6, true), 16383);
  assert.equal(wav.getInt16(44 + 8, true), -32767);
  assert.equal(wav.getInt16(44 + 12, true), 32767);                    // a sample over full scale is held at it
});
