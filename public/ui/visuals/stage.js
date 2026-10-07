// The /visuals page's renderer: WebGPU only (three.js WebGPURenderer, materials in TSL), no WebGL path.
//
// A mode is one module in ./modes/ whose default export is
//   { name, label, create(ctx) }      ctx: { THREE, tsl, renderer, u }
// and create() returns
//   { scene, camera, update(sig, dt), resize?(width, height), dispose() }
// `u` holds the shared uniforms below, set once per frame from the feed's signal, so a mode's shaders read the
// music (and the colours that follow the track) straight from them; `sig` is the same signal for the JavaScript side.
// A mode owns its scene and whatever buffers and compute passes it needs, and frees them in dispose().
//
// The stage draws the current mode into a render target and that target to the screen. During a change of mode both
// modes are updated and drawn, each into its own target, and the two are blended over a musical length, so both keep
// reacting and nothing cuts.
//
// A mode can also (or instead) shape the shared elements of morph.js, with a `morph(ctx, slot)` described there. A
// change between two modes that do is a morph: the elements travel from one shape to the other. Any other pair
// crossfades as above.
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { Morph, pickTier, lowerTier } from './morph.js';

const { uniform, uniformArray, texture, uv, mix, float, smoothstep, length, vec3 } = tsl;
export const BANDS = 16;

export async function webgpuProblem() {
  if (!navigator.gpu) return 'This browser has no WebGPU.';
  try { if (!(await navigator.gpu.requestAdapter())) return 'WebGPU is here, but no graphics adapter is available to it.'; } catch (e) { return `WebGPU could not start: ${e.message}`; }
  return null;
}

function makeUniforms() {
  return {
    time: uniform(0), level: uniform(0), bass: uniform(0), mid: uniform(0), high: uniform(0), kick: uniform(0),
    beat: uniform(0), beatPhase: uniform(0), barPhase: uniform(0),
    energy: uniform(0.5), drive: uniform(1),            // the track's energy rating; 1 in full sections, lower in intros and breakdowns
    color: uniform(new THREE.Color(0.6, 0.6, 0.7)),     // the key's colour, as on the DJ page's key chips
    accent: uniform(new THREE.Color(0.6, 0.6, 0.7)),    // the deck colour of what is heard
    bands: uniformArray(new Array(BANDS).fill(0), 'float'),
    aspect: uniform(1),
  };
}

const SLOW_FRAME = 1 / 50;   // a frame longer than this misses the 60 fps target
const SLOW_FOR = 4;          // seconds of that, without a break, before the element count steps down
const WARM_UP = 6;           // the first seconds after start: one second of slow frames is enough

export class Stage {
  constructor(canvas, modes, { onLost = () => {}, onTier = () => {}, quality = null } = {}) {
    this.canvas = canvas; this.modes = modes; this.onLost = onLost; this.onTier = onTier;
    this.quality = quality;      // a tier forced from the address (?quality=), or null to choose and adapt
    this.u = makeUniforms();
    this.slots = [null, null];   // the mode on stage in each slot: { name, inst, morph }
    this.cur = 0;                // which slot is the current mode
    this.fade = null;            // { from, to, start, seconds, morph }
    this.dead = false;
    this.slow = 0; this.age = 0;
  }

