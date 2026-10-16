// The sound. A Synth builds voices out of oscillators, a filter and two envelopes on any audio context; the
// Engine plays keys and the sequence on the live one with a look-ahead scheduler; renderWav() plays the sequence
// on an offline one. Both go through Synth.noteOn / noteOff and ask lib/seq.mjs which notes start when, so what
// is exported is what was heard.
//
//   oscillators, sub, noise → filter (its envelope and the LFO move it) → amp (its envelope) → bus
//   bus → master, and through the delay and the reverb → master → limiter → out (and the page's meter)
//
// The imports are relative so that this file loads in the browser (where ../lib is /lib) and in Node (the tests
// run it on a pretend audio context).
import { noteFreq } from '../lib/notes.mjs';
import { envLevel, envEnd, tau } from '../lib/envelope.mjs';
import { envOf } from '../lib/patch.mjs';
import { voiceToSteal } from '../lib/voices.mjs';
import { notesInWindow, stepSeconds, STEPS } from '../lib/seq.mjs';
import { encodeWav } from '../lib/wav.mjs';

const LOOKAHEAD = 0.1;      // seconds of notes scheduled ahead of the clock
const TICK_MS = 25;
const SMOOTH = 0.02;        // a turned control reaches its value over about this long, so it does not click
const WAVE = { sine: 'sine', triangle: 'triangle', saw: 'sawtooth', square: 'square' };

// ---- envelopes as Web Audio automation (the same curves as lib/envelope.mjs)

function envOn(param, env, t0, scale) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(scale, t0 + env.attack);
  param.setTargetAtTime(scale * env.sustain, t0 + env.attack, tau(env.decay));
}

// Puts the param where the envelope is at `at` and takes away everything planned after it. In the attack that
// is a shorter ramp to the level reached; later it is the level itself.
function envHold(param, env, t0, releaseAt, at, scale) {
  const level = scale * envLevel(env, at - t0, releaseAt - t0);
  param.cancelScheduledValues(at);
  if (at - t0 < env.attack && at <= releaseAt) param.linearRampToValueAtTime(level, at);
  else param.setValueAtTime(level, at);
}

function envOff(param, env, t0, at, scale) {
  envHold(param, env, t0, Infinity, at, scale);
  param.setTargetAtTime(0, at, tau(env.release));
}

// the same noise every time, so two renders are the same file
function noiseInto(data, seed, shape = () => 1) {
  let s = seed;
  for (let i = 0; i < data.length; i++) { s = (s * 16807) % 2147483647; data[i] = (s / 1073741823.5 - 1) * shape(i); }
}

export class Synth {
  constructor(ctx, patch) {
    this.ctx = ctx;
    this.voices = [];
    this.lastNote = null;                              // where a glide starts from
    const gain = (value, into) => { const g = ctx.createGain(); g.gain.value = value; if (into) g.connect(into); return g; };

    const limiter = ctx.createDynamicsCompressor();    // eight loud voices do not clip
    limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    limiter.connect(ctx.destination);
    this.out = limiter;                                // what is heard: the page's meter listens here
    this.master = gain(0, limiter);
    this.bus = gain(1, this.master);                   // every voice ends here; the LFO's tremolo is this gain

    this.delaySend = gain(0);
    this.delay = ctx.createDelay(2);
    this.feedback = gain(0, this.delay);
    const damp = ctx.createBiquadFilter();             // each repeat is a little duller than the last
    damp.type = 'lowpass'; damp.frequency.value = 4500;
    this.bus.connect(this.delaySend).connect(this.delay).connect(damp).connect(this.feedback);
    this.delay.connect(this.master);

    this.reverbSend = gain(0);
    this.bus.connect(this.reverbSend);
    this.reverbOut = gain(3, this.master);             // a convolver comes out quiet: at a full send the room is about as loud as the note
    this.reverb = null;
    this.reverbSize = 0;

    this.lfo = ctx.createOscillator();                 // one LFO for all voices, running from the start
    this.lfoPitch = gain(0);                           // in cents, into every oscillator's detune
    this.lfoFilter = gain(0);                          // in cents, into every voice's filter
    this.lfoAmp = gain(0, this.bus.gain);
    for (const depth of [this.lfoPitch, this.lfoFilter, this.lfoAmp]) this.lfo.connect(depth);
    this.lfo.start(0);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    noiseInto(this.noiseBuffer.getChannelData(0), 22222);
    this.setPatch(patch);
  }

