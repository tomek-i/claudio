// Starting sounds. Each is written as what it changes from the plain patch (initPatch in patch.mjs), so a
// preset reads as its idea: which oscillators, how the filter moves, how long the note lasts.
import { normalizePatch } from './patch.mjs';

export const KINDS = ['bass', 'lead', 'pad', 'pluck', 'keys'];

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
  },
];

export const PRESETS = SOUNDS.map(({ kind, ...sound }) => ({ kind, patch: normalizePatch(sound) }));
export const PRESET_LIST = PRESETS.map((p) => ({ name: p.patch.name, kind: p.kind }));

// a preset by its name, or by how its name starts ("acid", "warm")
export function preset(name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  const found = wanted && (PRESETS.find((p) => p.patch.name.toLowerCase() === wanted) || PRESETS.find((p) => p.patch.name.toLowerCase().startsWith(wanted)));
  if (!found) throw new Error(`no preset "${name}" (there are: ${PRESET_LIST.map((p) => p.name).join(', ')})`);
  return found.patch;
}
