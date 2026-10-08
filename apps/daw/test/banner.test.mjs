// The startup banner: every animation draws full-size frames and ends on the same picture; the strip shows the
// song it is given; output that is not a terminal stays plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, REST_LANES, banner, frame, laneLines, lanesOf, logoRows } from '../lib/banner.mjs';
import { TEMPLATES } from '../lib/templates.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '');
const info = { url: 'http://localhost:4750', song: '"Night drive"  122 bpm', cli: 'node claudebase.mjs help' };
const cells = (lane) => lane.cells.map((c) => '.=#'[c]).join('');

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

test('the logo spells the name', () => {
  assert.equal(logoRows()[0].length, 59);
  assert.equal(logoRows(true)[0].length, 118);
  // C L A U D E B A S E: the two As and the two Es are the same glyph
  const letter = (i) => logoRows().map((r) => r.slice(i * 6, i * 6 + 5)).join('|');
  assert.equal(letter(2), letter(7));
  assert.equal(letter(5), letter(9));
  assert.equal(new Set([0, 1, 2, 3, 4, 5, 6, 8].map(letter)).size, 8);
});

test('the strip shows a song: a lane a track, a cell a bar, a brighter block where a clip starts', () => {
  const night = TEMPLATES.find((t) => t.name === 'Night drive');   // 16 bars: drums 1-4 and 5-16, bass 5-16, pad 1-16, pluck 9-16
  const lanes = lanesOf(night);
  assert.deepEqual(lanes.map((l) => l.name), ['Drums', 'Bass', 'Pad', 'Pluck']);
  assert.deepEqual(lanes.map(cells), [
    '#===#===========................',
    '....#===========................',
    '#===============................',
    '........#=======................',
  ]);
  const drums = strip(laneLines(59, lanes)[0]);
  assert.match(drums, /^ {2}Drums {2}█▆▆▆ █▆▆▆ ▆▆▆▆ ▆▆▆▆ ···· ···· ···· ···· {13}$/);
  assert.equal(strip(laneLines(118, lanes)[0]).length, 120);
  assert.notEqual(laneLines(59, lanes, () => 1, 4).join(''), laneLines(59, lanes).join(''), 'the playhead is drawn');

  // a muted track shows nothing; a long name is cut to fit
  const muted = lanesOf({ ...night, tracks: night.tracks.map((t, i) => (i === 1 ? { ...t, mute: true, name: 'A very long bass name' } : t)) });
  assert.equal(cells(muted[1]), '.'.repeat(32));
  assert.match(strip(laneLines(59, muted)[1]), /^ {2}A very ·/);
});

test('the strip fits any song: several bars to a cell when it is long, the other tracks together when there are many', () => {
  const clip = (bar, bars) => ({ id: `c${bar}`, bar, bars });
  const long = { bars: 128, tracks: [{ name: 'Drums', clips: [clip(0, 8), clip(64, 64)] }] };   // 4 bars to a cell
  assert.equal(cells(lanesOf(long)[0]), '#=' + '.'.repeat(14) + '#' + '='.repeat(15));
  assert.deepEqual(lanesOf(long).slice(1).map((l) => [l.name, cells(l)]), Array(3).fill(['', '.'.repeat(32)]));

  const many = { bars: 8, tracks: ['a', 'b', 'c', 'd', 'e', 'f'].map((name, i) => ({ name, clips: [clip(i, 1)] })) };
  const lanes = lanesOf(many);
  assert.deepEqual(lanes.map((l) => l.name), ['a', 'b', 'c', '+3']);
  assert.equal(cells(lanes[3]), '...###..' + '.'.repeat(24));
  assert.deepEqual(lanesOf({ bars: 8, tracks: [] }).map(cells), Array(4).fill('.'.repeat(32)));
});

test('banner: plain lines when the output is not a terminal; CLAUDEBASE_BANNER picks the animation', async () => {
  let plain = '';
  await banner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  🎹  Claudebase  →  http://localhost:4750\n\n  song: "Night drive"  122 bpm\n  cli:  node claudebase.mjs help\n\n');
  for (const [out, env] of [[{ isTTY: true, columns: 120 }, { NO_COLOR: '1' }], [{ isTTY: true, columns: 120 }, { CLAUDEBASE_NO_BANNER: '1' }], [{ isTTY: true, columns: 60 }, {}]]) {
    let quiet = '';
    await banner(info, { ...out, write: (s) => (quiet += s) }, env);
    assert.equal(quiet, plain, JSON.stringify([out, env]));
  }
  let tty = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (tty += s) }, { CLAUDEBASE_BANNER: 'clips' });
  assert.ok(tty.includes('\x1b[?25l') && tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'cursor hidden, then shown again');
  assert.match(strip(tty), /▶ {2}http:\/\/localhost:4750\n\n {2}song {3}"Night drive" {2}122 bpm\n {2}cli {4}node claudebase\.mjs help\n\n$/);
});
