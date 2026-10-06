import './extra-decks.js'; // decks C + D and their strips must exist before anything here looks for them
import { $, $$ } from './util.js';
import { ui } from './state.js';
import { onUi } from './prefs.js';
import { VOL_MAX, volOfDb } from '../engine.js';

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

// ------------------------------------------------------------------ the dB scale of the mixer
// Printed beside every channel fader and between the master meters, as on a hardware mixer: 0 is a track at its
// normal level, the marks above it are the headroom. The fader and the meters share the mapping (volOfDb in
// engine.js), so a mark means the same level on both.
const SCALE = [[6, '+6'], [3, '+3'], [0, '0'], [-3, '-3'], [-6, '-6'], [-10, '-10'], [-20, '-20'], [-Infinity, '∞']];
const marks = SCALE.map(([db, label]) => `<i${db === 0 ? ' class="zero"' : ''} style="bottom:${((volOfDb(db) / VOL_MAX) * 100).toFixed(2)}%">${label}</i>`).join('');
for (const t of $$('.fadertrack')) t.insertAdjacentHTML('afterbegin', `<span class="fscale" aria-hidden="true">${marks}</span>`);
$('#masterVol').insertAdjacentHTML('afterend', `<b class="hscale" aria-hidden="true">${marks.replaceAll('bottom:', 'left:')}</b>`);
$('.mastermeters .mm')?.insertAdjacentHTML('afterend', `<div class="mscale" aria-hidden="true"><span>${marks}</span><small>dB</small></div>`);

onUi(applyLayout);
