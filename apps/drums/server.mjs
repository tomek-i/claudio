#!/usr/bin/env node
// The drum machine's server: serves the page, holds the beat (lib/store.mjs), and takes edits from the page and
// from the CLI on one small JSON API. No dependencies. Local only: it listens on 127.0.0.1.
//
//   GET  /api/state            the whole state           GET  /api/events        the same, as server-sent events
//   POST /api/op               one edit (see Store.apply and applyOp)            → the new state
//   GET  /api/export.mid       the playing pattern as MIDI (?loops=4)
//   POST /api/ask | /api/say   a note from the page to Claude | from Claude to the page
//   GET  /api/wait?ms=         the notes from the page not handed out yet (long poll)
//   POST /api/transport        the page saying it started or stopped playing (for the banner's playhead)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { toMidi } from './lib/midi.mjs';
import { banner, lanesOf } from './lib/banner.mjs';
import { stepSeconds } from './lib/timing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 4748;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_BODY = 256 * 1024;
const MAX_WAIT_MS = 60_000;

function readJson(req) {
  return new Promise((resolve, reject) => {
    // a JSON content type cannot be sent by another site's page without a preflight, which is never answered
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(new Error('send JSON (Content-Type: application/json)'));
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('too much')); req.destroy(); } else chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('that is not JSON')); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, root, rel) {
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) || !TYPES[path.extname(file)]) return false;
  let body;
  try { body = fs.readFileSync(file); } catch { return false; }
  res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  res.end(body);
  return true;
}

export function createServer({ home = process.env.CL808_HOME || path.join(HERE, '.cl-808') } = {}) {
  const store = new Store({ file: path.join(home, 'state.json') });
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /api/state': return send(res, 200, store.state());
        case 'GET /api/events': {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          const push = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
          push(store.state());
          store.listeners.add(push);
          const beat = setInterval(() => res.write(': still here\n\n'), 20_000);
          req.on('close', () => { store.listeners.delete(push); clearInterval(beat); });
          return;
        }
        case 'POST /api/op': return send(res, 200, store.apply(await readJson(req)));
        case 'POST /api/ask': return send(res, 200, store.note('you', (await readJson(req)).text));
        case 'POST /api/say': return send(res, 200, store.note('claude', (await readJson(req)).text));
        case 'GET /api/wait': {
          const ms = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get('ms')) || 0));
          return send(res, 200, { notes: await store.wait(ms) });
        }
        case 'POST /api/transport':
          store.transport = { playing: !!(await readJson(req)).playing, at: Date.now() };
          return send(res, 200, { ok: true });
        case 'GET /api/export.mid': {
          const loops = Math.min(64, Math.max(1, Math.round(Number(url.searchParams.get('loops')) || 1)));
          const name = store.pattern.name.replace(/[^\w -]/g, '').trim() || 'beat';
          res.writeHead(200, { 'Content-Type': 'audio/midi', 'Content-Disposition': `attachment; filename="${name}.mid"`, 'Cache-Control': 'no-store' });
          return res.end(Buffer.from(toMidi(store.pattern, { loops })));
        }
      }
      if (req.method === 'GET') {
        const rel = decodeURIComponent(url.pathname);
        if (rel.startsWith('/lib/') ? serveFile(res, path.join(HERE, 'lib'), rel.slice(5)) : serveFile(res, path.join(HERE, 'public'), rel === '/' ? 'index.html' : rel.slice(1))) return;
      }
      send(res, 404, { error: `nothing at ${route}` });
    } catch (err) {
      send(res, 400, { error: err.message });
    }
  });
  server.store = store;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CL808_PORT) || DEFAULT_PORT;
  const server = createServer();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is taken: the drum machine may be running already (http://localhost:${port})` : err.message);
    process.exit(1);
  });
  const { store } = server;
  // the banner's strip: the bar being played and the step the page's playhead is on, while a page is open and playing
  const live = () => {
    const p = store.pattern;
    const pos = store.transport.playing && store.listeners.size ? ((Date.now() - store.transport.at) / 1000 - 0.08) / stepSeconds(p.bpm) : -1;
    const step = pos < 0 ? -1 : Math.floor(pos) % p.steps;
    return { lanes: lanesOf(p, step >= 16 ? 1 : 0), head: step < 0 ? -1 : step % 16 };
  };
  server.listen(port, '127.0.0.1', () => {
    const p = store.pattern;
    banner({
      url: `http://localhost:${port}`,
      beat: `"${p.name}"  ${p.bpm} bpm  swing ${Math.round(p.swing * 100)}%  ${p.steps} steps  (slot ${store.slot})`,
      cli: `node ${path.relative(process.cwd(), path.join(HERE, 'cl808.mjs')).replaceAll('\\', '/')} help`,
      lanes: lanesOf(p),
      live,
    });
  });
  const stop = () => { server.store.flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
