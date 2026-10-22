// The shared theme of Claude-808, MiniClaude, Claudebase and Claudel (tools/theme/): each app has its own copy, since the apps
// import nothing from each other. The copies stay the same as tools/theme/, each page loads its copy before its own
// stylesheet, and no app's stylesheet takes a rule of the theme back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const THEME = path.join(ROOT, 'tools', 'theme');
const APPS = ['drums', 'synth', 'daw', 'live'];
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.replaceAll('\\', '/')).sort();
// text compared without line endings (git may check out either); fonts byte for byte
const content = (f) => (f.endsWith('.woff2') ? fs.readFileSync(f) : fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));

for (const app of APPS) {
  test(`${app}: public/theme/ is the same as tools/theme/ (change tools/theme/ and run node tools/theme.mjs)`, () => {
    const copy = path.join(ROOT, 'apps', app, 'public', 'theme');
    assert.deepEqual(files(copy), files(THEME));
    for (const f of files(THEME)) assert.deepEqual(content(path.join(copy, f)), content(path.join(THEME, f)), `apps/${app}/public/theme/${f} differs`);
  });
}

test('every page loads the theme, then its own stylesheet', () => {
  for (const app of APPS) {
    const pub = path.join(ROOT, 'apps', app, 'public');
    for (const page of fs.readdirSync(pub).filter((f) => f.endsWith('.html'))) {   // the live page too, not only index.html
      const html = fs.readFileSync(path.join(pub, page), 'utf8');
      const theme = html.indexOf('href="theme/theme.css"'), own = html.indexOf('href="style.css"');
      assert.ok(theme > 0 && own > theme, `apps/${app}/public/${page}`);
    }
  }
});

test('every server serves the fonts', () => {
  for (const app of APPS) assert.match(fs.readFileSync(path.join(ROOT, 'apps', app, 'server.mjs'), 'utf8'), /'\.woff2': 'font\/woff2'/, `apps/${app}/server.mjs`);
});

// the top-level rules of a stylesheet, comments left out and white space squeezed
const rules = (css) => {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, ''), out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '{') depth++; else if (s[i] === '}' && --depth === 0) { out.push(s.slice(start, i + 1).replace(/\s+/g, ' ').trim()); start = i + 1; }
  return out;
};

test('no app stylesheet repeats a rule of the theme: it is in the theme once', () => {
  const theme = new Set(rules(fs.readFileSync(path.join(THEME, 'theme.css'), 'utf8')).filter((r) => !r.startsWith(':root') && !r.startsWith('@font-face')));
  for (const app of APPS) {
    const again = rules(fs.readFileSync(path.join(ROOT, 'apps', app, 'public', 'style.css'), 'utf8')).filter((r) => theme.has(r));
    assert.deepEqual(again, [], `apps/${app}/public/style.css`);
  }
});
