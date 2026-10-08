// Where the DJ window was when it was last closed, so it opens there again: its size and position, and whether it
// was maximised. Kept with the rest of what the rig keeps (.dj/desktop-window.json). No Electron in here: main.mjs
// hands in the screens, so the tests can too.
import fs from 'node:fs';
import path from 'node:path';

const MIN_W = 480, MIN_H = 320;   // smaller than this is not a window anyone left on purpose
const GRAB_W = 120, GRAB_H = 40;  // how much of the window's top edge must be on a screen to drag it back

export function loadWindow(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function saveWindow(file, state) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch { /* the window just opens in the default place next time */ }
}

// What to open the window with: { bounds, maximized }. bounds is null when there is nothing usable saved, which
// leaves the default size on the main screen. The first start is maximised.
// displays: Electron's screen.getAllDisplays() (each with a workArea { x, y, width, height }).
export function placement(saved, displays) {
  if (!saved) return { bounds: null, maximized: true };
  const maximized = saved.maximized !== false;
  const b = saved.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < MIN_W || b.height < MIN_H) return { bounds: null, maximized };
  // the saved place may be on a screen that is gone (a laptop off its dock): only use it where its title bar can be reached
  const reachable = displays.some(({ workArea: a }) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    return w >= GRAB_W && b.y >= a.y - 8 && b.y + GRAB_H <= a.y + a.height;
  });
  if (!reachable) return { bounds: null, maximized };
  return { bounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }, maximized };
}
