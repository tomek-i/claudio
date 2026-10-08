// `dj stems setup`: installs the stem separator (PyTorch + demucs) into the project's own .venv, with uv.
// Nothing outside the project folder is changed: uv brings its own Python 3.12 for the venv.
//   setupSteps()  the commands, as data (the tests read them; docs/stems.md lists the same ones for doing it by hand)
//   runSetup()    runs them. `run` is injected by the tests; by default each command's output goes to the terminal.
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findPython } from './stems.mjs';

// demucs without its own dependency list: that list pulls in torchaudio, which has no wheel on some machines and
// which separate.py does not need (it decodes with ffmpeg). These are the ones demucs imports.
export const DEPS = ['demucs', 'dora-search', 'einops', 'julius', 'pyyaml', 'tqdm', 'omegaconf', 'retrying', 'submitit', 'treetable'];
// Which PyTorch: the CPU build (small, runs everywhere), the CUDA build for an NVIDIA card (about 2.5 GB to download,
// 5 GB on disk; cu126 = CUDA 12.6, a driver from 2024 or later), or PyPI's default, which on Apple Silicon has the GPU in it.
export const TORCH_INDEX = { cpu: 'https://download.pytorch.org/whl/cpu', cuda: 'https://download.pytorch.org/whl/cu126', default: null };
export const pickBuild = ({ platform = process.platform, gpu = false } = {}) => (gpu ? 'cuda' : platform === 'darwin' ? 'default' : 'cpu');

const venvPython = (root, platform = process.platform) => (platform === 'win32' ? path.join(root, '.venv', 'Scripts', 'python.exe') : path.join(root, '.venv', 'bin', 'python'));
const CHECK = 'import torch, demucs; print(torch.__version__, demucs.__version__, "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")';

export function setupSteps({ root, build = 'cpu', hasVenv = false, platform = process.platform }) {
  const py = venvPython(root, platform), index = TORCH_INDEX[build];
  return [
    ...(hasVenv ? [] : [{ title: 'Python 3.12 in .venv', cmd: 'uv', args: ['venv', '.venv', '--python', '3.12'] }]),
    { title: `PyTorch (${build === 'cuda' ? 'CUDA build, for an NVIDIA card' : build === 'cpu' ? 'CPU build' : 'default build'})`, cmd: 'uv', args: ['pip', 'install', '--python', py, 'torch', ...(index ? ['--index-url', index] : []), 'numpy'] },
    { title: 'demucs', cmd: 'uv', args: ['pip', 'install', '--python', py, '--no-deps', ...DEPS] },
  ];
}

const UV_HELP = {
  win32: 'winget install --id=astral-sh.uv -e      (or: powershell -c "irm https://astral.sh/uv/install.ps1 | iex")',
  darwin: 'brew install uv      (or: curl -LsSf https://astral.sh/uv/install.sh | sh)',
  linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
};

// run(cmd, args, { cwd, capture }) -> { code, out }: `capture` wants the output back and not on the terminal
function spawnRun(cmd, args, { cwd, capture = false } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(cmd, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true }); } catch { return resolve({ code: -1, out }); }
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('error', () => resolve({ code: -1, out }));
    p.on('close', (code) => resolve({ code, out }));
  });
}

// What is installed now: { python, torch, demucs, device } or null when the separator cannot run.
export async function installed(root, run = spawnRun) {
  const python = findPython(root);
  if (!python) return null;
  const r = await run(python, ['-c', CHECK], { cwd: root, capture: true });
  if (r.code !== 0) return null;
  const [torch, demucs, device] = r.out.trim().split(/\s+/).slice(-3);
  return { python, torch, demucs, device };
}

// Installs what is missing. gpu: the CUDA build of PyTorch (also replaces a CPU build that is there).
// Returns { already, build, python, torch, demucs, device }; throws with a message for the user when it cannot.
export async function runSetup({ root, gpu = false, platform = process.platform, run = spawnRun, log = console.log } = {}) {
  const have = await installed(root, run);
  if (have && !(gpu && have.device !== 'cuda')) return { already: true, build: null, ...have };
  if ((await run('uv', ['--version'], { cwd: root, capture: true })).code !== 0) {
    throw new Error(`uv is not installed (it makes the .venv and brings Python 3.12). Install it, then run this again:\n  ${UV_HELP[platform] || UV_HELP.linux}`);
  }
  const build = pickBuild({ platform, gpu });
  for (const s of setupSteps({ root, build, hasVenv: !!findPython(root), platform })) {
    log(`\n▸ ${s.title}`);
    const r = await run(s.cmd, s.args, { cwd: root });
    if (r.code !== 0) throw new Error(`"${s.cmd} ${s.args.slice(0, 2).join(' ')} …" failed (exit ${r.code}): the lines above say why`);
  }
  const now = await installed(root, run);
  if (!now) throw new Error('the packages installed, but the separator still does not start: run `.venv` python with `-c "import torch, demucs"` to see why');
  return { already: false, build, ...now };
}
