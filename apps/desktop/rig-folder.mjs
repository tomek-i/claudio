// The installed app's project folder. Run from the repository, the rig keeps its things (config.json, .dj/,
// library/, bin/) in the project folder the code is in. An installed app has no such folder: its code sits in the
// install directory, which an update replaces. So it keeps them in a folder of the user's, made on the first start.
// No Electron in here: root.mjs decides when and where, and the tests call this directly.
import fs from 'node:fs';
import path from 'node:path';

// root: the folder to make ready. shipped: the app's own files (config.json and starter/ as they were built in).
export function prepareRigFolder(root, shipped) {
  fs.mkdirSync(root, { recursive: true });
  // the settings are the user's from then on: never replaced by an update
  const config = path.join(root, 'config.json');
  if (!fs.existsSync(config)) fs.copyFileSync(path.join(shipped, 'config.json'), config);
  // the starter crate's track list is the app's, not the user's: an update brings a new one
  fs.cpSync(path.join(shipped, 'starter'), path.join(root, 'starter'), { recursive: true });
  return root;
}
