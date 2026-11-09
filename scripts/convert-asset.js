// Convert a detailed mesh (a FlightGear asset) into a Machina parametric model by
// measuring it: fuselage sections, wing, tail and winglet planforms, control surface
// extents, engines and landing gear all come from slicing the geometry. Windows,
// doors, cockpit panes and the livery layout are placed by rule from the measured
// body. Nothing is set per aircraft.
// Usage: npm run convert -- data/models/aviation/<id>.json [--id <new-id>] [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import '../src/builders/index.js';
import { loadAssetNode } from '../src/assets-node.js';
import { collect } from '../src/draw/hlr.js';
import { pick, boxOf, fuselage, planform, coverage, segments, nacelle, wheels, legs, clusters1, gridOutlines } from '../src/fit/mesh.js';
import { bodyProfile } from '../src/parametric/body.js';
import { angleOn } from '../src/parametric/cabin.js';

const args = process.argv.slice(2);
const file = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))[0];
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const src = JSON.parse(readFileSync(file, 'utf8'));
const template = JSON.parse(readFileSync('data/models/aviation/b737-300-parametric.json', 'utf8'));
const r2 = v => Math.round(v * 100) / 100;

// Mesh in Machina axes, shifted so the nose is at x = 0 and the ground at y = 0.
const meshes = collect(loadAssetNode(src), { skipSystems: ['interior', 'lights', 'avionics'] });
const all = boxOf(pick(meshes, /./));
// Light aircraft (under 16 m) get the light-aircraft treatment: cowling in the body,
// propellers, struts, see-through glazing and a generated cabin.
const light = (src.specs.length_m ?? 99) < 16;
const FUS = light ? /^fuselage$|cowl|^engine$|windshield|window|canopy|door/ : /^fuselage$/; // on light aircraft the cabin is mostly glass and doors
const fusTris0 = pick(meshes, FUS);
const nose = boxOf(fusTris0).min[0], ground = all.min[1];
for (const m of meshes) {
  for (let i = 0; i < m.verts.length; i += 3) { m.verts[i] -= nose; m.verts[i + 1] -= ground; }
  m.box.min.x -= nose; m.box.max.x -= nose; m.box.min.y -= ground; m.box.max.y -= ground;
}

// ── Fuselage: the part may also hold unmapped meshes (wing roots, engines), so points
// wider than the forward cabin's width are left out.
let fusTris = pick(meshes, FUS);
const first = fuselage(fusTris);
// Width reference: the forward cabin on airliners; the cowling on light aircraft, where
// struts and wing roots in the same part would inflate it.
const [wa, wb2] = light ? [0.05, 0.15] : [0.15, 0.35];
const fwd = first.stations.filter(s => s[0] > first.length * wa && s[0] < first.length * wb2).map(s => s[1]).sort((a, b) => a - b);
const halfW = fwd[Math.floor(fwd.length / 2)] * (light ? 1.3 : 1.12);
fusTris = fusTris.filter(t => Math.abs(t[2]) <= halfW && Math.abs(t[5]) <= halfW && Math.abs(t[8]) <= halfW);
const fus = fuselage(fusTris);
const L = fus.length;
const body = x => { const s = fus.at(x); return { w: s.w, top: s.top, bot: s.bot, mid: s.mid }; };
const D = 2 * halfW / 1.12;

const cxOf = t => (t[0] + t[3] + t[6]) / 3, czOf = t => (t[2] + t[5] + t[8]) / 3, cyOf = t => (t[1] + t[4] + t[7]) / 3;

