import { $ } from './util.js';
import { ui } from './state.js';
import { onUi } from './prefs.js';
import { toggleLower } from './lower.js';
import { toggleKeys } from './keys.js';

// ------------------------------------------------------------------ maximise a section (crate + booth, or sampler + keys)
// The section covers the whole page until its button is clicked again (or Esc). One at a time, and not saved: a reload
// comes up normal. Maximising a hidden section shows it for that long; hiding a maximised one puts it back first.
const SECTIONS = {
  lower: { btn: $('#lowerMax'), what: 'crate and booth', show: (on) => toggleLower(!on), hidden: () => ui.lowerCollapsed },
  keys: { btn: $('#keysMax'), what: 'sampler and chop keyboard', show: (on) => toggleKeys(!on), hidden: () => ui.keysCollapsed },
};
let current = null, rehide = false; // rehide: the section was hidden when it was maximised

export function setMax(which) {
  const prev = current, again = rehide;
  current = SECTIONS[which] ? which : null; rehide = false;
  if (again && prev !== current && !SECTIONS[prev].hidden()) SECTIONS[prev].show(false);
  for (const [name, s] of Object.entries(SECTIONS)) {
    const on = name === current;
    document.body.classList.toggle(`${name}-max`, on);
    s.btn.textContent = on ? '⤡' : '⤢';
    s.btn.setAttribute('aria-pressed', String(on));
    s.btn.title = on ? `Back to the normal size (Esc)` : `Maximise the ${s.what}`;
  }
}
for (const [name, s] of Object.entries(SECTIONS)) s.btn.onclick = () => {
  if (current === name) return setMax(null);
  const was = s.hidden();
  if (was) s.show(true);
  setMax(name); rehide = was;
};
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) setMax(null); });
onUi(() => { if (current && SECTIONS[current].hidden()) setMax(null); });
setMax(null);
