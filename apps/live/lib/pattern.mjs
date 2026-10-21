// Patterns: a short line of code that describes a loop, in the mini-notation of TidalCycles and Strudel, so a beat
// from a Strudel stream can be pasted in. Our own code, not Strudel's (which is AGPL-3 and brings its own sound
// engine): the same syntax, playing on a drum kit and synth sounds of our own (lib/kit.mjs, lib/presets.mjs). No page
// in here, so test/pattern.test.mjs tests it in plain Node.
//
//   s("bd*4, [~ sd]*2, hh*8")             kick on every beat, snare on 2 and 4, eighth hats
//   note("<c3 eb3 g3 bb3>*2").s("bass")   a different note each half bar
//   s("bd sd").every(4, fast(2))          every fourth bar twice as fast
//
// parse(code) → a pattern; query(pattern, from, to) → the events that start between two cycles. One cycle is one bar.
// What is supported, with an example each, is in apps/live/PATTERNS.md.
//
// Time follows Tidal: a pattern answers "what starts in [from, to)", each event with its whole length. In a sequence
// each step plays its own cycle squeezed into its slot; in an alternation <a b> each item counts the cycles it has
// played, so "a <b c>" is a b, then a c. Randomness (? and sometimes) is a hash of the event's start: the same code
// gives the same bars every time, and different bars from one cycle to the next.
import { voiceId } from './kit.mjs';
import { presetId } from './presets.mjs';
import { DEFAULT_VEL } from './notes.mjs';

const EPS = 1e-9;
const snap = (t) => Math.round(t * 1e9) / 1e9 + 0;   // + 0: no -0
const cycleOf = (t) => Math.floor(t + EPS);

// An error in the code: where it is, and what was expected there.
export class PatternError extends Error {
  constructor(reason, line, col) {
    super(`line ${line}, column ${col}: ${reason}`);
    this.reason = reason; this.line = line; this.col = col;
  }
}

// ---- patterns: a pattern is a query, (from, to) → the events { start, end, value } that start in [from, to)

class Pattern {
  constructor(query) { this.query = query; }
}
const P = (query) => new Pattern(query);
const silence = P(() => []);

// the query cut at the cycle boundaries: fn(from, to, cycle) for each cycle it touches
const perCycle = (b, e, fn) => {
  const out = [];
  for (let c = cycleOf(b); c < e - EPS; c++) {
    const pb = Math.max(b, c), pe = Math.min(e, c + 1);
    if (pe - pb > EPS) out.push(...fn(pb, pe, c));
  }
  return out;
};
const startsIn = (b, e) => (ev) => ev.start >= b - EPS && ev.start < e - EPS;
const moved = (ev, f) => ({ ...ev, start: f(ev.start), end: f(ev.end) });

// one value, once a cycle
const pure = (value) => P((b, e) => {
  const out = [];
  for (let c = Math.ceil(b - EPS); c < e - EPS; c++) out.push({ start: c, end: c + 1, value });
  return out;
});

const stack = (pats) => P((b, e) => pats.flatMap((p) => p.query(b, e)));

// cycle c of the pattern, played in [c + s, c + e) of cycle c
function compress(p, s, e) {
  const w = e - s;
  if (w < EPS) return silence;
  return P((b, end) => perCycle(b, end, (pb, pe, c) => {
    const ib = Math.max(pb, c + s), ie = Math.min(pe, c + e);
    if (ie - ib < EPS) return [];
    const into = (t) => c + (t - c - s) / w, back = (t) => c + s + (t - c) * w;
    return p.query(into(ib), into(ie)).map((ev) => moved(ev, back));
  }));
}

// a sequence: each step its share of the cycle, by weight
function timecat(steps) {
  const total = steps.reduce((sum, st) => sum + st.w, 0);
  if (!steps.length || total <= 0) return silence;
  let at = 0;
  return stack(steps.map((st) => { const p = compress(st.p, at / total, (at + st.w) / total); at += st.w; return p; }));
}

