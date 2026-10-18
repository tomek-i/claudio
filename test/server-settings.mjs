// Settings API on a scratch server: save → config.json on disk + live objects updated; bad values change nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startServer, api } from './server-harness.mjs';

const sc = scratch('settings', { port: 4856 });
const srv = await startServer(sc);
after(() => srv.stop());
const onDisk = () => JSON.parse(fs.readFileSync(path.join(sc.dir, 'config.json'), 'utf8'));
const valueOf = (r, key) => r.fields.find((f) => f.key === key).value;

test('GET lists every setting with its current value', async () => {
  const r = await api(sc.base, '/api/settings');
  assert.equal(valueOf(r, 'port'), 4856);
  assert.equal(valueOf(r, 'stems.enabled'), false);
  assert.equal(valueOf(r, 'autoDJ.leadSec'), onDisk().autoDJ?.leadSec ?? 45);
  assert.deepEqual(r.restartPending, []);
});

test('saving writes config.json, applies live settings at once and flags the ones that need a restart', async () => {
  const before = onDisk();
  const r = await api(sc.base, '/api/settings', { 'autoDJ.leadSec': 30, 'stems.concurrency': 3, 'stems.minFreeGB': 7.5, port: 4857 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed.sort(), ['autoDJ.leadSec', 'port', 'stems.concurrency', 'stems.minFreeGB']);
  assert.deepEqual(r.restartPending, ['Port']);
  const cfg = onDisk();
  assert.equal(cfg.autoDJ.leadSec, 30);
  assert.equal(cfg.port, 4857);
  assert.equal(cfg.stems.model, before.stems.model, 'keys outside the schema are kept');
  assert.equal(cfg.deadAirGuard, false);
  const stems = await api(sc.base, '/api/stems');
  assert.equal(stems.concurrency, 3, 'stem queue picked it up without a restart');
  const state = await api(sc.base, '/api/state');
  assert.equal(state.autoDJ.leadSec, 30, 'auto-DJ picked it up without a restart');
  assert.deepEqual((await api(sc.base, '/api/settings')).restartPending, ['Port'], 'still pending on the next visit');
});

test('a bad value is refused with a message and nothing is written', async () => {
  const before = fs.readFileSync(path.join(sc.dir, 'config.json'), 'utf8');
  const res = await fetch(sc.base + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ 'autoDJ.leadSec': 999, 'stems.threads': 4, nope: 1 }) });
  assert.equal(res.status, 400);
  const r = await res.json();
  assert.equal(r.ok, false);
  assert.match(r.errors['autoDJ.leadSec'], /between 10 and 180/);
  assert.ok(r.errors.nope);
  assert.equal(fs.readFileSync(path.join(sc.dir, 'config.json'), 'utf8'), before);
  assert.equal((await api(sc.base, '/api/stems')).threads, onDisk().stems.threads);
});

test('the project folder: where it is, and that only a known thing can be opened', async () => {
  assert.deepEqual(await api(sc.base, '/api/folder'), { root: sc.dir, local: true });
  // (a real `folder` or `claude` would open a window on this machine: reveal.test.mjs covers the commands)
  const bad = await api(sc.base, '/api/folder/open', { what: 'shell' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /folder, claude/);
});

test('GET /api/ping says which app this is, open to the pages of the other apps (their Apps menus)', async () => {
  const res = await fetch(sc.base + '/api/ping');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { app: 'dj', name: 'DJ Claude' });
});
