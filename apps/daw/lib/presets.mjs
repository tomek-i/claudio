// The sounds a synth track can have. One voice design for all of them: a few oscillators into a low-pass filter
// that opens on each note and closes again, then an attack / decay / sustain / release envelope. A preset is the
// numbers for that voice; public/engine.js is what plays them.
//
//   oscs:   wave, cents away from the note (−1200 is an octave down), and how loud
//   cutoff: where the filter rests, in Hz; sweep: how many octaves above that a note opens it; close: seconds to fall back
//   a d s r: attack and decay in seconds, sustain as a share of the peak, release in seconds
//   program: the General MIDI instrument the MIDI export names for it

export const PRESETS = {
  bass: {
    name: 'Bass', program: 38, gain: 0.55, cutoff: 260, sweep: 2.6, close: 0.2, q: 5, a: 0.004, d: 0.22, s: 0.7, r: 0.07,
    oscs: [{ type: 'sawtooth', cents: 0, gain: 0.6 }, { type: 'square', cents: -1200, gain: 0.5 }],
  },
  lead: {
    name: 'Lead', program: 81, gain: 0.36, cutoff: 1700, sweep: 1.6, close: 0.3, q: 2.5, a: 0.01, d: 0.2, s: 0.75, r: 0.14,
    oscs: [{ type: 'sawtooth', cents: -7, gain: 0.5 }, { type: 'sawtooth', cents: 7, gain: 0.5 }],
  },
  pad: {
    name: 'Pad', program: 89, gain: 0.26, cutoff: 850, sweep: 1.1, close: 1.4, q: 0.8, a: 0.28, d: 0.9, s: 0.8, r: 0.7,
    oscs: [{ type: 'sawtooth', cents: -10, gain: 0.45 }, { type: 'sawtooth', cents: 10, gain: 0.45 }, { type: 'triangle', cents: 1200, gain: 0.2 }],
  },
  pluck: {
    name: 'Pluck', program: 45, gain: 0.6, cutoff: 480, sweep: 3.6, close: 0.13, q: 3, a: 0.002, d: 0.2, s: 0.06, r: 0.14,
    oscs: [{ type: 'square', cents: 0, gain: 0.45 }, { type: 'sawtooth', cents: 5, gain: 0.45 }],
  },
  keys: {
    name: 'Keys', program: 4, gain: 0.42, cutoff: 1900, sweep: 1.2, close: 0.45, q: 0.7, a: 0.004, d: 0.7, s: 0.35, r: 0.28,
    oscs: [{ type: 'triangle', cents: 0, gain: 0.7 }, { type: 'sine', cents: 1200, gain: 0.25 }, { type: 'sawtooth', cents: 3, gain: 0.12 }],
  },
};

export const PRESET_IDS = Object.keys(PRESETS);

export function presetId(name) {
  const key = String(name).toLowerCase().trim();
  if (PRESETS[key]) return key;
  throw new Error(`no sound called "${name}" (there are: ${PRESET_IDS.join(', ')})`);
}
