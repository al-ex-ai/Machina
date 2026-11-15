// A drawing in, a model out, with the structure decided first. The layout (references/
// known/<id>.layout.json, written by someone reading the drawing) says what the aircraft
// is made of: how many engines and where, the tail, each gear leg and its wheels, the
// doors, the window rows. The drawing then only sets dimensions. Nothing the layout
// fixes is ever guessed from pixels, and the rules every airliner follows hold by
// construction: both sides alike, all engines one engine, every wheel on the ground.
import { buildModel } from '../registry.js';
import { measure, geometryFrom, correct } from './from-views.js';
import { targetOf, compareMasks } from './views.js';
import { MATERIALS, liveryFor, dress, distance } from './fit.js';
import { readDetails, applyDetails } from './details.js';

const r2 = v => Math.round(v * 100) / 100;
/** A model's views drawn with the drawing's line: grown by half its width, as the drawing's outline reaches past the edge. */
function inked(t, line) {
  const r = Math.round((line / 2) * t.ppm);
  if (r < 1) return t;
  const grow = m => {
    const { w, h } = m, a = m.data, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = a[y * w + k]; tmp[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x]; out[y * w + x] = v; }
    const c = m.clone(); c.data = out; return c;
  };
  return { ...t, side: grow(t.side), top: grow(t.top), front: t.front && grow(t.front) };
}

const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Keep what the layout says exists, and nothing else, from one reading of the views. */
export function constrain(m, layout, views) {
  const out = { ...m };
  const per = Math.floor(layout.engines.count / 2);
  const biggest = (list, n, what) => {
    if (list.length < n) throw new Error(`layout has ${n} ${what} engine(s) a side, the drawing shows ${list.length}`);
    return [...list].sort((a, b) => b.dia - a.dia).slice(0, n).sort((a, b) => a.z - b.z);
  };
  if (layout.engines.mount === 'wing') { out.engines = biggest(m.engines, per, 'wing'); out.rear = []; }
  else if (layout.engines.mount === 'rear') { out.rear = biggest(m.rear, per, 'rear'); out.engines = []; }
  // A T-tail: the tailplane is the long thin run across the top of the front view; its
  // chord plane is the middle of the rows where one run spans most of it.
  if (layout.tail === 'T' && out.stab) {
    const root = out.stab.rows[0], tip = out.stab.rows.at(-1).at;
    let y = m.H - 0.045 * (root.te - root.le);
    const f = views?.front;
    if (f) {
      const rows = [];
      for (let j = f.h - 1; j >= 0; j--) { const v = f.V(j); if (v < m.H * 0.5) break; if (f.runsU(v).some(r => r[0] < -tip * 0.7 && r[1] > tip * 0.7)) rows.push(v); }
      if (rows.length) y = (Math.min(...rows) + Math.max(...rows)) / 2;
    }
    out.stab = { ...out.stab, h: [[0, y]] };
  }
  // Engines beside the rear fuselage: the outer half of each nacelle is never hidden in the
  // front view. The outermost column gives its edge, the run heights inside it a circle.
  if (layout.engines.mount === 'rear' && views?.front) out.rear = out.rear.map(e => nacelleFromFront(views.front, e) ?? e);
  return out;
}

/** A nacelle's center height, center and diameter from the outer half of its circle in the front view. */
function nacelleFromFront(f, e) {
  const r0 = e.dia / 2, win = q => q[1] > e.y - 2 * r0 && q[0] < e.y + 2 * r0;
  const run = z => f.runsV(z).filter(win).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  let zOut = null;
  for (let z = e.z + 2 * r0; z > e.z; z -= 1 / f.ppm) if (run(z)) { zOut = z; break; }
  if (zOut === null) return null;
  const cols = [];
  for (let d = 2 / f.ppm; d < r0 * 0.9; d += 1 / f.ppm) { const q = run(zOut - d); if (q) cols.push({ d, mid: (q[0] + q[1]) / 2, hh: (q[1] - q[0]) / 2 }); }
  const fit = cols.filter(c => c.d > r0 * 0.25);
  if (fit.length < 3) return null;
  const r = median(fit.map(c => (c.hh * c.hh + c.d * c.d) / (2 * c.d)));
  if (!(r > r0 * 0.6 && r < r0 * 1.8)) return null;
  return { ...e, z: zOut - r, dia: 2 * r, y: median(fit.map(c => c.mid)) };
}

