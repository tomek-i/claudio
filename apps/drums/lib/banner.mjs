// The server's startup banner. In a terminal the logo comes in with one of the ANIMATIONS below (picked at random,
// or by name with CL808_BANNER=<name>) over a strip of sequencer pads, and settles on the beat that is loaded. The
// strip then stays live: it shows the beat as it is edited, and a playhead runs through it while the page plays,
// until something else prints. Anywhere else (a log file, a pipe, NO_COLOR) it is the same facts as plain lines.

const GLYPHS = {
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  '-': ['     ', '     ', ' ███ ', '     ', '     '],
  8: [' ███ ', '█   █', ' ███ ', '█   █', ' ███ '],
  0: [' ███ ', '█  ██', '█ █ █', '██  █', ' ███ '],
};
const TEXT = 'CLAUDE-808', ROWS = 5, LOGO_W = TEXT.length * 6 - 1;
const LOW = [255, 122, 69], MID = [54, 214, 231], HIGH = [155, 229, 100], PERC = [199, 146, 234]; // the rows' colours on the page
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const ESC = '\x1b[';

// the four lanes of the strip, and which voices of the kit each one shows
const LANES = [
  { name: 'kick', voices: ['kick'], color: LOW },
  { name: 'snare', voices: ['snare', 'clap'], color: MID },
  { name: 'hats', voices: ['hat', 'open'], color: HIGH },
  { name: 'perc', voices: ['tom', 'rim', 'bell'], color: PERC },
];
const LABEL = 6, STEPS = 16;
const CELL = 2, CELL_WIDE = 5;   // how wide a pad is drawn, so that the sixteen of them reach about as far as the logo
// what the strip shows when no beat is given (the preview, the tests)
export const REST_LANES = ['x......x..x.....', '....X.......X...', 'x.o.x.o.x.o.x.og', '..............o.']
  .map((row) => [...row].map((c) => ({ '.': 0, g: 0.3, o: 0.55, x: 0.8, X: 1 })[c]));

export function logoRows(wide = false) {
  return [0, 1, 2, 3, 4].map((r) => [...TEXT].map((ch) => GLYPHS[ch][r]).join(' ').replace(/./g, (c) => (wide ? c + c : c)));
}

// one bar (16 steps) of a pattern as the strip's four lanes: the hardest hit of each lane's voices on every step
export function lanesOf(pattern, bar = 0) {
  return LANES.map((lane) => Array.from({ length: STEPS }, (_, s) => Math.max(0, ...pattern.tracks
    .filter((t) => lane.voices.includes(t.voice) && !t.mute)
    .map((t) => t.vel[(bar * STEPS + s) % pattern.steps] || 0))));
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const out3 = (t) => 1 - (1 - t) ** 3;
const blend = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
const grad = (u) => (u < 0.5 ? blend(LOW, MID, u * 2) : blend(MID, HIGH, (u - 0.5) * 2)); // kick → snare → hats, left to right
const noise = (x, y, f = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + f * 37.719) * 43758.5453; return v - Math.floor(v); };
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

// An animation draws the logo, cell(x, y, p, logo, scene) → [character, rgb] or null, and says how much of each pad
// of the strip is there yet, pads(lane, step, p) → 0..1. head(p) is the step the playhead is on, when it has one.
// p runs from 0 to 1, and at 1 every animation shows the same thing: the whole logo, the whole strip, no playhead.
const KICKS = 4, HITS = 14;
const rollHits = (p) => { let n = 0; while (n < HITS && 0.8 * (1 - 0.82 ** (n + 1)) / (1 - 0.82 ** HITS) <= p) n++; return p >= 0.8 ? HITS : n; };
const snap = (p) => Math.floor(clamp(p / 0.8) * 6) / 6;

