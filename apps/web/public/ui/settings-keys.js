// The key bindings editor on /settings. It edits a full binding set in memory and hands settings.js the two values
// it saves with everything else: the overrides (keys.bindings) and the user's presets (keys.presets).
import { ACTIONS, ACTION, CHOP_IDS, effective, toOverrides, bindingOf, bindingLabel, bindingError, validateBindings, awkward } from '/keymap.mjs';
import { $, esc } from './util.js';

let root = null, onChange = () => {};
let full = effective({}), presets = {}, builtin = [];
let undo = null;      // the set before the last preset / import / reset, until the page is left
let capture = null;   // { id } while waiting for a key · { remap: [...keys so far], before } while re-mapping the row
let message = null;   // { text, bad, buttons: [{ label, run }] }
let filter = '', layout = null;
let selected = null; // the preset to show as picked on the next draw (after a rename)

navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m; if (root) draw(); }).catch(() => {});
fetch('/api/keypresets').then((r) => r.json()).then((r) => { builtin = r.presets || []; if (root) draw(); }).catch(() => {});

const label = (b) => bindingLabel(b, layout);
const ownerOf = (b, except) => ACTIONS.find((a) => a.id !== except && full[a.id] === b);
const say = (text, { bad = false, buttons = [] } = {}) => { message = text ? { text, bad, buttons } : null; };
function replaceAll(next, what) {
  undo = { full: { ...full }, what };
  full = next; capture = null;
  say(`${what.replace(/\.$/, '')}. Save changes to keep it.`, { buttons: [{ label: 'Undo', run: undoLast }] });
  changedSet();
}
function undoLast() { if (!undo) return; full = undo.full; undo = null; say(''); changedSet(); }
function changedSet() { draw(); onChange(); }

export function mount(el, values, changed) {
  root = el; onChange = changed;
  full = effective(values.bindings); presets = structuredClone(values.presets || {});
  capture = null; message = null;
  draw();
}
export const bindings = () => toOverrides(full);
export const userPresets = () => presets;

function draw() {
  const q = filter.trim().toLowerCase();
  const groups = [...new Set(ACTIONS.map((a) => a.group))];
  const rows = (g) => ACTIONS.filter((a) => a.group === g && (!q || `${a.label} ${a.group} ${label(full[a.id])}`.toLowerCase().includes(q))).map((a) => {
    const b = full[a.id], waiting = capture?.id === a.id || (capture?.remap && CHOP_IDS[capture.remap.length] === a.id);
    return `<div class="krow${b !== a.def ? ' changed' : ''}${waiting ? ' waiting' : ''}" data-id="${a.id}">
      <span class="kname">${esc(a.label)}${b !== a.def ? ' <i title="Differs from the default">*</i>' : ''}</span>
      <button type="button" class="kkey" data-act="capture" title="Click, then press the new key (Esc cancels)">${waiting ? 'press a key…' : b ? esc(label(b)) : '<span class="none">no key</span>'}</button>
      <button type="button" class="kbtn" data-act="clear" title="Remove the key"${b ? '' : ' disabled'}>×</button>
      <button type="button" class="kbtn" data-act="reset" title="Back to the default (${a.def ? esc(label(a.def)) : 'no key'})"${b !== a.def ? '' : ' disabled'}>↺</button>
    </div>`;
  }).join('');
  const sel = selected ?? $('.kpreset', root)?.value; selected = null;
  const opt = (kind, name) => `<option value="${kind}:${esc(name)}"${sel === `${kind}:${name}` ? ' selected' : ''}>${esc(name)}</option>`;
  const mine = Object.keys(presets), isMine = !!sel?.startsWith('user:') && sel.slice(5) in presets;
  root.innerHTML = `
    <div class="kbar">
      <input type="search" class="ksearch" placeholder="Filter the list…" value="${esc(filter)}" aria-label="Filter key bindings">
      <span class="kgroup"><select class="kpreset" aria-label="Preset"><optgroup label="Built in">${builtin.map((p) => opt('builtin', p.name)).join('')}</optgroup>${mine.length ? `<optgroup label="Yours">${mine.map((n) => opt('user', n)).join('')}</optgroup>` : ''}</select>
        <button type="button" class="btn sm" data-act="apply">Apply</button>
        <button type="button" class="btn sm" data-act="rename"${isMine ? '' : ' disabled'}>Rename</button>
        <button type="button" class="btn sm" data-act="delete"${isMine ? '' : ' disabled'}>Delete</button></span>
      <button type="button" class="btn sm" data-act="saveas">Save as preset…</button>
      <span class="kgroup"><button type="button" class="btn sm" data-act="import">Import…</button>
        <button type="button" class="btn sm" data-act="export">Export</button></span>
      <button type="button" class="btn sm" data-act="remap" title="Press the 18 chop keyboard keys in order, low to high">Re-map the chop row…</button>
      <button type="button" class="btn sm" data-act="resetall">Reset all</button>
      <input type="file" class="kfile" accept="application/json,.json" hidden>
    </div>
    <p class="kmsg${message?.bad ? ' bad' : ''}" role="status"${message ? '' : ' hidden'}>${esc(message?.text || '')} ${(message?.buttons || []).map((b, i) => `<button type="button" class="btn sm" data-msg="${i}">${esc(b.label)}</button>`).join(' ')}</p>
    ${groups.map((g) => { const r = rows(g); return r ? `<h3>${esc(g)}</h3>${r}` : ''; }).join('') || '<p class="help">Nothing matches the filter.</p>'}`;
}

