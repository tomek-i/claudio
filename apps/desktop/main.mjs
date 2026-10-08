// DJ Claude as a desktop app: an Electron window on the same server and the same page as browser mode.
//   pnpm --filter dj-claude-desktop start      (or: pnpm desktop, from the project folder)
//
// What the app adds over a browser tab:
//  - no "Start engine" click: the app allows sound without a gesture, and loads the page with ?desktop, which starts
//    the engine by itself;
//  - no background throttling: the window keeps running at full speed when it is hidden or minimised, so the engine
//    does not go stale;
//  - one thing to launch: the server starts with the app and stops with it;
//  - a start-up window (splash.html): it is on screen at once, lists each step as it happens (server, checks, audio
//    engine), and gives way to the DJ page when the engine plays;
//  - the DJ window opens where it was last closed (window-state.mjs): same screen, same size, maximised or not.
//
// `pnpm dist` builds it into an installer (electron-builder.config.cjs). Installed, the app keeps the rig's things
// in the user's Documents (root.mjs), since there is no project folder around it.
//
// The server is not run in this process. It runs as a utility process of its own, because analysis is heavy
// synchronous work that would freeze the window, and because the server lowers its own priority to keep the audio
// ahead of it, which must not apply to the window. If a server is already listening on the port (started with
// `node dj.mjs start`, say), the app uses that one and leaves it running when it quits.
import './root.mjs'; // first: where the project folder is, for paths.mjs below
import { app, BrowserWindow, nativeTheme, screen, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, DJ_DIR, ROOT, SERVER_FILE } from '../server/lib/paths.mjs';
import { banner } from '../server/lib/banner.mjs';
import { loadWindow, placement, saveWindow } from './window-state.mjs';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.DJ_PORT || config.port || 4747);
const ORIGIN = `http://localhost:${PORT}`;
const WINDOW_FILE = path.join(DJ_DIR, 'desktop-window.json');

// the app owns its flags, so these need no separate browser profile
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// the page is dark whatever the system theme is, so the window frame (title bar, menus, scrollbars) is dark too
nativeTheme.themeSource = 'dark';
// the logo on the window and the taskbar; an identity of its own on Windows, so the taskbar does not show Electron's
const ICON = fileURLToPath(new URL('./icon.png', import.meta.url));
app.setAppUserModelId('com.dj-claude.desktop');

let server = null; // the utility process, when this app started the server
let main = null;
let splash = null, splashLoaded = null; // the start-up window, and its page being ready to be told things
let starting = true, failed = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (p, ms = 2000) => (await fetch(ORIGIN + p, { signal: AbortSignal.timeout(ms) })).json();

