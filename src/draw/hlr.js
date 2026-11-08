// Hidden-line projection of a three.js object into orthographic views, as exact vectors.
//
// Lines come from the geometry itself, never from traced pixels:
//   silhouettes  mesh edges between a face turned toward the viewer and one turned away
//   creases      edges where the surface folds by more than a threshold (trailing edges, panel cuts)
//   boundaries   edges of open surfaces (window panes, sheet parts)
//   intersections where two parts pass through each other (wing roots, fin roots, pylons)
//   surface lines polylines a builder attaches to a mesh (userData.drawLines): doors, windows
// Each candidate line is clipped to its visible stretches with a depth buffer, so the
// output keeps exact 3D positions and only the visibility cut points are sampled.
import * as THREE from 'three';

/** Orthographic views: 2D x to the right, y down, depth larger toward the viewer. */
export const VIEWS = {
  side: { label: 'Side', project: (x, y, z) => [x, -y, z], toward: [0, 0, 1] }, // from the left, nose to the left
  top: { label: 'Top', project: (x, y, z) => [x, z, y], toward: [0, 1, 0] }, // from above, nose to the left, left wing down
  front: { label: 'Front', project: (x, y, z) => [z, -y, -x], toward: [-1, 0, 0] }, // facing the nose, left wing on the right
};

const CREASE = Math.cos(THREE.MathUtils.degToRad(40));

/**
 * Collect the drawable meshes of an object as world-space triangle soups with welded
 * topology. Interior parts and hidden meshes are left out.
 */
