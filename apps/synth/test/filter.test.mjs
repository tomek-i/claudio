// The filter curve the page draws (lib/filter.mjs): the low-pass's level at each frequency, and a drag on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowpassDb, qOf, dragTo, xOfFreq, yOfDb, RES_DB } from '../lib/filter.mjs';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('the curve: flat below the cutoff, the resonance peak at it, falling 12 dB an octave above', () => {
  near(lowpassDb(50, 2000, 0), 0, 0.1, 'well below the cutoff');
  near(lowpassDb(2000, 2000, qOf(0.5)), 11, 0.1, 'at the cutoff the level is the peak (Q in dB)');
  near(lowpassDb(2000, 2000, qOf(1)), RES_DB, 0.1, 'full resonance');
  const a = lowpassDb(2000, 250, 0), b = lowpassDb(4000, 250, 0);
  near(a - b, 12, 1.5, 'an octave further up is about 12 dB down');
});

test('a drag: across is the cutoff, up is how high the peak goes', () => {
  const peak = { x: xOfFreq(800), y: yOfDb(11) };
  assert.deepEqual(dragTo(peak.x, peak.y), { cutoff: 800, resonance: 0.5 });
  assert.equal(dragTo(0.5, yOfDb(-10)).resonance, 0, 'below 0 dB: no resonance');
  assert.equal(dragTo(0.5, 0).resonance, 1, 'the top: full');
  assert.equal(dragTo(1.2, 0.5).cutoff, 18000, 'held to the parameter\'s range');
  assert.equal(dragTo(-1, 0.5).cutoff, 20);
});
