// Pitches and notes as text. A pitch is a MIDI number (C4 = 60, A4 = 69 = 440 Hz) or a name (C4, F#2, Bb3).
// A note is written pitch:start:length, in sixteenths counted from 0 at the start of the clip, with an optional
// fourth part for the velocity (1-127). Notes that share start, length and velocity can be joined with + into a chord:
//
//   C2:0:4 E2:4:2          a C for a beat, then an E for an eighth
//   A3+C4+E4:16:16:70      an A minor chord over the whole second bar, played softly

export const LOW = 24;     // C1: the lowest pitch a clip holds, and the bottom of the piano roll
export const HIGH = 96;    // C7
export const DEFAULT_VEL = 0.8;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const noteName = (pitch) => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

export const isBlackKey = (pitch) => NAMES[((pitch % 12) + 12) % 12].length === 2;

export const noteHz = (pitch) => 440 * 2 ** ((pitch - 69) / 12);

export function noteNumber(text) {
  const s = String(text).trim();
  let pitch;
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s);
  if (m) pitch = LETTERS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  else if (/^\d+$/.test(s)) pitch = Number(s);
  else throw new Error(`"${text}" is not a pitch (write C4, F#2, Bb3, or a MIDI number)`);
  if (pitch < LOW || pitch > HIGH) throw new Error(`${s} is out of range (${noteName(LOW)} to ${noteName(HIGH)})`);
  return pitch;
}

const HOW = 'write a note as pitch:start:length in sixteenths, like C2:0:4';

// "C2:0:4 E2:4:2:90 A3+C4+E4:16:16" → [{ pitch, start, len, vel }]
export function parseNotes(text) {
  const notes = [];
  for (const token of String(text).split(/[\s,]+/).filter(Boolean)) {
    const parts = token.split(':');
    if (parts.length < 3 || parts.length > 4) throw new Error(`cannot read the note "${token}" (${HOW})`);
    const [start, len, velocity] = parts.slice(1).map(Number);
    if (!(start >= 0)) throw new Error(`"${parts[1]}" in "${token}" is not a start (${HOW})`);
    if (!(len > 0)) throw new Error(`"${parts[2]}" in "${token}" is not a length (${HOW})`);
    if (parts.length === 4 && !(velocity >= 1 && velocity <= 127)) throw new Error(`"${parts[3]}" in "${token}" is not a velocity (1 to 127)`);
    const vel = parts.length === 4 ? velocity / 127 : DEFAULT_VEL;
    for (const name of parts[0].split('+')) notes.push({ pitch: noteNumber(name), start, len, vel });
  }
  return notes;
}

const short = (n) => String(Number(n.toFixed(3)));
const midiVel = (vel) => Math.max(1, Math.min(127, Math.round(vel * 127)));

// The same notation back, in the order the notes sound, chords joined. parseNotes reads what this writes.
export function formatNotes(notes) {
  const groups = new Map();
  for (const n of [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)) {
    const key = `${short(n.start)}:${short(n.len)}${midiVel(n.vel) === midiVel(DEFAULT_VEL) ? '' : `:${midiVel(n.vel)}`}`;
    groups.set(key, [...(groups.get(key) || []), noteName(n.pitch)]);
  }
  return [...groups].map(([key, names]) => `${names.join('+')}:${key}`).join(' ');
}
