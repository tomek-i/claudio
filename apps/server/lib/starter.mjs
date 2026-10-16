// Demo tracks: openly licensed tracks (CC0 / CC BY / CC BY-SA, listed in apps/server/demo-tracks/tracks.json) so a
// fresh checkout has music to mix. Used by `dj demo` and by the "Download demo tracks" button on an empty crate
// (/api/starter).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEMO_DIR } from './paths.mjs';

export const starterTracks = (dir = DEMO_DIR) => JSON.parse(fs.readFileSync(path.join(dir, 'tracks.json'), 'utf8'));

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const httpGet = (url) => fetch(url, { headers: { 'user-agent': 'dj-claude' } });

// the file URL is a storage path that can change; the track page always carries the current one
async function fileUrl(t, get) {
  const html = (await (await get(t.source)).text()).replace(/&quot;/g, '"').replace(/\\\//g, '/');
  return html.match(/"fileUrl":"([^"]+)"/)?.[1];
}
async function fetchTrack(t, get) {
  for (const url of [t.url, null]) {
    const res = await Promise.resolve().then(async () => get(url || (await fileUrl(t, get)) || t.url)).catch(() => null);
    if (!res?.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha(buf) === t.sha256) return buf;
  }
  return null;
}

export async function downloadStarter({ dir, tracks, force = false, onProgress = () => {}, get = httpGet }) {
  fs.mkdirSync(dir, { recursive: true });
  const failed = [];
  for (const [index, track] of tracks.entries()) {
    const file = path.join(dir, track.file), at = { track, index, total: tracks.length };
    if (!force && fs.existsSync(file) && fs.statSync(file).size === track.bytes) { onProgress({ ...at, status: 'have' }); continue; }
    onProgress({ ...at, status: 'start' });
    const buf = await fetchTrack(track, get);
    if (buf) fs.writeFileSync(file, buf); else failed.push(track);
    onProgress({ ...at, status: buf ? 'ok' : 'failed' });
  }
  return { total: tracks.length, failed };
}
