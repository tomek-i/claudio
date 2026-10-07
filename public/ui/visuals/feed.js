// The /visuals page's view of the music: reads the server's event stream (lib/visuals.mjs: hello, frames, scene,
// mode) and turns it into one smooth signal per drawn frame.
//
// Frames are stamped on the engine's audio clock. The feed keeps a short buffer and a running estimate of how that
// clock maps onto this page's clock, then reads the buffer at "now minus a small delay", interpolating between the
// two frames around that moment. With no audio playing here the delay is as small as the jitter of the link allows,
// so the picture is as close to live as it gets. `clock` can be replaced to lock the picture to something else
// (the audio this viewer hears).
import { camelotHsl } from '../util.js';
import { DECK_COLORS } from '../../engine.js';

const BANDS = 16;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, (d / (1 - Math.abs(2 * l - 1))) * 100, l * 100];
}
const DECK_HSL = Object.fromEntries(Object.entries(DECK_COLORS).map(([n, c]) => [n, rgbToHsl(hex(c))]));
const GREY = [0.55, 0.6, 0.7], GREY_HSL = rgbToHsl(GREY);

// Several colours as one, each with a weight: the hue is found on the colour wheel, so two decks in a mix give the
// hue between them and not the grey that averaging red, green and blue would give. Opposite hues have no hue
// between them; the heavier one wins.
export function blendHsl(list) {
  let x = 0, y = 0, s = 0, l = 0, w = 0, top = null;
  for (const [[h, sat, li], wt] of list) {
    x += Math.cos((h * Math.PI) / 180) * wt; y += Math.sin((h * Math.PI) / 180) * wt; s += sat * wt; l += li * wt; w += wt;
    if (!top || wt > top[1]) top = [h, wt];
  }
  if (!w) return null;
  const hue = Math.hypot(x, y) / w > 0.15 ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : top[0];
  return hslToRgb(hue, s / w, l / w);
}

export function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
const lerp = (a, b, x) => a + (b - a) * x;
const ease = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

// which part of the track a position is in: intro and breakdowns are the calm parts
export function sectionAt(deck, pos) {
  if (!deck) return 'main';
  if (deck.introEnd != null && pos < deck.introEnd) return 'intro';
  if (deck.outroStart != null && pos >= deck.outroStart) return 'outro';
  for (const [start, drop] of deck.breakdowns || []) if (pos >= start && pos < drop) return 'breakdown';
  return 'main';
}

export class Feed {
  constructor({ url = '/api/visuals/events', offsetMs = 0, onHello = () => {}, onMode = () => {}, onAudio = () => {}, onRtc = () => {}, onStatus = () => {} } = {}) {
    this.frames = [];           // recent frames, oldest first
    this.scene = { live: null, decks: {} };
    this.offsetMs = offsetMs;   // the viewer's own shift: positive draws later (a slow projector wants negative)
    this.lead = null;           // smallest (arrival - frame time) seen lately, ms: the engine clock on this page's clock
    this.window = [];           // the last few seconds of arrivals, one entry a second: { sec, min, max } of (arrival - frame time)
    this.jitter = 30;           // how far behind the newest frame to read, ms: grows when frames arrive unevenly
    this.clock = null;          // () => engine audio time to draw, or null for "as live as possible"
    this.connected = false; this.lastArrival = 0;
    this.sig = {
      time: 0, idle: true, level: 0, peak: 0, bass: 0, mid: 0, high: 0, kick: 0, bands: new Float32Array(BANDS),
      beat: 0, beatPhase: 0, barPhase: 0, bpm: 120, energy: 0.5, drive: 1, section: 'main',
      color: [...GREY], accent: [...GREY], live: null, trackId: null,
    };
    this.prevBass = 0;
    this.onHello = onHello; this.onMode = onMode; this.onAudio = onAudio; this.onRtc = onRtc; this.onStatus = onStatus;
    this.connect(url);
  }

