# How it works

[← Back to the README](../README.md)

```
you (typing in Claude Code) ──► Claude + DJ skills ──► node dj.mjs … ──► server ──► browser audio engine ──► speakers
                                                                 ▲                         │
                                                crowd requests from the booth ◄────────────┘
```

Claude never touches audio. It runs `node dj.mjs …` commands; the server relays them to the one page that is the
**sound system** (the audio engine), and that page does the playing, on the audio clock.

## The pieces
| Piece | What it does |
|---|---|
| `apps/server/server.mjs` | Holds the library and analysis cache, relays commands to the browser engine, long-polls (`dj wait`), booth log, crowd inbox, recorder, auto-DJ. |
| `dj.mjs` + `apps/cli/cli-ext/` | The CLI Claude drives: `node dj.mjs help` and `node dj.mjs help-engine`. |
| `apps/web/public/engine.js`, `apps/web/public/worklets/` | Web Audio engine: four decks (A/B + C/D), 3-band kill EQ, filter, beat-synced echo, loops, key lock + key shift (WSOLA), per-stem playback, deck FX, 8-pad sampler, scratching, sample-accurate transitions. |
| `apps/web/public/app.js`, `apps/web/public/ui/`, `apps/web/public/css/` | The DJ-table UI and the booth feed: plain ES modules and per-component stylesheets, no build step. |
| `apps/server/lib/analyze.mjs` | BPM and beat grid, downbeat, key (Camelot), loudness, energy 1–10, intro/breakdowns/drops/outro, section labels, auto hot cues. |
| `apps/server/lib/library.mjs` | Cache, search, harmonic/tempo/energy suggestions, mashup pairing. |
| `apps/server/lib/downloader.mjs` | yt-dlp wrapper: search, download, playlist caps; uses `.dj/youtube-cookies.txt` if you provide one. |
| `apps/server/lib/sets.mjs` | Saved sets: named track lists in `sets/` that the auto-DJ plays from. |
| `apps/server/lib/sequencer.mjs`, `apps/server/lib/monitor.mjs`, `apps/server/lib/memory.mjs` | Scheduled plan steps and track queue, auto-DJ safety net, mix monitor with transition critiques, set memory + ratings. |
| `apps/server/lib/settings.mjs`, `apps/server/lib/health.mjs` | The `/settings` page (edits `config.json`, says which settings apply live and which need a restart) and the `/health` page with `GET /api/health` (one ok/warn/fail/off entry per system, checked only on request). |
| `apps/server/lib/set-clock.mjs`, `apps/web/public/ui/clock.js` | The header's clock: the time of day (12 or 24 hours, as the browser's locale has it) and how long the set has been running. A set starts with the first track on air and ends after 30 minutes without music; the server keeps the start, so a reload of the page does not reset the timer (a restart of the server does). |
| `apps/server/lib/starter.mjs`, `starter/` | The Creative Commons starter crate behind `dj starter` and the **Download demo tracks** button. |
| `apps/server/lib/banner.mjs` | The server's startup banner: one of fifteen animations at random, then an equaliser that follows the live deck's beat. |
| `apps/server/lib/stems.mjs` + `apps/server/lib/separate.py` | Optional stem separation (demucs) so vocals/drums/bass can be muted or swapped live. |
| `apps/desktop/` | The Electron app: the same server and page in a window of their own, a start-up window, and the installer. See [The desktop app](desktop-app.md). |
| `tools/produce/` | Production toolchain: Playwright page recording, set/album video rendering, caption indexing for speech clips, voice-reel builder, live design runner, per-track cutting, speaker footage cut-ins (`video-cuts.mjs`), deck screenshots (`snap-deck.mjs`). |

`CLAUDE.md` has the file-by-file layout, written for Claude and kept current with the code.

## Skills (`.claude/skills/`)
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

## One sound system at a time
Exactly one page is the audio engine: a browser tab where **Start engine** was clicked, or the desktop app's window.
A second page does not take it silently. Starting the engine there says "Another window is the sound system right
now" (and whether music is playing), and takes over only on **Take over**; the decks then come up empty on the new
page. The page that lost the engine offers **Take it back**. The recording and screenshot tools in `tools/produce/`
take the engine at once, because that is their job.

