---
name: dj-crate
description: "Build and search the DJ Claude library: download tracks, albums or playlists from YouTube, SoundCloud or Bandcamp, pick the DJ-friendly version (extended or original mix), and query by BPM, Camelot key and energy. Use when the user asks to get, download, find or add music, build a crate for a genre or era, or asks what is in the library."
---

# The crate

The crate is the music library. Every audio file in the library folders is scanned and analysed automatically. The only folder is `data/dj/library/` by default, set by `libraryDirs` in `config.json`. Analysis covers BPM and beat grid, key as a Camelot code, loudness, energy from 1 to 10, intro, breakdowns, drops and outro. Downloads land in `data/dj/library/downloads/` and are analysed as soon as they finish.

In this skill `dj` is short for `node dj.mjs`, run from the project root. `<id>` and `<trackId>` are a track's library id, shown by `dj library`.

## Getting music

```bash
node dj.mjs find "<artist> <title>"                  # list candidates, no download
node dj.mjs get "<artist> - <title>"                 # download the first search hit and analyse it
node dj.mjs get https://www.youtube.com/watch?v=…    # exact URL
node dj.mjs get "<playlist url>" --playlist --max 20 # a playlist, capped
node dj.mjs demo                                  # the Creative Commons starter crate, into data/dj/library/demo/
```

- `dj get "Artist - Title"` downloads the first search hit, which is usually right for well-known tracks. When the version matters, as for a club set, run `dj find` first, pick the upload, and pass its URL to `dj get`.
- Prefer DJ-friendly versions: the Extended Mix or Original Mix. Their long intros and outros make blends possible.
- Avoid uploads marked Radio Edit, Lyrics, slowed + reverb, sped up or nightcore, and avoid live recordings and mashup channels, unless the user asks for one.
- Prefer uploads from the official artist channel, the label, or a "Topic" channel.
- A download takes about 10 to 40 s.
- A download can fail because of a region lock or a removed video. If it does, run `dj find` and pick another upload.
- yt-dlp installs itself into `bin/` on first use. `node dj.mjs doctor --fix` installs it up front.
- `dj demo` downloads a small Creative Commons crate, so a fresh checkout has music to mix. `dj starter --list` prints the tracks without downloading. `dj starter --force` downloads them again. The credits and licences are in `apps/server/demo-tracks/README.md`.

To build a crate for a brief such as "2008 hardstyle classics" or "deep house warm-up":

1. Use your own knowledge to list 10 to 20 specific, well-known tracks as `"Artist - Title"`.
2. Run `dj get` for each track, one after another.
3. During a set, fetch one track at a time between waits, so the set stays responsive.

## Searching what you have

```bash
node dj.mjs library                                   # everything, by artist
node dj.mjs library hardstyle --sort bpm              # text search
node dj.mjs library --bpm 145-152 --key 8A,9A,8B      # tempo window + keys
node dj.mjs library --compatible <trackId>            # harmonic neighbours of a track
node dj.mjs library --energy 8-10 --sort energy
node dj.mjs suggest --from <trackId> --direction up   # ranked next-track candidates, with reasons
node dj.mjs track <trackId>                            # full analysis for one track
```

`dj suggest --mashup` pairs vocal-heavy tracks with instrumental beds. It needs vocal maps, which `dj stems status` reports. The dj-mashup skill explains how to use it.

## Trusting the analysis

If the analysed BPM is half or double the real tempo, or the key is wrong, use the value you know, and tell the user when the wrong value would change a mix decision.

- BPM is reliable for four-on-the-floor music. For breakbeat, drum & bass, hip-hop or trap it may report half or double time. The mixer treats half and double time as compatible.
- Key is right, or a neighbouring key, most of the time.
- Energy is a heuristic built from loudness, rhythmic density and tempo. Your own sense of a track, such as "anthem", "deep" or "peak-time", is more reliable than the number.
- Structure (intro, outro, drops) comes from the bass energy of each bar. A breakdown is a stretch without bass, and the `drop` is where the bass returns.

## Housekeeping

- To add local files, copy them into `data/dj/library/`, then run `node dj.mjs scan`.
- Audio files can also be dropped onto the page or picked with its FILES button. They are copied into the `uploads` folder of the first library folder and analysed.
- To use other folders, add them under "Music folders" on the `/settings` page (or edit `libraryDirs` in `config.json`) and restart the server.
- Changed files are re-analysed automatically. To force a full redo, run `node dj.mjs scan --force`.

## Deeper analysis

After the server starts, a background pass adds more analysis to every track. It decodes each track once and runs at idle priority. A download gets the same analysis when it is first analysed. The pass adds:

- a beat map, with `gridStable` and `drift`. `drift` is how many milliseconds the constant grid is off by.
- section labels, shown by `dj sections <id>`.
- auto hot cues, listed under "Hot cues and saved loops" in the dj-mix skill.

Section labels are derived again when the stems finish. Before stems exist, verse and chorus labels are estimates. Once the vocal map exists, they are measured.

## Fixing a beat grid

`dj grid <id>` shows a track's grid: the BPM, where bar 1 starts, and whether the grid is stable or drifts. Correct it with these flags:

| Flag | Unit | What it does |
|---|---|---|
| `--shift <beats>` | beats | Moves the downbeat. A positive value moves it later. |
| `--nudge <ms>` | milliseconds | Slides the whole grid. A positive value moves it later. |
| `--bpm <x>` | BPM | Sets the tempo. |
| `--reset` | none | Goes back to the detected grid. |

- `--shift` and `--nudge` add to any earlier correction on the same track.
- Corrections are saved in `data/dj/grid-edits.json` and survive re-analysis.
- The intro, outro, breakdowns and sections are derived again on the corrected grid.
- A deck that already holds the track plays with the old grid until the track is loaded again.
