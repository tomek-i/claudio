// `dj stems setup`: which commands it runs for which machine, when it does nothing, and what it says when it cannot.
// No uv and no network here: the commands are run by a stand-in that plays their part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEPS, pickBuild, runSetup, setupSteps } from '../apps/server/lib/stems-setup.mjs';
import { StemQueue } from '../apps/server/lib/stems.mjs';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dj-claude-stems-setup-'));
const venvPython = (root) => (process.platform === 'win32' ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python'));
// A machine: uv is there or not; `uv venv` makes the python; the python can import the packages once both installs ran.
function machine(root, { uv = true, torch = null, demucs = false, failAt = null } = {}) {
  const ran = [], state = { torch, demucs };
  const run = async (cmd, args) => {
    ran.push([cmd, ...args].join(' '));
    if (cmd === 'uv') {
      if (!uv) return { code: -1, out: '' };
      if (failAt && args.includes(failAt)) return { code: 1, out: '' };
      if (args[0] === 'venv') { fs.mkdirSync(path.dirname(venvPython(root)), { recursive: true }); fs.writeFileSync(venvPython(root), ''); }
      if (args[0] === 'pip' && args.includes('torch')) state.torch = args.includes('https://download.pytorch.org/whl/cu126') ? 'cuda' : 'cpu';
      if (args[0] === 'pip' && args.includes('demucs')) state.demucs = true;
      return { code: 0, out: 'uv 0.9' };
    }
    // the venv's python, asked whether the separator imports
    return state.torch && state.demucs ? { code: 0, out: `2.9.0 4.1.0 ${state.torch}\n` } : { code: 1, out: 'ModuleNotFoundError' };
  };
  return { run, ran, state };
}
const quiet = () => {};

test('setupSteps: the CPU build by default, CUDA for --gpu, the default build on a Mac; an existing .venv is kept', () => {
  assert.equal(pickBuild({ platform: 'win32' }), 'cpu');
  assert.equal(pickBuild({ platform: 'linux', gpu: true }), 'cuda');
  assert.equal(pickBuild({ platform: 'darwin' }), 'default');
  const root = path.join('C:', 'rig'), line = (s) => [s.cmd, ...s.args].join(' ');
  const cpu = setupSteps({ root, build: 'cpu', platform: 'win32' }).map(line);
  assert.equal(cpu.length, 3);
  assert.equal(cpu[0], 'uv venv .venv --python 3.12');
  assert.match(cpu[1], /^uv pip install --python .*\.venv.Scripts.python\.exe torch --index-url https:\/\/download\.pytorch\.org\/whl\/cpu numpy$/);
  assert.match(cpu[2], new RegExp(`--no-deps ${DEPS.join(' ')}$`));
  assert.match(setupSteps({ root, build: 'cuda', platform: 'linux' }).map(line)[1], /\.venv.bin.python torch --index-url https:\/\/download\.pytorch\.org\/whl\/cu126 numpy$/);
  assert.match(setupSteps({ root, build: 'default', platform: 'darwin' }).map(line)[1], /python torch numpy$/);
  assert.equal(setupSteps({ root, build: 'cpu', hasVenv: true }).length, 2);
});

test('runSetup: a bare folder gets the venv, PyTorch and demucs, in that order, and the result says what runs', async () => {
  const root = scratch();
  try {
    const m = machine(root);
    const r = await runSetup({ root, run: m.run, log: quiet, platform: 'linux' });
    assert.deepEqual({ already: r.already, build: r.build, torch: r.torch, demucs: r.demucs, device: r.device }, { already: false, build: 'cpu', torch: '2.9.0', demucs: '4.1.0', device: 'cpu' });
    assert.equal(r.python, venvPython(root));
    const uv = m.ran.filter((c) => c.startsWith('uv '));
    assert.deepEqual(uv.map((c) => c.split(' ').slice(0, 3).join(' ')), ['uv --version', 'uv venv .venv', 'uv pip install', 'uv pip install']);

    // again: nothing to do, and nothing is run but the check
    m.ran.length = 0;
    assert.equal((await runSetup({ root, run: m.run, log: quiet, platform: 'linux' })).already, true);
    assert.ok(!m.ran.some((c) => c.startsWith('uv ')));

    // --gpu on a CPU install replaces PyTorch, in the venv that is there
    m.ran.length = 0;
    const gpu = await runSetup({ root, gpu: true, run: m.run, log: quiet, platform: 'linux' });
    assert.deepEqual({ already: gpu.already, build: gpu.build, device: gpu.device }, { already: false, build: 'cuda', device: 'cuda' });
    assert.ok(!m.ran.some((c) => c.startsWith('uv venv')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runSetup: without uv it says how to get it; a failed install names the step', async () => {
  const root = scratch();
  try {
    await assert.rejects(runSetup({ root, run: machine(root, { uv: false }).run, log: quiet, platform: 'win32' }), /uv is not installed[\s\S]*winget install/);
    assert.ok(!fs.existsSync(path.join(root, '.venv')));
    await assert.rejects(runSetup({ root, run: machine(root, { failAt: 'torch' }).run, log: quiet, platform: 'linux' }), /"uv pip install …" failed \(exit 1\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the stem queue finds a .venv made while the server runs; a python handed in is never looked for again', () => {
  const root = scratch();
  try {
    const script = path.join(root, 'separate.py');
    fs.writeFileSync(script, '');
    const opts = { root, library: { tracks: new Map(), save() {} }, stemsDir: path.join(root, 'stems'), script };
    const q = new StemQueue(opts), none = new StemQueue({ ...opts, python: null });
    assert.equal(q.available, false);
    fs.mkdirSync(path.dirname(venvPython(root)), { recursive: true });
    fs.writeFileSync(venvPython(root), '');
    assert.equal(q.available, true);
    assert.equal(q.status().python, venvPython(root));
    assert.equal(none.available, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
