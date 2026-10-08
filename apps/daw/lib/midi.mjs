// The song as a standard MIDI file (format 1): a first track with the name, the tempo and the time signature,
// then one track per track of the song, at 480 ticks to the beat. Drum tracks are General MIDI drums on channel
// 10; each synth track has a channel of its own and the program its sound names. The swing is in the note
// positions. Every track is written, muted or not: mute and solo are the mixer's, not the composition's.
import { VOICES } from './kit.mjs';
import { PRESETS } from './presets.mjs';
import { eventsInWindow, songSteps } from './song.mjs';

export const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4;
const DRUM_TICKS = 30;
const DRUM_CHANNEL = 9;
const SYNTH_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const text = (type, s) => { const bytes = [...new TextEncoder().encode(s)]; return [0, 0xff, type, ...varLen(bytes.length), ...bytes]; };

// one track chunk: what it starts with, its events ([tick, order, ...bytes]) and the end of the song
function chunk(head, events, end) {
  const body = [...head];
  let at = 0;
  for (const [tick, , ...bytes] of events.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {   // note offs before note ons on one tick
    body.push(...varLen(tick - at), ...bytes);
    at = tick;
  }
  body.push(...varLen(Math.max(0, end - at)), 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

export function toMidi(project) {
  const steps = songSteps(project);
  const end = steps * TICKS_PER_STEP;
  const drumNote = Object.fromEntries(VOICES.map((v) => [v.id, v.midi]));
  const perTrack = new Map(project.tracks.map((t) => [t.id, []]));
  const channel = new Map();
  let synths = 0;
  for (const t of project.tracks) channel.set(t.id, t.kind === 'drums' ? DRUM_CHANNEL : SYNTH_CHANNELS[synths++ % SYNTH_CHANNELS.length]);

  for (const e of eventsInWindow(project, 0, steps)) {
    const ch = channel.get(e.track);
    const tick = Math.round(e.pos * TICKS_PER_STEP);
    const note = e.kind === 'drums' ? drumNote[e.voice] : e.pitch;
    const off = e.kind === 'drums' ? tick + DRUM_TICKS : Math.max(tick + 1, Math.round((e.pos + e.len) * TICKS_PER_STEP));
    perTrack.get(e.track).push([tick, 1, 0x90 | ch, note, Math.max(1, Math.min(127, Math.round(e.vel * 127)))]);
    perTrack.get(e.track).push([Math.min(end, off), 0, 0x80 | ch, note, 0]);
  }

  const usPerBeat = Math.round(60e6 / project.bpm);
  const chunks = [chunk([
    ...text(0x03, project.name),
    0, 0xff, 0x51, 3, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
  ], [], end)];
  for (const t of project.tracks) {
    const program = t.kind === 'synth' ? [0, 0xc0 | channel.get(t.id), PRESETS[t.preset].program] : [];
    chunks.push(chunk([...text(0x03, t.name), ...program], perTrack.get(t.id), end));
  }
  return Uint8Array.from([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff, ...chunks.flat()]);
}
