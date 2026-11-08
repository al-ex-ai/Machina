// See-through cabins for parametric aircraft: glazing cut out of the fuselage skin,
// glass and frames, and a generated interior (wall lining, floor, seats, instrument
// panel, yokes or sticks). The glazing is a map on the body surface: for columns of
// constant x, the angle ranges (degrees from the top centerline, left side; the right
// side mirrors) that are glass. It is measured from a mesh by the converter.
import * as THREE from 'three';
import { mergeIndexed } from './body.js';
import { plain, rod } from './details.js';

/** Angle t (0 at the top, PI at the bottom, left side) where a section point (y, z) lies on the body at x. */
export function angleOn(body, x, y, z) {
  const s = body.at(x);
  const nz = Math.min(1, Math.abs(z) / Math.max(s.w, 1e-3));
  if (y >= s.mid) {
    const e = 2 / body.nTop, ny = Math.min(1, (y - s.mid) / Math.max(s.top - s.mid, 1e-3));
    return Math.atan2(nz ** (1 / e), ny ** (1 / e));
  }
  const e = 2 / body.nBot, ny = Math.min(1, (s.mid - y) / Math.max(s.mid - s.bot, 1e-3));
  return Math.PI - Math.atan2(nz ** (1 / e), ny ** (1 / e));
}

/** Point in polygon (ray casting) for [x, y] pairs. */
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Test for glass at (x, t), either side: inside a pane outline, or on a glazed cell. */
export function glassTest(glazing) {
  if (!glazing) return () => false;
  if (glazing.panes?.length) return (x, t) => {
    const deg = THREE.MathUtils.radToDeg(t > Math.PI ? Math.PI * 2 - t : t);
    return glazing.panes.some(p => inside(p, x, deg));
  };
  const { x0, dx, cols } = glazing;
  return (x, t) => {
    const i = Math.floor((x - x0) / dx);
    if (i < 0 || i >= cols.length) return false;
    const deg = THREE.MathUtils.radToDeg(t > Math.PI ? Math.PI * 2 - t : t);
    return cols[i].some(([a, b]) => deg >= a && deg <= b);
  };
}

