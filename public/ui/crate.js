import { DECKS } from '../engine.js';
import { $, $$, mmss, camelotColor, compatible, post, esc } from './util.js';
import { mixer, liveDeck } from './state.js';
import { requestLoad } from './loader.js';
import { addFeed } from './booth.js';

// ------------------------------------------------------------------ crate
let library = [], libStatus = '';
let historyIds = new Set();
export async function loadLibrary() {
  const r = await fetch('/api/library').then((x) => x.json());
  library = r.tracks;
  const st = r.status;
  libStatus = `${library.length} tracks${st.analyzing || st.queued ? ` · analysing ${st.analyzing + st.queued}` : ''}`;
  $('#lbCount').textContent = String(library.length);
  if (!library.length) { $('#grabRow').hidden = false; $('#addBtn').setAttribute('aria-expanded', 'true'); } // an empty crate starts with the way to fill it
  renderLibrary(true);
}
export async function refreshHistory() {
  const h = await fetch('/api/history').then((x) => x.json());
  historyIds = new Set(h.map((x) => x.id));
}
// ---- what the table shows: the search box, four filters and a sort (kept in this browser)
// bpm / key compare with the live deck, so they do nothing until one plays. energy: 0 any · 1 low · 2 mid · 3 high.
const LS = 'djCrate', ENERGY = [['Energy', () => true], ['Energy: low', (e) => e <= 4], ['Energy: mid', (e) => e >= 5 && e <= 7], ['Energy: high', (e) => e >= 8]];
const view = { bpm: false, key: false, energy: 0, fresh: false, sort: 'added', desc: false };
try { Object.assign(view, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* no saved view */ }
const saveView = () => { try { localStorage.setItem(LS, JSON.stringify(view)); } catch { /* storage is off */ } };
const camelotOrder = (c) => { const m = /^(\d+)([AB])$/.exec(c || ''); return m ? Number(m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : 99; };
const SORTS = { title: (a, b) => `${a.title}`.localeCompare(`${b.title}`), bpm: (a, b) => a.bpm - b.bpm, key: (a, b) => camelotOrder(a.camelot) - camelotOrder(b.camelot), energy: (a, b) => a.energy - b.energy };
function showView(hasLive) {
  for (const b of $$('#libFilters button')) {
    const f = b.dataset.f, on = f === 'energy' ? view.energy > 0 : !!view[f];
    b.setAttribute('aria-pressed', String(on));
    if (f === 'energy') b.textContent = ENERGY[view.energy][0];
    if (f === 'bpm' || f === 'key') b.classList.toggle('idle', on && !hasLive); // on, but nothing is playing to compare with
  }
  $('#libSort').value = view.sort;
  for (const th of $$('#lib th[data-sort]')) th.dataset.dir = th.dataset.sort === view.sort ? (view.desc ? 'desc' : 'asc') : '';
}
for (const b of $$('#libFilters button')) b.onclick = () => {
  const f = b.dataset.f;
  if (f === 'energy') view.energy = (view.energy + 1) % ENERGY.length; else view[f] = !view[f];
  saveView(); renderLibrary(true);
};
$('#libSort').onchange = (e) => { view.sort = e.target.value; view.desc = false; saveView(); renderLibrary(true); };
for (const th of $$('#lib th[data-sort]')) th.onclick = () => {
  if (view.sort === th.dataset.sort) view.desc = !view.desc; else { view.sort = th.dataset.sort; view.desc = false; }
  saveView(); renderLibrary(true);
};

let lastLibKey = '';
let stale = false; // the table was not rendered while the row was hidden
document.addEventListener('lower:open', () => { if (stale) renderLibrary(true); refreshQueue(); });
export function renderLibrary(force) {
  if (document.body.classList.contains('lower-collapsed') || document.body.dataset.dock !== 'library') { stale = true; return; }
  stale = false;
  const q = $('#search').value.trim().toLowerCase();
  const live = mixer?.xfader ? liveDeck() : null;
  const ref = live?.track;
  const loaded = mixer ? Object.values(mixer.decks).map((d) => d.track?.id) : [];
  const key = [q, ref?.id, loaded.join(), library.length, historyIds.size, JSON.stringify(view), queueIds.join()].join('|');
  if (!force && key === lastLibKey) return;
  lastLibKey = key;
  showView(!!ref);
  const terms = q.split(/\s+/).filter(Boolean);
  const fits = (t) => ({
    key: !!ref && compatible(ref.camelot, t.camelot),
    bpm: !!ref && Math.min(...[t.bpm, t.bpm * 2, t.bpm / 2].map((b) => Math.abs(b - live.effBpm) / live.effBpm)) < 0.06,
  });
  let rows = library.filter((t) => {
    const hay = `${t.artist} ${t.title} ${t.camelot} ${Math.round(t.bpm)} ${t.genre || ''}`.toLowerCase();
    if (!terms.every((w) => hay.includes(w))) return false;
    if (!ENERGY[view.energy][1](t.energy)) return false;
    if (view.fresh && historyIds.has(t.id)) return false;
    if (ref && (view.bpm || view.key)) { const f = fits(t); if ((view.bpm && !f.bpm) || (view.key && !f.key)) return false; }
    return true;
  });
  if (SORTS[view.sort]) rows = rows.slice().sort(SORTS[view.sort]);
  if (view.desc) rows.reverse();
  $('#libEmpty').classList.toggle('hide', library.length > 0);
  $('#libCount').textContent = rows.length === library.length ? libStatus : `${rows.length} of ${libStatus}`;
  $('#lib tbody').innerHTML = rows.map((t) => {
    const f = fits(t);
    const cls = [ref && t.id !== ref.id && f.key && f.bpm ? 'match' : ref && (f.key || f.bpm) ? 'near' : '', historyIds.has(t.id) ? 'played' : '', loaded.includes(t.id) ? 'loaded' : ''].join(' ');
    return `<tr class="${cls}" data-id="${t.id}" draggable="true">
      <td class="fit"></td>
      <td class="load">${DECKS.map((n) => `<button class="ld ${n.toLowerCase()}" data-deck="${n}" title="Load on deck ${n}">${n}</button>`).join('')}</td>
      <td class="name">${esc(t.title)} <small>${esc(t.artist || '')}</small>${t.stems ? ' <span class="stemtag" title="stems available">STEMS</span>' : ''}</td>
      <td>${t.bpm.toFixed(1)}</td>
      <td><span class="keychip" style="background:${camelotColor(t.camelot)}">${t.camelot}</span></td>
      <td><span class="ebar"><i style="width:${t.energy * 10}%"></i></span> ${t.energy}</td>
      <td>${mmss(t.duration)}</td>
      <td><button class="qadd" title="${queueIds.includes(t.id) ? 'In the queue' : 'Add to the queue (up next)'}"${queueIds.includes(t.id) ? ' disabled' : ''}>${queueIds.includes(t.id) ? 'queued' : '+ queue'}</button></td></tr>`;
  }).join('');
}
$('#search').oninput = () => renderLibrary(true);
// the row's load buttons: a playing deck takes Shift-click, or on a touch screen a confirm on the deck
$('#lib').addEventListener('click', async (e) => {
  const add = e.target.closest('.qadd');
  if (add) { await post('/api/queue', { add: [add.closest('tr').dataset.id] }).catch(() => {}); return refreshQueue(); }
  const b = e.target.closest('.ld'); if (!b) return;
  requestLoad(b.dataset.deck, b.closest('tr').dataset.id, { force: e.shiftKey, touch: e.pointerType === 'touch' });
});
// "Add music": the fetch row is only there while it is wanted (and while something is downloading)
$('#addBtn').onclick = () => { const row = $('#grabRow'); row.hidden = !row.hidden; $('#addBtn').setAttribute('aria-expanded', String(!row.hidden)); if (!row.hidden) $('#grabInput').focus(); };

// ---- up next: the queue (dj queue, or "+ queue" on a row) and the track auto-DJ has cued. Asked for while the
// library is on screen, every few seconds: both are changed from outside the page too.
let queueIds = [];
async function refreshQueue() {
  if (document.body.classList.contains('lower-collapsed') || document.body.dataset.dock !== 'library') return;
  let queue, state;
  try { [queue, state] = await Promise.all([fetch('/api/queue').then((r) => r.json()), fetch('/api/state').then((r) => r.json())]); } catch { return; }
  const prep = state.autoDJ?.enabled ? state.autoDJ.prepared : null, prepTrack = prep && library.find((t) => t.id === prep.track);
  const item = (t, tag, i) => `<div class="un${tag ? ' auto' : ''}"><b>${tag || i + 1}</b><span>${esc(t.title)}<small>${esc(t.artist || '')}</small></span>${tag ? '' : `<button data-i="${i + 1}" title="Take it out of the queue">×</button>`}</div>`;
  $('#upnext').innerHTML = (prepTrack ? item(prepTrack, `deck ${prep.deck}`) : '') + queue.map((t, i) => item(t, '', i)).join('')
    || `<p class="hint">Nothing queued. Use “+ queue” on a track, or ask Claude.${state.autoDJ?.enabled ? ' Auto-DJ picks the next track by itself when the music is about to run out.' : ''}</p>`;
  $('#queueClear').hidden = !queue.length;
  const ids = queue.map((t) => t.id);
  if (ids.join() !== queueIds.join()) { queueIds = ids; renderLibrary(true); }
}
$('#upnext').addEventListener('click', async (e) => { const b = e.target.closest('button[data-i]'); if (b) { await post('/api/queue', { remove: Number(b.dataset.i) }).catch(() => {}); refreshQueue(); } });
$('#queueClear').onclick = async () => { await post('/api/queue', { clear: true }).catch(() => {}); refreshQueue(); };
setInterval(refreshQueue, 4000);

// ------------------------------------------------------------------ demo tracks (the button on an empty crate)
export function renderStarter(job) {
  if (!job) return;
  const btn = $('#starterBtn'), n = job.failed.length;
  btn.disabled = job.running;
  btn.textContent = job.running ? `Downloading ${Math.min(job.done + 1, job.total)} of ${job.total}…` : n || job.error ? 'Try again' : 'Download demo tracks';
  if (job.running) $('#starterMsg').textContent = 'Tracks appear here as each one is downloaded and analysed.';
  else if (job.error) $('#starterMsg').textContent = `The download stopped: ${job.error}`;
  else if (n) $('#starterMsg').textContent = `${n} of ${job.total} could not be downloaded. Their links are in the booth log.`;
  else $('#starterMsg').textContent = 'Downloaded. Analysing…';
}
$('#starterBtn').onclick = async () => {
  $('#starterBtn').disabled = true;
  try { renderStarter((await post('/api/starter', {})).job); }
  catch { $('#starterBtn').disabled = false; $('#starterMsg').textContent = 'The server did not answer.'; }
};
fetch('/api/starter').then((r) => r.json()).then((s) => {
  $('#starterBtn').textContent = `Download ${s.tracks} demo tracks`;
  $('#starterMsg').textContent = `${Math.round(s.bytes / 1e6)} MB of Creative Commons music (hip-hop, house, techno, drum & bass), free to use.`;
  renderStarter(s.job?.running ? s.job : null);
}).catch(() => {});

// ------------------------------------------------------------------ downloads
async function grab() {
  const input = $('#grabInput').value.trim(); if (!input) return;
  $('#grabInput').value = '';
  const r = await post('/api/download', { input, playlist: $('#grabPlaylist').checked });
  if (r.error) addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${r.error}` });
}
$('#grabBtn').onclick = grab;
$('#grabInput').onkeydown = (e) => e.key === 'Enter' && grab();
const jobStates = new Map(); // id -> status, for the summary on the collapsed bar
function summariseJobs(j) {
  const done = j.status === 'ready' || j.status === 'error';
  if (done && jobStates.get(j.id) !== j.status) document.dispatchEvent(new Event('lower:peek')); // show the new track or the error
  jobStates.set(j.id, j.status);
  if (done) setTimeout(() => { jobStates.delete(j.id); showJobs(); }, j.status === 'ready' ? 8000 : 20000);
  showJobs();
}
function showJobs() {
  const all = [...jobStates.values()], failed = all.filter((s) => s === 'error').length, active = all.filter((s) => s !== 'error' && s !== 'ready').length;
  const el = $('#lbJobs');
  el.textContent = failed ? `! ${failed} failed` : active ? `↓ ${active} downloading` : '';
  el.classList.toggle('bad', failed > 0);
}
export function renderJob(j) {
  summariseJobs(j);
  $('#grabRow').hidden = false; // a download in progress shows beside the box it was asked from
  let el = $(`#job-${j.id}`);
  if (!el) { el = document.createElement('div'); el.id = `job-${j.id}`; $('#jobs').prepend(el); }
  el.className = `job ${j.status}`;
  const label = j.tracks?.length ? j.tracks.map((t) => t.title).join(', ') : j.input;
  el.innerHTML = `<span>${esc(label)}</span><span class="bar"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></span><span>${j.status}${j.error ? ': ' + esc(j.error).slice(0, 60) : ''}</span>`;
  if (j.status === 'ready') setTimeout(() => el.remove(), 8000);
  if (j.status === 'error') setTimeout(() => el.remove(), 20000);
}
