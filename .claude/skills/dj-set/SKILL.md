---
name: dj-set
description: "Play a whole DJ set on autopilot while staying steerable by text and by crowd requests from the booth. Use when the user says \"play a set\", \"DJ for me\", \"take over\", \"30 minutes of hardstyle\", \"warm-up set\", or invokes /dj-set. Accepts an optional length, genre or vibe."
---

# Autopilot set: you DJ, the user steers

You run the set continuously. The user steers by typing in this Claude Code session at any time, for example "harder", "play X", "no vocals" or "wrap it up in 10". Crowd requests also arrive in the booth inbox from the browser. Keep the music going and stay interruptible.

Load the dj skill for the command reference and the dj-mix skill for transition craft. Commands are written as `dj <command>`, which means `node dj.mjs <command>` from the project root. `<live>` is the deck that is on air and `<idle>` is the other one, as defined in the dj skill. `<id>` is a track id.

## Setup

1. Run `dj status`. If the server or the engine is not running, follow "Boot" in the dj skill.
2. Read the brief: length, genre, vibe, start energy and end energy. If the user gave none, play a set of about 30 minutes that builds to a peak and lands gently. Do not ask questions. Start playing.
3. Run `dj library --sort bpm`. You need about one track per 3.5 minutes of set, which is about 9 tracks for 30 minutes. If you have fewer tracks that fit the brief, download more with `dj get "artist - title"`, preferring extended or original mixes (see the dj-crate skill). Start the first track before you download anything, and fetch one track at a time between waits.

## Plan the arc

Plan the energy arc of the set in four phases:

- Warm-up, about the first 20 %: energy 4–6 and longer blends of 16–32 bars.
- Build, about 40 %: energy climbs one step every 1–2 tracks. Pick harmonic neighbours and let the tempo creep up by at most 2–3 BPM per track.
- Peak, about 25 %: energy 8–10, drop-to-drop mixes with `--style bassswap --in drop`, the occasional energy-boost key (Camelot +2, see "Harmonic compatibility" in the dj-mix skill) and bigger moments with `echo` or `cut`.
- Land, about the last 15 %: step the energy down. Finish with a long `fade` or a big closing anthem.

Do not write the plan to a file. Change it whenever the user steers. Announce it to the user in two lines at most, then start.

## The loop

To start the set, run `dj load A <id>` with the first track, then `dj play A`, then `dj say "<short intro>"`. Add `--speak` to have the intro spoken.

Then repeat these steps for every track:

1. Pick the next track. See "Choosing the next track".
2. Run `dj load <idle> <id>`, then `dj track <id>`. Decide the style, the number of bars and the `--in` point with the dj-mix skill.
3. If you have picked the next 2 or 3 tracks, add the later ones to the queue with `dj queue add <id> <id> …`.
4. Schedule the mix with `dj plan add`, so that the server fires it on time while you stay responsive. Use a `beforeMixout` of `<lead>` seconds, where `<lead>` is the transition length in seconds plus 5 s and the transition length is `bars × 4 × 60 / bpm`. The dj-mix skill has a worked example under "Timing". This is the standard mix step, with deck A live, deck B idle and a `<lead>` of 30 s:
   ```bash
   node dj.mjs plan add '{"when":{"deck":"A","beforeMixout":30},"cmd":"mix","args":{"to":"B","style":"bassswap","bars":8,"in":"drop"},"why":"9A→9A drop-to-drop"}'
   ```
   Read `plan-schema.md` in this folder before writing a `dj plan add` step that is anything other than this mix step with your own deck, lead, style, bars, `in` point and reason.
5. Wait for the mix point with `dj wait mixout --seconds <lead> --timeout 60`. Keep every `dj wait` at 60 s or less, because the user's messages only reach you between tool calls. The wait prints one of three reasons:
   - `timeout`: check for new user text, then run the same wait again.
   - `inbox`: a crowd request arrived. Handle it as described under "Steering", then run the same wait again.
   - `mixout`: the mix point is reached. Go to step 6.
6. The planned step fires the mix. If you planned nothing, run the mix yourself: `dj mix <live> <idle> --style <style> --bars <n> --at phrase --in <point> --why "<one-line musical reason>"`.
7. Run `dj wait transition --timeout 60`, then `dj status`. Fix each ⚠ line using the table in "The mix monitor" in the dj-mix skill.
8. Read the critique (`dj log`) and rate the transition when the user comments.
9. For about one track in three, run `dj say "<crowd-facing line>"`.
10. Give the user a one-line update in chat, for example "Next: <title> (150 BPM, 9B), bass-swapped into the drop."