// ---- capturing a key
function setKey(id, b) { full[id] = b; capture = null; say(''); changedSet(); }
function captured(id, b) {
  const err = bindingError(id, b);
  if (err) { say(`${err}. Press another key, or Esc to cancel.`, { bad: true }); return draw(); }
  const other = ownerOf(b, id);
  if (other) {
    const prev = full[id];
    capture = null;
    say(`${label(b)} is already used by "${other.label}".`, { bad: true, buttons: [
      { label: `Swap (${other.label} gets ${prev ? label(prev) : 'no key'})`, run: () => { full[other.id] = prev; setKey(id, b); } },
      { label: 'Cancel', run: () => { say(''); draw(); } }] });
    return draw();
  }
  if (awkward(b)) {
    capture = null;
    say(`${label(b)} also moves the focus and presses buttons on the page.`, { bad: true, buttons: [{ label: 'Use it anyway', run: () => setKey(id, b) }, { label: 'Cancel', run: () => { say(''); draw(); } }] });
    return draw();
  }
  setKey(id, b);
}
function remapStep(b) {
  const keys = capture.remap, id = CHOP_IDS[keys.length];
  const err = bindingError(id, b), other = ACTIONS.find((a) => !CHOP_IDS.includes(a.id) && full[a.id] === b);
  if (err) say(`${err}. Press another key.`, { bad: true });
  else if (keys.includes(b)) say(`${label(b)} is already key ${keys.indexOf(b) + 1} of the row. Press another key.`, { bad: true });
  else if (other) say(`${label(b)} is used by "${other.label}". Press another key, or change that one first.`, { bad: true });
  else {
    keys.push(b);
    if (keys.length === CHOP_IDS.length) {
      const next = { ...full }; CHOP_IDS.forEach((cid, i) => (next[cid] = keys[i]));
      return replaceAll(next, 'Chop keyboard row re-mapped');
    }
    say(`Key ${keys.length + 1} of ${CHOP_IDS.length}: press the key for ${ACTION[CHOP_IDS[keys.length]].label}. Esc cancels.`);
  }
  draw();
}
window.addEventListener('keydown', (e) => {
  if (!capture || !root?.isConnected) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { capture = null; say(''); return draw(); }
  const b = bindingOf(e);
  if (!b) return; // a modifier on its way to a combination
  if (capture.remap) remapStep(b); else captured(capture.id, b);
}, true);

// ---- import / export
function exportSet() {
  const blob = new Blob([JSON.stringify({ format: 'dj-key-bindings', version: 1, bindings: full }, null, 2) + '\n'], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'key-bindings.json' });
  a.click(); URL.revokeObjectURL(a.href);
}
async function importSet(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return say(`${file.name} is not a JSON file.`, { bad: true }), draw(); }
  const given = data?.bindings && typeof data.bindings === 'object' ? data.bindings : data;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return say(`${file.name} has no bindings in it.`, { bad: true }), draw();
  const skipped = Object.keys(given).filter((id) => !ACTION[id]);
  const r = validateBindings(Object.fromEntries(Object.entries(given).filter(([id]) => ACTION[id])));
  const note = skipped.length ? ` ${skipped.length} unknown action${skipped.length === 1 ? '' : 's'} skipped (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}).` : '';
  if (!r.ok) return say(`Nothing imported: ${r.errors.slice(0, 3).join('; ')}.${note}`, { bad: true }), draw();
  const next = effective(r.overrides), diff = ACTIONS.filter((a) => next[a.id] !== full[a.id]);
  if (!diff.length) return say(`${file.name} matches the current bindings.${note}`), draw();
  const list = diff.slice(0, 6).map((a) => `${a.label}: ${label(full[a.id]) || 'no key'} → ${label(next[a.id]) || 'no key'}`).join('\n');
  if (confirm(`Import ${file.name}? It replaces the whole binding set; ${diff.length} action${diff.length === 1 ? '' : 's'} change:\n\n${list}${diff.length > 6 ? `\n… and ${diff.length - 6} more` : ''}`)) replaceAll(next, `Imported ${file.name}.${note}`);
}

