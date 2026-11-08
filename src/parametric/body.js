// Bodies lofted through measured cross-sections: fuselages, nacelles, fairings.
//
// A station is [x, halfWidth, top, bottom, mid]: the section is widest at height
// `mid`, reaches `top` and `bottom` on the centerline, and each half is a
// superellipse (exponent nTop above mid, nBot below; 2 is an ellipse, higher is
// boxier). Every value is interpolated smoothly along x, so a handful of stations
// describe a whole fuselage, including the nose, cockpit brow and tail upsweep.
//
// Angle t runs around the section: 0 on top, PI/2 on the left (+z), PI at the
// bottom, 3PI/2 on the right. UVs are u = x / length, v = t / 2PI, so a livery can
// be painted at exact positions (see thetaAt).
import * as THREE from 'three';
import { pchip } from './curves.js';

/**
 * @param {number[][]} stations [x, halfWidth, top, bottom, mid], x increasing
 * @param {{ nTop?: number, nBot?: number }} [shape]
 */
export function bodyProfile(stations, shape = {}) {
  const xs = stations.map(s => s[0]);
  const f = k => pchip(xs, stations.map(s => s[k]));
  const w = f(1), top = f(2), bot = f(3), mid = f(4);
  const nTop = shape.nTop ?? 2, nBot = shape.nBot ?? 2;
  return {
    x0: xs[0], x1: xs[xs.length - 1], nTop, nBot,
    at: x => ({ w: Math.max(0, w(x)), top: top(x), bot: bot(x), mid: mid(x) }),
    /** Point on the surface at station x and angle t. */
    point(x, t, out = new THREE.Vector3()) {
      const s = this.at(x);
      const c = Math.cos(t), sn = Math.sin(t);
      const n = c >= 0 ? nTop : nBot;
      const e = 2 / n;
      const y = c >= 0 ? s.mid + (s.top - s.mid) * Math.abs(c) ** e : s.mid - (s.mid - s.bot) * Math.abs(c) ** e;
      return out.set(x, y, s.w * Math.sign(sn) * Math.abs(sn) ** e);
    },
    /** Angle on the left side where the surface reaches height y at station x (right side: 2PI - t). */
    thetaAt(x, y) {
      const s = this.at(x);
      if (y >= s.mid) {
        const c = THREE.MathUtils.clamp((y - s.mid) / (s.top - s.mid || 1e-6), 0, 1);
        return Math.acos(c ** (nTop / 2));
      }
      const c = THREE.MathUtils.clamp((s.mid - y) / (s.mid - s.bot || 1e-6), 0, 1);
      return Math.PI - Math.acos(c ** (nBot / 2));
    },
  };
}

/** Ring positions along x: dense where the section changes fast (nose, tail), sparse along the cabin. */
function ringStations(p, target = 0.06) {
  const xs = [p.x0];
  const len = p.x1 - p.x0;
  const size = x => { const s = p.at(x); return s.w + (s.top - s.bot) / 2; };
  let x = p.x0;
  while (x < p.x1) {
    const probe = Math.min(len / 400, 0.02);
    const slope = Math.abs(size(Math.min(x + probe, p.x1)) - size(x)) / probe;
    const step = THREE.MathUtils.clamp(target / Math.max(slope, 1e-3), len / 600, len / 40);
    x = Math.min(x + step, p.x1);
    xs.push(x);
  }
  return xs;
}

/**
 * Loft a body. Open ends that still have width are closed with a flat cap.
 * @param {ReturnType<typeof bodyProfile>} p
 * @param {{ segments?: number, length?: number, capStart?: boolean, capEnd?: boolean }} [opts]
 */
export function loftBody(p, opts = {}) {
  const S = opts.segments ?? 96;
  const L = opts.length ?? p.x1;
  const xs = ringStations(p);
  const pos = [], uv = [], idx = [];
  const v = new THREE.Vector3();
  for (const x of xs) {
    for (let j = 0; j <= S; j++) {
      const t = (j / S) * Math.PI * 2;
      p.point(x, t, v);
      pos.push(v.x, v.y, v.z);
      uv.push(x / L, j / S);
    }
  }
  const R = S + 1;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  smoothSeam(geo, xs.length, R);
  const caps = [];
  if (opts.capStart !== false && p.at(p.x0).w > 1e-3) caps.push(cap(p, p.x0, S, -1, L));
  if (opts.capEnd !== false && p.at(p.x1).w > 1e-3) caps.push(cap(p, p.x1, S, 1, L));
  return caps.length ? mergeIndexed([geo, ...caps]) : geo;
}

// The ring's first and last vertex coincide (top seam) and so do all vertices of a
// zero-width end ring (nose tip). Give each such group one shared normal.
function smoothSeam(geo, rings, R) {
  const n = geo.attributes.normal, p = geo.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < rings; i++) {
    const s = i * R, e = s + R - 1;
    a.fromBufferAttribute(n, s).add(b.fromBufferAttribute(n, e)).normalize();
    n.setXYZ(s, a.x, a.y, a.z); n.setXYZ(e, a.x, a.y, a.z);
  }
  for (const i of [0, rings - 1]) {
    const s = i * R;
    const first = new THREE.Vector3().fromBufferAttribute(p, s);
    let pinched = true;
    for (let j = 1; j < R && pinched; j++) pinched = first.distanceTo(b.fromBufferAttribute(p, s + j)) < 1e-5;
    if (!pinched) continue;
    const dir = i === 0 ? -1 : 1;
    for (let j = 0; j < R; j++) n.setXYZ(s + j, dir, 0, 0);
  }
  n.needsUpdate = true;
}

function cap(p, x, S, dir, L) {
  const s = p.at(x);
  const pos = [x, s.mid, 0], uv = [x / L, 0.5], idx = [];
  const v = new THREE.Vector3();
  for (let j = 0; j <= S; j++) {
    p.point(x, (j / S) * Math.PI * 2, v);
    pos.push(v.x, v.y, v.z);
    uv.push(x / L, j / S);
  }
  for (let j = 1; j <= S; j++) dir > 0 ? idx.push(0, j, j + 1) : idx.push(0, j + 1, j);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Merge indexed geometries that share the same attributes (position, normal, uv). */
export function mergeIndexed(geos) {
  const names = ['position', 'normal', 'uv'].filter(n => geos.every(g => g.attributes[n]));
  const out = Object.fromEntries(names.map(n => [n, []]));
  const idx = [];
  let base = 0;
  for (const g of geos) {
    for (const n of names) out[n].push(...g.attributes[n].array);
    const index = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    for (const i of index) idx.push(i + base);
    base += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  for (const n of names) geo.setAttribute(n, new THREE.Float32BufferAttribute(out[n], n === 'uv' ? 2 : 3));
  geo.setIndex(idx);
  return geo;
}
