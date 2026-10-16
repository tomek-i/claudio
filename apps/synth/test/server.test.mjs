// The synth's server on a scratch folder and its own port: edits, undo, slots, the sequence, play requests,
// notes, saving. And the CLI, run as a real process against that server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { APP_NAME } from '../lib/app.mjs';
import { rowText } from '../lib/seq.mjs';

const PORT = 4864;
const BASE = `http://127.0.0.1:${PORT}`;
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'miniclaude.mjs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'miniclaude-test-'));
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
const patch = (state) => state.slots[state.slot];
// the CLI as Claude runs it; resolves with what it printed and how it ended
const cli = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { env: { ...process.env, MINICLAUDE_PORT: String(PORT) } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout.trimEnd(), err: stderr.trim() }));
});
// the event stream as a page reads it: next() gives the next event as { event, data }
async function listen() {
  const res = await fetch(BASE + '/api/events');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async () => {
    while (!buffer.includes('\n\n')) buffer += decoder.decode((await reader.read()).value, { stream: true });
    const block = buffer.slice(0, buffer.indexOf('\n\n'));
    buffer = buffer.slice(block.length + 2);
    return { event: /^event: (.+)$/m.exec(block)?.[1] ?? 'message', data: JSON.parse(/^data: (.+)$/m.exec(block)[1]) };
  };
  return { next, close: () => reader.cancel() };
}

