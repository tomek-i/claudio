# The desktop app

[← Back to the README](../README.md)

The same server and the same page in a window of their own, instead of a browser tab:
```bash
pnpm install     # once: Electron, for the desktop app only (it fetches its own binary, about 370 MB, on first run)
pnpm desktop
```
- **A start-up window**: it opens at once and lists each step as it happens (the server, the health checks, the
  audio engine), then gives way to the DJ page when the engine is live. If the server cannot start, it says why.
- **The window where you left it**: it opens on the same screen, at the same size, maximised or not (maximised the
  first time).
- **No Start engine click**: the app may play sound without one, so the window is the sound system as soon as it opens.
- **No stale engine**: the window is not slowed down when it is hidden or minimised, as a background browser tab is.
- **One thing to launch**: the server starts with the app and stops with it. If a server is already running
  (`node dj.mjs start`), the app uses that one and leaves it running when it quits.

- **It asks before it takes over**: if a browser tab is already the sound system on that server, the app does not
  cut it off. Its window opens with "Another window is the sound system right now" and takes over on **Take over**.

Claude Code and `node dj.mjs …` work the same in both modes: they talk to the server. Browser mode needs no install;
only `apps/desktop/` has dependencies.

## The installer
Each [release](https://github.com/tomek-i/dj-claude/releases) has the Windows installer attached
(`DJ-Claude-Setup-<version>.exe`); `pnpm dist` builds the same thing into `dist/`. It is not code-signed, so Windows
asks before running it.

The installed app is the same window, started from the Start menu, and it brings the whole project with it. On the
first start it makes **Documents/DJ Claude**: a project folder like this repository, with `dj.mjs`, the skills
(`.claude/skills`), `CLAUDE.md`, `tools/produce` and its own `config.json`, library and `.dj/`. Open Claude Code in
that folder and it plays the rig exactly as it does here. The start-up window shows where the folder is, and the
Settings page has it too, with **Open folder** and **Open Claude Code here** (a terminal in that folder, running `claude`). What the
machine needs besides the app: Node 20+ (for `node dj.mjs …`, which is how Claude Code drives it), Claude Code, and
ffmpeg on PATH. Stem separation is one command in that folder: `node dj.mjs stems setup` (see [Stems](stems.md)).

An update replaces the app's own files in that folder (`apps/`, `tools/`, `starter/`, `dj.mjs`, `CLAUDE.md` and the
skills it ships) and leaves yours alone: `config.json`, `.claude/settings.json`, the library, `.dj/`, skills you added.

## Building and testing it
- `pnpm dist` builds the installer into `dist/` (electron-builder; the configuration is `apps/desktop/electron-builder.config.cjs`).
- `node --test test/desktop.test.mjs` starts the real app on a scratch project folder and checks its start-up. It is
  skipped when Electron is not installed.
- More on both in [Development](development.md).
