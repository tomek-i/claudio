// Starting sounds. Each is written as what it changes from the plain patch (initPatch in patch.mjs), so a
// preset reads as its idea: which oscillators, how the filter moves, how long the note lasts. The presets the
// player saves are not here: the store keeps them (lib/store.mjs), and findPreset looks through both.
import { normalizePatch } from './patch.mjs';

export const KINDS = ['bass', 'lead', 'pad', 'pluck', 'keys', 'fx'];

const env = (id, attack, decay, sustain, release) => ({ [`${id}.attack`]: attack, [`${id}.decay`]: decay, [`${id}.sustain`]: sustain, [`${id}.release`]: release });

const SOUNDS = [
  {
    name: 'Acid bass', kind: 'bass',                 // one saw, a filter that snaps shut, a slide between notes
    'osc1.octave': -1, 'filter.cutoff': 320, 'filter.resonance': 0.78, 'filter.env': 3.6,
    ...env('fenv', 0.001, 0.22, 0.05, 0.1), ...env('aenv', 0.002, 0.25, 0.6, 0.08),
    'voice.glide': 0.06, 'delay.mix': 0.12, 'reverb.mix': 0.05,
  },
  {
    name: 'Sub bass', kind: 'bass',                  // a sine with a sine under it
    'osc1.wave': 'sine', 'osc1.octave': -1, 'osc1.level': 0.9, 'mix.sub': 0.5, 'filter.cutoff': 600, 'filter.env': 0.5,
    ...env('aenv', 0.005, 0.2, 0.9, 0.12), 'voice.glide': 0.04, 'reverb.mix': 0,
  },
  {
    name: 'Reese bass', kind: 'bass',                // two saws out of tune with each other, slowly swept
    'osc1.octave': -1, 'osc2.octave': -1, 'osc2.fine': 18, 'osc2.level': 0.8, 'voice.unison': 2, 'voice.detune': 14,
    'filter.cutoff': 900, 'filter.resonance': 0.2, 'lfo.rate': 0.3, 'lfo.depth': 0.15, 'lfo.dest': 'filter',
    ...env('aenv', 0.01, 0.3, 0.9, 0.15), 'reverb.mix': 0.05,
  },
  {
    name: 'Saw lead', kind: 'lead',                  // a stack of saws, a little vibrato, an echo
    'osc2.fine': 9, 'osc2.level': 0.7, 'voice.unison': 3, 'voice.detune': 16, 'filter.cutoff': 3800, 'filter.resonance': 0.25,
    'filter.env': 1.2, 'voice.glide': 0.05, 'lfo.rate': 5.5, 'lfo.depth': 0.08, 'delay.mix': 0.25, 'reverb.mix': 0.2,
    ...env('aenv', 0.005, 0.3, 0.8, 0.25),
  },
  {
    name: 'Square lead', kind: 'lead',               // hollow, with a long slide
    'osc1.wave': 'square', 'osc2.wave': 'square', 'osc2.octave': 1, 'osc2.level': 0.3, 'filter.cutoff': 2600,
    'filter.resonance': 0.3, 'voice.glide': 0.09, 'lfo.rate': 6, 'lfo.depth': 0.07, 'delay.mix': 0.3, 'reverb.mix': 0.15,
  },
  {
    name: 'Warm pad', kind: 'pad',                   // slow to open, slow to go
    'osc2.fine': -11, 'osc2.level': 0.8, 'voice.unison': 3, 'voice.detune': 18, 'mix.sub': 0.25, 'filter.cutoff': 1400,
    'filter.env': 1.5, ...env('fenv', 1.2, 2, 0.6, 2), ...env('aenv', 0.9, 1.5, 0.85, 2.2),
    'lfo.rate': 0.25, 'lfo.depth': 0.12, 'lfo.dest': 'filter', 'delay.mix': 0.15, 'reverb.size': 4, 'reverb.mix': 0.45,
  },
  {
    name: 'Glass pad', kind: 'pad',                  // thin and bright, trembling a little
    'osc1.wave': 'triangle', 'osc2.wave': 'sine', 'osc2.octave': 1, 'osc2.fine': 6, 'osc2.level': 0.5, 'mix.noise': 0.04,
    'filter.cutoff': 5200, ...env('aenv', 0.5, 2, 0.7, 3), 'lfo.rate': 4, 'lfo.depth': 0.2, 'lfo.dest': 'amp',
    'reverb.size': 5, 'reverb.mix': 0.5,
  },
  {
    name: 'Pluck', kind: 'pluck',                    // the filter and the level both fall away at once
    'osc2.wave': 'square', 'osc2.fine': 5, 'osc2.level': 0.5, 'filter.cutoff': 700, 'filter.resonance': 0.3, 'filter.env': 3.5,
    'filter.keytrack': 0.5, ...env('fenv', 0.001, 0.18, 0, 0.2), ...env('aenv', 0.001, 0.35, 0, 0.3),
    'delay.time': 0.25, 'delay.mix': 0.3, 'reverb.mix': 0.2,
  },
  {
    name: 'Bell pluck', kind: 'pluck',               // two sines a twelfth apart, left to ring
    'osc1.wave': 'sine', 'osc2.wave': 'sine', 'osc2.octave': 1, 'osc2.semi': 7, 'osc2.level': 0.4, 'filter.cutoff': 8000,
    ...env('aenv', 0.001, 1.2, 0, 1.2), 'reverb.size': 3, 'reverb.mix': 0.4,
  },
  {
    name: 'Electric keys', kind: 'keys',             // a soft hammer and a slow tremolo
    'osc1.wave': 'triangle', 'osc2.wave': 'sine', 'osc2.octave': 1, 'osc2.level': 0.25, 'mix.sub': 0.15, 'filter.cutoff': 2200,
    'filter.env': 1.5, 'filter.keytrack': 0.6, ...env('fenv', 0.001, 0.5, 0.2, 0.4), ...env('aenv', 0.003, 1.4, 0.25, 0.4),
    'lfo.rate': 5, 'lfo.depth': 0.12, 'lfo.dest': 'amp', 'reverb.mix': 0.2,
  },
  {
    name: 'Organ', kind: 'keys',                     // three sines an octave apart, on at once and off at once
    'osc1.wave': 'sine', 'osc2.wave': 'sine', 'osc2.octave': 1, 'osc2.level': 0.6, 'mix.sub': 0.6, 'filter.cutoff': 6000,
    ...env('aenv', 0.005, 0.1, 1, 0.06), 'lfo.rate': 6.5, 'lfo.depth': 0.05, 'reverb.mix': 0.25,
  },  {
    name: 'Wobble bass', kind: 'bass',               // a saw and a square, the filter swung open and shut by the LFO
    'osc1.octave': -1, 'osc2.wave': 'square', 'osc2.octave': -1, 'osc2.fine': 7, 'osc2.level': 0.6, 'mix.sub': 0.4,
    'filter.cutoff': 260, 'filter.resonance': 0.55, 'lfo.rate': 2.2, 'lfo.depth': 0.45, 'lfo.dest': 'filter',
    ...env('aenv', 0.005, 0.2, 1, 0.1), 'reverb.mix': 0, 'master.volume': 0.6,
  },
  {
    name: 'Fat analog bass', kind: 'bass',           // saw over square with a sub, a short thump of filter on every note
    'osc1.octave': -1, 'osc2.wave': 'square', 'osc2.octave': -1, 'osc2.fine': -6, 'osc2.level': 0.6, 'mix.sub': 0.35,
    'filter.cutoff': 450, 'filter.resonance': 0.35, 'filter.env': 2.4, ...env('fenv', 0.002, 0.35, 0.2, 0.12),
    ...env('aenv', 0.002, 0.4, 0.75, 0.1), 'reverb.mix': 0, 'master.volume': 0.6,
  },
  {
    name: 'Deep house bass', kind: 'bass',           // a round triangle and a sub, a little knock at the start
    'osc1.wave': 'triangle', 'osc1.octave': -1, 'osc1.level': 0.9, 'mix.sub': 0.5, 'filter.cutoff': 380, 'filter.env': 1.5,
    ...env('fenv', 0.001, 0.12, 0, 0.1), ...env('aenv', 0.003, 0.35, 0.4, 0.1), 'reverb.mix': 0,
  },
  {
    name: 'Supersaw', kind: 'lead',                  // the trance lead: every copy of every saw spread wide, an echo, a hall
    'osc2.fine': -12, 'osc2.level': 0.8, 'voice.unison': 4, 'voice.detune': 32, 'filter.cutoff': 6000, 'filter.resonance': 0.05,
    ...env('aenv', 0.01, 0.4, 0.9, 0.4), 'delay.mix': 0.3, 'delay.feedback': 0.4, 'reverb.size': 3, 'reverb.mix': 0.35,
    'master.volume': 0.55,
  },
  {
    name: 'Hoover', kind: 'lead',                    // the rave hoover: saws an octave apart, far out of tune, sliding
    'osc2.octave': -1, 'osc2.fine': 20, 'osc2.level': 0.8, 'voice.unison': 4, 'voice.detune': 45, 'voice.glide': 0.18,
    'filter.cutoff': 2400, 'filter.resonance': 0.15, 'filter.env': 1, 'lfo.rate': 5, 'lfo.depth': 0.1,
    ...env('aenv', 0.02, 0.4, 0.85, 0.35), 'reverb.mix': 0.25, 'master.volume': 0.55,
  },
  {
    name: 'Chip lead', kind: 'lead',                 // a game console: bare squares, a quick vibrato, no room
    'osc1.wave': 'square', 'osc2.wave': 'square', 'osc2.octave': 1, 'osc2.level': 0.2, 'filter.cutoff': 12000,
    'filter.resonance': 0, 'filter.keytrack': 0, ...env('aenv', 0.001, 0.1, 0.7, 0.04), 'lfo.rate': 7, 'lfo.depth': 0.1,
    'reverb.mix': 0, 'master.volume': 0.5,
  },
  {
    name: 'Screamer', kind: 'lead',                  // one saw through a filter on the edge of whistling
    'filter.cutoff': 900, 'filter.resonance': 0.85, 'filter.env': 4, 'filter.keytrack': 0.6, ...env('fenv', 0.001, 0.4, 0.3, 0.2),
    'voice.glide': 0.08, 'delay.mix': 0.3, 'reverb.mix': 0.15, 'master.volume': 0.55,
  },
  {
    name: 'Trance strings', kind: 'pad',             // a wall of saws that swells in and drifts
    'osc2.fine': 8, 'osc2.level': 0.7, 'voice.unison': 4, 'voice.detune': 22, 'filter.cutoff': 3200, 'filter.resonance': 0.05,
    'filter.env': 1, ...env('fenv', 0.8, 1.5, 0.7, 1.5), ...env('aenv', 0.6, 1, 0.9, 1.5), 'lfo.rate': 0.15, 'lfo.depth': 0.1,
    'lfo.dest': 'filter', 'delay.mix': 0.2, 'reverb.size': 4, 'reverb.mix': 0.5, 'master.volume': 0.55,
  },
  {
    name: 'Dark drone', kind: 'pad',                 // low and shut, breathing very slowly, in a long echo
    'osc1.octave': -1, 'osc2.wave': 'square', 'osc2.octave': -1, 'osc2.fine': 9, 'osc2.level': 0.7, 'mix.noise': 0.06,
    'filter.cutoff': 300, 'filter.resonance': 0.45, 'lfo.rate': 0.08, 'lfo.depth': 0.3, 'lfo.dest': 'filter',
    ...env('aenv', 2.5, 3, 1, 4), 'delay.time': 0.75, 'delay.feedback': 0.6, 'delay.mix': 0.25, 'reverb.size': 6, 'reverb.mix': 0.6,
  },
  {
    name: 'Air pad', kind: 'pad',                    // breath: soft tones with noise through them, gently pulsing
    'osc1.wave': 'triangle', 'osc2.wave': 'sine', 'osc2.octave': 1, 'osc2.level': 0.4, 'mix.noise': 0.18, 'filter.cutoff': 2500,
    'filter.resonance': 0.3, ...env('aenv', 1.5, 2, 0.8, 3), 'lfo.rate': 0.3, 'lfo.depth': 0.15, 'lfo.dest': 'amp',
    'reverb.size': 5, 'reverb.mix': 0.55,
  },
  {
    name: 'Trance pluck', kind: 'pluck',             // a supersaw that snaps shut, into a dotted echo
    'osc2.fine': 10, 'osc2.level': 0.7, 'voice.unison': 3, 'voice.detune': 18, 'filter.cutoff': 500, 'filter.resonance': 0.25,
    'filter.env': 4.5, ...env('fenv', 0.001, 0.15, 0, 0.15), ...env('aenv', 0.001, 0.3, 0, 0.3), 'delay.time': 0.352,
    'delay.feedback': 0.45, 'delay.mix': 0.35, 'reverb.mix': 0.3, 'master.volume': 0.6,
  },
  {
    name: 'Marimba', kind: 'pluck',                  // a sine and a quiet one two octaves up, struck and gone
    'osc1.wave': 'sine', 'osc1.level': 0.9, 'osc2.wave': 'sine', 'osc2.octave': 2, 'osc2.level': 0.2, 'filter.cutoff': 4000,
    ...env('aenv', 0.001, 0.45, 0, 0.4), 'reverb.mix': 0.15,
  },
  {
    name: 'House stab', kind: 'keys',                // the 90s organ chord: short, hollow, with a room behind it
    'osc1.wave': 'square', 'osc2.octave': 1, 'osc2.level': 0.5, 'mix.sub': 0.3, 'filter.cutoff': 1800, 'filter.resonance': 0.2,
    'filter.env': 2, ...env('fenv', 0.001, 0.2, 0.1, 0.15), ...env('aenv', 0.001, 0.25, 0.2, 0.15), 'delay.mix': 0.2,
    'reverb.mix': 0.3,
  },
  {
    name: 'Clav', kind: 'keys',                      // funky and nasal: the filter follows the keys and bites on each note
    'osc1.wave': 'square', 'osc2.fine': 4, 'osc2.level': 0.4, 'filter.cutoff': 1200, 'filter.resonance': 0.4, 'filter.env': 3,
    'filter.keytrack': 0.8, ...env('fenv', 0.001, 0.12, 0.1, 0.08), ...env('aenv', 0.001, 0.6, 0.15, 0.08), 'reverb.mix': 0.05,
  },
  {
    name: 'Noise riser', kind: 'fx',                 // hold it: noise that opens for six seconds, the build before a drop
    'osc1.level': 0, 'mix.noise': 0.8, 'filter.cutoff': 200, 'filter.resonance': 0.6, 'filter.env': 6, 'filter.keytrack': 0,
    ...env('fenv', 6, 1, 1, 1.5), ...env('aenv', 3, 1, 1, 1.5), 'delay.mix': 0.3, 'reverb.size': 4, 'reverb.mix': 0.4,
  },
  {
    name: 'Laser', kind: 'fx',                       // a square whose pitch the LFO sweeps up and up again, in an echo
    'osc1.wave': 'square', 'filter.cutoff': 4000, 'filter.resonance': 0.6, 'lfo.shape': 'saw', 'lfo.rate': 9, 'lfo.depth': 0.55,
    ...env('aenv', 0.001, 0.18, 0, 0.1), 'delay.time': 0.19, 'delay.feedback': 0.5, 'delay.mix': 0.35, 'reverb.mix': 0.2,
    'master.volume': 0.5,
  },
];

export const PRESETS = SOUNDS.map(({ kind, ...sound }) => ({ kind, patch: normalizePatch(sound) }));
export const PRESET_LIST = PRESETS.map((p) => ({ name: p.patch.name, kind: p.kind }));

export const isBuiltIn = (name) => PRESETS.some((p) => p.patch.name.toLowerCase() === String(name ?? '').trim().toLowerCase());

// A preset by its name, or by how its name starts ("acid", "warm"): the player's own (`saved`, a list of patches)
// before the built-in ones.
export function findPreset(name, saved = []) {
  const wanted = String(name ?? '').trim().toLowerCase();
  const all = [...saved, ...PRESETS.map((p) => p.patch)];
  const found = wanted && (all.find((p) => p.name.toLowerCase() === wanted) || all.find((p) => p.name.toLowerCase().startsWith(wanted)));
  if (!found) throw new Error(`no preset "${name}" (there are: ${all.map((p) => p.name).join(', ')})`);
  return found;
}

export const preset = (name) => findPreset(name);
