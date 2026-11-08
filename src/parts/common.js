// Shared part helpers: systems, materials and the part factory.
// Coordinate convention for every builder:
//   +x runs from the nose (x = 0) toward the tail, +y is up,
//   +z is the LEFT side (port), -z is the RIGHT side (starboard).
import * as THREE from 'three';

/** @typedef {{ id: string, label: string, system: string, info?: Record<string, string|number>, material?: MaterialOpts }} PartMeta */
/** @typedef {{ color?: string, map?: THREE.Texture|null, metalness?: number, roughness?: number, clearcoat?: number, doubleSide?: boolean, envMapIntensity?: number }} MaterialOpts */

// Finish per system: painted panels get clearcoat, metal parts get metalness.
const FINISH = {
  structure: { roughness: 0.38, metalness: 0.05, clearcoat: 0.6 },
  surfaces: { roughness: 0.42, metalness: 0.1, clearcoat: 0.4 },
  propulsion: { roughness: 0.32, metalness: 0.6, clearcoat: 0.2 },
  gear: { roughness: 0.55, metalness: 0.3, clearcoat: 0 },
  glazing: { roughness: 0.05, metalness: 0.2, clearcoat: 1 },
  rotor: { roughness: 0.5, metalness: 0.2, clearcoat: 0.1 },
  armament: { roughness: 0.45, metalness: 0.55, clearcoat: 0 },
  mobility: { roughness: 0.8, metalness: 0.2, clearcoat: 0 },
  sensors: { roughness: 0.25, metalness: 0.4, clearcoat: 0.5 },
  controls: { roughness: 0.42, metalness: 0.1, clearcoat: 0.4 },
  lights: { roughness: 0.2, metalness: 0.3, clearcoat: 0.8 },
  avionics: { roughness: 0.4, metalness: 0.5, clearcoat: 0.2 },
  interior: { roughness: 0.7, metalness: 0.05, clearcoat: 0 },
};

/** Build a material for a system, with optional overrides. */
export function systemMaterial(system, livery = {}, opts = {}) {
  const sys = SYSTEMS[system] ?? SYSTEMS.structure;
  const finish = FINISH[system] ?? FINISH.structure;
  return new THREE.MeshPhysicalMaterial({
    color: opts.color ?? livery[system] ?? sys.color,
    map: opts.map ?? null,
    roughness: opts.roughness ?? finish.roughness,
    metalness: opts.metalness ?? finish.metalness,
    clearcoat: opts.clearcoat ?? finish.clearcoat,
    clearcoatRoughness: 0.25,
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: opts.envMapIntensity ?? 1,
    specularIntensity: opts.specularIntensity ?? 1,
  });
}

export const SYSTEMS = {
  structure: { label: 'Structure', color: '#d9dde3' },
  surfaces: { label: 'Flight surfaces', color: '#c3cad3' },
  controls: { label: 'Control surfaces', color: '#9fb4c8' },
  propulsion: { label: 'Propulsion', color: '#55606e' },
  gear: { label: 'Landing gear', color: '#3a3f47' },
  glazing: { label: 'Glazing', color: '#4d6f91' },
  rotor: { label: 'Rotor system', color: '#474c54' },
  armament: { label: 'Armament', color: '#5f6452' },
  mobility: { label: 'Running gear', color: '#2d3034' },
  sensors: { label: 'Sensors', color: '#7a8594' },
  lights: { label: 'Lights', color: '#e8c15a' },
  avionics: { label: 'Antennas and probes', color: '#8f86c9' },
  interior: { label: 'Cabin interior', color: '#a08a72' },
};

/**
 * Create a selectable part mesh.
 * @param {THREE.BufferGeometry} geometry
 * @param {PartMeta} meta
 * @param {Record<string, string>} [livery] per-system color overrides from the model file
 */
export function makePart(geometry, meta, livery = {}) {
  const material = systemMaterial(meta.system, livery, meta.material);
  if (!meta.keepNormals) geometry.computeVertexNormals();
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
  for (const { geometry, system, material } of children) {
    const mesh = makePart(geometry, { ...meta, system: system ?? meta.system, material: material ?? meta.material, keepNormals: false }, livery);
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