  // The patch to play from now on. Notes that are sounding follow the controls that are turned while listening
  // (filter, levels, effects, LFO); the envelopes and the oscillators' pitches are those of the next note.
  setPatch(patch) {
    const first = !this.patch;
    const now = this.ctx.currentTime;
    const put = (param, value) => { if (first) param.value = value; else param.setTargetAtTime(value, now, SMOOTH); };
    this.patch = patch;
    put(this.master.gain, patch['master.volume'] ** 2);
    put(this.delay.delayTime, patch['delay.time']);
    put(this.feedback.gain, patch['delay.feedback']);
    put(this.delaySend.gain, patch['delay.mix']);
    put(this.reverbSend.gain, patch['reverb.mix']);
    if (patch['reverb.size'] !== this.reverbSize) this.buildReverb(patch['reverb.size']);
    const depth = patch['lfo.depth'];
    const dest = patch['lfo.dest'];
    this.lfo.type = WAVE[patch['lfo.shape']];
    put(this.lfo.frequency, patch['lfo.rate']);
    put(this.lfoPitch.gain, dest === 'pitch' ? depth * depth * 2400 : 0);    // full depth is two octaves each way
    put(this.lfoFilter.gain, dest === 'filter' ? depth * 4800 : 0);          // four octaves each way
    put(this.lfoAmp.gain, dest === 'amp' ? depth / 2 : 0);                   // full depth goes down to silence
    put(this.bus.gain, dest === 'amp' ? 1 - depth / 2 : 1);
    this.prune();
    for (const v of this.voices) this.retune(v, false);
  }

  // The reverb is a burst of noise that dies away over `size` seconds, played back for every sound that enters.
  buildReverb(size) {
    const { ctx } = this;
    const length = Math.ceil(size * ctx.sampleRate);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (const ch of [0, 1]) noiseInto(impulse.getChannelData(ch), 4711 + ch * 9973, (i) => Math.exp((-6.9 * i) / length));
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    if (this.reverb) { this.reverbSend.disconnect(this.reverb); this.reverb.disconnect(); }
    this.reverbSend.connect(reverb).connect(this.reverbOut);
    this.reverb = reverb;
    this.reverbSize = size;
  }

  // what follows the patch while a note sounds: the filter and the levels
  retune(v, first) {
    const p = this.patch;
    const now = this.ctx.currentTime;
    const put = (param, value) => { if (first) param.value = value; else param.setTargetAtTime(value, now, SMOOTH); };
    put(v.filter.frequency, Math.min(18000, p['filter.cutoff'] * 2 ** (((v.note - 60) / 12) * p['filter.keytrack'])));
    put(v.filter.Q, p['filter.resonance'] * 22);       // for a low-pass this is the height of the peak, in dB
    for (const [id, node] of Object.entries(v.levels)) {
      put(node.gain, id === 'sub' ? p['mix.sub'] : id === 'noise' ? p['mix.noise'] * 0.6 : p[`${id}.level`] / Math.sqrt(v.copies));
    }
  }

