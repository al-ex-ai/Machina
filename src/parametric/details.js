// Generated detail for parametric aircraft. Everything here is derived from data the
// model file already has (body profile, window belt, doors, engine and gear sizes), so
// a new aircraft gets the same detail without any per-model tuning.
import * as THREE from 'three';
import { bodyProfile, loftBody, mergeIndexed } from './body.js';

/** Indexed copy with only position and normal (normals kept), so primitives merge with mergeIndexed. */
export function plain(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', geo.attributes.position);
  out.setAttribute('normal', geo.attributes.normal);
  out.setIndex(geo.index ? [...geo.index.array] : [...Array(geo.attributes.position.count).keys()]);
  return out;
}

// ── Surface lines for drawings ─────────────────────────────────────────────

/**
 * Window and door outlines as 3D polylines on the skin, both sides, for the line
 * drawings (attached to the fuselage mesh as userData.drawLines).
 */
export function skinOutlines(body, lv) {
  const lines = [];
  const v = new THREE.Vector3();
  // Subdivide first: a long straight edge between two skin points would cut through the
  // curved body instead of following it.
  const dense = pts => pts.flatMap((p, i) => {
    if (!i) return [p];
    const q = pts[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.05));
    return Array.from({ length: n }, (_, k) => [q[0] + ((p[0] - q[0]) * (k + 1)) / n, q[1] + ((p[1] - q[1]) * (k + 1)) / n]);
  });
  const onSkin = (pts, side) => dense(pts).map(([x, y]) => {
    const t = body.thetaAt(x, y);
    body.point(x, side > 0 ? t : Math.PI * 2 - t, v);
    return [v.x, v.y, v.z];
  });
  const rounded = (cx, cy, w, h, r) => {
    const pts = [];
    const rr = Math.min(r, w / 2, h / 2);
    const corners = [[cx + w / 2 - rr, cy + h / 2 - rr, 0], [cx - w / 2 + rr, cy + h / 2 - rr, 90], [cx - w / 2 + rr, cy - h / 2 + rr, 180], [cx + w / 2 - rr, cy - h / 2 + rr, 270]];
    for (const [x, y, a0] of corners) for (let k = 0; k <= 4; k++) {
      const a = THREE.MathUtils.degToRad(a0 + k * 22.5);
      pts.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]);
    }
    pts.push(pts[0]);
    return pts;
  };
  const win = lv.windows;
  const list = win?.list ?? [];
  if (win && !win.list) for (let x = win.from; x <= win.to + 1e-6; x += win.pitch) {
    if (!win.skip?.some(([a, b]) => x > a && x < b)) list.push([x, win.y]);
  }
  for (const side of [1, -1]) {
    for (const [x, y] of list) lines.push(onSkin(rounded(x, y, win.w, win.h, win.w * 0.45), side));
    for (const d of lv.doors ?? []) {
      lines.push(onSkin(rounded(d.x, d.sill + d.h / 2, d.w, d.h, 0.08), side));
      if (d.window) lines.push(onSkin(rounded(d.x, d.sill + d.h * 0.7, 0.22, 0.3, 0.1), side));
    }
  }
  return lines;
}

// ── Engines ────────────────────────────────────────────────────────────────

