---
name: dj-mix
description: "How to mix in DJ Claude. Covers one transition (style: blend, bass swap, filter, echo out, cut, brake, spinback, double drop; length; start on bar, phrase or mix-out point; entry at intro or drop), performance FX, stems, key shift, sampler, scratching, and fixing ⚠ warnings from the mix monitor. Use before every `dj mix`, when the user asks for a kind of transition or effect, or when a transition sounded wrong."
---

# Mixing like a DJ

This file covers one transition from start to finish. The performance tools you use between transitions and the hot cue reference are in separate files in this folder. "Performance tools" and "Reference" at the end of this file say when to read them.

Commands are written as `dj <command>`, which means `node dj.mjs <command>` from the project root. `<deck>` is A, B, C or D. `<id>` is a track id from `dj library`.

## One transition

A transition is five decisions: which track, which style, how long, when it starts, and where the incoming track enters. The engine handles beat-matching, phase alignment and sample-accurate scheduling. The musical decisions are yours.

### Read both tracks

```bash
node dj.mjs status              # live deck, position, bar, time to mix-out
node dj.mjs track <incomingId>  # grid, key, intro end, breakdowns and drops, phrase energy, sections
```

- The key numbers are `bpm`, `camelot`, `energy`, `mixIn` (the first downbeat), `introEnd`, `breakdowns[].drop` and `mixOut` (the start of the outro).
- The phrase-energy sparkline shows where the track is quiet (▁▂) and where it is full (▇█).
- `dj sections <id>` labels the structure as intro, verse, chorus, build, drop, breakdown and outro, with bar numbers. `dj track` shows the same labels. Time mixes to them. For example, enter with `--in bar:<first chorus>`, or plan a mix for the end of a chorus.
- `dj track` shows the grid as `grid stable (drift N ms)` or `DRIFTS up to N ms`. Tracks with a drifting grid carry a `beatMap`. Keep blends with them short (8 bars) and watch for `flamming`. To repair a grid, see "Fixing a beat grid" in the dj-crate skill.

### Pick the style

First compute the tempo gap: `|incoming bpm − live effective bpm| / live effective bpm`. Half time and double time count as a match.

| Situation | Style | Bars |
|---|---|---|
| Gap of 6 % or less, compatible keys, groove to groove | `blend` | 16–32 |
| Gap of 6 % or less, compatible keys, and you want it punchier or faster | `bassswap` | 8 |
| Gap of 6 % or less, compatible keys, and both tracks have a drop coming | `double` | 16 |
| Gap of 6 % or less, and the keys clash or the vocals would collide | `filter` | 8–16 |
| Gap above 6 %, a genre change, or ending on a big moment | `echo` | 1–2 |
| The crowd wants it immediately, drop on drop, or a hard genre switch | `cut` with `--at bar` | 0 |
| A theatrical reset: a big tempo change or a set-piece moment | `spinback` or `brake` | 0 |
| Ambient music, no beats, or ending the night | `fade` | 16–32 |

What each style does:

- `blend` is an EQ blend with a bass swap in the middle.
- `bassswap` brings the incoming track in without bass and swaps the two basslines on the middle downbeat.
- `double` is a double drop. `dj mix A B --style double --bars 16` starts the incoming track so that its first drop lands exactly on the outgoing track's next drop, computed on the audio clock. The incoming track rises filtered and without bass under the build. On the drop both melodies hit with one bassline, the incoming track's. Both tracks play for `--bars`, then the outgoing track fades. It works best with the same key or neighbouring keys and matched energy. The command fails if the incoming track has no detected drop or the outgoing track has no drop ahead of its playhead.
- `filter` high-passes the outgoing track away while the incoming track opens from a low-pass.
- `echo` echoes the outgoing track out on the downbeat. The incoming track drops in after `--bars` bars, 1 by default.
- `cut` switches on the beat with no overlap.
- `brake` stops the outgoing track like a turntable over 2 beats. `spinback` spins it backwards over 2 beats. The incoming track starts straight after.
- `fade` is a plain crossfade.

