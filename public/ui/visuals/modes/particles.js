// Particle field: a cloud of particles simulated on the GPU. A compute pass moves every particle each frame: they
// drift on a slow flow field, are held on shells around the centre that breathe with the bass, and are thrown
// outwards by each kick. Every particle listens to one band of the spectrum, which lights it up.
const COUNT = 200000, BANDS = 16;

export default {
  name: 'particles',
  label: 'Particle field',
  create({ THREE, tsl, renderer, u }) {
    const { Fn, float, int, vec3, uniform, instancedArray, instanceIndex, hash, sin, cos, sqrt, pow, length, mix, uv, smoothstep, varying } = tsl;

    const pos = instancedArray(COUNT, 'vec3'), vel = instancedArray(COUNT, 'vec3');
    const dt = uniform(0.016);
    const init = Fn(() => {
      const a = hash(instanceIndex).mul(Math.PI * 2), z = hash(instanceIndex.add(COUNT)).mul(2).sub(1), r = pow(hash(instanceIndex.add(COUNT * 2)), 1 / 3).mul(4);
      const xy = sqrt(float(1).sub(z.mul(z)));
      pos.element(instanceIndex).assign(vec3(cos(a).mul(xy), sin(a).mul(xy), z).mul(r));
      vel.element(instanceIndex).assign(vec3(0));
    })().compute(COUNT);
    const step = Fn(() => {
      const p = pos.element(instanceIndex), v = vel.element(instanceIndex);
      const r = length(p).max(0.001), dir = p.div(r), h = hash(instanceIndex);
      const t = u.time.mul(0.3);
      const flow = vec3(sin(p.y.mul(0.9).add(t)), sin(p.z.mul(0.9).add(t.mul(1.3))), sin(p.x.mul(0.9).add(t.mul(0.7)))).mul(u.drive.mul(1.4).add(0.3));
      const swirl = vec3(p.z.negate(), 0, p.x).mul(0.3);
      const shell = h.mul(2.6).add(1.8).add(u.bass.mul(1.6));
      const push = flow.add(swirl).add(dir.mul(shell.sub(r)).mul(1.6)).add(dir.mul(u.kick).mul(h.mul(9).add(2)));
      v.addAssign(push.mul(dt));
      v.mulAssign(float(1).sub(dt.mul(1.7)).max(0));
      p.addAssign(v.mul(dt));
    })().compute(COUNT);
    renderer.compute(init);

    const band = u.bands.element(int(hash(instanceIndex.add(COUNT * 3)).mul(BANDS - 0.01)));
    const speed = length(vel.toAttribute());
    const light = band.mul(band).mul(1.6).add(speed.mul(0.12)).add(0.05).mul(u.energy.mul(0.8).add(0.6));
    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    material.positionNode = pos.toAttribute();
    material.scaleNode = band.mul(0.05).add(0.022);
    material.colorNode = varying(mix(u.color, u.accent, hash(instanceIndex.add(COUNT * 4)).mul(band).mul(1.4).min(1)).mul(light));
    material.opacityNode = smoothstep(0.5, 0.05, length(uv().sub(0.5)));

    const cloud = new THREE.Sprite(material);
    cloud.count = COUNT;
    cloud.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(cloud);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    let turn = 0;

    return {
      scene, camera,
      update(sig, d) {
        dt.value = Math.min(0.05, d);
        renderer.compute(step);
        turn += d * (0.08 + 0.12 * sig.drive);
        camera.position.set(Math.sin(turn) * 9, Math.sin(turn * 0.37) * 2.5, Math.cos(turn) * 9);
        camera.lookAt(0, 0, 0);
      },
      resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
      dispose() { material.dispose(); pos.dispose?.(); vel.dispose?.(); init.dispose?.(); step.dispose?.(); },
    };
  },
};
