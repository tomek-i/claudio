import { RPS } from '../engine.js';
import { ui } from './state.js';
import { CUE_COLORS, hotcuesOf } from './deck.js';

// ------------------------------------------------------------------ the deck as a record player (ui.deckStyle: turntable)
// Drawn into the same square canvas as the CDJ wheel (canvas.js calls drawTurntable in its place). No display: a record
// with a printed label that turns with the playback position (33⅓ rpm at 1x, so a scratch or a spinback shows), on a
// platter whose rim nudges the tempo. The tonearm reads the track like a real one, from the outer groove at the start
// to the run-out at the end, and can be picked up by its headshell and set down somewhere else (a silent seek). Hot
// cues are stickers on the record: each sits in the groove of its time, at the spot that passes under the stylus then.
//
// Lengths are fractions of the canvas width, measured from the centre of the record.
export const turntableOn = () => ui.deckStyle === 'turntable';
export const T_RECORD = 0.4, T_PLATTER = 0.468, T_LABEL = 0.15; // record, platter rim, label
const GROOVE = [0.385, 0.19];           // the stylus at the start of the track and at its end
const PIVOT = [0.4, -0.37], ARM = 0.52;  // the arm's pivot (top right corner) and its length to the stylus
const REST = (84 * Math.PI) / 180;      // the arm's direction when parked beside the record
const PIVOT_DIST = Math.hypot(...PIVOT), BASE = Math.atan2(-PIVOT[1], -PIVOT[0]); // pivot → centre
// the arm's direction with the stylus at radius r (the triangle pivot, centre, stylus), and back
const dirOf = (r) => BASE - Math.acos((PIVOT_DIST ** 2 + ARM ** 2 - r ** 2) / (2 * PIVOT_DIST * ARM));
const stylusAt = (dir) => [PIVOT[0] + ARM * Math.cos(dir), PIVOT[1] + ARM * Math.sin(dir)];
const DIR = GROOVE.map(dirOf);          // [at the start, at the end]: the arm swings from the first to the second
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const radiusAt = (d, sec) => GROOVE[0] - (GROOVE[0] - GROOVE[1]) * clamp(sec / d.duration, 0, 1);
const turn = (sec) => sec * RPS * Math.PI * 2; // how far the record has turned at this position

// the arm while it is held: canvas -> the position (seconds) its stylus is over
export const armHeld = new WeakMap();
const armDir = (canvas, d) => (!d.buffer ? REST : dirOf(radiusAt(d, armHeld.has(canvas) ? armHeld.get(canvas) : d.position())));

// is this point (canvas pixels from the centre) on the headshell or the front half of the arm?
export function armHit(canvas, d, x, y) {
  if (!d.buffer) return false;
  const W = canvas.width, dir = armDir(canvas, d), [sx, sy] = stylusAt(dir), px = x / W, py = y / W;
  if (Math.hypot(px - sx, py - sy) < 0.07) return true;
  // along the tube, from halfway to the headshell
  const ux = Math.cos(dir), uy = Math.sin(dir), along = (px - PIVOT[0]) * ux + (py - PIVOT[1]) * uy, off = Math.abs((px - PIVOT[0]) * uy - (py - PIVOT[1]) * ux);
  return along > ARM * 0.5 && along < ARM && off < 0.03;
}
// the position (seconds) the stylus would be over with the arm pointing at this point
export function armTimeAt(canvas, d, x, y) {
  const W = canvas.width, dir = clamp(Math.atan2(y / W - PIVOT[1], x / W - PIVOT[0]), DIR[0], DIR[1]);
  const r = Math.hypot(...stylusAt(dir));
  return clamp((GROOVE[0] - r) / (GROOVE[0] - GROOVE[1]), 0, 1) * d.duration;
}