export const ANIMATIONS = {
  // a playhead crosses the logo in sixteen steps and writes it as it goes
  steps: {
    ms: 1900,
    head: (p) => (p < 0.85 ? Math.floor((p / 0.85) * STEPS) : -1),
    cell(x, y, p, { w, on }) {
      if (p >= 0.85) return on(x, y) ? ['█', grad(x / w)] : null;
      const edge = (Math.floor((p / 0.85) * STEPS) / STEPS) * w;
      if (x >= edge && x < edge + w / STEPS) return on(x, y) ? ['█', WHITE] : ['░', [70, 70, 85]];
      return x < edge && on(x, y) ? ['█', grad(x / w)] : null;
    },
    pads: (lane, s, p) => (p >= 0.85 || s <= Math.floor((p / 0.85) * STEPS) ? 1 : 0),
  },
  // four on the floor: every kick shakes the logo and opens another part of it, from the middle row out
  kick: {
    ms: 2000,
    cell(x, y, p, { w, gw, on }) {
      const k = Math.min(KICKS, Math.floor(p / 0.2) + 1), since = p - (k - 1) * 0.2;
      const flash = p < 0.9 ? Math.exp(-since * 18) : 0;
      if (Math.abs(y - 2) > k - 1) return null;
      const sx = x - (flash > 0.5 ? (k % 2 ? gw : -gw) : 0);
      return on(sx, y) ? ['█', blend(blend(BLACK, grad(x / w), 0.4 + 0.2 * (k - 1)), WHITE, flash * 0.85)] : null;
    },
    pads: (lane, s, p) => (Math.min(KICKS, Math.floor(p / 0.2) + 1) > lane ? 1 : 0),
  },
  // a snare roll that speeds up: every stroke brings more of the logo, and the crash at the end brings the rest
  roll: {
    ms: 2200,
    cell(x, y, p, { w, on }) {
      if (!on(x, y)) return null;
      if (p >= 0.8) return ['█', blend(WHITE, grad(x / w), clamp((p - 0.8) / 0.15))];
      const n = rollHits(p), at = noise(x, y, 1) * HITS;
      if (at >= n) return null;
      return at >= n - 1 ? ['▓', WHITE] : ['█', blend(BLACK, grad(x / w), 0.75)];   // the newest stroke is the bright one
    },
    pads: (lane, s, p) => (p >= 0.8 || (lane === 1 && s < (rollHits(p) * STEPS) / HITS) ? 1 : 0),
  },
  // swing: the rows slide in from both sides, and every second one arrives late
  shuffle: {
    ms: 2000,
    cell(x, y, p, { w, on }) {
      const e = out3(clamp((p - (y % 2 ? 0.18 : 0)) / 0.78)), off = (y % 2 ? 1 : -1) * Math.round((1 - e) * w * 0.55);
      return on(x - off, y) ? ['░▒▓█'[Math.min(3, Math.floor(e * 4))], blend(BLACK, grad(x / w), 0.35 + 0.65 * e)] : null;
    },
    pads: (lane, s, p) => clamp((p - (s % 2 ? 0.55 : 0.15)) / 0.25),   // the off steps come in after the others
  },
  // a drum head: three hits in the middle send rings out through the logo, and the first one leaves it behind
  ripple: {
    ms: 2200,
    cell(x, y, p, { w, on }) {
      const d = Math.hypot((x - (w - 1) / 2) / (w / 2), (y - 2) / 3.2);
      const ring = p < 0.9 && [0, 0.25, 0.5].some((t) => p >= t && Math.abs(d - (p - t) * 3) < 0.07);
      if (ring) return on(x, y) ? ['█', WHITE] : ['░', [90, 95, 115]];
      return on(x, y) && d < p * 3 ? ['█', grad(x / w)] : null;
    },
    pads: (lane, s, p) => (Math.abs(s - 7.5) / 8 < p * 3 ? 1 : 0),
  },
  // velocity: every letter is played louder and louder, ghost → soft → normal → accent, like the pads of the grid
  velocity: {
    ms: 2000,
    level: (u, p) => clamp(p * 1.5 - u * 0.5),
    cell(x, y, p, { w, on }) {
      const level = this.level(x / w, p);
      return on(x, y) && level > 0 ? [' ▂▄▆█'[Math.ceil(level * 4)], blend(BLACK, grad(x / w), 0.35 + 0.65 * level)] : null;
    },
    pads(lane, s, p) { return this.level(s / STEPS, p); },
  },
  // quantize: the logo starts as hits scattered off the grid and is snapped to it, a little closer on every beat
  quantize: {
    ms: 2200,
    scene(p, { w, gw, on }) {
      const e = snap(p), grid = new Map();
      for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < w; tx++) {
        if (!on(tx, ty)) continue;
        const x = tx + Math.round((noise(tx, ty, 2) - 0.5) * 12 * gw * (1 - e));
        if (x >= 0 && x < w) grid.set(ty * w + x, x === tx ? ['█', blend(BLACK, grad(tx / w), 0.5 + 0.5 * e)] : ['▓', blend(BLACK, WHITE, 0.3 + 0.4 * e)]);
      }
      return grid;
    },
    cell: (x, y, p, { w }, grid) => grid.get(y * w + x) || null,
    pads: (lane, s, p) => snap(p),
  },
};

const PAD = (v) => (v > 0.9 ? '█' : v > 0.65 ? '▆' : v > 0.4 ? '▄' : '▂');

