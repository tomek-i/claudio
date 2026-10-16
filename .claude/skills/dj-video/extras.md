# Video extras

This file covers three side jobs of the dj-video skill: cutting to the speakers on screen, taking screenshots of the deck, and fetching short samples for the sampler.

## Speakers on screen

For a dj-voice or dj-album piece, the video can cut to each person as they speak.

First download each clip's video to `data/dj/video/<videoId>.mp4`:

```bash
bin/yt-dlp.exe -f "bv*[height<=480]+ba/b[height<=480]" --merge-output-format mp4 -o data/dj/video/%(id)s.mp4 <url>
```

Then cut the track with the footage. `<design.mjs>` is the design module and `<N>` is the track number:

```bash
node tools/produce/cut-track.mjs <design.mjs> <N> --footage
```

Use this command instead when you already have a `meta.json` and the audio, and want to run the cutter directly:

```bash
node tools/produce/video-cuts.mjs <meta.json> <audio> <out.mp4> --bg <viz.mp4> --screen <capture.webm> --screen-offset <sec>
```

- A line whose clip has no footage keeps the visualiser.
- The DJ table fills gaps longer than 3 s.

## Screenshots of the deck

Use this command for thumbnails and posts. `<trackA>` to `<trackD>` are library ids or search text; the first two are required.

```bash
node tools/produce/snap-deck.mjs <trackA> <trackB> [trackC] [trackD] --scale 2
```

- It plays a 1-minute demo and saves 3840×2160 PNGs in `data/dj/produce/out/shots`.
- It opens its own Chromium, which becomes the engine and plays audio. Do not run it during a set.
- The demo loads the tracks, plays, mutes stems, rolls a loop, blends A into B, brings up four decks and sweeps a filter. It takes a screenshot at each step.

## Samples for the sampler

Find a short upload first:

```bash
node dj.mjs find "<sound> sound effect"
```

Then download it. `<name>` is a kebab-case name for the sample, and the command saves `data/dj/produce/samples/<name>.mp3` and prints its non-silent segments:

```bash
node tools/produce/get-sample.mjs <url> <name>
```

Use this command to measure the segments again with a different silence threshold:

```bash
node tools/produce/measure-sample.mjs data/dj/produce/samples/<name>.mp3 --thresh -45
```