// one per cycle in turn, each seeing the cycles it has played
function slowcat(pats) {
  const n = pats.length;
  if (!n) return silence;
  return P((b, e) => perCycle(b, e, (pb, pe, c) => {
    const shift = c - Math.floor(c / n);
    return pats[((c % n) + n) % n].query(pb - shift, pe - shift).map((ev) => moved(ev, (t) => t + shift));
  }));
}

const fastBy = (p, k) => (k <= 0 ? silence : k === 1 ? p : P((b, e) => p.query(b * k, e * k).map((ev) => moved(ev, (t) => t / k))));
const lateBy = (p, t) => (t === 0 ? p : P((b, e) => p.query(b - t, e - t).map((ev) => moved(ev, (x) => x + t))));
const filtered = (p, keep) => P((b, e) => p.query(b, e).filter(keep));
const withValue = (p, f) => P((b, e) => p.query(b, e).map((ev) => ({ ...ev, value: f(ev.value) })));

// the event sounding at time t (the latest that has started and not ended), or null
function eventAt(p, t) {
  for (const back of [0, 1, 4, 64]) {
    let best = null;
    for (const ev of p.query(cycleOf(t) - back, t + 1e-6)) if (ev.start <= t + EPS && ev.end > t + EPS && (!best || ev.start > best.start)) best = ev;
    if (best) return best;
  }
  return null;
}

// a number that can be a pattern ("<1 2>"): read at the start of each cycle, then fn(number) plays that cycle
function byNumber(arg, fn) {
  if (typeof arg === 'number') return fn(arg);
  const made = new Map();
  return P((b, e) => perCycle(b, e, (pb, pe, c) => {
    const k = eventAt(arg, c)?.value;
    if (typeof k !== 'number') return [];
    if (!made.has(k)) made.set(k, fn(k));
    return made.get(k).query(pb, pe);
  }));
}

// the structure of the left, the values of the right: each event takes what the right holds at its start (an event
// where the right holds nothing goes)
function setFrom(p, right, merge) {
  return P((b, e) => p.query(b, e).flatMap((ev) => {
    const at = eventAt(right, ev.start);
    return at ? [{ ...ev, value: merge(ev.value, at.value) }] : [];
  }));
}

// a number in [0, 1) from a time and a seed: the same for the same pair, every time
const mix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; };
const rand = (t, seed) => mix((Math.round(t * 1e6) | 0) ^ mix(seed + 0x9e3779b9)) / 4294967296;

const every = (p, n, f) => { const fp = f(p); return P((b, e) => perCycle(b, e, (pb, pe, c) => (((c % n) + n) % n === 0 ? fp : p).query(pb, pe))); };
const degradeBy = (p, x, seed) => filtered(p, (ev) => rand(ev.start, seed) >= x);
const sometimesBy = (p, x, f, seed) => stack([filtered(p, (ev) => rand(ev.start, seed) >= x), filtered(f(p), (ev) => rand(ev.start, seed) < x)]);
const off = (p, t, f) => stack([p, f(lateBy(p, t))]);

// each cycle backwards
const rev = (p) => P((b, e) => perCycle(b, e, (pb, pe, c) => p.query(c, c + 1)
  .map((ev) => ({ ...ev, start: Math.max(c, 2 * c + 1 - ev.end), end: 2 * c + 1 - ev.start }))
  .filter(startsIn(pb, pe))));

// each event played n times in its own length
const plyBy = (p, n) => (n < 1 ? silence : P((b, e) => p.query(cycleOf(b) - 1, e).flatMap((ev) => {
  const len = (ev.end - ev.start) / n;
  return Array.from({ length: Math.floor(n) }, (_, i) => ({ ...ev, start: ev.start + i * len, end: ev.start + (i + 1) * len }));
}).filter(startsIn(b, e))));

