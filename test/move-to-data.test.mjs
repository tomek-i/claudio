// tools/move-to-data.mjs: a project folder from before data/ is moved into it, and the tracks' new ids reach everything that
// knows them by id. Runs on scratch folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { migrateLayout, pathMapper } from '../tools/move-to-data.mjs';
import { trackId } from '../apps/server/lib/library.mjs';

const put = (root, files) => { for (const [f, body] of Object.entries(files)) { const p = path.join(root, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 1)); } };
const read = (root, f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const has = (root, f) => fs.existsSync(path.join(root, f));

function oldFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-layout-'));
  const demo = path.join(root, 'library', 'starter', 'Demo.mp3'), mine = path.join(root, 'library', 'downloads', 'Mine.mp3');
  const a = trackId(demo), b = trackId(mine);
  put(root, {
    'config.json': { port: 4747, libraryDirs: ['./library', '~/Music'], downloadDir: './library/downloads' },
    'library/starter/Demo.mp3': 'demo', 'library/downloads/Mine.mp3': 'mine',
    '.dj/library.json': { tracks: [{ id: a, file: demo, title: 'Demo' }, { id: b, file: mine, title: 'Mine' }] },
    '.dj/cues.json': { [a]: { hotcues: [1] } },
    '.dj/grid-edits.json': { [b]: { edit: { shift: 1 } } },
    '.dj/memory.json': { transitions: [{ id: 'mmuw18q93', from: { id: a }, to: { id: b } }] },
    '.dj/active-set.json': { name: 'Friday', played: [b] },
    [`.dj/stems/${a}/meta.json`]: { id: a, source: demo },
    [`.dj/stems/${a}/vocals.wav`]: 'v',
    [`.dj/pcm/${a}-48000-1.wav`]: 'pcm',
    '.dj/sessions/s1/events.jsonl': JSON.stringify({ load: a }) + '\n' + JSON.stringify({ load: b }) + '\n',
    '.dj/produce/beds.mjs': `export default [{ id: '${b}' }];\n`,
    '.dj/desktop-window.json': { maximized: true },
    '.dj/server.log': 'log',
    'sets/friday.json': { name: 'Friday', tracks: [{ id: a }, { id: b }] },
  });
  const now = (f) => path.join(root, 'data', 'dj', 'library', ...f);
  return { root, a, b, A: trackId(now(['demo', 'Demo.mp3'])), B: trackId(now(['downloads', 'Mine.mp3'])), demoNow: now(['demo', 'Demo.mp3']) };
}

