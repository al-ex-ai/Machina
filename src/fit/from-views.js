// Measure a parametric aircraft from its three silhouettes (src/fit/views.js), with no
// hints: no pixel boxes, no skip ranges, no station lists. Each view is read for what
// only it can show, and what one view hides is taken from another:
//   side   fuselage crown and belly, fin, tail cone end, gear legs, nacelle depth
//   top    fuselage width, wing and tailplane planforms, engines ahead of the wing
//   front  wing and tailplane heights (dihedral), winglets, engine and gear positions across
// Works in the ground frame: x from the nose aft, y up from the ground, z to the left.
// Covers jet transports: one fuselage, one wing, a single fin, a tailplane on the body
// or on the fin, engines under the wing or on the rear fuselage.
import { Mask, blank } from './views.js';

const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const lerp = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1][0]) return pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * (x - pts[i][0])) / (pts[i + 1][0] - pts[i][0] || 1);
  return pts.at(-1)[1];
};

/** Close gaps up to 2 * px wide (hinge lines, parts drawn a hair apart): grow, then shrink. */
function closed(mask, px = 2) {
  const { w, h } = mask;
  const pass = (src, grow) => {
    // Separable square: a pixel is set if any (grow) or all (shrink) of its neighbors within px are.
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let k = -px; k <= px; k++) { const q = x + k; const s = q < 0 || q >= w ? 0 : src[y * w + q]; if (grow ? s : !s) { v = grow ? 1 : 0; break; } }
      tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = grow ? 0 : 1;
      for (let k = -px; k <= px; k++) { const q = y + k; const s = q < 0 || q >= h ? 0 : tmp[q * w + x]; if (grow ? s : !s) { v = grow ? 1 : 0; break; } }
      out[y * w + x] = v;
    }
    return out;
  };
  return new Mask(w, h, mask.ppm, mask.u0, mask.v0, pass(pass(mask.data, true), false));
}

/** Keep only what a mask shows on both sides of its centerline. */
function mirrored(mask, across) {
  const { w, h, data } = mask, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, q = across === 'rows' ? (h - 1 - y) * w + x : y * w + (w - 1 - x);
    out[k] = data[k] & data[q];
  }
  return new Mask(w, h, mask.ppm, mask.u0, mask.v0, out);
}

/** Line through most of the points (y within tol), ignoring the rest: what a cabin roof is among antennas and a fin. */
function robustLine(pts, tol) {
  let best = null, score = -1;
  const n = pts.length, step = Math.max(1, Math.floor(n / 40));
  for (let i = 0; i < n; i += step) for (let j = i + step * 4; j < n; j += step) {
    const b = (pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]), a = pts[i][1] - b * pts[i][0];
    if (Math.abs(b) > 0.15) continue;
    let s = 0;
    for (const p of pts) if (Math.abs(p[1] - (a + b * p[0])) < tol) s++;
    if (s > score) { score = s; best = { a, b }; }
  }
  best ??= { a: median(pts.map(p => p[1])), b: 0 };
  // Refit on the inliers.
  const inl = pts.filter(p => Math.abs(p[1] - (best.a + best.b * p[0])) < tol);
  if (inl.length > 3) {
    const mx = inl.reduce((s, p) => s + p[0], 0) / inl.length, my = inl.reduce((s, p) => s + p[1], 0) / inl.length;
    const den = inl.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    if (den > 0) { const b = inl.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / den; best = { a: my - b * mx, b }; }
  }
  const { a, b } = best;
  return { a, b, at: x => a + b * x };
}

/** Least-squares line through all the points, as a function. */
function lineFit(pts) {
  const mx = pts.reduce((q, p) => q + p[0], 0) / pts.length, my = pts.reduce((q, p) => q + p[1], 0) / pts.length;
  const b = pts.reduce((q, p) => q + (p[0] - mx) * (p[1] - my), 0) / (pts.reduce((q, p) => q + (p[0] - mx) ** 2, 0) || 1);
  return x => my + b * (x - mx);
}

/** Runs of consecutive true flags as [first, last] index pairs; gaps up to `join` are bridged. */
function spans(flags, join = 0) {
  const out = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    const c = out.at(-1);
    if (c && i - c[1] - 1 <= join) c[1] = i; else out.push([i, i]);
  }
  return out;
}

/** Keep the points where a polyline bends by more than tol (Ramer, Douglas and Peucker), on several values at once. */
function bends(rows, keys, tol) {
  const keep = new Set([0, rows.length - 1]);
  const split = (i0, i1) => {
    let best = 0, at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const f = (rows[i].at - rows[i0].at) / (rows[i1].at - rows[i0].at);
      for (const k of keys) { const d = Math.abs(rows[i][k] - (rows[i0][k] + (rows[i1][k] - rows[i0][k]) * f)); if (d > best) { best = d; at = i; } }
    }
    if (best > tol && at > 0) { keep.add(at); split(i0, at); split(at, i1); }
  };
  split(0, rows.length - 1);
  return [...keep].sort((p, q) => p - q).map(i => rows[i]);
}

/**
 * Remove bumps from an edge profile: a stretch that leaves the edge with a step and
 * comes back with another (a nacelle ahead of a leading edge, a flap track fairing
 * behind a trailing edge). `sign` is the direction the bump pokes in (-1 forward).
 * Returns the cleaned values and the bumps as index ranges.
 */
function debump(v, step, sign, minStep, maxWidth) {
  const out = Float64Array.from(v), bumps = [];
  const n = v.length, k = Math.max(1, Math.round(0.08 / step));
  for (let i = k; i < n - k; i++) {
    if ((v[i] - v[i - k]) * sign < minStep) continue; // a step out
    let end = -1;
    for (let j = i + 1; j < Math.min(n - k, i + Math.round(maxWidth / step)); j++) {
      if ((v[j] - v[j + k]) * sign >= minStep * 0.6 && Math.abs(v[j + k] - v[i - k]) < Math.max(1.2, (j - i) * step * 1.5)) end = j; // a step back, near the level it left
      else if (end >= 0) break;
    }
    if (end < 0) continue;
    const a = i - k, b = end + k;
    for (let q = a + 1; q < b; q++) out[q] = v[a] + ((v[b] - v[a]) * (q - a)) / (b - a);
    bumps.push([a, b]);
    i = b;
  }
  return { clean: out, bumps };
}

// ── Side view ──────────────────────────────────────────────────────────────

