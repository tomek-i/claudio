// The /visuals page's optional sound: plays the set's master output, relayed by the server as one long WebM
// stream (lib/visuals.mjs). Off until the viewer turns it on.
//
// `time()` is the moment of the set that is coming out of the speakers now, on the engine's audio clock: the clock
// the analysis frames are stamped with. The feed draws the frame for exactly that moment, which keeps picture and
// sound together however far behind the decks this viewer is.
//
// Where the sound is, is measured, not assumed. The stream goes through a MediaSource, which keeps its own
// timestamps, and the server says where that timeline starts on the engine's clock (t0): that is the first guess.
// But a recording's timeline does not run at exactly the rate of the audio clock (0.3 % apart was measured, which is
// over half a second after a few minutes), so the guess is corrected all the time from the sound itself: the loudness
// of what is being played is compared with the loudness in the analysis frames, and the shift that makes the two
// line up best is the real offset. See `Sync` below.
const MIME = 'audio/webm;codecs=opus';
const BEHIND_MAX = 2.5;   // seconds of sound waiting to be played before the player skips ahead
const BEHIND_AIM = 0.5;   // where it skips to: this much before the newest sound

// Finds how far a guess of "which moment is playing" is from the truth, by lining up two loudness curves: the one
// heard here (a sample per drawn frame, each with the guessed time) and the one in the analysis frames (levelAt).
export class Sync {
  constructor({ windowSec = 6, everySec = 1.5 } = {}) {
    this.windowSec = windowSec; this.everySec = everySec;
    this.reset();
  }
  reset() {
    this.samples = [];    // [guessed engine time, loudness heard]
    this.shift = 0;       // what to add to the guess, eased towards `target`
    this.target = null;   // the last measured shift; null until the first lock
    this.quality = 0;     // how well the curves matched at that shift (correlation, 0..1)
    this.lastAt = -Infinity;
    this.rate = 0;        // how fast the shift itself is changing (seconds per second): the two clocks' difference in rate
    this.base = null;     // the last measurement: { shift, at } where `at` is the middle of the samples it was made from
  }

  add(guess, loud, levelAt, dt) {
    const s = this.samples;
    s.push([guess, loud]);
    while (s.length && guess - s[0][0] > this.windowSec) s.shift();
    if (guess - this.lastAt >= this.everySec && s.length > 60) { this.lastAt = guess; this.measure(levelAt); }
    // a measurement is the average over its samples, so it is already old; the drift rate carries it up to now
    if (this.base) this.target = this.base.shift + this.rate * (guess - this.base.at);
    if (this.target != null) {
      // the first lock is taken at once; after that the picture slides to a new value instead of jumping
      const gap = this.target - this.shift;
      this.shift = Math.abs(gap) > 0.25 ? this.target : this.shift + gap * Math.min(1, dt / 0.8);
    }
    return this.shift;
  }

  match(lag, levelAt) {
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (const [t, a] of this.samples) {
      const b = levelAt(t + lag);
      if (b == null) continue;
      n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
    if (n < 60) return -1;
    const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    return va > 1e-7 && vb > 1e-7 ? (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb) : -1; // silence matches nothing
  }

  measure(levelAt) {
    // look near the last answer; with none yet, or when that stops matching, look wide
    const near = this.target != null && this.match(this.target, levelAt) > 0.3;
    const mid = this.target ?? 0, span = near ? 0.2 : 2;
    let best = null, top = -1, score = -Infinity;
    for (let lag = mid - span; lag <= mid + span + 1e-9; lag += 0.01) {
      // dance music repeats every beat, so shifts a beat apart match almost as well: of those, the one nearest to
      // what was expected (the stream's own timeline at first, the last answer after that) is the right one
      const r = this.match(lag, levelAt), sc = r - 0.1 * Math.abs(lag - mid);
      if (sc > score) { score = sc; top = r; best = lag; }
    }
    if (best == null || top < 0.35) return;
    for (let lag = best - 0.008; lag <= best + 0.0081; lag += 0.002) { const r = this.match(lag, levelAt); if (r > top) { top = r; best = lag; } }
    const s = this.samples, at = (s[0][0] + s[s.length - 1][0]) / 2;
    if (near && this.base && at - this.base.at > 0.5) {
      const rate = Math.max(-0.01, Math.min(0.01, (best - this.base.shift) / (at - this.base.at)));
      this.rate += (rate - this.rate) * 0.25;
    } else if (!near) this.rate = 0; // a jump is not a drift
    this.base = { shift: best, at };
    this.target = best + this.rate * (s[s.length - 1][0] - at); this.quality = top;
  }
}

export class Listener {
  constructor({ url = '/api/visuals/audio', levelAt = () => null, onState = () => {} } = {}) {
    this.url = url; this.onState = onState;
    this.levelAt = levelAt;   // (engine time) => the level in the analysis frames at that moment, or null
    this.sync = new Sync();
    this.wanted = false; this.state = 'off'; // off | connecting | playing | waiting (the stream dropped; joining again)
    this.audio = new Audio(); this.audio.preload = 'auto';
    this.volume = 1; this.muted = false;
    this.t0 = null; this.est = null; this.estAt = 0;
  }

