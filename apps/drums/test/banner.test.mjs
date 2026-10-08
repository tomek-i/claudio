// The startup banner: every animation draws full-size frames and ends on the same picture; the strip shows the
// beat it is given; output that is not a terminal stays plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, REST_LANES, banner, frame, laneLines, lanesOf, logoRows } from '../lib/banner.mjs';
import { preset } from '../lib/presets.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '');
const info = { url: 'http://localhost:4748', beat: '"Boom bap"  90 bpm', cli: 'node cl808.mjs help' };

test('every animation: 9 full-width lines throughout, and the same final frame', () => {
  for (const wide of [false, true]) {
    const rows = logoRows(wide), w = rows[0].length;
    const finals = new Set();
    for (const [name, anim] of Object.entries(ANIMATIONS)) {
      for (let p = 0; p <= 1.0001; p += 0.04) {
        const lines = frame(rows, anim, Math.min(1, p)).map(strip);
        assert.equal(lines.length, 9, name);
        for (const l of lines) assert.equal([...l].length, w + 2, `${name} at ${p.toFixed(2)}`);
      }
      const end = frame(rows, anim, 1);
      assert.deepEqual(end.slice(0, 5).map(strip), rows.map((r) => '  ' + r), `${name} ends on the whole logo`);
      assert.deepEqual(end.slice(5), laneLines(w, REST_LANES), `${name} ends on the whole strip, with no playhead`);
      finals.add(end.join('\n'));
    }
    assert.equal(finals.size, 1, 'all animations settle on the same picture');
  }
});

test('the strip shows a beat: one lane per group of voices, pads as tall as the hits are hard', () => {
  const house = preset('house');
  const lanes = lanesOf(house);
  assert.equal(lanes[0].map((v) => (v > 0 ? 'x' : '.')).join(''), 'x...x...x...x...');
  assert.ok(lanes[1][4] > 0.9, 'the clap is in the snare lane');
  assert.ok(lanes[2][2] > 0, 'the open hat is in the hats lane');
  const kick = laneLines(59, lanes).map(strip)[0];
  assert.match(kick, /^ {2}kick {2}[▆█]{2} ·· ·· ··(?: {2}[▆█]{2} ·· ·· ··){3} {3}$/);
  assert.equal(strip(laneLines(118, lanes)[0]).length, 120);
  assert.notEqual(laneLines(59, lanes, () => 1, 4).join(''), laneLines(59, lanes).join(''), 'the playhead is drawn');
  const two = { ...house, steps: 32, tracks: house.tracks.map((t) => ({ ...t, vel: [...t.vel, ...t.vel.map(() => 0)] })) };
  assert.ok(lanesOf(two, 1).every((lane) => lane.every((v) => v === 0)), 'the second bar of a 32-step pattern');
});

test('banner: plain lines when the output is not a terminal; CL808_BANNER picks the animation', async () => {
  let plain = '';
  await banner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  🥁  Claude-808  →  http://localhost:4748\n\n  beat: "Boom bap"  90 bpm\n  cli:  node cl808.mjs help\n\n');
  let quiet = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (quiet += s) }, { NO_COLOR: '1' });
  assert.equal(quiet, plain);
  let tty = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (tty += s) }, { CL808_BANNER: 'kick' });
  assert.ok(tty.includes('\x1b[?25l') && tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'cursor hidden, then shown again');
  assert.match(strip(tty), /▶ {2}http:\/\/localhost:4748\n\n {2}beat {2}"Boom bap" {2}90 bpm\n {2}cli {3}node cl808\.mjs help\n\n$/);
});