/** A patch of the body surface over the cells where keep(x, t) holds, lifted along the normal. */
function surfacePatch(body, glazing, keep, lift) {
  const { x0, dx, cols } = glazing;
  const dt = THREE.MathUtils.degToRad(2);
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  const at = (x, t) => {
    body.point(x, t, v);
    const n = new THREE.Vector3(0, v.y - body.at(x).mid, v.z).normalize(); // outward from the body axis
    return v.clone().addScaledVector(n, lift);
  };
  for (let i = 0; i < cols.length; i++) {
    const xa = x0 + i * dx, xb = xa + dx;
    for (let k = 0; k < 90; k++) {
      const ta = k * dt, tb = ta + dt;
      if (!keep(xa + dx / 2, ta + dt / 2)) continue;
      for (const side of [1, -1]) {
        const T = t => (side > 0 ? t : Math.PI * 2 - t);
        const base = pos.length / 3;
        for (const p of [at(xa, T(ta)), at(xb, T(ta)), at(xb, T(tb)), at(xa, T(tb))]) pos.push(p.x, p.y, p.z);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3); // drawn double sided
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Local mean radius of the body at x, to turn angles into arc lengths. */
const radius = (body, x) => { const s = body.at(x); return Math.max(0.05, (s.w + (s.top - s.bot) / 2) / 2); };

/**
 * Smooth panes: each outline triangulated and draped over the skin (both sides), with
 * a frame band along its edge that also covers the stepped edge of the opening.
 */
function paneGeometry(body, panes) {
  const v = new THREE.Vector3();
  const lifted = (x, deg, side, lift) => {
    const t = THREE.MathUtils.degToRad(deg);
    body.point(x, side > 0 ? t : Math.PI * 2 - t, v);
    const n = new THREE.Vector3(0, v.y - body.at(x).mid, v.z).normalize();
    return v.clone().addScaledVector(n, lift);
  };
  const glass = { pos: [], idx: [] }, frame = { pos: [], idx: [] };
  const quad = (out, a, b, c, d) => { const base = out.pos.length / 3; for (const p of [a, b, c, d]) out.pos.push(p.x, p.y, p.z); out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  for (const pane of panes) {
    // Glass: triangulate the outline, subdivide so it follows the curve, map to the skin.
    const tris = THREE.ShapeUtils.triangulateShape(pane.map(([x, d]) => new THREE.Vector2(x, d)), []);
    const sub = (a, b, c, n) => {
      if (n === 0) return [[a, b, c]];
      const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      return [...sub(a, ab, ca, n - 1), ...sub(ab, b, bc, n - 1), ...sub(ca, bc, c, n - 1), ...sub(ab, bc, ca, n - 1)];
    };
    for (const side of [1, -1]) for (const [i, j, k] of tris) for (const [a, b, c] of sub(pane[i], pane[j], pane[k], 3)) {
      const base = glass.pos.length / 3;
      for (const p of [a, b, c]) { const q = lifted(p[0], p[1], side, 0.002); glass.pos.push(q.x, q.y, q.z); }
      glass.idx.push(base, base + 1, base + 2);
    }
    // Frame: a band 5 cm either side of the outline, measured along the skin.
    for (let e = 0; e < pane.length; e++) {
      const [x1, d1] = pane[e], [x2, d2] = pane[(e + 1) % pane.length];
      const r = radius(body, (x1 + x2) / 2), k = 180 / Math.PI / r; // degrees per meter of arc
      const du = x2 - x1, dv = (d2 - d1) / k, len = Math.hypot(du, dv) || 1;
      const nu = -dv / len * 0.05, nv = du / len * 0.05 * k;
      const steps = Math.max(1, Math.ceil(len / 0.04));
      for (let s2 = 0; s2 < steps; s2++) {
        const f0 = s2 / steps, f1 = (s2 + 1) / steps;
        const P = f => [x1 + (x2 - x1) * f, d1 + (d2 - d1) * f];
        const [ax, ad] = P(f0), [bx, bd] = P(f1);
        for (const side of [1, -1]) quad(frame,
          lifted(ax - nu, ad - nv, side, 0.005), lifted(bx - nu, bd - nv, side, 0.005),
          lifted(bx + nu, bd + nv, side, 0.005), lifted(ax + nu, ad + nv, side, 0.005));
      }
    }
  }
  const geo = o => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setIndex(o.idx); g.computeVertexNormals(); return g; };
  return { glass: geo(glass), frame: geo(frame) };
}

/** Glass and frames: smooth panes when outlines are given, otherwise glazed cells with a one-cell frame. */
export function glazingGeometry(body, glazing) {
  if (glazing.panes?.length) return paneGeometry(body, glazing.panes);
  const isGlass = glassTest(glazing);
  const d = { x: glazing.dx, t: THREE.MathUtils.degToRad(2) };
  const frame = (x, t) => !isGlass(x, t) && [[d.x, 0], [-d.x, 0], [0, d.t], [0, -d.t], [d.x, d.t], [-d.x, -d.t], [d.x, -d.t], [-d.x, d.t]].some(([a, b]) => isGlass(x + a, t + b));
  return { glass: surfacePatch(body, glazing, isGlass, 0.002), frame: surfacePatch(body, glazing, frame, 0.006) };
}

/**
 * The cabin interior from the interior spec { from, to, floor, seats, abreast }: lining
 * (an inner shell seen from inside, with the glazing cut out), floor, seats, an
 * instrument panel with gauges, and yokes (side by side) or sticks (tandem).
 */
export function interior(body, spec, glazing, loftBody, bodyProfile) {
  const { from, to, floor } = spec;
  const isGlass = glassTest(glazing);
  // Lining: the body between from and to, pulled in 4 cm, with the glass cut out.
  const inner = bodyProfile(
    Array.from({ length: 13 }, (_, i) => {
      const x = from + ((to - from) * i) / 12, s = body.at(x);
      return [x, Math.max(0.05, s.w - 0.04), s.top - 0.04, s.bot + 0.04, s.mid];
    }), { nTop: body.nTop, nBot: body.nBot },
  );
  const lining = loftBody(inner, { segments: 96, capStart: false, capEnd: false, skip: (x, t) => isGlass(x, t) });
  // Floor across the cabin at floor height.
  const mid = body.at((from + to) / 2);
  const halfAt = y => mid.w * Math.sqrt(Math.max(0, 1 - ((mid.mid - y) / (mid.mid - mid.bot)) ** 2));
  const fw = halfAt(floor) * 1.9;
  const floorGeo = new THREE.BoxGeometry(to - from, 0.04, fw).translate((from + to) / 2, floor - 0.02, 0);
  // Seats in rows, front row just behind the panel.
  const seat = (x, z) => [
    new THREE.BoxGeometry(0.46, 0.1, 0.44).translate(x, floor + 0.32, z),
    new THREE.BoxGeometry(0.1, 0.62, 0.44).translate(x + 0.24, floor + 0.66, z),
    new THREE.BoxGeometry(0.08, 0.16, 0.28).translate(x + 0.26, floor + 1.04, z),
    new THREE.BoxGeometry(0.3, 0.27, 0.36).translate(x, floor + 0.14, z),
  ].map(plain);
  const panelX = from + 0.12;
  const seats = [], controls = [];
  const abreast = spec.abreast ?? 2, rows = Math.ceil((spec.seats ?? 2) / abreast);
  const pitch = abreast === 1 ? 0.95 : 0.85;
  const zs = abreast === 1 ? [0] : [fw * 0.24, -fw * 0.24];
  for (let r = 0; r < rows; r++) {
    const x = panelX + 0.85 + r * pitch;
    if (x > to - 0.3) break;
    for (const z of zs) {
      seats.push(...seat(x, z));
      if (r === 0 || abreast === 1) {
        // Yoke on a column out of the panel for side by side seats, a stick for tandem.
        if (abreast === 1) controls.push(plain(rod([x - 0.45, floor + 0.05, z], [x - 0.4, floor + 0.62, z], 0.015, 8)));
        else if (r === 0) {
          controls.push(plain(rod([panelX + 0.05, floor + 0.7, z], [panelX + 0.32, floor + 0.7, z], 0.02, 8)));
          controls.push(plain(new THREE.BoxGeometry(0.04, 0.05, 0.3).translate(panelX + 0.34, floor + 0.7, z)));
          controls.push(plain(new THREE.BoxGeometry(0.04, 0.12, 0.04).translate(panelX + 0.34, floor + 0.78, z + 0.13)));
          controls.push(plain(new THREE.BoxGeometry(0.04, 0.12, 0.04).translate(panelX + 0.34, floor + 0.78, z - 0.13)));
        }
      }
    }
  }
  // Instrument panel and glareshield across the cabin, with two rows of gauges.
  const pw = halfAt(floor + 0.75) * 1.85;
  const panel = [
    plain(new THREE.BoxGeometry(0.08, 0.3, pw).translate(panelX, floor + 0.78, 0)),
    plain(new THREE.BoxGeometry(0.22, 0.04, pw).translate(panelX - 0.04, floor + 0.95, 0)),
  ];
  const gauges = [];
  const n = Math.max(3, Math.floor(pw / 0.11));
  for (let i = 0; i < n; i++) for (const dy of [0.06, -0.06]) {
    const z = -pw / 2 + 0.08 + (i * (pw - 0.16)) / (n - 1 || 1);
    gauges.push(plain(new THREE.CircleGeometry(0.035, 20).rotateY(Math.PI / 2).translate(panelX + 0.042, floor + 0.8 + dy, z)));
  }
  return {
    lining,
    floor: plain(floorGeo),
    seats: mergeIndexed(seats),
    panel: mergeIndexed(panel),
    gauges: mergeIndexed(gauges),
    controls: controls.length ? mergeIndexed(controls) : null,
  };
}
