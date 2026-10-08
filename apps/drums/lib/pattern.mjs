// A pattern: tempo, swing, and one row per voice of the kit. Each step of a row has a velocity (0 = off) and an
// offset, the part of a step it sits early (negative) or late.
//
//   { name, bpm, swing, steps: 16 | 32, tracks: [{ voice, level, tune, mute, solo, vel: [...], off: [...] }] }
//
// Nothing here changes a pattern in place: every function returns a new one.
import { VOICES, LEVELS, letterOf, velOfLetter, levelOf, voiceId } from './kit.mjs';
import { clampOffset, stepSeconds } from './timing.mjs';

export const SLOTS = ['A', 'B', 'C', 'D'];
export const STEP_COUNTS = [16, 32];
export const BPM_RANGE = [40, 240];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (n, fallback) => (Number.isFinite(Number(n)) ? Number(n) : fallback);
const round = (n, places) => Number(n.toFixed(places)) + 0;   // + 0: a tiny negative number rounds to 0, not −0

export function emptyPattern(name = 'Empty', steps = 16) {
  return {
    name, bpm: 100, swing: 0, steps,
    tracks: VOICES.map((v) => ({ voice: v.id, level: 0.8, tune: 0, mute: false, solo: false, vel: Array(steps).fill(0), off: Array(steps).fill(0) })),
  };
}

// Whatever came in (a file, the page, a CLI argument) as a well-formed pattern: every voice of the kit, in kit
// order, every number in range. An off step has no offset.
export function normalizePattern(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.tracks)) throw new Error('not a pattern');
  const steps = STEP_COUNTS.includes(Number(input.steps)) ? Number(input.steps) : 16;
  const out = emptyPattern(String(input.name ?? 'Untitled').slice(0, 60) || 'Untitled', steps);
  out.bpm = round(clamp(num(input.bpm, 100), ...BPM_RANGE), 1);
  out.swing = round(clamp(num(input.swing, 0), 0, 1), 3);
  for (const track of out.tracks) {
    const src = input.tracks.find((t) => t && t.voice === track.voice);
    if (!src) continue;
    track.level = round(clamp(num(src.level, 0.8), 0, 1), 3);
    track.tune = round(clamp(num(src.tune, 0), -12, 12), 2);
    track.mute = !!src.mute;
    track.solo = !!src.solo;
    for (let s = 0; s < steps; s++) {
      const vel = round(clamp(num(src.vel?.[s], 0), 0, 1), 3);
      track.vel[s] = vel;
      track.off[s] = vel > 0 ? round(clampOffset(num(src.off?.[s], 0)), 4) : 0;
    }
  }
  return out;
}

export const clonePattern = (p) => normalizePattern(JSON.parse(JSON.stringify(p)));

// 16 → 32 plays the bar twice; 32 → 16 keeps the first bar.
export function resize(pattern, steps) {
  if (!STEP_COUNTS.includes(steps)) throw new Error('a pattern has 16 or 32 steps');
  const out = clonePattern(pattern);
  if (steps === out.steps) return out;
  for (const t of out.tracks) {
    t.vel = Array.from({ length: steps }, (_, s) => t.vel[s % out.steps]);
    t.off = Array.from({ length: steps }, (_, s) => t.off[s % out.steps]);
  }
  out.steps = steps;
  return out;
}

function trackOf(pattern, voice) {
  const id = voiceId(voice);
  return pattern.tracks.find((t) => t.voice === id);
}

function stepIndex(pattern, step) {
  const s = Number(step);
  if (!Number.isInteger(s) || s < 0 || s >= pattern.steps) throw new Error(`step ${step + 1} is not in a ${pattern.steps}-step pattern`);
  return s;
}

// One row written as text: "kick x...x...x...x..." ( . off, g ghost, o soft, x normal, X accent; | and spaces
// between steps are ignored). 16 steps into a 32-step pattern are played twice.
export function parseRow(line) {
  const m = /^\s*([A-Za-z][\w-]*)\s*[:=]?\s+(.+)$/.exec(line);
  if (!m) throw new Error(`cannot read the row "${line}" (write it as: kick x...x...x...x...)`);
  const voice = voiceId(m[1]);
  const vel = [...m[2].replace(/[\s|]/g, '')].map(velOfLetter);
  if (!STEP_COUNTS.includes(vel.length)) throw new Error(`the ${voice} row has ${vel.length} steps; a row has 16 or 32`);
  return { voice, vel };
}