function readSide(t) {
  const m = t.side, L = t.L, n = m.w, d = 1 / m.ppm;
  const top = new Float64Array(n).fill(NaN), bot = new Float64Array(n).fill(NaN), high = new Float64Array(n).fill(NaN);
  const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const runs = Array.from({ length: n }, (_, i) => m.runsV(m.U(i)));
  // Follow the body out from ahead of the wing: in each column, the run that continues
  // most of the last one.
  const X = i => m.U(i);
  const i0 = m.I(L * 0.3);
  const start = runs[i0].reduce((a, r) => (!a || r[1] - r[0] > a[1] - a[0] ? r : a), null);
  top[i0] = start[1]; bot[i0] = start[0];
  for (const dir of [-1, 1]) {
    let prev = start;
    for (let i = i0 + dir; i >= 0 && i < n; i += dir) {
      let pick = null, po = 0;
      for (const r of runs[i]) { const o = overlap(r, prev); if (o > po) { po = o; pick = r; } }
      // Behind the gear the body is the run that carries the belly line on: a fin or a
      // tailplane standing clear of the tail cone overlaps more, but starts higher.
      if (dir > 0 && X(i) > L * 0.72) pick = runs[i].filter(r => overlap(r, prev) > 0).sort((a, b) => Math.abs(a[0] - prev[0]) - Math.abs(b[0] - prev[0]))[0] ?? null;
      if (!pick) break;
      top[i] = pick[1]; bot[i] = pick[0]; prev = pick;
    }
  }
  const cols = [];
  for (let i = 0; i < n; i++) { if (!Number.isNaN(top[i])) cols.push(i); if (runs[i].length) high[i] = runs[i].at(-1)[1]; }
  const mid = cols.filter(i => X(i) > L * 0.15 && X(i) < L * 0.7);
  const crown = robustLine(mid.map(i => [X(i), top[i]]), 0.05);
  const belly = robustLine(mid.map(i => [X(i), bot[i]]), 0.05);
  const bodyH = crown.at(L * 0.4) - belly.at(L * 0.4);

  // The tail cone ends where the belly line stops: a step up from its level over the
  // last half meter, after which the lowest point stays above it (a tailplane or fin
  // overhanging the end). A drain mast or skid is too short to set that level.
  let endI = cols.at(-1);
  const w = Math.round(0.5 / d);
  for (let i = cols.at(-1) - 1; X(i) > L * 0.7; i--) {
    if (bot[i + 1] - bot[i] < 0.4) continue;
    const level = median(Array.from({ length: w }, (_, q) => bot[i - q]).filter(v => !Number.isNaN(v)));
    if (bot[i + 1] - level < 0.4) continue;
    // An overhang past the tail cone is short: a step with much of the aircraft still behind it is the
    // end of something under the body (a box nacelle), not of the body.
    let stays = X(cols.at(-1)) - X(i) < Math.max(2.5, L * 0.08);
    for (let j = i + 1; j <= cols.at(-1) && stays; j++) if (bot[j] < level + 0.3) { stays = false; break; }
    if (stays) { endI = i; break; }
  }
  const xEnd = X(endI) + d / 2;

  // The fin: from its tip forward and aft for as long as the outline stays above the
  // crown. Its outline is the top of each column, whether or not it touches the body there.
  let tipI = -1, lastI = 0;
  for (let i = 0; i < n; i++) if (!Number.isNaN(high[i])) { lastI = i; if (X(i) > L * 0.5 && (tipI < 0 || high[i] > high[tipI])) tipI = i; }
  const above = i => high[i] > crown.at(X(i)) + 0.3;
  let finA = tipI, finB = tipI;
  while (finA - 1 >= cols[0] && above(finA - 1)) finA--;
  while (finB + 1 <= lastI && above(finB + 1)) finB++;
  const hasFin = tipI >= 0 && high[tipI] - crown.at(X(tipI)) > bodyH * 0.4;

  // Below the belly: gear and nacelles. A stretch that ends in wheels is a leg; wheels
  // are found from each stretch's own lowest point, since a leg may hang unloaded.
  // A thin strut can stand clear of the body in this view, so this reads the lowest
  // point of each column, attached or not.
  const legs = [];
  const low = i => runs[i][0][0];
  for (const [a, b] of spans(cols.map(i => X(i) < xEnd && low(i) < belly.at(X(i)) - 0.15), Math.round(0.2 / d))) {
    const x0 = X(cols[a]) - d / 2, x1 = X(cols[b]) + d / 2;
    let lb = Infinity;
    for (let q = a; q <= b; q++) lb = Math.min(lb, low(cols[q]));
    if (lb > Math.max(0.6, belly.at(x0) * 0.35)) continue;
    // Tires: a row a little above the lowest point cuts each wheel, and the chord gives
    // the diameter. The height that shows the most wheels is used: too low and a tire
    // standing on a drawn ground line is cut open, too high and wheels side by side merge.
    let tires = [];
    for (const h of [0.12, 0.06, 0.18, 0.25]) {
      const found = m.runsU(lb + h).filter(r => r[0] >= x0 - d && r[1] <= x1 + d).map(r => { const E = r[1] - r[0]; return { x: (r[0] + r[1]) / 2, d: (E * E) / (4 * h) + h }; }).filter(q => q.d > 0.3 && q.d < 1.9);
      if (found.length > tires.length) tires = found;
    }
    if (!tires.length) continue;
    // The diameter from higher cuts too: just above its lowest point a drawn tire is a polygon's
    // corner, narrower than its circle. A cut counts while it still holds that tire alone.
    tires = tires.map(q => {
      const est = [0.18, 0.25, 0.32, 0.4].map(h => m.runsU(lb + h).find(r => Math.abs((r[0] + r[1]) / 2 - q.x) < 0.2 && r[1] - r[0] < Math.max(q.d, 0.5) * 1.15)).map((r, i) => { if (!r) return null; const h = [0.18, 0.25, 0.32, 0.4][i], E = r[1] - r[0]; return h < q.d * 0.9 ? (E * E) / (4 * h) + h : null; }).filter(v => v && v > 0.3 && v < 1.9);
      return est.length >= 2 ? { ...q, d: median(est) } : q;
    });
    // Wheels of one leg are the same size: strays (a door edge, a strut end) are off the median.
    const dia = median(tires.map(q => q.d)), same = tires.filter(q => Math.abs(q.d - dia) < dia * 0.3);
    legs.push({ x: r2(same.reduce((q, t2) => q + t2.x, 0) / same.length), d: r2(dia), bottom: lb, axles: same.length, axleSpacing: same.length > 1 ? r2((same.at(-1).x - same[0].x) / (same.length - 1)) : 0, x0: Math.min(...same.map(q => q.x - q.d / 2)), x1: Math.max(...same.map(q => q.x + q.d / 2)) });
  }
  const isGear = x => legs.some(g => x >= g.x0 - 0.15 && x <= g.x1 + 0.15);
  // Other stretches hanging below the belly line: nacelle candidates, matched to the top view
  // later. `core` is the deep part: a nacelle often runs into a shallower belly fairing behind it.
  const hang = spans(cols.map(i => !isGear(X(i)) && X(i) < xEnd && low(i) < belly.at(X(i)) - 0.25), Math.round(0.2 / d))
    .map(([a, b]) => {
      let lo = Infinity;
      for (let q = a; q <= b; q++) lo = Math.min(lo, low(cols[q]));
      const depth = belly.at(X(cols[a])) - lo;
      let c0 = -1, c1 = -1;
      for (let q = a; q <= b; q++) if (low(cols[q]) < lo + depth * 0.45) { if (c0 < 0) c0 = q; c1 = q; }
      return { x0: X(cols[a]), x1: X(cols[b]), bottom: lo, depth, core: [X(cols[c0]), X(cols[c1])] };
    })
    .filter(c => c.x1 - c.x0 > 1.2 && c.depth > 0.3);

  return { m, top, bot, high, cols, X, crown, belly, bodyH, fin: hasFin ? { a: finA, b: finB, tip: tipI } : null, xEnd, endI, legs, hang, isGear };
}

