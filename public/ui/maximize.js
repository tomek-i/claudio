import { $, $$, mmss } from './util.js';
import { ui, mixer } from './state.js';
import { onUi, saveUi } from './prefs.js';
import { toggleLower } from './lower.js';

// ------------------------------------------------------------------ the bottom panel maximised, and the layout presets
// Maximised, the panel (whichever tab is open) covers the page under a slim strip of the decks, until its button is
// clicked again or Esc is pressed. Maximising a hidden panel shows it for that long.
// The header's layout buttons set everything at once (ui.layoutPreset): Mix = decks with the library, Browse = the
// library maximised, Perform = decks with the sampler. They only drive what is already there.
const btn = $('#lowerMax');
let on = false, rehide = false; // rehide: the panel was hidden when it was maximised

export function setMax(want) {
  const was = on; on = !!want;
  if (was && !on && rehide && !ui.lowerCollapsed) toggleLower(true);
  if (!on) rehide = false;
  document.body.classList.toggle('lower-max', on);
  btn.textContent = on ? '⤡' : '⤢';
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Back to the normal size (Esc)' : 'Maximise the bottom panel';
  // leaving the maximised library by hand is leaving Browse
  if (was && !on && ui.layoutPreset === 'browse') saveUi({ layoutPreset: 'mix' });
}
btn.onclick = () => {
  if (on) return setMax(false);
  const was = ui.lowerCollapsed;
  if (was) toggleLower(false);
  setMax(true); rehide = was;
};
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on) setMax(false); });
onUi(() => { if (on && ui.lowerCollapsed) setMax(false); });

// ---- layout presets
const PRESETS = {
  mix: { dockTab: 'library', lowerCollapsed: false, lowerHeight: 0 },
  browse: { dockTab: 'library', lowerCollapsed: false },
  perform: { dockTab: 'sampler', lowerCollapsed: false, lowerHeight: 0 },
};
function showPreset() { for (const b of $$('#presets button')) b.setAttribute('aria-pressed', String(b.dataset.preset === (ui.layoutPreset || 'mix'))); }
export function setPreset(name) {
  if (!PRESETS[name]) return;
  rehide = false;
  saveUi({ ...PRESETS[name], layoutPreset: name });
  setMax(name === 'browse');
}
for (const b of $$('#presets button')) b.onclick = () => setPreset(b.dataset.preset);
onUi(showPreset);
setMax(ui.layoutPreset === 'browse' && !ui.lowerCollapsed); // the page comes back the way it was left

// ---- the slim strip of the decks, shown above a maximised panel: what is loaded, time left, tempo, play and cue
const strip = $('#deckStrip');
strip.innerHTML = ['A', 'B', 'C', 'D'].map((n) => `<div class="ds" data-deck="${n}" hidden>
  <b class="ds-letter">${n}</b><span class="ds-title"></span><span class="ds-time"></span><span class="ds-bpm"></span>
  <button class="ds-cue" title="Cue deck ${n}">CUE</button><button class="ds-play" title="Play / pause deck ${n}">▶</button>
  <i class="ds-bar"><b></b></i></div>`).join('');
for (const el of $$('.ds', strip)) {
  const deck = () => $(`.deck[data-deck="${el.dataset.deck}"]`);
  $('.ds-play', el).onclick = () => $('.play', deck()).click();
  $('.ds-cue', el).onclick = () => $('.cue', deck()).click();
}
const set = (el, txt) => { if (el.textContent !== txt) el.textContent = txt; };
// called every frame by app.js; does nothing unless the strip is on screen
export function renderDeckStrip() {
  if (!on || !mixer) return;
  for (const el of $$('.ds', strip)) {
    const d = mixer.decks[el.dataset.deck], t = d.track;
    el.hidden = !t && (d.name === 'C' || d.name === 'D');
    if (el.hidden) continue;
    const pos = d.position(), dur = d.buffer?.duration;
    set($('.ds-title', el), t ? `${t.artist ? `${t.artist} · ` : ''}${t.title}` : 'No track');
    set($('.ds-time', el), dur ? `-${mmss((dur - pos) / d.rate)}` : '');
    set($('.ds-bpm', el), t ? d.effBpm.toFixed(1) : '');
    set($('.ds-play', el), d.playing ? '❚❚' : '▶');
    el.classList.toggle('playing', d.playing);
    $('.ds-bar b', el).style.width = dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0';
  }
}
