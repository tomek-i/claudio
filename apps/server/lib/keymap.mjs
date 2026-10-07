// Key bindings: the one registry of keyboard actions, and the rules a binding set has to pass.
// Shared by the server (validating the `keys` section of config.json) and the pages (served at /keymap.mjs):
// the key handler on the DJ page dispatches through it, and the settings page and the shortcut list are drawn from it.
//
// An action is { id, label, group, kind, def }. `kind` is what the action needs from an input, not which input:
// 'trigger' (one press), 'hold' (press and release) or 'value' (continuous; none yet). A binding names its source,
// so other sources can bind to the same actions later: 'key:KeyA', 'key:Ctrl+Shift+KeyA', and '' for "no key".
// Keys are physical positions (KeyboardEvent.code), so the piano row keeps its shape on every keyboard layout.

const DECKS = ['A', 'B', 'C', 'D'];
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const key = (code) => (code ? `key:${code}` : '');

// the 18 semitones of the chop keyboard, in order: A W S E D F T G Y H U J K O L P ; '
export const CHOP_ROW = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
const LOOP_KEYS = { A: ['Digit1', 'Digit2', 'Digit3', 'Digit4'], B: ['Digit7', 'Digit8', 'Digit9', 'Digit0'] };

export const ACTIONS = [
  ...CHOP_ROW.map((code, semis) => ({ id: `chop.note.${semis}`, label: `Note ${semis + 1} (${NOTES[semis % 12]})`, group: 'Chop keyboard', kind: 'hold', def: key(code), semis })),
  { id: 'chop.octave.down', label: 'Octave down', group: 'Chop keyboard', kind: 'trigger', def: key('KeyZ') },
  { id: 'chop.octave.up', label: 'Octave up', group: 'Chop keyboard', kind: 'trigger', def: key('KeyX') },
  // per-deck actions are declared once and expanded per deck; C and D start without keys
  ...DECKS.flatMap((deck) => [4, 8, 16, 32].map((beats, i) => ({ id: `loop.${beats}.${deck}`, label: `Loop ${beats} beats, deck ${deck}`, group: 'Loops', kind: 'trigger', def: key(LOOP_KEYS[deck]?.[i]), deck, beats }))),
  { id: 'loop.half', label: 'Halve the loop', group: 'Loops', kind: 'trigger', def: key('BracketLeft'), factor: 0.5, help: 'Acts on the deck the pointer was last used on if it has a loop, otherwise the first deck with one.' },
  { id: 'loop.double', label: 'Double the loop', group: 'Loops', kind: 'trigger', def: key('BracketRight'), factor: 2 },
  ...DECKS.flatMap((deck) => [
    { id: `loop.half.${deck}`, label: `Halve the loop, deck ${deck}`, group: 'Loops', kind: 'trigger', def: '', deck, factor: 0.5 },
    { id: `loop.double.${deck}`, label: `Double the loop, deck ${deck}`, group: 'Loops', kind: 'trigger', def: '', deck, factor: 2 },
  ]),
  { id: 'loop.move.back', label: 'Move the loop back by its length', group: 'Loops', kind: 'trigger', def: '', move: -1 },
  { id: 'loop.move.forward', label: 'Move the loop forward by its length', group: 'Loops', kind: 'trigger', def: '', move: 1 },
  { id: 'lower.toggle', label: 'Hide / show the bottom panel', group: 'Page', kind: 'trigger', def: key('KeyC') },
  { id: 'keys.toggle', label: 'Sampler tab / library tab', group: 'Page', kind: 'trigger', def: key('KeyB') },
  { id: 'shortcuts.show', label: 'Show the shortcut list', group: 'Page', kind: 'trigger', def: '' },
];
export const ACTION = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
export const CHOP_IDS = CHOP_ROW.map((_, semis) => `chop.note.${semis}`);

