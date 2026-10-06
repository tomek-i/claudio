# Performance tools

This file covers the tools you use between transitions: performance FX (`dj fx`), loop rolls, `dj perform` routines, and the engine tools (key lock, key shift, stems, four decks, the sampler, deck FX and scratching).

You cannot hear the audio. What stands in for ears is the analysis from `dj track <id>` (bars, 8-bar phrases, breakdowns, drops and phrase energy), the mix monitor, and your knowledge of the genre and the songs. Before you fire anything, check `dj status` for the bar number and `dj track` for the next drop, so that you know what the music is doing.

### Performance FX

FX sound good only when they are tied to the structure of the track. Fired on the next bar at a random point, they sound like mistakes. Each preset is anchored musically by default. `--at drop|phrase-end|phrase|bar|now` overrides the anchor.

| FX | What it is | Use it | Default anchor |
|---|---|---|---|
| `dj fx rollup <deck>` | 8-bar loop roll, 4 beats to 2 to 1 to ½ to ¼, with a rising high-pass and a slip release | Over the last 8 bars before a drop, ideally over a build or breakdown | Ends exactly on the next drop (`--at drop`) |
| `dj fx roll <deck>` | The 4-bar version | Over a shorter build, or as a fill before a phrase | Ends exactly on the next drop (`--at drop`) |
| `dj fx throw <deck>` | Echoes the last beat, cuts for a bar, slams back in | On the final beat of a phrase, as a breath before the next section | Ends on the phrase boundary (`--at phrase-end`) |
| `dj fx chop <deck>` | Transformer volume chops in 8th notes | As a 2-bar fill at the end of a phrase, over a drums-only section | Ends on the phrase boundary (`--at phrase-end`) |
| `dj fx scratchcut <deck>` | Crossfader cuts between both decks | After a `double` mix, while both decks are playing | Ends on the phrase boundary (`--at phrase-end`) |
| `dj fx kills <deck>` | Kills bass, then mid, then high, and brings all back on the bar | Inside a full-energy section | Starts on the phrase (`--at phrase`) |
| `dj fx sweep <deck>` | Low-pass down and back up over 4 bars | To take energy out and bring it back, for example before a breakdown | Starts on the phrase (`--at phrase`) |
| `dj fx wobble <deck>` | Low-pass pump on the beat | In a breakdown or an intro | Starts on the phrase (`--at phrase`) |

Rules:

- Use no `fx` preset and no deck FX over the first 8 bars of a drop. Let the drop breathe.
- Use one FX per 16 bars at most. The track's own drop is the loudest effect you have.
- Rolls and builds resolve into drops. Never roll into the middle of a phrase.
- Never use `chop` over vocals.
- Use `wobble` only in a breakdown or an intro, because it muddies a drop.
- Use `scratchcut` only when both decks are playing, in phase and harmonically compatible.
- If the deck has no drop ahead of its playhead, `--at drop` ends the routine on the next 8-bar phrase boundary instead.

### Loop roll into a drop

`dj fx roll <deck>` and `dj fx rollup <deck>` are the scheduled loop rolls. Their loops run in slip mode: the engine remembers where the track would have been and jumps back there on release, so the drop lands on time.

To roll by hand over the last bar before a drop:

1. `dj loop <deck> 2`
2. `dj loop <deck> 1`
3. `dj loop <deck> 0.5`
4. `dj loop <deck> 0.25`
5. On the downbeat, run `dj loop <deck> 0`, then run it again one beat later, because a loop that is not released holds the track at the same bar.

A loop set with `dj loop` is not a slip loop. After the release the track carries on from inside the looped bar, so its drop arrives later than it would have by the time spent looping. Use `dj fx roll` or a `dj perform` routine when the drop has to land on the grid.

### Custom routines with `dj perform`

`dj perform '<json steps>' --at drop|phrase-end|phrase|bar|now` schedules a list of steps on the audio clock, all up front. Without `--at` it starts on the next bar. `--at drop` and `--at phrase-end` are end-aligned: the routine finishes exactly on the next drop or on the next phrase boundary. `--ref <deck>` names the deck whose beat grid times the routine. Without it the live deck is used.

Each step is a JSON object. `b` is the beat offset from the start of the routine and `d` is the deck.

| Step | What it does |
|---|---|
| `{b, d, c, v, o}` | Moves control `c` to value `v` over `o` beats. `c` is one of `low`, `mid`, `high`, `filter`, `echo`, `vol`, `xfade`, `master`, `vocals`, `drums`, `bass`, `other`, `fx`. |
| `{b, d, loop: beats}` | Starts a slip-mode loop of that many beats. `{b, d, loop: 0}` releases it. |
| `{b, d, rate: "+2%"}` | Changes the tempo. |
| `{b, d, seek}` | Jumps to a position in seconds or `bar:N`. |
| `{b, d, scratch: "baby", beats: 2}` | Plays a scratch pattern. |
| `{b, sample: 1-8}` | Fires a sampler pad. |

