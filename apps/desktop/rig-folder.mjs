// The installed app's project folder. Run from the repository, the rig is the project folder: the code, the skills
// Claude Code plays it with, and what it keeps (config.json, .dj/, library/, bin/). An installed app has no such
// folder: its code sits in the install directory, which an update replaces. So it makes one in a folder of the
// user's, as a whole project: open Claude Code there and `node dj.mjs …`, the skills and tools/produce all work as
// they do in the repository (with Node on the machine), talking to the server the app runs.
//
// Two kinds of thing go in:
//  - the app's own (APP_OWNED, and each skill the app ships): replaced whenever the app is a different build from
//    the one that last wrote them, so an update brings its code, skills and starter list. Edits to them are lost.
//  - the user's (USER_OWNED): copied once, then never touched.
// Everything else in the folder (the library, .dj/, bin/, .venv/, skills of the user's own) is left alone.
// No Electron in here: root.mjs decides when and where, and the tests call this directly.
import fs from 'node:fs';
import path from 'node:path';

const APP_OWNED = ['apps/server', 'apps/cli', 'apps/web', 'tools', 'starter', 'dj.mjs', 'CLAUDE.md'];
const USER_OWNED = ['config.json', '.claude/settings.json'];
const STAMP = '.dj/app-build'; // which build of the app last wrote its files here

// The build's identity: its version, and when it was packaged (two builds of one version differ).
export function buildStamp(shipped) {
  const pkg = path.join(shipped, 'package.json');
  return `${JSON.parse(fs.readFileSync(pkg, 'utf8')).version} ${Math.round(fs.statSync(pkg).mtimeMs)}`;
}

// root: the folder to make ready. shipped: the app's own files, laid out as the repository is.
// Returns root. A git checkout (DJ_ROOT pointed at the repository) keeps its own code: only its settings are made.
export function prepareRigFolder(root, shipped) {
  fs.mkdirSync(root, { recursive: true });
  const checkout = fs.existsSync(path.join(root, '.git'));
  for (const f of checkout ? ['config.json'] : USER_OWNED) {
    const to = path.join(root, f);
    if (fs.existsSync(to) || !fs.existsSync(path.join(shipped, f))) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(shipped, f), to);
  }
  if (checkout) return root;

  const stamp = buildStamp(shipped), stampFile = path.join(root, STAMP);
  let have = null;
  try { have = fs.readFileSync(stampFile, 'utf8'); } catch { /* first start */ }
  if (have === stamp) return root;
  const skillsDir = path.join(shipped, '.claude', 'skills');
  const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).map((n) => `.claude/skills/${n}`) : [];
  for (const f of [...APP_OWNED, ...skills]) {
    const from = path.join(shipped, f), to = path.join(root, f);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(to, { recursive: true, force: true }); // a file the new build dropped must not stay behind
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' });
  }
  // last: a copy that was cut short is done again on the next start
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, stamp);
  return root;
}
