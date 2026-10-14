import { $, $$ } from './util.js';
import { mixer, ui } from './state.js';
import { requestLoad, importFiles } from './loader.js';

// ------------------------------------------------------------------ dragging tracks and files onto a deck
// A library row (mouse: HTML drag and drop · touch: long-press, then drag) or audio files from the computer can be
// dropped on a deck to load it; files dropped on the crate are imported only. Both inputs share the same three
// steps (begin / over / finish) and the same drop (loader.js). While a drag is on, the decks light up in their own
// colour and the hidden decks C and D show as drop zones. A row can also be dropped on the active set (ui/sets.js),
// before the set's track it is let go on.
const TRACK = 'application/x-dj-track';
const deckAt = (el) => el?.closest?.('.deck[data-deck]') || null;
const ready = () => !!mixer?.xfader;
const refused = (deckEl, force) => mixer.decks[deckEl.dataset.deck].isLive() && !force;
const setAt = (el) => el?.closest?.('#svTracks.on') || null;
// where in the set a drop lands: before the track under the pointer (1-based), or at the end
function setSpot(el) {
  const item = el?.closest?.('#svTracks .svt');
  return item ? Number(item.dataset.i) : undefined;
}
function overSet(el) {
  const box = $('#svTracks'), on = !!setAt(el), item = on ? el.closest?.('#svTracks .svt') : null;
  box.classList.toggle('drop-over', on);
  for (const x of $$('#svTracks .svt')) x.classList.toggle('drop-before', x === item);
}
const dropOnSet = (id, el) => document.dispatchEvent(new CustomEvent('set:drop', { detail: { id, at: setSpot(el) } }));

function begin() { document.body.classList.add('dragging'); }
function over(deckEl, no = false) {
  for (const el of $$('.deck')) { el.classList.toggle('drop-over', el === deckEl && !no); el.classList.toggle('drop-no', el === deckEl && no); }
}
function finish() {
  document.body.classList.remove('dragging', 'touch-drag');
  over(null); overSet(null); $('.crate').classList.remove('drop-over');
  $$('.dragchip').forEach((c) => c.remove());
}
// the compact card that travels with the pointer: title, BPM, key
function chipFor(row) {
  const chip = Object.assign(document.createElement('div'), { className: 'dragchip' });
  const title = Object.assign(document.createElement('b'), { textContent: $('.name .tt', row).firstChild.textContent });
  const bpm = Object.assign(document.createElement('span'), { textContent: row.cells[2].textContent });
  chip.append(title, bpm, $('.keychip', row).cloneNode(true));
  document.body.append(chip);
  return chip;
}

// ---- mouse and trackpad: HTML drag and drop
const lib = $('#lib');
lib.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('tr[data-id]');
  if (!row || !ready()) return e.preventDefault();
  e.dataTransfer.setData(TRACK, row.dataset.id);
  e.dataTransfer.effectAllowed = 'copy';
  const chip = chipFor(row); chip.classList.add('ghost'); // off screen: the browser takes its picture of it now
  e.dataTransfer.setDragImage(chip, 12, 12);
  setTimeout(() => chip.remove(), 0);
});
const kindOf = (e) => { const t = [...(e.dataTransfer?.types || [])]; return t.includes(TRACK) ? 'track' : t.includes('Files') ? 'files' : null; };
document.addEventListener('dragover', (e) => {
  const kind = kindOf(e);
  if (!kind) return; // text, links, images: not ours
  if (kind === 'files') e.preventDefault(); // a file let go anywhere else must not make the browser open it over the decks
  if (!ready()) { e.dataTransfer.dropEffect = 'none'; return; }
  begin();
  const deckEl = deckAt(e.target), onCrate = kind === 'files' && !!e.target.closest?.('.crate'), onSet = kind === 'track' && setAt(e.target);
  $('.crate').classList.toggle('drop-over', onCrate);
  overSet(kind === 'track' ? e.target : null);
  if (onSet) { e.preventDefault(); over(null); e.dataTransfer.dropEffect = 'copy'; }
  else if (deckEl) { e.preventDefault(); over(deckEl, refused(deckEl, e.shiftKey)); e.dataTransfer.dropEffect = 'copy'; }
  else { over(null); e.dataTransfer.dropEffect = onCrate ? 'copy' : 'none'; }
});
document.addEventListener('drop', (e) => {
  const kind = kindOf(e);
  if (!kind) return;
  e.preventDefault();
  const deckEl = deckAt(e.target), deck = deckEl?.dataset.deck, opts = { force: e.shiftKey };
  const files = [...(e.dataTransfer.files || [])], onCrate = !!e.target.closest?.('.crate');
  const onSet = kind === 'track' && setAt(e.target);
  finish();
  if (!ready()) return;
  if (onSet) dropOnSet(e.dataTransfer.getData(TRACK), e.target);
  else if (kind === 'track' && deck) requestLoad(deck, e.dataTransfer.getData(TRACK), opts);
  else if (kind === 'files' && (deck || onCrate)) importFiles(files, deck || null, opts);
});
document.addEventListener('dragend', finish);
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) finish(); }); // the drag left the window

