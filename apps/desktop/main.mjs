// DJ Claude as a desktop app: an Electron window on the same server and the same page as browser mode.
//   pnpm --filter dj-claude-desktop start      (or: pnpm desktop, from the project folder)
//
// What the app adds over a browser tab:
//  - no "Start engine" click: the app allows sound without a gesture, and loads the page with ?desktop, which starts
//    the engine by itself;
//  - no background throttling: the window keeps running at full speed when it is hidden or minimised, so the engine
//    does not go stale;
//  - one thing to launch: the server starts with the app and stops with it.
//
// The server is not run in this process. It runs as a utility process of its own, because analysis is heavy
// synchronous work that would freeze the window, and because the server lowers its own priority to keep the audio
// ahead of it, which must not apply to the window. If a server is already listening on the port (started with
// `node dj.mjs start`, say), the app uses that one and leaves it running when it quits.
import { app, BrowserWindow, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import { CONFIG_FILE, ROOT, SERVER_FILE } from '../server/lib/paths.mjs';
import { banner } from '../server/lib/banner.mjs';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const PORT = Number(process.env.DJ_PORT || config.port || 4747);
const ORIGIN = `http://localhost:${PORT}`;

// the app owns its flags, so these need no separate browser profile
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let server = null; // the utility process, when this app started the server
let main = null;

const up = async () => { try { return (await fetch(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

async function ensureServer() {
  if (await up()) return 'attached';
  server = utilityProcess.fork(SERVER_FILE, [], { cwd: ROOT, env: { ...process.env, DJ_PORT: String(PORT), DJ_EMBEDDED: '1' }, stdio: 'inherit', serviceName: 'DJ Claude server' });
  server.once('exit', () => { server = null; });
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await up()) return 'started';
    if (!server) break;
  }
  throw new Error(`the server did not start on port ${PORT}`);
}

// The start-up banner, drawn here: the server's own output is a pipe when it runs under the app, so it could only
// print the plain lines. The equaliser follows the live deck's beat, read from the server a few times a second.
async function showBanner() {
  const get = async (p) => (await fetch(ORIGIN + p, { signal: AbortSignal.timeout(2000) })).json();
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

function open(url) {
  const win = new BrowserWindow({
    width: 1500, height: 950, backgroundColor: '#0b0b10', autoHideMenuBar: true, title: 'DJ Claude',
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
  app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
  app.whenReady().then(async () => {
    try {
      const how = await ensureServer();
      main = open(`${ORIGIN}/?desktop`);
      if (how === 'started') showBanner(); else console.log(`DJ Claude: using the server already running on ${ORIGIN}`);
      main.on('closed', () => { main = null; });
    } catch (e) { console.error(`DJ Claude: ${e.message}`); app.exit(1); }
  });
  app.on('window-all-closed', () => app.quit());
  // a server this app started stops with it; one it attached to is left alone
  app.on('quit', () => { try { server?.kill(); } catch { /* already gone */ } });
}