// The edits a pattern takes. `op.op` names one; the rest of `op` is its arguments.
export function applyOp(pattern, op) {
  let p = clonePattern(pattern);
  switch (op.op) {
    case 'step': {                                  // one step: its velocity, its offset, or both
      const t = trackOf(p, op.track);
      const s = stepIndex(p, op.step);
      if (op.vel !== undefined) t.vel[s] = clamp(num(op.vel, 0), 0, 1);
      if (op.off !== undefined) {
        if (!(t.vel[s] > 0)) throw new Error(`there is no hit on ${t.voice} step ${s + 1} to move`);
        t.off[s] = num(op.off, 0);
      }
      break;
    }
    case 'param':
      if (op.key === 'steps') p = resize(p, Number(op.value));
      else if (op.key === 'bpm') p.bpm = num(op.value, p.bpm);
      else if (op.key === 'swing') p.swing = num(op.value, p.swing);
      else if (op.key === 'name') p.name = String(op.value);
      else throw new Error(`a pattern has no "${op.key}"`);
      break;
    case 'track': {
      const t = trackOf(p, op.track);
      if (op.key === 'level' || op.key === 'tune') t[op.key] = num(op.value, t[op.key]);
      else if (op.key === 'mute' || op.key === 'solo') t[op.key] = !!op.value;
      else throw new Error(`a row has no "${op.key}"`);
      break;
    }
    case 'clear':
      for (const t of op.track ? [trackOf(p, op.track)] : p.tracks) { t.vel.fill(0); t.off.fill(0); }
      break;
    case 'write': {                                 // whole rows as text; the rows not named stay as they are
      const rows = (op.lines || []).map(parseRow);
      if (!rows.length) throw new Error('nothing to write');
      if (rows.some((r) => r.vel.length === 32)) p = resize(p, 32);
      if (op.clear) for (const t of p.tracks) { t.vel.fill(0); t.off.fill(0); }
      for (const row of rows) {
        const t = trackOf(p, row.voice);
        t.vel = Array.from({ length: p.steps }, (_, s) => row.vel[s % row.vel.length]);
        t.off = t.off.map((off, s) => (t.vel[s] > 0 ? off : 0));
      }
      break;
    }
    case 'quantize':                                // what a plain grid does: every hit on its step, at one of four levels
      for (const t of p.tracks) {
        t.vel = t.vel.map((v) => (v > 0 ? LEVELS[levelOf(v)] : 0));
        t.off.fill(0);
      }
      break;
    default:
      throw new Error(`no such edit: ${op.op}`);
  }
  return normalizePattern(p);
}

// ---- as text, for the terminal

const ms = (steps, bpm) => `${steps > 0 ? '+' : '−'}${Math.abs(steps * stepSeconds(bpm) * 1000).toFixed(0)}ms`;

export function toText(pattern) {
  const pad = Math.max(...VOICES.map((v) => v.id.length)) + 2;
  const swingMs = (pattern.swing * 0.5 * stepSeconds(pattern.bpm) * 1000).toFixed(1);
  const lines = [`"${pattern.name}"  ${pattern.bpm} bpm  swing ${Math.round(pattern.swing * 100)}% (${swingMs} ms)  ${pattern.steps} steps`];
  lines.push(' '.repeat(pad) + Array.from({ length: pattern.steps }, (_, s) => (s % 4 ? '.' : (s / 4) % 4 + 1)).join(''));
  for (const t of pattern.tracks) {
    if (!t.vel.some((v) => v > 0)) continue;
    const moved = t.off.map((off, s) => (Math.abs(off) >= 0.005 ? `${s + 1} ${ms(off, pattern.bpm)}` : null)).filter(Boolean);
    const flags = [t.mute && 'muted', t.solo && 'solo', t.tune && `tune ${t.tune > 0 ? '+' : ''}${t.tune}`].filter(Boolean);
    lines.push(t.voice.padEnd(pad) + t.vel.map(letterOf).join('')
      + (flags.length ? `   [${flags.join(', ')}]` : '')
      + (moved.length ? `   off the grid: ${moved.join(', ')}` : ''));
  }
  if (lines.length === 2) lines.push('(no hits)');
  return lines.join('\n');
}
