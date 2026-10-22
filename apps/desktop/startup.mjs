// What an app's start-up window (splash.html) lists from the app's /api/health. No Electron in here, so
// test/desktop-startup.test.mjs tests it in plain Node.
//
// DJ Claude has many systems: its library and the two tools it cannot play without are always listed, the optional
// ones only when they have a fault. The other apps have a few checks, all listed. The server has a line of its own
// before the checks, and DJ Claude's engine one after them (it has not started yet), so neither is listed from here.
const DJ_ALWAYS = { library: 'Library', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

// the lines shown while the checks run (DJ Claude's; the other apps' are not known before the answer)
export const pendingSteps = (app) => (app.id === 'dj' ? Object.entries(DJ_ALWAYS).map(([id, name]) => ({ id, name })) : []);

// checks: /api/health's. The steps to show, each { id, name, state: ok | warn | fail, detail }, and down: whether a
// required one failed (an optional system's fault is a warn already)
export function stepsOf(app, checks) {
  const steps = [];
  let down = false;
  for (const c of checks) {
    if (c.id === 'server' || c.id === 'engine') continue;
    if (app.id === 'dj' && !DJ_ALWAYS[c.id] && c.status !== 'warn' && c.status !== 'fail') continue;
    const version = c.status === 'ok' && /^\S+ version ([^\s-]+)/.exec(c.detail);
    steps.push({ id: c.id, name: c.name, state: c.status === 'off' ? 'ok' : c.status, detail: version ? version[1] : c.detail });
    down ||= c.status === 'fail';
  }
  return { steps, down };
}