/** Gear legs and wheels as the layout has them; where each stands and how big its wheels are from the drawing. */
function gearAsLaid(g, m, layout) {
  const gear = g.gear;
  const st = g.fuselage.stations, belly = x => st.reduce((a, q) => (Math.abs(q[0] - x) < Math.abs(a[0] - x) ? q : a))[3];
  // A tire is never wider than about half its diameter: a wider reading is two tires seen as one.
  const tireOf = q => ({ ...q.tire, w: r2(Math.min(q.tire.w, q.tire.d * 0.42)) });
  if (gear.nose) {
    const n = layout.gear.nose;
    gear.nose.tire = tireOf(gear.nose);
    const w = gear.nose.tire.w;
    gear.nose = { ...gear.nose, wheels: n.wheels, spacing: r2(n.wheels > 1 ? (gear.nose.wheels === n.wheels ? gear.nose.spacing : w * 1.25) : 0), ...(n.axles > 1 ? { axles: n.axles, axleSpacing: gear.nose.axleSpacing ?? r2(gear.nose.tire.d * 1.15) } : { axles: 1, axleSpacing: 0 }) };
  }
  const want = layout.gear.mains;
  let read = [...gear.mains];
  // Legs one behind the other read as one leg with an axle per leg: split it at its axles.
  if (read.length < want.length) {
    const total = want.reduce((a, w) => a + w.axles, 0);
    read = read.flatMap(q => {
      const n = q.axles ?? 1;
      if (n !== total || n < 2) return [q];
      return Array.from({ length: n }, (_, k) => ({ ...q, x: r2(q.x + (k - (n - 1) / 2) * q.axleSpacing), axles: 1, axleSpacing: 0 }));
    });
  }
  // Legs read from the drawing, outer first; the layout's wing legs are the outer ones.
  read.sort((a, b) => b.z - a.z || a.x - b.x);
  const order = want.map((w, i) => ({ ...w, i })).sort((a, b) => (a.place === b.place ? 0 : a.place === 'wing' ? -1 : 1));
  const base = read[0];
  gear.mains = order.map((w, k) => {
    const q0 = read[Math.min(k, read.length - 1)] ?? base;
    // Body gear hangs from the belly, whatever the wing does above it.
    const q = { ...q0, tire: tireOf(q0), ...(w.place === 'body' ? { top: r2(belly(q0.x) + 0.35) } : {}) };
    const axleSpacing = w.axles > 1 ? (q.axles === w.axles && q.axleSpacing ? q.axleSpacing : r2(q.tire.d * 1.15)) : 0;
    const spacing = w.wheels > 1 ? (q.wheels === w.wheels ? q.spacing : r2(q.tire.w * 1.25)) : 0;
    return { ...q, wheels: w.wheels, spacing, axles: w.axles, axleSpacing, id: want.length > 1 ? `${w.place}-gear-${k + 1}` : 'main-gear', label: want.length > 1 ? `${w.place} gear ${k + 1}` : 'main gear' };
  });
  return g;
}

/**
 * @param {object} target silhouettes from a sheet (src/fit/sheet.js targetFromSheet)
 * @param {object} layout what the aircraft is made of, read from the drawing
 * @param {{ id: string, name: string, specs?: object }} about
 * @param {{ steps?: number, log?: (line: string) => void }} [opts]
 */
export function fitLayout(target, layout, about, { steps = 3, log } = {}) {
  const want = constrain(measure(target), layout, target);
  const frame = { L: target.L, H: target.H, S: target.S };
  const make = reading => {
    const geometry = gearAsLaid({ ...geometryFrom(reading, { engineName: about.specs?.engine_type }), materials: MATERIALS }, reading, layout);
    return { id: about.id, name: about.name, category: 'aviation', builder: 'parametric', specs: about.specs ?? {}, note: 'Built from a three-view drawing: outside only, no cockpit or cabin interior.', livery: liveryFor(geometry), geometry };
  };
  const views = obj => inked(targetOf(obj, { ppm: target.ppm, frame }), target.line ?? 0);
  const away = v => distance(Object.fromEntries(['side', 'top', 'front'].filter(k => target[k] && v[k]).map(k => [k, compareMasks(target[k], v[k])])));
  let cur = want, model = make(cur), obj = buildModel(model), best = away(views(obj));
  log?.(`start ${(best * 100).toFixed(1)} cm`);
  for (let k = 0; k < steps; k++) {
    let next, nextModel, nextObj, d;
    try {
      const seen = views(obj);
      next = correct(cur, want, constrain(measure(seen), layout, seen));
      nextModel = make(next);
      nextObj = buildModel(nextModel);
      d = away(views(nextObj));
    } catch (e) {
      log?.(`step ${k + 1} failed: ${e.message}`);
      break;
    }
    log?.(`step ${k + 1} ${(d * 100).toFixed(1)} cm`);
    if (d >= best - 0.001) break;
    cur = next; model = nextModel; obj = nextObj; best = d;
  }
  dress(model);
  if (target.inner && layout.windows?.drawn !== false) {
    const got = applyDetails(model, readDetails(target.inner, target.L));
    log?.(`from the drawing: ${got.join(', ') || 'no inner detail found'}`);
  }
  return model;
}
