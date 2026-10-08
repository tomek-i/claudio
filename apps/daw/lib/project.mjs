// A project: a song in 4/4 made of tracks, each with clips on a bar timeline.
//
//   { name, bpm, swing, bars, loop: { on, from, to }, master, ids: { t, c, n },
//     tracks: [{ id, name, kind: 'drums' | 'synth', preset, vol, pan, mute, solo, reverb, delay,
//                clips: [{ id, bar, bars, len, rows | notes }] }] }
//
// A clip starts at `bar` (counted from 0 here; the page and the CLI show bars from 1) and lasts `bars`. Its
// content is `len` bars long and repeats until the clip ends. A drum clip has `rows`: one list of velocities per
// voice of the kit, a step per sixteenth (0 = off). A synth clip has `notes`: { id, pitch, start, len, vel } with
// start and len in sixteenths. Two clips of one track never share a bar.
//
// Nothing here changes a project in place: every function returns a new one.
import { VOICES, velOfLetter, voiceId } from './kit.mjs';
import { LOW, HIGH, DEFAULT_VEL, noteName, parseNotes } from './notes.mjs';
import { PRESETS, presetId } from './presets.mjs';

export const APP_NAME = 'Claudebase';   // the one place the name shown to people is written
export const STEPS_PER_BAR = 16;
export const KINDS = ['drums', 'synth'];
export const BPM_RANGE = [40, 240];
export const MAX_BARS = 256;
export const MAX_LEN = 8;               // bars of content in one clip
export const MAX_TRACKS = 16;
export const MAX_NOTES = 1024;          // in one clip
export const MIN_NOTE = 0.125;          // the shortest note, in sixteenths

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (n, fallback) => (n !== null && n !== '' && Number.isFinite(Number(n)) ? Number(n) : fallback);
const int = (n, fallback) => Math.round(num(n, fallback));
const round = (n, places) => Number(n.toFixed(places)) + 0;   // + 0: a tiny negative number rounds to 0, not −0

function want(value, what) {
  const n = num(value, NaN);
  if (Number.isNaN(n)) throw new Error(`"${value}" is not ${what}`);
  return n;
}
function whole(value, what) {
  const n = want(value, what);
  if (!Number.isInteger(n)) throw new Error(`"${value}" is not ${what}`);
  return n;
}

export function emptyProject(name = 'Untitled') {
  return { name, bpm: 120, swing: 0, bars: 16, loop: { on: false, from: 0, to: 4 }, master: 0.8, ids: { t: 0, c: 0, n: 0 }, tracks: [] };
}

export const clipEnd = (clip) => clip.bar + clip.bars;
export const lastBar = (project) => Math.max(0, ...project.tracks.flatMap((t) => t.clips.map(clipEnd)));

// the clip of `track` that has a bar in [bar, bar + bars), other than the clip `except`
export const taker = (track, bar, bars, except = null) => track.clips.find((c) => c.id !== except && c.bar < bar + bars && bar < clipEnd(c));
export const fits = (track, bar, bars, except = null) => bar >= 0 && bars >= 1 && bar + bars <= MAX_BARS && !taker(track, bar, bars, except);

export function findClip(project, id) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

// ---- a well-formed project out of whatever came in (a file, the page, a template)

// Ids are t1, c1, n1, … and are never reused while a project lives: `ids` holds the last number given of each kind.
function idMaker(input) {
  const ids = { t: 0, c: 0, n: 0 };
  const seen = new Set();
  const good = (kind, id) => typeof id === 'string' && id[0] === kind && /^[1-9]\d{0,8}$/.test(id.slice(1));
  const raise = (kind, n) => { ids[kind] = clamp(Math.max(ids[kind], Math.floor(num(n, 0))), 0, 1e9); };
  for (const kind of Object.keys(ids)) raise(kind, input.ids?.[kind]);
  for (const t of input.tracks) {
    if (good('t', t?.id)) raise('t', t.id.slice(1));
    for (const c of Array.isArray(t?.clips) ? t.clips : []) {
      if (good('c', c?.id)) raise('c', c.id.slice(1));
      for (const n of Array.isArray(c?.notes) ? c.notes : []) if (good('n', n?.id)) raise('n', n.id.slice(1));
    }
  }
  // the id a thing came with when it is a good one not seen yet, otherwise the next new one
  const take = (kind, id) => {
    const out = good(kind, id) && !seen.has(id) ? id : `${kind}${++ids[kind]}`;
    seen.add(out);
    return out;
  };
  return { ids, take };
}