const up = async () => { try { return (await fetch(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

async function ensureServer() {
  if (await up()) return 'attached';
  server = utilityProcess.fork(SERVER_FILE, [], { cwd: ROOT, env: { ...process.env, DJ_PORT: String(PORT), DJ_EMBEDDED: '1' }, stdio: 'inherit', serviceName: 'DJ Claude server' });
  server.once('exit', () => { server = null; });
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    if (await up()) return 'started';
    if (!server) break;
  }
  throw new Error(`the server did not start on port ${PORT}`);
}

// The start-up banner, drawn here: the server's own output is a pipe when it runs under the app, so it could only
// print the plain lines. The equaliser follows the live deck's beat, read from the server a few times a second.
async function showBanner() {
  const get = getJson;
  try {
    const [lib, vis] = await Promise.all([get('/api/library?limit=1'), get('/api/visuals')]);
    let deck = null, at = 0;
    const poll = setInterval(async () => {
      try { const s = await get('/api/state'), d = s.decks?.[s.live]; deck = d?.playing && d.bpm && d.firstBeat != null ? d : null; at = Date.now(); } catch { deck = null; }
    }, 300);
    poll.unref();
    const beat = () => (deck ? ((((deck.position + ((Date.now() - at) / 1000) * (deck.rate || 1) - deck.firstBeat) / (60 / deck.bpm)) % 1) + 1) % 1 : null);
    await banner({ url: ORIGIN, visuals: vis.url, dirs: lib.dirs, tracks: lib.status.tracks, queued: lib.status.queued, live: config.banner?.loop === false ? null : beat });
  } catch { console.log(`DJ Claude: server started on ${ORIGIN}`); }
}

const local = (url) => { try { return new URL(url).origin === ORIGIN; } catch { return false; } };

// The start-up window. A local file with nothing to fetch, so it shows before the server exists. It has no preload:
// the steps are reported by calling the page's own functions (step / done / failed in splash.html).
function openSplash() {
  splash = new BrowserWindow({
    width: 440, height: 520, frame: false, resizable: false, maximizable: false, fullscreenable: false, center: true,
    backgroundColor: '#09090c', title: 'DJ Claude', icon: ICON, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashLoaded = splash.loadFile(fileURLToPath(new URL('./splash.html', import.meta.url))).catch(() => {});
  // closed before the DJ page is up (Alt+F4, or Close after an error): there is no other window to quit from
  splash.on('closed', () => {
    splash = null;
    if (!starting) return;
    try { server?.kill(); } catch { /* already gone */ }
    app.exit(failed ? 1 : 0);
  });
}
const tell = async (fn, ...args) => {
  await splashLoaded;
  if (splash) await splash.webContents.executeJavaScript(`${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`).catch(() => {});
};
const step = (id, name, state, detail = '') => tell('step', id, name, state, detail);

// The rig's own health checks (/api/health), as lines of the start-up window: the library and the two required
// tools always, the optional systems only when they have a fault. Returns true when a required one is down.
// The engine is not judged here: it has not started yet, and has a line of its own.
async function checkRig() {
  const always = { library: 'Library', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  for (const [id, name] of Object.entries(always)) step(id, name, 'run');
  let checks;
  try { checks = (await getJson('/api/health', 15000)).checks; } catch {
    for (const [id, name] of Object.entries(always)) step(id, name, 'warn', 'not checked: no answer from the server');
    return false;
  }
  let down = false;
  for (const c of checks) {
    if (c.id === 'server' || c.id === 'engine' || (!always[c.id] && c.status !== 'warn' && c.status !== 'fail')) continue;
    const version = c.status === 'ok' && /^\S+ version ([^\s-]+)/.exec(c.detail);
    step(c.id, c.name, c.status === 'off' ? 'ok' : c.status, version ? version[1] : c.detail);
    down ||= c.status === 'fail';
  }
  return down;
}

// The DJ page loads hidden behind the start-up window and starts the engine by itself (?desktop). True once the
// server hears from that engine; false when the page did not load or the engine did not start in time.
async function engineLive(win) {
  let loaded = false, broken = false;
  win.webContents.once('did-finish-load', () => { loaded = true; });
  win.webContents.once('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) broken = true; });
  for (let i = 0; i < 100 && !broken && !win.isDestroyed(); i++) {
    await sleep(200);
    if (!loaded) continue;
    try { const e = (await getJson('/api/state')).engine; if (e?.connected && e.started && !e.stale) return true; } catch { /* ask again */ }
  }
  return false;
}

async function start() {
  openSplash();
  step('server', 'Server', 'run', `port ${PORT}`);
  let how;
  try { how = await ensureServer(); } catch (e) {
    failed = true;
    console.error(`DJ Claude: ${e.message}`);
    step('server', 'Server', 'fail', e.message);
    return tell('failed', 'DJ Claude could not start.');
  }
  step('server', 'Server', 'ok', how === 'started' ? `started on port ${PORT}` : `already running on port ${PORT}`);
  if (how === 'started') showBanner(); else console.log(`DJ Claude: using the server already running on ${ORIGIN}`);

  const down = await checkRig();
  step('engine', 'Audio engine', 'run', 'starting');
  // where it was last closed, when that place is still on a screen; maximised on the first start
  const place = placement(loadWindow(WINDOW_FILE), screen.getAllDisplays());
  main = open(`${ORIGIN}/?desktop`, false, place.bounds);
  main.on('close', () => saveWindow(WINDOW_FILE, { bounds: main.getNormalBounds(), maximized: main.isMaximized() }));
  main.on('closed', () => { main = null; });
  const live = await engineLive(main);
  // not live: the page says why (its start dialog comes back with the error), so it is shown all the same
  step('engine', 'Audio engine', live ? 'ok' : 'warn', live ? 'live' : 'not started: see the page');
  tell('done', down || !live ? 'Started, with problems.' : 'Ready.');
  if (down || !live) await sleep(2500); // long enough to read what is wrong; the page's status light has the rest
  if (!main || !splash) return;
  starting = false;
  if (place.maximized) main.maximize(); else main.show(); // maximize() shows it too
  splash.close();
}

function open(url, show = true, bounds = null) {
  const win = new BrowserWindow({
    width: 1500, height: 950, ...bounds, backgroundColor: '#0b0b10', autoHideMenuBar: true, title: 'DJ Claude', icon: ICON, show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // only the local server's pages are shown in the app; any other link opens in the user's browser
  win.webContents.on('will-navigate', (e, to) => { if (!local(to)) { e.preventDefault(); shell.openExternal(to); } });
  win.webContents.setWindowOpenHandler(({ url: to }) => {
    if (local(to)) open(to); else shell.openExternal(to);
    return { action: 'deny' };
  });
  win.loadURL(url);
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const w = starting ? splash : main; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  // a server this app started stops with it; one it attached to is left alone
  app.on('quit', () => { try { server?.kill(); } catch { /* already gone */ } });
}
