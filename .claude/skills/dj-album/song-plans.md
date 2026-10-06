# Song plans

This file says what to give and tell each per-song subagent, and lists the nine things a good song plan has.

Give each agent:
- the brief, which is `produce/songs/README.md`, to read first;
- its track number and working title;
- its two beds, with the bpm, bars and drops of each;
- the file to write: `.dj/produce/songs/track-NN.mjs`.

Tell each agent:
- Write only your own file and sample downloads.
- Never change the beds, the server or the engine.
- Verify your plan with `node produce/album-design.mjs --track N`.
- Prefer lines that literally match your title, because all agents take lines from one shared pool and the first plan to use a line keeps it.
- Put the jokes you must keep into `script`, because scripted lines are reserved before any verse is filled.

A good song plan has all nine of these. `produce/songs/README.md` defines every field.
1. `hook`: the title, as an exact spoken phrase found with `node produce/index-captions.mjs --find <words>`.
2. `word`: one word for the drop rolls, spoken by the same voice as the hook.
3. `verse`: a tight regex, so that every verse line is about the title.
4. `verseOnly: true`, so that no generic filler lines are used.
5. `featured`: 10 to 30 lines in listening order, grouped by speaker.
6. `script`: 3 to 8 call-and-response moments, each ending on a phrase bar.
7. `arrangement`: music-only air after each drop and sparse bars before each hand-off.
8. `samples`: 3 or fewer iconic vocal samples. "Samples for the sampler" in dj-video shows how to fetch one.
9. Coverage between 0.40 and 0.55. **Coverage** is the share of a section's bars that carry a spoken line.
