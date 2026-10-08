---
name: cl-808
description: 'Play Claude-808, the drum machine in apps/drums: write a beat from a description ("make me a boom bap beat", "a garage beat at 132"), change it ("busier hats", "lazier snare", "more swing"), give it a feel, make variations, write a second bar, morph between two beats, export MIDI. Use when the user asks for a beat, a drum pattern or a groove, mentions the drum machine, Claude-808 or the 808, or invokes /cl-808. Not for the DJ decks (that is the dj skill).'
---

# The drum machine

A step sequencer at http://localhost:4748 that you play through `node apps/drums/cl808.mjs <command>`. The page is the sound and the grid. You and the user edit the same beat, and every change of yours is one undo step for them. The CLI starts the server when it is not running. Tell the user to open the page, click "Start sound" on the card it opens on (a browser keeps a page silent until it is clicked; the light in its top bar reads "sound off" until then) and press Play (or Space); you cannot start playback. `open` prints the address and, under it, whether a page is open and whether its sound is on: when it says the sound is off, pass on "click Start sound on the page". The ruler above the grid names every beat bar.beat (1.1 … 1.4, and 2.1 … 2.4 in a 32-step beat); a click on a number plays from that beat, so "listen from 2.3" is something the user can do. Beat b of bar a starts on step (a − 1) × 16 + (b − 1) × 4 + 1: 1.3 is step 9, 2.1 is step 17.

Run `node apps/drums/cl808.mjs help` once for the full command list. Every command that changes the beat prints it back.

## Reading a beat

```
slot A  "Boom bap"  90 bpm  swing 50% (41.7 ms)  16 steps
       1...2...3...4...
kick   x......x..x.....
snare  ....X.......X...   off the grid: 5 +11ms, 13 +9ms
```

`.` off, `g` ghost, `o` soft, `x` normal, `X` accent. Steps are sixteenths, counted from 1. "Off the grid" lists the hits that sit late (+) or early (−).

## Writing one

1. Set the frame: `bpm 132`, `swing 35`, `name "Two-step"`.
2. Write the rows in one command. `--clear` empties the rows you do not name:
   `write --clear "kick x.........x....." "snare ....X.......X..." "hat ..x.x.x...x.x.xg"`
3. Place the hits that carry the feel: `nudge snare 5 +15ms`, `nudge hat 3 -0.08` (a share of a step).
   Or give the whole beat a feel: `humanize laidback 60` (`tight`, `laidback`, `pushed`, `drunk`). It replaces the offsets, so do it before your own nudges, not after.

A beat is its timing as much as its notes. Swing delays every second sixteenth (50% at 90 BPM is 41.7 ms); offsets move single hits. Use both on purpose: a late snare drags, early hats push, ghost notes sit late and quiet. A hit can be at most 0.4 of a step early and 0.5 late.

Voices: `kick snare clap hat open tom rim bell`. A closed hat cuts a ringing open hat, so do not put both on one step.

## Changing one

- Small asks are single edits: `hit hat 8 ghost`, `hit kick 11 off`, `swing 58`, `level hat 60`, `tune kick -2`.
- "Something like this but different": `vary 40` prints four versions; `pick 2` takes one. The user can audition them on the page.
- "Make it longer": `continue` writes bar 2 with a fill.
- Two beats: keep one in each slot (`copy B`, `slot B`), then `morph B 40` from slot A.
- A wrong move: `undo`.

After a change, say in one line what you did and why it should feel the way they asked.

## The note box

The page has a box for notes to you. When the user wants to direct from the page, loop on `wait 30`: it prints the notes typed since the last call. Act on each, then answer on the page with `say "<one line>"`. Check for messages in Claude Code between waits; they come first.

## Files

`export midi <file> [loops]` writes MIDI with the timing kept. WAV is the button on the page.
