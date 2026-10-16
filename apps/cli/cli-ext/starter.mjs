// Demo tracks: openly licensed tracks (CC0 / CC BY / CC BY-SA) so a fresh checkout has music to mix.
//   demo [--list] [--force]            download apps/server/demo-tracks/tracks.json into <first library folder>/demo
//   starter                            the same (its old name)
import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../../server/lib/library.mjs';
import { starterTracks, downloadStarter } from '../../server/lib/starter.mjs';
import { CONFIG_FILE, LIBRARY_DIR } from '../../server/lib/paths.mjs';

export default ({ flags, fail, out, ROOT, BASE, JSON_OUT }) => {
  async function demo() {
    const list = starterTracks();
    if (JSON_OUT) return out(list);
    if (flags.list) {
      for (const t of list) console.log(`${String(t.bpm).padStart(3)} BPM  ${t.genre.padEnd(11)}  ${t.artist} - ${t.title}  (${t.license})`);
      return;
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const first = config.libraryDirs?.[0];
    const dir = path.join(first ? path.resolve(ROOT, expandHome(first)) : LIBRARY_DIR, 'demo');
    const { failed } = await downloadStarter({
      dir, tracks: list, force: !!flags.force,
      onProgress: ({ track: t, status }) => {
        if (status === 'have') console.log(`✓ ${t.file} (already there)`);
        else if (status === 'start') process.stdout.write(`⬇ ${t.file} (${(t.bytes / 1e6).toFixed(1)} MB) … `);
        else console.log(status === 'ok' ? '✓' : `✗ failed, get it from ${t.source}`);
      },
    });
    console.log(`\n${list.length - failed.length}/${list.length} tracks in ${dir}\nCredits and licences: apps/server/demo-tracks/README.md`);
    // the server may not be up yet; it scans on start anyway
    const scan = await fetch(BASE + '/api/library/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    console.log(scan?.ok ? 'Library rescan started: node dj.mjs library' : 'Start the server to analyse them: node dj.mjs start');
    if (failed.length) fail(`${failed.length} track(s) could not be downloaded`);
  }
  return { demo, starter: demo };
};
