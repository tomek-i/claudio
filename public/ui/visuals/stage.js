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
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';

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

export class Stage {
  constructor(canvas, modes, { onLost = () => {} } = {}) {
    this.canvas = canvas; this.modes = modes; this.onLost = onLost;
    this.u = makeUniforms();
    this.slots = [null, null];   // the mode drawn into each target
    this.cur = 0;                // which slot is the current mode
    this.fade = null;            // { from, to, start, seconds }
    this.dead = false;
  }

  async init() {
    const r = this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    await r.init();
    if (!r.backend?.isWebGPUBackend) throw new Error('the renderer did not get a WebGPU device');
    r.setClearColor(0x000000, 1);
    r.backend.device.lost.then((info) => { if (!this.dead) { this.dead = true; this.onLost(info?.message || info?.reason || 'device lost'); } });
    this.targets = [new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType }), new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType })];
    // the screen pass: the two targets blended, a soft vignette, dimmed while idle
    this.mixU = uniform(0); this.dimU = uniform(1);
    const a = texture(this.targets[0].texture, uv()), b = texture(this.targets[1].texture, uv());
    const vig = float(1).sub(smoothstep(0.55, 1.25, length(uv().sub(0.5).mul(2))).mul(0.6));
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = mix(a, b, this.mixU).rgb.mul(vig).mul(this.dimU);
    this.quad = new THREE.QuadMesh(mat);
    this.resize();
  }

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
    for (const s of this.slots) s?.inst.resize?.(pw, ph);
  }

  make(name) {
    const def = this.modes.find((m) => m.name === name) || this.modes[0];
    const inst = def.create({ THREE, tsl, renderer: this.renderer, u: this.u });
    inst.resize?.(...this.size);
    return { name: def.name, inst };
  }

  get mode() { return this.fade ? this.slots[this.fade.to]?.name : this.slots[this.cur]?.name; }
  get changing() { return !!this.fade; }

  // change mode over `seconds` (the caller turns beats or bars into seconds). The first mode appears at once.
  show(name, seconds = 0) {
    if (this.dead || this.fade || name === this.mode) return false;
    if (!this.slots[this.cur]) { this.slots[this.cur] = this.make(name); this.mixU.value = this.cur; return true; }
    const to = 1 - this.cur;
    this.slots[to] = this.make(name);
    this.fade = { from: this.cur, to, start: performance.now(), seconds: Math.max(0.05, seconds) };
    return true;
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

    if (this.fade) {
      const x = Math.min(1, (performance.now() - this.fade.start) / (this.fade.seconds * 1000)), s = x * x * (3 - 2 * x);
      this.mixU.value = this.fade.to === 1 ? s : 1 - s;
      if (x >= 1) {
        this.slots[this.fade.from].inst.dispose(); this.slots[this.fade.from] = null;
        this.cur = this.fade.to; this.fade = null;
      }
    }
    for (let i = 0; i < 2; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.inst.update(sig, dt);
      r.setRenderTarget(this.targets[i]);
      r.render(s.inst.scene, s.inst.camera);
    }
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.dead = true;
    for (const s of this.slots) { try { s?.inst.dispose(); } catch { /* the device may be gone */ } }
    try { for (const t of this.targets || []) t.dispose(); this.renderer?.dispose(); } catch { /* the device may be gone */ }
  }
}
