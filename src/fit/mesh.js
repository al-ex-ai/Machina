// Measure a parametric description from a triangle mesh: fuselage sections, lifting
// surface planforms, control surface extents, engines and landing gear. Works on the
// world-space soups from src/draw/hlr.js collect(), in Machina axes (x aft, y up,
// z left). Part names are only used to pick candidate triangles; every number comes
// from slicing the geometry.

/** Triangles of the meshes whose part id matches, optionally only those with a vertex on one side of z. */
export function pick(meshes, re, { not, side } = {}) {
  const out = [];
  for (const m of meshes) {
    if (!re.test(m.part) || (not && not.test(m.part))) continue;
    const P = m.verts, T = m.tris;
    for (let f = 0; f < T.length / 3; f++) {
      if (!m.keep[f]) continue;
      const a = T[f * 3] * 3, b = T[f * 3 + 1] * 3, c = T[f * 3 + 2] * 3;
      const t = [P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]];
      if (side && Math.max(t[2] * side, t[5] * side, t[8] * side) <= 0) continue;
      if (sliver(t)) continue;
      out.push(t);
    }
  }
  return out;
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
  const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  return (2 * area) / long < 0.02;
}

export function boxOf(tris) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const t of tris) for (let k = 0; k < 9; k++) {
    const i = k % 3;
    if (t[k] < b.min[i]) b.min[i] = t[k];
    if (t[k] > b.max[i]) b.max[i] = t[k];
  }
  return b;
}

/** Points where the triangles cross the plane axis = v (axis 0 x, 1 y, 2 z), as [u, w] in the other two axes. */
export function slice(tris, axis, v) {
  const [u, w] = [[1, 2], [0, 2], [0, 1]][axis];
  const pts = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const i = k * 3, j = ((k + 1) % 3) * 3;
      const di = t[i + axis] - v, dj = t[j + axis] - v;
      if ((di <= 0 && dj > 0) || (di > 0 && dj <= 0)) {
        const s = di / (di - dj);
        pts.push([t[i + u] + (t[j + u] - t[i + u]) * s, t[i + w] + (t[j + w] - t[i + w]) * s]);
      }
    }
  }
  return pts;
}

/** Segments where the triangles cross the plane axis = v, each as two [u, w] points. */
export function sliceSegments(tris, axis, v) {
  const [u, w] = [[1, 2], [0, 2], [0, 1]][axis];
  const out = [];
  for (const t of tris) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const i = k * 3, j = ((k + 1) % 3) * 3;
      const di = t[i + axis] - v, dj = t[j + axis] - v;
      if ((di <= 0 && dj > 0) || (di > 0 && dj <= 0)) {
        const s = di / (di - dj);
        pts.push([t[i + u] + (t[j + u] - t[i + u]) * s, t[i + w] + (t[j + w] - t[i + w]) * s]);
      }
    }
    if (pts.length === 2) out.push(pts);
  }
  return out;
}

/** Group 1D values into clusters separated by gaps larger than gap. */
export function clusters1(values, gap) {
  const v = [...values].sort((a, b) => a - b);
  const out = [];
  for (const x of v) {
    const c = out.at(-1);
    if (c && x - c.max <= gap) { c.max = x; c.n++; c.sum += x; } else out.push({ min: x, max: x, n: 1, sum: x });
  }
  return out.map(c => ({ ...c, mid: c.sum / c.n }));
}

const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

// ── Fuselage ────────────────────────────────────────────────────────────────

/**
 * Stations [x, halfWidth, top, bottom, mid] at cosine-spaced x (dense at the nose and
 * tail), and superellipse exponents fitted to the central sections.
 */
