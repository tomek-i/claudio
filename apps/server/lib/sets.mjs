// Saved sets: a named list of tracks that Auto-DJ plays from. One JSON file per set in sets/ (in the project folder,
// beside library/), named after the set:
//   { version: 1, name, pick: 'fit' | 'order', then: 'library' | 'stop', tracks: [{ id, title, artist }], created, updated }
// pick:  'fit' = the track of the set that fits the live deck best (tempo, key, energy), 'order' = top to bottom.
// then:  what Auto-DJ does when every track of the set has played: carry on from the whole library, or stop.
// Tracks are library ids; the title and artist are kept with them so a track that is no longer in the library can
// still be named (and fetched again).
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
  };
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
