// Moves the folder an installed DJ Claude app made (Documents/DJ Claude) to the one Claudio, the suite, uses
// (Documents/Claudio), and lays it out with data/ (move-to-data.mjs) on the way. Run it once, by hand, with the app
// closed and before the new build starts for the first time (it would make an empty Documents/Claudio otherwise):
//   node tools/move-to-claudio.mjs                       Documents of this user
//   node tools/move-to-claudio.mjs <from> [<to>]         other folders (a Documents that OneDrive moved, say)
// The app writes its own code, skills and CLAUDE.md into the folder again on its next start; the music, the sets,
// config.json and everything else of the user's comes along as it is.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLayout, layoutReport } from './move-to-data.mjs';

export function moveToClaudio(from, to) {
  if (!fs.existsSync(path.join(from, 'config.json'))) throw new Error(`${from} is not a DJ Claude folder (no config.json in it)`);
  if (fs.existsSync(to)) throw new Error(`${to} is there already: move or delete it first, nothing has been changed`);
  fs.renameSync(from, to);
  // the app's build stamp: the new build is a different app, so it writes its files in again
  fs.rmSync(path.join(to, 'data', 'desktop', 'app-build'), { force: true });
  fs.rmSync(path.join(to, '.dj', 'app-build'), { force: true });
  return migrateLayout(to);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const docs = path.join(os.homedir(), 'Documents');
  const from = path.resolve(process.argv[2] || path.join(docs, 'DJ Claude'));
  const to = path.resolve(process.argv[3] || path.join(path.dirname(from), 'Claudio'));
  try {
    const r = moveToClaudio(from, to);
    console.log(`Moved ${from} to ${to}`);
    for (const l of layoutReport(r)) console.log(l);
    process.exit(r?.problems.length ? 1 : 0);
  } catch (e) { console.error(e.message); process.exit(1); }
}
