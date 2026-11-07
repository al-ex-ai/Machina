// Reusable procedural geometry. All lengths are meters.
import * as THREE from 'three';
import { deg } from './common.js';

/**
 * Body of revolution along +x from stations [[x, radius], ...].
 * Optional vertical scale makes the cross-section elliptical.
 */
export function bodyOfRevolution(stations, { segments = 40, heightScale = 1 } = {}) {
  const pts = stations.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.0001), x));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateZ(-Math.PI / 2); // lathe axis y -> x
  if (heightScale !== 1) geo.scale(1, heightScale, 1);
  return geo;
}

/**
 * Fuselage stations: rounded nose, constant section, tapered tail.
 * @param {{ length: number, diameter: number, noseLength?: number, tailLength?: number, tailEndRatio?: number, noseBluntness?: number }} f
 */
export function fuselageStations(f) {
  const R = f.diameter / 2;
  const L = f.length;
  const nose = f.noseLength ?? f.diameter * 1.6;
  const tail = f.tailLength ?? f.diameter * 2.6;
  const endR = R * (f.tailEndRatio ?? 0.12);
  const blunt = f.noseBluntness ?? 0.5; // 0 = pointed, 1 = hemispherical
  const st = [[0, 0]];
  const n = 14;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const ell = Math.sqrt(1 - (1 - t) ** 2);
    const cone = t;
    st.push([nose * t, R * (blunt * ell + (1 - blunt) * cone)]);
  }
  st.push([L - tail, R]);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    st.push([L - tail + tail * t, endR + (R - endR) * (1 - t ** 1.6)]);
  }
  st.push([L, 0]);
  return st;
}

/** Bend the tail section upward so the tail cone sweeps up, as on airliners. */
export function applyTailUpsweep(geo, { length, tailLength, rise }) {
  if (!rise) return geo;
  const pos = geo.attributes.position;
  const start = length - tailLength;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x > start) {
      const t = (x - start) / tailLength;
      pos.setY(i, pos.getY(i) + rise * t * t);
    }
  }
  pos.needsUpdate = true;
  return geo;
}

function airfoil(n, thickness) {
  // Symmetric NACA 00xx with cosine spacing. Returns closed loop of [x, y] in chord units.
  const upper = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    upper.push([x, yt]);
  }
  const lower = upper.slice(1, -1).reverse().map(([x, y]) => [x, -y]);
  return [...upper, ...lower];
}

/**
 * Tapered, swept lifting surface (wing, tailplane or fin).
 * Root section sits at the origin with its leading edge at x = 0.
 * @param {{ span: number, rootChord: number, tipChord: number, sweepDeg?: number, dihedralDeg?: number, thickness?: number, vertical?: boolean, side?: 1|-1 }} w
 *   span is the length of THIS surface from root to tip. side +1 builds toward +z (left), -1 toward -z.
 */
export function liftingSurface(w) {
  const side = w.side ?? 1;
  const loop = airfoil(16, w.thickness ?? 0.12);
  const m = loop.length;
  const sweep = Math.tan(deg(w.sweepDeg ?? 0));
  const dihedral = Math.tan(deg(w.dihedralDeg ?? 0));
  const sections = [
    { chord: w.rootChord, le: 0, s: 0, rise: 0 },
    { chord: w.tipChord, le: w.span * sweep, s: w.span, rise: w.span * dihedral },
  ];
  const positions = [];
  for (const sec of sections) {
    for (const [cx, cy] of loop) {
      const x = sec.le + cx * sec.chord;
      const thick = cy * sec.chord;
      if (w.vertical) positions.push(x, sec.s, thick);
      else positions.push(x, thick + sec.rise, side * sec.s);
    }
  }
  const idx = [];
  for (let i = 0; i < m; i++) {
    const a = i, b = (i + 1) % m, c = m + i, d = m + ((i + 1) % m);
    idx.push(a, c, b, b, c, d);
  }
  // Caps (fan triangulation from the leading edge point).
  for (let i = 1; i < m - 1; i++) {
    idx.push(0, i + 1, i);
    idx.push(m, m + i, m + i + 1);
  }
  const flip = (!w.vertical && side < 0);
  if (flip) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(idx);
  return geo;
}

/** Cylinder whose axis runs along x, centered on the origin. */
export function cylinderX(radius, length, segments = 24, radiusEnd = radius) {
  const geo = new THREE.CylinderGeometry(radiusEnd, radius, length, segments);
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

/** Cylinder whose axis runs along z (wheels seen from the side), centered on the origin. */
export function cylinderZ(radius, width, segments = 24) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, segments);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** Extrude a side profile [[x, y], ...] across z, centered on z = 0. */
export function extrudeSide(points, width, bevel = 0) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  return geo;
}

/** Extrude a top-view outline [[x, z], ...] upward by height, base at y = 0. */
export function extrudeTop(points, height, bevel = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}

/** A continuous track loop: stadium-shaped side profile with a hollow center, extruded across z. */
export function trackLoop(length, height, width, thickness) {
  const r = height / 2;
  const outer = new THREE.Shape();
  outer.absarc(r, r, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  outer.lineTo(length - r, 0);
  outer.absarc(length - r, r, r, -Math.PI / 2, Math.PI / 2, false);
  outer.lineTo(r, height);
  const ri = r - thickness;
  const hole = new THREE.Path();
  hole.absarc(r, r, ri, Math.PI / 2, (3 * Math.PI) / 2, false);
  hole.lineTo(length - r, r - ri);
  hole.absarc(length - r, r, ri, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(r, r + ri);
  outer.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(outer, { depth: width, bevelEnabled: false, curveSegments: 12 });
  geo.translate(0, 0, -width / 2);
  return geo;
}

/** Merge several positioned geometries into one (no external utils needed). */
export function mergeGeometries(geos) {
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0.toNonIndexed();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (g.index) for (let i = 0; i < g.index.count; i++) indices.push(g.index.getX(i) + offset);
    else for (let i = 0; i < pos.count; i++) indices.push(i + offset);
    offset += pos.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  return out;
}
