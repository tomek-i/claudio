// The project and its edits, notes as text, and the song as text: the parts with no browser and no server in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BARS, applyOp, emptyProject, findClip, fits, normalizeProject, parseRow, trackOf } from '../lib/project.mjs';
import { HIGH, LOW, formatNotes, noteHz, noteName, noteNumber, parseNotes } from '../lib/notes.mjs';
import { VOICE_IDS } from '../lib/kit.mjs';
import { PRESET_IDS, PRESETS } from '../lib/presets.mjs';
import { TEMPLATES, template } from '../lib/templates.mjs';
import { arrangementText, clipText } from '../lib/text.mjs';

// a project built with edits: `song(['track.add', { kind: 'drums' }], …)`
const song = (...ops) => ops.reduce((p, [op, args]) => applyOp(p, { op, ...args }), emptyProject('test'));
const band = () => song(
  ['track.add', { kind: 'drums' }], ['track.add', { kind: 'synth', name: 'Bass', preset: 'bass' }],
  ['clip.add', { track: 't1', bar: 0, bars: 4 }], ['clip.add', { track: 'Bass', bar: 4, bars: 2 }],
);
const clip = (p, id) => findClip(p, id).clip;

test('pitches have names: C4 is 60, A4 is 440 Hz, flats and sharps are the same keys', () => {
  assert.equal(noteNumber('C4'), 60);
  assert.equal(noteNumber('a4'), 69);
  assert.equal(noteNumber('Bb3'), noteNumber('A#3'));
  assert.equal(noteNumber('36'), 36);
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(61), 'C#4');
  assert.equal(noteName(LOW), 'C1');
  assert.equal(noteHz(69), 440);
  for (let pitch = LOW; pitch <= HIGH; pitch++) assert.equal(noteNumber(noteName(pitch)), pitch);
  assert.throws(() => noteNumber('H2'), /not a pitch/);
  assert.throws(() => noteNumber('C9'), /out of range/);
});

test('notes are read and written as pitch:start:length, with chords and velocities', () => {
  assert.deepEqual(parseNotes('C2:0:4 E2:4:2'), [{ pitch: 36, start: 0, len: 4, vel: 0.8 }, { pitch: 40, start: 4, len: 2, vel: 0.8 }]);
  const chord = parseNotes('A3+C4+E4:16:16:64');
  assert.deepEqual(chord.map((n) => n.pitch), [57, 60, 64]);
  assert.ok(chord.every((n) => n.start === 16 && n.len === 16 && Math.abs(n.vel - 64 / 127) < 1e-9));
  assert.equal(formatNotes(parseNotes('E2:4:2, C2:0:4 A3+C4+E4:16:16:64 D3:8.5:0.5')), 'C2:0:4 E2:4:2 D3:8.5:0.5 A3+C4+E4:16:16:64');
  for (const bad of ['C2', 'C2:0', 'C2:x:4', 'C2:0:0', 'C2:0:4:200', 'X2:0:4']) assert.throws(() => parseNotes(bad), /not|cannot/);
});

test('a new song has nothing in it; tracks get ids, names and a sound', () => {
  const p = band();
  assert.deepEqual(p.tracks.map((t) => [t.id, t.name, t.kind, t.preset]), [['t1', 'Drums', 'drums', undefined], ['t2', 'Bass', 'synth', 'bass']]);
  assert.equal(trackOf(p, 't2'), trackOf(p, '2'));
  assert.equal(trackOf(p, 'ba'), trackOf(p, 'BASS'));
  assert.throws(() => trackOf(p, 'strings'), /no track "strings" \(there are: t1 Drums, t2 Bass\)/);
  assert.throws(() => applyOp(p, { op: 'track.add', kind: 'audio' }), /drums, synth/);
  assert.throws(() => applyOp(p, { op: 'track.add', kind: 'synth', preset: 'organ' }), /no sound called "organ"/);
  assert.throws(() => applyOp(p, { op: 'track.set', track: 't1', key: 'preset', value: 'bass' }), /drum track/);
  assert.equal(applyOp(p, { op: 'track.set', track: 't2', key: 'preset', value: 'pad' }).tracks[1].preset, 'pad');
  assert.deepEqual(applyOp(p, { op: 'track.del', track: 'drums' }).tracks.map((t) => t.id), ['t2']);
});

