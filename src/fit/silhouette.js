// Silhouette agreement between two objects in the three orthographic views: the
// overlap (intersection over union) of their filled outlines, rasterized on a common
// grid. Used to score a converted or fitted model against its source.
import * as THREE from 'three';
import { VIEWS } from '../draw/hlr.js';

function triangles(obj) {
  obj.updateMatrixWorld(true);
  const out = [];
  const v = new THREE.Vector3();
  obj.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    let part = o; while (part && !part.userData.part) part = part.parent;
    if (part?.userData.system === 'interior') return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  return new Float64Array(out);
}

function mask(tris, view, box, ppm, W, H) {
  const m = new Uint8Array(W * H);
  const pr = VIEWS[view].project;
  for (let i = 0; i < tris.length; i += 9) {
    const p = [0, 3, 6].map(k => { const [x, y] = pr(tris[i + k], tris[i + k + 1], tris[i + k + 2]); return [(x - box.x0) * ppm, (y - box.y0) * ppm]; });
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const a = ((p[1][1] - p[2][1]) * (x + 0.5 - p[2][0]) + (p[2][0] - p[1][0]) * (y + 0.5 - p[2][1])) / d;
      const b = ((p[2][1] - p[0][1]) * (x + 0.5 - p[2][0]) + (p[0][0] - p[2][0]) * (y + 0.5 - p[2][1])) / d;
      if (a >= 0 && b >= 0 && a + b <= 1) m[y * W + x] = 1;
    }
  }
  return m;
}

/**
 * Overlap of a and b in each view, after placing both with the nose at x = 0, the
 * lowest point at y = 0 and the centerline at z = 0.
 * @returns {{ side: number, top: number, front: number }}
 */
export function compareSilhouettes(a, b, { px = 1600 } = {}) {
  const norm = obj => {
    const t = triangles(obj);
    let x0 = Infinity, y0 = Infinity;
    for (let i = 0; i < t.length; i += 3) { x0 = Math.min(x0, t[i]); y0 = Math.min(y0, t[i + 1]); }
    for (let i = 0; i < t.length; i += 3) { t[i] -= x0; t[i + 1] -= y0; }
    return t;
  };
  const ta = norm(a), tb = norm(b);
  const out = {};
  for (const view of ['side', 'top', 'front']) {
    const pr = VIEWS[view].project;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of [ta, tb]) for (let i = 0; i < t.length; i += 3) {
      const [x, y] = pr(t[i], t[i + 1], t[i + 2]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const ppm = px / Math.max(x1 - x0, y1 - y0);
    const W = Math.ceil((x1 - x0) * ppm) + 1, H = Math.ceil((y1 - y0) * ppm) + 1;
    const box = { x0, y0 };
    const ma = mask(ta, view, box, ppm, W, H), mb = mask(tb, view, box, ppm, W, H);
    let inter = 0, uni = 0;
    for (let k = 0; k < ma.length; k++) { inter += ma[k] & mb[k]; uni += ma[k] | mb[k]; }
    out[view] = Math.round((inter / uni) * 1000) / 1000;
  }
  return out;
}
