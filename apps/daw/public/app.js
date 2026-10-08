// The page: draws the song the server holds, sends every edit to it (POST /api/op), and plays it. The state
// comes back on the server's event stream, so an edit made from the CLI shows here as it is made. This file is
// the top bar, the transport, the Claude box and the keys; arrange.js and editor.js are the two panels.
import { stepSeconds } from '/lib/song.mjs';
import { $, el, ui, project, onRender, render, send, commit, post, connect, complain, slide, letGo, setValue, engine } from './link.js';
import { BAR_W } from './arrange.js';
import { editorFrame } from './editor.js';
import { renderWav } from './engine.js';

// ---- the top bar

onRender((p, state) => {
  setValue($('name'), p.name);
  setValue($('bpm'), p.bpm);
  setValue($('swing'), Math.round(p.swing * 100));
  $('swingOut').textContent = `${Math.round(p.swing * 100)}% · ${(p.swing * 0.5 * stepSeconds(p.bpm) * 1000).toFixed(1)} ms late`;
  setValue($('bars'), p.bars);
  $('loop').setAttribute('aria-pressed', p.loop.on);
  setValue($('loopFrom'), p.loop.from + 1);
  setValue($('loopTo'), p.loop.to);
  $('loopFrom').max = $('loopTo').max = p.bars;
  setValue($('master'), Math.round(p.master * 100));
  $('undo').disabled = !state.canUndo;
  $('redo').disabled = !state.canRedo;
  if ($('template').options.length === 1) $('template').append(...state.templates.map((name) => el('option', { value: name }, name)));
  renderNotes(state.notes);
});

$('name').addEventListener('change', () => commit($('name'), { op: 'set', key: 'name', value: $('name').value }));
$('bpm').addEventListener('change', () => commit($('bpm'), { op: 'set', key: 'bpm', value: Number($('bpm').value) }));
$('bars').addEventListener('change', () => commit($('bars'), { op: 'set', key: 'bars', value: Number($('bars').value) }));
$('swing').addEventListener('input', () => slide($('swing'), { op: 'set', key: 'swing', value: $('swing').value / 100 }));
$('swing').addEventListener('change', () => letGo($('swing')));
$('master').addEventListener('input', () => slide($('master'), { op: 'set', key: 'master', value: $('master').value / 100 }));
$('master').addEventListener('change', () => letGo($('master')));

const toggleLoop = () => send({ op: 'loop', on: !project().loop.on });
$('loop').addEventListener('click', toggleLoop);
// the two boxes say the first and the last bar of the loop
for (const id of ['loopFrom', 'loopTo']) {
  $(id).addEventListener('change', () => commit($(id), { op: 'loop', from: Number($('loopFrom').value) - 1, to: Number($('loopTo').value) }));
}

$('template').addEventListener('change', () => {
  if ($('template').value) send({ op: 'template', name: $('template').value });
  $('template').value = '';
});
$('undo').addEventListener('click', () => send({ op: 'undo' }));
$('redo').addEventListener('click', () => send({ op: 'redo' }));

$('wav').addEventListener('click', async () => {
  const p = project();
  $('wav').disabled = true;
  try {
    const url = URL.createObjectURL(await renderWav(p));
    el('a', { href: url, download: `${p.name.replace(/[^\w -]/g, '').trim() || 'song'}.wav` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) { complain(`the WAV could not be made: ${err.message}`); }
  $('wav').disabled = false;
});

// ---- the transport

function play(bar = ui.startBar) {
  if (!ui.state) return;
  ui.startBar = bar;
  engine.start(bar * 16);
  render();
}

function togglePlay() {
  if (engine.playing) engine.stop(); else play();
}
$('play').addEventListener('click', togglePlay);

let shown = { playing: null, pos: '' };
function frame() {
  const playing = engine.playing;                    // the engine stops by itself at the end of the song
  if (playing !== shown.playing) {
    shown.playing = playing;
    $('play').setAttribute('aria-pressed', playing);
    $('play').textContent = playing ? 'Stop' : 'Play';
    $('playhead').classList.toggle('idle', !playing);
  }
  const pos = playing ? Math.max(0, engine.position()) : ui.startBar * 16;
  $('playhead').style.transform = `translateX(${(pos / 16) * BAR_W}px)`;
  const text = `${Math.floor(pos / 16) + 1}.${Math.floor((pos % 16) / 4) + 1}`;
  if (text !== shown.pos) { shown.pos = text; $('pos').textContent = text; }
  editorFrame(playing ? pos : -1);
  requestAnimationFrame(frame);
}

// `claudebase play` and `claudebase stop`: Claude starting and stopping the song for you
const transport = ({ action, bar }) => {
  if (action === 'stop') return engine.stop();
  play(bar);
  setTimeout(() => { if (engine.blocked) complain('Claude pressed Play: click the page once so the browser lets it make sound'); }, 300);
};

// ---- the Claude box

let shownNotes = -1;
function renderNotes(notes) {
  const last = notes.at(-1)?.id ?? 0;
  if (last === shownNotes) return;
  shownNotes = last;
  $('notes').replaceChildren(...notes.map((n) => el('div', { className: n.from }, n.text)));
  $('notes').scrollTop = $('notes').scrollHeight;
}

$('ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('askText').value.trim();
  if (!text) return;
  $('askText').value = '';
  try { await post('/api/ask', { text }); } catch (err) { complain(err.message); }
});

// ---- keys

addEventListener('keydown', (e) => {
  if (e.target.matches('input:not([type="range"]), select, textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); send({ op: e.shiftKey ? 'redo' : 'undo' }); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); send({ op: 'redo' }); }
  else if (mod || e.altKey) return;
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key.toLowerCase() === 'l' && ui.state) toggleLoop();
});

connect({ transport });
requestAnimationFrame(frame);
