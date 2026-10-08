// Imported first by main.mjs, for its effect: it decides where the project folder is before paths.mjs looks for it.
// Run from the repository (`pnpm desktop`) there is nothing to decide: paths.mjs finds the folder the code is in.
// The installed app uses "DJ Claude" in the user's Documents (the library and the downloads are theirs to see), or
// the app's own data folder when Documents cannot be written to. DJ_ROOT, when set, is used instead of both, and
// is made ready the same way.
import { app } from 'electron';
import path from 'node:path';
import { prepareRigFolder } from './rig-folder.mjs';

if (app.isPackaged) {
  const places = process.env.DJ_ROOT ? [path.resolve(process.env.DJ_ROOT)] : [path.join(app.getPath('documents'), 'DJ Claude'), path.join(app.getPath('userData'), 'rig')];
  for (const dir of places) {
    try { process.env.DJ_ROOT = prepareRigFolder(dir, app.getAppPath()); break; } catch { /* try the next place */ }
  }
}
