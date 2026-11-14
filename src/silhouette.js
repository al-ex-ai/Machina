// True-scale silhouettes for Compare. Each model is drawn flat in its own color from the side,
// the top and the front, all at one scale: noses on one line in the side and top views, the
// centerline in the middle of the top and front views, and every model standing on the ground.
//
// Speed: each view is one GPU render for up to four models. Every model writes 1 into its own
// channel (red, green, blue, alpha) with max blending, so overlaps keep every model's mask; the
// pixels are read straight from a render target and composited in a single pass. Given the
// viewer's renderer, it draws with that, so the models' geometry is not uploaded to a second
// WebGL context.
import * as THREE from 'three';

// Camera direction and up vector per view. Side and top keep the nose on the left.
const VIEWS = {
  side: { dir: [0, 0, 1], up: [0, 1, 0], h: 'x', v: 'y' },
  top: { dir: [0, 1, 0], up: [0, 0, -1], h: 'x', v: 'z' },
  front: { dir: [-1, 0, 0], up: [0, 1, 0], h: 'z', v: 'y' },
};
const CHANNELS = 4;
const FILL_ALPHA = 0.22;

let ctx = null;
function setup() {
  // No multisampling: it is slow on software renderers. Cracks are closed in composite() instead.
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  // Model i writes 1 into channel i only; max blending keeps what other models wrote.
  const masks = [0, 1, 2, 3].map(i => new THREE.MeshBasicMaterial({
    color: new THREE.Color(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0),
    opacity: i === 3 ? 1 : 0,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendEquationAlpha: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  }));
  return { target, scene, camera, masks, own: null };
}

/** The world box of one model. */
function measure(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

/**
 * Render one view of up to four models, each into its own channel, and return the raw RGBA
 * pixels (bottom row first, as WebGL reads them).
 */
function maskView(items, view, ext, pxPerM, w, h, shared) {
  ctx ??= setup();
  const { target, scene, camera, masks } = ctx;
  const renderer = shared ?? (ctx.own ??= new THREE.WebGLRenderer({ antialias: false, alpha: true }));
  const v = VIEWS[view];
  const restore = [];
  items.forEach((it, i) => {
    restore.push({ obj: it.obj, parent: it.obj.parent, pos: it.obj.position.clone() });
    scene.add(it.obj);
    it.obj.position.x += view === 'front' ? 0 : it.shift;
    it.obj.traverse(o => {
      if (!o.isMesh) return;
      restore.push({ mesh: o, material: o.material });
      o.material = masks[i];
    });
  });
  scene.updateMatrixWorld(true);

  const center = new THREE.Vector3();
  center[v.h] = (ext.h[0] + ext.h[1]) / 2;
  center[v.v] = (ext.v[0] + ext.v[1]) / 2;
  Object.assign(camera, { left: -w / pxPerM / 2, right: w / pxPerM / 2, top: h / pxPerM / 2, bottom: -h / pxPerM / 2 });
  camera.up.set(...v.up);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(...v.dir), 2000);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  // Render targets skip tone mapping and color conversion, so 1 stays 255. Put the shared
  // renderer's state back afterwards.
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  target.setSize(w, h);
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);

  for (const r of restore) {
    if (r.mesh) { r.mesh.material = r.material; continue; }
    r.obj.position.copy(r.pos);
    if (r.parent) r.parent.add(r.obj); else scene.remove(r.obj);
    r.obj.updateMatrixWorld(true);
  }
  return px;
}

/**
 * Composite the masks into one image: each model a translucent fill with a solid outline, the
 * first model on top. One pass over the pixels; edges come from bit masks of the neighbors.
 */
function composite(px, w, h, colors, t) {
  const n = colors.length;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w; // WebGL rows start at the bottom
    for (let x = 0; x < w; x++) {
      const i = (src + x) * 4;
      bits[y * w + x] = (px[i] > 127 ? 1 : 0) | (px[i + 1] > 127 ? 2 : 0) | (px[i + 2] > 127 ? 4 : 0) | (px[i + 3] > 127 ? 8 : 0);
    }
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : bits[y * w + x]);
  // Close hairline cracks between triangles: a pixel belongs to a model when the pixels on both
  // sides of it do, across or up and down. Without this every crack would get an outline.
  const closed = new Uint8Array(bits.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      closed[i] = bits[i] | (at(x - 1, y) & at(x + 1, y)) | (at(x, y - 1) & at(x, y + 1));
    }
  }
  bits.set(closed);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = bits[y * w + x];
      if (!b) continue;
      // A model's pixel is on its outline when any neighbor lacks its bit.
      const edge = b & ~(at(x - t, y) & at(x + t, y) & at(x, y - t) & at(x, y + t));
      let r = 0, g = 0, bl = 0, a = 0;
      for (let k = n - 1; k >= 0; k--) { // later models first, the first model ends on top
        if (!(b & (1 << k))) continue;
        const al = edge & (1 << k) ? 1 : FILL_ALPHA;
        const c = colors[k];
        const out = al + a * (1 - al);
        r = (c[0] * al + r * a * (1 - al)) / out;
        g = (c[1] * al + g * a * (1 - al)) / out;
        bl = (c[2] * al + bl * a * (1 - al)) / out;
        a = out;
      }
      const o = (y * w + x) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = bl;
      d[o + 3] = a * 255;
    }
  }
  return img;
}

