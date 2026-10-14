import { STEMS, FX_TYPES, SCRATCH_PATTERNS } from '../engine.js';
import { $ } from './util.js';
import { mixer, tracks, liveBpm, liveDeck } from './state.js';
import { KB, kbState, kbTime, loopSet, renderKeys, renderPads } from './keys.js';
import { renderDeckMeta } from './deck.js';
import { renderLibrary } from './crate.js';

// ------------------------------------------------------------------ commands from Claude
const deckOf = (name) => {
  const d = mixer.decks[String(name).toUpperCase()];
  if (!d) throw new Error(`no deck "${name}" (A, B, C or D)`);
  return d;
};
const parsePos = (d, v) => {
  if (v == null || v === '') return null;
  const m = /^bar:(\d+)$/.exec(String(v));
  if (m) return d.posOfBeat((Number(m[1]) - 1) * 4);
  const n = Number(v);
  if (isNaN(n)) throw new Error(`bad position "${v}" (use seconds or bar:N)`);
  return n;
};
const rampSecs = (beats, d) => (beats ? (Number(beats) * 60) / (d?.effBpm || liveBpm() || 120) : 0);
function setCtl(ctl, value, ramp, d) {
  const secs = rampSecs(ramp, d);
  if (secs) ctl.ramp(Number(value), mixer.ctx.currentTime + 0.02, secs); else ctl.set(Number(value));
}
const onOff = (v) => !(v === false || v === 0 || /^(off|false|0|no)$/i.test(String(v)));
export async function loadTrack(deck, track, opts) {
  const d = deckOf(deck);
  tracks.set(track.id, track);
  renderDeckMeta(d);
  await d.load(track, opts);
  renderDeckMeta(d);
  renderLibrary();
  return d;
}