  connect(url) {
    const es = this.es = new EventSource(url);
    es.addEventListener('hello', (e) => { const h = JSON.parse(e.data); this.connected = true; this.id = h.id; this.scene = h.scene; this.frames = []; this.lead = null; this.window = []; this.onHello(h); this.onStatus(); });
    es.addEventListener('scene', (e) => { this.scene = JSON.parse(e.data); });
    es.addEventListener('mode', (e) => this.onMode(JSON.parse(e.data).mode));
    es.addEventListener('audio', (e) => this.onAudio(JSON.parse(e.data)));
    es.addEventListener('rtc', (e) => this.onRtc(JSON.parse(e.data))); // low-latency signalling from the engine tab
    es.addEventListener('frames', (e) => this.take(JSON.parse(e.data), performance.now()));
    es.onerror = () => { this.connected = false; this.onStatus(); }; // the browser reconnects by itself
  }

  take(list, now) {
    for (const f of list) {
      const last = this.frames[this.frames.length - 1];
      if (last && f.t <= last.t) { if (last.t - f.t > 2) { this.frames = []; this.lead = null; this.window = []; } else continue; } // the engine restarted: its clock starts again
      this.frames.push(f);
      // how the engine's clock sits on this page's clock, from the last few seconds only: the quickest arrivals
      // give the offset, the slowest how uneven the link is. Only the last few seconds, because the link changes:
      // a browser delivers a hidden tab's messages later and in batches, and an estimate that remembered the quick
      // first moments for ever would leave the picture reading ahead of every frame that arrives ("waiting for music").
      const lead = now - f.t * 1000, sec = Math.floor(now / 1000);
      let w = this.window[this.window.length - 1];
      if (!w || w.sec !== sec) { this.window.push(w = { sec, min: lead, max: lead }); if (this.window.length > 5) this.window.shift(); }
      w.min = Math.min(w.min, lead); w.max = Math.max(w.max, lead);
    }
    if (this.window.length) {
      const min = Math.min(...this.window.map((w) => w.min)), spread = Math.max(...this.window.map((w) => w.max)) - min;
      // small changes are eased so the picture does not jump; a big one is taken at once
      this.lead = this.lead == null || Math.abs(min - this.lead) > 300 ? min : this.lead + (min - this.lead) * 0.1;
      this.jitter += (Math.min(1000, spread * 1.1) - this.jitter) * 0.1;
    }
    if (this.frames.length > 900) this.frames.splice(0, this.frames.length - 900); // about 19 s: a listener is a few seconds behind, and compares the seconds before that
    this.lastArrival = now;
  }

  // the engine audio time it is now, as far as the arriving frames tell
  liveTime(now) { return this.lead == null ? null : (now - this.lead) / 1000; }

  // the engine audio time that should be on screen now
  drawTime(now) {
    if (this.clock) { const t = this.clock(); if (t != null) return t + this.offsetMs / 1000; }
    if (this.lead == null) return null;
    return (now - this.lead - Math.max(25, this.jitter) + this.offsetMs) / 1000;
  }

  // the two frames around t, blended; past the newest frame the beat runs on and the levels fade
  at(t) {
    const fr = this.frames, n = fr.length;
    if (!n) return null;
    let i = n - 1;
    while (i > 0 && fr[i - 1].t > t) i--;
    const b = fr[Math.min(i, n - 1)], a = fr[Math.max(0, i - 1)];
    const span = b.t - a.t, x = span > 0 ? (t - a.t) / span : 1;
    const over = Math.max(0, t - b.t), fade = Math.exp(-over / 0.25), k = Math.min(1, Math.max(0, x));
    const bands = new Float32Array(BANDS);
    for (let j = 0; j < BANDS; j++) bands[j] = (lerp(a.b[j] || 0, b.b[j] || 0, k) / 255) * fade;
    const decks = {};
    for (const [name, [beat, aud]] of Object.entries(b.d)) {
      const pa = a.d[name];
      // extrapolate with the slope between the two frames (the deck's own tempo, pitch included)
      const slope = pa && span > 0 ? (beat - pa[0]) / span : 0;
      const ok = pa && Math.abs(beat - pa[0]) < 4; // a seek or a loop jump is not a slope
      decks[name] = [ok ? beat + slope * (t - b.t) : beat, pa ? lerp(pa[1], aud, k) : aud, ok ? slope : 0];
    }
    return { l: lerp(a.l, b.l, k) * fade, p: lerp(a.p, b.p, k) * fade, bands, decks, stale: over };
  }

