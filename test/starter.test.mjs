// Starter crate downloader: checks every file against its sha256, falls back to the URL on the track page,
// skips what is already there and reports the tracks it could not get.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadStarter, starterTracks } from '../apps/server/lib/starter.mjs';

const body = (s) => Buffer.from(s);
const track = (name, data) => ({ file: `${name}.mp3`, source: `http://page/${name}`, url: `http://files/${name}`, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') });
const res = (data, ok = true) => ({ ok, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length), text: async () => data.toString() });

test('downloadStarter: verified downloads, page fallback, skip existing, report failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-starter-'));
  try {
    const tracks = [track('good', body('aaaa')), track('moved', body('bbbbbb')), track('corrupt', body('cc')), track('gone', body('ddd'))];
    const calls = [];
    const get = async (url) => {
      calls.push(url);
      if (url === 'http://files/good') return res(body('aaaa'));
      if (url === 'http://files/moved') return res(body(''), false);                               // the stored URL went stale…
      if (url === 'http://page/moved') return res(body('{&quot;fileUrl&quot;:&quot;http:\\/\\/new\\/moved&quot;}')); // …the page has the new one
      if (url === 'http://new/moved') return res(body('bbbbbb'));
      if (url === 'http://files/corrupt') return res(body('XX'));                                   // wrong bytes every time
      if (url === 'http://page/corrupt') return res(body('nothing here'));
      throw new Error('network down');
    };
    const seen = [];
    const r = await downloadStarter({ dir, tracks, get, onProgress: (e) => seen.push(`${e.track.file}:${e.status}`) });
    assert.deepEqual(r.failed.map((t) => t.file), ['corrupt.mp3', 'gone.mp3']);
    assert.equal(r.total, 4);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['good.mp3', 'moved.mp3']);
    assert.equal(fs.readFileSync(path.join(dir, 'moved.mp3'), 'utf8'), 'bbbbbb');
    assert.deepEqual(seen, ['good.mp3:start', 'good.mp3:ok', 'moved.mp3:start', 'moved.mp3:ok', 'corrupt.mp3:start', 'corrupt.mp3:failed', 'gone.mp3:start', 'gone.mp3:failed']);

    // a second run only fetches what is missing; --force fetches everything again
    calls.length = 0; seen.length = 0;
    await downloadStarter({ dir, tracks, get, onProgress: (e) => seen.push(`${e.track.file}:${e.status}`) });
    assert.deepEqual(seen.slice(0, 2), ['good.mp3:have', 'moved.mp3:have']);
    assert.ok(!calls.includes('http://files/good'));
    calls.length = 0;
    await downloadStarter({ dir, tracks: tracks.slice(0, 1), get, force: true });
    assert.deepEqual(calls, ['http://files/good']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('starter/tracks.json: every track has what the downloader and the credits need', () => {
  const list = starterTracks(path.resolve(import.meta.dirname, '..'));
  assert.ok(list.length > 0);
  for (const t of list) {
    assert.match(t.file, /^[^/\\]+\.mp3$/, 'a plain file name');
    assert.match(t.sha256, /^[0-9a-f]{64}$/);
    assert.ok(t.bytes > 0 && t.url.startsWith('https://') && t.source.startsWith('https://') && t.license && t.artist && t.title);
  }
});