  // forget the voices that have ended, and unhook them from the LFO
  prune() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => {
      if (v.end > now) return true;
      try {
        for (const o of v.oscs) this.lfoPitch.disconnect(o.detune);
        this.lfoFilter.disconnect(v.filter.detune);
        v.amp.disconnect();
      } catch { /* already gone */ }
      return false;
    });
  }

  // A key goes down at `time`. Returns the voice, which noteOff() takes.
  noteOn(note, vel = 0.8, time = this.ctx.currentTime) {
    const { ctx, patch: p } = this;
    this.prune();
    const victim = voiceToSteal(this.voices, time);
    if (victim) this.cut(victim, time);

    const v = {
      note, start: time, releaseAt: Infinity, end: Infinity,
      aenv: envOf(p, 'aenv'), fenv: envOf(p, 'fenv'),
      peak: (0.2 + 0.8 * vel * vel) * 0.3,             // eight voices at full level fit under the limiter
      sweep: p['filter.env'] * 1200,                   // the filter envelope's reach, in cents
      copies: p['voice.unison'], sources: [], oscs: [], levels: {},
    };
    v.amp = ctx.createGain();
    v.amp.connect(this.bus);
    v.filter = ctx.createBiquadFilter();
    v.filter.type = 'lowpass';
    v.filter.connect(v.amp);
    this.lfoFilter.connect(v.filter.detune);

    const glide = p['voice.glide'];
    const from = glide > 0 && this.lastNote !== null ? this.lastNote : note;
    this.lastNote = note;
    const level = (id) => { const g = ctx.createGain(); g.connect(v.filter); v.levels[id] = g; return g; };
    const tone = (type, semis, cents, into) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = cents;
      if (from === note) o.frequency.value = noteFreq(note + semis);
      else {
        o.frequency.setValueAtTime(noteFreq(from + semis), time);
        o.frequency.exponentialRampToValueAtTime(noteFreq(note + semis), time + glide);
      }
      this.lfoPitch.connect(o.detune);
      o.connect(into);
      o.start(time);
      v.oscs.push(o);
      v.sources.push(o);
    };
    for (const id of ['osc1', 'osc2']) {
      if (!(p[`${id}.level`] > 0)) continue;
      const into = level(id);
      for (let u = 0; u < v.copies; u++) {             // the copies are spread evenly from −detune to +detune
        const spread = v.copies > 1 ? ((u / (v.copies - 1)) * 2 - 1) * p['voice.detune'] : 0;
        tone(WAVE[p[`${id}.wave`]], p[`${id}.octave`] * 12 + p[`${id}.semi`], p[`${id}.fine`] + spread, into);
      }
    }
    if (p['mix.sub'] > 0) tone('sine', p['osc1.octave'] * 12 - 12, 0, level('sub'));
    if (p['mix.noise'] > 0) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      n.loop = true;
      n.connect(level('noise'));
      n.start(time, (time * 0.37) % 0.9);
      v.sources.push(n);
    }
    this.retune(v, true);

    envOn(v.amp.gain, v.aenv, time, v.peak);
    if (v.sweep) envOn(v.filter.detune, v.fenv, time, v.sweep);
    this.voices.push(v);
    return v;
  }

  // The key comes up at `time` (never sooner than 5 ms after it went down).
  noteOff(v, time = this.ctx.currentTime) {
    if (v.releaseAt !== Infinity) return;
    const at = Math.max(time, v.start + 0.005);
    envOff(v.amp.gain, v.aenv, v.start, at, v.peak);
    if (v.sweep) envOff(v.filter.detune, v.fenv, v.start, at, v.sweep);
    v.releaseAt = at;
    v.end = v.start + envEnd(v.aenv, at - v.start);
    for (const s of v.sources) s.stop(v.end);
  }

  // a note of a known length: both ends are planned at once
  play(note, vel, time, seconds) {
    const v = this.noteOn(note, vel, time);
    this.noteOff(v, time + seconds);
    return v;
  }

  // a voice taken away for another note: gone in a few milliseconds, without a click
  cut(v, time) {
    envHold(v.amp.gain, v.aenv, v.start, v.releaseAt, time, v.peak);
    v.amp.gain.setTargetAtTime(0, time, 0.004);
    v.releaseAt = Math.min(v.releaseAt, time);
    v.end = time + 0.03;
    for (const s of v.sources) s.stop(v.end);
  }

  // every voice, now
  silence() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.end > now) this.cut(v, now);
  }
}

export class Engine {
  // source(): { patch, seq } to play right now, asked on every tick, so an edit is heard on the next note
  constructor(source) {
    this.source = source;
    this.playing = false;
    this.held = new Map();                             // note → the voice a key or a MIDI note is holding
    this.onChange = null;                              // called when playing starts or stops, or the sound wakes
  }