/** Crown and belly along the body, with the fin, gear and given stretches bridged. */
function bodyLines(s, skipBelow) {
  const { top, bot, cols, X, fin } = s;
  const t = [], b = [];
  const endTop = (() => {
    // Behind the fin the tail cone shows again; if the fin runs to the end, the cone is taken as slim.
    const y = top[s.endI], lo = bot[s.endI];
    return y - lo < Math.max(1.2, s.bodyH * 0.35) ? y : lo + Math.min(0.5, s.bodyH * 0.12);
  })();
  for (const i of cols) {
    const x = X(i);
    if (x > s.xEnd) break;
    if (!(fin && i >= fin.a && i <= fin.b)) t.push([x, top[i]]);
    if (!s.isGear(x) && !skipBelow.some(c => x >= c[0] - 0.1 && x <= c[1] + 0.1)) b.push([x, bot[i]]);
  }
  if (t.at(-1)[0] < s.xEnd - 0.05) t.push([s.xEnd, endTop]);
  if (b.at(-1)[0] < s.xEnd - 0.05) b.push([s.xEnd, bot[s.endI]]);
  // Antennas, probes and their fairings are short: a running median over 1.2 m drops
  // them, and leaves a steady rise or fall (a nose, a tail cone) as it is.
  const k = Math.max(1, Math.round(0.6 * s.m.ppm));
  const despike = pts => pts.map((p, i) => (i < k || i >= pts.length - k || p[0] < 1 ? p : [p[0], median(pts.slice(i - k, i + k + 1).map(q => q[1]))]));
  // Pixel rows leave stairs in the lines: a short moving average (shorter toward the ends) takes them out.
  const a = Math.max(1, Math.round(0.12 * s.m.ppm));
  const even = pts => pts.map((p, i) => { const w = Math.min(a, i, pts.length - 1 - i); let y = 0; for (let q = i - w; q <= i + w; q++) y += pts[q][1]; return [p[0], y / (2 * w + 1)]; });
  return { top: even(despike(t)), bot: even(despike(b)) };
}

/** Leading and trailing edge of the fin, row by row above the body. */
function readFin(s, lines) {
  if (!s.fin) return null;
  const { m, X } = s, d = 1 / m.ppm;
  const xa = X(s.fin.a), tipY = s.high[s.fin.tip];
  const rows = [];
  for (let y = tipY - d; y > 0; y -= d) {
    // The row's run that carries the fin down: under the tip first, then under the row above.
    const last = rows.at(-1) ?? { le: X(s.fin.tip) - 0.5, te: X(s.fin.tip) + 0.5 };
    const run = m.runsU(y).map(r => [r, Math.min(r[1], last.te) - Math.max(r[0], last.le)]).filter(q => q[1] > 0).sort((p, q) => q[1] - p[1])[0]?.[0];
    if (!run) { if (rows.length) break; continue; }
    // Where the row is still inside the body, the fin starts where the crown passes below it.
    let le = Math.max(run[0], xa - 0.2);
    while (le < run[1] && lerp(lines.top, le) > y - 0.02) le += d;
    if (run[1] - le < 0.3) { if (rows.length) break; continue; } // a probe or a rounded tip above the first full row
    // Stop where the trailing edge runs into the body: the row then follows the tail cone, not the fin.
    const prev = rows.at(-1);
    if (prev && ((rows.length * d > 0.4 && run[1] > prev.te + 0.5) || y < lerp(lines.top, Math.min(prev.te, s.xEnd)) + 0.05)) break; // the first rows are a rounded tip, which widens fast
    rows.push({ at: y, le, te: run[1] });
  }
  if (rows.length < 6) return null;
  // A tailplane on top of the fin shows edge-on as rows much longer than the fin below them.
  const H = rows[0].at - rows.at(-1).at;
  const midRows = rows.filter(r => r.at < rows[0].at - H * 0.25 && r.at > rows.at(-1).at + H * 0.3);
  let tee = null;
  if (midRows.length > 6) {
    const leL = lineFit(midRows.map(r => [r.at, r.le])), teL = lineFit(midRows.map(r => [r.at, r.te]));
    const wide = rows.filter(r => r.at > rows[0].at - H * 0.3 && (r.te > teL(r.at) + 0.5 || r.le < leL(r.at) - 0.5));
    if (wide.length * d > 0.12 && wide[0].at > rows[0].at - 0.3) {
      const y0 = wide.at(-1).at, y1 = wide[0].at;
      tee = { y: (y0 + y1) / 2, le: Math.min(...wide.map(r => r.le)), te: Math.max(...wide.map(r => r.te)) };
      rows.splice(0, rows.findIndex(r => r.at < y0 - d / 2));
      // The fin continues up to the tailplane along its own edges.
      rows.unshift({ at: tee.y, le: leL(tee.y), te: teL(tee.y) });
    }
  }
  return { rows, tee };
}

// ── Top view ───────────────────────────────────────────────────────────────