How the engine treats the tempo gap:

- With `blend`, `bassswap`, `double`, `filter` and `fade`, the engine always stretches the incoming track to the live tempo. Do not use them above a 6 % gap.
- With `echo`, `cut`, `brake` and `spinback`, the engine beat-matches the incoming track up to a 6 % gap and plays it at its own tempo above that.
- If a beat-matched style would stretch the incoming track by more than 8 %, the mix result carries the warning `tempo gap is N%`. Above 8 % key lock holds the key but stretch artefacts creep in. If you see the warning, switch to `echo`, `cut` or `spinback`.

#### Harmonic compatibility

Keys are shown in Camelot notation, for example 8A.

- A safe move is the same code (8A to 8A), one step with the same letter (8A to 7A or 9A), or a letter swap (8A to 8B).
- An energy boost is two steps with the same letter (8A to 10A), or the diagonal, one step with a letter swap (8A to 9B). Use it sparingly, at peaks.
- Anything else is a clash. Use `filter`, `echo` or `cut` so that the two keys barely overlap. You can ignore a clash on a hard drop swap, because an overlap of drums only does not clash.
- Detected keys can be off by a fifth or by the relative key. If your own knowledge of the track disagrees, trust yourself. See "Trusting the analysis" in the dj-crate skill.

`dj suggest` is key-aware. It scores each candidate at the pitch it will actually play, which is the live tempo unless the incoming deck has key lock on, and each result says `plays as 3A`. When a small shift fixes a clash, the result adds `→ keyShift -1 (8A): dj key <deck> -1`. Apply that command to the incoming deck before the mix. In `--json` output the field is `recommendedKeyShift`.

### Timing

Dance music moves in 8-bar phrases of 32 beats, and big changes land on 16-bar and 32-bar boundaries. Time a mix in phrases, not seconds.

- `--at phrase` starts on the next 8-bar boundary of the live track. If that boundary is more than 30 s away, it uses the next 4-bar boundary. Use `--at phrase` for every planned mix.
- `--at bar` starts on the next downbeat. Use it for reactive moves. It is what `dj mix` uses when you pass no `--at`.
- `--at now` starts immediately. The mix is phase-matched but not aligned to a bar. Use it only in an emergency.

Start early enough. Wait until the live track is close to its outro before you mix:

```bash
node dj.mjs wait mixout --seconds <lead>
```

`<lead>` is the transition length in seconds plus 5 s. The transition length is `bars × 4 × 60 / bpm`. For example, a 16-bar blend at 128 BPM takes 16 × 4 × 60 / 128 = 30 s, so use `--seconds 35`. A long blend should finish around the end of the outgoing track's outro, not after the track has run out.

### Where the incoming track enters (`--in`)

- `mixin` is the default. The track enters at its first downbeat and its intro plays under the outgoing track. It suits `blend` and `bassswap` best.
- `intro` makes the incoming track reach its full groove exactly as the transition ends.
- `drop` makes the incoming track's first drop, the end of its first breakdown, land exactly as the transition completes. This is the crowd-pleaser. Use it with `bassswap` or `filter` at 8 bars.
- `bar:N` or `<seconds>` is a manual entry point. Use it, for example, to skip a long intro that is hard to mix.

### After the mix

- The engine glides the incoming track's tempo back to its native BPM over 16 bars, about 30 s at 128 BPM. The pitch drifts subtly while it does. Pass `--no-glide` to hold the current tempo, for example when you mix several tracks of one genre at a steady club tempo.
- `dj wait transition` blocks until the transition has finished. Then run `dj status` to confirm which deck is live.
- Load the next track onto the idle deck early, because loading takes a few seconds.

### The mix monitor

You cannot hear the mix, so the mix monitor listens for you. `dj status` prints its warnings as ⚠ lines. `dj monitor` shows the full picture: each deck's effective key, section and vocals, and the phase offset in ms. The monitor checks every 250 ms. The deck-against-deck checks run while two or more decks are audible above 0.3.

