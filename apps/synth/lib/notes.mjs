// Notes as numbers. A note is a MIDI note number: 60 is middle C (C4), 69 is the A at 440 Hz, and one more is a
// semitone up.
export const NOTE_MIN = 0;
export const NOTE_MAX = 127;

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// fractions of a note are allowed: 69.5 is a quarter tone above A4
export const noteFreq = (note) => 440 * 2 ** ((note - 69) / 12);

export const noteName = (note) => `${NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;

export const isBlack = (note) => NAMES[((note % 12) + 12) % 12].length === 2;

// "C2", "eb3", "F#4", or a MIDI number ("36")
export function parseNote(text) {
  const s = String(text).trim();
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(s);
  const note = m ? LETTERS[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12
    : /^\d{1,3}$/.test(s) ? Number(s) : NaN;
  if (!Number.isInteger(note)) throw new Error(`"${s}" is not a note (write C2, Eb3, F#4)`);
  if (note < NOTE_MIN || note > NOTE_MAX) throw new Error(`${s} is out of range (C-1 to G9)`);
  return note;
}
