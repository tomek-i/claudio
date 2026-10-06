// Shared UI state. `mixer` and `isEngine` are live bindings: import and read them anywhere,
// but only this module can assign them, so writers go through setMixer / setEngine.

export const clientId = sessionStorage.getItem('djClient') || `c${Math.random().toString(36).slice(2, 10)}`;
sessionStorage.setItem('djClient', clientId);

export let mixer = null;
export let isEngine = false;
export const tracks = new Map(); // id -> full track (with waveform)
export const ui = { jogRing: 'large', deckLayout: 'stacked', lowerCollapsed: false, lowerHeight: 0, keysCollapsed: true, meterStyle: 'bar', hotcues: 'pad', waveGuard: true, waveInertia: true, waveZoom: 110, touchHoldMs: 300, keys: {} }; // the ui.* settings, kept current by prefs.js
// what the hand is doing on the waveforms, for the renderer: held = deck -> 'scratch' | 'seek' | 'nudge',
// preview = deck -> the position a silent seek is showing, strip = the deck whose nudge strip is under the pointer
export const wave = { held: new Map(), preview: new Map(), strip: null };
export const pointer = { deck: null }; // the deck the pointer was last used on: what the [ ] keys act on
export const setMixer = (m) => { mixer = m; };
export const setEngine = (on) => { isEngine = on; };

export const liveBpm = () => { const l = liveDeck(); return l ? l.effBpm : null; };
export const liveDeck = () => mixer.liveDeck();
