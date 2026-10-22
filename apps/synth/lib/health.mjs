// Health checks: one entry per thing MiniClaude needs, in the shape of DJ Claude's /api/health ({ checks: [{ id, name,
// status: 'ok' | 'fail', required, ok, detail }] }), so the desktop suite's start-up window lists them as it lists DJ
// Claude's. A new dependency gets a check here. Checks run only on request.
import fs from 'node:fs';
import path from 'node:path';

const check = (id, name, status, detail) => ({ id, name, status, required: true, ok: status !== 'fail', detail });

// port: where the server listens; since: when it started (ms); home: the folder the patches and sequences are saved in
export function healthOf({ port, since, home }) {
  return { checks: [check('server', 'Server', 'ok', `port ${port} · up ${Math.floor((Date.now() - since) / 60000)} min`), dataCheck(home)] };
}

// the folder is there (made on the first start, as saving would) and something can be written into it
export function dataCheck(home) {
  try {
    fs.mkdirSync(home, { recursive: true });
    const probe = path.join(home, `.health-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
    return check('data', 'Data folder', 'ok', home);
  } catch (err) {
    return check('data', 'Data folder', 'fail', `${home}: cannot write there (${err.code || err.message})`);
  }
}
