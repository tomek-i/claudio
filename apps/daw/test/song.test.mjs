// What sounds when: the events of a stretch of the song, the playhead that walks it, and the MIDI file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, emptyProject } from '../lib/project.mjs';
import { Playhead, audibleTracks, eventsInWindow, songSteps, stepSeconds, swingSteps } from '../lib/song.mjs';
import { PPQ, toMidi } from '../lib/midi.mjs';
import { TEMPLATES } from '../lib/templates.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);
const song = (...ops) => ops.reduce((p, [op, args]) => applyOp(p, { op, ...args }), emptyProject('test'));

// drums on bars 1-4 (one bar, repeated) and a bass phrase of two bars on bars 3-5
const band = () => song(
  ['track.add', { kind: 'drums' }], ['track.add', { kind: 'synth', name: 'Bass', preset: 'bass' }],
  ['clip.add', { track: 't1', bar: 0, bars: 4 }], ['clip.rows', { clip: 'c1', lines: ['kick x...x...x...x...', 'hat .x.x.x.x.x.x.x.x'] }],
  ['clip.add', { track: 't2', bar: 2, bars: 3, len: 2 }], ['clip.notes', { clip: 'c2', notes: 'C2:0:4 E2:5:2 G2:28:8' }],
  ['set', { key: 'bars', value: 8 }],
);

test('at 120 BPM a sixteenth is 125 ms, and swing moves the off sixteenths only', () => {
  near(stepSeconds(120), 0.125);
  assert.equal(swingSteps(3, 0.5), 0.25);
  assert.equal(swingSteps(4, 0.5), 0);
  assert.equal(swingSteps(3.5, 0.5), 0);
  assert.equal(songSteps(band()), 128);
});

test('a clip repeats its content until it ends, and a note is cut where its clip ends', () => {
  const all = eventsInWindow(band(), 0, 128);
  const kicks = all.filter((e) => e.voice === 'kick').map((e) => e.pos);
  assert.deepEqual(kicks, Array.from({ length: 16 }, (_, i) => i * 4));     // four bars of four
  assert.equal(all.filter((e) => e.voice === 'hat').length, 32);
  const bass = all.filter((e) => e.kind === 'synth');
  assert.deepEqual(bass.map((e) => [e.pitch, e.pos, e.len]), [[36, 32, 4], [40, 37, 2], [43, 60, 4], [36, 64, 4], [40, 69, 2]]);   // the G is cut at the end of the phrase; the third bar starts it again
  assert.ok(bass.every((e) => e.track === 't2' && e.preset === 'bass'));
  assert.deepEqual(all.map((e) => e.pos), [...all.map((e) => e.pos)].sort((a, b) => a - b));
});

test('any way the song is cut into windows, every event is found once', () => {
  const p = applyOp(band(), { op: 'set', key: 'swing', value: 0.6 });
  const whole = eventsInWindow(p, 0, 128);
  for (const size of [0.37, 1, 5.5, 16, 100]) {
    const parts = [];
    for (let from = 0; from < 128; from += size) parts.push(...eventsInWindow(p, from, Math.min(128, from + size)));
    assert.deepEqual(parts, whole, `windows of ${size}`);
  }
  near(whole.find((e) => e.voice === 'hat').pos, 1.3);                     // the first hat is on an off sixteenth
  assert.equal(whole.find((e) => e.pitch === 40).pos, 37.3);               // so is the E, on 5
  assert.equal(eventsInWindow(p, 32, 32.5).filter((e) => e.kind === 'drums').length, 1);
});

test('muted tracks are still in the events; who is heard is asked separately', () => {
  let p = applyOp(band(), { op: 'track.set', track: 't1', key: 'mute', value: true });
  assert.equal(eventsInWindow(p, 0, 16).length, 12);
  assert.deepEqual(audibleTracks(p).map((t) => t.id), ['t2']);
  p = applyOp(p, { op: 'track.set', track: 't1', key: 'solo', value: true });
  assert.deepEqual(audibleTracks(p).map((t) => t.id), ['t1']);             // a solo is heard even when it is muted
  assert.deepEqual(audibleTracks(band()).map((t) => t.id), ['t1', 't2']);
});

test('the playhead hands out every event once, in small steps, with the second it sounds at', () => {
  const p = band();
  const head = new Playhead(p, 0, 10);
  const got = [];
  for (let now = 10; !head.done; now += 0.025) got.push(...head.advance(p, now + 0.1));
  const whole = eventsInWindow(p, 0, 128);
  assert.deepEqual(got.map((e) => [e.track, e.pos]), whole.map((e) => [e.track, e.pos]));
  for (const e of got) near(e.time, 10 + e.pos * 0.125);
  near(head.time, 10 + 128 * 0.125);                                        // the end of the song
  near(head.position(10 + 3 * 0.125), 3);
  assert.equal(head.position(0), 0);
});

test('with the loop on, the end of the loop leads back to its start', () => {
  const p = applyOp(band(), { op: 'loop', from: 2, to: 4, on: true });
  const head = new Playhead(p, 32, 0);                                      // from bar 3
  const got = [];
  for (let now = 0; now < 12; now += 0.025) got.push(...head.advance(p, now + 0.1));
  assert.equal(head.done, false);
  const kicks = got.filter((e) => e.voice === 'kick');
  assert.deepEqual(kicks.slice(0, 10).map((e) => e.pos), [32, 36, 40, 44, 48, 52, 56, 60, 32, 36]);
  kicks.forEach((e, i) => near(e.time, i * 0.5));                           // a kick every beat, straight through the loop point
  near(head.position(4.25), 34);                                            // 32 steps in: back at bar 3, and two steps on
  assert.ok(got.every((e) => e.pos >= 32 && e.pos < 64));
});

