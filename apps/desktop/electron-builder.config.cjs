// The installer: `pnpm dist` (from the project folder) writes it to dist/.
// The packaged app is the project itself, laid out as in the repository (main.mjs reaches the server by a relative
// path), so the project folder is electron-builder's app directory and this file only picks what goes in. The code
// has no dependencies, so no node_modules are packed. Not an asar archive: the server starts ffmpeg and python on
// its own files, which have to be real files.
const path = require('node:path');

module.exports = {
  appId: 'com.claudio.desktop', // the same id main.mjs gives the taskbar (app.setAppUserModelId)
  productName: 'Claudio',
  electronVersion: require('electron/package.json').version,
  directories: { output: 'dist', buildResources: path.join(__dirname) },
  extraMetadata: { main: 'apps/desktop/main.mjs' },
  asar: false,
  npmRebuild: false,
  files: [
    'package.json', 'apps/desktop/*.{mjs,html,png,md}',
    // the project, as the repository has it: the app runs it from here, and copies it into the user's folder so
    // Claude Code, the CLI and the skills work there (rig-folder.mjs)
    'dj.mjs', 'CLAUDE.md', 'config.json',
    'apps/server/**', 'apps/cli/**', 'apps/web/public/**', 'tools/produce/**',
    // the other three apps of the suite, without their tests
    'apps/drums/**', 'apps/synth/**', 'apps/daw/**', '!apps/{drums,synth,daw}/test/**',
    '.claude/settings.json', '.claude/skills/**',
    '!apps/web/public/samples/src/**',
    '!**/node_modules/**',
  ],
  artifactName: 'Claudio-Setup-${version}.${ext}', // no spaces: it is a download link on the release page
  win: { target: 'nsis', icon: 'apps/desktop/icon.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'Claudio' },
  mac: { target: 'dmg', icon: 'apps/desktop/icon.png', category: 'public.app-category.music' },
  linux: { target: 'AppImage', icon: 'apps/desktop/icon.png', category: 'Audio' },
};
