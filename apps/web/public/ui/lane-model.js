// The lanes of an automation take (automation-core.js) as the Automation tab shows and edits them (ui/lanes.js). No
// page in here: test/lanes.test.mjs runs it.
//   A control's lane (A.filter, xfader, …) is a curve: each `set` entry moves the value there in 12 ms (as Ctl.set),
//   each `auto` entry follows its points; a later entry cuts a path still running (as Ctl.automate does). Its handles
//   are what can be dragged: a set's (at, v), and each point of a path.
//   Every other lane (a deck's transport, key, crossfader side, FX, the echo, the sampler) is a row of marks; an entry
//   there can be moved in time as a whole, or deleted.
import { shiftEntry } from '../automation-core.js';

export const EASE = { linear: (x) => x, smooth: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x), in: (x) => x * x, out: (x) => 1 - (1 - x) * (1 - x) };
const SET_RAMP = 0.012;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export const isControlLane = (g) => !/\.(transport|key|xf|fx)$/.test(g) && g !== 'echo' && g !== 'pads';
const NAMES = { transport: 'transport', key: 'key', xf: 'XF side', fx: 'FX', vol: 'volume', filter: 'filter', echo: 'echo', trim: 'trim',
  'eq.high': 'EQ high', 'eq.mid': 'EQ mid', 'eq.low': 'EQ low', 'stem.vocals': 'vocals', 'stem.drums': 'drums', 'stem.bass': 'bass', 'stem.other': 'other' };
export function laneLabel(g) {
  const m = /^([A-D])\.(.+)$/.exec(g);
  if (m) return { deck: m[1], name: NAMES[m[2]] || m[2] };
  return { deck: null, name: { xfader: 'crossfader', master: 'master', echo: 'echo time', pads: 'sampler', 'sampler.vol': 'sampler volume' }[g] || g };
}
const ORDER = ['transport', 'vol', 'trim', 'eq.high', 'eq.mid', 'eq.low', 'filter', 'echo', 'fx', 'key', 'xf', 'stem.vocals', 'stem.drums', 'stem.bass', 'stem.other'];
const rank = (g) => {
  const m = /^([A-D])\.(.+)$/.exec(g);
  if (m) return 'ABCD'.indexOf(m[1]) * 100 + (ORDER.includes(m[2]) ? ORDER.indexOf(m[2]) : 50);
  return 1000 + ['xfader', 'master', 'echo', 'pads', 'sampler.vol'].indexOf(g);
};
export const laneSort = (a, b) => rank(a) - rank(b) || a.localeCompare(b);

// the control's range (from the engine when it runs) and its value at 0:00 (the set's saved decks)
const RANGES = { vol: [0, 1.5399], trim: [-12, 12], echo: [0, 1], 'stem.vocals': [0, 1], 'stem.drums': [0, 1], 'stem.bass': [0, 1], 'stem.other': [0, 1] };
export function rangeOf(g, controls) {
  if (controls?.[g]?.range) return controls[g].range;
  if (g === 'xfader' || g === 'sampler.vol') return [0, 1];
  if (g === 'master') return [0, 1.39];
  return RANGES[g.slice(2)] || [-1, 1];
}
export function startValue(g, snap) {
  const m = /^([A-D])\.(.+)$/.exec(g), d = m && snap?.decks?.[m[1]];
  if (g === 'xfader') return snap?.master?.xfader ?? 0.5;
  if (g === 'master') return snap?.master?.volume ?? 0.9;
  if (g === 'sampler.vol') return 0.85;
  if (!m) return 0;
  const k = m[2];
  if (k.startsWith('eq.')) return d?.eq?.[k.slice(3)] ?? 0;
  if (k.startsWith('stem.')) return d?.stems?.[k.slice(5)] ?? 1;
  return d?.[k] ?? (k === 'vol' ? 1 : 0);
}

export const entriesOf = (take, g) => take.entries.filter((e) => e.g === g);

