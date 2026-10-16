// The server's startup banner. In a terminal the logo comes in with one of the ANIMATIONS below (picked at random,
// or by name with MINICLAUDE_BANNER=<name>) over a strip of the step sequencer: the sixteen steps across, the
// riff's notes on four lines from high to low. The strip then stays live: it shows the riff as it is written, and
// a playhead runs through it while the page plays, until something else prints. Anywhere else (a log file, a pipe,
// NO_COLOR) it is the same facts as plain lines.
import { APP_NAME } from './app.mjs';
import { noteName } from './notes.mjs';
import { STEPS, VEL } from './seq.mjs';

const GLYPHS = {
  M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
};
const TEXT = APP_NAME.toUpperCase(), ROWS = 5, LOGO_W = TEXT.length * 6 - 1;
const LOW = [255, 122, 69], MID = [54, 214, 231], HIGH = [155, 229, 100], TOP = [199, 146, 234];
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const ESC = '\x1b[';

// The strip: four lanes of pitch, the highest on top. A cell is 0 (nothing), 1 (a note held over from the step
// before), 2 (a note starts) or 3 (an accented one).
const LANE_COLORS = [TOP, HIGH, MID, LOW], LANES = LANE_COLORS.length, LABEL = 6;
const CELL = 2, CELL_WIDE = 5;   // how wide a step is drawn, so that the sixteen of them reach about as far as the logo
const lane = (name, row) => ({ name, cells: [...row].map((c) => ({ '.': 0, '-': 1, x: 2, X: 3 })[c]) });
// what the strip shows when no riff is given (the preview, the tests)
export const REST_LANES = [
  lane('C4', '..............x.'),
  lane('G3', '......X-...x....'),
  lane('Eb3', '..x.......x.....'),
  lane('C3', 'X...x...X...x...'),
];

export function logoRows(wide = false) {
  return [0, 1, 2, 3, 4].map((r) => [...TEXT].map((ch) => GLYPHS[ch][r]).join(' ').replace(/./g, (c) => (wide ? c + c : c)));
}

