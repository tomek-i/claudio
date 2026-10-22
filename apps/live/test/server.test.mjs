// Claudel's server on its own port: the page, its script and libraries, the theme, and nothing outside them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createServer } from '../server.mjs';
import { healthOf } from '../lib/health.mjs';
import { APP_NAME } from '../lib/app.mjs';

const PORT = 4867;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(() => new Promise((resolve) => { server = createServer(); server.listen(PORT, '127.0.0.1', resolve); }));
after(() => new Promise((resolve) => server.close(resolve)));

test('the page, with its name, its script, the theme and the Apps menu', async () => {
  const page = await (await fetch(BASE + '/')).text();
  assert.match(page, new RegExp(`<title>${APP_NAME}</title>`));
  assert.match(page, /<textarea id="code"[^]*src="app.js"/);
  assert.match(page, /id="appsBtn"/);
  assert.match(page, /<select id="examples"/);
  assert.match(await (await fetch(BASE + '/app.js')).text(), /parseBlocks/);
  assert.match(await (await fetch(BASE + '/engine.js')).text(), /export class Rig/);
  assert.match(await (await fetch(BASE + '/theme/theme.css')).text(), /--mono/);
  assert.equal((await fetch(BASE + '/theme/fonts/jetbrains-mono.woff2')).headers.get('content-type'), 'font/woff2');
});

test('the libraries the page imports', async () => {
  assert.match(await (await fetch(BASE + '/lib/pattern.mjs')).text(), /export function parseBlocks/);
  assert.match(await (await fetch(BASE + '/lib/live.mjs')).text(), /export class Loop/);
  for (const lib of ['kit', 'presets', 'notes', 'examples']) assert.equal((await fetch(`${BASE}/lib/${lib}.mjs`)).status, 200, lib);
});

test('it says which app it is, to the other apps', async () => {
  const res = await fetch(BASE + '/api/ping');
  assert.deepEqual(await res.json(), { app: 'live', name: APP_NAME });
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('nothing outside the page and the libraries', async () => {
  assert.equal((await fetch(BASE + '/lib/../server.mjs')).status, 404);
  assert.equal((await fetch(BASE + '/nothing.js')).status, 404);
  assert.equal((await fetch(BASE + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(BASE + '/api/ping', { method: 'POST' })).status, 404);
});

test('its health: the server and the page files, ok; a folder without them is a fail', async () => {
  const { checks } = await (await fetch(BASE + '/api/health')).json();
  assert.deepEqual(checks.map((c) => [c.id, c.status, c.required]), [['server', 'ok', true], ['page', 'ok', true]]);
  assert.match(checks[0].detail, new RegExp(`port ${PORT}`));
  const bad = healthOf({ port: PORT, since: Date.now(), root: os.tmpdir() }).checks[1];
  assert.equal(bad.status, 'fail');
  assert.match(bad.detail, /missing: public\/index.html, lib\/pattern.mjs/);
});
