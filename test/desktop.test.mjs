// The desktop app's start-up, with the real Electron: DJ Claude on its own (--app dj): the start-up window first, then
// the server, the checks and the audio engine, then the DJ page in its place; the start-up window saying so when the
// server cannot start; and Claudio's home window, opening another app's window and server from its card.
// The app runs on a scratch project folder (DJ_ROOT: its own config, port and generated library) and a scratch
// Electron profile, so it never meets the rig on this machine. Skipped when Electron is not installed (it is the
// desktop app's own dependency: `pnpm install`). Ports 4859-4860, 4862 and 4869-4871. desktop-driver.mjs is the part inside Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { REAL, scratch, sleep, api, FakeEngine } from './server-harness.mjs';

let electron = null;
try { electron = createRequire(path.join(REAL, 'apps', 'desktop', 'package.json'))('electron'); } catch { /* not installed, or its binary is not downloaded */ }
// DESKTOP_TEST_REQUIRED (the CI job that exists to run this): a missing Electron is a failure there, not a skip
if (!electron && process.env.DESKTOP_TEST_REQUIRED) throw new Error('Electron is not installed, and DESKTOP_TEST_REQUIRED is set');
const skip = !electron && 'Electron is not installed (pnpm install)';

// one run of the app, to its end: the driver's events in order, the exit code, and what the app printed.
// args: the app's own (--app dj: DJ Claude alone, no home window)
function run(sc, env = {}, args0 = ['--app=dj']) {
  return new Promise((resolve) => {
    // a Linux CI machine has no user namespace sandbox to give
    const args = [...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []), path.join(REAL, 'test', 'desktop-driver.mjs'), path.join(REAL, 'apps', 'desktop', 'main.mjs'), ...args0];
    const child = spawn(electron, args, {
      cwd: sc.dir, windowsHide: false,
      env: { ...process.env, DJ_ROOT: sc.dir, DJ_PORT: String(sc.port), DJ_NO_BACKFILL: '1', DJ_BANNER_LOOP: '0', DRIVE_USERDATA: path.join(sc.dir, 'electron-profile'), ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out, events: out.split(/\r?\n/).filter((l) => l.startsWith('@@')).map((l) => JSON.parse(l.slice(2))) }));
  });
}
const up = async (sc) => { try { return (await fetch(sc.base + '/api/state', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
const stopped = async (sc) => { for (let i = 0; i < 50; i++) { if (!(await up(sc))) return true; await sleep(100); } return false; };

test('start-up: the start-up window first, then the DJ page with a live engine; the server stops with the app; the window opens where it was closed', { skip, timeout: 120000 }, async () => {
  const sc = scratch('desktop', { port: 4859 });
  // the driver leaves the window at this place before it closes it, for the second start below
  const left = { x: 40, y: 40, width: 900, height: 600 };
  const r = await run(sc, { DRIVE_BOUNDS: JSON.stringify(left) });
  const ev = r.events, at = (f) => ev.findIndex(f);
  assert.equal(r.code, 0, r.out);

  // the start-up window is on screen before the DJ page exists, and goes when that is shown
  const splashShown = at((e) => e.ev === 'win' && e.kind === 'splash' && e.visible);
  const mainFirst = at((e) => e.ev === 'win' && e.kind === 'main');
  const mainShown = at((e) => e.ev === 'win' && e.kind === 'main' && e.visible);
  assert.ok(splashShown >= 0 && mainFirst > splashShown, r.out);
  assert.equal(ev[mainFirst].visible, false, 'the DJ page loads hidden behind the start-up window');
  assert.ok(mainShown > mainFirst, r.out);
  assert.ok(at((e) => e.ev === 'gone' && e.kind === 'splash') > mainFirst, r.out);

  // the steps it listed ended well: the server, the library, the two tools. (The engine's line turns to ok as the
  // window closes, too briefly to be read from here: the engine itself is checked below.)
  const steps = ev.filter((e) => e.ev === 'splash').at(-1).steps;
  for (const id of ['server', 'library', 'ffmpeg', 'ffprobe']) assert.equal(steps[id], 'ok', `${id}: ${JSON.stringify(steps)}`);
  assert.ok(steps.engine, JSON.stringify(steps));
  assert.equal(ev.filter((e) => e.ev === 'splash').at(-1).failed, false);

  // the DJ page is the sound system by the time it is shown
  const state = ev.find((e) => e.ev === 'state');
  assert.equal(state.engine?.connected, true, JSON.stringify(state));
  assert.equal(state.engine?.started, true, JSON.stringify(state));
  assert.deepEqual(state.page, { engine: 'live', button: 'Start engine', dialog: false });
  // (a Linux CI screen has no window manager to maximise anything)
  if (process.platform !== 'linux') assert.equal(ev[mainShown].maximized, true, 'the first start is maximised');

  assert.ok(await stopped(sc), 'the server the app started stops with it');

  // closed as a plain window at `left`: that is saved with the rig, and the next start opens there
  // (within a few pixels: on a scaled screen Windows rounds a new window's size to whole device pixels)
  const near = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= 8);
  const saved = JSON.parse(fs.readFileSync(path.join(sc.dir, 'data', 'claudio', 'window-dj.json'), 'utf8'));
  assert.equal(saved.maximized, false);
  assert.ok(near(saved.bounds, left), JSON.stringify(saved));
  const again = await run(sc);
  assert.equal(again.code, 0, again.out);
  const shown = again.events.find((e) => e.ev === 'win' && e.kind === 'main' && e.visible);
  assert.equal(shown.maximized, false, again.out);
  assert.ok(near(shown.bounds, left), JSON.stringify(shown));
  assert.ok(await stopped(sc));
});

test('start-up: a port that something else holds is reported in the start-up window, and the app exits with 1', { skip, timeout: 90000 }, async () => {
  const sc = scratch('desktop-taken', { port: 4860 });
  const other = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await new Promise((r) => other.listen(sc.port, r));
  try {
    const r = await run(sc);
    const last = r.events.filter((e) => e.ev === 'splash').at(-1);
    assert.equal(last?.steps.server, 'fail', r.out);
    assert.equal(last.failed, true);
    assert.ok(!r.events.some((e) => e.kind === 'main'), 'no DJ page is opened');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the server did not start on port 4860/);
  } finally { other.closeAllConnections?.(); other.close(); }
});

test('start-up: a server whose sound system is another page keeps it; the app asks, and leaves the server running', { skip, timeout: 90000 }, async () => {
  const sc = scratch('desktop-held', { port: 4862 });
  // a server as `node dj.mjs start` leaves one: this repository's code (the scratch copy has no page) on the scratch folder
  const srv = spawn(process.execPath, [path.join(REAL, 'apps', 'server', 'server.mjs')], { cwd: sc.dir, env: { ...process.env, DJ_ROOT: sc.dir, DJ_PORT: String(sc.port), DJ_NO_BACKFILL: '1' }, stdio: 'ignore', windowsHide: true });
  srv.stop = () => { try { srv.kill(); } catch { /* gone */ } };
  for (let i = 0; i < 80 && !(await up(sc)); i++) await sleep(150);
  const tab = new FakeEngine(sc.base, 'browser-tab');
  try {
    await tab.start();
    await tab.loadTrack('A', sc.fx.main);
    await tab.set('A', { playing: true, audible: 1 });
    const r = await run(sc);
    assert.equal(r.code, 0, r.out);
    // the DJ page is shown, with the question up and nothing taken
    const state = r.events.find((e) => e.ev === 'state');
    assert.deepEqual(state?.page, { engine: 'held', button: 'Take over', dialog: true }, r.out);
    assert.equal(tab.sent('load').length + tab.sent('pause').length, 0);
    const now = await api(sc.base, '/api/state');
    assert.equal(now.engine.connected, true);
    assert.equal(now.decks.A.playing, true, 'the music the other page plays goes on');
    assert.match(r.out, /using the server already running/);

    // again, and this time the user answers "Take over": the app's page becomes the sound system, with empty decks
    const yes = await run(sc, { DRIVE_ANSWER: '1' });
    assert.deepEqual(yes.events.find((e) => e.ev === 'answered')?.page, { engine: 'live', button: 'Start engine', dialog: false }, yes.out);
    assert.ok(!(await api(sc.base, '/api/state')).decks.A?.playing, 'the other page is no longer the engine');
    assert.ok(await up(sc), 'a server the app attached to is left running');
  } finally { await tab.stop(); srv.stop(); }
});

test('home: Claudio opens on its home window; a card starts that app\'s server and opens its window, and closing it stops the server', { skip, timeout: 90000 }, async () => {
  const sc = scratch('desktop-home', { port: 4870 });
  const drums = 'http://localhost:4869';
  const drumsUp = async () => { try { return (await fetch(drums + '/api/state', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
  const r = await run(sc, { DRIVE_OPEN: 'drums', CL808_PORT: '4869' }, []);
  assert.equal(r.code, 0, r.out);
  const ev = r.events, at = (f) => ev.findIndex(f);
  // the home window, with a card per app, and no DJ start-up: nothing is started before it is asked for
  // (the first report can come before the cards are drawn: the first one with cards in it)
  assert.deepEqual(Object.keys(ev.find((e) => e.ev === 'home' && Object.keys(e.cards).length).cards), ['dj', 'drums', 'synth', 'daw'], r.out);
  assert.ok(!ev.some((e) => e.kind === 'splash' || e.kind === 'main'), 'DJ Claude is not started');
  // the card says it is starting, then the drum machine's own page is in a window of its own
  // (the order is checked from the click: the driver can see a window before the card says "starting", as the DJ test below says)
  const clicked = at((e) => e.ev === 'home'), shown = at((e) => e.ev === 'app');
  assert.ok(ev.some((e) => e.ev === 'home' && e.cards.drums === 'starting'), r.out);
  assert.ok(clicked >= 0 && shown > clicked, r.out);
  assert.equal(ev[shown].url, drums + '/');
  assert.match(ev[shown].title, /808/);
  assert.ok(at((e) => e.ev === 'home' && e.cards.drums === 'open') > clicked, r.out);
  // closed: its card says so, and the server the suite started for it is gone
  assert.ok(ev.findLastIndex((e) => e.ev === 'home' && e.cards.drums === 'off') > shown, r.out);
  assert.match(r.out, /\[Claude-808\] .*http:\/\/localhost:4869/, 'its output, with its name before each line');
  for (let i = 0; i < 50 && (await drumsUp()); i++) await sleep(100);
  assert.equal(await drumsUp(), false, 'the server the suite started stops with its window');
});

test('home: DJ Claude from its card: the start-up window, then the DJ page; closed, its server stops and the home window stays', { skip, timeout: 90000 }, async () => {
  const sc = scratch('desktop-home-dj', { port: 4871 });
  const r = await run(sc, { DRIVE_OPEN: 'dj' }, []);
  assert.equal(r.code, 0, r.out);
  const ev = r.events, at = (f) => ev.findIndex(f);
  // the driver clicks the card once it has seen the cards; it looks at the windows every 100 ms, so the start-up
  // window can be seen before the card says "starting": the order is checked from the click, not from that
  const clicked = at((e) => e.ev === 'home');
  assert.ok(clicked >= 0 && ev.some((e) => e.ev === 'home' && e.cards.dj === 'starting'), r.out);
  assert.ok(at((e) => e.ev === 'win' && e.kind === 'splash' && e.visible) > clicked, r.out);
  assert.ok(at((e) => e.ev === 'win' && e.kind === 'main' && e.visible) > clicked, r.out);
  assert.equal(ev.find((e) => e.ev === 'state')?.page?.engine, 'live', r.out);
  assert.ok(at((e) => e.ev === 'home' && e.cards.dj === 'open') > clicked, r.out);
  // the home window is still there after the DJ page closed: it is closed last, by the driver, once the card says off
  const djGone = at((e) => e.ev === 'gone' && e.kind === 'main'), homeGone = at((e) => e.ev === 'gone' && e.kind === 'home');
  assert.ok(djGone >= 0 && homeGone > djGone, r.out);
  assert.ok(ev.findLastIndex((e) => e.ev === 'home' && e.cards.dj === 'off') > djGone, r.out);
  assert.ok(await stopped(sc), 'the server the suite started stops with the DJ window');
});
