import { $, $$, post, esc } from './util.js';
import { boothShown } from './lower.js';

// ------------------------------------------------------------------ booth
export function addFeed(e) {
  const el = document.createElement('div');
  el.className = `msg ${e.kind}`;
  el.innerHTML = `<time>${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>${esc(e.text)}`;
  const feed = $('#feed');
  const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  feed.append(el);
  while (feed.children.length > 200) feed.firstChild.remove();
  if (stick) feed.scrollTop = feed.scrollHeight;
  // the collapsed bar carries the latest line, marked unread while the feed is hidden
  const line = $('#lbFeed');
  line.textContent = e.text;
  if (!boothShown()) { line.classList.add('unread'); $('#boothTab').classList.add('unread'); }
}
// ---- which lines the log shows (kept in this browser). Main leaves out the raw commands.
const LS = 'djBoothShow';
function showOnly(kind) {
  const feed = $('#feed'); feed.dataset.show = kind;
  for (const b of $$('#feedFilters button')) b.setAttribute('aria-pressed', String(b.dataset.show === kind));
  feed.scrollTop = feed.scrollHeight;
  try { localStorage.setItem(LS, kind); } catch { /* storage is off */ }
}
for (const b of $$('#feedFilters button')) b.onclick = () => showOnly(b.dataset.show);
{ let k = 'main'; try { k = localStorage.getItem(LS) || 'main'; } catch { /* storage is off */ } showOnly(['main', 'claude', 'action', 'system', 'all'].includes(k) ? k : 'main'); }

// ---- now and next, pinned above the log. Read from the server's state every two seconds while the booth is on
// screen: a running transition first, then the track auto-DJ has cued, then the head of the queue.
let next = null; // { kind: 'auto' | 'queue', title }
async function refreshNowNext() {
  if (!boothShown()) return;
  let s, queue; try { [s, queue] = await Promise.all([fetch('/api/state').then((r) => r.json()), fetch('/api/queue').then((r) => r.json())]); } catch { return; }
  const decks = s.decks || {}, name = (d) => (d?.title ? `${d.artist ? `${d.artist} · ` : ''}${d.title}` : null);
  const live = decks[s.live] || Object.values(decks).find((d) => d.playing);
  $('#nnNow').textContent = name(live) || '—';
  const tr = s.transition, prep = s.autoDJ?.enabled ? s.autoDJ.prepared : null, q = queue[0];
  let title = '—', sub = s.plan?.pending ? `${s.plan.pending} planned step${s.plan.pending === 1 ? '' : 's'}` : 'nothing planned';
  next = null;
  if (tr) { title = name(decks[tr.to]) || `deck ${tr.to}`; sub = `${String(tr.style || 'mix')} in progress${tr.endAt ? ` · ${Math.max(0, Math.round((tr.endAt - Date.now()) / 1000))}s` : ''}`; }
  else if (prep) { title = name(decks[prep.deck]) || 'cued'; next = { kind: 'auto', title }; sub = `auto-DJ · on deck ${prep.deck}${live?.untilMixOut > 0 ? ` · mix-out in ${Math.floor(live.untilMixOut / 60)}:${String(Math.floor(live.untilMixOut % 60)).padStart(2, '0')}` : ''}`; }
  else if (q) { title = `${q.artist ? `${q.artist} · ` : ''}${q.title}`; next = { kind: 'queue', title }; sub = 'from the queue'; }
  $('#nnNext').textContent = title; $('#nnSub').textContent = sub;
  $('#nnSkip').hidden = $('#nnChange').hidden = !next;
}
$('#nnSkip').onclick = async () => { await post('/api/autodj', { skip: true }).catch(() => {}); refreshNowNext(); };
$('#nnChange').onclick = async () => { if (next) await post('/api/inbox', { text: `Change the next track: something other than "${next.title}".`, from: 'you' }).catch(() => {}); };
setInterval(refreshNowNext, 2000);
document.addEventListener('lower:open', refreshNowNext);

$('#ask').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#askInput').value.trim(); if (!text) return;
  $('#askInput').value = '';
  await post('/api/inbox', { text, from: 'you' });
};
