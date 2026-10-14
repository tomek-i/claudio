// Saved sets: a named list of tracks that Auto-DJ plays from. One JSON file per set in sets/ (in the project folder,
// beside library/), named after the set:
//   { version: 1, name, pick: 'fit' | 'order', then: 'library' | 'stop', tracks: [{ id, title, artist }], created, updated }
// pick:  'fit' = the track of the set that fits the live deck best (tempo, key, energy), 'order' = top to bottom.
// then:  what Auto-DJ does when every track of the set has played: carry on from the whole library, or stop.
// Tracks are library ids; the title and artist are kept with them so a track that is no longer in the library can
// still be named (and fetched again).
// snapshot (optional): the decks and the mixer as they were saved (`dj sets save`), put back by `dj sets open`:
//   { savedAt, autoDJ, master: { volume, xfader }, decks: { A: { trackId, title, artist, position, cue, rate, keylock,
//     keyShift, vol, trim, filter, echo, eq: { low, mid, high }, stems: { vocals, drums, bass, other }, xfAssign,
//     fx: { type, amount }, loop: { start, end, beats } | null }, … } }
import fs from 'node:fs';
import path from 'node:path';

export const PICKS = ['fit', 'order'], THENS = ['library', 'stop'];
export const slug = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function normalise(s) {
  const name = String(s?.name ?? '').trim().slice(0, 80);
  if (!slug(name)) throw new Error('a set needs a name with a letter or a digit in it');
  return {
    version: 1,
    name,
    pick: PICKS.includes(s.pick) ? s.pick : 'fit',
    then: THENS.includes(s.then) ? s.then : 'library',
    tracks: (Array.isArray(s.tracks) ? s.tracks : []).filter((t) => t?.id).map((t) => ({ id: String(t.id), title: t.title ?? null, artist: t.artist ?? null })),
    created: Number(s.created) || Date.now(),
    updated: Number(s.updated) || Date.now(),
    ...(s.snapshot?.decks ? { snapshot: s.snapshot } : {}),
  };
}

// ---------------------------------------------------------------- the decks and the mixer of a set
const STEM_NAMES = ['vocals', 'drums', 'bass', 'other'];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// the engine's state (server liveState()) → what a set keeps of it: the decks with a track on them, the master, the
// crossfader, and whether Auto-DJ is on
export function snapshotOf(state, { autoDJ } = {}) {
  const decks = {};
  for (const [n, d] of Object.entries(state?.decks || {})) {
    if (!d?.trackId) continue;
    decks[n] = {
      trackId: d.trackId, title: d.title ?? null, artist: d.artist ?? null,
      position: +num(d.position).toFixed(3), cue: +num(d.cue).toFixed(3), rate: +num(d.rate, 1).toFixed(4),
      keylock: d.keylock !== false, keyShift: num(d.keyShift),
      vol: num(d.vol, 1), trim: num(d.trim), filter: num(d.filter), echo: num(d.echo),
      eq: { low: num(d.eq?.low), mid: num(d.eq?.mid), high: num(d.eq?.high) },
      stems: Object.fromEntries(STEM_NAMES.map((s) => [s, num(d.stems?.[s], 1)])),
      xfAssign: d.xfAssign || null,
      fx: { type: d.fx?.type || 'none', amount: num(d.fx?.amount) },
      loop: d.loop?.beats ? { start: num(d.loop.start), end: num(d.loop.end), beats: num(d.loop.beats) } : null,
    };
  }
  return { savedAt: Date.now(), ...(autoDJ != null ? { autoDJ: !!autoDJ } : {}), master: { volume: num(state?.master?.volume, 0.9), xfader: num(state?.master?.xfader, 0.5) }, decks };
}

// a snapshot → the engine commands that put it back, deck by deck, then the mixer. Decks come back paused at their
// position. A step marked `optional` may fail without it mattering (stems on a deck whose stems are not there).
// hasTrack(id) says whether the library still has a track; decks whose track is gone are left out and reported.
export function restoreSteps(snap, hasTrack = () => true) {
  const steps = [], missing = [];
  for (const [deck, d] of Object.entries(snap?.decks || {})) {
    if (!hasTrack(d.trackId)) { missing.push({ deck, id: d.trackId, title: d.title, artist: d.artist }); continue; }
    const step = (cmd, args, optional = false) => steps.push({ cmd, args: { deck, ...args }, ...(optional ? { optional } : {}) });
    step('load', { track: d.trackId, cue: d.cue, force: true }); // the deck may still count as on air just after its pause
    step('keylock', { on: d.keylock ? 'on' : 'off' });
    if (d.rate && Math.abs(d.rate - 1) > 1e-4) step('tempo', { value: `${((d.rate - 1) * 100).toFixed(3)}%` });
    if (d.keyShift) step('key', { semitones: d.keyShift });
    for (const band of ['low', 'mid', 'high']) if (d.eq?.[band]) step('eq', { band, value: d.eq[band] });
    if (d.filter) step('filter', { value: d.filter });
    if (d.trim) step('trim', { value: d.trim });
    if (d.vol !== 1) step('vol', { value: d.vol });
    if (d.echo) step('echo', { value: d.echo });
    for (const s of STEM_NAMES) if (d.stems?.[s] != null && d.stems[s] !== 1) step('stem', { stem: s, value: d.stems[s] }, true);
    if (d.xfAssign) step('xfassign', { side: d.xfAssign });
    if (d.fx?.type && d.fx.type !== 'none') step('deckfx', { type: d.fx.type, amount: d.fx.amount });
    if (d.loop) { step('seek', { position: d.loop.start }); step('loop', { beats: d.loop.beats }); }
    step('seek', { position: d.position });
  }
  if (snap?.master) {
    steps.push({ cmd: 'master', args: { value: snap.master.volume } });
    steps.push({ cmd: 'xfade', args: { value: snap.master.xfader } });
  }
  return { steps, missing };
}

export class SetStore {
  constructor(dir) { this.dir = dir; }
  file(name) { const s = slug(name); if (!s) throw new Error('a set needs a name with a letter or a digit in it'); return path.join(this.dir, s + '.json'); }
  read(f) { try { return normalise(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { return null; } }
  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((f) => f.endsWith('.json')).map((f) => this.read(path.join(this.dir, f))).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  get(name) { const f = this.file(name); return fs.existsSync(f) ? this.read(f) : null; }
  create(name, tracks = []) {
    if (this.get(name)) throw new Error(`there is already a set called "${this.get(name).name}"`);
    return this.save({ name, tracks, created: Date.now() });
  }
  save(set) {
    const s = normalise({ ...set, updated: Date.now() });
    fs.mkdirSync(this.dir, { recursive: true });
    const f = this.file(s.name), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    fs.renameSync(tmp, f);
    return s;
  }
  // change a set: fn gets a copy and returns it changed (or changes it in place)
  update(name, fn) {
    const s = this.get(name);
    if (!s) throw new Error(`no set called "${name}"`);
    const copy = structuredClone(s);
    return this.save(fn(copy) || copy);
  }
  remove(name) { const f = this.file(name); if (!fs.existsSync(f)) return false; fs.unlinkSync(f); return true; }
}
