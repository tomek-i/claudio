// What the parts of the page share: the state the server last sent, what is selected, the link to the server
// (every edit is a POST to /api/op, and the state comes back on the event stream), and the audio engine.
import { findClip } from '/lib/project.mjs';
import { Engine } from './engine.js';

export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export const ui = {
  state: null,       // what the server last said
  clip: null,        // the id of the clip in the editor
  startBar: 0,       // where Play starts from
};

export const project = () => ui.state.project;
export const selected = () => (ui.state && ui.clip ? findClip(project(), ui.clip) : null);
export const engine = new Engine(project);

// ---- drawing: each part of the page adds a function that draws its share of the state

const painters = [];
export const onRender = (paint) => painters.push(paint);
export function render() {
  if (ui.state) for (const paint of painters) paint(project(), ui.state);
}
export function select(id) {
  if (ui.clip === id) return;
  ui.clip = id;
  render();
}

// ---- the link to the server

export function setStatus(text, kind = 'on') {
  $('status').className = `status ${kind}`;
  $('statusText').textContent = text;
}

let errorTimer = null;
export function complain(message) {
  setStatus(message, 'bad');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { errorTimer = null; setStatus('saved'); }, 4000);
}

export async function post(route, body) {
  const res = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function take(next) {
  if (ui.state && next.rev < ui.state.rev) return;
  ui.state = next;
  render();
}

// one edit; answers the new state, or null when the server refused it (the reason is shown)
export async function send(op) {
  try {
    const next = await post('/api/op', op);
    take(next);
    return next;
  } catch (err) {
    complain(err.message);
    return null;
  }
}

// for something that is dragged: one edit on its way at a time, and the latest position after it
const latest = new Map();
export async function sendLatest(key, op) {
  const slot = latest.get(key) || { busy: false, next: null };
  latest.set(key, slot);
  if (slot.busy) { slot.next = op; return; }
  slot.busy = true;
  await send(op);
  slot.busy = false;
  if (slot.next) { const next = slot.next; slot.next = null; sendLatest(key, next); }
}

let gestureCount = 0;
export const newGesture = () => `g${Date.now()}-${++gestureCount}`;

// A slider is one undo step from the moment it is taken hold of until it is let go, and the state does not
// write over a control while it is being dragged or typed in.
const dragging = new Set();
export function slide(input, op) {
  if (!input.gesture) { input.gesture = newGesture(); dragging.add(input); }
  sendLatest(input, { ...op, gesture: input.gesture });
}
export function letGo(input) {
  input.gesture = null;
  dragging.delete(input);
}
export function setValue(input, value) {
  if (dragging.has(input) || (!input.stale && input.type !== 'range' && document.activeElement === input)) return;
  input.stale = false;
  if (input.value !== String(value)) input.value = value;
}
// A typed value: after the edit the box shows what the server made of it (a tempo of 500 is 240; a refused value
// goes back to what it was), also while it still has the focus.
export async function commit(input, op) {
  await send(op);
  input.stale = true;
  render();
}

// the server's events: the state as the plain message, and named ones (`transport`) for whoever asked for them
export function connect(named = {}) {
  const events = new EventSource('/api/events');
  events.onmessage = (e) => { take(JSON.parse(e.data)); if (!errorTimer) setStatus('saved'); };
  events.onerror = () => setStatus('the server is not answering', 'bad');
  for (const [name, handle] of Object.entries(named)) events.addEventListener(name, (e) => handle(JSON.parse(e.data)));
}