  async init() {
    const r = this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    await r.init();
    if (!r.backend?.isWebGPUBackend) throw new Error('the renderer did not get a WebGPU device');
    r.setClearColor(0x000000, 1);
    const device = r.backend.device;
    device.lost.then((info) => { if (!this.dead) { this.dead = true; this.onLost(info?.message || info?.reason || 'device lost'); } });
    this.targets = [new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType }), new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType })];
    // the screen pass: the two targets blended, a soft vignette, dimmed while idle
    this.mixU = uniform(0); this.dimU = uniform(1);
    const a = texture(this.targets[0].texture, uv()), b = texture(this.targets[1].texture, uv());
    const vig = float(1).sub(smoothstep(0.55, 1.25, length(uv().sub(0.5).mul(2))).mul(0.6));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = mix(a, b, this.mixU).rgb.mul(vig).mul(this.dimU);
    this.quad = new THREE.QuadMesh(mat);
    // the shared elements of the modes that morph, at a size this GPU can hold (see morph.js)
    let info = device.adapterInfo;
    if (!info) { try { info = (await navigator.gpu.requestAdapter())?.info; } catch { /* no details: start low */ } }
    this.tier = pickTier({ info: info || {}, limits: device.limits, want: this.quality });
    this.morph = this.tier ? new Morph({ THREE, tsl, renderer: r, u: this.u, tier: this.tier }) : null;
    this.resize();
    this.onTier(this.tier);
  }

  // the modes this GPU can show: one that only morphs needs the shared elements
  get usable() { return this.modes.filter((m) => m.create || (m.morph && this.morph)); }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    // full resolution up to 1440p; beyond that the picture is drawn smaller and scaled by the browser
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt((2560 * 1440) / Math.max(1, w * h)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    const pw = Math.max(2, Math.round(w * ratio)), ph = Math.max(2, Math.round(h * ratio));
    for (const t of this.targets) t.setSize(pw, ph);
    this.size = [pw, ph];
    this.u.aspect.value = pw / ph;
    this.morph?.resize(pw, ph);
    for (const s of this.slots) s?.inst.resize?.(pw, ph);
  }

  make(name, slot) {
    const def = this.usable.find((m) => m.name === name) || this.usable[0];
    const ctx = { THREE, tsl, renderer: this.renderer, u: this.u };
    if (def.morph && this.morph) {
      const inst = def.morph(ctx, this.morph.slots[slot]);
      this.morph.views[slot] = inst.view;
      return { name: def.name, inst, morph: true };
    }
    const inst = def.create(ctx);
    inst.resize?.(...this.size);
    return { name: def.name, inst, morph: false };
  }
  drop(slot) {
    const s = this.slots[slot];
    if (!s) return;
    try { s.inst.dispose(); } catch { /* the device may be gone */ }
    if (s.morph && this.morph) this.morph.views[slot] = null;
    this.slots[slot] = null;
  }

  get mode() { return this.fade ? this.slots[this.fade.to]?.name : this.slots[this.cur]?.name; }
  get changing() { return !!this.fade; }
  get morphing() { return !!this.fade?.morph; }

  // Change mode over `seconds` (the caller turns beats or bars into seconds). The first mode appears at once. Two
  // modes that both morph change by morphing; any other pair crossfades. Nothing is cut.
  show(name, seconds = 0) {
    if (this.dead || this.fade || name === this.mode) return false;
    if (!this.slots[this.cur]) { this.slots[this.cur] = this.make(name, this.cur); this.mixU.value = this.cur; return true; }
    const to = 1 - this.cur;
    this.slots[to] = this.make(name, to);
    this.fade = { from: this.cur, to, start: performance.now(), seconds: Math.max(0.05, seconds), morph: this.slots[this.cur].morph && this.slots[to].morph };
    return true;
  }

  // a different element count: new buffers, and the modes on stage start again on them. Never during a change.
  setTier(tier) {
    if (this.fade || !this.morph || tier === this.tier || !tier) return false;
    const names = this.slots.map((s) => s?.name);
    for (const i of [0, 1]) this.drop(i);
    this.morph.dispose();
    this.tier = tier;
    this.morph = new Morph({ THREE, tsl, renderer: this.renderer, u: this.u, tier });
    this.morph.resize(...this.size);
    for (const i of [0, 1]) if (names[i]) this.slots[i] = this.make(names[i], i);
    this.slow = 0;
    this.onTier(tier);
    return true;
  }

  // the frame rate target missed for a sustained stretch (not one slow frame): one tier down, between changes only
  watch(dt) {
    this.age += dt;
    this.slow = dt > SLOW_FRAME ? this.slow + dt : 0;
    const limit = this.age < WARM_UP ? 1 : SLOW_FOR;
    if (this.slow < limit || this.quality || this.fade || !this.slots.some((s) => s?.morph)) return;
    if (!this.setTier(lowerTier(this.tier))) this.slow = 0;
  }

  frame(sig, dt) {
    if (this.dead) return;
    const u = this.u, r = this.renderer;
    u.time.value = sig.time; u.level.value = sig.level; u.bass.value = sig.bass; u.mid.value = sig.mid; u.high.value = sig.high; u.kick.value = sig.kick;
    u.beat.value = sig.beat; u.beatPhase.value = sig.beatPhase; u.barPhase.value = sig.barPhase;
    u.energy.value = sig.energy; u.drive.value = sig.drive;
    u.color.value.setRGB(...sig.color, THREE.SRGBColorSpace); u.accent.value.setRGB(...sig.accent, THREE.SRGBColorSpace); // the feed's colours are screen colours
    for (let i = 0; i < BANDS; i++) u.bands.array[i] = sig.bands[i];
    this.dimU.value += ((sig.idle ? 0.35 : 1) - this.dimU.value) * Math.min(1, dt * 1.5);
    this.watch(dt);

    let weight = this.cur; // of slot 1: where a morph has got to, or simply the slot whose shape is shown
    if (this.fade) {
      const f = this.fade, x = Math.min(1, (performance.now() - f.start) / (f.seconds * 1000)), s = x * x * (3 - 2 * x);
      weight = f.to === 1 ? s : 1 - s;
      // a crossfade blends the two pictures; a morph is one picture, drawn into the outgoing mode's target
      this.mixU.value = f.morph ? f.from : weight;
      if (x >= 1) { this.drop(f.from); this.cur = f.to; this.mixU.value = f.to; this.fade = null; weight = this.cur; }
    }
    for (const s of this.slots) s?.inst.update(sig, dt);
    const morphs = this.slots.map((s) => !!s?.morph);
    if (morphs[0] || morphs[1]) this.morph.step(morphs[0] && morphs[1] ? weight : morphs[1] ? 1 : 0);
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (!s || (this.fade?.morph && i !== this.fade.from)) continue;
      r.setRenderTarget(this.targets[i]);
      if (s.morph) r.render(this.morph.scene, this.morph.camera); else r.render(s.inst.scene, s.inst.camera);
    }
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.dead = true;
    for (const i of [0, 1]) this.drop(i);
    try { this.morph?.dispose(); for (const t of this.targets || []) t.dispose(); this.renderer?.dispose(); } catch { /* the device may be gone */ }
  }
}
