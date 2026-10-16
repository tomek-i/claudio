# The desktop app: Claudio

[← Back to the README](../README.md)

**Claudio** is the desktop suite: DJ Claude, Claude-808 (drums), MiniClaude (synth) and Claudebase (DAW), each in a
window of its own, on the same servers and pages as in a browser:
```bash
pnpm install                  # once: Electron, for the desktop app only (it fetches its own binary, about 370 MB, on first run)
pnpm desktop                  # the home window: one card per app
pnpm desktop -- --app synth   # one app at once, without the home window (dj, drums, synth, daw)
```
- **A home window**: a card per app. A card (or its number key, 1 to 4) opens that app; the card says whether it is
  starting, open, or could not start. Nothing is started before you ask for it.
- **An Apps menu in every window**: Home (Ctrl+Shift+H) and the four apps (Ctrl+1 to Ctrl+4). Each app has one
  window: opening it again brings that window forward. A link from one app's page to another's opens that app.
- **Each app's server starts when it is opened**, and stops when its window closes. If one is already running on
  its port (`node dj.mjs start`, `pnpm synth`), the suite uses that one and leaves it running. The other apps'
  output shows in the terminal with their name before each line.

DJ Claude's window adds:
- **A start-up window**: it opens at once and lists each step as it happens (the server, the health checks, the
  audio engine), then gives way to the DJ page when the engine is live. If the server cannot start, it says why.
- **The window where you left it** (every app's): it opens on the same screen, at the same size, maximised or not
  (maximised the first time).
- **No Start engine click**: the app may play sound without one, so the window is the sound system as soon as it opens.
- **No stale engine**: the window is not slowed down when it is hidden or minimised, as a background browser tab is.

- **It asks before it takes over**: if a browser tab is already the sound system on that server, the app does not
  cut it off. Its window opens with "Another window is the sound system right now" and takes over on **Take over**.

Claude Code and `node dj.mjs …` work the same in both modes: they talk to the server. Browser mode needs no install;
only `apps/desktop/` has dependencies.

## The installer
Each [release](https://github.com/tomek-i/dj-claude/releases) has the Windows installer attached
(`Claudio-Setup-<version>.exe`); `pnpm dist` builds the same thing into `dist/`. It is not code-signed, so Windows
asks before running it.

The installed app is the same suite, started from the Start menu, and it brings the whole project with it. On the
first start it makes **Documents/Claudio**: a project folder like this repository, with `dj.mjs`, the four apps,
the skills (`.claude/skills`), `CLAUDE.md`, `tools/produce` and its own `config.json` and `data/` (the music and
everything else the apps make, a folder per app). Open Claude Code in that folder and it plays all four exactly as it
does here. The start-up window shows where the folder is, and the
Settings page has it too, with **Open folder** and **Open Claude Code here** (a terminal in that folder, running `claude`). What the
machine needs besides the app: Node 20+ (for `node dj.mjs …`, which is how Claude Code drives it), Claude Code, and
ffmpeg on PATH. Stem separation is one command in that folder: `node dj.mjs stems setup` (see [Stems](stems.md)).

An update replaces the app's own files in that folder (`apps/`, `tools/`, `dj.mjs`, `CLAUDE.md` and the
skills it ships) and leaves yours alone: `config.json`, `.claude/settings.json`, `data/`, skills you added.

A folder an earlier DJ Claude app made (**Documents/DJ Claude**) is not picked up by itself. Close the app and, from a
checkout of this repository, move it once: `node tools/move-to-claudio.mjs` (or `node tools/move-to-claudio.mjs
<from> [<to>]` for a Documents folder elsewhere). It renames it to Documents/Claudio and lays it out with `data/`.

## Building and testing it
- `pnpm dist` builds the installer into `dist/` (electron-builder; the configuration is `apps/desktop/electron-builder.config.cjs`).
- `node --test test/desktop.test.mjs` starts the real app on a scratch project folder and checks its start-up: DJ
  Claude on its own, and the home window opening DJ Claude and Claude-808. It is skipped when Electron is not
  installed. `test/desktop-apps.test.mjs` checks the list of apps (`apps/desktop/apps.mjs`) in plain Node.
- More on both in [Development](development.md).
