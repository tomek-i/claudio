// Runs inside Electron for desktop.test.mjs (no tests in here): `electron test/desktop-driver.mjs <main.mjs>`.
// It loads the real desktop app and reports what its windows do as lines of `@@<json>` on stdout:
//   { ev: 'win', kind: 'splash' | 'main', visible, maximized, bounds }   a window appeared or changed
//   { ev: 'gone', kind }                                         a window closed
//   { ev: 'splash', steps: { <id>: <state> }, failed }           the start-up window's lines changed
//   { ev: 'state', engine }                                      /api/state, once the DJ page is on screen
// Then it ends the run the way a user would: it closes the DJ page once that is shown, or presses Close on the
// start-up window when the start failed. DRIVE_USERDATA keeps Electron's own profile out of the user's.
import { app, BrowserWindow } from 'electron';
import { pathToFileURL } from 'node:url';

app.setPath('userData', process.env.DRIVE_USERDATA);
const say = (o) => console.log('@@' + JSON.stringify(o));
const last = new Map(); // window id -> what was last reported about it
let lastSplash = '', ending = false;

async function look() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    const url = w.webContents.getURL();
    if (!url) continue;
    const kind = url.startsWith('file:') ? 'splash' : 'main';
    const now = { ev: 'win', kind, visible: w.isVisible(), maximized: w.isMaximized(), bounds: w.getNormalBounds() };
    if (!last.has(w.id)) w.once('closed', () => say({ ev: 'gone', kind }));
    if (last.get(w.id) !== JSON.stringify(now)) { last.set(w.id, JSON.stringify(now)); say(now); }
    if (kind === 'splash') {
      const s = await w.webContents.executeJavaScript(`({ steps: Object.fromEntries([...document.querySelectorAll('#steps li')].map((li) => [li.dataset.id, li.dataset.state])), failed: document.body.classList.contains('failed') })`).catch(() => null);
      if (s && JSON.stringify(s) !== lastSplash) { lastSplash = JSON.stringify(s); say({ ev: 'splash', ...s }); }
      if (s?.failed && !ending) { ending = true; w.webContents.executeJavaScript(`document.getElementById('close').click()`).catch(() => {}); }
    } else if (now.visible && !ending) {
      ending = true;
      try { say({ ev: 'state', engine: (await (await fetch(`http://localhost:${process.env.DJ_PORT}/api/state`)).json()).engine }); } catch (e) { say({ ev: 'state', error: e.message }); }
      if (process.env.DRIVE_BOUNDS) { w.unmaximize(); w.setBounds(JSON.parse(process.env.DRIVE_BOUNDS)); await new Promise((r) => setTimeout(r, 300)); }
      w.close();
    }
  }
}
let busy = false;
setInterval(async () => { if (busy) return; busy = true; try { await look(); } finally { busy = false; } }, 100);
setTimeout(() => { say({ ev: 'timeout' }); app.exit(3); }, 60000);

await import(pathToFileURL(process.argv[2]).href);
