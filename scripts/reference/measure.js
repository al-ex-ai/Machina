// Measure an aircraft from an orthographic reference drawing and write the results,
// with where each value came from, to references/<id>/measured.json.
// Usage: node scripts/reference/measure.js references/b737-300
//
// Coordinates: x from the nose tip aft, y up, in meters. The drawing shows the
// aircraft in its ground attitude; values are converted to level body axes using
// the slope of the cabin window line, and the attitude is recorded so the builder
// can sit the model on its gear the same way.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPNG } from './png.js';
import { viewOf, hull, simplify } from './trace.js';

const dir = process.argv[2];
const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'));
const img = readPNG(readFileSync(join(dir, ref.image)));
const P = ref.published;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const inSkip = (x, list) => list?.some(([a, b]) => x >= a && x <= b);
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

// ── Side view ─────────────────────────────────────────────────────────────
const sv = ref.views.side;
const side = viewOf(img, sv.box);
const SB = side.bounds();
const s = P.length / (SB.maxX - SB.minX + 1); // meters per pixel, calibrated on overall length
const gy = sv.ground - sv.box[1];
const X = px => (px - SB.minX + 0.5) * s;
const Y = py => (gy + 1 - py) * s;
const PX = x => Math.round(SB.minX + x / s - 0.5);
const PY = y => Math.round(gy + 1 - y / s);

const holes = side.holes(6).map(h => ({ ...h, x: X(h.cx), y: Y(h.cy), w: (h.maxX - h.minX + 1) * s, h: (h.maxY - h.minY + 1) * s }));
const FW = ref.fuselage;
const [wy0, wy1] = FW.windowY ?? [3.4, 5.4];
const windows = holes.filter(h => h.area * s * s >= 0.035 && h.area * s * s <= 0.11 && h.h > h.w * 1.2 && h.y > wy0 && h.y < wy1 && h.x > (FW.windowsAfter ?? 4) && h.x < (FW.windowsBefore ?? Infinity));
// Attitude: least-squares slope of the window centers.
const mx = windows.reduce((a, w) => a + w.x, 0) / windows.length, my = windows.reduce((a, w) => a + w.y, 0) / windows.length;
const slope = windows.reduce((a, w) => a + (w.x - mx) * (w.y - my), 0) / windows.reduce((a, w) => a + (w.x - mx) ** 2, 0);
const att = Math.atan(slope);
const toBody = (x, y) => [x * Math.cos(att) + y * Math.sin(att), -x * Math.sin(att) + y * Math.cos(att)];

// Line width: median vertical ink run along the cabin roof.
const runs = [];
for (let x = 6; x <= 10; x += 0.25) {
  const px = PX(x);
  let y = 0; while (y < side.h && !side.ink[y * side.w + px]) y++;
  let n = 0; while (y + n < side.h && side.ink[(y + n) * side.w + px]) n++;
  if (n) runs.push(n);
}
const line = median(runs) * s;

// Fuselage top and bottom, column by column, in body axes.
const F = ref.fuselage;
const windowY = x => my + (x - mx) * slope;
const tops = [], bots = [];
for (let px = SB.minX; px <= SB.maxX; px++) {
  const x = X(px);
  let r = null;
  for (const dy of [-0.5, -0.2, -0.8, 0, -1.1, 0.3]) { r = side.runV(px, PY(windowY(x) + dy)); if (r) break; }
  if (!r) continue;
  const t = toBody(x, Y(r[0] - 0.5)), b = toBody(x, Y(r[1] + 0.5));
  if (!inSkip(x, F.topSkip)) tops.push(t);
  if (!inSkip(x, F.bottomSkip)) bots.push(b);
}
// Tail cone tip: the rearmost inked column, its vertical center (where the stabilizer
// does not reach), in body axes. Profiles end there.
const tail = F.tailTip
  ? { x: F.tailTip.x, y: F.tailTip.y, half: F.tailTip.half, estimated: F.tailTip.note }
  : (() => {
      const px = SB.maxX;
      let a = -1, b = -1;
      for (let py = 0; py < side.h; py++) if (side.solid(px, py)) { if (a < 0) a = py; b = py; }
      const [x, y] = toBody(X(px), Y((a + b) / 2));
      return { x, y, half: ((b - a + 1) / 2) * s };
    })();
tops.push([tail.x, tail.y + tail.half]);
bots.push([tail.x, tail.y - tail.half]);
const interp = (pts, x) => {
  let i = pts.findIndex(p => p[0] >= x);
  if (i < 0) return pts.at(-1)[1];
  if (i === 0) return pts[0][1];
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
};