function readTop(t, xEnd) {
  const m = t.top, L = t.L, S = t.S, d = 1 / m.ppm;
  // Half-width of the run through the centerline, column by column (the narrower side, so a one-sided mark is ignored).
  const half = [];
  for (let i = 0; i < m.w; i++) {
    const x = m.U(i);
    const run = m.runsV(x).find(r => r[0] <= 0 && r[1] >= 0);
    half.push([x, run ? Math.min(run[1], -run[0]) : 0]);
  }
  // The body's width is the most common half-width along the length.
  const bins = new Map();
  for (const [x, w] of half) if (x > L * 0.08 && x < L * 0.92 && w > 0.2) { const k = Math.round(w / 0.03); bins.set(k, (bins.get(k) ?? 0) + 1); }
  let R = 0, cnt = 0;
  for (const [k, c] of bins) { const c3 = c + (bins.get(k - 1) ?? 0) + (bins.get(k + 1) ?? 0); if (c3 > cnt) { cnt = c3; R = k * 0.03; } }
  const clear = R * 1.04 + 0.03;
  // Plan half-width of the body: measured where nothing is attached, bridged elsewhere.
  const plan = half.filter(([x, w]) => x <= xEnd && w <= clear && w > 0);
  if (plan.at(-1)[0] < xEnd - 0.3) plan.push([xEnd, Math.min(0.2, R * 0.12)]);

  // Rows outboard of the body, tip to root. The wing is the run that reaches the tip.
  const rows = [];
  for (let z = S - d * 0.5; z > clear; z -= d) rows.push({ z, runs: m.runsU(z) });
  const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const follow = (startIdx, startRun) => {
    const out = [];
    let prev = startRun;
    for (let i = startIdx; i < rows.length; i++) {
      let pick = null, po = -0.3; // a raked tip can move more than its own length from one row to the next
      for (const r of rows[i].runs) { if (r.used) continue; const o = overlap(r, prev); if (o > po) { po = o; pick = r; } }
      if (!pick) break;
      pick.used = true;
      let le = pick[0];
      // A nacelle ahead of a swept leading edge often ends just short of it in this view:
      // what lies within 1.5 m ahead of the surface belongs to it (and shows as a bump).
      if (ahead) for (let q = rows[i].runs.indexOf(pick) - 1; q >= 0; q--) { const r = rows[i].runs[q]; if (r.used || le - r[1] > 1.5) break; r.used = true; le = r[0]; }
      out.push({ at: rows[i].z, le, te: pick[1] });
      prev = pick;
    }
    return out;
  };
  const first = rows.findIndex(r => r.runs.length);
  let ahead = true;
  const wing = follow(first, rows[first].runs.reduce((a, r) => (r[1] - r[0] > a[1] - a[0] ? r : a)));
  ahead = false;
  // Of what is left, the tailplane is the widest-spanning piece behind the wing; shorter
  // pieces beside the body are pods (rear engines).
  const others = [];
  for (let i = 0; i < rows.length; i++) for (const r of rows[i].runs) {
    if (r.used || r[1] - r[0] < 0.15) continue;
    const piece = follow(i, r);
    if (piece.length * d > 0.4) others.push(piece);
  }
  const span = p => p[0].at - p.at(-1).at;
  const xmid = p => median(p.map(r => (r.le + r.te) / 2));
  const wingX = xmid(wing);
  const long = p => Math.max(...p.map(r => r.te - r.le));
  // A pod is longer than it is wide; a tailplane is the other way round.
  const tails = others.filter(p => xmid(p) > wingX && span(p) > 1 && span(p) > long(p) * 0.8).sort((a, b) => span(b) - span(a));
  const stab = tails[0] ?? null;
  const pods = others.filter(p => p !== stab && span(p) > 0.6 && long(p) > 2 && span(p) < long(p) * 0.8);
  return { R, clear, plan, wing, stab, pods, d };
}

/** Planform sections from tracked rows: bumps taken off the edges, then reduced to the bends. */
function planformOf(rowsIn, d, opts = {}) {
  const rows = [...rowsIn].reverse(); // root to tip
  const le = debump(rows.map(r => r.le), d, -1, 0.35, opts.maxEngine ?? 5);
  const te = debump(rows.map(r => r.te), d, 1, 0.2, 2.2);
  const clean = rows.map((r, i) => ({ at: r.at, le: le.clean[i], te: te.clean[i] }));
  const engines = le.bumps.map(([a, b]) => {
    let inlet = Infinity;
    for (let i = a; i <= b; i++) inlet = Math.min(inlet, rows[i].le);
    return { z0: rows[a].at, z1: rows[b].at, z: (rows[a].at + rows[b].at) / 2, width: rows[b].at - rows[a].at, inlet, wingLe: (le.clean[a] + le.clean[b]) / 2 };
  }).filter(e => e.width > 0.6 && e.wingLe - e.inlet > 0.5);
  // Wide bumps behind the trailing edge are pods (gear fairings); narrow ones are flap track fairings and are left off.
  const pods = te.bumps.map(([a, b]) => {
    let tail = -Infinity;
    for (let i = a; i <= b; i++) tail = Math.max(tail, rows[i].te);
    return { z: (rows[a].at + rows[b].at) / 2, width: rows[b].at - rows[a].at, tail, wingTe: (te.clean[a] + te.clean[b]) / 2 };
  }).filter(q => q.width > 0.8 && q.tail - q.wingTe > 1.2);
  return { clean, engines, pods };
}

/**
 * Sections of a surface from its edge rows. Rows are a pixel apart and carry pixel noise;
 * real edges are straight between a few kinks. A running median takes out strays, an
 * average the stairs, and only bends of more than 10 cm are kept.
 */
function sectionsOf(rows) {
  const n = rows.length, k = Math.max(1, Math.round(n / 60));
  const pass = (key, f) => rows.map((r, i) => { const w = Math.min(k * 2, i, n - 1 - i); return f(rows.slice(i - w, i + w + 1).map(q => q[key])); });
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const med = { le: pass('le', median), te: pass('te', median) };
  const mid = rows.map((r, i) => ({ at: r.at, le: med.le[i], te: med.te[i] }));
  const sm = mid.map((r, i) => { const w = Math.min(k, i, n - 1 - i); const part = mid.slice(i - w, i + w + 1); return { at: r.at, le: mean(part.map(q => q.le)), te: mean(part.map(q => q.te)) }; });
  return bends(sm, ['le', 'te'], 0.1).map(r => ({ at: r2(r.at), le: r2(r.le), chord: r2(r.te - r.le) }));
}

// ── Front view ─────────────────────────────────────────────────────────────

function readFront(t, R) {
  const m = t.front, S = t.S, d = 1 / m.ppm;
  const gap = (a, b) => Math.max(a[0], b[0]) - Math.min(a[1], b[1]); // negative when they overlap
  const cols = [];
  for (let z = S - d * 0.5; z > 0; z -= d) cols.push({ z, runs: m.runsV(z) });
  // Follow a thin surface inward from its tip. A steep winglet moves more than its own
  // thickness from one column to the next, so the nearest run within 30 cm continues it.
  // Where the surface passes an engine, a leg or the body the run thickens; the thin
  // run before it stays the reference until the surface comes out the other side.
  const follow = (startIdx, startRun, stopZ) => {
    const out = [];
    let prev = startRun;
    for (let i = startIdx; i < cols.length && cols[i].z > stopZ; i++) {
      let pick = null, pg = 0.3;
      for (const r of cols[i].runs) { const g = gap(r, prev); if (g < pg) { pg = g; pick = r; } }
      if (!pick) break;
      pick.used = true;
      out.push({ z: cols[i].z, lo: pick[0], hi: pick[1] });
      if (pick[1] - pick[0] < 0.9) prev = pick;
      // An upright winglet is a tall run right at the tip: the wing carries on from its foot.
      else if (cols[startIdx].z - cols[i].z < S * 0.08) prev = [pick[0], pick[0] + 0.3];
    }
    return out;
  };
  const first = cols.findIndex(c => c.runs.length);
  const wing = first < 0 ? [] : follow(first, cols[first].runs[0], R * 0.9);
  // Body section: half-width by row, down from the top.
  const hw = [];
  for (let y = t.H; y > 0; y -= d) { const run = m.runsU(y).find(r => r[0] <= 0 && r[1] >= 0); hw.push([y, run ? Math.min(run[1], -run[0]) : 0]); }
  /** Tires seen from the front: what the row 12 cm above a leg's lowest point cuts. */
  const tiresAt = y => m.runsU(y + 0.12).map(r => ({ z: (r[0] + r[1]) / 2, w: r[1] - r[0] })).filter(q => q.w > 0.08 && q.w < 1.2);
  return { m, cols, wing, hw, tiresAt, follow, d };
}