/** A rounded inlet lip from the nacelle's outer edge, curling forward and into the fan duct. */
export function inletLip(nac, rDuct, fanY) {
  const S = 72, K = 12;
  const pos = [], idx = [];
  const o = new THREE.Vector3();
  const depth = rDuct * 0.18, bulge = rDuct * 0.06;
  for (let j = 0; j <= S; j++) {
    const t = (j / S) * Math.PI * 2;
    nac.point(0, t, o);
    const ix = depth, iy = fanY + rDuct * Math.cos(t), iz = rDuct * Math.sin(t);
    for (let k = 0; k <= K; k++) {
      const phi = (k / K) * Math.PI, f = (1 - Math.cos(phi)) / 2;
      pos.push(o.x + (ix - o.x) * f - bulge * Math.sin(phi), o.y + (iy - o.y) * f, o.z + (iz - o.z) * f);
    }
  }
  for (let j = 0; j < S; j++) for (let k = 0; k < K; k++) {
    const a = j * (K + 1) + k, b = a + 1, c = a + K + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Fan blades: twisted, tapered blades from the hub to the duct, pitched like a
 * turbofan's (flatter at the root, more across the flow at the tip).
 */
export function fanBlades(rFan, x, y, count = 24) {
  const geos = [];
  const N = 8, C = 4;
  const r0 = rFan * 0.33, r1 = rFan * 0.98;
  for (let b = 0; b < count; b++) {
    const th = (b / count) * Math.PI * 2;
    const R = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
    const T = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, r = r0 + (r1 - r0) * f;
      const chord = rFan * (0.3 + 0.16 * f);
      const beta = THREE.MathUtils.degToRad(30 + 32 * f); // angle from the engine axis
      const along = new THREE.Vector3(Math.cos(beta), 0, 0).addScaledVector(T, Math.sin(beta));
      for (let k = 0; k <= C; k++) {
        const c = (k / C - 0.5) * chord;
        const bow = Math.sin((k / C) * Math.PI) * chord * 0.04; // a little camber
        const p = R.clone().multiplyScalar(r).addScaledVector(along, c).addScaledVector(T, bow * Math.cos(beta)).add(new THREE.Vector3(x - bow * Math.sin(beta), y, 0));
        pos.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < C; k++) {
      const a = i * (C + 1) + k, bb = a + 1, c = a + C + 1, d = c + 1;
      idx.push(a, bb, c, bb, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    geos.push(g);
  }
  return mergeIndexed(geos);
}

/** The dark inside of the exhaust: a short lofted sleeve just inside the nacelle's trailing edge, closed deep inside. */
export function nozzleSleeve(nac, length) {
  const st = [];
  for (const f of [0, 0.5, 1]) {
    const x = length - 0.6 + 0.6 * f;
    const s = nac.at(Math.max(nac.x0, x));
    const k = 0.95;
    st.push([x, s.w * k, s.mid + (s.top - s.mid) * k, s.mid - (s.mid - s.bot) * k, s.mid]);
  }
  return loftBody(bodyProfile(st, { nTop: nac.nTop, nBot: nac.nBot }), { length, segments: 48, capEnd: false });
}

// ── Landing gear ───────────────────────────────────────────────────────────

/** A tire with three tread grooves, axis along z, centered on the origin. */
export function grooveTire(d, w) {
  const r = d / 2, k = w * 0.32;
  const pts = [new THREE.Vector2(r * 0.55, -w / 2)];
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 40;
    const z = (w / 2) * Math.sin(a) * 1.05;
    let rr = r - k + Math.cos(a) * k;
    const zn = z / (w / 2);
    if (Math.abs(a) < 0.9 && [-0.45, 0, 0.45].some(c => Math.abs(zn - c) < 0.06)) rr -= Math.min(0.012, r * 0.02);
    pts.push(new THREE.Vector2(rr, z));
  }
  pts.push(new THREE.Vector2(r * 0.55, w / 2));
  return new THREE.LatheGeometry(pts, 48).rotateX(Math.PI / 2);
}

/** A round rod between two points. */
export function rod(a, b, radius, sides = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const geo = new THREE.CylinderGeometry(radius, radius, len, sides);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  geo.applyQuaternion(q);
  const m = A.clone().add(B).multiplyScalar(0.5);
  geo.translate(m.x, m.y, m.z);
  return geo;
}

/** A flat bar between two points, its wide side facing z. */
function bar(a, b, w, t) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const geo = new THREE.BoxGeometry(A.distanceTo(B), w, t);
  geo.rotateZ(Math.atan2(B.y - A.y, B.x - A.x));
  const m = A.clone().add(B).multiplyScalar(0.5);
  geo.translate(m.x, m.y, m.z);
  return geo;
}

/**
 * Torque links (the scissor on the front of the shock strut) and a brace from the
 * upper strut toward the structure: aft for a nose gear, inboard for a main gear.
 * @param {{ x: number, strut: number, top: number }} gear
 * @param {number} axleY height of the axle
 * @param {number} z leg position
 */
export function gearLinkage(gear, axleY, z) {
  const h = gear.top - axleY;
  const lo = axleY + h * 0.12, hi = axleY + h * 0.5, mid = (lo + hi) / 2;
  const ax = gear.x - gear.strut * 0.55, apex = gear.x - gear.strut * 0.55 - h * 0.12;
  const links = mergeIndexed([
    bar([ax, lo, z], [apex, mid, z], gear.strut * 0.22, gear.strut * 0.12),
    bar([apex, mid, z], [ax, hi, z], gear.strut * 0.22, gear.strut * 0.12),
  ].map(plain));
  const from = [gear.x, axleY + h * 0.78, z];
  const to = z === 0 ? [gear.x + h * 0.55, gear.top + 0.05, z] : [gear.x + 0.05, gear.top + 0.05, z * 0.55];
  return { links, brace: rod(from, to, gear.strut * 0.2) };
}

// ── Antennas, lights and probes ────────────────────────────────────────────

/** A swept blade antenna standing on y = 0, chord along x; flip to hang it below. */
function blade(h, flip = false) {
  const s = new THREE.Shape();
  const c = h * 1.1;
  s.moveTo(0, 0); s.lineTo(c, 0); s.lineTo(c * 0.82, h); s.lineTo(c * 0.55, h); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }).translate(0, 0, -0.01);
  if (flip) geo.scale(1, -1, 1);
  return geo;
}

/**
 * Antennas, anti-collision beacons, pitot probes and the APU exhaust, placed on the
 * body profile at fixed fractions of its length.
 * @returns {{ antennas: THREE.BufferGeometry, beacons: THREE.BufferGeometry, apu: THREE.BufferGeometry|null }}
 */
