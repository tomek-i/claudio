// Moves a project folder from the layout before data/ (.dj/, library/ and sets/ at the top, and the other apps'
// apps/drums/.cl-808, apps/synth/.miniclaude, apps/daw/.claudebase) into data/. Run it once, by hand, with nothing
// of the rig running:
//   node tools/move-to-data.mjs                 this project folder
//   node tools/move-to-data.mjs <folder>        another one (the installed app's Documents/DJ Claude, say)
// It does nothing on a folder that has nothing of the old layout left.
//
// A track's id is a hash of its file's full path (trackId in library.mjs), so moving the music gives every track a
// new id, and the stems, cues, grid edits, memory, sets and sessions all know tracks by id. So the move:
//  1. moves the folders (a folder already at the new place is merged into, nothing there is replaced);
//  2. writes down the plan: which paths became which, and which ids became which (data/dj/.layout-plan.json);
//  3. rewrites the JSON (and .mjs, for produce designs) under data/dj with the new paths and ids, renames the stem
//     folders and decoded audio, and changes config.json's library folders;
//  4. deletes the plan. A run that finds a plan does 3 again, so a move cut short is finished by running it again.
// What cannot be moved (a file another program holds open, say a server.log of a server still running) stays where
// it was and is reported.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackId } from '../apps/server/lib/library.mjs';

const WIN = process.platform === 'win32';
const TO_CACHE = ['library.json', 'pcm', 'stems', 'models', 'server.log'];   // of .dj/: what can be made again
const TO_DESKTOP = ['desktop-window.json', 'app-build'];                     // of .dj/: the desktop app's
const ID = /\b[0-9a-f]{8}\b/g;
const PLAN = '.layout-plan.json';
const APPS = [['drums', '.cl-808'], ['synth', '.miniclaude'], ['daw', '.claudebase']]; // the other apps' old folders

// from → to, merging into a folder that is already there; what cannot be moved is added to problems
function moveInto(from, to, problems) {
  if (!fs.existsSync(from)) return false;
  const dir = fs.statSync(from).isDirectory();
  if (!fs.existsSync(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); return true; } catch (e) {
      if (!dir) { problems.push(`${from} (${e.code})`); return false; }
      fs.mkdirSync(to); // a folder with something open in it: move what can be moved, one by one
    }
  }
  if (!dir || !fs.statSync(to).isDirectory()) { problems.push(`${from} (${to} is already there)`); return false; }
  for (const n of fs.readdirSync(from)) moveInto(path.join(from, n), path.join(to, n), problems);
  try { fs.rmdirSync(from); } catch { /* something stayed behind, and is reported */ }
  return true;
}

// a string that is a path at or under one of the plan's old places → the same path under the new one
export function pathMapper(pairs) {
  const norm = (s) => (WIN ? s.replace(/\//g, '\\').toLowerCase() : s);
  const ps = pairs.map(([from, to]) => [norm(from), from.length, to]);
  return (s) => {
    if (typeof s !== 'string' || !path.isAbsolute(s)) return s;
    const n = norm(s);
    for (const [from, len, to] of ps) if (n === from || n.startsWith(from + path.sep)) return to + s.slice(len);
    return s;
  };
}

const mapDeep = (v, fix) => {
  if (typeof v === 'string') return fix(v);
  if (Array.isArray(v)) return v.map((x) => mapDeep(x, fix));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [fix(k), mapDeep(x, fix)]));
  return v;
};

function rewrite(file, fix) {
  const text = fs.readFileSync(file, 'utf8');
  let out;
  if (file.endsWith('.mjs')) out = fix(text, true);
  else if (file.endsWith('.jsonl')) out = text.split('\n').map((l) => { try { return l.trim() ? JSON.stringify(mapDeep(JSON.parse(l), fix)) : l; } catch { return l; } }).join('\n');
  else {
    let v; try { v = JSON.parse(text); } catch { return false; }
    const indent = text.match(/^[[{]\r?\n( +)/)?.[1].length || 0;
    out = JSON.stringify(mapDeep(v, fix), null, indent) + (text.endsWith('\n') ? '\n' : '');
  }
  if (out === text) return false;
  fs.writeFileSync(file, out);
  return true;
}

function* files(dir, skip) {
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(p)) yield* files(p, skip); } else if (/\.(json|jsonl|mjs)$/.test(e.name) && e.name !== PLAN) yield p;
  }
}

