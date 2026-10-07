// Reactive terrain: ridge lines running to the horizon. Each line is the spectrum at one moment, newest at the
// camera, so the landscape is built out of the music as it plays: bass raises the mountains at the sides, the highs
// ripple along the valley floor.
// The spectrum history is a GPU buffer written by a compute pass (one row per ridge); the lines are displaced in the
// vertex shader from that buffer.
const ROWS = 110, COLS = 160, BANDS = 16;
const WIDTH = 46, SPACING = 0.55;
const ROWS_PER_BEAT = 4;

export default {
  name: 'terrain',
  label: 'Reactive terrain',
  create({ THREE, tsl, renderer, u }) {
    const { Fn, float, int, vec3, uniform, instancedArray, instanceIndex, uv, floor, abs, mix, fract, smoothstep, pow, varying } = tsl;

    const history = instancedArray(ROWS * BANDS, 'float');
    const head = uniform(0), frac = uniform(0);
    const writeRow = Fn(() => {
      history.element(int(head).mul(BANDS).add(int(instanceIndex))).assign(u.bands.element(int(instanceIndex)));
    })().compute(BANDS);

    // one line per row, COLS segments each; uv says where a vertex is: x across (0..1), y the row number
    const pts = new Float32Array(ROWS * COLS * 2 * 2), zero = new Float32Array(ROWS * COLS * 2 * 3);
    for (let r = 0, k = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const cc of [c, c + 1]) { pts[k++] = cc / COLS; pts[k++] = r; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(zero, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(pts, 2));

    const across = uv().x, rowN = uv().y;
    const age = rowN.add(frac), far = age.div(ROWS);
    const row = int(head).sub(int(rowN)).add(ROWS).mod(ROWS);
    const side = abs(across.mul(2).sub(1));                    // 0 in the middle of the valley, 1 at the edges
    const bf = float(1).sub(side).mul(BANDS - 1);              // highs in the middle, bass at the edges
    const b0 = int(floor(bf)), b1 = b0.add(1).min(BANDS - 1);
    const band = mix(history.element(row.mul(BANDS).add(b0)), history.element(row.mul(BANDS).add(b1)), fract(bf));
    const height = pow(band, 1.6).mul(side.mul(11).add(1.4)).mul(smoothstep(0, 0.06, far));
    const material = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    material.positionNode = vec3(across.sub(0.5).mul(WIDTH), height, age.mul(-SPACING));
    const fog = smoothstep(1, 0.2, far).mul(smoothstep(0, 0.03, far));
    material.colorNode = varying(mix(u.color, u.accent, band.mul(band)).mul(band.mul(1.8).add(0.12)).mul(fog).mul(u.energy.mul(0.8).add(0.6)).mul(u.kick.mul(0.5).add(1)));

    const lines = new THREE.LineSegments(geo, material);
    lines.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(lines);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 200);
    let lastBeat = null;

    return {
      scene, camera,
      update(sig, dt) {
        const moved = lastBeat == null ? 0 : sig.beat - lastBeat;
        lastBeat = sig.beat;
        let f = frac.value + (moved > 0 && moved < 1 ? moved : (dt * sig.bpm) / 60) * ROWS_PER_BEAT;
        let rows = Math.min(4, Math.floor(f));
        f -= Math.floor(f);
        while (rows-- > 0) { head.value = (head.value + 1) % ROWS; renderer.compute(writeRow); }
        frac.value = f;
        camera.position.set(Math.sin(sig.time * 0.11) * 2.5, 5.5 + sig.bass * 0.8, 2.5);
        camera.lookAt(0, 3.5, -22);
      },
      resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
      dispose() { geo.dispose(); material.dispose(); history.dispose?.(); writeRow.dispose?.(); },
    };
  },
};
