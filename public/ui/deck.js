import { $, $$, camelotColor, post, esc } from './util.js';
import { mixer, ui } from './state.js';
import { onUi } from './prefs.js';
import { addFeed } from './booth.js';

// ------------------------------------------------------------------ rendering
export function renderDeckMeta(d) {
  const el = $(`.deck[data-deck="${d.name}"]`);
  const t = d.track;
  $('.title', el).textContent = t ? (d.loading ? `Loading… ${t.title}` : t.title) : 'No track';
  $('.artist', el).textContent = t ? t.artist || '' : 'Load something from the crate';
  $('.energy', el).textContent = t ? `E ${t.energy}` : 'E —';
  renderKeyChip(d, el);
  renderHotcues(d, el);
}

// ------------------------------------------------------------------ hot cue buttons (8 per deck)
// auto-filled by lib/cues.mjs: 1 start · 2 first vocal · 3 first chorus · 4 first drop · 5 first breakdown · 6 mix-out; 7 and 8 are free
export const CUE_COLORS = ['#e8e8f0', '#7ec3e7', '#7ee787', '#f2cc60', '#b392f0', '#f59e8b', '#ff7ab6', '#4fd1c5'];
export const hotcuesOf = (t) => (t ? t.hotcues || t.cues?.hotcues || {} : {});
// ui.hotcues picks the look: 'pad' (number, name, bar over a line that lights up when the cue is set), 'pad2' (the same
// with the name on its own line), 'slim' (one thin row) or 'letters' (pads marked A to H and nothing else). The styles
// are in css/deck.css under body[data-hotcues]. All 8 are always there; d is null before the engine starts.
const CUE_LETTERS = 'ABCDEFGH';
function renderHotcues(d, el) {
  const wrap = $('.hotcues', el); if (!wrap) return;
  const hc = hotcuesOf(d?.track);
  const letters = ui.hotcues === 'letters';
  const key = (d?.track?.id || '') + letters + JSON.stringify(hc);
  if (wrap.dataset.key === key) return;
  wrap.dataset.key = key;
  wrap.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
    const c = hc[n];
    const label = c ? String(c.label || '').replace(/\s*\(auto\)$/, '') : '';
    const name = letters ? `${CUE_LETTERS[n - 1]} (${n})` : n;
    const tip = c ? `hot cue ${name}${label ? `: ${label}` : ''} · bar ${c.bar} · click = jump on the beat · shift+click = set here` : `hot cue ${name} is empty · shift+click = set it here`;
    if (letters) return `<button class="hc${c ? '' : ' empty'}" data-n="${n}" style="--hc:${CUE_COLORS[n - 1]}" title="${esc(tip)}"><i>${CUE_LETTERS[n - 1]}</i></button>`;
    return `<button class="hc${c ? '' : ' empty'}" data-n="${n}" style="--hc:${CUE_COLORS[n - 1]}" title="${esc(tip)}"><i>${n}</i>${label ? `<span>${esc(label)}</span>` : ''}${c ? `<small>${c.bar}</small>` : ''}</button>`;
  }).join('');
  for (const b of $$('.hc', wrap)) b.onclick = async (e) => {
    if (!d?.track) return;
    const n = Number(b.dataset.n);
    try {
      const r = await post('/api/hotcue', { deck: d.name, n, action: e.shiftKey ? 'set' : 'jump' });
      if (!r.ok) throw new Error(r.error || 'hot cue failed');
      if (e.shiftKey) { // show the new cue straight away
        const cur = hotcuesOf(d.track);
        d.track.hotcues = { ...cur, [n]: { sec: r.result.sec, bar: r.result.bar, label: r.result.label || null } };
        renderHotcues(d, el);
      }
    } catch (err) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${err.message}` }); }
  };
}
// the empty row before anything is loaded, and again whenever the look changes
onUi(() => {
  document.body.dataset.hotcues = ['pad', 'pad2', 'slim', 'letters'].includes(ui.hotcues) ? ui.hotcues : 'pad';
  for (const el of $$('.deck')) renderHotcues(mixer?.decks[el.dataset.deck] || null, el);
});
export function renderKeyChip(d, el) {
  const t = d.track, key = $('.key', el);
  const eff = t ? d.effectiveCamelot() || t.camelot : null;
  const txt = t ? (eff && eff !== t.camelot ? `${eff} ← ${t.camelot}` : `${t.camelot} · ${t.key}`) : '—';
  if (key.textContent !== txt) { key.textContent = txt; key.style.background = t ? camelotColor(eff) : ''; }
}
// ---- section jumps: next break / drop / outro of a deck, landing on the next bar
export function jumpTo(d, what) {
  const t = d.track; if (!t) throw new Error(`deck ${d.name} is empty`);
  const cur = d.beatAt(d.position()) / 4 + 1;
  const secs = (t.sections || []).filter((s) => s.startBar > cur + 0.5);
  let bar = null;
  if (what === 'breakdown') bar = secs.find((s) => s.label === 'breakdown')?.startBar ?? (t.breakdowns || []).map((b) => b.startBar).find((b) => b > cur + 0.5) ?? null;
  if (what === 'drop') bar = secs.find((s) => s.label === 'drop')?.startBar ?? (t.breakdowns || []).map((b) => b.endBar + 1).find((b) => b > cur + 0.5) ?? (hotcuesOf(t)[4]?.bar > cur + 0.5 ? hotcuesOf(t)[4].bar : null);
  if (what === 'outro') bar = t.outroStartBar > cur + 0.5 ? t.outroStartBar : null;
  if (!bar) throw new Error(`no ${what} ahead on ${d.name}`);
  const when = d.playing ? mixer.nextBoundary(d, 4, 0.03).t : mixer.ctx.currentTime;
  d.seekAt(d.posOfBeat((bar - 1) * 4), when);
  addFeed({ ts: Date.now(), kind: 'action', text: `⏭ ${d.name} → ${what} at bar ${bar}` });
}
