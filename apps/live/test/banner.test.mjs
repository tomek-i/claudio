// The startup banner: every animation draws full-size frames and ends on the same picture; the strip is what the
// code plays; output that is not a terminal stays plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, banner, colsFor, frame, laneLines, lanesOf, logoRows } from '../lib/banner.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '');
const info = { url: 'http://localhost:4751', keys: 'Ctrl+Enter plays', language: 'apps/live/PATTERNS.md' };
const cells = (lane) => lane.cells.map((c) => '.=#'[c]).join('');

test('every animation: 9 full-width lines throughout, and the same final frame', () => {
  for (const wide of [false, true]) {
    const rows = logoRows(wide), w = rows[0].length, lanes = lanesOf(undefined, colsFor(wide));
    const finals = new Set();
    for (const [name, anim] of Object.entries(ANIMATIONS)) {
      for (let p = 0; p <= 1.0001; p += 0.02) {
        const lines = frame(rows, anim, Math.min(1, p), lanes).map(strip);
        assert.equal(lines.length, 9, name);
        for (const l of lines) assert.equal([...l].length, w + 2, `${name} at ${p.toFixed(2)}`);
      }
      const end = frame(rows, anim, 1, lanes);
      assert.deepEqual(end.slice(0, 5).map(strip), rows.map((r) => '  ' + r), `${name} ends on the whole logo`);
      assert.deepEqual(end.slice(5), laneLines(w, lanes), `${name} ends on the whole strip, with no playhead`);
      finals.add(end.join('\n'));
    }
    assert.equal(finals.size, 1, 'all animations settle on the same picture');
  }
});

test('the logo spells the name', () => {
  assert.equal(logoRows()[0].length, 41);
  assert.equal(logoRows(true)[0].length, 82);
  // C L A U D E L: the two Ls are the same glyph
  const letter = (i) => logoRows().map((r) => r.slice(i * 6, i * 6 + 5)).join('|');
  assert.equal(letter(1), letter(6));
  assert.equal(new Set([0, 1, 2, 3, 4, 5].map(letter)).size, 6);
});

test('the strip is what the code plays: a lane a block, a cell a sixteenth', () => {
  const lanes = lanesOf('$drums: s("bd*4, [~ sd]*2")\n$bass: note("c2 ~ ~ eb2").s("bass")\n$pad: note("c3").s("pad")', 16);
  assert.deepEqual(lanes.map((l) => l.name), ['drums', 'bass', 'pad', '']);
  assert.deepEqual(lanes.map(cells), [
    '#===#===#===#===',
    '#===........#===',
    '#===============',
    '................',
  ]);
  assert.equal(cells(lanesOf('$a: s("bd")', 32)[0]), '#===============#===============', 'two bars in a wide terminal');
  assert.deepEqual(lanesOf('s("bd', 16).map(cells), Array(4).fill('.'.repeat(16)), 'code that does not parse: empty lanes');
  assert.match(strip(laneLines(41, lanes)[0]), /^ {2}drums {2}█▆▆▆ █▆▆▆ █▆▆▆ █▆▆▆ {15}$/);
  assert.notEqual(laneLines(41, lanes, () => 1, 4).join(''), laneLines(41, lanes).join(''), 'the playhead is drawn');
});

test('banner: plain lines when the output is not a terminal; CLAUDEL_BANNER picks the animation', async () => {
  let plain = '';
  await banner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  🔁  Claudel  →  http://localhost:4751\n\n  keys: Ctrl+Enter plays\n  code: apps/live/PATTERNS.md\n\n');
  for (const [out, env] of [[{ isTTY: true, columns: 120 }, { NO_COLOR: '1' }], [{ isTTY: true, columns: 120 }, { CLAUDEL_NO_BANNER: '1' }], [{ isTTY: true, columns: 40 }, {}]]) {
    let quiet = '';
    await banner(info, { ...out, write: (s) => (quiet += s) }, env);
    assert.equal(quiet, plain, JSON.stringify([out, env]));
  }
  let tty = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (tty += s) }, { CLAUDEL_BANNER: 'type' });
  assert.ok(tty.includes('\x1b[?25l') && tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'cursor hidden, then shown again');
  assert.match(strip(tty), /▶ {2}http:\/\/localhost:4751\n\n {2}keys {3}Ctrl\+Enter plays\n {2}code {3}apps\/live\/PATTERNS\.md\n\n$/);
});