  // the level at engine time t, for lining the sound up with the frames; null outside what is buffered
  levelAt(t) {
    const fr = this.frames;
    let lo = 0, hi = fr.length - 1;
    if (hi < 1 || t < fr[0].t || t > fr[hi].t) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m].t <= t) lo = m; else hi = m; }
    return fr[lo].l + (fr[hi].l - fr[lo].l) * ((t - fr[lo].t) / (fr[hi].t - fr[lo].t || 1));
  }

  // called once per drawn frame; returns the signal the modes draw from
  update(now, dt) {
    const s = this.sig, t = this.drawTime(now), f = t == null ? null : this.at(t);
    s.time += dt;
    const fresh = f && f.stale < 1.5 && now - this.lastArrival < 3000;
    const level = fresh ? f.l : 0;
    s.level = ease(s.level, level, dt, level > s.level ? 0.02 : 0.12);
    s.peak = fresh ? f.p : 0;
    let bass = 0, mid = 0, high = 0;
    for (let j = 0; j < BANDS; j++) {
      const v = fresh ? f.bands[j] : 0;
      s.bands[j] = ease(s.bands[j], v, dt, v > s.bands[j] ? 0.015 : 0.14);
      if (j < 4) bass += v / 4; else if (j < 11) mid += v / 7; else high += v / 5;
    }
    // kick: the low end jumping up, then falling away
    const jump = Math.max(0, bass - this.prevBass);
    this.prevBass = ease(this.prevBass, bass, dt, 0.06);
    s.kick = Math.max(s.kick * Math.exp(-dt / 0.14), Math.min(1, jump * 7));
    s.bass = ease(s.bass, bass, dt, 0.05); s.mid = ease(s.mid, mid, dt, 0.08); s.high = ease(s.high, high, dt, 0.08);

    // the decks that are heard decide beat, colour and energy, each by how audible it is
    let lead = null, wsum = 0, energy = 0, drive = 0;
    const keys = [], accs = [];
    for (const [name, [beat, aud, slope]] of Object.entries(fresh ? f.decks : {})) {
      const d = this.scene.decks[name];
      if (!d || aud <= 0.001) continue;
      if (!lead || aud > lead.aud) lead = { name, beat, aud, slope, d };
      const pos = (d.firstBeat || 0) + beat * (60 / (d.bpm || 120));
      const calm = ['intro', 'breakdown'].includes(sectionAt(d, pos));
      keys.push([camelotHsl(d.camelot) || GREY_HSL, aud]); accs.push([DECK_HSL[name] || GREY_HSL, aud]);
      energy += ((d.energy ?? 5) / 10) * aud; drive += (calm ? 0.45 : 1) * aud; wsum += aud;
    }
    const tc = 0.9; // colour and intensity are eased, never stepped
    const key = blendHsl(keys) || GREY, acc = blendHsl(accs) || GREY;
    for (let c = 0; c < 3; c++) { s.color[c] = ease(s.color[c], key[c], dt, tc); s.accent[c] = ease(s.accent[c], acc[c], dt, tc); }
    s.energy = ease(s.energy, wsum ? energy / wsum : 0.3, dt, tc);
    s.drive = ease(s.drive, wsum ? drive / wsum : 0.4, dt, 1.5);
    if (lead) {
      s.beat = lead.beat; s.bpm = Math.abs(lead.slope) > 0.2 ? lead.slope * 60 : lead.d.bpm || s.bpm;
      s.live = lead.name; s.trackId = lead.d.id;
      s.section = sectionAt(lead.d, (lead.d.firstBeat || 0) + lead.beat * (60 / (lead.d.bpm || 120)));
    } else {
      s.beat += (dt * s.bpm) / 60 * 0.5; // nothing playing: the picture idles at half tempo
      s.live = null; s.section = 'main';
    }
    s.beatPhase = ((s.beat % 1) + 1) % 1; s.barPhase = (((s.beat / 4) % 1) + 1) % 1;
    const idle = !fresh || (!lead && s.level < 0.003);
    if (idle !== s.idle) { s.idle = idle; this.onStatus(); }
    return s;
  }
}
