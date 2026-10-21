// The server's startup banner. In a terminal the logo comes in with one of the ANIMATIONS below (picked at random,
// or by name with CLAUDEL_BANNER=<name>) over a strip of the code a first visit opens with (lib/examples.mjs): a
// lane a block, a sixteenth a cell, a brighter block where a sound starts. The strip is the pattern language's own
// answer (lib/pattern.mjs), not a drawing of it. Anywhere else (a log file, a pipe, NO_COLOR) it is the same facts as
// plain lines. The server does not know what a page plays, so the strip stays still once it is drawn.
import { APP_NAME } from './app.mjs';
import { EXAMPLE } from './examples.mjs';
import { parseBlocks, query } from './pattern.mjs';

const GLYPHS = {
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
};
const TEXT = APP_NAME.toUpperCase(), ROWS = 5, LOGO_W = TEXT.length * 6 - 1;
const LOW = [255, 122, 69], MID = [54, 214, 231], HIGH = [155, 229, 100], PERC = [199, 146, 234]; // the blocks' colours, as on the page
const WHITE = [255, 255, 255], BLACK = [0, 0, 0], GREY = [70, 72, 90];
const ESC = '\x1b[';

// The strip: LANES blocks, a cell a sixteenth: one bar, or two in a wide terminal (where the logo is twice as wide).
// A cell is 0 (silence), 1 (a sound goes on) or 2 (a sound starts).
const LANE_COLORS = [LOW, MID, HIGH, PERC], LANES = LANE_COLORS.length, LABEL = 7;
export const colsFor = (wide) => (wide ? 32 : 16);

export function logoRows(wide = false) {
  return [0, 1, 2, 3, 4].map((r) => [...TEXT].map((ch) => GLYPHS[ch][r]).join(' ').replace(/./g, (c) => (wide ? c + c : c)));
}

// Code as the strip's lanes: its first LANES blocks, over `cols` sixteenths from the start. Code that does not parse
// gives empty lanes.
export function lanesOf(code = EXAMPLE, cols = 16) {
  let blocks = [];
  try { blocks = parseBlocks(code); } catch { /* empty lanes */ }
  return Array.from({ length: LANES }, (_, l) => {
    const b = blocks[l];
    if (!b) return { name: '', cells: Array(cols).fill(0) };
    const events = query(b.pattern, 0, cols / 16);
    const cells = Array.from({ length: cols }, (_, c) => {
      const from = c / 16, to = (c + 1) / 16;
      if (events.some((e) => e.start >= from - 1e-9 && e.start < to - 1e-9)) return 2;
      return events.some((e) => e.start < from && e.start + e.len > from + 1e-9) ? 1 : 0;
    });
    return { name: b.name, cells };
  });
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const out3 = (t) => 1 - (1 - t) ** 3;
const blend = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
const grad = (u) => (u < 0.5 ? blend(LOW, MID, u * 2) : blend(MID, HIGH, (u - 0.5) * 2)); // the first block's colour → the third's
const noise = (x, y, f = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + f * 37.719) * 43758.5453; return v - Math.floor(v); };
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;
const CODE = '$s("bd*4,[~sd]<>).n:0357'; // what the letters are made of before they sound

