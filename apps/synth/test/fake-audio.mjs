// A pretend audio context for the tests: it makes no sound, it writes down what the engine asks for. Every
// node remembers what it was connected to and when it was started and stopped; every parameter remembers its
// automation. It refuses what a real context refuses (a time that is not a number, an exponential ramp to 0),
// so a slip in the engine fails a test here and not in somebody's browser.

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }

  add(kind, value, at, extra) {
    if (!Number.isFinite(value) || !Number.isFinite(at) || at < 0) throw new RangeError(`${kind}(${value}, ${at})`);
    this.events.push({ kind, value, at, ...extra });
    return this;
  }

  setValueAtTime(value, at) { return this.add('set', value, at); }
  linearRampToValueAtTime(value, at) { return this.add('ramp', value, at); }
  exponentialRampToValueAtTime(value, at) {
    if (value === 0) throw new RangeError('an exponential ramp cannot reach 0');
    return this.add('exp', value, at);
  }
  setTargetAtTime(value, at, tau) {
    if (!(tau >= 0)) throw new RangeError(`setTargetAtTime time constant ${tau}`);
    return this.add('target', value, at, { tau });
  }
  cancelScheduledValues(at) {
    if (!Number.isFinite(at)) throw new RangeError(`cancelScheduledValues(${at})`);
    this.events = this.events.filter((e) => e.at < at);
    return this;
  }
}

const PARAMS = {
  gain: ['gain'], oscillator: ['frequency', 'detune'], filter: ['frequency', 'detune', 'Q', 'gain'], source: ['playbackRate', 'detune'],
  delay: ['delayTime'], convolver: [], compressor: ['threshold', 'knee', 'ratio', 'attack', 'release'], destination: [],
};

class Node {
  constructor(ctx, kind) {
    this.kind = kind;
    this.to = [];
    this.started = null;
    this.stopped = null;
    for (const name of PARAMS[kind]) this[name] = new Param(name === 'gain' && kind === 'gain' ? 1 : 0);
    ctx.nodes.push(this);
  }

  connect(target) { this.to.push(target); return target; }
  disconnect(target) { this.to = target ? this.to.filter((t) => t !== target) : []; }
  start(at = 0) {
    if (this.started !== null) throw new Error('started twice');
    if (!Number.isFinite(at) || at < 0) throw new RangeError(`start(${at})`);
    this.started = at;
  }
  stop(at = 0) {
    if (this.started === null) throw new Error('stopped before it was started');
    if (!Number.isFinite(at) || at < 0) throw new RangeError(`stop(${at})`);
    this.stopped = at;
  }
}

export class FakeContext {
  constructor({ sampleRate = 44100 } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'running';
    this.nodes = [];
    this.destination = new Node(this, 'destination');
  }

  createGain() { return new Node(this, 'gain'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createBufferSource() { return new Node(this, 'source'); }
  createDelay() { return new Node(this, 'delay'); }
  createConvolver() { return new Node(this, 'convolver'); }
  createDynamicsCompressor() { return new Node(this, 'compressor'); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (ch) => data[ch] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }

  of(kind) { return this.nodes.filter((n) => n.kind === kind); }
}

// the offline one hands back silence of the length it was asked for
export class FakeOfflineContext extends FakeContext {
  constructor(channels, length, sampleRate) {
    super({ sampleRate });
    this.channels = channels;
    this.length = length;
    FakeOfflineContext.last = this;
  }

  startRendering() { return Promise.resolve(this.createBuffer(this.channels, this.length, this.sampleRate)); }
}
