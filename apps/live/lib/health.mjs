// Health checks: one entry per thing Claudel needs, in the shape of DJ Claude's /api/health ({ checks: [{ id, name,
// status: 'ok' | 'fail', required, ok, detail }] }), so the desktop suite's start-up window lists them as it lists DJ
// Claude's. The server keeps nothing, so there is no data folder; a new dependency gets a check here.
import fs from 'node:fs';
import path from 'node:path';

const check = (id, name, status, detail) => ({ id, name, status, required: true, ok: status !== 'fail', detail });

// port: where the server listens; since: when it started (ms); root: the app's folder (apps/live)
export function healthOf({ port, since, root }) {
  const missing = ['public/index.html', 'lib/pattern.mjs'].filter((f) => !fs.existsSync(path.join(root, f)));
  return {
    checks: [
      check('server', 'Server', 'ok', `port ${port} · up ${Math.floor((Date.now() - since) / 60000)} min`),
      check('page', 'Page files', missing.length ? 'fail' : 'ok', missing.length ? `missing: ${missing.join(', ')}` : 'the page and the pattern language'),
    ],
  };
}