export function airframeDetails(body) {
  const L = body.x1; // the fuselage's own length, from the nose at x = 0 (a tail bullet may extend the aircraft)
  const at = x => body.at(x);
  const parts = [];
  // Blade antennas: two on the crown, two under the belly.
  for (const [f, h] of [[0.34, 0.32], [0.6, 0.22]]) { const x = f * L, s = at(x); parts.push(blade(h).translate(x, s.top - 0.01, 0)); }
  for (const [f, h] of [[0.22, 0.16], [0.47, 0.18]]) { const x = f * L, s = at(x); parts.push(blade(h, true).translate(x, s.bot + 0.01, 0)); }
  // Pitot probes: two on each side of the nose, an L-shaped tube pointing forward.
  const v = new THREE.Vector3();
  const px = 0.07 * L;
  for (const side of [1, -1]) for (const dy of [0.12, -0.12]) {
    const s = at(px);
    const y = s.mid + dy;
    const t = body.thetaAt(px, y);
    body.point(px, side > 0 ? t : Math.PI * 2 - t, v);
    const out = side * 0.12;
    parts.push(rod([v.x, v.y, v.z - side * 0.02], [v.x, v.y, v.z + out], 0.012, 8));
    parts.push(rod([v.x + 0.01, v.y, v.z + out], [v.x - 0.16, v.y, v.z + out], 0.01, 8));
  }
  const antennas = mergeIndexed(parts.map(plain));
  // Beacons: red domes on the crown and the belly.
  const dome = (x, y, down) => new THREE.SphereGeometry(0.11, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.3, down ? -0.55 : 0.55, 1).translate(x, y, 0);
  const bx = 0.45 * L, ux = 0.52 * L;
  const beacons = mergeIndexed([dome(bx, at(bx).top - 0.01, false), dome(ux, at(ux).bot + 0.01, true)].map(plain));
  // APU exhaust: a dark disc on the tail cone tip when the cone ends open.
  const end = body.at(body.x1);
  const apu = end.w > 0.04 ? plain(new THREE.CircleGeometry(1, 28).scale(1, (end.top - end.bot) / 2 * 0.75, end.w * 0.75).rotateY(Math.PI / 2).translate(body.x1 + 0.003, end.mid, 0)) : null;
  return { antennas, beacons, apu };
}

// ── Propellers and struts ───────────────────────────────────────────────────

/**
 * A propeller turning about the x axis: a spinner and twisted, tapered blades, sized
 * from the measured disc. spec: { x, y, z, diameter, blades, spinner: { length, radius } }
 */
export function propeller(spec) {
  const R = spec.diameter / 2, n = spec.blades ?? 2;
  const sr = spec.spinner?.radius ?? R * 0.13, sl = spec.spinner?.length ?? R * 0.42;
  const spinner = new THREE.LatheGeometry(
    Array.from({ length: 13 }, (_, i) => { const f = i / 12; return new THREE.Vector2(sr * Math.sqrt(Math.max(0, 1 - f * f)) + 1e-4, -sl * f); }), 32,
  ).rotateZ(-Math.PI / 2).translate(spec.x + sl * 0.15, spec.y, spec.z); // nose forward (-x)
  const blades = [];
  const N = 10;
  for (let b = 0; b < n; b++) {
    const th = (b / n) * Math.PI * 2 + Math.PI / 2;
    const Rv = new THREE.Vector3(0, Math.cos(th), Math.sin(th)), T = new THREE.Vector3(0, -Math.sin(th), Math.cos(th));
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const f = i / N, r = sr * 0.8 + (R - sr * 0.8) * f;
      const chord = R * (0.16 - 0.08 * f) * (f > 0.92 ? Math.sqrt(Math.max(0, (1 - f) / 0.08)) * 0.9 + 0.1 : 1);
      const pitch = THREE.MathUtils.degToRad(62 - 42 * f); // flatter toward the tip
      const along = new THREE.Vector3(Math.sin(pitch), 0, 0).addScaledVector(T, Math.cos(pitch));
      for (const c of [-0.5, 0.5]) {
        const p = Rv.clone().multiplyScalar(r).addScaledVector(along, c * chord);
        pos.push(spec.x + p.x, spec.y + p.y, spec.z + p.z);
      }
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    blades.push(g);
  }
  return { spinner: plain(spinner), blades: mergeIndexed(blades) };
}

/** A streamlined strut between two points: an elliptic tube, its long axis along the flow (x). */
export function strut(a, b, chord = 0.12, thick = 0.04) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const geo = new THREE.CylinderGeometry(0.5, 0.5, A.distanceTo(B), 14, 1);
  geo.scale(chord, 1, thick); // ellipse in the x-z plane of the cylinder
  const dir = B.clone().sub(A).normalize();
  // Turn the cylinder axis (y) onto the strut, keeping its chord as close to x as possible.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const chordDir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const want = new THREE.Vector3(1, 0, 0).addScaledVector(dir, -dir.x).normalize();
  const twist = Math.atan2(chordDir.clone().cross(want).dot(dir), chordDir.dot(want));
  geo.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0)).applyQuaternion(q);
  geo.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(dir, twist));
  const m = A.clone().add(B).multiplyScalar(0.5);
  geo.translate(m.x, m.y, m.z);
  return plain(geo);
}
