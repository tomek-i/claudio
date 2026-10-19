// What a pinned taskbar button of one of the suite's apps keeps: the command that opens that app, and its icon file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icoOf, relaunchCommand } from '../apps/desktop/taskbar.mjs';

test('relaunchCommand: the installed app opens the app by itself; from the source tree, Electron with the app folder', () => {
  assert.equal(relaunchCommand('synth', { execPath: 'C:\\Program Files\\Claudio\\Claudio.exe', appPath: 'C:\\Program Files\\Claudio\\resources\\app', packaged: true }),
    '"C:\\Program Files\\Claudio\\Claudio.exe" --app synth');
  assert.equal(relaunchCommand('daw', { execPath: 'C:\\src\\node_modules\\electron\\dist\\electron.exe', appPath: 'C:\\src\\apps\\desktop', packaged: false }),
    '"C:\\src\\node_modules\\electron\\dist\\electron.exe" "C:\\src\\apps\\desktop" --app daw');
});

// a PNG's signature and IHDR, enough for icoOf: it reads only the size
const png = (w, h) => {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};

test('icoOf: one PNG in an .ico, its size in the entry (256 as 0), the PNG after the 22 bytes of header', () => {
  const p = png(256, 256), ico = icoOf(p);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.deepEqual([ico[6], ico[7]], [0, 0]);
  assert.deepEqual([ico.readUInt16LE(10), ico.readUInt16LE(12)], [1, 32]);
  assert.deepEqual([ico.readUInt32LE(14), ico.readUInt32LE(18)], [p.length, 22]);
  assert.deepEqual(ico.subarray(22), p);
  const small = icoOf(png(48, 32));
  assert.deepEqual([small[6], small[7]], [48, 32]);
});

test('icoOf: anything but a PNG is refused', () => {
  assert.throws(() => icoOf(Buffer.from('not a picture at all, not a PNG')), /not a PNG/);
});
