// The morph: one shared set of GPU elements (a position, a size and a colour each) that modes shape, so a change
// between two such modes is the same elements travelling from one shape to the other and not one picture fading
// over another.
//
// A mode takes part by having, next to (or in place of) `create`, a
//   morph(ctx, slot)      ctx: { THREE, tsl, renderer, u }, as for create
//                         slot: { count, pos, col, s1, s2, scale }
// that returns { update(sig, dt), view, dispose() }. In update() the mode runs a compute pass of its own that writes
// where every element should be: slot.pos (xyz and the size in w) and slot.col (rgb), for all `count` elements. s1
// and s2 are two more buffers of the same size the mode may keep state in (a simulation, a history). `scale` is
// { light, size }: what to multiply brightness and size by so the picture has the same weight at every element
// count. `view` is { position, target, fov }, the camera the shape wants, which the mode may move in update().
// A mode without `morph` is drawn by itself and crossfades as before; it needs to know nothing of this file.
//
// Everything lives in storage buffers written by compute passes: two slots (one per mode on stage) and the buffers
// that are drawn. They are allocated once, for the quality tier, and never at a change of mode. Each frame a compute
// pass moves every element along its own path between the two slots' shapes, by how far the change has come.
export const TIERS = { low: 250000, medium: 1000000, high: 4000000 };
const ORDER = ['low', 'medium', 'high'];
const BUFFERS = 10, BYTES = 16;   // ten buffers of one vec4 per element

// Which tier to start on. `info` and `limits` are the adapter's; a tier is only eligible when one of its buffers fits
// in what the adapter allows. `want` (from ?quality=) wins if it is eligible, else the nearest lower one is used.
export function pickTier({ info = {}, limits = {}, want = null } = {}) {
  const room = Math.min(limits.maxStorageBufferBindingSize ?? Infinity, limits.maxBufferSize ?? Infinity);
  const eligible = ORDER.filter((t) => TIERS[t] * BYTES <= room);
  if (!eligible.length) return null;
  const top = (t) => eligible.filter((e) => ORDER.indexOf(e) <= ORDER.indexOf(t)).pop() || eligible[0];
  if (ORDER.includes(want)) return top(want);
  const text = `${info.vendor || ''} ${info.architecture || ''} ${info.description || ''}`.toLowerCase();
  // a discrete card starts high and Apple silicon in the middle; integrated and unknown graphics start low. The
  // warm-up then steps down whatever cannot hold the frame rate.
  const guess = /nvidia|amd|radeon/.test(text) && !/integrated/.test(text) ? 'high' : /apple/.test(text) ? 'medium' : 'low';
  return top(guess);
}
export const lowerTier = (t) => ORDER[ORDER.indexOf(t) - 1] || null;
export const tierBytes = (t) => TIERS[t] * BYTES * BUFFERS;

export class Morph {
  constructor({ THREE, tsl, renderer, u, tier }) {
    const { Fn, vec3, vec4, uniform, instancedArray, instanceIndex, hash, sin, cos, cross, mix, smoothstep, uv, length, varying } = tsl;
    this.renderer = renderer; this.tier = tier;
    const N = this.count = TIERS[tier];
    const buf = () => instancedArray(N, 'vec4');
    const scale = { light: (TIERS.low / N) ** 0.6, size: (TIERS.low / N) ** 0.22 };
    this.slots = [0, 1].map(() => ({ count: N, pos: buf(), col: buf(), s1: buf(), s2: buf(), scale }));
    this.drawn = { pos: buf(), col: buf() };
    // three.js makes a GPU buffer the first time it is used; touching all ten here means every one exists from the
    // start, and none is made when a mode first uses its slot (which is when a change begins)
    const all = [...this.slots.flatMap((s) => [s.pos, s.col, s.s1, s.s2]), this.drawn.pos, this.drawn.col];
    for (let k = 0; k < all.length; k += 4) { // a few at a time: a compute pass may bind only eight storage buffers
      const some = all.slice(k, k + 4);
      const touch = Fn(() => { for (const b of some) b.element(instanceIndex).assign(vec4(0)); })().compute(N);
      renderer.compute(touch);
      touch.dispose?.();
    }
    this.w = uniform(0);          // how far the elements are from slot 0's shape (0) towards slot 1's (1)
    this.views = [null, null];
    const [a, b] = this.slots, w = this.w;

    // One path per element, the same in both directions. Elements do not leave together (each has its own start
    // within the first half of the change) and do not fly straight: the path bows out sideways, by an amount that
    // grows with the distance to cover, and is stirred by a slow swirl that the kick pushes. At either end the
    // path is exactly the shape, so nothing pops when a change starts or ends.
    this.blend = Fn(() => {
      const i = instanceIndex;
      const pa = a.pos.element(i), pb = b.pos.element(i);
      const h = hash(i.add(17));
      const along = smoothstep(h.mul(0.5), h.mul(0.5).add(0.5), w);
      const out = sin(along.mul(Math.PI));
      // sideways from the straight line, further for a longer trip but never far enough to scatter the shape into fog
      const trip = pb.xyz.sub(pa.xyz), across = cross(trip, vec3(hash(i.add(101)), hash(i.add(202)), hash(i.add(303))).sub(0.5));
      const side = across.div(length(across).max(0.0001)).mul(length(trip).mul(0.22).min(2.2)).mul(hash(i.add(404)));
      const t = u.time.mul(0.6);
      const swirl = vec3(sin(pa.y.mul(0.7).add(t).add(h.mul(6.283))), cos(pa.z.mul(0.7).add(t)), sin(pa.x.mul(0.7).sub(t))).mul(u.kick.mul(0.6).add(0.3));
      this.drawn.pos.element(i).assign(vec4(mix(pa.xyz, pb.xyz, along).add(side.add(swirl).mul(out)), mix(pa.w, pb.w, along).mul(out.mul(0.35).add(1))));
      this.drawn.col.element(i).assign(mix(a.col.element(i), b.col.element(i), along).mul(out.mul(u.bass).mul(0.8).add(1)));
    })().compute(N);

    const material = this.material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const p = this.drawn.pos.toAttribute();
    material.positionNode = p.xyz;
    material.scaleNode = p.w;
    material.colorNode = varying(this.drawn.col.toAttribute().xyz);
    material.opacityNode = smoothstep(0.5, 0.08, length(uv().sub(0.5)));
    const dots = new THREE.Sprite(material);
    dots.count = N; dots.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(dots);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 300);
    this.eye = new THREE.Vector3(); this.aim = new THREE.Vector3();
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // weight: 0 = slot 0's shape, 1 = slot 1's. Moves the elements and the camera; call after the modes' update().
  step(weight) {
    this.w.value = weight;
    this.renderer.compute(this.blend);
    const [v0, v1] = this.views, a = v0 || v1, b = v1 || v0;
    if (!a) return;
    this.eye.lerpVectors(a.position, b.position, weight); this.aim.lerpVectors(a.target, b.target, weight);
    this.camera.position.copy(this.eye); this.camera.lookAt(this.aim);
    const fov = a.fov + (b.fov - a.fov) * weight;
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  dispose() {
    this.material.dispose(); this.blend.dispose?.();
    for (const b of [...this.slots.flatMap((s) => [s.pos, s.col, s.s1, s.s2]), this.drawn.pos, this.drawn.col]) b.dispose?.();
  }
}
