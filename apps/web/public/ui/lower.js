import { $, $$ } from './util.js';
import { ui } from './state.js';
import { onUi, saveUi } from './prefs.js';
import { hint, onBindings } from './bindings.js';

// ------------------------------------------------------------------ the bottom panel: tabs · hide / show / resize
// One bar of tabs (Library, Sets, Sampler & keys, Automation, Booth) with the open tab under it: ui.dockTab. The booth can stay pinned
// as a column beside the other two (ui.boothPinned). ui.lowerCollapsed and ui.lowerHeight (0 = automatic) hold the
// rest. The bar is also the divider: drag it to resize, double-click for the automatic height, S / M / L set a
// height. Hidden, the bar still carries the track count, downloads and the latest booth line. `peek` shows the
// panel without saving that, for when it opens by itself.
const MIN = 300, SNAP = 60, STEP = 24; // MIN is the row's automatic minimum in crate.css: the page scrolls before the crate gets shorter
const bar = $('#lowerBar'), row = $('#lower'), toggle = $('#lowerToggle');
const maxHeight = () => Math.round(innerHeight * 0.6);
const narrow = () => matchMedia('(max-width: 1100px)').matches; // the page scrolls there: nothing to resize against
let peek = false, last = null, preview = null; // preview: { collapsed, height } while the divider is being dragged

function applyLower() {
  if (ui.lowerCollapsed !== last) { last = ui.lowerCollapsed; peek = false; }
  const collapsed = preview ? preview.collapsed : ui.lowerCollapsed && !peek;
  const height = preview ? preview.height : ui.lowerHeight;
  const sized = !collapsed && height > 0 && !narrow();
  const was = document.body.classList.contains('lower-collapsed');
  document.body.classList.toggle('lower-collapsed', collapsed);
  document.body.classList.toggle('lower-sized', sized);
  row.style.flex = sized ? `0 0 ${Math.max(MIN, Math.min(maxHeight(), height))}px` : '';
  row.style.minHeight = sized ? '0' : '';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? '▴' : '▾';
  const k = hint('lower.toggle');
  toggle.title = `${collapsed ? 'Show' : 'Hide'} the bottom panel${k ? ` (${k})` : ''}`;
  bar.title = `Drag to resize the bottom panel · double-click = automatic height${k ? ` · ${k} = hide / show` : ''}`;
  applyDock();
  if (was && !collapsed) document.dispatchEvent(new Event('lower:open'));
}
// ---- which tab is open, and whether the booth is pinned beside it
const TABS = ['library', 'sets', 'sampler', 'automation', 'booth'];
export const dockTab = () => (TABS.includes(ui.dockTab) ? ui.dockTab : 'library');
export const boothShown = () => !document.body.classList.contains('lower-collapsed') && (dockTab() === 'booth' || ui.boothPinned !== false);
function applyDock() {
  const tab = dockTab(), pinned = ui.boothPinned !== false, was = document.body.dataset.dock;
  document.body.dataset.dock = tab;
  document.body.classList.toggle('booth-pinned', pinned);
  for (const b of $$('.lowerbar .tab')) b.setAttribute('aria-selected', String(b.dataset.tab === tab && !document.body.classList.contains('lower-collapsed')));
  const pin = $('#boothPin'); pin.setAttribute('aria-pressed', String(pinned));
  pin.title = pinned ? 'The booth stays beside the open tab · click to make it a tab of its own' : 'Keep the booth beside the open tab';
  const k = hint('keys.toggle'); $('.lowerbar .tab[data-tab="sampler"]').title = `Sampler pads and the chop keyboard${k ? ` (${k})` : ''}`;
  for (const b of $$('.lb-sizes button')) b.setAttribute('aria-pressed', String(!document.body.classList.contains('lower-collapsed') && Number(b.dataset.h) === ui.lowerHeight));
  if (boothShown()) { $('#lbFeed').classList.remove('unread'); $('#boothTab').classList.remove('unread'); }
  if (was && was !== tab) document.dispatchEvent(new Event('lower:open')); // a tab that was not on screen may be stale
}
// open a tab (and the panel, if it was hidden)
export function showTab(tab) {
  peek = false; last = false;
  saveUi({ dockTab: TABS.includes(tab) ? tab : 'library', lowerCollapsed: false });
}
for (const b of $$('.lowerbar .tab')) b.onclick = () => showTab(b.dataset.tab);
$('#boothPin').onclick = () => saveUi({ boothPinned: ui.boothPinned === false, dockTab: ui.boothPinned === false && dockTab() === 'booth' ? 'library' : dockTab() });
for (const b of $$('.lb-sizes button')) b.onclick = () => { peek = false; last = false; saveUi({ lowerCollapsed: false, lowerHeight: Number(b.dataset.h) }); };
onUi(applyLower);
onBindings(applyLower);

export function toggleLower(collapsed = !document.body.classList.contains('lower-collapsed')) {
  peek = false; last = collapsed;
  saveUi({ lowerCollapsed: collapsed });
}
// opened by itself (a download finished or failed): shown, but a reload still comes up collapsed
document.addEventListener('lower:peek', () => { if (ui.lowerCollapsed && !peek) { peek = true; applyLower(); } });

toggle.onclick = () => toggleLower();
$('#lbFeed').onclick = () => showTab(ui.boothPinned !== false ? dockTab() : 'booth');

// ---- the divider
let drag = null;
bar.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || narrow() || document.body.classList.contains('lower-max')) return;
  drag = { y: e.clientY, h: row.offsetHeight, moved: false }; // from where the row is now: the page may be scrolled
  bar.setPointerCapture(e.pointerId);
});
bar.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientY - drag.y) < 4) return;
  drag.moved = true;
  const h = drag.h + drag.y - e.clientY;
  preview = h < MIN - SNAP ? { collapsed: true, height: ui.lowerHeight } : { collapsed: false, height: Math.max(MIN, Math.min(maxHeight(), Math.round(h))) };
  applyLower();
});
const drop = () => {
  if (!drag) return;
  const p = preview; drag = null; preview = null;
  if (!p) return;
  peek = false; last = p.collapsed;
  saveUi(p.collapsed ? { lowerCollapsed: true } : { lowerCollapsed: false, lowerHeight: Math.min(p.height, row.offsetHeight) });
};
bar.addEventListener('pointerup', drop); bar.addEventListener('pointercancel', drop);
bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button') && !document.body.classList.contains('lower-max')) { peek = false; last = false; saveUi({ lowerCollapsed: false, lowerHeight: 0 }); } });
bar.addEventListener('keydown', (e) => {
  if (e.target !== bar) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLower(); return; }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  if (narrow() || document.body.classList.contains('lower-max')) return;
  if (document.body.classList.contains('lower-collapsed')) { if (e.key === 'ArrowUp') toggleLower(false); return; }
  const h = row.offsetHeight + (e.key === 'ArrowUp' ? STEP : -STEP);
  if (h < MIN) toggleLower(true); else saveUi({ lowerHeight: Math.min(maxHeight(), h) });
});
window.addEventListener('resize', applyLower);
