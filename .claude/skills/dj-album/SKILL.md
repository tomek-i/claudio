---
name: dj-album
description: "Produce a themed album or EP on the DJ table: several produced songs with speech lines over instrumental beds, recorded as one live take and cut into per-track masters and videos plus a full-album video. Use when the user asks for an album, an EP, or several produced songs on a theme. For a live set use dj-set."
---

# A themed album, recorded as one live set

This skill builds on dj-voice. Read that skill first: it explains the caption index, the voice reel, beds, windows and the runner, and those terms are used here without further explanation.

An album here is a list of tracks. Each track is about 6 minutes long and uses two beds played back to back, joined by a hand-off. The vocals are speech lines from the caption index, planned song by song. The whole album is recorded as one take of `tools/produce/run-design.mjs` and is then cut into tracks.

`N` is a track number and `NN` is the same number with two digits.

## Beds
Write `.dj/produce/beds.mjs`. Its schema is in `tools/produce/songs/README.md`. Each track gets two sections, named `tN-a` and `tN-b`. Each section gives:
- the bed's library id, `fromBar` and stems, with the bed's vocals at 0;
- `bars`, the length of the section;
- `moves: [{kind:'roll', bar}]` for each drop, placed at the bed's real drops;
- `handoff`, which says how the section hands over to the next one.

Choose beds that meet all of these:
- The intro and the drops are clear in `dj track <id>`.
- The stems are ready.
- The tempo changes by 3 BPM or less from one section to the next.
- The keys of consecutive sections are compatible.

One hour of album is about 10 tracks, which is about 20 beds.

## Plan every song with its own subagent
Each song is planned by its own subagent. Run all the agents in parallel. Each agent reads `tools/produce/songs/README.md`, writes its plan to `.dj/produce/songs/track-NN.mjs` and verifies it with `node tools/produce/album-design.mjs --track N`.

Read `song-plans.md` in this folder before briefing the per-song subagents.

## Compile and check
```bash
node tools/produce/album-design.mjs            # per section: lines, hooks, coverage, strict and punchy counts, then MISSING, WARN, DUPES
node tools/produce/album-design.mjs --track 3  # the full timeline of one track
```
- `MISSING` lists texts that are not in the caption index. Fix every one by copying the exact `text` that `tools/produce/find-line.mjs` prints.
- `strict` counts the lines that match the song's `verse` regex. **Punchy** lines are short generic exclamations and questions that fill a verse when the matching lines run out. Keep `punchy 0`.
- `DUPES` lists lines used in more than one track. Resolve each by moving or dropping the weaker copy. A scripted joke wins over a verse line. A one-word catchphrase that returns once as a callback is fine.

## Before the take
Keep at least 15 GB free and switch off automatic stem separation before a long take.

- `.dj/pcm` is a cache and grows again during the take.
- Switch off stem separation on the `/settings` page with "Separate new tracks automatically". The change applies at once, without a restart. With it on, the separation competes with the audio engine for the CPU.
- If you want footage, start `node tools/produce/record-browser.mjs` before anything else. It is optional, and its window becomes the engine.

## Record
The whole album is one take. Follow "Build the reel and play it" in dj-voice for the build, scan, dry-run and run commands, in that order. The design path for an album is `tools/produce/album-design.mjs`: use it wherever those commands say `<design.mjs>`.

During the take, check `.dj/produce/out/run-design.log` and `dj status`, and never go more than 60 s without checking for new user text. The live-set rules in CLAUDE.md apply.

## During the take
Cut only the master mp3 while the take is running. As soon as a track has finished playing, cut it with this command, which is safe while the take continues:
```bash
node tools/produce/cut-track.mjs tools/produce/album-design.mjs 1 --album "Album Name" --artist "DJ Claude"
```
The `1` is the track number. If the command reports that the track is not fully recorded yet, or that the recording is not far enough yet, wait and run it again.

## After the take
Render videos after the take and one at a time; "Render" in dj-video has the reason.
```bash
node tools/produce/cut-track.mjs tools/produce/album-design.mjs 1 --album "Album Name" --video --logo logo.png     # track video: visualiser and DJ-table footage
node tools/produce/cut-track.mjs tools/produce/album-design.mjs 1 --album "Album Name" --footage                   # track video with the speakers' footage cut in
node tools/produce/full-album.mjs --album "Album Name"                                                        # one continuous video and mp3
```
- Use either `--video` or `--footage` for a track.
- `--footage` needs each clip's video at `.dj/video/<videoId>.mp4`. "Speakers on screen" in the dj-video skill explains how to download it.
- Run `tools/produce/full-album.mjs` last. It needs the video of every track.

## Deliver
- Masters are at `.dj/exports/album/<Album> - NN - <Title>.mp3`.
- Each track's videos are next to its master, in 720p and 480p.
- The full album is `<Album> - Full Album.mp4` and `<Album> - Full Album.mp3`.
- Send each track to the user as soon as it is cut.
- Tell the user which tracks or sections nobody has listened to, since you cannot hear the result.