  static supported() { return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MIME); }

  // the sound passes through a meter on its way out (for Sync); volume and mute come after it, so a muted viewer
  // stays in step
  wire() {
    if (this.ctx) return this.ctx.resume();
    const ctx = this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.meter = Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
    this.gain = ctx.createGain();
    ctx.createMediaElementSource(this.audio).connect(this.meter).connect(this.gain).connect(ctx.destination);
    this.buf = new Float32Array(this.meter.fftSize);
    this.applyGain();
    return ctx.resume();
  }
  applyGain() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume; }

  set(state) { if (state !== this.state) { this.state = state; this.onState(state); } }
  setVolume(v) { this.volume = Math.min(1, Math.max(0, v)); this.applyGain(); }
  setMuted(m) { this.muted = !!m; this.applyGain(); }

  // call from a click or a key press: browsers only start sound on a gesture
  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.wire();
    this.join();
  }
  stop() {
    this.wanted = false;
    this.leave();
    this.set('off');
  }
  leave() {
    this.ctrl?.abort(); this.ctrl = null;
    clearTimeout(this.retry);
    this.audio.pause();
    if (this.audio.src) { URL.revokeObjectURL(this.audio.src); this.audio.removeAttribute('src'); this.audio.load(); }
    this.t0 = null; this.est = null; this.sync.reset();
  }

  async join() {
    this.leave();
    if (!this.wanted) return;
    this.set(this.state === 'off' ? 'connecting' : 'waiting');
    const ctrl = this.ctrl = new AbortController(), audio = this.audio;
    const again = () => { if (this.ctrl === ctrl && this.wanted) { this.set('waiting'); this.t0 = null; this.retry = setTimeout(() => this.join(), 1500); } };
    try {
      const ms = new MediaSource();
      audio.src = URL.createObjectURL(ms);
      await new Promise((ok) => ms.addEventListener('sourceopen', ok, { once: true }));
      const sb = ms.addSourceBuffer(MIME);
      const res = await fetch(this.url, { signal: ctrl.signal });
      if (res.status === 403) { this.wanted = false; this.leave(); return this.set('off'); } // switched off on the server
      if (!res.ok || !res.body) return again();
      const t0 = Number(res.headers.get('x-audio-t0'));
      const reader = res.body.getReader();
      const idle = () => (sb.updating ? new Promise((ok) => sb.addEventListener('updateend', ok, { once: true })) : null);
      let started = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done || this.ctrl !== ctrl) break;
        await idle();
        sb.appendBuffer(value);
        await idle();
        if (!sb.buffered.length) continue;
        const end = sb.buffered.end(sb.buffered.length - 1);
        if (!started) {
          started = true;
          audio.currentTime = sb.buffered.start(0);
          audio.preservesPitch = false; audio.playbackRate = 1; this.waiting = null;
          await audio.play();
          this.t0 = t0; this.est = null; this.sync.reset();
          this.set('playing');
        } else if (end - audio.currentTime > BEHIND_MAX) {
          audio.currentTime = end - BEHIND_AIM; this.est = null; this.sync.samples = []; // fell behind (a stall, a sleeping tab): catch up
        } else {
          // this device's audio clock and the engine's never run at quite the same rate, so the sound waiting to be
          // played slowly grows or runs dry. Playing a touch faster or slower (at most 1.5 %, pitch moving with it:
          // a quarter of a semitone at the very most) holds it steady, with no skip to hear.
          this.waiting = this.waiting == null ? end - audio.currentTime : this.waiting + (end - audio.currentTime - this.waiting) * 0.05;
          audio.playbackRate = Math.min(1.015, Math.max(0.985, 1 + (this.waiting - BEHIND_AIM) * 0.03));
        }
        // what has been played is not kept
        if (audio.currentTime - sb.buffered.start(0) > 30) { await idle(); sb.remove(0, audio.currentTime - 10); }
      }
    } catch (e) { if (e?.name === 'AbortError') return; }
    again();
  }

  // The engine audio time being heard now, or null when nothing is playing. Call once per drawn frame: each call
  // also takes a loudness sample for Sync. The player's own position moves in steps, so it is followed by a clock
  // that runs smoothly and is pulled gently towards it.
  time(now = performance.now()) {
    const a = this.audio;
    if (this.state !== 'playing' || this.t0 == null || a.paused || a.readyState < 3) { this.est = null; return null; }
    const pos = a.currentTime, dt = this.est == null ? 0 : (now - this.estAt) / 1000;
    if (this.est == null || Math.abs(pos - this.est) > 0.15) this.est = pos;
    else { this.est += dt * a.playbackRate; this.est += (pos - this.est) * 0.04; }
    this.estAt = now;
    const guess = this.t0 + this.est;
    this.meter.getFloatTimeDomainData(this.buf);
    let sum = 0; for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const shift = this.sync.add(guess, Math.sqrt(sum / this.buf.length), this.levelAt, dt);
    // what the meter hears now leaves the speakers one output delay later; the picture is for what is heard
    this.heard = guess + shift - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    return this.heard;
  }

  get locked() { return this.sync.target != null; }
}
