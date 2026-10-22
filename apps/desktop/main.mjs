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
//  - a start-up window for each app (splash.html): on screen at once, it lists each step as it happens (server, the
//    app's checks from its /api/health, DJ Claude's audio engine, the page) and gives way to the app's window;
//  - Claudio's banner in the terminal it was started from (banner.mjs); the servers' output follows it, a line at a
//    time with the app's name before it;
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
import { loadWindow, placement, saveWindow } from './window-state.mjs';
import { icoOf, relaunchCommand } from './taskbar.mjs';
import { describe, watchUpdates } from './updates.mjs';
import { claudioBanner } from './banner.mjs';
import { pendingSteps, stepsOf } from './startup.mjs';
import { APPS, appById, appFromArgs, appOfUrl, originOf, pingUrl, portOf, serverEnv, serverFile } from './apps.mjs';

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const OPTS = { config };
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

// per app: the utility process when the suite started its server, its window, and the opening under way; while it
// starts, its start-up window, that page being ready to be told things, and whether the start failed
const apps = new Map(APPS.map((a) => [a.id, { server: null, win: null, opening: null, splash: null, splashLoaded: null, starting: false, failed: false }]));
let home = null, homeLoaded = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (a, p, ms = 2000) => (await fetch(originOf(a, OPTS) + p, { signal: AbortSignal.timeout(ms) })).json();
// Claudio's banner, once, as the app starts; what is printed after it waits for it, as the banner draws in place
let bannerDone = Promise.resolve();
const log = (line, err = false) => bannerDone.then(() => (err ? console.error : console.log)(line));
const up = async (a) => { try { return (await fetch(pingUrl(a, OPTS), { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

// an app's server: the one on its port, or one started here. Its output is passed on a line at a time, with the
// app's name before it. Being a pipe, it gets the app's own banner as plain lines: the animated one is for an app
// started by itself.
async function ensureServer(a) {
  if (await up(a)) return 'attached';
  const s = apps.get(a.id);
  const env = serverEnv(a, { env: process.env, config, dataDir: DATA_DIR });
  s.server = utilityProcess.fork(serverFile(a), [], { cwd: ROOT, env, stdio: 'pipe', serviceName: `${a.name} server` });
  for (const out of [s.server.stdout, s.server.stderr]) out?.on('data', (d) => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) log(`[${a.name}] ${l}`); });
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
  if (s.splash) { s.splash.focus(); return s.opening; }
  if (s.opening) return s.opening;
  s.opening = startApp(a).finally(() => { s.opening = null; });
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

// ---- starting an app: its start-up window, the server, its checks, then its window once the page is ready (DJ
// Claude's once its engine plays)

// The start-up window. A local file with nothing to fetch, so it shows before the server exists. It has no preload:
// the steps are reported by calling the page's own functions (step / done / failed in splash.html).
function openSplash(a) {
  const s = apps.get(a.id);
  const splash = s.splash = new BrowserWindow({
    width: 440, height: 520, frame: false, resizable: false, maximizable: false, fullscreenable: false, center: true,
    backgroundColor: '#09090c', title: a.name, icon: ICON, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  s.splashLoaded = splash.loadFile(fileURLToPath(new URL('./splash.html', import.meta.url)), { query: { app: a.id, name: a.name, color: a.color } }).catch(() => {});
  // closed before the app's window is up (Alt+F4, or Close after an error): the app is not opened. With no other
  // window (--app <id>), there is nothing left to quit from.
  splash.on('closed', () => {
    s.splash = null;
    if (!s.starting) return;
    s.starting = false;
    if (s.win && !s.win.isDestroyed()) s.win.destroy();
    stopServer(a);
    tellHome(a.id, s.failed ? 'failed' : 'off', s.failed ? 'see the start-up window' : '');
    if (!home && ![...apps.values()].some((o) => o.win || o.splash)) app.exit(s.failed ? 1 : 0);
  });
}
const tell = async (a, fn, ...args) => {
  const s = apps.get(a.id);
  await s.splashLoaded;
  if (s.splash) await s.splash.webContents.executeJavaScript(`${fn}(${args.map((v) => JSON.stringify(v)).join(',')})`).catch(() => {});
};
const step = (a, id, name, state, detail = '') => tell(a, 'step', id, name, state, detail);

// The app's own health checks (/api/health), as lines of the start-up window (which ones: startup.mjs). Returns true
// when a required one is down.
async function checkApp(a) {
  const pending = pendingSteps(a);
  for (const p of pending) step(a, p.id, p.name, 'run');
  let checks;
  try { checks = (await getJson(a, '/api/health', 15000)).checks; } catch {
    const unknown = pending.length ? pending : [{ id: 'checks', name: 'Checks' }];
    for (const p of unknown) step(a, p.id, p.name, 'warn', 'not checked: no answer from the server');
    return false;
  }
  const { steps, down } = stepsOf(a, checks);
  for (const x of steps) step(a, x.id, x.name, x.state, x.detail);
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
    try { const e = (await getJson(appById('dj'), '/api/state')).engine; if (e?.connected && e.started && !e.stale) return 'live'; } catch { /* ask again */ }
  }
  return false;
}

// The other apps' pages load hidden too, and are ready once they have painted: true, or false when the page did not
// load in time.
function pageReady(win) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    win.once('ready-to-show', () => { clearTimeout(timer); resolve(true); });
    win.webContents.once('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) { clearTimeout(timer); resolve(false); } });
  });
}

async function startApp(a) {
  const s = apps.get(a.id), port = portOf(a, OPTS);
  s.starting = true; s.failed = false;
  tellHome(a.id, 'starting');
  openSplash(a);
  // installed, the project folder is one the app made (root.mjs): say where, it is where Claude Code is opened
  if (a.id === 'dj' && app.isPackaged) step(a, 'folder', 'Project folder', 'ok', ROOT);
  step(a, 'server', 'Server', 'run', `port ${port}`);
  let how;
  try { how = await ensureServer(a); } catch (e) {
    s.failed = true;
    log(`${a.name}: ${e.message}`, true);
    step(a, 'server', 'Server', 'fail', e.message);
    tellHome(a.id, 'failed', e.message);
    return tell(a, 'failed', `${a.name} could not start.`);
  }
  if (!s.starting) return; // the start-up window was closed meanwhile
  step(a, 'server', 'Server', 'ok', how === 'started' ? `started on port ${port}` : `already running on port ${port}`);
  if (how === 'attached') log(`${a.name}: using the server already running on ${originOf(a, OPTS)}`);

  const down = await checkApp(a);
  if (!s.starting) return;
  // where it was last closed, when that place is still on a screen; maximised on the first start
  const { win, place } = appWindow(a, false);
  let ready;
  if (a.id === 'dj') {
    step(a, 'engine', 'Audio engine', 'run', 'starting');
    const engine = await engineLive(win);
    ready = engine === 'live';
    // not live: the page says why (its start dialog is up, with the error or the question), so it is shown all the same
    step(a, 'engine', 'Audio engine', ready ? 'ok' : 'warn', ready ? 'live' : engine === 'held' ? 'another window is the sound system: take over on the page' : 'not started: see the page');
  } else {
    step(a, 'page', 'Page', 'run', 'loading');
    ready = await pageReady(win);
    step(a, 'page', 'Page', ready ? 'ok' : 'warn', ready ? 'loaded' : 'did not load in time: see the window');
  }
  tell(a, 'done', down || !ready ? 'Started, with problems.' : 'Ready.');
  if (down || !ready) await sleep(2500); // long enough to read what is wrong
  if (win.isDestroyed() || !s.splash) return;
  s.starting = false;
  if (place.maximized) win.maximize(); else win.show(); // maximize() shows it too
  s.splash.close();
  tellHome(a.id, 'open');
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
  app.whenReady().then(() => {
    bannerDone = claudioBanner({ version: app.getVersion(), apps: APPS.map((a) => ({ name: a.name, url: originOf(a, OPTS) })) }).catch(() => {});
    watchForUpdates(); setMenu(); if (ONLY) openApp(ONLY); else openHome();
  });
  app.on('window-all-closed', () => app.quit());
  // the servers this app started stop with it; ones it attached to are left alone
  app.on('quit', () => { for (const a of APPS) stopServer(a); });
}
