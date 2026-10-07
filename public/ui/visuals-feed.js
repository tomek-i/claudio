// Engine side of the /visuals page: while someone is watching, a tap on the master output (worklets/visuals-tap.js)
// measures the sound and this module posts its frames to the server, which fans them out (lib/visuals.mjs).
// With no viewers nothing is connected and nothing is sent. For viewers who turned the sound on, the master output is
// also encoded (Opus in WebM) and posted as a stream, by a recorder of its own: it shares nothing with the session
// recorder in link.js, so neither can interrupt the other. It runs only while someone listens. The server says how
// many are watching and listening in `hello` and in `visuals` events (wired in link.js).
import { clientId, mixer, isEngine } from './state.js';

let viewers = 0, listeners = 0, tap = null, starting = false, loaded = false;
let queue = [], busy = false;

// one request at a time keeps frames in order; whatever piled up meanwhile goes in the next one
async function flush() {
  if (busy || !queue.length) return;
  busy = true;
  const frames = queue; queue = [];
  try { await fetch('/api/visuals/frames', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: clientId, frames }) }); } catch { /* server away: these frames are gone */ }
  busy = false;
  flush();
}

// where each playing deck is at audio time t, in beats since its first beat, and how audible it is
function decksAt(t) {
  const d = {}, behind = mixer.ctx.currentTime - t;
  for (const [n, x] of Object.entries(mixer.decks)) {
    if (!x.track || !x.playing || !x.track.bpm) continue;
    const pos = x.position() - behind * x.rate;
    d[n] = [+((pos - (x.track.firstBeat || 0)) / (60 / x.track.bpm)).toFixed(3), +x.audible().toFixed(3)];
  }
  return d;
}

async function start() {
  if (tap || starting) return;
  starting = true;
  try {
    if (!loaded) { await mixer.ctx.audioWorklet.addModule(new URL('../worklets/visuals-tap.js', import.meta.url)); loaded = true; }
    const node = new AudioWorkletNode(mixer.ctx, 'visuals-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
    node.port.onmessage = (e) => {
      if (queue.length > 40) queue.splice(0, queue.length - 40);
      queue.push({ ...e.data, d: decksAt(e.data.t) });
      flush();
    };
    mixer.out.connect(node);
    tap = node;
  } catch (err) { console.warn('visuals tap failed to start', err); }
  starting = false;
  sync(); // the last viewer may have left while the module loaded
}

function stop() {
  if (!tap) return;
  try { mixer.out.disconnect(tap); } catch { /* already gone */ }
  tap.port.postMessage('stop');
  tap.port.onmessage = null;
  tap = null; queue = [];
}

// ---- audio for listeners: chunks go up one request at a time, in order (the server needs them in order)
const SLICE_MS = 250;
let cast = null;
function startCast() {
  if (cast) return;
  const dest = mixer.ctx.createMediaStreamDestination();
  mixer.out.connect(dest);
  const mr = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
  const c = cast = { mr, dest, id: Math.random().toString(36).slice(2, 10), t0: null, parts: [], busy: false };
  const send = async () => {
    if (c.busy || !c.parts.length || c.t0 == null) return;
    c.busy = true;
    const body = new Blob(c.parts); c.parts = [];
    try { await fetch(`/api/visuals/audio?client=${clientId}&stream=${c.id}&t0=${c.t0.toFixed(4)}`, { method: 'POST', body }); } catch { /* server away */ }
    c.busy = false;
    if (cast === c) send();
  };
  // t0: where the recording's own timeline starts on the audio clock, which is what viewers sync the picture with
  mr.onstart = () => { c.t0 = mixer.ctx.currentTime; send(); };
  mr.ondataavailable = (ev) => { if (ev.data.size && cast === c) { c.parts.push(ev.data); send(); } };
  mr.start(SLICE_MS);
}
function stopCast() {
  if (!cast) return;
  const c = cast; cast = null;
  try { c.mr.stop(); } catch { /* not started */ }
  try { mixer.out.disconnect(c.dest); } catch { /* already gone */ }
}

function sync() {
  const engine = isEngine && !!mixer?.out;
  if (engine && viewers > 0) start(); else stop();
  if (engine && listeners > 0) startCast(); else stopCast();
}

export function visualsAudience(a) { viewers = Number(a?.viewers) || 0; listeners = Number(a?.listeners) || 0; sync(); }
setInterval(sync, 1000); // this tab becoming, or ceasing to be, the engine
