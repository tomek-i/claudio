// Claudio, the desktop suite: DJ Claude, Claude-808, MiniClaude, Claudebase and Claudel, each in a window of its own, on the
// same servers and pages as in a browser.
//   pnpm --filter dj-claude-desktop start      (or: pnpm desktop, from the project folder)
//   … -- --app <id>                           one app at once, without the home window (dj, drums, synth, daw, live)
//
// It starts on the home window (home.html), one card per app (apps.mjs). Opening an app starts its server, if none
// is running on its port, and opens its window; the Apps menu, in every window, opens any of them. Each app has one
// window: opening it again brings that one forward. A link from one app's page to another's opens that app.
//
// What the app adds over browser tabs:
//  - no "Start engine" or "Start sound" click: the app allows sound without a gesture, and loads every app's page with
//    ?desktop, which starts its sound by itself;
//  - no background throttling: a window keeps running at full speed when it is hidden or minimised, so the engine
//    does not go stale;
//  - nothing to start by hand: an app's server starts when it is opened, and stops when its window closes;
//  - DJ Claude's start-up window (splash.html): on screen at once, it lists each step as it happens (server, checks,
//    audio engine) and gives way to the DJ page when the engine plays;
//  - each app's window opens where it was last closed (window-state.mjs): same screen, same size, maximised or not;
//  - updates, installed (updates.mjs): a check at start-up and from the Apps menu or the home window's footer, the
//    download in the background, and the new version on the next start.
//
// `pnpm dist` builds it into an installer (electron-builder.config.cjs). Installed, the suite keeps its things in the
// user's Documents (root.mjs), since there is no project folder around it.
//
// The servers are not run in this process. Each runs as a utility process of its own: DJ Claude's analysis is heavy
// synchronous work that would freeze the windows, and its server lowers its own priority to keep the audio ahead of
// it, which must not apply to the windows. If a server is already listening on an app's port (started with
// `node dj.mjs start` or `pnpm synth`, say), the suite uses that one and leaves it running.
import './root.mjs'; // first: where the project folder is, for paths.mjs below
import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
import { CONFIG_FILE, DATA_DIR, DESKTOP_DIR, ROOT } from '../server/lib/paths.mjs';
import { banner } from '../server/lib/banner.mjs';
import { loadWindow, placement, saveWindow } from './window-state.mjs';
import { icoOf, relaunchCommand } from './taskbar.mjs';
import { describe, watchUpdates } from './updates.mjs';
import { APPS, appById, appFromArgs, appOfUrl, originOf, portOf, serverEnv, serverFile } from './apps.mjs';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const OPTS = { config };
const DJ = appById('dj');
const PORT = portOf(DJ, OPTS);
const ORIGIN = originOf(DJ, OPTS);
const windowFile = (a) => path.join(DESKTOP_DIR, `window-${a.id}.json`);
// --app <id>: that app alone, as a standalone app would be (the home window only from the Apps menu)
const ONLY = appFromArgs(process.argv);

// the app owns its flags, so these need no separate browser profile
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// the pages are dark whatever the system theme is, so the window frame (title bar, menus, scrollbars) is dark too
nativeTheme.themeSource = 'dark';
// the logo on the windows and the taskbar; an identity of its own on Windows, so the taskbar does not show Electron's
const ICON = fileURLToPath(new URL('./icon.png', import.meta.url));
app.setName('Claudio');
app.setAppUserModelId('com.claudio.desktop');

