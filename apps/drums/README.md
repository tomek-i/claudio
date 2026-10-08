# Claude-808

A drum machine that Claude plays with you. A step grid puts every hit on a sixteenth; here each hit also has an
offset, so a beat keeps the few milliseconds that make it a groove. The page draws each pad where the hit sounds.

This is a separate project that lives in the DJ Claude repository for now. It imports nothing from it.

## Run it

```
node apps/drums/server.mjs        # http://localhost:4748
node apps/drums/cl808.mjs help    # the CLI (starts the server when needed)
node --test apps/drums/test/*.test.mjs
```

Needs Node 20 or later. No dependencies, no build step. `CL808_PORT` changes the port and `CL808_HOME` the folder
the beat is saved in (default `apps/drums/.cl-808/`).

## What it does

- 16 or 32 steps, eight voices synthesised the way the TR-808 makes them, four pattern slots, tempo, swing, level / tune / mute / solo per voice.
- A step has a velocity (ghost, soft, normal, accent) and an offset: up to 0.4 of a step early, 0.5 late.
- Feel: four ways of playing the hits you wrote (tight, laid back, pushed, drunk). Adds and removes nothing.
- Variations: four beats near yours; hold one to hear it, click to keep it.
- Continue: a second bar with a fill. Morph: slide a beat towards the one in another slot.
- Undo for everything, shared by the page and the CLI. Saved as you go.
- Export: WAV (rendered in the browser by the same code that plays it) and MIDI (timing kept).
- Eight presets.

## Where the AI is

Claude Code is the musician. It reads the beat as text and writes rows, single hits and offsets through the CLI
(`.claude/skills/cl-808/SKILL.md` teaches it how), and it reads the notes typed into the page's Claude box
(`cl808 wait`). There is no model in the page and no API key. The Feel, Variations, Continue and Morph buttons are
rules with a seeded random number generator (`lib/groove.mjs`), so they work without Claude.

## Layout

- `lib/timing.mjs`: where a hit sounds (step + swing + offset). Playback, WAV and MIDI all use it.
- `lib/pattern.mjs`: the pattern, its edits (`applyOp`), rows as text. `lib/kit.mjs`: the voices and levels.
- `lib/groove.mjs`: humanize, variations, continue, morph. `lib/presets.mjs`. `lib/midi.mjs`.
- `lib/store.mjs`: slots, undo, saving, notes. `server.mjs`: the HTTP API and static files (the API is listed at its top).
- `public/`: the page. `engine.js` is the synthesiser, the scheduler and the WAV render; `app.js` the grid and controls.
  The page imports `lib/` as `/lib/*.mjs`.
- `cl808.mjs`: the CLI.
- `lib/banner.mjs`: the server's startup banner. One of its `ANIMATIONS` plays at random (`CL808_BANNER=<name>`
  picks one, `CL808_NO_BANNER=1` gives plain lines), then its strip of pads shows the loaded beat as it is edited,
  with a playhead while the page plays (`CL808_BANNER_LOOP=0` turns that off). Preview: `node cl808.mjs banner [name]`.

## Not yet

Song arrangement (chaining patterns), samples, time signatures other than 4/4, touch gestures for offsets, WAV
export from the CLI.
