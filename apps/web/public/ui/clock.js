// The clock in the header: how long the current set has been running, and the time of day.
// The start of the set is the server's (`hello`, then `set` whenever it changes: apps/server/lib/set-clock.mjs), so
// a reload keeps it and two pages agree. Drawn once a second, on the second, and not at all while the page is hidden.
import { $ } from './util.js';

const el = $('#topClock');
let start = null; // when the set started, on this machine's clock; null = no set

// s: { start, now } in the server's time. Another device's clock may be minutes off the server's, so the start is
// moved by the difference instead of being compared with a clock it was not read from.
export function receiveSet(s) {
  start = s?.start != null ? s.start + (Date.now() - (s.now ?? Date.now())) : null;
  draw();
}

const two = (n) => String(n).padStart(2, '0');
const setText = (node, txt) => { if (node.textContent !== txt) node.textContent = txt; };
function draw() {
  const now = Date.now();
  const s = start == null ? null : Math.max(0, Math.floor((now - start) / 1000));
  setText($('.set b', el), s == null ? '—' : `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`);
  setText($('.now', el), new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); // 12 or 24 hours: the browser's locale
}

let timer = 0;
function tick() {
  draw();
  timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5); // just after the second turns, so no second is shown twice
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden) tick();
});
if (!document.hidden) tick();
