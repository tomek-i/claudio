// ------------------------------------------------------------------ automation on the page
// The recorder and player are in ../automation-core.js; this runs them for the active set: a recording belongs to the
// set (sets/<name>.automation.json, through /api/sets/automation) and its 0:00 is the set's saved decks, so recording
// saves them first and playing opens the set (puts them back) before it starts. A worker is the clock: timers on the
// page are slowed down in a background tab, a worker's much less.
// Export: the flight recorder records the master while the recording plays from 0:00, then the server cuts exactly
// 0:00 to the end out of it (/api/export) into .dj/exports/<set>.mp3 + tracklist. It takes as long as the set does.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Automation {
  constructor() { this.core = null; this.set = null; this.error = null; this.stopTicks = null; this.exporting = null; this.lastExport = null; }
  get mode() { return this.core?.mode || 'idle'; }
  coreOf() { return (this.core ||= new AutomationCore(mixer, { loadDeck })); }
  state() {
    const c = this.core;
    return { mode: this.mode, set: this.set, t: +(c?.now() || 0).toFixed(2), duration: c?.take?.duration ?? null,
      ...(this.exporting ? { exporting: this.exporting.phase || 'playing' } : {}), ...(this.lastExport ? { lastExport: this.lastExport } : {}), ...(this.error ? { error: this.error } : {}) };
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
    this.stopTicks = tickEvery(5, () => { if (this.core.tick()) this.stop({ ended: true }); });
    this.notify();
  }
  punchIn() { if (this.exporting) throw new Error('an export is playing: stop it first'); this.coreOf().punchIn(); this.notify(); }
  async finishExport(ex, ended) {
    if (!ended) { // stopped by hand: no file
      this.exporting = null; await post('/api/record/stop', {}).catch(() => {});
      this.lastExport = { ok: false, error: 'stopped before the end' }; this.notify(); return;
    }
    ex.phase = 'saving'; this.notify();
    await sleep(1500); // the last second of audio is still on its way
    await post('/api/record/stop', {}).catch(() => {});
    for (const d of Object.values(mixer.decks)) if (d.playing) d.pause(); // the set is over
    const r = await post('/api/export', { session: ex.session, format: ex.format, from: ex.from, to: ex.to, name: ex.set }).catch((e) => ({ ok: false, error: e.message }));
    this.exporting = null;
    this.lastExport = r.ok ? { ok: true, file: r.audio.split(/[\\/]/).pop(), duration: r.duration, tracks: r.tracks.length } : { ok: false, error: r.error };
    this.notify();
  }
  // the set's recording as a mix file: played from 0:00 in real time while the flight recorder records it
  async exportSet(set, { format = 'mp3' } = {}) {
    if (this.mode !== 'idle' || this.exporting) throw new Error('stop the automation first');
    const had = await fetch(`/api/sets?name=${encodeURIComponent(set)}`).then((x) => x.json()).catch(() => null);
    if (!had?.automation) throw new Error(`the set "${set}" has no recording to export`);
    const s = await post('/api/record/start', { screen: false, mic: false });
    if (!s?.id) throw new Error(s?.error || 'the recorder did not start');
    this.exporting = { session: s.id, format, set: had.name, phase: 'starting' }; this.lastExport = null;
    this.notify();
    await sleep(1500); // the recorder on this page starts when the server says so; give it its first chunk
    try { await this.play(set); } catch (e) { this.exporting = null; await post('/api/record/stop', {}).catch(() => {}); this.notify(); throw e; }
    Object.assign(this.exporting, { phase: 'playing', from: mixer.epoch(this.core.T0), to: mixer.epoch(this.core.T0 + this.core.take.duration) });
    this.notify();
    return { duration: this.core.take.duration };
  }

  async stop({ ended = false } = {}) {
    if (this.mode === 'idle') return null;
    const end = this.core.now(), ex = this.exporting;
    this.stopTicks?.(); this.stopTicks = null;
    const take = this.core.stop();
    this.notify();
    if (ex) { await this.finishExport(ex, ended); return { duration: +end.toFixed(2), entries: null, export: this.lastExport }; }
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