before(() => new Promise((resolve) => { server = createServer({ home }); server.listen(PORT, '127.0.0.1', resolve); }));
after(() => { server.closeAllConnections(); server.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('it starts with four patches and a riff, and serves the page and the shared code', async () => {
  const state = await get('/api/state');
  assert.equal(state.slot, 'A');
  assert.deepEqual(Object.values(state.slots).map((p) => p.name), ['Acid bass', 'Warm pad', 'Pluck', 'Electric keys']);
  assert.ok(state.presets.length >= 10);
  assert.ok(state.seq.steps.filter(Boolean).length > 4);
  const page = await (await fetch(BASE + '/')).text();
  assert.ok(page.includes(`<title>${APP_NAME}</title>`) && !page.includes('%NAME%'));
  assert.match(page, /id="startOverlay" role="dialog"[^]*id="startBtn"[^>]*>Start sound</);   // shown from the first paint, no script needed
  assert.ok(!page.includes('Turn the sound on'));
  assert.match(page, /<\/main>\s*<\/div>\s*(<!--[^>]*-->\s*)?<section class="board"[^>]*>[^]*id="fold"/);   // the keyboard comes after the page, with its "hide"
  assert.match(page, /<div class="room">\s*(<!--[^>]*-->\s*)?<aside class="browser"[^]*<main>/);   // the preset browser is beside the page, not in it
  assert.doesNotMatch(await (await fetch(BASE + '/style.css')).text(), /\.board \{[^}]*position:/);   // and is not laid over it
  assert.match(await (await fetch(BASE + '/lib/patch.mjs')).text(), /PARAMS/);
  assert.match(await (await fetch(BASE + '/engine.js')).text(), /class Synth/);
  for (const file of ['app.js', 'engine.js', 'browser.js']) {                       // what the page imports is all there to be served
    const source = fs.readFileSync(path.join(path.dirname(CLI), 'public', file), 'utf8');
    for (const [, from] of source.matchAll(/from '([^']+)'/g)) assert.equal((await fetch(new URL(from, `${BASE}/${file}`))).status, 200, from);
  }
  assert.equal((await fetch(BASE + '/lib/../server.mjs')).status, 404);
  assert.equal((await fetch(BASE + '/.miniclaude/state.json')).status, 404);
});

test('an edit changes the patch, and a drag is one undo step', async () => {
  await edit({ op: 'set', param: 'filter.cutoff', value: 1000 });
  for (const value of [1100, 1200, 1300]) await edit({ op: 'set', param: 'filter.cutoff', value, gesture: 'drag-1' });
  assert.equal(patch(await get('/api/state'))['filter.cutoff'], 1300);
  assert.equal(patch(await edit({ op: 'undo' }))['filter.cutoff'], 1000);
  const redone = await edit({ op: 'redo' });
  assert.equal(patch(redone)['filter.cutoff'], 1300);
  assert.equal(redone.canRedo, false);
  const many = await edit({ op: 'set', values: { resonance: '50%', 'osc2.level': 0.4, 'lfo.dest': 'filter' } });
  assert.deepEqual([patch(many)['filter.resonance'], patch(many)['osc2.level'], patch(many)['lfo.dest']], [0.5, 0.4, 'filter']);
  assert.equal(patch(await edit({ op: 'undo' }))['osc2.level'], 0);     // several at once are one step too
});

test('a bad edit is refused with a reason and changes nothing', async () => {
  const before = await get('/api/state');
  const bad = [
    { op: 'set', param: 'filter.cutoff', value: 5 }, { op: 'set', param: 'nope', value: 1 }, { op: 'set', param: 'osc1.wave', value: 'pulse' },
    { op: 'preset', name: 'trombone' }, { op: 'slot', slot: 'E' }, { op: 'copy', to: 'A' }, { op: 'row', text: 'C2 D2 E2' },
    { op: 'step', step: 99, token: 'C2' }, { op: 'nope' }, {},
  ];
  for (const op of bad) {
    const { status, body } = await post('/api/op', op);
    assert.equal(status, 400, JSON.stringify(op));
    assert.ok(body.error);
  }
  assert.equal((await post('/api/op', { op: 'init' }, 'text/plain')).status, 400);   // what another site's page could send
  assert.equal((await post('/api/play', { action: 'dance' })).status, 400);
  assert.equal((await post('/api/play', { action: 'notes', notes: [999] })).status, 400);
  assert.deepEqual(await get('/api/state'), before);
});

test('slots hold their own patches; presets, init, naming and copying are undo steps', async () => {
  await edit({ op: 'slot', slot: 'B' });
  const loaded = await edit({ op: 'preset', name: 'saw lead' });
  assert.equal(patch(loaded).name, 'Saw lead');
  assert.equal(loaded.slots.A['filter.cutoff'], 1300);
  assert.equal(patch(await edit({ op: 'name', value: 'My lead' })).name, 'My lead');
  assert.equal((await edit({ op: 'copy', to: 'D' })).slots.D.name, 'My lead');
  assert.equal((await edit({ op: 'undo' })).slots.D.name, 'Electric keys');
  assert.equal(patch(await edit({ op: 'init' }))['osc1.wave'], 'saw');
  assert.equal(patch(await edit({ op: 'undo' })).name, 'My lead');
  const back = await edit({ op: 'slot', slot: 'A' });
  assert.equal(patch(back).name, 'Acid bass');
  assert.equal(back.canUndo, true);                                    // changing slot is not itself an undo step
});

test('the sequence is written as a row, step by step, and undone with the rest', async () => {
  const written = await edit({ op: 'row', text: 'C2 . G2 -' });
  assert.equal(rowText(written.seq), 'C2 . G2 - | C2 . G2 - | C2 . G2 - | C2 . G2 -');
  const stepped = await edit({ op: 'step', step: 1, notes: [48, 55] });
  assert.equal(rowText(stepped.seq).slice(0, 15), 'C2 C3+G3 G2 - |');
  assert.equal((await edit({ op: 'seqparam', key: 'bpm', value: 97 })).seq.bpm, 97);
  assert.equal((await edit({ op: 'undo' })).seq.bpm, 118);
  assert.equal(rowText((await edit({ op: 'undo' })).seq).slice(0, 11), 'C2 . G2 - |');
  await edit({ op: 'redo' });
  await edit({ op: 'redo' });
});

test('a play request reaches the open pages as an event and leaves the state alone', async () => {
  assert.deepEqual((await post('/api/play', { action: 'seq' })).body, { pages: 0, awake: false });
  const page = await listen();
  const first = await page.next();
  assert.equal(first.event, 'message');
  assert.deepEqual((await post('/api/play', { action: 'notes', notes: [48, 55], seconds: 2 })).body, { pages: 1, awake: false });
  assert.deepEqual(await page.next(), { event: 'play', data: { action: 'notes', notes: [48, 55], seconds: 2, vel: 0.8 } });
  await post('/api/transport', { playing: false, awake: true });       // the page saying its sound is on
  assert.deepEqual((await post('/api/play', { action: 'seq', loops: 2 })).body, { pages: 1, awake: true });
  assert.deepEqual(await page.next(), { event: 'play', data: { action: 'seq', loops: 2 } });
  await post('/api/play', { action: 'stop' });
  assert.deepEqual((await page.next()).data, { action: 'stop' });
  // and an edit is told to the page as the new state
  await edit({ op: 'set', param: 'master.volume', value: 0.5 });
  const next = await page.next();
  assert.equal(next.event, 'message');
  assert.equal(next.data.rev, first.data.rev + 1);
  assert.equal(next.data.slots.A['master.volume'], 0.5);
  await page.close();
});

test('a note typed on the page reaches a waiting CLI once, and the answer is shown', async () => {
  const waiting = get('/api/wait?ms=5000');
  await post('/api/ask', { text: 'make it darker' });
  assert.deepEqual((await waiting).notes.map((n) => n.text), ['make it darker']);
  assert.deepEqual((await get('/api/wait?ms=0')).notes, []);
  await post('/api/say', { text: 'cutoff is down to 400 Hz' });
  assert.deepEqual((await get('/api/state')).notes.map((n) => n.from), ['you', 'claude']);
});

test('the CLI prints the patch as text, sets parameters by name, writes the sequence and says what went wrong', async () => {
  const help = await cli('help');
  assert.ok(help.out.startsWith(`${APP_NAME} synthesizer`));
  const shown = (await cli('show')).out.split('\n');
  assert.equal(shown[0], 'slot A  "Acid bass"');
  assert.equal(shown.length, 14);                                      // the title, eleven sections, two lines of sequence
  assert.equal(shown[1], 'osc1    wave saw   octave -1   semi 0   fine 0   level 0.8');
  assert.equal(shown.at(-1), '        C2 C3+G3 G2 - | C2 . G2 - | C2 . G2 - | C2 . G2 -');

  const set = await cli('set', 'cutoff', '640', 'filter.resonance', '45%', 'osc2.wave', 'square');
  assert.equal(set.out, 'slot A  "Acid bass"\nfilter  cutoff 640   resonance 0.45   env 3.6   keytrack 0.3\nosc2    wave square   octave 0   semi 0   fine 0   level 0');
  assert.equal((await cli('undo')).out.split('\n')[4], 'filter  cutoff 1300   resonance 0.78   env 3.6   keytrack 0.3');

  assert.equal((await cli('seq', 'C2 . C3 - | Eb2 . C3! G2 | C2 . Bb2 C3 | . G2 Bb2 -')).out, 'seq     97 bpm   gate 0.6   swing 0\n        C2 . C3 - | Eb2 . C3! G2 | C2 . Bb2 C3 | . G2 Bb2 -');
  assert.match((await cli('step', '2', 'Eb2+G2')).out, /C2 Eb2\+G2 C3 - \|/);
  assert.match((await cli('bpm', '126')).out, /^seq {5}126 bpm/);
  assert.match((await cli('swing', '30')).out, /swing 0\.3$/m);
  assert.match((await cli('transpose', '12')).out, /C3 Eb3\+G3 C4 - \|/);
  assert.match((await cli('preset')).out, /^bass {3}Acid bass$/m);
  assert.equal((await cli('preset', 'glass')).out.split('\n')[0], 'slot A  "Glass pad"');
  assert.equal((await cli('name', 'Frosted', 'glass')).out, 'slot A  "Frosted glass"');
  assert.equal((await cli('play', '2')).out, `no page is open, so nothing sounds: open http://localhost:${PORT}`);
  assert.equal(JSON.parse((await cli('show', '--json')).out).patch.name, 'Frosted glass');
  assert.equal((await cli('params')).out.split('\n').length, 37);

  for (const [args, reason] of [[['set', 'cutoff', '5'], /✗ filter\.cutoff goes from 20 to 18000 Hz/], [['set', 'level', '1'], /which "level"/], [['set', 'cutoff'], /pairs/], [['seq', 'C2 D2 E2'], /16 steps/], [['step', '0', 'C2'], /not a step/], [['note', 'H9'], /not a note/], [['frobnicate'], /no command/]]) {
    const bad = await cli(...args);
    assert.equal(bad.code, 1, args.join(' '));
    assert.match(bad.err, reason);
  }
});

test('the CLI tells a page to sound, hears a note from it and answers', async () => {
  const page = await listen();
  await page.next();
  await post('/api/transport', { playing: false, awake: false });
  assert.match((await cli('note', 'C3', 'Eb3', 'G3', '2s')).out, /^sounding C3 Eb3 G3 for 2 s \(sent, but the page's sound is off .*: click Start sound on the page\)$/);
  assert.deepEqual((await page.next()).data, { action: 'notes', notes: [48, 51, 55], seconds: 2, vel: 0.8 });
  await post('/api/transport', { playing: false, awake: true });
  assert.equal((await cli('play')).out, 'playing the sequence until: stop');
  assert.deepEqual((await page.next()).data, { action: 'seq', loops: 0 });
  assert.equal((await cli('stop')).out, 'stopped');
  await page.close();
  for (let i = 0; i < 50 && server.store.listeners.size; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(server.store.transport.awake, false);                   // the page is gone, and its click with it
  const waiting = cli('wait', '5');
  await new Promise((r) => setTimeout(r, 300));
  await post('/api/ask', { text: 'more bite' });
  assert.equal((await waiting).out, 'note: more bite');
  assert.equal((await cli('wait', '0')).out, '(no notes)');
  assert.equal((await cli('say', 'resonance', 'up')).out, 'said');
  assert.equal((await get('/api/state')).notes.at(-1).text, 'resonance up');
});

test('a sound saved as a preset is listed first, loads by name, survives a restart and can be deleted', async () => {
  await edit({ op: 'preset', name: 'hoover' });
  await edit({ op: 'set', values: { 'filter.cutoff': 1100 } });
  const saved = await edit({ op: 'savepreset', name: 'Night hoover' });
  assert.equal(patch(saved).name, 'Night hoover');                    // the patch takes the name it is saved under
  assert.deepEqual(saved.presets[0], { name: 'Night hoover', kind: 'saved', saved: true });
  await edit({ op: 'preset', name: 'pluck' });
  const loaded = patch(await edit({ op: 'preset', name: 'night' }));
  assert.equal(loaded.name, 'Night hoover');
  assert.equal(loaded['filter.cutoff'], 1100);
  // the same name again replaces it, whatever its case
  await edit({ op: 'set', values: { 'filter.cutoff': 1500 } });
  assert.equal((await edit({ op: 'savepreset', name: 'night HOOVER' })).presets.filter((p) => p.saved).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'presets.json'), 'utf8')).presets[0]['filter.cutoff'], 1500);
  assert.equal(createServer({ home }).store.saved[0].name, 'night HOOVER');

  for (const [op, reason] of [[{ op: 'savepreset', name: 'Acid Bass' }, /built-in/], [{ op: 'savepreset', name: '  ' }, /needs a name/],
    [{ op: 'deletepreset', name: 'Pluck' }, /cannot be deleted/], [{ op: 'deletepreset', name: 'nope' }, /no saved preset "nope" \(saved: night HOOVER\)/]]) {
    const { status, body } = await post('/api/op', op);
    assert.equal(status, 400);
    assert.match(body.error, reason);
  }

  assert.equal((await cli('preset', 'save', 'Tape', 'pluck')).out, 'slot A  "Tape pluck"  saved as a preset');
  assert.match((await cli('preset')).out, /^saved  night HOOVER\nsaved  Tape pluck\nbass {3}Acid bass$/m);
  assert.equal((await cli('preset', 'delete', 'tape', 'pluck')).out, 'deleted the preset "tape pluck"');
  const after = await edit({ op: 'deletepreset', name: 'Night hoover' });
  assert.equal(after.presets.some((p) => p.saved), false);
  assert.equal(patch(after).name, 'Tape pluck');                      // deleting the preset leaves the sound playing
});

test('the patches and the sequence are saved and come back after a restart', async () => {
  const state = await get('/api/state');
  server.store.flush();
  const again = createServer({ home });
  assert.deepEqual(again.store.slots, state.slots);
  assert.deepEqual(again.store.seq, state.seq);
  assert.equal(again.store.slot, state.slot);
  // a file that cannot be read is not the end of it
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'miniclaude-test-'));
  fs.writeFileSync(path.join(broken, 'state.json'), '{ not json');
  const logged = console.error;
  console.error = () => {};
  try { assert.equal(createServer({ home: broken }).store.patch.name, 'Acid bass'); } finally { console.error = logged; fs.rmSync(broken, { recursive: true, force: true }); }
});
