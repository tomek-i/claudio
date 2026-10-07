// Library queries (apps/server/lib/library.mjs) on a synthetic 500-track library where half the tracks have stems on disk:
// suggest() as the CLI and auto-DJ call it, and search() as the crate (`/api/library`, limit 500) calls it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compare, digest, rng, versions } from './util.mjs';

const { base, cur, ref } = await versions('lib/library.mjs');
const N = 500, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-bench-lib-')), stemsDir = path.join(dir, 'stems'), r = rng(5);
const tracks = Array.from({ length: N }, (_, i) => {
  const id = i.toString(16).padStart(8, '0');
  if (i % 2) { fs.mkdirSync(path.join(stemsDir, id), { recursive: true }); for (const s of ['vocals', 'drums', 'bass', 'other']) fs.writeFileSync(path.join(stemsDir, id, `${s}.wav`), ''); }
  return {
    id, file: path.join(dir, `Artist ${i % 40} - Track ${i}.mp3`), size: 1, mtimeMs: 1, title: `Track ${i}`, artist: `Artist ${i % 40}`, genre: ['house', 'techno', 'trance'][i % 3],
    bpm: +(118 + r() * 24).toFixed(2), camelot: `${1 + Math.floor(r() * 12)}${r() < 0.5 ? 'A' : 'B'}`, energy: 1 + Math.floor(r() * 10), duration: 240 + Math.floor(r() * 120),
    firstBeat: 0.1, mixOut: 200, vocalPct: +r().toFixed(2), addedAt: new Date(1.7e12 + i * 1e6).toISOString(),
    waveform: { peaks: Array.from({ length: 800 }, r), lows: Array.from({ length: 800 }, r) }, phraseEnergy: Array.from({ length: 20 }, r), barEnergy: Array.from({ length: 160 }, r),
  };
});
fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ tracks }));
try {
  const lib = (m) => new m.Library({ dirs: [], cacheFile: path.join(dir, 'library.json'), stemsDir });
  const b = lib(base), c = lib(cur), from = tracks[7].id;
  const cases = {
    'suggest, top 10 (dj suggest)': (l) => l.suggest({ from, direction: 'up' }),
    'suggest, top 1 (auto-DJ pick)': (l) => l.suggest({ from, limit: 1, exclude: [tracks[3].id], keylock: true }),
    'search, 500 rows (crate load)': (l) => l.search({ limit: 500 }),
    'search, text query, 60 rows': (l) => l.search({ q: 'artist 7', limit: 60 }),
  };
  console.log(`${ref} vs current, ${N} tracks`);
  for (const [name, fn] of Object.entries(cases)) {
    const same = digest(fn(b)) === digest(fn(c));
    await compare(name, () => fn(b), () => fn(c), { runs: 31 });
    console.log(`${''.padEnd(34)} output ${same ? 'identical' : 'DIFFERS'}`);
  }
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
