# Videos, speech clips and albums

[← Back to the README](../README.md)

The production tools are in `tools/produce/`. They are run by Claude through the **dj-video**, **dj-voice** and
**dj-album** skills, and can be run by hand.

## Making a video of a set
```bash
node tools/produce/record-browser.mjs                 # before the set: records the DJ table page (Playwright), becomes the sound system
node dj.mjs record start --no-screen --no-mic   # … play the set …
node dj.mjs record stop && node dj.mjs export   # → .dj/exports/<session>.mp3 + tracklist
node tools/produce/record-browser.mjs --stop
node tools/produce/make-video.mjs .dj/exports/<session>.mp3 --title "DJ Claude - Saturday Night Set" --screen auto
```
You get a 720p mp4 and a 480p copy: reactive visualiser, title card, the DJ table as footage, one colour tint per track.
Details and options in `.claude/skills/dj-video/SKILL.md`.

Recording the page needs [Playwright](https://playwright.dev) (`npm i -g playwright && npx playwright install chromium`).

## Speech clips as the vocals, and albums
An hour-long album can be made this way: talk clips indexed from their captions
(`tools/produce/index-captions.mjs`), a title hook per track cut word-accurately, verses that literally match the song's
words, one subagent planning each song, a voice reel built with `tools/produce/build-reel.mjs`, the whole thing played as one
live take by `tools/produce/run-design.mjs` and cut into tracks with `tools/produce/cut-track.mjs`. The `dj-voice` and `dj-album`
skills walk through it; `tools/produce/songs/README.md` is the song-plan schema.