// The strip: four lines as wide as the logo. vis(lane, step) → how much of the pad is there; head: the playhead's step.
export function laneLines(w, lanes, vis = () => 1, head = -1) {
  const wide = w > LOGO_W;
  return LANES.map((lane, l) => {
    let s = '  ' + dim(lane.name.padEnd(LABEL)), used = LABEL;
    for (let step = 0; step < STEPS; step++) {
      const v = lanes[l][step] * clamp(vis(l, step));
      const color = v > 0 ? (step === head ? WHITE : blend(BLACK, lane.color, 0.45 + 0.55 * v)) : step === head ? [170, 170, 185] : step % 4 ? [48, 48, 60] : [84, 84, 100];
      const gap = step === STEPS - 1 ? '' : ' ' + (step % 4 === 3 ? ' ' : '');
      s += fg(color) + (v > 0 ? PAD(v) : '·').repeat(wide ? CELL_WIDE : CELL) + gap;
      used += (wide ? CELL_WIDE : CELL) + gap.length;
    }
    return s + `${ESC}0m` + ' '.repeat(w - used);
  });
}

export function frame(rows, anim, p, lanes = REST_LANES) {
  const w = rows[0].length;
  const logo = { w, gw: w / LOGO_W, on: (x, y) => rows[y]?.[x] === '█' };
  const scene = anim.scene?.(p, logo), lines = [];
  for (let y = 0; y < ROWS; y++) {
    let s = '  ';
    for (let x = 0; x < w; x++) { const c = anim.cell(x, y, p, logo, scene); s += c ? fg(c[1]) + c[0] : ' '; }
    lines.push(s + `${ESC}0m`);
  }
  return [...lines, ...laneLines(w, lanes, (l, s) => anim.pads(l, s, p), anim.head?.(p) ?? -1)];
}

const isWide = (out) => (out.columns || 80) >= 2 * LOGO_W + 6;

export async function animate(anim, out = process.stdout, lanes = REST_LANES) {
  const rows = logoRows(isWide(out)), MS = anim.ms || 1800, lines = ROWS + LANES.length;
  const showCursor = () => out.write(`${ESC}?25h`);
  process.once('exit', showCursor);                  // Ctrl+C in the middle must not leave the cursor hidden
  out.write(`\n${ESC}?25l`);
  for (let t0 = Date.now(), first = true; ; first = false) {   // paced by the clock: timers are coarse on Windows
    const p = Math.min(1, (Date.now() - t0) / MS);
    if (!first) out.write(`${ESC}${lines}A`);
    out.write(frame(rows, anim, p, lanes).map((l) => `${ESC}2K${l}`).join('\n') + '\n');
    if (p >= 1) break;
    await new Promise((r) => setTimeout(r, 33));
  }
  process.removeListener('exit', showCursor);
  showCursor();
}

// Keeps the strip, `below` lines above the cursor, showing live() → { lanes, head } until anything else is printed.
function loopStrip(out, w, below, live) {
  const write = out.write.bind(out), patched = [process.stdout, process.stderr].map((s) => [s, s.write]);
  let shown = '';
  const tick = () => {
    const { lanes, head } = live();
    const strip = laneLines(w, lanes, () => 1, head).map((l) => `\r${ESC}2K${l}`).join('\n');
    if (strip === shown) return;
    shown = strip;
    write(`\x1b7${ESC}?25l${ESC}${below + LANES.length}A${strip}\x1b8${ESC}?25h`);
  };
  const timer = setInterval(tick, 40);
  const stop = () => { clearInterval(timer); out.removeListener('resize', stop); for (const [s, wr] of patched) s.write = wr; };
  for (const [s, wr] of patched) s.write = (...a) => { stop(); return wr.apply(s, a); };
  out.once('resize', stop);
  timer.unref();
  return stop;
}

// info: { url, beat (one line about the loaded beat), cli (how to call the CLI), lanes, live }
export async function banner(info, out = process.stdout, env = process.env) {
  const { url, beat, cli, lanes = REST_LANES, live } = info;
  if (!out.isTTY || env.NO_COLOR || env.CL808_NO_BANNER || (out.columns || 80) < LOGO_W + 4) {
    out.write(`\n  🥁  Claude-808  →  ${url}\n\n  beat: ${beat}\n  cli:  ${cli}\n\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.CL808_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out, lanes);
  out.write(`\n  ${fg(LOW)}▶${ESC}0m  ${ESC}1m${url}${ESC}0m\n\n  ${dim('beat'.padEnd(LABEL))}${beat}\n  ${dim('cli'.padEnd(LABEL))}${cli}\n\n`);
  if (live && env.CL808_BANNER_LOOP !== '0') loopStrip(out, logoRows(isWide(out))[0].length, 6, live);
}
