// The master limiter (LimiterCore in apps/web/public/worklets/deck-player.js): below the ceiling nothing changes,
// nothing ever goes over it, the gain comes down ahead of a peak (no click) and goes back up with the release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LimiterCore } from '../apps/web/public/worklets/deck-player.js';

const SR = 48000, CEIL = Math.pow(10, -1 / 20);
// run a signal (two Float32Arrays) through in 128-sample blocks, as the worklet does
function run(lim, L, R = L) {
  const n = L.length, oL = new Float32Array(n), oR = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const e = Math.min(n, i + 128);
    lim.process([L.subarray(i, e), R.subarray(i, e)], [oL.subarray(i, e), oR.subarray(i, e)]);
  }
  return [oL, oR];
}
const sine = (sec, amp, f = 220) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const peak = (x, a = 0, b = x.length) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i])); return m; };

test('below the ceiling the signal comes out unchanged, only later by the look-ahead', () => {
  const lim = new LimiterCore(SR), x = sine(0.5, 0.5);
  const [y] = run(lim, x);
  const d = lim.look;
  assert.equal(d, 72, '1.5 ms at 48 kHz');
  for (let i = d; i < x.length; i++) assert.ok(Math.abs(y[i] - x[i - d]) < 1e-6, `sample ${i}`);
  assert.equal(lim.gainReduction(), 0);
});

test('a loud signal never goes over the ceiling, and is held at it', () => {
  const lim = new LimiterCore(SR), x = sine(1, 2.0);
  const [y] = run(lim, x);
  assert.ok(peak(y) <= CEIL + 1e-6, `peak ${peak(y)} vs ceiling ${CEIL}`);
  const tail = peak(y, SR / 2);
  assert.ok(tail > CEIL * 0.97, `sustained, it sits at the ceiling: ${tail}`);
  const gr = lim.gainReduction();
  assert.ok(Math.abs(gr - (20 * Math.log10(2 / CEIL))) < 0.3, `reports about 7 dB taken off: ${gr}`);
});

test('a lone spike: caught, with the gain coming down before it (no step), and back up afterwards', () => {
  const lim = new LimiterCore(SR);
  const x = sine(1, 0.3);
  x[SR / 2] = 4.0; // one sample, far over
  const [y] = run(lim, x);
  assert.ok(peak(y) <= CEIL + 1e-6, `the spike is caught: ${peak(y)}`);
  // the gain went down over the look-ahead: around the spike neighbouring samples change smoothly
  const at = SR / 2 + lim.look;
  let jump = 0;
  for (let i = at - 2 * lim.look; i < at - 1; i++) jump = Math.max(jump, Math.abs(y[i + 1] - y[i]) - Math.abs(x[i + 1 - lim.look] - x[i - lim.look]) * 1.01);
  assert.ok(jump < 0.02, `no click on the way down: ${jump}`);
  // and back up: 0.4 s later the quiet sine is whole again
  const late = peak(y, at + Math.round(SR * 0.4), at + Math.round(SR * 0.45));
  assert.ok(late > 0.3 * 0.98, `released: ${late}`);
});

test('the two sides move together: a peak on the left turns the right down as much', () => {
  const lim = new LimiterCore(SR), L = sine(0.5, 2.0), R = sine(0.5, 0.2);
  const [, yR] = run(lim, L, R);
  const r = peak(yR, SR / 4);
  assert.ok(Math.abs(r - 0.2 * CEIL / 2.0) < 0.01, `right turned down with the left: ${r}`);
});