function normalizeNotes(src, steps, take) {
  const at = new Set();
  const notes = [];
  for (const n of Array.isArray(src) ? src : []) {
    const pitch = int(n?.pitch, NaN);
    const start = round(num(n?.start, NaN), 3);
    if (!(pitch >= LOW && pitch <= HIGH) || !(start >= 0 && start < steps) || at.has(`${pitch}@${start}`)) continue;
    at.add(`${pitch}@${start}`);
    notes.push({
      id: n.id, pitch, start,
      len: round(clamp(num(n.len, 1), Math.min(MIN_NOTE, steps - start), steps - start), 3),   // a note ends with the content at the latest
      vel: round(clamp(num(n.vel, DEFAULT_VEL), 0.01, 1), 3),
    });
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes.slice(0, MAX_NOTES).map((n) => ({ ...n, id: take('n', n.id) }));
}

function normalizeClip(src, kind, take) {
  const bar = clamp(int(src.bar, 0), 0, MAX_BARS - 1);
  const clip = { id: take('c', src.id), bar, bars: clamp(int(src.bars, 1), 1, MAX_BARS - bar), len: clamp(int(src.len, 1), 1, MAX_LEN) };
  const steps = clip.len * STEPS_PER_BAR;
  if (kind === 'drums') {
    clip.rows = Object.fromEntries(VOICES.map((v) => [v.id, Array.from({ length: steps }, (_, s) => round(clamp(num(src.rows?.[v.id]?.[s], 0), 0, 1), 3))]));
  } else clip.notes = normalizeNotes(src.notes, steps, take);
  return clip;
}

export function normalizeProject(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tracks)) throw new Error('not a project');
  const { ids, take } = idMaker(input);
  const tracks = [];
  for (const src of input.tracks) {
    if (!src || !KINDS.includes(src.kind) || tracks.length >= MAX_TRACKS) continue;
    const track = {
      id: take('t', src.id),
      name: String(src.name ?? '').trim().slice(0, 40) || (src.kind === 'drums' ? 'Drums' : 'Synth'),
      kind: src.kind,
      ...(src.kind === 'synth' && { preset: PRESETS[src.preset] ? src.preset : 'lead' }),
      vol: round(clamp(num(src.vol, 0.8), 0, 1), 3),
      pan: round(clamp(num(src.pan, 0), -1, 1), 3),
      mute: !!src.mute,
      solo: !!src.solo,
      reverb: round(clamp(num(src.reverb, 0), 0, 1), 3),
      delay: round(clamp(num(src.delay, 0), 0, 1), 3),
      clips: [],
    };
    const clips = (Array.isArray(src.clips) ? src.clips : []).filter((c) => c && typeof c === 'object').map((c) => normalizeClip(c, src.kind, take));
    for (const clip of clips.sort((a, b) => a.bar - b.bar)) if (!taker(track, clip.bar, clip.bars)) track.clips.push(clip);
    tracks.push(track);
  }
  const out = {
    name: String(input.name ?? '').trim().slice(0, 60) || 'Untitled',
    bpm: round(clamp(num(input.bpm, 120), ...BPM_RANGE), 1),
    swing: round(clamp(num(input.swing, 0), 0, 1), 3),
    bars: 1, loop: null,
    master: round(clamp(num(input.master, 0.8), 0, 1), 3),
    ids, tracks,
  };
  out.bars = clamp(Math.max(int(input.bars, 16), lastBar(out)), 1, MAX_BARS);   // the song is never shorter than its clips
  const from = clamp(int(input.loop?.from, 0), 0, out.bars - 1);
  out.loop = { on: !!input.loop?.on, from, to: clamp(int(input.loop?.to, from + 4), from + 1, out.bars) };
  return out;
}

// ---- drum rows as text

// "kick x...x...x...x..." ( . off, g ghost, o soft, x normal, X accent; | and spaces between steps are ignored).
// A row is whole bars: 16 steps, 32, … A row shorter than the clip's content is repeated to fill it.
export function parseRow(line) {
  const m = /^\s*([A-Za-z][\w-]*)\s*[:=]?\s+(.+)$/.exec(line);
  if (!m) throw new Error(`cannot read the row "${line}" (write it as: kick x...x...x...x...)`);
  const voice = voiceId(m[1]);
  const vel = [...m[2].replace(/[\s|]/g, '')].map(velOfLetter);
  if (!vel.length || vel.length % STEPS_PER_BAR || vel.length > MAX_LEN * STEPS_PER_BAR) {
    throw new Error(`the ${voice} row has ${vel.length} steps; a row is whole bars of 16 steps (at most ${MAX_LEN} bars)`);
  }
  return { voice, vel };
}