test('migrateLayout: the folders move into data/, one place for what is kept, one for what can be made again', () => {
  const { root } = oldFolder();
  try {
    const r = migrateLayout(root);
    assert.deepEqual(r.problems, []);
    for (const f of ['.dj', 'library', 'sets']) assert.ok(!has(root, f), `${f} is gone`);
    for (const f of ['data/dj/library/demo/Demo.mp3', 'data/dj/library/downloads/Mine.mp3', 'data/dj/sets/friday.json', 'data/dj/cues.json', 'data/dj/grid-edits.json', 'data/dj/memory.json', 'data/dj/sessions/s1/events.jsonl', 'data/dj/produce/beds.mjs',
      'data/dj/cache/library.json', 'data/dj/cache/server.log', 'data/desktop/desktop-window.json']) assert.ok(has(root, f), f);
    assert.ok(!has(root, 'data/dj/.layout-plan.json'), 'the plan is deleted once done');
    // the library folders in config.json follow; one outside the project is left alone
    const config = read(root, 'config.json');
    assert.deepEqual(config.libraryDirs, ['./data/dj/library', '~/Music']);
    assert.equal(config.downloadDir, './data/dj/library/downloads');
    assert.equal(config.port, 4747);
    // a second start has nothing to do
    assert.equal(migrateLayout(root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migrateLayout: every track gets the id of its new path, everywhere it was known by the old one', () => {
  const { root, a, b, A, B, demoNow } = oldFolder();
  try {
    assert.equal(migrateLayout(root).tracks, 2);
    const lib = read(root, 'data/dj/cache/library.json').tracks;
    assert.deepEqual(lib.map((t) => [t.id, t.file]), [[A, demoNow], [B, path.join(root, 'data', 'dj', 'library', 'downloads', 'Mine.mp3')]]);
    assert.deepEqual(Object.keys(read(root, 'data/dj/cues.json')), [A]);
    assert.deepEqual(Object.keys(read(root, 'data/dj/grid-edits.json')), [B]);
    const m = read(root, 'data/dj/memory.json').transitions[0];
    assert.deepEqual([m.id, m.from.id, m.to.id], ['mmuw18q93', A, B], 'other ids are left alone');
    assert.deepEqual(read(root, 'data/dj/active-set.json').played, [B]);
    assert.deepEqual(read(root, 'data/dj/sets/friday.json').tracks.map((t) => t.id), [A, B]);
    assert.deepEqual(fs.readFileSync(path.join(root, 'data/dj/sessions/s1/events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).load), [A, B]);
    assert.match(fs.readFileSync(path.join(root, 'data/dj/produce/beds.mjs'), 'utf8'), new RegExp(B));
    // the stems and the decoded audio are renamed, not made again
    assert.ok(!has(root, `data/dj/cache/stems/${a}`) && has(root, `data/dj/cache/stems/${A}/vocals.wav`));
    assert.deepEqual(read(root, `data/dj/cache/stems/${A}/meta.json`), { id: A, source: demoNow });
    assert.deepEqual(fs.readdirSync(path.join(root, 'data/dj/cache/pcm')), [`${A}-48000-1.wav`]);
    assert.notEqual(a, A); assert.notEqual(b, B);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migrateLayout: a move cut short after its plan is finished by running it again', () => {
  const { root, A } = oldFolder();
  try {
    migrateLayout(root);
    // as if step 3 had been cut short: the plan is still there, and the cues still have an old id
    const old = 'deadbeef';
    put(root, { 'data/dj/cues.json': { [old]: { hotcues: [2] } }, 'data/dj/.layout-plan.json': { pairs: [], ids: { [old]: A } } });
    const r = migrateLayout(root);
    assert.ok(r && r.files >= 1);
    assert.deepEqual(read(root, 'data/dj/cues.json'), { [A]: { hotcues: [2] } });
    assert.ok(!has(root, 'data/dj/.layout-plan.json'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migrateLayout: a folder already at the new place is merged into, nothing there is replaced', () => {
  const { root } = oldFolder();
  try {
    put(root, { 'data/dj/sets/friday.json': { name: 'newer' }, 'data/dj/sets/other.json': { name: 'other' } });
    const r = migrateLayout(root);
    assert.equal(read(root, 'data/dj/sets/friday.json').name, 'newer');
    assert.ok(has(root, 'data/dj/sets/other.json'));
    assert.ok(has(root, 'sets/friday.json'), 'the one that could not move stays where it was');
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0], /friday\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('migrateLayout: a fresh folder has nothing to move', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-layout-'));
  try {
    put(root, { 'config.json': { port: 4747 } });
    assert.equal(migrateLayout(root), null);
    assert.ok(!has(root, 'data'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pathMapper: the most particular place wins, and only whole folder names match', () => {
  const r = path.resolve('/proj');
  const map = pathMapper([[path.join(r, 'library', 'starter'), path.join(r, 'data', 'dj', 'library', 'demo')], [path.join(r, 'library'), path.join(r, 'data', 'dj', 'library')]]);
  assert.equal(map(path.join(r, 'library', 'starter', 'x.mp3')), path.join(r, 'data', 'dj', 'library', 'demo', 'x.mp3'));
  assert.equal(map(path.join(r, 'library', 'x.mp3')), path.join(r, 'data', 'dj', 'library', 'x.mp3'));
  assert.equal(map(path.join(r, 'library2', 'x.mp3')), path.join(r, 'library2', 'x.mp3'));
  assert.equal(map('library/x.mp3'), 'library/x.mp3', 'a relative path is not one of ours');
});

test('migrateLayout: the other apps\' folders inside apps/ move to data/<app>', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-layout-'));
  try {
    put(root, { 'config.json': { port: 4747 }, 'apps/drums/.cl-808/state.json': { beat: 1 }, 'apps/synth/.miniclaude/state.json': { patch: 1 }, 'apps/daw/.claudebase/project.json': { song: 1 } });
    const r = migrateLayout(root);
    assert.deepEqual(r.moved, ['apps/drums/.cl-808', 'apps/synth/.miniclaude', 'apps/daw/.claudebase']);
    assert.deepEqual(read(root, 'data/drums/state.json'), { beat: 1 });
    assert.deepEqual(read(root, 'data/synth/state.json'), { patch: 1 });
    assert.deepEqual(read(root, 'data/daw/project.json'), { song: 1 });
    assert.ok(!has(root, 'apps/drums/.cl-808'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('node tools/move-to-data.mjs <folder>: moves it and says what it did; a second run says there is nothing to move', () => {
  const { root } = oldFolder();
  const script = path.join(import.meta.dirname, '..', 'tools', 'move-to-data.mjs');
  try {
    const first = execFileSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.match(first, /^Moved \.dj, library, sets into data\/ \(2 track ids and \d+ files updated\)/);
    assert.ok(has(root, 'data/dj/cache/library.json'));
    assert.match(execFileSync(process.execPath, [script, root], { encoding: 'utf8' }), /Nothing to move/);
    assert.throws(() => execFileSync(process.execPath, [script, path.join(root, 'data')], { stdio: 'pipe' }), /not a project folder/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
