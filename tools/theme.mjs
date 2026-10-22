// Copies the shared theme (tools/theme/: theme.css and the two fonts with their licences) into each of the four
// apps, Claude-808, MiniClaude, Claudebase and Claudel, as their public/theme/. The apps import nothing from each other or
// from here, so each serves its own copy; test/apps-theme.test.mjs fails when a copy is not the same as this one.
//   node tools/theme.mjs          after changing anything in tools/theme/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FROM = path.join(ROOT, 'tools', 'theme');
export const APPS = ['drums', 'synth', 'daw', 'live'];

for (const app of APPS) {
  const to = path.join(ROOT, 'apps', app, 'public', 'theme');
  fs.rmSync(to, { recursive: true, force: true }); // a file taken out of the theme goes from the copies too
  fs.cpSync(FROM, to, { recursive: true });
  console.log(`theme → apps/${app}/public/theme/`);
}
