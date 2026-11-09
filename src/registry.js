// Builder registry: maps a model's "builder" field to the function that turns
// its JSON into a THREE.Group of selectable parts.
import * as THREE from 'three';

/** @typedef {(model: object) => THREE.Group} Builder */

/** @type {Map<string, { build: Builder, label: string }>} */
const builders = new Map();

/** @param {string} name @param {string} label @param {Builder} build */
export function registerBuilder(name, label, build) {
  builders.set(name, { build, label });
}

export function hasBuilder(name) {
  return name === 'asset' || builders.has(name);
}

export function listBuilders() {
  return [...builders.keys()];
}

/**
 * Build a model. The result is centered on x and z with its lowest point at y = 0.
 * @param {{ builder: string }} model
 */
export function buildModel(model) {
  if (model.builder === 'asset') throw new Error(`${model.id} only exists as a detailed asset`);
  const entry = builders.get(model.builder);
  if (!entry) throw new Error(`No builder registered for "${model.builder}"`);
  return finalize(entry.build(model), model);
}

/**
 * Number of selectable parts, for the home stats. Detailed models count the parts their
 * mapping produces (rules plus fallbacks); generated models are built and counted.
 */
export function partCount(model) {
  if (model.asset) {
    const a = model.asset;
    return new Set([...(a.parts ?? []).map(r => r.id), a.fallback?.id ?? 'airframe', ...(a.files ?? []).map(f => f.fallback?.id).filter(Boolean)]).size;
  }
  let n = 0;
  buildModel(model).traverse(o => {
    if (o.userData.part) n++;
    if (o.isMesh) { o.geometry.dispose(); for (const m of [o.material].flat()) { m.map?.dispose(); m.dispose(); } }
  });
  return n;
}

/** Center a built object on x and z and put its lowest point at y = 0. */
export function finalize(inner, model) {
  const box = new THREE.Box3().setFromObject(inner);
  const center = box.getCenter(new THREE.Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);
  const root = new THREE.Group();
  root.name = model.id;
  root.add(inner);
  root.userData = { modelId: model.id };
  return root;
}
