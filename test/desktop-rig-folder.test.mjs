// The installed desktop app's project folder: made on the first start from what the app ships, and on later starts
// the user's settings are left alone while the starter crate's list follows the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareRigFolder } from '../apps/desktop/rig-folder.mjs';
import { findRoot } from '../apps/server/lib/paths.mjs';

test('prepareRigFolder: the first start makes the folder; an update keeps the settings and brings its starter list', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-rig-')), shipped = path.join(tmp, 'app'), root = path.join(tmp, 'Documents', 'DJ Claude');
  const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
  try {
    fs.mkdirSync(path.join(shipped, 'starter'), { recursive: true });
    fs.writeFileSync(path.join(shipped, 'config.json'), '{"port":4747}');
    fs.writeFileSync(path.join(shipped, 'starter', 'tracks.json'), '["one"]');

    assert.equal(prepareRigFolder(root, shipped), root);
    assert.equal(read(root, 'config.json'), '{"port":4747}');
    assert.equal(read(root, 'starter', 'tracks.json'), '["one"]');
    // it is a project folder as the server understands one
    assert.equal(findRoot(path.join(root, 'starter'), {}), root);

    // the user changes a setting, then installs an update with other defaults and a longer starter list
    fs.writeFileSync(path.join(root, 'config.json'), '{"port":5000}');
    fs.writeFileSync(path.join(shipped, 'config.json'), '{"port":4747,"new":true}');
    fs.writeFileSync(path.join(shipped, 'starter', 'tracks.json'), '["one","two"]');
    prepareRigFolder(root, shipped);
    assert.equal(read(root, 'config.json'), '{"port":5000}');
    assert.equal(read(root, 'starter', 'tracks.json'), '["one","two"]');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
