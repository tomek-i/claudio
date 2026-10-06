import { $ } from './util.js';
import { ui } from './state.js';
import { onUi, saveUi } from './prefs.js';
import { hint, onBindings } from './bindings.js';

// ------------------------------------------------------------------ the lower row (crate + booth): hide / show / resize
// ui.lowerCollapsed and ui.lowerHeight (0 = automatic) hold the saved state. The bar above the row is the divider:
// drag it to resize, double-click for the automatic height, and collapsed it carries the summary (track count,
// downloads, the latest booth line). `peek` shows the row without saving that, for when it opens by itself.
const MIN = 140, SNAP = 60, STEP = 24;
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
  if (sized) {
    // taller than the page can give without scrolling (the rig has a minimum height): hand the overflow back
    const over = document.body.scrollHeight - document.body.clientHeight;
    if (over > 0) row.style.flex = `0 0 ${Math.max(MIN, row.offsetHeight - over)}px`;
  }
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? '▴' : '▾';
  const k = hint('lower.toggle');
  toggle.title = `${collapsed ? 'Show' : 'Hide'} the crate and booth${k ? ` (${k})` : ''}`;
  bar.title = `Drag to resize the crate and booth · double-click = automatic height · arrow keys resize${k ? ` · ${k} = hide / show` : ''}`;
  if (was && !collapsed) { $('#lbFeed').classList.remove('unread'); document.dispatchEvent(new Event('lower:open')); }
}
onUi(applyLower);
onBindings(applyLower);

export function toggleLower(collapsed = !document.body.classList.contains('lower-collapsed')) {
  peek = false; last = collapsed;
  saveUi({ lowerCollapsed: collapsed });
}
// opened by itself (a download finished or failed): shown, but a reload still comes up collapsed
document.addEventListener('lower:peek', () => { if (ui.lowerCollapsed && !peek) { peek = true; applyLower(); } });

toggle.onclick = () => toggleLower();
$('#lbCrate').onclick = $('#lbFeed').onclick = () => toggleLower(false);

// ---- the divider
let drag = null;
bar.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || narrow()) return;
  drag = { y: e.clientY, moved: false };
  bar.setPointerCapture(e.pointerId);
});
bar.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.abs(e.clientY - drag.y) < 4) return;
  drag.moved = true;
  const h = innerHeight - e.clientY - bar.offsetHeight / 2; // the row is the last thing on the page
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
bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) { peek = false; last = false; saveUi({ lowerCollapsed: false, lowerHeight: 0 }); } });
bar.addEventListener('keydown', (e) => {
  if (e.target !== bar) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLower(); return; }
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  if (narrow()) return;
  if (document.body.classList.contains('lower-collapsed')) { if (e.key === 'ArrowUp') toggleLower(false); return; }
  const h = row.offsetHeight + (e.key === 'ArrowUp' ? STEP : -STEP);
  if (h < MIN) toggleLower(true); else saveUi({ lowerHeight: Math.min(maxHeight(), h) });
});
window.addEventListener('resize', applyLower);
