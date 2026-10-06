import { $, $$ } from './util.js';
import { mixer, pointer } from './state.js';
import { renderKeys, renderPads } from './keys.js';
import { jumpTo } from './deck.js';
import { wireJog } from './canvas.js';
import { addFeed } from './booth.js';
import { mixerEls } from './layout.js';
import { VOL_MAX, MASTER_UNITY, masterOfFader } from '../engine.js';

// ------------------------------------------------------------------ knobs
// A knob is drawn like a pot on a mixer: a groove around it that fills with the deck colour from the centre position to
// the value, and a lit cap with a knurled edge and a white notch that turn with it. The gradients are defined once.
const KNOB_DEFS = `<svg class="knobdefs" width="0" height="0" aria-hidden="true"><defs>
  <radialGradient id="knobCap" cx="36%" cy="26%" r="80%"><stop offset="0" stop-color="#565664"/><stop offset="0.5" stop-color="#2a2a34"/><stop offset="1" stop-color="#131319"/></radialGradient>
  <linearGradient id="knobRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c7c8c"/><stop offset="0.45" stop-color="#2c2c36"/><stop offset="1" stop-color="#08080b"/></linearGradient>
  <radialGradient id="knobShade"><stop offset="0.55" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
</defs></svg>`;
function makeKnob(el, { min, max, center, get, set }) {
  if (!$('.knobdefs')) document.body.insertAdjacentHTML('beforeend', KNOB_DEFS);
  const size = 38, r = 16, cap = 12, cx = size / 2, cy = size / 2; // r: the groove; cap: the knob itself
  const toAng = (v) => -135 + ((v - min) / (max - min)) * 270;
  const pt = (a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const sweep = (a0, a1) => { const [x0, y0] = pt(a0), [x1, y1] = pt(a1); return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  el.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <path class="groove" d="${sweep(-135, 135)}" fill="none" stroke="#2a2a36" stroke-width="2.6" stroke-linecap="round"/>
    <path class="arc" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy + 2.5}" r="${cap + 3.5}" fill="url(#knobShade)"/>
    <circle cx="${cx}" cy="${cy}" r="${cap}" fill="url(#knobRim)"/>
    <circle cx="${cx}" cy="${cy}" r="${cap - 1.3}" fill="url(#knobCap)"/>
    <g class="ptr">
      <circle cx="${cx}" cy="${cy}" r="${cap - 0.65}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="1.3" stroke-dasharray="0.9 1.75"/>
      <line x1="${cx}" y1="${cy - 3.5}" x2="${cx}" y2="${cy - cap + 2}" stroke="#f6f6fa" stroke-width="2" stroke-linecap="round"/>
    </g>
  </svg><span>${el.dataset.label}</span>`;
  el.style.color = 'var(--c)';
  const arc = $('.arc', el), ptr = $('.ptr', el);
  let last = null;
  el.render = () => {
    const v = get();
    if (v === last) return; last = v;
    const a0 = toAng(center), a1 = toAng(v);
    arc.setAttribute('d', Math.abs(a1 - a0) < 0.5 ? '' : sweep(Math.min(a0, a1), Math.max(a0, a1)));
    ptr.setAttribute('transform', `rotate(${a1} ${cx} ${cy})`);
  };
  let drag = null;
  el.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, v: get() }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const v = Math.max(min, Math.min(max, drag.v + ((drag.y - e.clientY) / 150) * (max - min)));
    set(Math.abs(v - center) < (max - min) * 0.02 ? center : v);
  });
  el.addEventListener('pointerup', () => (drag = null));
  el.addEventListener('dblclick', () => set(center));
}

let wired = false;
export function wireControls() {
  if (wired) return; wired = true;
  for (const strip of $$('.strip')) {
    const d = mixer.decks[strip.dataset.deck];
    for (const k of mixerEls(d.name, '.k')) {
      const name = k.dataset.ctl;
      if (name === 'fx') {
        makeKnob(k, { min: 0, max: 1, center: 0, get: () => +(d.fx.ctl ? d.fx.ctl.value() : 0).toFixed(3), set: (v) => d.fx.ctl?.set(v) });
        k.ctlOf = () => d.fx.ctl;
        continue;
      }
      const ctl = name === 'filter' ? d.filter : name === 'echo' ? d.echo : name === 'trim' ? d.trimDb : d.eq[name];
      const [min, max] = ctl.range;
      makeKnob(k, {
        min, max, center: 0,
        get: () => +ctl.value().toFixed(3),
        set: (v) => {
          if (name === 'echo') mixer.delay.delayTime.setValueAtTime(Math.min(3.9, (60 / (d.effBpm || 120)) * 0.75), mixer.ctx.currentTime);
          ctl.set(v);
        },
      });
      k.ctlOf = () => ctl;
    }
    $('.fader', strip).oninput = (e) => d.vol.set(Number(e.target.value));
    $('.fader', strip).ondblclick = () => d.vol.set(1); // back to 0 dB
    $('.fader', strip).max = d.vol.range[1];
    mixerEls(d.name, '.fxsel')[0].onchange = (e) => d.fx.set(e.target.value, 0.5);
  }
  $('#xfader').oninput = (e) => mixer.xfader.set(Number(e.target.value));
  $('#xfader').ondblclick = () => mixer.xfader.set(0.5); // the centre: both sides at full
  $('#masterVol').max = VOL_MAX;
  $('#masterVol').oninput = (e) => mixer.master.set(masterOfFader(Number(e.target.value)));
  $('#masterVol').ondblclick = () => mixer.master.set(MASTER_UNITY); // back to 0 dB
  for (const el of $$('.deck')) {
    const d = mixer.decks[el.dataset.deck];
    $('.play', el).onclick = () => (d.playing ? d.pause() : d.buffer && d.play());
    $('.cue', el).onclick = () => { if (d.playing) { d.pause(); d.startPos = d.cuePoint; } else { d.cuePoint = d.startPos; } };
    $('.sync', el).onclick = () => { try { mixer.sync(d.name); } catch (e) { addFeed({ ts: Date.now(), kind: 'system', text: e.message }); } };
    $('.rate', el).oninput = (e) => d.setRate(Number(e.target.value));
    $('.rate', el).ondblclick = () => d.setRate(1); // back to 0%
    el.addEventListener('pointerdown', () => (pointer.deck = d.name), true); // the deck the pointer was last used on: what [ ] act on
    const warn = (fn) => { try { fn(); } catch (e) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${e.message}` }); } };
    // ½ / ×2: halve or double this deck's loop (or step the next loop's length) · shift+click = move the loop
    for (const b of $$('.lscale', el)) b.onclick = (e) => warn(() => {
      const f = Number(b.dataset.scale);
      if (!e.shiftKey) d.loopStep(f); else if (d.loop) d.moveLoop(f < 1 ? -1 : 1);
    });
    $('.lsize', el).onclick = () => d.setLoop(d.loop ? 0 : d.loopSize, undefined, 'block');
    // loops: click = loop the block you are in (snapped to the loop length) · hold = momentary · shift+click = from the next bar
    for (const b of $$('.loops button[data-loop]', el)) {
      let downAt = 0, armed = false;
      b.onpointerdown = (e) => {
        e.preventDefault(); downAt = performance.now();
        const beats = Number(b.dataset.loop);
        if (d.loop?.beats === beats && !e.shiftKey) { d.setLoop(0); armed = false; return; }
        armed = true;
        if (e.shiftKey) d.setLoop(beats, mixer.nextBoundary(d, 4, 0.03).t, 'floor'); else d.setLoop(beats, undefined, 'block');
      };
      b.onpointerup = b.onpointerleave = () => { if (armed && performance.now() - downAt > 350) d.setLoop(0); armed = false; };
    }
    for (const b of $$('.jumps button', el)) b.onclick = () => { try { jumpTo(d, b.dataset.jump); } catch (e) { addFeed({ ts: Date.now(), kind: 'system', text: `⚠ ${e.message}` }); } };
    $('.keylock', el).onclick = () => d.setKeylock(!d.keylock);
    for (const b of $$('.ks', el)) b.onclick = () => d.setKeyShift(d.keyShift + Number(b.dataset.d));
    $('.ksv', el).ondblclick = () => d.setKeyShift(0);
    $('.slip', el).onclick = () => (d.slip = !d.slip);
    $('.xfa', el).onchange = (e) => d.setXfSide(e.target.value);
    for (const s of $$('.stems input', el)) s.oninput = (e) => d.stemsLoaded && d.stem[s.dataset.stem].set(Number(e.target.value));
    wireJog($('.jogwheel', el), d);
    $('.overview', el).onclick = (e) => {
      if (!d.buffer || e.currentTarget.dataset.dragged) return; // the end of a scrub (wave.js) is not a click
      const r = e.currentTarget.getBoundingClientRect();
      d.seek(((e.clientX - r.left) / r.width) * d.buffer.duration);
    };
  }
  renderPads();
  renderKeys();
}
