import { $, post, esc } from './util.js';
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
$('#ask').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#askInput').value.trim(); if (!text) return;
  $('#askInput').value = '';
  await post('/api/inbox', { text, from: 'you' });
};
