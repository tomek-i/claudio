// Startup banner. In a terminal the logo comes in with one of the ANIMATIONS below (picked at random, or by name
// with DJ_BANNER=<name>) over an equaliser, and settles; the equaliser then keeps moving (breathing when idle,
// kicking on the beat of the live deck) until something else prints. Anywhere else (a log file, a pipe,
// NO_COLOR) it is the same information as plain lines, no escape codes.

const GLYPHS = {
  D: ['████ ', '█   █', '█   █', '█   █', '████ '],
  J: ['  ███', '    █', '    █', '█   █', ' ███ '],
  C: [' ████', '█    ', '█    ', '█    ', ' ████'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  I: ['█████', '  █  ', '  █  ', '  █  ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};
const TEXT = 'DJ CLAUDE', ROWS = 5;
const BARS = ' ▁▂▃▄▅▆▇█';
const A = [255, 122, 69], B = [54, 214, 231], WHITE = [255, 255, 255]; // deck A clay → deck B cyan, as on the page
const ESC = '\x1b[';

export function logoRows(text = TEXT, wide = false) {
  return [0, 1, 2, 3, 4].map((r) => [...text].map((ch) => GLYPHS[ch][r]).join(' ').replace(/./g, (c) => (wide ? c + c : c)));
}

const BLACK = [0, 0, 0];
const clamp = (v) => Math.max(0, Math.min(1, v));
const out3 = (t) => 1 - (1 - t) ** 3; // ease out: fast, then gently into place
const blend = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
const mix = (t) => blend(A, B, t);
const grad = (u, shift = 5) => mix((Math.sin(u * Math.PI - shift) + 1) / 2);
const hue = (h) => [0, 2, 4].map((k) => Math.round(255 * (0.5 + 0.5 * Math.cos(2 * Math.PI * (h + k / 6)))));
const noise = (x, y, f = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + f * 37.719) * 43758.5453; return v - Math.floor(v); };
const fg = ([r, g, b]) => `${ESC}38;2;${r};${g};${b}m`;
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

const rest = (u, i) => 0.18 + 0.5 * Math.exp(-u * 3) * (0.6 + 0.4 * Math.sin(i * 0.9));
const calm = (p) => clamp((p - 0.65) / 0.35) ** 2;
const settle = (live, u, i, p) => live * (1 - calm(p)) + rest(u, i) * calm(p);

export const ANIMATIONS = {
  // the logo sweeps in from the left under a sliding gradient
  sweep: {
    cell: (x, y, p, { w, on }) => (x < w * Math.min(1, p * 2.4) && on(x, y) ? ['█', grad(x / w, p * 5)] : null),
    bars: (u, i, p) => settle((0.45 + 0.55 * Math.exp(-u * 3)) * (0.3 + 0.7 * Math.abs(Math.sin(p * 3.7 * (5 + 9 * u) + i * 1.7) * Math.sin(p * 11.5 + i * 0.37))), u, i, p),
  },
  // static that resolves into the logo, left to right
  decode: {
    ms: 1900,
    cell(x, y, p, { w, on }) {
      if (p >= 0.1 + 0.5 * (x / w) + 0.25 * noise(x, y)) return on(x, y) ? ['█', grad(x / w)] : null;
      const f = Math.floor(p * 45);
      return noise(x, y, f) < 0.4 ? ['▓▒░#%&@$'[Math.floor(noise(y, x, f) * 8)], blend(mix(noise(x, f)), WHITE, 0.35)] : null;
    },
    bars: (u, i, p) => settle(noise(i, 3, Math.floor(p * 30)), u, i, p),
  },
  // the letters drop in one after another, each landing with a kick
  drop: {
    ms: 2000,
    cell(x, y, p, { w, on, letter }) {
      const k = letter(x), local = clamp((p - k * 0.075) / 0.3), off = Math.round((1 - local) ** 3 * 7);
      if (!on(x, y + off)) return null;
      const landed = p - (k * 0.075 + 0.3); // seconds-ish since this letter hit the floor: flash white, then cool down
      return ['█', off ? blend(grad(x / w), WHITE, 0.5) : blend(WHITE, grad(x / w), clamp(landed / 0.08))];
    },
    bars(u, i, p, { n }) {
      let kick = 0;
      for (let k = 0; k < n; k++) { const t = p - (k * 0.075 + 0.3), c = (k + 0.5) / n; if (t >= 0) kick = Math.max(kick, Math.exp(-t * 16) * Math.exp(-((u - c) ** 2) / 0.006)); }
      return settle(Math.min(1, rest(u, i) * 0.6 + kick), u, i, p);
    },
  },
  // rain falls down every column and leaves the logo behind it
  rain: {
    ms: 2000,
    cell(x, y, p, { w, on }) {
      const head = Math.floor((p * 1.5 - noise(x, 7) * 0.55) * 9);
      if (y === head) return ['▓', WHITE];
      if (y > head) return null;
      return on(x, y) ? ['█', blend(B, grad(x / w), clamp((head - y) / 4))] : y === head - 1 ? ['░', blend(B, BLACK, 0.5)] : null;
    },
    bars: (u, i, p) => rest(u, i) * clamp((p * 1.5 - noise(i, 7) * 0.55 - 0.6) * 4), // each bar fills once its column's drop has landed
  },
  // the logo fades in rippling through the rainbow, over an oscilloscope, and steadies
  wave: {
    ms: 2200,
    cell(x, y, p, { w, on }) {
      const sx = x - Math.round(Math.sin(y * 1.3 + p * 16) * 7 * (1 - p) ** 2);
      if (!on(sx, y)) return null;
      return ['░▒▓█'[Math.min(3, Math.floor(p * 14))], blend(hue(x / w + p * 1.6 + y * 0.04), grad(x / w), clamp((p - 0.7) / 0.3))];
    },
    bars: (u, i, p) => settle(0.5 + 0.45 * Math.sin(u * 14 - p * 22), u, i, p),
  },
  // particles: every block of the logo flies in from somewhere else on a curved path and locks into place
  swarm: {
    ms: 2400,
    scene(p, { w, on }) {
      const grid = new Map();
      for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < w; tx++) {
        if (!on(tx, ty)) continue;
        const l = clamp((p - noise(tx, ty, 3) * 0.3) / 0.65), e = out3(l);
        if (l >= 1) { grid.set(ty * w + tx, ['█', grad(tx / w), true]); continue; }
        const sx = noise(tx, ty, 1) * w, sy = noise(tx, ty, 2) * ROWS, arc = Math.sin(e * Math.PI);
        const x = Math.round(sx + (tx - sx) * e + arc * 9 * (noise(ty, tx, 4) - 0.5)), y = Math.round(sy + (ty - sy) * e + arc * 2 * (noise(ty, tx, 5) - 0.5));
        const k = y * w + x;
        if (x >= 0 && x < w && y >= 0 && y < ROWS && !grid.get(k)?.[2]) grid.set(k, [e < 0.45 ? '·' : e < 0.85 ? '•' : '▪', blend(WHITE, grad(tx / w), e)]);
      }
      return grid;
    },
    cell: (x, y, p, { w }, grid) => grid.get(y * w + x) || null,
    bars: (u, i, p) => settle(noise(i, 5, Math.floor(p * 24)) * (0.25 + 0.75 * p), u, i, p),
  },
  // 3D: the logo spins about its vertical axis, shaded by how far it is turned (the back face is dark), and slows to a stop
  spin: {
    ms: 2800,
    scene: (p) => Math.cos((1 - out3(clamp(p / 0.9))) * 5 * Math.PI),
    cell(x, y, p, { w, on }, c) {
      const cx = (w - 1) / 2;
      if (Math.abs(c) < 0.06) return Math.round(cx) === x ? ['█', WHITE] : null; // edge on: a sliver
      const sx = Math.round(cx + (x - cx) / c);
      if (!on(sx, y)) return null;
      return c > 0 ? ['█', blend(BLACK, grad(sx / w), 0.4 + 0.6 * c)] : ['▓', blend(BLACK, grad(sx / w), 0.12 + 0.2 * -c)];
    },
    bars: (u, i, p) => settle(0.5 + 0.45 * Math.sin(u * 7 + (1 - out3(clamp(p / 0.9))) * 5 * Math.PI), u, i, p),
  },
  // 3D: the logo flies in from far away through a field of stars streaming past the camera
  warp: {
    ms: 2600,
    scene(p, { w }) {
      const stars = new Map(), cx = (w - 1) / 2;
      for (let i = 0; i < 60; i++) {
        if (noise(i, 3) <= (p - 0.55) / 0.35) continue; // they thin out as the logo arrives
        const a = noise(i, 1) * 2 * Math.PI, r = (p * 2.2 + noise(i, 2)) % 1, x = Math.round(cx + Math.cos(a) * r * r * w * 0.6), y = Math.round(2 + Math.sin(a) * r * r * 5);
        if (x >= 0 && x < w && y >= 0 && y < ROWS) stars.set(y * w + x, ['.·*✦'[Math.min(3, Math.floor(r * 4))], blend([90, 100, 140], WHITE, r)]);
      }
      const e = out3(clamp(p / 0.85));
      return { stars, s: e + 0.06 * (1 - e) };
    },
    cell(x, y, p, { w, on }, { stars, s }) {
      const cx = (w - 1) / 2;
      if (on(Math.round(cx + (x - cx) / s), Math.round(2 + (y - 2) / s))) return ['░▒▓█'[Math.min(3, Math.floor(s * 4.5))], blend(WHITE, grad(x / w), clamp(s * 1.15))];
      return stars.get(y * w + x) || null;
    },
    bars: (u, i, p) => settle(0.5 + 0.5 * Math.sin(Math.abs(u - 0.5) * 26 - p * 26), u, i, p),
  },
  // a fragment shader: animated plasma fills the screen, keeps burning inside the letters, then cools to the logo
  plasma: {
    ms: 2800,
    cell(x, y, p, { w, on }) {
      const t = p * 5, g = w / 53; // g keeps the pattern the same size on the double-width logo
      const v = (Math.sin(x * 0.19 / g + t) + Math.sin(y * 0.9 - t * 0.8) + Math.sin((x * 0.11) / g + y * 0.5 + t * 1.3) + Math.sin(Math.hypot((x - w / 2) * 0.16 / g, (y - 2) * 0.7) - t * 1.6) + 4) / 8;
      const col = hue(v * 1.6 + p * 0.5);
      if (on(x, y)) return ['░▒▓█'[Math.min(3, Math.floor(p * 12))], blend(col, grad(x / w), clamp((p - 0.6) / 0.4))];
      const k = Math.floor(v * 4 * (1 - clamp((p - 0.4) / 0.35)));
      return k > 0 ? [' ░▒▓'[k], blend(col, BLACK, 0.5)] : null;
    },
    bars: (u, i, p) => settle(Math.abs(Math.sin(u * 9 + p * 14) * Math.sin(p * 9 + u * 3)), u, i, p),
  },
  // fire climbs from the equaliser up through the letters; behind the flame front they cool from white-hot to the logo
  fire: {
    ms: 2400,
    cell(x, y, p, { w, on }) {
      const f = Math.floor(p * 40), d = ROWS - 1 - y, front = p * 11.2 - noise(x, 9) * 2 + Math.sin(x * 0.5 + p * 20) * 0.6; // rows above the floor
      if (d < front - 1.2) return on(x, y) ? ['█', blend([255, 190, 70], grad(x / w), clamp((front - d - 1.2) / 3))] : null;
      if (d < front) return on(x, y) ? ['█', [255, 244, 190]] : noise(x, y, f) < 0.6 ? ['▒░'[f % 2], [255, 110, 30]] : null;
      return p < 0.8 && noise(x, y, f) < 0.035 ? ["·'"[x % 2], [255, 200, 80]] : null; // sparks ahead of it
    },
    bars: (u, i, p) => settle(0.35 + 0.65 * noise(i, 2, Math.floor(p * 30)) * (0.5 + 0.5 * Math.exp(-u * 2)), u, i, p),
  },

  // ---- pixel animations: px(x, y, p, logo, scene) → rgb or null on a grid twice as tall (10 rows; logo.onPx(x, y))
  // 3D with perspective: the logo is a flat sign tumbling about two axes towards the camera, lit by how it faces us
  tumble: {
    ms: 3200,
    scene(p) {
      const e = out3(clamp(p / 0.92)), a = (1 - e) * 1.5 * Math.PI, b = (1 - e) * 2.5 * Math.PI; // about the x and the y axis
      return { r1: [Math.cos(b), 0, -Math.sin(b)], r2: [Math.sin(a) * Math.sin(b), Math.cos(a), Math.sin(a) * Math.cos(b)], facing: Math.cos(a) * Math.cos(b) };
    },
    px(x, y, p, { w, onPx }, { r1, r2, facing }) {
      // which point (a, b) of the sign does the ray through this pixel hit? (camera d pixels in front of it)
      const cx = (w - 1) / 2, sx = x - cx, sy = y - 4.5, d = w * 1.1;
      const a11 = d * r1[0] - sx * r1[2], a12 = d * r2[0] - sx * r2[2], a21 = d * r1[1] - sy * r1[2], a22 = d * r2[1] - sy * r2[2], det = a11 * a22 - a12 * a21;
      if (Math.abs(det) < 1e-6) return null;
      const a = (sx * d * a22 - a12 * sy * d) / det, b = (a11 * sy * d - sx * d * a21) / det, lx = Math.round(a + cx);
      if (d + a * r1[2] + b * r2[2] <= 0 || !onPx(lx, Math.round(b + 4.5))) return null;
      return blend(BLACK, grad(lx / w), facing > 0 ? 0.35 + 0.65 * facing : 0.1 - 0.15 * facing); // the back of the sign is dark
    },
    bars: (u, i, p) => settle(0.5 + 0.45 * Math.sin(u * 8 + (1 - out3(clamp(p / 0.92))) * 9), u, i, p),
  },
  // 3D: a four-sided block with the logo on every face rolls towards us, one colour per face, and stops on the front
  prism: {
    ms: 3000,
    scene: (p) => (1 - out3(clamp(p / 0.92))) * 3 * Math.PI,
    px(x, y, p, { w, onPx }, phi) {
      const cx = (w - 1) / 2, sy = y - 4.5, fit = 1 / (Math.abs(Math.sin(phi)) + Math.abs(Math.cos(phi))); // shrink it while it stands on an edge
      for (let k = 0; k < 4; k++) {
        const al = phi + (k * Math.PI) / 2, c = Math.cos(al), mid = 5 * fit * Math.sin(al);
        if (c <= 1e-3 || Math.abs(sy - mid) > 5 * fit * c) continue; // this face is turned away, or the pixel is not on it
        const lx = Math.round((x - cx) / fit + cx);
        if (!onPx(lx, Math.round((sy - mid) / (fit * c) + 4.5))) return null;
        return blend(BLACK, k ? hue(lx / w / 2 + k / 4) : grad(lx / w), 0.3 + 0.7 * c);
      }
      return null;
    },
    bars: (u, i, p) => settle(Math.abs(Math.sin((1 - out3(clamp(p / 0.92))) * 6 * Math.PI)) * (0.4 + 0.6 * noise(i, 4)), u, i, p),
  },
  // graffiti: a spray can crosses the wall leaving the logo in pink / yellow / cyan with white highlights and overspray, then it dries
  graffiti: {
    ms: 2800,
    px(x, y, p, { w, onPx }) {
      const cover = clamp((-4 + (w + 8) * clamp(p / 0.65) - x + 3) / 6); // 0 ahead of the nozzle → 1 once it has passed
      if (!cover) return null;
      const paint = y < 3 ? [255, 60, 170] : y < 7 ? [255, 225, 60] : [60, 220, 255];
      if (!onPx(x, y)) return noise(x, y, 2) < 0.16 * cover * (1 - clamp((p - 0.5) / 0.3)) ? blend(paint, BLACK, 0.55) : null; // overspray, fading
      if (noise(x, y, 1) > cover) return null; // the speckled leading edge of the spray
      return blend(!onPx(x - 1, y) && !onPx(x, y - 1) ? WHITE : paint, grad(x / w), clamp((p - 0.72) / 0.28));
    },
    bars: (u, i, p) => settle(0.1 + Math.exp(-((u - clamp(p / 0.65)) ** 2) / 0.008) * (0.5 + 0.5 * noise(i, 1, Math.floor(p * 40))), u, i, p),
  },
  // lasers: a white-hot scan line etches the logo left to right while six beams from the top corners sweep and cross over it
  lasers: {
    ms: 3000,
    scene(p, { w }) {
      const beams = [];
      for (let j = 0; j < 2; j++) for (let k = 0; k < 3; k++) {
        const th = (j ? -1 : 1) * (0.3 + 1.2 * (0.5 + 0.5 * Math.sin(p * 9 + k * 2.1 + j))); // from straight down towards the other corner
        beams.push({ ex: j ? w - 1 : 0, c: Math.cos(th), s: Math.sin(th), col: [[255, 40, 70], [60, 255, 100], [80, 130, 255]][k] });
      }
      return { beams, scan: w * clamp(p / 0.6), fade: 1 - clamp((p - 0.7) / 0.25) };
    },
    px(x, y, p, { w, onPx }, { beams, scan, fade }) {
      const lit = onPx(x, y) && x <= scan;
      const base = lit ? blend([130, 255, 150], grad(x / w), Math.max(clamp((scan - x) / (w * 0.25)), clamp((p - 0.6) / 0.3))) : null; // cools behind the scan line
      if (p < 0.6 && Math.abs(x - scan) < 1) return [215, 255, 225];
      const beam = fade > 0 && beams.find((b) => Math.abs((x - b.ex) * b.c - (y + 2) * b.s) < 0.6);
      if (!beam) return base;
      return base ? blend(base, WHITE, 0.45 * fade) : blend(BLACK, beam.col, 0.75 * fade);
    },
    bars: (u, i, p) => settle(Math.exp(-Math.abs(u - p / 0.6) * 7) * (0.6 + 0.4 * noise(i, 6, Math.floor(p * 40))) + 0.12 * Math.abs(Math.sin(p * 40)), u, i, p),
  },
  // disco: the lights are off; a mirror ball comes down between DJ and CLAUDE (in the middle of a single word), spins, throws coloured spots across the
  // wall and the letters, the lights come up, and it lifts away
  disco: {
    ms: 3800,
    scene(p, { w, gw, gap }) {
      const r = 2.5 * gw, bx = gap ?? (w - 1) / 2, rot = p * 9;
      const by = p < 0.15 ? -r - 1 + (5.5 + r) * out3(p / 0.15) : p > 0.82 ? 4.5 - (6.5 + r) * ((p - 0.82) / 0.18) ** 2 : 4.5;
      const fade = 1 - clamp((p - 0.75) / 0.2), spots = [];
      if (p > 0.12 && fade > 0) for (let k = 0; k < 16; k++) { const a = rot * 1.3 + (k * Math.PI) / 8; spots.push({ x: bx + Math.cos(a) * w * 0.62, y: 4.5 + Math.sin(a * 2 + k) * 4.5, col: hue(k / 16) }); }
      return { r, bx, by, rot, fade, spots, room: 0.15 + 0.85 * clamp((p - 0.5) / 0.4), f: Math.floor(p * 28) };
    },
    px(x, y, p, { w, onPx }, { r, bx, by, rot, fade, spots, room, f }) {
      const nx = (x - bx) / r, ny = (y - by) / r, d2 = nx * nx + ny * ny;
      if (d2 < 1) { // on the ball: mirror facets by longitude / latitude, a few of them catching the light each frame
        const nz = Math.sqrt(1 - d2), lon = Math.floor((Math.atan2(nx, nz) + rot) / 0.5), lat = Math.floor(Math.asin(ny) / 0.5);
        return noise(lon, lat, f) > 0.78 ? WHITE : blend(blend(BLACK, [200, 205, 225], 0.3 + 0.55 * nz), hue(noise(lon, lat)), 0.25);
      }
      const spot = spots.find((s) => ((x - s.x) / 2.2) ** 2 + ((y - s.y) / 1.3) ** 2 < 1);
      if (onPx(x, y)) { const c = blend(BLACK, grad(x / w), room); return spot ? blend(c, blend(spot.col, WHITE, 0.4), 0.85 * fade) : c; }
      return spot ? blend(BLACK, spot.col, 0.5 * fade) : null;
    },
    bars: (u, i, p) => settle(rest(u, i) * 0.5 + Math.exp(-((p * 8) % 1) * 4) * (0.2 + 0.6 * Math.exp(-u * 3)), u, i, p), // four on the floor
  },
};

// text: the word the rows spell (logoRows), for the animations that place things by letter
export function frame(rows, anim, p, text = TEXT) {
  const w = rows[0].length, gw = w / (text.length * 6 - 1); // gw = 1, or 2 when the logo is double width
  // gap: the middle of the space between two words (the gap after "DJ" is 5 columns wide), if there is one
  const space = text.indexOf(' '), gap = space < 0 ? null : (6 * space + 1) * gw + (gw - 1) / 2;
  const logo = { w, gw, gap, n: text.length, on: (x, y) => rows[y]?.[x] === '█', onPx: (x, y) => rows[y >> 1]?.[x] === '█', letter: (x) => Math.floor(x / (6 * gw)) };
  const lines = [], scene = anim.scene?.(p, logo);
  for (let y = 0; y < ROWS; y++) {
    let s = '  ';
    for (let x = 0; x < w; x++) {
      if (!anim.px) { const c = anim.cell(x, y, p, logo, scene); s += c ? fg(c[1]) + c[0] : ' '; continue; }
      // pixel animations: two pixels per cell, drawn with half blocks (upper half in the text colour, lower in the background)
      const t = anim.px(x, 2 * y, p, logo, scene), b = anim.px(x, 2 * y + 1, p, logo, scene);
      s += !t && !b ? ' ' : !b ? fg(t) + '▀' : !t ? fg(b) + '▄' : t.every((v, k) => v === b[k]) ? fg(t) + '█' : `${fg(t)}${ESC}48;2;${b.join(';')}m▀${ESC}49m`;
    }
    lines.push(s + `${ESC}0m`);
  }
  return [...lines, ...barLines(w, (u, i) => anim.bars(u, i, p, logo))];
}

function barLines(w, level) {
  const lines = [];
  for (const top of [true, false]) {
    let s = '  ';
    for (let x = 0; x < w; x++) {
      const h = clamp(level(x / w, x)) * 16, cell = top ? h - 8 : Math.min(8, h); // two rows of eighth-blocks = 16 steps
      s += fg(mix(x / w)) + BARS[Math.max(0, Math.min(8, Math.round(cell)))];
    }
    lines.push(s + `${ESC}0m`);
  }
  return lines;
}

export function liveLevel(u, i, t, beat) {
  if (beat == null) return rest(u, i) * (0.8 + 0.2 * Math.sin(t * 1.6 + i * 0.35)); // idle: breathing
  const bass = Math.exp(-u * 3), kick = Math.exp(-beat * 5); // the kick hits on the beat and decays through it
  return rest(u, i) * 0.5 + kick * (0.2 + 0.6 * bass) + (1 - bass) * 0.3 * noise(i, 1, Math.floor(t * 12));
}

function loopBars(out, w, below, live) {
  const write = out.write.bind(out), t0 = Date.now(), patched = [process.stdout, process.stderr].map((s) => [s, s.write]);
  const tick = () => write(`\x1b7${ESC}?25l${ESC}${below + 2}A` + barLines(w, (u, i) => liveLevel(u, i, (Date.now() - t0) / 1000, live())).map((l) => `\r${ESC}2K${l}`).join('\n') + `\x1b8${ESC}?25h`);
  const timer = setInterval(tick, 83);
  const stop = () => { clearInterval(timer); out.removeListener('resize', stop); for (const [s, wr] of patched) s.write = wr; };
  for (const [s, wr] of patched) s.write = (...a) => { stop(); return wr.apply(s, a); };
  out.once('resize', stop);
  timer.unref();
  return stop;
}

export async function banner(info, out = process.stdout, env = process.env) {
  const { url, dirs, tracks, queued, live, visuals } = info; // visuals: the /visuals page's address for other devices
  if (!out.isTTY || env.NO_COLOR || env.DJ_NO_BANNER || (out.columns || 80) < 56) {
    out.write(`\n  🎧  DJ Claude  →  ${url}\n\n  library: ${dirs.join(', ')}\n  ${tracks} tracks cached, ${queued} queued for analysis\n${visuals ? `  visuals: ${visuals}\n` : ''}\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.DJ_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out);
  const label = (s) => dim(s.padEnd(9));
  out.write(`\n  ${fg(A)}▶${ESC}0m  ${ESC}1m${url}${ESC}0m\n\n`);
  out.write(`  ${label('library')}${tracks} track${tracks === 1 ? '' : 's'} cached${queued ? `, ${fg(A)}${queued} queued for analysis${ESC}0m` : ''}\n`);
  dirs.forEach((d, i) => out.write(`  ${label(i ? '' : 'folders')}${d}\n`));
  if (visuals) out.write(`  ${label('visuals')}${visuals}\n`);
  out.write('\n');
  if (live && env.DJ_BANNER_LOOP !== '0') loopBars(out, logoRows(TEXT, wideFits(TEXT, out))[0].length, 5 + dirs.length + (visuals ? 1 : 0), live);
}

// the logo doubles in width when the terminal has room for it (108 columns for DJ CLAUDE)
export const wideFits = (text, out) => (out.columns || 80) >= logoRows(text)[0].length * 2 + 6;

export async function animate(anim, out = process.stdout, text = TEXT) {
  const rows = logoRows(text, wideFits(text, out)), MS = anim.ms || 1500, lines = ROWS + 2;
  const showCursor = () => out.write(`${ESC}?25h`);
  process.once('exit', showCursor); // Ctrl+C mid-animation must not leave the cursor hidden
  out.write(`\n${ESC}?25l`);
  for (let t0 = Date.now(), first = true; ; first = false) { // paced by the clock: timers are coarse on Windows
    const p = Math.min(1, (Date.now() - t0) / MS);
    if (!first) out.write(`${ESC}${lines}A`);
    out.write(frame(rows, anim, p, text).map((l) => `${ESC}2K${l}`).join('\n') + '\n');
    if (p >= 1) break;
    await new Promise((r) => setTimeout(r, 33));
  }
  process.removeListener('exit', showCursor);
  showCursor();
}
