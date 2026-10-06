// Health report: one check per system, red only for real faults, 'off' for things switched off on purpose.
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
  assert.deepEqual(h.checks.map((c) => c.id), ['server', 'engine', 'library', 'ffmpeg', 'ffprobe', 'ytdlp', 'downloads', 'stems', 'disk']);
  assert.ok(h.checks.every((c) => c.status === 'ok' && c.detail));
});

test('each fault turns its own check red and the report not ok', () => {
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
    const h = buildHealth(s);
    assert.equal(h.ok, false, id);
    assert.deepEqual(h.checks.filter((c) => c.status === 'fail').map((c) => c.id), [id]);
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
});

test('toolVersion: a real binary reports a version line, a missing one is null', async () => {
  assert.match(await toolVersion(process.execPath, ['--version']), /^v\d+/);
  assert.equal(await toolVersion('definitely-not-a-real-binary-xyz'), null);
});
