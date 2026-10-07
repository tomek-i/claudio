// The /settings page: a form generated from the schema the server sends (apps/server/lib/settings.mjs).
// Only values that differ from what was loaded are sent on save.
// The schema's groups are filed under a few categories: the list on the left picks one and only that one is shown.
// Every field stays in the page all the while (hidden, not removed), because saving reads them all. The search box
// shows the matching settings of every category instead.
import { $, $$, esc, post } from './util.js';
import * as keysUi from './settings-keys.js';

let fields = []; // last schema + values from the server
const CATEGORIES = [
  { id: 'decks', label: 'Decks & mixer', groups: ['Decks', 'Waveform', 'Mixer'] },
  { id: 'library', label: 'Library', groups: ['Library', 'Stem separation'] },
  { id: 'page', label: 'Page layout', groups: ['Bottom panel'] },
  { id: 'claude', label: 'Claude', groups: ['Auto-DJ', 'Safety nets'] },
  { id: 'keys', label: 'Key bindings', groups: ['Key bindings'] },
  { id: 'system', label: 'System', groups: ['Server', 'Recording'] }, // and any group not named above
];
const categoryOf = (group) => (CATEGORIES.find((c) => c.groups.includes(group)) || CATEGORIES[CATEGORIES.length - 1]).id;
const LS_CAT = 'djSettingsCat';
const stored = () => { try { return localStorage.getItem(LS_CAT); } catch { return null; } };
const known = (id) => (CATEGORIES.some((c) => c.id === id) ? id : null);
let current = known(location.hash.slice(1)) || known(stored()) || CATEGORIES[0].id;
const idOf = (key) => `f-${key.replace(/\W/g, '-')}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function control(f) {
  const id = idOf(f.key), attrs = `id="${id}" data-key="${esc(f.key)}" aria-describedby="${id}-help ${id}-err"`;
  if (f.type === 'bool') return `<label class="switch"><input type="checkbox" ${attrs}${f.value ? ' checked' : ''}><span>${f.value ? 'On' : 'Off'}</span></label>`;
  if (f.type === 'paths') return `<textarea ${attrs} rows="${Math.max(2, f.value.length + 1)}" spellcheck="false">${esc(f.value.join('\n'))}</textarea>`;
  if (f.type === 'keys') return `<div class="keysui" ${attrs}></div>`; // filled by settings-keys.js
  if (f.type === 'keypresets') return `<input type="hidden" ${attrs}>`;
  if (f.type === 'decks') return `<span class="decks" ${attrs}>${['A', 'B', 'C', 'D'].map((d) => `<label><input type="checkbox" data-deck="${d}"${f.value.includes(d) ? ' checked' : ''}> ${d}</label>`).join('')}</span>`;
  if (f.type === 'text') return `<input type="text" ${attrs} value="${esc(f.value)}" spellcheck="false">`;
  if (f.type === 'choice') return `<select ${attrs}>${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  return `<span class="num"><input type="number" ${attrs} value="${f.value}" min="${f.min}" max="${f.max}" step="${f.step || 1}">${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}</span>`;
}

function render() {
  const groups = [...new Set(fields.map((f) => f.group))];
  // a category's groups in the order it names them, then any it was not told about
  const inCategory = (c) => [...c.groups.filter((g) => groups.includes(g)), ...groups.filter((g) => categoryOf(g) === c.id && !c.groups.includes(g))];
  const fieldset =(g) => `<fieldset><legend>${esc(g)}</legend>${fields.filter((f) => f.group === g).map((f) => `
    <div class="field ${f.type}" data-field="${esc(f.key)}" data-find="${esc(`${f.label} ${f.help || ''} ${g} ${f.key}${f.live ? '' : ' needs restart'}`.toLowerCase())}">
      <label class="name" for="${idOf(f.key)}">${esc(f.label)}${f.live ? '' : ' <span class="tag">needs restart</span>'}</label>
      <div class="input">${control(f)}</div>
      <p class="help" id="${idOf(f.key)}-help">${esc(f.help || '')}</p>
      <p class="err" id="${idOf(f.key)}-err"></p>
    </div>`).join('')}</fieldset>`;
  $('#form').innerHTML = CATEGORIES.map((c) => `<section class="cat" data-cat="${c.id}"><h3 class="cattitle">${esc(c.label)}</h3>${inCategory(c).map(fieldset).join('')}</section>`).join('');
  $('#cats').innerHTML = CATEGORIES.map((c) => `<button type="button" class="catbtn" data-cat="${c.id}">${esc(c.label)}<i class="dot" aria-hidden="true"></i></button>`).join('');
  for (const b of $$('.catbtn')) b.onclick = () => { $('#find').value = ''; select(b.dataset.cat); };
  const value = (key) => fields.find((f) => f.key === key)?.value;
  if ($('.keysui')) keysUi.mount($('.keysui'), { bindings: value('keys.bindings'), presets: value('keys.presets') }, changed);
  show();
  changed();
}

