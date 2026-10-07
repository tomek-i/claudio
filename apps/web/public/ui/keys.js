import { $, $$, esc } from './util.js';
import { pointer, mixer, ui } from './state.js';
import { addFeed } from './booth.js';
import { actionFor, hint, onBindings, toggleShortcuts } from './bindings.js';
import { toggleLower, showTab, dockTab } from './lower.js';

// ------------------------------------------------------------------ chop keyboard
// A pad becomes an instrument: grab a beat of whatever is playing (or just its vocal), play it from the computer
// keyboard at any pitch (by default the A row is the white keys and the row above it the black keys, Z / X shift the
// octave; all of it can be rebound), quantised or free, and record a loop of it.
export const KB = { pad: 7, octave: 0, quant: 'off', hold: true, gain: 1, grabBeats: 1, grabStem: 'vocals', scale: 'on', active: new Map(),
  loop: { bars: 4, events: [], rec: false, on: false, t0: 0, secPerBeat: 60 / 128, timer: null, done: new Set() } };
const WHITES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17], NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const kbState = () => ({ pad: KB.pad, octave: KB.octave, quant: KB.quant, hold: KB.hold, loop: { on: KB.loop.on, rec: KB.loop.rec, bars: KB.loop.bars, events: KB.loop.events.length } });
export function kbTime() {
  const now = mixer.ctx.currentTime;
  const live = mixer.liveDeck();
  if (KB.quant === 'off' || !live?.track) return now + 0.005;
  if (KB.quant === 'beat') return mixer.quantTime('beat');
  const nb = mixer.quantTime('beat'), step = live.beatLen / live.rate / 4; // 1/16 grid
  let t = nb; while (t - step > now + 0.005) t -= step;
  return t;
}
const loopBeats = () => KB.loop.bars * 4;
function kbLoopBeat(t) { const L = KB.loop, lb = loopBeats(); return ((((t - L.t0) / L.secPerBeat) % lb) + lb) % lb; }
// ---- scale lock + chord HUD: the chop's detected root + the live track's key → notes snap to the scale
const CAM_MAJOR = { 1: 11, 2: 6, 3: 1, 4: 8, 5: 3, 6: 10, 7: 5, 8: 0, 9: 7, 10: 2, 11: 9, 12: 4 }; // Camelot nB → tonic pitch class
function keyInfo(cam) {
  const m = /^(\d{1,2})([AB])$/.exec(String(cam || '')); if (!m) return null;
  const major = m[2] === 'B', tonic = major ? CAM_MAJOR[m[1]] : (CAM_MAJOR[m[1]] + 9) % 12;
  const steps = major ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return { cam, major, tonic, pcs: new Set(steps.map((s) => (tonic + s) % 12)), name: `${NOTE_NAMES[tonic]}${major ? '' : 'm'}` };
}
function liveKey() { const d = mixer.liveDeck(); return d?.track ? keyInfo(d.effectiveCamelot?.() || d.track.camelot) : null; }
function snapSemis(semis) {
  const p = mixer.sampler.pads[KB.pad - 1], key = liveKey();
  if (KB.scale !== 'on' || !key || p?.rootMidi == null) return semis;
  const pc = ((p.rootMidi + semis) % 12 + 12) % 12;
  if (key.pcs.has(pc)) return semis;
  for (const dlt of [-1, 1, -2, 2]) if (key.pcs.has((pc + dlt + 12) % 12)) return semis + dlt;
  return semis;
}
const chromaCache = new Map();
async function phraseChromaFor(id) {
  if (!chromaCache.has(id)) chromaCache.set(id, fetch(`/api/track/${encodeURIComponent(id)}/chroma`).then((r) => (r.ok ? r.json() : null)).then((j) => j?.phraseChroma || null).catch(() => null));
  return chromaCache.get(id);
}
function chordOf(vec) { // best major/minor triad template against a 12-bin chroma
  if (!vec) return null;
  let best = null;
  for (let r = 0; r < 12; r++) for (const [name, tri] of [['', [0, 4, 7]], ['m', [0, 3, 7]]]) {
    const s = tri.reduce((a, i) => a + vec[(r + i) % 12], 0) - 0.5 * vec.reduce((a, v) => a + v, 0) / 12 * 3;
    if (!best || s > best.s) best = { s, name: NOTE_NAMES[r] + name, pcs: new Set(tri.map((i) => (r + i) % 12)) };
  }
  return best;
}
async function hudTick() {
  const hud = $('#kbHud'); if (!hud || !mixer) return;
  const d = mixer.liveDeck(), key = liveKey(), p = mixer.sampler.pads[KB.pad - 1];
  let chord = null;
  if (d?.track) { const pc = await phraseChromaFor(d.track.id); const i = Math.floor((d.beatAt(d.position()) / 4) / 8); chord = chordOf(pc?.[i]); }
  const root = p?.rootMidi != null ? `${NOTE_NAMES[p.rootMidi % 12]}${Math.floor(p.rootMidi / 12) - 1}` : '?';
  hud.textContent = `chop ${root} · key ${key ? `${key.cam} ${key.name}` : '—'} · chord ${chord?.name || '—'}`;
  for (const k of $$('#keys .pk')) {
    const pcls = p?.rootMidi != null ? ((p.rootMidi + Number(k.dataset.semis) + 12 * KB.octave) % 12 + 12) % 12 : null;
    k.classList.toggle('scale', pcls != null && !!key?.pcs.has(pcls));
    k.classList.toggle('chord', pcls != null && !!chord?.pcs.has(pcls));
  }
}
setInterval(() => hudTick().catch(() => {}), 400);
function kbNoteOn(semis, when = kbTime(), key = null) {
  semis = snapSemis(semis);
  const h = mixer.sampler.note(KB.pad, semis, when, KB.gain);
  if (key) KB.active.set(key, h);
  if (KB.loop.rec) KB.loop.events.push({ b: +kbLoopBeat(when).toFixed(3), semis, dur: null, h, live: Math.floor((when - KB.loop.t0) / (loopBeats() * KB.loop.secPerBeat)) });
  markKey(semis, true);
  return h;
}
function kbNoteOff(key, semis) {
  const h = KB.active.get(key); if (!h) return;
  KB.active.delete(key);
  if (KB.hold) h.stop();
  if (KB.loop.rec) { const ev = KB.loop.events.find((e) => e.h === h); if (ev) { const lb = loopBeats(); ev.dur = +(((kbLoopBeat(mixer.ctx.currentTime) - ev.b + lb) % lb) || 0.25).toFixed(3); } }
  markKey(semis, false);
}
function markKey(semis, on) { const el = $(`#keys .pk[data-semis="${semis - 12 * KB.octave}"]`); if (el) el.classList.toggle('on', on); }
export function loopSet(mode) {
  const L = KB.loop;
  if (mode === 'clear') { L.events = []; L.rec = false; L.on = false; }
  else if (mode === 'stop') { L.rec = false; L.on = false; }
  else if (mode === 'rec' || mode === 'play') {
    if (!L.on) { const live = mixer.liveDeck(); L.secPerBeat = live?.track ? live.beatLen / live.rate : 60 / 128; L.t0 = live?.track ? mixer.quantTime('bar') : mixer.ctx.currentTime + 0.05; L.done.clear(); }
    L.rec = mode === 'rec'; L.on = true;
  }
  if (L.on && !L.timer) L.timer = setInterval(loopTick, 40);
  if (!L.on && L.timer) { clearInterval(L.timer); L.timer = null; }
  renderKeys();
}
function loopTick() {
  const L = KB.loop; if (!L.on || !mixer) return;
  const now = mixer.ctx.currentTime, loopSec = loopBeats() * L.secPerBeat, ahead = 0.15;
  const cyc = Math.floor((now - L.t0) / loopSec);
  for (const c of [cyc, cyc + 1]) for (const [i, ev] of L.events.entries()) {
    if (ev.live === c) continue; // played live while being recorded this cycle
    const t = L.t0 + c * loopSec + ev.b * L.secPerBeat, key = `${c}:${i}`;
    if (t < now - 0.02 || t > now + ahead || L.done.has(key)) continue;
    L.done.add(key);
    try { const h = mixer.sampler.note(KB.pad, ev.semis, t, KB.gain); if (ev.dur) h.stop(t + ev.dur * L.secPerBeat); } catch { /* pad emptied */ }
  }
  if (L.done.size > 5000) L.done.clear();
}
// ---- keys: every shortcut is an action in the registry (/keymap.mjs); which key runs it is a setting (ui.keys)
const warn = (fn) => { try { fn(); } catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${err.message}` }); } };
// the deck [ ] act on: the one the pointer was last used on if it has a loop, else the first deck with one, else the live deck
function loopTarget() {
  const last = mixer.decks[pointer.deck];
  return last?.loop ? last : Object.values(mixer.decks).find((x) => x.loop) || mixer.liveDeck();
}
function run(a, e) {
  if (a.id === 'lower.toggle') return toggleLower();
  if (a.id === 'keys.toggle') return showTab(dockTab() === 'sampler' && !ui.lowerCollapsed ? 'library' : 'sampler');
  if (a.id === 'shortcuts.show') return toggleShortcuts();
  if (!mixer?.sampler) return; // the rest needs the engine
  if (a.semis !== undefined) {
    const semis = a.semis + 12 * KB.octave;
    held.set(e.code, semis);
    return warn(() => kbNoteOn(semis, kbTime(), e.code));
  }
  if (a.id === 'chop.octave.down') { KB.octave = Math.max(-2, KB.octave - 1); return renderKeys(); }
  if (a.id === 'chop.octave.up') { KB.octave = Math.min(2, KB.octave + 1); return renderKeys(); }
  if (a.beats) { const d = mixer.decks[a.deck]; if (d?.track) d.setLoop(d.loop?.beats === a.beats ? 0 : a.beats, undefined, 'block'); return; }
  const d = a.deck ? mixer.decks[a.deck] : loopTarget();
  if (a.move) { if (d?.loop) warn(() => d.moveLoop(a.move)); return; }
  if (a.factor && d && (a.deck || d.loop)) warn(() => d.loopStep(a.factor)); // a deck's own key also steps the next loop's length, as its button does
}
const held = new Map(); // physical key -> the note it started, so key-up ends that note whatever changed meanwhile
window.addEventListener('keydown', (e) => {
  if (e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
  const a = actionFor(e);
  if (!a) return;
  e.preventDefault();
  run(a, e);
});
window.addEventListener('keyup', (e) => {
  if (!held.has(e.code)) return;
  const semis = held.get(e.code); held.delete(e.code);
  kbNoteOff(e.code, semis);
});
// the tooltips that name keys follow the bindings
function keyHints() {
  for (const el of $$('.deck')) {
    const deck = el.dataset.deck, keys = [4, 8, 16, 32].map((b) => hint(`loop.${b}.${deck}`));
    $('.loops', el).title = `Loop, in beats: click = loop this block (snapped) · hold = momentary · shift+click = from the next bar${keys.some(Boolean) ? ` · keys ${keys.map((k) => k || '–').join(' ')}` : ''}`;
    for (const b of $$('.lscale', el)) {
      const half = b.dataset.scale === '0.5', k = hint(`loop.${half ? 'half' : 'double'}.${deck}`) || hint(half ? 'loop.half' : 'loop.double');
      b.title = `${half ? 'Halve' : 'Double'} the loop${k ? ` (${k})` : ''} · shift+click = move the loop ${half ? 'back' : 'forward'} by its own length · with no loop: a ${half ? 'shorter' : 'longer'} next loop`;
    }
  }
}
onBindings(() => { keyHints(); renderKeys(); });
export function renderKeys() {
  const wrap = $('#keysMain'); if (!wrap || !mixer?.sampler) return; // not #keys itself: the pads can live in there too
  const L = KB.loop, p = mixer.sampler.pads[KB.pad - 1];
  const opt = (vals, cur, fmt = (v) => v) => vals.map((v) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${fmt(v)}</option>`).join('');
  // three named groups: where the sound comes from, how it is played, and the loop recorder. The pad the keyboard
  // plays is picked on the pads themselves (the ring on a pad).
  wrap.innerHTML = `
    <div class="kgroups">
      <div class="kg"><h4>SOURCE <span class="kchop" title="the pad the keyboard plays, and what is on it">pad ${KB.pad} · ${p?.buffer ? esc(p.name) : 'empty'}</span></h4>
        <div class="krow">
          <label title="How much to grab: the length of the chop, in beats">grab <select id="kbBeats">${opt([0.5, 1, 2, 4], KB.grabBeats, (v) => `${v} beat${v === 1 ? '' : 's'}`)}</select></label>
          <label title="What to grab: one stem of the track, or the full mix">of <select id="kbStem">${opt(['vocals', 'mix', 'drums', 'bass', 'other'], KB.grabStem)}</select></label>
          ${['A', 'B', 'C', 'D'].map((d) => `<button class="btn sm kgrab" data-deck="${d}" title="grab from deck ${d} at its playhead, into pad ${KB.pad}">↓ ${d}</button>`).join('')}
        </div></div>
      <div class="kg"><h4>PLAY <span class="khud" id="kbHud">—</span></h4>
        <div class="krow">
          <label title="Quantise: a note starts at once (off), on the next 1/16 or on the next beat of the live deck">quant <select id="kbQuant">${opt(['off', '16', 'beat'], KB.quant, (v) => (v === '16' ? '1/16' : v))}</select></label>
          <button class="btn sm ${KB.hold ? 'on' : ''}" id="kbHold" title="hold: the chop stops when you release the key">HOLD</button>
          <button class="btn sm ${KB.scale === 'on' ? 'on' : ''}" id="kbScale" title="scale lock: notes snap to the live track's key (needs the chop's root, detected on grab)">SCALE</button>
          <span class="koct" title="${esc([hint('chop.octave.down'), hint('chop.octave.up')].filter(Boolean).join(' / '))}">oct ${KB.octave >= 0 ? '+' : ''}${KB.octave}</span>
          <label title="Volume of the chop, up to 150%">vol <input type="range" id="kbGain" min="0" max="1.5" step="0.01" value="${KB.gain}"></label>
        </div></div>
      <div class="kg"><h4>LOOP <span class="kevents">${L.events.length ? `${L.events.length} notes` : ''}</span></h4>
        <div class="krow">
          <label title="Length of the recorded loop"><select id="kbBars">${opt([1, 2, 4, 8], L.bars, (v) => `${v} bar${v === 1 ? '' : 's'}`)}</select></label>
          <button class="btn sm ${L.rec ? 'rec' : ''}" id="kbRec" title="Record: the notes you play are added to the loop, from the live deck's next bar · click again = stop recording, the loop plays on">● REC</button>
          <button class="btn sm ${L.on && !L.rec ? 'on' : ''}" id="kbPlay" title="Play the recorded loop, from the live deck's next bar">▶ LOOP</button>
          <button class="btn sm" id="kbStop" title="Stop the loop · its notes are kept">■</button>
          <button class="btn sm" id="kbClear" title="Stop the loop and delete its notes">CLR</button>
        </div></div>
    </div>
    <div class="piano">${[...Array(18).keys()].map((s) => {
      const white = WHITES.includes(s);
      const wi = WHITES.filter((w) => w < s).length; // whites before this key
      const style = white ? `left:${(wi * 100) / WHITES.length}%;width:${100 / WHITES.length}%` : `left:${(wi * 100) / WHITES.length - 100 / WHITES.length / 3.4}%;width:${100 / WHITES.length / 1.7}%`;
      return `<button class="pk ${white ? 'w' : 'b'}" data-semis="${s}" style="${style}" title="${NOTE_NAMES[s % 12]}"><i>${esc(hint(`chop.note.${s}`))}</i>${white ? `<small>${NOTE_NAMES[s % 12]}</small>` : ''}</button>`;
    }).join('')}</div>`;
  $('#kbBeats').onchange = (e) => (KB.grabBeats = Number(e.target.value));
  $('#kbStem').onchange = (e) => (KB.grabStem = e.target.value);
  $('#kbQuant').onchange = (e) => (KB.quant = e.target.value);
  $('#kbBars').onchange = (e) => (KB.loop.bars = Number(e.target.value));
  $('#kbGain').oninput = (e) => (KB.gain = Number(e.target.value));
  $('#kbHold').onclick = () => { KB.hold = !KB.hold; renderKeys(); };
  $('#kbScale').onclick = () => { KB.scale = KB.scale === 'on' ? 'off' : 'on'; renderKeys(); };
  $('#kbRec').onclick = () => loopSet(KB.loop.rec ? 'play' : 'rec');
  $('#kbPlay').onclick = () => loopSet('play');
  $('#kbStop').onclick = () => loopSet('stop');
  $('#kbClear').onclick = () => loopSet('clear');
  for (const b of $$('.kgrab', wrap)) b.onclick = async () => {
    try { const r = await mixer.sampler.grab(KB.pad, b.dataset.deck, KB.grabBeats, KB.grabStem === 'mix' ? null : KB.grabStem); addFeed({ ts: Date.now(), kind: 'action', text: `🎹 grabbed ${r.beats} beat(s) of ${r.name} from ${r.deck} into pad ${r.pad}` }); renderPads(); renderKeys(); }
    catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${err.message}` }); }
  };
  for (const k of $$('.pk', wrap)) {
    const semis = () => Number(k.dataset.semis) + 12 * KB.octave;
    k.onmousedown = (e) => { e.preventDefault(); try { kbNoteOn(semis(), kbTime(), `m${k.dataset.semis}`); } catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${err.message}` }); } };
    k.onmouseup = k.onmouseleave = () => kbNoteOff(`m${k.dataset.semis}`, semis());
  }
}