test('an edit returns a new project and leaves the old one alone', () => {
  const p = band();
  const before = JSON.stringify(p);
  applyOp(p, { op: 'clip.rows', clip: 'c1', lines: ['kick x...x...x...x...'] });
  applyOp(p, { op: 'track.set', track: 't1', key: 'vol', value: 0.2 });
  assert.equal(JSON.stringify(p), before);
});

test('clips sit on bars, never two on one bar of a track, and the song grows to hold them', () => {
  let p = band();
  assert.deepEqual([clip(p, 'c1').bar, clip(p, 'c1').bars, clip(p, 'c1').len], [0, 4, 1]);   // a drum clip repeats one bar
  assert.deepEqual([clip(p, 'c2').bars, clip(p, 'c2').len], [2, 2]);                          // a synth clip is as long as its notes
  assert.throws(() => applyOp(p, { op: 'clip.add', track: 't1', bar: 3, bars: 2 }), /bars 4-5 of Drums will not fit: c1 is at bars 1-4/);
  assert.equal(fits(p.tracks[0], 4, 4), true);
  assert.equal(fits(p.tracks[0], 3, 1), false);
  assert.equal(fits(p.tracks[0], 3, 1, 'c1'), true);
  p = applyOp(p, { op: 'clip.add', track: 't1', bar: 20, bars: 4 });
  assert.equal(p.bars, 24);
  assert.throws(() => applyOp(p, { op: 'set', key: 'bars', value: 8 }), /clips reach bar 24/);
  assert.throws(() => applyOp(p, { op: 'clip.add', track: 't1', bar: MAX_BARS - 1, bars: 2 }), /at most 256 bars/);
  assert.throws(() => applyOp(p, { op: 'clip.add', track: 't1', bar: 'x', bars: 2 }), /not a bar/);
});

test('a clip is moved, resized, copied and deleted', () => {
  let p = applyOp(band(), { op: 'clip.rows', clip: 'c1', lines: ['kick x...x...x...x...'] });
  p = applyOp(p, { op: 'clip.move', clip: 'c1', bar: 8 });
  assert.equal(clip(p, 'c1').bar, 8);
  p = applyOp(p, { op: 'clip.resize', clip: 'c1', bars: 2 });
  assert.equal(clip(p, 'c1').bars, 2);
  p = applyOp(p, { op: 'clip.dup', clip: 'c1', times: 2 });                 // right after it, twice
  assert.deepEqual(p.tracks[0].clips.map((c) => [c.id, c.bar]), [['c1', 8], ['c3', 10], ['c4', 12]]);
  assert.deepEqual(clip(p, 'c4').rows, clip(p, 'c1').rows);
  p = applyOp(p, { op: 'clip.dup', clip: 'c1', bar: 0 });
  assert.equal(clip(p, 'c5').bar, 0);
  assert.throws(() => applyOp(p, { op: 'clip.dup', clip: 'c1' }), /will not fit: c3/);
  assert.throws(() => applyOp(p, { op: 'clip.move', clip: 'c1', bar: 0, track: 't2' }), /drums clip and Bass is a synth track/);
  assert.throws(() => applyOp(p, { op: 'clip.resize', clip: 'c1', bars: 3 }), /will not fit/);
  p = applyOp(p, { op: 'clip.del', clip: 'c3' });
  assert.equal(findClip(p, 'c3'), null);
  assert.throws(() => applyOp(p, { op: 'clip.del', clip: 'c3' }), /no clip "c3"/);
  const twoKits = applyOp(p, { op: 'track.add', kind: 'drums', name: 'Perc' });
  assert.equal(applyOp(twoKits, { op: 'clip.move', clip: 'c1', track: 'Perc' }).tracks[2].clips[0].id, 'c1');
});

