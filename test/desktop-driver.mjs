// Runs inside Electron for desktop.test.mjs (no tests in here): `electron test/desktop-driver.mjs <main.mjs>`.
// It loads the real desktop app and reports what its windows do as lines of `@@<json>` on stdout:
//   { ev: 'win', kind: 'home' | 'splash' | 'main' | 'app', visible, maximized, bounds }   a window appeared or changed
//                                                                (main: the DJ page; app: another app's page)
//   { ev: 'gone', kind }                                         a window closed
//   { ev: 'splash', steps: { <id>: <state> }, failed }           the start-up window's lines changed
//   { ev: 'state', engine, page }                                /api/state once the DJ page is on screen, and what the
//                                                                page says of itself (data-engine: live | held)
//   { ev: 'answered', page }                                     DRIVE_ANSWER=1: the page after its start button was pressed
//   { ev: 'home', cards: { <id>: <state> } }                      the home window's cards changed
//   { ev: 'app', url, title, page: { sound, card } }             another app's window is on screen: its sound light, its start card up
// DRIVE_OPEN=<id>: once the home window is up, its card for that app is clicked. Then it ends the run the way a user
// would: it closes the DJ page or the other app's window once that is shown (and then the home window, once its card
// says so), or presses Close on the start-up window when the start failed. DRIVE_USERDATA keeps Electron's own
// profile out of the user's.
import { app, BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';

app.setPath('userData', process.env.DRIVE_USERDATA);
const say = (o) => console.log('@@' + JSON.stringify(o));
const last = new Map(); // window id -> what was last reported about it
let lastSplash = '', lastHome = '', ending = false, clicked = false, appClosed = false;

async function look() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    const url = w.webContents.getURL();
    if (!url) continue;
    const kind = url.startsWith('file:') ? (url.includes('home.html') ? 'home' : 'splash') : new URL(url).port === process.env.DJ_PORT ? 'main' : 'app';
    const now = { ev: 'win', kind, visible: w.isVisible(), maximized: w.isMaximized(), bounds: w.getNormalBounds() };
    if (!last.has(w.id)) w.once('closed', () => say({ ev: 'gone', kind }));
    if (last.get(w.id) !== JSON.stringify(now)) { last.set(w.id, JSON.stringify(now)); say(now); }
    if (kind === 'home') {
      const cards = await w.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('.app')].map((a) => [a.dataset.id, a.dataset.state]))`).catch(() => null);
      if (cards && JSON.stringify(cards) !== lastHome) { lastHome = JSON.stringify(cards); say({ ev: 'home', cards }); }
      if (process.env.DRIVE_OPEN && !clicked && now.visible && cards?.[process.env.DRIVE_OPEN]) { clicked = true; w.webContents.executeJavaScript(`document.querySelector('.app[data-id="${process.env.DRIVE_OPEN}"]').click()`).catch(() => {}); }
      if (appClosed && cards?.[process.env.DRIVE_OPEN] === 'off') w.close(); // the app's card says it is closed: the run is over
    } else if (kind === 'app') {
      // closed once its sound is on, or after 5 s: the report says whether it started by itself and the card stayed away
      if (now.visible && !appClosed && !w.webContents.isLoading()) {
        appClosed = true;
        const look = () => w.webContents.executeJavaScript(`({ sound: document.getElementById('soundText')?.textContent || '', card: !document.getElementById('startOverlay')?.hidden })`).catch(() => null);
        let page = await look();
        for (let i = 0; i < 50 && page?.sound !== 'sound on'; i++) { await new Promise((r) => setTimeout(r, 100)); page = await look(); }
        say({ ev: 'app', url, title: w.getTitle(), page });
        w.close();
      }
    } else if (kind === 'splash') {
      const s = await w.webContents.executeJavaScript(`({ steps: Object.fromEntries([...document.querySelectorAll('#steps li')].map((li) => [li.dataset.id, li.dataset.state])), failed: document.body.classList.contains('failed') })`).catch(() => null);
      if (s && JSON.stringify(s) !== lastSplash) { lastSplash = JSON.stringify(s); say({ ev: 'splash', ...s }); }
      if (s?.failed && !ending) { ending = true; w.webContents.executeJavaScript(`document.getElementById('close').click()`).catch(() => {}); }
    } else if (now.visible && !ending) {
      ending = true;
      const page = await w.webContents.executeJavaScript(`({ engine: document.documentElement.dataset.engine || '', button: document.getElementById('startBtn').textContent, dialog: !document.getElementById('startOverlay').classList.contains('hide') })`).catch(() => null);
      try { say({ ev: 'state', page, engine: (await (await fetch(`http://localhost:${process.env.DJ_PORT}/api/state`)).json()).engine }); } catch (e) { say({ ev: 'state', error: e.message }); }
      if (process.env.DRIVE_ANSWER) { // press the page's start button (the answer to "take over?") and wait for it to be the engine
        await w.webContents.executeJavaScript(`document.getElementById('startBtn').click()`);
        let after = null;
        for (let i = 0; i < 50 && after?.engine !== 'live'; i++) { await new Promise((r) => setTimeout(r, 100)); after = await w.webContents.executeJavaScript(`({ engine: document.documentElement.dataset.engine || '', button: document.getElementById('startBtn').textContent, dialog: !document.getElementById('startOverlay').classList.contains('hide') })`).catch(() => null); }
        await new Promise((r) => setTimeout(r, 600)); // its first state reaches the server
        say({ ev: 'answered', page: after });
      }
      if (process.env.DRIVE_BOUNDS) { w.unmaximize(); w.setBounds(JSON.parse(process.env.DRIVE_BOUNDS)); await new Promise((r) => setTimeout(r, 300)); }
      w.close();
      appClosed = true; // opened from the home window: that one closes once its card says so
    }
  }
}
let busy = false;
setInterval(async () => { if (busy) return; busy = true; try { await look(); } finally { busy = false; } }, 100);
setTimeout(() => { say({ ev: 'timeout' }); app.exit(3); }, 60000);

await import(pathToFileURL(process.argv[2]).href);
