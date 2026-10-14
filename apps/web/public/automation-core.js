// Automation, the engine side: record what the engine does and play it back (ui/automation.js runs it on the page:
// the set it belongs to, the clock, saving).
//
// Everything the engine does goes through Mixer._tap as an entry (engine.js): a knob set or path (Ctl), a deck's
// transport events (seek / start / stop / rate / curve / loop), key, crossfader side, deck FX, a load, a scratch by
// hand, the AudioParams written directly (echo time and feedback, scratch cuts) and the sampler. Recording keeps them
// on the take's own clock (0 = when recording started); playing re-issues the same calls shifted onto the clock it is
// played on. So a mix, a loop or a scratch comes back as it was done, not re-run: nothing higher up is called again.
//
//   take: { version: 1, duration, entries: [{ at, g, k, … }] }   at: seconds from 0:00 · g: the lane (laneOf)
// Recording over a take (overdub) plays it and records at once: a lane takes the new moves from the moment it is
// first touched, the rest of the take plays on as it was.
import { DECKS } from './engine.js';

export const LEAD = 0.1; // seconds: entries that carry audio-clock times are sent this much early, so they land exactly
const AHEAD = new Set(['ev', 'param', 'trig', 'note', 'noteoff']);
const r4 = (x) => (typeof x === 'number' ? Math.round(x * 1e4) / 1e4 : x);

// the lane an entry belongs to: one per control, and per deck its transport (play, seek, loops, scratching, loads),
// its key, its crossfader side and its FX; the echo; the sampler
export function laneOf(e) {
  switch (e.k) {
    case 'set': case 'auto': return e.id;
    case 'param': return e.id.endsWith('.cut') ? `${e.id[0]}.transport` : 'echo';
    case 'ev': case 'hand': case 'load': return `${e.d}.transport`;
    case 'key': return `${e.d}.key`;
    case 'xf': return `${e.d}.xf`;
    case 'fx': return `${e.d}.fx`;
    default: return 'pads';
  }
}
export const deckOfEntry = (e) => e.d || (DECKS.includes(e.id?.[0]) && e.id[1] === '.' ? e.id[0] : null);

// move every audio-clock time in an entry by dt (recording: −start; playing: +start)
export function shiftEntry(e, dt) {
  const s = { ...e };
  switch (e.k) {
    case 'ev':
      s.events = e.events.map((x) => ({ ...x, t: r4(x.t + dt), ...(x.pts ? { pts: x.pts.map((p) => ({ ...p, t: r4(p.t + dt) })) } : {}) }));
      if (e.clearAt != null) s.clearAt = r4(e.clearAt + dt);
      break;
    case 'auto': s.pts = e.pts.map((p) => ({ ...p, t: r4(p.t + dt), v: r4(p.v) })); break;
    case 'param': { const i = e.m === 'cancelScheduledValues' ? 0 : 1; s.a = e.a.map((v, j) => r4(j === i ? v + dt : v)); break; }
    case 'trig': case 'note': s.when = r4(e.when + dt); break;
    case 'noteoff': s.t = r4(e.t + dt); break;
    case 'set': s.v = r4(e.v); break;
    default: break;
  }
  return s;
}

// an overdub: the old take without what the touched lanes had from their first touch on, and the new entries
export function mergeTake(old, fresh, latched, duration) {
  const kept = (old?.entries || []).filter((e) => !(latched.has(e.g) && e.at >= latched.get(e.g)));
  const entries = [...kept, ...fresh].sort((a, b) => a.at - b.at);
  return { version: 1, duration: r4(Math.max(old?.duration || 0, duration)), entries };
}

// loadDeck(deckName, trackId) → Promise: how a recorded load is done again (the page loads through its UI)
export class AutomationCore {
  constructor(mixer, { loadDeck } = {}) {
    this.mixer = mixer;
    this.loadDeck = loadDeck || ((d, id) => Promise.reject(new Error(`cannot load ${id} on ${d}`)));
    this.mode = 'idle'; // idle · rec (a new take) · play · overdub (play and record over it)
    this.take = null; this.fresh = []; this.latched = new Map();
    this.T0 = 0; this.idx = 0; this.notes = new Map(); this.pending = {};
  }
  get ctx() { return this.mixer.ctx; }
  now() { return this.mode === 'idle' ? 0 : Math.max(0, this.ctx.currentTime - this.T0); }

  // ---- recording: from now, with what is playing starting at 0:00 where it is (the decks come back paused)
  record() {
    const T0 = this.ctx.currentTime;
    this.T0 = T0; this.mode = 'rec'; this.take = null; this.fresh = []; this.latched = new Map();
    this.mixer.tap = (e, now) => this.onTap(e, now);
    for (const d of Object.values(this.mixer.decks)) {
      if (!d.buffer || !d.playing) continue;
      this.fresh.push({ at: 0, g: `${d.name}.transport`, k: 'ev', d: d.name, clear: 'transport', clearAt: 0, events: [{ t: LEAD, type: 'start', pos: r4(d.position(T0 + LEAD)) }] });
    }
  }
  onTap(entry, now) {
    if (this.mode !== 'rec' && this.mode !== 'overdub') return;
    const at = r4(now - this.T0);
    if (at < 0) return; // before 0:00
    const e = { at, g: laneOf(entry), ...shiftEntry(entry, -this.T0) };
    if (this.mode === 'overdub' && !this.latched.has(e.g)) this.latched.set(e.g, at);
    this.fresh.push(e);
  }