// ── Top view: plan half-width, normalized to the published fuselage width ──
const tv = ref.views.top;
const top = viewOf(img, tv.box);
const TB = top.bounds();
const st = P.length / (TB.maxX - TB.minX + 1);
const TX = px => (px - TB.minX + 0.5) * st;
const midCol = TB.minX + Math.round(7 / st);
const cRun = top.runV(midCol, Math.round((TB.minY + TB.maxY) / 2));
const cRow = Math.round((cRun[0] + cRun[1]) / 2);
const plan = [];
for (let px = TB.minX; px <= TB.maxX; px++) {
  const x = TX(px);
  if (inSkip(x, F.planSkip)) continue;
  const r = top.runV(px, cRow);
  if (r) plan.push([x, (r[1] - r[0] + 1) / 2]);
}
plan.push([P.length, (tail.half / st) * s]); // tail cone tip: as wide as it is tall
const planMax = Math.max(...plan.filter(([x]) => x > 5 && x < 11).map(p => p[1]));
const halfWidth = x => (interp(plan, x) / planMax) * (P.fuselageWidth / 2);

// ── Front view: upper cross-section shape, wing and stabilizer heights ──
const fv = ref.views.front;
let upper = null, upperHeight = null, midRatio = F.midRatio ?? 0.5, sf = null, hMid = null;
const fuselageHeight = interp(tops, F.measureAt ?? 8) - interp(bots, F.measureAt ?? 8);
if (fv && F.frontRows) {
  const front = viewOf(img, fv.box);
  const FB = front.bounds();
  sf = P.span / (FB.maxX - FB.minX + 1);
  const cx = Math.round((FB.minX + FB.maxX) / 2);
  const rows = F.frontRows, rTop = rows.top - fv.box[1], rMid = rows.mid - fv.box[1];
  const halfAt = row => { const r = front.runH(cx, row); return r ? (r[1] - r[0] + 1) / 2 : 0; };
  hMid = halfAt(rMid);
  upper = [];
  for (let row = rTop; row <= rMid; row++) {
    if (inSkip(row + fv.box[1], rows.skip)) continue;
    upper.push([r3((rMid - row) / (rMid - rTop)), r3(Math.min(1, halfAt(row) / hMid))]);
  }
  upper.push([1, 0]);
  upper.sort((a, b) => a[0] - b[0]);
  upperHeight = (rMid - rTop) * sf; // meters from the widest point to the crown
  midRatio = Math.min(0.9, upperHeight / fuselageHeight);
}

const stations = F.stations.map(x => {
  const t = interp(tops, x), b = interp(bots, x);
  const w = x === 0 ? 0 : halfWidth(x);
  return [x, r2(w), r2(t), r2(b), r2(t - (t - b) * midRatio)];
});
stations[0][3] = stations[0][2] = stations[0][4] = r2((interp(tops, 0.02) + interp(bots, 0.02)) / 2);

// ── Openings ──
const grow = line; // holes are measured inside the ink; the opening edge is about one line width out
const body = h => { const [x, y] = toBody(h.x, h.y); return { x: r2(x), y: r2(y), w: r2(h.w + grow), h: r2(h.h + grow) }; };
const doors = holes.filter(h => h.h > 1.5 && h.h < 2.1 && h.w > 0.55 && h.w < 1.0 && h.y > (FW.doorMinY ?? 2.5) && h.y < wy1).map(body);
const exits = holes.filter(h => h.h > 0.7 && h.h < 1.05 && h.w > 0.3 && h.w < 0.6 && h.y > (FW.doorMinY ?? 2.5) + 0.5 && h.y < wy1).map(body);
const windshield = holes.filter(h => h.x < (FW.windshieldX ?? 3.2) && h.y > (FW.windshieldMinY ?? 3.4) && h.area * s * s >= 0.02).map(h => {
  const pts = h.pts.map(k => { const px = k % side.w, py = (k - px) / side.w; return [X(px), Y(py)]; });
  return simplify(hull(pts), 4).map(([x, y]) => toBody(x, y).map(r2));
});

// ── Fin outline: leading and trailing edge per height, above the fuselage crown ──
const fin = [];
const finTopPx = (() => { for (let py = 0; py < side.h; py++) for (let px = PX(ref.fin?.fromX ?? 24); px <= SB.maxX; px++) if (side.solid(px, py)) return py; return 0; })();
const crown = interp(tops, 27);
for (let y = Math.min(Y(finTopPx) - 0.02, ref.fin?.maxY ?? Infinity); y > (ref.fin?.minY ?? 4.9); y -= 0.25) {
  const py = PY(y);
  let le = -1, te = -1;
  for (let px = PX(ref.fin?.searchFrom ?? 18); px <= SB.maxX; px++) if (side.solid(px, py)) { if (le < 0) le = px; te = px; }
  if (le < 0) continue;
  const a = toBody(X(le - 0.5), y), b = toBody(X(te + 0.5), y);
  fin.push({ y: r2((a[1] + b[1]) / 2), le: r2(a[0]), te: r2(b[0]) });
}

