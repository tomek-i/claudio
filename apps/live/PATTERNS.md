# Patterns

A pattern is a short line of code that describes a loop, in the **mini-notation** of [TidalCycles](https://tidalcycles.org) and [Strudel](https://strudel.cc), so a beat from a Strudel stream can be pasted in. It is the language of Claudel, the live-coding app (#90). This page lists what it understands.

```js
s("bd*4, [~ sd]*2, hh*8")             // kick on every beat, snare on 2 and 4, eighth hats
note("<c3 eb3 g3 bb3>*2").s("bass")   // a different note each half bar
s("bd sd").every(4, fast(2))          // every fourth bar twice as fast
```

One **cycle is one bar**. The code is `lib/pattern.mjs`: `parse(code)` reads it, and `query(pattern, from, to)` gives the events that start between two cycles (`{ start, len, sound, kind, pitch, vel }`, in cycles). It is our own code with Strudel's syntax, not Strudel. It plays on Claudel's kit and synth sounds (the same as Claudebase's).

## Sounds

`s("…")` (or `sound("…")`) takes the names of:

- **The kit:** `bd` `sd` `hh` `oh` `cp` `rim` `lt` `cb`, and the kit's own names `kick` `snare` `hat` `open` `clap` `tom` `bell`. Also `sn`, `ch`, `rs`, `mt` and `ht`.
- **The synths:** `bass` `lead` `pad` `pluck` `keys`.

A note with no `s` plays on the sound of the track it is in.

## The mini-notation: inside the quotes

| Write | It means | Example |
|---|---|---|
| `a b c` | a sequence: the cycle shared out evenly | `s("bd sd hh")` |
| `~` or `-` | a rest | `s("bd ~ sd ~")` |
| `[a b]` | a group: one step holding a sequence of its own | `s("bd [sd sd]")` |
| `a, b` | layers, at the same time | `s("bd*2, hh*4")` |
| `<a b>` | one item a cycle, in turn | `s("hh <sd cp>")` |
| `a*n` | n times as fast: n of it in its step | `s("hh*8")` |
| `a/n` | n times as slow: once every n cycles | `s("bd sd/2")` |
| `a!n`, `a !` | the step repeated | `s("bd!3 sd")`, `s("bd ! sd")` |
| `a@n`, `a _` | a step n times as long | `s("bd@3 sd")`, `s("bd _ _ sd")` |
| `a?`, `a?0.3` | dropped at random, half the time or by the amount | `s("hh*8?")` |
| `a(k,n)`, `a(k,n,r)` | Euclid: k hits spread over n steps, turned left by r | `s("bd(3,8)")`, `s("bd(3,8,2)")` |
| `a:n` | the sound's number (read; the kit has one sound each) | `s("bd:3")` |
| `*<2 3>`, `/[1 2]` | a number that changes by cycle | `s("bd*<2 3>")` |

## Notes

- **Notes:** `note("c3 eb3 g3")` takes names (`c3`, `eb3`, `f#2`, `cs4`; octave 3 when none is written, so `c` is `c3`) or MIDI numbers (`60`). Chords are layers: `note("[c3,e3,g3]")`.
- **Scale degrees:** `n("0 2 4").scale("C:major")`. Degrees count from the root, so `7` is the octave above in a seven-note scale and `-1` the note below.
  - A scale is a root and a name: `C:major`, `A2:minor`, `D:minor:pentatonic`.
  - The names: `major` `minor` `ionian` `dorian` `phrygian` `lydian` `mixolydian` `aeolian` `locrian`, `harmonic minor`, `melodic minor`, `pentatonic` (`major pentatonic`), `minor pentatonic`, `blues`, `whole tone`, `chromatic`.
  - The scale can change by cycle: `.scale("<C:major A:minor>")`.
- **`n` alone on a synth** counts semitones from C3: `n("0 7").s("pad")`.

## Functions

Each one is written after a pattern (`s("bd sd").fast(2)`). It can also be written before one (`fast(2, s("bd sd"))`). Without the pattern it is a function to hand to another (`every(4, fast(2))`). An arrow function works there too: `every(4, x => x.fast(2))`.

| Function | What it does | Example |
|---|---|---|
| `fast(n)`, `slow(n)` | faster or slower; n can be a string of numbers | `s("bd sd").fast("<1 2>")` |
| `every(n, f)` | f on the first cycle of each n (also `firstOf`) | `s("bd sd").every(4, fast(2))` |
| `sometimes(f)` | f on about half the events, `often` 3/4, `rarely` 1/4, `almostNever`, `almostAlways` | `s("hh*8").sometimes(x => x.ply(2))` |
| `sometimesBy(x, f)` | f on the events, with chance x | `s("hh*8").sometimesBy(0.3, fast(2))` |
| `degradeBy(x)`, `degrade()` | drops events at random, with chance x (half) | `s("hh*16").degradeBy(0.3)` |
| `rev()` | each cycle backwards | `s("bd sd hh").rev()` |
| `ply(n)` | each event n times in its own length | `s("bd sd").ply(2)` |
| `off(t, f)` | a copy t cycles later, with f on it | `s("bd sd").off(1/8, x => x.s("hh"))` |
| `late(t)`, `early(t)` | later or earlier by t cycles | `s("bd sd").late(1/4)` |
| `gain(x)`, `velocity(x)` | how hard: 1 is the normal level | `s("hh*8").gain("[.5 1]*4")` |
| `s`, `note`, `n` | the sound, the note or the degree, on a pattern | `note("c3 e3").s("pad")` |
| `scale(name)` | degrees (`n`) to notes | `n("0 2 4").scale("C:minor")` |
| `stack(a, b)` | patterns at the same time | `stack(s("bd*2"), s("hh*4"))` |
| `cat(a, b)` | one a cycle, in turn (also `slowcat`) | `cat(s("bd*2"), s("sd*4"))` |
| `seq(a, b)` | in one cycle (also `fastcat`) | `seq(s("bd"), s("sd sd"))` |

Numbers can be worked out (`1/8`, `3/4 + 1/16`). `silence` is a pattern with nothing in it.

## The code around them

- **Several patterns**, each on its own line, play together. A line may start with `$:`, as in Strudel, or name its
  block: `$drums:` (or `drums:`). `_` before either mutes it. On Claudel's page each block can be muted and soloed.
- **A chain can go on over lines:** `s("bd sd")` then `.fast(2)` on the next line.
- **Comments** are `//` and `/* */`.
- **Strings** take `"`, `'` or `` ` ``.

```js
// a beat, a bass line and a pad
$: s("bd*4, [~ sd]*2, hh*8?")
$: n("0 0 3 5").scale("C2:minor").s("bass").every(4, rev)
_$: note("<[c3,eb3,g3] [ab2,c3,eb3]>").s("pad")
```

## Randomness

`?`, `degradeBy` and `sometimes` decide by the time of each event. The same code gives the same bars every time, and different bars from one cycle to the next.

## Errors

An error says the line and column and what was expected:

```
line 1, column 7: no sound called "sx" (the kit: bd, sd, hh, oh, cp, rim, lt, cb, …; the synths: bass, lead, pad, pluck, keys)
line 2, column 4: every takes 2 arguments here, not 1
```

## Not yet

- Strudel's sample banks and effects: `speed`, `lpf`, `room`, `jux` and the like.
- Random choice `a | b` and polymeter `{a b c}%4`.
- Patterned Euclid numbers: `bd(<3 5>,8)`.
- Arithmetic on patterns: `add`, `sub`.
- Variables and the rest of JavaScript.

Whether to go further than the core is an open question in #90.
