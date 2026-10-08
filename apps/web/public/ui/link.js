import { $, post } from './util.js';
import { clientId, mixer, isEngine, setEngine, setTakeOver } from './state.js';
import { handlers } from './commands.js';
import { loadLibrary, refreshHistory, renderJob, renderStarter } from './crate.js';
import { addFeed } from './booth.js';
import { receiveUi } from './prefs.js';
import { visualsAudience, visualsSignal } from './visuals-feed.js';

// ------------------------------------------------------------------ server link
const es = new EventSource(`/api/events?client=${clientId}`);
es.addEventListener('hello', (e) => {
  const h = JSON.parse(e.data);
  receiveUi(h.ui);
  showAuto(h.autoDJ);
  $('#feed').innerHTML = '';
  h.log.forEach(addFeed);
  $('#lbFeed').classList.remove('unread'); $('#boothTab').classList.remove('unread'); // the replayed log is not news
  h.jobs.forEach(renderJob);
  visualsAudience(h.visuals);
  if (h.recording && isEngine) startRecording();
  // server restarted while we were the engine: quietly re-claim (unless another page got there first)
  if (isEngine && h.engineId !== clientId) {
    setStatus('on', 'engine live');
    post('/api/engine/claim', { client: clientId }).then((r) => { if (r.held) lostEngine('Another window became the sound system.<br>Start here to take it back.'); });
    return;
  }
  if (h.engineId && h.engineId !== clientId) $('#overlayMsg').innerHTML = 'Another window is currently the sound system.<br>Start here to take over.';
});
// This page was the sound system and no longer is: it goes quiet and offers to take the engine back. The message says
// what a click does, so that click needs no second question.
function lostEngine(html) {
  setEngine(false);
  for (const d of Object.values(mixer.decks)) d.stop();
  mixer.ctx.suspend();
  setTakeOver(true);
  setStatus('', 'engine offline');
  document.documentElement.dataset.engine = '';
  $('#overlayMsg').innerHTML = html;
  $('#startBtn').textContent = 'Take it back';
  $('#startOverlay').classList.remove('hide');
}
es.addEventListener('log', (e) => {
  const entry = JSON.parse(e.data);
  addFeed(entry);
  if (entry.kind === 'system' && entry.text.startsWith('▶')) refreshHistory();
});
es.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
es.addEventListener('starter', (e) => renderStarter(JSON.parse(e.data)));
es.addEventListener('ui', (e) => receiveUi(JSON.parse(e.data)));
es.addEventListener('visuals', (e) => visualsAudience(JSON.parse(e.data)));
es.addEventListener('visualsRtc', (e) => visualsSignal(JSON.parse(e.data)));
// ---- the AUTO DJ switch in the header. The server says what it is (`hello`, then `autodj` whenever it changes, also
// from `dj autodj on|off`); a click switches it now and saves it as the autoDJ.enabled setting.
const autoBtn = $('#autoDjBtn');
function showAuto(on) {
  autoBtn.setAttribute('aria-pressed', String(!!on));
  $('b', autoBtn).textContent = on ? 'ON' : 'OFF';
  autoBtn.title = on ? 'Auto-DJ is on: Claude cues and mixes in the next track by itself when the music is about to run out. Click to switch it off.'
    : 'Auto-DJ is off: nothing is cued or mixed unless you or Claude ask for it. Click to switch it on.';
}
es.addEventListener('autodj', (e) => showAuto(JSON.parse(e.data).enabled));
autoBtn.onclick = async () => {
  const enabled = autoBtn.getAttribute('aria-pressed') !== 'true';
  showAuto(enabled);
  try { await post('/api/autodj', { enabled, save: true }); }
  catch { showAuto(!enabled); }
};
let libTimer;
es.addEventListener('library', () => { clearTimeout(libTimer); libTimer = setTimeout(loadLibrary, 400); });
es.addEventListener('engine', (e) => {
  const { id } = JSON.parse(e.data);
  if (id !== clientId && isEngine) lostEngine('Another window took over as the sound system.<br>Start here to take it back.');
});
es.addEventListener('cmd', async (e) => {
  const { id, cmd, args } = JSON.parse(e.data);
  if (!isEngine) return;
  try {
    const h = handlers[cmd];
    if (!h) throw new Error(`unknown command ${cmd}`);
    const result = await h(args || {});
    await post('/api/ack', { id, ok: true, result: result ?? null, client: clientId, state: mixer.state() });
  } catch (err) {
    await post('/api/ack', { id, ok: false, error: err.message, client: clientId, state: mixer.state() });
  }
  pushState();
});
es.onerror = () => setStatus('warn', 'server unreachable');
es.addEventListener('record', (e) => { const { on } = JSON.parse(e.data); if (isEngine) { if (on) startRecording(); else stopRecording(); } });

