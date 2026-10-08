// The arrangement: a row per track (its mixer at the left, its clips on the bar timeline at the right), the
// ruler with the bar numbers and the loop, and the clips by hand: drag to move, the right edge to resize.
import { MAX_BARS, clipEnd, findClip, fits } from '/lib/project.mjs';
import { PRESETS, PRESET_IDS } from '/lib/presets.mjs';
import { VOICE_IDS } from '/lib/kit.mjs';
import { $, el, ui, project, onRender, render, select, send, commit, sendLatest, newGesture, slide, letGo, setValue, engine } from './link.js';

export const BAR_W = 36;      // pixels to the bar
const COLOURS = ['var(--low)', 'var(--mid)', 'var(--high)', 'var(--perc)'];
export const colourOf = (track) => COLOURS[project().tracks.indexOf(track) % COLOURS.length];   // a track's colour, here and in the editor
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

$('arrInner').style.setProperty('--bar', `${BAR_W}px`);

// ---- drawing

function buildTrack(t) {
  const range = (cls, label, min, max) => el('label', {}, label, el('input', { type: 'range', className: cls, min, max, step: 1 }));
  const row = el('div', { className: 'track' },
    el('div', { className: 'head' },
      el('div', { className: 'l1' },
        el('input', { className: 'tname', maxLength: 40, spellcheck: false }),
        t.kind === 'synth'
          ? el('select', { className: 'sound' }, ...PRESET_IDS.map((id) => el('option', { value: id }, PRESETS[id].name)))
          : el('span', { className: 'kind' }, 'Drum kit'),
        el('button', { className: 'ms m', title: 'Mute' }, 'M'),
        el('button', { className: 'ms s', title: 'Solo' }, 'S'),
        el('button', { className: 'ms addclip', title: 'Add a clip after the last one' }, '+'),
        el('button', { className: 'ms del', title: 'Delete the track' }, '×')),
      el('div', { className: 'l2' }, range('vol', 'vol', 0, 100), range('pan', 'pan', -100, 100), range('reverb', 'rev', 0, 100), range('delay', 'dly', 0, 100))),
    el('div', { className: 'lane' }));
  row.dataset.track = t.id;
  return row;
}

