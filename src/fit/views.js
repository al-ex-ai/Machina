// Three orthographic silhouettes at one scale, in meters: what a fitter sees of an
// aircraft, whether they come from a mesh (the round trip) or from a drawing.
//
// Frame: x from the nose aft, y up from the ground, z to the left of the centerline.
//   side   columns x, rows y
//   top    columns x, rows z
//   front  columns z, rows y
// A mask keeps a margin around the aircraft so outlines never touch its border.
import * as THREE from 'three';

export const PLANES = {
  side: { u: 0, v: 1 },
  top: { u: 0, v: 2 },
  front: { u: 2, v: 1 },
};

export class Mask {
  /** @param {number} u0 world u of the left edge @param {number} v0 world v of the bottom edge */
  constructor(w, h, ppm, u0, v0, data = new Uint8Array(w * h)) {
    this.w = w; this.h = h; this.ppm = ppm; this.u0 = u0; this.v0 = v0; this.data = data;
  }
  at(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h ? this.data[j * this.w + i] : 0; }
  /** World coordinate of a column or row center. */
  U(i) { return this.u0 + (i + 0.5) / this.ppm; }
  V(j) { return this.v0 + (j + 0.5) / this.ppm; }
  /** Column or row holding a world coordinate. */
  I(u) { return Math.floor((u - this.u0) * this.ppm); }
  J(v) { return Math.floor((v - this.v0) * this.ppm); }
  solid(u, v) { return this.at(this.I(u), this.J(v)) === 1; }
  /** Solid runs [v0, v1] (world) in the column at u, bottom to top. */
  runsV(u) {
    const i = this.I(u), out = [];
    if (i < 0 || i >= this.w) return out;
    let a = -1;
    for (let j = 0; j <= this.h; j++) {
      const s = j < this.h && this.data[j * this.w + i];
      if (s && a < 0) a = j;
      if (!s && a >= 0) { out.push([this.v0 + a / this.ppm, this.v0 + j / this.ppm]); a = -1; }
    }
    return out;
  }
  /** Solid runs [u0, u1] (world) in the row at v, left to right. */
  runsU(v) {
    const j = this.J(v), out = [];
    if (j < 0 || j >= this.h) return out;
    let a = -1;
    for (let i = 0; i <= this.w; i++) {
      const s = i < this.w && this.data[j * this.w + i];
      if (s && a < 0) a = i;
      if (!s && a >= 0) { out.push([this.u0 + a / this.ppm, this.u0 + i / this.ppm]); a = -1; }
    }
    return out;
  }
  bounds() {
    let i0 = this.w, i1 = -1, j0 = this.h, j1 = -1;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) if (this.data[j * this.w + i]) {
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    return { u0: this.u0 + i0 / this.ppm, u1: this.u0 + (i1 + 1) / this.ppm, v0: this.v0 + j0 / this.ppm, v1: this.v0 + (j1 + 1) / this.ppm };
  }
  clone() { return new Mask(this.w, this.h, this.ppm, this.u0, this.v0, this.data.slice()); }
}

/**
 * Helper geometry in simulator models (light cones, shadow strips) can be triangles
 * meters long and millimeters wide that join a wing tip to the tail. No skin triangle
 * looks like that: longer than 3 m with a height under 2 cm.
 */
function sliver(t) {
  const e = [[0, 3], [3, 6], [6, 0]].map(([i, j]) => Math.hypot(t[j] - t[i], t[j + 1] - t[i + 1], t[j + 2] - t[i + 2]));
  const long = Math.max(...e);
  if (long < 3) return false;
  const [a, b, c] = e, s = (a + b + c) / 2;
  return (2 * Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)))) / long < 0.02;
}

/** World-space triangles of an object as a flat array, without interior parts and hidden meshes. */
export function trianglesOf(obj) {
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
    for (let i = 0; i + 2 < n; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); t.push(v.x, v.y, v.z); }
      if (!sliver(t)) out.push(...t);
    }
  });
  // Nose at x = 0, lowest point at y = 0. Built objects are already centered on z.
  let x0 = Infinity, y0 = Infinity;
  for (let i = 0; i < out.length; i += 3) { if (out[i] < x0) x0 = out[i]; if (out[i + 1] < y0) y0 = out[i + 1]; }
  const t = new Float64Array(out);
  for (let i = 0; i < t.length; i += 3) { t[i] -= x0; t[i + 1] -= y0; }
  return t;
}

/** Extent of a triangle array: length, height and half span. */
export function extent(tris) {
  let L = 0, H = 0, S = 0;
  for (let i = 0; i < tris.length; i += 3) { if (tris[i] > L) L = tris[i]; if (tris[i + 1] > H) H = tris[i + 1]; const a = Math.abs(tris[i + 2]); if (a > S) S = a; }
  return { L, H, S };
}

/** An empty mask for one view of an aircraft of the given extent. */
export function blank(view, { L, H, S }, ppm, margin = 0.5) {
  const m = margin;
  if (view === 'side') return new Mask(Math.ceil((L + 2 * m) * ppm), Math.ceil((H + 2 * m) * ppm), ppm, -m, -m);
  if (view === 'top') return new Mask(Math.ceil((L + 2 * m) * ppm), Math.ceil((2 * S + 2 * m) * ppm), ppm, -m, -S - m);
  return new Mask(Math.ceil((2 * S + 2 * m) * ppm), Math.ceil((H + 2 * m) * ppm), ppm, -S - m, -m);
}