// ── Surfaces
const parts = Object.fromEntries(template.geometry.surfaces.map((s, i) => [['wing', 'stab', 'fin'][i], s.parts]));
const winglet = /winglet|sharklet/;
// A part named "wing" may also hold the horizontal tail: behind 72% of the length is tail.
const surfTris = pick(meshes, /wing|aileron|flap|slat|spoiler/, { not: /gear|strut|fairing|winglet|sharklet/, side: 1 });
const wingTris = surfTris.filter(t => cxOf(t) < L * 0.72);
const wb = boxOf(wingTris);
// Surfaces are measured from just outside the body (slices inside it are partial) and
// extended inward with their root section as a stub the body hides.
const stub = (plan, inner) => (plan.length && plan[0].at > inner ? [{ ...plan[0], at: r2(inner) }, ...plan] : plan);
const clampTc = plan => plan.map(s => ({ ...s, tc: Math.min(s.tc, 0.16) }));
const wingPlan = clampTc(stub(planform(wingTris, 2, Math.max(wb.min[2], halfW / 1.12 * 1.02), wb.max[2] - 0.02), 0.3));
const te = (re, key) => [coverage(pick(meshes, re, { side: 1, not: /fairing|gear/ }), wingPlan, 2, 'te'), key];
const wing = {
  axis: 'z', mirror: true, camber: 0.02, camberAt: 0.4,
  sections: wingPlan,
  segments: segments(wingPlan, { te: [te(/aileron/, 'ailerons'), te(/flap/, 'flaps')], le: [[coverage(pick(meshes, /slat/, { side: 1 }), wingPlan, 2, 'le'), 'slats']] }, 'box'),
  parts: parts.wing,
};
// The horizontal tail: named parts, plus tail geometry left in a wing part or in the
// catch-all fuselage part (wider than the body, behind 72% of the length).
const stabTris = [
  ...pick(meshes, /stabilizer|elevator/, { side: 1 }),
  ...surfTris.filter(t => cxOf(t) >= L * 0.72),
  ...pick(meshes, /^fuselage$/, { side: 1 }).filter(t => cxOf(t) > L * 0.72 && Math.max(t[2], t[5], t[8]) > halfW * 1.1),
].filter(t => czOf(t) < wingPlan.at(-1).at * 0.5); // a horizontal tail spans less than half the wing
if (stabTris.length < 20) throw new Error(`${src.id}: the source mesh has no horizontal tail to measure`);
const sb = boxOf(stabTris);
const stabX = (sb.min[0] + sb.max[0]) / 2;
const stabPlan = clampTc(stub(planform(stabTris, 2, Math.max(sb.min[2], body(stabX).w * 1.05), sb.max[2] - 0.02, 30), 0.2));
const stab = {
  axis: 'z', mirror: true, sections: stabPlan,
  segments: segments(stabPlan, { te: [[coverage(pick(meshes, /elevator/, { side: 1 }), stabPlan, 2, 'te'), 'elev']], le: [] }, 'stab'),
  parts: parts.stab,
};
const finAll = pick(meshes, /^fins?$|rudders?/);
const twin = finAll.length && finAll.reduce((a, t) => a + Math.abs(czOf(t)), 0) / finAll.length > 0.3; // two fins out on the tailplane
const finTris = twin ? pick(meshes, /^fins?$|rudders?/, { side: 1 }) : finAll;
const fb = boxOf(finTris);
const finX = (fb.min[0] + fb.max[0]) / 2, finBase = twin ? fb.min[1] : body(finX).top;
const finZ = twin ? finTris.reduce((a, t) => a + czOf(t), 0) / finTris.length : 0;
// Twin fins and light aircraft tails (a rudder may hang below the tail cone) are measured from their lowest point.
const finPlan = clampTc(twin || light ? planform(finTris, 1, fb.min[1] + 0.02, fb.max[1] - 0.02, twin ? 20 : 30) : stub(planform(finTris, 1, Math.max(fb.min[1], finBase) + 0.1, fb.max[1] - 0.02, 30), finBase - 0.5)).map(s => ({ ...s, h: r2(finZ) }));
const fin = {
  axis: 'y', mirror: twin, sections: finPlan,
  segments: segments(finPlan, { te: [[coverage(pick(meshes, /rudder/, twin ? { side: 1 } : {}), finPlan, 1, 'te'), 'rudder']], le: [] }, 'fin'),
  parts: parts.fin,
};
const surfaces = [wing, stab, fin];
// Winglets: a vertical surface standing on the wing tip, its sections offset outward (cant).
const wlTris = pick(meshes, winglet, { side: 1 });
if (wlTris.length) {
  const wl = boxOf(wlTris);
  const tip = wingPlan.at(-1);
  const plan = clampTc(planform(wlTris, 1, Math.max(wl.min[1], tip.h) + 0.02, wl.max[1] - 0.02, 16));
  if (plan.length >= 2) {
    const outAt = y => { const pts = pick(meshes, winglet, { side: 1 }); let z = 0, n = 0; for (const t of pts) for (let k = 0; k < 9; k += 3) if (Math.abs(t[k + 1] - y) < 0.15) { z += t[k + 2]; n++; } return n ? z / n : wl.max[2]; };
    surfaces.push({
      axis: 'y', mirror: true, sections: plan.map(s => ({ ...s, h: r2(outAt(s.at)) })),
      segments: [{ from: plan[0].at, to: plan.at(-1).at, split: [[0, 1, 'winglet']] }],
      parts: { winglet: { id: 'winglet', label: 'Winglet', system: 'surfaces' } },
    });
  }
}