/**
 * Height of a thin surface across the span from front view columns: its thin columns,
 * bridged over the thick ones, and a winglet where the tip rises off the line of the wing.
 */
function heightsOf(track, S) {
  if (track.length < 8) return null;
  const typical = median(track.map(c => c.hi - c.lo));
  const lim = Math.max(0.35, typical * 2.2);
  const pts = track.filter(c => c.hi - c.lo <= lim).map(c => [c.z, (c.lo + c.hi) / 2]).reverse();
  if (pts.length < 4) return null;
  const thin = track.filter(c => c.hi - c.lo <= lim).map(c => [c.z, c.hi - c.lo]).reverse();
  const inner = S ? pts.filter(p => p[0] > S * 0.5 && p[0] < S * 0.88) : [];
  if (inner.length > 8) {
    const line = robustLine(inner, 0.06);
    let k = 0; // track runs tip first
    while (k < track.length && track[k].hi > line.at(track[k].z) + 0.25 && track[k].z > S * 0.8) k++;
    const up = track.slice(0, k);
    if (k && Math.max(...up.map(c => c.hi)) - line.at(S) > 0.45) {
      const z0 = up.at(-1).z;
      const keep = pts.filter(p => p[0] < z0);
      keep.push([z0, line.at(z0)]);
      return { pts: keep, thick: typical, thin, winglet: { z0, base: line.at(z0), track: up.map(c => ({ z: c.z, y: (c.lo + c.hi) / 2, lo: c.lo, hi: c.hi })).reverse() } };
    }
  }
  return { pts, thick: typical, thin, winglet: null };
}

/** Where the body is widest and how square its upper half is, from the front view's half-widths by row. */
function sectionOf(hw, R, crownY, botY) {
  const rows = hw.filter(([y, w]) => y < crownY - 0.03 && w > R * 0.3 && w < R * 1.03); // narrower is the fin, wider a wing or tailplane
  let best = { mid: (crownY + botY) / 2, n: 2 }, err = Infinity;
  const H = crownY - botY;
  for (let mid = botY + H * 0.3; mid <= botY + H * 0.7; mid += 0.02) {
    const up = rows.filter(([y]) => y > mid + 0.05);
    if (up.length < 10) continue;
    for (let n = 1.8; n <= 3.6; n += 0.05) {
      let e = 0;
      for (const [y, w] of up) { const c = (y - mid) / (crownY - mid); e += (w / R - Math.max(0, 1 - c ** n) ** (1 / n)) ** 2; }
      e /= up.length;
      if (e < err) { err = e; best = { mid, n }; }
    }
  }
  return best;
}

// ── Assembly ───────────────────────────────────────────────────────────────

/**
 * Measure everything the three views show.
 * @param {{ L: number, H: number, S: number, side: Mask, top: Mask, front: Mask }} target
 */
