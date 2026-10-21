// The apps of Claudio, the desktop suite: what main.mjs needs to start each one's server and open its window.
// No Electron in here, so test/desktop-apps.test.mjs tests it in plain Node.
//
// The other four apps are separate projects (they will move to their own repositories): nothing is imported from
// them. The suite only runs their server file, and so their ports are written down here as well as in their own
// code; each one's port can be changed with its own variable, as when it runs by itself.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// id: the name in --app <id>, the Apps menu and the window state file. home: the variable that tells the app's
// server where to keep its things (data/<id>/ in the project folder; Claudel keeps nothing on its server, so has
// none). page: where its window opens.
export const APPS = [
  { id: 'dj', name: 'DJ Claude', what: 'Four decks, a library, stems and Claude in the booth', server: 'server/server.mjs', port: 4747, portEnv: 'DJ_PORT', page: '/?desktop', color: '#ff7a45' },
  { id: 'drums', name: 'Claude-808', what: 'A drum machine: write a beat, give it a feel', server: 'drums/server.mjs', port: 4748, portEnv: 'CL808_PORT', home: 'CL808_HOME', page: '/?desktop', color: '#ffb347' },
  { id: 'synth', name: 'MiniClaude', what: 'A synthesizer: design a sound, play a riff', server: 'synth/server.mjs', port: 4749, portEnv: 'MINICLAUDE_PORT', home: 'MINICLAUDE_HOME', page: '/?desktop', color: '#36d6e7' },
  { id: 'daw', name: 'Claudebase', what: 'A small DAW: tracks, clips and a song', server: 'daw/server.mjs', port: 4750, portEnv: 'CLAUDEBASE_PORT', home: 'CLAUDEBASE_HOME', page: '/?desktop', color: '#9be564' },
  { id: 'live', name: 'Claudel', what: 'Live coding: code that loops, as on strudel.cc', server: 'live/server.mjs', port: 4751, portEnv: 'CLAUDEL_PORT', page: '/?desktop', color: '#c792ea' },
];

export const appById = (id) => APPS.find((a) => a.id === id) || null;

// where an app's server listens: its variable when set; DJ Claude also has the port in its config.json
export function portOf(app, { env = process.env, config = {} } = {}) {
  return Number(env[app.portEnv]) || (app.id === 'dj' && Number(config.port)) || app.port;
}
export const originOf = (app, opts) => `http://localhost:${portOf(app, opts)}`;
export const serverFile = (app) => path.join(APPS_DIR, app.server);

// the environment its server is started with: its port, and for the other apps where they keep their things
export function serverEnv(app, { env = process.env, config = {}, dataDir }) {
  const out = { ...env, [app.portEnv]: String(portOf(app, { env, config })) };
  if (app.id === 'dj') out.DJ_EMBEDDED = '1';
  if (app.home && !env[app.home]) out[app.home] = path.join(dataDir, app.id);
  return out;
}

// the app a URL belongs to (a link from one app's page to another's opens that app's window), or null
export function appOfUrl(url, opts) {
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  return APPS.find((a) => originOf(a, opts) === origin) || null;
}

// `--app <id>` or `--app=<id>` on the command line: open that app at once, without the home window
export function appFromArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const m = /^--app(?:=(.*))?$/.exec(argv[i]);
    if (m) return appById(m[1] ?? argv[i + 1]) ? (m[1] ?? argv[i + 1]) : null;
  }
  return null;
}
