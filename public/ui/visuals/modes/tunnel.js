// Spectrum tunnel: rings of light running away from the camera. Each ring is the spectrum at the moment it was
// born, so the tunnel is a few bars of the music's recent past with "now" right in front.
// The spectrum history lives in a GPU buffer (one row per ring, written by a compute pass as rings are born); the
// dots are instanced sprites placed in the vertex shader from that buffer, so nothing is looped over on the CPU.
const RINGS = 96, SEG = 128, BANDS = 16;
const SPACING = 0.75;        // distance between rings
const ROWS_PER_BEAT = 8;     // rings born per beat: the tunnel moves with the tempo

export default {
  name: 'tunnel',
  label: 'Spectrum tunnel',
  create({ THREE, tsl, renderer, u }) {
    const { Fn, float, int, vec3, uniform, instancedArray, instanceIndex, sin, cos, floor, abs, mix, uv, smoothstep, varying, length, fract } = tsl;

    const history = instancedArray(RINGS * BANDS, 'float');
    const head = uniform(0), frac = uniform(0); // the newest row, and how far the next ring is on its way
    const writeRow = Fn(() => {
      history.element(int(head).mul(BANDS).add(int(instanceIndex))).assign(u.bands.element(int(instanceIndex)));
    })().compute(BANDS);

    const i = float(instanceIndex);
    const ring = floor(i.div(SEG)), seg = i.sub(ring.mul(SEG));
    const age = ring.add(frac);                               // in rings: 0 is being born, RINGS is the far end
    const row = int(head).sub(int(ring)).add(RINGS).mod(RINGS);
    const around = seg.div(SEG);
    // the spectrum is laid around the ring twice, mirrored, so lows sit at the top and bottom and highs at the sides
    const bf = abs(fract(around.mul(2)).mul(2).sub(1)).mul(BANDS - 1);
    const b0 = int(floor(bf)), b1 = b0.add(1).min(BANDS - 1);
    const band = mix(history.element(row.mul(BANDS).add(b0)), history.element(row.mul(BANDS).add(b1)), fract(bf));
    const far = age.div(RINGS);                               // 0 near .. 1 far
    const z = age.mul(-SPACING);
    const angle = around.mul(Math.PI * 2).add(age.mul(0.035)).add(u.time.mul(0.05));
    const radius = float(2.6).add(band.mul(2.4)).add(sin(age.mul(0.21).add(u.time.mul(0.6))).mul(0.25)).add(u.kick.mul(0.35).mul(float(1).sub(far)));
    const position = vec3(cos(angle).mul(radius), sin(angle).mul(radius), z);
    const glow = band.mul(band).mul(3.2).add(0.1).mul(u.drive.mul(0.7).add(0.3)).mul(u.energy.mul(0.8).add(0.6));
    const fog = smoothstep(1, 0.15, far).mul(smoothstep(0, 0.04, far));
    const vColor = varying(mix(u.color, u.accent, band.mul(band)).mul(glow).mul(fog));

    const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    material.positionNode = position;
    material.scaleNode = band.mul(0.22).add(0.05).mul(u.kick.mul(0.5).add(1));
    material.colorNode = vColor;
    material.opacityNode = smoothstep(0.5, 0.1, length(uv().sub(0.5)));

    const dots = new THREE.Sprite(material);
    dots.count = RINGS * SEG;
    dots.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(dots);
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 200);
    camera.position.set(0, 0, 1.5);
    let lastBeat = null;

    return {
      scene, camera,
      update(sig, dt) {
        // rings are born at a steady number per beat; a jump in the beat (a seek, a new track) is not a burst of rings
        const moved = lastBeat == null ? 0 : sig.beat - lastBeat;
        lastBeat = sig.beat;
        let f = frac.value + (moved > 0 && moved < 1 ? moved : (dt * sig.bpm) / 60) * ROWS_PER_BEAT;
        let rows = Math.min(4, Math.floor(f));
        f -= Math.floor(f);
        while (rows-- > 0) { head.value = (head.value + 1) % RINGS; renderer.compute(writeRow); }
        frac.value = f;
        camera.rotation.z = Math.sin(sig.time * 0.07) * 0.25;
        camera.position.x = Math.sin(sig.time * 0.23) * 0.3; camera.position.y = Math.cos(sig.time * 0.19) * 0.3;
      },
      resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
      dispose() { material.dispose(); history.dispose?.(); writeRow.dispose?.(); },
    };
  },
};
