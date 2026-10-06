// Settings schema: values are validated against the schema, applied all-or-nothing, and unknown config keys survive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, describe, coerce, applyPatch, uiSettings } from '../lib/settings.mjs';

const field = (key) => FIELDS.find((f) => f.key === key);
const base = () => ({ port: 4747, libraryDirs: ['./library'], stems: { enabled: true, threads: 2, model: 'htdemucs' }, custom: { keep: 'me' } });

test('describe: current values, defaults where config.json is silent', () => {
  const d = Object.fromEntries(describe(base()).map((f) => [f.key, f.value]));
  assert.equal(d['stems.threads'], 2);
  assert.equal(d['autoDJ.leadSec'], 45);
  assert.equal(d['deadAirGuard'], true);
  assert.deepEqual(d['libraryDirs'], ['./library']);
  assert.ok(FIELDS.every((f) => f.group && f.label && f.def !== undefined && typeof f.live === 'boolean'));
});

test('coerce: types and ranges', () => {
  assert.deepEqual(coerce(field('autoDJ.leadSec'), '60'), { value: 60 });
  assert.match(coerce(field('autoDJ.leadSec'), 5).error, /between 10 and 180/);
  assert.match(coerce(field('autoDJ.leadSec'), 45.5).error, /whole number/);
  assert.match(coerce(field('autoDJ.leadSec'), '').error, /number/);
  assert.deepEqual(coerce(field('targetLoudnessDb'), -9.5), { value: -9.5 });
  assert.match(coerce(field('stems.enabled'), 'yes').error, /on or off/);
  assert.deepEqual(coerce(field('libraryDirs'), ' ./a \n\n~/Music\n./a'), { value: ['./a', '~/Music'] });
  assert.match(coerce(field('libraryDirs'), '  \n').error, /at least one/);
  assert.match(coerce(field('downloadDir'), '  ').error, /empty/);
  assert.deepEqual(coerce(field('recordMicDevice'), ''), { value: '' });
  assert.deepEqual(coerce(field('ui.jogRing'), 'small'), { value: 'small' });
  assert.match(coerce(field('ui.jogRing'), 'huge').error, /one of: Large, Small/);
  assert.deepEqual(coerce(field('ui.deckLayout'), 'classic'), { value: 'classic' });
  assert.deepEqual(coerce(field('ui.meterStyle'), 'led'), { value: 'led' });
  assert.deepEqual(coerce(field('ui.hotcues'), 'letters'), { value: 'letters' });
  assert.match(coerce(field('ui.hotcues'), 'emoji').error, /one of: Numbers \(pads\)/);
  assert.match(coerce(field('ui.meterStyle'), 'vu').error, /one of: Smooth bar, LED ladder/);
  assert.match(coerce(field('ui.waveGuard'), 'yes').error, /on or off/);
  assert.deepEqual(coerce(field('ui.lowerCollapsed'), true), { value: true });
  assert.deepEqual(coerce(field('ui.waveGuard'), false), { value: false });
  assert.match(coerce(field('ui.waveInertia'), 1).error, /on or off/);
  assert.deepEqual(coerce(field('ui.waveZoom'), 220.5), { value: 220.5 });
  assert.match(coerce(field('ui.waveZoom'), 20).error, /between 40 and 800/);
  assert.match(coerce(field('ui.waveZoom'), 900).error, /between 40 and 800/);
  assert.deepEqual(coerce(field('ui.touchHoldMs'), 450), { value: 450 });
  assert.match(coerce(field('ui.touchHoldMs'), 100).error, /between 150 and 800/);
  assert.match(coerce(field('ui.touchHoldMs'), 900).error, /between 150 and 800/);
  assert.match(coerce(field('ui.touchHoldMs'), 300.5).error, /whole number/);
  assert.deepEqual(coerce(field('ui.lowerHeight'), 320), { value: 320 });
  assert.match(coerce(field('ui.lowerHeight'), -5).error, /between 0 and 2000/);
  assert.match(coerce(field('ui.deckLayout'), 'sideways').error, /one of: Stacked \(CDJ style\), Classic \(side by side\)/);
});

test('uiSettings: what the DJ page is sent, defaults included', () => {
  const defaults = { deckLayout: 'stacked', jogRing: 'large', lowerCollapsed: false, lowerHeight: 0, keysCollapsed: true, meterStyle: 'bar', hotcues: 'pad', waveGuard: true, waveInertia: true, waveZoom: 110, touchHoldMs: 300, keys: {} };
  assert.deepEqual(uiSettings(base()), defaults);
  assert.deepEqual(uiSettings({ ...base(), ui: { jogRing: 'small', deckLayout: 'classic', lowerCollapsed: true, lowerHeight: 260, waveZoom: 300, waveGuard: false, touchHoldMs: 500 } }),
    { ...defaults, deckLayout: 'classic', jogRing: 'small', lowerCollapsed: true, lowerHeight: 260, waveZoom: 300, waveGuard: false, touchHoldMs: 500 });
});