// ---- drawing. The platter and the record's grooves never change, so they are drawn once per size.
const layers = new WeakMap();
function staticLayer(canvas) {
  const W = canvas.width;
  let l = layers.get(canvas);
  if (l?.W === W) return l.cv;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: W }), g = cv.getContext('2d'), k = W / 340;
  const disc = (r) => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); };
  g.translate(W / 2, W / 2);
  // platter: brushed metal, with the rows of strobe dots on its rim
  const RO = W * T_PLATTER, R = W * T_RECORD;
  const metal = g.createLinearGradient(-RO, -RO, RO, RO);
  metal.addColorStop(0, '#8d8d99'); metal.addColorStop(0.35, '#3c3c46'); metal.addColorStop(0.55, '#6e6e7a'); metal.addColorStop(0.8, '#2a2a32'); metal.addColorStop(1, '#5a5a66');
  g.fillStyle = metal; disc(RO); g.fill();
  g.strokeStyle = '#000000b0'; g.lineWidth = 1; g.stroke();
  for (const [rr, n, size] of [[RO - 4.5 * k, 120, 1.25], [RO - 9.5 * k, 104, 1.25], [RO - 14.5 * k, 92, 1.25]]) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.fillStyle = '#0b0b0e'; g.beginPath(); g.arc(Math.cos(a) * rr, Math.sin(a) * rr, size * k, 0, Math.PI * 2); g.fill();
  }
  // the record: near black, a lead-in band, fine grooves with the odd gap between tracks, the run-out near the label
  const vinyl = g.createRadialGradient(0, 0, W * T_LABEL, 0, 0, R); vinyl.addColorStop(0, '#0e0e12'); vinyl.addColorStop(1, '#050507');
  g.fillStyle = vinyl; disc(R); g.fill();
  g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
  g.lineWidth = Math.max(0.6, 0.7 * k);
  for (let r = W * GROOVE[1], i = 0; r < W * GROOVE[0]; r += 1.5 * k, i++) { g.strokeStyle = `rgba(255,255,255,${i % 9 === 0 ? 0.085 : 0.03})`; disc(r); g.stroke(); }
  g.save(); disc(R - 1); g.clip();
  const shine = g.createConicGradient(-Math.PI * 0.78, 0, 0), clear = 'rgba(255,255,255,0)';
  shine.addColorStop(0, clear); shine.addColorStop(0.06, 'rgba(255,255,255,0.15)'); shine.addColorStop(0.13, clear);
  shine.addColorStop(0.5, clear); shine.addColorStop(0.56, 'rgba(255,255,255,0.11)'); shine.addColorStop(0.63, clear); shine.addColorStop(1, clear);
  g.fillStyle = shine; g.fillRect(-R, -R, 2 * R, 2 * R);
  g.restore();
  layers.set(canvas, { W, cv });
  return cv;
}

// a darker shade of a #rrggbb colour, for the paper of the label
const shade = (hex, f) => `rgb(${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * f)).join(',')})`;