// ---- touch: long-press a row (ui.touchHoldMs), then drag. Not in the phone layout, where the decks and the crate
// do not share a screen: there the row's load buttons are the way.
const phone = matchMedia('(max-width: 700px)');
let press = null; // { id, x, y, timer, held, chip, scroll }
function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer); clearInterval(press.scroll);
  const held = press.held; press = null;
  if (held) finish();
}
lib.addEventListener('touchstart', (e) => {
  cancelPress();
  const row = e.target.closest?.('tr[data-id]');
  if (!row || e.touches.length !== 1 || e.target.closest('.ld') || phone.matches || !ready()) return;
  const t = e.touches[0];
  press = { id: row.dataset.id, x: t.clientX, y: t.clientY, held: false };
  press.timer = setTimeout(() => {
    if (!press) return;
    press.held = true;
    navigator.vibrate?.(12);
    begin(); document.body.classList.add('touch-drag');
    press.chip = chipFor(row); moveChip(press.x, press.y);
  }, ui.touchHoldMs);
}, { passive: true });
function moveChip(x, y) { press.chip.style.left = `${Math.max(8, x - 40)}px`; press.chip.style.top = `${Math.max(8, y - 64)}px`; } // above the finger
document.addEventListener('touchmove', (e) => {
  if (!press) return;
  if (e.touches.length > 1) return cancelPress(); // a second finger calls it off
  const t = e.touches[0];
  if (!press.held) { if (Math.hypot(t.clientX - press.x, t.clientY - press.y) > 8) cancelPress(); return; } // moved first: that is a scroll
  e.preventDefault(); // held: the finger drags the track, not the page
  press.x = t.clientX; press.y = t.clientY;
  moveChip(t.clientX, t.clientY);
  const under = document.elementFromPoint(t.clientX, t.clientY);
  over(deckAt(under)); overSet(under);
  // near the top or bottom edge the page scrolls, so a deck that is off screen can be reached
  const edge = t.clientY < 56 ? -1 : t.clientY > innerHeight - 56 ? 1 : 0;
  clearInterval(press.scroll);
  if (edge) press.scroll = setInterval(() => { document.body.scrollBy(0, edge * 14); document.scrollingElement.scrollBy(0, edge * 14); }, 16);
}, { passive: false });
document.addEventListener('touchend', () => {
  if (!press) return;
  const { held, id, x, y } = press, under = held ? document.elementFromPoint(x, y) : null, deck = deckAt(under)?.dataset.deck;
  cancelPress();
  if (held && setAt(under)) dropOnSet(id, under);
  else if (deck) requestLoad(deck, id, { touch: true });
});
document.addEventListener('touchcancel', cancelPress);
document.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); }); // the browser's own long-press menu

// ---- the FILES button: the device's file picker, import only
const picker = $('#filesInput');
$('#filesBtn').onclick = () => picker.click();
picker.onchange = () => { const files = [...picker.files]; picker.value = ''; if (files.length) importFiles(files); }; // cleared, so the same file can be picked again