// ---- presets
function presetBindings(value) {
  const [kind, ...rest] = value.split(':'), name = rest.join(':');
  return { kind, name, set: kind === 'user' ? presets[name] : builtin.find((p) => p.name === name)?.bindings };
}
const nameTaken = (n) => builtin.some((p) => p.name.toLowerCase() === n.toLowerCase());
function askName(text, initial = '') {
  const n = (prompt(text, initial) || '').trim().slice(0, 40);
  if (!n) return null;
  if (nameTaken(n)) { say(`"${n}" is a built-in preset. Pick another name.`, { bad: true }); draw(); return null; }
  return n;
}

function click(e) {
  const m = e.target.closest('[data-msg]');
  if (m) return message?.buttons[Number(m.dataset.msg)]?.run();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.closest('.krow')?.dataset.id;
  if (act === 'capture') { capture = capture?.id === id ? null : { id }; say(''); return draw(); }
  if (act === 'clear') return setKey(id, '');
  if (act === 'reset') {
    const other = ACTION[id].def && ownerOf(ACTION[id].def, id);
    if (other) { say(`The default, ${label(ACTION[id].def)}, is in use by "${other.label}".`, { bad: true, buttons: [{ label: 'Take it (that one loses its key)', run: () => { full[other.id] = ''; setKey(id, ACTION[id].def); } }, { label: 'Cancel', run: () => { say(''); draw(); } }] }); return draw(); }
    return setKey(id, ACTION[id].def);
  }
  if (act === 'resetall') { if (confirm('Put every key back to its default?')) replaceAll(effective({}), 'All keys reset to the defaults'); return; }
  if (act === 'remap') { capture = { remap: [] }; say(`Key 1 of ${CHOP_IDS.length}: press the key for ${ACTION[CHOP_IDS[0]].label}. Esc cancels.`); return draw(); }
  if (act === 'export') return exportSet();
  if (act === 'import') return $('.kfile', root).click();
  const p = presetBindings($('.kpreset', root).value || '');
  if (act === 'apply') {
    if (!p.set) return;
    const r = validateBindings(p.set);
    if (!r.ok) { say(`Preset "${p.name}" cannot be applied: ${r.errors[0]}.`, { bad: true }); return draw(); }
    if (confirm(`Apply the preset "${p.name}"? It replaces the whole binding set.`)) replaceAll(effective(r.overrides), `Preset "${p.name}" applied`);
    return;
  }
  if (act === 'saveas') {
    const n = askName('Name for this preset:'); if (!n) return;
    if (presets[n] && !confirm(`Replace your preset "${n}"?`)) return;
    presets[n] = toOverrides(full); say(`Saved as "${n}". Save changes to keep it.`); return changedSet();
  }
  if (act === 'rename' && p.kind === 'user') {
    const n = askName(`New name for "${p.name}":`, p.name); if (!n || n === p.name) return;
    presets = Object.fromEntries(Object.entries(presets).map(([k, v]) => [k === p.name ? n : k, v])); selected = `user:${n}`; return changedSet();
  }
  if (act === 'delete' && p.kind === 'user' && confirm(`Delete your preset "${p.name}"?`)) { delete presets[p.name]; return changedSet(); }
}

document.addEventListener('click', (e) => { if (root?.contains(e.target)) click(e); });
document.addEventListener('input', (e) => {
  if (!root?.contains(e.target) || !e.target.classList.contains('ksearch')) return;
  e.stopPropagation();
  filter = e.target.value; draw();
  const s = $('.ksearch', root); s.focus(); s.setSelectionRange(filter.length, filter.length);
}, true);
document.addEventListener('change', (e) => {
  if (!root?.contains(e.target)) return;
  if (e.target.classList.contains('kfile') && e.target.files[0]) importSet(e.target.files[0]);
  if (e.target.classList.contains('kpreset')) draw();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList?.contains('ksearch')) e.preventDefault(); });
