# Claudel

Live coding: code that loops, as on [strudel.cc](https://strudel.cc). Write a pattern in Strudel's mini-notation,
Ctrl+Enter plays it, and change it while it plays: the change comes in on the next bar. The name is Strudel's, with a
Claude in it.

This is a separate project that lives in the DJ Claude repository for now. It imports nothing from it, nor from the
other apps.

## Run it

```
node apps/live/server.mjs          # http://localhost:4751   (or: pnpm live)
node --test apps/live/test/*.test.mjs
```

Needs Node 20 or later. No dependencies, no build step. `CLAUDEL_PORT` changes the port.

The header's Apps menu (the nine dots) lists the five apps of the suite, with a dot for each one running; it asks each
server's `GET /api/ping`. Its code, `public/apps-menu.js`, is the same file in each app (`test/apps-menu.test.mjs` at the
top of the repository keeps the copies the same). The look is the theme the apps share, `public/theme/` (a copy of
`tools/theme/`).

## What it does

- Write a pattern in Strudel's mini-notation ([PATTERNS.md](PATTERNS.md)): **Ctrl+Enter** plays it, and code played
  while it loops comes in on the next bar line, never inside a bar. **Ctrl+.** stops.
- An error leaves the loop playing what it played and marks its line.
- Blocks (`$drums: …`) can be muted and soloed; the words that sound light up in the code; a strip of the notes of this
  bar and the next, and a scope, under it.
- The code and the tempo are kept in the browser between visits, and **Share** copies a link that opens the code.
- It plays on a drum kit and synth sounds that are the same as Claudebase's (their code is copied, not shared).

## Where things are

- `lib/pattern.mjs`: the pattern language, Strudel's mini-notation and its core functions (`parse`, `query`: the
  events between two cycles, a cycle a bar). Our own code, not Strudel's (which is AGPL-3). What it supports, with an
  example each: [PATTERNS.md](PATTERNS.md). No page in it; `test/pattern.test.mjs`.
- `lib/live.mjs`: the loop: blocks bar after bar, new code on a bar line, mute and solo, the code as a link. No page in
  it; `test/live.test.mjs`.
- `lib/kit.mjs`, `lib/presets.mjs`, `lib/notes.mjs`: the drum voices, the synth sounds, pitches; copies of Claudebase's.
- `lib/app.mjs`: the name and the port.
- `public/index.html`, `app.js`, `style.css`: the page. `public/engine.js`: the sound (a `Rig`: a strip per instrument,
  reverb and delay sends, a limiter), which began as a copy of Claudebase's.
- `server.mjs`: serves the page and the libraries, and `GET /api/ping`. The code is kept by the page, not here.
