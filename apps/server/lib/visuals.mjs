// Visuals relay: what the /visuals page is fed with.
// The audio only exists in the engine tab, so that tab measures it (apps/web/public/worklets/visuals-tap.js) and posts compact
// analysis frames here; the hub fans them out to every viewer over one event stream. It also keeps the "scene": the
// slow facts about what is on the decks (key, energy, structure), sent when they change. Viewers only ever read.
//
// A frame, as the engine sends it and viewers get it:
//   { t, l, p, b, d }   t  seconds on the engine's audio clock, the end of the block that was measured
//                       l  level (RMS, 0..1)   p  peak (0..1)   b  band energies, low to high, 0..255 each
//                       d  { A: [beat, audible], … } for every playing deck: beats since the track's first beat
//                          (a fraction, so it carries beat, bar and phrase phase) and how audible the deck is (0..1)
// A scene: { live, decks: { A: { id, title, artist, camelot, energy, bpm, firstBeat, introEnd, outroStart, breakdowns } } }
// with times in track seconds. A deck's position is firstBeat + beat * 60 / bpm.

import os from 'node:os';

export const MODES = ['tunnel', 'particles', 'terrain', 'kaleido'];
export const BANDS = 16;
const MAX_BATCH = 64;
const num = (v, lo, hi) => (Number.isFinite(v = Number(v)) ? Math.min(hi, Math.max(lo, v)) : 0);

// only the shape above is ever passed on, whatever was posted
export function cleanFrame(f) {
  if (!f || typeof f !== 'object' || !Number.isFinite(Number(f.t))) return null;
  const b = Array.isArray(f.b) ? f.b.slice(0, BANDS).map((v) => Math.round(num(v, 0, 255))) : [];
  const d = {};
  for (const n of ['A', 'B', 'C', 'D']) {
    const x = f.d?.[n];
    if (Array.isArray(x) && Number.isFinite(Number(x[0]))) d[n] = [+Number(x[0]).toFixed(3), +num(x[1], 0, 1).toFixed(3)];
  }
  return { t: +Number(f.t).toFixed(4), l: +num(f.l, 0, 1).toFixed(4), p: +num(f.p, 0, 1).toFixed(4), b, d };
}

export function buildScene(state, library) {
  const decks = {};
  for (const [name, d] of Object.entries(state?.decks || {})) {
    if (!d?.trackId) continue;
    const t = library?.tracks.get(d.trackId) || {};
    decks[name] = {
      id: d.trackId, title: d.title ?? t.title ?? '', artist: d.artist ?? t.artist ?? '',
      camelot: d.effectiveCamelot || d.camelot || t.camelot || null,
      energy: d.energy ?? t.energy ?? null,
      bpm: d.bpm ?? t.bpm ?? null, firstBeat: d.firstBeat ?? t.firstBeat ?? 0,
      introEnd: t.introEnd ?? null, outroStart: t.outroStart ?? null,
      breakdowns: (t.breakdowns || []).map((x) => [x.start, x.drop]),
    };
  }
  return { live: state?.live || null, decks };
}

// The address other devices on the network reach this machine at: an IPv4 address that is not loopback, preferring a
// real adapter over the virtual ones of WSL, Hyper-V, Docker and VPNs, and a home or office range over anything else.
export function lanAddress(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const virtual = /vethernet|wsl|hyper-v|virtual|vmware|vbox|docker|tailscale|zerotier|vpn|tun|tap|loopback/i.test(name);
      const home = /^(192\.168\.|10\.)/.test(a.address);
      found.push({ address: a.address, rank: (virtual ? 2 : 0) + (home ? 0 : 1) });
    }
  }
  return found.sort((x, y) => x.rank - y.rank)[0]?.address || null;
}

// Audio for viewers who ask for it: the engine tab encodes the master output (Opus in WebM, a MediaRecorder of its
// own, running only while someone listens) and posts the chunks here; the hub passes them on as one long response per
// listener. A WebM stream can only be picked up at its header and then at the start of a cluster, so the hub keeps
// the header of the current stream and starts each new listener there, followed by the stream from the next cluster
// on: a late joiner hears the set from now, not from the beginning. Every stream has its own timeline; `t0` is where
// that timeline starts on the engine's audio clock, which is what lets a viewer line the picture up with the sound.
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]); // the id of a WebM cluster
const MAX_HEADER = 1 << 20, MAX_BACKLOG = 4 << 20;

