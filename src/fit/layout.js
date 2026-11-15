// A drawing in, a model out, with the structure decided first. The layout (references/
// known/<id>.layout.json, written by someone reading the drawing) says what the aircraft
// is made of: how many engines and where, the tail, each gear leg and its wheels, the
// doors, the window rows. The drawing then only sets dimensions. Nothing the layout
// fixes is ever guessed from pixels, and the rules every airliner follows hold by
// construction: both sides alike, all engines one engine, every wheel on the ground.
import { buildModel } from '../registry.js';
import { measure, geometryFrom, correct } from './from-views.js';
import { targetOf, score } from './views.js';
import { MATERIALS, liveryFor, dress, distance } from './fit.js';
import { readDetails, applyDetails } from './details.js';

const r2 = v => Math.round(v * 100) / 100;
const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Keep what the layout says exists, and nothing else, from one reading of the views. */
export function constrain(m, layout) {
  const out = { ...m };
  const per = Math.floor(layout.engines.count / 2);
  const biggest = (list, n, what) => {
    if (list.length < n) throw new Error(`layout has ${n} ${what} engine(s) a side, the drawing shows ${list.length}`);
    return [...list].sort((a, b) => b.dia - a.dia).slice(0, n).sort((a, b) => a.z - b.z);
  };
  if (layout.engines.mount === 'wing') { out.engines = biggest(m.engines, per, 'wing'); out.rear = []; }
  else if (layout.engines.mount === 'rear') { out.rear = biggest(m.rear, per, 'rear'); out.engines = []; }
  // A T-tail: the tailplane sits on the fin tip.
  if (layout.tail === 'T' && out.stab && out.fin) {
    const tip = Math.max(...out.fin.rows.map(r => r.at));
    out.stab = { ...out.stab, h: [[0, tip - 0.1]] };
  }
  return out;
}

/** Gear legs and wheels as the layout has them; where each stands and how big its wheels are from the drawing. */
function gearAsLaid(g, m, layout) {
  const gear = g.gear;
  if (gear.nose) {
    const n = layout.gear.nose;
    const w = gear.nose.tire.w;
    gear.nose = { ...gear.nose, wheels: n.wheels, spacing: r2(n.wheels > 1 ? (gear.nose.wheels === n.wheels ? gear.nose.spacing : w * 1.25) : 0), ...(n.axles > 1 ? { axles: n.axles, axleSpacing: gear.nose.axleSpacing ?? r2(gear.nose.tire.d * 1.15) } : { axles: 1, axleSpacing: 0 }) };
  }
  const want = layout.gear.mains;
  const read = [...gear.mains];
  // Legs read from the drawing, outer first; the layout's wing legs are the outer ones.
  read.sort((a, b) => b.z - a.z || a.x - b.x);
  const order = want.map((w, i) => ({ ...w, i })).sort((a, b) => (a.place === b.place ? 0 : a.place === 'wing' ? -1 : 1));
  const base = read[0];
  gear.mains = order.map((w, k) => {
    const q = read[Math.min(k, read.length - 1)] ?? base;
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
  const want = constrain(measure(target), layout);
  const frame = { L: target.L, H: target.H, S: target.S };
  const make = reading => {
    const geometry = gearAsLaid({ ...geometryFrom(reading, { engineName: about.specs?.engine_type }), materials: MATERIALS }, reading, layout);
    return { id: about.id, name: about.name, category: 'aviation', builder: 'parametric', specs: about.specs ?? {}, note: 'Built from a three-view drawing: outside only, no cockpit or cabin interior.', livery: liveryFor(geometry), geometry };
  };
  let cur = want, model = make(cur), obj = buildModel(model), best = distance(score(target, obj));
  log?.(`start ${(best * 100).toFixed(1)} cm`);
  for (let k = 0; k < steps; k++) {
    let next, nextModel, nextObj, d;
    try {
      next = correct(cur, want, constrain(measure(targetOf(obj, { ppm: target.ppm, frame })), layout));
      nextModel = make(next);
      nextObj = buildModel(nextModel);
      d = distance(score(target, nextObj));
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
  void median;
  return model;
}
