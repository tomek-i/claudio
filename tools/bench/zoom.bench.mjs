// Scrolling-waveform peaks (zoomFromInt16 in apps/web/public/worklets/deck-player.js), built once per track load in the
// zoom worker: a 5-minute track as the full mix (1 source) and as 4 stems.
import { compare, digest, synthTrack, versions } from './util.mjs';

const { base, cur, ref } = await versions('public/worklets/deck-player.js');
const SR = 48000, SECONDS = 300;
const one = synthTrack({ sr: SR, seconds: SECONDS }), frames = one.length / 2;
// four distinct sources without synthesising four tracks: offset views of the same PCM
const four = [0, 1, 2, 3].map((k) => one.subarray(2 * k * 1000, 2 * (frames - 4000 + k * 1000)));
console.log(`${ref} vs current, ${SECONDS} s track`);
for (const [name, srcs, n] of [['zoom peaks, full mix', [one], frames], ['zoom peaks, 4 stems', four, frames - 4000]]) {
  const run = (m) => () => m.zoomFromInt16(srcs, n, SR);
  const d = (m) => { const z = run(m)(); return digest(z.full, z.low, z.perSec); };
  const same = d(base) === d(cur);
  await compare(name, run(base), run(cur), { runs: 15 });
  console.log(`${''.padEnd(34)} output ${same ? 'identical' : 'DIFFERS'}`);
}
