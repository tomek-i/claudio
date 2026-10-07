import { $ } from './util.js';
import { mixer, tracks } from './state.js';
import { loadTrack } from './commands.js';
import { addFeed } from './booth.js';

// ------------------------------------------------------------------ loading a deck from the page
// One path for the row buttons, a row dragged to a deck (mouse or touch) and a file dropped on a deck. A deck that
// is playing and audible is not replaced by a slip of the hand: it takes Shift (`force`), or on a touch screen a
// confirm on the deck itself. Loads from the booth (dj load, the sequencer, the auto-DJ) do not come through here.
const warn = (text) => addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${text}` });

function note(deck, text) {
  const el = $(`.deck[data-deck="${deck}"]`);
  $('.deck-note', el)?.remove();
  const n = Object.assign(document.createElement('div'), { className: 'deck-note', textContent: text });
  el.append(n);
  setTimeout(() => n.remove(), 2600);
}
// "Replace playing track?" on the deck; no answer in time is a no
function confirmReplace(deck) {
  const el = $(`.deck[data-deck="${deck}"]`);
  $('.deck-confirm', el)?.remove();
  const box = Object.assign(document.createElement('div'), { className: 'deck-confirm' });
  box.innerHTML = '<span>Replace playing track?</span><button class="btn sm yes">Replace</button><button class="btn sm no">Cancel</button>';
  el.append(box);
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(timer); box.remove(); resolve(v); };
    const timer = setTimeout(() => done(false), 5000);
    $('.yes', box).onclick = () => done(true);
    $('.no', box).onclick = () => done(false);
  });
}

export async function requestLoad(deck, id, { force = false, touch = false } = {}) {
  if (!mixer?.xfader) return false; // the engine is not running yet
  if (mixer.decks[deck].isLive() && !force) {
    if (touch) { if (!(await confirmReplace(deck))) return false; }
    else { note(deck, `Deck ${deck} is playing, hold Shift to replace`); warn(`deck ${deck} is playing, hold Shift to replace it`); return false; }
    force = true;
  }
  try {
    const full = tracks.get(id) || (await fetch(`/api/track/${id}`).then((r) => r.json()));
    await loadTrack(deck, { ...full, url: `/audio/${id}` }, { force });
    return true;
  } catch (err) { warn(err.message); return false; }
}

// import audio files into the library (progress shows with the downloads); the first one goes on `deck` if given
export async function importFiles(files, deck = null, opts = {}) {
  let loaded = false;
  for (const f of files) {
    let r;
    try { r = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f }).then((x) => x.json()); }
    catch { warn(`${f.name}: the server did not take the file`); continue; }
    if (!r.ok) { warn(r.error || `${f.name} could not be imported`); continue; }
    if (r.duplicate) addFeed({ ts: Date.now(), kind: 'system', text: `${f.name} is already in the library` });
    if (deck && !loaded) { loaded = true; await requestLoad(deck, r.track.id, opts); }
  }
}
