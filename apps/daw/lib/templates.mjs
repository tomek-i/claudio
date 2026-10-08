// Songs to start from, so a new project is not an empty page. Written the way the CLI writes them: drum rows
// and notes as text (parseRow in project.mjs, parseNotes in notes.mjs).
import { STEPS_PER_BAR, normalizeProject, parseRow } from './project.mjs';
import { parseNotes } from './notes.mjs';

// a drum clip from rows of text; the longest row is the length of its content
function drums(bar, bars, ...lines) {
  const rows = lines.map(parseRow);
  const steps = Math.max(...rows.map((r) => r.vel.length));
  return { bar, bars, len: steps / STEPS_PER_BAR, rows: Object.fromEntries(rows.map((r) => [r.voice, Array.from({ length: steps }, (_, s) => r.vel[s % r.vel.length])])) };
}

const notes = (bar, bars, len, text) => ({ bar, bars, len, notes: parseNotes(text) });

// one figure played in every bar, on that bar's notes: `at` is the bar's first sixteenth
const perBar = (list, figure) => list.map((x, i) => figure(x, i * STEPS_PER_BAR)).join(' ');

const SONGS = [
  {
    name: 'Night drive', bpm: 122, bars: 16, loop: { on: false, from: 4, to: 16 },
    tracks: [
      {
        kind: 'drums', name: 'Drums', vol: 0.85, clips: [
          drums(0, 4, 'kick x...x...x...x...', 'hat ..o...o...o...o.'),
          drums(4, 12, 'kick x...x...x...x...', 'clap ....X.......X...', 'hat ogo.ogo.ogo.ogo.', 'open ..x...x...x...x.'),
        ],
      },
      {                                               // A minor, F, C, G: the root on every off-beat
        kind: 'synth', name: 'Bass', preset: 'bass', vol: 0.8, clips: [
          notes(4, 12, 4, perBar(['A1', 'F1', 'C2', 'G1'], (n, at) => `${n}:${at + 2}:2 ${n}:${at + 6}:2 ${n}:${at + 10}:2 ${n}:${at + 14}:2`)),
        ],
      },
      {
        kind: 'synth', name: 'Pad', preset: 'pad', vol: 0.7, reverb: 0.45, clips: [
          notes(0, 16, 4, perBar(['A3+C4+E4', 'A3+C4+F4', 'G3+C4+E4', 'G3+B3+D4'], (chord, at) => `${chord}:${at}:16:80`)),
        ],
      },
      {
        kind: 'synth', name: 'Pluck', preset: 'pluck', vol: 0.65, pan: 0.15, reverb: 0.2, delay: 0.35, clips: [
          notes(8, 8, 4, perBar([['E5', 'C5', 'A4'], ['F5', 'C5', 'A4'], ['E5', 'C5', 'G4'], ['D5', 'B4', 'G4']],
            ([a, b, c], at) => `${a}:${at}:3 ${b}:${at + 3}:3 ${c}:${at + 6}:2 ${b}:${at + 8}:3 ${a}:${at + 11}:3 ${c}:${at + 14}:2`)),
        ],
      },
    ],
  },
  {
    name: 'Slow tape', bpm: 84, swing: 0.5, bars: 8, loop: { on: true, from: 0, to: 8 },
    tracks: [
      { kind: 'drums', name: 'Drums', vol: 0.85, clips: [drums(0, 8, 'kick x......x..x.....', 'snare ....x.......x...', 'hat x.xgx.xgx.xgx.xg')] },
      {                                               // D minor 7, G7, C major 7, A minor 7
        kind: 'synth', name: 'Bass', preset: 'bass', vol: 0.75, clips: [
          notes(0, 8, 4, perBar(['D2', 'G1', 'C2', 'A1'], (n, at) => `${n}:${at}:6 ${n}:${at + 10}:2 ${n}:${at + 13}:2`)),
        ],
      },
      {
        kind: 'synth', name: 'Keys', preset: 'keys', vol: 0.75, reverb: 0.3, clips: [
          notes(0, 8, 4, perBar(['D3+F3+A3+C4', 'D3+F3+G3+B3', 'C3+E3+G3+B3', 'C3+E3+G3+A3'], (chord, at) => `${chord}:${at}:6:85 ${chord}:${at + 10}:4:70`)),
        ],
      },
      {
        kind: 'synth', name: 'Lead', preset: 'lead', vol: 0.5, pan: -0.1, reverb: 0.25, delay: 0.3, clips: [
          notes(4, 4, 4, 'A4:2:2 C5:4:4 D5:10:4 B4:18:2 D5:20:4 G4:26:4 E5:34:2 D5:36:2 C5:38:4 G4:44:3 A4:50:6 C5:58:4'),
        ],
      },
    ],
  },
  {
    name: 'Blank', bpm: 120, bars: 8, loop: { on: false, from: 0, to: 4 },
    tracks: [{ kind: 'drums', name: 'Drums' }, { kind: 'synth', name: 'Bass', preset: 'bass' }],
  },
];

export const TEMPLATES = SONGS.map(normalizeProject);
export const TEMPLATE_NAMES = TEMPLATES.map((t) => t.name);

export function template(name) {
  const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = TEMPLATES.map((t) => t.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const i = names.indexOf(key) >= 0 ? names.indexOf(key) : key ? names.findIndex((n) => n.startsWith(key)) : -1;
  if (i < 0) throw new Error(`no template called "${name}" (there are: ${TEMPLATE_NAMES.join(', ')})`);
  return TEMPLATES[i];
}