// ---- the edits

// A track by its id (t2), its place in the list (2), or its name (Bass, or the start of it).
export function trackOf(project, ref) {
  const key = String(ref ?? '').trim().toLowerCase();
  const tracks = project.tracks;
  const named = tracks.filter((t) => t.name.toLowerCase() === key);
  const starts = tracks.filter((t) => key && t.name.toLowerCase().startsWith(key));
  const found = tracks.find((t) => t.id === key) || (/^\d+$/.test(key) && tracks[Number(key) - 1]) || named[0] || (starts.length === 1 && starts[0]);
  if (found) return found;
  throw new Error(tracks.length ? `no track "${ref}" (there are: ${tracks.map((t) => `${t.id} ${t.name}`).join(', ')})` : `no track "${ref}": the song has no tracks yet`);
}

function clipOf(project, id, kind) {
  const found = findClip(project, String(id ?? '').trim().toLowerCase());
  if (!found) throw new Error(`no clip "${id}" (clips are named c1, c2, …; the arrangement lists them)`);
  if (kind && found.track.kind !== kind) {
    throw new Error(kind === 'drums' ? `${found.clip.id} is a synth clip: it takes notes (C2:0:4), not drum rows` : `${found.clip.id} is a drum clip: it takes rows (kick x...x...x...x...), not notes`);
  }
  return found;
}

const barsText = (bar, bars) => (bars === 1 ? `bar ${bar + 1}` : `bars ${bar + 1}-${bar + bars}`);

function place(track, bar, bars, except) {
  if (bar < 0) throw new Error('bars count from 1');
  if (bars < 1) throw new Error('a clip is at least one bar long');
  if (bar + bars > MAX_BARS) throw new Error(`a song is at most ${MAX_BARS} bars long`);
  const other = taker(track, bar, bars, except);
  if (other) throw new Error(`${barsText(bar, bars)} of ${track.name} will not fit: ${other.id} is at ${barsText(other.bar, other.bars)}`);
}

// a clip's content at a new length: longer repeats what is there, shorter keeps the start
function relen(clip, len) {
  const [old, steps] = [clip.len * STEPS_PER_BAR, len * STEPS_PER_BAR];
  if (clip.rows) for (const v of VOICES) clip.rows[v.id] = Array.from({ length: steps }, (_, s) => clip.rows[v.id][s % old]);
  else {
    const copies = [];
    for (let at = old; at < steps; at += old) copies.push(...clip.notes.map((n) => ({ pitch: n.pitch, start: n.start + at, len: n.len, vel: n.vel })));
    clip.notes.push(...copies);
  }
  clip.len = len;
}

const copyOf = (clip, bar) => {
  const copy = structuredClone(clip);
  delete copy.id;
  for (const n of copy.notes || []) delete n.id;
  return { ...copy, bar };
};

function checkNote(clip, note) {
  const steps = clip.len * STEPS_PER_BAR;
  const pitch = whole(note?.pitch, 'a pitch');
  if (pitch < LOW || pitch > HIGH) throw new Error(`pitch ${pitch} is out of range (${noteName(LOW)} to ${noteName(HIGH)})`);
  const start = want(note.start, 'a start');
  if (start < 0 || start >= steps) {
    throw new Error(`a note at ${start} is outside ${clip.id}: its ${clip.len} ${clip.len === 1 ? 'bar is' : 'bars are'} sixteenths 0 to ${steps - 1} (a longer phrase needs: clip len ${clip.id} <bars>)`);
  }
  return { pitch, start, len: Math.max(MIN_NOTE, num(note.len, 1)), vel: num(note.vel, DEFAULT_VEL) };
}

const sameSpot = (a, b) => a.pitch === b.pitch && Math.abs(a.start - b.start) < 0.0005;