export function renderPads() {
  const wrap = $('#pads');
  if (!mixer?.sampler) return;
  // a pad fires on a click; the ring in its corner makes it the one the chop keyboard plays and grabs into
  wrap.innerHTML = mixer.sampler.pads.map((p) => `<div class="pad${p.buffer ? '' : ' empty'}${p.pad === KB.pad ? ' sel' : ''}" role="button" tabindex="0" data-pad="${p.pad}" title="${p.buffer ? `pad ${p.pad}: ${esc(p.name)} (click = now, shift+click = next beat)` : `pad ${p.pad} is empty — grab into it from a deck, or: dj sampler ${p.pad} --load <trackId> --from <sec> --beats 2`}"><i>${p.pad}</i><span>${esc(p.name)}</span><button class="padsel" aria-pressed="${p.pad === KB.pad}" title="${p.pad === KB.pad ? 'The chop keyboard plays this pad' : 'Play this pad from the chop keyboard'}"></button></div>`).join('');
  for (const b of $$('.pad', wrap)) {
    const fire = (e) => {
      if (e.target.closest('.padsel')) { KB.pad = Number(b.dataset.pad); renderPads(); renderKeys(); return; }
      try { const t = mixer.quantTime(e.shiftKey ? 'beat' : 'now'); mixer.sampler.trigger(Number(b.dataset.pad), t); }
      catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: err.message }); }
    };
    b.onclick = fire;
    b.onkeydown = (e) => { if (e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fire(e); } };
  }
}
