// Reactive terrain: ridge lines running to the horizon. Each ridge is the spectrum at one moment, newest at the
// camera, so the landscape is built out of the music as it plays: bass raises the mountains at the sides, the highs
// ripple along the valley floor.
// It shapes the shared elements (../morph.js), so it morphs into and out of the other modes that do: the elements
// are strung along the ridges, close enough together to read as lines. The spectrum history lives in the slot's
// first state buffer (one row per ridge, written as ridges are born); one compute pass places every element from it.
const ROWS = 110, BANDS = 16;
const WIDTH = 46, SPACING = 0.55;
const ROWS_PER_BEAT = 4;

export default {
  name: 'terrain',
  label: 'Reactive terrain',
  morph({ THREE, tsl, renderer, u }, slot) {
    const { Fn, float, int, vec4, uniform, instanceIndex, hash, floor, abs, mix, fract, smoothstep, pow } = tsl;
    const N = slot.count, PER = Math.floor(N / ROWS);   // elements along each ridge

    const history = slot.s1;                            // .x of the first ROWS * BANDS entries
    const head = uniform(0), frac = uniform(0);
    const writeRow = Fn(() => {
      history.element(int(head).mul(BANDS).add(int(instanceIndex))).assign(vec4(u.bands.element(int(instanceIndex)), 0, 0, 0));
    })().compute(BANDS);
    const clear = Fn(() => { history.element(instanceIndex).assign(vec4(0)); })().compute(ROWS * BANDS);
    renderer.compute(clear);

    const place = Fn(() => {
      const i = float(instanceIndex);
      const rowN = floor(i.div(PER)).min(ROWS - 1), across = fract(i.div(PER));
      const age = rowN.add(frac), far = age.div(ROWS);
      const row = int(head).sub(int(rowN)).add(ROWS).mod(ROWS);
      const side = abs(across.mul(2).sub(1));                    // 0 in the middle of the valley, 1 at the edges
      const bf = float(1).sub(side).mul(BANDS - 1);              // highs in the middle, bass at the edges
      const b0 = int(floor(bf)), b1 = b0.add(1).min(BANDS - 1);
      const band = mix(history.element(row.mul(BANDS).add(b0)).x, history.element(row.mul(BANDS).add(b1)).x, fract(bf));
      const height = pow(band, 1.6).mul(side.mul(11).add(1.4)).mul(smoothstep(0, 0.06, far));
      const fog = smoothstep(1, 0.2, far).mul(smoothstep(0, 0.03, far));
      // a ridge is a thin line: its elements keep to it, with a hair of scatter so it does not look like beads
      const z = age.add(hash(instanceIndex).sub(0.5).mul(0.06)).mul(-SPACING);
      const light = band.mul(1.8).add(0.12).mul(fog).mul(u.energy.mul(0.8).add(0.6)).mul(u.kick.mul(0.5).add(1));
      slot.pos.element(instanceIndex).assign(vec4(across.sub(0.5).mul(WIDTH), height, z, float(0.05).add(band.mul(0.03)).mul(slot.scale.size)));
      slot.col.element(instanceIndex).assign(vec4(mix(u.color, u.accent, band.mul(band)).mul(light).mul(slot.scale.light).mul(0.55), 1));
    })().compute(N);

    const view = { position: new THREE.Vector3(0, 5.5, 2.5), target: new THREE.Vector3(0, 3.5, -22), fov: 70 };
    let lastBeat = null;
    return {
      view,
      update(sig, dt) {
        // ridges are born at a steady number per beat; a jump in the beat (a seek, a new track) is not a burst of them
        const moved = lastBeat == null ? 0 : sig.beat - lastBeat;
        lastBeat = sig.beat;
        let f = frac.value + (moved > 0 && moved < 1 ? moved : (dt * sig.bpm) / 60) * ROWS_PER_BEAT;
        let rows = Math.min(4, Math.floor(f));
        f -= Math.floor(f);
        while (rows-- > 0) { head.value = (head.value + 1) % ROWS; renderer.compute(writeRow); }
        frac.value = f;
        renderer.compute(place);
        view.position.set(Math.sin(sig.time * 0.11) * 2.5, 5.5 + sig.bass * 0.8, 2.5);
      },
      dispose() { writeRow.dispose?.(); clear.dispose?.(); place.dispose?.(); },
    };
  },
};
