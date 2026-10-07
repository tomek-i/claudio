// Visuals tap: measures the master output for the /visuals page (level, peak and a 16-band spectrum per block).
// It runs on the audio thread so the engine tab keeps measuring when it is hidden, and so every frame carries the
// time of its audio on the engine's audio clock. Fed from mixer.out by public/ui/visuals-feed.js, only while someone
// is watching. No output: it never touches the sound.
//
// SpectrumTap is the measuring itself, exported so it can be tested without an audio context.

export const BANDS = 16;
const SIZE = 2048;        // analysis window (samples); 23 Hz per bin at 48 kHz, enough to tell a kick from a bassline
const HOP = 1024;         // one frame per hop: about 47 frames a second at 48 kHz
const LO = 30, HI = 16000; // band edges run from LO to HI Hz, evenly spaced in pitch
const FLOOR_DB = -72;     // a band at or below this is 0; a full-scale sine is 255

export class SpectrumTap {
  constructor(sampleRate, { size = SIZE, hop = HOP, bands = BANDS } = {}) {
    this.sr = sampleRate; this.size = size; this.hop = hop; this.bands = bands;
    this.ring = new Float32Array(size); this.at = 0; this.filled = 0;
    this.sumSq = 0; this.peak = 0;
    this.re = new Float32Array(size); this.im = new Float32Array(size);
    this.win = new Float32Array(size);
    let wsum = 0;
    for (let i = 0; i < size; i++) { this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size); wsum += this.win[i]; }
    this.norm = 2 / wsum; // a full-scale sine comes out with magnitude 1
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(size / 2); this.sin = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / size); this.sin[i] = Math.sin((2 * Math.PI * i) / size); }
    // first and last bin of each band (inclusive); a narrow low band still gets the one bin nearest to it
    this.edges = [];
    const top = Math.min(HI, sampleRate / 2 - 1), binHz = sampleRate / size;
    for (let b = 0; b < bands; b++) {
      const f0 = LO * (top / LO) ** (b / bands), f1 = LO * (top / LO) ** ((b + 1) / bands);
      const a = Math.max(1, Math.round(f0 / binHz));
      this.edges.push([a, Math.max(a, Math.round(f1 / binHz) - 1)]);
    }
  }

  // feed n samples of one or two channels; calls done({ l, p, b }, samplesIntoThisCall) once per completed hop
  push(L, R, n, done) {
    for (let i = 0; i < n; i++) {
      const v = R ? 0.5 * (L[i] + R[i]) : L[i];
      const a = Math.max(Math.abs(L[i]), R ? Math.abs(R[i]) : 0);
      if (a > this.peak) this.peak = a;
      this.sumSq += v * v;
      this.ring[this.at] = v; this.at = (this.at + 1) % this.size;
      if (++this.filled === this.hop) { this.filled = 0; done(this.measure(), i + 1); }
    }
  }

  measure() {
    const { size, re, im, ring, win, rev, cos, sin } = this;
    for (let i = 0; i < size; i++) { re[rev[i]] = ring[(this.at + i) % size] * win[i]; im[rev[i]] = 0; }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1, step = size / len;
      for (let s = 0; s < size; s += len) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], d = -sin[k * step], i = s + k, j = i + half;
          const xr = re[j] * c - im[j] * d, xi = re[j] * d + im[j] * c;
          re[j] = re[i] - xr; im[j] = im[i] - xi; re[i] += xr; im[i] += xi;
        }
      }
    }
    const b = new Array(this.bands);
    for (let k = 0; k < this.bands; k++) {
      const [a, z] = this.edges[k];
      let pw = 0;
      for (let i = a; i <= z; i++) pw = Math.max(pw, re[i] * re[i] + im[i] * im[i]);
      const db = 10 * Math.log10(pw * this.norm * this.norm + 1e-12);
      b[k] = Math.round(255 * Math.min(1, Math.max(0, 1 - db / FLOOR_DB)));
    }
    const out = { l: Math.min(1, Math.sqrt(this.sumSq / this.hop)), p: Math.min(1, this.peak), b };
    this.sumSq = 0; this.peak = 0;
    return out;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
  class VisualsTap extends AudioWorkletProcessor {
    constructor() {
      super();
      this.tap = new SpectrumTap(sampleRate);
      this.on = true;
      this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
      this.silent = new Float32Array(128);
    }
    process(inputs) {
      const ch = inputs[0], L = ch?.[0] || this.silent, R = ch?.[1] || null;
      // t: the audio-clock time of the last sample in the hop
      this.tap.push(L, R, L.length, (f, into) => this.port.postMessage({ t: (currentFrame + into) / sampleRate, ...f }));
      return this.on;
    }
  }
  registerProcessor('visuals-tap', VisualsTap);
}