export function measure(target) {
  // A sheet without a front view still fits: heights across the span then fall back to rules.
  // An aircraft is the same on both sides: the top and front views are folded about the
  // centerline, and only what both halves show is kept (a caption, a one-sided mark, noise go).
  const t = { ...target, side: closed(target.side), top: mirrored(closed(target.top), 'rows'), front: target.front ? mirrored(closed(target.front), 'cols') : blank('front', target, target.ppm) };
  const L = t.L;
  const s = readSide(t);
  const top = readTop(t, s.xEnd);
  const front = readFront(t, top.R);
  const R = top.R;

  // Wing and tailplane planforms from the top view, heights from the front view.
  const wingP = planformOf(top.wing, top.d);
  const wingH = heightsOf(front.wing, t.S);
  const wingY = s.belly.at(L * 0.4) + 0.3 * s.bodyH; // where a low wing sits, if the front view does not show it
  const hWing = z => (wingH ? lerp(wingH.pts, Math.max(z, wingH.pts[0][0])) : wingY);

  // A winglet: where the front view shows the tip rising, the top view rows out there are
  // its planform, each at the height the front view gives for that distance out.
  let winglet = null, wingRows = wingP.clean;
  if (wingH?.winglet) {
    const w = wingH.winglet;
    const outer = wingP.clean.filter(r => r.at >= w.z0);
    wingRows = wingP.clean.filter(r => r.at < w.z0);
    const yAt = z => lerp(w.track.map(c => [c.z, c.y]), z);
    const rows = outer.map(r => ({ at: yAt(r.at), h: r.at, le: r.le, te: r.te })).filter((r, i, a) => i === 0 || r.at > a[i - 1].at + 0.01);
    // An upright winglet rises over a few columns only: its height comes from the front view, its edges from the tip.
    const topY = Math.max(...w.track.map(c => c.hi));
    if (rows.length && topY - rows.at(-1).at > 0.25) { const lastR = rows.at(-1), c = lastR.te - lastR.le; rows.push({ at: topY, h: t.S - 0.03, le: lastR.le + c * 0.55, te: lastR.te + c * 0.1 }); }
    if (rows.length >= 2 && wingRows.length > 4) winglet = rows;
    else wingRows = wingP.clean;
  }
  const wing = { rows: wingRows, pods: wingP.pods, h: wingH?.pts ?? [[0, wingY]], thick: wingH?.thin ?? null };

  // Engines under the wing: seen ahead of the leading edge from above; how low they hang
  // from the front view, how far back they run from the side view.
  const skip = [];
  const engines = wingP.engines.map(e => {
    // Lowest point of the nacelle: the middle half of its width in the front view, where
    // the run that meets the wing ends (a leg behind it would reach the ground instead).
    const lows = front.cols.filter(c => Math.abs(c.z - e.z) < e.width * 0.25).map(c => c.runs.filter(r => r[1] > hWing(e.z) - e.width * 1.2 && r[0] > 0.15).map(r => r[0])).filter(v => v.length).map(v => Math.min(...v));
    const hang = s.hang.filter(h => h.x0 < e.wingLe + 1 && h.x1 > e.inlet).sort((a, b) => b.depth - a.depth)[0];
    if (hang) skip.push(hang.core);
    const dia = e.width;
    const bottom = lows.length ? median(lows) : hang ? hang.bottom : hWing(e.z) - dia - 0.2;
    const exit = hang ? Math.max(hang.core[1], e.inlet + dia * 1.3) : e.inlet + dia * 1.9;
    return { z: e.z, dia, inlet: e.inlet, exit, bottom, wingLe: e.wingLe };
  });
  // Engines beside the rear fuselage: pods in the top view, their height from the front
  // view, where each is a round blob that is neither the wing nor the tailplane.
  const rear = top.pods.map(p => {
    const long = Math.max(...p.map(r => r.te - r.le));
    const body = p.filter(r => r.te - r.le > long * 0.8); // the pylon rows are shorter
    const z0 = body.at(-1).at, z1 = body[0].at, z = (z0 + z1) / 2, dia = z1 - z0;
    // Of the runs about the right size in each column, the tallest: a wing root edge-on can pass for a small one, and the
    // width seen from above is short of the nacelle (the body hides its inner side).
    const blobs = front.cols.filter(c => Math.abs(c.z - z) < dia * 0.2).map(c => c.runs.filter(r => r[1] - r[0] > dia * 0.6 && r[1] - r[0] < dia * 1.6 && r[0] > 0.3).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]).filter(Boolean);
    if (!blobs.length) return null;
    // The inner side of the nacelle is hidden by the body from above: the front view gives its full height.
    const full = Math.max(dia, median(blobs.map(r => r[1] - r[0])));
    return { z: z1 - full / 2, dia: full, inlet: Math.min(...body.map(r => r.le)), exit: Math.max(...body.map(r => r.te)), y: median(blobs.map(r => (r[0] + r[1]) / 2)), inner: p.at(-1).at };
  }).filter(Boolean);
  const lines = bodyLines(s, skip);
  const fin = readFin(s, lines);

  // Tailplane height: on the fin if the side view shows it there, else from the front view.
  const stab = top.stab ? { rows: planformOf(top.stab, top.d, { maxEngine: 0.01 }).clean, h: null } : null;
  if (stab) {
    const tipZ = stab.rows.at(-1).at;
    if (fin?.tee) stab.h = [[0, fin.tee.y]];
    else {
      // In the front view the tailplane is a second thin run inboard of its tip, not the wing's.
      const rootX = stab.rows[0].le;
      const yGuess = lerp(lines.top, rootX) - 0.35 * (lerp(lines.top, rootX) - lerp(lines.bot, rootX));
      const i0 = front.cols.findIndex(c => c.z < tipZ - 0.15);
      const cand = i0 < 0 ? [] : front.cols[i0].runs.filter(r => !r.used && r[1] - r[0] < 1);
      const pick = cand.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - yGuess) - Math.abs((b[0] + b[1]) / 2 - yGuess))[0];
      const h = pick ? heightsOf(front.follow(i0, pick, R * 0.5), 0) : null;
      stab.h = h ? h.pts : [[0, yGuess]];
    }
  }

  // Body cross-section from the front view: where it is widest, and how square the upper half is.
  const ahead = lines.top.filter(p => p[0] < (s.fin ? s.X(s.fin.a) : L));
  const crownY = Math.max(...ahead.map(p => p[1]));
  const xMax = ahead.find(p => p[1] >= crownY - 0.02)?.[0] ?? L * 0.3;
  const botY = lerp(lines.bot, xMax);
  const sec = sectionOf(front.hw, R, crownY, botY);

  // Gear: legs along the length from the side view, across from the front view.
  const noseLeg = s.legs.find(g => g.x < L * 0.3) ?? null;
  const mainLegs = s.legs.filter(g => g.x >= L * 0.3);
  const inner = Math.max(0.55, R * 0.3);
  const centerTires = noseLeg ? front.tiresAt(noseLeg.bottom).filter(w => Math.abs(w.z) < inner) : [];
  const sideTires = front.tiresAt(mainLegs.length ? Math.min(...mainLegs.map(g => g.bottom)) : 0).filter(w => w.z >= inner);
  const gearGroups = [];
  for (const w of sideTires.sort((a, b) => a.z - b.z)) { const g = gearGroups.at(-1); if (g && w.z - g.at(-1).z < 1.6) g.push(w); else gearGroups.push([w]); }

  return { L, H: t.H, S: t.S, R, xEnd: s.xEnd, top: lines.top, bot: lines.bot, plan: top.plan, midRatio: (crownY - sec.mid) / (crownY - botY), nTop: sec.n, wing, winglet, stab, fin: fin ? { rows: [...fin.rows].reverse(), tee: fin.tee } : null, engines, rear, noseLeg, mainLegs, centerTires, gearGroups };
}

const NACELLE = [[0, 0.86], [0.04, 0.95], [0.18, 1], [0.5, 1], [0.78, 0.86], [1, 0.6]];

/**
 * Turn measurements into the geometry block of a parametric model.
 * @param {ReturnType<typeof measure>} m
 */
