// What the server holds: the project, the undo history, and the notes between the page and Claude. Every
// change goes through apply(), from the page and from the CLI alike, so both see one song and one undo history.
import fs from 'node:fs';
import path from 'node:path';
import { applyOp, normalizeProject } from './project.mjs';
import { TEMPLATES, TEMPLATE_NAMES, template } from './templates.mjs';

const UNDO_STEPS = 100;
const NOTES_KEPT = 40;

export class Store {
  constructor({ file = null } = {}) {
    this.file = file;
    this.project = structuredClone(TEMPLATES[0]);
    this.past = [];
    this.future = [];
    this.gesture = null;
    this.rev = 0;
    this.notes = [];
    this.noteId = 0;
    this.delivered = 0;                              // the last note from the page that `claudebase wait` has handed out
    this.listeners = new Set();                      // the open pages: each is told (event, data)
    this.waiters = new Set();
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      this.project = normalizeProject(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch (err) {
      console.error(`could not read ${this.file}: ${err.message} (starting from a template)`);
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
    fs.writeFileSync(tmp, JSON.stringify(this.project));
    fs.renameSync(tmp, this.file);
  }

  state() {
    return {
      rev: this.rev, project: this.project,
      canUndo: this.past.length > 0, canRedo: this.future.length > 0,
      templates: TEMPLATE_NAMES, notes: this.notes, pages: this.listeners.size,
    };
  }

  // One change. `op.gesture` ties the many edits of one drag (a moved clip, a turned knob) into one undo step.
  apply(op) {
    if (!op || typeof op.op !== 'string') throw new Error('an edit needs an "op"');
    const before = this.project;
    switch (op.op) {
      case 'undo':
      case 'redo': {
        const [from, to] = op.op === 'undo' ? [this.past, this.future] : [this.future, this.past];
        if (!from.length) throw new Error(`nothing to ${op.op}`);
        to.push(before);
        this.project = from.pop();
        this.gesture = null;
        return this.changed();
      }
      case 'template':                               // a new song from one of the templates
        this.project = structuredClone(template(op.name));
        break;
      case 'replace':                                // a whole project, as `show --json` prints it
        this.project = normalizeProject(op.project);
        break;
      case 'batch':                                  // several edits as one: all of them, or none when one is refused
        if (!Array.isArray(op.ops) || !op.ops.length) throw new Error('a batch needs a list of edits ("ops")');
        this.project = op.ops.reduce((project, one) => applyOp(project, one ?? {}), before);
        break;
      default:
        this.project = applyOp(before, op);         // a project is never changed in place, so `before` is the undo step
    }
    if (JSON.stringify(this.project) !== JSON.stringify(before)) {
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
    for (const tell of this.listeners) tell('state', state);
    return state;
  }

  // Play and stop, asked for from the CLI: the pages do the playing, so they are told. Answers how many heard it.
  transport(action, bar) {
    if (action !== 'play' && action !== 'stop') throw new Error('the transport takes "play" or "stop"');
    const at = Math.round(Number(bar ?? 0));
    if (action === 'play' && !(at >= 0 && at < this.project.bars)) throw new Error(`the song has bars 1 to ${this.project.bars}`);
    for (const tell of this.listeners) tell('transport', action === 'play' ? { action, bar: at } : { action });
    return { pages: this.listeners.size };
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