// Bjorklund's spreading of k hits over n steps, as Tidal and Strudel have it: (3,8) is x..x..x.
function bjork(k, n) {
  const go = (ons, offs, xs, ys) => {
    if (Math.min(ons, offs) <= 1) return [...xs.flat(), ...ys.flat()];
    if (ons > offs) return go(offs, ons - offs, xs.slice(0, offs).map((x, i) => [...x, ...ys[i]]), xs.slice(offs));
    return go(ons, offs - ons, xs.map((x, i) => [...x, ...ys[i]]), ys.slice(ons));
  };
  return go(k, n - k, Array.from({ length: k }, () => [1]), Array.from({ length: n - k }, () => [0]));
}
// the pattern on k of n steps, turned left by r steps
function euclid(p, k, n, r) {
  const hits = bjork(k, n), turn = ((r % n) + n) % n;
  return timecat([...hits.slice(turn), ...hits.slice(0, turn)].map((hit) => ({ p: hit ? p : silence, w: 1 })));
}

// ---- values: what an event plays. An event's value is an object of controls: s (a sound) with n (its number), note
// (a MIDI pitch), gain, velocity, and scale (when n is a degree of it).

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11], 'melodic minor': [0, 2, 3, 5, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9], 'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
  'whole tone': [0, 2, 4, 6, 8, 10], chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// c3, eb3, F#2, a (octave 3 when none is written), or a MIDI number; null when the text is none of those
