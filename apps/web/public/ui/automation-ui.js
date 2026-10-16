// ------------------------------------------------------------------ the automation controls, wherever they are
// ● rec · ▶ play · ■ stop · ⤓ export and the line that says where it is: in the Set block of the Library tab and at
// the head of the Automation tab (ui/lanes.js). Each place has its own box for the questions they ask. The active set
// is kept here (crate.js gives it as /api/sets?name= describes it); the automation itself is mixer.automation
// (ui/automation.js), there once the engine runs.
import { $, mmss } from './util.js';
import { mixer } from './state.js';
import { addFeed } from './booth.js';

let current = null;
export const activeSetDetail = () => current;
export function setActiveSet(detail) {
  current = detail || null;
  render();
  document.dispatchEvent(new CustomEvent('activeset:detail', { detail: current }));
}
const automationOf = () => mixer?.automation || null;
const warn = (text) => addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${text}` });

// a question in a box (<div><span></span><div class="choices"></div></div>): resolves with the value chosen, or null
// (Cancel, or no answer in 10 s)
export function ask(box, text, choices) {
  const row = $('.choices', box);
  $('span', box).textContent = text;
  row.innerHTML = '';
  box.hidden = false;
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(timer); box.hidden = true; resolve(v); };
    const timer = setTimeout(() => done(null), 10000);
    for (const [label, value] of [...choices, ['Cancel', null]]) {
      const b = Object.assign(document.createElement('button'), { className: 'btn sm', textContent: label });
      b.onclick = () => done(value);
      row.append(b);
    }
  });
}

const places = []; // { root, box }: root has [data-a="rec|play|stop|export|info"]
const playingDecks = () => Object.values(mixer?.decks || {}).filter((d) => d.isLive()).map((d) => d.name);
const okToStopMusic = async (box, what) => {
  const live = playingDecks();
  return !live.length || (await ask(box, `Deck ${live.join(' and ')} ${live.length > 1 ? 'are' : 'is'} playing. ${what} puts the set's decks back first, which stops ${live.length > 1 ? 'them' : 'it'}.`, [['Go on', true]])) === true;
};
export function wireTransport(root, box) {
  places.push({ root, box });
  const btn = (a) => $(`[data-a="${a}"]`, root);
  const guard = (fn) => async () => { try { await fn(); } catch (err) { warn(err.message); } };
  btn('rec').onclick = guard(async () => {
    const A = automationOf(); if (!A || !current) return;
    if (A.mode === 'play') return A.punchIn();
    const rec = current.automation;
    if (!rec) return A.record(current.name);
    const how = await ask(box, `"${current.name}" has a recording (${mmss(rec.duration)}). Record over it: it plays, and a control you touch is replaced from then on. Or start a new one from the decks as they are now.`, [['Record over', 'over'], ['New recording', 'new']]);
    if (how === 'over') await A.play(current.name, { over: true });
    else if (how === 'new') await A.record(current.name, { replace: true });
  });
  btn('play').onclick = guard(async () => {
    const A = automationOf(); if (!A || !current?.automation) return;
    if (await okToStopMusic(box, 'Playing the recording')) await A.play(current.name);
  });
  btn('stop').onclick = guard(() => automationOf()?.stop());
  const ex = btn('export');
  if (ex) ex.onclick = guard(async () => {
    const A = automationOf(); if (!A || !current?.automation) return;
    const live = playingDecks();
    const how = await ask(box, `Export "${current.name}": the recording plays from 0:00 in real time (${mmss(current.automation.duration)}) while it is recorded, then it is saved as an MP3 with a tracklist in data/dj/exports. The decks are not yours meanwhile. Silently: the speakers are off until it is done (the file gets everything).${live.length ? ` Deck ${live.join(' and ')} ${live.length > 1 ? 'are' : 'is'} playing and stops: the set's decks are put back first.` : ''}`, [['Export silently', 'silent'], ['Export and listen', 'listen']]);
    if (how) await A.exportSet(current.name, { listen: how === 'listen' });
  });
  render();
}

let timer = null;
export function render() {
  const A = automationOf(), st = A?.state() || { mode: 'idle' }, rec = current?.automation, on = st.mode !== 'idle' || !!st.exporting;
  const info = st.exporting === 'starting' ? '⤓ export: starting the recorder…'
    : st.exporting === 'saving' ? '⤓ export: saving the file…'
      : st.exporting ? `⤓ exporting ${mmss(st.t)} / ${mmss(st.duration || 0)}${st.silent ? ' · speakers off' : ''}`
        : st.mode === 'rec' ? `⏺ recording ${mmss(st.t)}`
          : st.mode === 'overdub' ? `⏺ recording over ${mmss(st.t)} / ${mmss(st.duration || 0)}`
            : st.mode === 'play' ? `▶ ${mmss(st.t)} / ${mmss(st.duration || 0)}`
              : st.lastExport?.ok ? `⤓ exported ${st.lastExport.file}`
                : rec ? `recording ${mmss(rec.duration)} · ${rec.lanes.length} lane${rec.lanes.length === 1 ? '' : 's'}` : 'no recording';
  for (const { root } of places) {
    root.hidden = !current;
    const b = (a) => $(`[data-a="${a}"]`, root);
    b('rec').disabled = !A || st.mode === 'rec' || st.mode === 'overdub' || !!st.exporting;
    b('rec').classList.toggle('on', st.mode === 'rec' || st.mode === 'overdub');
    b('play').disabled = !A || on || !rec;
    b('play').classList.toggle('on', st.mode === 'play' || st.mode === 'overdub');
    b('stop').disabled = !on || st.exporting === 'saving';
    if (b('export')) { b('export').disabled = !A || on || !rec; b('export').classList.toggle('on', !!st.exporting); }
    b('info').textContent = info;
    b('info').title = st.lastExport && !st.lastExport.ok ? `The last export: ${st.lastExport.error}` : rec && !on ? `Lanes: ${rec.lanes.join(', ')}` : '';
  }
  if (on && !timer) timer = setInterval(render, 250);
  if (!on && timer) { clearInterval(timer); timer = null; }
}
document.addEventListener('automation', render);
