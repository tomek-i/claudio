// Claude-808, MiniClaude and Claudebase list their shortcuts behind a "Keys" button in the header (the shared dialog in
// tools/theme/keys.js, copied into each app's public/theme/) and put a tooltip on every control, instead of paragraphs
// of help under the panels (#40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PARAMS } from '../apps/synth/lib/patch.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const APPS = ['drums', 'synth', 'daw'];
const read = (app, file) => fs.readFileSync(path.join(ROOT, 'apps', app, 'public', file), 'utf8');

for (const app of APPS) {
  test(`${app}: a Keys button in the header opens the shared shortcut list`, () => {
    const html = read(app, 'index.html');
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    assert.match(header, /<button id="keysBtn"[^>]*title="[^"]+"[^>]*>/);
    assert.match(read(app, 'app.js'), /import \{ mountKeys \} from '\.\/theme\/keys\.js'/);
    assert.match(read(app, 'app.js'), /mountKeys\(/);
  });

  test(`${app}: no paragraphs of help under the panels`, () => {
    assert.doesNotMatch(read(app, 'index.html'), /class="hint"/);
  });

  test(`${app}: every button, field and list on the page has a tooltip`, () => {
    const tags = read(app, 'index.html').match(/<(button|select|input)\b[^>]*>/g);
    const bare = tags.filter((t) => !/\btype="hidden"/.test(t) && !/\btitle="[^"]+"/.test(t));
    assert.deepEqual(bare, []);
  });
}

// the server tests never load the page's scripts: a slip in one would only show in a browser
test('the scripts of the three pages and the Keys dialog parse', () => {
  const files = ['tools/theme/keys.js', ...APPS.flatMap((app) => fs.readdirSync(path.join(ROOT, 'apps', app, 'public')).filter((f) => f.endsWith('.js')).map((f) => `apps/${app}/public/${f}`))];
  for (const f of files) {
    const run = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${f}: ${run.stderr}`);
  }
});

test('synth: every parameter of the panel has a hint, its tooltip', () => {
  const bare = PARAMS.filter((p) => typeof p.hint !== 'string' || !p.hint.trim()).map((p) => p.id);
  assert.deepEqual(bare, []);
});
