// What the server holds: four patch slots, which one is being played, the sequence, the undo history, the
// presets the player has saved, and the notes between the page and Claude. Every change goes through apply(),
// from the page and from the CLI alike, so both see one synth and one undo history.
import fs from 'node:fs';
import path from 'node:path';
import { SLOTS, clonePatch, initPatch, normalizePatch, setParams } from './patch.mjs';
import { PRESETS, PRESET_LIST, findPreset, isBuiltIn, preset, kindOf, phraseOf } from './presets.mjs';
import { applySeqOp, normalizeSeq, parseRow } from './seq.mjs';
import { NOTE_MAX, NOTE_MIN } from './notes.mjs';

const UNDO_STEPS = 100;
const NOTES_KEPT = 40;
const SAVED_MAX = 200;                               // presets the player can save
const START = ['Acid bass', 'Warm pad', 'Pluck', 'Electric keys'];   // what the four slots hold on a first run
const START_ROW = 'C2 . C3 . | Eb2 . C3 G2 | C2 . Bb2 C3 | . G2 Bb2 -';

export class Store {
  // file: the slots and the sequence. presetsFile: the saved presets, kept apart so that undo never takes one away.
  constructor({ file = null, presetsFile = null } = {}) {
    this.file = file;
    this.presetsFile = presetsFile;
    this.saved = [];                                 // the player's presets: patches, in the order they were first saved
    this.slot = 'A';
    this.slots = Object.fromEntries(SLOTS.map((s, i) => [s, clonePatch(preset(START[i]))]));
    this.seq = normalizeSeq({ bpm: 118, steps: parseRow(START_ROW) });
    this.past = [];
    this.future = [];
    this.gesture = null;
    this.rev = 0;
    this.notes = [];
    this.noteId = 0;
    this.delivered = 0;                              // the last note from the page that `miniclaude wait` has handed out
    this.transport = { playing: false, awake: false };   // what the page last said: is it playing, may it make sound
    this.listeners = new Set();
    this.waiters = new Set();
    this.load();
    this.loadPresets();
  }

