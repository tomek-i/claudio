// Updates of the installed app: electron-updater reads the latest GitHub release (its latest.yml, attached with the
// installer by release-please.yml), downloads a newer installer in the background and runs it when the app restarts,
// or when it next quits. This file is what the suite makes of it: one state, told to main.mjs on every change (the
// home window's footer and the Apps menu show it), and the words for each state.
// No Electron in it: the updater is handed in, so test/desktop-updates.test.mjs drives it with a stand-in.

// status: dev (run from the source tree: no updates) | idle | checking | latest | downloading | ready | failed
export function watchUpdates(updater, { version, onChange }) {
  let state = { status: 'idle', current: version };
  const set = (s) => { state = { current: version, ...s }; onChange(state); };
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'latest' }));
  updater.on('update-available', (info) => set({ status: 'downloading', next: info.version, percent: 0 }));
  updater.on('download-progress', (p) => set({ status: 'downloading', next: state.next, percent: Math.floor(p.percent) }));
  updater.on('update-downloaded', (info) => set({ status: 'ready', next: info.version }));
  updater.on('error', (e) => set({ status: 'failed', error: reason(e) }));
  return {
    get state() { return state; },
    // a check while one is under way, or after the update is in, is that one
    async check() {
      if (['checking', 'downloading', 'ready'].includes(state.status)) return state;
      try { await updater.checkForUpdates(); } catch (e) { set({ status: 'failed', error: reason(e) }); }
      return state;
    },
    // quietly, and the app starts again on the new version
    install() { if (state.status === 'ready') updater.quitAndInstall(true, true); },
  };
}

// electron-updater's errors are long (a whole HTTP answer); one short line of why
export function reason(e) {
  const msg = String(e?.message || e || '');
  if (/\b404\b/.test(msg)) return 'GitHub has no update to show (the releases are not public, or the latest has no latest.yml)';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED/.test(msg)) return 'no connection to GitHub';
  const line = msg.split('\n')[0].trim() || 'unknown error';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

// what the home window's footer and the Apps menu say: a line, and the action its link and menu item take (none
// while there is nothing to do)
export function describe(s) {
  switch (s.status) {
    case 'dev': return { text: `Claudio ${s.current}, from the source tree: updates come with git pull`, action: null };
    case 'checking': return { text: 'Checking for updates…', action: null };
    case 'latest': return { text: `Claudio ${s.current} is up to date`, action: 'Check for updates' };
    case 'downloading': return { text: `Downloading Claudio ${s.next}… ${s.percent}%`, action: null };
    case 'ready': return { text: `Claudio ${s.next} is ready: it installs when the app restarts`, action: 'Restart to update' };
    case 'failed': return { text: `Could not check for updates: ${s.error}`, action: 'Try again' };
    default: return { text: `Claudio ${s.current}`, action: 'Check for updates' };
  }
}