// a clip as a small picture of what is in it, repeated as the clip repeats it
function thumb(clip) {
  const width = clip.bars * 16;
  const content = clip.len * 16;
  const rects = [];
  let rows = VOICE_IDS.length;
  if (clip.rows) {
    VOICE_IDS.forEach((voice, row) => clip.rows[voice].forEach((vel, s) => {
      if (vel > 0) for (let x = s; x < width; x += content) rects.push(`<rect x="${x}" y="${row + 0.1}" width="0.8" height="0.8" opacity="${0.4 + 0.6 * vel}"/>`);
    }));
  } else if (clip.notes.length) {
    const pitches = clip.notes.map((n) => n.pitch);
    const [lo, hi] = [Math.min(...pitches), Math.max(...pitches)];
    rows = Math.max(12, hi - lo + 1);                // a single pitch is a line in the middle, not a wall
    const top = hi + Math.floor((rows - (hi - lo + 1)) / 2);
    for (const n of clip.notes) {
      for (let x = n.start; x < width; x += content) rects.push(`<rect x="${x}" y="${top - n.pitch}" width="${Math.max(0.5, Math.min(n.len, width - x) - 0.15)}" height="0.9" opacity="${0.4 + 0.6 * n.vel}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${width} ${rows}" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${rects.join('')}</svg>`;
}

function paintClips(lane, t) {
  const have = new Map([...lane.children].map((node) => [node.dataset.clip, node]));
  for (const clip of t.clips) {
    let node = have.get(clip.id);
    if (!node) {
      node = el('button', { className: 'clip' }, el('span', { className: 'label' }), el('span', { className: 'thumb' }), el('i', { className: 'grip' }));
      node.dataset.clip = clip.id;
      lane.append(node);
    }
    have.delete(clip.id);
    node.style.left = `${clip.bar * BAR_W}px`;
    node.style.width = `${clip.bars * BAR_W - 2}px`;
    node.setAttribute('aria-pressed', clip.id === ui.clip);
    node.setAttribute('aria-label', `Clip ${clip.id} on ${t.name}, ${clip.bars === 1 ? `bar ${clip.bar + 1}` : `bars ${clip.bar + 1} to ${clipEnd(clip)}`}`);
    node.firstChild.textContent = clip.id;
    const key = JSON.stringify([clip.bars, clip.len, clip.rows || clip.notes]);
    if (node.dataset.key !== key) { node.dataset.key = key; node.children[1].innerHTML = thumb(clip); }
  }
  for (const node of have.values()) node.remove();
}

let builtTracks = null;
function paintTracks(p) {
  $('arrInner').style.setProperty('--bars', p.bars);
  const key = p.tracks.map((t) => t.id + t.kind).join(' ');
  if (key !== builtTracks) {
    builtTracks = key;
    $('tracks').replaceChildren(...p.tracks.map(buildTrack));
  }
  const solo = p.tracks.some((t) => t.solo);
  [...$('tracks').children].forEach((row, i) => {
    const t = p.tracks[i];
    const q = (sel) => row.querySelector(sel);
    const label = (sel, text) => q(sel).setAttribute('aria-label', `${text} ${t.name}`);
    row.style.setProperty('--c', colourOf(t));
    row.classList.toggle('silent', solo ? !t.solo : t.mute);
    setValue(q('.tname'), t.name);
    q('.tname').setAttribute('aria-label', `Name of track ${i + 1}`);
    if (t.kind === 'synth') { setValue(q('.sound'), t.preset); label('.sound', 'Sound of'); }
    q('.m').setAttribute('aria-pressed', t.mute); label('.m', 'Mute');
    q('.s').setAttribute('aria-pressed', t.solo); label('.s', 'Solo');
    label('.addclip', 'Add a clip to'); label('.del', 'Delete track');
    for (const [cls, value, text] of [['vol', t.vol, 'Volume of'], ['pan', t.pan, 'Pan of'], ['reverb', t.reverb, 'Reverb send of'], ['delay', t.delay, 'Delay send of']]) {
      setValue(q(`.${cls}`), Math.round(value * 100));
      label(`.${cls}`, text);
      q(`.${cls}`).title = `${text} ${t.name}: ${Math.round(value * 100)}`;
    }
    paintClips(q('.lane'), t);
  });
}

let builtBars = 0;
function paintRuler(p) {
  if (p.bars !== builtBars) {
    builtBars = p.bars;
    $('ruler').replaceChildren(el('div', { className: 'loopband' }), ...Array.from({ length: p.bars }, (_, b) => {
      const button = el('button', { className: 'barno', title: `Play from bar ${b + 1}` }, String(b + 1));
      button.dataset.bar = b;
      return button;
    }));
  }
  ui.startBar = clamp(ui.startBar, 0, p.bars - 1);
  for (const button of $('ruler').querySelectorAll('.barno')) button.setAttribute('aria-pressed', Number(button.dataset.bar) === ui.startBar);
  const band = $('ruler').firstChild;
  band.style.left = `${p.loop.from * BAR_W}px`;
  band.style.width = `${(p.loop.to - p.loop.from) * BAR_W}px`;
  band.classList.toggle('on', p.loop.on);
}

onRender((p) => { paintRuler(p); paintTracks(p); });

// ---- the ruler: where Play starts

$('ruler').addEventListener('click', (e) => {
  const button = e.target.closest('.barno');
  if (!button) return;
  ui.startBar = Number(button.dataset.bar);
  if (engine.playing) engine.start(ui.startBar * 16);   // while playing, the playhead jumps there
  render();
});

// ---- the track headers

const trackOfNode = (node) => project().tracks.find((t) => t.id === node.closest('.track')?.dataset.track);

async function addClip(track, bar, bars) {
  const state = await send({ op: 'clip.add', track: track.id, bar, bars });
  if (!state) return;
  select(`c${state.project.ids.c}`);
  $('tracks').querySelector(`[data-clip="${ui.clip}"]`)?.focus();
}

$('tracks').addEventListener('click', (e) => {
  const track = trackOfNode(e.target);
  if (!track) return;
  const set = (key, value) => send({ op: 'track.set', track: track.id, key, value });
  if (e.target.closest('.m')) set('mute', !track.mute);
  else if (e.target.closest('.s')) set('solo', !track.solo);
  else if (e.target.closest('.del')) send({ op: 'track.del', track: track.id });
  else if (e.target.closest('.addclip')) addClip(track, Math.max(0, ...track.clips.map(clipEnd)), 4);
  else if (e.target.closest('.clip')) select(e.target.closest('.clip').dataset.clip);   // Enter on a focused clip
});

$('tracks').addEventListener('change', (e) => {
  const track = trackOfNode(e.target);
  if (!track) return;
  if (e.target.type === 'range') letGo(e.target);
  else if (e.target.classList.contains('tname')) commit(e.target, { op: 'track.set', track: track.id, key: 'name', value: e.target.value });
  else if (e.target.classList.contains('sound')) send({ op: 'track.set', track: track.id, key: 'preset', value: e.target.value });
});

$('tracks').addEventListener('input', (e) => {
  if (e.target.type !== 'range') return;
  slide(e.target, { op: 'track.set', track: trackOfNode(e.target).id, key: e.target.className, value: e.target.value / 100 });
});

$('addDrums').addEventListener('click', () => send({ op: 'track.add', kind: 'drums' }));
$('addSynth').addEventListener('click', () => send({ op: 'track.add', kind: 'synth', preset: 'lead' }));

// ---- clips by hand

let drag = null;
$('tracks').addEventListener('pointerdown', (e) => {
  const node = e.target.closest('.clip');
  if (!node || e.button !== 0) return;
  e.preventDefault();
  const { clip } = findClip(project(), node.dataset.clip);
  select(clip.id);
  node.focus();
  $('tracks').setPointerCapture(e.pointerId);
  drag = { kind: e.target.closest('.grip') ? 'size' : 'move', id: clip.id, x: e.clientX, bar: clip.bar, bars: clip.bars, gesture: newGesture() };
});

$('tracks').addEventListener('pointermove', (e) => {
  const found = drag && findClip(project(), drag.id);
  if (!found) return;
  const { track, clip } = found;
  const by = Math.round((e.clientX - drag.x) / BAR_W);
  if (drag.kind === 'move') {
    const bar = clamp(drag.bar + by, 0, MAX_BARS - clip.bars);
    if (bar !== clip.bar && fits(track, bar, clip.bars, clip.id)) sendLatest('clip', { op: 'clip.move', clip: clip.id, bar, gesture: drag.gesture });
  } else {
    const bars = clamp(drag.bars + by, 1, MAX_BARS - clip.bar);
    if (bars !== clip.bars && fits(track, clip.bar, bars, clip.id)) sendLatest('clip', { op: 'clip.resize', clip: clip.id, bars, gesture: drag.gesture });
  }
});
for (const type of ['pointerup', 'pointercancel']) $('tracks').addEventListener(type, () => { drag = null; });

// an empty bar, double-clicked: a clip of up to four bars, as many as are free
$('tracks').addEventListener('dblclick', (e) => {
  if (!e.target.classList.contains('lane')) return;
  const track = trackOfNode(e.target);
  const bar = Math.floor((e.clientX - e.target.getBoundingClientRect().left) / BAR_W);
  let bars = 4;
  while (bars > 1 && !fits(track, bar, bars)) bars--;
  if (fits(track, bar, bars)) addClip(track, bar, bars);
});

export async function duplicate(id) {
  const state = await send({ op: 'clip.dup', clip: id });
  if (!state) return;
  select(`c${state.project.ids.c}`);
  $('tracks').querySelector(`[data-clip="${ui.clip}"]`)?.focus();
}

// the same from the keyboard, on the focused clip
$('tracks').addEventListener('keydown', (e) => {
  const node = e.target.closest('.clip');
  const found = node && findClip(project(), node.dataset.clip);
  if (!found || e.altKey) return;
  const { track, clip } = found;
  const side = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') duplicate(clip.id);
  else if (e.ctrlKey || e.metaKey) return;
  else if (side && e.shiftKey) { if (fits(track, clip.bar, clip.bars + side, clip.id)) send({ op: 'clip.resize', clip: clip.id, bars: clip.bars + side }); }
  else if (side) { if (fits(track, clip.bar + side, clip.bars, clip.id)) send({ op: 'clip.move', clip: clip.id, bar: clip.bar + side }); }
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    node.closest('.track').querySelector('.addclip').focus();
    send({ op: 'clip.del', clip: clip.id });
  } else return;
  e.preventDefault();
  e.stopPropagation();
});
