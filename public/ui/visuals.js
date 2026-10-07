// The /visuals page: a full-screen visualiser for a second screen, a projector or someone's phone. It only watches:
// it reads the server's visuals stream (ui/visuals/feed.js) and draws it with WebGPU (ui/visuals/stage.js).
//   /visuals?mode=auto|<name>   which mode to show (auto, the default, moves between them by itself)
//   /visuals?offset=<ms>        shift the picture against the sound, for a slow projector (also the ← → keys)
//   /visuals?quality=low|medium|high   how many elements the morphing modes draw (chosen for the GPU otherwise)
//   /visuals?audio=1            ask for the set's sound as well (one click starts it; the page is silent otherwise)
// With the sound on, the picture is locked to what this viewer hears; with it off it runs as close to live as it can.
// `dj visuals <mode|auto>` from the booth changes every open page.
import { Feed } from './visuals/feed.js';
import { Stage, webgpuProblem } from './visuals/stage.js';
import { Listener } from './visuals/audio.js';
import tunnel from './visuals/modes/tunnel.js';
import particles from './visuals/modes/particles.js';
import terrain from './visuals/modes/terrain.js';
import kaleido from './visuals/modes/kaleido.js';

// the names are also in lib/visuals.mjs (MODES), which is what `dj visuals <mode>` accepts
const MODES = [tunnel, particles, terrain, kaleido];
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const known = (m) => m === 'auto' || MODES.some((x) => x.name === m);

let wanted = known(params.get('mode')) ? params.get('mode') : null; // null: follow the booth
let stage = null, last = performance.now();

function notice(text) { $('#noticeText').textContent = text; $('#notice').hidden = !text; }

const feed = new Feed({
  offsetMs: Number(params.get('offset')) || 0,
  onHello: (h) => { if (!params.get('mode')) wanted = h.mode; offered(h.audio, h.lowLatency); },
  onAudio: (a) => offered(a.offered, a.lowLatency),
  onRtc: (msg) => listener.onSignal(msg),
  onMode: (m) => { if (known(m)) { wanted = m; drawOverlay(); } },
  onStatus: () => drawOverlay(),
});

