// Track analysis (lib/analyze.mjs) on a 5-minute synthetic track: full analyzeFile(), the cheaper refineTrack(),
// and barFeatures() alone (pure JS, FFT-bound; the other two include an ffmpeg decode no JS change can move).
import fs from 'node:fs';
import { compare, digest, synthTrack, versions, writeWav } from './util.mjs';

const { base, cur, ref } = await versions('lib/analyze.mjs');
const file = writeWav('dj-bench-analyze.wav', synthTrack());
try {
  const out = [];
  for (const m of [base, cur]) {
    const { analyzedAt, ...a } = await m.analyzeFile(file);
    out.push({ a, analyze: digest(a), refine: digest(await m.refineTrack({ ...a, file }, { grid: { shiftBeats: 1 } })) });
  }
  const a = out[1].a;
  console.log(`track   ${a.bpm} BPM, ${a.camelot}, ${a.bars} bars`);
  console.log(`output  ${ref}: analyze ${out[0].analyze} refine ${out[0].refine}   current: analyze ${out[1].analyze} refine ${out[1].refine}`);
  const x = await cur.decodeMono(file);
  const run = (fn) => [(() => fn(base)), (() => fn(cur))];
  await compare('barFeatures (pure JS)', ...run((m) => m.barFeatures(x, x, a.bpm, a.firstBeat, a.duration)), { runs: 31 });
  await compare('analyzeFile', ...run((m) => m.analyzeFile(file)), { runs: 11, warmup: 1 });
  await compare('refineTrack', ...run((m) => m.refineTrack({ ...a, file }, { grid: { shiftBeats: 1 } })), { runs: 11, warmup: 1 });
} finally { fs.rmSync(file, { force: true }); }
