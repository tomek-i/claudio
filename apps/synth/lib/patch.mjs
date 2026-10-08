// A patch: a name and one value for every parameter of the synth, under dotted names.
//
//   { name, 'osc1.wave': 'saw', 'osc1.octave': -1, …, 'filter.cutoff': 320, …, 'master.volume': 0.7 }
//
// PARAMS is the whole schema: the range, the default, the unit and how a slider travels through the range. The
// page builds its panel from it, the CLI its `set` and `params`, and the engine reads patches that have been
// through normalizePatch, so every number it meets is in range. Nothing here changes a patch in place.
export const SLOTS = ['A', 'B', 'C', 'D'];
export const WAVES = ['sine', 'triangle', 'saw', 'square'];
export const LFO_DESTS = ['pitch', 'filter', 'amp'];

// curve: how a slider covers the range. lin: evenly. log: evenly in octaves (frequencies, times). sq: fine at
// the low end, and it can reach 0.
const num = (id, label, min, max, def, unit = '', step = 0.01, curve = 'lin') => ({ id, label, min, max, def, unit, step, curve });
const pick = (id, label, options, def) => ({ id, label, options, def });
const osc = (n, level) => [
  pick(`osc${n}.wave`, 'Wave', WAVES, 'saw'),
  num(`osc${n}.octave`, 'Octave', -3, 3, 0, '', 1),
  num(`osc${n}.semi`, 'Semitone', -12, 12, 0, 'st', 1),
  num(`osc${n}.fine`, 'Fine', -50, 50, 0, 'ct', 1),
  num(`osc${n}.level`, 'Level', 0, 1, level, '%'),
];
const adsr = (id, attack, decay, sustain, release) => [
  num(`${id}.attack`, 'Attack', 0.001, 10, attack, 's', 0.001, 'log'),
  num(`${id}.decay`, 'Decay', 0.001, 10, decay, 's', 0.001, 'log'),
  num(`${id}.sustain`, 'Sustain', 0, 1, sustain, '%'),
  num(`${id}.release`, 'Release', 0.001, 10, release, 's', 0.001, 'log'),
];

export const PARAMS = [
  ...osc(1, 0.8),
  ...osc(2, 0),
  num('mix.sub', 'Sub', 0, 1, 0, '%'),                       // a sine one octave below oscillator 1
  num('mix.noise', 'Noise', 0, 1, 0, '%'),
  num('filter.cutoff', 'Cutoff', 20, 18000, 2400, 'Hz', 1, 'log'),
  num('filter.resonance', 'Resonance', 0, 1, 0.1, '%'),
  num('filter.env', 'Envelope', -6, 6, 0, 'oct', 0.1),       // how far the filter envelope opens (or closes) it
  num('filter.keytrack', 'Key track', 0, 1, 0.3, '%'),       // 100%: the cutoff follows the note, an octave for an octave
  ...adsr('fenv', 0.005, 0.3, 0.3, 0.3),
  ...adsr('aenv', 0.005, 0.3, 0.8, 0.3),
  num('lfo.rate', 'Rate', 0.05, 30, 5, 'Hz', 0.01, 'log'),
  pick('lfo.shape', 'Shape', WAVES, 'sine'),
  num('lfo.depth', 'Depth', 0, 1, 0, '%'),
  pick('lfo.dest', 'To', LFO_DESTS, 'pitch'),
  num('voice.glide', 'Glide', 0, 2, 0, 's', 0.001, 'sq'),
  num('voice.unison', 'Unison', 1, 4, 1, '', 1),             // copies of each oscillator per note
  num('voice.detune', 'Detune', 0, 50, 12, 'ct', 1),         // how far the copies are spread
  num('delay.time', 'Time', 0.02, 1.5, 0.375, 's', 0.001),
  num('delay.feedback', 'Feedback', 0, 0.9, 0.35, '%'),
  num('delay.mix', 'Send', 0, 1, 0, '%'),
  num('reverb.size', 'Size', 0.3, 6, 2, 's', 0.1),
  num('reverb.mix', 'Send', 0, 1, 0.1, '%'),
  num('master.volume', 'Volume', 0, 1, 0.7, '%'),
];

// the sections of the panel, in the order they are shown and printed
export const GROUPS = [
  { id: 'osc1', name: 'Oscillator 1', family: 'osc' },
  { id: 'osc2', name: 'Oscillator 2', family: 'osc' },
  { id: 'mix', name: 'Sub and noise', family: 'osc' },
  { id: 'filter', name: 'Filter', family: 'filter' },
  { id: 'fenv', name: 'Filter envelope', family: 'filter' },
  { id: 'aenv', name: 'Amp envelope', family: 'amp' },
  { id: 'lfo', name: 'LFO', family: 'mod' },
  { id: 'voice', name: 'Voice', family: 'mod' },
  { id: 'delay', name: 'Delay', family: 'fx' },
  { id: 'reverb', name: 'Reverb', family: 'fx' },
  { id: 'master', name: 'Master', family: 'fx' },
];

const BY_ID = new Map(PARAMS.map((p) => [p.id, p]));
export const groupOf = (id) => id.split('.')[0];
export const paramsOf = (group) => PARAMS.filter((p) => groupOf(p.id) === group);

const places = (step) => (String(step).split('.')[1] || '').length;
const snap = (def, value) => Number((Math.round(value / def.step) * def.step).toFixed(places(def.step))) + 0;

