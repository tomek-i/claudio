// Starting beats, each with its own tempo and swing. Written as rows of text (see parseRow in pattern.mjs) and,
// where one is named, given a feel with a fixed seed, so a preset is the same beat every time.
import { applyOp, emptyPattern } from './pattern.mjs';
import { humanize } from './groove.mjs';

const BEATS = [
  {
    name: 'Boom bap', bpm: 90, swing: 0.5, feel: 'laidback', rows: [
      'kick  x......x..x.....',
      'snare ....X.......X...',
      'hat   x.x.x.x.x.x.x.x.',
    ],
  },
  {
    name: 'House', bpm: 124, swing: 0.1, feel: 'tight', rows: [
      'kick  x...x...x...x...',
      'clap  ....X.......X...',
      'hat   xg.gxg.gxg.gxg.g',
      'open  ..x...x...x...x.',
    ],
  },
  {
    name: 'Trap', bpm: 140, swing: 0, rows: [
      'kick  x......x..x.....',
      'clap  ........X.......',
      'hat   x.x.x.xxx.x.xg.g',
      'open  ..............x.',
    ],
  },
  {
    name: 'Breakbeat', bpm: 135, swing: 0.15, feel: 'pushed', rows: [
      'kick  x.x.......xx....',
      'snare ....X..g.g..X..g',
      'hat   x.x.x.x.x.x.x.x.',
    ],
  },
  {
    name: 'Two-step', bpm: 132, swing: 0.35, feel: 'tight', rows: [
      'kick  x.........x.....',
      'snare ....X.......X...',
      'hat   ..x.x.x...x.x.xg',
      'rim   .......g........',
    ],
  },
  {
    name: 'Dembow', bpm: 95, swing: 0, rows: [
      'kick  x...x...x...x...',
      'snare ...x..x....x..x.',
      'hat   x.x.x.x.x.x.x.x.',
    ],
  },
  {
    name: 'Bell groove', bpm: 108, swing: 0.2, feel: 'laidback', rows: [
      'kick  x.....x...x.....',
      'rim   ..x..x....x..x..',
      'hat   x.oxx.oxx.oxx.ox',
      'bell  x..x..x...x.x...',
      'tom   ..............oo',
    ],
  },
  {
    name: 'Slow drunk', bpm: 78, swing: 0.6, feel: 'drunk', rows: [
      'kick  x.....x..x......',
      'snare ....X.......X..g',
      'hat   x.o.x.o.x.o.x.oo',
    ],
  },
];

export const PRESETS = BEATS.map((beat, i) => {
  let p = { ...emptyPattern(beat.name), bpm: beat.bpm, swing: beat.swing };
  p = applyOp(p, { op: 'write', lines: beat.rows });
  return beat.feel ? humanize(p, { feel: beat.feel, amount: 0.6, seed: 1000 + i }) : p;
});

export const PRESET_NAMES = PRESETS.map((p) => p.name);

export function preset(name) {
  const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = PRESETS.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key)
    || PRESETS.find((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key));
  if (!found || !key) throw new Error(`no preset called "${name}" (there are: ${PRESET_NAMES.join(', ')})`);
  return found;
}