export class VisualsHub {
  constructor({ library, audio = true, lowLatency = false, maxListeners = 8, audioBitrate = 160, onAudience = () => {}, onSignal = () => {} } = {}) {
    this.library = library;
    this.onAudience = onAudience; // called with { viewers, listeners } when either changes: the engine measures and encodes only while they are wanted
    this.viewers = new Map();     // id -> res
    this.mode = 'auto';
    this.scene = { live: null, decks: {} };
    this.sceneKey = JSON.stringify(this.scene);
    this.frames = 0;              // frames relayed since start
    this.recent = [];             // arrival times (ms) of the last two seconds of frames
    this.lastFrameAt = 0;
    this.audioOn = audio !== false; // the visuals.audio setting: with it off no audio is offered or passed on
    this.listeners = new Map();   // id -> { res, live }: live once it has been sent the header and a first cluster
    this.stream = null;           // { id, t0, header, pending, bytes, lastAt }
    this.audioRecent = [];        // [arrival ms, bytes] of the last two seconds of audio
    // Low-latency audio (the visuals.lowLatency setting): the engine tab sends the sound straight to a viewer over
    // WebRTC, and the hub only passes the two sides' signalling (offer, answer, ICE candidates) between them; no
    // audio comes through here on that path. Each such listener is one more encode in the engine tab, so only
    // `maxListeners` get a place; everyone else, and anyone whose connection fails, listens through the relay above.
    this.lowLatency = lowLatency === true;
    this.maxListeners = maxListeners;
    this.audioBitrate = audioBitrate;   // kbit/s, for connections made from now on
    this.rtc = new Set();               // the viewers holding a low-latency place
    this.onSignal = onSignal;           // called with what the engine tab must hear: { type: 'join' | 'answer' | 'ice' | 'leave', viewer, … }
  }

