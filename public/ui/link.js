import { $, post } from './util.js';
import { clientId, mixer, isEngine, setEngine } from './state.js';
import { handlers } from './commands.js';
import { loadLibrary, refreshHistory, renderJob, renderStarter } from './crate.js';
import { addFeed } from './booth.js';
import { receiveUi } from './prefs.js';

// ------------------------------------------------------------------ server link
const es = new EventSource(`/api/events?client=${clientId}`);
es.addEventListener('hello', (e) => {
  const h = JSON.parse(e.data);
  receiveUi(h.ui);
  $('#feed').innerHTML = '';
  h.log.forEach(addFeed);
  $('#lbFeed').classList.remove('unread'); // the replayed log is not news
  h.jobs.forEach(renderJob);
  if (h.recording && isEngine) startRecording();
  // server restarted while we were the engine: quietly re-claim
  if (isEngine && h.engineId !== clientId) { post('/api/engine/claim', { client: clientId }); setStatus('on', 'engine live'); return; }
  if (h.engineId && h.engineId !== clientId) $('#overlayMsg').innerHTML = 'Another tab is currently the sound system.<br>Start here to take over.';
});
es.addEventListener('log', (e) => {
  const entry = JSON.parse(e.data);
  addFeed(entry);
  if (entry.kind === 'system' && entry.text.startsWith('▶')) refreshHistory();
});
es.addEventListener('job', (e) => renderJob(JSON.parse(e.data)));
es.addEventListener('starter', (e) => renderStarter(JSON.parse(e.data)));
es.addEventListener('ui', (e) => receiveUi(JSON.parse(e.data)));
let libTimer;
es.addEventListener('library', () => { clearTimeout(libTimer); libTimer = setTimeout(loadLibrary, 400); });
es.addEventListener('engine', (e) => {
  const { id } = JSON.parse(e.data);
  if (id !== clientId && isEngine) {
    setEngine(false);
    for (const d of Object.values(mixer.decks)) d.stop();
    mixer.ctx.suspend();
    $('#overlayMsg').innerHTML = 'The engine moved to another tab.<br>Start here to take it back.';
    $('#startOverlay').classList.remove('hide');
  }
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
let status = { cls: '', txt: 'engine offline' }, issues = [];
function drawStatus() {
  const el = $('#engineStatus');
  el.className = `status ${status.cls}${issues.some((c) => c.status === 'fail') ? ' bad' : issues.length ? ' limited' : ''}`;
  $('.txt', el).textContent = `${status.txt}${issues.length ? ` · ${issues.length} issue${issues.length === 1 ? '' : 's'}` : ''}`;
  el.title = issues.length ? `${issues.map((c) => `${c.name}: ${c.detail}`).join('\n')}\nClick for the health page` : 'All systems ok · click for the health page';
}
export async function refreshHealth() {
  try {
    const h = await (await fetch('/api/health')).json();
    // the engine check is this tab's own state, which the text already says
    issues = h.checks.filter((c) => ['fail', 'warn'].includes(c.status) && c.id !== 'engine');
  } catch { issues = []; /* server unreachable: setStatus says so */ }
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
