// The /settings page: a form generated from the schema the server sends (lib/settings.mjs).
// Only values that differ from what was loaded are sent on save.
import { $, $$, esc, post } from './util.js';
import * as keysUi from './settings-keys.js';

let fields = []; // last schema + values from the server
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
  $('#form').innerHTML = groups.map((g) => `<fieldset${g === 'Key bindings' ? ' id="keys"' : ''}><legend>${esc(g)}</legend>${fields.filter((f) => f.group === g).map((f) => `
    <div class="field ${f.type}" data-field="${esc(f.key)}">
      <label class="name" for="${idOf(f.key)}">${esc(f.label)}${f.live ? '' : ' <span class="tag">needs restart</span>'}</label>
      <div class="input">${control(f)}</div>
      <p class="help" id="${idOf(f.key)}-help">${esc(f.help || '')}</p>
      <p class="err" id="${idOf(f.key)}-err"></p>
    </div>`).join('')}</fieldset>`).join('');
  const value = (key) => fields.find((f) => f.key === key)?.value;
  if ($('.keysui')) keysUi.mount($('.keysui'), { bindings: value('keys.bindings'), presets: value('keys.presets') }, changed);
  changed();
}

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
  const dirty = Object.keys(patch()).length > 0;
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
    for (const [key, msg] of Object.entries(r.errors || {})) {
      const row = $(`.field[data-field="${key}"]`); if (!row) continue;
      row.classList.add('bad'); $('.err', row).textContent = msg;
    }
    $('#result').textContent = r.error ? `Not saved: ${r.error}` : 'Not saved: fix the highlighted settings.';
    changed();
    return;
  }
  fields = r.fields; render(); showRestart(r.restartPending);
  $('#result').textContent = r.changed.length ? `Saved ${r.changed.length} setting${r.changed.length === 1 ? '' : 's'}.` : 'Nothing to save.';
};

load().then(() => { if (location.hash === '#keys') $('#keys')?.scrollIntoView(); });
