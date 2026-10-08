# Claudebase

A small DAW in the browser that Claude composes in with you. A song is tracks of clips on a bar timeline: drum
tracks with a built-in kit and synth tracks with a built-in voice, so it makes sound with nothing else installed.
You edit on the page; Claude edits the same song from the terminal, and every change of either is one undo step.

This is a separate project that lives in the DJ Claude repository for now. It imports nothing from it.

## Run it

```
node apps/daw/server.mjs        # http://localhost:4750
node apps/daw/claudebase.mjs help      # the CLI (starts the server when needed)
node --test apps/daw/test/*.test.mjs
```

Needs Node 20 or later. No dependencies, no build step. `CLAUDEBASE_PORT` changes the port and `CLAUDEBASE_HOME` the folder the
song is saved in (default `apps/daw/.claudebase/`).

## What it does

- A song: tempo, swing, a length in bars, a loop region, 4/4. Up to 16 tracks.
- Drum tracks: a synthesised kit of eight voices (kick, snare, clap, hat, open hat, tom, rim, cowbell). A drum clip
  is a step pattern, 16 steps to the bar, each step off or at one of four velocities.
- Synth tracks: a polyphonic subtractive voice (oscillators, a filter that opens on each note, an envelope) with
  five sounds: bass, lead, pad, pluck, keys. A synth clip holds notes: pitch, start, length, velocity.
- Clips sit on a track at a bar and last some bars. A clip's content is 1 to 8 bars long and repeats until the clip
  ends, so one bar of drums can be a clip of eight bars. Clips are moved, resized, duplicated and deleted; two
  clips of a track never share a bar.
- The editor of the selected clip: a step grid for drums, a piano roll for notes (click to add, drag to move, the
  right edge for the length), and the notes as a line of text you can edit.
- A mixer per track: volume, pan, mute, solo, a reverb send and a delay send (one shared room, one shared echo of
  three sixteenths). A master volume into a limiter.
- Transport: play from any bar, loop, a moving playhead, tempo changes while it plays.
- Undo for everything, shared by the page and the CLI. Saved as you go.
- Export: WAV of the whole song (rendered in the browser by the same code that plays it) and a MIDI file with a
  track per track (drums on channel 10, a channel and a program per synth track; muted tracks are in it too).
- Three templates to start from: Night drive, Slow tape, Blank.

## Where the AI is

Claude Code is the composer. It reads the arrangement and the clips as text and writes tracks, clips, drum rows
and notes through the CLI (`.claude/skills/claudebase/SKILL.md` teaches it how). It can press Play on the open page
(`claudebase play 5`) and it reads the notes typed into the page's Claude box (`claudebase wait`). There is no model in the page
and no API key.

```
"Night drive"  122 bpm  swing 0%  16 bars  loop 5-16 off  master 80
bar              1   5   9   13
t1 Drums  drums  [==][==========]   vol 85
    c1 1-4 (1 bar ×4, 8 hits) · c2 5-16 (1 bar ×12, 22 hits)
t2 Bass  bass    ....[==========]   vol 80
    c3 5-16 (4 bars ×3, 16 notes)
```

A drum clip is written as rows (`kick x...x...x...x...`: `.` off, `g` ghost, `o` soft, `x` normal, `X` accent) and
a synth clip as notes (`C2:0:4 E2:4:2` is pitch:start:length in sixteenths from 0; `A3+C4+E4:16:16:70` is a chord
with a velocity of 70 out of 127).

## Layout

- `lib/project.mjs`: the project, its validation (`normalizeProject`) and its edits (`applyOp`); the name shown to
  people is `APP_NAME` there. `lib/kit.mjs`: the drum voices and levels. `lib/presets.mjs`: the synth sounds.
- `lib/notes.mjs`: pitch names and MIDI numbers, notes as text.
- `lib/song.mjs`: which events sound in a stretch of the song (`eventsInWindow`: playback, WAV and MIDI all use
  it) and the `Playhead` that walks the song for live playback (the loop, the tempo, the end).
- `lib/midi.mjs`: the MIDI file. `lib/text.mjs`: the arrangement and a clip as text. `lib/templates.mjs`.
- `lib/banner.mjs`: the server's startup banner. One of its `ANIMATIONS` plays at random (`CLAUDEBASE_BANNER=<name>`
  picks one, `CLAUDEBASE_NO_BANNER=1` gives plain lines), then its strip of the arrangement (tracks down, bars
  across) shows the song as it is written (`CLAUDEBASE_BANNER_LOOP=0` turns that off). Preview:
  `node claudebase.mjs banner [name]`.
- `lib/store.mjs`: the project on the server, undo, saving, notes. `server.mjs`: the HTTP API and static files
  (the API is listed at its top).
- `public/`: the page. `engine.js` is the mixer, the kit, the synth voice, the scheduler and the WAV render;
  `link.js` the state and the link to the server; `arrange.js` the tracks and the timeline; `editor.js` the step
  grid and the piano roll; `app.js` the top bar, the transport and the Claude box. The page imports `lib/` as
  `/lib/*.mjs`.
- `claudebase.mjs`: the CLI.

## Not yet

Audio-file tracks and samples (every sound is synthesised), recording, automation, editing the sounds themselves
(a preset is fixed), time signatures other than 4/4, tempo changes inside a song, moving a clip to another track by
dragging (the CLI can: `clip move c3 5 t4`), reordering tracks, selecting several clips or notes at once, WAV
export from the CLI, more than one project at a time (there is one song; `show --json` prints it whole).
