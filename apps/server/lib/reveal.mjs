// The way back to the project folder from the page: open it in the file manager, or open a terminal in it running
// Claude Code. The folder is where the rig keeps its things and where Claude Code plays it from, and with the
// installed desktop app it is a folder the app made (Documents/DJ Claude), which nobody chose and few would find.
//   revealCommand()  what to run, as data: [command, arguments]
//   reveal()         runs it, detached. Resolves { ok } or { ok: false, error } when the program is not there.
import { spawn } from 'node:child_process';

export const REVEALS = ['folder', 'claude', 'exports']; // exports: the server opens its exports folder as a 'folder'

export function revealCommand(what, root, platform = process.platform) {
  if (what === 'folder') return platform === 'win32' ? ['explorer.exe', [root]] : platform === 'darwin' ? ['open', [root]] : ['xdg-open', [root]];
  if (what === 'claude') {
    // a new terminal window, in the folder, running `claude`; it stays open if claude is not installed, to say so
    if (platform === 'win32') return ['cmd.exe', ['/c', 'start', 'DJ Claude', '/D', root, 'cmd.exe', '/k', 'claude']];
    if (platform === 'darwin') {
      const quoted = root.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); // inside an AppleScript string
      return ['osascript', ['-e', `tell application "Terminal" to do script "cd " & quoted form of "${quoted}" & " && claude"`, '-e', 'tell application "Terminal" to activate']];
    }
    return ['x-terminal-emulator', ['-e', 'bash', '-lc', 'cd "$1" && claude; exec bash', 'dj-claude', root]];
  }
  throw new Error(`unknown thing to open: ${what} (one of ${REVEALS.join(', ')})`);
}

export function reveal(what, root, { platform = process.platform, run = spawn } = {}) {
  const [cmd, args] = revealCommand(what, root, platform);
  return new Promise((resolve) => {
    let child;
    try { child = run(cmd, args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: false }); } catch (e) { return resolve({ ok: false, error: e.message }); }
    // a program that is not installed fails at once; anything later is the opened window's own business
    const timer = setTimeout(() => { child.unref?.(); resolve({ ok: true }); }, 400);
    child.once('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.code === 'ENOENT' ? `${cmd} was not found on this machine` : e.message }); });
  });
}

// Only a page on this machine may open windows on it: the server also answers other devices on the network (/visuals).
export const isLocal = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
