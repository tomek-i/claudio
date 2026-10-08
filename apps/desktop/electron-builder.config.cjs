// The installer: `pnpm dist` (from the project folder) writes it to dist/.
// The packaged app is the project itself, laid out as in the repository (main.mjs reaches the server by a relative
// path), so the project folder is electron-builder's app directory and this file only picks what goes in. The code
// has no dependencies, so no node_modules are packed. Not an asar archive: the server starts ffmpeg and python on
// its own files, which have to be real files.
const path = require('node:path');

module.exports = {
  appId: 'com.dj-claude.desktop', // the same id main.mjs gives the taskbar (app.setAppUserModelId)
  productName: 'DJ Claude',
  electronVersion: require('electron/package.json').version,
  directories: { output: 'dist', buildResources: path.join(__dirname) },
  extraMetadata: { main: 'apps/desktop/main.mjs' },
  asar: false,
  npmRebuild: false,
  files: [
    'package.json', 'dj.mjs',
    'config.json', 'starter/**',   // copied into the user's folder on the first start (rig-folder.mjs)
    'apps/desktop/*.{mjs,html,png}',
    'apps/server/**', 'apps/cli/**', 'apps/web/public/**',
    '!apps/web/public/samples/src/**',
    '!**/node_modules/**',
  ],
  win: { target: 'nsis', icon: 'apps/desktop/icon.png' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, shortcutName: 'DJ Claude' },
  mac: { target: 'dmg', icon: 'apps/desktop/icon.png', category: 'public.app-category.music' },
  linux: { target: 'AppImage', icon: 'apps/desktop/icon.png', category: 'Audio' },
};