function pitchOf(text) {
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = /^([a-gA-G])([#sbf]*)(-?\d+)?$/.exec(text);
  if (!m) return null;
  const acc = [...m[2]].reduce((sum, ch) => sum + (ch === '#' || ch === 's' ? 1 : -1), 0);
  return LETTER[m[1].toLowerCase()] + acc + ((m[3] === undefined ? 3 : Number(m[3])) + 1) * 12;
}

// a sound name: the kit's (bd, sd, hh, … and its own names) or a synth sound (bass, lead, pad, …)
export function soundOf(name) {
  try { return { kind: 'drum', id: voiceId(name) }; } catch {}
  try { return { kind: 'synth', id: presetId(name) }; } catch {}
  return null;
}

// What a word in a mini-notation string becomes, by what the string is for. Each throws a message; the parser adds
// where the word is.
const READ = {
  number: (t) => { const v = Number(t); if (!Number.isFinite(v) || !/^-?(\d+\.?\d*|\.\d+)$/.test(t)) throw new Error(`"${t}" is not a number`); return v; },
  sound: (t) => {
    const [name, n, more] = t.split(':');
    if (more !== undefined || !soundOf(name)) throw new Error(`no sound called "${name}" (the kit: bd, sd, hh, oh, cp, rim, lt, cb, …; the synths: bass, lead, pad, pluck, keys)`);
    return n === undefined ? { s: name } : { s: name, n: READ.number(n) };
  },
  note: (t) => { const p = pitchOf(t); if (p === null) throw new Error(`"${t}" is not a note (write c3, eb3, f#2, or a MIDI number)`); return { note: p }; },
  n: (t) => ({ n: READ.number(t) }),
  gain: (t) => ({ gain: READ.number(t) }),
  velocity: (t) => ({ velocity: READ.number(t) }),
  scale: (t) => {
    const [root, ...words] = t.split(':');
    const tonic = pitchOf(root), name = words.join(' ').toLowerCase();
    if (tonic === null || !SCALES[name]) throw new Error(`"${t}" is not a scale (write a root and a name, like C:major, A2:minor or D:minor:pentatonic)`);
    return { scale: { tonic, steps: SCALES[name] } };
  },
  // a string that is a pattern of its own (stack("bd hh", …), or "bd sd".fast(2)): a sound, a note or a number
  any: (t) => {
    if (soundOf(t.split(':')[0])) return READ.sound(t);
    const p = pitchOf(t);
    if (p !== null && !/^-?\d/.test(t)) return { note: p };
    if (p !== null) return { n: p };
    throw new Error(`"${t}" is not a sound, a note or a number`);
  },
};

// the places in the code of the two values that make one event
const both = (a, b) => [...(a.locs ?? []), ...(b.locs ?? [])];

// a degree of a scale as a pitch: 0 is the tonic, 7 the octave above in a seven-note scale, -1 the note below
const degree = ({ tonic, steps }, d) => {
  const i = Math.round(d), len = steps.length;
  return tonic + 12 * Math.floor(i / len) + steps[((i % len) + len) % len];
};

// ---- the mini-notation: the language inside the quotes

// text: what is inside the quotes, from: where it starts in the code, readWord: what each word becomes (READ.*)
function mini(text, from, readWord, ctx) {
  let i = 0, read = readWord;
  const fail = (reason, at = i) => ctx.fail(reason, from + at);
  const space = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const ends = (ch) => ch === undefined || /[\s,\]>)]/.test(ch);   // a word ends at a space, a comma, a bracket or the end

  // sequences side by side (a, b) until the closing bracket
  const layers = (close) => {
    const seqs = [sequence(close)];
    while (text[i] === ',') { i++; seqs.push(sequence(close)); }
    space();
    if (close && text[i] !== close) fail(i >= text.length ? `"${close}" expected before the end of the string` : `"${close}" expected`);
    if (!close && i < text.length) fail(`unexpected "${text[i]}"`);
    if (close) i++;
    return seqs;
  };
  const sequence = (close) => {
    const steps = [];
    for (;;) {
      space();
      if (i >= text.length || text[i] === ',' || text[i] === close) return steps;
      if (']>)'.includes(text[i])) fail(`unexpected "${text[i]}"`);
      if (text[i] === '!' && !/\d/.test(text[i + 1] ?? '')) {   // "a ! !": the step before, again
        if (!steps.length) fail('"!" repeats the step before it, and there is none');
        steps.push({ ...steps.at(-1) }); i++; continue;
      }
      if (text[i] === '_' && ends(text[i + 1])) {   // "a _ _": the step before, longer
        if (!steps.length) fail('"_" makes the step before it longer, and there is none');
        steps.at(-1).w += 1; i++; continue;
      }
      steps.push(...modifiers({ p: term(), w: 1 }));
    }
  };
  const term = () => {
    const at = i, ch = text[i];
    if (ch === '[') { i++; return stack(layers(']').map(timecat)); }
    if (ch === '<') { i++; return stack(layers('>').map((steps) => slowcat(steps.flatMap((st) => Array(Math.max(1, Math.round(st.w))).fill(st.p))))); }
    if (((ch === '~' || ch === '-') && ends(text[i + 1])) || (ch === '~' && /[*/!@?(]/.test(text[i + 1] ?? ''))) { i++; return silence; }   // a rest
    const m = /^[A-Za-z0-9#.:'\-^_]+/.exec(text.slice(i));
    if (!m) fail(`unexpected "${ch}"`);
    i += m[0].length;
    let v;
    try { v = read(m[0]); } catch (err) { return fail(err.message, at); }
    return pure(typeof v === 'object' ? { ...v, locs: [[from + at, from + i]] } : v);   // where the word is, to light it up
  };
  // a number after * / @ ? or in ( ): a word, or a pattern of numbers in brackets
  const amount = (what) => {
    space();
    if (text[i] === '[' || text[i] === '<') {   // a pattern of numbers: "bd*<2 3>"
      const words = read; read = READ.number;
      try { return term(); } finally { read = words; }
    }
    const m = /^-?(\d+\.?\d*|\.\d+)/.exec(text.slice(i));
    if (!m) fail(`a number expected after "${what}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const whole = (what) => { const at = i, v = amount(what); if (typeof v !== 'number' || !Number.isInteger(v)) fail(`a whole number expected in "${what}"`, at); return v; };
  const modifiers = (step) => {
    const out = [step];
    for (;;) {
      const ch = text[i], last = out.at(-1);
      if (ch === '*' || ch === '/') { i++; const k = amount(ch), p = last.p; last.p = byNumber(k, (n) => fastBy(p, ch === '*' ? n : n === 0 ? 0 : 1 / n)); }
      else if (ch === '@') { i++; const at = i, w = amount('@'); if (typeof w !== 'number' || w <= 0) fail('a length above 0 expected after "@"', at); last.w = w; }
      else if (ch === '!') { i++; const n = /\d/.test(text[i] ?? '') ? whole('!') : 2; for (let k = 1; k < n; k++) out.push({ ...last }); }
      else if (ch === '?') { i++; const x = /[\d.]/.test(text[i] ?? '') ? amount('?') : 0.5; last.p = degradeBy(last.p, x, ctx.seed++); }
      else if (ch === '(') {
        const open = i++, k = whole('(');
        space(); if (text[i] !== ',') fail('"," expected: (hits,steps) or (hits,steps,rotation)'); i++;
        const n = whole(',');
        space(); let r = 0;
        if (text[i] === ',') { i++; r = whole(','); space(); }
        if (text[i] !== ')') fail('")" expected');
        i++;
        if (n < 1 || k < 0 || k > n) fail(`(${k},${n}): the hits must be between 0 and the steps`, open);
        last.p = euclid(last.p, k, n, r);
      } else return out;
    }
  };

  const seqs = layers(null);
  return stack(seqs.map(timecat));
}

// ---- the code around the strings: the JavaScript that Strudel's snippets are written in, as far as patterns need it.
// Calls and method chains, strings, numbers with + - * /, arrow functions (x => x.fast(2)), several patterns on
// lines of their own (each may start with $: or $name:, and _ before it mutes it), comments.

function tokens(code, fail) {
  const out = [];
  for (let i = 0; i < code.length;) {
    const ch = code[i], rest = code.slice(i);
    if (/\s/.test(ch)) { i++; continue; }
    if (rest.startsWith('//')) { while (i < code.length && code[i] !== '\n') i++; continue; }
    if (rest.startsWith('/*')) { const j = code.indexOf('*/', i + 2); if (j < 0) fail('the comment is not closed with */', i); i = j + 2; continue; }
    if ('"\'`'.includes(ch)) {
      const j = code.indexOf(ch, i + 1);
      if (j < 0) fail(`the string is not closed: ${ch} expected`, i);
      out.push({ t: 'str', v: code.slice(i + 1, j), at: i + 1, pos: i }); i = j + 1; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(rest);
    if (num) { out.push({ t: 'num', v: Number(num[0]), pos: i }); i += num[0].length; continue; }
    const label = /^(_?)(\$?)([A-Za-z]\w*)?:/.exec(rest);   // $: or $drums: or drums: begins a block, _ mutes it
    if (label && (label[2] || label[3])) { out.push({ t: 'label', name: label[3] ?? null, muted: label[1] === '_', pos: i }); i += label[0].length; continue; }
    const id = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (id) { out.push({ t: 'id', v: id[0], pos: i }); i += id[0].length; continue; }
    if (rest.startsWith('=>')) { out.push({ t: 'op', v: '=>', pos: i }); i += 2; continue; }
    if ('(),.+-*/;'.includes(ch)) { out.push({ t: 'op', v: ch, pos: i }); i++; continue; }
    fail(`unexpected "${ch}"`, i);
  }
  return out;
}

// the statements of the code, as trees: { k: 'num' | 'str' | 'id' | 'call' | 'method' | 'bin' | 'neg' | 'arrow', … }
function syntax(code, fail) {
  const toks = tokens(code, fail);
  let k = 0;
  const peek = (v, at = k) => toks[at]?.t === 'op' && toks[at].v === v;
  const here = () => toks[k]?.pos ?? code.length;
  const expect = (v, what) => { if (!peek(v)) fail(`"${v}" expected${what ? ` ${what}` : ''}`, here()); k++; };
  const args = () => {
    const list = [];
    expect('(');
    while (!peek(')')) {
      list.push(expr());
      if (!peek(',')) break;
      k++;
    }
    expect(')', 'to close the call');
    return list;
  };
  const primary = () => {
    const tok = toks[k];
    if (!tok) return fail('the code ends where a value is expected', code.length);
    if (tok.t === 'num') { k++; return { k: 'num', v: tok.v, pos: tok.pos }; }
    if (tok.t === 'str') { k++; return { k: 'str', v: tok.v, at: tok.at, pos: tok.pos }; }
    if (tok.t === 'id') { k++; return peek('(') ? { k: 'call', name: tok.v, args: args(), pos: tok.pos } : { k: 'id', name: tok.v, pos: tok.pos }; }
    if (peek('(')) { k++; const e = expr(); expect(')'); return e; }
    return fail(`unexpected "${tok.v}"`, tok.pos);
  };
  const postfix = () => {
    let node = primary();
    while (peek('.')) {
      k++;
      const tok = toks[k];
      if (tok?.t !== 'id') fail('a function name expected after "."', here());
      k++;
      if (!peek('(')) fail(`"(" expected: write .${tok.v}(…)`, here());
      node = { k: 'method', obj: node, name: tok.v, args: args(), pos: tok.pos };
    }
    return node;
  };
  const unary = () => { if (peek('-')) { const pos = here(); k++; return { k: 'neg', a: unary(), pos }; } return postfix(); };
  const binary = (next, ops) => () => {
    let node = next();
    while (ops.some((op) => peek(op))) { const tok = toks[k++]; node = { k: 'bin', op: tok.v, a: node, b: next(), pos: tok.pos }; }
    return node;
  };
  const product = binary(unary, ['*', '/']);
  const sum = binary(product, ['+', '-']);
  const expr = () => {
    if (toks[k]?.t === 'id' && peek('=>', k + 1)) { const p = toks[k]; k += 2; return { k: 'arrow', param: p.v, body: expr(), pos: p.pos }; }
    if (peek('(') && toks[k + 1]?.t === 'id' && peek(')', k + 2) && peek('=>', k + 3)) { const p = toks[k + 1]; k += 4; return { k: 'arrow', param: p.v, body: expr(), pos: p.pos }; }
    return sum();
  };
  const statements = [];
  while (k < toks.length) {
    if (peek(';')) { k++; continue; }
    const label = toks[k].t === 'label' ? toks[k++] : null;
    const pos = label?.pos ?? toks[k]?.pos ?? code.length;
    statements.push({ node: expr(), muted: !!label?.muted, name: label?.name ?? null, pos });
  }
  return statements;
}

// a string not read yet: what its words become depends on where it goes
class Str { constructor(text, at) { this.text = text; this.at = at; } }

const CONTROLS = ['s', 'sound', 'note', 'n', 'gain', 'velocity'];
const readerOf = (name) => READ[name === 's' ? 'sound' : name];
const NAMES_ONLY = new Set(['s', 'sound']);

// The functions on patterns: what each takes before the pattern, and what it does. Kinds of argument: num (a number,
// or a string of numbers that changes by cycle), count (a whole number), amount (0 to 1), time (in cycles), fn (a
// function: fast(2), rev, x => x.ply(2)), scale (a string of scales), control (a string, or a number for gain).
const FUNCTIONS = {
  fast: [['num'], (p, k) => byNumber(k, (n) => fastBy(p, n))],
  slow: [['num'], (p, k) => byNumber(k, (n) => fastBy(p, n === 0 ? 0 : 1 / n))],
  ply: [['num'], (p, k) => byNumber(k, (n) => plyBy(p, n))],
  every: [['count', 'fn'], (p, n, f) => every(p, n, f)],
  firstOf: [['count', 'fn'], (p, n, f) => every(p, n, f)],
  sometimesBy: [['amount', 'fn'], (p, x, f, seed) => sometimesBy(p, x, f, seed)],
  sometimes: [['fn'], (p, f, seed) => sometimesBy(p, 0.5, f, seed)],
  often: [['fn'], (p, f, seed) => sometimesBy(p, 0.75, f, seed)],
  rarely: [['fn'], (p, f, seed) => sometimesBy(p, 0.25, f, seed)],
  almostNever: [['fn'], (p, f, seed) => sometimesBy(p, 0.1, f, seed)],
  almostAlways: [['fn'], (p, f, seed) => sometimesBy(p, 0.9, f, seed)],
  degradeBy: [['amount'], (p, x, seed) => degradeBy(p, x, seed)],
  degrade: [[], (p, seed) => degradeBy(p, 0.5, seed)],
  rev: [[], (p) => rev(p)],
  off: [['time', 'fn'], (p, t, f) => off(p, t, f)],
  late: [['time'], (p, t) => lateBy(p, t)],
  early: [['time'], (p, t) => lateBy(p, -t)],
  scale: [['scale'], (p, sc) => setFrom(p, sc, (a, b) => (a.n === undefined ? a : { ...a, note: degree(b.scale, a.n), locs: both(a, b) }))],
  ...Object.fromEntries(CONTROLS.map((name) => [name, [['control'], (p, c) => setFrom(p, c, (a, b) => ({ ...a, ...b, locs: both(a, b) }))]])),
};
const RANDOM = new Set(['sometimesBy', 'sometimes', 'often', 'rarely', 'almostNever', 'almostAlways', 'degradeBy', 'degrade']);
const inTurn = (ps) => timecat(ps.map((p) => ({ p, w: 1 })));
const MAKERS = { stack, cat: slowcat, slowcat, seq: inTurn, fastcat: inTurn };

function evaluate(statements, ctx) {
  const fail = (reason, pos) => ctx.fail(reason, pos);
  const patternOf = (v, node) => {
    if (v instanceof Pattern) return v;
    if (v instanceof Str) return mini(v.text, v.at, READ.any, ctx);
    return fail(typeof v === 'function' ? 'a pattern expected here, not a function' : `a pattern expected here, like "bd sd", not ${v}`, node.pos);
  };
  // an argument read by its kind (see FUNCTIONS); control is the name of the control it sets
  const arg = (kind, v, node, fname) => {
    const say = (what) => fail(`${fname} needs ${what}`, node.pos);
    if (kind === 'num') { if (typeof v === 'number') return v; if (v instanceof Str) return mini(v.text, v.at, READ.number, ctx); return say('a number, or a string of numbers'); }
    if (kind === 'count') { if (Number.isInteger(v) && v >= 1) return v; return say('a whole number from 1'); }
    if (kind === 'amount') { if (typeof v === 'number' && v >= 0 && v <= 1) return v; return say('an amount from 0 to 1'); }
    if (kind === 'time') { if (typeof v === 'number') return v; return say('a time in cycles, like 1/8'); }
    if (kind === 'fn') { if (typeof v === 'function') return v; return say('a function, like fast(2), rev or x => x.ply(2)'); }
    if (kind === 'scale') { if (v instanceof Str) return mini(v.text, v.at, READ.scale, ctx); return say('a scale, like "C:major"'); }
    // a control: its string, or a number (gain(0.5), note(60), n(2)); s and sound take names only
    if (v instanceof Str) return mini(v.text, v.at, readerOf(fname), ctx);
    if (typeof v === 'number' && !NAMES_ONLY.has(fname)) {
      try { return pure(readerOf(fname)(String(v))); } catch (err) { return fail(err.message, node.pos); }
    }
    if (v instanceof Pattern) return v;
    return say(NAMES_ONLY.has(fname) ? 'a string of sound names, like "bd sd"' : 'a string, or a number');
  };
  // name(args) on p: the arguments read by their kinds, and a seed for the random ones
  const apply = (name, p, values, nodes, pos) => {
    const [kinds, fn] = FUNCTIONS[name];
    if (values.length !== kinds.length) fail(`${name} takes ${kinds.length === 0 ? 'nothing' : `${kinds.length} argument${kinds.length > 1 ? 's' : ''}`} here, not ${values.length}`, pos);
    const read = kinds.map((kind, i) => arg(kind, values[i], nodes[i], name));
    return RANDOM.has(name) ? fn(p, ...read, ctx.seed++) : fn(p, ...read);
  };

  const value = (node, env) => {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return new Str(node.v, node.at);
      case 'neg': { const a = value(node.a, env); if (typeof a !== 'number') fail('"-" works on numbers only', node.pos); return -a; }
      case 'bin': {
        const a = value(node.a, env), b = value(node.b, env);
        if (typeof a !== 'number' || typeof b !== 'number') fail(`"${node.op}" works on numbers only`, node.pos);
        return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : a / b;
      }
      case 'arrow': return (p) => patternOf(value(node.body, { ...env, [node.param]: p }), node.body);
      case 'id': {
        if (node.name in env) return env[node.name];
        if (node.name === 'silence') return silence;
        const spec = FUNCTIONS[node.name];
        if (spec && spec[0].length === 0) return (p) => apply(node.name, p, [], [], node.pos);
        if (spec || MAKERS[node.name]) return fail(`${node.name} is a function: write ${node.name}(…)`, node.pos);
        return fail(`unknown name "${node.name}"`, node.pos);
      }
      case 'call': {
        const values = node.args.map((a) => value(a, env));
        if (MAKERS[node.name]) return MAKERS[node.name](values.map((v, i) => patternOf(v, node.args[i])));
        if (CONTROLS.includes(node.name) && values.length === 1) return arg('control', values[0], node.args[0], node.name);
        const spec = FUNCTIONS[node.name];
        if (!spec) return fail(`unknown function "${node.name}"`, node.pos);
        const want = spec[0].length;
        // fast(2) is a function waiting for its pattern; fast(2, "bd sd") is the pattern
        if (values.length === want) return (p) => apply(node.name, p, values, node.args, node.pos);
        if (values.length === want + 1) return apply(node.name, patternOf(values[want], node.args[want]), values.slice(0, want), node.args, node.pos);
        return fail(`${node.name} takes ${want} argument${want === 1 ? '' : 's'} (and the pattern), not ${values.length}`, node.pos);
      }
      case 'method': {
        const p = patternOf(value(node.obj, env), node.obj);
        if (!FUNCTIONS[node.name]) return fail(`unknown function ".${node.name}"`, node.pos);
        return apply(node.name, p, node.args.map((a) => value(a, env)), node.args, node.pos);
      }
    }
    return fail('cannot read this', node.pos);
  };

  return statements.map((st) => ({ ...st, pattern: patternOf(value(st.node, {}), st.node) }));
}

// ---- the two calls

// The code as a pattern: its blocks that are not muted, together. Throws a PatternError that says the line, the
// column and what was expected.
export function parse(code) {
  return stack(parseBlocks(code).filter((b) => !b.muted).map((b) => b.pattern));
}

// The blocks of the code, each on its own: { name, muted, line, pattern }. A block is a pattern on lines of its own,
// begun by $: or $name: (or name:); _ before it mutes it. A block with no name is called by its number: 1, 2, …
export function parseBlocks(code) {
  const text = String(code);
  const lineOf = (pos) => text.slice(0, Math.max(0, pos)).split('\n');
  const ctx = {
    seed: 0,
    fail(reason, pos) { const before = lineOf(pos); throw new PatternError(reason, before.length, before.at(-1).length + 1); },
  };
  return evaluate(syntax(text, ctx.fail), ctx).map((st, i) => ({ name: st.name ?? String(i + 1), muted: st.muted, line: lineOf(st.pos).length, pattern: st.pattern }));
}

// The events that start in [from, to), in cycles (one cycle is one bar), in the order they sound:
//   { start, len, sound, kind, pitch, vel, locs }
// sound: a kit voice (kind 'drum') or a synth sound (kind 'synth'), or null when only a note is given (the track's
// sound plays it). pitch: a MIDI number, or null for a drum. vel: 0 to 1, the normal level times gain and velocity.
// locs: where the words of the event are in the code, as [from, to) offsets, to light them up as they sound.
export function query(pattern, from, to) {
  return pattern.query(from, to).filter(startsIn(from, to)).map(({ start, end, value: v }) => {
    const sound = v.s !== undefined ? soundOf(v.s) : null;
    let pitch = v.note ?? null;
    if (pitch === null && v.n !== undefined && sound?.kind !== 'drum') pitch = 48 + v.n;   // n alone: semitones from C3
    const vel = Math.min(1, Math.max(0, DEFAULT_VEL * (v.gain ?? 1) * (v.velocity ?? 1)));
    return { start: snap(start), len: snap(end - start), sound: sound?.id ?? null, kind: sound?.kind ?? null, pitch: sound?.kind === 'drum' ? null : pitch, vel, locs: v.locs ?? [] };
  }).sort((a, b) => a.start - b.start || String(a.sound).localeCompare(String(b.sound)) || (a.pitch ?? 0) - (b.pitch ?? 0));
}

