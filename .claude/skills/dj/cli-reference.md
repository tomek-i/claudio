# CLI reference

This file lists every `dj` command with its flags and says how the commands behave.

`dj <command>` is short for `node dj.mjs <command>`, run from the project root.

`<deck>` is A, B, C or D. `<id>` is a track id from `dj library`; most commands also accept search words in its place.

```
SETUP   start [--no-open] | open | doctor [--fix] | status [--json]
        banner [name] [--list]             preview the server's startup animations
CRATE   library [search] [--bpm 140-150] [--key 8A,9A] [--energy 6-9] [--compatible <id>] [--sort bpm|energy|key|added] [--limit N]
        track <id>                         grid, key, intro/outro, breakdowns, phrase energy, sections, hot cues
        suggest [--from <id>] [--direction up|down|hold] [--limit N] [--keylock on|off]
        suggest --mashup                   vocal-over-bed pairs (needs stems)
        find "<query>"                     search YouTube, no download
        get <url|"artist - title"> [--playlist --max N]
        scan [--force]                     rescan the library folders
        starter [--list] [--force]         download the Creative Commons starter crate into library/starter
DECKS   load <deck> <id|search>   play <deck> [--at bar]   pause <deck>   cue <deck> [sec|bar:N]
        seek <deck> <sec|bar:N>   sync <deck>   tempo <deck> <bpm|±N%>
        loop <deck> <beats|off|half|double>   start a loop, release it (off or 0), halve or double the running loop
        loop <deck> move <n>               move the running loop by n of its own lengths (-1 = back one)
MIXER   vol <deck> <0-1>   eq <deck> <low|mid|high> <-1..1>   filter <deck> <-1..1>   echo <deck> <0-1>
        trim <deck> <-12..12 dB>           gain before the EQ, on top of the track's analysed gain (0 = unchanged)
        xfade <0-1>   master <0-1>
        --ramp <beats>                     automates vol, eq, filter, echo, trim or xfade on the beat clock
MIX     mix <from> <to> [--track <id>] [--style blend|bassswap|double|fade|filter|echo|cut|brake|spinback]
            [--bars N] [--at now|bar|phrase] [--in mixin|intro|drop|<sec>|bar:N] [--no-glide]
TIMING  wait mixout [--seconds 20] | wait remaining <sec> | wait transition | wait end | wait bar <n> | wait time <sec>
        --timeout <sec>                    give up after this long (the result says reason: timeout)
        --deck <deck>                      watch this deck instead of the live one
        --ignore-inbox                     do not return early on a crowd request
FX      fx <rollup|roll|chop|scratchcut|wobble|kills|throw|sweep> [deck] [--at drop|phrase-end|phrase|bar|now]
        perform '<json steps>' [--at drop|phrase-end|phrase|bar|now] [--ref <deck>]   beat-scheduled moves (schema in dj-mix)
SET     plan add '<json>' | plan show | plan clear [--all] | plan rm <id>     timeline sequencer (schema in dj-set)
        queue add <id|"search">… | queue show | queue clear | queue rm <n>   track queue for the auto-DJ and "track":"next"
        autodj on|off [--lead 45]          the auto-DJ safety net (on by default)
        monitor [--watch N]                the mix monitor: clashes, phase, clipping, energy
        rate good|bad [note]   memory [--n 10]                               set memory (feeds suggest)
REC     record start|stop|status [--no-screen --no-mic]                      the flight recorder (session recording)
        report [sessionId]                 report of a recorded session
        export [sessionId] [--format mp3|m4a]                                recorded session as a mix file, tracklist and .cue
CROWD   inbox [--clear]   say "text" [--speak]   log   history
TRACK   sections <id>                      labelled structure with bar numbers
        grid <id> [--shift beats --nudge ms --bpm x --reset]                 show or correct the beat grid (see dj-crate)
        stems [<id>|all|status]            queue stem separation, or show its status
        vocals <id>                        where the vocals are, in bars and times
        hotcue <deck> [list] | set <1-8> [bar:N|sec] [--label x] [--exact] | <1-8> | clear <n> | reset <n>
        savedloop <deck> [list] | set <name> [beats] [--at bar:N|sec] | <name> | delete <name>
KEYS    keys [grab <deck> | note <semis> | loop rec|play|stop|clear | set]   the chop keyboard (flags in cli-ext/keys.mjs)
PAGE    crate hide|show|toggle             hide or show the crate and booth on every open page, for example before recording
ENGINE  keylock <deck> [on|off|toggle]     key lock: tempo changes keep the key (on by default)
        key <deck> <-6..+6|reset>          shift the key in semitones, independent of tempo
        stem <deck> <vocals|drums|bass|other|all> <0-1> [--ramp beats]       stem fader (tracks with stems only)
        xfassign <deck> <left|right|thru>  crossfader side (A and C left, B and D right by default)
        sample <1-8> [--at now|beat|bar|phrase] [--vol 0-1.5]                fire a sampler pad (default: next beat)
        sampler [<1-8> --load <id> --from <sec|bar:N> --beats <n>]           list the pads, or capture a slice of a track into a pad
        deckfx <deck> <none|reverb|flanger|phaser|gate|crush> [amount 0-1] [--ramp beats]
        scratch <deck> <baby|chirp|transform|flare> [--beats 4] [--at bar|beat|now]
HELP    help | help-engine
GLOBAL  --why "reason"   --json
```

How the commands behave:

- Every `wait` returns early when a crowd request lands in the booth inbox.
- A bare `dj stems` queues every track. Use `dj stems <id>` for one track.
- `dj hotcue <deck> <1-8>` jumps to the cue. While the deck is playing, the jump is quantised to the next bar line.
- `dj savedloop <deck> <name>` recalls a loop: it seeks to the loop and starts it.
- `dj suggest --mashup` is covered in the dj-mashup skill.
- `dj help` and `dj help-engine` print this syntax.
