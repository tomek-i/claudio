# Design fields

This file defines every field of a design module's `SECTIONS` and `WINDOWS` exports, which the example under "Write the design" in SKILL.md shows in use.

| Item | Fields | The bar is where the item |
|---|---|---|
| `lines` | `[endBar, clipId, fromSec, durSec, text]` | ends |
| `slices` | `[startBar, clipId, fromSec, durSec, refFromSec, refDurSec]` | starts |
| `bedMoves` | `{ bar, beat, …step }` | starts |

- Every bar in a design is a bar number of the bed track, as `dj track <bedId>` prints it. A bar can be fractional: 31.5 is beat 3 of bar 31.
- In `lines` and `slices`, `fromSec` and `durSec` give the start and the length of the cut inside the clip, in seconds.
- A line is placed so that it ends exactly on `endBar`. `text` labels the line in the build output.
- A slice is a stab or one repeat of a roll. `refFromSec` and `refDurSec` give the whole word or line that the slice is cut from. The builder measures the level of that whole word once and gives every slice of it the same gain.
- A bed move is a `dj perform` step for the bed deck: either `loop: <beats>` or `c: <control>, v: <value>, o: <over-beats>`. `beat` is optional and shifts the move by that many beats after the bar line. `produce/remix.mjs` has helpers that return ready-made moves, among them `bedRoll` (a loop roll into a drop) and `bassKill` (a stem move).
- In a section, `fromBar` is the bed bar where the section starts, `bars` is its length, `key` is the key shift in semitones, and `stems` sets the bed's stem levels. Keep `vocals: 0` so the bed's own vocals stay muted.
- A window's `name` must equal its section's `name`, because the runner looks up the window by that name. `anchor` is the anchor bar, normally the section's `fromBar`. The runner does not read `mute`.
- `handoff: { drumsIn: 8 }` describes how this section hands over to the next one. The next bed's drums start under this bed 8 bars before this section ends. On the downbeat where the next section begins, the next bed switches to its full stems and this bed is cut. Without `handoff`, the next bed starts on that downbeat with no drums beforehand.
- The runner cues the first two sections before it starts, so a design needs at least two sections.