test('applyPatch: writes nested keys, reports what changed and what needs a restart, keeps unknown keys', () => {
  const cfg = base();
  const r = applyPatch(cfg, { 'autoDJ.leadSec': 30, 'stems.threads': 4, port: 5000, 'stems.enabled': true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed.sort(), ['autoDJ.leadSec', 'port', 'stems.threads']);
  assert.deepEqual(r.restart, ['Port']);
  assert.deepEqual(cfg.autoDJ, { leadSec: 30 });
  assert.deepEqual(cfg.stems, { enabled: true, threads: 4, model: 'htdemucs' });
  assert.deepEqual(cfg.custom, { keep: 'me' });
});

test('applyPatch: one bad value rejects the whole patch; unknown keys are refused', () => {
  const cfg = base(), before = JSON.stringify(cfg);
  const r = applyPatch(cfg, { 'stems.threads': 4, port: 80, 'stems.model': 'x', __proto__: { polluted: 1 } });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['port', 'stems.model']);
  assert.equal(JSON.stringify(cfg), before);
  assert.equal(applyPatch(cfg, { 'constructor.prototype.x': 1 }).ok, false);
  assert.equal({}.x, undefined);
});

test('keys section: unknown actions, bad keys and duplicates are refused; only overrides are stored', async () => {
  const { ACTIONS, effective, validateBindings, bindingOf, parseBinding } = await import('../lib/keymap.mjs');
  const keys = field('keys.bindings');
  assert.deepEqual(coerce(keys, {}), { value: {} });
  // a default written out is not an override; a changed key and an unbound action are
  assert.deepEqual(coerce(keys, { 'chop.octave.up': 'key:KeyX', 'chop.octave.down': 'key:KeyV', 'loop.half': '' }), { value: { 'chop.octave.down': 'key:KeyV', 'loop.half': '' } });
  assert.match(coerce(keys, { 'deck.explode': 'key:KeyQ' }).error, /is not an action/);
  assert.match(coerce(keys, { 'loop.half': 'KeyQ' }).error, /is not a key/);
  assert.match(coerce(keys, { 'loop.half': 'key:Shift+Ctrl+KeyQ' }).error, /is not a key/, 'modifiers have one order');
  assert.match(coerce(keys, { 'loop.half': 'key:KeyA' }).error, /is on both/, 'A is the first chop note');
  assert.match(coerce(keys, { 'chop.note.0': 'key:Shift+KeyA' }).error, /held key cannot use modifiers/);
  assert.match(coerce(keys, { 'loop.half': 'key:Ctrl+KeyW' }).error, /browser uses it/);
  assert.deepEqual(coerce(keys, { 'loop.4.C': 'key:Ctrl+Digit1', 'loop.half': 'key:KeyA', 'chop.note.0': 'key:BracketLeft' }).value,
    { 'chop.note.0': 'key:BracketLeft', 'loop.4.C': 'key:Ctrl+Digit1', 'loop.half': 'key:KeyA' }, 'a swap is fine: no key is used twice');
  assert.match(coerce(keys, ['key:KeyA']).error, /map of action id/);
  // the registry: today's keys on a US layout, C and D loops and per-deck halve / double unbound
  const eff = effective({ 'gone.action': 'key:KeyQ' });
  assert.equal(eff['gone.action'], undefined, 'a binding for an action that no longer exists is ignored');
  assert.deepEqual([eff['chop.note.0'], eff['chop.note.17'], eff['loop.4.A'], eff['loop.32.B'], eff['loop.half'], eff['loop.4.C'], eff['loop.double.D'], eff['lower.toggle']],
    ['key:KeyA', 'key:Quote', 'key:Digit1', 'key:Digit0', 'key:BracketLeft', '', '', 'key:KeyC']);
  assert.ok(ACTIONS.every((a) => ['trigger', 'hold', 'value'].includes(a.kind) && (a.def === '' || parseBinding(a.def))), 'every action has a kind and a source-tagged default');
  assert.ok(validateBindings({}).ok, 'the defaults do not collide');
  assert.equal(bindingOf({ code: 'KeyA', ctrlKey: true, shiftKey: true }), 'key:Ctrl+Shift+KeyA');
  assert.equal(bindingOf({ code: 'ShiftLeft', shiftKey: true }), null);
  // presets: a name and a valid set each
  const presets = field('keys.presets');
  assert.deepEqual(coerce(presets, { Lefty: { 'loop.half': 'key:Comma', 'loop.double': 'key:BracketRight' } }), { value: { Lefty: { 'loop.half': 'key:Comma' } } });
  assert.match(coerce(presets, { Bad: { 'loop.half': 'key:KeyA' } }).error, /preset "Bad"/);
  // through the patch: saved under keys.*, delivered to the page with the ui settings
  const cfg = base();
  const r = applyPatch(cfg, { 'keys.bindings': { 'loop.half': 'key:Comma' } });
  assert.ok(r.ok); assert.deepEqual(cfg.keys.bindings, { 'loop.half': 'key:Comma' });
  assert.deepEqual(uiSettings(cfg).keys, { 'loop.half': 'key:Comma' });
  assert.equal(applyPatch(cfg, { 'keys.bindings': { 'loop.half': 'key:KeyA' } }).ok, false);
  assert.deepEqual(cfg.keys.bindings, { 'loop.half': 'key:Comma' }, 'a refused set changes nothing');
});
