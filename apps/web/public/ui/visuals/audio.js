// The /visuals page's optional sound: plays the set's master output, relayed by the server as one long WebM
// stream (apps/server/lib/visuals.mjs). Off until the viewer turns it on.
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
//
// There are two ways the sound can come. The direct path is WebRTC straight from the engine tab (issue #3): a
// fraction of a second behind the decks, only on the same network, only if the server offers it and has a place
// free. It is tried first; if it has not connected within three seconds, or fails later, the relay plays instead
// and the direct path is tried again in the background. The direct path has no timeline, so its first guess is
// simply "now"; Sync finds the rest, the same way.
import { musicSdp, opusParams } from './sdp.js';
const MIME = 'audio/webm;codecs=opus';
const BEHIND_MAX = 2.5;   // seconds of sound waiting to be played before the player skips ahead
const BEHIND_AIM = 0.5;   // where it skips to: this much before the newest sound
const DIRECT_WAIT = 3000;   // ms for the direct (WebRTC) path to connect before the relay is started instead
const DIRECT_RETRY = 20000; // ms between tries for the direct path while the relay plays

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
  constructor({ url = '/api/visuals/audio', levelAt = () => null, liveTime = () => null, signal = () => {}, onState = () => {} } = {}) {
    this.url = url; this.onState = onState;
    this.levelAt = levelAt;   // (engine time) => the level in the analysis frames at that moment, or null
    this.liveTime = liveTime; // () => the engine time it is now, as far as the frames tell, or null
    this.signal = signal;     // (message) => sends low-latency signalling to the server
    this.sync = new Sync();
    this.wanted = false; this.state = 'off'; // off | connecting | playing | waiting (the stream dropped; joining again)
    this.path = null;                        // 'direct' (WebRTC from the engine tab) | 'relay' (through the server) | null
    this.lowLatency = false;                 // whether the server offers the direct path
    this.audio = new Audio(); this.audio.preload = 'auto';
    this.volume = 1; this.muted = false;
    this.t0 = null; this.est = null; this.estAt = 0;
    this.rtc = null;                         // { pc, el, node, connected }
  }

  static supported() { return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MIME); }

  // the sound passes through a meter on its way out (for Sync); volume and mute come after it, so a muted viewer
  // stays in step
  wire() {
    if (this.ctx) return this.ctx.resume();
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.meter = Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
    this.gain = ctx.createGain();
    this.relayGain = ctx.createGain();   // the relay's player; silenced while the direct path plays
    ctx.createMediaElementSource(this.audio).connect(this.relayGain).connect(this.meter).connect(this.gain).connect(ctx.destination);
    this.buf = new Float32Array(this.meter.fftSize);
    this.applyGain();
    return ctx.resume();
  }
  applyGain() { if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume; }

  set(state) { if (state !== this.state) { this.state = state; this.onState(state); } }
  setPath(path) { if (path !== this.path) { this.path = path; this.sync.reset(); this.onState(this.state); } }
  setVolume(v) { this.volume = Math.min(1, Math.max(0, v)); this.applyGain(); }
  setMuted(m) { this.muted = !!m; this.applyGain(); }

  // call from a click or a key press: browsers only start sound on a gesture
  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.wire();
    this.set('connecting');
    if (this.lowLatency) this.askDirect(); else this.join();
  }
  stop() {
    this.wanted = false;
    this.dropDirect(true);
    clearTimeout(this.directWait); clearTimeout(this.directRetry);
    this.leave();
    this.setPath(null);
    this.set('off');
  }

  // ---- the direct path: WebRTC from the engine tab, tried first
  // The server offers it or stops offering it (the visuals.lowLatency setting).
  setLowLatency(on) {
    this.lowLatency = !!on;
    if (!this.wanted) return;
    if (on && !this.rtc) this.askDirect();
    if (!on) { clearTimeout(this.directRetry); if (this.rtc) this.failDirect(); }
  }
  askDirect() {
    clearTimeout(this.directWait); clearTimeout(this.directRetry);
    if (!this.wanted || !this.lowLatency || typeof RTCPeerConnection === 'undefined') return this.failDirect();
    this.dropDirect(false);
    this.rtc = { pc: null, connected: false };
    this.signal({ type: 'join' });
    // a viewer the engine tab cannot reach would otherwise wait out the browser's own timeout in silence
    this.directWait = setTimeout(() => { if (this.rtc && !this.rtc.connected) this.failDirect(); }, DIRECT_WAIT);
  }
  // signalling from the engine tab, by way of the server
  async onSignal(msg) {
    if (!this.wanted) return;
    try {
      if (msg.type === 'refuse' || msg.type === 'bye') return this.failDirect(false);
      if (!this.rtc) return;
      if (msg.type === 'offer') {
        const pc = this.rtc.pc = new RTCPeerConnection({ iceServers: [] }), rtc = this.rtc;
        pc.onicecandidate = (e) => { if (e.candidate) this.signal({ type: 'ice', candidate: e.candidate.toJSON() }); };
        pc.ontrack = (e) => this.hear(rtc, e);
        pc.onconnectionstatechange = () => {
          if (this.rtc !== rtc) return;
          if (pc.connectionState === 'connected') this.onDirect(rtc);
          else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.failDirect();
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await pc.createAnswer();
        // the answer has to ask for stereo and the bitrate as well, or the engine sends mono speech
        answer.sdp = musicSdp(answer.sdp, Number(opusParams(msg.sdp)?.maxaveragebitrate) / 1000 || 160);
        await pc.setLocalDescription(answer);
        this.signal({ type: 'answer', sdp: answer.sdp });
      } else if (msg.type === 'ice' && this.rtc.pc) await this.rtc.pc.addIceCandidate(msg.candidate);
    } catch (err) { console.warn('visuals: low-latency audio failed', err); this.failDirect(); }
  }
  hear(rtc, e) {
    const stream = e.streams[0] || new MediaStream([e.track]);
    try { e.receiver.jitterBufferTarget = 0; } catch { /* not in this browser */ }
    // a remote stream only flows into Web Audio while an element is playing it too; that element stays silent
    rtc.el = Object.assign(new Audio(), { srcObject: stream, muted: true });
    rtc.el.play().catch(() => {});
    rtc.node = this.ctx.createMediaStreamSource(stream);
    rtc.receiver = e.receiver;
  }
  onDirect(rtc) {
    clearTimeout(this.directWait);
    rtc.connected = true;
    rtc.node?.connect(this.meter);
    this.relayGain.gain.value = 0;
    this.leave();                 // the relay, if it was playing meanwhile
    this.setPath('direct');
    this.set('playing');
  }
  dropDirect(tell) {
    const rtc = this.rtc;
    if (!rtc) return;
    this.rtc = null;
    try { rtc.node?.disconnect(); } catch { /* not connected */ }
    try { rtc.pc?.close(); } catch { /* already closed */ }
    if (rtc.el) { rtc.el.pause(); rtc.el.srcObject = null; }
    if (tell) this.signal({ type: 'leave' });
  }
  // the direct path is not to be had (refused, unreachable, dropped): the relay plays, and the direct path is tried
  // again in the background
  failDirect(tell = true) {
    clearTimeout(this.directWait);
    const was = this.path === 'direct';
    this.dropDirect(tell);
    if (!this.wanted) return;
    if (this.relayGain) this.relayGain.gain.value = 1;
    if (was || this.path !== 'relay') { this.setPath('relay'); this.set(was ? 'waiting' : this.state); this.join(); }
    clearTimeout(this.directRetry);
    if (this.lowLatency) this.directRetry = setTimeout(() => this.askDirect(), DIRECT_RETRY);
  }

  // ---- the relay: one long WebM stream through the server
  leave() {
    this.ctrl?.abort(); this.ctrl = null;
    clearTimeout(this.retry);
    this.audio.pause();
    if (this.audio.src) { URL.revokeObjectURL(this.audio.src); this.audio.removeAttribute('src'); this.audio.load(); }
    this.t0 = null; this.est = null;
    if (this.path !== 'direct') this.sync.reset();
  }

  async join() {
    this.leave();
    if (!this.wanted || this.path === 'direct') return;
    this.setPath('relay');
    this.set(this.state === 'playing' ? 'waiting' : this.state);
    const ctrl = this.ctrl = new AbortController(), audio = this.audio;
    const again = () => { if (this.ctrl === ctrl && this.wanted && this.path === 'relay') { this.set('waiting'); this.t0 = null; this.retry = setTimeout(() => this.join(), 1500); } };
    try {
      const ms = new MediaSource();
      audio.src = URL.createObjectURL(ms);
      await new Promise((ok) => ms.addEventListener('sourceopen', ok, { once: true }));
      const sb = ms.addSourceBuffer(MIME);
      const res = await fetch(this.url, { signal: ctrl.signal });
      if (res.status === 403) { if (this.path === 'relay') { this.wanted = false; this.leave(); this.setPath(null); this.set('off'); } return; } // switched off on the server
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
  // also takes a loudness sample for Sync.
  time(now = performance.now()) {
    if (this.state !== 'playing' || !this.meter) { this.est = null; return null; }
    let guess, dt;
    if (this.path === 'direct') {
      // no timeline of its own: the sound is "now", less however long the connection holds it, which Sync finds
      guess = this.liveTime(now);
      if (guess == null) return null;
      dt = this.estAt ? Math.min(0.1, (now - this.estAt) / 1000) : 0;
    } else {
      // the relay's player has a position on the stream's timeline. It moves in steps, so it is followed by a clock
      // that runs smoothly and is pulled gently towards it.
      const a = this.audio;
      if (this.t0 == null || a.paused || a.readyState < 3) { this.est = null; return null; }
      const pos = a.currentTime;
      dt = this.est == null ? 0 : (now - this.estAt) / 1000;
      if (this.est == null || Math.abs(pos - this.est) > 0.15) this.est = pos;
      else { this.est += dt * a.playbackRate; this.est += (pos - this.est) * 0.04; }
      guess = this.t0 + this.est;
    }
    this.estAt = now;
    this.meter.getFloatTimeDomainData(this.buf);
    let sum = 0; for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const shift = this.sync.add(guess, Math.sqrt(sum / this.buf.length), this.levelAt, dt);
    // what the meter hears now leaves the speakers one output delay later; the picture is for what is heard
    this.heard = guess + shift - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
    return this.heard;
  }

  get locked() { return this.sync.target != null; }

  // what the direct connection is actually carrying, from the receiver's own statistics
  async stats() {
    const pc = this.rtc?.pc;
    if (!pc) return null;
    const out = { path: this.path };
    for (const r of (await pc.getStats()).values()) {
      if (r.type === 'inbound-rtp' && r.kind === 'audio') Object.assign(out, { bytes: r.bytesReceived, at: r.timestamp, jitterBufferMs: r.jitterBufferEmittedCount ? Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000) : null, codecId: r.codecId });
      if (r.type === 'candidate-pair' && r.nominated) out.pair = { local: r.localCandidateId, remote: r.remoteCandidateId, rttMs: r.currentRoundTripTime != null ? Math.round(r.currentRoundTripTime * 1000) : null };
    }
    for (const r of (await pc.getStats()).values()) {
      if (r.id === out.codecId) Object.assign(out, { codec: r.mimeType, channels: r.channels, fmtp: r.sdpFmtpLine });
      if (r.type === 'local-candidate' && r.id === out.pair?.local) out.localType = r.candidateType;
      if (r.type === 'remote-candidate' && r.id === out.pair?.remote) out.remoteType = r.candidateType;
    }
    return out;
  }
}
