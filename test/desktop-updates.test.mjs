// The installed app's updates (apps/desktop/updates.mjs), with a stand-in for electron-updater.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, reason, watchUpdates } from '../apps/desktop/updates.mjs';

// emits what electron-updater would for a check that finds `next` (or nothing new, or fails with `fail`)
function fakeUpdater({ next = null, fail = null } = {}) {
  const u = new EventEmitter();
  u.checks = 0; u.installed = null;
  u.checkForUpdates = async () => {
    u.checks++;
    u.emit('checking-for-update');
    if (fail) { u.emit('error', fail); throw fail; }
    if (!next) return u.emit('update-not-available', { version: '0.8.0' });
    u.emit('update-available', { version: next });
    u.emit('download-progress', { percent: 42.7 });
    u.emit('update-downloaded', { version: next });
  };
  u.quitAndInstall = (silent, runAfter) => { u.installed = { silent, runAfter }; };
  return u;
}
const watch = (u) => {
  const seen = [];
  const w = watchUpdates(u, { version: '0.8.0', onChange: (s) => seen.push(s) });
  return { w, seen };
};

test('watchUpdates: a newer release downloads by itself and is ready, with its progress on the way', async () => {
  const u = fakeUpdater({ next: '0.9.0' }), { w, seen } = watch(u);
  assert.equal(u.autoDownload, true);
  assert.equal(u.autoInstallOnAppQuit, true);
  assert.deepEqual(w.state, { status: 'idle', current: '0.8.0' });
  await w.check();
  assert.deepEqual(seen.map((s) => s.status), ['checking', 'downloading', 'downloading', 'ready']);
  assert.equal(seen[2].percent, 42);
  assert.deepEqual(w.state, { status: 'ready', current: '0.8.0', next: '0.9.0' });
});

test('watchUpdates: nothing newer is up to date; a check can be made again', async () => {
  const u = fakeUpdater(), { w } = watch(u);
  await w.check();
  assert.equal(w.state.status, 'latest');
  await w.check();
  assert.equal(u.checks, 2);
});

test('watchUpdates: a failed check says why in a line, and can be tried again', async () => {
  const u = fakeUpdater({ fail: new Error('HttpError: 404 \n"method: GET url: https://github.com/tomek-i/dj-claude/releases.atom"\n\nData:\n …') });
  const { w } = watch(u);
  await w.check();
  assert.equal(w.state.status, 'failed');
  assert.match(w.state.error, /^GitHub has no update to show/);
  await w.check();
  assert.equal(u.checks, 2);
});

test('watchUpdates: no second check while one is under way or the update is in; install only once it is', async () => {
  const u = fakeUpdater({ next: '0.9.0' }), { w } = watch(u);
  w.install();
  assert.equal(u.installed, null);
  await w.check();
  await w.check();
  assert.equal(u.checks, 1);
  w.install();
  assert.deepEqual(u.installed, { silent: true, runAfter: true });
});

test('reason: a 404, no network, anything else as its first line, cut short', () => {
  assert.match(reason(new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404')), /not public/);
  assert.equal(reason(new Error('net::ERR_INTERNET_DISCONNECTED')), 'no connection to GitHub');
  assert.equal(reason(new Error('getaddrinfo ENOTFOUND api.github.com')), 'no connection to GitHub');
  assert.equal(reason(new Error('sha512 checksum mismatch\nexpected …')), 'sha512 checksum mismatch');
  assert.equal(reason(new Error('x'.repeat(300))).length, 120);
  assert.equal(reason(null), 'unknown error');
});

test('describe: a line for each state, and the action only when there is one to take', () => {
  assert.deepEqual(describe({ status: 'idle', current: '0.8.0' }), { text: 'Claudio 0.8.0', action: 'Check for updates' });
  assert.equal(describe({ status: 'checking', current: '0.8.0' }).action, null);
  assert.equal(describe({ status: 'latest', current: '0.8.0' }).text, 'Claudio 0.8.0 is up to date');
  assert.deepEqual(describe({ status: 'downloading', current: '0.8.0', next: '0.9.0', percent: 42 }), { text: 'Downloading Claudio 0.9.0… 42%', action: null });
  assert.equal(describe({ status: 'ready', current: '0.8.0', next: '0.9.0' }).action, 'Restart to update');
  assert.equal(describe({ status: 'failed', current: '0.8.0', error: 'no connection to GitHub' }).text, 'Could not check for updates: no connection to GitHub');
  assert.equal(describe({ status: 'dev', current: '0.8.0' }).action, null);
});
