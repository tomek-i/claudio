// Opening the project folder, or Claude Code in it, from the page: the command for each platform, a program that is
// not there, and who may ask. Nothing is opened here: the commands are data, and reveal() gets a stand-in to run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { isLocal, reveal, revealCommand } from '../apps/server/lib/reveal.mjs';

const WIN = 'C:\\Users\\Ann\\Documents\\DJ Claude', NIX = '/home/ann/DJ Claude';

test('revealCommand: the folder in the file manager of each platform', () => {
  assert.deepEqual(revealCommand('folder', WIN, 'win32'), ['explorer.exe', [WIN]]);
  assert.deepEqual(revealCommand('folder', NIX, 'darwin'), ['open', [NIX]]);
  assert.deepEqual(revealCommand('folder', NIX, 'linux'), ['xdg-open', [NIX]]);
});

test('revealCommand: Claude Code in a terminal that starts in the folder; the path is one argument, never spliced into a shell line', () => {
  assert.deepEqual(revealCommand('claude', WIN, 'win32'), ['cmd.exe', ['/c', 'start', 'DJ Claude', '/D', WIN, 'cmd.exe', '/k', 'claude']]);
  const [cmd, args] = revealCommand('claude', NIX, 'linux');
  assert.equal(cmd, 'x-terminal-emulator');
  assert.equal(args.at(-1), NIX);
  assert.ok(!args.slice(0, -1).some((a) => a.includes(NIX)));
  // AppleScript takes it inside a string: quotes and backslashes in the path are escaped, and the shell gets it quoted
  const [osa, script] = revealCommand('claude', '/Users/ann/My "DJ" \\ rig', 'darwin');
  assert.equal(osa, 'osascript');
  assert.equal(script[1], 'tell application "Terminal" to do script "cd " & quoted form of "/Users/ann/My \\"DJ\\" \\\\ rig" & " && claude"');
  assert.throws(() => revealCommand('shell', NIX, 'linux'), /unknown thing to open/);
});

test('reveal: runs the command in the folder, detached; a program that is not installed is an error that names it', async () => {
  const calls = [];
  const ok = await reveal('folder', NIX, { platform: 'linux', run: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return Object.assign(new EventEmitter(), { unref() {} }); } });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual([calls[0].cmd, calls[0].args, calls[0].opts.cwd, calls[0].opts.detached], ['xdg-open', [NIX], NIX, true]);

  const missing = await reveal('claude', NIX, { platform: 'linux', run: () => { const c = new EventEmitter(); setImmediate(() => c.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))); return c; } });
  assert.deepEqual(missing, { ok: false, error: 'x-terminal-emulator was not found on this machine' });
});

test('isLocal: only the machine itself', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLocal(a), true, a);
  for (const a of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.5', undefined]) assert.equal(isLocal(a), false, String(a));
});
