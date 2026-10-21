// Claudel's page: code that loops, as on strudel.cc. Ctrl+Enter plays the code, and code played while the loop
// runs comes in on the next bar line; an error leaves the loop playing what it played. The language is
// lib/pattern.mjs, the loop lib/live.mjs, the sound the kit and synth voices of engine.js (a Rig with one kit and a
// strip per synth sound). The events are scheduled ahead on the audio clock, so typing never moves the beat.
import { PatternError, parseBlocks } from '/lib/pattern.mjs';
import { Loop, codeToHash, hashToCode, heardBlocks, nextBar } from '/lib/live.mjs';
import { PRESET_IDS } from '/lib/presets.mjs';
import { EXAMPLES } from '/lib/examples.mjs';
import { VOICE_IDS } from '/lib/kit.mjs';
import { Rig, stepSeconds } from './engine.js';
import { mountAppsMenu } from './apps-menu.js';

const $ = (id) => document.getElementById(id);
mountAppsMenu($('appsBtn'), 'live');
const LOOKAHEAD = 0.12;           // seconds of events scheduled ahead of the clock
const LOOKAHEAD_HIDDEN = 1.5;     // a hidden tab's timers run as seldom as once a second
const TICK_MS = 25;
const STORE = 'claudel';          // the code and the tempo, kept between visits
const SYNTH = 'keys';             // the sound of a note that names none
const COLORS = ['#ff7a45', '#36d6e7', '#9be564', '#c792ea', '#f2cc60', '#ff5c8a'];

// the instruments, as the engine's Rig has them: one kit, and a strip for each synth sound
const instruments = (bpm) => ({
  bpm, master: 0.8,
  tracks: [
    { id: 'kit', kind: 'drums', vol: 0.85, pan: 0, reverb: 0.06, delay: 0 },
    ...PRESET_IDS.map((id) => ({ id, kind: 'synth', preset: id, vol: 0.75, pan: 0, reverb: id === 'pad' ? 0.3 : 0.12, delay: id === 'pluck' ? 0.2 : 0 })),
  ],
});

const state = { bpm: 120, played: '', blocks: [], muted: new Set(), soloed: new Set(), error: null };
const loop = new Loop();
let ctx = null, rig = null, analyser = null, timer = null;
let anchor = null;      // { time, bar }: when on the audio clock a bar began; null when stopped
let scheduled = 0;      // how far the loop is scheduled, in bars
let sounding = [];      // what is scheduled, for the lights: { time, end, locs, code }
let version = 0;        // goes up when what plays changes, so the note strip is drawn again

const playing = () => anchor !== null;
const heard = () => ({ muted: state.muted, soloed: state.soloed });
const barSeconds = () => 240 / state.bpm;
const barAt = (t) => anchor.bar + (t - anchor.time) / barSeconds();
const timeOf = (bar) => anchor.time + (bar - anchor.bar) * barSeconds();

function say(text, bad = false) { $('status').textContent = text; $('status').classList.toggle('bad', bad); }

// ---- playing

function play(ev, time) {
  if (ev.kind === 'drum') rig.play({ track: 'kit', kind: 'drums', voice: ev.sound, vel: ev.vel }, time);
  else if (ev.kind === 'synth' || ev.pitch !== null) {
    const preset = ev.kind === 'synth' ? ev.sound : SYNTH;
    rig.play({ track: preset, kind: 'synth', preset, pitch: ev.pitch ?? 48, len: ev.len * 16, vel: ev.vel }, time, stepSeconds(state.bpm));
  }
}

function tick() {
  const now = ctx.currentTime;
  const until = barAt(now + (document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD));
  if (until <= scheduled) return;
  for (const ev of loop.events(scheduled, until, heard())) {
    const time = Math.max(now, timeOf(ev.start));
    play(ev, time);
    sounding.push({ time, end: time + Math.max(0.1, ev.len * barSeconds()), locs: ev.locs, code: ev.source.code });
  }
  if (loop.next && until >= loop.next.at) version++;
  loop.advance(until);
  scheduled = until;
  sounding = sounding.filter((s) => s.end > now);
}

function start(blocks) {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') ctx.resume();
  rig = new Rig(ctx, instruments(state.bpm));
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  rig.master.connect(analyser);
  loop.set(blocks);
  anchor = { time: ctx.currentTime + 0.08, bar: 0 };
  scheduled = 0;
  timer = setInterval(tick, TICK_MS);
  tick();
  setPlaying();
}

function stop() {
  if (!playing()) return;
  clearInterval(timer);
  rig.release();
  rig = null; analyser = null; anchor = null; sounding = [];
  loop.next = null;
  version++;
  setPlaying();
  paint();
  say('stopped');
}

function setPlaying() {
  $('play').setAttribute('aria-pressed', playing());
  $('play').textContent = playing() ? 'Stop' : 'Play';
}

