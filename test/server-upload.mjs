// Importing audio files through POST /api/upload: an accepted file is analysed and registered, the wrong type is
// refused by extension and by content, a second copy is not imported twice, and no name can leave the library.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratch, startServer, api, waitUntil } from './server-harness.mjs';

const sc = scratch('upload', { port: 4858, config: { autoDJ: { enabled: false } } });
const srv = await startServer(sc);
after(() => srv.stop());

const wav = fs.readFileSync(sc.fx.far.file); // a real, analysable track (110 BPM)
const send = (name, body) => fetch(`${sc.base}/api/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const uploads = path.join(sc.dir, 'library', 'uploads');
const everything = () => fs.readdirSync(sc.dir, { recursive: true }).map(String);

test('an audio file is stored in the library, analysed and listed, with a job like a download', async () => {
  const r = await send('Dropped Track.wav', wav);
  assert.equal(r.status, 200); assert.ok(r.ok && !r.duplicate);
  assert.ok(Math.abs(r.track.bpm - 110) < 0.1, `bpm ${r.track.bpm}`);
  assert.ok(fs.existsSync(path.join(uploads, 'Dropped Track.wav')), 'written under library/uploads');
  const lib = await api(sc.base, '/api/library');
  assert.ok(lib.tracks.some((t) => t.id === r.track.id), 'in the crate');
  const job = (await api(sc.base, '/api/jobs')).find((j) => j.input === 'Dropped Track.wav');
  assert.equal(job.status, 'ready');
  const saved = await waitUntil(() => JSON.parse(fs.readFileSync(path.join(sc.dir, '.dj', 'library.json'), 'utf8')).tracks.find((t) => t.id === r.track.id), 3000);
  assert.ok(saved, 'saved to the library cache, so it survives a restart');
});

test('the same file again is not imported twice; a different file under that name is refused', async () => {
  const before = fs.readdirSync(uploads).length;
  const again = await send('Dropped Track.wav', wav);
  assert.ok(again.ok && again.duplicate); assert.equal(fs.readdirSync(uploads).length, before);
  const other = await send('Dropped Track.wav', wav.subarray(0, wav.length - 2000));
  assert.equal(other.status, 409); assert.match(other.error, /already in the library/);
});

test('refused: not audio by extension or by content, and names with path characters', async () => {
  let r = await send('notes.txt', Buffer.from('hello'));
  assert.equal(r.status, 415); assert.match(r.error, /not an audio file/);
  r = await send('fake.mp3', Buffer.from('<html>this is not an mp3</html>'.repeat(50)));
  assert.equal(r.status, 415); assert.match(r.error, /not audio/);
  assert.ok(!fs.existsSync(path.join(uploads, 'fake.mp3')) && !fs.existsSync(path.join(uploads, 'fake.mp3.part')), 'nothing left behind');
  for (const name of ['../escape.wav', '..\\escape.wav', 'sub/dir.wav', 'C:evil.wav', '.hidden.wav', '']) {
    r = await send(name, wav.subarray(0, 4096));
    assert.equal(r.status, 400, `${JSON.stringify(name)} → ${r.status}`);
  }
  assert.ok(!everything().some((f) => /escape|evil|hidden|dir\.wav/.test(f)), 'nothing was written anywhere');
  const log = await api(sc.base, '/api/log?n=30');
  assert.ok(log.some((e) => /Import (refused|failed)/.test(e.text)), 'the booth feed says why');
});