// what is on screen: one category, or with text in the search box every setting that matches it
function show() {
  const q = $('#find').value.trim().toLowerCase();
  document.body.classList.toggle('searching', !!q);
  let any = false;
  for (const sec of $$('#form .cat')) {
    let inSection = false;
    for (const fs of $$('fieldset', sec)) {
      let inSet = false;
      for (const row of $$('.field', fs)) { const hit = !q || (row.dataset.find.includes(q) && !row.classList.contains('keypresets')); row.hidden = !hit; inSet ||= hit; }
      fs.hidden = !inSet; inSection ||= inSet;
    }
    sec.hidden = q ? !inSection : sec.dataset.cat !== current;
    any ||= !sec.hidden;
  }
  $('#nomatch').hidden = any;
  $('#catname').textContent = q ? 'Search results' : CATEGORIES.find((c) => c.id === current).label;
  for (const b of $$('.catbtn')) { if (!q && b.dataset.cat === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
}
function select(id) {
  current = known(id) || current;
  try { localStorage.setItem(LS_CAT, current); } catch { /* storage is off */ }
  if (location.hash.slice(1) !== current) history.replaceState(null, '', `#${current}`);
  show();
  scrollTo({ top: 0 });
}
$('#find').addEventListener('input', show);
window.addEventListener('hashchange', () => { if (known(location.hash.slice(1))) { $('#find').value = ''; select(location.hash.slice(1)); } });

function read(f) {
  const el = $(`#${idOf(f.key)}`);
  if (f.type === 'bool') return el.checked;
  if (f.type === 'paths') return el.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (f.type === 'keys') return keysUi.bindings();
  if (f.type === 'keypresets') return keysUi.userPresets();
  if (f.type === 'decks') return $$('input', el).filter((x) => x.checked).map((x) => x.dataset.deck);
  if (f.type === 'text') return el.value.trim();
  if (f.type === 'choice') return el.value;
  return el.value.trim() === '' ? '' : Number(el.value);
}
const patch = () => Object.fromEntries(fields.map((f) => [f.key, read(f)]).filter(([key, v]) => !same(v, fields.find((f) => f.key === key).value)));

function changed() {
  for (const el of $$('.switch input')) el.nextElementSibling.textContent = el.checked ? 'On' : 'Off';
  const keys = Object.keys(patch()), dirty = keys.length > 0;
  // a dot on every category with something unsaved in it
  const touched = new Set(keys.map((key) => categoryOf(fields.find((f) => f.key === key).group)));
  for (const b of $$('.catbtn')) b.classList.toggle('dirty', touched.has(b.dataset.cat));
  $('#save').disabled = $('#revert').disabled = !dirty;
  if (dirty) $('#result').textContent = '';
}

function showRestart(list) {
  const el = $('#restart');
  el.hidden = !list.length;
  el.textContent = list.length ? `Restart the server to apply: ${list.join(', ')}. Stop it and run "node dj.mjs start".` : '';
}

async function load() {
  try {
    const r = await fetch('/api/settings').then((x) => x.json());
    fields = r.fields; render(); showRestart(r.restartPending);
  } catch {
    $('#form').innerHTML = '<p class="notice bad">Could not reach the server. Start it with <code>node dj.mjs start</code> and reload this page.</p>';
  }
}

$('#form').addEventListener('input', changed);
$('#revert').onclick = () => { render(); $('#result').textContent = 'Changes discarded.'; };
$('#form').onsubmit = async (e) => {
  e.preventDefault();
  for (const el of $$('.err')) el.textContent = '';
  for (const el of $$('.field.bad')) el.classList.remove('bad');
  $('#save').disabled = true;
  let r;
  try { r = await post('/api/settings', patch()); }
  catch { $('#result').textContent = 'Not saved: the server did not answer.'; changed(); return; }
  if (!r.ok) {
    let first = null;
    for (const [key, msg] of Object.entries(r.errors || {})) {
      const row = $(`.field[data-field="${key}"]`); if (!row) continue;
      row.classList.add('bad'); $('.err', row).textContent = msg;
      first ||= row;
    }
    // the setting at fault may be in a category that is not on screen
    if (first && first.closest('.cat').hidden) { $('#find').value = ''; select(first.closest('.cat').dataset.cat); }
    first?.scrollIntoView({ block: 'center' });
    $('#result').textContent = r.error ? `Not saved: ${r.error}` : 'Not saved: fix the highlighted settings.';
    changed();
    return;
  }
  fields = r.fields; render(); showRestart(r.restartPending);
  $('#result').textContent = r.changed.length ? `Saved ${r.changed.length} setting${r.changed.length === 1 ? '' : 's'}.` : 'Nothing to save.';
};

load();
