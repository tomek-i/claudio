// Fixture library for the server tests: synthetic tracks run through the real analyser, so the tests need no music
// on the machine and get the same library everywhere.
//  - buildFixtures(): renders two tracks (150 and 110 BPM, with an intro, a breakdown, a drop and an outro) as WAVs,
//    analyses them once and caches audio + analysis in the scratch base (rebuilt when FIXTURE_VERSION or the
//    analyser version changes).
//  - TRACKS: the library the tests see. Each entry is one of the two renders under its own file name (so its own id)
//    with the tags a test asks for by role: tempo, key, energy.
// Run directly (`node test/fixtures.mjs <cacheDir>`) it just builds the cache; server-harness.mjs does that.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANALYSIS_VERSION, STRUCT_VERSION } from '../lib/analyze.mjs';
import { Library } from '../lib/library.mjs';

const FIXTURE_VERSION = 1, SR = 22050;

// role -> which render it is and how it is tagged. `main` is the track most tests play; the others are named for
// what they are to it.
export const TRACKS = {
  main:   { render: 150, title: 'Fixture Main', camelot: '6A', key: 'Gm', energy: 8 },
  second: { render: 150, title: 'Fixture Second', camelot: '7A', key: 'Dm', energy: 8 },   // same tempo, neighbouring key
  bed:    { render: 150, title: 'Fixture Bed', camelot: '6B', key: 'Bb', energy: 7 },      // relative major
  vocal:  { render: 150, title: 'Fixture Vocal', camelot: '5A', key: 'Cm', energy: 7 },    // neighbouring key
  clash:  { render: 150, title: 'Fixture Clash', camelot: '1B', key: 'B', energy: 8 },     // same tempo, clashing key
  far:    { render: 110, title: 'Fixture Far', camelot: '6A', key: 'Gm', energy: 5 },      // big tempo gap
};

// 8 bars intro (no kick), 32 bars verse (a softer kick, a little bass), 8 bars breakdown (pad only), 56 bars drop (full
// kick + bass), 16 bars outro (kick, no bass). The verse is kept well under the drop so the first drop is the one
// after the breakdown, as on a real track.
function render(bpm) {
  const beat = 60 / bpm, bars = 120, first = 0.5, n = Math.round((first + bars * 4 * beat + 1) * SR), x = new Float32Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const section = (bar) => (bar < 8 ? 'intro' : bar < 40 ? 'verse' : bar < 48 ? 'break' : bar < 104 ? 'drop' : 'outro');
  for (let b = 0; b < bars * 4; b++) {
    const t = first + b * beat, s0 = Math.round(t * SR), sec = section(Math.floor(b / 4));
    if (sec !== 'intro' && sec !== 'break') {
      for (let k = 0; k < SR * 0.25 && s0 + k < n; k++) { // kick
        const tt = k / SR;
        x[s0 + k] += (sec === 'verse' ? 0.6 : 0.8) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12);
        if (k < SR * 0.01) x[s0 + k] += 0.2 * rnd() * (1 - k / (SR * 0.01));
      }
    }
    if (sec === 'drop' || sec === 'verse') { // off-beat bass note, lighter in the verse
      const b0 = Math.round((t + beat / 2) * SR), len = Math.round(beat * 0.4 * SR);
      for (let k = 0; k < len && b0 + k < n; k++) x[b0 + k] += (sec === 'verse' ? 0.15 : 0.35) * Math.sin(2 * Math.PI * 98 * (k / SR)) * Math.sin((Math.PI * k) / len);
    }
    const h0 = Math.round((t + beat / 2) * SR); // off-beat hat, quieter where there is no kick
    for (let k = 0; k < SR * 0.02 && h0 + k < n; k++) x[h0 + k] += (sec === 'break' ? 0.05 : 0.15) * rnd() * Math.exp(-k / (SR * 0.004));
  }
  for (let i = 0; i < n; i++) { // a G minor pad all the way through, up front in the breakdown
    const t = i / SR, bar = Math.floor((t - first) / (4 * beat)), level = section(bar) === 'break' ? 0.22 : section(bar) === 'intro' ? 0.12 : 0.05;
    x[i] += level * (Math.sin(2 * Math.PI * 196 * t) + Math.sin(2 * Math.PI * 233.08 * t) + Math.sin(2 * Math.PI * 293.66 * t)) / 3;
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 20000))), 44 + i * 2);
  return buf;
}

export const fixtureDir = (base) => path.join(base, `_fixtures-v${FIXTURE_VERSION}-a${ANALYSIS_VERSION}s${STRUCT_VERSION}`);
async function buildFixtures(base) {
  const final = fixtureDir(base);
  if (fs.existsSync(path.join(final, 'analysis.json'))) return final;
  // test files run in parallel: build in a private folder, then move it into place in one step
  const dir = `${final}.tmp-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const lib = new Library({ dirs: [], cacheFile: path.join(dir, 'unused.json') });
  const analysis = {};
  for (const bpm of [...new Set(Object.values(TRACKS).map((t) => t.render))]) {
    const file = path.join(dir, `render-${bpm}.wav`);
    fs.writeFileSync(file, render(bpm));
    const { id, file: _f, size, mtimeMs, addedAt, title, artist, ...a } = await lib.analyzeOne(file);
    analysis[bpm] = a;
  }
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(analysis));
  try { fs.renameSync(dir, final); } catch { fs.rmSync(dir, { recursive: true, force: true }); } // another file got there first
  return final;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildFixtures(process.argv[2]);
