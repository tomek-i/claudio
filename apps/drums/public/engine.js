// The sound. A Kit makes the eight voices out of oscillators and noise on any audio context, each the way the
// TR-808 makes it (the frequencies below are that machine's); the Engine plays
// a pattern on the live one with a look-ahead scheduler; renderWav() plays it on an offline one. Both ask
// lib/timing.mjs where each hit goes, so what is exported is what was heard.
import { hitsInWindow, stepSeconds, MAX_EARLY } from '/lib/timing.mjs';

const LOOKAHEAD = 0.1;      // seconds of hits scheduled ahead of the clock
const TICK_MS = 25;
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];   // the 808's six square waves that are not in tune: hats and cowbell

export class Kit {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -10; glue.ratio.value = 3; glue.attack.value = 0.005; glue.release.value = 0.12;
    this.out.connect(glue).connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 22222;                                  // the same noise every time, so two renders are the same file
    for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
    this.noiseBuffer = noise;
    this.openHat = null;
    this.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 511.5 - 1) * 2.2) / Math.tanh(2.2));
  }

  // soft clipping, as an overdriven output stage does: a loud kick gets its weight from it
  drive(into) {
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.curve;
    shaper.connect(into);
    return shaper;
  }

  // a gain with a spike at the start and a longer tail after it
  twoStage(time, peak, spike, tail, into = this.out) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, peak), time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.35), time + spike);
    g.gain.exponentialRampToValueAtTime(0.0001, time + spike + tail);
    g.connect(into);
    return g;
  }

  // a gain that goes to `peak` at once and dies away over `decay` seconds
  env(time, peak, decay, attack = 0.001) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    g.connect(this.out);
    return g;
  }

  osc(type, freq, time, stop, into) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.connect(into);
    o.start(time);
    o.stop(stop);
    return o;
  }

  noise(time, stop, into) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    n.connect(into);
    n.start(time, (time * 0.37) % 0.9);
    n.stop(stop);
    return n;
  }

  filter(type, freq, q, into) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.connect(into);
    return f;
  }

  // one hit: { voice, vel, level, tune } at `time` seconds on this kit's context
  trigger(hit, time) {
    const amp = hit.vel ** 1.6 * (hit.level ?? 0.8) * 1.25;
    const pitch = 2 ** ((hit.tune || 0) / 12);
    const bright = 0.6 + 0.4 * hit.vel;                // a harder hit is a brighter one
    switch (hit.voice) {
      case 'kick': {                                   // a resonator near 50 Hz, kicked: the pitch falls into it, then the long boom
        const push = this.ctx.createGain();            // a harder kick is driven further into the clipping
        push.gain.value = 0.55 + 0.6 * hit.vel;
        push.connect(this.drive(this.env(time, amp * 1.1, 0.5 + 0.5 * hit.vel)));
        const o = this.osc('sine', 130 * pitch, time, time + 1.1, push);
        o.frequency.exponentialRampToValueAtTime(50 * pitch, time + 0.045);
        this.noise(time, time + 0.01, this.filter('lowpass', 2500 * bright, 0.5, this.env(time, amp * 0.3, 0.006)));   // the click
        break;
      }
      case 'snare': {                                  // two resonators an octave apart, and the "snappy": high-passed noise
        this.osc('sine', 238 * pitch, time, time + 0.25, this.env(time, amp * 0.7, 0.13));
        this.osc('sine', 476 * pitch, time, time + 0.15, this.env(time, amp * 0.3, 0.07));
        this.noise(time, time + 0.3, this.filter('highpass', 1800, 0.7, this.filter('lowpass', 9000 * bright, 0.5, this.env(time, amp * 0.9, 0.18))));
        break;
      }
      case 'clap': {                                   // noise around 1 kHz: three quick bursts, then a short room
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        for (const at of [0, 0.01, 0.02]) {
          g.gain.setValueAtTime(amp * 1.7, time + at);
          g.gain.exponentialRampToValueAtTime(amp * 0.25, time + at + 0.009);
        }
        g.gain.setValueAtTime(amp * 1.4, time + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
        g.connect(this.out);
        this.noise(time, time + 0.32, this.filter('bandpass', 1000 * pitch, 2.2, this.filter('highpass', 500, 0.5, g)));
        break;
      }
      case 'hat':
      case 'open': {                                   // the six squares through two band-passes: a buzz of metal, short or ringing
        const open = hit.voice === 'open';
        const decay = open ? 0.42 : 0.04;
        const g = this.env(time, amp * 1.1, decay);
        const high = this.filter('highpass', 7000 * bright, 0.7, g);
        const bands = [this.filter('bandpass', 3440 * pitch, 2.5, high), this.filter('bandpass', 7100 * pitch, 2.5, high)];
        for (const freq of METAL) {
          const o = this.osc('square', freq * pitch, time, time + decay + 0.05, bands[0]);
          o.connect(bands[1]);
        }
        if (this.openHat) {                            // a hat closes the open hat that is ringing
          this.openHat.gain.cancelScheduledValues(time);
          this.openHat.gain.setTargetAtTime(0.0001, time, 0.008);
        }
        this.openHat = open ? g : null;
        break;
      }
      case 'tom': {                                    // a resonator that sags as it rings, with a breath of noise
        const o = this.osc('sine', 175 * pitch, time, time + 0.5, this.env(time, amp * 0.9, 0.34));
        o.frequency.exponentialRampToValueAtTime(120 * pitch, time + 0.22);
        this.noise(time, time + 0.12, this.filter('lowpass', 900, 0.5, this.env(time, amp * 0.1, 0.09)));
        break;
      }
      case 'rim': {                                    // two short resonators far apart, clipped: a click with a pitch
        const g = this.drive(this.filter('highpass', 400, 0.7, this.env(time, amp * 0.55, 0.012)));
        this.osc('sine', 1667 * pitch, time, time + 0.03, g);
        this.osc('sine', 455 * pitch, time, time + 0.03, g);
        break;
      }
      case 'bell': {                                   // two of the squares, band-passed: a knock, then the ring
        const g = this.filter('bandpass', 2640 * pitch, 1.4, this.twoStage(time, amp * 0.55, 0.018, 0.32));
        this.osc('square', 540 * pitch, time, time + 0.4, g);
        this.osc('square', 800 * pitch, time, time + 0.4, g);
        break;
      }
    }
  }
}

