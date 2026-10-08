// What the machine can do to a beat by itself: give it a feel, make versions of it, write its second bar, move
// it towards another beat. These are rules about how drummers play, with a seeded random number generator, so
// the same seed gives the same result. (The writing of beats from a description is Claude's part: see cl808.mjs.)
import { LEVELS, levelOf } from './kit.mjs';
import { clonePattern, normalizePattern, resize } from './pattern.mjs';

export function rng(seed) {                         // mulberry32
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// ---- humanize

// A feel: where each voice sits against the grid (in steps; + is late), and how much it wanders.
export const FEELS = {
  tight: { about: 'on the grid, with a played touch', jitter: 0.015, vel: 0.05, bias: {} },
  laidback: { about: 'snare and hats behind the beat', jitter: 0.03, vel: 0.08, bias: { snare: 0.07, clap: 0.08, hat: 0.035, open: 0.035, rim: 0.05, tom: 0.03 } },
  pushed: { about: 'hats and snare ahead of the beat', jitter: 0.025, vel: 0.07, bias: { hat: -0.05, open: -0.04, snare: -0.03, clap: -0.03, kick: -0.01, bell: -0.03 } },
  drunk: { about: 'late hats, rushed snare, a loose kick', jitter: 0.05, vel: 0.12, bias: { hat: 0.1, open: 0.09, snare: -0.06, clap: -0.05, kick: 0.025, rim: 0.06, bell: 0.08 } },
};

// how hard a hit is played by where it falls in the beat: on the beat, on the "and", on the "e" or "a"
const HAT_SHAPE = [1, 0.68, 0.84, 0.66];
const OTHER_SHAPE = [1, 0.9, 0.96, 0.9];
// a hit stays within its own level (a soft hit stays the softer of two), which is what lets a second pass start over
const BANDS = { ghost: [0.14, 0.42], soft: [0.43, 0.67], normal: [0.68, 0.89], accent: [0.91, 1] };

// Moves the hits that are there and changes how hard they are played. It never adds or removes one, and it
// starts from the grid each time, so humanizing twice does not pile one feel on another.
export function humanize(pattern, { feel = 'laidback', amount = 0.6, seed = newSeed() } = {}) {
  const f = FEELS[feel];
  if (!f) throw new Error(`no feel called "${feel}" (there are: ${Object.keys(FEELS).join(', ')})`);
  const k = clamp(Number(amount), 0, 1);
  const r = rng(seed);
  const out = clonePattern(pattern);
  for (const t of out.tracks) {
    const hats = t.voice === 'hat' || t.voice === 'open';
    for (let s = 0; s < out.steps; s++) {
      if (!(t.vel[s] > 0)) continue;
      const level = levelOf(t.vel[s]);
      const shape = (hats ? HAT_SHAPE : OTHER_SHAPE)[s % 4];
      const played = level === 'accent' || level === 'ghost' ? 1 : lerp(1, shape, k);   // accents and ghosts are meant
      t.vel[s] = clamp(LEVELS[level] * played * (1 + gauss(r) * f.vel * k), ...BANDS[level]);
      const anchor = t.voice === 'kick' && s % 4 === 0;                                  // the kick on the beat holds the time
      const wander = gauss(r) * f.jitter * (anchor ? 0.3 : 1);
      const lean = (f.bias[t.voice] || 0) * (anchor ? 0.3 : 1) + (level === 'ghost' ? 0.03 : 0);
      t.off[s] = s === 0 && anchor ? 0 : k * (lean + wander);
    }
  }
  return normalizePattern(out);
}

// ---- variations

const BACKBEAT = new Set([4, 12]);
const isAnchor = (voice, s) => (voice === 'kick' && s % 16 === 0) || ((voice === 'snare' || voice === 'clap') && BACKBEAT.has(s % 16));

// the chance that an empty step of a voice gets a hit, at full wildness, and what kind of hit
function addition(voice, s, busy, w, r) {
  const odd = s % 2 === 1;
  switch (voice) {
    case 'hat': return r() < 0.2 * w ? (odd ? LEVELS.ghost : LEVELS.soft) : 0;
    case 'kick': return r() < (odd ? (w > 0.5 ? 0.06 : 0) : 0.1) * w ? LEVELS.normal : 0;
    case 'snare': return r() < 0.09 * w ? LEVELS.ghost : 0;
    case 'open': return s % 4 === 2 && r() < 0.1 * w ? LEVELS.soft : 0;
    default: return (busy || w > 0.7) && r() < 0.05 * w ? LEVELS.soft : 0;
  }
}

function variation(pattern, w, r) {
  const out = clonePattern(pattern);
  const levels = Object.values(LEVELS);
  for (const t of out.tracks) {
    const busy = t.vel.some((v) => v > 0);
    const before = [...t.vel];
    for (let s = 0; s < out.steps; s++) {
      const safe = isAnchor(t.voice, s) && w <= 0.8;
      if (before[s] > 0) {
        if (safe) continue;
        const roll = r();
        if (roll < 0.22 * w) { t.vel[s] = 0; t.off[s] = 0; }                             // drop it
        else if (roll < 0.5 * w) {                                                       // move it
          const to = s + (r() < 0.5 ? -1 : 1) * (w > 0.6 && r() < 0.4 ? 2 : 1);
          if (to >= 0 && to < out.steps && !(t.vel[to] > 0) && !(before[to] > 0)) {
            t.vel[to] = t.vel[s]; t.off[to] = t.off[s];
            t.vel[s] = 0; t.off[s] = 0;
          }
        } else if (roll < 0.75 * w) {                                                    // play it harder or softer
          const i = levels.indexOf(LEVELS[levelOf(t.vel[s])]);
          t.vel[s] = levels[clamp(i + (r() < 0.5 ? -1 : 1), 0, levels.length - 1)];
        }
      } else if (!(t.vel[s] > 0)) {
        t.vel[s] = addition(t.voice, s, busy, w, r);
      }
    }
  }
  return normalizePattern(out);
}

const sameHits = (a, b) => a.tracks.every((t, i) => t.vel.every((v, s) => v === b.tracks[i].vel[s]));

// `count` beats near this one. wild 0..1: from a hit or two changed to a different beat on the same bones.
export function variations(pattern, { wild = 0.4, seed = newSeed(), count = 4 } = {}) {
  const w = clamp(Number(wild), 0.05, 1);
  const base = clonePattern(pattern);
  const out = [];
  for (let i = 0; i < count; i++) {
    let v = base;
    for (let attempt = 0; attempt < 12 && sameHits(v, base); attempt++) v = variation(base, w, rng(seed + i * 7919 + attempt * 104729));
    out.push(v);
  }
  return out;
}

// ---- continue

// what the last beat of the second bar can be: velocities for the four steps, per voice
const FILLS = [
  { snare: [0.55, 0, 0.7, 1], kick: [0, 0.8, 0, 0] },
  { snare: [0.3, 0.55, 0.8, 1] },
  { tom: [0.8, 0, 0.8, 0.8], snare: [0, 0.55, 0, 0] },
  { kick: [0.8, 0, 0.8, 0], snare: [0, 0.8, 0, 1] },
  { tom: [0.55, 0.8, 0, 0], snare: [0, 0, 0.8, 1] },
];

// Writes bar 2 from bar 1: the same beat with a few things changed, and a fill on its last beat. A 16-step
// pattern becomes a 32-step one; a 32-step one has its second bar written again.
export function continuePattern(pattern, { seed = newSeed() } = {}) {
  const r = rng(seed);
  const bar1 = resize(pattern, 16);
  const [bar2] = variations(bar1, { wild: 0.3, seed, count: 1 });
  const fill = FILLS[Math.floor(r() * FILLS.length)];
  const out = resize(bar1, 32);
  for (const t of out.tracks) {
    const src = bar2.tracks.find((b) => b.voice === t.voice);
    for (let s = 0; s < 16; s++) { t.vel[16 + s] = src.vel[s]; t.off[16 + s] = src.off[s]; }
    for (let i = 0; i < 4; i++) {
      const s = 28 + i;
      if (fill[t.voice]) { t.vel[s] = fill[t.voice][i]; t.off[s] = 0; }
      else if (t.voice !== 'hat') { t.vel[s] = 0; t.off[s] = 0; }                        // the fill has the bar's end to itself, over the hats
    }
  }
  return normalizePattern(out);
}

// ---- morph

// a number from 0 to 1 for one cell of the grid, the same every time: the order hits leave and arrive in
function cellRank(track, step, seed) {
  return rng((seed + 1) * 2654435761 + track * 40503 + step * 9973)();
}

// The beat `amount` of the way from a to b (0 is a, 1 is b). Hits both beats have slide between them; a hit only
// one has leaves or arrives at its own point on the way, so moving the amount changes a few hits at a time.
export function morph(a, b, amount, seed = 1) {
  const t = clamp(Number(amount), 0, 1);
  const steps = Math.max(a.steps, b.steps);
  const from = resize(a, steps);
  const to = resize(b, steps);
  const out = clonePattern(t < 0.5 ? from : to);
  out.bpm = lerp(from.bpm, to.bpm, t);
  out.swing = lerp(from.swing, to.swing, t);
  out.tracks.forEach((track, i) => {
    const x = from.tracks[i];
    const y = to.tracks[i];
    track.level = lerp(x.level, y.level, t);
    track.tune = lerp(x.tune, y.tune, t);
    for (let s = 0; s < steps; s++) {
      const rank = cellRank(i, s, seed);
      const inA = x.vel[s] > 0;
      const inB = y.vel[s] > 0;
      if (inA && inB) { track.vel[s] = lerp(x.vel[s], y.vel[s], t); track.off[s] = lerp(x.off[s], y.off[s], t); }
      else if (inA && rank >= t) { track.vel[s] = x.vel[s]; track.off[s] = x.off[s]; }
      else if (inB && rank < t) { track.vel[s] = y.vel[s]; track.off[s] = y.off[s]; }
      else { track.vel[s] = 0; track.off[s] = 0; }
    }
  });
  return normalizePattern(out);
}