// ── Engines: clusters of engine triangles on the left side, mirrored.
const wingAt = (k, z) => {
  const p = wingPlan;
  for (let i = 0; i < p.length - 1; i++) if (z <= p[i + 1].at) { const f = (z - p[i].at) / (p[i + 1].at - p[i].at || 1); return p[i][k] + (p[i + 1][k] - p[i][k]) * f; }
  return p.at(-1)[k];
};
const engTris = light ? [] : pick(meshes, /engine/, { not: /cowl/, side: 1 }).filter(t => (t[2] + t[5] + t[8]) / 3 > 0.3);
const engines = clusters1(engTris.map(t => (t[2] + t[5] + t[8]) / 3), 1.0).map((c, i, list) => {
  const n = nacelle(engTris.filter(t => { const z = (t[2] + t[5] + t[8]) / 3; return z >= c.min && z <= c.max; }));
  const z = n.position.z;
  const wingLow = wingAt('h', z) - 0.15;
  const at0 = r2(n.top - 0.2), at1 = r2(Math.max(wingLow, n.top + 0.25));
  const le = r2(Math.max(n.position.x + n.length * 0.15, wingAt('le', z) - n.length * 0.5));
  return {
    name: src.specs.engine_type ?? 'Engine',
    id: list.length > 1 ? (i === 0 ? 'inner-engine' : 'outer-engine') : undefined,
    label: list.length > 1 ? (i === 0 ? 'Inner engine' : 'Outer engine') : undefined,
    mirror: true, position: n.position, nacelle: n.nacelle, fan: n.fan, plug: n.plug,
    pylon: { axis: 'y', sections: [{ at: at0, le, chord: r2(n.length * 0.8), h: z, tc: 0.14 }, { at: at1, le: r2(le + 0.4), chord: r2(n.length * 0.85), h: z, tc: 0.14 }] },
  };
});