export function fuselage(tris, count = 44) {
  const b = boxOf(tris);
  const x0 = b.min[0], x1 = b.max[0], L = x1 - x0;
  const stations = [];
  for (let i = 0; i <= count; i++) {
    const f = (1 - Math.cos((Math.PI * i) / count)) / 2;
    const x = x0 + L * f;
    if (i === 0 || i === count) continue;
    const pts = slice(tris, 0, x);
    if (pts.length < 6) continue;
    let w = 0, top = -Infinity, bot = Infinity;
    for (const [y, z] of pts) { w = Math.max(w, Math.abs(z)); top = Math.max(top, y); bot = Math.min(bot, y); }
    // A fin root or dorsal fillet in the same mesh rises above the crown as a thin wall.
    // The crown is the highest point where the section is still wider than a fin: 10 cm
    // below it the body is a good fraction of its width across.
    const thin = Math.max(0.12, w * 0.12);
    const wide = pts.filter(([, z]) => Math.abs(z) > thin).map(([y]) => y);
    if (wide.length) top = Math.min(top, Math.max(...wide) + 0.1);
    const widest = pts.filter(([, z]) => Math.abs(z) > w * 0.97).map(([y]) => y);
    stations.push({ x, w, top, bot, mid: median(widest), pts: pts.filter(([y]) => y <= top) });
  }
  // Door handles, pillars and frames catch single slices: a running median over five
  // stations removes those spikes (a steady trend, such as a nose taper, passes unchanged).
  // Only a value outside the range of both neighbors counts as a spike, so a nose or
  // tail taper is never touched.
  const sm = stations.map((s, i) => {
    if (i === 0 || i === stations.length - 1) return s;
    const a = stations[i - 1], b = stations[i + 1];
    const fix = k => (s[k] > Math.max(a[k], b[k]) || s[k] < Math.min(a[k], b[k]) ? median([a[k], s[k], b[k]]) : s[k]);
    return { ...s, w: fix('w'), top: fix('top'), bot: fix('bot'), mid: fix('mid') };
  });
  stations.splice(0, stations.length, ...sm);
  // Exponents: for each section point solve |dz/w|^n + |dy/h|^n = 1 for n, take the median.
  const solve = (a, c) => {
    if (a <= 0.02 || c <= 0.02 || a >= 0.999 || c >= 0.999) return null;
    let lo = 1, hi = 8;
    for (let k = 0; k < 40; k++) { const n = (lo + hi) / 2; (a ** n + c ** n > 1 ? (lo = n) : (hi = n)); }
    return (lo + hi) / 2;
  };
  const nT = [], nB = [];
  for (const s of stations) {
    if (s.x < x0 + L * 0.3 || s.x > x0 + L * 0.65) continue;
    for (const [y, z] of s.pts) {
      const a = Math.abs(z) / s.w;
      if (y >= s.mid) { const n = solve(a, (y - s.mid) / (s.top - s.mid)); if (n) nT.push(n); }
      else { const n = solve(a, (s.mid - y) / (s.mid - s.bot)); if (n) nB.push(n); }
    }
  }
  const tip = (x, side) => {
    // Close the profile at the very ends with a point section at the measured end height.
    const near = side < 0 ? stations[0] : stations.at(-1);
    return [r2(x - x0), 0, r2(near.mid), r2(near.mid), r2(near.mid)];
  };
  return {
    x0, length: L,
    nTop: r2(median(nT) || 2), nBot: r2(median(nB) || 2),
    stations: [tip(x0, -1), ...stations.map(s => [r2(s.x - x0), r2(s.w), r2(s.top), r2(s.bot), r2(s.mid)]), tip(x1, 1)],
    at(x) { // measured section near x (absolute)
      let best = stations[0];
      for (const s of stations) if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
      return best;
    },
  };
}

// ── Lifting surfaces ────────────────────────────────────────────────────────

/**
 * Planform of a surface sliced along its span axis (2 for wings and tails, 1 for a
 * fin): leading edge, chord, height of the chord line and thickness at each station,
 * reduced to the stations where the edges bend.
 */