// ---------------------------------------------------------------- sound (optional; the picture follows it while it plays)
const listener = new Listener({
  levelAt: (t) => feed.levelAt(t), liveTime: (now) => feed.liveTime(now), onState: () => drawOverlay(),
  signal: (msg) => fetch('/api/visuals/rtc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ viewer: feed.id, ...msg }) }).catch(() => {}),
});
feed.clock = () => listener.time();
let audioOffered = false;
function offered(on, lowLatency) {
  audioOffered = !!on && Listener.supported();
  if (!audioOffered) listener.stop();
  else listener.setLowLatency(lowLatency);
  $('#soundAsk').hidden = !(audioOffered && params.get('audio') === '1' && listener.state === 'off');
  drawOverlay();
}
function sound(on) {
  if (!audioOffered) return;
  if (on) listener.start(); else listener.stop();
  $('#soundAsk').hidden = true;
  drawOverlay();
}
$('#soundAsk').onclick = () => sound(true);
$('#soundBtn').onclick = () => sound(listener.state === 'off');
$('#muteBtn').onclick = () => { listener.setMuted(!listener.muted); drawOverlay(); };
$('#volume').oninput = (e) => listener.setVolume(Number(e.target.value));

// ---------------------------------------------------------------- which mode is on screen
const beats = (n) => (n * 60) / Math.max(60, Math.min(200, feed.sig.bpm || 120));
// Auto: a mode stays for at least MIN_BARS, then gives way at the next musical boundary: a new track on the deck
// that leads, the track going into or out of a breakdown, or (after LONG_BARS) the start of a phrase.
const MIN_BARS = 16, LONG_BARS = 32;
const auto = { since: 0, was: null, prevMode: null };
function boundary(sig) {
  const now = { track: sig.trackId, section: sig.section, phrase: Math.floor(sig.beat / 32) }, was = auto.was;
  auto.was = now;
  if (!was || sig.idle) return null;
  const bars = (performance.now() - auto.since) / 1000 / beats(4);
  if (bars < MIN_BARS) return null;
  if (now.track !== was.track) return { bars: 8 };
  if (now.section !== was.section && [now.section, was.section].includes('breakdown')) return { bars: 4 };
  if (bars >= LONG_BARS && now.phrase !== was.phrase) return { bars: 8 };
  return null;
}
function pickMode(sig) {
  if (!stage) return;
  const hit = boundary(sig);
  if (stage.changing) return;
  let target = wanted && wanted !== 'auto' ? wanted : stage.mode, bars = 4;
  if (!target) target = MODES[Math.floor(Math.random() * MODES.length)].name;
  else if (hit && (!wanted || wanted === 'auto')) {
    const others = MODES.map((m) => m.name).filter((n) => n !== stage.mode && n !== auto.prevMode);
    target = others[Math.floor(Math.random() * others.length)] || stage.mode; bars = hit.bars;
  }
  if (target !== stage.mode) { auto.prevMode = stage.mode; auto.since = performance.now(); stage.show(target, beats(bars * 4)); drawOverlay(); }
}

// ---------------------------------------------------------------- renderer (re-made if the GPU device is lost)
async function boot() {
  const problem = await webgpuProblem();
  if (problem) return notice(`${problem} This page needs a WebGPU-capable browser, such as a current Chrome or Edge.`);
  const canvas = document.createElement('canvas');
  $('#stage').replaceChildren(canvas);
  const s = new Stage(canvas, MODES, {
    quality: params.get('quality'),
    onTier: () => drawOverlay(),
    onLost: (why) => {
      console.warn('GPU device lost:', why);
      if (stage === s) { stage = null; s.dispose(); setTimeout(boot, 500); }
    },
  });
  try { await s.init(); } catch (e) { s.dispose(); return notice(`WebGPU could not start (${e.message}). This page needs a WebGPU-capable browser, such as a current Chrome or Edge.`); }
  notice('');
  stage = s;
  last = performance.now();
  s.renderer.setAnimationLoop(frame);
}

function frame() {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sig = feed.update(now, dt);
  if (!stage) return;
  pickMode(sig);
  stage.frame(sig, dt);
  fps.n++;
}
addEventListener('resize', () => stage?.resize());
const fps = { n: 0, value: 0 };
setInterval(() => { fps.value = fps.n; fps.n = 0; }, 1000);

// ---------------------------------------------------------------- overlay: shown while the pointer moves, hidden at rest
const overlay = $('#overlay');
let restTimer = null;
function wake() {
  overlay.classList.remove('hide'); document.body.classList.remove('resting');
  clearTimeout(restTimer);
  restTimer = setTimeout(() => { if (!overlay.matches(':hover, :focus-within')) { overlay.classList.add('hide'); document.body.classList.add('resting'); } }, 3000);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown']) addEventListener(ev, wake);

function setWanted(m) { wanted = m; drawOverlay(); wake(); }
function drawOverlay() {
  const box = $('#modes');
  if (!box.children.length) {
    for (const m of [{ name: 'auto', label: 'Auto' }, ...MODES]) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.mode = m.name; b.textContent = m.label;
      b.onclick = () => setWanted(m.name);
      box.append(b);
    }
  }
  for (const b of box.children) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === (wanted || 'auto')));
    b.classList.toggle('showing', b.dataset.mode === stage?.mode);
  }
  $('#status').textContent = !feed.connected ? 'server unreachable, retrying…' : performance.now() - feed.lastArrival > 3000 ? 'no signal from the DJ page (it must be open and started)' : feed.sig.idle ? 'waiting for music' : `${feed.sig.live ? 'deck ' + feed.sig.live + ' · ' : ''}${Math.round(feed.sig.bpm)} BPM`;
  const on = listener.state !== 'off', newest = feed.frames[feed.frames.length - 1], heard = listener.state === 'playing' ? listener.heard : null;
  $('#sound').hidden = !audioOffered;
  $('#soundBtn').textContent = on ? 'Sound on' : 'Sound off'; $('#soundBtn').setAttribute('aria-pressed', String(on));
  $('#soundCtl').hidden = !on;
  $('#muteBtn').setAttribute('aria-pressed', String(listener.muted));
  // which way the sound is coming, and how far behind the decks it is
  const path = listener.path === 'direct' ? 'low latency' : 'through the server', lag = heard != null && newest ? Math.max(0, newest.t - heard) : null;
  $('#soundState').textContent = !on ? '' : listener.state === 'playing' ? `${path}${lag != null ? ` · ${lag < 1 ? `${Math.round(lag * 1000)} ms` : `${lag.toFixed(1)} s`} behind the decks, ${listener.locked ? 'picture in step' : 'lining the picture up…'}` : ''}`
    : listener.state === 'connecting' ? 'connecting…' : 'sound dropped, joining again… (picture runs live)';
  $('#quality').textContent = stage?.tier ? `quality ${stage.tier}` : '';
  $('#nudge').textContent = feed.offsetMs ? `picture ${feed.offsetMs > 0 ? '+' : ''}${feed.offsetMs} ms` : '';
}
setInterval(drawOverlay, 1000);

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const n = Number(e.key);
  if (e.key === 'a' || e.key === 'A' || e.key === '0') setWanted('auto');
  else if (n >= 1 && n <= MODES.length) setWanted(MODES[n - 1].name);
  else if (e.key === 's' || e.key === 'S') sound(listener.state === 'off');
  else if (e.key === 'm' || e.key === 'M') { listener.setMuted(!listener.muted); drawOverlay(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { feed.offsetMs += e.key === 'ArrowRight' ? 10 : -10; drawOverlay(); }
  else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
});

// for looking at the page from the outside (tests, the console)
window.visuals = { feed, listener, get stage() { return stage; }, fps, auto, modes: MODES.map((m) => m.name) };
drawOverlay();
boot();
