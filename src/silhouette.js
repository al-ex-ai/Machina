// True-scale silhouettes for Compare. Each model is drawn flat in its own color from the side,
// the top and the front, all at one scale: noses on one line in the side and top views, the
// centerline in the middle of the top and front views, and every model standing on the ground.
import * as THREE from 'three';

// Camera direction and up vector per view. Side and top keep the nose on the left.
const VIEWS = {
  side: { dir: [0, 0, 1], up: [0, 1, 0], h: 'x', v: 'y' },
  top: { dir: [0, 1, 0], up: [0, 0, -1], h: 'x', v: 'z' },
  front: { dir: [-1, 0, 0], up: [0, 1, 0], h: 'z', v: 'y' },
};

let ctx = null;
function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor('#000000', 1);
  const scene = new THREE.Scene();
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  return { renderer, scene, camera };
}

/** The world box of one model with its nose moved to x = 0. */
function measure(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  return { box, shift: -box.min.x };
}

/** Pixel mask of one model in one view, at the shared scale. */
function mask(obj, shift, view, ext, pxPerM, w, h) {
  const { renderer, scene, camera } = (ctx ??= setup());
  const parent = obj.parent;
  const pos = obj.position.clone();
  scene.add(obj);
  obj.position.x += shift;
  obj.updateMatrixWorld(true);

  const v = VIEWS[view];
  const center = new THREE.Vector3(0, 0, 0);
  center[v.h] = (ext.h[0] + ext.h[1]) / 2;
  center[v.v] = (ext.v[0] + ext.v[1]) / 2;
  camera.left = -w / pxPerM / 2;
  camera.right = w / pxPerM / 2;
  camera.top = h / pxPerM / 2;
  camera.bottom = -h / pxPerM / 2;
  camera.up.set(...v.up);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(...v.dir), 2000);
  camera.lookAt(center);
  camera.near = 1;
  camera.far = 4000;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h, false);
  renderer.render(scene, camera);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(renderer.domElement, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;

  obj.position.copy(pos);
  if (parent) parent.add(obj); else scene.remove(obj);
  obj.updateMatrixWorld(true);

  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = data[i * 4] > 110 ? 1 : 0;
  return m;
}

/** A translucent fill with a solid outline, in the model's color. */
function layer(m, w, h, color, t) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const [r, gr, b] = new THREE.Color(color).toArray().map(x => Math.round(x * 255));
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      const edge = !at(x - t, y) || !at(x + t, y) || !at(x, y - t) || !at(x, y + t);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gr;
      img.data[i + 2] = b;
      img.data[i + 3] = edge ? 255 : 56;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A round number of meters for the scale bar, about a fifth of the drawing. */
function niceStep(span) {
  const raw = span / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(k => k * p).find(s => s >= raw) ?? 10 * p;
}

/**
 * Draw every model from the side, top and front at one shared scale.
 * @param {{ obj: THREE.Object3D, color: string }[]} items built models, each centered and on the ground
 * @param {{ width?: number, height?: number, gap?: number, caption?: number, dpr?: number, ink?: string, faint?: string }} [opts]
 *   sizes in CSS pixels. width is the room for the side and front views next to each other; the top view
 *   goes under the side view, and height (optional) caps the whole sheet including one caption per row.
 * @returns {{ side: HTMLCanvasElement, top: HTMLCanvasElement, front: HTMLCanvasElement, pxPerM: number }}
 */
export function silhouettes(items, opts = {}) {
  const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
  const width = (opts.width ?? 880) * dpr;
  const measured = items.map(it => ({ ...it, ...measure(it.obj) }));
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
    // Later models first, so the first model's outline sits on top.
    for (const it of [...measured].reverse()) {
      g.drawImage(layer(mask(it.obj, view === 'front' ? 0 : it.shift, view, e, pxPerM, w, h), w, h, it.color, Math.max(1, Math.round(dpr))), 0, 0);
    }
    // Ground line under the side and front views, and a scale bar.
    g.strokeStyle = opts.faint ?? '#75839a';
    g.fillStyle = opts.faint ?? '#75839a';
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