// a control lane's curve: breakpoints [{ t, v, shape }] (shape: how the segment arriving at the point bends)
export function curve(entries, v0) {
  let bps = [{ t: 0, v: v0 }];
  const cut = (t) => { // a new entry at t: what was still to come is dropped, the value holds where it got to
    const v = valueAt(bps, t);
    bps = bps.filter((b) => b.t < t);
    bps.push({ t, v, shape: 'linear' });
    return v;
  };
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    if (e.k === 'set') { cut(e.at); bps.push({ t: e.at + SET_RAMP, v: e.v, shape: 'linear' }); }
    else if (e.k === 'auto' && e.pts?.length) {
      cut(e.at);
      if (e.pts[0].t > e.at) bps.push({ t: e.pts[0].t, v: valueAt(bps, e.pts[0].t), shape: 'linear' });
      for (const [i, p] of e.pts.entries()) bps.push({ t: p.t, v: p.v, shape: i === 0 ? 'linear' : p.shape || 'smooth' });
    }
  }
  return bps;
}
export function valueAt(bps, t) {
  if (t <= bps[0].t) return bps[0].v;
  for (let i = 1; i < bps.length; i++) {
    const a = bps[i - 1], b = bps[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + (b.v - a.v) * EASE[b.shape || 'linear']((t - a.t) / (b.t - a.t));
  }
  return bps[bps.length - 1].v;
}

// what can be dragged in a control lane: { e, p } (p: the path point, -1 for a set) at (t, v)
export function handlesOf(entries) {
  const out = [];
  for (const e of entries) {
    if (e.k === 'set') out.push({ e, p: -1, t: e.at, v: e.v });
    else if (e.k === 'auto') e.pts.forEach((pt, p) => out.push({ e, p, t: pt.t, v: pt.v }));
  }
  return out;
}
const sortTake = (take) => { take.entries.sort((a, b) => a.at - b.at); take.duration = Math.max(take.duration || 0, ...take.entries.map((e) => e.at)); return take; };

export function moveHandle(take, h, t, v, range) {
  t = Math.max(0, t); v = Math.max(range[0], Math.min(range[1], v));
  if (h.p < 0) { h.e.at = r4(t); h.e.v = r4(v); }
  else {
    const pts = h.e.pts, lo = h.p > 0 ? pts[h.p - 1].t + 0.001 : 0, hi = h.p < pts.length - 1 ? pts[h.p + 1].t - 0.001 : Infinity;
    pts[h.p] = { ...pts[h.p], t: r4(Math.max(lo, Math.min(hi, t))), v: r4(v) };
    if (h.p === 0) h.e.at = Math.min(h.e.at, pts[0].t); // the path is set off no later than it starts
  }
  sortTake(take);
  return { ...h, t: h.p < 0 ? h.e.at : h.e.pts[h.p].t, v: h.p < 0 ? h.e.v : h.e.pts[h.p].v };
}
export function addPoint(take, g, t, v, range) {
  const e = { at: r4(Math.max(0, t)), g, k: 'set', id: g, v: r4(Math.max(range[0], Math.min(range[1], v))) };
  take.entries.push(e);
  sortTake(take);
  return { e, p: -1, t: e.at, v: e.v };
}
export function removeHandle(take, h) {
  if (h.p >= 0 && h.e.pts.length > 2) { h.e.pts.splice(h.p, 1); return take; }
  if (h.p >= 0) { // a path of two points loses one: what is left is a move to the other point
    const keep = h.e.pts[1 - h.p];
    Object.assign(h.e, { k: 'set', at: keep.t, v: keep.v }); delete h.e.pts;
    sortTake(take); return take;
  }
  take.entries.splice(take.entries.indexOf(h.e), 1);
  return take;
}
// a mark (any other lane): moved in time as a whole, everything in it with it
export function shiftWhole(take, e, dt) {
  dt = Math.max(-e.at, dt);
  const moved = { ...shiftEntry(e, dt), at: r4(e.at + dt) };
  take.entries[take.entries.indexOf(e)] = moved;
  sortTake(take);
  return moved;
}
export function removeEntry(take, e) { take.entries.splice(take.entries.indexOf(e), 1); return take; }

// the marks of a lane that is not a control: [{ e, t, label, kind }]
export function marksOf(entries, titleOf = (id) => id) {
  const out = [];
  for (const e of entries) {
    switch (e.k) {
      case 'ev':
        for (const x of e.events) {
          if (x.type === 'start') out.push({ e, t: x.t, label: '▶', kind: 'start' });
          else if (x.type === 'stop') out.push({ e, t: x.t, label: '■', kind: 'stop' });
          else if (x.type === 'seek') out.push({ e, t: x.t, label: `→${fmt(x.pos)}`, kind: 'seek' });
          else if (x.type === 'loop') out.push({ e, t: x.t, label: x.loop ? `loop ${x.loop.beats}` : 'loop off', kind: 'loop' });
          else if (x.type === 'rate') out.push({ e, t: x.t, label: `${x.rate >= 1 ? '+' : ''}${((x.rate - 1) * 100).toFixed(1)}%`, kind: 'rate' });
          else if (x.type === 'curve') out.push({ e, t: x.pts[0].t, end: x.pts[x.pts.length - 1].t, label: 'scratch', kind: 'curve' });
        }
        break;
      case 'hand': if (e.op !== 'move') out.push({ e, t: e.at, label: e.op === 'grab' ? '✋' : '', kind: `hand-${e.op}` }); break;
      case 'load': out.push({ e, t: e.at, label: `load ${titleOf(e.track)}`, kind: 'load' }); break;
      case 'param': if (e.m !== 'cancelScheduledValues') out.push({ e, t: e.a[1], label: '', kind: 'param' }); break;
      case 'key': out.push({ e, t: e.at, label: e.keylock != null ? `keylock ${e.keylock ? 'on' : 'off'}` : `key ${e.shift > 0 ? '+' : ''}${e.shift}`, kind: 'key' }); break;
      case 'xf': out.push({ e, t: e.at, label: `XF ${{ left: 'L', right: 'R', thru: 'thru' }[e.side] || e.side}`, kind: 'xf' }); break;
      case 'fx': out.push({ e, t: e.at, label: e.type === 'none' ? 'FX off' : `${e.type}${e.amount != null ? ' ' + e.amount : ''}`, kind: 'fx' }); break;
      case 'trig': case 'note': out.push({ e, t: e.when, label: String(e.pad), kind: 'pad' }); break;
      case 'grab': case 'capture': out.push({ e, t: e.at, label: `pad ${e.pad} ←`, kind: 'pad' }); break;
      default: break;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
