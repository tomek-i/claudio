#!/usr/bin/env node
// The synth's server: serves the page, holds the patches and the sequence (lib/store.mjs), and takes edits from
// the page and from the CLI on one small JSON API. No dependencies. Local only: it listens on 127.0.0.1.
//
//   GET  /api/state            the whole state           GET  /api/events        the same, as server-sent events
//   POST /api/op               one edit (see Store.apply and applySeqOp)         → the new state
//   POST /api/play             ask the open pages to sound now: the sequence, some notes, or stop
//                              (sent to the pages as a "play" event; the state does not change)
//   POST /api/ask | /api/say   a note from the page to Claude | from Claude to the page
//   GET  /api/wait?ms=         the notes from the page not handed out yet (long poll)
//   POST /api/transport        the page saying whether it is playing and whether the browser lets it sound
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { APP_NAME, DEFAULT_PORT } from './lib/app.mjs';
import { banner, lanesOf } from './lib/banner.mjs';
import { STEPS, stepSeconds } from './lib/seq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export { DEFAULT_PORT };

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
  const ext = path.extname(file);
  if (!file.startsWith(root + path.sep) || !TYPES[ext]) return false;
  let body;
  try { body = fs.readFileSync(file); } catch { return false; }
  if (ext === '.html') body = body.toString('utf8').replaceAll('%NAME%', APP_NAME);   // the name is in lib/app.mjs only
  res.writeHead(200, { 'Content-Type': `${TYPES[ext]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  res.end(body);
  return true;
}

export function createServer({ home = process.env.MINICLAUDE_HOME || path.join(HERE, '.miniclaude') } = {}) {
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
          const push = (data, event) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
          push(store.state());
          store.listeners.add(push);
          const beat = setInterval(() => res.write(': still here\n\n'), 20_000);
          req.on('close', () => {
            store.listeners.delete(push);
            clearInterval(beat);
            if (!store.listeners.size) store.transport = { playing: false, awake: false };
          });
          return;
        }
        case 'POST /api/op': return send(res, 200, store.apply(await readJson(req)));
        case 'POST /api/play': return send(res, 200, store.play(await readJson(req)));
        case 'POST /api/ask': return send(res, 200, store.note('you', (await readJson(req)).text));
        case 'POST /api/say': return send(res, 200, store.note('claude', (await readJson(req)).text));
        case 'GET /api/wait': {
          const ms = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get('ms')) || 0));
          return send(res, 200, { notes: await store.wait(ms) });
        }
        case 'POST /api/transport': {
          const said = await readJson(req);
          // `at`: when it started playing, for the banner's playhead (kept while the page only repeats itself)
          const at = said.playing ? (store.transport.playing && store.transport.at) || Date.now() : 0;
          store.transport = { playing: !!said.playing, awake: !!said.awake, at };
          return send(res, 200, { ok: true });
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
  const port = Number(process.env.MINICLAUDE_PORT) || DEFAULT_PORT;
  const server = createServer();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is taken: the synth may be running already (http://localhost:${port})` : err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const { store } = server;
    // the banner's strip: the riff as it is now, and the step the page's playhead is on while a page is open and playing
    const live = () => {
      const t = store.transport;
      const pos = t.playing && t.at && store.listeners.size ? ((Date.now() - t.at) / 1000 - 0.08) / stepSeconds(store.seq.bpm) : -1;
      return { lanes: lanesOf(store.seq), head: pos < 0 ? -1 : Math.floor(pos) % STEPS };
    };
    banner({
      url: `http://localhost:${port}`,
      patch: `"${store.patch.name}" (slot ${store.slot})   ${store.seq.bpm} bpm`,
      cli: `node ${path.relative(process.cwd(), path.join(HERE, 'miniclaude.mjs')).replaceAll('\\', '/')} help`,
      lanes: lanesOf(store.seq),
      live,
    });
  });
  const stop = () => { server.store.flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
