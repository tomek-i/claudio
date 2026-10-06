import './extra-decks.js'; // decks C + D and their strips must exist before anything here looks for them
import { $, $$ } from './util.js';
import { ui, mixer } from './state.js';
import { onUi, saveUi } from './prefs.js';

// ------------------------------------------------------------------ deck layout (ui.deckLayout): stacked | classic
// One set of markup for both. The decks switch in CSS alone (body[data-layout]). The mixer needs three things moved,
// listeners and all: the per-deck FX controls (FX block ⇄ channel strip), the master volume (MASTER section ⇄ header)
// and the sampler pads (beside the chop keyboard ⇄ under the crossfader).
export const mixerEls = (deck, sel) => $$(`.mixer [data-deck="${deck}"] ${sel}`); // a deck's controls, in its strip or its FX row

function applyLayout() {
  const layout = ui.deckLayout === 'classic' ? 'classic' : 'stacked';
  if (document.body.dataset.layout === layout) return; // the markup is authored in the stacked layout
  document.body.dataset.layout = layout;
  const stacked = layout === 'stacked';
  for (const strip of $$('.strip')) {
    const deck = strip.dataset.deck, row = $(`.fxrow[data-deck="${deck}"]`);
    const [sel] = mixerEls(deck, '.fxsel'), [echo] = mixerEls(deck, '.k[data-ctl="echo"]'), [fx] = mixerEls(deck, '.k[data-ctl="fx"]');
    if (stacked) row.append(sel, echo, fx);
    else $('.faderwrap', strip).before(echo, fx, sel);
  }
  const vol = $('.mastervol');
  if (stacked) $('.master .sname').after(vol); else $('header.top').append(vol);
  if (stacked) $('#keys').prepend($('#pads')); else $('.mixer').append($('#pads'));
}

// ------------------------------------------------------------------ jog wheel size (ui.jogLarge: the decks shown large)
function applyJogSize() {
  for (const el of $$('.deck')) {
    const large = ui.jogLarge.includes(el.dataset.deck), b = $('.jogsize', el);
    el.classList.toggle('jog-large', large);
    b.setAttribute('aria-pressed', String(large));
    b.title = large ? 'Back to the normal jog wheel size' : 'Enlarge the jog wheel';
  }
}
for (const el of $$('.deck')) $('.jogsize', el).onclick = () => {
  const deck = el.dataset.deck;
  if (mixer?.decks[deck].handActive) return; // mid-scratch: wait for the wheel to be let go
  saveUi({ jogLarge: ui.jogLarge.includes(deck) ? ui.jogLarge.filter((d) => d !== deck) : [...ui.jogLarge, deck].sort() });
};
onUi(applyLayout);
onUi(applyJogSize);
