---
name: dj-voice
description: "Use spoken-word clips (talks, podcasts, interviews) as the vocals of a set: index clips from captions, find exact lines, build a voice reel that lands every line on the beat, and play it live over instrumental beds. Use when the user wants speech clips, soundbites, quotes or people's voices in the music. For sung vocals use dj-mashup."
---

# Speech as the vocal

Spoken lines from talks, podcasts or interviews take the place of sung vocals. The work goes in this order:

1. Put the clips in the crate and index their captions.
2. Find the lines you want.
3. Write a design that says which line lands on which bar of which bed.
4. Build the voice reel from the design.
5. Run the design live.

During the run the beds play live with their own vocals muted and the reel plays on deck C. On each window's anchor bar the runner seeks the reel to that window's offset and opens deck C's volume, so every line lands sample-accurately.

## Terms
- **Bed**: the instrumental track under the speech. Beds play on decks A and B in turn.
- **Reel**: one WAV file holding every line of a design. It is a normal library track.
- **Window**: the part of the reel that plays over one bed.
- **Runner**: `tools/produce/run-design.mjs`, the script that plays a design on the decks.
- **Anchor bar**: the bar of the bed where a window begins. The reel builder measures the position of every line from this bar, and the runner seeks the reel to the window's offset on this bar.
- **Design**: a `.mjs` file that lists the beds and the lines. `<design.mjs>` is its path and `<name>` is its file name without `.mjs`.

## Get clips and captions
`<clipId>` is the library id of a speech clip. `<videoId>` is the clip's YouTube id.

```bash
node dj.mjs get "<youtube url>"                       # audio into the crate; the file name keeps the [videoId]
bin/yt-dlp.exe --write-auto-sub --sub-lang en --skip-download -o "data/dj/voice/captions/sub-%(id)s" "<youtube url>"
node dj.mjs stems <clipId>                            # vocal stem = the speech without the clip's background music
node tools/produce/index-captions.mjs                        # writes data/dj/voice/sentences.json (with kind and speaker) and words.json
node tools/produce/analyze-speech.mjs                        # optional: pitch class, contour and strongest-consonant offset per line
```
- Separate the stems of every clip, even though it takes time. The reel builder cuts each line from the vocal stem when one exists.
- The speaker name comes from "| Name |" in the clip's title. If the title has none, set it in `data/dj/voice/clips.json` as `{ "<videoId>": { "speaker": "Name" } }`.
- You can add hand-picked lines in `data/dj/voice/lines.json` as `[{ id, from, dur, text, speaker, kind }]`. This file is optional.

## Find material
```bash
node tools/produce/find-line.mjs "<word>|<word>" --dur 0.6-3 --speaker <name>     # sentences; prints: dur kind speaker clipId from | text
node tools/produce/index-captions.mjs --find <words>                              # exact phrase occurrences with word timing
```
A good line meets all of these:
- It lasts 0.6 to 3 s.
- It is a complete thought.
- It has no "uh" or "um".
- It does not end on a comma.

Use one speaker per 8-bar phrase. A **hook** is a short phrase everyone can repeat. A **stab** is a single word used for rolls.

## Write the design
A design module exports `SECTIONS` and `WINDOWS`. `SECTIONS` lists the beds in playing order. `WINDOWS` lists what the reel plays over each bed. For an album, write song plans and let `tools/produce/album-design.mjs` generate both exports (see the dj-album skill). For a one-off, write the module by hand. `<bedId>` is the library id of a bed.

```js
export const SECTIONS = [{ name: 'intro', id: '<bedId>', bpm: 125, key: 0, fromBar: 17, bars: 64,
  stems: { drums: 1, bass: 1, other: 0.85, vocals: 0 }, handoff: { drumsIn: 8 } }];
export const WINDOWS = [{ name: 'intro', bed: 'intro', anchor: 17, bpm: 125, mute: [17, 81],
  lines: [[25, '<clipId>', 12.4, 1.8, '<exact line text>']],
  slices: [[31, '<clipId>', 61.2, 0.34, 61.2, 0.34]],
  bedMoves: [] }];
```

Read `design.md` in this folder before writing or editing a design file. It defines every field in the example above.

### Rules for placing lines
- Every line ends on a downbeat.
- No line goes over the first 4 to 8 bars of a drop or breakdown.
- A hook returns every 16 bars, with half a bar of air around it.
- A build into a drop rolls a whole word: halves first, then quarters. Never use slices shorter than 100 ms.
- Speech keeps its natural pitch. Do not pitch-shift it.

## Build the reel and play it
```bash
node tools/produce/build-reel.mjs <design.mjs>        # writes data/dj/library/voice-reels/Voice Reel - <name>.wav and data/dj/voices/<name>-reel.json
node dj.mjs scan                                 # the reel becomes a track (artist "Voice Reel")
node tools/produce/run-design.mjs --design <design.mjs> --dry    # cues the beds and the reel, checks everything resolves
node tools/produce/run-design.mjs --design <design.mjs>          # records, plays every section with hand-offs, exports at the end
```
- `data/dj/voice/` holds the speech index. `data/dj/voices/` holds each reel's metadata.
- The build prints a ⚠ line for each line that starts before the anchor bar or overlaps the previous line. Change the design until it prints none.
- Run the commands in the order shown. The runner stops with an error if the reel has not been scanned.
- If you want DJ-table footage, start `tools/produce/record-browser.mjs` before the runner (see "Record the DJ table" in the dj-video skill). The runner reads its timing.
- During a live run, check `data/dj/produce/out/run-design.log` and `dj status`, and never go more than 60 s without checking for new user text. The live-set rules in CLAUDE.md apply.

## Volume and feel
- Every line in the reel is levelled to the same speech loudness.
- The bed ducks to 0.8 under each line. This value is fixed in `tools/produce/run-design.mjs`.
- If the voice is too quiet, raise `TARGET_DB` in `tools/produce/build-reel.mjs` (−18 dB) and rebuild the reel. Do not use the deck fader.
- A line cut from a vocal stem sounds dry and clear. A line cut from the raw clip carries the clip's background music.