// ── Engine, wheels: from the side view below the fuselage ──
const lowest = (x0, x1) => {
  let best = -1, at = 0;
  for (let x = x0; x <= x1; x += s) { const px = PX(x); for (let py = gy; py >= 0; py--) if (side.solid(px, py)) { if (py > best) { best = py; at = x; } break; } }
  return { x: at, y: Y(best + 0.5) };
};
const nacelle = ref.nacelle === false ? null : (() => {
  let x0 = Infinity, x1 = -Infinity;
  const engineBottom = lowest(10.5, 13.5);
  const py = PY(engineBottom.y + 0.4);
  // Walk out from the engine's lowest point along a row just above it; stop at the first gap.
  for (let x = engineBottom.x; side.solid(PX(x), py); x -= s) x0 = x;
  for (let x = engineBottom.x; side.solid(PX(x), py); x += s) x1 = x;
  const [bx, by] = toBody(engineBottom.x, engineBottom.y);
  return { inletX: r2(toBody(x0, engineBottom.y + 0.4)[0]), exitX: r2(toBody(x1, engineBottom.y + 0.4)[0]), bottom: r2(by), bottomAt: r2(bx), clearance: r2(engineBottom.y) };
})();
const wheelX = (x0, x1) => {
  const xs = [];
  for (let x = x0; x <= x1; x += s) { const px = PX(x); const wr = gy - (sv.wheelRow ?? 0); if (side.solid(px, wr) || side.solid(px, wr - 1)) xs.push(x); }
  return xs.length ? (xs[0] + xs.at(-1)) / 2 : null;
};
const noseWheel = wheelX(...(ref.gear?.nose ?? [2, 6])), mainWheel = wheelX(...(ref.gear?.main ?? [14, 19]));
const groundAt = x => r2(toBody(x, 0)[1]);

// ── Top view planforms: straight-line fits to each panel's edges ──
const tz = P.span / (TB.maxY - TB.minY + 1); // spanwise meters per pixel in the top view
const TZ = py => (cRow - py) * tz; // + is left
const edgeRows = (z0, z1, x0, x1) => {
  const rowsOut = [];
  for (let z = z0; z <= z1; z += tz) {
    const py = Math.round(cRow - z / tz);
    let le = -1, te = -1;
    for (let px = Math.round(TB.minX + x0 / st); px <= TB.minX + x1 / st; px++) if (top.solid(px, py)) { if (le < 0) le = px; te = px; } else if (le >= 0) break;
    if (le >= 0) rowsOut.push({ z, le: TX(le - 0.5), te: TX(te + 0.5) });
  }
  return rowsOut;
};
// Least-squares line x = a + b z, refitted after dropping rows more than tol off (engines, fairings).
const fit = (pts, key, tol = 0.12) => {
  let use = pts;
  for (let k = 0; k < 4; k++) {
    const n = use.length, mz = use.reduce((q, p) => q + p.z, 0) / n, mv = use.reduce((q, p) => q + p[key], 0) / n;
    const b = use.reduce((q, p) => q + (p.z - mz) * (p[key] - mv), 0) / use.reduce((q, p) => q + (p.z - mz) ** 2, 0);
    const a = mv - b * mz;
    const keep = pts.filter(p => Math.abs(p[key] - (a + b * p.z)) < tol);
    if (keep.length === use.length || keep.length < 5) return { a, b, at: z => a + b * z };
    use = keep;
  }
  const n = use.length, mz = use.reduce((q, p) => q + p.z, 0) / n, mv = use.reduce((q, p) => q + p[key], 0) / n;
  const b = use.reduce((q, p) => q + (p.z - mz) * (p[key] - mv), 0) / use.reduce((q, p) => q + (p.z - mz) ** 2, 0);
  return { a: mv - b * mz, b, at: z => mv - b * mz + b * z };
};
const W = ref.wing;
const inner = edgeRows(W.inner[0], W.inner[1], ...(W.x ?? [8, 23])), outer = edgeRows(W.outer[0], W.outer[1], ...(W.x ?? [8, 23]));
const leIn = fit(inner, 'le'), teIn = fit(inner, 'te'), leOut = fit(outer, 'le'), teOut = fit(outer, 'te');
const kinkZ = (teOut.a - teIn.a) / (teIn.b - teOut.b);
const tipRow = (() => { const rs = edgeRows(W.outer[1], P.span / 2 + 0.5, ...(W.x ?? [8, 23])); return rs.at(-1); })();
const wingAt = z => (z <= kinkZ ? { le: leIn.at(z), te: teIn.at(z) } : { le: leOut.at(z), te: teOut.at(z) });
const wingPlan = [W.root, P.fuselageWidth / 2, kinkZ, P.span / 2].map(z => { const e = wingAt(Math.min(z, P.span / 2)); return { z: r2(z), le: r2(e.le), chord: r2(e.te - e.le) }; });
const S = ref.stabilizer;
const stabRows = edgeRows(S.span[0], S.span[1], S.fromX ?? 26, P.length);
const leS = fit(stabRows, 'le'), teS = fit(stabRows, 'te');
const stabPlan = [S.root, S.span[1]].map(z => ({ z: r2(z), le: r2(leS.at(z)), chord: r2(teS.at(z) - leS.at(z)) }));
// Engine: rows where the solid run starts well ahead of the wing leading edge.
const engRows = ref.nacelle === false ? [] : edgeRows(2.5, 7.5, 8, 23).filter(r => r.le < wingAt(r.z).le - 0.6);
const engineZ = engRows.length ? r2((engRows[0].z + engRows.at(-1).z) / 2) : null;
// Stabilizer tip height: the side view's rearmost inked column is the stabilizer tip.
const stabTip = (() => {
  const px = SB.maxX; let a = -1, b = -1;
  for (let py = 0; py < side.h; py++) if (side.solid(px, py)) { if (a < 0) a = py; b = py; }
  return toBody(X(px), Y((a + b) / 2));
})();

