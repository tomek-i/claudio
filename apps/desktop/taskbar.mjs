// What Windows needs to give each app of the suite a taskbar button that can be pinned: the command that opens that
// app again (a pinned button runs it once the suite is closed), and an .ico of its icon (a pinned button's picture
// is read from a file). No Electron in here, so test/desktop-taskbar.test.mjs tests it in plain Node.

// The command line that opens one app: the installed app is its own program; in the source tree it is Electron
// with the app's folder (`electron .`, as `pnpm desktop` runs it).
export function relaunchCommand(id, { execPath, appPath, packaged }) {
  const q = (s) => `"${s}"`;
  return [q(execPath), ...(packaged ? [] : [q(appPath)]), '--app', id].join(' ');
}

// An .ico holding one PNG (Windows reads PNGs in .ico files since Vista): the 6-byte header, one 16-byte entry, the
// PNG. Its size comes from the PNG's own header; 256 is written as 0, as the format has it.
export function icoOf(png) {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type 1 (icon), one image
  head.writeUInt8(w >= 256 ? 0 : w, 6); head.writeUInt8(h >= 256 ? 0 : h, 7);
  head.writeUInt8(0, 8); head.writeUInt8(0, 9); // no palette, reserved
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); // planes, bits per pixel
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18); // the PNG's size, and where it starts
  return Buffer.concat([head, png]);
}
