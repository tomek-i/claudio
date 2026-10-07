// Particle field: a cloud of particles simulated on the GPU. A compute pass moves every particle each frame: they
// drift on a slow flow field, are held on shells around the centre that breathe with the bass, and are thrown
// outwards by each kick. Every particle listens to one band of the spectrum, which lights it up.
// It shapes the shared elements (../morph.js), so it morphs into and out of the other modes that do. The simulation
// keeps its positions and velocities in the slot's two state buffers and writes the result as the elements' targets.
const BANDS = 16;

export default {
  name: 'particles',
  label: 'Particle field',
  morph({ THREE, tsl, renderer, u }, slot) {
    const { Fn, float, int, vec3, vec4, uniform, instanceIndex, hash, sin, cos, sqrt, pow, length, mix } = tsl;
    const N = slot.count, pos = slot.s1, vel = slot.s2;
    const dt = uniform(0.016);

    const init = Fn(() => {
      const a = hash(instanceIndex).mul(Math.PI * 2), z = hash(instanceIndex.add(N)).mul(2).sub(1), r = pow(hash(instanceIndex.add(N * 2)), 1 / 3).mul(4);
      const xy = sqrt(float(1).sub(z.mul(z)));
      pos.element(instanceIndex).assign(vec4(vec3(cos(a).mul(xy), sin(a).mul(xy), z).mul(r), 0));
      vel.element(instanceIndex).assign(vec4(0));
    })().compute(N);
    renderer.compute(init);

    const step = Fn(() => {
      const p = pos.element(instanceIndex).xyz.toVar(), v = vel.element(instanceIndex).xyz.toVar();
      const r = length(p).max(0.001), dir = p.div(r), h = hash(instanceIndex);
      const t = u.time.mul(0.3);
      const flow = vec3(sin(p.y.mul(0.9).add(t)), sin(p.z.mul(0.9).add(t.mul(1.3))), sin(p.x.mul(0.9).add(t.mul(0.7)))).mul(u.drive.mul(1.4).add(0.3));
      const swirl = vec3(p.z.negate(), 0, p.x).mul(0.3);
      const shell = h.mul(2.6).add(1.8).add(u.bass.mul(1.6));
      const push = flow.add(swirl).add(dir.mul(shell.sub(r)).mul(1.6)).add(dir.mul(u.kick).mul(h.mul(9).add(2)));
      v.addAssign(push.mul(dt));
      v.mulAssign(float(1).sub(dt.mul(1.7)).max(0));
      p.addAssign(v.mul(dt));
      pos.element(instanceIndex).assign(vec4(p, 0));
      vel.element(instanceIndex).assign(vec4(v, 0));
      const band = u.bands.element(int(hash(instanceIndex.add(N * 3)).mul(BANDS - 0.01)));
      const light = band.mul(band).mul(1.6).add(length(v).mul(0.12)).add(0.05).mul(u.energy.mul(0.8).add(0.6));
      slot.pos.element(instanceIndex).assign(vec4(p, band.mul(0.05).add(0.022).mul(slot.scale.size)));
      slot.col.element(instanceIndex).assign(vec4(mix(u.color, u.accent, hash(instanceIndex.add(N * 4)).mul(band).mul(1.4).min(1)).mul(light).mul(slot.scale.light), 1));
    })().compute(N);

    const view = { position: new THREE.Vector3(0, 0, 9), target: new THREE.Vector3(0, 0, 0), fov: 60 };
    let turn = 0;
    return {
      view,
      update(sig, d) {
        dt.value = Math.min(0.05, d);
        renderer.compute(step);
        turn += d * (0.08 + 0.12 * sig.drive);
        view.position.set(Math.sin(turn) * 9, Math.sin(turn * 0.37) * 2.5, Math.cos(turn) * 9);
      },
      dispose() { init.dispose?.(); step.dispose?.(); },
    };
  },
};