// The parameter a name means: its full name ("filter.cutoff"), or the last part when only one parameter ends
// that way ("cutoff", "glide").
export function paramDef(name) {
  const id = String(name ?? '').trim().toLowerCase();
  if (BY_ID.has(id)) return BY_ID.get(id);
  const ends = PARAMS.filter((p) => p.id.split('.')[1] === id);
  if (ends.length === 1) return ends[0];
  if (ends.length) throw new Error(`which "${id}"? ${ends.map((p) => p.id).join(', ')}`);
  const group = paramsOf(groupOf(id));
  throw new Error(group.length ? `no parameter "${id}" (${groupOf(id)} has: ${group.map((p) => p.id.split('.')[1]).join(', ')})`
    : `no parameter "${id}" (the sections are: ${GROUPS.map((g) => g.id).join(', ')})`);
}

// One value checked against its parameter: a number in range (as a number or as text; "45%" is 0.45), or one of
// the options.
export function checkValue(def, value) {
  if (def.options) {
    const option = String(value).trim().toLowerCase();
    if (!def.options.includes(option)) throw new Error(`${def.id} is one of: ${def.options.join(', ')}`);
    return option;
  }
  const text = String(value).trim();
  const n = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  if (text === '' || !Number.isFinite(n)) throw new Error(`${def.id} needs a number, not "${value}"`);
  if (n < def.min || n > def.max) throw new Error(`${def.id} goes from ${def.min} to ${def.max}${rangeUnit(def)}`);
  return snap(def, n);
}

const rangeUnit = (def) => (def.unit === '%' ? ' (or 0% to 100%)' : def.unit ? ` ${def.unit}` : '');

export function initPatch(name = 'Init') {
  return { name, ...Object.fromEntries(PARAMS.map((p) => [p.id, p.def])) };
}

// Whatever came in (a file, a preset, the page) as a well-formed patch: every parameter there, every number in
// range. A value that cannot be read becomes the default.
export function normalizePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not a patch');
  const out = initPatch(String(input.name ?? '').trim().slice(0, 40) || 'Untitled');
  for (const def of PARAMS) {
    const value = input[def.id];
    if (def.options) { if (def.options.includes(value)) out[def.id] = value; }
    else if (Number.isFinite(Number(value)) && value !== null && value !== '') out[def.id] = snap(def, Math.min(def.max, Math.max(def.min, Number(value))));
  }
  return out;
}

export const clonePatch = (patch) => normalizePatch(patch);

// A patch with some parameters changed: { 'filter.cutoff': 800, resonance: '60%' }. A wrong name or a value out
// of range is an error that says what would have been right.
export function setParams(patch, values) {
  if (!values || typeof values !== 'object' || !Object.keys(values).length) throw new Error('nothing to set');
  const out = clonePatch(patch);
  for (const [name, value] of Object.entries(values)) {
    const def = paramDef(name);
    out[def.id] = checkValue(def, value);
  }
  return out;
}

export const envOf = (patch, id) => ({ attack: patch[`${id}.attack`], decay: patch[`${id}.decay`], sustain: patch[`${id}.sustain`], release: patch[`${id}.release`] });

// ---- a value for people, and a slider for a value

const signed = (n, digits = 0) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

export function format(id, value) {
  const def = BY_ID.get(id);
  switch (def.unit) {
    case '%': return `${Math.round(value * 100)}%`;
    case 'Hz': return value >= 1000 ? `${(value / 1000).toFixed(2)} kHz` : `${Number(value.toFixed(value < 10 ? 2 : 0))} Hz`;
    case 's': return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case 'ct': return `${signed(value)} ct`;
    case 'st': return `${signed(value)} st`;
    case 'oct': return `${signed(value, 1)} oct`;
    default: return String(value);
  }
}

// where a slider (0..1) is for a value, and back
export function toSlider(def, value) {
  const pos = def.curve === 'log' ? Math.log(value / def.min) / Math.log(def.max / def.min) : (value - def.min) / (def.max - def.min);
  return Math.min(1, Math.max(0, def.curve === 'sq' ? Math.sqrt(pos) : pos));
}

export function fromSlider(def, pos) {
  const p = Math.min(1, Math.max(0, pos));
  const value = def.curve === 'log' ? def.min * (def.max / def.min) ** p : def.min + (def.curve === 'sq' ? p * p : p) * (def.max - def.min);
  return snap(def, Math.min(def.max, Math.max(def.min, value)));
}

// ---- as text, for the terminal

// One line per section, with the names `set` takes: "filter  cutoff 320   resonance 0.78   env 3.6   keytrack 0.3"
export function patchText(patch, groups = GROUPS.map((g) => g.id)) {
  return groups.map((group) => `${group.padEnd(8)}${paramsOf(group).map((p) => `${p.id.split('.')[1]} ${patch[p.id]}`).join('   ')}`).join('\n');
}

// every parameter with what it takes
export function paramsText() {
  const pad = Math.max(...PARAMS.map((p) => p.id.length)) + 2;
  return PARAMS.map((p) => p.id.padEnd(pad) + (p.options ? p.options.join(' | ') : `${p.min} to ${p.max}${p.unit && p.unit !== '%' ? ` ${p.unit}` : ''}`).padEnd(30) + `default ${p.def}`).join('\n');
}
