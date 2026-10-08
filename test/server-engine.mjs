// Who is the sound system: one page at a time, and a page that is still there keeps the engine until another one
// says it takes over (which a page only does once its user was asked). Port 4861.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scratch, startServer, api, FakeEngine, waitUntil } from './server-harness.mjs';

const sc = scratch('engine', { port: 4861 });
let srv;
const claim = (client, extra = {}) => api(sc.base, '/api/engine/claim', { client, ...extra });
// a page's event stream: being connected is what makes it "still there". Returns the ids of the engine events it saw.
async function page(client) {
  const ctrl = new AbortController(), seen = [];
  const res = await fetch(`${sc.base}/api/events?client=${client}`, { signal: ctrl.signal });
  (async () => {
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^event: engine$/m.test(block)) seen.push(JSON.parse(/^data: (.*)$/m.exec(block)[1]).id);
      }
    }
  })().catch(() => {});
  return { seen, close: () => ctrl.abort() };
}

before(async () => { srv = await startServer(sc); });
after(() => srv?.stop());

test('a second page does not take the engine from one that is still there; with force it does, and the first is told', async () => {
  const first = new FakeEngine(sc.base, 'page-one');
  await first.start();
  await first.loadTrack('A', sc.fx.main);
  assert.equal((await api(sc.base, '/api/state')).engine.connected, true);

  const two = await page('page-two');
  try {
    // nothing playing: refused, and the answer says so
    assert.deepEqual(await claim('page-two'), { ok: false, held: true, playing: false });
    // music playing: the same, and the question can say what taking over would stop
    await first.set('A', { playing: true, audible: 1 });
    assert.deepEqual(await claim('page-two'), { ok: false, held: true, playing: true });
    // the first page is still the engine: its state is the one the server reports, and commands still reach it
    assert.equal((await api(sc.base, '/api/state')).decks.A.playing, true);
    assert.deepEqual(two.seen, []);

    // the engine claiming again (a server restart, a reload) is not a take-over
    assert.equal((await claim('page-one')).ok, true);

    // the user said yes
    assert.equal((await claim('page-two', { force: true })).ok, true);
    assert.ok(await waitUntil(() => two.seen.at(-1) === 'page-two'), `engine events: ${two.seen}`);
    // the old engine's state is no longer taken
    await first.set('A', { position: 60 });
    assert.equal((await api(sc.base, '/api/state')).engine.connected, true);
  } finally { two.close(); await first.stop(); }
});

test('an engine whose page is gone is replaced without a question', async () => {
  const gone = await page('page-gone');
  assert.equal((await claim('page-gone', { force: true })).ok, true);
  gone.close();
  assert.ok(await waitUntil(async () => !(await api(sc.base, '/api/state')).engine.connected));
  const next = await page('page-next');
  try { assert.equal((await claim('page-next')).ok, true); } finally { next.close(); }
});
