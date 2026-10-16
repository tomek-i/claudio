// The filter's curve: how loud each frequency comes through the voices' low-pass (a Web Audio BiquadFilterNode of
// type 'lowpass', whose Q is the height of its peak in dB). The page draws it and drags it; the numbers are the
// Web Audio specification's, so the curve is what is heard.
export const RES_DB = 22;                  // resonance 1 → a 22 dB peak (engine.js sets Q from the same number)
export const qOf = (resonance) => resonance * RES_DB;

// the level in dB at `freq` of a low-pass at `cutoff` with a peak of `qDb`, at sample rate `sr`
export function lowpassDb(freq, cutoff, qDb, sr = 48000) {
  const nyquist = sr / 2;
  const f0 = Math.min(cutoff, nyquist * 0.999);
  const w0 = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w0) / (2 * 10 ** (qDb / 20));
  const cos = Math.cos(w0);
  const b0 = (1 - cos) / 2, b1 = 1 - cos, b2 = b0;
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  // |H(e^jw)| at the frequency asked about
  const w = (2 * Math.PI * Math.min(freq, nyquist)) / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
}

// the drawing's scale: frequency across (log, 20 Hz to 20 kHz), level up (dB)
export const CURVE = { fLow: 20, fHigh: 20000, dbLow: -36, dbHigh: 26 };
export const xOfFreq = (f) => Math.log(f / CURVE.fLow) / Math.log(CURVE.fHigh / CURVE.fLow);
export const freqOfX = (x) => CURVE.fLow * (CURVE.fHigh / CURVE.fLow) ** Math.min(1, Math.max(0, x));
export const yOfDb = (db) => (CURVE.dbHigh - Math.min(CURVE.dbHigh, Math.max(CURVE.dbLow, db))) / (CURVE.dbHigh - CURVE.dbLow);
export const dbOfY = (y) => CURVE.dbHigh - Math.min(1, Math.max(0, y)) * (CURVE.dbHigh - CURVE.dbLow);

// A point dragged on the drawing (x, y from 0 to 1, top left 0): the cutoff is where it is across, and the
// resonance makes the peak as high as it is (a point at 0 dB or lower is no resonance).
export function dragTo(x, y, { min = 20, max = 18000 } = {}) {
  return {
    cutoff: Math.round(Math.min(max, Math.max(min, freqOfX(x)))),
    resonance: Math.round(Math.min(1, Math.max(0, dbOfY(y) / RES_DB)) * 100) / 100,
  };
}
