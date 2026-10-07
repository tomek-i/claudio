import { ACTIONS, ACTION, CHOP_IDS, effective, bindingOf, bindingLabel } from '/keymap.mjs';
import { $, esc } from './util.js';
import { ui } from './state.js';
import { onUi } from './prefs.js';

// ------------------------------------------------------------------ key bindings on the DJ page
// ui.keys holds the overrides (config.json → the `hello` and `ui` events); the registry in /keymap.mjs fills in the
// rest. Everything on the page that names a key (tooltips, the piano, the shortcut list) asks hint(), so a changed
// binding shows everywhere at once.
let current = effective({}), byBinding = new Map(), layout = null;
const listeners = [];
export function onBindings(fn) { listeners.push(fn); fn(); }
function rebuild() {
  current = effective(ui.keys);
  byBinding = new Map(ACTIONS.filter((a) => current[a.id]).map((a) => [current[a.id], a]));
  for (const fn of listeners) fn();
}
onUi(rebuild);
// the characters this keyboard's keys produce, where the browser will tell us (else US labels)
navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m; rebuild(); }).catch(() => {});

export const actionFor = (e) => byBinding.get(bindingOf(e));
export const hint = (id) => bindingLabel(current[id], layout); // '' when the action has no key

// ---- the shortcut list: read-only, opened from the keyboard button in the header
const box = $('#shortcuts');
function renderShortcuts() {
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  const row = (label, keys) => `<tr><td>${esc(label)}</td><td><kbd>${esc(keys)}</kbd></td></tr>`;
  $('#shortcutList').innerHTML = groups.map((g) => {
    const acts = ACTIONS.filter((a) => a.group === g && !CHOP_IDS.includes(a.id));
    const notes = g === ACTION[CHOP_IDS[0]].group ? row('Notes, low to high', CHOP_IDS.map((id) => hint(id) || '·').join(' ')) : '';
    const bound = acts.filter((a) => hint(a.id)), unbound = acts.length - bound.length;
    return `<h3>${esc(g)}</h3><table>${notes}${bound.map((a) => row(a.label, hint(a.id))).join('')}</table>${unbound ? `<p class="more">${unbound} more without a key</p>` : ''}`;
  }).join('');
}
export function toggleShortcuts(show = box.classList.contains('hide')) {
  if (show) renderShortcuts();
  box.classList.toggle('hide', !show);
}
onBindings(() => { if (!box.classList.contains('hide')) renderShortcuts(); });
$('#keysBtn').onclick = () => toggleShortcuts();
$('#shortcutsClose').onclick = () => toggleShortcuts(false);
box.addEventListener('click', (e) => { if (e.target === box) toggleShortcuts(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.classList.contains('hide')) toggleShortcuts(false); });