export function collect(obj, { skipSystems = ['interior'] } = {}) {
  obj.updateMatrixWorld(true);
  const meshes = [];
  const v = new THREE.Vector3();
  obj.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    let part = o; while (part && !part.userData.part) part = part.parent;
    const system = part?.userData.system ?? 'structure';
    if (skipSystems.includes(system)) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    // Weld coincident vertices (UV seams, split normals) so creases and silhouettes see one surface.
    const ids = new Map(), verts = [], tris = [];
    const vid = i => {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const k = `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
      let id = ids.get(k);
      if (id === undefined) { id = verts.length / 3; ids.set(k, id); verts.push(v.x, v.y, v.z); }
      return id;
    };
    for (let i = 0; i + 2 < n; i += 3) {
      const a = vid(idx ? idx.getX(i) : i), b = vid(idx ? idx.getX(i + 1) : i + 1), c = vid(idx ? idx.getX(i + 2) : i + 2);
      if (a !== b && b !== c && a !== c) tris.push(a, b, c);
    }
    if (!tris.length) return;
    const lines = (o.userData.drawLines ?? []).map(l => l.map(p => v.set(p[0], p[1], p[2]).applyMatrix4(o.matrixWorld).toArray()));
    meshes.push(prepare({ part: part?.userData.id ?? o.name, system, verts: new Float64Array(verts), tris: new Uint32Array(tris), lines }));
  });
  return meshes;
}

/** Face normals, bounds and the edge list (with the faces on each side) of one mesh. */
function prepare(m) {
  const { verts: P, tris: T } = m;
  const nf = T.length / 3;
  const fn = new Float64Array(nf * 3);
  const keep = new Uint8Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) continue;
    keep[f] = 1;
    fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l;
  }
  const edges = new Map();
  for (let f = 0; f < nf; f++) {
    if (!keep[f]) continue;
    for (let k = 0; k < 3; k++) {
      const a = T[f * 3 + k], b = T[f * 3 + ((k + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const e = edges.get(key);
      if (e) e.push(f); else edges.set(key, [f]);
    }
  }
  // Edge records: [a, b, f1, f2 (-1 when open), kind] where kind 1 = always drawn
  // (crease, boundary, non-manifold) and 0 = drawn only as a silhouette.
  const list = [];
  for (const [key, fs] of edges) {
    const a = Math.floor(key / 4294967296), b = key % 4294967296;
    if (fs.length !== 2) { list.push([a, b, fs[0], -1, 1]); continue; }
    const [f1, f2] = fs;
    const dot = fn[f1 * 3] * fn[f2 * 3] + fn[f1 * 3 + 1] * fn[f2 * 3 + 1] + fn[f1 * 3 + 2] * fn[f2 * 3 + 2];
    list.push([a, b, f1, f2, dot < CREASE ? 1 : 0]);
  }
  const box = new THREE.Box3();
  for (let i = 0; i < P.length; i += 3) box.expandByPoint(new THREE.Vector3(P[i], P[i + 1], P[i + 2]));
  return { ...m, fn, keep, edges: list, box };
}

/** Bounds of all meshes, in world space. */
export function bounds(meshes) {
  const box = new THREE.Box3();
  for (const m of meshes) box.union(m.box);
  return box;
}

// ── Part intersections ───────────────────────────────────────────────────────

/** Segment where two triangles cross, or null. Coplanar and touching pairs give null. */
function triTri(P, a, b, c, Q, d, e, f) {
  const plane = (X, i, j, k) => {
    const ux = X[j] - X[i], uy = X[j + 1] - X[i + 1], uz = X[j + 2] - X[i + 2];
    const wx = X[k] - X[i], wy = X[k + 1] - X[i + 1], wz = X[k + 2] - X[i + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l, -(nx * X[i] + ny * X[i + 1] + nz * X[i + 2]) / l];
  };
  const dist = (pl, X, i) => pl[0] * X[i] + pl[1] * X[i + 1] + pl[2] * X[i + 2] + pl[3];
  const p2 = plane(Q, d, e, f);
  const da = dist(p2, P, a), db = dist(p2, P, b), dc = dist(p2, P, c);
  const E = 1e-7;
  if ((da > E && db > E && dc > E) || (da < -E && db < -E && dc < -E)) return null;
  const p1 = plane(P, a, b, c);
  const dd = dist(p1, Q, d), de = dist(p1, Q, e), df = dist(p1, Q, f);
  if ((dd > E && de > E && df > E) || (dd < -E && de < -E && df < -E)) return null;
  if (Math.abs(da) < E && Math.abs(db) < E && Math.abs(dc) < E) return null; // coplanar
  const cross = (X, ids, ds) => {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const i = ids[k], j = ids[(k + 1) % 3], di = ds[k], dj = ds[(k + 1) % 3];
      if (Math.abs(di) < E) pts.push([X[i], X[i + 1], X[i + 2]]);
      else if ((di > E && dj < -E) || (di < -E && dj > E)) {
        const t = di / (di - dj);
        pts.push([X[i] + (X[j] - X[i]) * t, X[i + 1] + (X[j + 1] - X[i + 1]) * t, X[i + 2] + (X[j + 2] - X[i + 2]) * t]);
      }
    }
    return pts.length >= 2 ? [pts[0], pts[1]] : null;
  };
  const s1 = cross(P, [a, b, c], [da, db, dc]);
  const s2 = cross(Q, [d, e, f], [dd, de, df]);
  if (!s1 || !s2) return null;
  const D = [p1[1] * p2[2] - p1[2] * p2[1], p1[2] * p2[0] - p1[0] * p2[2], p1[0] * p2[1] - p1[1] * p2[0]];
  const t = p => p[0] * D[0] + p[1] * D[1] + p[2] * D[2];
  let [a0, a1] = s1, [b0, b1] = s2;
  if (t(a0) > t(a1)) [a0, a1] = [a1, a0];
  if (t(b0) > t(b1)) [b0, b1] = [b1, b0];
  const lo = t(a0) > t(b0) ? a0 : b0, hi = t(a1) < t(b1) ? a1 : b1;
  if (t(hi) - t(lo) < 1e-6) return null;
  return [lo, hi];
}

/** Intersection curves between meshes of different parts, as 3D segments. */
export function intersections(meshes) {
  const segs = [];
  const triBox = (m, f) => {
    const P = m.verts, T = m.tris;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const i = T[f * 3 + k] * 3;
      x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
      y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]);
      z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
    }
    return [x0, y0, z0, x1, y1, z1];
  };
  for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) {
    const A = meshes[i], B = meshes[j];
    if (A.part === B.part) continue;
    const ov = A.box.clone().intersect(B.box);
    if (ov.isEmpty()) continue;
    ov.expandByScalar(1e-4);
    const inside = (m) => {
      const out = [];
      for (let f = 0; f < m.tris.length / 3; f++) {
        if (!m.keep[f]) continue;
        const b = triBox(m, f);
        if (b[3] < ov.min.x || b[0] > ov.max.x || b[4] < ov.min.y || b[1] > ov.max.y || b[5] < ov.min.z || b[2] > ov.max.z) continue;
        out.push([f, b]);
      }
      return out;
    };
    const ta = inside(A), tb = inside(B);
    if (!ta.length || !tb.length) continue;
    // Uniform grid over the overlap box, sized to the B triangles it holds.
    const size = ov.getSize(new THREE.Vector3());
    const cell = Math.max(Math.cbrt((size.x * size.y * size.z) / Math.max(tb.length, 1)) * 1.5, 1e-3);
    const nx = Math.max(1, Math.ceil(size.x / cell)), ny = Math.max(1, Math.ceil(size.y / cell)), nz = Math.max(1, Math.ceil(size.z / cell));
    const ci = (v, o, n) => Math.min(n - 1, Math.max(0, Math.floor((v - o) / cell)));
    const grid = new Map();
    for (const [f, b] of tb) {
      for (let x = ci(b[0], ov.min.x, nx); x <= ci(b[3], ov.min.x, nx); x++)
        for (let y = ci(b[1], ov.min.y, ny); y <= ci(b[4], ov.min.y, ny); y++)
          for (let z = ci(b[2], ov.min.z, nz); z <= ci(b[5], ov.min.z, nz); z++) {
            const k = (x * ny + y) * nz + z;
            const c = grid.get(k); if (c) c.push(f); else grid.set(k, [f]);
          }
    }
    const stamp = new Int32Array(B.tris.length / 3).fill(-1);
    for (const [fa, b] of ta) {
      for (let x = ci(b[0], ov.min.x, nx); x <= ci(b[3], ov.min.x, nx); x++)
        for (let y = ci(b[1], ov.min.y, ny); y <= ci(b[4], ov.min.y, ny); y++)
          for (let z = ci(b[2], ov.min.z, nz); z <= ci(b[5], ov.min.z, nz); z++) {
            for (const fb of grid.get((x * ny + y) * nz + z) ?? []) {
              if (stamp[fb] === fa) continue;
              stamp[fb] = fa;
              const s = triTri(A.verts, A.tris[fa * 3] * 3, A.tris[fa * 3 + 1] * 3, A.tris[fa * 3 + 2] * 3,
                B.verts, B.tris[fb * 3] * 3, B.tris[fb * 3 + 1] * 3, B.tris[fb * 3 + 2] * 3);
              if (s) segs.push(s);
            }
          }
    }
  }
  return segs;
}

// ── Projection with hidden-line removal ──────────────────────────────────────

/**
 * Project the meshes into one view.
 * @param {ReturnType<typeof collect>} meshes
 * @param {keyof VIEWS} name
 * @param {{ ppm?: number, extra?: number[][][] }} [opts] ppm: depth buffer pixels per
 *   meter; extra: additional 3D segments to draw (part intersections)
 * @returns {{ outline: number[][][], detail: number[][][], box: { x0: number, y0: number, x1: number, y1: number } }}
 *   polylines in view coordinates (meters, y down)
 */
export function projectView(meshes, name, opts = {}) {
  const view = VIEWS[name];
  const pr = view.project;
  const [tx, ty, tz] = view.toward;
  // View bounds from all vertices.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.verts.length; i += 3) {
    const [x, y] = pr(m.verts[i], m.verts[i + 1], m.verts[i + 2]);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const ppm = opts.ppm ?? 4096 / Math.max(x1 - x0, y1 - y0);
  const pad = 3;
  const W = Math.ceil((x1 - x0) * ppm) + pad * 2, H = Math.ceil((y1 - y0) * ppm) + pad * 2;
  const PX = x => (x - x0) * ppm + pad, PY = y => (y - y0) * ppm + pad;

  // Depth buffer.
  const zb = new Float32Array(W * H).fill(-Infinity);
  for (const m of meshes) {
    const P = m.verts, T = m.tris;
    const q = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const [x, y, z] = pr(P[i], P[i + 1], P[i + 2]);
      q[i] = PX(x); q[i + 1] = PY(y); q[i + 2] = z;
    }
    for (let f = 0; f < T.length / 3; f++) {
      if (!m.keep[f]) continue;
      const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
      rasterTri(zb, W, H, q[a], q[a + 1], q[a + 2], q[b], q[b + 1], q[b + 2], q[c], q[c + 1], q[c + 2]);
    }
  }
  // The farthest depth among each pixel's neighbors: a line on a surface is tested
  // against the surface beside it, not against the nearer slope of a curved silhouette.
  const zf = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      const d = xx < 0 || yy < 0 || xx >= W || yy >= H ? -Infinity : zb[yy * W + xx];
      if (d < m) m = d;
    }
    zf[y * W + x] = m;
  }
  const eps = 2.5 / ppm + 0.004;
  const visible = (px, py, z) => {
    const ix = Math.floor(px), iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return true;
    return z >= zf[iy * W + ix] - eps;
  };
  const empty = (px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return true;
    return zb[iy * W + ix] === -Infinity;
  };

  const outline = [], detail = [];
  // Clip one 3D segment to its visible stretches and file them as outline or detail.
  const segment = (A, B, maybeOutline) => {
    const a = pr(A[0], A[1], A[2]), b = pr(B[0], B[1], B[2]);
    const ax = PX(a[0]), ay = PY(a[1]), bx = PX(b[0]), by = PY(b[1]);
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / 0.5));
    let start = -1;
    const emit = (t0, t1) => {
      if (t1 <= t0) return;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      let out = false;
      if (maybeOutline && len > 1e-6) {
        // Outline when there is nothing on one side of the line (2 px away).
        const tm = (t0 + t1) / 2, mx = ax + (bx - ax) * tm, my = ay + (by - ay) * tm;
        const nx = -(by - ay) / len * 2, ny = (bx - ax) / len * 2;
        out = empty(mx + nx, my + ny) || empty(mx - nx, my - ny);
      }
      (out ? outline : detail).push([p0, p1]);
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const vis = visible(ax + (bx - ax) * t, ay + (by - ay) * t, a[2] + (b[2] - a[2]) * t);
      if (vis && start < 0) start = t;
      if (!vis && start >= 0) { emit(start, Math.max(start, t - 0.5 / n)); start = -1; }
    }
    if (start >= 0) emit(start, 1);
  };

  for (const m of meshes) {
    const P = m.verts, fn = m.fn;
    const pt = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    for (const [a, b, f1, f2, kind] of m.edges) {
      let draw = kind === 1, sil = f2 < 0;
      if (!draw) {
        const d1 = fn[f1 * 3] * tx + fn[f1 * 3 + 1] * ty + fn[f1 * 3 + 2] * tz;
        const d2 = fn[f2 * 3] * tx + fn[f2 * 3 + 1] * ty + fn[f2 * 3 + 2] * tz;
        sil = draw = d1 * d2 < 0;
      }
      if (draw) segment(pt(a), pt(b), sil || kind === 1);
    }
    // Surface lines (windows, doors) only where they face the viewer: seen edge-on they
    // collapse into dashes that a draftsman would leave out.
    // For a closed outline the ratio of projected to true area is the cosine of the
    // viewing angle; below 0.5 (more than 60 degrees off) it is left out.
    for (const line of m.lines) {
      const c = [0, 0, 0];
      let a2 = 0;
      for (let i = 0; i + 1 < line.length; i++) {
        const [a, b] = [line[i], line[i + 1]];
        c[0] += a[1] * b[2] - a[2] * b[1]; c[1] += a[2] * b[0] - a[0] * b[2]; c[2] += a[0] * b[1] - a[1] * b[0];
        const p = pr(...a), q = pr(...b);
        a2 += p[0] * q[1] - p[1] * q[0];
      }
      const a3 = Math.hypot(...c);
      if (a3 > 1e-9 && Math.abs(a2) < a3 * 0.5) continue;
      for (let i = 0; i + 1 < line.length; i++) segment(line[i], line[i + 1], false);
    }
  }
  for (const [A, B] of opts.extra ?? []) segment(A, B, false);

  return { outline: chain(outline), detail: chain(detail), box: { x0, y0, x1, y1 } };
}

function rasterTri(zb, W, H, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-12) return;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
      const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * az + l2 * bz + l3 * cz;
      const k = y * W + x;
      if (z > zb[k]) zb[k] = z;
    }
  }
}

/** Join 2D segments that share end points into polylines. */
export function chain(segs) {
  const key = p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const p of s) { const k = key(p); const l = adj.get(k); if (l) l.push(i); else adj.set(k, [i]); }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  const walk = (line, k) => {
    for (;;) {
      const next = (adj.get(k) ?? []).find(i => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const s = segs[next];
      const p = key(s[0]) === k ? s[1] : s[0];
      line.push(p);
      k = key(p);
    }
  };
  // Start from open ends first so open polylines come out whole.
  const order = [...segs.keys()].sort((i, j) => {
    const deg = s => Math.min(adj.get(key(s[0])).length, adj.get(key(s[1])).length);
    return deg(segs[i]) - deg(segs[j]);
  });
  for (const i of order) {
    if (used[i]) continue;
    used[i] = 1;
    const fwd = [segs[i][0], segs[i][1]];
    walk(fwd, key(segs[i][1]));
    const back = [segs[i][0]];
    walk(back, key(segs[i][0]));
    lines.push([...back.slice(1).reverse(), ...fwd]);
  }
  return lines;
}

/** Ramer-Douglas-Peucker simplification, keeping closed loops closed. */
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const closed = Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9;
  if (closed) {
    let far = 0, best = -1;
    pts.forEach((q, i) => { const d = Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]); if (d > best) { best = d; far = i; } });
    if (far === 0) return pts;
    return [...rdp(pts.slice(0, far + 1), eps).slice(0, -1), ...rdp(pts.slice(far), eps)];
  }
  return rdp(pts, eps);
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, ay] = pts[i0], [bx, by] = pts[i1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = len < 1e-12 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) { best = d; at = i; }
    }
    if (best > eps) { keep[at] = 1; stack.push([i0, at], [at, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Cut the meshes of the given parts with the plane x = X; returns polylines in (z, y). */
export function section(meshes, parts, X) {
  const segs = [];
  for (const m of meshes) {
    if (!parts.includes(m.part)) continue;
    if (X < m.box.min.x || X > m.box.max.x) continue;
    const P = m.verts, T = m.tris;
    for (let f = 0; f < T.length / 3; f++) {
      if (!m.keep[f]) continue;
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const i = T[f * 3 + k] * 3, j = T[f * 3 + ((k + 1) % 3)] * 3;
        const di = P[i] - X, dj = P[j] - X;
        if ((di <= 0 && dj > 0) || (di > 0 && dj <= 0)) {
          const t = di / (di - dj);
          pts.push([P[i + 2] + (P[j + 2] - P[i + 2]) * t, P[i + 1] + (P[j + 1] - P[i + 1]) * t]);
        }
      }
      if (pts.length === 2) segs.push(pts);
    }
  }
  return chain(segs);
}