  write(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  broadcast(event, data) { for (const res of this.viewers.values()) this.write(res, event, data); }
  audience() { this.onAudience({ viewers: this.viewers.size, listeners: this.listeners.size, rtc: this.rtc.size }); }

  attach(id, res) {
    this.viewers.set(id, res);
    this.write(res, 'hello', { id, mode: this.mode, modes: MODES, scene: this.scene, audio: this.audioOn, lowLatency: this.audioOn && this.lowLatency });
    this.audience();
  }
  detach(id) {
    if (!this.viewers.delete(id)) return;
    if (this.rtc.delete(id)) this.onSignal({ type: 'leave', viewer: id });
    this.audience();
  }

  // frames from the engine tab: cleaned, counted, passed on in the order they came
  push(list, now = Date.now()) {
    const frames = (Array.isArray(list) ? list.slice(-MAX_BATCH) : []).map(cleanFrame).filter(Boolean);
    if (!frames.length) return 0;
    this.frames += frames.length;
    this.lastFrameAt = now;
    for (let i = 0; i < frames.length; i++) this.recent.push(now);
    while (this.recent.length && now - this.recent[0] > 2000) this.recent.shift();
    if (this.viewers.size) this.broadcast('frames', frames);
    return frames.length;
  }

  // the live state as the server sees it; viewers hear about it only when a fact changed
  setState(state) {
    const scene = buildScene(state, this.library), key = JSON.stringify(scene);
    if (key === this.sceneKey) return false;
    this.scene = scene; this.sceneKey = key;
    this.broadcast('scene', scene);
    return true;
  }

  setMode(mode) {
    mode = String(mode || '').toLowerCase();
    if (mode !== 'auto' && !MODES.includes(mode)) return { ok: false, error: `unknown mode "${mode}" (auto, ${MODES.join(', ')})` };
    this.mode = mode;
    this.broadcast('mode', { mode });
    return { ok: true, mode, viewers: this.viewers.size };
  }

  // ---- audio
  // a viewer asks to listen: its response stays unanswered until there is a header and a cluster to start it with
  listen(id, res) {
    if (!this.audioOn) return false;
    this.listeners.set(id, { res, live: false });
    this.audience();
    return true;
  }
  unlisten(id) {
    if (this.listeners.delete(id)) this.audience();
  }
  drop(id) {
    const l = this.listeners.get(id);
    if (!l) return;
    this.listeners.delete(id);
    try { if (!l.live) l.res.writeHead(503, { 'cache-control': 'no-store' }); l.res.end(); } catch { /* already gone */ }
  }

  // a chunk of the engine's stream, in order. `stream` names the recording it belongs to.
  pushAudio({ stream, t0 }, buf, now = Date.now()) {
    if (!this.audioOn || !Buffer.isBuffer(buf) || !buf.length || !stream) return false;
    if (this.stream?.id !== String(stream)) {
      // a new recording in the engine: its own header and timeline, so those listening start again on it
      const before = this.listeners.size;
      for (const [id, l] of this.listeners) if (l.live) this.drop(id);
      this.stream = { id: String(stream), t0: Number(t0) || 0, header: null, pending: Buffer.alloc(0), bytes: 0, lastAt: now };
      if (this.listeners.size !== before) this.audience();
    }
    const s = this.stream;
    s.lastAt = now; s.bytes += buf.length;
    this.audioRecent.push([now, buf.length]);
    while (this.audioRecent.length && now - this.audioRecent[0][0] > 2000) this.audioRecent.shift();
    if (!s.header) {
      s.pending = Buffer.concat([s.pending, buf]);
      const k = s.pending.indexOf(CLUSTER);
      if (k < 0) { if (s.pending.length > MAX_HEADER) s.pending = Buffer.alloc(0); return true; }
      s.header = Buffer.from(s.pending.subarray(0, k)); buf = s.pending.subarray(k); s.pending = null;
    }
    let dropped = false;
    for (const [id, l] of this.listeners) {
      if (l.live) {
        // a listener that cannot keep up would pile the set up in memory: it is let go and joins again
        if (l.res.writableLength > MAX_BACKLOG) { this.drop(id); dropped = true; } else l.res.write(buf);
        continue;
      }
      const k = buf.indexOf(CLUSTER);
      if (k < 0) continue;
      l.res.writeHead(200, { 'content-type': 'audio/webm', 'cache-control': 'no-store', 'x-audio-stream': s.id, 'x-audio-t0': String(s.t0) });
      l.res.write(s.header); l.res.write(buf.subarray(k));
      l.live = true;
    }
    if (dropped) this.audience();
    return true;
  }

  // ---- low-latency signalling
  // from a viewer: ask for a place ('join'), answer the engine's offer, pass ICE candidates, or give the place up
  signalFromViewer(id, msg = {}) {
    const res = this.viewers.get(id);
    if (!res) return { ok: false, error: 'unknown viewer' };
    const refuse = (reason) => { this.write(res, 'rtc', { type: 'refuse', reason }); return { ok: false, reason }; };
    const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
    if (msg.type === 'join') {
      if (!this.audioOn || !this.lowLatency) return refuse('off');
      if (!this.rtc.has(id) && this.rtc.size >= this.maxListeners) return refuse('full');
      this.rtc.add(id);
      this.onSignal({ type: 'join', viewer: id, bitrate: this.audioBitrate });
      this.audience();
      return { ok: true };
    }
    if (msg.type === 'leave') {
      if (this.rtc.delete(id)) { this.onSignal({ type: 'leave', viewer: id }); this.audience(); }
      return { ok: true };
    }
    if (!this.rtc.has(id)) return { ok: false, error: 'no low-latency place' };
    if (msg.type === 'answer' && text(msg.sdp, 20000)) { this.onSignal({ type: 'answer', viewer: id, sdp: msg.sdp }); return { ok: true }; }
    if (msg.type === 'ice' && msg.candidate && JSON.stringify(msg.candidate).length <= 2000) { this.onSignal({ type: 'ice', viewer: id, candidate: msg.candidate }); return { ok: true }; }
    return { ok: false, error: 'bad message' };
  }
  // from the engine tab, for one viewer: its offer, ICE candidates, or 'bye' when it closes the connection
  signalFromEngine(msg = {}) {
    const res = this.viewers.get(msg.viewer);
    if (!res || !this.rtc.has(msg.viewer)) return { ok: false, error: 'no such listener' };
    if (msg.type === 'offer' && typeof msg.sdp === 'string') this.write(res, 'rtc', { type: 'offer', sdp: msg.sdp });
    else if (msg.type === 'ice' && msg.candidate) this.write(res, 'rtc', { type: 'ice', candidate: msg.candidate });
    else if (msg.type === 'bye') { this.rtc.delete(msg.viewer); this.write(res, 'rtc', { type: 'bye' }); this.audience(); }
    else return { ok: false, error: 'bad message' };
    return { ok: true };
  }
  // every low-latency listener is told to go (it falls back to the relay if there is one) and the engine to hang up
  endRtc() {
    for (const id of this.rtc) { const res = this.viewers.get(id); if (res) this.write(res, 'rtc', { type: 'bye' }); this.onSignal({ type: 'leave', viewer: id }); }
    const had = this.rtc.size;
    this.rtc.clear();
    return had;
  }
  setRtc({ lowLatency, maxListeners, audioBitrate } = {}) {
    if (maxListeners != null) this.maxListeners = maxListeners;   // a lower cap does not disconnect anyone
    if (audioBitrate != null) this.audioBitrate = audioBitrate;
    lowLatency = lowLatency === true;
    if (lowLatency === this.lowLatency) return;
    this.lowLatency = lowLatency;
    if (!lowLatency) this.endRtc();
    this.broadcast('audio', { offered: this.audioOn, lowLatency: this.audioOn && this.lowLatency });
    this.audience();
  }

  setAudio(on) {
    on = on !== false;
    if (on === this.audioOn) return;
    this.audioOn = on;
    if (!on) { for (const id of [...this.listeners.keys()]) this.drop(id); this.stream = null; this.audioRecent = []; this.endRtc(); }
    this.broadcast('audio', { offered: on, lowLatency: on && this.lowLatency });
    this.audience();
  }

  status(now = Date.now()) {
    while (this.recent.length && now - this.recent[0] > 2000) this.recent.shift();
    while (this.audioRecent.length && now - this.audioRecent[0][0] > 2000) this.audioRecent.shift();
    return {
      viewers: this.viewers.size, mode: this.mode, modes: MODES,
      fps: +(this.recent.length / 2).toFixed(1), frames: this.frames,
      lastFrameAgoMs: this.lastFrameAt ? now - this.lastFrameAt : null,
      audio: {
        offered: this.audioOn, listeners: this.listeners.size, // listeners: through the relay
        lowLatency: this.lowLatency, rtcListeners: this.rtc.size, maxListeners: this.maxListeners, bitrate: this.audioBitrate,
        kbps: Math.round((this.audioRecent.reduce((a, x) => a + x[1], 0) * 8) / 2000),
        lastChunkAgoMs: this.stream ? now - this.stream.lastAt : null,
      },
    };
  }
}