// per app: the utility process when the suite started its server, its window, and the opening under way
const apps = new Map(APPS.map((a) => [a.id, { server: null, win: null, opening: null }]));
let home = null, homeLoaded = null;
let splash = null, splashLoaded = null; // DJ Claude's start-up window, and its page being ready to be told things
let djStarting = false, failed = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (p, ms = 2000) => (await fetch(ORIGIN + p, { signal: AbortSignal.timeout(ms) })).json();
const up = async (a) => { try { return (await fetch(`${originOf(a, OPTS)}/api/state`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

// an app's server: the one on its port, or one started here. DJ Claude's output goes to this process's own (its
// banner is drawn by showBanner below); the others' is passed on a line at a time, with the app's name before it.
async function ensureServer(a) {
  if (await up(a)) return 'attached';
  const s = apps.get(a.id);
  const env = serverEnv(a, { env: process.env, config, dataDir: DATA_DIR });
  s.server = utilityProcess.fork(serverFile(a), [], { cwd: ROOT, env, stdio: a.id === 'dj' ? 'inherit' : 'pipe', serviceName: `${a.name} server` });
  if (a.id !== 'dj') for (const out of [s.server.stdout, s.server.stderr]) out?.on('data', (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) console.log(`[${a.name}] ${l}`); });
  const child = s.server;
  child.once('exit', () => { if (s.server === child) s.server = null; });
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    if (await up(a)) return 'started';
    if (s.server !== child) break;
  }
  throw new Error(`the server did not start on port ${portOf(a, OPTS)}`);
}
// a server this app started stops with its window; one it attached to is left alone
function stopServer(a) {
  const s = apps.get(a.id);
  try { s.server?.kill(); } catch { /* already gone */ }
  s.server = null;
}

// ---- the home window: one card per app (home.html). A card is a link to #open/<id>: the page stays where it is,
// and the change of its address is what says which one was asked for.
function openHome() {
  if (home) { if (home.isMinimized()) home.restore(); return home.focus(); }
  home = new BrowserWindow({
    width: 860, height: 600, minWidth: 420, minHeight: 420, center: true, backgroundColor: '#09090c', title: 'Claudio', icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  homeLoaded = home.loadFile(fileURLToPath(new URL('./home.html', import.meta.url))).then(() => {
    const list = APPS.map(({ id, name, what, color }) => ({ id, name, what, color }));
    return home?.webContents.executeJavaScript(`setApps(${JSON.stringify(list)})`);
  }).catch(() => {});
  for (const a of APPS) tellHome(a.id, apps.get(a.id).win ? 'open' : 'off');
  updateHome();
  home.webContents.on('did-navigate-in-page', (e, url) => {
    const id = /#open\/(\w+)$/.exec(url)?.[1];
    if (!id && !url.endsWith('#update')) return;
    home.webContents.executeJavaScript(`history.replaceState(null, '', location.pathname)`).catch(() => {}); // the same card again is a change again
    if (id) openApp(id); else updateAction();
  });
  home.webContents.on('will-navigate', (e) => e.preventDefault());
  home.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  home.on('closed', () => { home = null; });
}
async function tellHome(id, state, detail = '') {
  await homeLoaded;
  if (home && !home.isDestroyed()) await home.webContents.executeJavaScript(`state(${JSON.stringify(id)}, ${JSON.stringify(state)}, ${JSON.stringify(detail)})`).catch(() => {});
}

// ---- updates (updates.mjs): only the installed app has them; run from the source tree, it is git pull
let updates = null, updateState = { status: 'dev', current: app.getVersion() }, askedForUpdate = false;
function watchForUpdates() {
  if (!app.isPackaged) return;
  updates = watchUpdates(electronUpdater.autoUpdater, { version: app.getVersion(), onChange: updateChanged });
  updateState = updates.state;
  setTimeout(() => updates.check(), 5000); // quietly: what it finds shows in the footer and the menu, without a dialog
}
function updateChanged(s) {
  const was = describe(updateState);
  updateState = s;
  updateHome();
  const now = describe(s);
  if (now.text !== was.text || now.action !== was.action) setMenu();
  // asked for from the menu or the footer: the answer in a dialog (a found update says so once it is in)
  if (!askedForUpdate) return;
  if (s.status === 'latest') { askedForUpdate = false; message('info', now.text); }
  if (s.status === 'failed') { askedForUpdate = false; message('warning', 'Could not check for updates', s.error); }
  if (s.status === 'ready') { askedForUpdate = false; askToRestart(s.next); }
}
async function updateHome() {
  await homeLoaded;
  if (home && !home.isDestroyed()) await home.webContents.executeJavaScript(`update(${JSON.stringify(describe(updateState))})`).catch(() => {});
}
// the menu item and the footer's link: check, or restart into the update that is in
function updateAction() {
  if (!updates) return message('info', 'Updates come to the installed app', 'This one runs from the source tree: git pull brings it up to date.');
  if (updates.state.status === 'ready') return updates.install();
  askedForUpdate = true;
  updates.check();
}
async function askToRestart(version) {
  const { response } = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? undefined, {
    type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1, title: 'Claudio',
    message: `Claudio ${version} is ready`, detail: 'Restart now to update: every app closes and the suite starts again. Later, it installs when you quit.',
  });
  if (response === 0) updates.install();
}
const message = (type, text, detail = '') => dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? undefined, { type, title: 'Claudio', message: text, detail });

// ---- opening an app: its window if it has one, else its server and then its window
function openApp(id) {
  const a = appById(id), s = a && apps.get(id);
  if (!a) return null;
  if (s.win && !s.win.isDestroyed()) { if (s.win.isMinimized()) s.win.restore(); s.win.focus(); return s.opening; }
  if (id === 'dj' && splash) { splash.focus(); return s.opening; }
  if (s.opening) return s.opening;
  s.opening = (id === 'dj' ? startDj() : startApp(a)).finally(() => { s.opening = null; });
  return s.opening;
}

// where an app's window was last closed, and the window itself, kept as the app's window from then on
function appWindow(a, show) {
  const s = apps.get(a.id), file = windowFile(a);
  const place = placement(loadWindow(file), screen.getAllDisplays());
  const win = s.win = open(`${originOf(a, OPTS)}${a.page}`, a, show, place.bounds);
  win.on('close', () => saveWindow(file, { bounds: win.getNormalBounds(), maximized: win.isMaximized() }));
  win.on('closed', () => { if (s.win === win) s.win = null; stopServer(a); tellHome(a.id, 'off'); });
  return { win, place };
}

async function startApp(a) {
  tellHome(a.id, 'starting');
  try { await ensureServer(a); } catch (e) {
    console.error(`${a.name}: ${e.message}`);
    tellHome(a.id, 'failed', e.message);
    if (!home && BrowserWindow.getAllWindows().length === 0) { dialog.showErrorBox(`${a.name} could not start`, e.message); app.exit(1); }
    return;
  }
  const { win, place } = appWindow(a, false);
  win.once('ready-to-show', () => { if (place.maximized) win.maximize(); else win.show(); });
  tellHome(a.id, 'open');
}

// ---- DJ Claude: the start-up window, the server, the checks, then the DJ page once its engine plays

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

// The start-up window. A local file with nothing to fetch, so it shows before the server exists. It has no preload:
// the steps are reported by calling the page's own functions (step / done / failed in splash.html).
function openSplash() {
  splash = new BrowserWindow({
    width: 440, height: 520, frame: false, resizable: false, maximizable: false, fullscreenable: false, center: true,
    backgroundColor: '#09090c', title: 'DJ Claude', icon: ICON, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splashLoaded = splash.loadFile(fileURLToPath(new URL('./splash.html', import.meta.url))).catch(() => {});
  // closed before the DJ page is up (Alt+F4, or Close after an error): DJ Claude is not opened. With no other window
  // (--app dj), there is nothing left to quit from.
  splash.on('closed', () => {
    splash = null;
    if (!djStarting) return;
    djStarting = false;
    const s = apps.get('dj');
    if (s.win && !s.win.isDestroyed()) s.win.destroy();
    stopServer(DJ);
    tellHome('dj', failed ? 'failed' : 'off', failed ? 'see the start-up window' : '');
    if (!home) app.exit(failed ? 1 : 0);
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

// The DJ page loads hidden behind the start-up window and starts the engine by itself (?desktop). The page says how
// that went (data-engine on its root element, set by app.js):
//   'live'  it is the sound system, and the server hears from it;
//   'held'  another window is (the app attached to a server with a browser tab playing): the page does not take the
//           engine by itself, it asks, so the window has to be shown for the question;
//   false   the page did not load, or the engine did not start in time.
async function engineLive(win) {
  let loaded = false, broken = false;
  win.webContents.once('did-finish-load', () => { loaded = true; });
  win.webContents.once('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) broken = true; });
  for (let i = 0; i < 100 && !broken && !win.isDestroyed(); i++) {
    await sleep(200);
    await sleep(200);
    if (!loaded) continue;
    const said = await win.webContents.executeJavaScript('document.documentElement.dataset.engine || ""').catch(() => '');
    if (said === 'held') return 'held';
    if (said !== 'live') continue;
    try { const e = (await getJson('/api/state')).engine; if (e?.connected && e.started && !e.stale) return 'live'; } catch { /* ask again */ }
  }
  return false;
}

async function startDj() {
  djStarting = true; failed = false;
  tellHome('dj', 'starting');
  openSplash();
  // installed, the project folder is one the app made (root.mjs): say where, it is where Claude Code is opened
  if (app.isPackaged) step('folder', 'Project folder', 'ok', ROOT);
  step('server', 'Server', 'run', `port ${PORT}`);
  let how;
  try { how = await ensureServer(DJ); } catch (e) {
    failed = true;
    console.error(`DJ Claude: ${e.message}`);
    step('server', 'Server', 'fail', e.message);
    tellHome('dj', 'failed', e.message);
    return tell('failed', 'DJ Claude could not start.');
  }
  if (!djStarting) return; // the start-up window was closed meanwhile
  step('server', 'Server', 'ok', how === 'started' ? `started on port ${PORT}` : `already running on port ${PORT}`);
  if (how === 'started') showBanner(); else console.log(`DJ Claude: using the server already running on ${ORIGIN}`);

  const down = await checkRig();
  step('engine', 'Audio engine', 'run', 'starting');
  // where it was last closed, when that place is still on a screen; maximised on the first start
  const { win, place } = appWindow(DJ, false);
  const engine = await engineLive(win), live = engine === 'live';
  // not live: the page says why (its start dialog is up, with the error or the question), so it is shown all the same
  step('engine', 'Audio engine', live ? 'ok' : 'warn', live ? 'live' : engine === 'held' ? 'another window is the sound system: take over on the page' : 'not started: see the page');
  tell('done', down || !live ? 'Started, with problems.' : 'Ready.');
  if (down || !live) await sleep(2500); // long enough to read what is wrong; the page's status light has the rest
  if (win.isDestroyed() || !splash) return;
  djStarting = false;
  if (place.maximized) win.maximize(); else win.show(); // maximize() shows it too
  splash.close();
  tellHome('dj', 'open');
}

// ---- windows on the apps' pages
function open(url, a, show = true, bounds = null) {
  const win = new BrowserWindow({
    width: 1500, height: 950, ...bounds, backgroundColor: '#0b0b10', title: a.name, icon: ICON, show,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // only the apps' own pages are shown here: one of this app's stays in the window, another app's opens that app,
  // anything else opens in the user's browser
  const route = (to) => { const b = appOfUrl(to, OPTS); return !b ? 'outside' : b === a ? 'here' : b; };
  win.webContents.on('will-navigate', (e, to) => {
    const r = route(to);
    if (r === 'here') return;
    e.preventDefault();
    if (r === 'outside') shell.openExternal(to); else openApp(r.id);
  });
  win.webContents.setWindowOpenHandler(({ url: to }) => {
    const r = route(to);
    if (r === 'here') open(to, a); else if (r === 'outside') shell.openExternal(to); else openApp(r.id);
    return { action: 'deny' };
  });
  wearIcon(win, a);
  win.loadURL(url);
  return win;
}

// Each app's window wears that app's own icon: the favicon its page has (an SVG), drawn once into a picture in a
// hidden window, as a window icon cannot be an SVG. On Windows each app also gets a taskbar button of its own (an id
// of its own), so the taskbar shows that icon and not the suite's.
const icons = new Map(); // favicon → the picture, once drawn
function iconOf(href) {
  if (icons.has(href)) return icons.get(href);
  // an offscreen window hands over each frame it paints (capturePage does not work on one): the first after the load
  const w = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, webPreferences: { offscreen: true, sandbox: true } });
  const drawn = new Promise((resolve) => {
    let loaded = false;
    w.webContents.once('did-finish-load', () => { loaded = true; w.webContents.invalidate(); });
    w.webContents.on('paint', (e, dirty, img) => { if (loaded && !img.isEmpty()) resolve(img); });
    setTimeout(() => resolve(null), 5000);
  }).finally(() => w.destroy());
  const src = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  w.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent"><img src="${src}" width="256" height="256">`)}`).catch(() => {});
  icons.set(href, drawn);
  return drawn;
}
// The taskbar button can be pinned: Windows keeps the command that opens this app again (taskbar.mjs) and the icon,
// from an .ico in data/claudio/ (a pinned button's picture is read from a file), so a pinned MiniClaude opens MiniClaude
// with its own picture, also when the suite is not running.
function wearIcon(win, a) {
  const win32 = process.platform === 'win32', appId = `com.claudio.desktop.${a.id}`;
  const relaunch = { relaunchCommand: relaunchCommand(a.id, { execPath: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged }), relaunchDisplayName: a.name };
  if (win32) win.setAppDetails({ appId, ...relaunch });
  win.webContents.on('page-favicon-updated', async (e, [href]) => {
    const img = href && await iconOf(href);
    if (!img || win.isDestroyed()) return;
    win.setIcon(img);
    if (!win32) return;
    try {
      const ico = path.join(DESKTOP_DIR, `icon-${a.id}.ico`);
      fs.mkdirSync(DESKTOP_DIR, { recursive: true });
      fs.writeFileSync(ico, icoOf(img.resize({ width: 256, height: 256 }).toPNG()));
      win.setAppDetails({ appId, appIconPath: ico, appIconIndex: 0, ...relaunch });
    } catch {} // the button keeps the window's icon, only a pinned one goes without
  });
}

// ---- the menu, in every window: the apps first. Ctrl+1 to 5 are free in all five pages (they leave a key with
// Ctrl to the browser).
function setMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Apps',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: openHome },
        { type: 'separator' },
        ...APPS.map((a, i) => ({ label: a.name, accelerator: `CmdOrCtrl+${i + 1}`, click: () => openApp(a.id) })),
        { type: 'separator' },
        updateItem(),
        ...(mac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    // copy and paste in text boxes need the Edit menu on a Mac; elsewhere the pages' own Ctrl+Z (undo) must not be taken
    ...(mac ? [{ role: 'editMenu' }] : []),
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

// what the updates are doing: the action to take, or while there is none, the state greyed out
function updateItem() {
  const { text, action } = describe(updateState);
  if (!updates) return { label: 'Check for updates…', click: updateAction };
  return action ? { label: action === 'Restart to update' ? action : `${action}…`, click: updateAction } : { label: text, enabled: false };
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // started again (a second shortcut, say): the app it names, or the home window
  app.on('second-instance', (e, argv) => { const id = appFromArgs(argv); if (id) openApp(id); else openHome(); });
  app.whenReady().then(() => { watchForUpdates(); setMenu(); if (ONLY) openApp(ONLY); else openHome(); });
  app.on('window-all-closed', () => app.quit());
  // the servers this app started stop with it; ones it attached to are left alone
  app.on('quit', () => { for (const a of APPS) stopServer(a); });
}
