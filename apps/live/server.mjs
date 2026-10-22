#!/usr/bin/env node
// Claudel's server: it serves the page and the libraries the page imports (/lib/…), nothing else. The code you play
// is kept by the page, in the browser. No dependencies. Local only: it listens on 127.0.0.1.
//
//   GET  /api/ping             which app this is, for the other apps' Apps menus
//   GET  /api/health           what it needs, each ok or not (lib/health.mjs), for the desktop suite's start-up window
//
//   node apps/live/server.mjs                     start it (pnpm live), with the startup banner
//   node apps/live/server.mjs banner [name|--list]  preview the banner's animations (CLAUDEL_BANNER=<name> picks one)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, DEFAULT_PORT } from './lib/app.mjs';
import { ANIMATIONS, animate, banner } from './lib/banner.mjs';
import { healthOf } from './lib/health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export { DEFAULT_PORT };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

function serveFile(res, root, rel) {
  const file = path.join(root, rel);
  const ext = path.extname(file);
  if (!file.startsWith(root + path.sep) || !TYPES[ext]) return false;
  let body;
  try { body = fs.readFileSync(file); } catch { return false; }
  if (ext === '.html') body = body.toString('utf8').replaceAll('%NAME%', APP_NAME);   // the name is in lib/app.mjs only
  res.writeHead(200, { 'Content-Type': TYPES[ext].startsWith('font/') ? TYPES[ext] : `${TYPES[ext]}; charset=utf-8`, 'Cache-Control': 'no-cache' });   // a font is not text
  res.end(body);
  return true;
}

export function createServer() {
  const send = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const since = Date.now();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    // which app this is, for the other apps' Apps menus (their pages are on other ports, so it is open to them)
    if (route === 'GET /api/ping') { res.setHeader('Access-Control-Allow-Origin', '*'); return send(res, 200, { app: 'live', name: APP_NAME }); }
    if (route === 'GET /api/health') return send(res, 200, healthOf({ port: server.address()?.port, since, root: HERE }));
    if (req.method === 'GET') {
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'that is not a path' }); }
      if (rel.startsWith('/lib/') ? serveFile(res, path.join(HERE, 'lib'), rel.slice(5)) : serveFile(res, path.join(HERE, 'public'), rel === '/' ? 'index.html' : rel.slice(1))) return;
    }
    send(res, 404, { error: `nothing at ${route}` });
  });
  return server;
}

// every animation in turn, or the one named, without starting the server
async function previewBanner(name) {
  const names = Object.keys(ANIMATIONS);
  if (name === '--list') return console.log(names.join('\n'));
  if (name && !ANIMATIONS[name]) throw new Error(`no animation "${name}": ${names.join(', ')}`);
  if (!process.stdout.isTTY) throw new Error('the banner draws in place, so it needs a terminal (not a pipe or a file)');
  const play = name ? [name] : names;
  for (const [i, n] of play.entries()) {
    console.log(`\n  ${n}${play.length > 1 ? `  (${i + 1}/${play.length})` : ''}   CLAUDEL_BANNER=${n} starts the server with this one`);
    await animate(ANIMATIONS[n]);
    if (i < play.length - 1) await new Promise((r) => setTimeout(r, 700));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === 'banner') {
  previewBanner(process.argv[3]).catch((err) => { console.error(err.message); process.exit(1); });
} else if (isMain) {
  const port = Number(process.env.CLAUDEL_PORT) || DEFAULT_PORT;
  const server = createServer();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is taken: ${APP_NAME} may be running already (http://localhost:${port})` : err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    banner({
      url: `http://localhost:${port}`,
      keys: 'Ctrl+Enter plays the code, and your changes from the next bar · Ctrl+. stops',
      language: path.relative(process.cwd(), path.join(HERE, 'PATTERNS.md')).replaceAll('\\', '/'),
    });
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
