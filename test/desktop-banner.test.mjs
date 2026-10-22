// banner.mjs: Claudio's banner in the terminal the suite starts from. Plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudioBanner } from '../apps/desktop/banner.mjs';
import { logoRows } from '../apps/server/lib/banner.mjs';

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const info = { version: '0.9.0', apps: [{ name: 'DJ Claude', url: 'http://localhost:4747' }, { name: 'Claudel', url: 'http://localhost:4751' }] };

test('plain lines when the output is not a terminal, or with NO_COLOR', async () => {
  let plain = '';
  await claudioBanner(info, { isTTY: false, write: (s) => (plain += s) }, {});
  assert.equal(plain, '\n  Claudio 0.9.0\n  DJ Claude  http://localhost:4747\n  Claudel    http://localhost:4751\n\n');
  let quiet = '';
  await claudioBanner(info, { isTTY: true, columns: 120, write: (s) => (quiet += s) }, { NO_COLOR: '1' });
  assert.equal(quiet, plain);
});

test('in a terminal: CLAUDIO comes in, settles, and nothing is written after it', async () => {
  let tty = '';
  const out = { isTTY: true, columns: 120, write: (s) => (tty += s) };
  await claudioBanner(info, out, { CLAUDIO_BANNER: 'rain' });
  const settled = strip(tty);
  for (const row of logoRows('CLAUDIO', true)) assert.ok(settled.includes('  ' + row), 'the whole logo, double width at 120 columns');
  assert.ok(tty.lastIndexOf('\x1b[?25h') > tty.lastIndexOf('\x1b[?25l'), 'the cursor is shown again');
  assert.match(settled, /Claudio 0\.9\.0\n\n {2}DJ Claude {2}http:\/\/localhost:4747\n {2}Claudel {4}http:\/\/localhost:4751\n\n$/);
  const after = tty.length;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tty.length, after, 'no equaliser left running: five apps print into this terminal');
});
