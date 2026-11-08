// Lifting surfaces (wings, tails, fins, pylons) lofted from real airfoil sections.
//
// A surface is a list of planform sections along its span axis:
//   { at, le, chord, h, tc, twist }
//   at     span position (z for horizontal surfaces, y for vertical ones)
//   le     x of the leading edge
//   chord  chord length
//   h      offset off the span axis (height for wings, gives dihedral)
//   tc     thickness to chord ratio
//   twist  degrees, positive is leading edge up
// Values between sections are linear, which is exact for straight tapered panels.
// Segments cut the surface spanwise and chordwise into named parts (slats, flaps,
// ailerons, rudder), each a closed solid.
import * as THREE from 'three';
import { linear } from './curves.js';
import { mergeIndexed } from './body.js';

/** NACA four-digit section: camber m at position p, thickness t, closed trailing edge. */
function naca(x, t, m, p) {
  const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = m === 0 ? 0 : x < p ? (m / p ** 2) * (2 * p * x - x * x) : (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
  return [yc + yt, yc - yt];
}

/** Closed section outline for the chord range [c0, c1]: upper surface aft to fore, then lower fore to aft. */
function outline(c0, c1, t, m, p, n = 36) {
  const xs = [];
  for (let k = 0; k <= n; k++) xs.push(c0 + ((c1 - c0) * (1 - Math.cos((Math.PI * k) / n))) / 2);
  const pts = [];
  for (let k = n; k >= 0; k--) pts.push([xs[k], naca(xs[k], t, m, p)[0]]);
  for (let k = c0 === 0 ? 1 : 0; k <= n; k++) pts.push([xs[k], naca(xs[k], t, m, p)[1]]);
  return pts;
}

/**
 * @param {{ axis: 'z'|'y', sections: object[], camber?: number, camberAt?: number }} spec
 */
export function surfacePlan(spec) {
  const at = spec.sections.map(s => s.at);
  const f = k => linear(at, spec.sections.map(s => s[k] ?? 0));
  const le = f('le'), chord = f('chord'), h = f('h'), tc = f('tc'), twist = f('twist');
  return { ...spec, section: a => ({ le: le(a), chord: chord(a), h: h(a), tc: tc(a), twist: twist(a) }) };
}

/** One closed solid: the span range [a0, a1] and chord range [c0, c1] of a surface. */
export function surfacePiece(plan, a0, a1, c0, c1) {
  const m = plan.camber ?? 0, p = plan.camberAt ?? 0.4;
  const vertical = plan.axis === 'y';
  const breaks = [a0, ...plan.sections.map(s => s.at).filter(a => a > a0 && a < a1), a1];
  const spans = [];
  for (let i = 0; i < breaks.length - 1; i++) for (let k = 0; k < 4; k++) spans.push(breaks[i] + ((breaks[i + 1] - breaks[i]) * k) / 4);
  spans.push(a1);

  const ring = a => {
    const s = plan.section(a);
    const tw = THREE.MathUtils.degToRad(s.twist);
    return outline(c0, c1, s.tc, m, p).map(([x, y]) => {
      if (vertical) return [s.le + x * s.chord, a, s.h + y * s.chord];
      const dx = (x - 0.25) * s.chord, dy = y * s.chord;
      return [s.le + 0.25 * s.chord + dx * Math.cos(tw) + dy * Math.sin(tw), s.h - dx * Math.sin(tw) + dy * Math.cos(tw), a];
    });
  };
  const rings = spans.map(ring);
  const R = rings[0].length;
  const pos = rings.flat(2);
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      if (vertical) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const skin = new THREE.BufferGeometry();
  skin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skin.setIndex(idx);
  skin.computeVertexNormals();
  return mergeIndexed([skin, endCap(rings[0], -1, vertical), endCap(rings[rings.length - 1], 1, vertical)]);
}

function endCap(ring, dir, vertical) {
  const c = ring.reduce((s, q) => [s[0] + q[0], s[1] + q[1], s[2] + q[2]], [0, 0, 0]).map(v => v / ring.length);
  const pos = [...c, ...ring.flat()];
  const idx = [];
  const flip = (dir > 0) !== vertical;
  for (let j = 1; j < ring.length; j++) flip ? idx.push(0, j, j + 1) : idx.push(0, j + 1, j);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Mirror a geometry to the other side (z to -z), keeping faces pointing outward. */
export function mirrorZ(geo) {
  const g = geo.clone();
  g.scale(1, 1, -1);
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
