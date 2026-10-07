// Kaleidoscope: a full-screen shader with no geometry. The screen is folded into mirrored wedges around the centre
// and a field of flowing noise is seen through them; rings travel outwards on the beat and the spectrum is laid
// along the radius, bass in the middle.
const BANDS = 16;

export default {
  name: 'kaleido',
  label: 'Kaleidoscope',
  create({ THREE, tsl, u }) {
    const { Fn, float, int, vec2, vec3, uniform, uv, sin, cos, atan, abs, length, mix, fract, floor, smoothstep, mx_noise_float } = tsl;

    const WEDGES = 8;
    const spin = uniform(0), flow = uniform(0);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
      const p = uv().sub(0.5).mul(vec2(u.aspect, 1)).mul(2);
      const r = length(p), wedge = float((Math.PI * 2) / WEDGES);
      const a = atan(p.y, p.x).add(spin);
      const fold = abs(fract(a.div(wedge)).sub(0.5)).mul(wedge);          // mirrored inside each wedge
      const q = vec2(cos(fold), sin(fold)).mul(r);
      const n1 = mx_noise_float(vec3(q.mul(2.2).add(vec2(flow, 0)), u.time.mul(0.12)));
      const n2 = mx_noise_float(vec3(q.mul(5).sub(vec2(0, flow.mul(1.7))), u.time.mul(0.2).add(n1)));
      const field = n1.add(n2.mul(0.5)).mul(0.5).add(0.5);
      const bf = r.mul(0.8).min(1).mul(BANDS - 1), b0 = int(floor(bf)), b1 = b0.add(1).min(BANDS - 1);
      const band = mix(u.bands.element(b0), u.bands.element(b1), fract(bf));
      const ring = smoothstep(0.75, 1, sin(r.mul(7).sub(u.beat.mul(Math.PI * 2)).add(n1.mul(2))).mul(0.5).add(0.5));
      const lines = smoothstep(0.42, 0.5, abs(fract(field.mul(6).add(band)).sub(0.5)));
      const light = lines.mul(band.mul(1.5).add(0.15)).add(ring.mul(u.kick.mul(0.9).add(0.12))).add(band.mul(band).mul(0.5));
      const colour = mix(u.color, u.accent, smoothstep(0.35, 0.75, field.add(band.mul(0.3))));
      return colour.mul(light).mul(u.energy.mul(0.8).add(0.6)).mul(u.drive.mul(0.6).add(0.4)).mul(smoothstep(1.9, 0.6, r));
    })();

    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return {
      scene, camera,
      update(sig, dt) {
        spin.value += dt * (0.05 + 0.25 * sig.mid) * (0.4 + 0.6 * sig.drive);
        flow.value += dt * (0.1 + 0.9 * sig.bass);
      },
      dispose() { material.dispose(); },
    };
  },
};
