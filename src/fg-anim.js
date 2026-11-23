// Plays a FlightGear model's own animations (gear, oleos, flaps, elevator, rudder, propellers, wheels)
// at runtime. scripts/fg-pose.js --anim keeps them on the asset; src/assets.js records, per mesh, which
// ones move it. The geometry holds the baked pose, so each mesh gets matrix = F * M(state) * M(pose)^-1 * F^-1.
import * as THREE from 'three';
import { curveAt } from './fg-curve.js';
import { fgMatrix } from './assets.js';

/**
 * @param {THREE.Object3D} root a loaded asset model
 * @param {any} model its catalog entry
 * @returns {null | { values: Record<string, number>, spin: Record<string, number>, props: string[], apply(): void, reset(): void }}
 *   values: property values (gear/gear[1]/position-norm, ...); spin: turns so far per spin property, in degrees.
 */
export function fgAnimator(root, model) {
  const meshes = [];
  root.traverse(o => { if (o.userData.fgAnim) meshes.push(o); });
  if (!meshes.length) return null;
  const poseState = Object.assign({}, ...(model.asset.files ?? []).map(f => f.poseState ?? {}));
  const props = [...new Set(meshes.flatMap(o => o.userData.fgAnim.chain.map(t => t.prop)))];
  const initial = Object.fromEntries(props.map(p => [p, /position-norm$/.test(p) ? 1 : poseState[p] ?? 0]));
  const values = { ...initial }, spin = {};
  const M = new THREE.Matrix4(), T = new THREE.Matrix4();
  return {
    values, spin, props,
    apply() {
      for (const o of meshes) {
        const { chain, F, tail } = o.userData.fgAnim;
        M.identity();
        for (const t of chain) M.premultiply(fgMatrix(t, t.type === 'spin' ? (spin[t.prop] ?? 0) * (t.factor ?? 1) : curveAt(t, values[t.prop]), T));
        o.matrixAutoUpdate = false;
        o.matrix.copy(F).multiply(M).multiply(tail);
        o.matrixWorldNeedsUpdate = true;
      }
    },
    /** Back to the baked pose, with the meshes' own matrices. */
    reset() {
      Object.assign(values, initial);
      for (const k of Object.keys(spin)) delete spin[k];
      for (const o of meshes) { o.matrix.identity(); o.matrixAutoUpdate = true; o.matrixWorldNeedsUpdate = true; }
    },
  };
}
