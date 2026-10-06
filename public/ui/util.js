// Small DOM / formatting / fetch helpers shared by every UI module.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const mmss = (s) => (s == null || isNaN(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
export const camelotColor = (c) => {
  const m = /^(\d+)([AB])$/.exec(c || '');
  if (!m) return '#666';
  return `hsl(${((Number(m[1]) - 1) * 30 + 90) % 360} ${m[2] === 'B' ? 75 : 65}% ${m[2] === 'B' ? 68 : 58}%)`;
};
export const compatible = (a, b) => {
  const x = /^(\d+)([AB])$/.exec(a || ''), y = /^(\d+)([AB])$/.exec(b || '');
  if (!x || !y) return false;
  const d = Math.min((x[1] - y[1] + 12) % 12, (y[1] - x[1] + 12) % 12);
  return (x[2] === y[2] && d <= 1) || (x[2] !== y[2] && d === 0);
};
export const post = (p, body) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
