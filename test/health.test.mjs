// Health report: one check per system, red for a required system that is down, amber for an optional one,
// 'off' for things switched off on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth, toolVersion } from '../lib/health.mjs';

const healthy = () => ({
  port: 4747, uptimeSec: 125, engine: { connected: true, started: true, stale: false },
  library: { tracks: 12, analyzing: 0, queued: 0 }, dirs: [{ dir: '/music', exists: true }, { dir: '/missing', exists: false }],
  ffmpeg: 'ffmpeg version 7', ffprobe: 'ffprobe version 7', ytdlp: '/bin/yt-dlp', jobs: [],
  stems: { enabled: true, available: true, done: 12, total: 12, jobs: [], queued: [], failed: {} }, freeGB: 80, minFreeGB: 3,
});
const byId = (h) => Object.fromEntries(h.checks.map((c) => [c.id, c]));

test('a healthy rig is all green', () => {
  const h = buildHealth(healthy());
  assert.equal(h.ok, true);
  assert.equal(h.level, 'ok');
  assert.deepEqual(h.checks.filter((c) => c.required).map((c) => c.id), ['server', 'engine', 'ffmpeg', 'ffprobe']);
  assert.deepEqual(h.checks.map((c) => c.id), ['server', 'engine', 'library', 'ffmpeg', 'ffprobe', 'ytdlp', 'downloads', 'stems', 'disk']);
  assert.ok(h.checks.every((c) => c.status === 'ok' && c.detail));
});

test('each fault lights its own check: red and not ok for a required system, amber for an optional one', () => {
  const cases = {
    engine: (s) => { s.engine = { connected: false }; },
    library: (s) => { s.dirs = [{ dir: '/missing', exists: false }]; },
    ffmpeg: (s) => { s.ffmpeg = null; },
    ffprobe: (s) => { s.ffprobe = null; },
    ytdlp: (s) => { s.ytdlp = null; },
    downloads: (s) => { s.jobs = [{ status: 'error', error: 'HTTP Error 403' }, { status: 'ready' }]; },
    stems: (s) => { s.stems.available = false; },
    disk: (s) => { s.freeGB = 1.2; },
  };
  for (const [id, breakIt] of Object.entries(cases)) {
    const s = healthy(); breakIt(s);
    const h = buildHealth(s), required = ['engine', 'ffmpeg', 'ffprobe'].includes(id);
    assert.equal(h.ok, !required, id);
    assert.equal(h.level, required ? 'fail' : 'warn', id);
    assert.deepEqual(h.checks.filter((c) => c.status !== 'ok').map((c) => [c.id, c.status]), [[id, required ? 'fail' : 'warn']]);
  }
  const stale = healthy(); stale.engine.stale = true;
  assert.equal(byId(buildHealth(stale)).engine.status, 'fail');
  assert.match(byId(buildHealth({ ...healthy(), jobs: [{ status: 'error', error: 'HTTP Error 403' }] })).downloads.detail, /403/);
});

test('stems switched off is "off", not a fault; an older failed download does not stay red', () => {
  const s = healthy(); s.stems.enabled = false; s.jobs = [{ status: 'ready' }, { status: 'error', error: 'x' }];
  const h = buildHealth(s);
  assert.equal(byId(h).stems.status, 'off');
  assert.equal(byId(h).downloads.status, 'ok');
  assert.equal(h.ok, true);
  assert.equal(h.level, 'ok');
});

test('toolVersion: a real binary reports a version line, a missing one is null', async () => {
  assert.match(await toolVersion(process.execPath, ['--version']), /^v\d+/);
  assert.equal(await toolVersion('definitely-not-a-real-binary-xyz'), null);
});

test('stems say which device separation runs on, once a job has shown it', () => {
  const on = (deviceInUse) => { const s = healthy(); s.stems.deviceInUse = deviceInUse; return byId(buildHealth(s)).stems; };
  assert.match(on('cuda').detail, /12\/12 done · on the GPU \(cuda\)/);
  assert.match(on('cpu').detail, /on the CPU/);
  assert.doesNotMatch(on(null).detail, /GPU|CPU/);
  assert.equal(on('cuda').status, 'ok');
});
