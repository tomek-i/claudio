// The startup banner: every animation draws full-size frames and ends on the same picture; the strip shows the
// riff it is given; output that is not a terminal stays plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, REST_LANES, banner, frame, laneLines, lanesOf, logoRows } from '../lib/banner.mjs';
import { emptySeq, normalizeSeq, parseRow } from '../lib/seq.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[78]/g, '');
const info = { url: 'http://localhost:4749', patch: '"Acid bass" (slot A)   118 bpm', cli: 'node miniclaude.mjs help' };
const cells = (lane) => lane.cells.map((c) => '.-xX'[c]).join('');
const seq = (row) => normalizeSeq({ bpm: 120, steps: parseRow(row) });

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
  // M I N I C L A U D E: the two Is are the same glyph, the other eight differ
  const letter = (i) => logoRows().map((r) => r.slice(i * 6, i * 6 + 5)).join('|');
  assert.equal(letter(1), letter(3));
  assert.equal(new Set([0, 1, 2, 4, 5, 6, 7, 8, 9].map(letter)).size, 9);
});

test('the strip shows a riff: four lanes from high to low, named by their top note; ties are held, accents are full', () => {
  // two octaves, C2 to C4: 25 semitones in four lanes of 7
  const lanes = lanesOf(seq('C2 . C3! - | G3 . C4 . | C2 . Bb2 C3 | . G2 Eb3 -'));
  assert.deepEqual(lanes.map((l) => l.name), ['C4', 'F3', 'Bb2', 'Eb2']);
  assert.deepEqual(lanes.map(cells), [
    '....x.x.........',
    '..X-.......x..x-',
    '..........x..x..',
    'x.......x.......',
  ]);
  const top = strip(laneLines(59, lanes)[0]);
  assert.match(top, /^ {2}C4 {4}·· ·· ·· ·· {2}▆▆ ·· ▆▆ ·· {2}·· ·· ·· ·· {2}·· ·· ·· ·· {3}$/);
  assert.equal(strip(laneLines(59, lanes)[1]).slice(8, 19), '·· ·· ██ ▂▂');
  assert.equal(strip(laneLines(118, lanes)[0]).length, 120);
  assert.notEqual(laneLines(59, lanes, () => 1, 4).join(''), laneLines(59, lanes).join(''), 'the playhead is drawn');
});

test('the strip fits any riff: a chord lights every lane it reaches, one note is one lane, no notes is an empty strip', () => {
  const chord = lanesOf(seq('C3+E3+G3+C4 . . . | . . . . | . . . . | . . . .'));
  assert.deepEqual(chord.map(cells).map((c) => c[0]), ['x', 'x', 'x', 'x']);
  const one = lanesOf(seq('A2 . . . | A2 . . . | A2 . . . | A2 . . .'));
  assert.deepEqual(one.map((l) => [l.name, cells(l)]), [['A2', 'x...x...x...x...'], ['Ab2', '.'.repeat(16)], ['G2', '.'.repeat(16)], ['F#2', '.'.repeat(16)]]);
  assert.deepEqual(lanesOf(emptySeq()).map((l) => [l.name, cells(l)]), Array(4).fill(['', '.'.repeat(16)]));
});

test('banner: plain lines when the output is not a terminal; MINICLAUDE_BANNER picks the animation', async () => {
  let plain = '';
  await banner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  🎛  MiniClaude  →  http://localhost:4749\n\n  patch: "Acid bass" (slot A)   118 bpm\n  cli:   node miniclaude.mjs help\n\n');
  for (const [out, env] of [[{ isTTY: true, columns: 120 }, { NO_COLOR: '1' }], [{ isTTY: true, columns: 120 }, { MINICLAUDE_NO_BANNER: '1' }], [{ isTTY: true, columns: 60 }, {}]]) {
    let quiet = '';
    await banner(info, { ...out, write: (s) => (quiet += s) }, env);
    assert.equal(quiet, plain, JSON.stringify([out, env]));
  }
  let tty = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (tty += s) }, { MINICLAUDE_BANNER: 'arp' });
  assert.ok(tty.includes('\x1b[?25l') && tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'cursor hidden, then shown again');
  assert.match(strip(tty), /▶ {2}http:\/\/localhost:4749\n\n {2}patch "Acid bass" \(slot A\) {3}118 bpm\n {2}cli {3}node miniclaude\.mjs help\n\n$/);
});