// Ctrl+Enter: the code in the box, from the next bar (at once when nothing plays). An error changes nothing that
// plays: the loop goes on with the code it has.
function run() {
  const code = $('code').value;
  let blocks;
  try {
    blocks = parseBlocks(code).map((b) => ({ ...b, code }));
  } catch (err) {
    state.error = err instanceof PatternError ? err : { line: 1, col: 1, message: err.message };
    say(state.error.message, true);
    paint();
    return;
  }
  state.error = null;
  state.blocks = blocks;
  state.played = code;
  version++;
  keep(code);
  if (!playing()) { start(blocks); say('playing'); }
  else { const at = nextBar(scheduled); loop.set(blocks, at); say(`from bar ${at + 1}`); }
  showBlocks();
  paint();
}

function setBpm(value) {
  const bpm = Math.round(Math.min(240, Math.max(40, Number(value) || 120)));
  if (playing()) { const now = ctx.currentTime; anchor = { time: now, bar: barAt(now) }; }   // the bar goes on from here
  state.bpm = bpm;
  $('bpm').value = bpm;
  rig?.sync(instruments(bpm));
  keep($('code').value);
}

// ---- the code kept, and as a link

function keep(code) {
  try { localStorage.setItem(STORE, JSON.stringify({ code, bpm: state.bpm })); } catch {}
  history.replaceState(null, '', codeToHash(code, state.bpm));
}

function load() {
  const linked = hashToCode(location.hash);
  if (linked) return { code: linked.code, bpm: linked.bpm ?? 120 };
  try { const kept = JSON.parse(localStorage.getItem(STORE)); if (kept?.code) return kept; } catch {}
  return { code: EXAMPLES[0].code, bpm: EXAMPLES[0].bpm };
}

// ---- the blocks: mute and solo

function showBlocks() {
  const box = $('blocks');
  box.textContent = '';
  const on = new Set(heardBlocks(state.blocks, heard()).map((b) => b.name));
  state.blocks.forEach((b, i) => {
    const chip = box.appendChild(document.createElement('span'));
    chip.className = `chip${on.has(b.name) ? '' : ' off'}`;
    chip.style.setProperty('--c', COLORS[i % COLORS.length]);
    chip.title = b.muted ? `${b.name}: muted in the code (_)` : `${b.name}, line ${b.line}`;
    chip.innerHTML = '<i class="dot"></i><span class="chip-name"></span>';
    chip.querySelector('.chip-name').textContent = b.name;
    for (const [what, set, label] of [['M', state.muted, 'Mute'], ['S', state.soloed, 'Solo']]) {
      const btn = chip.appendChild(document.createElement('button'));
      btn.textContent = what;
      btn.title = `${label} ${b.name}`;
      btn.setAttribute('aria-pressed', set.has(b.name));
      btn.addEventListener('click', () => { if (set.has(b.name)) set.delete(b.name); else set.add(b.name); version++; showBlocks(); });
    }
  });
}

// ---- the editor: the text box's letters are see-through; under them a painted copy, with colours, the words that
// sound lit up, and the line of an error

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let painted = '';

function paint(lit = []) {
  const code = $('code').value;
  const cls = Array.from(code, () => '');
  const mark = (from, to, c) => { for (let i = from; i < to && i < cls.length; i++) cls[i] = c; };
  for (const m of code.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"[^"\n]*"|'[^'\n]*'|`[^`]*`|\b\d+(\.\d+)?\b|\b[A-Za-z_]\w*(?=\s*\()|^\s*_?\$?\w*:/gm)) {
    const t = m[0];
    const c = t.startsWith('/') ? 'k-note' : /^["'`]/.test(t) ? 'k-str' : /^\d/.test(t) ? 'k-num' : t.trim().endsWith(':') ? 'k-label' : 'k-fn';
    mark(m.index, m.index + t.length, c);
  }
  if (code === state.played) for (const [from, to] of lit) mark(from, to, 'k-on');
  const errLine = state.error?.line;
  let html = '', at = 0;
  code.split('\n').forEach((line, n) => {
    let row = '';
    for (let i = 0; i < line.length;) {
      let j = i;
      while (j < line.length && cls[at + j] === cls[at + i]) j++;
      const text = escape(line.slice(i, j));
      row += cls[at + i] ? `<span class="${cls[at + i]}">${text}</span>` : text;
      i = j;
    }
    html += `<span class="ln${errLine === n + 1 ? ' k-err' : ''}">${row || ' '}</span>\n`;
    at += line.length + 1;
  });
  if (html !== painted) { $('paint').innerHTML = html; painted = html; }
}

// ---- the strip of notes and the scope, drawn every frame

function fit(canvas) {
  const dpr = devicePixelRatio || 1, w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return canvas.getContext('2d');
}

