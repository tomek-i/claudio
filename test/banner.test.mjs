// Startup banner: every animation draws a full-size frame at any point and ends on the same settled picture;
// output that is not a terminal stays plain text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATIONS, frame, logoRows, banner } from '../apps/server/lib/banner.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const info = { url: 'http://localhost:4747', dirs: ['/music', '/more'], tracks: 12, queued: 0 };

test('every animation: 7 full-width lines throughout, and the same final frame', () => {
  for (const wide of [false, true]) {
    const rows = logoRows('DJ CLAUDE', wide), w = rows[0].length;
    const finals = new Set();
    for (const [name, anim] of Object.entries(ANIMATIONS)) {
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const lines = frame(rows, anim, Math.min(1, p)).map(strip);
        assert.equal(lines.length, 7, name);
        for (const l of lines) assert.equal([...l].length, w + 2, `${name} at ${p.toFixed(2)}`);
      }
      const end = frame(rows, anim, 1);
      assert.deepEqual(end.slice(0, 5).map(strip), rows.map((r) => '  ' + r), `${name} ends on the whole logo`);
      finals.add(end.join('\n'));
    }
    assert.equal(finals.size, 1, 'all animations settle on the same colours and bars');
  }
});

test('banner: plain lines when the output is not a terminal; DJ_BANNER picks the animation', async () => {
  let plain = '';
  await banner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  🎧  DJ Claude  →  http://localhost:4747\n\n  library: /music, /more\n  12 tracks cached, 0 queued for analysis\n\n');
  let quiet = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (quiet += s) }, { NO_COLOR: '1' });
  assert.equal(quiet, plain);
  let tty = '';
  await banner(info, { isTTY: true, columns: 120, write: (s) => (tty += s) }, { DJ_BANNER: 'rain' });
  assert.ok(tty.endsWith('/more\n\n') && tty.includes('\x1b[?25l') && tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'cursor hidden, then shown again');
  assert.match(strip(tty), /▶ {2}http:\/\/localhost:4747\n\n {2}library {2}12 tracks cached\n {2}folders {2}\/music\n {11}\/more\n\n$/);
});
