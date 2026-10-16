#!/usr/bin/env node
// The DAW's server: serves the page, holds the project (lib/store.mjs), and takes edits from the page and from
// the CLI on one small JSON API. No dependencies. Local only: it listens on 127.0.0.1.
//
//   GET  /api/state            the whole state           GET  /api/events        the same, as server-sent events
//   POST /api/op               one edit (see Store.apply and applyOp), or several as { op: 'batch', ops }   → the new state
//   GET  /api/export.mid       the song as a MIDI file, a track per track
//   POST /api/transport        { action: 'play', bar } or { action: 'stop' }: passed on to the open pages
//   POST /api/sound            { awake }: the page saying whether the browser lets it sound (not before "Start sound")
//   POST /api/ask | /api/say   a note from the page to Claude | from Claude to the page
//   GET  /api/wait?ms=         the notes from the page not handed out yet (long poll)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { toMidi } from './lib/midi.mjs';
import { APP_NAME } from './lib/project.mjs';
import { banner, lanesOf } from './lib/banner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 4750;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_BODY = 2 * 1024 * 1024;                    // a whole project can come in (the `replace` edit)
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
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(root + path.sep) || !type) return false;
  let body;
  try { body = fs.readFileSync(file); } catch { return false; }
  if (type === 'text/html') body = body.toString('utf8').replaceAll('%NAME%', APP_NAME);   // the page's title and header
  res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
  res.end(body);
  return true;
}

// Saved in the project's data/daw/ (CLAUDEBASE_HOME to put it elsewhere).
export const DEFAULT_HOME = path.join(HERE, '..', '..', 'data', 'daw');

export function createServer({ home = process.env.CLAUDEBASE_HOME || DEFAULT_HOME } = {}) {
  const store = new Store({ file: path.join(home, 'project.json') });
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
          // the state is the plain message; anything else (the transport) is a named event
          const tell = (event, data) => res.write(`${event === 'state' ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`);
          store.listeners.add(tell);
          tell('state', store.state());
          const beat = setInterval(() => res.write(': still here\n\n'), 20_000);
          req.on('close', () => {
            store.listeners.delete(tell);
            clearInterval(beat);
            if (!store.listeners.size) store.awake = false;   // a page that is loaded again has to be clicked again
          });
          return;
        }
        case 'POST /api/op': return send(res, 200, store.apply(await readJson(req)));
        case 'POST /api/transport': {
          const { action, bar } = await readJson(req);
          return send(res, 200, store.transport(action, bar));
        }
        case 'POST /api/sound':
          store.awake = !!(await readJson(req)).awake;
          return send(res, 200, { ok: true });
        case 'POST /api/ask': return send(res, 200, store.note('you', (await readJson(req)).text));
        case 'POST /api/say': return send(res, 200, store.note('claude', (await readJson(req)).text));
        case 'GET /api/wait': {
          const ms = Math.min(MAX_WAIT_MS, Math.max(0, Number(url.searchParams.get('ms')) || 0));
          return send(res, 200, { notes: await store.wait(ms) });
        }
        case 'GET /api/export.mid': {
          const name = store.project.name.replace(/[^\w -]/g, '').trim() || 'song';
          res.writeHead(200, { 'Content-Type': 'audio/midi', 'Content-Disposition': `attachment; filename="${name}.mid"`, 'Cache-Control': 'no-store' });
          return res.end(Buffer.from(toMidi(store.project)));
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
  const port = Number(process.env.CLAUDEBASE_PORT) || DEFAULT_PORT;
  const server = createServer();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is taken: ${APP_NAME} may be running already (http://localhost:${port})` : err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const p = server.store.project;
    banner({
      url: `http://localhost:${port}`,
      song: `"${p.name}"  ${p.bpm} bpm  ${p.bars} bars  ${p.tracks.length} tracks`,
      cli: `node ${path.relative(process.cwd(), path.join(HERE, 'claudebase.mjs')).replaceAll('\\', '/')} help`,
      lanes: lanesOf(p),
      live: () => lanesOf(server.store.project),     // the strip follows the song as it is written
    });
  });
  const stop = () => { server.store.flush(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
