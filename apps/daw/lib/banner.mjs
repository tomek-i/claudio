// The server's startup banner. In a terminal the logo comes in with one of the ANIMATIONS below (picked at random,
// or by name with CLAUDEBASE_BANNER=<name>) over a strip of the arrangement: the first tracks down, the bars
// across, a block where a clip is. The strip then stays live: it shows the song as it is written, clip by clip,
// until something else prints. Anywhere else (a log file, a pipe, NO_COLOR) it is the same facts as plain lines.
import { APP_NAME, clipEnd } from './project.mjs';

const GLYPHS = {
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  B: ['████ ', '█   █', '████ ', '█   █', '████ '],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
};
const TEXT = APP_NAME.toUpperCase(), ROWS = 5, LOGO_W = TEXT.length * 6 - 1;
const LOW = [255, 122, 69], MID = [54, 214, 231], HIGH = [155, 229, 100], PERC = [199, 146, 234]; // the tracks' colours, top to bottom
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
const ESC = '\x1b[';

// The strip: LANES tracks, COLS cells for the bars. A cell is 0 (no clip), 1 (a clip goes on) or 2 (a clip starts).
const LANE_COLORS = [LOW, MID, HIGH, PERC], LANES = LANE_COLORS.length, COLS = 32, LABEL = 7;
const lane = (name, row) => ({ name, cells: [...row].map((c) => ({ '.': 0, '=': 1, '#': 2 })[c]) });
// what the strip shows when no song is given (the preview, the tests)
export const REST_LANES = [
  lane('drums', '#===#===========#==============='),
  lane('bass', '....#===========....#==========='),
  lane('pad', '#===============#==============='),
  lane('lead', '........#=======........#======='),
];

export function logoRows(wide = false) {
  return [0, 1, 2, 3, 4].map((r) => [...TEXT].map((ch) => GLYPHS[ch][r]).join(' ').replace(/./g, (c) => (wide ? c + c : c)));
}

// A song as the strip's lanes. One cell is one bar while the song fits (the cells past its end stay empty), and
// several bars when it is longer. With more tracks than lanes, the last lane is all the others together.
export function lanesOf(project) {
  const per = Math.max(1, Math.ceil(project.bars / COLS));
  const cells = (tracks) => Array.from({ length: COLS }, (_, i) => {
    const from = i * per, to = from + per;
    if (from >= project.bars) return 0;
    const clips = tracks.filter((t) => !t.mute).flatMap((t) => t.clips).filter((c) => c.bar < to && from < clipEnd(c));
    return !clips.length ? 0 : clips.some((c) => c.bar >= from) ? 2 : 1;
  });
  const { tracks } = project, more = tracks.length > LANES;
  return Array.from({ length: LANES }, (_, l) => {
    if (more && l === LANES - 1) return { name: `+${tracks.length - l}`, cells: cells(tracks.slice(l)) };
    return tracks[l] ? { name: tracks[l].name, cells: cells([tracks[l]]) } : { name: '', cells: Array(COLS).fill(0) };
  });
}

const clamp = (v) => Math.max(0, Math.min(1, v));
const out3 = (t) => 1 - (1 - t) ** 3;
const blend = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
const grad = (u) => (u < 0.5 ? blend(LOW, MID, u * 2) : blend(MID, HIGH, (u - 0.5) * 2)); // first track → third, left to right
const noise = (x, y, f = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + f * 37.719) * 43758.5453; return v - Math.floor(v); };
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