test('drum rows are written as text; a longer row makes the content longer, a shorter one repeats', () => {
  assert.deepEqual(parseRow('hihat: x.o.|g.X.|....|....').vel.slice(0, 8), [0.8, 0, 0.55, 0, 0.3, 0, 1, 0]);
  assert.throws(() => parseRow('kick x.x'), /whole bars of 16 steps/);
  assert.throws(() => parseRow('gong x...x...x...x...'), /no drum called/);
  let p = applyOp(band(), { op: 'clip.rows', clip: 'c1', lines: ['kick x...x...x...x...', 'snare ....X.......X...'] });
  assert.deepEqual(Object.keys(clip(p, 'c1').rows), VOICE_IDS);
  p = applyOp(p, { op: 'clip.rows', clip: 'c1', lines: ['hat x.x.x.x.x.x.x.x.x.x.x.x.x.x.xxxx'] });
  assert.equal(clip(p, 'c1').len, 2);
  assert.equal(clip(p, 'c1').rows.kick.filter((v) => v > 0).length, 8);     // the kick bar is played twice
  p = applyOp(p, { op: 'clip.rows', clip: 'c1', clear: true, lines: ['clap ....x.......x...'] });
  assert.equal(clip(p, 'c1').rows.kick.some((v) => v > 0), false);
  assert.equal(clip(p, 'c1').rows.clap.filter((v) => v > 0).length, 4);
  p = applyOp(p, { op: 'clip.step', clip: 'c1', voice: 'bd', step: 31, vel: 1 });
  assert.equal(clip(p, 'c1').rows.kick[31], 1);
  assert.throws(() => applyOp(p, { op: 'clip.step', clip: 'c1', voice: 'kick', step: 32, vel: 1 }), /step 33 is not in c1/);
  assert.throws(() => applyOp(p, { op: 'clip.notes', clip: 'c1', notes: 'C2:0:4' }), /c1 is a drum clip/);
  assert.equal(clip(applyOp(p, { op: 'clip.len', clip: 'c1', len: 1 }), 'c1').rows.kick.length, 16);
});

test('notes are written into a synth clip, added to, moved and removed', () => {
  let p = applyOp(band(), { op: 'clip.notes', clip: 'c2', notes: 'E2:4:2 C2:0:4 G2:30:8' });
  assert.deepEqual(clip(p, 'c2').notes.map((n) => [n.id, n.pitch, n.start, n.len]), [['n1', 36, 0, 4], ['n2', 40, 4, 2], ['n3', 43, 30, 2]]);   // in the order they sound; the last is cut at the end
  assert.throws(() => applyOp(p, { op: 'clip.notes', clip: 'c2', notes: 'C2:32:4' }), /outside c2: its 2 bars are sixteenths 0 to 31/);
  assert.throws(() => applyOp(p, { op: 'clip.rows', clip: 'c2', lines: ['kick x...x...x...x...'] }), /c2 is a synth clip/);
  p = applyOp(p, { op: 'clip.notes', clip: 'c2', add: true, notes: 'C2:0:8:127 C3:16:4' });
  assert.equal(formatNotes(clip(p, 'c2').notes), 'C2:0:8:127 E2:4:2 C3:16:4 G2:30:2');
  p = applyOp(p, { op: 'note.add', clip: 'c2', pitch: 48, start: 20, len: 2 });
  const added = clip(p, 'c2').notes.find((n) => n.start === 20);
  assert.throws(() => applyOp(p, { op: 'note.add', clip: 'c2', pitch: 48, start: 20 }), /there is a C3 at 20 already/);
  p = applyOp(p, { op: 'note.set', clip: 'c2', note: added.id, start: 99, pitch: 200 });
  const moved = clip(p, 'c2').notes.find((n) => n.id === added.id);
  assert.deepEqual([moved.pitch, moved.start, moved.len], [HIGH, 31.875, 0.125]);           // kept inside the clip
  assert.throws(() => applyOp(p, { op: 'note.set', clip: 'c2', note: added.id, start: 0, pitch: 36 }), /already/);
  p = applyOp(p, { op: 'note.del', clip: 'c2', note: added.id });
  assert.equal(clip(p, 'c2').notes.length, 4);
  p = applyOp(p, { op: 'clip.len', clip: 'c2', len: 4 });                                    // longer: the phrase again
  assert.equal(clip(p, 'c2').notes.length, 8);
  assert.equal(new Set(clip(p, 'c2').notes.map((n) => n.id)).size, 8);
  assert.equal(clip(applyOp(p, { op: 'clip.notes', clip: 'c2', notes: '' }), 'c2').notes.length, 0);
  assert.equal(clip(applyOp(p, { op: 'clip.clear', clip: 'c2' }), 'c2').notes.length, 0);
});

