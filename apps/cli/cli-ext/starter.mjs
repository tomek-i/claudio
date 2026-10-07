// Starter crate: openly licensed tracks (CC0 / CC BY / CC BY-SA) so a fresh checkout has music to mix.
//   starter [--list] [--force]         download starter/tracks.json into <first library folder>/starter
import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../../server/lib/library.mjs';
import { starterTracks, downloadStarter } from '../../server/lib/starter.mjs';

export default ({ flags, fail, out, ROOT, BASE, JSON_OUT }) => ({
  async starter() {
    const list = starterTracks(ROOT);
    if (JSON_OUT) return out(list);
    if (flags.list) {
      for (const t of list) console.log(`${String(t.bpm).padStart(3)} BPM  ${t.genre.padEnd(11)}  ${t.artist} - ${t.title}  (${t.license})`);
      return;
    }
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    const dir = path.join(path.resolve(ROOT, expandHome(config.libraryDirs?.[0] || './library')), 'starter');
    const { failed } = await downloadStarter({
      dir, tracks: list, force: !!flags.force,
      onProgress: ({ track: t, status }) => {
        if (status === 'have') console.log(`✓ ${t.file} (already there)`);
        else if (status === 'start') process.stdout.write(`⬇ ${t.file} (${(t.bytes / 1e6).toFixed(1)} MB) … `);
        else console.log(status === 'ok' ? '✓' : `✗ failed, get it from ${t.source}`);
      },
    });
    console.log(`\n${list.length - failed.length}/${list.length} tracks in ${dir}\nCredits and licences: starter/README.md`);
    // the server may not be up yet; it scans on start anyway
    const scan = await fetch(BASE + '/api/library/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null);
    console.log(scan?.ok ? 'Library rescan started: node dj.mjs library' : 'Start the server to analyse them: node dj.mjs start');
    if (failed.length) fail(`${failed.length} track(s) could not be downloaded`);
  },
});