// ── Landing gear from the wheels. Part names are unreliable here (tires mapped to the
// nose gear, or to no gear at all), so wheels are found by position: everything gear-like
// ahead of 30% of the length is the nose gear, the rest are mains, and each region is
// sliced just above its own lowest point (meshes may sit on unloaded struts).
const gearTris = pick(meshes, /gear/, { not: /door/ });
const region = (tris, h) => { const g = tris.length ? boxOf(tris).min[1] : 0; return { ground: g, wheels: tris.length ? wheels(tris, g, h) : [] }; };
const fwdGear = gearTris.filter(t => cxOf(t) < L * 0.3);
let noseR = region(fwdGear);
if (!noseR.wheels.length && fwdGear.length) {
  const b = boxOf(fwdGear);
  noseR = region(pick(meshes, /./).filter(t => cxOf(t) > b.min[0] - 0.6 && cxOf(t) < b.max[0] + 0.6 && Math.abs(czOf(t)) < 1 && cyOf(t) < b.min[1] + 1.2));
}
const noseGround = noseR.ground;
const noseLeg = legs(noseR.wheels.map(w => ({ ...w, z: 0 })))[0];
const mainR = region(gearTris.filter(t => cxOf(t) >= L * 0.3));
const mainLegs = legs(mainR.wheels.filter(w => w.z > 0.2));
const gearOf = (leg, wingMounted) => ({
  x: leg.x, z: leg.z, tire: leg.tire, wheels: leg.wheels, spacing: leg.spacing,
  ...(leg.axles > 1 ? { axles: leg.axles, axleSpacing: leg.axleSpacing } : {}),
  strut: r2(Math.max(0.12, leg.tire.d * 0.26)),
  top: r2(wingMounted ? wingAt('h', leg.z) - 0.1 : body(leg.x).bot + 0.35),
  bottom: 0, // every wheel stands on the ground (source meshes often sit on one leg, the others unloaded)
});
let gear = light ? null : {
  nose: { ...gearOf(noseLeg, false), z: undefined, bottom: 0 },
  mains: mainLegs.map((leg, i) => ({ ...gearOf(leg, leg.z > halfW * 0.95), id: mainLegs.length > 1 ? (leg.z > halfW * 0.95 ? 'wing-gear' : 'body-gear') : 'main-gear', label: mainLegs.length > 1 ? (leg.z > halfW * 0.95 ? 'wing gear' : 'body gear') : 'main gear' })),
};

if (light) {
  const lgTris = pick(meshes, /gear|wheel/, { not: /door/ });
  const outer = lgTris.filter(t => Math.abs(czOf(t)) > 0.3), center = lgTris.filter(t => Math.abs(czOf(t)) <= 0.3);
  const mR = region(outer);
  let cR = region(center);
  if (!cR.wheels.length) cR = region(center, 0.04); // a small tail wheel: slice lower
  const mains = legs(mR.wheels.filter(w => w.z > 0.3));
  const main = mains[0];
  const cw = legs(cR.wheels.map(w => ({ ...w, z: 0 })))[0];
  const small = (leg, ground) => ({ x: leg.x, tire: leg.tire, wheels: leg.wheels, spacing: leg.spacing, strut: r2(Math.max(0.05, leg.tire.d * 0.18)), top: r2(body(leg.x).bot + 0.15), bottom: r2(ground) });
  gear = {};
  if (cw) gear[cw.x < main.x ? 'nose' : 'tail'] = small(cw, cR.ground);
  const b = body(main.x);
  gear.mains = [{ ...small(main, mR.ground), z: main.z, wheels: 1, id: 'main-gear', label: 'main gear',
    ...(main.z > b.w * 0.9 ? { attach: { y: r2(b.bot + 0.12), z: r2(b.w * 0.6) } } : {}) }];
}

