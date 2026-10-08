// The sound. A Rig is the whole signal path on any audio context: a strip per track (fader, pan, reverb and
// delay sends) into the master and its limiter, the drum kit and the synth voice. The Engine plays the song on
// the live context with a look-ahead scheduler; renderWav() plays it on an offline one. Both hand the events of
// lib/song.mjs to Rig.play(), so what is exported is what was heard.
import { Playhead, audibleTracks, eventsInWindow, songSteps, stepSeconds } from '/lib/song.mjs';
import { PRESETS } from '/lib/presets.mjs';
import { noteHz } from '/lib/notes.mjs';

const LOOKAHEAD = 0.12;     // seconds of events scheduled ahead of the clock
const LOOKAHEAD_HIDDEN = 1.5;   // a browser runs a hidden tab's timers as seldom as once a second
const TICK_MS = 25;
const TAIL = 2.5;           // seconds a render goes on after the last bar, for the reverb and the echoes
const HAT_PARTIALS = [2, 3, 4.16, 5.43, 6.79, 8.21];   // six square waves that are not in tune: a metal sound

// the same noise every time, so two renders of a song are the same file
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

// The drum kit of one drum track: every voice is oscillators and noise.
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

// One note of a synth track: the preset's oscillators into a filter that opens and closes, then the envelope.
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

export class Rig {
  constructor(ctx, project) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();   // a steep compressor near the top: loud songs are held, not clipped
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    const half = ctx.createGain();                    // and a ceiling after it: straight up to 0.7, then bending, never past 1
    half.gain.value = 0.5;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = Float32Array.from({ length: 2049 }, (_, i) => {
      const x = (i - 1024) / 512;                     // the curve covers −2..2
      return Math.abs(x) <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3));
    });
    this.master.connect(limiter).connect(half).connect(ceiling).connect(ctx.destination);

    this.reverb = ctx.createConvolver();              // one room for every track: noise that dies away over 2.4 s
    this.reverb.buffer = noiseBuffer(ctx, 2.4, 2, (t) => (1 - t) ** 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    this.reverb.connect(wet).connect(this.master);

    this.delay = ctx.createDelay(2);                  // one echo for every track: three sixteenths, each repeat darker
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 3200;
    const again = ctx.createGain();
    again.gain.value = 0.38;
    this.delay.connect(damp).connect(again).connect(this.delay);
    damp.connect(this.master);

    this.noise = noiseBuffer(ctx, 1, 1, () => 1);
    this.strips = new Map();
    this.sync(project);
  }

  // The mixer as the project has it. A new strip starts at its values; a change glides there, so it does not click.
  sync(project) {
    const now = this.ctx.currentTime;
    const set = (param, value, fresh) => { if (fresh) param.value = value; else param.setTargetAtTime(value, now, 0.015); };
    set(this.master.gain, project.master ** 2 * 1.1, !this.project);
    set(this.delay.delayTime, Math.min(2, 3 * stepSeconds(project.bpm)), !this.project);
    const heard = new Set(audibleTracks(project).map((t) => t.id));
    for (const t of project.tracks) {
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
      set(strip.fader.gain, heard.has(t.id) ? t.vol ** 2 * 1.25 : 0, fresh);
      set(strip.pan.pan, t.pan, fresh);
      set(strip.reverb.gain, t.reverb, fresh);
      set(strip.delay.gain, t.delay, fresh);
    }
    for (const [id, strip] of this.strips) {
      if (!project.tracks.some((t) => t.id === id)) { strip.pan.disconnect(); this.strips.delete(id); }
    }
    this.project = project;
  }

  // one event of lib/song.mjs at `time` seconds; `step` is the length of a sixteenth, for how long a note is held
  play(event, time, step) {
    const strip = this.strips.get(event.track);
    if (!strip) return;
    if (event.kind === 'drums') strip.kit?.trigger(event, time);
    else playNote(this.ctx, strip.in, PRESETS[event.preset], event, time, event.len * step);
  }

  // fade out and let go, so notes that are still held stop with the transport
  release() {
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.012);
    setTimeout(() => this.master.disconnect(), 150);          // what is still scheduled plays into nothing
  }
}

export class Engine {
  // source(): the project to play right now, asked on every tick, so an edit is heard on the next event
  constructor(source) {
    this.source = source;
    this.playing = false;
    this.playhead = null;
    this.onSound = null;                               // called when the browser lets the page sound, or takes that away
  }

  wake() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx.onstatechange = () => this.onSound?.();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const project = this.source();
    if (!this.rig) this.rig = new Rig(this.ctx, project);
    else if (this.rig.project !== project) this.rig.sync(project);
  }

  // a browser lets a page make sound only after it has been clicked or typed in
  get blocked() { return !!this.ctx && this.ctx.state !== 'running'; }
  get awake() { return this.ctx?.state === 'running'; }

  start(pos = 0) {
    if (this.playing) this.stop();
    this.wake();
    this.playhead = new Playhead(this.source(), pos, this.ctx.currentTime + 0.08);
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.rig.release();
    this.rig = null;
  }

  // where the playhead is, in sixteenths from the start of the song
  position() {
    return this.playing ? this.playhead.position(this.ctx.currentTime) : 0;
  }

  tick() {
    const project = this.source();
    const now = this.ctx.currentTime;
    if (this.rig.project !== project) this.rig.sync(project);
    const step = stepSeconds(project.bpm);
    const ahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
    for (const event of this.playhead.advance(project, now + ahead)) this.rig.play(event, Math.max(now, event.time), step);
    if (this.playhead.done && now >= this.playhead.time) this.stop();   // the end of the song, with the loop off
  }

  // a sound by hand: a drum of a track, or a pitch on its synth
  preview(track, what) {
    this.wake();
    const time = this.ctx.currentTime + 0.005;
    if (track.kind === 'drums') this.rig.play({ track: track.id, kind: 'drums', voice: what, vel: 0.9 }, time);
    else this.rig.play({ track: track.id, kind: 'synth', preset: track.preset, pitch: what, len: 1, vel: 0.8 }, time, 0.2);
  }
}

// The whole song, once through, on an offline context, as a 16-bit stereo WAV file. The events are handed to the
// rig two bars ahead of the render, a bar at a time: with every note of a song waiting in the graph at once, a
// render takes as long as the song.
export async function renderWav(project, sampleRate = 44100) {
  const step = stepSeconds(project.bpm);
  const steps = songSteps(project);
  const ctx = new OfflineAudioContext(2, Math.ceil((steps * step + TAIL) * sampleRate), sampleRate);
  const rig = new Rig(ctx, project);
  const schedule = (from) => { for (const event of eventsInWindow(project, from, Math.min(steps, from + 16))) rig.play(event, event.pos * step, step); };
  schedule(0);
  schedule(16);
  for (let at = 16; at + 16 < steps; at += 16) {
    ctx.suspend(at * step).then(() => { schedule(at + 16); ctx.resume(); });
  }
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
