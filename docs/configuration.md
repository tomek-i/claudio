# Configuration and data

[← Back to the README](../README.md)

## Settings
`config.json`: port, `libraryDirs` (default `./library`; add more on the `/settings` page), download folder, loudness target, stems, auto-DJ.
Edit it by hand or on the **settings page** at http://localhost:4747/settings, which also has the UI options (the deck layout:
stacked like a CDJ or the classic side-by-side one, and the size of the jog wheel's outer ring) and marks the settings that need a restart. http://localhost:4747/health shows
whether each part of the rig (engine, ffmpeg, yt-dlp, stems, disk) is working.

The settings page also shows where the project folder is, with **Open folder** and **Open Claude Code here**.

## Key bindings
Every keyboard shortcut can be changed in the **Key bindings** section of the settings page (click a key, press the new
one), with presets and import / export. Bindings follow the physical key, so the chop keyboard keeps its piano shape on
any layout. The **Keys** button in the DJ page's header lists the current ones.

## The startup banner
The server greets you with an animated banner and keeps its equaliser moving with the music. `node dj.mjs banner [name]`
previews the animations, `DJ_BANNER=<name>` picks one, and `DJ_BANNER_LOOP=0` (or the `banner.loop` setting) leaves the
equaliser still. Output that is not a terminal gets plain text.

## Where things are kept
The project folder holds the project: the code, `config.json`, and the tools it installs (`bin/` for yt-dlp, `.venv/`
for the stem separator). Everything the apps make while they run is in `data/` (git-ignored), one folder per app:

| Folder | What is in it |
|---|---|
| `data/dj/library/` | the music: downloads in `downloads/`, the demo tracks in `demo/`, uploads in `uploads/` |
| `data/dj/sets/` | saved sets and their automation takes |
| `data/dj/` | `cues.json`, `grid-edits.json`, `memory.json`, `active-set.json`, `sessions/` and `exports/` (recordings, mp3 + tracklist + cue), `voice/`, `produce/` |
| `data/dj/cache/` | `library.json` (analysis), `pcm/` (decoded audio), `stems/`, `models/`, `server.log`: made again when deleted (stems take a while) |
| `data/desktop/` | where the desktop app's window was, and which build wrote the folder |
| `data/drums/`, `data/synth/`, `data/daw/` | Claude-808's beat, MiniClaude's patches and sequence, Claudebase's song |

A folder from before `data/` (`.dj/`, `library/` and `sets/` at the top, and the other apps' `apps/*/.cl-808` and the
like) is moved in once, by hand, with nothing of the rig running:

```bash
node tools/move-to-data.mjs                          # this project folder
node tools/move-to-data.mjs "$HOME/Documents/DJ Claude"  # another one, such as the installed app's
```

A track's id comes from its file's path, so the move also gives the cues, grid edits, memory, sets and stems the
tracks' new ids. A file something still holds open stays where it is and is listed; run it again once that is closed.

## YouTube logins
YouTube sometimes asks for a login. Export your cookies to `data/dj/youtube-cookies.txt` (Netscape format) and both
`dj get` and `tools/produce/get-sample.mjs` will use them. Never commit that file.
