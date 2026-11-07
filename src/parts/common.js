// Shared part helpers: systems, materials and the part factory.
// Coordinate convention for every builder:
//   +x runs from the nose (x = 0) toward the tail, +y is up,
//   +z is the LEFT side (port), -z is the RIGHT side (starboard).
import * as THREE from 'three';

/** @typedef {{ id: string, label: string, system: string, info?: Record<string, string|number> }} PartMeta */

export const SYSTEMS = {
  structure: { label: 'Structure', color: '#d9dde3' },
  surfaces: { label: 'Flight surfaces', color: '#c3cad3' },
  propulsion: { label: 'Propulsion', color: '#55606e' },
  gear: { label: 'Landing gear', color: '#3a3f47' },
  glazing: { label: 'Glazing', color: '#4d6f91' },
  rotor: { label: 'Rotor system', color: '#474c54' },
  armament: { label: 'Armament', color: '#5f6452' },
  mobility: { label: 'Running gear', color: '#2d3034' },
  sensors: { label: 'Sensors', color: '#7a8594' },
};

/**
 * Create a selectable part mesh.
 * @param {THREE.BufferGeometry} geometry
 * @param {PartMeta} meta
 * @param {Record<string, string>} [livery] per-system color overrides from the model file
 */
export function makePart(geometry, meta, livery = {}) {
  const sys = SYSTEMS[meta.system] ?? SYSTEMS.structure;
  const color = livery[meta.system] ?? sys.color;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: meta.system === 'glazing' ? 0.15 : 0.55,
    metalness: meta.system === 'propulsion' || meta.system === 'armament' ? 0.45 : 0.15,
  });
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = meta.id;
  mesh.userData = { part: true, id: meta.id, label: meta.label, system: meta.system, info: meta.info ?? {} };
  return mesh;
}

/** Group several meshes into one selectable part (for example a gear leg plus its wheels). */
export function makeCompositePart(children, meta, livery = {}) {
  const group = new THREE.Group();
  group.name = meta.id;
  group.userData = { part: true, id: meta.id, label: meta.label, system: meta.system, info: meta.info ?? {} };
  for (const { geometry, system } of children) {
    const mesh = makePart(geometry, { ...meta, system: system ?? meta.system }, livery);
    mesh.userData = { partChild: true };
    group.add(mesh);
  }
  return group;
}

/** Merge per-part info from the model file over the builder's defaults. */
export function partInfo(model, id, defaults = {}) {
  return { ...defaults, ...(model.parts?.[id] ?? {}) };
}

export const deg = (d) => (d * Math.PI) / 180;
