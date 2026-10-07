// Shared helpers for the benchmarks in this folder. Run any of them with `node tools/bench/<name>.bench.mjs`.
// Each one compares the working tree against the git ref saved in tools/bench/baseline.json (BENCH_BASE=<ref> overrides it).
// Columns are min / median ms. `output` lines are content hashes: equal hashes = byte-identical results.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// where the code a benchmark names ("apps/server/lib/…", "apps/web/public/…") is: today, and in refs from before the restructure
const NOW = { lib: 'apps/server/lib', public: 'apps/web/public' };
const has = (ref, dir) => { try { execFileSync('git', ['cat-file', '-e', `${ref}:${dir}`], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } };
const place = (rel, map) => { const [top, ...rest] = rel.split('/'); return [map[top] || top, ...rest].join('/'); };

export async function versions(rel) {
  const ref = process.env.BENCH_BASE || JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'bench', 'baseline.json'), 'utf8')).ref;
  const then = has(ref, NOW.lib) ? NOW : { lib: 'lib', public: 'public' };
  const dir = path.join(os.tmpdir(), `dj-bench-base-${process.pid}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    const tar = execFileSync('git', ['archive', ref, then.lib, then.public], { cwd: ROOT, maxBuffer: 1 << 28 });
    execFileSync('tar', ['-x'], { input: tar, cwd: dir }); // cwd, not -C: GNU tar on Windows misreads drive-letter paths
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const [base, cur] = await Promise.all([import(pathToFileURL(path.join(dir, place(rel, then)))), import(pathToFileURL(path.join(ROOT, place(rel, NOW))))]);
  return { base, cur, ref };
}

export async function compare(name, base, cur, { runs = 15, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) { await base(); await cur(); }
  const ms = { base: [], cur: [] };
  for (let i = 0; i < runs; i++) {
    for (const [k, fn] of i % 2 ? [['cur', cur], ['base', base]] : [['base', base], ['cur', cur]]) { const t = performance.now(); await fn(); ms[k].push(performance.now() - t); }
  }
  const st = (a) => { a.sort((x, y) => x - y); return { min: a[0], median: a[a.length >> 1] }; };
  const b = st(ms.base), c = st(ms.cur), f = (v) => v.toFixed(2).padStart(9);
  console.log(`${name.padEnd(34)} base ${f(b.min)} / ${f(b.median)} ms   current ${f(c.min)} / ${f(c.median)} ms   x${(b.min / c.min).toFixed(2)} (min) x${(b.median / c.median).toFixed(2)} (median)`);
  return { base: b, cur: c };
}

export function digest(...parts) {
  const h = crypto.createHash('sha1');
  for (const p of parts) h.update(ArrayBuffer.isView(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : JSON.stringify(p));
  return h.digest('hex').slice(0, 12);
}

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function synthTrack({ sr = 44100, seconds = 300, bpm = 128, seed = 1 } = {}) {
  const n = Math.floor(sr * seconds), out = new Int16Array(n * 2), rand = rng(seed);
  const beat = 60 / bpm, bar = 4 * beat, chord = [220, 261.63, 329.63];
  for (let i = 0; i < n; i++) {
    const t = i / sr, tb = t % beat, barNo = Math.floor(t / bar);
    const full = barNo >= 8 && !(barNo >= 64 && barNo < 80) && t < seconds - 16 * bar;
    let x = 0;
    if (full) {
      x += 0.8 * Math.sin(2 * Math.PI * (50 * tb + 60 * (1 - Math.exp(-tb * 30)) / 30)) * Math.exp(-tb * 9);
      const to = (t + beat / 2) % beat;
      x += 0.35 * Math.sin(2 * Math.PI * 55 * to) * Math.exp(-to * 6);
    }
    for (const f of chord) x += 0.07 * Math.sin(2 * Math.PI * f * t);
    const th = (t + beat / 2) % (beat / 2);
    x += 0.12 * (rand() * 2 - 1) * Math.exp(-th * 60);
    const v = Math.max(-1, Math.min(1, x * 0.7)) * 32767;
    out[2 * i] = v; out[2 * i + 1] = v * 0.9;
  }
  return out;
}

export function writeWav(name, pcm, sr = 44100) {
  const file = path.join(os.tmpdir(), name), hdr = Buffer.alloc(44), bytes = pcm.byteLength;
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + bytes, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 4, 28);
  hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(bytes, 40);
  fs.writeFileSync(file, Buffer.concat([hdr, Buffer.from(pcm.buffer, pcm.byteOffset, bytes)]));
  return file;
}