// An animation draws the logo, cell(x, y, p, logo) → [character, rgb] or null, and says how much of each cell of
// the strip is there yet, strip(lane, col, p) → 0..1. head(p) is the column the playhead is on, when it has one.
// p runs from 0 to 1, and at 1 every animation shows the same thing: the whole logo, the whole strip, no playhead.
const LETTERS = TEXT.length, TAKE = 0.85;
export const ANIMATIONS = {
  // one take: a playhead runs through the bars and leaves the song behind it
  record: {
    ms: 2000,
    head: (p) => (p < TAKE ? Math.floor((p / TAKE) * COLS) : -1),
    cell(x, y, p, { w, on }) {
      if (p >= TAKE) return on(x, y) ? ['█', grad(x / w)] : null;
      const edge = (p / TAKE) * w;
      if (x >= edge && x < edge + w / COLS) return on(x, y) ? ['█', WHITE] : ['│', [120, 60, 60]];
      return x < edge && on(x, y) ? ['█', grad(x / w)] : null;
    },
    strip: (l, c, p) => (p >= TAKE || c <= Math.floor((p / TAKE) * COLS) ? 1 : 0),
  },
  // the arrangement is built a track at a time: every row of the logo slides in from the left, one after the other
  tracks: {
    ms: 2100,
    row: (y, p) => out3(clamp((p - y * 0.14) / 0.4)),
    cell(x, y, p, { w, on }) {
      const e = this.row(y, p), off = Math.round((1 - e) * w);
      return e > 0 && on(x + off, y) ? ['░▒▓█'[Math.min(3, Math.floor(e * 4))], blend(BLACK, grad(x / w), 0.35 + 0.65 * e)] : null;
    },
    strip(l, c, p) { return this.row(l + 1, p) >= 1 ? 1 : 0; },
  },
  // clips dropped on the timeline: the letters land one by one, each bright for a moment
  clips: {
    ms: 2000,
    cell(x, y, p, { w, gw, on }) {
      const letter = Math.min(LETTERS - 1, Math.floor(x / (6 * gw))), at = (letter / LETTERS) * 0.8;
      if (p < at || !on(x, y)) return null;
      return ['█', blend(grad(x / w), WHITE, p >= 0.95 ? 0 : Math.exp(-(p - at) * 28))];
    },
    strip: (l, c, p) => (p >= (Math.floor(c / 4) / (COLS / 4)) * 0.8 + l * 0.02 ? 1 : 0),
  },
  // the master fader comes up: the song is there all along, and gets louder from the left
  fader: {
    ms: 1900,
    level: (u, p) => clamp(p * 1.6 - u * 0.6),
    cell(x, y, p, { w, on }) {
      const level = this.level(x / w, p);
      return on(x, y) && level > 0 ? [' ░▒▓█'[Math.ceil(level * 4)], blend(BLACK, grad(x / w), 0.3 + 0.7 * level)] : null;
    },
    strip(l, c, p) { return this.level(c / COLS, p); },
  },
  // zoom to fit: the whole song starts squeezed into the middle of the timeline and is stretched out to its length
  zoom: {
    ms: 2000,
    cell(x, y, p, { w, on }) {
      const z = 0.12 + 0.88 * out3(clamp(p / 0.85)), mid = (w - 1) / 2, sx = Math.round(mid + (x - mid) / z);
      return sx >= 0 && sx < w && on(sx, y) ? ['█', blend(BLACK, grad(sx / w), 0.4 + 0.6 * z)] : null;
    },
    strip: (l, c, p) => (Math.abs(c - (COLS - 1) / 2) / (COLS / 2) <= 0.12 + 0.88 * out3(clamp(p / 0.85)) ? 1 : 0),
  },
  // a bounce: the song is rendered out of noise, a bar at a time in no order
  bounce: {
    ms: 2100,
    cell(x, y, p, { w, on }) {
      if (!on(x, y)) return null;
      const at = noise(Math.floor((x / w) * COLS), 0, 3) * 0.8;
      if (p >= at) return ['█', blend(WHITE, grad(x / w), clamp((p - at) / 0.12))];
      return noise(x, y, Math.floor(p * 30)) < 0.35 ? ['░▒'[Math.floor(noise(x, y, 5) * 2)], [70, 72, 90]] : null;
    },
    strip: (l, c, p) => (p >= noise(c, 0, 3) * 0.8 ? 1 : 0),
  },
};

// The strip: one line a lane, as wide as the logo. vis(lane, col) → how much of the cell is there; head: the playhead's column.
export function laneLines(w, lanes, vis = () => 1, head = -1) {
  const wide = w > LOGO_W;
  return lanes.map((ln, l) => {
    let s = '  ' + dim(ln.name.slice(0, LABEL - 1).padEnd(LABEL)), used = LABEL;
    for (let col = 0; col < COLS; col++) {
      const kind = ln.cells[col], v = kind ? clamp(vis(l, col)) : 0;
      const color = v > 0 ? (col === head ? WHITE : blend(BLACK, LANE_COLORS[l], (kind === 2 ? 0.55 : 0.3) + (kind === 2 ? 0.45 : 0.4) * v)) : col === head ? [170, 170, 185] : col % 4 ? [48, 48, 60] : [84, 84, 100];
      const gap = col % 4 === 3 && col < COLS - 1 ? ' ' : '';
      s += fg(color) + (v > 0 ? (kind === 2 ? '█' : '▆') : '·').repeat(wide ? 2 : 1) + gap;
      used += (wide ? 2 : 1) + gap.length;
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
  return [...lines, ...laneLines(w, lanes, (l, c) => anim.strip(l, c, p), anim.head?.(p) ?? -1)];
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

// Keeps the strip, `below` lines above the cursor, showing live() → lanes until anything else is printed.
function loopStrip(out, w, below, live) {
  const write = out.write.bind(out), patched = [process.stdout, process.stderr].map((s) => [s, s.write]);
  let shown = '';
  const tick = () => {
    const strip = laneLines(w, live()).map((l) => `\r${ESC}2K${l}`).join('\n');
    if (strip === shown) return;
    shown = strip;
    write(`\x1b7${ESC}?25l${ESC}${below + LANES}A${strip}\x1b8${ESC}?25h`);
  };
  const timer = setInterval(tick, 200);
  const stop = () => { clearInterval(timer); out.removeListener('resize', stop); for (const [s, wr] of patched) s.write = wr; };
  for (const [s, wr] of patched) s.write = (...a) => { stop(); return wr.apply(s, a); };
  out.once('resize', stop);
  timer.unref();
  return stop;
}

// info: { url, song (one line about the loaded song), cli (how to call the CLI), lanes, live (() → lanes, as the song is now) }
export async function banner(info, out = process.stdout, env = process.env) {
  const { url, song, cli, lanes = REST_LANES, live } = info;
  if (!out.isTTY || env.NO_COLOR || env.CLAUDEBASE_NO_BANNER || (out.columns || 80) < LOGO_W + 4) {
    out.write(`\n  🎹  ${APP_NAME}  →  ${url}\n\n  song: ${song}\n  cli:  ${cli}\n\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.CLAUDEBASE_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out, lanes);
  out.write(`\n  ${fg(LOW)}▶${ESC}0m  ${ESC}1m${url}${ESC}0m\n\n  ${dim('song'.padEnd(LABEL))}${song}\n  ${dim('cli'.padEnd(LABEL))}${cli}\n\n`);
  if (live && env.CLAUDEBASE_BANNER_LOOP !== '0') loopStrip(out, logoRows(isWide(out))[0].length, 6, live);
}