let strip = { key: '', rows: [], events: [] };
function drawRoll(bar) {
  const canvas = $('roll'), g = fit(canvas), { width: w, height: h } = canvas;
  const first = Math.max(0, Math.floor(bar));
  const key = `${first}|${version}`;
  if (strip.key !== key) {
    const events = state.blocks.length ? loop.events(first, first + 2, heard()) : [];
    const row = (e) => (e.kind === 'drum' ? `d${VOICE_IDS.indexOf(e.sound)}` : `p${1000 - (e.pitch ?? 48)}`);
    strip = { key, events, rows: [...new Set(events.map(row))].sort(), row };
  }
  g.clearRect(0, 0, w, h);
  const rowH = Math.min(14 * devicePixelRatio, (h - 8) / Math.max(1, strip.rows.length));
  g.fillStyle = '#262631';
  g.fillRect(w / 2, 0, 1, h);                                       // the bar line between the two bars
  const names = state.blocks.map((b) => b.name);
  for (const e of strip.events) {
    const x = ((e.start - first) / 2) * w, y = 4 + strip.rows.indexOf(strip.row(e)) * rowH;
    g.fillStyle = COLORS[Math.max(0, names.indexOf(e.block)) % COLORS.length];
    g.globalAlpha = 0.35 + 0.65 * e.vel;
    g.fillRect(x + 1, y + 1, Math.max(2, (e.len / 2) * w - 2), Math.max(2, rowH - 2));
  }
  g.globalAlpha = 1;
  if (playing()) { g.fillStyle = '#ecebf2'; g.fillRect(((bar - first) / 2) * w, 0, 2, h); }
}

const wave = new Float32Array(2048);
function drawScope() {
  const canvas = $('scope'), g = fit(canvas), { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(wave);
  g.strokeStyle = '#36d6e7';
  g.lineWidth = 1.5 * devicePixelRatio;
  g.beginPath();
  for (let i = 0; i < wave.length; i += 2) {
    const x = (i / wave.length) * w, y = h / 2 - wave[i] * h * 0.45;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}

let litKey = '';
function frame() {
  const now = ctx?.currentTime ?? 0;
  const bar = playing() ? barAt(now) : 0;
  $('bar').textContent = playing() && bar >= 0 ? `${Math.floor(bar) + 1}` : '–';
  const lit = playing() ? sounding.filter((s) => s.time <= now && now < s.end && s.code === state.played).flatMap((s) => s.locs) : [];
  const key = lit.map((l) => l.join(':')).join(',');
  if (key !== litKey) { litKey = key; paint(lit); }
  drawRoll(bar);
  drawScope();
  requestAnimationFrame(frame);
}

// ---- keys and buttons

const code = $('code');
code.addEventListener('input', () => paint());
code.addEventListener('scroll', () => { $('paint').scrollTop = code.scrollTop; $('paint').scrollLeft = code.scrollLeft; });
addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); run(); }
  else if (mod && e.key === '.') { e.preventDefault(); stop(); }
  else if (e.key === 'Tab' && e.target === code && !e.shiftKey) {   // two spaces, not the next control
    e.preventDefault();
    code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
    paint();
  }
});
$('play').addEventListener('click', () => (playing() ? stop() : run()));
$('bpm').addEventListener('change', (e) => setBpm(e.target.value));
// the Examples menu: an example's code and tempo, played (from the next bar when something plays). Code of your own
// that is not one of the examples is asked about first, as it would be lost.
const examples = $('examples');
for (const ex of EXAMPLES) examples.add(new Option(`${ex.name} · ${ex.bpm}`, ex.id));
examples.addEventListener('change', () => {
  const ex = EXAMPLES.find((e) => e.id === examples.value);
  examples.value = '';
  if (!ex || ex.code === code.value) return;
  const yours = code.value.trim() && !EXAMPLES.some((e) => e.code === code.value);
  if (yours && !confirm(`Replace your code with the ${ex.name} example?`)) return;
  code.value = ex.code;
  setBpm(ex.bpm);
  run();
  code.focus();
});

$('share').addEventListener('click', async () => {
  history.replaceState(null, '', codeToHash(code.value, state.bpm));
  try { await navigator.clipboard.writeText(location.href); say('link copied: it opens this code'); } catch { say('copy the address: it opens this code'); }
});

// a link pasted into this tab: only the # changes, so the page is not loaded again
addEventListener('hashchange', () => {
  const linked = hashToCode(location.hash);
  if (!linked || linked.code === code.value) return;
  code.value = linked.code;
  if (linked.bpm) setBpm(linked.bpm);
  paint();
  say('Ctrl+Enter plays the code of the link');
});

const first = load();
code.value = first.code;
state.bpm = first.bpm;
$('bpm').value = first.bpm;
paint();
say('Ctrl+Enter plays');
requestAnimationFrame(frame);
