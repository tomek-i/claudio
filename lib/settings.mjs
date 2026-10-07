// Settings: the editable part of config.json. One schema drives the /settings page, validation and saving.
// `live` fields take effect as soon as they are saved; the rest need a server restart.
// Keys in config.json that are not in the schema are left exactly as they are.

import { validateBindings } from './keymap.mjs';

export const FIELDS = [
  { key: 'autoDJ.enabled', group: 'Auto-DJ', label: 'Auto-DJ', type: 'bool', def: true, live: true, help: 'Mix in the next track by itself when the music is about to run out and nothing is planned.' },
  { key: 'autoDJ.leadSec', group: 'Auto-DJ', label: 'Take over with this much music left', type: 'int', unit: 'seconds', min: 10, max: 180, def: 45, live: true },

  { key: 'monitor.enabled', group: 'Safety nets', label: 'Mix monitor', type: 'bool', def: true, live: true, help: 'Listens to the mix and warns about key clashes, clipping and off-beat transitions.' },
  { key: 'deadAirGuard', group: 'Safety nets', label: 'Dead-air guard', type: 'bool', def: true, live: true, help: 'Steps in if a track is about to end with nothing lined up.' },

  { key: 'stems.enabled', group: 'Stem separation', label: 'Stem separation', type: 'bool', def: true, live: true, help: 'Split tracks into vocals, drums, bass and other. Heavy on the CPU while it runs.' },
  { key: 'stems.auto', group: 'Stem separation', label: 'Separate new tracks automatically', type: 'bool', def: true, live: true },
  { key: 'stems.device', group: 'Stem separation', label: 'Run on', type: 'choice', options: [{ value: 'auto', label: 'Automatic (the GPU when there is one)' }, { value: 'cpu', label: 'CPU only' }], def: 'auto', live: true, help: 'Automatic uses an NVIDIA or Apple GPU when PyTorch in .venv can see one, which is many times faster, and the CPU otherwise. Applies to tracks started from now on. The health page shows which one is in use.' },
  { key: 'stems.concurrency', group: 'Stem separation', label: 'Tracks separated at once', type: 'int', min: 1, max: 8, def: 2, live: true, help: 'On the CPU. A GPU always takes one track at a time.' },
  { key: 'stems.threads', group: 'Stem separation', label: 'CPU threads per track', type: 'int', min: 1, max: 16, def: 2, live: true },
  { key: 'stems.minFreeGB', group: 'Stem separation', label: 'Pause when free disk space drops below', type: 'number', unit: 'GB', min: 0, max: 500, step: 0.5, def: 3, live: true },

  { key: 'libraryDirs', group: 'Library', label: 'Music folders', type: 'paths', def: ['./library'], live: false, help: 'One folder per line. Add more folders here, e.g. ~/Music. Relative paths start at the project folder; ~ is your home folder.' },
  { key: 'downloadDir', group: 'Library', label: 'Download folder', type: 'text', def: './library/downloads', required: true, live: false },
  { key: 'targetLoudnessDb', group: 'Library', label: 'Target loudness', type: 'number', unit: 'dB', min: -20, max: -4, step: 0.5, def: -10, live: true, help: 'Tracks are levelled to this when analysed. Applies to tracks analysed from now on.' },

  { key: 'ui.touchHoldMs', group: 'Library', label: 'Touch hold before a track is picked up', type: 'int', unit: 'ms', min: 150, max: 800, def: 300, live: true, help: 'How long a finger rests on a track before it can be dragged to a deck. Shorter picks up faster; longer makes it harder to pick a track up by accident while scrolling.' },

  { key: 'visuals.audio', group: 'Visuals', label: 'Offer the set\'s audio on the visuals page', type: 'bool', def: true, live: true, help: 'The /visuals page is silent until a viewer turns the sound on. With this off the speaker button is gone and no audio leaves this machine; the picture still works.' },
  { key: 'visuals.lowLatency', group: 'Visuals', label: 'Low-latency audio on this network', type: 'bool', def: false, live: true, help: 'Sends the sound straight from the DJ page to a viewer on the same network (WebRTC), a fraction of a second behind the decks. Anyone it cannot reach that way listens through the server as before, a second or two behind.' },
  { key: 'visuals.maxListeners', group: 'Visuals', label: 'Low-latency listeners at once', type: 'int', min: 1, max: 32, def: 8, live: true, help: 'Every low-latency listener is one more encode in the DJ page. Listeners beyond this number use the server relay. Lowering it does not disconnect anyone already listening.' },
  { key: 'visuals.audioBitrate', group: 'Visuals', label: 'Low-latency audio bitrate', type: 'int', unit: 'kbit/s', min: 128, max: 192, def: 160, live: true, help: 'Stereo Opus. Applies to connections made after the change.' },

  { key: 'recordMicDevice', group: 'Recording', label: 'Microphone device', type: 'text', def: '', live: true, help: 'The DirectShow device name "dj record" captures the microphone from. Leave empty to record without a microphone.' },

  { key: 'ui.deckLayout', group: 'Decks', label: 'Deck and mixer layout', type: 'choice', options: [{ value: 'stacked', label: 'Stacked (CDJ style)' }, { value: 'classic', label: 'Classic (side by side)' }], def: 'stacked', live: true, help: 'Stacked puts the display on top and the jog wheel below it, with a hardware-style mixer between the decks. Classic is the earlier layout: jog wheel beside the controls, FX in the channel strips, master volume in the header.' },
  { key: 'ui.deckStyle', group: 'Decks', label: 'Deck style', type: 'choice', options: [{ value: 'cdj', label: 'CDJ (jog wheel with a display)' }, { value: 'turntable', label: 'Turntable (record and tonearm)' }], def: 'cdj', live: true, help: 'Turntable draws a record player in place of the jog wheel: the record turns with the track, the tonearm moves across it as the track plays and can be picked up by its headshell and set down elsewhere, and the hot cues are stickers on the record. The record scratches and the platter rim nudges, as the wheel does.' },
  { key: 'ui.jogRing', group: 'Decks', label: 'Jog wheel outer ring', type: 'choice', options: [{ value: 'large', label: 'Large' }, { value: 'small', label: 'Small' }], def: 'large', live: true, help: 'The dimpled ring you drag to nudge the tempo. Large makes it a wider target and the scratch area smaller.' },

  { key: 'ui.meterStyle', group: 'Mixer', label: 'Level meters', type: 'choice', options: [{ value: 'bar', label: 'Smooth bar' }, { value: 'led', label: 'LED ladder' }], def: 'bar', live: true, help: 'How the channel and master level meters are drawn. Both follow the dB scale printed beside the faders.' },

  { key: 'ui.jogHint', group: 'Decks', label: 'Jog wheel: show which part the pointer is on', type: 'choice', options: [{ value: 'edge', label: 'A line of light on its edge' }, { value: 'spot', label: 'A spot of light under the pointer' }, { value: 'off', label: 'Off' }], def: 'edge', live: true, help: 'The outer ring nudges the tempo, the vinyl scratches. Edge: a pale line on the outer edge over the ring (deck colour while nudging), a brighter deck light over the vinyl. Spot: a soft pool of light that follows the pointer inside the part it is on.' },
  { key: 'ui.hotcues', group: 'Decks', label: 'Hot cue buttons', type: 'choice', options: [{ value: 'pad', label: 'Numbers (pads)' }, { value: 'pad2', label: 'Numbers (pads, name on its own line)' }, { value: 'slim', label: 'Numbers (slim row)' }, { value: 'letters', label: 'Letters A to H (pads)' }], def: 'pad', live: true, help: 'Pads have a line that lights up in the cue colour when the cue is set. Numbers show the cue name and its bar; letters show nothing else. The slim row is the most compact. "dj hotcue" always takes the numbers 1 to 8.' },


  { key: 'ui.waveGuard', group: 'Waveform', label: 'Lock the waveform of playing decks', type: 'bool', def: true, live: true, help: 'A playing deck cannot be dragged by its waveform unless Shift is held. The lock on the waveform switches this too. The jog wheel is not affected.' },
  { key: 'ui.waveInertia', group: 'Waveform', label: 'Waveform keeps moving when thrown', type: 'bool', def: true, live: true, help: 'Let go of the waveform while dragging and the track runs on and slows down, like a platter. Off stops it dead.' },
  { key: 'ui.waveZoom', group: 'Waveform', label: 'Waveform zoom', type: 'number', unit: 'pixels per second', min: 40, max: 800, step: 1, def: 110, live: true, help: 'The time scale of the main waveform, for every deck. The mouse wheel or a pinch on the waveform changes it.' },

  { key: 'ui.lowerCollapsed', group: 'Bottom panel', label: 'Hide the bottom panel', type: 'bool', def: false, live: true, help: 'Leaves the bar of tabs and gives the height to the decks. Also: the arrow on the bar, the C key, or "dj crate hide|show|toggle".' },
  { key: 'ui.lowerHeight', group: 'Bottom panel', label: 'Height of the bottom panel', type: 'int', unit: 'px (0 = automatic)', min: 0, max: 2000, def: 0, live: true, help: 'Set by dragging the bar of tabs, or with its S / M / L buttons. Double-click the bar to go back to automatic.' },
  { key: 'ui.dockTab', group: 'Bottom panel', label: 'Open tab', type: 'choice', options: [{ value: 'library', label: 'Library' }, { value: 'sampler', label: 'Sampler & keys' }, { value: 'booth', label: 'Booth' }], def: 'library', live: true, help: 'The tab the bottom panel shows. The pads and the keyboard keys still play while the sampler tab is not open.' },
  { key: 'ui.boothPinned', group: 'Bottom panel', label: 'Keep the booth beside the open tab', type: 'bool', def: true, live: true, help: 'Pinned, the booth is a column on the right of the library or the sampler. Unpinned, it is a tab of its own.' },
  { key: 'ui.layoutPreset', group: 'Bottom panel', label: 'Page layout', type: 'choice', options: [{ value: 'mix', label: 'Mix' }, { value: 'browse', label: 'Browse' }, { value: 'perform', label: 'Perform' }], def: 'mix', live: true, help: 'The layout buttons in the header. Mix: decks with the library. Browse: the library full size with a slim strip of the decks. Perform: decks with the sampler.' },

  // key bindings: the actions and the rules are in lib/keymap.mjs; the settings page has its own editor for these two
  { key: 'keys.bindings', group: 'Key bindings', label: 'Key bindings', type: 'keys', def: {}, live: true, help: 'Only the keys that differ from the defaults are stored.' },
  { key: 'keys.presets', group: 'Key bindings', label: 'Saved presets', type: 'keypresets', def: {}, live: true },

  { key: 'port', group: 'Server', label: 'Port', type: 'int', min: 1024, max: 65535, def: 4747, live: false },
  { key: 'banner.loop', group: 'Server', label: 'Live equaliser in the terminal', type: 'bool', def: true, live: false, help: 'After the startup animation, keep the equaliser under the logo moving with the music. Off leaves it still.' },
];