## Transitions and timing
Transitions are scheduled on the audio clock, so they land on the beat even with the tab in the background:
`blend` (EQ blend + bass swap) · `bassswap` · `double` · `fade` · `filter` · `echo` · `cut` · `brake` · `spinback`, started
`--at now|bar|phrase`, with the incoming track entering at its `mixin`, `intro` or `drop`. `dj perform` schedules knob
choreography per beat; `dj plan add` schedules any command for a future bar, mix-out point or wall-clock time.

The **auto-DJ** steps in only if the live track is 45 s from its end with nothing planned. It uses no AI: it takes the
queue first, then the active **set** if there is one, then the best match from the library. A set is a named track list
in `sets/` (one JSON file each), made in the **Sets** tab or with `dj sets`. The Sets tab has the library on the left
(drag a track across to add it) and your sets on the right: ★ marks the one Auto-DJ plays from (pick another, or "No
set"), and the open set can be renamed, copied or deleted, its tracks reordered by dragging or taken out with ×, and its
decks saved and loaded. The Library tab says under "Up next" which set Auto-DJ plays from. Each set says whether Auto-DJ plays it in order or takes the track that fits the live deck best, and what
happens when all of it has played (carry on from the library, or stop). What of the set has played is kept across a
restart in `.dj/active-set.json`.

A set can also keep **the decks and the mixer**: "save decks" (`dj sets save "<name>"`) stores what is on each deck
(track, position, cue, tempo, key lock, key shift, EQ, filter, trim, volume, echo, stem levels, crossfader side, deck
FX, loop), the master volume, the crossfader and whether Auto-DJ is on. "load decks" (`dj sets open "<name>"`) makes it
the active set and puts all of that back, paused, ready to play. If a deck is playing, it asks first, because
opening the set stops it. A saved deck whose track has left the library is skipped and named in the booth.

A set can also keep an **automation recording**: everything done on the decks and the mixer from the set's 0:00, so
a mix prepared at home plays back the same later (the **Automation** tab: ● rec · ▶ play · ■ stop, or
`dj automation record|play|over|stop|clear`). Recording saves the decks first, as "save decks" does: they are the
recording's 0:00, and a deck that is playing when recording starts starts again from there. From then on every change
the engine makes is kept, whoever makes it (the page, Claude, Auto-DJ): knobs and faders, play / pause / cue / seek,
tempo, key lock and key shift, loops, hot cues, EQ, filter, echo, trim, stems, deck FX, the crossfader, a whole
transition, scratching by hand or by pattern, the sampler. Playing puts the set's decks back and replays it from 0:00;
transport, loops and transitions land on the same audio frames as when they were recorded. Pressing ● rec while it
plays records over it: a control is replaced from the moment it is touched, the rest plays on as it was. While a
recording plays, Auto-DJ and Claude's planned steps wait. The recording is `sets/<name>.automation.json`.

The **Automation** tab (bottom panel) shows the active set's recording as lanes along its time: a curve for each control
that moved (volume, EQ, filter, echo, trim, stems, the crossfader, the master), and a row of marks for each deck's
transport (play, stop, seek, loops, scratches, loads), key, crossfader side and FX, the echo and the sampler. Drag a
point of a curve (Shift: its value only), double-click in a curve to add one, pick a point or a mark and press Delete
to remove it, drag a mark along the time; "+ lane" adds a curve for a control that has none yet. Changes are kept
when you press **save** (Ctrl+S); **undo** (Ctrl+Z) and **revert** go back. Ctrl + wheel zooms, "fit" shows it all.

**⤓ export** (or `dj automation export [--format m4a]`) makes the set a mix file: the recording plays from 0:00 in real
time while the flight recorder records the master, then exactly 0:00 to its end is saved as
`.dj/exports/<set>.mp3` with a tracklist (`.txt`) and a cue sheet (`.cue`); "exports ↗" opens that folder. It takes
as long as the set: the decks are the export's while it runs, and stopping it before the end makes no file. It asks
whether to export **silently**: the speakers are off until it is done (`dj automation export` does that unless given
`--listen`), while the recording, the meters and the visuals still get the master as it is. The **mix monitor** flags vocal
clashes, key clashes, beat-phase offsets, tempo mismatch and clipping, and critiques every transition in the booth.
