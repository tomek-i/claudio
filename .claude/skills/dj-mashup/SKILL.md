---
name: dj-mashup
description: 'Build a live mashup on the DJ table: the sung vocals of one track over the instrumental of another, using stems, tempo and key fitting, and vocal placement over sparse sections. Use when the user asks for a mashup, "X over Y", an acapella over a beat, a remix of two tracks, or vocals from one song on another. For speech clips use dj-voice.'
---

# Live mashups

A mashup here is two tracks on two decks. The **bed** plays its drums, bass and other stems with its own vocals muted. The **top** plays only its vocals stem. Both play from the engine with tempo and key matched, so the result is live and can be re-cut at any time.

Both tracks need stems. Run `dj stems <id>` for each track and check progress with `dj stems status`.

In this skill the bed is on deck A and the top is on deck B. `<bedId>` and `<topId>` are their library ids.

## Pick the pair
A bad pairing cannot be fixed with effects, so spend the effort here.

- `dj suggest --mashup` ranks vocal-heavy tracks over instrumental beds. It lists a pair when the tempos are within 8 % and the keys are compatible at the bed's tempo.
- `dj library --compatible <bedId>` lists the harmonic neighbours of a bed. `dj track <id>` shows a track's vocal sections.
- Put dance-style vocals over dance beds only. A pop ballad vocal over hardstyle is a novelty for 8 bars and tiring after that. The fix is a different pairing.
- Tempo: stretch the top and leave the bed at its own tempo. Keep the stretch under about 8 % with key lock on (`dj keylock B on`).
- Key: shift the top to the bed's key with `dj key B <semitones>`. `dj suggest --mashup` gives the shift as `recommendedKeyShift`.
- Audition first. Play the pairing on a quiet deck for 16 bars before you commit it to the set.

## Place the vocal
- Vocals belong over the bed's sparse sections: the intro, a breakdown, or the 8 bars before a drop. Read `dj sections <bedId>` and the top's `vocalSections`.
- Line a vocal phrase up so that it ends exactly on a phrase downbeat of the bed.
- No vocal line goes over the first 4 to 8 bars of a drop or breakdown.
- While the vocal is in, take the bed's lead down with `dj stem A other 0.3`, so that two melodies never fight. Bring it back when the vocal stops.
- Use mashups sparingly. One or two mashup moments in a set land harder than a whole set of them.

## Mechanics
`<bedBpm>` is the bed's tempo and `<shift>` is the key shift in semitones.

```bash
node dj.mjs load A <bedId> && node dj.mjs stem A vocals 0                 # bed, own vocals muted
node dj.mjs load B <topId> && node dj.mjs stem B drums 0 && node dj.mjs stem B bass 0 && node dj.mjs stem B other 0
node dj.mjs keylock B on && node dj.mjs tempo B <bedBpm> && node dj.mjs key B <shift>
node dj.mjs xfassign A thru && node dj.mjs xfassign B thru                # both decks audible regardless of the crossfader
node dj.mjs hotcue B 2                                                    # hot cue 2 = the top's first vocal-in
node dj.mjs play B --at bar
```
- `dj hotcue B 2` moves deck B to the bar where the top's vocals first come in. To start from a different phrase, run `dj seek B bar:<N>` or `dj seek B <seconds>` instead, with the bar taken from the top's vocal sections.
- `dj play B --at bar` starts the top on the bed's next downbeat. Nothing works out the phrase ending for you. Count the bars of the vocal phrase, subtract that from the bed bar where the phrase must end, and run `dj play B --at bar` during the bed bar before the result. `dj status` shows the bed's current bar.
- Schedule timed moves with `dj perform '<steps>'`, which is beat-accurate. For example, take the bed's lead down over 2 beats as the vocal enters. The dj-mix skill gives the step format under "Performance tools".
- To roll into the drop, prefer `dj fx roll <deck>` or `dj fx rollup <deck>` when the drop has to land on the grid. "Loop roll into a drop" in the dj-mix skill has the detail. If you roll by hand with `dj loop` instead, on the downbeat run `dj loop <deck> 0`, then run it again one beat later, because a loop that is not released holds the track at the same bar.
- To lay an acapella over the live deck in the middle of a set, use deck C, so that deck B stays free for the next track. The rule is the same as above: the incoming deck plays `vocals 1, drums 0, bass 0, other 0` over the live deck with its `vocals 0`. With deck A live, run these in order:
  ```bash
  node dj.mjs load C <topId>
  node dj.mjs xfassign C thru
  node dj.mjs stem C drums 0 && node dj.mjs stem C bass 0 && node dj.mjs stem C other 0
  node dj.mjs stem A vocals 0 --ramp 4
  node dj.mjs vol C 0
  node dj.mjs play C --at bar
  node dj.mjs vol C 0.9 --ramp 8
  ```
- Move between mashup sections with `--style bassswap` or `--style filter` only. Do not echo out to silence and do not add riser or sweep samples, because the two tracks are the feature.

## Spoken word as the top
For speech clips use the dj-voice skill; its rules replace "Place the vocal" and "Mechanics" here.

## Judge it
After each transition read the critique (`dj log`) and rate it when the user comments. In a mashup, look in the critique for vocal clash, key clash and beat offset. Rate the pairing with `dj rate good|bad "<note>"` while both decks are audible; `dj suggest --mashup` uses these ratings in its ranking.