const getPath = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, key, value) {
  const parts = key.split('.'), last = parts.pop();
  let o = obj;
  for (const k of parts) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  o[last] = value;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function describe(config) {
  return FIELDS.map((f) => ({ ...f, value: getPath(config, f.key) ?? f.def }));
}

export const uiSettings = (config) => ({
  ...Object.fromEntries(describe(config).filter((f) => f.key.startsWith('ui.')).map((f) => [f.key.slice(3), f.value])),
  keys: getPath(config, 'keys.bindings') ?? {},
});

export function coerce(f, raw) {
  if (f.type === 'bool') {
    if (typeof raw !== 'boolean') return { error: 'must be on or off' };
    return { value: raw };
  }
  if (f.type === 'int' || f.type === 'number') {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof n !== 'number' || !isFinite(n)) return { error: 'must be a number' };
    if (f.type === 'int' && !Number.isInteger(n)) return { error: 'must be a whole number' };
    if (n < f.min || n > f.max) return { error: `must be between ${f.min} and ${f.max}` };
    return { value: n };
  }
  if (f.type === 'choice') {
    if (!f.options.some((o) => o.value === raw)) return { error: `must be one of: ${f.options.map((o) => o.label).join(', ')}` };
    return { value: raw };
  }
  if (f.type === 'keys') {
    const r = validateBindings(raw);
    return r.ok ? { value: r.overrides } : { error: `cannot be saved: ${r.errors.slice(0, 3).join('; ')}` };
  }
  if (f.type === 'keypresets') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'must be a map of preset name to bindings' };
    const names = Object.keys(raw), value = {};
    if (names.length > 40) return { error: 'has too many presets (40 at most)' };
    for (const name of names) {
      if (!name.trim() || name.length > 40) return { error: 'has a preset name that is empty or too long' };
      const r = validateBindings(raw[name]);
      if (!r.ok) return { error: `preset "${name}" cannot be saved: ${r.errors[0]}` };
      value[name.trim()] = r.overrides;
    }
    return { value };
  }
  if (f.type === 'decks') {
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split('')).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    if (list.some((d) => !['A', 'B', 'C', 'D'].includes(d))) return { error: 'must be a list of decks (A, B, C, D)' };
    return { value: [...new Set(list)].sort() };
  }
  if (f.type === 'text') {
    if (typeof raw !== 'string') return { error: 'must be text' };
    const s = raw.trim();
    if (f.required && !s) return { error: 'cannot be empty' };
    if (s.length > 300) return { error: 'is too long' };
    return { value: s };
  }
  if (f.type === 'paths') {
    const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/)).map((s) => String(s).trim()).filter(Boolean);
    if (!list.length) return { error: 'needs at least one folder' };
    if (list.some((s) => s.length > 300)) return { error: 'has a path that is too long' };
    return { value: [...new Set(list)] };
  }
  return { error: 'unknown setting type' };
}

export function applyPatch(config, patch) {
  const errors = {}, next = [];
  for (const [key, raw] of Object.entries(patch || {})) {
    const f = FIELDS.find((x) => x.key === key);
    if (!f) { errors[key] = 'is not a setting'; continue; }
    const r = coerce(f, raw);
    if (r.error) errors[key] = `${f.label} ${r.error}`; else next.push([f, r.value]);
  }
  if (Object.keys(errors).length) return { ok: false, errors, changed: [], restart: [] };
  const changed = [], restart = [];
  for (const [f, value] of next) {
    if (same(getPath(config, f.key) ?? f.def, value)) continue;
    setPath(config, f.key, value);
    changed.push(f.key);
    if (!f.live) restart.push(f.label);
  }
  return { ok: true, errors, changed, restart };
}