| ⚠ | Meaning | Fix |
|---|---|---|
| `vocal clash` | Two decks are inside vocal sections with their vocals up (stem gain above 0.3, mid EQ above −0.7). | `dj stem <deck> vocals 0 --ramp 2`, or `dj eq <deck> mid -1`, or finish the mix sooner. |
| `key clash` | The effective keys, after tempo and key shift, clash while both decks have bass or melody up. | Kill one deck's `low` and `mid`, or shorten the overlap, or run `dj key <deck> ±1`. |
| `flamming: B is 30 ms behind A` | The beat-phase offset is above 20 ms, so the kicks double up. | `dj sync <deck>`. If a track keeps drifting, check `dj grid <id>`. |
| `tempo mismatch` | The decks are at different effective BPMs, so the phase will drift. | `dj sync <deck>` or `dj tempo <deck> <bpm>`. |
| `master clipping` | The master peak is at −0.3 dBFS or above. | `dj master 0.8`, or pull back one deck's volume or low EQ. |
| `energy dip` | Everything audible has been in a breakdown or a low section for more than 16 bars. | Bring the next drop in with `dj fx rollup` or a mix with `--in drop`. |

After each transition the booth gets a `🧐 Critique` line. It says what was checked, the maximum phase offset and any warnings. Read it with `dj log`. It is also recorded in `.dj/memory.json` and in `dj report`.

If the user reacts to a transition, for example "that was rough" or "nice", run `dj rate bad "<note>"` or `dj rate good "<note>"`. `dj memory` shows the pairings that worked and the ones that did not, and `dj suggest` favours the ones that worked.

### Recipes

```bash
# Classic long EQ blend on the phrase, same genre
node dj.mjs mix A B --style blend --bars 32 --at phrase --why "8A→9A, same 128 BPM, long intro — ride it"
# Drop to drop: the incoming track's drop lands as the mix completes
node dj.mjs mix A B --style bassswap --bars 8 --in drop --at phrase --why "Timing the incoming drop to land on the phrase"
# Genre or tempo jump (128 to 150)
node dj.mjs mix A B --style echo --at phrase --why "22-BPM jump — echo out and slam into hardstyle"
# Build tension on the live deck, then release into a cut
node dj.mjs filter A 0.6 --ramp 16 && node dj.mjs wait bar <n>
node dj.mjs mix A B --style cut --at bar --in drop
```

### Manual moves

Use these when a direction does not fit a preset style. The examples have A live and B incoming.

Tease the incoming track:

1. `dj vol B 0`
2. `dj play B --at bar`. Deck B starts beat-synced and silent.
3. `dj xfade 0.5`
4. `dj vol B 0.5 --ramp 8`
5. Finish with `dj mix A B --style fade --bars 4`.

Loop to extend a short outro:

1. `dj loop A 8` while you set up.
2. `dj mix A B` with the style you chose. The loop ends when deck A stops.

Ride the EQs:

1. `dj eq B low -1` before you bring B in.
2. Swap the bass on a downbeat with `dj eq A low -1 && dj eq B low 0`.

## Performance tools

Read `performance.md` in this folder before using a `dj fx` preset, a `dj perform` routine, key lock, key shift, stems, deck C or D, crossfader assign, the sampler, deck FX or scratching.

Two rules apply whenever stems are in use:

- Never have two vocal stems up at once.
- Never have two basslines up at once. Stems obey the same bass-swap rule as EQs.

### Loop roll into a drop

Read "Loop roll into a drop" in `performance.md` in this folder before rolling a loop into a drop, either with `dj fx roll` or `dj fx rollup` or by hand with `dj loop`.

## Reference

### Hot cues and saved loops

Read "Hot cues and saved loops" in `reference.md` in this folder before using `dj hotcue` or `dj savedloop`, or when you need the positions of the six automatic hot cues.
