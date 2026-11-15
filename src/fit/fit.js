// Three silhouettes in, a parametric model out, with nothing set per aircraft.
//
// The fit is a closed loop. The views are read once (src/fit/from-views.js) and a
// model is built from the reading. That model's own silhouettes are then read by the
// same reader: where the two readings differ, the reader or the builder is off (a tire
// read small, a wing drawn a little high), and the difference is taken off. A step is
// kept only if the model's outline ends up closer to the target's.
import { buildModel } from '../registry.js';
import { measure, geometryFrom, correct } from './from-views.js';
import { targetOf, score } from './views.js';
import { readDetails, applyDetails } from './details.js';

const MATERIALS = {
  metal: { color: '#b9bfc7', metalness: 0.85, roughness: 0.28, clearcoat: 0 },
  surfaces: { color: '#d4d8de', roughness: 0.42 },
  controls: { color: '#c9ced5', roughness: 0.45 },
  tail: { color: '#18273a', roughness: 0.32, clearcoat: 0.8 },
};

/**
 * Paint, windows and doors by rule from the fitted body, the way the mesh converter
 * places them: a silhouette shows none of these.
 */
export function liveryFor(g) {
  const r2 = v => Math.round(v * 100) / 100;
  const L = g.length, st = g.fuselage.stations;
  const at = x => st.reduce((a, q) => (Math.abs(q[0] - x) < Math.abs(a[0] - x) ? q : a));
  const D = 2 * Math.max(...st.map(q => q[1]));
  const m = at(L * 0.25);
  const winY = r2(m[4] + 0.335 * (m[2] - m[4]));
  const doorCount = L < 36 ? 2 : L < 50 ? 3 : L < 65 ? 4 : 5;
  const first = 1.26 * D, last = 0.79 * L;
  const dw = D > 5 ? 1.07 : 0.8, dh = D > 5 ? 1.93 : 1.82;
  const doorXs = Array.from({ length: doorCount }, (_, i) => r2(first + ((last - first) * i) / (doorCount - 1)));
  const list = [];
  for (let x = first + 1.1; x < last - 0.9; x += 0.53) {
    if (doorXs.some(d => Math.abs(d - x) < dw)) continue;
    const q = at(x);
    if (winY < q[2] - 0.45 && winY > q[4] - 0.2) list.push([r2(x), winY]);
  }
  return {
    base: '#f5f6f8', belly: '#18273a', stripe: '#ff8a3d', nacelle: '#18273a', pylon: '#d7dbe0', window: '#1b2633',
    cheatline: { y: r2(winY - 0.13 * D), width: r2(0.032 * D), riseFrom: r2(L * 0.72), rise: 0.12 },
    windows: { list, w: D > 5 ? 0.28 : 0.254, h: D > 5 ? 0.38 : 0.356 },
    doors: doorXs.map(x => ({ x, sill: r2(winY - dh * 0.52), w: dw, h: dh, window: true })),
    windshield: [],
    // Cockpit panes of a narrow-body nose, scaled to the body width.
    cockpitWindows: PANES.map(pane => pane.map(([x, deg]) => [r2((x * D) / 3.76), deg])),
    titles: { text: 'MACHINA', x: r2(L * 0.32), y: r2(m[4] + 0.61 * (m[2] - m[4])), height: r2(0.19 * D), color: '#18273a', markColor: '#ff8a3d' },
  };
}

const PANES = [[[1.73, 4], [2.13, 47], [2.47, 33], [2.33, 4]], [[2.21, 50], [2.83, 54], [2.81, 35], [2.53, 33]], [[2.93, 55], [3.37, 57], [3.33, 39], [2.91, 37]]];

/**
 * Movable surfaces and tail paint by rule: flaps inboard, slats and ailerons outboard,
 * an elevator and a rudder over the aft 30% of chord, a painted fin. A silhouette shows
 * none of them, and none of them changes it.
 */