  loadPresets() {
    if (!this.presetsFile || !fs.existsSync(this.presetsFile)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.presetsFile, 'utf8'));
      this.saved = (Array.isArray(saved.presets) ? saved.presets : []).slice(0, SAVED_MAX).map(normalizePatch);
    } catch (err) {
      console.error(`could not read ${this.presetsFile}: ${err.message} (starting with no saved presets)`);
    }
  }

  savePresets() {
    if (!this.presetsFile) return;
    fs.mkdirSync(path.dirname(this.presetsFile), { recursive: true });
    const tmp = `${this.presetsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ presets: this.saved }, null, 1));
    fs.renameSync(tmp, this.presetsFile);
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const s of SLOTS) if (saved.slots?.[s]) this.slots[s] = normalizePatch(saved.slots[s]);
      if (SLOTS.includes(saved.slot)) this.slot = saved.slot;
      if (saved.seq) this.seq = normalizeSeq(saved.seq);
    } catch (err) {
      console.error(`could not read ${this.file}: ${err.message} (starting from the default patches)`);
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
    fs.writeFileSync(tmp, this.snapshot());
    fs.renameSync(tmp, this.file);
  }

  get patch() { return this.slots[this.slot]; }

  state() {
    return {
      rev: this.rev, slot: this.slot, slots: this.slots, seq: this.seq,
      canUndo: this.past.length > 0, canRedo: this.future.length > 0,
      presets: [...this.saved.map((p) => ({ name: p.name, kind: 'saved', saved: true })), ...PRESET_LIST], notes: this.notes,
    };
  }

  snapshot() { return JSON.stringify({ slot: this.slot, slots: this.slots, seq: this.seq }); }

  restore(json) {
    const saved = JSON.parse(json);
    this.slot = saved.slot;
    this.slots = saved.slots;
    this.seq = saved.seq;
  }

  // One change. `op.gesture` ties the many edits of one drag (a slider being moved) into one undo step.
  apply(op) {
    if (!op || typeof op.op !== 'string') throw new Error('an edit needs an "op"');
    const before = this.snapshot();
    let undoable = true;
    const others = () => SLOTS.filter((s) => s !== this.slot).join(', ');
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
        undoable = false;
        break;
      case 'copy':                                   // the playing patch into another slot
        if (!SLOTS.includes(op.to) || op.to === this.slot) throw new Error(`copy to one of the other slots (${others()})`);
        this.slots[op.to] = clonePatch(this.patch);
        break;
      case 'set':                                    // one parameter ({ param, value }) or several ({ values })
        this.slots[this.slot] = setParams(this.patch, op.values ?? { [op.param]: op.value });
        break;
      case 'name':
        this.slots[this.slot] = normalizePatch({ ...this.patch, name: op.value });
        break;
      case 'preset':
        this.slots[this.slot] = clonePatch(findPreset(op.name, this.saved));
        break;
      case 'savepreset': {                           // the playing patch as a preset, under its own name or a new one
        const name = String(op.name ?? this.patch.name).trim().slice(0, 40);
        if (!name) throw new Error('a preset needs a name');
        if (isBuiltIn(name)) throw new Error(`"${name}" is a built-in preset: save yours under another name`);
        const same = this.saved.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
        if (same < 0 && this.saved.length >= SAVED_MAX) throw new Error(`${SAVED_MAX} presets are saved already: delete one first`);
        this.slots[this.slot] = normalizePatch({ ...this.patch, name });   // the patch takes the name it is saved under
        if (same >= 0) this.saved[same] = clonePatch(this.patch);
        else this.saved.push(clonePatch(this.patch));
        this.savePresets();
        break;
      }
      case 'deletepreset': {                         // not an undo step: undo is for the sound, not the list
        const name = String(op.name ?? '').trim().toLowerCase();
        const at = this.saved.findIndex((p) => p.name.toLowerCase() === name);
        if (at < 0) throw new Error(isBuiltIn(name) ? 'the built-in presets cannot be deleted' : `no saved preset "${op.name}"${this.saved.length ? ` (saved: ${this.saved.map((p) => p.name).join(', ')})` : ''}`);
        this.saved.splice(at, 1);
        this.savePresets();
        break;
      }
      case 'init':
        this.slots[this.slot] = initPatch();
        break;
      case 'replace':
        this.slots[this.slot] = normalizePatch(op.patch);
        break;
      default:
        this.seq = applySeqOp(this.seq, op);
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

  // Ask the open pages to make a sound now: the sequence ({ action: 'seq', loops }), some notes held for a while
  // ({ action: 'notes', notes, seconds }), a preset heard without loading it ({ action: 'preset', name }: a phrase
  // that suits its kind, on a synth of its own), or silence ({ action: 'stop' }). Nothing in the state changes.
  play(request) {
    const action = request?.action;
    let event;
    if (action === 'seq') event = { action, loops: Math.min(64, Math.max(0, Math.round(Number(request.loops) || 0))) };   // 0: until stopped
    else if (action === 'stop') event = { action };
    else if (action === 'preset') {
      const patch = findPreset(request.name, this.saved);
      const kind = PRESETS.find((p) => p.patch.name === patch.name)?.kind ?? kindOf(patch);
      event = { action, name: patch.name, kind, patch, phrase: phraseOf(kind) };
    }
    else if (action === 'notes') {
      const notes = Array.isArray(request.notes) ? request.notes.map(Number) : [];
      if (!notes.length || notes.length > 8 || notes.some((n) => !Number.isInteger(n) || n < NOTE_MIN || n > NOTE_MAX)) throw new Error('play one to eight notes');
      event = { action, notes, seconds: Math.min(10, Math.max(0.05, Number(request.seconds) || 1)), vel: Math.min(1, Math.max(0.05, Number(request.vel) || 0.8)) };
    } else throw new Error('play what? (seq, notes, preset or stop)');
    for (const fn of this.listeners) fn(event, 'play');
    return { pages: this.listeners.size, awake: this.transport.awake, ...(event.name ? { name: event.name } : {}) };
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
