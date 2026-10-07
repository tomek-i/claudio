# three.js (vendored)

The WebGPU build of [three.js](https://threejs.org), used only by the `/visuals` page. Vendored so the page works
offline and the project keeps having no npm dependencies. MIT licence, see `LICENSE`. The version is in `VERSION`.

| File | From the `three` npm package |
|---|---|
| `three.webgpu.min.js` | `build/three.webgpu.js` |
| `three.core.js` | `build/three.core.js` (keeps this name: the WebGPU build imports `./three.core.js`) |
| `three.tsl.min.js` | `build/three.tsl.js` |

All three are the minified copies served by jsDelivr (`https://cdn.jsdelivr.net/npm/three@<version>/build/<name>.min.js`).
`public/visuals.html` maps `three/webgpu` and `three/tsl` to them with an import map.

To update: download the three files for the new version the same way, keep the names above, and change `VERSION`.
