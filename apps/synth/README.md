# MiniClaude

A synthesizer that Claude plays with you. Eight voices of two oscillators, a sub and noise through a low-pass
filter, with two envelopes, an LFO, a delay and a reverb, and sixteen steps of sequencer so that a sound can be
heard without hands. Every control has a name, and the whole patch reads as a dozen lines of text.

This is a separate project that lives in the DJ Claude repository for now. It imports nothing from it.

## Run it

```
node apps/synth/server.mjs        # http://localhost:4749
node apps/synth/miniclaude.mjs help    # the CLI (starts the server when needed)
node --test apps/synth/test/*.test.mjs
```

Needs Node 20 or later. No dependencies, no build step. `MINICLAUDE_PORT` changes the port and `MINICLAUDE_HOME` the folder
the patches are saved in (default `apps/synth/.miniclaude/`).

## What it does

- Two oscillators (sine, triangle, saw, square; octave, semitone, fine, level), a sine sub an octave down, noise.
- A low-pass filter: cutoff, resonance, how far its envelope moves it (up or down, in octaves), key tracking.
- An ADSR for the filter and one for the level, both drawn on the page.
- One LFO (rate, shape, depth) to the pitch, the filter or the level. Glide. Unison of up to four copies, detuned.
- A delay and a reverb, each on a send. Master volume and a limiter.
- Eight voices. A ninth note takes the voice that is dying away, or the oldest.
- Played from the keys on the screen (mouse or touch; lower on a key is louder), two rows of the computer's
  keyboard, and a MIDI keyboard where the browser has Web MIDI. The keys on the screen are the bottom row of the
  window: the panel, the sequence and the Claude box scroll in the room above them, so nothing is ever underneath.
  "Hide keys" folds them away (the browser remembers it) and the room goes to the page.
- A sixteen-step sequence with rests, ties, chords, accents, tempo, gate and swing. Choose a step and play a note
  to write it, or type the bar as text.
- Eleven presets (bass, lead, pad, pluck, keys) and four patch slots.
- Undo for everything, shared by the page and the CLI. Saved as you go.
- Export: the sequence as a WAV, rendered in the browser by the same code that plays it.

## Where the AI is

Claude Code is the sound designer. It reads the patch as text, sets parameters by name and writes the sequence
as a row of notes through the CLI (`.claude/skills/miniclaude/SKILL.md` teaches it how), asks the open page to sound
(`miniclaude play`, `miniclaude note C3 Eb3 G3`), and reads the notes typed into the page's Claude box (`miniclaude wait`).
There is no model in the page and no API key.

```
slot A  "Acid bass"
osc1    wave saw   octave -1   semi 0   fine 0   level 0.8
filter  cutoff 320   resonance 0.78   env 3.6   keytrack 0.3
…
seq     118 bpm   gate 0.6   swing 0
        C2 . C3 . | Eb2 . C3 G2 | C2 . Bb2 C3 | . G2 Bb2 -
```

A browser keeps a page silent until it has been clicked. So the page opens on a card with one button, "Start
sound", and a light in the top bar reads "sound off" until it is clicked and "sound on" after. The card does not
come back while the page stays open; a page that is loaded again asks again, because the browser forgets the click.
Until then `miniclaude play` and `miniclaude note` say that the page's sound is off ("click Start sound on the page")
instead of pretending.

## Layout

- `lib/app.mjs`: the name and the port, each written once.
- `lib/patch.mjs`: the schema (`PARAMS`: every parameter with its range, default, unit and slider curve), making
  a patch well-formed, `setParams`, values and patches as text. `lib/presets.mjs`.
- `lib/notes.mjs`: note ↔ frequency ↔ name. `lib/envelope.mjs`: the level of an ADSR at any moment.
  `lib/voices.mjs`: which voice a ninth note takes. `lib/wav.mjs`.
- `lib/seq.mjs`: the sequence, its edits (`applySeqOp`), rows as text, and `notesInWindow`: which notes start
  when. Playback and the WAV both ask it.
- `lib/banner.mjs`: the server's startup banner. One of its `ANIMATIONS` plays at random (`MINICLAUDE_BANNER=<name>`
  picks one, `MINICLAUDE_NO_BANNER=1` gives plain lines), then its strip of the sixteen steps shows the riff as it is
  written, with a playhead while the page plays (`MINICLAUDE_BANNER_LOOP=0` turns that off). Preview:
  `node miniclaude.mjs banner [name]`.
- `lib/store.mjs`: slots, undo, saving, play requests, notes. `server.mjs`: the HTTP API and static files (the
  API is listed at its top).
- `public/`: the page. `engine.js` is the synthesiser, the scheduler and the WAV render; `app.js` builds the
  panel from the schema and handles the keys and the sequence. The page imports `lib/` as `/lib/*.mjs`.
- `miniclaude.mjs`: the CLI.
- `test/`: `synth.test.mjs` (the arithmetic), `engine.test.mjs` (the engine on a pretend audio context,
  `fake-audio.mjs`), `server.test.mjs` (the server on a scratch folder, port 4864, and the CLI as a process).

## Not yet

An arpeggiator, more than one bar, a sequence per patch, a mono / legato mode, pulse width, a high-pass filter,
velocity to the filter, pitch bend and MIDI controllers, WAV and MIDI export from the CLI, a startup banner.
