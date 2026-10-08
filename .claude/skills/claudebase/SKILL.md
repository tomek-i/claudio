---
name: claudebase
description: 'Compose in Claudebase, the small DAW in apps/daw: write a song from a description ("make me a house track", "a lofi loop with keys and a bass line"), add tracks and clips, write drum patterns, bass lines, chords and melodies, arrange them along the bars (intro, drop, breakdown), mix (volume, pan, mute, solo, reverb, delay), start playback, export MIDI. Use when the user asks for a song, a track, an arrangement, a bass line, chords or a melody in the DAW, mentions Claudebase or the DAW, or invokes /claudebase. Not for a single drum pattern on the drum machine (that is the cl-808 skill) and not for the DJ decks (that is the dj skill).'
---

# Claudebase

A DAW at http://localhost:4750 that you compose in through `node apps/daw/claudebase.mjs <command>`. The page is the sound, the timeline and the editors. You and the user edit the same song, and every command of yours is one undo step for them. The CLI starts the server when it is not running. The page has to be open for sound: `open` prints the address.

Run `node apps/daw/claudebase.mjs help` once for the full command list. Every command that changes the song prints the result back, so you rarely need `show` after an edit.

## Reading a song

```
"Night drive"  122 bpm  swing 0%  16 bars  loop 5-16 off  master 80
bar              1   5   9   13
t1 Drums  drums  [==][==========]   vol 85
    c1 1-4 (1 bar ×4, 8 hits) · c2 5-16 (1 bar ×12, 22 hits)
t2 Bass  bass    ....[==========]   vol 80
    c3 5-16 (4 bars ×3, 16 notes)
```

One character per bar: `.` empty, `#` a clip of one bar, `[==]` a longer one. Under each track are its clips: id, bars, and what is in them. `1 bar ×4` means one bar of content played four times; `(=c1)` means the same content as c1. Bars count from 1. `show clip c3` prints one clip: drum rows, or the notes bar by bar and a small piano roll.

A track is named by its id (`t2`), its number (`2`) or its name (`bass`). A clip only by its id (`c3`).

## Writing a song

1. Start clean or from a template: `new blank` (a drum track and a bass track, no clips), or `new` to list them. Then `name "…"`, `tempo 124`, `swing 20`, `length 32`.
2. Add the tracks you need: `track add drums`, `track add synth Chords pad`. The sounds are `bass lead pad pluck keys`.
3. Add each clip with its content in one command. The track, the bar it starts at, how many bars it lasts, then the content:
   - drums: `clip add drums 1 8 "kick x...x...x...x..." "clap ....X.......X..." "hat ..x...x...x...x."`
   - notes: `clip add bass 1 8 "A1:0:3 A1:6:2 A1:10:2 C2:14:2" "F1:16:3 F1:22:2 F1:26:2 G1:30:2"`
4. Arrange: `clip dup c1 9 2` puts two copies of c1 from bar 9, `clip move c4 17`, `clip resize c2 4`, `clip del c5`.
5. Mix: `mix bass vol 75`, `mix pad reverb 40`, `mix pluck delay 30`, `mix pluck pan R20`, `mix drums mute` / `mute off`, `solo`.
6. Let them hear it: `play` or `play 9` starts the open page from that bar, `stop` stops it. `loop 5 8` repeats bars 5 to 8 (`loop off`). If `play` says no page is open, tell the user to open the address.

### Drum rows

`.` off, `g` ghost, `o` soft, `x` normal, `X` accent; 16 steps to the bar; `|` and spaces between steps are ignored. The kit: `kick snare clap hat open tom rim bell`. A closed hat cuts a ringing open hat, so do not put both on one step. A drum clip's content is one bar unless a row is longer: a 32-step row makes it two bars (a fill in the second bar), and the shorter rows repeat. `drums c1 "hat x.x.x.x.x.x.x.x."` rewrites rows of an existing clip (the rows you do not name stay; `--clear` empties them), `hit c1 snare 16 ghost` changes one step (steps count from 1).

### Notes

`pitch:start:length`, start and length in sixteenths, **start counted from 0** at the beginning of the clip's content (bar 2 starts at 16, bar 3 at 32). A fourth part is the velocity, 1-127 (102 when left out). `+` joins pitches into a chord: `A3+C4+E4:0:16`. Pitches are C1 to C7 (C4 is middle C); sharps `F#2`, flats `Bb2`. Halves work: `C4:0.5:0.5`.

A synth clip's content is as long as the clip when you add it (at most 8 bars); a note that starts past the end is refused. To loop a short phrase, add a short clip and stretch it: `clip add bass 1 2 "…"` then `clip resize c3 8`. `clip len c3 4` makes the content longer, repeating what is there, so you can vary the second half.

`notes c3 "…"` replaces a clip's notes; `notes c3 --add "…"` adds to them; `notes c3 --del C2:0 E2:4` removes notes by pitch:start.

Registers that work with the sounds: bass C1-C3, pad and keys C3-C5, lead and pluck C4-C6. Swing moves the off sixteenths (odd starts) late, in drums and notes alike.

## Changing a song

Read first (`show`, `show clip <id>`), then make the smallest edit that does what was asked: one `hit`, one `notes --add`, one `mix`. A new section is new clips, usually copies of existing ones with a change (`clip dup`, then `drums` or `notes` on the copy: copies are independent). A wrong move: `undo`.

After a change, say in one line what you did and where (track, bars), and offer to play it from there.

## The note box

The page has a box for notes to you. When the user wants to direct from the page, loop on `wait 30`: it prints the notes typed since the last call. Act on each, then answer on the page with `say "<one line>"`. Check for messages in Claude Code between waits; they come first.

## Files

`export midi <file>` writes the whole song as MIDI, a track per track. WAV is the button on the page. `show --json` prints the project as JSON.
