// Plays a FlightGear model's own animations (gear, oleos, flaps, elevator, rudder, propellers, wheels)
// at runtime. scripts/fg-pose.js --anim keeps them on the asset; src/assets.js records, per mesh, which
// ones move it. The geometry holds the baked pose, so each mesh gets matrix = F * M(state) * M(pose)^-1 * F^-1.
import * as THREE from 'three';
import { curveAt, conditionAt } from './fg-curve.js';
import { fgMatrix } from './assets.js';

/**
 * @param {THREE.Object3D} root a loaded asset model
 * @param {any} model its catalog entry
 * @returns {null | { values: Record<string, number>, spin: Record<string, number>, props: string[], meshes: THREE.Mesh[], apply(): void, reset(): void }}
 *   values: property values (gear/gear[1]/position-norm, ...); spin: turns so far per spin property, in degrees.
 */
export function fgAnimator(root, model) {
  const meshes = [];
  const shown = []; // meshes shown or hidden by gear position (select animations)
  const textured = []; // instrument faces whose texture moves (digit drums, attitude ball)
  root.traverse(o => { if (o.userData.fgAnim) meshes.push(o); if (o.userData.fgSelect) shown.push(o); if (o.userData.fgTex && o.geometry.attributes.uv) textured.push(o); });
  if (!meshes.length && !shown.length && !textured.length) return null;
  const poseState = Object.assign({}, ...(model.asset.files ?? []).map(f => f.poseState ?? {}));
  const condProps = c => (Array.isArray(c) ? (typeof c[1] === 'string' && c[0] !== 'and' && c[0] !== 'or' && c[0] !== 'not' ? [c[1]] : c.slice(1).flatMap(condProps)) : []);
  const props = [...new Set([...meshes.flatMap(o => o.userData.fgAnim.chain.map(t => t.prop)), ...shown.flatMap(o => o.userData.fgSelect.flatMap(condProps)).filter(p => p.startsWith('gear/')), ...textured.flatMap(o => o.userData.fgTex.map(t => t.prop))])];
  for (const o of textured) o.userData.uvBase ??= o.geometry.attributes.uv.array.slice();
  const initial = Object.fromEntries(props.map(p => [p, /position-norm$/.test(p) ? 1 : poseState[p] ?? 0]));
  const values = { ...initial }, spin = {};
  const M = new THREE.Matrix4(), T = new THREE.Matrix4();
  return {
    values, spin, props, meshes,
    apply() {
      for (const o of meshes) {
        const { chain, F, tail } = o.userData.fgAnim;
        M.identity();
        for (const t of chain) M.premultiply(fgMatrix(t, t.type === 'spin' ? (spin[t.prop] ?? 0) * (t.factor ?? 1) : curveAt(t, values[t.prop]), T));
        o.matrixAutoUpdate = false;
        o.matrix.copy(F).multiply(M).multiply(tail);
        o.matrixWorldNeedsUpdate = true;
      }
      for (const o of shown) o.visible = o.userData.baseVisible && o.userData.fgSelect.every(c => conditionAt(c, values));
      for (const o of textured) moveTexture(o, values);
    },
    /** Back to the baked pose, with the meshes' own matrices. */
    reset() {
      Object.assign(values, initial);
      for (const k of Object.keys(spin)) delete spin[k];
      for (const o of meshes) { o.matrix.identity(); o.matrixAutoUpdate = true; o.matrixWorldNeedsUpdate = true; }
      for (const o of shown) o.visible = o.userData.baseVisible && o.userData.fgSelect.every(c => conditionAt(c, values));
      for (const o of textured) { o.geometry.attributes.uv.array.set(o.userData.uvBase); o.geometry.attributes.uv.needsUpdate = true; }
    },
  };
}

/**
 * FlightGear's stepped value for a texture animation: a drum digit holds, then rolls over to the next during
 * the last `scroll` units of each step (an altimeter's thousands roll over in the last 50 ft).
 */
function texValue(t, v) {
  if (t.table) v = curveAt({ table: t.table }, v);
  else {
    if (t.step > 0) {
      const bias = t.bias ?? 0, f = (v - bias) / t.step, whole = Math.floor(f), rem = (f - whole) * t.step;
      let out = whole * t.step + bias;
      if (t.scroll > 0 && rem > t.step - t.scroll) out += (t.step * (rem - (t.step - t.scroll))) / t.scroll;
      v = out;
    }
    v = v * (t.factor ?? 1) + (t.offset ?? 0);
  }
  if (t.min !== undefined) v = Math.max(t.min, v);
  if (t.max !== undefined) v = Math.min(t.max, v);
  return v;
}

/** Texture coordinates of an instrument face moved and turned by its steps, from the coordinates it was drawn with. */
function moveTexture(o, values) {
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0; // uv' = [a b; c d] uv + [e f]
  for (const t of o.userData.fgTex) {
    const v = texValue(t, values[t.prop] ?? 0);
    if (t.kind === 'translate') { e += (t.axis[0] ?? 0) * v; f += (t.axis[1] ?? 0) * v; }
    else {
      const th = THREE.MathUtils.degToRad(v) * (t.axis[2] < 0 ? -1 : 1), cs = Math.cos(th), sn = Math.sin(th), [cx, cy] = t.center ?? [0, 0];
      // rotate the current transform about the center
      const na = cs * a - sn * c, nb = cs * b - sn * d, nc = sn * a + cs * c, nd = sn * b + cs * d;
      const ne = cs * (e - cx) - sn * (f - cy) + cx, nf = sn * (e - cx) + cs * (f - cy) + cy;
      a = na; b = nb; c = nc; d = nd; e = ne; f = nf;
    }
  }
  const base = o.userData.uvBase, uv = o.geometry.attributes.uv.array;
  for (let i = 0; i < base.length; i += 2) { const u = base[i], w = base[i + 1]; uv[i] = a * u + b * w + e; uv[i + 1] = c * u + d * w + f; }
  o.geometry.attributes.uv.needsUpdate = true;
}