export function geometryFrom(m, { engineName = 'Engine' } = {}) {
  const { L, R } = m;
  const xEnd = m.xEnd;
  // A fuselage is a nose, a constant section and a tail: along the constant section the
  // crown and the belly are straight lines, so readings within 8 cm of them are put on them.
  const straight = pts => {
    const mid = pts.filter(p => p[0] > L * 0.15 && p[0] < L * 0.7);
    if (mid.length < 20) return pts;
    const line = robustLine(mid, 0.05);
    return pts.map(([x, y]) => [x, Math.abs(y - line.at(x)) < 0.08 ? line.at(x) : y]);
  };
  const lines = { top: straight(m.top), bot: straight(m.bot) };
  const held = (pts, z) => lerp(pts, Math.max(z, pts[0][0]));
  const hWing = z => held(m.wing.h, z);
  // Thickness: what the front view shows of the wing edge-on, less a few percent of chord for incidence.
  // Read over a tenth of the span at a time, so one odd column cannot put a ridge in the wing.
  const tcWing = z => {
    if (!m.wing.thick || m.wing.rows.length < 6) return 0.11;
    const chordAt = q => { const r = m.wing.rows.reduce((a, c) => (Math.abs(c.at - q) < Math.abs(a.at - q) ? c : a)); return r.te - r.le; };
    const z0 = R * 1.3, z1 = m.wing.rows.at(-1).at, w = (z1 - z0) * 0.05;
    const around = Array.from({ length: 9 }, (_, i) => Math.min(z1, Math.max(z0, z - w + (i / 8) * 2 * w)));
    return Math.min(0.15, Math.max(0.07, median(around.map(q => lerp(m.wing.thick, q) / chordAt(q) - 0.03))));
  };
  // Stations: dense at the nose and tail, as the mesh converter spaces them.
  const stations = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const x = (xEnd * (1 - Math.cos((Math.PI * i) / N))) / 2;
    const top = lerp(lines.top, x), bot = lerp(lines.bot, x);
    if (i === 0) { const y = (lerp(lines.top, 0.05) + lerp(lines.bot, 0.05)) / 2; stations.push([0, 0, r2(y), r2(y), r2(y)]); continue; }
    const w = i === N ? Math.min(lerp(m.plan, x), (top - bot) / 2 + 0.05) : Math.min(R, lerp(m.plan, x));
    stations.push([r2(x), r2(w), r2(top), r2(bot), r2(top - (top - bot) * m.midRatio)]);
  }
  const bodyAt = x => ({ top: lerp(lines.top, x), bot: lerp(lines.bot, x), w: lerp(m.plan, x) });

  const stub = (plan, inner) => (plan[0].at > inner ? [{ ...plan[0], at: r2(inner) }, ...plan] : plan);
  const wingSecs = stub(sectionsOf(m.wing.rows).map(q => ({ ...q, h: r2(hWing(q.at)), tc: r3(tcWing(q.at, q.chord)) })), 0.3);
  const surfaces = [{
    axis: 'z', mirror: true, camber: 0.02, camberAt: 0.4, sections: wingSecs,
    segments: [{ from: wingSecs[0].at, to: wingSecs.at(-1).at, split: [[0, 1, 'box']] }],
    parts: { box: { id: 'wing', label: 'Wing', system: 'surfaces' } },
  }];
  if (m.stab) {
    const secs = stub(sectionsOf(m.stab.rows).map(q => ({ ...q, h: r2(held(m.stab.h, q.at)), tc: 0.09 })), 0.2);
    surfaces.push({
      axis: 'z', mirror: true, sections: secs,
      segments: [{ from: secs[0].at, to: secs.at(-1).at, split: [[0, 1, 'stab']] }],
      parts: { stab: { id: 'stabilizer', label: 'Horizontal stabilizer', system: 'surfaces' } },
    });
  }
  if (m.fin) {
    const secs = sectionsOf(m.fin.rows).map(q => ({ ...q, h: 0, tc: 0.1 }));
    const root = secs[0];
    const base = Math.min(bodyAt(root.le).top, bodyAt(Math.min(root.le + root.chord, xEnd)).top) - 0.4;
    const all = stub(secs, base);
    surfaces.push({
      axis: 'y', mirror: false, sections: all,
      segments: [{ from: all[0].at, to: all.at(-1).at, split: [[0, 1, 'fin']] }],
      parts: { fin: { id: 'fin', label: 'Vertical stabilizer', system: 'surfaces' } },
    });
  }
  if (m.winglet) {
    const secs = bends(m.winglet, ['le', 'te', 'h'], 0.05).map(r => ({ at: r2(r.at), le: r2(r.le), chord: r2(Math.max(0.08, r.te - r.le)), h: r2(r.h), tc: 0.08 }));
    surfaces.push({
      axis: 'y', mirror: true, sections: secs,
      segments: [{ from: secs[0].at, to: secs.at(-1).at, split: [[0, 1, 'winglet']] }],
      parts: { winglet: { id: 'winglet', label: 'Winglet', system: 'surfaces' } },
    });
  }

  const wingAt = (k, z) => lerp(wingSecs.map(q => [q.at, q[k]]), z);
  // Engines under one wing are the same engine: one diameter and one length for all,
  // taken across the readings. Only where each hangs differs.
  const engDia = median(m.engines.map(e => e.dia)), engLen = Math.min(engDia * 2.4, Math.max(engDia * 1.4, median(m.engines.map(e => e.exit - e.inlet)))); // a turbofan nacelle is about twice as long as it is wide
  const engines = m.engines.map((e, i, list) => {
    const r = engDia / 2, len = engLen, y = e.bottom + r, zc = e.z;
    void zc;
    const st = NACELLE.map(([f, k]) => [r2(f * len), r2(r * k), r2(r * k), r2(-r * k), 0]);
    const top = y + r, wingLow = wingAt('h', e.z) - 0.1;
    const le = r2(Math.max(e.inlet + len * 0.15, e.wingLe - len * 0.5));
    return {
      name: engineName, mirror: true,
      id: list.length > 1 ? (i === 0 ? 'inner-engine' : 'outer-engine') : undefined,
      label: list.length > 1 ? (i === 0 ? 'Inner engine' : 'Outer engine') : undefined,
      position: { x: r2(e.inlet), y: r2(y), z: r2(e.z) },
      nacelle: { nTop: 2, nBot: 2, stations: st },
      fan: { radius: r2(r * 0.86 * 0.82), depth: r2(Math.min(0.6, len * 0.1)) },
      plug: [[r2(len - 0.2), r2(r * 0.36)], [r2(len + 0.1), r2(r * 0.27)], [r2(len + 0.5), 0.03]],
      pylon: { axis: 'y', sections: [{ at: r2(top - 0.2), le, chord: r2(len * 0.8), h: r2(e.z), tc: 0.14 }, { at: r2(Math.max(wingLow, top + 0.25)), le: r2(le + 0.4), chord: r2(len * 0.85), h: r2(e.z), tc: 0.14 }] },
    };
  });

  for (const e of m.rear) {
    const r = e.dia / 2, len = e.exit - e.inlet;
    engines.push({
      name: engineName, mirror: true,
      position: { x: r2(e.inlet), y: r2(e.y), z: r2(e.z) },
      nacelle: { nTop: 2, nBot: 2, stations: NACELLE.map(([f, k]) => [r2(f * len), r2(r * k), r2(r * k), r2(-r * k), 0]) },
      fan: { radius: r2(r * 0.86 * 0.82), depth: r2(Math.min(0.6, len * 0.1)) },
      plug: [[r2(len - 0.2), r2(r * 0.36)], [r2(len + 0.1), r2(r * 0.27)], [r2(len + 0.5), 0.03]],
      pylon: { axis: 'z', sections: [{ at: r2(Math.min(R * 0.8, e.z - r)), le: r2(e.inlet + len * 0.3), chord: r2(len * 0.5), h: r2(e.y), tc: 0.12 }, { at: r2(e.z - r * 0.6), le: r2(e.inlet + len * 0.32), chord: r2(len * 0.46), h: r2(e.y), tc: 0.12 }] },
    });
  }
  // Pods on the wing behind the trailing edge (gear fairings): as far under the wing as they reach behind it.
  const pods = m.wing.pods.map((q, i, list) => {
    const r = q.width / 2, x0 = q.wingTe - (q.tail - q.wingTe) * 1.2, len = q.tail - x0, y = wingAt('h', q.z) - r * 0.25;
    return { id: list.length > 1 ? `wing-pod-${i + 1}` : 'gear-pod', label: list.length > 1 ? `Wing pod ${i + 1}` : 'Main gear pod', system: list.length > 1 ? 'structure' : 'gear', mirror: true, position: { x: r2(x0), y: 0, z: r2(q.z) }, nTop: 2, nBot: 2.2,
      stations: [[0, 0.05, 0.05], [0.18, 0.9, 0.9], [0.6, 1, 1], [0.9, 0.55, 0.55], [1, 0.05, 0.05]].map(([f, kw, kh]) => [r2(f * len), r2(r * kw), r2(y + r * kh), r2(y - r * kh), r2(y)]) };
  });

  // Gear. Tire width and wheel count across come from the front view where it shows them.
  // Every wheel stands on the ground, whatever the source did with an unloaded leg.
  const leg = (g, tires, top) => {
    const n = Math.max(1, tires.length);
    const zs = tires.map(w => w.z).sort((a, b) => a - b);
    return { x: g.x, tire: { d: g.d, w: r2(tires.length ? median(tires.map(w => w.w)) : g.d * 0.32) }, wheels: n, spacing: r2(n > 1 ? (zs.at(-1) - zs[0]) / (n - 1) : 0.4), ...(g.axles > 1 ? { axles: g.axles, axleSpacing: g.axleSpacing } : {}), strut: r2(Math.max(0.12, g.d * 0.26)), top: r2(top), bottom: 0 };
  };
  const gear = {};
  if (m.noseLeg) gear.nose = leg(m.noseLeg, m.centerTires.slice(0, 2), bodyAt(m.noseLeg.x).bot + 0.35);
  // Legs across (front view groups) pair with legs along (side view): outer legs sit further forward.
  const along = [...m.mainLegs].sort((a, b) => a.x - b.x), across = [...m.gearGroups].sort((a, b) => b[0].z - a[0].z);
  const count = Math.max(1, Math.min(along.length || 1, across.length || 1));
  gear.mains = [];
  for (let i = 0; i < count; i++) {
    const g = along[Math.min(i, along.length - 1)] ?? { x: r2(L * 0.5), d: 1, axles: 1, axleSpacing: 0 };
    const grp = across[Math.min(i, across.length - 1)] ?? [];
    // Without a front view of the legs: in the pods behind the wing if it has them, else just outside the body.
    const z = grp.length ? grp.reduce((q, w) => q + w.z, 0) / grp.length : (m.wing.pods[0]?.z ?? R * 1.2);
    const onWing = z > R * 0.95;
    gear.mains.push({ ...leg(g, grp, onWing ? wingAt('h', z) - 0.1 : bodyAt(g.x).bot + 0.35), z: r2(z), id: count > 1 ? (onWing ? 'wing-gear' : 'body-gear') : 'main-gear', label: count > 1 ? (onWing ? 'wing gear' : 'body gear') : 'main gear' });
  }

  // Main gear the picture cannot be trusted on (a leg hidden behind an engine reads as a
  // stray wheel) is placed where main gear goes: under the wing root at 60% chord, a tenth
  // of the span out unless the front view shows it, on wheels sized to the aircraft.
  const rootSec = wingSecs.find(q => q.at >= R) ?? wingSecs[0];
  const span = 2 * wingSecs.at(-1).at, wheel = Math.min(1.4, Math.max(0.6, L * 0.022));
  gear.mains = gear.mains.map(q => {
    const f = (q.x - rootSec.le) / rootSec.chord;
    const xOk = f >= 0.3 && f <= 1.15, dOk = q.tire.d >= Math.max(0.45, L * 0.018), zOk = q.z >= 0.4 && q.z <= span * 0.25;
    if (xOk && dOk && zOk) return q;
    const d = dOk ? q.tire.d : r2(wheel), z = zOk ? q.z : r2(Math.max(R * 1.3, span * 0.1)), x = xOk ? q.x : r2(rootSec.le + rootSec.chord * 0.6);
    const bogie = L > 45;
    return { ...q, x, z, byRule: true, tire: { d, w: r2(d * 0.36) }, wheels: 2, spacing: r2(d * 0.85), ...(bogie ? { axles: 2, axleSpacing: r2(d * 1.25) } : {}), strut: r2(Math.max(0.12, d * 0.26)), top: r2(z > R * 0.95 ? wingAt('h', z) - 0.1 : bodyAt(x).bot + 0.35), bottom: 0 };
  });
  // Legs across pair up one to one; two readings that land on the same spot are one leg.
  gear.mains = gear.mains.filter((q, i, a) => a.findIndex(p => Math.abs(p.x - q.x) < 1 && Math.abs(p.z - q.z) < 0.6) === i);
  if (gear.mains.length === 1) { gear.mains[0].id = 'main-gear'; gear.mains[0].label = 'main gear'; }

  const tip = wingSecs.at(-1);
  return {
    length: r2(xEnd),
    fuselage: { nTop: r2(m.nTop), nBot: 2, stations },
    surfaces, engines, gear, ...(pods.length ? { pods } : {}),
    navLights: { wingtip: { x: r2(tip.le + tip.chord * 0.3), y: tip.h, z: tip.at }, tail: { x: r2(xEnd - 0.1), y: r2((bodyAt(xEnd - 0.3).top + bodyAt(xEnd - 0.3).bot) / 2) } },
  };
}