test('started after the loop, the song plays on to its end; a new tempo takes over where the playhead is', () => {
  let p = applyOp(band(), { op: 'loop', from: 0, to: 2, on: true });
  const head = new Playhead(p, 48, 0);
  const got = head.advance(p, 100);
  assert.equal(head.done, true);
  assert.deepEqual([got[0].pos, got.at(-1).pos], [48, 69]);
  near(head.time, (128 - 48) * 0.125);

  p = applyOp(band(), { op: 'loop', on: false });
  const tempo = new Playhead(p, 0, 0);
  tempo.advance(p, 1);                                                      // 8 steps at 120
  const faster = applyOp(p, { op: 'set', key: 'bpm', value: 240 });
  const next = tempo.advance(faster, 2).filter((e) => e.voice === 'kick');  // 16 more at 240
  assert.deepEqual(next.map((e) => e.pos), [8, 12, 16, 20]);
  near(next[1].time, 1 + 4 * 0.0625);
  near(tempo.position(0.5), 4);
  near(tempo.position(1.5), 16);
});

// ---- MIDI

function readMidi(bytes) {
  const view = new DataView(bytes.buffer);
  const tracks = [];
  let at = 14;
  while (at < bytes.length) {
    assert.equal(String.fromCharCode(...bytes.subarray(at, at + 4)), 'MTrk');
    const end = at + 8 + view.getUint32(at + 4);
    const events = [];
    let tick = 0;
    for (let i = at + 8; i < end;) {
      let delta = 0;
      do { delta = (delta << 7) | (bytes[i] & 0x7f); } while (bytes[i++] & 0x80);
      tick += delta;
      if (bytes[i] === 0xff) { events.push({ tick, meta: bytes[i + 1], data: bytes.subarray(i + 3, i + 3 + bytes[i + 2]) }); i += 3 + bytes[i + 2]; }
      else if ((bytes[i] & 0xf0) === 0xc0) { events.push({ tick, program: bytes[i + 1], channel: bytes[i] & 15 }); i += 2; }
      else { events.push({ tick, on: (bytes[i] & 0xf0) === 0x90, channel: bytes[i] & 15, note: bytes[i + 1], velocity: bytes[i + 2] }); i += 3; }
    }
    tracks.push(events);
    at = end;
  }
  return { format: view.getUint16(8), count: view.getUint16(10), ppq: view.getUint16(12), tracks };
}

test('the MIDI file has a tempo track and a track per track: drums on channel 10, notes at their lengths', () => {
  const p = applyOp(band(), { op: 'set', key: 'swing', value: 0.5 });
  const midi = readMidi(toMidi(p));
  assert.deepEqual([midi.format, midi.count, midi.ppq, midi.tracks.length], [1, 3, PPQ, 3]);
  const tempo = midi.tracks[0].find((e) => e.meta === 0x51).data;
  assert.equal((tempo[0] << 16) | (tempo[1] << 8) | tempo[2], 500000);     // 120 BPM
  assert.equal(new TextDecoder().decode(midi.tracks[2].find((e) => e.meta === 0x03).data), 'Bass');
  for (const track of midi.tracks) assert.deepEqual([track.at(-1).meta, track.at(-1).tick], [0x2f, 128 * 120]);

  const drums = midi.tracks[1].filter((e) => e.on);
  assert.equal(drums.length, 48);
  assert.ok(drums.every((e) => e.channel === 9));
  assert.deepEqual(drums.slice(0, 3).map((e) => [e.note, e.tick]), [[36, 0], [42, 150], [42, 390]]);   // the hats are swung: 1.25 and 3.25 steps

  const bass = midi.tracks[2];
  assert.deepEqual(bass.find((e) => e.program !== undefined), { tick: 0, program: 38, channel: 0 });
  const ons = bass.filter((e) => e.on);
  const offs = bass.filter((e) => e.on === false);
  assert.deepEqual(ons.map((e) => [e.note, e.tick]), [[36, 3840], [40, 4470], [43, 7200], [36, 7680], [40, 8310]]);
  assert.deepEqual(offs.map((e) => [e.note, e.tick]), [[36, 4320], [40, 4710], [43, 7680], [36, 8160], [40, 8550]]);   // a swung note keeps its length
  assert.ok(ons.every((e) => e.velocity === 102));
});

test('every template plays and exports', () => {
  for (const t of TEMPLATES) {
    const events = eventsInWindow(t, 0, songSteps(t));
    const tracksWithClips = t.tracks.filter((track) => track.clips.length).length;
    assert.equal(new Set(events.map((e) => e.track)).size, tracksWithClips, t.name);
    assert.ok(events.every((e) => e.pos >= 0 && e.pos < songSteps(t) && e.vel > 0 && (e.kind === 'drums' || e.len > 0)));
    const midi = readMidi(toMidi(t));
    assert.equal(midi.tracks.length, t.tracks.length + 1);
    assert.equal(midi.tracks.flat().filter((e) => e.on).length, events.length);
  }
});
