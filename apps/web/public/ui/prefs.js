import { post } from './util.js';
import { ui } from './state.js';

// ------------------------------------------------------------------ the ui.* settings, on the page
// The server is the source of truth (config.json, sent in the `hello` and `ui` events). A copy in localStorage lets
// the page come up in its last state on first paint, before `hello` arrives. Modules register an apply function with
// onUi(); anything the page itself changes (the lower row, the waveform zoom) goes through saveUi(), which writes it back.
const LS = 'djUi';
try { Object.assign(ui, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { /* no stored copy */ }

// a setting the page is in the middle of changing (a zoom gesture) is not overwritten by what the server sends
const held = new Set();
export const holdUi = (key, on) => (on ? held.add(key) : held.delete(key));
export function receiveUi(values) {
  for (const [k, v] of Object.entries(values)) if (!held.has(k)) ui[k] = v;
  applyUi();
}

const appliers = [];
export function onUi(fn) { appliers.push(fn); fn(); }
export function applyUi() {
  for (const fn of appliers) fn();
  try { localStorage.setItem(LS, JSON.stringify(ui)); } catch { /* storage is off */ }
}
export function saveUi(patch) {
  Object.assign(ui, patch);
  applyUi();
  post('/api/settings', Object.fromEntries(Object.entries(patch).map(([k, v]) => [`ui.${k}`, v]))).catch(() => {});
}
