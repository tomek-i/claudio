# Development

[← Back to the README](../README.md)

`CLAUDE.md` is the map of the code, file by file. This page is how to test, benchmark and release it.

## Tests
```bash
pnpm test        # or: node --test test/*.test.mjs test/server-*.mjs apps/*/test/*.test.mjs
```
No install is needed for them: the code has no dependencies. They need ffmpeg and ffprobe on PATH.

- **Server tests** (`test/server-*.mjs`) run scratch copies on ports 4851–4858 and 4861 with a fake engine and a
  generated library (synthetic tracks run through the real analyser), so they need no music on the machine and never
  touch `data/`.
- **The desktop test** (`test/desktop.test.mjs`, ports 4859–4860, 4862 and 4869–4871) starts the real desktop app in Electron on
  a scratch project folder and a scratch profile. It is skipped when Electron is not installed (`pnpm install`). Its
  windows are invisible (transparent, off the taskbar, never focused) so they do not pop up while you work;
  `DRIVE_VISIBLE=1` shows them, to watch a run.
- **The four small apps** have their own tests in `apps/drums/test/`, `apps/synth/test/`, `apps/daw/test/` and
  `apps/live/test/` (port 4867).

## Benchmarks
Benchmarks compare the working tree with the git ref in `tools/bench/baseline.json` (`BENCH_BASE=<ref>` overrides it) and check
that the output is byte-identical:
```bash
node tools/bench/analyze.bench.mjs     # also: deck-voice, zoom, library
```

## Continuous integration
- `.github/workflows/test.yml`: the whole suite on Linux, on every pull request and push to main. A change to
  documentation only runs nothing.
- `.github/workflows/desktop.yml`: the desktop start-up test on Windows with the real Electron. On a pull request it
  runs only when the desktop app, the server, the page, the CLI or the lockfile changed. On a push to main with such a
  change, and when run by hand (Actions → desktop → Run workflow), it also builds the installer, and the Mac app on
  macOS (only the build: it is not started there).

## Releases
Versions and the changelog come from the commit messages ([Conventional Commits](https://www.conventionalcommits.org):
`feat(visuals): …`, `fix(ui): …`). On every push to `main`, [release-please](https://github.com/googleapis/release-please)
keeps a release pull request up to date with the next version and `CHANGELOG.md`; merging it tags the version and
publishes the GitHub release. A `feat` raises the minor version, a `fix` the patch version. Setup:
`.github/workflows/release-please.yml` and `release-please-config.json`.

When a release is published, the same workflow builds the Windows installer and the Mac app from the released commit
and attaches them to the release (`Claudio-Setup-<version>.exe`; `Claudio-<version>-arm64.dmg` and `-x64.dmg`, with
the `.zip` files and `latest-mac.yml` the Mac updater reads). Run by hand with a tag, it builds and attaches them for
a release that has none.

## The installer
`pnpm install` once (Electron and electron-builder, for `apps/desktop` only), then `pnpm dist` writes the installer
to `dist/`. On a Mac, `pnpm dist:mac` writes the Mac app (a `.dmg` and a `.zip` for Apple Silicon and for Intel); it
cannot be built on Windows. Neither is signed with a certificate (the Mac app is signed ad hoc). What goes into it is the `files` list in `apps/desktop/electron-builder.config.cjs`: anything a skill
needs at run time has to be in that list. See [The desktop app](desktop-app.md).