The `vocals`, `drums`, `bass` and `other` controls need a track with stems. The `fx` control is the amount of the deck FX, so run `dj deckfx <deck> <type> 0` first.

### Engine tools

Every deck argument accepts A, B, C or D. `dj help-engine` prints the syntax. All of these commands are logged to the booth and to the flight recorder, which is the session recording.

| Tool | Command | Purpose |
|---|---|---|
| Key lock | `dj keylock <deck> on\|off` | Tempo changes keep the key. It is on by default for every load. |
| Key shift | `dj key <deck> <-6..+6>` | Shifts the key in semitones, independent of tempo. `dj key <deck> reset` undoes it. |
| Stems | `dj stem <deck> vocals\|drums\|bass\|other\|all <0-1> [--ramp beats]` | A fader per stem, for tracks that have stems. |
| Four decks and crossfader assign | `dj xfassign <deck> left\|right\|thru` | Puts a deck on one side of the crossfader, or past it. |
| Sampler | `dj sample <pad> --at beat\|bar` | Fires one of the 8 pads. |
| Sampler capture | `dj sampler 7 --load <id> --from bar:17 --beats 2` | Captures a slice of a track into a pad. |
| Deck FX | `dj deckfx <deck> reverb\|flanger\|phaser\|gate\|crush\|none [0-1] [--ramp beats]` | A beat-synced effect on one deck. |
| Scratch | `dj scratch <deck> baby\|chirp\|transform\|flare --beats 4 --at bar` | A beat-synced scratch routine. |

#### Key lock

- It helps on tempo jumps over about 3 %. A 124 BPM track pushed to 132 keeps its key.
- Brakes, spinbacks and scratches bypass it by design.
- Above about 8 % of stretch, prefer `echo` or `cut`, because stretch artefacts creep in.

#### Key shift

- Use it to fix a clash so that two tracks blend. Shift the incoming track to the live deck's `effectiveCamelot` or to a neighbour of it. `dj status --json` shows `effectiveCamelot` for each deck.
- One semitone up moves the key 7 steps round the Camelot wheel, and the letter stays. For example, 8A shifted +1 plays as 3A, because 8 + 7 = 15 and the wheel wraps at 12.
- Shifts beyond ±2 make vocals sound chipmunky or demonic.
- Run `dj key <deck> reset` before the track plays solo for long.

#### Stems

- In a `dj perform` routine, use `c: vocals`, `c: drums`, `c: bass` or `c: other`.
- For a stem swap blend, bring the incoming drums in first, swap the bass on the downbeat, and bring the vocals in last.
- For a drum-only loop, set `other 0`, `vocals 0` and `bass 0`.
- Keep the keys compatible when you layer vocals over other music. Use `dj key` to get there.
- For an acapella over a bed, see "Mechanics" in the dj-mashup skill.

#### Four decks and crossfader assign

- Decks A and C are on the left of the crossfader and B and D are on the right by default.
- Use C and D for a loop layer, an acapella or a tool track under the main deck.
- `thru` keeps a layer up while you crossfade between A and B.
- A mix between two decks on the same side, or with one on `thru`, automatically uses the channel faders.
- More than 3 audible decks is mud. Load C or D only for a purpose, and pause it afterwards.

#### Sampler

The pads are: 1 air horn, 2 riser, 3 boom, 4 siren, 5 laser, 6 "hey!". Pads 7 and 8 hold captured slices.

- The riser is always 8 beats long and has to end on the drop. Use the end-aligned perform recipe below.
- Fire the boom on the drop's downbeat.
- Fire the air horn or the siren once at the top of a big drop, in dancehall, hardstyle or drum and bass.
- Use a captured vocal hit as a call and response in a breakdown.
- Samples are seasoning. Fire at most one hit per drop. Never fire one over a vocal line. Never fire one every phrase.

#### Deck FX

- In a `dj perform` routine, use `c: fx`.
- Use a reverb washout on the last bar of a track, together with the echo out.
- Use flanger or phaser over a breakdown or a long intro.
- Use `gate`, a 1/16 trance gate, on pads and breakdowns in trance and hardstyle. Never use it on vocals.
- Use `crush` briefly as a build-up texture.
- Run `dj deckfx <deck> none` when you are done. Do not leave an effect on.

#### Scratch

- In a `dj perform` routine, use `{b, d, scratch: "chirp", beats: 2}`.
- Use it as a fill of 1 or 2 bars at a phrase end, in hip-hop, breaks, drum and bass or old-school house.
- The track resumes on the grid afterwards, because the scratch runs in slip mode.
- Do not scratch over sustained melodic sections.
- Do not scratch more than once per 32 bars.

#### Engine tool recipes

```bash
# Big tempo jump that keeps its key: key lock is already on, so just blend
node dj.mjs mix A B --style bassswap --bars 8 --why "126→133 with key lock on, no pitch change"
# Riser ends exactly on the next drop and the boom hits the drop (end-aligned perform: 8-beat riser, boom at beat 8)
node dj.mjs perform '[{"b":0,"sample":2},{"b":8,"sample":3}]' --at drop --ref A
```
