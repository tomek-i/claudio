---
name: dj-video
description: "Produce a video of a DJ Claude set: record the DJ page with Playwright while the set plays, export the set audio, then render a music video (visualiser, title card, DJ-table footage, 720p and 480p). Also takes deck screenshots and fetches short samples for the sampler. Use when the user asks for a video, a recording of the decks, footage of the set, a clip to share, or screenshots of the deck."
---

# Set video

A set video is the exported set audio under a reactive visualiser, with an opening title card and, if you recorded it, footage of the DJ table. Exports land in `.dj/exports/`. Page recordings and screenshots land in `.dj/produce/out/`.

In this skill `dj` is short for `node dj.mjs`, run from the project root. `<session>` is the session id that `dj export` prints; it is the recording's start time in UTC.

## Before you start

- ffmpeg and ffprobe must be on PATH.
- Playwright is needed only for the DJ-table footage and for deck screenshots. The render works without footage.

Install Playwright once, if it is missing:

```bash
npm i -g playwright && npx playwright install chromium
```

Set `PLAYWRIGHT_CHROMIUM` to the path of a Chrome or Chromium executable if Playwright's default browser is not installed.

## The whole job, in order

For a video without DJ-table footage, skip steps 1, 2 and 6.

1. Start the page recorder before you load any deck. It runs until you stop it, so run it in the background.
   ```bash
   node produce/record-browser.mjs
   ```
2. Wait for the engine in the recorder window. That window takes over as the sound system. Run `node dj.mjs status` until it shows the engine connected.
3. Start the audio recording at the start of the set.
   ```bash
   node dj.mjs record start --no-screen --no-mic
   ```
4. Play the set.
5. Stop the audio recording.
   ```bash
   node dj.mjs record stop
   ```
6. Stop the page recorder. This finalises the .webm.
   ```bash
   node produce/record-browser.mjs --stop
   ```
7. Export the set audio.
   ```bash
   node dj.mjs export
   ```
8. Render the video.
   ```bash
   node produce/make-video.mjs .dj/exports/<session>.mp3 --title "DJ Claude - Saturday Night Set" --screen auto
   ```

## Record the DJ table

The footage is optional. `node produce/record-browser.mjs` opens its own maximised Chromium, clicks "Start engine" and records the page.

- Start it before you load any deck. The recorder window takes over as the sound system, and the decks in the old tab are dropped.
- `dj status` must show the engine connected afterwards.
- It writes `.dj/produce/out/screen/browser.json` and a `.webm` file next to it. The `start` field in `browser.json` is the time the video began, in epoch milliseconds.
- Keep audio playing, because Chromium throttles a silent, hidden page.
- Do not minimise the window.
- Stop it after `dj record stop`. ffmpeg can read the growing `.webm` before it is finalised, so a partial render works before the recorder is stopped.
- The recorder uses Playwright because Chrome window capture with gdigrab returns black frames for GPU-rendered pages.

## Record and export the set audio

- `node dj.mjs record start --no-screen --no-mic` starts the flight recorder, which is the session recording. Run it at the start of the set.
- `--no-screen` leaves out the server's own desktop capture, and `--no-mic` leaves out the microphone. The microphone is recorded only if a device is set on `/settings`.
- `node dj.mjs record stop` ends the recording.
- `node dj.mjs export` writes `.dj/exports/<session>.mp3`, a `.txt` tracklist and a `.cue` sheet. Without an argument it exports the latest session.

## Render

Render after the set, one render at a time. A render during a live set starves the audio engine, and several renders at once share the CPU.

Use this command for a set with DJ-table footage:

```bash
node produce/make-video.mjs .dj/exports/<session>.mp3 --title "DJ Claude - Saturday Night Set" --screen auto
```

- `--title "Credit - Song"` sets the opening card. The part before ` - ` is the small credit, and the rest is the big title. The text is drawn with ffmpeg drawtext, and `%`, `:` and `,` are escaped for you. Without `--title`, the audio file name is the title.
- `--screen` chooses the footage:
  - `--screen auto` picks the latest page recording and lines it up with the export, using the session id in the audio file name and `start` in `browser.json`.
  - `--screen <file.webm> --screen-offset <sec>` lines a recording up by hand. `<sec>` is how many seconds into the recording the set audio starts.
  - Leave `--screen` out for a video with the visualiser only.
- `--logo <png>` puts a logo in the centre that pulses on the kick. A white or transparent PNG works best.
- `--sections <file>` points at a tracklist, which gives each track its own colour tint. Without it, the export's `.txt` tracklist next to the mp3 is used automatically.
- `--out <file>` sets the output file. Without it, the output is `<audio name>.mp4` at 1280×720 and `<audio name> (480p).mp4`, both beside the audio.
- Fonts: the Windows fonts Impact and Arial are used when present. On other systems set `VIZ_FONT_BOLD=<path.ttf>`.
- Speed: a render runs roughly 1.5 to 3 times faster than real time on a laptop.

## Speakers on screen

Read "Speakers on screen" in `extras.md` in this folder before making a dj-voice or dj-album video that cuts to each person as they speak, or before downloading a clip's video to `.dj/video/`.

## Screenshots of the deck

Read "Screenshots of the deck" in `extras.md` in this folder before taking screenshots of the DJ page with `produce/snap-deck.mjs`.

## Samples for the sampler

Short samples stay out of `library/`. They are too short for the library's BPM analysis, so they live in `.dj/produce/samples/`.

Read "Samples for the sampler" in `extras.md` in this folder before finding, downloading or measuring a short sample.

## If the Playwright window closes

The engine is gone when that window closes. The dj-troubleshoot skill has the recovery steps under "Engine and tab".
