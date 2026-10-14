// ------------------------------------------------------------------ the Sets tab: prepare a set beside the library
// Left: the library, the Library tab's own table (moved here while this tab is open, so its search, filters and sort
// are the same). Right: every set (the one Auto-DJ plays from has a ★; picking one makes it that set, "No set" lets
// Auto-DJ pick from the whole library), and the open set: rename / copy / delete, how Auto-DJ picks from it and what it
// does when all of it has played, its tracks (drag a library row in, drag a track to another place, × takes it out),
// its saved decks, and its automation (the Automation tab has the rest). Sets live on the server (lib/sets.mjs).
import { $, $$, mmss, post, esc, camelotColor } from './util.js';
import { mixer } from './state.js';
import { addFeed } from './booth.js';
import { markSet } from './crate.js';
import { ask, setActiveSet } from './automation-ui.js';
import { showTab } from './lower.js';

let list = { sets: [], active: null }, detail = null;
const warn = (text) => addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${text}` });
const act = (body) => post('/api/sets', body).catch(() => ({ ok: false, error: 'the server did not answer' }));
const box = $('#svConfirm');
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export async function refreshSets() {
  try {
    list = await fetch('/api/sets').then((x) => x.json());
    detail = list.active ? await fetch('/api/sets?name=' + encodeURIComponent(list.active.name)).then((x) => x.json()) : null;
    if (detail?.ok === false) detail = null;
  } catch { return; }
  setActiveSet(detail);
  markSet(detail?.name || null, (detail?.tracks || []).map((t) => t.id));
  render();
}

function render() {
  const d = detail, tracks = d?.tracks || [], played = tracks.filter((t) => t.played).length, missing = tracks.filter((t) => t.missing).length;
  // in the Library tab, under Up next: which set Auto-DJ plays from
  $('#upSet').hidden = !d;
  if (d) $('#upSet').innerHTML = `Set <b>${esc(d.name)}</b>: Auto-DJ plays it after the queue (${played} of ${tracks.length} played). <button class="linkish" data-go="sets">Sets tab</button>`;
  // every set
  const row = (st) => {
    const on = list.active?.name === st.name;
    const bits = [`${st.tracks} track${st.tracks === 1 ? '' : 's'}`, st.duration ? mmss(st.duration) : null, st.saved ? 'decks' : null, st.automation ? `rec ${mmss(st.automation.duration)}` : null].filter(Boolean);
    return `<button class="sv-row${on ? ' on' : ''}" role="option" aria-selected="${on}" data-name="${esc(st.name)}" title="${on ? 'Auto-DJ plays from this set' : 'Make this the set Auto-DJ plays from'}"><i>${on ? '★' : ''}</i><span>${esc(st.name)}</span><small>${bits.join(' · ')}</small></button>`;
  };
  const html = `<button class="sv-row none${list.active ? '' : ' on'}" role="option" aria-selected="${!list.active}" data-name="" title="No set: Auto-DJ picks from the whole library"><i>${list.active ? '' : '★'}</i><span>No set</span><small>Auto-DJ picks from the library</small></button>` + list.sets.map(row).join('');
  if ($('#svSets').dataset.html !== html) { $('#svSets').innerHTML = html; $('#svSets').dataset.html = html; }
  // the open set
  $('#svSet').hidden = !d;
  $('#svTracks').classList.toggle('on', !!d);
  if (!d) return;
  if ($('#svRenameForm').hidden) $('#svTitle').textContent = d.name;
  for (const b of $$('#svPick button')) b.setAttribute('aria-pressed', String(b.dataset.v === d.pick));
  for (const b of $$('#svThen button')) b.setAttribute('aria-pressed', String(b.dataset.v === d.then));
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
  $('#svSum').textContent = [`${tracks.length} track${tracks.length === 1 ? '' : 's'}`, mmss(total), played ? `${played} played` : null, missing ? `${missing} not in the library` : null, d.done ? `finished: Auto-DJ ${d.then === 'stop' ? 'stops' : 'carries on from the library'}` : null].filter(Boolean).join(' · ');
  const t = tracks.map((x, i) => `<div class="svt${x.played ? ' played' : ''}${x.missing ? ' missing' : ''}" draggable="true" data-i="${i + 1}" title="${x.missing ? 'Not in the library any more' : 'Drag to another place in the set'}">
    <span class="grip" aria-hidden="true">⠿</span><b>${i + 1}</b><span class="nm">${esc(x.title || x.id)}<small>${esc(x.artist || '')}</small></span>
    <span class="num">${x.bpm ? x.bpm.toFixed(1) : ''}</span>${x.camelot ? `<span class="keychip" style="background:${camelotColor(x.camelot)}">${x.camelot}</span>` : '<span></span>'}
    <span class="num">${x.energy != null ? 'E' + x.energy : ''}</span><span class="num">${x.duration ? mmss(x.duration) : ''}</span>
    <button data-rm="${i + 1}" title="Take it out of the set">×</button></div>`).join('')
    || '<p class="hint">The set is empty. Drag tracks from the library on the left onto it.</p>';
  if ($('#svTracks').dataset.html !== t) { $('#svTracks').innerHTML = t; $('#svTracks').dataset.html = t; } // unchanged: left alone, so a drag over it keeps its marks
  const snap = d.snapshot;
  $('#setOpen').disabled = !snap;
  $('#setSaved').textContent = snap ? `decks ${Object.keys(snap.decks).join(' ')} saved ${when(snap.savedAt)}` : 'no decks saved in this set';
  $('#setSaved').title = snap ? `Saved ${new Date(snap.savedAt).toLocaleString()}: ${Object.entries(snap.decks).map(([n, x]) => `${n} ${x.title}`).join(', ')}` : '';
  const rec = d.automation;
  $('#svAuto').textContent = rec ? `recording ${mmss(rec.duration)} · ${rec.lanes.length} lane${rec.lanes.length === 1 ? '' : 's'} · saved ${when(rec.savedAt)}` : 'no automation recorded yet';
}

// ---- the list of sets, a new one
$('#svSets').addEventListener('click', async (e) => {
  const b = e.target.closest('.sv-row'); if (!b) return;
  const r = await act({ action: 'use', name: b.dataset.name || null });
  if (!r.ok) warn(r.error);
  refreshSets();
});
$('#svNew').onclick = () => {
  const f = $('#svForm'); f.hidden = !f.hidden;
  $('#svNew').setAttribute('aria-expanded', String(!f.hidden));
  if (!f.hidden) $('#svName').focus();
};
$('#svForm').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('#svName').value.trim(); if (!name) return;
  const r = await act({ action: 'create', name, use: true });
  if (!r.ok) return warn(r.error);
  $('#svName').value = ''; $('#svForm').hidden = true; $('#svNew').setAttribute('aria-expanded', 'false');
  refreshSets();
};

// ---- the open set: rename, copy, delete, options
$('#svEdit').onclick = () => {
  if (!detail) return;
  $('#svRename').value = detail.name; $('#svRenameForm').hidden = false; $('#svTitle').hidden = true;
  $('#svRename').focus(); $('#svRename').select();
};
const endRename = () => { $('#svRenameForm').hidden = true; $('#svTitle').hidden = false; };
$('#svRenameForm').onsubmit = async (e) => {
  e.preventDefault();
  const to = $('#svRename').value.trim();
  if (to && to !== detail?.name) { const r = await act({ action: 'rename', name: detail.name, to }); if (!r.ok) warn(r.error); }
  endRename(); refreshSets();
};
$('#svRename').onkeydown = (e) => { if (e.key === 'Escape') { endRename(); render(); } };
$('#svRename').onblur = () => setTimeout(() => { if (!$('#svRenameForm').hidden) $('#svRenameForm').requestSubmit(); }, 0);
$('#svDup').onclick = async () => { if (!detail) return; const r = await act({ action: 'duplicate', name: detail.name }); if (!r.ok) warn(r.error); refreshSets(); };
$('#svDel').onclick = async () => {
  if (!detail) return;
  const what = [detail.tracks.length ? `its ${detail.tracks.length} track${detail.tracks.length === 1 ? '' : 's'}` : null, detail.snapshot ? 'its saved decks' : null, detail.automation ? 'its automation' : null].filter(Boolean);
  if ((await ask(box, `Delete the set "${detail.name}"${what.length ? `, with ${what.join(', ')}` : ''}? The tracks stay in the library.`, [['Delete', true]])) !== true) return;
  const r = await act({ action: 'delete', name: detail.name });
  if (!r.ok) warn(r.error);
  refreshSets();
};
for (const [id, key] of [['#svPick', 'pick'], ['#svThen', 'then']]) {
  $(id).addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-v]'); if (!b || !detail || detail[key] === b.dataset.v) return;
    const r = await act({ action: 'options', name: detail.name, [key]: b.dataset.v });
    if (!r.ok) warn(r.error);
    refreshSets();
  });
}

// ---- its tracks: × takes one out; drag one to another place (a library row dropped on the list is ui/dragdrop.js)
$('#svTracks').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-rm]'); if (!b || !detail) return;
  await act({ action: 'remove', name: detail.name, index: Number(b.dataset.rm) });
  refreshSets();
});
const ROW = 'application/x-dj-setrow';
let moving = null;
$('#svTracks').addEventListener('dragstart', (e) => {
  const r = e.target.closest?.('.svt'); if (!r) return;
  moving = Number(r.dataset.i);
  e.dataTransfer.setData(ROW, String(moving)); e.dataTransfer.effectAllowed = 'move';
  r.classList.add('moving');
});
const rowAt = (e) => e.target.closest?.('#svTracks .svt');
$('#svTracks').addEventListener('dragover', (e) => {
  if (!moving || ![...e.dataTransfer.types].includes(ROW)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const r = rowAt(e);
  for (const x of $$('#svTracks .svt')) x.classList.toggle('drop-before', x === r);
  $('#svTracks').classList.toggle('drop-end', !r);
});
const endMove = () => { moving = null; for (const x of $$('#svTracks .svt')) x.classList.remove('drop-before', 'moving'); $('#svTracks').classList.remove('drop-end'); };
$('#svTracks').addEventListener('drop', async (e) => {
  if (!moving || ![...e.dataTransfer.types].includes(ROW) || !detail) return;
  e.preventDefault();
  const from = moving, r = rowAt(e), target = r ? Number(r.dataset.i) : detail.tracks.length + 1;
  endMove();
  const to = target > from ? target - 1 : target; // the place it lands in, once it has left its own
  if (to !== from) { await act({ action: 'move', name: detail.name, from, to }); refreshSets(); }
});
$('#svTracks').addEventListener('dragend', endMove);
document.addEventListener('set:drop', async (e) => {
  if (!detail || detail.tracks.some((t) => t.id === e.detail.id)) return;
  const r = await act({ action: 'add', name: detail.name, tracks: [e.detail.id], at: e.detail.at });
  if (!r.ok) warn(r.error);
  refreshSets();
});

// ---- its decks: save decks · load decks (back as saved, paused; with music playing it asks first)
$('#setSave').onclick = async () => {
  if (!detail) return;
  const r = await act({ action: 'save', name: detail.name });
  if (!r.ok) warn(r.error);
  refreshSets();
};
$('#setOpen').onclick = async () => {
  if (!detail?.snapshot) return;
  const open = (force) => act({ action: 'open', name: detail.name, force });
  $('#setOpen').disabled = true;
  try {
    let r = await open(false);
    if (!r.ok && r.playing && (await ask(box, `Deck ${r.playing.join(' and ')} ${r.playing.length > 1 ? 'are' : 'is'} playing. Loading the set's decks stops ${r.playing.length > 1 ? 'them' : 'it'}.`, [['Load', true]])) === true) r = await open(true);
    if (!r.ok && !r.playing) warn(r.error);
  } finally { refreshSets(); }
};
$('#svAutoGo').onclick = () => showTab('automation');
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-go]'); if (b) showTab(b.dataset.go); });

// ---- the library table lives in the Library tab, and in this one while it is open
const crateMain = $('.crate-main');
function placeLibrary() {
  const here = document.body.dataset.dock === 'sets';
  if (here && crateMain.parentElement !== $('#svLib')) $('#svLib').append(crateMain);
  else if (!here && crateMain.parentElement !== $('.crate')) $('.crate').prepend(crateMain);
}
new MutationObserver(placeLibrary).observe(document.body, { attributes: true, attributeFilter: ['data-dock'] });
placeLibrary();

// changed from elsewhere too (dj sets, Auto-DJ marking what played): the server says so (`activeset`, ui/link.js); and
// while the Sets or Library tab is on screen, every few seconds
document.addEventListener('automation', () => { if (mixer?.automation?.mode === 'idle') refreshSets(); });
document.addEventListener('lower:open', () => { if (['sets', 'library'].includes(document.body.dataset.dock)) refreshSets(); });
setInterval(() => { if (!document.body.classList.contains('lower-collapsed') && ['sets', 'library'].includes(document.body.dataset.dock)) refreshSets(); }, 4000);
refreshSets();