// ── Light aircraft: glazing map, cabin, propellers and struts, all from the mesh.
let glazing = null, cabin = null, propellers = [], struts = [];
if (light) {
  const prof = bodyProfile(fus.stations, { nTop: fus.nTop, nBot: fus.nBot });
  // Glazing: rasterize the glass triangles onto the body surface, 5 cm by 2 degrees.
  const glass = pick(meshes, /windshield|window|canopy|glazing/);
  if (glass.length) {
    const gb = boxOf(glass);
    const x0 = Math.max(0, gb.min[0]), dx = 0.05, nx = Math.ceil((Math.min(L, gb.max[0]) - x0) / dx) + 1;
    const grid = Array.from({ length: nx }, () => new Uint8Array(90));
    for (const t of glass) {
      const e = Math.max(Math.hypot(t[3] - t[0], t[4] - t[1], t[5] - t[2]), Math.hypot(t[6] - t[0], t[7] - t[1], t[8] - t[2]));
      const n = Math.max(2, Math.ceil(e / 0.025));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const a = i / n, b2 = j / n, c = 1 - a - b2;
        const x = t[0] * a + t[3] * b2 + t[6] * c, y = t[1] * a + t[4] * b2 + t[7] * c, z = t[2] * a + t[5] * b2 + t[8] * c;
        const xi = Math.floor((x - x0) / dx);
        if (xi < 0 || xi >= nx || x <= 0 || x >= L) continue;
        const k = Math.floor((angleOn(prof, x, y, z) * 180) / Math.PI / 2);
        if (k >= 0 && k < 90) grid[xi][k] = 1;
      }
    }
    // Close pinholes: a cell is glass when most of its neighbors are.
    const closed = grid.map((col, i) => col.map((v, k) => {
      if (v) return 1;
      let n = 0, m = 0;
      for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) { const c = grid[i + a]?.[k + b2]; if (c !== undefined) { m++; n += c; } }
      return n >= 5 ? 1 : 0;
    }));
    // Then a majority vote over each cell's neighborhood smooths ragged edges.
    const smooth = closed.map((col, i) => col.map((v, k) => {
      let n = 0, m = 0;
      for (let a = -1; a <= 1; a++) for (let b2 = -2; b2 <= 2; b2++) { const c = closed[i + a]?.[k + b2]; if (c !== undefined) { m++; n += c; } }
      return n * 2 > m ? 1 : 0;
    }));
    const cols = smooth.map(col => { const runs = []; let a = -1; for (let k = 0; k <= 90; k++) { if (col[k] && a < 0) a = k; if (!col[k] && a >= 0) { runs.push([a * 2, k * 2]); a = -1; } } return runs; });
    // Panes: open the map first (erode, then dilate) so thin bridges and slivers between
    // windows go, then trace each region's outline as a smooth polygon in (x, degrees).
    const morph = (g, keep) => g.map((col, i) => col.map((v, k) => {
      let n = 0, m = 0;
      for (let a = -1; a <= 1; a++) for (let b2 = -1; b2 <= 1; b2++) { const c = g[i + a]?.[k + b2]; if (c !== undefined) { m++; n += c; } }
      return keep(n, m) ? 1 : 0;
    }));
    const eroded = morph(smooth, (n, m) => n === m), opened = morph(eroded, n => n > 0);
    const panes = gridOutlines(opened.map(c => [...c]), 1.2).map(l => l.map(([i, k]) => [r2(x0 + i * dx), Math.round(k * 2 * 10) / 10]))
      .filter(l => { let a = 0; for (let i = 0; i < l.length; i++) { const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2) > dx * 2 * 6; });
    glazing = { x0: r2(x0), dx, cols, panes };
    // Cabin: from just ahead of the windshield to just behind the last window.
    const from = x0 - 0.15, to = Math.min(L * 0.75, gb.max[0] + 0.25);
    const m = body((from + to) / 2);
    const seats = parseInt(String(src.specs.seats ?? 2), 10) || 2;
    cabin = { from: r2(from), to: r2(to), floor: r2(m.bot + 0.2 * (m.top - m.bot)), seats, abreast: 2 * m.w > 0.95 ? 2 : 1 }; // two abreast needs a body about a meter wide
  }
  // Propeller: the disc of the propeller part, its blades counted around the hub.
  for (const c of clusters1(pick(meshes, /propeller/).map(t => czOf(t)), 2.5)) {
    const pt = pick(meshes, /propeller/).filter(t => czOf(t) >= c.min && czOf(t) <= c.max);
    const b = boxOf(pt);
    const cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const D2 = Math.max(b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const bins = new Array(36).fill(0);
    for (const t of pt) for (let k = 0; k < 9; k += 3) { const dy = t[k + 1] - cy, dz = t[k + 2] - cz; if (Math.hypot(dy, dz) > D2 * 0.3) bins[Math.floor(((Math.atan2(dz, dy) + Math.PI) / (Math.PI * 2)) * 36) % 36]++; }
    const filled = bins.filter(v => v > 0).length;
    let peaks = 0;
    for (let i = 0; i < 36; i++) if (bins[i] > 0 && bins[(i + 35) % 36] === 0) peaks++;
    const blades = filled > 30 ? 2 : Math.min(4, Math.max(2, peaks)); // a disc (prop blur) gives no count: two blades
    // Blade plane: where the geometry far from the hub sits; the spinner runs forward to the part's front.
    const far = pt.flatMap(t => [0, 3, 6].filter(k => Math.hypot(t[k + 1] - cy, t[k + 2] - cz) > D2 * 0.3).map(k => t[k]));
    const px = far.length ? far.reduce((a, v) => a + v, 0) / far.length : (b.min[0] + b.max[0]) / 2;
    const sl = Math.max(0.15, (px - b.min[0]) / 0.85);
    propellers.push({ x: r2(px), y: r2(cy), z: r2(cz), diameter: r2(D2), blades, spinner: { radius: r2(Math.min(D2 * 0.085, body(0.2).w * 0.85)), length: r2(sl) } });
  }
  // Struts: named strut parts, or thin geometry under the wing outside the body.
  const wingY = wingAt('h', halfW * 2);
  let st = pick(meshes, /strut/, { side: 1 });
  if (!st.length && wingY > body(wingPlan[0].le).mid) {
    st = pick(meshes, /^fuselage$|wing/, { side: 1, not: /gear/ }).filter(t => czOf(t) > halfW * 1.1 && cyOf(t) < wingY - 0.15 && cyOf(t) > 0.4 && Math.max(t[1], t[4], t[7]) - Math.min(t[1], t[4], t[7]) > 0.3);
  }
  if (st.length) {
    // Members: connected pieces; a V strut splits by its two upper ends.
    const key = (t, k) => `${Math.round(t[k] * 200)},${Math.round(t[k + 1] * 200)},${Math.round(t[k + 2] * 200)}`;
    const parent = st.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const owner = new Map();
    st.forEach((t, i) => { for (const k of [0, 3, 6]) { const kk = key(t, k); if (owner.has(kk)) parent[find(i)] = find(owner.get(kk)); else owner.set(kk, i); } });
    const comps = new Map();
    st.forEach((t, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); });
    if (process.env.DEBUG) console.log('struts', st.length, [...comps.values()].map(c => { const b = boxOf(c); return `${c.length}: y ${b.min[1].toFixed(2)}-${b.max[1].toFixed(2)} z ${b.min[2].toFixed(2)}-${b.max[2].toFixed(2)}`; }).slice(0, 12));
    for (const tris of comps.values()) {
      const pts = tris.flatMap(t => [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]]);
      const ys = pts.map(p => p[1]).sort((a, b) => a - b);
      const lo = ys[Math.floor(ys.length * 0.1)], hi = ys[Math.floor(ys.length * 0.9)];
      if (hi - lo < 0.5) continue;
      const mean = list => list.reduce((a, p) => [a[0] + p[0] / list.length, a[1] + p[1] / list.length, a[2] + p[2] / list.length], [0, 0, 0]).map(r2);
      const bottom = mean(pts.filter(p => p[1] <= lo));
      const tops = pts.filter(p => p[1] >= hi);
      const xc = clusters1(tops.map(p => p[0]), 0.3);
      for (const c of (xc.length === 2 ? xc : [{ min: -Infinity, max: Infinity }])) struts.push({ from: bottom, to: mean(tops.filter(p => p[0] >= c.min && p[0] <= c.max)), chord: 0.1, thick: 0.035 });
    }
  }
}

