// Boot + the per-frame render loop. Everything else lives in ui/*.js.

import { Mixer, DECK_COLORS, LOOP_MIN, LOOP_MAX } from './engine.js';
import './ui/extra-decks.js';
import { $, $$, mmss, post } from './ui/util.js';
import { clientId, mixer, setMixer, setEngine, liveDeck } from './ui/state.js';
import { pushState, setStatus } from './ui/link.js';
import { wireControls } from './ui/controls.js';
import { renderKeyChip } from './ui/deck.js';
import { drawOverview, drawScroll, drawJog, drawMeter } from './ui/canvas.js';
import { loadLibrary, refreshHistory, renderLibrary } from './ui/crate.js';
import { mixerEls } from './ui/layout.js';
import './ui/lower.js';
import './ui/wave.js';
import './ui/dragdrop.js';

// ------------------------------------------------------------------ engine start
$('#startBtn').onclick = async () => {
  try {
    if (!mixer) { setMixer(new Mixer()); await mixer.ctx.resume(); await mixer.init(); }
    else await mixer.ctx.resume();
  } catch (err) {
    $('#overlayMsg').textContent = `Audio engine failed to start: ${err.message}`;
    setMixer(null);
    return;
  }
  setEngine(true);
  await post('/api/engine/claim', { client: clientId });
  $('#startOverlay').classList.add('hide');
  setStatus('on', 'engine live');
  pushState();
  wireControls();
  requestAnimationFrame(frame);
};

let lastLive = null, lastSlow = 0;
function frame() {
  if (!mixer) return;
  const now = performance.now();
  drawScroll($('#scroll'));
  let anyPlaying = false;
  const shown = { C: !!mixer.decks.C.track, D: !!mixer.decks.D.track };
  $('#rig2').classList.toggle('shown', shown.C || shown.D);
  $('.rig').classList.toggle('four', shown.C || shown.D);
  for (const el of $$('.deck')) {
    const d = mixer.decks[el.dataset.deck], color = DECK_COLORS[d.name];
    if (d.name === 'C' || d.name === 'D') { el.classList.toggle('shown', shown[d.name]); if (!shown[d.name]) continue; }
    drawOverview($('.overview', el), d, color);
    drawJog($('.jogwheel', el), d, color);
    anyPlaying ||= d.playing;
    const t = d.track, pos = d.position();
    $('.play', el).classList.toggle('on', d.playing);
    $('.play', el).textContent = d.playing ? '❚❚' : '▶';
    $('.bpm', el).textContent = t ? d.effBpm.toFixed(1) : '—';
    const pct = (d.rate - 1) * 100;
    for (const p of $$('.pitch', el)) p.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    $('.time', el).textContent = mmss(pos);
    const dur = d.buffer?.duration;
    $('.remain', el).textContent = dur ? `-${mmss((dur - pos) / d.rate)}` : '-0:00';
    if (t) {
      const beats = d.beatAt(pos);
      $('.bar', el).textContent = `bar ${Math.floor(beats / 4) + 1}.${(((Math.floor(beats) % 4) + 4) % 4) + 1}`;
      const toOut = (t.mixOut - pos) / d.rate;
      const mo = $('.mixout', el);
      mo.textContent = d.playing ? (toOut > 0 ? `mix-out ${mmss(toOut)}` : 'in outro') : '';
      mo.classList.toggle('soon', d.playing && toOut < 30);
      renderKeyChip(d, el);
    }
    const lp = d.loop;
    for (const b of $$('.loops button[data-loop]', el)) b.classList.toggle('on', lp?.beats === Number(b.dataset.loop));
    // ½ / ×2 go dark at a limit; the readout names a length the four buttons cannot show
    const size = lp ? lp.beats : d.loopSize;
    for (const b of $$('.lscale', el)) { const f = Number(b.dataset.scale); b.disabled = lp ? !!d.loopLimit(f) : size * f < LOOP_MIN || size * f > LOOP_MAX; }
    const ls = $('.lsize', el), txt = [4, 8, 16, 32].includes(size) ? '' : ({ 0.25: '¼', 0.5: '½' }[size] || String(size));
    if (ls.textContent !== txt) ls.textContent = txt;
    ls.classList.toggle('on', !!lp && txt !== '');
    const rate = $('.rate', el); if (document.activeElement !== rate) rate.value = d.rate;
    $('.keylock', el).classList.toggle('on', d.keylock);
    $('.ksv', el).textContent = d.keyShift > 0 ? `+${d.keyShift}` : String(d.keyShift);
    $('.slip', el).classList.toggle('on', d.slip);
    const xfa = $('.xfa', el); if (document.activeElement !== xfa) xfa.value = d.xfSide;
    $('.stems', el).classList.toggle('off', !d.stemsLoaded);
    for (const s of $$('.stems input', el)) {
      s.disabled = !d.stemsLoaded;
      if (document.activeElement !== s) s.value = d.stem[s.dataset.stem].value();
    }
  }
  const live = liveDeck();
  for (const el of $$('.deck')) el.classList.toggle('live', live?.name === el.dataset.deck);
  document.body.classList.toggle('playing', anyPlaying);
  $('#masterBpm').textContent = live ? live.effBpm.toFixed(1) : '—';
  for (const strip of $$('.strip')) {
    const d = mixer.decks[strip.dataset.deck];
    if (strip.classList.contains('extra')) {
      strip.classList.toggle('shown', !!d.track); $(`.fxrow[data-deck="${d.name}"]`).classList.toggle('shown', !!d.track);
      if (!d.track) continue;
    }
    for (const k of mixerEls(d.name, '.k')) { k.render?.(); k.classList.toggle('auto', !!k.ctlOf?.()?.automating?.()); }
    const f = $('.fader', strip); if (document.activeElement !== f) f.value = d.vol.value();
    const sel = mixerEls(d.name, '.fxsel')[0]; if (document.activeElement !== sel) sel.value = d.fx.type;
    drawMeter($('.meter', strip), d.analyser);
  }
  const xf = $('#xfader'); if (document.activeElement !== xf) xf.value = mixer.xfader.value();
  const mv = $('#masterVol'); if (document.activeElement !== mv) mv.value = mixer.master.value();
  if (document.body.dataset.layout === 'stacked') for (const m of $$('.master .meter')) drawMeter(m, mixer.meters[m.dataset.side]);
  const tr = mixer.transition;
  $('#transitionInfo').textContent = tr ? `⟶ ${tr.style.toUpperCase()} ${tr.from}→${tr.to} · ${Math.max(0, (tr.endAt - Date.now()) / 1000).toFixed(0)}s` : '';
  const nowMs = Date.now();
  for (const b of $$('#pads .pad')) { const h = mixer.sampler.lastHit[b.dataset.pad - 1]; b.classList.toggle('hit', nowMs >= h && nowMs - h < 160); }
  if (now - lastSlow > 1000 || live?.name !== lastLive) { lastSlow = now; lastLive = live?.name; renderLibrary(); }
  requestAnimationFrame(frame);
}

loadLibrary();
refreshHistory();