Planning the mix in step 4 is the default. Plain waiting, with no plan step and the mix run by hand in step 6, is the fallback. You can also leave a mix to the auto-DJ, which is described under "Safety rails".

### Choosing the next track

Run `dj suggest --direction up`, `dj suggest --direction hold` or `dj suggest --direction down`, whichever the arc calls for. It leaves out tracks that were played or are loaded, and it scores the rest by key distance, tempo gap and energy step. Then apply the judgement the scorer cannot:

- Do not play two tracks by the same artist back to back.
- Vary vocal tracks and instrumentals.
- Honour the genre of the brief.
- Use your knowledge of the actual songs: the anthems, the classics, what the crowd knows.
- Save the biggest tunes for the peak.
- If nothing suitable is left, `dj get` something. A download takes about 10 to 40 s and the current track keeps playing meanwhile. Fetch one track at a time between waits.

## Steering

Handle user text and crowd requests immediately, even in the middle of a wait.

- A specific track, such as "play X": run `dj library X`. If the track is missing, run `dj get "X"` while the current track keeps playing. Make it the next track. If the user says "now", mix at the next bar with a style that suits the tempo gap (see "Pick the style" in the dj-mix skill).
- Energy, such as "harder", "chill" or "slow it down": shift the arc. The very next pick changes direction. Add a live filter or EQ move straight away if it helps, for example `dj filter <live> -0.5 --ramp 8` for "chill".
- Time, such as "wrap it up in 10 min": re-plan so that the landing fits. Consider shortening tracks by mixing earlier, with `--at phrase` before the outro.
- A veto, such as "not this" or "skip": mix out at the next bar with `echo` or `cut` into the best track that is ready.
- The crowd inbox: when `dj wait` returns the reason `inbox`, it prints the messages. Treat them as requests from the dancefloor. Honour them when they fit the vibe. Acknowledge them with `dj say` either way. Then run `dj inbox --clear`.
- Stop, such as "stop" or "that's it": finish with a `brake` mix or a short `fade`, then follow "End of the set".

If a planned mix no longer fits what the user asked for, remove it with `dj plan rm <stepId>` or `dj plan clear` and plan again.

## Safety rails

- If `dj status` shows `Engine state is stale` or `Audio engine not connected`, the tab may be closed or asleep. Tell the user and pause the loop. The recovery steps are under "Engine and tab" in the dj-troubleshoot skill.
- If the live track's `remaining` drops under the transition length and nothing is ready, run an `echo` mix to whatever is loaded, or run `dj loop <live> 8` to buy time.

The auto-DJ is the server's safety net. It is on by default, and `dj autodj on|off [--lead 45]` switches it and sets its lead time. It mixes the next track itself when you have not, and the booth shows what it does as `🤖 Auto-DJ: …`.

- What keeps it off: a pending `plan` step that is a `mix`, a pending `plan` step that plays another deck, or a second deck that is playing and audible. A `dj mix` you run before the trigger also keeps it off, because a transition is running and then the other deck is live.
- The dead-air guard is the last resort. If the live track has 9 s left with no loop on it, no transition running and no other deck playing, the server puts an 8-beat loop on it until the next mix.

Read `auto-dj.md` in this folder when you need to predict or explain what the auto-DJ will do: when it triggers, which track it cues, when its mix starts and which style it picks.

When you queue tracks, the auto-DJ and plan steps with `"track": "next"` take from the queue. A track leaves the queue when it goes on air.

## End of the set

1. Sign off with `dj say`.
2. If a recording is running, run `dj record stop`, then `dj report`, then `dj export`. `dj record status` shows whether one is running. The recording is the flight recorder: the session recording that `dj record start` writes to `.dj/sessions/<id>/`. `dj export` gives the user an mp3, a timestamped tracklist and a `.cue` file in `.dj/exports/`.
3. Run `dj history`. Give the user the tracklist and one sentence on the arc.

## Chat etiquette

The live-set rules in CLAUDE.md apply. Two points are specific to a set:

- Write no essays and no command dumps unless the user asks.
- Your `--why` text is the running commentary. The user sees it in the booth in the browser, so make it read like a DJ's thought, for example "Keeping 9B→10B, stepping energy up for the build."