export function dress(model) {
  const g = model.geometry, r2 = v => Math.round(v * 100) / 100;
  const body = g.fuselage.stations, topAt = x => body.reduce((a, q) => (Math.abs(q[0] - x) < Math.abs(a[0] - x) ? q : a))[2];
  const half = Math.max(...body.map(q => q[1]));
  for (const s of g.surfaces) {
    const id = Object.values(s.parts)[0].id, a = s.sections[0].at, b = s.sections.at(-1).at;
    if (id === 'wing') {
      const z0 = r2(half * 1.02), z1 = r2(z0 + (b - z0) * 0.3), z2 = r2(z0 + (b - z0) * 0.68), z3 = r2(z0 + (b - z0) * 0.94);
      s.parts = { box: { id: 'wing', label: 'Wing', system: 'surfaces' }, slats: { id: 'slats', label: 'Slats', system: 'controls', finish: 'metal' }, flaps: { id: 'flaps', label: 'Flaps', system: 'controls' }, ailerons: { id: 'aileron', label: 'Aileron', system: 'controls' } };
      s.segments = [
        { from: a, to: z0, split: [[0, 1, 'box']] },
        { from: z0, to: z1, split: [[0, 0.72, 'box'], [0.72, 1, 'flaps']] },
        { from: z1, to: z2, split: [[0, 0.14, 'slats'], [0.14, 0.74, 'box'], [0.74, 1, 'flaps']] },
        { from: z2, to: z3, split: [[0, 0.14, 'slats'], [0.14, 0.74, 'box'], [0.74, 1, 'ailerons']] },
        { from: z3, to: b, split: [[0, 1, 'box']] },
      ];
    } else if (id === 'stabilizer') {
      s.parts = { stab: { id: 'stabilizer', label: 'Horizontal stabilizer', system: 'surfaces' }, elev: { id: 'elevator', label: 'Elevator', system: 'controls' } };
      s.segments = [{ from: a, to: b, split: [[0, 0.7, 'stab'], [0.7, 1, 'elev']] }];
    } else if (id === 'fin') {
      // The rudder starts at the first section clear of the body.
      const clear = s.sections.find(q => q.at > topAt(q.le + q.chord * 0.5) + 0.2) ?? s.sections[1];
      const tip = s.sections.at(-1);
      s.parts = { fin: { id: 'fin', label: 'Vertical stabilizer', system: 'surfaces', finish: 'tail' }, rudder: { id: 'rudder', label: 'Rudder', system: 'controls', finish: 'tail' } };
      s.segments = clear.at > a + 0.05 && clear.at < b - 0.5
        ? [{ from: a, to: clear.at, split: [[0, 1, 'fin']] }, { from: clear.at, to: b, split: [[0, 0.7, 'fin'], [0.7, 1, 'rudder']] }]
        : [{ from: a, to: b, split: [[0, 1, 'fin']] }];
      s.paint = { base: '#18273a', stripe: { edge: [[clear.le, clear.at], [tip.le, tip.at]], offset: 0.45, width: 0.18, color: '#ff8a3d' } };
    }
  }
  return model;
}

/** One number for how far a model is from its target: the mean outline distance over the views, in meters. */
export function distance(sc) {
  const v = Object.values(sc);
  return v.reduce((a, s) => a + s.mean, 0) / v.length;
}

/**
 * @param {object} target silhouettes from src/fit/views.js
 * @param {{ id: string, name: string, specs?: object }} about
 * @param {{ steps?: number, log?: (line: string) => void }} [opts]
 */
export function fitViews(target, about, { steps = 3, log } = {}) {
  const want = measure(target);
  const frame = { L: target.L, H: target.H, S: target.S };
  const make = reading => {
    const geometry = { ...geometryFrom(reading, { engineName: about.specs?.engine_type }), materials: MATERIALS };
    return { id: about.id, name: about.name, category: 'aviation', builder: 'parametric', specs: about.specs ?? {}, livery: liveryFor(geometry), geometry };
  };
  let cur = want, model = make(cur), obj = buildModel(model), best = distance(score(target, obj));
  log?.(`start ${(best * 100).toFixed(1)} cm`);
  for (let k = 0; k < steps; k++) {
    let next, nextModel, nextObj, d;
    try {
      next = correct(cur, want, measure(targetOf(obj, { ppm: target.ppm, frame })));
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
  // A drawing also shows what is inside the outline: its own windows, doors and cockpit panes.
  if (target.inner) { const got = applyDetails(model, readDetails(target.inner, target.L)); log?.(`from the drawing: ${got.join(', ') || 'no inner detail found'}`); }
  return model;
}
