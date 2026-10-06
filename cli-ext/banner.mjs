// dj CLI extension: preview the server's startup animations (lib/banner.mjs). Needs no server.
//   dj banner            play every animation, one after another
//   dj banner <name>     play one (see --list)
//   dj banner --list     just the names
import { ANIMATIONS, animate } from '../lib/banner.mjs';

export default ({ flags, rest, fail }) => ({
  async banner() {
    const names = Object.keys(ANIMATIONS);
    if (flags.list) return console.log(names.join('\n'));
    if (rest[0] && !ANIMATIONS[rest[0]]) return fail(`no animation "${rest[0]}" (there is: ${names.join(', ')})`);
    if (!process.stdout.isTTY) return fail('dj banner draws in place, so it needs a terminal (not a pipe or a file)');
    const play = rest[0] ? [rest[0]] : names;
    for (const [i, name] of play.entries()) {
      console.log(`\n  ${name}${play.length > 1 ? `  (${i + 1}/${play.length})` : ''}   DJ_BANNER=${name} starts the server with this one`);
      await animate(ANIMATIONS[name]);
      if (i < play.length - 1) await new Promise((r) => setTimeout(r, 700));
    }
    console.log();
  },
});