/** A round number of meters for the scale bar, about a fifth of the drawing. */
function niceStep(span) {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(k => k * p).find(s => s >= raw) ?? 10 * p;
}

/**
 * Draw every model from the side, top and front at one shared scale.
 * @param {{ obj: THREE.Object3D, color: string }[]} items built models (up to four), each centered and on the ground
 * @param {{ width?: number, height?: number, gap?: number, caption?: number, dpr?: number, ink?: string, faint?: string, renderer?: THREE.WebGLRenderer }} [opts]
 *   sizes in CSS pixels. width is the room for the side and front views next to each other; the top view
 *   goes under the side view, and height (optional) caps the whole sheet including one caption per row.
 * @returns {{ side: HTMLCanvasElement, top: HTMLCanvasElement, front: HTMLCanvasElement, pxPerM: number }}
 */
export function silhouettes(items, opts = {}) {
  if (items.length > CHANNELS) throw new Error(`silhouettes draws up to ${CHANNELS} models`);
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const width = (opts.width ?? 880) * dpr;
  const measured = items.map(it => { const box = measure(it.obj); return { ...it, box, shift: -box.min.x }; });
  const len = Math.max(...measured.map(m => m.box.max.x - m.box.min.x));
  const half = Math.max(...measured.map(m => Math.max(-m.box.min.z, m.box.max.z)));
  const high = Math.max(...measured.map(m => m.box.max.y));
  const pad = Math.max(len, half * 2) * 0.04;
  const ext = {
    side: { h: [-pad, len + pad], v: [-pad, high + pad] },
    top: { h: [-pad, len + pad], v: [-half - pad, half + pad] },
    front: { h: [-half - pad, half + pad], v: [-pad, high + pad] },
  };
  // One scale for all three views: side and front views side by side fill the width.
  const gap = (opts.gap ?? 16) * dpr;
  let pxPerM = (width - gap) / (len + 2 * pad + 2 * (half + pad));
  // With a height, the sheet (side over top, plus captions) also has to fit that tall.
  if (opts.height) {
    const captions = 2 * (opts.caption ?? 24) * dpr;
    pxPerM = Math.min(pxPerM, (opts.height * dpr - gap - captions) / (high + 2 * pad + 2 * (half + pad)));
  }
  const colors = items.map(it => new THREE.Color(it.color).toArray().map(x => Math.round(x * 255)));
  const t = Math.max(1, Math.round(dpr));
  const out = { pxPerM: pxPerM / dpr };
  for (const view of Object.keys(VIEWS)) {
    const e = ext[view];
    const w = Math.max(2, Math.round((e.h[1] - e.h[0]) * pxPerM));
    const h = Math.max(2, Math.round((e.v[1] - e.v[0]) * pxPerM));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.style.width = `${w / dpr}px`;
    c.style.aspectRatio = `${w} / ${h}`;
    const g = c.getContext('2d');
    g.putImageData(composite(maskView(measured, view, e, pxPerM, w, h, opts.renderer), w, h, colors, t), 0, 0);
    // Ground line under the side and front views, and a scale bar.
    g.strokeStyle = opts.faint ?? '#75839a';
    g.lineWidth = dpr;
    if (view !== 'top') {
      const y = h - pad * pxPerM;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    const step = niceStep(view === 'front' ? 2 * half : len);
    const bar = step * pxPerM;
    const x0 = 8 * dpr;
    const y0 = 10 * dpr;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + bar, y0);
    g.moveTo(x0, y0 - 4 * dpr);
    g.lineTo(x0, y0 + 4 * dpr);
    g.moveTo(x0 + bar, y0 - 4 * dpr);
    g.lineTo(x0 + bar, y0 + 4 * dpr);
    g.stroke();
    g.font = `${11 * dpr}px ui-monospace, Consolas, monospace`;
    g.fillStyle = opts.ink ?? '#e7ecf2';
    g.fillText(`${step} m`, x0 + bar + 6 * dpr, y0 + 4 * dpr);
    out[view] = c;
  }
  return out;
}