/**
 * One step of the closed loop. `want` is what was read from the target, `got` what the
 * same reader finds in the model built from `cur`. Whatever the reader or the builder
 * gets systematically wrong shows up as the difference, and is taken off `cur`.
 * Steps are capped so a part that one reading has and the other lacks cannot run away,
 * and may be taken as a fraction (alpha) of the difference.
 */
export function correct(cur, want, got, cap = 0.4, alpha = 1) {
  const lim = v => Math.max(-cap, Math.min(cap, Number.isFinite(v) ? v * alpha : 0));
  const line = (c, a, b) => (a && b ? c.map(([x, y]) => [x, y + lim(lerp(a, x) - lerp(b, x))]) : c);
  const col = (rows, k) => rows.map(r => [r.at, r[k]]);
  const edges = (c, a, b) => (a?.length > 1 && b?.length > 1 ? c.map(r => ({ ...r, le: r.le + lim(lerp(col(a, 'le'), r.at) - lerp(col(b, 'le'), r.at)), te: r.te + lim(lerp(col(a, 'te'), r.at) - lerp(col(b, 'te'), r.at)) })) : c);
  const each = (c, a, b, keys) => (a.length === b.length ? c.map((e, i) => ({ ...e, ...Object.fromEntries(keys.map(k => [k, e[k] + lim(a[i][k] - b[i][k])])) })) : c);
  return {
    ...cur,
    top: line(cur.top, want.top, got.top),
    bot: line(cur.bot, want.bot, got.bot),
    plan: line(cur.plan, want.plan, got.plan).map(([x, w]) => [x, Math.max(0.02, w)]),
    wing: { ...cur.wing, rows: edges(cur.wing.rows, want.wing.rows, got.wing.rows), h: line(cur.wing.h, want.wing.h, got.wing.h), thick: cur.wing.thick && line(cur.wing.thick, want.wing.thick, got.wing.thick) },
    stab: cur.stab && got.stab ? { ...cur.stab, rows: edges(cur.stab.rows, want.stab.rows, got.stab.rows), h: line(cur.stab.h, want.stab.h, got.stab.h) } : cur.stab,
    fin: cur.fin && got.fin ? { ...cur.fin, rows: edges(cur.fin.rows, want.fin.rows, got.fin.rows) } : cur.fin,
    engines: each(cur.engines, want.engines, got.engines, ['z', 'dia', 'inlet', 'exit', 'bottom']),
    rear: each(cur.rear, want.rear, got.rear, ['z', 'dia', 'inlet', 'exit', 'y']),
  };
}