export const handlers = {
  async load({ deck, track, cue, force }) { // force: even over a deck that is on air (a set being opened has paused it)
    const d = await loadTrack(deck, track, { force: !!force });
    if (cue != null) { d.cuePoint = parsePos(d, cue); d.startPos = d.cuePoint; }
    return { deck: d.name, title: track.title, bpm: track.bpm, camelot: track.camelot, cue: +d.cuePoint.toFixed(2), stems: d.stemsLoaded, keylock: d.keylock, ...(d.warning ? { warning: d.warning } : {}) };
  },
  play({ deck, at }) {
    const d = deckOf(deck);
    if (!d.buffer) throw new Error(`deck ${d.name} is empty`);
    const o = mixer.other(d.name);
    if (at === 'bar' && o?.playing && o.track) {
      d.setRate(mixer.matchRate(d, o.effBpm));
      const nb = mixer.nextBoundary(o, 4);
      const phase = ((o.beatAt(o.position(nb.t)) % 4) + 4) % 4;
      const b = Math.round(d.beatAt(d.startPos) / 4) * 4 + phase;
      d.startSource(Math.max(0, d.posOfBeat(b)), nb.t);
      return { startsInSec: +(nb.t - mixer.ctx.currentTime).toFixed(2), synced: true, to: o.name };
    }
    d.play();
    return { playing: true };
  },
  pause({ deck }) { deckOf(deck).pause(); },
  cue({ deck, position }) {
    const d = deckOf(deck);
    const p = parsePos(d, position);
    if (p != null) { d.cuePoint = p; if (!d.playing) d.startPos = p; return { cue: p }; }
    d.pause(); d.startPos = d.cuePoint; return { cue: d.cuePoint };
  },
  seek({ deck, position }) { const d = deckOf(deck); d.seek(parsePos(d, position)); return { position: +d.position().toFixed(2) }; },
  sync({ deck }) { return mixer.sync(deckOf(deck).name); },
  tempo({ deck, value }) {
    const d = deckOf(deck);
    if (!d.track) throw new Error('deck is empty');
    const s = String(value);
    const rate = s.endsWith('%') ? 1 + Number(s.slice(0, -1)) / 100 : Number(s) / d.track.bpm;
    if (!isFinite(rate)) throw new Error('tempo must be a BPM like 128 or a pitch like +2%');
    d.setRate(rate);
    return { rate: +d.rate.toFixed(4), bpm: +d.effBpm.toFixed(2), keylock: d.keylock, effectiveCamelot: d.effectiveCamelot() };
  },
  eq({ deck, band, value, ramp }) { const d = deckOf(deck); setCtl(d.eq[band], value, ramp, d); },
  filter({ deck, value, ramp }) { const d = deckOf(deck); setCtl(d.filter, value, ramp, d); },
  vol({ deck, value, ramp }) { const d = deckOf(deck); setCtl(d.vol, value, ramp, d); },
  trim({ deck, value, ramp }) { const d = deckOf(deck); setCtl(d.trimDb, value, ramp, d); },
  echo({ deck, value, ramp }) {
    const d = deckOf(deck);
    mixer.delay.delayTime.setValueAtTime(Math.min(3.9, (60 / (d.effBpm || 120)) * 0.75), mixer.ctx.currentTime);
    setCtl(d.echo, value, ramp, d);
  },
  xfade({ value, ramp }) { setCtl(mixer.xfader, value, ramp, liveDeck()); },
  master({ value }) { mixer.master.set(Number(value)); },
  loop({ deck, beats, n }) {
    const d = deckOf(deck);
    if (beats === 'half' || beats === 'double') return { loop: d.scaleLoop(beats === 'half' ? 0.5 : 2) };
    if (beats === 'move') return { loop: d.moveLoop(n) };
    d.setLoop(Number(beats) || 0);
    return { loop: d.loop };
  },
  async mix(args) {
    if (args.track) await loadTrack(args.to, args.track);
    return mixer.mix(args);
  },
  speak({ text }) { if ($('#ttsToggle').checked) mixer.speak(text); },

  // ---- key lock / key shift
  keylock({ deck, on = true }) {
    const d = deckOf(deck);
    d.setKeylock(on === 'toggle' ? !d.keylock : onOff(on));
    return { deck: d.name, keylock: d.keylock, camelot: d.track?.camelot, effectiveCamelot: d.effectiveCamelot() };
  },
  key({ deck, semitones }) {
    const d = deckOf(deck);
    const s = /^(reset|off)$/i.test(String(semitones)) ? 0 : Number(semitones);
    if (!isFinite(s) || Math.abs(s) > 6) throw new Error('semitones must be a number from -6 to +6');
    d.setKeyShift(s);
    return { deck: d.name, keyShift: d.keyShift, camelot: d.track?.camelot, effectiveCamelot: d.effectiveCamelot() };
  },
  // ---- stems
  stem({ deck, stem, value, ramp }) {
    const d = deckOf(deck);
    if (!d.stemsLoaded) throw new Error(`deck ${d.name} has no stems loaded${d.track?.stems ? ' (stem fetch failed — the full mix is playing)' : ' — this track has not been separated'}`);
    const names = stem === 'all' ? STEMS : [stem];
    if (!names.every((n) => STEMS.includes(n))) throw new Error(`stem must be ${STEMS.join('|')}|all`);
    const v = Number(value);
    if (!isFinite(v)) throw new Error('value must be 0..1');
    for (const n of names) setCtl(d.stem[n], v, ramp, d);
    return { deck: d.name, stems: d.state().stems };
  },
  // ---- mixer routing
  xfassign({ deck, side }) {
    const d = deckOf(deck);
    const s = { l: 'left', left: 'left', a: 'left', r: 'right', right: 'right', b: 'right', t: 'thru', thru: 'thru', through: 'thru', off: 'thru' }[String(side).toLowerCase()];
    if (!s) throw new Error('side must be left, right or thru');
    d.setXfSide(s);
    return { deck: d.name, side: d.xfSide };
  },
  // ---- sampler
  sample({ pad, at = 'beat', vol }) {
    const t = mixer.quantTime(at);
    const r = mixer.sampler.trigger(Number(pad), t, vol != null ? Number(vol) : 1);
    return { ...r, startsInSec: +(t - mixer.ctx.currentTime).toFixed(2) };
  },
  async sampler({ pad, load, from, beats }) {
    if (pad == null) return { pads: mixer.sampler.state() };
    if (!load) throw new Error('usage: sampler {pad: 1-8, load: trackId, from: sec|bar:N, beats}');
    const r = await mixer.sampler.capture(Number(pad), load, from, beats);
    renderPads();
    return r;
  },
  // ---- chop keyboard (the KEYS panel): grab a chop from a deck, play it at a pitch, record a loop
  async keys({ pad, grab, beats, stem, from, note, at, gain, loop, bars, quant, octave, hold }) {
    if (pad != null) KB.pad = Number(pad);
    if (quant) KB.quant = quant;
    if (octave != null) KB.octave = Number(octave);
    if (bars) KB.loop.bars = Number(bars);
    if (hold != null) KB.hold = onOff(hold);
    let r = {};
    if (grab) r = await mixer.sampler.grab(KB.pad, grab, beats ?? 1, stem || null, from ?? null);
    if (note != null) {
      const t = at ? mixer.quantTime(at) : kbTime();
      mixer.sampler.note(KB.pad, Number(note), t, gain != null ? Number(gain) : KB.gain);
      r = { ...r, note: Number(note), startsInSec: +(t - mixer.ctx.currentTime).toFixed(3) };
    }
    if (loop) loopSet(loop);
    renderPads(); renderKeys();
    return { ...r, keys: kbState() };
  },
  // ---- deck FX
  deckfx({ deck, type, amount, ramp }) {
    const d = deckOf(deck);
    const t = type ?? d.fx.type;
    if (!FX_TYPES.includes(t)) throw new Error(`type must be ${FX_TYPES.join('|')}`);
    d.fx.set(t, amount != null ? Number(amount) : undefined, rampSecs(ramp, d));
    return { deck: d.name, fx: { type: d.fx.type, target: amount != null ? Number(amount) : d.fx.ctl ? +d.fx.ctl.value().toFixed(2) : 0 } };
  },
  // ---- scratch
  scratch({ deck, pattern = 'baby', beats = 4, at = 'bar' }) {
    const d = deckOf(deck);
    if (!SCRATCH_PATTERNS.includes(pattern)) throw new Error(`pattern must be ${SCRATCH_PATTERNS.join('|')}`);
    const T = mixer.quantTime(at, d);
    const r = d.scratchPattern(pattern, Number(beats) || 4, T);
    return { deck: d.name, pattern, beats: Number(beats) || 4, startsInSec: +(T - mixer.ctx.currentTime).toFixed(2), durationSec: +(r.endsAt - T).toFixed(2) };
  },

  perform({ steps, at = 'bar', ref }) { return mixer.perform({ steps, at, ref }); },
  // ---- automation (ui/automation.js): record the set's decks from 0:00, play it back, record over it
  async automation({ op = 'status', set, replace, format }) {
    const A = mixer.automation;
    if (op === 'record') {
      if (A.mode === 'play') A.punchIn();
      else if (A.mode === 'idle') { if (!set) throw new Error('no active set: choose one (dj sets use "<name>")'); await A.record(set, { replace: !!replace }); }
    } else if (op === 'overdub') { if (!set) throw new Error('no active set'); await A.play(set, { over: true }); }
    else if (op === 'play') { if (!set) throw new Error('no active set'); await A.play(set); }
    else if (op === 'export') { if (!set) throw new Error('no active set'); await A.exportSet(set, { format }); }
    else if (op === 'stop') { const stopped = await A.stop(); return { ...A.state(), stopped }; }
    return A.state();
  },
};
