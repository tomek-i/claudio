// The sequencer: one, two or four bars of sixteen steps (sixteenths) that play the patch without hands.
//
//   { bpm, gate, swing, bars, steps: [null | { notes: [60, 64], vel: 0.8, len: 1 }, … 16 × bars of them] }
//
// A step is a rest (null) or a note or chord with a velocity and a length in steps (2 or more is a tie over the
// rests that follow, across a bar line too). `gate` is how much of its last step a note is held for. Swing plays
// every second step late. notesInWindow() is the one place that says which notes start when: live playback and the
// WAV render both ask it.
//
// As text a row is a token per step: "C2 . C3 - | Eb2+G2 . C3! G2:50 | … || <the next bar>"  ( . rest, - tie,
// + chord, ! accent, :50 velocity in percent; | and || are ignored, and are written between beats and bars).
import { NOTE_MAX, NOTE_MIN, noteName, parseNote } from './notes.mjs';

export const STEPS = 16;                             // in a bar
export const BARS = [1, 2, 4];
export const lengthOf = (seq) => STEPS * seq.bars;  // the steps of the whole sequence
export const BPM_RANGE = [40, 240];
export const VEL = { normal: 0.8, accent: 1 };
const MAX_CHORD = 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (n, fallback) => (Number.isFinite(Number(n)) && n !== null ? Number(n) : fallback);
const round = (n, places) => Number(n.toFixed(places));

export const stepSeconds = (bpm) => 60 / bpm / 4;

// swing 0..1: how late the off steps (2nd, 4th, …) are, as a share of half a step
export const swingSteps = (step, swing) => (step % 2 ? (swing || 0) * 0.5 : 0);

export function emptySeq(bars = 1) {
  return { bpm: 120, gate: 0.6, swing: 0, bars, steps: Array(STEPS * bars).fill(null) };
}

// Whatever came in as a well-formed sequence. A note ends where the next one starts, and at the end of the last
// bar. One saved before there were bars is one bar long.
export function normalizeSeq(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.steps)) throw new Error('not a sequence');
  const bars = BARS.includes(Number(input.bars)) ? Number(input.bars) : BARS.find((b) => b * STEPS >= input.steps.length) ?? BARS.at(-1);
  const out = emptySeq(bars);
  const length = lengthOf(out);
  out.bpm = round(clamp(num(input.bpm, 120), ...BPM_RANGE), 1);
  out.gate = round(clamp(num(input.gate, 0.6), 0.05, 1), 2);
  out.swing = round(clamp(num(input.swing, 0), 0, 1), 2);
  for (let s = 0; s < length; s++) {
    const src = input.steps[s];
    if (!src || !Array.isArray(src.notes)) continue;
    const notes = [...new Set(src.notes.map(Number).filter((n) => Number.isInteger(n) && n >= NOTE_MIN && n <= NOTE_MAX))].sort((a, b) => a - b).slice(0, MAX_CHORD);
    if (notes.length) out.steps[s] = { notes, vel: round(clamp(num(src.vel, VEL.normal), 0.05, 1), 2), len: Math.max(1, Math.round(num(src.len, 1))) };
  }
  for (let s = 0; s < length; s++) {
    if (!out.steps[s]) continue;
    let room = 1;
    while (s + room < length && !out.steps[s + room]) room++;
    out.steps[s].len = Math.min(out.steps[s].len, room);
  }
  return out;
}

// ---- as text

// One token: null for a rest, 'tie', or { notes, vel }.
export function parseToken(token) {
  const text = String(token).trim();
  if (text === '.' || text === '') return null;
  if (text === '-') return 'tie';
  const m = /^(.+?)(!|:(\d{1,3}))?$/.exec(text);
  const vel = m[2] === '!' ? VEL.accent : m[3] !== undefined ? Number(m[3]) / 100 : VEL.normal;
  if (!(vel > 0 && vel <= 1)) throw new Error(`"${text}": a velocity is 1 to 100`);
  const notes = m[1].split('+').map(parseNote);
  if (notes.length > MAX_CHORD) throw new Error(`"${text}": a step holds at most ${MAX_CHORD} notes`);
  return { notes, vel };
}

// the tokens of a row, with the bar and beat marks taken out
export const rowTokens = (text) => String(text ?? '').replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);

// A row of tokens as `length` steps (16 for one bar). A shorter row that divides it (1, 2, 4, 8, 16 or 32 tokens)
// is repeated.
export function parseRow(text, length = STEPS) {
  const tokens = rowTokens(text);
  if (!tokens.length || length % tokens.length) throw new Error(`a row has ${length} steps (${length / STEPS} bar${length > STEPS ? 's' : ''} of ${STEPS}, or a part of that which divides it, which is repeated); this one has ${tokens.length}`);
  const steps = [];
  for (const token of tokens) {
    const step = parseToken(token);
    if (step !== 'tie') { steps.push(step && { ...step, len: 1 }); continue; }
    let from = steps.length - 1;
    while (from >= 0 && !steps[from]) from--;
    if (from < 0 || from + steps[from].len !== steps.length) throw new Error('a tie (-) comes straight after a note or another tie');
    steps[from].len++;
    steps.push(null);
  }
  return Array.from({ length }, (_, s) => (steps[s % steps.length] ? { ...steps[s % steps.length] } : null));
}

const tokenOf = (step) => step.notes.map(noteName).join('+') + (step.vel === VEL.accent ? '!' : step.vel === VEL.normal ? '' : `:${Math.round(step.vel * 100)}`);