// The edits a project takes. `op.op` names one; the rest of `op` is its arguments. Bars and steps count from 0 here.
export function applyOp(project, op) {
  const p = structuredClone(project);
  switch (op.op) {
    case 'set':
      if (op.key === 'name') p.name = String(op.value ?? '');
      else if (op.key === 'bpm') p.bpm = want(op.value, 'a tempo');
      else if (op.key === 'swing') p.swing = want(op.value, 'a swing amount');
      else if (op.key === 'master') p.master = want(op.value, 'a level');
      else if (op.key === 'bars') {
        const bars = whole(op.value, 'a number of bars');
        if (bars < 1 || bars > MAX_BARS) throw new Error(`a song is 1 to ${MAX_BARS} bars long`);
        if (bars < lastBar(p)) throw new Error(`the clips reach bar ${lastBar(p)}, so the song cannot be shorter than that`);
        p.bars = bars;
      } else throw new Error(`a song has no "${op.key}"`);
      break;
    case 'loop': {                                  // the bars from..to (to is the first bar after the loop)
      const from = op.from === undefined ? p.loop.from : whole(op.from, 'a bar');
      const to = op.to === undefined ? p.loop.to : whole(op.to, 'a bar');
      if (from < 0 || to <= from || to > p.bars) throw new Error(`a loop is a range of bars inside the song (1 to ${p.bars})`);
      p.loop = { on: op.on === undefined ? p.loop.on : !!op.on, from, to };
      break;
    }
    case 'track.add': {
      if (!KINDS.includes(op.kind)) throw new Error(`a track is one of: ${KINDS.join(', ')}`);
      if (p.tracks.length >= MAX_TRACKS) throw new Error(`a song has at most ${MAX_TRACKS} tracks`);
      const preset = op.kind === 'synth' ? presetId(op.preset ?? 'lead') : undefined;
      p.tracks.push({ kind: op.kind, name: String(op.name ?? '').trim() || (preset ? PRESETS[preset].name : 'Drums'), preset, clips: [] });
      break;
    }
    case 'track.del': {
      const t = trackOf(p, op.track);
      p.tracks = p.tracks.filter((other) => other !== t);
      break;
    }
    case 'track.set': {
      const t = trackOf(p, op.track);
      if (op.key === 'name') t.name = String(op.value ?? '').trim() || t.name;
      else if (op.key === 'preset') {
        if (t.kind !== 'synth') throw new Error(`${t.name} is a drum track: it has one kit and no sounds to choose from`);
        t.preset = presetId(op.value);
      } else if (['vol', 'pan', 'reverb', 'delay'].includes(op.key)) t[op.key] = want(op.value, 'a number');
      else if (op.key === 'mute' || op.key === 'solo') t[op.key] = !!op.value;
      else throw new Error(`a track has no "${op.key}" (it has: name, preset, vol, pan, mute, solo, reverb, delay)`);
      break;
    }
    case 'clip.add': {
      const t = trackOf(p, op.track);
      const bar = whole(op.bar, 'a bar');
      const bars = whole(op.bars ?? 4, 'a length in bars');
      place(t, bar, bars);
      const len = op.len === undefined ? (t.kind === 'drums' ? 1 : Math.min(bars, MAX_LEN)) : whole(op.len, 'a length in bars');
      if (len < 1 || len > MAX_LEN) throw new Error(`a clip's content is 1 to ${MAX_LEN} bars long`);
      t.clips.push({ bar, bars, len, ...(t.kind === 'drums' ? { rows: {} } : { notes: [] }) });
      break;
    }
    case 'clip.move': {                             // along its track, or onto another of the same kind
      const { track, clip } = clipOf(p, op.clip);
      const to = op.track === undefined ? track : trackOf(p, op.track);
      if (to.kind !== track.kind) throw new Error(`${clip.id} is a ${track.kind} clip and ${to.name} is a ${to.kind} track`);
      const bar = op.bar === undefined ? clip.bar : whole(op.bar, 'a bar');
      place(to, bar, clip.bars, clip.id);
      clip.bar = bar;
      if (to !== track) { track.clips = track.clips.filter((c) => c !== clip); to.clips.push(clip); }
      break;
    }
    case 'clip.resize': {                           // its length on the timeline: the content repeats or is cut off
      const { track, clip } = clipOf(p, op.clip);
      const bars = whole(op.bars, 'a length in bars');
      place(track, clip.bar, bars, clip.id);
      clip.bars = bars;
      break;
    }
    case 'clip.len': {                              // the length of its content
      const { clip } = clipOf(p, op.clip);
      const len = whole(op.len, 'a length in bars');
      if (len < 1 || len > MAX_LEN) throw new Error(`a clip's content is 1 to ${MAX_LEN} bars long`);
      relen(clip, len);
      break;
    }
    case 'clip.dup': {                              // copies in a row, from `bar` or from the end of the clip
      const { track, clip } = clipOf(p, op.clip);
      const times = whole(op.times ?? 1, 'a number of copies');
      if (times < 1 || times > 64) throw new Error('make 1 to 64 copies at a time');
      const from = op.bar === undefined ? clipEnd(clip) : whole(op.bar, 'a bar');
      for (let i = 0; i < times; i++) {
        place(track, from + i * clip.bars, clip.bars);
        track.clips.push(copyOf(clip, from + i * clip.bars));
      }
      break;
    }
    case 'clip.del': {
      const { track, clip } = clipOf(p, op.clip);
      track.clips = track.clips.filter((c) => c !== clip);
      break;
    }
    case 'clip.clear': {
      const { clip } = clipOf(p, op.clip);
      if (clip.rows) clip.rows = {}; else clip.notes = [];
      break;
    }
    case 'clip.rows': {                             // whole drum rows as text; the rows not named stay as they are
      const { clip } = clipOf(p, op.clip, 'drums');
      const rows = (op.lines || []).map(parseRow);
      if (!rows.length) throw new Error('nothing to write (a row is: kick x...x...x...x...)');
      const longest = Math.max(...rows.map((r) => r.vel.length)) / STEPS_PER_BAR;
      if (longest > clip.len) relen(clip, longest);
      if (op.clear) clip.rows = {};
      for (const row of rows) clip.rows[row.voice] = Array.from({ length: clip.len * STEPS_PER_BAR }, (_, s) => row.vel[s % row.vel.length]);
      break;
    }
    case 'clip.step': {
      const { clip } = clipOf(p, op.clip, 'drums');
      const voice = voiceId(op.voice);
      const step = whole(op.step, 'a step');
      if (step < 0 || step >= clip.len * STEPS_PER_BAR) throw new Error(`step ${step + 1} is not in ${clip.id}: it has ${clip.len * STEPS_PER_BAR} steps`);
      clip.rows[voice][step] = want(op.vel, 'a velocity');
      break;
    }
    case 'clip.notes': {                            // notes as text or as a list; they replace the clip's notes unless `add`
      const { clip } = clipOf(p, op.clip, 'synth');
      const notes = (typeof op.notes === 'string' ? parseNotes(op.notes) : Array.isArray(op.notes) ? op.notes : []).map((n) => checkNote(clip, n));
      if (!notes.length && !(typeof op.notes === 'string' && !op.add)) throw new Error('no notes to write (a note is pitch:start:length, like C2:0:4)');
      const kept = op.add ? clip.notes.filter((old) => !notes.some((n) => sameSpot(n, old))) : [];
      clip.notes = [...kept, ...notes];
      if (clip.notes.length > MAX_NOTES) throw new Error(`a clip holds at most ${MAX_NOTES} notes`);
      break;
    }
    case 'note.add': {
      const { clip } = clipOf(p, op.clip, 'synth');
      const note = checkNote(clip, op);
      if (clip.notes.some((n) => sameSpot(n, note))) throw new Error(`there is a ${noteName(note.pitch)} at ${note.start} already`);
      if (clip.notes.length >= MAX_NOTES) throw new Error(`a clip holds at most ${MAX_NOTES} notes`);
      clip.notes.push(note);
      break;
    }
    case 'note.set': {                              // move a note, or change its length or velocity; it stays inside the content
      const { clip } = clipOf(p, op.clip, 'synth');
      const note = clip.notes.find((n) => n.id === op.note);
      if (!note) throw new Error(`no note "${op.note}" in ${clip.id}`);
      const steps = clip.len * STEPS_PER_BAR;
      if (op.pitch !== undefined) note.pitch = clamp(whole(op.pitch, 'a pitch'), LOW, HIGH);
      if (op.start !== undefined) note.start = clamp(want(op.start, 'a start'), 0, steps - MIN_NOTE);
      if (op.len !== undefined) note.len = Math.max(MIN_NOTE, want(op.len, 'a length'));
      if (op.vel !== undefined) note.vel = want(op.vel, 'a velocity');
      if (clip.notes.some((n) => n !== note && sameSpot(n, note))) throw new Error(`there is a ${noteName(note.pitch)} at ${note.start} already`);
      break;
    }
    case 'note.del': {
      const { clip } = clipOf(p, op.clip, 'synth');
      if (!clip.notes.some((n) => n.id === op.note)) throw new Error(`no note "${op.note}" in ${clip.id}`);
      clip.notes = clip.notes.filter((n) => n.id !== op.note);
      break;
    }
    default:
      throw new Error(`no such edit: ${op.op}`);
  }
  return normalizeProject(p);
}
