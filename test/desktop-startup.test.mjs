// startup.mjs: which of an app's /api/health checks its start-up window lists. Plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appById } from '../apps/desktop/apps.mjs';
import { pendingSteps, stepsOf } from '../apps/desktop/startup.mjs';

const check = (id, status, detail = '') => ({ id, name: id, status, detail });

test('DJ Claude: the library and the two tools always, an optional system only on a fault; versions short', () => {
  const dj = appById('dj');
  assert.deepEqual(pendingSteps(dj).map((s) => s.id), ['library', 'ffmpeg', 'ffprobe']);
  const { steps, down } = stepsOf(dj, [
    check('server', 'ok'), check('engine', 'fail'), check('library', 'ok', '12 tracks'),
    check('ffmpeg', 'ok', 'ffmpeg version 7.1-full_build Copyright'), check('ffprobe', 'ok', 'ffprobe version 7.1'),
    check('stems', 'ok'), check('ytdlp', 'warn', 'not installed yet'), check('visuals', 'off'),
  ]);
  assert.deepEqual(steps.map((s) => [s.id, s.state, s.detail]), [['library', 'ok', '12 tracks'], ['ffmpeg', 'ok', '7.1'], ['ffprobe', 'ok', '7.1'], ['ytdlp', 'warn', 'not installed yet']]);
  assert.equal(down, false, 'the engine is judged on its own line, not here');
  assert.equal(stepsOf(dj, [check('ffmpeg', 'fail', 'not on PATH')]).down, true);
});

test('another app: every check but the server, nothing pending; a failed one is down', () => {
  const drums = appById('drums');
  assert.deepEqual(pendingSteps(drums), []);
  const ok = stepsOf(drums, [check('server', 'ok'), check('data', 'ok', '/data/drums')]);
  assert.deepEqual(ok, { steps: [{ id: 'data', name: 'data', state: 'ok', detail: '/data/drums' }], down: false });
  const bad = stepsOf(appById('live'), [check('server', 'ok'), check('page', 'fail', 'missing: public/index.html')]);
  assert.equal(bad.down, true);
  assert.equal(bad.steps[0].state, 'fail');
});