// a token per step of the sequence: what parseRow reads back
export function tokens(seq) {
  const out = Array(seq.steps.length).fill('.');
  seq.steps.forEach((step, s) => {
    if (!step) return;
    out[s] = tokenOf(step);
    for (let i = 1; i < step.len; i++) out[s + i] = '-';
  });
  return out;
}

// one bar's row ("C2 . C3 - | …"), or the whole sequence's with || between the bars
export const barText = (seq, bar) => tokens(seq).slice(bar * STEPS, (bar + 1) * STEPS).map((t, s) => (s && s % 4 === 0 ? `| ${t}` : t)).join(' ');
export const rowText = (seq) => Array.from({ length: seq.bars }, (_, b) => barText(seq, b)).join(' || ');

export function seqText(seq) {
  const bars = Array.from({ length: seq.bars }, (_, b) => `\n        ${barText(seq, b)}`).join('');
  return `seq     ${seq.bpm} bpm   gate ${seq.gate}   swing ${seq.swing}${seq.bars > 1 ? `   ${seq.bars} bars` : ''}${bars}`;
}

// ---- edits

function stepIndex(seq, step) {
  const s = Number(step);
  if (!Number.isInteger(s) || s < 0 || s >= lengthOf(seq)) throw new Error(`a step is 1 to ${lengthOf(seq)}`);
  return s;
}

// The edits a sequence takes. `op.op` names one; the rest of `op` is its arguments.
export function applySeqOp(seq, op) {
  const out = normalizeSeq(seq);
  switch (op.op) {
    case 'row': {                                    // the whole sequence as text; a row of two or four bars sets that
      const n = rowTokens(op.text).length;
      if (n > lengthOf(out) && BARS.includes(n / STEPS)) out.bars = n / STEPS;
      out.steps = parseRow(op.text, lengthOf(out));
      break;
    }
    case 'step': {                                   // one step: a token, or { notes, vel }
      const s = stepIndex(out, op.step);
      const step = op.token !== undefined ? parseToken(op.token) : op.notes?.length ? { notes: op.notes, vel: op.vel ?? VEL.normal } : null;
      const owner = out.steps.findIndex((other, i) => other && i < s && i + other.len > s);   // a note tied over this step
      if (step === 'tie') {
        let from = s - 1;
        while (from >= 0 && !out.steps[from]) from--;
        if (from < 0) throw new Error(`there is no note before step ${s + 1} to tie`);
        out.steps[from].len = s - from + 1;
        out.steps[s] = null;
      } else {
        if (owner >= 0) out.steps[owner].len = s - owner;
        out.steps[s] = step && { ...step, len: 1 };
      }
      break;
    }
    case 'note': {                                   // the piano roll: a step's notes, velocity or length, as they are given
      const s = stepIndex(out, op.step);
      const was = out.steps[s];
      const notes = op.notes ?? was?.notes ?? [];
      if (!Array.isArray(notes)) throw new Error('notes is a list of note numbers');
      if (!notes.length) { out.steps[s] = null; break; }
      const owner = out.steps.findIndex((other, i) => other && i < s && i + other.len > s);
      if (owner >= 0 && !was) out.steps[owner].len = s - owner;   // a note starting inside a held one cuts it there
      const len = Math.max(1, Math.round(num(op.len, was?.len ?? 1)));   // held up to the next note at most (normalizeSeq)
      out.steps[s] = { notes, vel: num(op.vel, was?.vel ?? VEL.normal), len };
      break;
    }
    case 'seqparam':
      if (op.key === 'bars') {                       // longer: the bars there are, again; shorter: the end goes
        const bars = Number(op.value);
        if (!BARS.includes(bars)) throw new Error(`a sequence is ${BARS.join(', ')} bars long`);
        const was = out.steps;
        out.steps = Array.from({ length: STEPS * bars }, (_, s) => (was[s % was.length] ? { ...was[s % was.length] } : null));
        out.bars = bars;
        break;
      }
      if (!['bpm', 'gate', 'swing'].includes(op.key)) throw new Error(`a sequence has no "${op.key}"`);
      if (!Number.isFinite(Number(op.value)) || op.value === null || op.value === '') throw new Error(`${op.key} needs a number`);
      out[op.key] = Number(op.value);
      break;
    case 'transpose': {
      const by = Number(op.by);
      if (!Number.isInteger(by)) throw new Error('transpose by a whole number of semitones');
      for (const step of out.steps) {
        if (!step) continue;
        step.notes = step.notes.map((n) => n + by);
        if (step.notes.some((n) => n < NOTE_MIN || n > NOTE_MAX)) throw new Error('that takes a note out of range');
      }
      break;
    }
    case 'clearseq':
      out.steps.fill(null);
      break;
    default:
      throw new Error(`no such edit: ${op.op}`);
  }
  return normalizeSeq(out);
}

// ---- playing

// Every note that starts in [from, to), positions in steps since play was pressed, the sequence repeating for
// ever (or up to and including loop `lastLoop`). `len` is how long the key is held, in steps.
export function notesInWindow(seq, from, to, { lastLoop = Infinity } = {}) {
  const notes = [];
  const length = seq.steps.length;
  const first = Math.max(0, Math.floor((from - 0.5) / length));
  const last = Math.min(lastLoop, Math.floor(to / length));
  for (let loop = first; loop <= last; loop++) {
    seq.steps.forEach((step, s) => {
      if (!step) return;
      const pos = loop * length + s + swingSteps(s, seq.swing);
      if (pos < from || pos >= to) return;
      for (const note of step.notes) notes.push({ note, vel: step.vel, pos, len: step.len - 1 + seq.gate, step: s });
    });
  }
  return notes.sort((a, b) => a.pos - b.pos);
}
