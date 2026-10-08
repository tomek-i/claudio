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
Everything the rig generates lives in `.dj/` (git-ignored): `library.json` analysis cache, `pcm/` decoded audio cache
(safe to delete), `stems/`, `sessions/` and `exports/` (recordings, mp3 + tracklist + cue), `memory.json`, `cues.json`,
`grid-edits.json`, `server.log`. Music lives in `library/` (git-ignored).

## YouTube logins
YouTube sometimes asks for a login. Export your cookies to `.dj/youtube-cookies.txt` (Netscape format) and both
`dj get` and `tools/produce/get-sample.mjs` will use them. Never commit that file.
