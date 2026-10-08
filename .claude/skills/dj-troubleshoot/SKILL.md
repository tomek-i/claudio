---
name: dj-troubleshoot
description: "Diagnose and recover the DJ Claude rig: engine not connected or stale, a silent deck, a stuck loop, loads that time out, a full disk, stem separation hogging the CPU, YouTube download walls, a script that will not stop. Use when a command errors, playback stops, or something is broken. For ⚠ mix warnings in `dj status` (key clash, vocal clash, flamming) use dj-mix."
---

# When it breaks

Run the quick health check, read the booth log with `node dj.mjs log`, then find the symptom in the tables below.

## Quick health check

```bash
node dj.mjs doctor            # server, engine, yt-dlp, library folders
node dj.mjs status            # whether the engine is connected or stale, and what is live
node dj.mjs stems status      # separation load and free disk
node dj.mjs record status     # whether a recording is running
```

- The page at http://localhost:4747/health shows one entry per system: ok, warn (an optional system such as stems or downloads has a fault; the decks still play), fail (a required system is down) or off. It is the place that checks ffmpeg and ffprobe, which `dj doctor` does not check.
- The server log is `.dj/server.log`.
- The test command is `node --test test/*.test.mjs test/server-*.mjs`. The tests are safe to run during a set; they do not read the library or write `.dj/`.
- The ⚠ lines in `dj status` are mix warnings, not faults. The dj-mix skill explains each one in "The mix monitor".

In this skill `dj` is short for `node dj.mjs`, `<deck>` is A, B, C or D, and `<id>` is a track's library id.

## Engine and tab

The **engine** is the one browser tab that plays the audio. `dj status` prints "Audio engine not connected" when no tab is the engine, and "Engine state is stale" when the tab has stopped reporting. A command sent without an engine fails with the server's message, "No audio engine connected".

To recover the engine:

1. Open http://localhost:4747 in a browser. `node dj.mjs open` opens it for you.
2. Ask the user to click "Start engine" on the page.
3. Run `node dj.mjs status` until the engine shows as connected.
4. If the decks are empty, load the tracks again.

| Symptom | Cause | Fix |
|---|---|---|
| "Audio engine not connected" or "Engine state is stale" | The browser tab was closed, or Chrome throttled a hidden, silent tab. | Follow the recovery steps above. Afterwards keep the tab in its own window with audio playing. For recordings use `tools/produce/record-browser.mjs`, because its Chromium does not throttle. |
| Loads time out, or the engine goes stale during a set | Chrome throttled the hidden tab (see the row above). | Reload the tab, click "Start engine", then load the tracks again. |
| The Playwright window closed | That window was the engine, so the engine is gone. | Follow the recovery steps above in a normal browser. |
| A second DJ page, or the desktop app, says "Another window is the sound system" | Only one page is the sound system at a time, and a page does not take it from another without asking. | Close the extra page, or click "Take over" in the one where you want the audio. The decks come up empty there: load the tracks again. |

## Decks and loops

| Symptom | Cause | Fix |
|---|---|---|
| A deck plays but nothing is heard | The crossfader is on the other side. | Check `xfade` in `dj status` first. Then run `node dj.mjs xfassign <deck> thru` for every deck that should be heard wherever the crossfader is. |
| A track is held at the same bar and sounds like it is skipping | A loop was never released. | Run `dj loop <deck> 0`, then run it again one beat later, because a loop that is not released holds the track at the same bar. |
| A vocal or sample lands early, or is silent | A `perform` step with a negative beat offset is dropped. | Schedule from the next bar so that every step has `b` of 0 or more, and seek into the window instead of starting before it. |

A loop roll ends with two releases for the same reason. The dj-mix skill has the recipe in "Loop roll into a drop".

## Disk and CPU

Keep at least 15 GB free and switch off automatic stem separation before a long take.

| Symptom | Cause | Fix |
|---|---|---|
| The set crashed and the disk is full | `.dj/pcm` (decoded audio) and `.dj/stems` grow with every track. | Delete `.dj/pcm/*`, which is a cache and safe to delete. Delete old folders in `.dj/sessions` and the files in `.dj/produce/out/*`. |
| Everything is sluggish while playing | Stem separation is running at full speed, or a video is rendering. | 1. Check `dj stems status`.<br>2. Kill the `separate.py` process.<br>3. Switch off "Separate new tracks automatically" on http://localhost:4747/settings.<br>4. Never render a video during a set. |
| `node dj.mjs stems` queued every track | `stems` without an id means all tracks. | Use `dj stems <id>`. The queue is emptied when the server restarts with "Separate new tracks automatically" switched off. |

## Downloads

| Symptom | Cause | Fix |
|---|---|---|
| `dj get` fails with "confirm you're not a bot" | YouTube wants a login. | Export your YouTube cookies in Netscape format to `.dj/youtube-cookies.txt`. `dj get` and `tools/produce/get-sample.mjs` use that file when it exists. Keep the file private. |
| `n challenge solving failed` | yt-dlp needs a JavaScript runtime. | `dj get` already passes `--js-runtimes node`, so make sure `node` is on PATH. Then update yt-dlp: delete the copy in `bin/` and run `node dj.mjs doctor --fix`, which installs yt-dlp only when it is missing. |
| A short clip reports "analysis failed" | The clip is too short for BPM analysis. | Keep short samples out of `library/`. The dj-video skill explains where they go in "Samples for the sampler". |

## Scripts and server

| Symptom | Cause | Fix |
|---|---|---|
| The server restarted during a set | The decks keep playing in the browser, but the plan and the queue are lost. | Run `dj plan clear` and add the queue again. Do not reload the browser tab; the decks are still playing. |
| A setting did not take effect | Settings changed on `/settings` apply live, except the port, the library folders, the download folder and `banner.loop`. Hand edits to `config.json` need a restart. | Stop the old server process, then run `node dj.mjs start`. |
| A set script keeps going after "stop" | Background scripts survive on Windows. | Find the process with `Get-CimInstance Win32_Process` filtered on the script name and kill it by PID. Then run `dj pause <deck>` and `dj loop <deck> 0`. |
