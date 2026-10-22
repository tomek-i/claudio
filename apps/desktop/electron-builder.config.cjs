// The installer: `pnpm dist` (from the project folder) writes it to dist/.
// The packaged app is the project itself, laid out as in the repository (main.mjs reaches the server by a relative
// path), so the project folder is electron-builder's app directory and this file only picks what goes in. Its one
// dependency is the updater (electron-updater, in the project's package.json because electron-builder packs the app
// directory's dependencies); the apps' own node_modules are not packed. Not an asar archive: the server starts ffmpeg and python on
// its own files, which have to be real files.
const path = require('node:path');

module.exports = {
  appId: 'com.claudio.desktop', // the same id main.mjs gives the taskbar (app.setAppUserModelId)
  productName: 'Claudio',
  electronVersion: require('electron/package.json').version,
  directories: { output: 'dist', buildResources: path.join(__dirname) },
  // name: the installer's folder (%LOCALAPPDATA%\Programs\<it>) is the product name, except in a one-click per-user
  // install, which takes the package name; the uninstaller also clears %APPDATA%\<it>, the app's own data
  extraMetadata: { name: 'claudio', main: 'apps/desktop/main.mjs' },
  asar: false,
  npmRebuild: false,
  files: [
    'package.json', 'apps/desktop/*.{mjs,html,png,md}',
    // the project, as the repository has it: the app runs it from here, and copies it into the user's folder so
    // Claude Code, the CLI and the skills work there (rig-folder.mjs)
    'dj.mjs', 'CLAUDE.md', 'config.json',
    'apps/server/**', 'apps/cli/**', 'apps/web/public/**', 'tools/produce/**',
    // the other four apps of the suite, without their tests
    'apps/drums/**', 'apps/synth/**', 'apps/daw/**', 'apps/live/**', '!apps/{drums,synth,daw,live}/test/**',
    '.claude/settings.json', '.claude/skills/**',
    '!apps/web/public/samples/src/**',
    '!apps/**/node_modules/**',
  ],
  // where the updater looks (main.mjs): the GitHub releases, which get the installer and its latest.yml (release-please.yml)
  publish: { provider: 'github', owner: 'tomek-i', repo: 'dj-claude' },
  artifactName: 'Claudio-Setup-${version}.${ext}', // no spaces: it is a download link on the release page
  win: { target: 'nsis', icon: 'apps/desktop/icon.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'Claudio' },
  mac: { target: 'dmg', icon: 'apps/desktop/icon.png', category: 'public.app-category.music' },
  linux: { target: 'AppImage', icon: 'apps/desktop/icon.png', category: 'Audio' },
};
