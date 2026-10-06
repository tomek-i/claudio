# The `dj plan add` step schema

This file gives the format of a plan step: its `when` conditions, the commands it can run, and how the server times them.

`dj plan add '<json>'` takes one step or an array of steps. The server holds the timeline and fires each step on time.

```bash
node dj.mjs plan add '{"when":{"deck":"A","beforeMixout":30},"cmd":"mix","args":{"to":"B","style":"bassswap","bars":8,"in":"drop"},"why":"9A→9A drop-to-drop"}'
node dj.mjs plan add '[{"when":{"deck":"A","bar":97},"cmd":"fx","args":{"name":"rollup","deck":"A"}},{"when":{"after":"p2","sec":20},"cmd":"say","args":{"text":"Make some noise!"}}]'
```

A step has `when`, `cmd`, `args` and an optional `why`. The server names the steps `p1`, `p2` and so on in the order they are added, unless you give a step its own `"id"`.

`when` is one of these:

| `when` | Fires |
|---|---|
| `{deck, bar}` | when that deck reaches bar N |
| `{deck, beforeMixout: s}` | `s` seconds before that deck's mix-out point |
| `{deck, beforeEnd: s}` | `s` seconds before that deck's audible end |
| `{after: stepId, sec}` | `sec` seconds after that step's command took effect |
| `{at: epochMs}` | at that wall-clock time |

- Add `"track": "<id>"` inside `when` as a guard. The step then fires only while that track is on the deck.
- `cmd` is any deck or mixer command, such as `mix`, `load`, `play`, `perform`, `eq`, `filter`, `vol`, `echo`, `xfade`, `loop`, `stem` or `key`. It can also be `fx`, `hotcue`, `savedloop`, `say`, `queue` or `autodj`.
- `args` holds the command's arguments by name, as in the examples.
- For `mix`, the server fills in `from` with the live deck and `to` with the idle deck. `"track": "next"` in the `args` of a `mix` or a `load` takes the next track from the queue.
- The server sends `mix`, `perform`, `fx`, `hotcue`, `savedloop`, `play`, `scratch` and knob moves about 1 bar early, and the command's own `--at` anchoring lands them on time. The default anchor is `phrase` for `mix` and `perform`, the preset's own anchor for `fx`, and `bar` when the step targets a bar.
- A knob move (`eq`, `filter`, `vol`, `trim`, `echo`, `xfade` or `loop`) becomes a one-step perform on the bar.
- `dj plan show` lists the steps with their ETAs. `dj plan rm <stepId>` removes one step. `dj plan clear` removes the pending steps, and `dj plan clear --all` removes the fired ones too.
- Every firing shows in the booth and in the flight recorder.