// A bar of a sequence (the first, or the one playing) as the strip's lanes: the sequence's range of pitch cut in
// four, each lane named by its highest note. A chord lights every lane it has a note in; a note longer than a step
// is held (1) through the steps it lasts.
export function lanesOf(seq, bar = 0) {
  const all = seq.steps.flatMap((s) => s?.notes || []);
  if (!all.length) return Array.from({ length: LANES }, () => ({ name: '', cells: Array(STEPS).fill(0) }));
  const hi = Math.max(...all), lo = Math.min(...all), size = Math.max(1, Math.ceil((hi - lo + 1) / LANES));
  const lanes = Array.from({ length: LANES }, (_, l) => ({ name: noteName(hi - l * size), cells: Array(STEPS).fill(0) }));
  seq.steps.slice(bar * STEPS, (bar + 1) * STEPS).forEach((step, s) => {
    for (const note of step?.notes || []) {
      const cells = lanes[Math.min(LANES - 1, Math.floor((hi - note) / size))].cells;
      cells[s] = Math.max(cells[s], step.vel >= VEL.accent ? 3 : 2);
      for (let k = 1; k < step.len && s + k < STEPS; k++) cells[s + k] = Math.max(cells[s + k], 1);
    }
  });
  return lanes;
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const out3 = (t) => 1 - (1 - t) ** 3;
const blend = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
const grad = (u) => (u < 0.5 ? blend(LOW, MID, u * 2) : blend(MID, HIGH, (u - 0.5) * 2)); // low notes → high, left to right
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

// An animation draws the logo, cell(x, y, p, logo) → [character, rgb] or null, and says how much of each cell of
// the strip is there yet, strip(lane, step, p) → 0..1. head(p) is the step the playhead is on, when it has one.
// p runs from 0 to 1, and at 1 every animation shows the same thing: the whole logo, the whole strip, no playhead.
const LETTERS = TEXT.length;
// attack, decay, sustain: up to full in the first fifth, down to the level it holds, and held
const adsr = (p) => (p < 0.2 ? p / 0.2 : p < 0.5 ? 1 - ((p - 0.2) / 0.3) * 0.45 : 0.55);
export const ANIMATIONS = {
  // the filter opens: the cutoff climbs from the bottom row to the top, each row dull at first and then bright
  sweep: {
    ms: 2000,
    open: (y, p) => clamp((p * 1.25 - (ROWS - 1 - y) * 0.16) / 0.3),
    cell(x, y, p, { w, on }) {
      const e = this.open(y, p);
      return on(x, y) && e > 0 ? ['░▒▓█'[Math.min(3, Math.floor(e * 4))], blend(BLACK, grad(x / w), 0.3 + 0.7 * e)] : null;
    },
    strip(l, s, p) { return this.open(l + 1, p); },
  },
  // one key held down: the logo rises with the attack, flashes at the peak, and falls to where the sustain holds it
  envelope: {
    ms: 2100,
    cell(x, y, p, { w, on }) {
      if (!on(x, y)) return null;
      if (p >= 0.9) return ['█', grad(x / w)];
      const level = adsr(p / 0.9), peak = p / 0.9 < 0.5 ? clamp((level - 0.7) / 0.3) : 0;
      return [' ░▒▓█'[Math.max(1, Math.ceil(level * 4))], blend(blend(BLACK, grad(x / w), 0.25 + 0.75 * level), WHITE, peak * 0.8)];
    },
    strip: (l, s, p) => (p >= 0.9 ? 1 : adsr(p / 0.9)),
  },
  // an arpeggio up the name: the letters are played one after the other, each bright as it sounds
  arp: {
    ms: 2000,
    head: (p) => (p < 0.8 ? Math.floor((p / 0.8) * STEPS) : -1),
    cell(x, y, p, { w, gw, on }) {
      const letter = Math.min(LETTERS - 1, Math.floor(x / (6 * gw))), at = (letter / LETTERS) * 0.8;
      if (p < at || !on(x, y)) return null;
      return ['█', blend(grad(x / w), WHITE, p >= 0.95 ? 0 : Math.exp(-(p - at) * 26))];
    },
    strip: (l, s, p) => (p >= 0.8 || s <= Math.floor((p / 0.8) * STEPS) ? 1 : 0),
  },
  // two oscillators out of tune: two logos, one each side of where it belongs, pulled into unison
  detune: {
    ms: 2100,
    cell(x, y, p, { w, gw, on }) {
      const off = Math.round((1 - out3(clamp(p / 0.85))) * 9 * gw);
      if (!off) return on(x, y) ? ['█', grad(x / w)] : null;
      const a = on(x - off, y), b = on(x + off, y);
      return a && b ? ['█', WHITE] : a ? ['▓', blend(BLACK, LOW, 0.8)] : b ? ['▓', blend(BLACK, MID, 0.8)] : null;
    },
    strip: (l, s, p) => out3(clamp(p / 0.85)),
  },
  // an LFO on the pitch: the rows sway from side to side, wide at first, and settle
  lfo: {
    ms: 2200,
    cell(x, y, p, { w, gw, on }) {
      const depth = (1 - out3(clamp(p / 0.85))) * 7 * gw, sx = x - Math.round(Math.sin(p * 22 + y * 0.9) * depth);
      return on(sx, y) ? ['█', blend(BLACK, grad(x / w), 0.45 + 0.55 * out3(clamp(p / 0.85)))] : null;
    },
    strip: (l, s, p) => clamp(p / 0.6 - (s % 4) * 0.08),
  },
  // an oscilloscope: one sweep of a sine across the screen, and what it has passed stays lit
  scope: {
    ms: 2000,
    head: (p) => (p < 0.85 ? Math.floor((p / 0.85) * STEPS) : -1),
    cell(x, y, p, { w, on }) {
      if (p >= 0.85) return on(x, y) ? ['█', grad(x / w)] : null;
      const edge = (p / 0.85) * w, wave = Math.round(2 + 2 * Math.sin((x / w) * Math.PI * 6));
      if (x >= edge - 2 && x < edge + 6 && y === wave) return ['█', WHITE];
      return x < edge && on(x, y) ? ['█', grad(x / w)] : null;
    },
    strip: (l, s, p) => (p >= 0.85 || s <= Math.floor((p / 0.85) * STEPS) ? 1 : 0),
  },
};

// The strip: one line a lane, as wide as the logo. vis(lane, step) → how much of the cell is there; head: the playhead's step.
export function laneLines(w, lanes, vis = () => 1, head = -1) {
  const wide = w > LOGO_W;
  return lanes.map((ln, l) => {
    let s = '  ' + dim(ln.name.padEnd(LABEL)), used = LABEL;
    for (let step = 0; step < STEPS; step++) {
      const kind = ln.cells[step], v = kind ? clamp(vis(l, step)) : 0;
      const strength = [0, 0.35, 0.75, 1][kind];
      const color = v > 0 ? (step === head ? WHITE : blend(BLACK, LANE_COLORS[l], 0.3 + 0.7 * strength * v)) : step === head ? [170, 170, 185] : step % 4 ? [48, 48, 60] : [84, 84, 100];
      const gap = step === STEPS - 1 ? '' : ' ' + (step % 4 === 3 ? ' ' : '');
      s += fg(color) + (v > 0 ? ' ▂▆█'[kind] : '·').repeat(wide ? CELL_WIDE : CELL) + gap;
      used += (wide ? CELL_WIDE : CELL) + gap.length;
    }
    return s + `${ESC}0m` + ' '.repeat(w - used);
  });
}

export function frame(rows, anim, p, lanes = REST_LANES) {
  const w = rows[0].length;
  const logo = { w, gw: w / LOGO_W, on: (x, y) => rows[y]?.[x] === '█' };
  const lines = [];
  for (let y = 0; y < ROWS; y++) {
    let s = '  ';
    for (let x = 0; x < w; x++) { const c = anim.cell(x, y, p, logo); s += c ? fg(c[1]) + c[0] : ' '; }
    lines.push(s + `${ESC}0m`);
  }
  return [...lines, ...laneLines(w, lanes, (l, s) => anim.strip(l, s, p), anim.head?.(p) ?? -1)];
}

const isWide = (out) => (out.columns || 80) >= 2 * LOGO_W + 6;

export async function animate(anim, out = process.stdout, lanes = REST_LANES) {
  const rows = logoRows(isWide(out)), MS = anim.ms || 1800, lines = ROWS + LANES;
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
    write(`\x1b7${ESC}?25l${ESC}${below + LANES}A${strip}\x1b8${ESC}?25h`);
  };
  const timer = setInterval(tick, 40);
  const stop = () => { clearInterval(timer); out.removeListener('resize', stop); for (const [s, wr] of patched) s.write = wr; };
  for (const [s, wr] of patched) s.write = (...a) => { stop(); return wr.apply(s, a); };
  out.once('resize', stop);
  timer.unref();
  return stop;
}

// info: { url, patch (one line about the patch that is loaded), cli (how to call the CLI), lanes, live }
export async function banner(info, out = process.stdout, env = process.env) {
  const { url, patch, cli, lanes = REST_LANES, live } = info;
  if (!out.isTTY || env.NO_COLOR || env.MINICLAUDE_NO_BANNER || (out.columns || 80) < LOGO_W + 4) {
    out.write(`\n  🎛  ${APP_NAME}  →  ${url}\n\n  patch: ${patch}\n  cli:   ${cli}\n\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.MINICLAUDE_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out, lanes);
  out.write(`\n  ${fg(LOW)}▶${ESC}0m  ${ESC}1m${url}${ESC}0m\n\n  ${dim('patch'.padEnd(LABEL))}${patch}\n  ${dim('cli'.padEnd(LABEL))}${cli}\n\n`);
  if (live && env.MINICLAUDE_BANNER_LOOP !== '0') loopStrip(out, logoRows(isWide(out))[0].length, 6, live);
}