// ---- flight recorder (engine side): telemetry every 200 ms + the master output as audio
let rec = null, telem = [], telemTimer = null, recSeq = 0;
function sampleTelemetry() {
  const buf = new Float32Array(mixer.analyser.fftSize);
  mixer.analyser.getFloatTimeDomainData(buf);
  let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
  const d = (x) => ({ p: +x.position().toFixed(3), on: x.playing ? 1 : 0, a: x.audible(), r: +x.rate.toFixed(4), id: x.track ? x.track.id : null, loop: x.loop ? x.loop.beats : 0 });
  const s = { t: Date.now(), pn: +performance.now().toFixed(1), ct: +mixer.ctx.currentTime.toFixed(4), lvl: +(20 * Math.log10(pk + 1e-6)).toFixed(1),
    xf: +mixer.xfader.value().toFixed(3), mv: +mixer.master.value().toFixed(2), st: mixer.ctx.state, hid: document.hidden ? 1 : 0,
    tr: mixer.transition ? mixer.transition.style : null, A: d(mixer.decks.A), B: d(mixer.decks.B) };
  for (const n of ['C', 'D']) if (mixer.decks[n].track) s[n] = d(mixer.decks[n]);
  telem.push(s);
}
function startRecording() {
  if (!mixer || rec) return;
  const dest = mixer.ctx.createMediaStreamDestination();
  mixer.out.connect(dest);
  const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
  mr.ondataavailable = (ev) => { if (ev.data.size) fetch('/api/record/chunk?seq=' + (recSeq++) + '&t=' + Date.now(), { method: 'POST', body: ev.data }).catch(() => {}); };
  mr.start(1000);
  rec = { mr, dest };
  telemTimer = setInterval(() => {
    sampleTelemetry();
    if (telem.length >= 5) { const samples = telem; telem = []; post('/api/telemetry', { samples }).catch(() => {}); }
  }, 200);
}
function stopRecording() {
  if (!rec) return;
  clearInterval(telemTimer);
  if (telem.length) { post('/api/telemetry', { samples: telem }).catch(() => {}); telem = []; }
  rec.mr.stop();
  try { mixer.out.disconnect(rec.dest); } catch { /* ignore */ }
  rec = null;
}

export function pushState() {
  if (!isEngine || !mixer?.xfader) return;
  post('/api/state', { client: clientId, state: mixer.state() }).catch(() => {});
}
setInterval(pushState, 400);

// audio-clock watchdog: if the AudioContext stops advancing, the OS/browser starved the audio thread
let wdLast = null;
setInterval(() => {
  if (!mixer || !isEngine) return;
  const now = { wall: performance.now(), ct: mixer.ctx.currentTime };
  if (wdLast) {
    const wallDt = (now.wall - wdLast.wall) / 1000, ctDt = now.ct - wdLast.ct;
    if (wallDt - ctDt > 0.3) post('/api/say', { text: `⚠ Audio engine stalled for ${(wallDt - ctDt).toFixed(1)}s (browser/OS starved the audio thread). state=${mixer.ctx.state}, hidden=${document.hidden}` }).catch(() => {});
  }
  wdLast = now;
}, 250);
// ---- the status light in the header: this tab's engine state, turned amber by a fault in an optional system
// (stems, downloads, …) and red by one in a required system (GET /api/health).
// Clicking it opens /health. The checks are asked for when the engine state changes, when the tab is looked at
// again and once a minute while it is visible.
const HEALTH_MS = 60000;
let status = { cls: '', txt: 'engine offline' }, issues = [], unknown = false; // unknown: the health checks could not be fetched
function drawStatus() {
  const el = $('#engineStatus');
  el.className = `status ${status.cls}${issues.some((c) => c.status === 'fail') ? ' bad' : issues.length ? ' limited' : ''}`;
  $('.txt', el).textContent = `${status.txt}${issues.length ? ` · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}`;
  el.title = issues.length ? `${issues.map((c) => `${c.name}: ${c.detail}`).join('\n')}\nClick for the health page`
    : unknown ? 'The server did not answer, so the state of the rig is not known · click for the health page' : 'All systems ok · click for the health page';
}
export async function refreshHealth() {
  try {
    const h = await (await fetch('/api/health')).json();
    // the engine check is this tab's own state, which the text already says
    issues = h.checks.filter((c) => ['fail', 'warn'].includes(c.status) && c.id !== 'engine');
    unknown = false;
  } catch { issues = []; unknown = true; /* server unreachable: setStatus says so, and the tooltip must not say all is well */ }
  drawStatus();
}
export function setStatus(cls, txt) {
  status = { cls, txt };
  drawStatus();
  refreshHealth();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHealth(); });
setInterval(() => { if (!document.hidden) refreshHealth(); }, HEALTH_MS);
refreshHealth();