test('tempo, swing, the mixer and the loop stay in range', () => {
  let p = applyOp(band(), { op: 'set', key: 'bpm', value: 999 });
  assert.equal(p.bpm, 240);
  p = applyOp(p, { op: 'set', key: 'swing', value: 0.5 });
  p = applyOp(p, { op: 'track.set', track: 't1', key: 'pan', value: -3 });
  p = applyOp(p, { op: 'track.set', track: 't1', key: 'mute', value: 1 });
  assert.deepEqual([p.swing, p.tracks[0].pan, p.tracks[0].mute], [0.5, -1, true]);
  p = applyOp(p, { op: 'loop', from: 4, to: 8, on: true });
  assert.deepEqual(p.loop, { on: true, from: 4, to: 8 });
  assert.deepEqual(applyOp(p, { op: 'loop', on: false }).loop, { on: false, from: 4, to: 8 });
  assert.throws(() => applyOp(p, { op: 'loop', from: 8, to: 4 }), /range of bars/);
  assert.throws(() => applyOp(p, { op: 'loop', from: 0, to: 99 }), /range of bars/);
  assert.throws(() => applyOp(p, { op: 'set', key: 'bpm', value: 'fast' }), /"fast" is not a tempo/);
  assert.throws(() => applyOp(p, { op: 'set', key: 'key', value: 'C' }), /no "key"/);
  assert.throws(() => applyOp(p, { op: 'nope' }), /no such edit/);
});

test('whatever is loaded becomes a well-formed project: ids kept or made, numbers in range, no overlaps', () => {
  assert.throws(() => normalizeProject({ name: 'x' }), /not a project/);
  const p = normalizeProject({
    bpm: 1, bars: 2, loop: { on: 1, from: 9, to: 1 }, ids: { t: 4 },
    tracks: [
      { kind: 'synth', id: 't2', preset: 'organ', vol: 7, clips: [
        { id: 'c9', bar: 0, bars: 4, len: 99, notes: [{ pitch: 60, start: 0, len: 999 }, { pitch: 60, start: 0 }, { pitch: 5, start: 0 }, { pitch: 61, start: -1 }, { id: 'n3', pitch: 62, start: 1.23456 }, 'junk'] },
        { id: 'c9', bar: 2, bars: 4 }, null,
      ] },
      { kind: 'drums', id: 't2', clips: [{ bar: 300, bars: 9, rows: { kick: [2, 'x', -1], gong: [1] } }] },
      { kind: 'tuba' }, 7,
    ],
  });
  assert.deepEqual(p.tracks.map((t) => t.id), ['t2', 't5']);                // the second t2 gets a new id, past the highest given
  assert.deepEqual([p.bpm, p.tracks[0].preset, p.tracks[0].vol], [40, 'lead', 1]);
  assert.deepEqual(p.tracks[0].clips.map((c) => [c.id, c.bar, c.bars, c.len]), [['c9', 0, 4, 8]]);
  assert.deepEqual(p.tracks[0].clips[0].notes, [{ id: 'n4', pitch: 60, start: 0, len: 128, vel: 0.8 }, { id: 'n3', pitch: 62, start: 1.235, len: 1, vel: 0.8 }]);
  assert.deepEqual([p.tracks[1].clips[0].bar, p.tracks[1].clips[0].bars], [255, 1]);
  assert.deepEqual(p.tracks[1].clips[0].rows.kick.slice(0, 3), [1, 0, 0]);
  assert.equal(p.bars, MAX_BARS);
  assert.deepEqual(p.loop, { on: true, from: 9, to: 10 });
  assert.deepEqual(normalizeProject(JSON.parse(JSON.stringify(p))), p);     // and it stays as it is
});

