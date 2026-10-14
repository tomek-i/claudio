// Exporting a part of a recorded session (lib/export.mjs from / to / name), as a set's export does: from the
// recording's 0:00 to its end, named after the set. Needs ffmpeg (skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { exportSession } from '../apps/server/lib/export.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// the mean level of the first `sec` seconds, in dB (ffmpeg's volumedetect, which reports on stderr)
const meanDb = (f, sec) => Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-t', String(sec), '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
const seconds = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString());

test('only the part asked for, under the name asked for', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djtrim-')), out = path.join(dir, 'out');
  // a 10 s "session": the engine audio as the page records it (WebM/Opus), posted in 1 s chunks
  const webm = path.join(dir, 'engine-audio.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-ac', '2', '-c:a', 'libopus', '-b:a', '64k', webm]);
  const bytes = fs.statSync(webm).size, T = Date.parse('2026-10-14T10:00:00Z');
  const lines = Array.from({ length: 10 }, (_, i) => JSON.stringify({ ts: T + (i + 1) * 1000, seq: i, bytes: Math.floor(bytes / 10) + (i === 9 ? bytes % 10 : 0) }));
  fs.writeFileSync(path.join(dir, 'audio-chunks.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id: 'sess1', startedAt: T }));
  const r = await exportSession(dir, { outDir: out, libraryFile: path.join(dir, 'none.json'), from: T + 2000, to: T + 7000, name: 'Friday night' });
  assert.equal(path.basename(r.audio), 'Friday night.mp3');
  assert.ok(fs.existsSync(path.join(out, 'Friday night.txt')) && fs.existsSync(path.join(out, 'Friday night.cue')));
  const d = seconds(r.audio);
  assert.ok(Math.abs(d - 5) < 0.15, `5 s of the 10: ${d}`);
  assert.ok(Math.abs(r.duration - 5) < 0.15, `reported: ${r.duration}`);
  // without from / to: all of it, under the session's name
  const all = await exportSession(dir, { outDir: out, libraryFile: path.join(dir, 'none.json') });
  assert.equal(path.basename(all.audio), 'sess1.mp3');
  assert.ok(Math.abs(seconds(all.audio) - 10) < 0.15);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a recording that starts in silence: timed from when the recorder started, not by its bytes', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djtrim-')), out = path.join(dir, 'out');
  const webm = path.join(dir, 'engine-audio.webm');
  // 4 s of silence, then 6 s of tone, as a set's export records it (the decks are put back before 0:00)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]', '-map', '[a]', '-ac', '2', '-c:a', 'libopus', '-b:a', '64k', webm]);
  const bytes = fs.statSync(webm).size, T = Date.parse('2026-10-14T10:00:00Z');
  // the silent seconds come in a few hundred bytes each, the music in the rest
  const sizes = [300, 250, 250, 200]; const rest = bytes - sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 6; i++) sizes.push(Math.floor(rest / 6) + (i === 5 ? rest % 6 : 0));
  fs.writeFileSync(path.join(dir, 'audio-chunks.jsonl'), sizes.map((b, i) => JSON.stringify({ ts: T + (i + 1) * 1000, seq: i, bytes: b, start: T })).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ id: 'sess2', startedAt: T }));
  // what was on air: x2 before 0:00 (as when a set's decks are put back), then x1 from 0:00, then x2 again from 2.5 s
  const deck = (id, on) => ({ p: 0, on: on ? 1 : 0, a: on ? 1 : 0, r: 1, id, loop: 0 });
  const tel = [];
  for (let ms = 0; ms < 10000; ms += 200) {
    const w = T + ms, rel = ms - 4000;
    tel.push({ t: w, A: deck('x1', rel >= 200 && rel < 2500), B: deck('x2', rel < 0 || rel >= 2500) });
  }
  fs.writeFileSync(path.join(dir, 'telemetry.jsonl'), tel.map((s) => JSON.stringify(s)).join('\n') + '\n');
  // the set's 0:00 is when the music starts, 4 s in; its end 9 s in
  const r = await exportSession(dir, { outDir: out, libraryFile: path.join(dir, 'none.json'), from: T + 4000, to: T + 9000, name: 'set' });
  const d = seconds(r.audio);
  assert.ok(Math.abs(d - 5) < 0.15, `5 s: ${d}`);
  assert.deepEqual(r.tracks.map((t) => [t.id, Math.round(t.at * 10) / 10]), [['x1', 0], ['x2', 2.6]], 'the tracklist: what played in it, from 0:00 (x2 is on air from the first sample at or after 2.5 s)');
  // what was cut out is the silence: the file starts with the tone at once
  const db = meanDb(r.audio, 0.3);
  assert.ok(db > -30, `the first 0.3 s is the tone, not silence: ${db} dB`);
  fs.rmSync(dir, { recursive: true, force: true });
});
