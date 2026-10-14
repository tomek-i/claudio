// Where things are. The one place that knows the layout of the project, so that moving a folder means changing
// this file and nothing else.
//
//   apps/server/   server.mjs and apps/server/lib/ (this folder)      apps/web/public/   the page
//   apps/cli/      dj.mjs and apps/cli/cli-ext/                    tools/             tools/produce/ and tools/bench/
//   dj.mjs at the root is a shim for apps/cli/dj.mjs, so `node dj.mjs …` works from the project folder.
//
// Two kinds of place:
//  - the project root, ROOT: where config.json lives, and with it everything the rig keeps or downloads (.dj/,
//    library/, bin/, .venv/, starter/). It is found by walking up from this file to the first folder holding a
//    config.json (the tests run copies of the code in scratch folders with their own config.json, and get that
//    folder), or it is DJ_ROOT when that is set.
//  - the code: the server's libraries, the page, the CLI. These are found from where this file itself is.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function findRoot(from = HERE, env = process.env) {
  if (env.DJ_ROOT) return path.resolve(env.DJ_ROOT);
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'config.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error(`no config.json found in ${from} or any folder above it (set DJ_ROOT to the project folder)`);
  }
}

export const ROOT = findRoot();

// ---- code
export const LIB_DIR = HERE;                                   // the server's libraries (this folder)
export const SERVER_FILE = path.join(HERE, '..', 'server.mjs');
export const PUBLIC_DIR = path.join(HERE, '..', '..', 'web', 'public');   // the page, the audio engine, the worklets
export const CLI_FILE = path.join(HERE, '..', '..', 'cli', 'dj.mjs');
export const CLI_EXT_DIR = path.join(HERE, '..', '..', 'cli', 'cli-ext');

// ---- what the rig keeps
export const CONFIG_FILE = path.join(ROOT, 'config.json');
export const DJ_DIR = path.join(ROOT, '.dj');                  // analysis cache, stems, sessions, logs
export const STARTER_DIR = path.join(ROOT, 'starter');
export const SETS_DIR = path.join(ROOT, 'sets');               // saved sets (lib/sets.mjs): the user's, beside library/
