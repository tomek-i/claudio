// What the server holds: four pattern slots, which one is being played, the undo history, the variations on
// offer, and the notes between the page and Claude. Every change goes through apply(), from the page and from
// the CLI alike, so both see one beat and one undo history.
import fs from 'node:fs';
import path from 'node:path';
import { SLOTS, applyOp, emptyPattern, normalizePattern, clonePattern } from './pattern.mjs';
import { continuePattern, humanize, morph, variations } from './groove.mjs';
import { PRESETS, PRESET_NAMES, preset } from './presets.mjs';

const UNDO_STEPS = 100;
const NOTES_KEPT = 40;

export class Store {
  constructor({ file = null } = {}) {
    this.file = file;
    this.slot = 'A';
    this.slots = Object.fromEntries(SLOTS.map((s, i) => [s, i === 0 ? clonePattern(PRESETS[0]) : emptyPattern()]));
    this.candidates = null;
    this.past = [];
    this.future = [];
    this.gesture = null;
    this.rev = 0;
    this.notes = [];
    this.noteId = 0;
    this.delivered = 0;                              // the last note from the page that `cl808 wait` has handed out
    // what the page last said: is it playing, since when and from which step (for the banner), and does the browser let it sound
    this.transport = { playing: false, at: 0, from: 0, awake: false };
    this.listeners = new Set();
    this.waiters = new Set();
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const s of SLOTS) if (saved.slots?.[s]) this.slots[s] = normalizePattern(saved.slots[s]);
      if (SLOTS.includes(saved.slot)) this.slot = saved.slot;
    } catch (err) {
      console.error(`could not read ${this.file}: ${err.message} (starting from the default beat)`);
    }
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ slot: this.slot, slots: this.slots }));
    fs.renameSync(tmp, this.file);
  }

  get pattern() { return this.slots[this.slot]; }

  state() {
    return {
      rev: this.rev, slot: this.slot, slots: this.slots, candidates: this.candidates,
      canUndo: this.past.length > 0, canRedo: this.future.length > 0,
      presets: PRESET_NAMES, notes: this.notes,
    };
  }

  snapshot() { return JSON.stringify({ slot: this.slot, slots: this.slots }); }

  restore(json) {
    const saved = JSON.parse(json);
    this.slot = saved.slot;
    this.slots = saved.slots;
  }

  // One change. `op.gesture` ties the many edits of one drag (a painted row, a turned knob) into one undo step.
  apply(op) {
    if (!op || typeof op.op !== 'string') throw new Error('an edit needs an "op"');
    const before = this.snapshot();
    let undoable = true;
    switch (op.op) {
      case 'undo':
      case 'redo': {
        const [from, to] = op.op === 'undo' ? [this.past, this.future] : [this.future, this.past];
        if (!from.length) throw new Error(`nothing to ${op.op}`);
        to.push(before);
        this.restore(from.pop());
        this.gesture = null;
        undoable = false;
        break;
      }
      case 'slot':
        if (!SLOTS.includes(op.slot)) throw new Error(`the slots are ${SLOTS.join(', ')}`);
        this.slot = op.slot;
        this.candidates = null;
        undoable = false;
        break;
      case 'copy':                                   // the playing pattern into another slot
        if (!SLOTS.includes(op.to) || op.to === this.slot) throw new Error(`copy to one of the other slots (${SLOTS.filter((s) => s !== this.slot).join(', ')})`);
        this.slots[op.to] = clonePattern(this.pattern);
        break;
      case 'replace':
        this.slots[this.slot] = normalizePattern(op.pattern);
        break;
      case 'preset':
        this.slots[this.slot] = clonePattern(preset(op.name));
        break;
      case 'humanize':
        this.slots[this.slot] = humanize(this.pattern, op);
        break;
      case 'continue':
        this.slots[this.slot] = continuePattern(this.pattern, op);
        break;
      case 'morph': {
        if (!SLOTS.includes(op.to) || op.to === this.slot) throw new Error(`morph towards one of the other slots (${SLOTS.filter((s) => s !== this.slot).join(', ')})`);
        this.slots[this.slot] = { ...morph(this.pattern, this.slots[op.to], op.amount ?? 0.5, op.seed), name: this.pattern.name };
        break;
      }
      case 'vary':                                   // puts versions on offer; the beat itself is not changed
        this.candidates = variations(this.pattern, op);
        undoable = false;
        break;
      case 'pick': {
        const chosen = this.candidates?.[Number(op.index)];
        if (!chosen) throw new Error(this.candidates ? `pick one of 1 to ${this.candidates.length}` : 'there are no variations on offer (make some first)');
        this.slots[this.slot] = clonePattern(chosen);
        break;
      }
      default:
        this.slots[this.slot] = applyOp(this.pattern, op);
    }
    if (undoable && this.snapshot() !== before) {
      if (!(op.gesture && op.gesture === this.gesture)) {
        this.past.push(before);
        if (this.past.length > UNDO_STEPS) this.past.shift();
      }
      this.future = [];
      this.gesture = op.gesture || null;
    }
    return this.changed();
  }

  changed() {
    this.rev++;
    this.save();
    const state = this.state();
    for (const fn of this.listeners) fn(state);
    return state;
  }

  // ---- notes: what is typed into the page for Claude, and what Claude answers

  note(from, text) {
    const clean = String(text ?? '').trim().slice(0, 500);
    if (!clean) throw new Error('an empty note');
    const note = { id: ++this.noteId, from, text: clean, at: Date.now() };
    this.notes = [...this.notes, note].slice(-NOTES_KEPT);
    if (from === 'you') for (const wake of this.waiters) wake();
    this.changed();
    return note;
  }

  pending() { return this.notes.filter((n) => n.from === 'you' && n.id > this.delivered); }

  // the notes from the page that have not been handed out yet; waits up to `ms` for one to arrive
  async wait(ms) {
    if (!this.pending().length && ms > 0) {
      await new Promise((resolve) => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, ms);
        this.waiters.add(wake);
      });
    }
    const notes = this.pending();
    if (notes.length) this.delivered = notes[notes.length - 1].id;
    return notes;
  }
}
