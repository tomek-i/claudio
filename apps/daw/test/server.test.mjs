// The DAW's server on a scratch folder and its own port: edits, undo, notes, the transport, saving, MIDI, and
// the CLI run against it as Claude runs it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { APP_NAME } from '../lib/project.mjs';

const PORT = 4866;
const BASE = `http://127.0.0.1:${PORT}`;
const CLI = fileURLToPath(new URL('../claudebase.mjs', import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebase-test-'));
let server;

const get = async (route) => (await fetch(BASE + route)).json();
async function post(route, body, type = 'application/json') {
  const res = await fetch(BASE + route, { method: 'POST', headers: { 'Content-Type': type }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const edit = async (op) => {
  const { status, body } = await post('/api/op', op);
  assert.equal(status, 200, body.error);
  return body;
};
// the CLI as a command: what it printed, and whether it failed
const daw = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { env: { ...process.env, CLAUDEBASE_PORT: String(PORT) } }, (err, stdout, stderr) => resolve({ ok: !err, out: stdout.trimEnd(), err: stderr.trim() }));
});
const clipIds = (state, track = 0) => state.project.tracks[track].clips.map((c) => `${c.id}@${c.bar}`).join(' ');

before(() => new Promise((resolve) => { server = createServer({ home }); server.listen(PORT, '127.0.0.1', resolve); }));
after(() => { server.closeAllConnections(); server.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('it starts on a template and serves the page and the shared code', async () => {
  const state = await get('/api/state');
  assert.equal(state.project.name, 'Night drive');
  assert.equal(state.project.tracks.length, 4);
  assert.ok(state.templates.includes('Blank'));
  const page = await (await fetch(BASE + '/')).text();
  assert.match(page, new RegExp(`<title>${APP_NAME}</title>`));
  assert.doesNotMatch(page, /%NAME%/);
  assert.match(page, /id="startOverlay" role="dialog"[^]*id="startBtn"[^>]*>Start sound</);   // shown from the first paint, no script needed
  assert.match(await (await fetch(BASE + '/lib/song.mjs')).text(), /eventsInWindow/);
  assert.match(await (await fetch(BASE + '/engine.js')).text(), /OfflineAudioContext/);
  assert.equal((await fetch(BASE + '/lib/../server.mjs')).status, 404);
  assert.equal((await fetch(BASE + '/.claudebase/project.json')).status, 404);
  assert.equal((await fetch(BASE + '/nothing.js')).status, 404);
});

test('an edit changes the song, and a drag is one undo step', async () => {
  await edit({ op: 'template', name: 'blank' });
  await edit({ op: 'clip.add', track: 't1', bar: 0, bars: 2 });
  for (const bar of [1, 2, 3]) await edit({ op: 'clip.move', clip: 'c1', bar, gesture: 'drag-1' });
  assert.equal(clipIds(await get('/api/state')), 'c1@3');
  assert.equal(clipIds(await edit({ op: 'undo' })), 'c1@0');
  const redone = await edit({ op: 'redo' });
  assert.equal(clipIds(redone), 'c1@3');
  assert.equal(redone.canRedo, false);
  await edit({ op: 'undo' });
  await edit({ op: 'undo' });
  const blank = await edit({ op: 'undo' });                                 // back before the template
  assert.equal(blank.project.name, 'Night drive');
  assert.equal(blank.canUndo, false);
  await edit({ op: 'redo' });
});

test('a bad edit is refused with a reason and changes nothing', async () => {
  const before = await get('/api/state');
  for (const op of [{ op: 'clip.add', track: 'gong', bar: 0, bars: 1 }, { op: 'clip.move', clip: 'c99', bar: 0 }, { op: 'set', key: 'bpm', value: 'x' }, { op: 'template', name: 'polka' }, { op: 'replace', project: 7 }, { op: 'batch', ops: [{ op: 'set', key: 'bpm', value: 90 }, { op: 'nope' }] }, { op: 'batch' }, { op: 'nope' }, {}]) {
    const { status, body } = await post('/api/op', op);
    assert.equal(status, 400);
    assert.ok(body.error);
  }
  assert.equal((await post('/api/op', { op: 'undo' }, 'text/plain')).status, 400);   // what another site's page could send
  assert.equal((await post('/api/transport', { action: 'rewind' })).status, 400);
  assert.equal((await get('/api/state')).rev, before.rev);
});

test('a note typed on the page reaches a waiting CLI once, and the answer is shown', async () => {
  const waiting = get('/api/wait?ms=5000');
  await post('/api/ask', { text: 'a bass line please' });
  assert.deepEqual((await waiting).notes.map((n) => n.text), ['a bass line please']);
  assert.deepEqual((await get('/api/wait?ms=0')).notes, []);
  await post('/api/say', { text: 'bass on bars 1-4' });
  assert.deepEqual((await get('/api/state')).notes.map((n) => n.from), ['you', 'claude']);
});

test('the page is told of every change, and of play and stop', async () => {
  assert.deepEqual((await post('/api/transport', { action: 'play', bar: 0 })).body, { pages: 0, awake: false });   // nobody is listening
  const res = await fetch(BASE + '/api/events');
  const reader = res.body.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  const first = JSON.parse((await read()).replace(/^data: /, ''));
  await edit({ op: 'set', key: 'swing', value: 0.33 });
  const next = JSON.parse((await read()).replace(/^data: /, ''));
  assert.equal(next.rev, first.rev + 1);
  assert.equal(next.project.swing, 0.33);
  assert.deepEqual((await post('/api/transport', { action: 'play', bar: 2 })).body, { pages: 1, awake: false });   // a page, not clicked yet
  assert.equal(await read(), 'event: transport\ndata: {"action":"play","bar":2}\n\n');
  assert.equal((await post('/api/transport', { action: 'play', bar: 99 })).status, 400);
  await post('/api/sound', { awake: true });                                 // "Start sound" was clicked
  assert.deepEqual((await post('/api/transport', { action: 'stop' })).body, { pages: 1, awake: true });
  assert.equal(await read(), 'event: transport\ndata: {"action":"stop"}\n\n');
  await reader.cancel();                                                     // the page is closed, or loaded again: the click is forgotten
  for (let i = 0; i < 50 && server.store.listeners.size; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(server.store.awake, false);
});

test('Claude composes through the CLI: tracks, clips, rows and notes, each printed back', async () => {
  assert.match((await daw('help')).out, new RegExp(`^${APP_NAME} — http://localhost:${PORT}`));
  assert.match((await daw('new', 'blank')).out, /^"Blank"  120 bpm .* 8 bars/);
  assert.equal((await daw('new')).out, 'Night drive\nSlow tape\nBlank');
  assert.match((await daw('tempo', '128')).out, /128 bpm/);

  const beat = await daw('clip', 'add', 'drums', '1', '4', 'kick x...x...x...x...', 'clap ....x.......x...');
  assert.deepEqual(beat.out.split('\n'), [
    'c1  t1 Drums (drums)  bars 1-4  1 bar ×4, 6 hits',
    '       1...2...3...4...',
    'kick   x...x...x...x...',
    'clap   ....x.......x...',
  ]);
  assert.match((await daw('hit', 'c1', 'hat', '3', 'ghost')).out, /hat    \.\.g\.{13}/);
  assert.match((await daw('drums', 'c1', 'hat ..x...x...x...x.')).out, /hat    \.\.x\.\.\.x\.\.\.x\.\.\.x\./);

  const line = await daw('clip', 'add', 'bass', '1', '2', 'A1:0:4 A1:6:2', 'C2:16:4 E2:22:2:110');
  assert.equal(line.out.split('\n')[0], 'c2  t2 Bass (bass)  bars 1-2  4 notes');
  assert.match(line.out, /bar 2 \(from 16\): C2:16:4 E2:22:2:110/);
  assert.match((await daw('notes', 'c2', '--add', 'G1:28:4')).out, /5 notes/);
  assert.match((await daw('notes', 'c2', '--del', 'A1:6', 'G1:28')).out, /3 notes/);
  assert.match((await daw('undo')).out, /c2 1-2 \(5 notes\)/);              // the two removed notes were one step

  assert.match((await daw('track', 'add', 'synth', 'Warm', 'chords', 'pad')).out, /t3 Warm chords  pad/);
  assert.match((await daw('mix', 't3', 'pan', 'L40')).out, /t3 .*vol 80  pan L40/);
  assert.match((await daw('mix', 'warm', 'reverb', '35')).out, /pan L40  reverb 35/);
  assert.match((await daw('mix', '1', 'mute')).out, /t1 Drums .*muted/);
  assert.doesNotMatch((await daw('mix', '1', 'mute', 'off')).out, /muted/);

  const arranged = await daw('clip', 'dup', 'c2', '3', '2');
  assert.match(arranged.out, /t2 Bass  bass +\[\]\[\]\[\]\.\./);
  assert.match(arranged.out, /c2 1-2 \(5 notes\) · c3 3-4 \(=c2\) · c4 5-6 \(=c2\)/);
  assert.match((await daw('clip', 'move', 'c4', '7')).out, /\[\]\[\]\.\.\[\]/);
  assert.match((await daw('clip', 'resize', 'c1', '8')).out, /t1 Drums  drums +\[======\]/);
  assert.match((await daw('clip', 'len', 'c3', '1')).out, /first 1 of 2 bars|bars 3-4  1 bar ×2/);
  assert.match((await daw('loop', '1', '4')).out, /loop 1-4 on/);
  assert.match((await daw('show', 'clip', 'c1')).out, /^c1  t1 Drums \(drums\)  bars 1-8/);
  assert.equal(JSON.parse((await daw('show', '--json')).out).tracks.length, 3);
  assert.match((await daw('clip', 'del', 'c4')).out, /\[\]\[\]\.\.\.\./);
});

test('the CLI says what is wrong, and a clip whose content cannot be read is not left behind', async () => {
  const before = (await get('/api/state')).project;
  for (const [args, reason] of [
    [['clip', 'add', 'drums', '9', '2', 'kick x.x'], /whole bars of 16 steps/],
    [['clip', 'add', 'bass', '9', '1', 'C2:20:4'], /outside c\d+: its 1 bar is sixteenths 0 to 15/],
    [['clip', 'add', 'bass', '1', '2'], /will not fit: c2 is at bars 1-2/],
    [['clip', 'add', 'tuba', '1', '2'], /no track "tuba"/],
    [['notes', 'c1', 'C2:0:4'], /c1 is a drum clip/],
    [['mix', 'bass', 'width', '3'], /mix has no "width"/],
    [['tempo'], /missing: a tempo/],
    [['frobnicate'], /no command "frobnicate"/],
  ]) {
    const run = await daw(...args);
    assert.equal(run.ok, false, args.join(' '));
    assert.match(run.err, reason);
  }
  assert.deepEqual((await get('/api/state')).project, before);
  assert.equal((await get('/api/state')).canRedo, false);                    // not even as something to redo
});

test('play and stop from the CLI, notes from the page, and the MIDI file', async () => {
  assert.match((await daw('play', '3')).out, /no page is open/);
  const res = await fetch(BASE + '/api/events');                             // a page
  const reader = res.body.getReader();
  await reader.read();
  assert.match((await daw('play', '3')).out, /^playing from bar 3 on the page \(sent, but the page's sound is off .*: click Start sound on the page\)$/);
  await reader.read();
  await post('/api/sound', { awake: true });
  assert.equal((await daw('play', '3')).out, 'playing from bar 3 on the page');
  assert.match(new TextDecoder().decode((await reader.read()).value), /"action":"play","bar":2/);
  assert.equal((await daw('stop')).out, 'stopped');
  await reader.cancel();

  await post('/api/ask', { text: 'more hats' });
  assert.equal((await daw('wait', '1')).out, 'note: more hats');
  assert.equal((await daw('wait', '0')).out, '(no notes)');
  assert.equal((await daw('say', 'hats', 'doubled')).out, 'said');
  assert.equal((await get('/api/state')).notes.at(-1).text, 'hats doubled');

  const file = path.join(home, 'out.mid');
  assert.match((await daw('export', 'midi', file)).out, /^wrote /);
  assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), 'MThd');
  const direct = await fetch(BASE + '/api/export.mid');
  assert.equal(direct.headers.get('content-type'), 'audio/midi');
  assert.match(direct.headers.get('content-disposition'), /filename="Blank\.mid"/);
});

test('the song is saved and comes back after a restart', async () => {
  await edit({ op: 'set', key: 'name', value: 'Kept' });
  server.store.flush();
  const again = createServer({ home });
  assert.equal(again.store.project.name, 'Kept');
  assert.deepEqual(again.store.project, server.store.project);
  assert.equal(again.store.state().canUndo, false);
});

test('GET /api/ping says which app this is, open to the pages of the other apps (their Apps menus)', async () => {
  const res = await fetch(BASE + '/api/ping');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await res.json(), { app: 'daw', name: 'Claudebase' });
});
