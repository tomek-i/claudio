# DJ Claude 🎧

A DJ rig that **Claude Code plays**. You direct the set in plain text ("play Sandstorm next", "kill the bass", "harder",
"mix into something darker"); Claude reads the crate, picks tracks, times the mixes on the beat and talks to the booth.
The browser tab is the sound system and the visuals.

```
you (typing in Claude Code) ──► Claude + DJ skills ──► node dj.mjs … ──► server ──► browser audio engine ──► speakers
                                                                 ▲                         │
                                                crowd requests from the booth ◄────────────┘
```

Everything runs locally: a Node server, a Web Audio engine in your browser, ffmpeg for analysis, yt-dlp for the crate.
No npm dependencies.

## Quick start
Requirements: **Node 20+**, **ffmpeg + ffprobe** on PATH, a Chromium-based browser, and [Claude Code](https://claude.com/claude-code).

```bash
git clone <this repo> dj-claude && cd dj-claude
node dj.mjs doctor --fix     # checks the server, engine and library, downloads yt-dlp into bin/
node dj.mjs starter          # optional: 12 Creative Commons tracks (hip-hop, house, techno, drum & bass) into library/starter/
node dj.mjs start            # starts the server and opens http://localhost:4747
```
Click **Start engine** in the tab once (browsers need one click before they may play audio). Drop some music into
`library/` or let Claude download it. An empty crate shows a **Download demo tracks** button that fetches the same
starter crate as `dj starter` (tracks and licences in [starter/README.md](starter/README.md)). Then open Claude Code in
this folder and talk to it:

- `play a 30 minute house set that builds to a peak`
- `get me Darude - Sandstorm and Headhunterz - Dragonborn`
- `mix into Sandstorm on the next phrase` · `kill the bass… bring it back on the drop`
- `harder` · `chill it out` · `loop this` · `wrap it up in 10 minutes`
- `record this and make me a video of the set`

People in the room can type requests into the **booth** box in the browser; Claude sees them as crowd requests.

The page can be played by hand too: drag a track from the crate onto a deck (or drop audio files from your computer on
one to import and load them), drag the big waveform to scratch, hold Alt to move the playhead silently, and use the
mouse wheel on it to zoom. A playing deck is locked against waveform drags unless you hold Shift or open the lock.

### As a desktop app
The same server and the same page in a window of their own, instead of a browser tab:
```bash
pnpm install     # once: Electron, for the desktop app only (it fetches its own binary, about 370 MB, on first run)
pnpm desktop
```
- **A start-up window**: it opens at once and lists each step as it happens (the server, the health checks, the
  audio engine), then gives way to the DJ page when the engine is live. If the server cannot start, it says why.
- **The window where you left it**: it opens on the same screen, at the same size, maximised or not (maximised the
  first time).
- **No Start engine click**: the app may play sound without one, so the window is the sound system as soon as it opens.
- **No stale engine**: the window is not slowed down when it is hidden or minimised, as a background browser tab is.
- **One thing to launch**: the server starts with the app and stops with it. If a server is already running
  (`node dj.mjs start`), the app uses that one and leaves it running when it quits.

Claude Code and `node dj.mjs …` work the same in both modes: they talk to the server. Browser mode needs no install;
only `apps/desktop/` has dependencies.

#### An installer
Each [release](https://github.com/tomek-i/dj-claude/releases) has the Windows installer attached
(`DJ-Claude-Setup-<version>.exe`); `pnpm dist` builds the same thing into `dist/`. It is not code-signed, so Windows
asks before running it.

The installed app is the same window, started from the Start menu, and it brings the whole project with it. On the
first start it makes **Documents/DJ Claude**: a project folder like this repository, with `dj.mjs`, the skills
(`.claude/skills`), `CLAUDE.md`, `tools/produce` and its own `config.json`, library and `.dj/`. Open Claude Code in
that folder and it plays the rig exactly as it does here; the start-up window shows where the folder is. What the
machine needs besides the app: Node 20+ (for `node dj.mjs …`, which is how Claude Code drives it), Claude Code, and
ffmpeg on PATH. Stem separation needs a `.venv` in that folder (see Stems below).

An update replaces the app's own files in that folder (`apps/`, `tools/`, `starter/`, `dj.mjs`, `CLAUDE.md` and the
skills it ships) and leaves yours alone: `config.json`, `.claude/settings.json`, the library, `.dj/`, skills you added.

## How it works
| Piece | What it does |
|---|---|
| `apps/server/server.mjs` | Holds the library and analysis cache, relays commands to the browser engine, long-polls (`dj wait`), booth log, crowd inbox, recorder, auto-DJ. |
| `dj.mjs` + `apps/cli/cli-ext/` | The CLI Claude drives: `node dj.mjs help` and `node dj.mjs help-engine`. |
| `apps/web/public/engine.js`, `apps/web/public/worklets/` | Web Audio engine: four decks (A/B + C/D), 3-band kill EQ, filter, beat-synced echo, loops, key lock + key shift (WSOLA), per-stem playback, deck FX, 8-pad sampler, scratching, sample-accurate transitions. |
| `apps/web/public/app.js`, `apps/web/public/ui/`, `apps/web/public/css/` | The DJ-table UI and the booth feed: plain ES modules and per-component stylesheets, no build step. |
| `apps/server/lib/analyze.mjs` | BPM and beat grid, downbeat, key (Camelot), loudness, energy 1–10, intro/breakdowns/drops/outro, section labels, auto hot cues. |
| `apps/server/lib/library.mjs` | Cache, search, harmonic/tempo/energy suggestions, mashup pairing. |
| `apps/server/lib/downloader.mjs` | yt-dlp wrapper: search, download, playlist caps; uses `.dj/youtube-cookies.txt` if you provide one. |
| `apps/server/lib/sequencer.mjs`, `apps/server/lib/monitor.mjs`, `apps/server/lib/memory.mjs` | Scheduled plan steps and track queue, auto-DJ safety net, mix monitor with transition critiques, set memory + ratings. |
| `apps/server/lib/settings.mjs`, `apps/server/lib/health.mjs` | The `/settings` page (edits `config.json`, says which settings apply live and which need a restart) and the `/health` page with `GET /api/health` (one ok/warn/fail/off entry per system, checked only on request). |
| `apps/server/lib/starter.mjs`, `starter/` | The Creative Commons starter crate behind `dj starter` and the **Download demo tracks** button. |
| `apps/server/lib/banner.mjs` | The server's startup banner: one of fifteen animations at random, then an equaliser that follows the live deck's beat. |
| `apps/server/lib/stems.mjs` + `apps/server/lib/separate.py` | Optional stem separation (demucs) so vocals/drums/bass can be muted or swapped live. |
| `tools/produce/` | Production toolchain: Playwright page recording, set/album video rendering, caption indexing for speech clips, voice-reel builder, live design runner, per-track cutting, speaker footage cut-ins (`video-cuts.mjs`), deck screenshots (`snap-deck.mjs`). |

### Skills (`.claude/skills/`)
These are what make Claude a DJ rather than a chatbot with a CLI. Claude Code loads them automatically in this folder.

| Skill | Use |
|---|---|
| `dj` | Front door: boot, status, turn any text direction into deck/mixer commands. Full CLI reference. |
| `dj-set` | Autopilot set with an energy arc, harmonic track selection and phrase-timed mixes. Steerable at any moment. |
| `dj-mix` | Transition craft: style, length, timing, entry point (intro / drop), knob choreography. |
| `dj-crate` | Find and download music (extended mixes preferred), search by BPM/key/energy, trust the analysis. |
| `dj-video` | Record the DJ table page while a set plays and render a music video of the exported set. |
| `dj-mashup` | Live mashups with stems: pairing rules, key/tempo fit, vocal placement, loop-roll into the drop. |
| `dj-voice` | Speech clips as the vocals: caption index, exact lines and phrases, a beat-locked voice reel played live. |
| `dj-album` | A themed album as one live take: beds per track, one planning subagent per song, per-track masters and videos. |
| `dj-troubleshoot` | Symptom → fix table for the rig (engine stale, silent deck, stuck loop, disk, stems load, YouTube wall). |

`CLAUDE.md` tells Claude how the folder is wired and how to behave during a live set (short waits, the user's latest words win).

## Transitions and timing
Transitions are scheduled on the audio clock, so they land on the beat even with the tab in the background:
`blend` (EQ blend + bass swap) · `bassswap` · `double` · `fade` · `filter` · `echo` · `cut` · `brake` · `spinback`, started
`--at now|bar|phrase`, with the incoming track entering at its `mixin`, `intro` or `drop`. `dj perform` schedules knob
choreography per beat; `dj plan add` schedules any command for a future bar, mix-out point or wall-clock time.

The **auto-DJ** steps in only if the live track is 45 s from its end with nothing planned. The **mix monitor** flags vocal
clashes, key clashes, beat-phase offsets, tempo mismatch and clipping, and critiques every transition in the booth.

## Visuals for a second screen
`http://<this machine>:4747/visuals` is a full-screen visualiser that reacts to the live set: for a projector behind
the decks, a second monitor, or someone's phone. The server prints the address with this machine's network address
when it starts, and `dj visuals` shows it again. The page only watches; it has no deck controls.

- **Modes**: spectrum tunnel, particle field, reactive terrain, kaleidoscope. **Auto** (the default) moves between
  them on musical boundaries (a new track, a breakdown, the start of a phrase), over several bars. Between the tunnel,
  the particle field and the terrain the change is a morph: the same points of light fly from one shape into the
  other. A change into or out of the kaleidoscope, which is a full-screen shader with no shape, crossfades.
  Pick one on the page (move the pointer for the overlay, or keys `1`-`4`, `A` for auto), by address
  (`/visuals?mode=tunnel`), or from the booth for every open page: `dj visuals <mode|auto>`.
- **Colour follows the track**: the hue is the key's colour as on the deck's key chip, the accent is the deck colour,
  and both move from one track to the next as the mix does. Energy and structure set how intense it is.
- **Sound, if wanted**: the page is silent until a viewer turns the sound on (the Sound button, `S`, or
  `/visuals?audio=1` and one click). The viewer then hears the set a second or two behind the decks, and the picture
  is locked to what that viewer hears. With the sound off the picture runs as close to live as it can, for a screen
  in the room; `/visuals?offset=<ms>` or the `←` `→` keys shift it for a slow projector. The `visuals.audio` setting
  switches the sound off for everyone.
- **Low-latency sound** (the `visuals.lowLatency` setting, off by default for now): on the same network the sound
  goes straight from the DJ page to the viewer over WebRTC, about a tenth of a second behind the decks instead of
  a second or two. No audio passes through the server on that path and nothing outside the network is contacted.
  It is tried first; a viewer it cannot reach within three seconds, or one beyond `visuals.maxListeners` (8), hears
  the set through the server as before, and the overlay says which way the sound is coming.
- **Quality**: the morphing modes draw 250 thousand, 1 million or 4 million points (low, medium, high). The page
  picks a tier for the graphics card when it starts and steps down one if it cannot hold the frame rate;
  `/visuals?quality=low|medium|high` fixes it.
- **Needs WebGPU** (a current Chrome or Edge). It is drawn with three.js, vendored in `apps/web/public/vendor/three/`; there is
  no WebGL fallback, and a browser without WebGPU gets a message saying so.

The engine tab measures the sound and encodes audio only while someone is watching or listening. `/health` shows both
streams.

## Making a video of a set
```bash
node tools/produce/record-browser.mjs                 # before the set: records the DJ table page (Playwright), becomes the sound system
node dj.mjs record start --no-screen --no-mic   # … play the set …
node dj.mjs record stop && node dj.mjs export   # → .dj/exports/<session>.mp3 + tracklist
node tools/produce/record-browser.mjs --stop
node tools/produce/make-video.mjs .dj/exports/<session>.mp3 --title "DJ Claude - Saturday Night Set" --screen auto
```
You get a 720p mp4 and a 480p copy: reactive visualiser, title card, the DJ table as footage, one colour tint per track.
Details and options in `.claude/skills/dj-video/SKILL.md`.

## Speech clips as the vocals, and albums
An hour-long album can be made this way: talk clips indexed from their captions
(`tools/produce/index-captions.mjs`), a title hook per track cut word-accurately, verses that literally match the song's
words, one subagent planning each song, a voice reel built with `tools/produce/build-reel.mjs`, the whole thing played as one
live take by `tools/produce/run-design.mjs` and cut into tracks with `tools/produce/cut-track.mjs`. The `dj-voice` and `dj-album`
skills walk through it; `tools/produce/songs/README.md` is the song-plan schema.

## Stems (vocals / drums / bass / other)
Optional, project-local. Every track can be split into `.dj/stems/<trackId>/{vocals,drums,bass,other}.wav`
by demucs (`htdemucs`) in the background at idle priority; the vocal stem also gives each track a vocal map that the
mixer uses to avoid vocal clashes. Install into `.venv` (no system changes):
```bash
uv venv .venv --python 3.12
uv pip install torch --index-url https://download.pytorch.org/whl/cpu numpy
uv pip install --no-deps demucs dora-search einops julius pyyaml tqdm omegaconf retrying submitit treetable
```
That is the CPU build of PyTorch, which cannot see a graphics card even when there is one. With an NVIDIA card,
install the CUDA build instead (about 2.5 GB to download, 5 GB on disk); it replaces the second line:
```bash
uv pip install torch --index-url https://download.pytorch.org/whl/cu126 numpy
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

## Configuration and data
`config.json`: port, `libraryDirs` (default `./library`; add more on the `/settings` page), download folder, loudness target, stems, auto-DJ.
Edit it by hand or on the **settings page** at http://localhost:4747/settings, which also has the UI options (the deck layout:
stacked like a CDJ or the classic side-by-side one, and the size of the jog wheel's outer ring) and marks the settings that need a restart. http://localhost:4747/health shows
whether each part of the rig (engine, ffmpeg, yt-dlp, stems, disk) is working.

Every keyboard shortcut can be changed in the **Key bindings** section of the settings page (click a key, press the new
one), with presets and import / export. Bindings follow the physical key, so the chop keyboard keeps its piano shape on
any layout. The **Keys** button in the DJ page's header lists the current ones.

The server greets you with an animated banner and keeps its equaliser moving with the music. `node dj.mjs banner [name]`
previews the animations, `DJ_BANNER=<name>` picks one, and `DJ_BANNER_LOOP=0` (or the `banner.loop` setting) leaves the
equaliser still. Output that is not a terminal gets plain text.

Everything the rig generates lives in `.dj/` (git-ignored): `library.json` analysis cache, `pcm/` decoded audio cache
(safe to delete), `stems/`, `sessions/` and `exports/` (recordings, mp3 + tracklist + cue), `memory.json`, `cues.json`,
`grid-edits.json`, `server.log`. Music lives in `library/` (git-ignored).

YouTube sometimes asks for a login. Export your cookies to `.dj/youtube-cookies.txt` (Netscape format) and both
`dj get` and `tools/produce/get-sample.mjs` will use them. Never commit that file.

## Tests
```bash
node --test test/*.test.mjs test/server-*.mjs
```
Server tests run scratch copies on ports 4851–4858 with a fake engine and a generated library (synthetic tracks run
through the real analyser), so they need no music on the machine and never touch `.dj/`.

Benchmarks compare the working tree with the git ref in `tools/bench/baseline.json` (`BENCH_BASE=<ref>` overrides it) and check
that the output is byte-identical:
```bash
node tools/bench/analyze.bench.mjs     # also: deck-voice, zoom, library
```

## Releases
Versions and the changelog come from the commit messages ([Conventional Commits](https://www.conventionalcommits.org):
`feat(visuals): …`, `fix(ui): …`). On every push to `main`, [release-please](https://github.com/googleapis/release-please)
keeps a release pull request up to date with the next version and `CHANGELOG.md`; merging it tags the version and
publishes the GitHub release. A `feat` raises the minor version, a `fix` the patch version. Setup:
`.github/workflows/release-please.yml` and `release-please-config.json`.

## Notes
- Built for personal use with music you have the rights to play. Downloads are your responsibility.
- Windows is the primary platform (PowerShell/Git Bash); the engine and server are plain Node + browser and run elsewhere, but
  paths such as fonts in `tools/produce/viz.mjs` default to Windows and may need `VIZ_FONT_BOLD`.
