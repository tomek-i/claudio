// All five servers at once, in one terminal: DJ Claude, Claude-808, MiniClaude, Claudebase and Claudel.
//   pnpm all          (node tools/all.mjs)
// Each server's output comes a line at a time with its name before it; one Ctrl+C stops them all. A server that
// cannot start (its port taken: it is running already, say) says so and the others carry on. The ports are each
// app's own (DJ_PORT or config.json, CL808_PORT, MINICLAUDE_PORT, CLAUDEBASE_PORT, CLAUDEL_PORT). No dependencies.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVERS = [
  { name: 'DJ Claude', file: 'apps/server/server.mjs', color: 208 },
  { name: 'Claude-808', file: 'apps/drums/server.mjs', color: 215 },
  { name: 'MiniClaude', file: 'apps/synth/server.mjs', color: 80 },
  { name: 'Claudebase', file: 'apps/daw/server.mjs', color: 149 },
  { name: 'Claudel', file: 'apps/live/server.mjs', color: 183 },
];
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const width = Math.max(...SERVERS.map((s) => s.name.length));
const tag = (s) => (tty ? `\x1b[38;5;${s.color}m${s.name.padEnd(width)}\x1b[0m │ ` : `${s.name.padEnd(width)} | `);

let stopping = false;
const children = SERVERS.map((s) => {
  const child = spawn(process.execPath, [path.join(ROOT, s.file)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const out of [child.stdout, child.stderr]) {
    let rest = '';
    out.on('data', (d) => {
      const lines = (rest + d).split(/\r?\n/);
      rest = lines.pop();
      for (const l of lines) if (l.trim()) process.stdout.write(tag(s) + l + '\n');
    });
  }
  child.on('exit', (code) => { if (!stopping) process.stdout.write(tag(s) + `stopped${code ? ` (exit ${code})` : ''}\n`); });
  return child;
});

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) try { c.kill(); } catch { /* gone */ }
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