// ── Windows, doors, cockpit panes and livery layout, by rule from the measured body.
const mid = body(L * 0.25); // the forward cabin: clear of the wing root fairing
const winY = r2(mid.mid + 0.335 * (mid.top - mid.mid));
const doorCount = L < 36 ? 2 : L < 50 ? 3 : L < 65 ? 4 : 5;
const frontDoor = 1.26 * D, rearDoor = 0.79 * L;
const doorXs = Array.from({ length: doorCount }, (_, i) => r2(frontDoor + ((rearDoor - frontDoor) * i) / (doorCount - 1)));
const dw = D > 5 ? 1.07 : 0.8, dh = D > 5 ? 1.93 : 1.82;
const doors = doorXs.map(x => ({ x, sill: r2(winY - dh * 0.52), w: dw, h: dh, window: true }));
const list = [];
const rows = [winY];
if (mid.top - winY > 3.6) rows.push(r2(winY + 2.55)); // a full second deck
for (const y of rows) for (let x = frontDoor + 1.1; x < rearDoor - 0.9; x += 0.53) {
  if (doorXs.some(d => Math.abs(d - x) < dw)) continue;
  const s = body(x);
  if (y < s.top - 0.45 && y > s.mid - 0.2) list.push([r2(x), y]);
}
// A partial upper deck (a hump, as on the 747): where the crown stands more than 0.6 m
// above the aft cabin crown, a row of windows 1.25 m below the hump's crown.
const aftTop = body(L * 0.55).top;
if (rows.length === 1) {
  const hump = [];
  for (let x = frontDoor; x < L * 0.5; x += 0.53) if (body(x).top - aftTop > 0.6) hump.push(x);
  const humpTop = Math.max(...hump.map(x => body(x).top));
  for (const x of hump.slice(1, -2)) if (body(x).top > humpTop - 0.15) list.push([r2(x), r2(humpTop - 1.25)]);
}
const k = D / 3.76;
const cockpitWindows = template.livery.cockpitWindows.map(pane => pane.map(([x, deg]) => [r2(x * k), deg]));
const finTop = finPlan.at(-1), finRoot = finPlan.find(s => s.at > body(finPlan[0].le).top) ?? finPlan[0];
const ty = r2(finRoot.at + (finTop.at - finRoot.at) * 0.42);
const fs = (() => { for (let i = 0; i < finPlan.length - 1; i++) if (ty <= finPlan[i + 1].at) { const f = (ty - finPlan[i].at) / (finPlan[i + 1].at - finPlan[i].at); return { le: finPlan[i].le + (finPlan[i + 1].le - finPlan[i].le) * f, chord: finPlan[i].chord + (finPlan[i + 1].chord - finPlan[i].chord) * f }; } return finTop; })();
const maker = (src.specs.manufacturer ?? '').split(/[\s(,]/)[0].toUpperCase();
const avail = fs.chord - 0.45 - 0.18 - 0.6;
fin.paint = {
  base: '#18273a',
  stripe: { edge: [[finRoot.le, finRoot.at], [finTop.le, finTop.at]], offset: 0.45, width: 0.18, color: '#ff8a3d' },
  title: { text: maker, x: r2(fs.le + 0.45 + 0.18 + 0.25 + avail / 2), y: ty, height: r2(Math.min(0.9, avail / (0.75 * maker.length))), color: '#ffffff' },
};
// Title: where the fuselage is most even over the title's length (no hump end, no wing
// root fairing), so the letters are not stretched across a change in shape.
const tx = light ? r2(L * 0.6) : (() => {
  const half = 0.19 * D * 4;
  let best = L * 0.3, score = Infinity;
  for (let x = L * 0.25 + half; x <= L * 0.6 - half; x += 0.25) {
    let lo = Infinity, hi = -Infinity, ml = Infinity, mh = -Infinity;
    for (let d = -half; d <= half; d += 0.25) { const q = body(x + d); lo = Math.min(lo, q.top); hi = Math.max(hi, q.top); ml = Math.min(ml, q.mid); mh = Math.max(mh, q.mid); }
    const v = (hi - lo) + (mh - ml) + Math.abs(x - L * 0.32) * 0.01;
    if (v < score) { score = v; best = x; }
  }
  return r2(best);
})(), tb = body(tx);
const lightDoors = () => {
  const out = [];
  for (const c of clusters1(pick(meshes, /door/, { side: 1, not: /gear/ }).map(t => cxOf(t)), 0.3)) {
    const t = pick(meshes, /door/, { side: 1, not: /gear/ }).filter(q => cxOf(q) >= c.min && cxOf(q) <= c.max);
    const b = boxOf(t);
    if (b.max[0] - b.min[0] > 0.25) out.push({ x: r2((b.min[0] + b.max[0]) / 2), sill: r2(b.min[1]), w: r2(b.max[0] - b.min[0]), h: r2(b.max[1] - b.min[1]) });
  }
  return out;
};
const livery = light ? {
  ...template.livery,
  cheatline: { y: r2(body(L * 0.5).mid - 0.05), width: r2(0.04 * (tb.top - tb.bot)), riseFrom: r2(L * 0.7), rise: 0.05 },
  windows: { list: [], w: 0.25, h: 0.35 },
  doors: lightDoors(),
  titles: { ...template.livery.titles, x: tx, y: r2(tb.mid + 0.05), height: r2(0.3 * (tb.top - tb.bot)) },
  cockpitWindows: [],
} : {
  ...template.livery,
  cheatline: { y: r2(winY - 0.13 * D), width: r2(0.032 * D), riseFrom: r2(L * 0.72), rise: 0.12 },
  windows: { list, w: D > 5 ? 0.28 : 0.254, h: D > 5 ? 0.38 : 0.356 },
  doors,
  titles: { ...template.livery.titles, x: tx, y: r2(tb.mid + 0.61 * (tb.top - tb.mid)), height: r2(0.19 * D) },
  cockpitWindows,
};
if (twin) delete fin.paint; // two small fins: plain tail color, no title

const tip = wingPlan.at(-1);
const id = opt('id') ?? `${src.id}-parametric`;
const model = {
  id, name: src.name, category: src.category, group: src.group, builder: 'parametric',
  summary: light
    ? `Generated by Machina from the geometry of the FlightGear ${src.name}: fuselage, wing, tail, propeller, struts, glazing and landing gear are measured from the mesh. The cabin behind the glass is generated from the seat count.`
    : `Generated by Machina from the geometry of the FlightGear ${src.name}: fuselage sections, wing, tail and engine shapes and the landing gear are measured from the mesh. Windows, doors and small detail are placed by rule.`,
  specs: src.specs,
  sources: src.sources,
  derived: { from: file.replace(/\\/g, '/'), asset: src.asset.path, author: src.asset.author, license: src.asset.license, source: src.asset.source, note: 'Shapes measured from a GPL model; this file carries the same license and credit.' },
  // The source mesh's documented size gaps, plus 2% allowed for the conversion itself.
  ...(src.asset.verify ? { verify: { tolerance: Object.fromEntries(Object.entries(src.asset.verify.tolerance).map(([k, v]) => [k, Math.round((v + 0.02) * 100) / 100])), note: `Inherited from the source mesh, plus 2% for the conversion. ${src.asset.verify.note}` } } : {}),
  livery,
  geometry: {
    length: r2(L),
    materials: template.geometry.materials,
    fuselage: { nTop: fus.nTop, nBot: fus.nBot, stations: fus.stations },
    surfaces,
    engines,
    gear,
    ...(light ? { details: false, glazing, interior: cabin, propellers, struts } : {}),
    navLights: { wingtip: { x: r2(tip.le + tip.chord * 0.3), y: r2(tip.h), z: r2(tip.at) }, tail: { x: r2(L - 0.1), y: r2(body(L - 0.3).mid) } },
  },
};
const out = opt('out') ?? `data/models/aviation/${id}.json`;
writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
if (light) console.log(`  light aircraft: ${glazing ? glazing.cols.filter(c => c.length).length + ' glazed columns' : 'no glazing'}, cabin ${cabin ? `${cabin.seats} seats ${cabin.abreast === 1 ? 'tandem' : 'side by side'}` : 'none'}, ${propellers.map(p => `${p.blades}-blade ${p.diameter} m prop`).join(', ')}, ${struts.length} strut members, gear ${Object.keys(gear).join('/')}${twin ? ', twin fins' : ''}`);
console.log(`${out}: L ${r2(L)} m, ${fus.stations.length} body stations, wing ${wingPlan.length} sections / ${wing.segments.length} segments, ${engines.length * 2} engines, ${mainLegs.length * 2} main legs (${mainLegs.map(l => `${l.axles}x${l.wheels}`).join(', ')}), ${list.length} windows, ${doors.length} doors${surfaces.length > 3 ? ', winglets' : ''}`);
