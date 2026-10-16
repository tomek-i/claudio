// Where things are. The one place that knows the layout of the project, so that moving a folder means changing
// this file and nothing else.
//
//   apps/server/   server.mjs and apps/server/lib/ (this folder)      apps/web/public/   the page
//   apps/cli/      dj.mjs and apps/cli/cli-ext/                    tools/             tools/produce/ and tools/bench/
//   dj.mjs at the root is a shim for apps/cli/dj.mjs, so `node dj.mjs …` works from the project folder.
//
// Two kinds of place:
//  - the project root, ROOT: the project itself, config.json, and the tools it installs (bin/, .venv/). It is found
//    by walking up from this file to the first folder holding a config.json (the tests run copies of the code in
//    scratch folders with their own config.json, and get that folder), or it is DJ_ROOT when that is set.
//    Everything the apps make while they run is in ROOT/data/, one folder per app:
//      data/dj/          what DJ Claude keeps: library/ (the music), sets/, cues, grid edits, memory, sessions,
//                        exports, voice and produce work
//      data/dj/cache/    what it can make again: the analysis cache, decoded audio, stems, models, the server log
//      data/desktop/     the desktop app's: where its window was, which build wrote the folder
//      data/drums/, data/synth/, data/daw/   the other apps' (each finds its own; nothing here reads them)
//    The layout before data/ (.dj/, library/, sets/ at the top) is moved here once by layout.mjs.
//  - the code: the server's libraries, the page, the CLI, the demo track list. These are found from where this file
//    itself is.
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
export const DEMO_DIR = path.join(HERE, '..', 'demo-tracks');  // the demo track list and its credits (lib/starter.mjs)

// ---- the project
export const CONFIG_FILE = path.join(ROOT, 'config.json');

// ---- what the apps make (data/)
export const DATA_DIR = path.join(ROOT, 'data');
export const DJ_DIR = path.join(DATA_DIR, 'dj');               // DJ Claude's: cues, memory, grid edits, sessions, exports
export const CACHE_DIR = path.join(DJ_DIR, 'cache');           // made again when deleted: analysis, pcm, stems, models, log
export const LIBRARY_DIR = path.join(DJ_DIR, 'library');       // the music (config.json libraryDirs says where to look)
export const SETS_DIR = path.join(DJ_DIR, 'sets');             // saved sets (lib/sets.mjs)
export const EXPORTS_DIR = path.join(DJ_DIR, 'exports');       // exported mixes and sets
export const DESKTOP_DIR = path.join(DATA_DIR, 'desktop');     // the desktop app's window place and build stamp