export function planform(tris, spanAxis, from, to, n = 60) {
  const raw = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    // Each triangle cut by the plane gives a segment; overlapping segments join into runs
    // along x. The surface is the longest run: anything separate (a tail in the same
    // part, a stray sliver) is another run and is dropped.
    const segs = sliceSegments(tris, spanAxis, a);
    if (segs.length < 3) continue;
    const iv = segs.map(([p, q]) => [Math.min(p[0], q[0]), Math.max(p[0], q[0]), p, q]).sort((p, q) => p[0] - q[0]);
    const runs = [];
    for (const v of iv) { const r = runs.at(-1); if (r && v[0] <= r.x1 + 0.4) { r.x1 = Math.max(r.x1, v[1]); r.pts.push(v[2], v[3]); } else runs.push({ x0: v[0], x1: v[1], pts: [v[2], v[3]] }); }
    const pts = runs.reduce((b, c) => (c.x1 - c.x0 > b.x1 - b.x0 ? c : b), runs[0]).pts;
    // pts are [x, other]: for z slices other = y, for y slices other = z.
    let le = Infinity, te = -Infinity, lo = Infinity, hi = -Infinity, hle = 0, hte = 0;
    for (const [x, o] of pts) {
      if (x < le) { le = x; hle = o; }
      if (x > te) { te = x; hte = o; }
      lo = Math.min(lo, o); hi = Math.max(hi, o);
    }
    const chord = te - le;
    if (chord < 0.05) continue;
    raw.push({ at: a, le, chord, h: (hle + hte) / 2, tc: Math.min(0.2, Math.max(0.04, (hi - lo) / chord)) });
  }
  // A surface is continuous along its span: stop at the first stretch with no cut
  // (anything beyond belongs to something else in the same part).
  const step = (to - from) / n;
  for (let i = 1; i < raw.length; i++) if (raw[i].at - raw[i - 1].at > step * 3.5) { raw.length = i; break; }
  if (raw.length < 2) return [];
  // Hinges, tracks and actuators inside a mesh catch single slices: a running median
  // over five slices removes those spikes before the edges are simplified.
  const med = (i, f) => median(raw.slice(Math.max(0, i - 2), i + 3).map(f));
  const smooth = raw.map((s, i) => {
    const le = med(i, q => q.le), te = med(i, q => q.le + q.chord);
    return { at: s.at, le, chord: te - le, h: med(i, q => q.h), tc: med(i, q => q.tc) };
  });
  raw.splice(0, raw.length, ...smooth);
  // Keep the stations where the leading or trailing edge bends (RDP on both edges).
  const keep = new Set([0, raw.length - 1]);
  const split = (i0, i1) => {
    let best = 0, at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const f = (raw[i].at - raw[i0].at) / (raw[i1].at - raw[i0].at);
      const dle = Math.abs(raw[i].le - (raw[i0].le + (raw[i1].le - raw[i0].le) * f));
      const dte = Math.abs(raw[i].le + raw[i].chord - (raw[i0].le + raw[i0].chord + (raw[i1].le + raw[i1].chord - raw[i0].le - raw[i0].chord) * f));
      const d = Math.max(dle, dte);
      if (d > best) { best = d; at = i; }
    }
    if (best > 0.06 && at > 0) { keep.add(at); split(i0, at); split(at, i1); }
  };
  split(0, raw.length - 1);
  return [...keep].sort((p, q) => p - q).map(i => raw[i]).map(s => ({ at: r2(s.at), le: r2(s.le), chord: r2(s.chord), h: r2(s.h), tc: r3(s.tc) }));
}

/**
 * Where a control surface covers the span, and the chord fraction it starts (trailing
 * edge devices) or ends (leading edge devices) at.
 */
export function coverage(tris, plan, spanAxis, edge) {
  if (!tris.length || !plan.length) return [];
  const from = plan[0].at, to = plan.at(-1).at;
  const lin = (k, a) => {
    for (let i = 0; i < plan.length - 1; i++) if (a <= plan[i + 1].at) {
      const f = (a - plan[i].at) / (plan[i + 1].at - plan[i].at || 1);
      return plan[i][k] + (plan[i + 1][k] - plan[i][k]) * f;
    }
    return plan.at(-1)[k];
  };
  const n = 80, runs = [];
  let cur = null;
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const pts = slice(tris, spanAxis, a);
    const le = lin('le', a), chord = lin('chord', a);
    let frac = null;
    if (pts.length >= 3) {
      const xs = pts.map(p => p[0]);
      frac = edge === 'te' ? (Math.min(...xs) - le) / chord : (Math.max(...xs) - le) / chord;
      if (frac < -0.1 || frac > 1.1) frac = null;
    }
    if (frac !== null) { if (!cur) runs.push(cur = { from: a, to: a, fr: [] }); cur.to = a; cur.fr.push(frac); }
    else cur = null;
  }
  // A hinge line sits aft of 55% chord for trailing edge devices and ahead of 30% for
  // leading edge devices; anything else is a mapping mistake in the source and is dropped.
  const ok = f => (edge === 'te' ? f >= 0.55 && f <= 0.9 : f >= 0.06 && f <= 0.3);
  return runs.filter(r => r.to - r.from > (to - from) * 0.04).map(r => ({ from: r2(r.from), to: r2(r.to), frac: r3(median(r.fr)) })).filter(r => ok(r.frac));
}

/** Segments with chordwise splits from control surface runs. kinds: { te: [[runs, key]...], le: [[runs, key]...] } */
export function segments(plan, kinds, boxKey) {
  const from = plan[0].at, to = plan.at(-1).at;
  const cuts = new Set([from, to, ...plan.map(s => s.at)]);
  for (const list of [kinds.te, kinds.le]) for (const [runs] of list) for (const r of runs) { cuts.add(r.from); cuts.add(r.to); }
  const xs = [...cuts].filter(a => a >= from && a <= to).sort((p, q) => p - q).filter((a, i, arr) => i === 0 || a - arr[i - 1] > 0.05);
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const hit = list => { for (const [runs, key] of list) { const r = runs.find(q => mid >= q.from && mid <= q.to); if (r) return [r.frac, key]; } return null; };
    const te = hit(kinds.te), le = hit(kinds.le);
    const split = [];
    let c = 0;
    if (le) { split.push([0, le[0], le[1]]); c = le[0]; }
    const e = te ? te[0] : 1;
    split.push([c, e, boxKey]);
    if (te) split.push([e, 1, te[1]]);
    const prev = segs.at(-1);
    if (prev && JSON.stringify(prev.split) === JSON.stringify(split)) prev.to = xs[i + 1];
    else segs.push({ from: xs[i], to: xs[i + 1], split });
  }
  return segs;
}