const out = {
  source: { image: ref.image, url: ref.source, author: ref.author, license: ref.license },
  calibration: {
    side: { metersPerPixel: r3(s * 1000) / 1000, from: 'overall length' },
    top: { metersPerPixel: r3(st * 1000) / 1000, from: 'overall length' },
    front: sf ? { metersPerPixel: r3(sf * 1000) / 1000, from: 'wingspan' } : null,
    checks: {
      height: { measured: r2((SB.maxY - SB.minY + 1) * s), published: P.height },
      spanFromTop: { measured: r2((TB.maxY - TB.minY + 1) * st), published: P.span },
      fuselageWidthFromFront: sf ? { measured: r2(hMid * 2 * sf), published: P.fuselageWidth } : null,
    },
    lineWidth: r3(line),
  },
  attitude: { degrees: r2((att * 180) / Math.PI), from: `slope of ${windows.length} cabin window centers` },
  tailTip: tail,
  fuselage: {
    stations, columns: '[x, halfWidth, top, bottom, mid]',
    height: r2(fuselageHeight), upperHeight: r2(upperHeight),
    upper, lowerExponent: F.lowerExponent,
    provenance: 'top and bottom from the side view, half-width shape from the top view scaled to the published width, upper cross-section from the front view; the lower lobe is hidden by the wing fairing and is estimated',
  },
  windows: windows.map(body).sort((a, b) => a.x - b.x),
  doors: doors.sort((a, b) => a.x - b.x),
  exits,
  windshield,
  fin,
  wing: { plan: wingPlan, kinkZ: r2(kinkZ), tipChordMeasured: tipRow ? r2(tipRow.te - tipRow.le) : null, from: 'top view, straight-line fits per panel' },
  stabilizer: { plan: stabPlan, tipHeight: r2(stabTip[1]), from: 'top view planform, side view tip height' },
  engineZ,
  nacelle,
  gear: { noseX: r2(toBody(noseWheel, 0)[0]), mainX: r2(toBody(mainWheel, 0)[0]), noseGround: groundAt(noseWheel), mainGround: groundAt(mainWheel), wheelbase: r2(mainWheel - noseWheel) },
};
writeFileSync(join(dir, 'measured.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ tail: [r2(tail.x), r2(tail.y), r2(tail.half)], calibration: out.calibration, attitude: out.attitude, fuselage: { height: out.fuselage.height, upperHeight: out.fuselage.upperHeight }, windows: out.windows.length, doors: out.doors, exits: out.exits, windshield: out.windshield, nacelle: out.nacelle, gear: out.gear, finRows: out.fin.length, finTop: out.fin[0], finBottom: out.fin.at(-1) }, null, 1));
