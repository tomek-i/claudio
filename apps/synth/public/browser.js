// The preset browser: every preset in one list down the side of the page, the player's own first, narrowed by a
// search and a category. A click loads one into the playing slot; ▶ on a row hears it without loading it (a short
// phrase on a synth of its own, through POST /api/play); the arrow keys walk the list, loading as they
// go, and the ◀ ▶ by the patch's name step through it from anywhere. The list is built again only when the
// presets, the search or the category change; the row of the sound that is playing is marked on every render.
import { KINDS } from '../lib/presets.mjs';

const OPEN = 'miniclaude.browserOpen';
const KIND = 'miniclaude.browserKind';
const NARROW = '(max-width: 900px)';            // under this the browser lies over the page, and starts closed

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* a browser that keeps nothing */ } };
const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

// state(): what the server last said. current(): the playing patch. send(op): one edit. hear(name): play a preset
// without loading it.
export function createBrowser({ state, current, send, hear }) {
  let kind = recall(KIND) || 'all';
  let query = '';
  let built = '';

  const shown = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return state().presets.filter((p) => (kind === 'all' || p.kind === kind)
      && words.every((w) => p.name.toLowerCase().includes(w) || p.kind.includes(w)));
  };
  const load = (name) => send({ op: 'preset', name });

  function open(yes, keep = true) {
    $('browser').hidden = !yes;
    $('browse').setAttribute('aria-expanded', yes);
    if (keep && !matchMedia(NARROW).matches) remember(OPEN, yes ? '1' : '0');
  }

  function buildKinds() {
    const counts = Object.fromEntries(['all', 'saved', ...KINDS].map((k) => [k, state().presets.filter((p) => k === 'all' || p.kind === k).length]));
    if (!counts[kind]) kind = 'all';
    $('presetKinds').replaceChildren(...Object.entries(counts).filter(([, n]) => n).map(([k, n]) => el('button', {
      type: 'button', value: k, textContent: k === 'fx' ? 'FX' : k, title: `${n} preset${n === 1 ? '' : 's'}`,
      onclick: () => { kind = k; remember(KIND, k); render(); },
    })));
    for (const b of $('presetKinds').children) b.setAttribute('aria-pressed', b.value === kind);
  }

  function buildList(list) {
    $('presetList').replaceChildren(...list.map((p) => el('li', { title: p.name },
      el('button', { type: 'button', className: 'hear', textContent: '▶', title: `Hear "${p.name}" without loading it`, ariaLabel: `Hear ${p.name}`, onclick: () => hear(p.name) }),
      el('button', { type: 'button', className: 'pick', onclick: () => load(p.name) },
        el('span', { textContent: p.name }), kind === 'all' || kind === 'saved' ? el('small', { textContent: p.saved ? 'saved' : p.kind }) : ''),
      p.saved ? el('button', {
        type: 'button', className: 'del', textContent: '×', title: `Delete the saved preset "${p.name}"`, ariaLabel: `Delete ${p.name}`,
        onclick: () => { if (confirm(`Delete the saved preset "${p.name}"? A slot playing it keeps the sound.`)) send({ op: 'deletepreset', name: p.name }); },
      }) : '')));
    $('presetEmpty').hidden = list.length > 0;
  }

  function render() {
    const list = shown();
    const key = JSON.stringify([state().presets, kind, query]);
    if (key !== built) {
      built = key;
      buildKinds();
      buildList(list);
      $('presetCount').textContent = list.length === state().presets.length ? `${list.length}` : `${list.length} of ${state().presets.length}`;
    }
    const name = current().name;
    let mark = null;
    for (const li of $('presetList').children) {
      const on = same(li.title, name);
      li.querySelector('.pick').toggleAttribute('aria-current', on);
      if (on) mark = li;
    }
    if (mark && mark !== render.marked && !$('presetList').contains(document.activeElement)) mark.scrollIntoView({ block: 'nearest' });
    render.marked = mark;
  }

  // ◀ ▶ and the arrow keys: the next preset in the list as it is narrowed now, from the one playing
  function step(by) {
    const list = shown();
    if (!list.length) return;
    const at = list.findIndex((p) => same(p.name, current().name));
    const next = list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length];
    load(next.name);
    return next;
  }

  function save() {
    const name = prompt('Save this sound as a preset called', current().name);
    if (name?.trim()) send({ op: 'savepreset', name: name.trim() });
  }

  $('browse').addEventListener('click', () => open($('browser').hidden));
  $('closeBrowser').addEventListener('click', () => { open(false); $('browse').focus(); });
  $('savePreset').addEventListener('click', save);
  $('prevPreset').addEventListener('click', () => step(-1));
  $('nextPreset').addEventListener('click', () => step(1));
  $('presetSearch').addEventListener('input', () => { query = $('presetSearch').value.trim(); render(); });
  $('presetSearch').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); $('presetList').querySelector('.pick')?.focus(); }
    else if (e.key === 'Escape' && $('presetSearch').value) { e.stopPropagation(); $('presetSearch').value = ''; query = ''; render(); }
  });
  $('presetList').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const picks = [...$('presetList').querySelectorAll('.pick')];
    const at = picks.indexOf(document.activeElement.closest('li')?.querySelector('.pick'));
    const next = picks[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) { if (e.key === 'ArrowUp') $('presetSearch').focus(); return; }
    next.focus();
    next.click();
  });
  $('browser').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && matchMedia(NARROW).matches) { open(false, false); $('browse').focus(); }
  });

  open(matchMedia(NARROW).matches ? false : recall(OPEN) !== '0', false);
  return { render, save, step };
}
