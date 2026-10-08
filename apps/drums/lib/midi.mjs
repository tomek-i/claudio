// A pattern as a standard MIDI file (format 0, General MIDI drums on channel 10) with the timing kept: the
// swing and each hit's offset are in the note positions, at 480 ticks to the beat.
import { VOICES } from './kit.mjs';
import { hitsInWindow } from './timing.mjs';

export const PPQ = 480;
const TICKS_PER_STEP = PPQ / 4;
const NOTE_TICKS = 30;

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

export function toMidi(pattern, { loops = 1 } = {}) {
  const end = loops * pattern.steps * TICKS_PER_STEP;
  const notes = Object.fromEntries(VOICES.map((v) => [v.id, v.midi]));
  const events = [];                                 // [tick, order, ...bytes]: note offs before note ons on one tick
  for (const hit of hitsInWindow(pattern, -1, loops * pattern.steps + 1, { lastLoop: loops - 1 })) {
    const tick = Math.max(0, Math.round(hit.pos * TICKS_PER_STEP));
    const velocity = Math.max(1, Math.min(127, Math.round(hit.vel * 127)));
    events.push([tick, 1, 0x99, notes[hit.voice], velocity]);
    events.push([tick + NOTE_TICKS, 0, 0x89, notes[hit.voice], 0]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const usPerBeat = Math.round(60e6 / pattern.bpm);
  const name = [...new TextEncoder().encode(pattern.name)];
  const body = [
    0, 0xff, 0x03, ...varLen(name.length), ...name,
    0, 0xff, 0x51, 3, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
  ];
  let at = 0;
  for (const [tick, , ...bytes] of events) {
    body.push(...varLen(tick - at), ...bytes);
    at = tick;
  }
  body.push(...varLen(Math.max(0, end - at)), 0xff, 0x2f, 0);

  const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff,
    0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body,
  ]);
}