// root: the project folder. Returns null when there was nothing to do, else { moved, tracks, files, problems }.
export function migrateLayout(root) {
  const old = { dj: path.join(root, '.dj'), library: path.join(root, 'library'), sets: path.join(root, 'sets') };
  const data = path.join(root, 'data'), dj = path.join(data, 'dj'), cache = path.join(dj, 'cache'), desktop = path.join(data, 'claudio');
  const lib = path.join(dj, 'library'), planFile = path.join(dj, PLAN);
  const moved = [], problems = [];
  let plan = null;
  try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch { /* none: a move cut short leaves one */ }
  const appsOld = APPS.map(([app, name]) => [path.join(root, 'apps', app, name), path.join(data, app)]);
  if (!plan && ![...Object.values(old), ...appsOld.map(([from]) => from)].some((p) => fs.existsSync(p))) return null;

  if (!plan) {
    // 1. the folders. Older paths first in the plan: the more particular place wins.
    const pairs = [];
    if (fs.existsSync(old.dj)) {
      for (const n of fs.readdirSync(old.dj)) {
        const from = path.join(old.dj, n);
        if (n === 'app-build' && fs.existsSync(path.join(desktop, n))) { fs.rmSync(from, { force: true }); continue; } // the desktop app wrote its own already
        const to = path.join(TO_CACHE.includes(n) ? cache : TO_DESKTOP.includes(n) ? desktop : dj, n);
        if (moveInto(from, to, problems)) pairs.push([from, to]);
      }
      try { fs.rmdirSync(old.dj); } catch { /* something stayed behind */ }
      moved.push('.dj');
      pairs.push([old.dj, dj]);
    }
    if (moveInto(old.library, lib, problems)) {
      moved.push('library');
      if (moveInto(path.join(lib, 'starter'), path.join(lib, 'demo'), problems)) pairs.push([path.join(old.library, 'starter'), path.join(lib, 'demo')]);
      pairs.push([old.library, lib]);
    }
    if (moveInto(old.sets, path.join(dj, 'sets'), problems)) { moved.push('sets'); pairs.push([old.sets, path.join(dj, 'sets')]); }
    for (const [from, to] of appsOld) if (moveInto(from, to, problems)) moved.push(path.relative(root, from).replace(/\\/g, '/'));

    // 2. the plan: the paths, and the ids of the tracks whose files moved
    const mapPath = pathMapper(pairs), ids = {};
    try {
      for (const t of JSON.parse(fs.readFileSync(path.join(cache, 'library.json'), 'utf8')).tracks || []) {
        const file = mapPath(t.file);
        if (file !== t.file && t.id) ids[t.id] = trackId(file);
      }
    } catch { /* no analysis cache: no ids to change */ }
    plan = { pairs, ids };
    fs.mkdirSync(dj, { recursive: true });
    fs.writeFileSync(planFile, JSON.stringify(plan));
  }

  // 3. what refers to the old paths and ids
  const mapPath = pathMapper(plan.pairs), ids = new Map(Object.entries(plan.ids));
  const fixId = (s) => (ids.size ? s.replace(ID, (m) => ids.get(m) ?? m) : s);
  const fix = (s, code = false) => (code ? fixId(s) : fixId(mapPath(s)));
  let changed = 0;
  for (const f of files(dj, new Set([lib, path.join(cache, 'pcm'), path.join(cache, 'models')]))) if (rewrite(f, fix)) changed++;
  for (const [sub, rename] of [['stems', (n) => ids.get(n)], ['pcm', (n) => ids.has(n.slice(0, 8)) && ids.get(n.slice(0, 8)) + n.slice(8)]]) {
    const dir = path.join(cache, sub);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const to = rename(n);
      if (to && !fs.existsSync(path.join(dir, to))) try { fs.renameSync(path.join(dir, n), path.join(dir, to)); } catch (e) { problems.push(`${path.join(dir, n)} (${e.code})`); }
    }
  }
  const configFile = path.join(root, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const move = (d) => {
      if (typeof d !== 'string' || d.startsWith('~')) return d;
      const was = path.resolve(root, d), now = mapPath(was);
      return now === was ? d : path.isAbsolute(d) ? now : './' + path.relative(root, now).replace(/\\/g, '/');
    };
    const next = { ...config, ...(config.libraryDirs && { libraryDirs: config.libraryDirs.map(move) }), ...(config.downloadDir && { downloadDir: move(config.downloadDir) }) };
    if (JSON.stringify(next) !== JSON.stringify(config)) { fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n'); changed++; }
  } catch { /* no config.json to change */ }

  // 4. done
  fs.rmSync(planFile, { force: true });
  return { moved, tracks: ids.size, files: changed, problems };
}

// the lines to show for what migrateLayout() returned
export function layoutReport(r) {
  if (!r) return [];
  const out = [`Moved ${r.moved.length ? r.moved.join(', ') : 'the rest'} into data/ (${r.tracks} track id${r.tracks === 1 ? '' : 's'} and ${r.files} file${r.files === 1 ? '' : 's'} updated)`];
  for (const p of r.problems) out.push(`  could not move ${p}: stop anything still using it and run this again`);
  return out;
}

// run as a script: the folder given, or the project this file is in
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (!fs.existsSync(path.join(root, 'config.json'))) { console.error(`${root} is not a project folder (no config.json in it)`); process.exit(1); }
  const r = migrateLayout(root);
  console.log(r ? layoutReport(r).join('\n') : `Nothing to move in ${root}: it is already laid out with data/.`);
  process.exit(r?.problems.length ? 1 : 0);
}