/** Fill the triangles' projection into a mask. */
export function raster(tris, view, mask) {
  const { u, v } = PLANES[view];
  const { w, h, ppm, u0, v0, data } = mask;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = (tris[i + u] - u0) * ppm, ay = (tris[i + v] - v0) * ppm;
    const bx = (tris[i + 3 + u] - u0) * ppm, by = (tris[i + 3 + v] - v0) * ppm;
    const cx = (tris[i + 6 + u] - u0) * ppm, cy = (tris[i + 6 + v] - v0) * ppm;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const p = ((by - cy) * (x + 0.5 - cx) + (cx - bx) * (y + 0.5 - cy)) / d;
      const q = ((cy - ay) * (x + 0.5 - cx) + (ax - cx) * (y + 0.5 - cy)) / d;
      if (p >= 0 && q >= 0 && p + q <= 1) data[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Fill everything the outside cannot reach. A silhouette has no holes: a drawing's is
 * what its outline encloses, and a mesh with see-through windows or an open door
 * should read the same way.
 */
export function fill(mask) {
  const { w, h, data } = mask;
  const out = new Uint8Array(w * h).fill(1), stack = [];
  const seed = k => { if (!data[k] && out[k]) { out[k] = 0; stack.push(k); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const k = stack.pop(), x = k % w;
    if (x > 0) seed(k - 1); if (x < w - 1) seed(k + 1);
    if (k >= w) seed(k - w); if (k < w * (h - 1)) seed(k + w);
  }
  mask.data = out;
  return mask;
}

/**
 * The three silhouettes of a built object.
 * @returns {{ L: number, H: number, S: number, ppm: number, side: Mask, top: Mask, front: Mask }}
 */
export function targetOf(obj, { ppm = 40, frame } = {}) {
  const tris = trianglesOf(obj);
  const e = frame ?? extent(tris);
  const t = { L: e.L, H: e.H, S: e.S, ppm };
  for (const view of ['side', 'top', 'front']) t[view] = fill(raster(tris, view, blank(view, e, ppm)));
  return t;
}

// ── Scoring ────────────────────────────────────────────────────────────────

/** Squared distance to the nearest set pixel, exact (Felzenszwalb and Huttenlocher). */
function distance2(seed, w, h) {
  const INF = 1e12;
  const f = new Float64Array(w * h);
  for (let k = 0; k < w * h; k++) f[k] = seed[k] ? 0 : INF;
  const n = Math.max(w, h);
  const d = new Float64Array(n), g = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  const pass = len => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) { s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) g[y] = f[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[x] = f[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) f[y * w + x] = d[x];
  }
  return f;
}

/** Outline pixels: solid with an empty 4-neighbor. */
function outline(m) {
  const { w, h, data } = m, o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (data[k] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !data[k - 1] || !data[k + 1] || !data[k - w] || !data[k + w])) o[k] = 1;
  }
  return o;
}

/**
 * How far apart two silhouettes are. Overlap (intersection over union) says how much
 * area agrees; the outline distances say how far a point on one outline is from the
 * other, in meters, which is what a blunted nose or a missing leg shows up in.
 * @returns {{ iou: number, mean: number, p95: number, max: number, worst: [number, number] }}
 */
export function compareMasks(a, b) {
  const { w, h } = a;
  let inter = 0, uni = 0;
  for (let k = 0; k < w * h; k++) { inter += a.data[k] & b.data[k]; uni += a.data[k] | b.data[k]; }
  const oa = outline(a), ob = outline(b);
  const da = distance2(oa, w, h), db = distance2(ob, w, h);
  const ds = [];
  let max = 0, worst = 0;
  for (let k = 0; k < w * h; k++) {
    if (oa[k]) { const d = Math.sqrt(db[k]); ds.push(d); if (d > max) { max = d; worst = k; } }
    if (ob[k]) { const d = Math.sqrt(da[k]); ds.push(d); if (d > max) { max = d; worst = k; } }
  }
  ds.sort((p, q) => p - q);
  const r = v => Math.round((v / a.ppm) * 1000) / 1000;
  return {
    iou: Math.round((inter / (uni || 1)) * 1000) / 1000,
    mean: r(ds.reduce((s, v) => s + v, 0) / (ds.length || 1)),
    p95: r(ds[Math.floor(ds.length * 0.95)] ?? 0),
    max: r(max),
    worst: [Math.round(a.U(worst % w) * 100) / 100, Math.round(a.V(Math.floor(worst / w)) * 100) / 100],
  };
}

/** Score a built object against a target, view by view, on the target's own grid. */
export function score(target, obj) {
  const tris = trianglesOf(obj);
  const out = {};
  for (const view of ['side', 'top', 'front']) {
    if (!target[view]) continue;
    const t = target[view];
    out[view] = compareMasks(t, fill(raster(tris, view, new Mask(t.w, t.h, t.ppm, t.u0, t.v0))));
  }
  return out;
}

/** Overlay as RGBA: gray where both agree, red only in the target, blue only in the model. */
export function overlay(a, b) {
  const { w, h } = a, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = a.data[y * w + x], q = b.data[y * w + x];
    const c = p && q ? [150, 156, 166] : p ? [226, 60, 60] : q ? [50, 110, 230] : [255, 255, 255];
    data.set([...c, 255], ((h - 1 - y) * w + x) * 4); // rows run upward in a mask, downward in an image
  }
  return { width: w, height: h, data };
}
