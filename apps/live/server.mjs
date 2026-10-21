#!/usr/bin/env node
// Claudel's server: it serves the page and the libraries the page imports (/lib/…), nothing else. The code you play
// is kept by the page, in the browser. No dependencies. Local only: it listens on 127.0.0.1.
//
//   GET  /api/ping             which app this is, for the other apps' Apps menus
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, DEFAULT_PORT } from './lib/app.mjs';

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

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    // which app this is, for the other apps' Apps menus (their pages are on other ports, so it is open to them)
    if (route === 'GET /api/ping') { res.setHeader('Access-Control-Allow-Origin', '*'); return send(res, 200, { app: 'live', name: APP_NAME }); }
    if (req.method === 'GET') {
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'that is not a path' }); }
      if (rel.startsWith('/lib/') ? serveFile(res, path.join(HERE, 'lib'), rel.slice(5)) : serveFile(res, path.join(HERE, 'public'), rel === '/' ? 'index.html' : rel.slice(1))) return;
    }
    send(res, 404, { error: `nothing at ${route}` });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CLAUDEL_PORT) || DEFAULT_PORT;
  const server = createServer();
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `port ${port} is taken: ${APP_NAME} may be running already (http://localhost:${port})` : err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  ${APP_NAME}  →  http://localhost:${port}\n  code that loops: Ctrl+Enter plays it, Ctrl+. stops\n`);
  });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
