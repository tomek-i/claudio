// Spectrum tunnel: rings of light running away from the camera. Each ring is the spectrum at the moment it was
// born, so the tunnel is a few bars of the music's recent past with "now" right in front.
// It shapes the shared elements (../morph.js), so it morphs into and out of the other modes that do. The spectrum
// history lives in the slot's first state buffer (one row per ring, written as rings are born); one compute pass
// places every element on its ring from that history. Nothing is looped over on the CPU.
const RINGS = 96, BANDS = 16;
const SPACING = 0.75;        // distance between rings
const ROWS_PER_BEAT = 8;     // rings born per beat: the tunnel moves with the tempo

export default {
  name: 'tunnel',
  label: 'Spectrum tunnel',
  morph({ THREE, tsl, renderer, u }, slot) {
    const { Fn, float, int, vec3, vec4, uniform, instanceIndex, hash, sin, cos, floor, abs, mix, smoothstep, fract } = tsl;
    const N = slot.count, PER = Math.floor(N / RINGS);   // elements on each ring

    const history = slot.s1;                            // .x of the first RINGS * BANDS entries
    const head = uniform(0), frac = uniform(0);         // the newest row, and how far the next ring is on its way
    const writeRow = Fn(() => {
      history.element(int(head).mul(BANDS).add(int(instanceIndex))).assign(vec4(u.bands.element(int(instanceIndex)), 0, 0, 0));
    })().compute(BANDS);
    const clear = Fn(() => { history.element(instanceIndex).assign(vec4(0)); })().compute(RINGS * BANDS);
    renderer.compute(clear);

    const place = Fn(() => {
      const i = float(instanceIndex);
      const ring = floor(i.div(PER)).min(RINGS - 1), around = fract(i.div(PER));
      const age = ring.add(frac);                               // in rings: 0 is being born, RINGS is the far end
      const row = int(head).sub(int(ring)).add(RINGS).mod(RINGS);
      // the spectrum is laid around the ring twice, mirrored, so lows sit at the top and bottom and highs at the sides
      const bf = abs(fract(around.mul(2)).mul(2).sub(1)).mul(BANDS - 1);
      const b0 = int(floor(bf)), b1 = b0.add(1).min(BANDS - 1);
      const band = mix(history.element(row.mul(BANDS).add(b0)).x, history.element(row.mul(BANDS).add(b1)).x, fract(bf));
      const far = age.div(RINGS);                               // 0 near .. 1 far
      const h = hash(instanceIndex);
      const angle = around.mul(Math.PI * 2).add(age.mul(0.035)).add(u.time.mul(0.05));
      // each ring has a little thickness, more where its band is loud
      const radius = float(2.6).add(band.mul(2.4)).add(sin(age.mul(0.21).add(u.time.mul(0.6))).mul(0.25))
        .add(u.kick.mul(0.35).mul(float(1).sub(far))).add(h.sub(0.5).mul(band.mul(0.5).add(0.04)));
      const z = age.add(hash(instanceIndex.add(7)).sub(0.5).mul(0.3)).mul(-SPACING);
      const glow = band.mul(band).mul(3.2).add(0.1).mul(u.drive.mul(0.7).add(0.3)).mul(u.energy.mul(0.8).add(0.6));
      const fog = smoothstep(1, 0.15, far).mul(smoothstep(0, 0.04, far));
      slot.pos.element(instanceIndex).assign(vec4(cos(angle).mul(radius), sin(angle).mul(radius), z, band.mul(0.2).add(0.045).mul(u.kick.mul(0.5).add(1)).mul(slot.scale.size)));
      slot.col.element(instanceIndex).assign(vec4(mix(u.color, u.accent, band.mul(band)).mul(glow).mul(fog).mul(slot.scale.light), 1));
    })().compute(N);

    const view = { position: new THREE.Vector3(0, 0, 1.5), target: new THREE.Vector3(0, 0, -30), fov: 72 };
    let lastBeat = null;
    return {
      view,
      update(sig, dt) {
        // rings are born at a steady number per beat; a jump in the beat (a seek, a new track) is not a burst of rings
        const moved = lastBeat == null ? 0 : sig.beat - lastBeat;
        lastBeat = sig.beat;
        let f = frac.value + (moved > 0 && moved < 1 ? moved : (dt * sig.bpm) / 60) * ROWS_PER_BEAT;
        let rows = Math.min(4, Math.floor(f));
        f -= Math.floor(f);
        while (rows-- > 0) { head.value = (head.value + 1) % RINGS; renderer.compute(writeRow); }
        frac.value = f;
        renderer.compute(place);
        view.position.set(Math.sin(sig.time * 0.23) * 0.3, Math.cos(sig.time * 0.19) * 0.3, 1.5);
        view.target.set(Math.sin(sig.time * 0.07) * 2, Math.cos(sig.time * 0.09) * 2, -30);
      },
      dispose() { writeRow.dispose?.(); clear.dispose?.(); place.dispose?.(); },
    };
  },
};