  // A browser gives a page sound only after a click or a key. Until then the context waits, suspended.
  wake() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.miniclaude = new Synth(this.ctx, this.source().patch);
      this.analyser = this.ctx.createAnalyser();       // the page's meter reads the sound from here
      this.analyser.fftSize = 2048;
      this.miniclaude.out.connect(this.analyser);
      this.ctx.onstatechange = () => this.onChange?.();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get awake() { return this.ctx?.state === 'running'; }

  setPatch(patch) { this.miniclaude?.setPatch(patch); }

  noteOn(note, vel = 0.8) {
    this.wake();
    if (this.held.has(note)) return;
    this.held.set(note, this.miniclaude.noteOn(note, vel, this.ctx.currentTime));
  }

  noteOff(note) {
    const v = this.held.get(note);
    if (!v) return;
    this.held.delete(note);
    this.miniclaude.noteOff(v, this.ctx.currentTime);
  }

  // some notes held for a while (what `miniclaude note` asks for)
  sound(notes, seconds = 1, vel = 0.8) {
    this.wake();
    for (const note of notes) this.miniclaude.play(note, vel, this.ctx.currentTime + 0.02, seconds);
  }

  // the sequence, `loops` times or until stop()
  start(loops = Infinity) {
    this.wake();
    clearInterval(this.timer);
    this.loops = loops;
    this.bpm = this.source().seq.bpm;
    this.anchorTime = this.ctx.currentTime + 0.08;     // where position `anchorPos` is on the clock
    this.anchorPos = 0;
    this.scheduled = 0;                                // notes before this position are already on their way
    this.playing = true;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.onChange?.();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.onChange?.();
  }

  // stop, and cut every note that is sounding
  panic() {
    this.stop();
    this.held.clear();
    this.miniclaude?.silence();
  }

  // where the playhead is, in steps since play was pressed
  position() {
    return this.playing ? this.anchorPos + (this.ctx.currentTime - this.anchorTime) / stepSeconds(this.bpm) : 0;
  }

  tick() {
    const { seq } = this.source();
    const now = this.ctx.currentTime;
    if (seq.bpm !== this.bpm) {                        // a new tempo takes over from where the playhead is
      this.anchorPos = Math.max(this.anchorPos, this.position());
      this.anchorTime = Math.max(now, this.anchorTime);
      this.bpm = seq.bpm;
    }
    const step = stepSeconds(this.bpm);
    const until = this.anchorPos + (now + LOOKAHEAD - this.anchorTime) / step;
    if (until > this.scheduled) {
      for (const n of notesInWindow(seq, this.scheduled, until, { lastLoop: this.loops - 1 })) {
        this.miniclaude.play(n.note, n.vel, Math.max(now, this.anchorTime + (n.pos - this.anchorPos) * step), n.len * step);
      }
      this.scheduled = until;
    }
    if (this.position() >= this.loops * STEPS) this.stop();
  }
}

// how long after the last note the render goes on: the release, and the echoes and the room when they are in use
function tailSeconds(patch) {
  return Math.min(8, 0.5 + patch['aenv.release'] * 2 + (patch['reverb.mix'] > 0 ? patch['reverb.size'] : 0) + (patch['delay.mix'] > 0 ? patch['delay.time'] * 4 : 0));
}

// The sequence played `loops` times with the patch on an offline context, as a 16-bit stereo WAV file.
export async function renderWav(patch, seq, loops = 2, sampleRate = 44100) {
  const step = stepSeconds(seq.bpm);
  const seconds = loops * STEPS * step + tailSeconds(patch);
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const synth = new Synth(ctx, patch);
  for (const n of notesInWindow(seq, 0, loops * STEPS, { lastLoop: loops - 1 })) synth.play(n.note, n.vel, n.pos * step, n.len * step);
  const audio = await ctx.startRendering();
  return new Blob([encodeWav(audio.getChannelData(0), audio.getChannelData(1), sampleRate)], { type: 'audio/wav' });
}
