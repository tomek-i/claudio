---
name: miniclaude
description: 'Play MiniClaude, the synthesizer in apps/synth: design a sound from a description ("a fat detuned bass", "a soft pad that opens slowly", "an 80s pluck"), change it ("darker", "more bite", "slower attack", "add an echo"), load and adapt presets, write a riff or a chord sequence for the step sequencer, and audition it on the page. Use when the user asks for a synth sound, a patch, a bassline, a lead, a pad or a riff, mentions the synth or MiniClaude, or invokes /miniclaude. Not for drum beats (that is the cl-808 skill) and not for the DJ decks (that is the dj skill).'
---

# The synthesizer

MiniClaude is a subtractive synth at http://localhost:4749 that you play through `node apps/synth/miniclaude.mjs <command>`. The page is the sound and the panel. You and the user edit the same patch, and every change of yours is one undo step for them. The CLI starts the server when it is not running.

Run `node apps/synth/miniclaude.mjs help` once for the full command list, and `params` for every parameter with its range. Every command that changes something prints the result back.

## Reading a patch

```
slot A  "Acid bass"
osc1    wave saw   octave -1   semi 0   fine 0   level 0.8
osc2    wave saw   octave 0   semi 0   fine 0   level 0
mix     sub 0   noise 0
filter  cutoff 320   resonance 0.78   env 3.6   keytrack 0.3
fenv    attack 0.001   decay 0.22   sustain 0.05   release 0.1
aenv    attack 0.002   decay 0.25   sustain 0.6   release 0.08
lfo     rate 5   shape sine   depth 0   dest pitch
voice   glide 0.06   unison 1   detune 12
delay   time 0.375   feedback 0.35   mix 0.12
reverb  size 2   mix 0.05
master  volume 0.7
seq     118 bpm   gate 0.6   swing 0
        C2 . C3 . | Eb2 . C3 G2 | C2 . Bb2 C3 | . G2 Bb2 -
```

A parameter's name is its line and its word: `filter.cutoff`, `aenv.attack`. Times are seconds, the cutoff and the LFO rate are Hz, levels and amounts are 0 to 1 (`60%` is accepted for 0.6), `fine` and `detune` are cents, `filter.env` is octaves (negative closes the filter).

## Making a sound

1. Start near it: `preset` lists the starting sounds by kind, `preset warm` loads one. `init` is one plain saw.
2. Set what makes it that sound, several at once: `set osc2.level 0.8 osc2.fine 14 unison 2 cutoff 900`. The last part of a name is enough when only one parameter ends that way (`cutoff`, `resonance`, `glide`, `unison`); `level`, `attack`, `mix` and the like need their section.
3. Name it: `name Night bass`.

What to reach for:

- Brighter or darker: `filter.cutoff`. Bite or squelch: `filter.resonance` with `filter.env` 2 to 4 and a short `fenv.decay`.
- Plucked: `aenv.sustain 0`, `aenv.decay` 0.2 to 0.5, and the same on `fenv`. Held: sustain near 1.
- Soft and slow: `aenv.attack` 0.3 to 1.5, a long `aenv.release`, `reverb.mix` 0.3 or more.
- Fat: `osc2.level` up with `osc2.fine` 5 to 20, or `voice.unison` 2 to 4 with `voice.detune` 10 to 25. Weight: `mix.sub`.
- Movement: `lfo.dest filter` with a slow rate for a sweep, `pitch` at 5 to 6 Hz with depth under 0.1 for vibrato, `amp` for tremolo.
- A slide between notes: `voice.glide` 0.03 to 0.1.
- Basses: `osc1.octave -1` and keep the reverb low. Loud patches: bring `master.volume` down instead of every level.

## Writing a riff

The sequence is one bar of sixteen sixteenths, written as a row: a note name per step, `.` rest, `-` tie (holds the note before), `+` chord, `!` accent, `:50` a velocity in percent. `|` is ignored; use it between beats.

- `seq "C2 . C3 - | Eb2 . C3! G2 | C2 . Bb2 C3 | . G2 Bb2 -"` writes the bar. A row of 1, 2, 4 or 8 tokens is repeated to fill it: `seq "C3+Eb3+G3 - - -"` is a chord on every beat.
- `step 5 Eb2+G2`, `step 6 -`, `step 7 .` change single steps.
- `bpm 126`, `gate 40` (how much of a step a note is held for; ties need a note to last longer), `swing 30`, `transpose -12`.

C4 is middle C. Write basses around C1 to C3, leads around C4 to C6, and write for the patch: a pad wants long tied chords, a pluck wants short notes and rests.

## Hearing it

You cannot hear the synth; the user can. The page has to be open, and clicked once, because a browser keeps a page silent until then; the commands tell you when that is the case, so pass it on.

- `play` starts the sequence on the page until `stop`; `play 2` plays it twice.
- `note C3 Eb3 G3 2s` holds a chord for two seconds: a quick way to let the user hear a change.

After a change, say in one line what you did and what it should sound like, and audition it when a page is open.

## Slots and undo

Four slots hold four patches: `slot B` switches, `copy C` copies the playing patch to another slot before a risky change. `undo` and `redo` step through the edits, yours and the user's alike.

## The note box

The page has a box for notes to you. When the user wants to direct from the page, loop on `wait 30`: it prints the notes typed since the last call. Act on each, then answer on the page with `say "<one line>"`. Check for messages in Claude Code between waits; they come first.

## Files

WAV export is the button on the page (two bars of the sequence with the playing patch). The patches and the sequence are saved in `apps/synth/.miniclaude/state.json`.