// An animation draws the logo, cell(x, y, p, logo) → [character, rgb] or null, and says how much of each cell of
// the strip is there yet, strip(lane, col, p, cols) → 0..1. head(p, cols) is the column the playhead is on, when it
// has one. p runs from 0 to 1, and at 1 every animation shows the same thing: the whole logo, the whole strip, no
// playhead.
const LETTERS = TEXT.length;
export const ANIMATIONS = {
  // the name typed in, a letter at a time, behind a blinking cursor; then the code under it, a line at a time
  type: {
    ms: 2100,
    at: (letter) => (letter / LETTERS) * 0.7,
    cell(x, y, p, { w, gw, on }) {
      const letter = Math.floor(x / (6 * gw)), typed = LETTERS * clamp(p / 0.7);
      const cursor = Math.min(w - 1, Math.round(Math.floor(typed) * 6 * gw));
      if (p < 0.85 && x === cursor && Math.floor(p * 14) % 2 === 0) return ['▌', WHITE];
      return letter < typed && on(x, y) ? ['█', grad(x / w)] : null;
    },
    strip: (l, c, p, cols) => (p >= 0.5 + l * 0.08 + (c / cols) * 0.08 ? 1 : 0),
  },
  // Ctrl+Enter: the code is there, grey, until it is played; then it flashes and sounds
  eval: {
    ms: 1900,
    flash: 0.55,
    cell(x, y, p, { w, on }) {
      if (!on(x, y)) return null;
      const t = (p - this.flash) / 0.3;
      if (t < 0) return ['░▒'[Math.floor(clamp(p / this.flash) * 1.99)], blend(BLACK, GREY, 0.4 + 0.6 * clamp(p / this.flash))];
      return ['█', blend(WHITE, grad(x / w), clamp(t))];
    },
    strip(l, c, p) { return p < this.flash ? 0.12 : 0.4 + 0.6 * clamp((p - this.flash) / 0.3); },
  },
  // two cycles of the loop: the first lays the name down faintly, the second plays it
  cycle: {
    ms: 2400,
    pass: (p) => clamp(p / 0.85) * 2,
    head(p, cols) { return p < 0.85 ? Math.floor((this.pass(p) % 1) * cols) : -1; },
    cell(x, y, p, { w, on }) {
      const pass = this.pass(p), edge = (pass % 1) * w;
      if (p >= 0.85) return on(x, y) ? ['█', grad(x / w)] : null;
      if (Math.abs(x - edge) < 1) return on(x, y) ? ['█', WHITE] : ['│', [90, 90, 110]];
      const lit = pass >= 1 && x < edge;
      return on(x, y) && (lit || pass >= 1 || x < edge) ? ['█', blend(BLACK, grad(x / w), lit ? 1 : 0.3)] : null;
    },
    strip(l, c, p, cols) {
      if (p >= 0.85) return 1;
      const pass = this.pass(p), at = (pass % 1) * cols;
      return pass < 1 ? (c <= at ? 0.25 : 0) : c <= at ? 1 : 0.25;
    },
  },
  // code turning into sound: the letters are made of the code's own characters, which settle into blocks
  scramble: {
    ms: 2000,
    at: (x, w, y) => (x / w) * 0.6 + noise(x, y, 7) * 0.2,
    cell(x, y, p, { w, on }) {
      if (!on(x, y)) return null;
      const at = this.at(x, w, y);
      if (p >= at) return ['█', blend(WHITE, grad(x / w), clamp((p - at) / 0.12))];
      return noise(x, y, Math.floor(p * 24)) < 0.6 ? [CODE[Math.floor(noise(x, y, Math.floor(p * 24) + 1) * CODE.length)], blend(GREY, grad(x / w), 0.35)] : null;
    },
    strip(l, c, p, cols) { return p >= (c / cols) * 0.6 + noise(c, l, 7) * 0.2 ? 1 : 0; },
  },
  // .rev(): the name comes in backwards, then turns over and reads the right way
  rev: {
    ms: 2200,
    cell(x, y, p, { w, on }) {
      const t = out3(clamp((p - 0.45) / 0.35)), s = Math.cos(Math.PI * t), mid = (w - 1) / 2;   // 1: backwards … −1: the right way
      if (Math.abs(s) < 0.06) return null;
      const src = Math.round(mid - (x - mid) / s);
      if (src < 0 || src >= w || !on(src, y)) return null;
      const level = 0.25 + 0.75 * out3(clamp(p / 0.45));
      return ['█', blend(BLACK, grad(src / w), s > 0 ? level * 0.6 : level)];
    },
    strip: (l, c, p) => (p >= 0.8 ? 1 : 0.3 * clamp(p / 0.45)),
  },
};

// The strip: one line a lane, as wide as the logo. vis(lane, col) → how much of the cell is there; head: the playhead's column.
export function laneLines(w, lanes, vis = () => 1, head = -1) {
  const wide = w > LOGO_W;                           // a cell two characters wide, under a logo twice as wide
  return lanes.map((ln, l) => {
    let s = '  ' + dim(ln.name.slice(0, LABEL - 1).padEnd(LABEL)), used = LABEL;
    ln.cells.forEach((kind, col) => {
      const v = kind ? clamp(vis(l, col)) : 0;
      const color = v > 0 ? (col === head ? WHITE : blend(BLACK, LANE_COLORS[l], (kind === 2 ? 0.55 : 0.3) + (kind === 2 ? 0.45 : 0.4) * v)) : col === head ? [170, 170, 185] : col % 4 ? [48, 48, 60] : [84, 84, 100];
      const gap = col % 4 === 3 && col < ln.cells.length - 1 ? ' ' : '';
      s += fg(color) + (v > 0 ? (kind === 2 ? '█' : '▆') : '·').repeat(wide ? 2 : 1) + gap;
      used += (wide ? 2 : 1) + gap.length;
    });
    return s + `${ESC}0m` + ' '.repeat(Math.max(0, w - used));
  });
}

export function frame(rows, anim, p, lanes = lanesOf(EXAMPLE, colsFor(rows[0].length > LOGO_W))) {
  const w = rows[0].length, cols = lanes[0].cells.length;
  const logo = { w, gw: w / LOGO_W, on: (x, y) => rows[y]?.[x] === '█' };
  const lines = [];
  for (let y = 0; y < ROWS; y++) {
    let s = '  ';
    for (let x = 0; x < w; x++) { const c = anim.cell(x, y, p, logo); s += c ? fg(c[1]) + c[0] : ' '; }
    lines.push(s + `${ESC}0m`);
  }
  return [...lines, ...laneLines(w, lanes, (l, c) => anim.strip(l, c, p, cols), anim.head?.(p, cols) ?? -1)];
}

const isWide = (out) => (out.columns || 80) >= 2 * LOGO_W + 6;

export async function animate(anim, out = process.stdout) {
  const wide = isWide(out), rows = logoRows(wide), lanes = lanesOf(EXAMPLE, colsFor(wide)), MS = anim.ms || 1800, lines = ROWS + LANES;
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

// info: { url, keys (how to play), language (where the language is written down) }
export async function banner(info, out = process.stdout, env = process.env) {
  const { url, keys, language } = info;
  if (!out.isTTY || env.NO_COLOR || env.CLAUDEL_NO_BANNER || (out.columns || 80) < LOGO_W + 4) {
    out.write(`\n  🔁  ${APP_NAME}  →  ${url}\n\n  keys: ${keys}\n  code: ${language}\n\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.CLAUDEL_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out);
  out.write(`\n  ${fg(PERC)}▶${ESC}0m  ${ESC}1m${url}${ESC}0m\n\n  ${dim('keys'.padEnd(LABEL))}${keys}\n  ${dim('code'.padEnd(LABEL))}${language}\n\n`);
}