export class Engine {
  // source(): the pattern to play right now, asked on every tick, so an edit is heard on the next hit
  constructor(source) {
    this.source = source;
    this.playing = false;
    this.onHit = null;
  }

  wake() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.kit = new Kit(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // from: the step to start on (0 is the top of the loop). Called while it plays, it moves the playhead there.
  start(from = 0) {
    this.wake();
    // hits already handed to the audio clock cannot be taken back, so a jump waits for them (at most the
    // look-ahead): none is heard on top of the new start, and none is cut
    const busyUntil = this.playing ? this.anchorTime + (this.scheduled - this.anchorPos) * stepSeconds(this.bpm) : 0;
    clearInterval(this.timer);
    this.bpm = this.source().bpm;
    this.anchorTime = Math.max(this.ctx.currentTime + 0.08, busyUntil);   // where position `anchorPos` is on the clock
    this.anchorPos = from;
    this.startStep = from;                             // the steps before it are not played (see hitsInWindow)
    this.scheduled = from - MAX_EARLY;                 // hits before this position are already on their way
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
  }

  // where the playhead is, in steps from the top of the first loop (it waits on the start step until the sound does)
  position() {
    return this.playing ? Math.max(this.anchorPos, this.anchorPos + (this.ctx.currentTime - this.anchorTime) / stepSeconds(this.bpm)) : 0;
  }

  tick() {
    const pattern = this.source();
    const now = this.ctx.currentTime;
    if (pattern.bpm !== this.bpm) {                    // a new tempo takes over from where the playhead is
      this.anchorPos = Math.max(this.anchorPos, this.position());
      this.anchorTime = Math.max(now, this.anchorTime);
      this.bpm = pattern.bpm;
    }
    const step = stepSeconds(this.bpm);
    const until = this.anchorPos + (now + LOOKAHEAD - this.anchorTime) / step;
    if (until <= this.scheduled) return;
    for (const hit of hitsInWindow(pattern, this.scheduled, until, { firstStep: this.startStep })) {
      this.kit.trigger(hit, Math.max(now, this.anchorTime + (hit.pos - this.anchorPos) * step));
    }
    this.scheduled = until;
  }

  // a voice by hand: the row's name, a number key
  tap(voice, track) {
    this.wake();
    this.kit.trigger({ voice, vel: 0.9, level: track?.level, tune: track?.tune }, this.ctx.currentTime + 0.005);
  }
}

// The pattern played `loops` times on an offline context, as a 16-bit stereo WAV file.
export async function renderWav(pattern, loops = 2, sampleRate = 44100) {
  const step = stepSeconds(pattern.bpm);
  const seconds = loops * pattern.steps * step + 1.2;  // and room for the last hits to ring out
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const kit = new Kit(ctx);
  for (const hit of hitsInWindow(pattern, -1, loops * pattern.steps + 1, { lastLoop: loops - 1 })) kit.trigger(hit, Math.max(0, hit.pos * step));
  const audio = await ctx.startRendering();
  const [left, right] = [audio.getChannelData(0), audio.getChannelData(1)];
  const view = new DataView(new ArrayBuffer(44 + left.length * 4));
  const text = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + left.length * 4, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, left.length * 4, true);
  for (let i = 0; i < left.length; i++) {
    view.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    view.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}
