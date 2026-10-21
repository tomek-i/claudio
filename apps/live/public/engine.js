// The sound. A Rig is the whole signal path on an audio context: a strip per instrument (fader, pan, reverb and
// delay sends) into the master and its limiter, the drum kit and the synth voice. It began as a copy of
// Claudebase's (apps/daw/public/engine.js); the apps import nothing from each other, so this one is Claudel's own.
import { PRESETS } from '/lib/presets.mjs';
import { noteHz } from '/lib/notes.mjs';

const HAT_PARTIALS = [2, 3, 4.16, 5.43, 6.79, 8.21];   // six square waves that are not in tune: a metal sound
export const stepSeconds = (bpm) => 60 / bpm / 4;       // a sixteenth

// the same noise every time
function noiseBuffer(ctx, seconds, channels, shape) {
  const buffer = ctx.createBuffer(channels, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  let seed = 22222;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 1073741823.5 - 1) * shape(i / data.length);
    }
  }
  return buffer;
}

// The drum kit: every voice is oscillators and noise.
class Kit {
  constructor(ctx, out, noise) {
    this.ctx = ctx;
    this.out = out;
    this.noiseBuffer = noise;
    this.openHat = null;
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
  }

  filter(type, freq, q, into) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    f.connect(into);
    return f;
  }

  // one hit: { voice, vel } at `time` seconds on this kit's context
  trigger(hit, time) {
    const amp = hit.vel ** 1.6;
    const bright = 0.6 + 0.4 * hit.vel;              // a harder hit is a brighter one
    switch (hit.voice) {
      case 'kick': {
        const o = this.osc('sine', 150, time, time + 0.5, this.env(time, amp, 0.42));
        o.frequency.exponentialRampToValueAtTime(48, time + 0.09);
        this.noise(time, time + 0.02, this.filter('lowpass', 3000 * bright, 0.5, this.env(time, amp * 0.25, 0.012)));
        break;
      }
      case 'snare': {
        const o = this.osc('triangle', 220, time, time + 0.2, this.env(time, amp * 0.6, 0.11));
        o.frequency.exponentialRampToValueAtTime(150, time + 0.06);
        this.noise(time, time + 0.3, this.filter('highpass', 1400, 0.6, this.env(time, amp * 0.7 * bright, 0.17)));
        break;
      }
      case 'clap': {
        const g = this.ctx.createGain();             // three quick bursts, then the tail
        g.gain.setValueAtTime(0.0001, time);
        for (const at of [0, 0.011, 0.022]) {
          g.gain.setValueAtTime(amp * 0.9, time + at);
          g.gain.exponentialRampToValueAtTime(amp * 0.15, time + at + 0.009);
        }
        g.gain.setValueAtTime(amp * 0.8, time + 0.031);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
        g.connect(this.out);
        this.noise(time, time + 0.3, this.filter('bandpass', 1150, 1.3, g));
        break;
      }
      case 'hat':
      case 'open': {
        const open = hit.voice === 'open';
        const decay = open ? 0.34 : 0.045;
        const g = this.env(time, amp * 0.3, decay);
        const band = this.filter('bandpass', 10000, 0.8, this.filter('highpass', 6500 * bright, 0.7, g));
        for (const partial of HAT_PARTIALS) this.osc('square', 40 * partial, time, time + decay + 0.05, band);
        if (this.openHat) {                          // a hat closes the open hat that is ringing
          this.openHat.gain.cancelScheduledValues(time);
          this.openHat.gain.setTargetAtTime(0.0001, time, 0.008);
        }
        this.openHat = open ? g : null;
        break;
      }
      case 'tom': {
        const o = this.osc('sine', 190, time, time + 0.4, this.env(time, amp * 0.9, 0.3));
        o.frequency.exponentialRampToValueAtTime(95, time + 0.18);
        break;
      }
      case 'rim': {
        const g = this.filter('highpass', 600, 0.7, this.env(time, amp * 0.6, 0.028));
        this.osc('triangle', 1720, time, time + 0.06, g);
        this.osc('square', 470, time, time + 0.06, g);
        break;
      }
      case 'bell': {
        const g = this.filter('bandpass', 2640, 1.1, this.env(time, amp * 0.5, 0.3));
        this.osc('square', 540, time, time + 0.4, g);
        this.osc('square', 800, time, time + 0.4, g);
        break;
      }
    }
  }
}

