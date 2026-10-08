// The drum machine's server on a scratch folder and its own port: edits, undo, variations, notes, saving, MIDI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';

const PORT = 4868;
const BASE = `http://127.0.0.1:${PORT}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'drums-test-'));
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
const kick = (state) => state.slots[state.slot].tracks[0].vel.map((v) => (v > 0 ? 'x' : '.')).join('');

before(() => new Promise((resolve) => { server = createServer({ home }); server.listen(PORT, '127.0.0.1', resolve); }));
after(() => { server.closeAllConnections(); server.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('it starts on a preset and serves the page and the shared code', async () => {
  const state = await get('/api/state');
  assert.equal(state.slot, 'A');
  assert.equal(state.slots.A.name, 'Boom bap');
  assert.equal(state.presets.length, 8);
  assert.match(await (await fetch(BASE + '/')).text(), /<title>/);
  assert.match(await (await fetch(BASE + '/lib/timing.mjs')).text(), /stepSeconds/);
  assert.equal((await fetch(BASE + '/lib/../server.mjs')).status, 404);
  assert.equal((await fetch(BASE + '/.cl-808/state.json')).status, 404);
});

test('an edit changes the beat, and a drag is one undo step', async () => {
  await edit({ op: 'write', clear: true, lines: ['kick x...............'] });
  for (const step of [4, 8, 12]) await edit({ op: 'step', track: 'kick', step, vel: 0.8, gesture: 'drag-1' });
  assert.equal(kick(await get('/api/state')), 'x...x...x...x...');
  assert.equal(kick(await edit({ op: 'undo' })), 'x...............');
  const redone = await edit({ op: 'redo' });
  assert.equal(kick(redone), 'x...x...x...x...');
  assert.equal(redone.canRedo, false);
});

test('a bad edit is refused with a reason and changes nothing', async () => {
  const before = await get('/api/state');
  for (const op of [{ op: 'step', track: 'gong', step: 0, vel: 1 }, { op: 'step', track: 'kick', step: 99, vel: 1 }, { op: 'pick', index: 0 }, { op: 'morph', to: 'A' }, { op: 'nope' }]) {
    const { status, body } = await post('/api/op', op);
    assert.equal(status, 400);
    assert.ok(body.error);
  }
  assert.equal((await post('/api/op', { op: 'clear' }, 'text/plain')).status, 400);   // what another site's page could send
  assert.equal((await get('/api/state')).rev, before.rev);
});

test('variations are offered without changing the beat, and picking one is an undo step', async () => {
  const offered = await edit({ op: 'vary', wild: 0.6, seed: 1 });
  assert.equal(offered.candidates.length, 4);
  assert.equal(kick(offered), 'x...x...x...x...');
  const picked = await edit({ op: 'pick', index: 2 });
  assert.deepEqual(picked.slots.A, offered.candidates[2]);
  assert.equal(kick(await edit({ op: 'undo' })), 'x...x...x...x...');
});

test('slots hold their own patterns, and a morph goes from one towards another', async () => {
  await edit({ op: 'copy', to: 'B' });
  await edit({ op: 'slot', slot: 'B' });
  await edit({ op: 'preset', name: 'house' });
  const state = await edit({ op: 'slot', slot: 'A' });
  assert.equal(state.slots.B.name, 'House');
  assert.equal(kick(state), 'x...x...x...x...');
  const morphed = await edit({ op: 'morph', to: 'B', amount: 1 });
  assert.deepEqual(morphed.slots.A.tracks, morphed.slots.B.tracks);
  await edit({ op: 'undo' });
});

test('a note typed on the page reaches a waiting CLI once, and the answer is shown', async () => {
  const waiting = get('/api/wait?ms=5000');
  await post('/api/ask', { text: 'make it swing harder' });
  assert.deepEqual((await waiting).notes.map((n) => n.text), ['make it swing harder']);
  assert.deepEqual((await get('/api/wait?ms=0')).notes, []);
  await post('/api/say', { text: 'swing is at 62%' });
  assert.deepEqual((await get('/api/state')).notes.map((n) => n.from), ['you', 'claude']);
});

test('the beat is saved and comes back after a restart; the MIDI export is a MIDI file', async () => {
  await edit({ op: 'param', key: 'bpm', value: 97 });
  server.store.flush();
  const again = createServer({ home });
  assert.equal(again.store.pattern.bpm, 97);
  assert.equal(kick(again.store.state()), 'x...x...x...x...');
  const res = await fetch(BASE + '/api/export.mid?loops=2');
  assert.equal(res.headers.get('content-type'), 'audio/midi');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), 'MThd');
});

test('the page is told of every change', async () => {
  const res = await fetch(BASE + '/api/events');
  const reader = res.body.getReader();
  const read = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, ''));
  const first = await read();
  await edit({ op: 'param', key: 'swing', value: 0.33 });
  const next = await read();
  assert.equal(next.rev, first.rev + 1);
  assert.equal(next.slots.A.swing, 0.33);
  await reader.cancel();
});
