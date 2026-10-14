// ------------------------------------------------------------------ automation on the page
// The recorder and player are in ../automation-core.js; this runs them for the active set: a recording belongs to the
// set (sets/<name>.automation.json, through /api/sets/automation) and its 0:00 is the set's saved decks, so recording
// saves them first and playing opens the set (puts them back) before it starts. A worker is the clock: timers on the
// page are slowed down in a background tab, a worker's much less.
import { AutomationCore } from '../automation-core.js';
import { mixer, tracks } from './state.js';
import { post } from './util.js';
import { loadTrack } from './commands.js';

function tickEvery(ms, fn) {
  const src = `let i=setInterval(()=>postMessage(0),${ms});onmessage=()=>{clearInterval(i);close()}`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = fn;
  return () => { try { w.postMessage(0); w.terminate(); } catch { /* gone */ } };
}
async function loadDeck(d, id) {
  const full = tracks.get(id) || (await fetch(`/api/track/${id}`).then((r) => r.json()));
  return loadTrack(d, { ...full, url: `/audio/${id}` }, { force: true });
}

class Automation {
  constructor() { this.core = null; this.set = null; this.error = null; this.stopTicks = null; }
  get mode() { return this.core?.mode || 'idle'; }
  coreOf() { return (this.core ||= new AutomationCore(mixer, { loadDeck })); }
  state() {
    const c = this.core;
    return { mode: this.mode, set: this.set, t: +(c?.now() || 0).toFixed(2), duration: c?.take?.duration ?? null, ...(this.error ? { error: this.error } : {}) };
  }

  // a new recording of the set from here (replace: when the set has one already)
  async record(set, { replace = false } = {}) {
    if (this.mode !== 'idle') throw new Error(`automation is already ${this.mode === 'rec' ? 'recording' : 'playing'}`);
    const had = await fetch(`/api/sets?name=${encodeURIComponent(set)}`).then((x) => x.json()).catch(() => null);
    if (had?.automation && !replace) throw new Error(`the set "${had.name}" already has a recording: record over it, or replace it`);
    const r = await post('/api/sets', { action: 'save', name: set }); // the decks as they are: the recording's 0:00
    if (!r.ok) throw new Error(r.error);
    this.set = r.set.name; this.error = null;
    this.coreOf().record();
    this.notify();
  }
  // the set's recording from 0:00 (over: record over it as it plays)
  async play(set, { over = false } = {}) {
    if (this.mode !== 'idle') throw new Error(`automation is already ${this.mode}`);
    const take = await fetch(`/api/sets/automation?name=${encodeURIComponent(set)}`).then((r) => r.json());
    if (!take?.entries) throw new Error(take?.error || `the set "${set}" has no recording yet`);
    const r = await post('/api/sets', { action: 'open', name: set, force: true });
    if (!r.ok) throw new Error(r.error);
    this.set = r.set.name; this.error = null;
    this.coreOf().play(take, { over });
    this.stopTicks = tickEvery(5, () => { if (this.core.tick()) this.stop(); });
    this.notify();
  }
  punchIn() { this.coreOf().punchIn(); this.notify(); }
  async stop() {
    if (this.mode === 'idle') return null;
    const end = this.core.now();
    this.stopTicks?.(); this.stopTicks = null;
    const take = this.core.stop();
    this.notify();
    if (take) {
      const r = await post('/api/sets/automation', { name: this.set, take });
      if (!r.ok) { this.error = r.error; this.notify(); throw new Error(r.error); }
    }
    this.notify();
    return { duration: +end.toFixed(2), entries: take?.entries.length ?? null };
  }
  notify() { document.dispatchEvent(new CustomEvent('automation', { detail: this.state() })); }
}

export const automation = new Automation();