test('the templates are whole songs, and each sound is a complete voice', () => {
  assert.ok(TEMPLATES.length >= 3);
  for (const t of TEMPLATES) assert.deepEqual(normalizeProject(structuredClone(t)), t);
  assert.equal(template('night drive').name, 'Night drive');
  assert.equal(template('slow').name, 'Slow tape');
  assert.throws(() => template('polka'), /no template called "polka"/);
  assert.ok(TEMPLATES[0].tracks.some((t) => t.kind === 'drums') && TEMPLATES[0].tracks.some((t) => t.kind === 'synth'));
  assert.deepEqual(PRESET_IDS, ['bass', 'lead', 'pad', 'pluck', 'keys']);
  for (const preset of Object.values(PRESETS)) {
    for (const key of ['gain', 'cutoff', 'sweep', 'close', 'q', 'a', 'd', 's', 'r', 'program']) assert.equal(typeof preset[key], 'number', key);
    assert.ok(preset.oscs.length && preset.oscs.every((o) => ['sine', 'square', 'sawtooth', 'triangle'].includes(o.type)));
  }
});

test('the arrangement as text: tracks down, bars across, clips as blocks with their ids', () => {
  let p = applyOp(band(), { op: 'clip.rows', clip: 'c1', lines: ['kick x...x...x...x...', 'hat ..x...x...x...x.'] });
  p = applyOp(p, { op: 'clip.notes', clip: 'c2', notes: 'C2:0:4 E2:4:2' });
  p = applyOp(p, { op: 'clip.dup', clip: 'c1', bar: 8 });
  p = applyOp(p, { op: 'clip.add', track: 't2', bar: 15, bars: 1 });
  p = applyOp(p, { op: 'track.set', track: 't2', key: 'pan', value: -0.3 });
  p = applyOp(p, { op: 'track.set', track: 't2', key: 'mute', value: true });
  assert.deepEqual(arrangementText(p).split('\n'), [
    '"test"  120 bpm  swing 0%  16 bars  loop 1-4 off  master 80',
    'bar              1   5   9   13',
    't1 Drums  drums  [==]....[==]....   vol 80',
    '    c1 1-4 (1 bar ×4, 8 hits) · c3 9-12 (=c1)',
    't2 Bass  bass    ....[].........#   vol 80  pan L30  muted',
    '    c2 5-6 (2 notes) · c4 16 (empty)',
  ]);
  assert.match(arrangementText(emptyProject('x')), /no tracks yet/);
});

test('a clip as text: drum rows, or the notes bar by bar and a piano roll', () => {
  let p = applyOp(band(), { op: 'clip.rows', clip: 'c1', lines: ['kick x...x...x...x...', 'snare ....X......g...o'] });
  assert.deepEqual(clipText(p, 'c1').split('\n'), [
    'c1  t1 Drums (drums)  bars 1-4  1 bar ×4, 7 hits',
    '       1...2...3...4...',
    'kick   x...x...x...x...',
    'snare  ....X......g...o',
  ]);
  p = applyOp(p, { op: 'clip.notes', clip: 'c2', notes: 'C2:0:4 E2:4:2 C2+G2:16:8:100' });
  assert.deepEqual(clipText(p, 'C2').split('\n'), [
    'c2  t2 Bass (bass)  bars 5-6  4 notes',
    'bar 1 (from 0): C2:0:4 E2:4:2',
    'bar 2 (from 16): C2+G2:16:8:100',
    '    1...2...3...4...1...2...3...4...',
    'G2  ................#=======........',
    'E2  ....#=..........................',
    'C2  #===............#=======........',
  ]);
  assert.match(clipText(applyOp(p, { op: 'clip.clear', clip: 'c2' }), 'c2'), /no notes: notes c2 /);
  assert.throws(() => clipText(p, 'c77'), /no clip "c77"/);
});
