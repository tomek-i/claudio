# Stems (vocals / drums / bass / other)

[← Back to the README](../README.md)

Optional, project-local. Every track can be split into `.dj/stems/<trackId>/{vocals,drums,bass,other}.wav`
by demucs (`htdemucs`) in the background at idle priority; the vocal stem also gives each track a vocal map that the
mixer uses to avoid vocal clashes. One command installs it into `.venv` (no system changes; it needs
[uv](https://docs.astral.sh/uv/), which brings its own Python 3.12):
```bash
node dj.mjs stems setup          # about 600 MB; then the library is separated in the background
node dj.mjs stems setup --gpu    # with an NVIDIA card: the CUDA build of PyTorch (about 2.5 GB to download, 5 GB on disk)
```
A running server picks the new `.venv` up without a restart. Without `--gpu` it is the CPU build of PyTorch, which
cannot see a graphics card even when there is one. What the command runs, to do it by hand:
```bash
uv venv .venv --python 3.12
uv pip install torch --index-url https://download.pytorch.org/whl/cpu numpy      # --gpu: …/whl/cu126
uv pip install --no-deps demucs dora-search einops julius pyyaml tqdm omegaconf retrying submitit treetable
```
`cu126` is CUDA 12.6 and needs a driver from 2024 or later (`nvidia-smi` shows the driver version); the indexes
PyTorch currently offers are listed at https://pytorch.org/get-started/locally/. On Apple Silicon the default build
(`uv pip install torch numpy`) includes GPU support.

Separation runs on the GPU when PyTorch finds one and on the CPU otherwise, and a track whose GPU run fails (out of
memory, say) is redone on the CPU. `dj stems status` and the health page show which is in use; "Run on: CPU only" on
the settings page (`stems.device`) keeps it off the GPU. On the CPU, separation throttles to one job while music
plays; a GPU takes one track at a time regardless.

`apps/server/lib/separate.py` decodes with ffmpeg and writes WAVs itself, so it also works where torchaudio has no wheel (Windows on
ARM). Model weights download to `.dj/models/` on first run. Control: `config.json → stems` (`enabled`, `auto`,
`device`, `concurrency`, `threads`), `dj stems <id|all>`, `dj stems status`, `dj vocals <id>`.

On a 12-core laptop CPU a track takes roughly two to three times its own length to separate, two tracks at a time,
and the four stems of a three-minute track are about 120 MB.
