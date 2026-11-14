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

const MATERIALS = {
  metal: { color: '#b9bfc7', metalness: 0.85, roughness: 0.28, clearcoat: 0 },
  surfaces: { color: '#d4d8de', roughness: 0.42 },
  controls: { color: '#c9ced5', roughness: 0.45 },
  tail: { color: '#18273a', roughness: 0.32, clearcoat: 0.8 },
};

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
  const make = reading => ({
    id: about.id, name: about.name, category: 'aviation', builder: 'parametric',
    specs: about.specs ?? {},
    livery: { base: '#f5f6f8', belly: '#18273a', nacelle: '#18273a', pylon: '#d7dbe0' },
    geometry: { ...geometryFrom(reading, { engineName: about.specs?.engine_type }), materials: MATERIALS, details: false },
  });
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
  return model;
}