  // ---- playing: 0:00 is `start` on the audio clock; over: record over it as it plays
  play(take, { start = this.ctx.currentTime + 0.25, over = false } = {}) {
    this.take = take; this.fresh = []; this.latched = new Map();
    this.idx = 0; this.notes = new Map(); this.pending = {};
    this.T0 = start; this.mode = over ? 'overdub' : 'play';
    if (over) this.mixer.tap = (e, now) => this.onTap(e, now);
  }
  punchIn() {
    if (this.mode !== 'play') throw new Error('punch in while the automation plays');
    this.mode = 'overdub'; this.fresh = []; this.latched = new Map();
    this.mixer.tap = (e, now) => this.onTap(e, now);
  }
  // → the take to keep (null when only playing)
  stop() {
    const mode = this.mode, end = this.now();
    this.mode = 'idle'; this.mixer.tap = null;
    if (mode === 'rec') return { version: 1, duration: r4(end), entries: this.fresh };
    if (mode === 'overdub') return mergeTake(this.take, this.fresh, this.latched, end);
    return null;
  }
  // send what is due (called every few ms); → true when a played take has run out
  tick() {
    if (this.mode !== 'play' && this.mode !== 'overdub') return false;
    const now = this.ctx.currentTime, list = this.take.entries;
    while (this.idx < list.length) {
      const e = list[this.idx];
      if (this.T0 + e.at - (AHEAD.has(e.k) ? LEAD : 0) > now) break;
      this.idx++;
      if (this.mode === 'overdub' && this.latched.has(e.g) && e.at >= this.latched.get(e.g)) continue; // recorded over
      this.fire(e);
    }
    return this.mode === 'play' && this.idx >= list.length && now > this.T0 + this.take.duration;
  }
  fire(e) {
    const d = deckOfEntry(e), wait = d && this.pending[d];
    if (wait) { wait.then(() => this.fire(e)); return; } // that deck is still loading a track: after it
    const s = shiftEntry(e, this.T0);
    if (s.k === 'load') {
      this.mixer.replaying = true; // the load's own entry is not recorded again; the deck mutes what loading does
      let p;
      try { p = this.loadDeck(d, s.track); } finally { this.mixer.replaying = false; }
      this.pending[d] = Promise.resolve(p).catch((err) => console.warn('[automation] load', d, s.track, err)).finally(() => { delete this.pending[d]; });
      return;
    }
    this.mixer.replaying = true;
    try { this.apply(s); } catch (err) { console.warn('[automation] replay', e, err); } finally { this.mixer.replaying = false; }
  }
  apply(s) {
    const M = this.mixer, dk = s.d && M.decks[s.d], sampler = M.sampler;
    switch (s.k) {
      case 'set': M.controls()[s.id]?.set(s.v); break;
      case 'auto': M.controls()[s.id]?.automate(s.pts); break;
      case 'ev':
        dk._ev(s.events, s.clear || undefined, s.clear ? s.clearAt : undefined);
        for (const x of s.events) { if (x.type === 'rate') dk.rate = x.rate; if (x.type === 'curve') dk.rate = x.after ?? dk.rate; }
        dk.fx.resync();
        break;
      case 'key': if (s.keylock != null) dk.setKeylock(s.keylock); else dk.setKeyShift(s.shift); break;
      case 'xf': dk.setXfSide(s.side); break;
      case 'fx': dk.fx.set(s.type, s.amount ?? undefined, s.ramp); break;
      case 'hand':
        if (s.op === 'grab') { dk.slip = s.slip; dk.grab(); } else if (s.op === 'move') dk.handMove(s.dSec, s.vel); else dk.release();
        break;
      case 'param': M.params()[s.id]?.[s.m](...s.a); break;
      case 'trig': sampler.trigger(s.pad, s.when, s.gain); break;
      case 'note': this.notes.set(s.nid, sampler.note(s.pad, s.semis, s.when, s.gain)); break;
      case 'noteoff': this.notes.get(s.nid)?.stop(s.t); this.notes.delete(s.nid); break;
      case 'grab': case 'capture': this.refill(s); break;
      default: break;
    }
  }
  async refill(s) { // a sampler pad filled during the take, filled again the same way (and not recorded twice)
    const S = this.mixer.sampler;
    (S.replayPads ||= new Set()).add(s.pad);
    try { if (s.k === 'grab') await S.grab(s.pad, s.d, s.beats, s.stem, s.from); else await S.capture(s.pad, s.track, s.from, s.beats); }
    catch (err) { console.warn('[automation] pad', err); }
    finally { S.replayPads.delete(s.pad); }
  }
}
