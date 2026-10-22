// Claudio's banner, in the terminal the suite was started from: the word comes in with one of DJ Claude's
// ANIMATIONS (picked at random, or CLAUDIO_BANNER=<name>) and settles, once. Five apps print into this terminal, so
// nothing keeps moving after it. Anywhere else (a pipe, a file, NO_COLOR) it is the same information as plain lines.
// The apps' own animated banners play only when an app is started by itself: under the suite their output is a pipe.
// No Electron in here, so test/desktop-banner.test.mjs tests it in plain Node.
import { ANIMATIONS, animate, logoRows } from '../server/lib/banner.mjs';

const ESC = '\x1b[';
const dim = (s) => `${ESC}2m${s}${ESC}0m`;

// apps: [{ name, url }]
export async function claudioBanner({ version, apps }, out = process.stdout, env = process.env) {
  const tty = out.isTTY && !env.NO_COLOR && !env.CLAUDIO_NO_BANNER && (out.columns || 80) >= logoRows('CLAUDIO')[0].length + 4;
  if (!tty) {
    out.write(`\n  Claudio ${version}\n${apps.map((a) => `  ${a.name.padEnd(11)}${a.url}\n`).join('')}\n`);
    return;
  }
  const names = Object.keys(ANIMATIONS);
  await animate(ANIMATIONS[env.CLAUDIO_BANNER] || ANIMATIONS[names[Math.floor(Math.random() * names.length)]], out, 'CLAUDIO');
  out.write(`\n  ${ESC}1mClaudio${ESC}0m ${dim(version)}\n\n`);
  for (const a of apps) out.write(`  ${dim(a.name.padEnd(11))}${a.url}\n`);
  out.write('\n');
}
