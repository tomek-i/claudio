import { DECKS } from '../engine.js';
import { $, mmss, camelotColor, compatible, post, esc } from './util.js';
import { mixer, liveDeck } from './state.js';
import { requestLoad } from './loader.js';
import { addFeed } from './booth.js';

// ------------------------------------------------------------------ crate
let library = [];
let historyIds = new Set();
export async function loadLibrary() {
  const r = await fetch('/api/library').then((x) => x.json());
  library = r.tracks;
  const st = r.status;
  $('#libCount').textContent = $('#lbCount').textContent = `${library.length} tracks${st.analyzing || st.queued ? ` · analysing ${st.analyzing + st.queued}` : ''}`;
  renderLibrary(true);
}
export async function refreshHistory() {
  const h = await fetch('/api/history').then((x) => x.json());
  historyIds = new Set(h.map((x) => x.id));
}
let lastLibKey = '';
let stale = false; // the table was not rendered while the row was hidden
document.addEventListener('lower:open', () => { if (stale) renderLibrary(true); });
export function renderLibrary(force) {
  if (document.body.classList.contains('lower-collapsed')) { stale = true; return; }
  stale = false;
  const q = $('#search').value.trim().toLowerCase();
  const live = mixer?.xfader ? liveDeck() : null;
  const ref = live?.track;
  const loaded = mixer ? Object.values(mixer.decks).map((d) => d.track?.id) : [];
  const key = [q, ref?.id, loaded.join(), library.length, historyIds.size].join('|');
  if (!force && key === lastLibKey) return;
  lastLibKey = key;
  const terms = q.split(/\s+/).filter(Boolean);
  const rows = library.filter((t) => {
    const hay = `${t.artist} ${t.title} ${t.camelot} ${Math.round(t.bpm)} ${t.genre || ''}`.toLowerCase();
    return terms.every((w) => hay.includes(w));
  });
  $('#libEmpty').classList.toggle('hide', library.length > 0);
  $('#lib tbody').innerHTML = rows.map((t) => {
    const fitKey = ref && compatible(ref.camelot, t.camelot);
    const bpmOk = ref && Math.min(...[t.bpm, t.bpm * 2, t.bpm / 2].map((b) => Math.abs(b - live.effBpm) / live.effBpm)) < 0.06;
    const cls = [ref && t.id !== ref.id && fitKey && bpmOk ? 'match' : ref && (fitKey || bpmOk) ? 'near' : '', historyIds.has(t.id) ? 'played' : '', loaded.includes(t.id) ? 'loaded' : ''].join(' ');
    return `<tr class="${cls}" data-id="${t.id}" draggable="true">
      <td class="fit"></td>
      <td class="name">${esc(t.title)}${t.stems ? ' <span class="stemtag" title="stems available">STEMS</span>' : ''}<small>${esc(t.artist || '')}</small></td>
      <td>${t.bpm.toFixed(1)}</td>
      <td><span class="keychip" style="background:${camelotColor(t.camelot)}">${t.camelot}</span></td>
      <td><span class="ebar"><i style="width:${t.energy * 10}%"></i></span> ${t.energy}</td>
      <td>${mmss(t.duration)}</td>
      <td>${DECKS.map((n) => `<button class="ld ${n.toLowerCase()}" data-deck="${n}">${n}</button>`).join('')}</td></tr>`;
  }).join('');
}
$('#search').oninput = () => renderLibrary(true);
// the row's load buttons: a playing deck takes Shift-click, or on a touch screen a confirm on the deck
$('#lib').addEventListener('click', (e) => {
  const b = e.target.closest('.ld'); if (!b) return;
  requestLoad(b.dataset.deck, b.closest('tr').dataset.id, { force: e.shiftKey, touch: e.pointerType === 'touch' });
});

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
  let el = $(`#job-${j.id}`);
  if (!el) { el = document.createElement('div'); el.id = `job-${j.id}`; $('#jobs').prepend(el); }
  el.className = `job ${j.status}`;
  const label = j.tracks?.length ? j.tracks.map((t) => t.title).join(', ') : j.input;
  el.innerHTML = `<span>${esc(label)}</span><span class="bar"><i style="width:${Math.round((j.progress || 0) * 100)}%"></i></span><span>${j.status}${j.error ? ': ' + esc(j.error).slice(0, 60) : ''}</span>`;
  if (j.status === 'ready') setTimeout(() => el.remove(), 8000);
  if (j.status === 'error') setTimeout(() => el.remove(), 20000);
}
