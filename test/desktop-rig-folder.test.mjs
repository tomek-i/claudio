// The installed desktop app's project folder: a whole project made from what the app ships, so Claude Code, the CLI
// and the skills work in it. An update replaces the app's own files and leaves the user's alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildStamp, prepareRigFolder } from '../apps/desktop/rig-folder.mjs';
import { findRoot } from '../apps/server/lib/paths.mjs';
import { REAL } from './server-harness.mjs';

const put = (dir, files) => { for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); } };
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-rig-'));
const ship = (dir, version, extra = {}) => put(dir, {
  'package.json': JSON.stringify({ version }), 'config.json': '{"port":4747}', '.claude/settings.json': '{"shipped":true}',
  'dj.mjs': `// ${version}`, 'CLAUDE.md': `# ${version}`, 'starter/tracks.json': '["one"]',
  'apps/server/server.mjs': `// ${version}`, 'apps/cli/dj.mjs': '//', 'apps/web/public/index.html': '<html>', 'tools/produce/viz.mjs': '//',
  '.claude/skills/dj/SKILL.md': `dj ${version}`, ...extra,
});

test('prepareRigFolder: the first start makes a whole project; an update replaces the files of the app and keeps those of the user', () => {
  const tmp = scratch(), shipped = path.join(tmp, 'app'), root = path.join(tmp, 'Documents', 'DJ Claude');
  try {
    ship(shipped, '1.0.0', { 'apps/server/lib/old.mjs': '// dropped in 1.1.0', '.claude/skills/dj-old/SKILL.md': 'old' });
    assert.equal(prepareRigFolder(root, shipped), root);
    for (const f of ['config.json', '.claude/settings.json', 'dj.mjs', 'CLAUDE.md', 'starter/tracks.json', 'apps/server/server.mjs', 'apps/cli/dj.mjs', 'apps/web/public/index.html', 'tools/produce/viz.mjs', '.claude/skills/dj/SKILL.md']) assert.ok(fs.existsSync(path.join(root, f)), f);
    // it is a project folder as the server and the CLI understand one
    assert.equal(findRoot(path.join(root, 'apps', 'server'), {}), root);

    // the user changes settings, adds a skill and music, and edits one of the app's files
    put(root, { 'config.json': '{"port":5000}', '.claude/settings.json': '{"mine":true}', '.claude/skills/my-own/SKILL.md': 'mine', 'library/track.mp3': 'music', '.dj/library.json': '{}', 'apps/server/server.mjs': '// edited' });

    // the same build again: nothing is copied (the edit is still there)
    prepareRigFolder(root, shipped);
    assert.equal(read(root, 'apps/server/server.mjs'), '// edited');

    // an update: new code, a file dropped, other default settings
    fs.rmSync(shipped, { recursive: true });
    ship(shipped, '1.1.0', { 'config.json': '{"port":4747,"new":true}', 'starter/tracks.json': '["one","two"]' });
    prepareRigFolder(root, shipped);
    assert.equal(read(root, 'apps/server/server.mjs'), '// 1.1.0');
    assert.equal(read(root, '.claude/skills/dj/SKILL.md'), 'dj 1.1.0');
    assert.equal(read(root, 'starter/tracks.json'), '["one","two"]');
    assert.ok(!fs.existsSync(path.join(root, 'apps/server/lib/old.mjs')), 'a file the update dropped is gone');
    assert.equal(read(root, '.dj/app-build'), buildStamp(shipped));
    // the user's things are as they left them
    assert.equal(read(root, 'config.json'), '{"port":5000}');
    assert.equal(read(root, '.claude/settings.json'), '{"mine":true}');
    assert.equal(read(root, '.claude/skills/my-own/SKILL.md'), 'mine');
    assert.equal(read(root, 'library/track.mp3'), 'music');
    assert.equal(read(root, '.dj/library.json'), '{}');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('prepareRigFolder: a git checkout keeps its own code; only missing settings are made', () => {
  const tmp = scratch(), shipped = path.join(tmp, 'app'), root = path.join(tmp, 'repo');
  try {
    ship(shipped, '1.0.0');
    put(root, { '.git/HEAD': 'ref', 'apps/server/server.mjs': '// my work', 'CLAUDE.md': '# mine' });
    prepareRigFolder(root, shipped);
    assert.equal(read(root, 'apps/server/server.mjs'), '// my work');
    assert.equal(read(root, 'CLAUDE.md'), '# mine');
    assert.equal(read(root, 'config.json'), '{"port":4747}');
    assert.ok(!fs.existsSync(path.join(root, 'tools')) && !fs.existsSync(path.join(root, '.dj')) && !fs.existsSync(path.join(root, '.claude')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a folder made from this repository runs the CLI with Node alone, as its own project', () => {
  const tmp = scratch(), root = path.join(tmp, 'DJ Claude');
  try {
    prepareRigFolder(root, REAL);
    // every skill the repository has is there, and the tools the skills call
    assert.deepEqual(fs.readdirSync(path.join(root, '.claude', 'skills')).sort(), fs.readdirSync(path.join(REAL, '.claude', 'skills')).sort());
    assert.ok(fs.existsSync(path.join(root, 'tools', 'produce', 'make-video.mjs')));
    const env = { ...process.env }; delete env.DJ_ROOT;
    assert.match(execFileSync(process.execPath, ['dj.mjs', 'help'], { cwd: root, encoding: 'utf8', env }), /SETUP/);
    // nothing of the desktop app's own, and none of its dependencies, is needed there
    assert.ok(!fs.existsSync(path.join(root, 'apps', 'desktop')) && !fs.existsSync(path.join(root, 'node_modules')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