export function drawTurntable(canvas, d, color, hand) {
  const g = canvas.getContext('2d'), W = canvas.width, k = W / 340, t = d.track, pos = d.position();
  const disc = (r) => { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); };
  g.clearRect(0, 0, W, W);
  g.drawImage(staticLayer(canvas), 0, 0);
  g.save(); g.translate(W / 2, W / 2);

  // ---- what turns with the record: the label and the cue stickers
  g.save(); g.rotate(turn(pos));
  const L = W * T_LABEL;
  g.fillStyle = t ? shade(color, 0.78) : '#3a3a44'; disc(L); g.fill();
  g.strokeStyle = '#00000070'; g.lineWidth = 1; g.stroke();
  g.strokeStyle = '#00000038'; g.lineWidth = 1; disc(L * 0.9); g.stroke(); disc(L * 0.42); g.stroke();
  g.fillStyle = t ? '#16110e' : '#0a0a0c'; g.textAlign = 'center';
  g.font = `700 ${Math.round(9.5 * k)}px Space Grotesk, sans-serif`; g.fillText((t?.title || 'DJ CLAUDE').slice(0, 18), 0, -L * 0.52, L * 1.5);
  g.font = `500 ${Math.round(7 * k)}px Space Grotesk, sans-serif`; g.fillText((t?.artist || '').slice(0, 22), 0, L * 0.66, L * 1.35);
  g.font = `600 ${Math.round(6 * k)}px JetBrains Mono, monospace`; g.fillText('33⅓', -L * 0.62, L * 0.08); g.fillText(`SIDE ${d.name}`, L * 0.58, L * 0.08);
  if (t) {
    // a sticker passes under the stylus exactly at its time: put it where the stylus is then, turned back by the
    // record's rotation at that time
    const sticker = (sec, fill, r) => {
      const [sx, sy] = stylusAt(dirOf(radiusAt(d, sec))), a = Math.atan2(sy, sx) - turn(sec), rad = Math.hypot(sx, sy) * W;
      g.fillStyle = fill; g.beginPath(); g.arc(Math.cos(a) * rad, Math.sin(a) * rad, r * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#000000a0'; g.lineWidth = 1; g.stroke();
    };
    for (const [n, c] of Object.entries(hotcuesOf(t))) if (c?.sec != null) sticker(c.sec, CUE_COLORS[n - 1] || '#fff', 4.2);
    sticker(d.cuePoint, '#ff4d4d', 2.8);
  }
  g.restore();
  // spindle
  const pin = g.createRadialGradient(-1.5 * k, -1.5 * k, 0, 0, 0, 5 * k); pin.addColorStop(0, '#f2f2f6'); pin.addColorStop(1, '#5a5a66');
  g.fillStyle = pin; disc(4.2 * k); g.fill();

  // ---- the part under the pointer (ui.jogHint), as on the CDJ wheel: the rim nudges, the record scratches
  if (hand && d.buffer && hand.zone !== 'arm' && (ui.jogHint === 'edge' || ui.jogHint === 'spot')) {
    g.save();
    const ring = hand.zone === 'ring';
    if (ui.jogHint === 'edge') {
      g.strokeStyle = hand.held ? color : '#e6e6ee'; g.globalAlpha = hand.held ? 0.95 : 0.6;
      g.shadowColor = hand.held ? color : '#ffffff'; g.shadowBlur = (hand.held ? 12 : 6) * k;
      g.lineWidth = (hand.held ? 2.5 : 1.5) * k; disc(ring ? W * T_PLATTER - 1.5 * k : W * T_RECORD - 2 * k); g.stroke();
    } else {
      const [r0, r1] = ring ? [W * T_RECORD, W * T_PLATTER] : [W * T_LABEL, W * T_RECORD];
      g.beginPath(); g.arc(0, 0, r1, 0, Math.PI * 2); g.arc(0, 0, r0, 0, Math.PI * 2, true); g.clip();
      const rad = 66 * k, spot = g.createRadialGradient(hand.x, hand.y, 0, hand.x, hand.y, rad);
      const rgb = hand.held ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(',') : '255,255,255';
      spot.addColorStop(0, `rgba(${rgb},${hand.held ? 0.36 : 0.22})`); spot.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = spot; g.fillRect(hand.x - rad, hand.y - rad, 2 * rad, 2 * rad);
    }
    g.restore();
  }

  // ---- the lamp by the platter: lit in the deck colour while the record plays
  g.save();
  g.fillStyle = t && d.playing ? color : '#2c2c34'; if (t && d.playing) { g.shadowColor = color; g.shadowBlur = 8 * k; }
  g.beginPath(); g.arc(-W * 0.44, W * 0.44, 4 * k, 0, Math.PI * 2); g.fill();
  g.restore();

  // ---- the tonearm, over everything: base, counterweight, tube, headshell
  const held = armHeld.has(canvas), over = hand?.zone === 'arm', dir = armDir(canvas, d), px = PIVOT[0] * W, py = PIVOT[1] * W, len = ARM * W;
  g.save(); g.translate(px, py);
  g.fillStyle = '#17171c'; g.beginPath(); g.arc(0, 0, 20 * k, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a4a56'; g.lineWidth = 1.5 * k; g.stroke();
  g.rotate(dir);
  g.shadowColor = '#000000c0'; g.shadowBlur = (held ? 14 : 6) * k; g.shadowOffsetY = (held ? 9 : 4) * k; // lifted: the shadow falls further
  const steel = g.createLinearGradient(0, -5 * k, 0, 5 * k); steel.addColorStop(0, '#f0f0f4'); steel.addColorStop(0.5, '#9a9aa6'); steel.addColorStop(1, '#55555f');
  g.fillStyle = '#26262d'; g.beginPath(); g.roundRect(-40 * k, -9 * k, 26 * k, 18 * k, 4 * k); g.fill();   // counterweight
  g.fillStyle = steel; g.fillRect(-18 * k, -2.6 * k, len - 4 * k, 5.2 * k);                                // tube
  g.shadowColor = 'transparent';
  g.fillStyle = '#101014'; g.beginPath(); g.arc(0, 0, 9 * k, 0, Math.PI * 2); g.fill();                     // pivot cap
  g.strokeStyle = '#8a8a96'; g.lineWidth = 1.5 * k; g.stroke();
  // headshell: angled in a little, as on an S-shaped arm, with a finger lift and a stripe in the deck colour
  g.translate(len - 12 * k, 0); g.rotate(0.38);
  if (held || over) { g.shadowColor = color; g.shadowBlur = (held ? 14 : 8) * k; }
  g.fillStyle = '#1b1b21'; g.beginPath(); g.roundRect(-6 * k, -8 * k, 30 * k, 16 * k, 3 * k); g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = '#5c5c68'; g.lineWidth = 1; g.stroke();
  g.fillStyle = t ? color : '#55546a'; g.fillRect(14 * k, -8 * k, 3 * k, 16 * k);
  g.strokeStyle = '#c8c8d2'; g.lineWidth = 2 * k; g.lineCap = 'round'; g.beginPath(); g.moveTo(20 * k, -8 * k); g.lineTo(27 * k, -17 * k); g.stroke(); // finger lift
  g.restore();
  g.restore();
}
