// Health checks for the rig: one entry per system, each 'ok' (green), 'warn' (amber: an optional system has a fault,
// the decks still play), 'fail' (red: a required system is down) or 'off' (switched off on purpose).
// buildHealth() is pure (the server hands it a snapshot); toolVersion() probes a binary on PATH and caches the answer.
import { spawn } from 'node:child_process';

const TOOL_TTL_MS = 60000;
const toolCache = new Map(); // name -> { at, promise }

export function toolVersion(bin, args = ['-version']) {
  const hit = toolCache.get(bin);
  if (hit && Date.now() - hit.at < TOOL_TTL_MS) return hit.promise;
  const promise = new Promise((resolve) => {
    let out = '';
    const done = (v) => { clearTimeout(timer); resolve(v); };
    let p;
    try { p = spawn(bin, args, { windowsHide: true }); } catch { return resolve(null); }
    const timer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } done(null); }, 5000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => done(null));
    p.on('close', (code) => done(code === 0 ? out.split(/\r?\n/)[0].trim() || 'installed' : null));
  });
  toolCache.set(bin, { at: Date.now(), promise });
  return promise;
}

// Required: without these nothing plays (the server, the engine tab, and ffmpeg / ffprobe to decode and analyse).
// The rest is optional: a fault there costs one feature (downloads, stems) or mends itself (yt-dlp is fetched on the
// first download, which also creates a missing library folder), so a 'fail' from the checks below is shown as 'warn'.
const REQUIRED = new Set(['server', 'engine', 'ffmpeg', 'ffprobe']);
function check(id, name, status, detail) {
  const required = REQUIRED.has(id);
  if (status === 'fail' && !required) status = 'warn';
  return { id, name, status, required, ok: status !== 'fail', detail };
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function buildHealth(s) {
  const checks = [];
  checks.push(check('server', 'Server', 'ok', `port ${s.port} · up ${Math.floor(s.uptimeSec / 60)} min`));

  const e = s.engine || {};
  checks.push(!e.connected ? check('engine', 'Audio engine', 'fail', 'no engine tab connected: open the page and click "Start engine"')
    : !e.started ? check('engine', 'Audio engine', 'fail', 'tab connected but the engine has not reported yet')
    : e.stale ? check('engine', 'Audio engine', 'fail', 'engine state is stale (tab asleep or stalled)')
    : check('engine', 'Audio engine', 'ok', 'connected and reporting'));

  const found = s.dirs.filter((d) => d.exists), lib = s.library;
  const busy = lib.analyzing + lib.queued;
  checks.push(found.length
    ? check('library', 'Library', 'ok', `${plural(lib.tracks, 'track')}${busy ? ` · analysing ${busy}` : ''} · ${plural(found.length, 'folder')}`)
    : check('library', 'Library', 'fail', `none of the library folders exist: ${s.dirs.map((d) => d.dir).join(', ')}`));

  checks.push(s.ffmpeg ? check('ffmpeg', 'ffmpeg', 'ok', s.ffmpeg) : check('ffmpeg', 'ffmpeg', 'fail', 'not found on PATH (needed to decode, analyse and export audio)'));
  checks.push(s.ffprobe ? check('ffprobe', 'ffprobe', 'ok', s.ffprobe) : check('ffprobe', 'ffprobe', 'fail', 'not found on PATH (needed to read track metadata)'));

  checks.push(s.ytdlp ? check('ytdlp', 'yt-dlp', 'ok', s.ytdlp) : check('ytdlp', 'yt-dlp', 'fail', 'not installed yet (it is fetched into ./bin on the first download)'));

  const jobs = s.jobs || [], last = jobs[0];
  const active = jobs.filter((j) => !['ready', 'error'].includes(j.status)).length;
  checks.push(last?.status === 'error'
    ? check('downloads', 'Downloads', 'fail', `last download failed: ${String(last.error || 'unknown error').slice(0, 200)}`)
    : check('downloads', 'Downloads', 'ok', active ? `${plural(active, 'download')} running` : jobs.length ? 'last download finished' : 'no downloads this session'));

  const st = s.stems || {};
  const failed = Object.keys(st.failed || {}).length;
  checks.push(!st.enabled ? check('stems', 'Stem separation', 'off', 'switched off in config.json')
    : !st.available ? check('stems', 'Stem separation', 'fail', 'not set up: run `node dj.mjs stems setup` in the project folder (it installs the separator into .venv)')
    : failed ? check('stems', 'Stem separation', 'fail', `${plural(failed, 'track')} failed to separate · ${st.done}/${st.total} done`)
    : check('stems', 'Stem separation', 'ok', `${st.done}/${st.total} done${st.deviceInUse ? (st.deviceInUse === 'cpu' ? ' · on the CPU' : ` · on the GPU (${st.deviceInUse})`) : ''}${st.jobs?.length ? ` · ${st.jobs.length} running` : ''}${st.queued?.length ? ` · ${st.queued.length} queued` : ''}`));

  // the /visuals page: nobody watching is normal (the engine does not measure then); viewers with no frames is a fault
  const v = s.visuals;
  if (v) {
    const stalled = v.lastFrameAgoMs == null || v.lastFrameAgoMs > 3000;
    checks.push(!v.viewers ? check('visuals', 'Visuals frames', 'off', 'no /visuals page is open')
      : !s.engine?.connected ? check('visuals', 'Visuals frames', 'off', `${plural(v.viewers, 'viewer')} waiting for the audio engine`)
      : stalled ? check('visuals', 'Visuals frames', 'warn', `${plural(v.viewers, 'viewer')} but no frames from the engine tab`)
      : check('visuals', 'Visuals frames', 'ok', `${plural(v.viewers, 'viewer')} · ${v.fps} frames a second · mode ${v.mode}`));
    const a = v.audio || {};
    const quiet = a.lastChunkAgoMs == null || a.lastChunkAgoMs > 4000;
    const who = `${a.rtcListeners || 0} low-latency · ${a.listeners || 0} relay`;
    checks.push(!a.offered ? check('visualsAudio', 'Visuals audio', 'off', 'switched off (the visuals.audio setting)')
      : !a.listeners && a.rtcListeners ? check('visualsAudio', 'Visuals audio', s.engine?.connected ? 'ok' : 'off', `${who}${s.engine?.connected ? '' : ' · waiting for the audio engine'}`)
      : !a.listeners ? check('visualsAudio', 'Visuals audio', 'off', 'nobody is listening')
      : !s.engine?.connected ? check('visualsAudio', 'Visuals audio', 'off', `${plural(a.listeners, 'listener')} waiting for the audio engine`)
      : quiet ? check('visualsAudio', 'Visuals audio', 'warn', `${plural(a.listeners, 'listener')} but no audio from the engine tab`)
      : check('visualsAudio', 'Visuals audio', 'ok', `${who} · ${a.kbps} kbit/s through the relay`));
  }

  checks.push(s.freeGB == null ? check('disk', 'Disk space', 'fail', 'could not read free space')
    : s.freeGB < s.minFreeGB ? check('disk', 'Disk space', 'fail', `${s.freeGB} GB free, below the ${s.minFreeGB} GB the stem queue needs`)
    : check('disk', 'Disk space', 'ok', `${s.freeGB} GB free`));

  // ok: every required system works. level: the worst light on the board.
  const level = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  return { ok: level !== 'fail', level, checkedAt: Date.now(), checks };
}
