# Reference

This file lists the automatic hot cues and the commands for hot cues and saved loops.

### Hot cues and saved loops

Every track gets automatic hot cues where the analysis finds them:

| Cue | Position |
|---|---|
| 1 | start |
| 2 | first vocal-in |
| 3 | first chorus |
| 4 | first drop |
| 5 | first breakdown |
| 6 | mix-out |

- `dj hotcue <deck> <n>` jumps to cue `n`. While the deck is playing, the jump lands on the next bar line and keeps the phase.
- `dj hotcue <deck> set <n> [bar:N|sec]` saves your own cue. It is persistent and is stored in `.dj/cues.json`.
- `dj savedloop <deck> set <name> <beats> [--at bar:N]` stores a loop.
- `dj savedloop <deck> <name>` recalls it.