// ── Engines ─────────────────────────────────────────────────────────────────

/** One nacelle from its triangles: position, lofted stations (round, below any pylon), fan and plug. */
export function nacelle(tris) {
  const b = boxOf(tris);
  const x0 = b.min[0], len = b.max[0] - x0;
  const zc = (b.min[2] + b.max[2]) / 2;
  const rows = [];
  for (let i = 1; i < 24; i++) {
    const x = x0 + (len * i) / 24;
    const pts = slice(tris, 0, x);
    if (pts.length < 6) continue;
    let zl = Infinity, zh = -Infinity, bot = Infinity;
    for (const [y, z] of pts) { zl = Math.min(zl, z); zh = Math.max(zh, z); bot = Math.min(bot, y); }
    const w = (zh - zl) / 2;
    rows.push({ x, w, cy: bot + w }); // round section resting on its lowest point: a pylon above cannot inflate it
  }
  const big = rows.reduce((a, r) => (r.w > a.w ? r : a), rows[0]);
  const cy = big.cy;
  const st = [[0, r2(rows[0].w * 0.97), r2(rows[0].w * 0.97), r2(-rows[0].w * 0.97), 0], ...rows.map(r => [r2(r.x - x0), r2(r.w), r2(r.cy - cy + r.w), r2(r.cy - cy - r.w), r2(r.cy - cy)])];
  const end = rows.at(-1);
  return {
    position: { x: r2(x0), y: r2(cy), z: r2(zc) },
    length: len,
    nacelle: { nTop: 2, nBot: 2, stations: st },
    fan: { radius: r2(rows[0].w * 0.82), depth: r2(Math.min(0.6, len * 0.1)) },
    plug: [[r2(end.x - x0 - 0.2), r2(end.w * 0.6)], [r2(end.x - x0 + 0.1), r2(end.w * 0.45)], [r2(end.x - x0 + 0.5), 0.03]],
    top: cy + big.w,
  };
}

// ── Landing gear ────────────────────────────────────────────────────────────

/**
 * Wheels from a slice just above the ground: each tire cuts the plane in its own blob,
 * whose fore-aft length gives the tire diameter (a chord at known height).
 */
export function wheels(tris, ground, h = 0.12) {
  // Each triangle cut by the plane gives a segment; segments that share end points form
  // closed loops, one per tire (a tread cut alone would only show its two edges).
  const v = ground + h, segs = [];
  for (const t of tris) {
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const i = k * 3, j = ((k + 1) % 3) * 3;
      const di = t[i + 1] - v, dj = t[j + 1] - v;
      if ((di <= 0 && dj > 0) || (di > 0 && dj <= 0)) {
        const s = di / (di - dj);
        pts.push([t[i] + (t[j] - t[i]) * s, t[i + 2] + (t[j + 2] - t[i + 2]) * s]);
      }
    }
    if (pts.length === 2) segs.push(pts);
  }
  const parent = segs.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const owner = new Map();
  const key = p => `${Math.round(p[0] * 500)},${Math.round(p[1] * 500)}`;
  segs.forEach((sg, i) => { for (const p of sg) { const k = key(p); if (owner.has(k)) parent[find(i)] = find(owner.get(k)); else owner.set(k, i); } });
  const blobs = new Map();
  segs.forEach((sg, i) => { const r = find(i); const b = blobs.get(r) ?? { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, n: 0 }; for (const [x, z] of sg) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); } b.n++; blobs.set(r, b); });
  // Blobs that overlap in plan are one tire (tread and sidewalls modeled apart).
  const list = [...blobs.values()].filter(b => b.n >= 4);
  const merged = [];
  for (const b of list.sort((p, q) => p.z0 - q.z0)) {
    const m = merged.find(q => b.x0 < q.x1 + 0.02 && b.x1 > q.x0 - 0.02 && b.z0 < q.z1 + 0.02 && b.z1 > q.z0 - 0.02);
    if (m) { m.x0 = Math.min(m.x0, b.x0); m.x1 = Math.max(m.x1, b.x1); m.z0 = Math.min(m.z0, b.z0); m.z1 = Math.max(m.z1, b.z1); }
    else merged.push({ ...b });
  }
  const out = [];
  for (const b of merged) {
    const E = b.x1 - b.x0, r = (E * E / (4 * h) + h) / 2;
    if (r < 0.06 || r > 1.2 || b.z1 - b.z0 < 0.03) continue;
    out.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, d: 2 * r, w: Math.max(0.12, (b.z1 - b.z0) * 1.1) });
  }
  return out;
}

