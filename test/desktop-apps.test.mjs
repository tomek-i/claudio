// apps.mjs: what Claudio, the desktop suite, knows of its four apps, and tools/move-to-claudio.mjs. Plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APPS, appById, appFromArgs, appOfUrl, originOf, pingUrl, portOf, serverEnv, serverFile } from '../apps/desktop/apps.mjs';
import { moveToClaudio } from '../tools/move-to-claudio.mjs';
import { OWN_STEPS } from '../apps/desktop/startup.mjs';

test('APPS: the four, each with a server file that is there', () => {
  assert.deepEqual(APPS.map((a) => a.id), ['dj', 'drums', 'synth', 'daw', 'live']);
  for (const a of APPS) assert.ok(fs.existsSync(serverFile(a)), serverFile(a));
  assert.equal(appById('synth').name, 'MiniClaude');
  assert.equal(appById('nope'), null);
});

test('portOf: the app\'s own variable, then (DJ Claude only) config.json, then its usual port', () => {
  assert.equal(portOf(appById('dj'), { env: {}, config: {} }), 4747);
  assert.equal(portOf(appById('dj'), { env: {}, config: { port: 5000 } }), 5000);
  assert.equal(portOf(appById('dj'), { env: { DJ_PORT: '5001' }, config: { port: 5000 } }), 5001);
  assert.equal(portOf(appById('drums'), { env: {}, config: { port: 5000 } }), 4748, 'config.json is DJ Claude\'s');
  assert.equal(portOf(appById('drums'), { env: { CL808_PORT: '4999' } }), 4999);
  assert.equal(originOf(appById('daw'), { env: {} }), 'http://localhost:4750');
});

test('serverEnv: the port, and for the other apps where to keep their things (data/<id>), unless already set', () => {
  const data = path.join('x', 'data');
  const dj = serverEnv(appById('dj'), { env: { PATH: 'p' }, config: { port: 4800 }, dataDir: data });
  assert.equal(dj.DJ_PORT, '4800'); assert.equal(dj.PATH, 'p');
  const synth = serverEnv(appById('synth'), { env: {}, dataDir: data });
  assert.equal(synth.MINICLAUDE_PORT, '4749'); assert.equal(synth.MINICLAUDE_HOME, path.join(data, 'synth'));
  assert.equal(serverEnv(appById('synth'), { env: { MINICLAUDE_HOME: '/mine' }, dataDir: data }).MINICLAUDE_HOME, '/mine');
});

// main.mjs waits on pingUrl after starting a server; Claudel once never answered it, so its window never opened.
// Then it lists the server's /api/health on the start-up window, where a check named as one of its own lines would be
// written over (Claudel's "Page files" once was, by "Page"). DJ Claude's server is left out: it is slow to start, and
// the desktop start-up test opens it.
test('pingUrl and /api/health: every other app\'s server answers both; no check is named as a line of the start-up window (ports 4872-4875)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-ping-'));
  const others = APPS.filter((a) => a.id !== 'dj');
  const kids = [];
  try {
    for (const [i, a] of others.entries()) {
      const env = serverEnv(a, { env: { ...process.env, [a.portEnv]: String(4872 + i) }, dataDir: tmp });
      const opts = { env };
      kids.push(spawn(process.execPath, [serverFile(a)], { env, stdio: 'ignore' }));
      let ok = false;
      for (let t = 0; t < 50 && !ok; t++) {
        await new Promise((r) => setTimeout(r, 100));
        try { ok = (await fetch(pingUrl(a, opts))).ok; } catch { /* not up yet */ }
      }
      assert.ok(ok, `${a.name} answers ${pingUrl(a, opts)}`);
      assert.equal((await (await fetch(pingUrl(a, opts))).json()).app, a.id);
      const { checks } = await (await fetch(`${originOf(a, opts)}/api/health`)).json();
      for (const c of checks) assert.ok(c.id === 'server' || !OWN_STEPS.includes(c.id), `${a.name}: check "${c.id}"`);
    }
  } finally {
    for (const k of kids) k.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('appOfUrl: a page of one of the apps, by its origin; anything else is none of them', () => {
  const env = { env: {}, config: {} };
  assert.equal(appOfUrl('http://localhost:4747/settings', env).id, 'dj');
  assert.equal(appOfUrl('http://localhost:4750/', env).id, 'daw');
  assert.equal(appOfUrl('http://localhost:4751/', env).id, 'live');
  assert.equal(appOfUrl('http://localhost:4752/', env), null);
  assert.equal(appOfUrl('https://github.com', env), null);
  assert.equal(appOfUrl('not a url', env), null);
});

test('appFromArgs: --app <id> and --app=<id>; an unknown one or none is null', () => {
  assert.equal(appFromArgs(['electron', 'main.mjs', '--app', 'synth']), 'synth');
  assert.equal(appFromArgs(['electron', '--app=dj']), 'dj');
  assert.equal(appFromArgs(['electron', '--app=nope']), null);
  assert.equal(appFromArgs(['electron', 'main.mjs']), null);
});

test('moveToClaudio: the folder moves, is laid out with data/, and its build stamp goes; a Claudio already there is left alone', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-claudio-'));
  const from = path.join(tmp, 'DJ Claude'), to = path.join(tmp, 'Claudio');
  const put = (f, body) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); };
  try {
    assert.throws(() => moveToClaudio(from, to), /not a DJ Claude folder/);
    put(path.join(from, 'config.json'), '{"libraryDirs":["./library"]}');
    put(path.join(from, 'library', 'a.mp3'), 'music');
    put(path.join(from, '.dj', 'app-build'), '0.6.0 1');
    put(path.join(to, 'keep.txt'), 'there already');
    assert.throws(() => moveToClaudio(from, to), /is there already/);
    assert.ok(fs.existsSync(from), 'nothing was changed');
    fs.rmSync(to, { recursive: true });

    const r = moveToClaudio(from, to);
    assert.ok(!fs.existsSync(from));
    assert.equal(fs.readFileSync(path.join(to, 'data', 'dj', 'library', 'a.mp3'), 'utf8'), 'music');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).libraryDirs, ['./data/dj/library']);
    assert.ok(!fs.existsSync(path.join(to, 'data', 'claudio', 'app-build')) && !fs.existsSync(path.join(to, '.dj')), 'the new build writes its files in again');
    assert.deepEqual(r.problems, []);
    fs.rmSync(to, { recursive: true });

    // a folder already laid out with data/, from when the desktop app's own was data/desktop
    put(path.join(from, 'config.json'), '{}');
    put(path.join(from, 'data', 'desktop', 'window-dj.json'), '{"maximized":true}');
    put(path.join(from, 'data', 'desktop', 'app-build'), '0.6.0 1');
    moveToClaudio(from, to);
    assert.ok(!fs.existsSync(path.join(to, 'data', 'desktop')));
    assert.equal(fs.readFileSync(path.join(to, 'data', 'claudio', 'window-dj.json'), 'utf8'), '{"maximized":true}');
    assert.ok(!fs.existsSync(path.join(to, 'data', 'claudio', 'app-build')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