// One note of a synth: the preset's oscillators into a filter that opens and closes, then the envelope.
function playNote(ctx, out, preset, note, time, seconds) {
  const freq = noteHz(note.pitch);
  const peak = preset.gain * note.vel ** 1.3;
  const off = time + Math.max(seconds, preset.a + 0.01);       // the release starts when the note ends
  const end = off + preset.r * 2 + 0.05;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak, time + preset.a);
  amp.gain.setTargetAtTime(peak * preset.s, time + preset.a, preset.d / 3);
  amp.gain.setTargetAtTime(0, off, preset.r / 3);
  amp.connect(out);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = preset.q;
  const rest = Math.min(16000, preset.cutoff * (1 + freq / 600));   // higher notes rest a little more open
  filter.frequency.setValueAtTime(Math.min(18000, rest * 2 ** (preset.sweep * (0.5 + 0.5 * note.vel))), time);
  filter.frequency.setTargetAtTime(rest, time + preset.a, preset.close / 3);
  filter.connect(amp);

  for (const o of preset.oscs) {
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = o.type;
    osc.frequency.value = freq;
    osc.detune.value = o.cents;
    level.gain.value = o.gain;
    osc.connect(level).connect(filter);
    osc.start(time);
    osc.stop(end);
  }
}

// rig: { bpm, master, tracks: [{ id, kind: 'drums' | 'synth', vol, pan, reverb, delay }] }, a strip per track
export class Rig {
  constructor(ctx, rig) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();   // a steep compressor near the top: loud loops are held, not clipped
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    const half = ctx.createGain();                    // and a ceiling after it: straight up to 0.7, then bending, never past 1
    half.gain.value = 0.5;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = Float32Array.from({ length: 2049 }, (_, i) => {
      const x = (i - 1024) / 512;                     // the curve covers −2..2
      return Math.abs(x) <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3));
    });
    this.master.connect(limiter).connect(half).connect(ceiling).connect(ctx.destination);

    this.reverb = ctx.createConvolver();              // one room for every strip: noise that dies away over 2.4 s
    this.reverb.buffer = noiseBuffer(ctx, 2.4, 2, (t) => (1 - t) ** 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.reverb.connect(wet).connect(this.master);

    this.delay = ctx.createDelay(2);                  // one echo for every strip: three sixteenths, each repeat darker
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 3200;
    const again = ctx.createGain();
    again.gain.value = 0.38;
    this.delay.connect(damp).connect(again).connect(this.delay);
    damp.connect(this.master);

    this.noise = noiseBuffer(ctx, 1, 1, () => 1);
    this.strips = new Map();
    this.sync(rig);
  }

  // The strips as `rig` has them. A new strip starts at its values; a change glides there, so it does not click.
  sync(rig) {
    const now = this.ctx.currentTime;
    const set = (param, value, fresh) => { if (fresh) param.value = value; else param.setTargetAtTime(value, now, 0.015); };
    set(this.master.gain, rig.master ** 2 * 1.1, !this.rig);
    set(this.delay.delayTime, Math.min(2, 3 * stepSeconds(rig.bpm)), !this.rig);
    for (const t of rig.tracks) {
      let strip = this.strips.get(t.id);
      const fresh = !strip;
      if (fresh) {
        strip = { in: this.ctx.createGain(), fader: this.ctx.createGain(), pan: this.ctx.createStereoPanner(), reverb: this.ctx.createGain(), delay: this.ctx.createGain() };
        strip.in.connect(strip.fader).connect(strip.pan).connect(this.master);
        strip.pan.connect(strip.reverb).connect(this.reverb);
        strip.pan.connect(strip.delay).connect(this.delay);
        if (t.kind === 'drums') strip.kit = new Kit(this.ctx, strip.in, this.noise);
        this.strips.set(t.id, strip);
      }
      set(strip.fader.gain, t.vol ** 2 * 1.25, fresh);
      set(strip.pan.pan, t.pan, fresh);
      set(strip.reverb.gain, t.reverb, fresh);
      set(strip.delay.gain, t.delay, fresh);
    }
    this.rig = rig;
  }

  // one sound at `time` seconds: { track, kind: 'drums', voice, vel } or { track, kind: 'synth', preset, pitch, len, vel },
  // `len` in sixteenths and `step` the length of a sixteenth
  play(event, time, step) {
    const strip = this.strips.get(event.track);
    if (!strip) return;
    if (event.kind === 'drums') strip.kit?.trigger(event, time);
    else playNote(this.ctx, strip.in, PRESETS[event.preset], event, time, event.len * step);
  }

  // fade out and let go, so notes that are still held stop with the loop
  release() {
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.012);
    setTimeout(() => this.master.disconnect(), 150);          // what is still scheduled plays into nothing
  }
}