/** Group wheels into legs (by z on one side) and axles (by x), in the builder's gear format. */
export function legs(ws, legGap = 1.3) {
  const out = [];
  for (const zl of clusters1(ws.map(w => w.z), legGap)) {
    const leg = ws.filter(w => w.z >= zl.min && w.z <= zl.max);
    const axles = clusters1(leg.map(w => w.x), 0.3);
    const perAxle = Math.round(leg.length / axles.length);
    const zs = clusters1(leg.map(w => w.z), 0.05).map(c => c.mid);
    out.push({
      x: r2(axles.reduce((a, c) => a + c.mid, 0) / axles.length),
      z: r2(zl.mid),
      wheels: perAxle,
      spacing: r2(zs.length > 1 ? (zs.at(-1) - zs[0]) / (zs.length - 1) : 0.4),
      axles: axles.length,
      axleSpacing: r2(axles.length > 1 ? (axles.at(-1).mid - axles[0].mid) / (axles.length - 1) : 0),
      tire: { d: r2(median(leg.map(w => w.d))), w: r2(median(leg.map(w => w.w))) },
    });
  }
  return out;
}

/**
 * Outlines of the filled regions of a grid (grid[i][k], 0 or 1) as closed loops in
 * cell coordinates, by marching squares, simplified to within tol cells.
 */
export function gridOutlines(grid, tol = 0.8) {
  const nx = grid.length, nk = grid[0].length;
  const at = (i, k) => (i >= 0 && k >= 0 && i < nx && k < nk ? grid[i][k] : 0);
  const segs = [];
  for (let i = -1; i < nx; i++) for (let k = -1; k < nk; k++) {
    const c = (at(i, k) << 3) | (at(i + 1, k) << 2) | (at(i + 1, k + 1) << 1) | at(i, k + 1);
    if (c === 0 || c === 15) continue;
    // Cell corners are cell centers (i + 0.5); edge midpoints between them.
    const T = [i + 1, k + 0.5], R = [i + 1.5, k + 1], B = [i + 1, k + 1.5], L = [i + 0.5, k + 1];
    const e = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[R, T]], 5: [[L, T], [R, B]], 6: [[B, T]], 7: [[L, T]], 8: [[T, L]], 9: [[T, B]], 10: [[T, R], [B, L]], 11: [[T, R]], 12: [[R, L]], 13: [[R, B]], 14: [[B, L]] }[c];
    for (const s of e) segs.push(s);
  }
  // Join segments that share end points into loops.
  const key = p => `${p[0]},${p[1]}`;
  const adj = new Map();
  segs.forEach((s, j) => { for (const p of s) { const kk = key(p); if (!adj.has(kk)) adj.set(kk, []); adj.get(kk).push(j); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let j = 0; j < segs.length; j++) {
    if (used[j]) continue;
    used[j] = 1;
    const loop = [segs[j][0], segs[j][1]];
    for (;;) {
      const next = (adj.get(key(loop.at(-1))) ?? []).find(q => !used[q]);
      if (next === undefined) break;
      used[next] = 1;
      const s = segs[next];
      loop.push(key(s[0]) === key(loop.at(-1)) ? s[1] : s[0]);
    }
    if (loop.length > 6) loops.push(loop);
  }
  const rdp = (pts, eps) => {
    if (pts.length < 3) return pts;
    let best = 0, at2 = 0;
    const [a, b] = [pts[0], pts.at(-1)], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len; if (d > best) { best = d; at2 = i; } }
    return best <= eps ? [a, b] : [...rdp(pts.slice(0, at2 + 1), eps).slice(0, -1), ...rdp(pts.slice(at2), eps)];
  };
  return loops.map(l => {
    let far = 0, best = -1;
    l.forEach((p, i) => { const d = Math.hypot(p[0] - l[0][0], p[1] - l[0][1]); if (d > best) { best = d; far = i; } });
    return [...rdp(l.slice(0, far + 1), tol).slice(0, -1), ...rdp(l.slice(far), tol).slice(0, -1)];
  }).filter(l => l.length >= 3);
}