// ---- binding strings
const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'];
const MOD_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;
export function parseBinding(b) {
  if (typeof b !== 'string') return null;
  const m = /^key:((?:(?:Ctrl|Alt|Shift|Meta)\+)*)([A-Za-z][A-Za-z0-9]*)$/.exec(b);
  if (!m || MOD_CODES.test(m[2])) return null;
  const mods = m[1].split('+').filter(Boolean);
  if (mods.join() !== MODS.filter((x) => mods.includes(x)).join()) return null; // one spelling per combination
  return { mods, code: m[2] };
}
// a keydown as a binding string; null for a modifier pressed alone
export function bindingOf(e) {
  if (!e.code || MOD_CODES.test(e.code)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return `key:${[...mods, e.code].join('+')}`;
}

// combinations the browser or the OS keeps for itself: they never reach the page
const RESERVED = [
  [/^key:(Ctrl|Meta)\+Key[WTNQ]$/, 'the browser uses it for tabs and windows'],
  [/^key:(Ctrl|Meta)\+(Shift\+)?KeyR$/, 'the browser uses it to reload the page'],
  [/^key:(Ctrl\+)?(Shift\+)?F5$/, 'the browser uses it to reload the page'],
  [/^key:Ctrl\+(Shift\+)?Tab$/, 'the browser uses it to switch tabs'],
  [/^key:Alt\+(Shift\+)?Tab$/, 'the system uses it to switch windows'],
  [/^key:Alt\+F4$/, 'the system uses it to close the window'],
  [/^key:(Ctrl\+)?(Shift\+)?F1[12]$/, 'the browser uses it for full screen and the developer tools'],
  [/^key:(Ctrl|Meta)\+Key[L]$/, 'the browser uses it for the address bar'],
  [/^key:(Ctrl\+|Alt\+|Shift\+)*Escape$/, 'Esc cancels things on the page'],
];
export function reservedReason(b) {
  for (const [re, why] of RESERVED) if (re.test(b)) return why;
  return null;
}
// keys that also drive focus and buttons: allowed, but worth a warning
export const awkward = (b) => /^key:(Tab|Enter|NumpadEnter|Space)$/.test(b);

// ---- labels: the character the key produces on this keyboard (layout map), else the US one
const US = { Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
export function codeLabel(code, layout) {
  const ch = layout?.get?.(code);
  if (ch && ch.trim()) return ch.length === 1 ? ch.toUpperCase() : ch;
  return US[code] || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}
export function bindingLabel(b, layout) {
  const p = parseBinding(b);
  return p ? [...p.mods, codeLabel(p.code, layout)].join('+') : '';
}

// ---- binding sets. Stored as overrides: only the actions that differ from their default ('' = unbound).
// action id -> binding for every action; entries for actions that no longer exist are ignored
export function effective(overrides = {}) {
  const out = {};
  for (const a of ACTIONS) out[a.id] = typeof overrides?.[a.id] === 'string' ? overrides[a.id] : a.def;
  return out;
}
export const toOverrides = (full) => Object.fromEntries(ACTIONS.filter((a) => (full[a.id] ?? a.def) !== a.def).map((a) => [a.id, full[a.id]]));
// why this binding cannot go on this action; null when it can
export function bindingError(id, b) {
  const a = ACTION[id];
  if (!a) return `"${id}" is not an action`;
  if (b === '') return null;
  const p = parseBinding(b);
  if (!p) return `${a.label}: "${b}" is not a key`;
  if (a.kind === 'hold' && p.mods.length) return `${a.label}: a held key cannot use modifiers`;
  const why = reservedReason(b);
  return why ? `${a.label}: ${bindingLabel(b)} cannot be used, ${why}` : null;
}
// a whole set (overrides or full): { ok, errors, overrides }. Unknown actions, bad keys and duplicate keys are errors.
export function validateBindings(set) {
  const errors = [];
  if (!set || typeof set !== 'object' || Array.isArray(set)) return { ok: false, errors: ['must be a map of action id to key'], overrides: {} };
  for (const [id, b] of Object.entries(set)) { const e = bindingError(id, b); if (e) errors.push(e); }
  if (errors.length) return { ok: false, errors, overrides: {} };
  const full = effective(set), seen = new Map();
  for (const a of ACTIONS) {
    const b = full[a.id]; if (!b) continue;
    if (seen.has(b)) errors.push(`${bindingLabel(b)} is on both "${ACTION[seen.get(b)].label}" and "${a.label}"`);
    else seen.set(b, a.id);
  }
  return { ok: !errors.length, errors, overrides: errors.length ? {} : toOverrides(full) };
}
