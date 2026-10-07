// The deck AudioWorklet's render loop (DeckVoice.process in apps/web/public/worklets/deck-player.js): 20 s of audio in
// 128-frame quanta, the way the browser calls it. `realtime` = how many decks of that kind one core could render.
import { compare, digest, synthTrack, versions } from './util.mjs';

const { base, cur, ref } = await versions('public/worklets/deck-player.js');
const SR = 48000, SECONDS = 20, BLOCK = 128, BLOCKS = Math.floor((SECONDS * SR) / BLOCK);
const pcm = [1, 2, 3, 4].map((seed) => synthTrack({ sr: SR, seconds: SECONDS + 10, seed }));

function scenario(mod, { stems, rate = 1, keylock = false, semis = 0, loop = null, automate = false, events = [] }) {
  const v = new mod.DeckVoice(SR), frames = pcm[0].length / 2;
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
  const flat = [1, 0.8, 0.6, 0.9].map((g) => Float32Array.of(g));
  const ramp = [0, 1, 2, 3].map((s) => Float32Array.from({ length: BLOCK }, (_, i) => 0.5 + (0.4 * ((i + s * 17) % BLOCK)) / BLOCK));
  return (keep = false) => {
    const out = keep ? new Float32Array(BLOCKS * BLOCK * 2) : null;
    v.onMessage({ type: 'load', bufs: pcm.slice(0, stems).map((p) => p.buffer), offsets: new Array(stems).fill(0), frames });
    v.onMessage({ type: 'keylock', on: keylock }); v.onMessage({ type: 'semis', v: semis });
    v.onMessage({ type: 'events', clear: 'all', events: [{ t: 0, type: 'rate', rate }, { t: 0, type: 'loop', loop }, { t: 0, type: 'start', pos: 1 }, ...events] });
    v.frameNow = 0;
    const gains = stems > 1 ? (automate ? ramp : flat) : null;
    for (let b = 0; b < BLOCKS; b++) {
      v.process(L, R, BLOCK, b * BLOCK, gains);
      if (out) { out.set(L, 2 * b * BLOCK); out.set(R, (2 * b + 1) * BLOCK); }
    }
    return out;
  };
}

const cases = {
  'varispeed, full mix': { stems: 1, rate: 1.03 },
  'varispeed, 4 stems': { stems: 4, rate: 1.03 },
  'varispeed, 4 stems, gain ramps': { stems: 4, rate: 1.03, automate: true },
  'key lock (WSOLA), full mix': { stems: 1, rate: 1.03, keylock: true },
  'key lock (WSOLA), 4 stems': { stems: 4, rate: 1.03, keylock: true },
  'key lock + shift, 4 stems, loop': { stems: 4, rate: 0.97, keylock: true, semis: 2, loop: { start: 2, end: 2 + 60 / 128 * 4 } },
  // jump crossfades, reverse into the start of the track, then running off its end
  'seeks, reverse, track end, 4 stems': { stems: 4, events: [{ t: 0.5, type: 'start', pos: 0 }, { t: 3, type: 'seek', pos: 25.0001 }, { t: 5, type: 'rate', rate: -3 }, { t: 15, type: 'rate', rate: 1.5 }, { t: 16, type: 'seek', pos: 27 }] },
};
console.log(`${ref} vs current, ${SECONDS} s of audio per run`);
for (const [name, opt] of Object.entries(cases)) {
  const b = scenario(base, opt), c = scenario(cur, opt);
  const same = digest(b(true)) === digest(c(true));
  const r = await compare(name, () => b(), () => c(), { runs: 21 });
  console.log(`${''.padEnd(34)} output ${same ? 'identical' : 'DIFFERS'}   realtime x${((SECONDS * 1000) / r.base.min).toFixed(0)} -> x${((SECONDS * 1000) / r.cur.min).toFixed(0)}`);
}
