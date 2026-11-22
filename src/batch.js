// Merges a model's meshes by material into a few large ones, for views that never pick single
// parts (Compare). A detailed airliner has thousands of meshes but a few dozen distinct materials,
// so this cuts its draw calls by two orders of magnitude. Meshes are kept apart per part system,
// so a view can still hide the interior or the lights.
import * as THREE from 'three';
import { mergeGeometries, deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js';
import { patch } from './machina-paint.js';

const systemOf = o => { for (let p = o; p; p = p.parent) if (p.userData?.part) return p.userData.system ?? ''; return ''; };
const shown = (o, root) => { for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false; return true; };
const plain = THREE.Material.prototype.onBeforeCompile;

// Loaders give every mesh its own material object, so materials are grouped by what they look like.
const ids = new WeakMap();
let nextId = 0;
const idOf = x => { if (!x) return ''; if (!ids.has(x)) ids.set(x, ++nextId); return ids.get(x); };
const TEX = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'lightMap', 'bumpMap', 'specularMap', 'envMap'];
const VALS = ['type', 'emissiveIntensity', 'roughness', 'metalness', 'shininess', 'reflectivity', 'envMapIntensity', 'transparent', 'opacity', 'side',
  'alphaTest', 'vertexColors', 'depthWrite', 'depthTest', 'colorWrite', 'flatShading', 'wireframe', 'blending', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'toneMapped', 'fog'];
function look(mat) {
  const liv = mat.userData.livery;
  return [
    ...VALS.map(k => mat[k]),
    mat.color?.getHex(), mat.emissive?.getHex(), mat.specular?.getHex(),
    ...TEX.map(k => idOf(mat[k])),
    mat.normalScale ? `${mat.normalScale.x},${mat.normalScale.y}` : '',
    // Painted materials share all livery uniforms but uToRoot (that one is rebuilt below) and the part kind.
    liv ? `liv${idOf(liv.uBase)}:${liv.uTailAll.value}` : (mat.onBeforeCompile !== plain ? `custom${idOf(mat)}` : ''),
  ].join('|');
}

/**
 * @param {THREE.Object3D} root a loaded model, not on stage yet
 * @returns {THREE.Group} a new group with the same transform; root's geometries move into it
 */
export function batchByMaterial(root) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map();
  const keep = [];
  root.traverse(o => {
    if (!o.isMesh || !shown(o, root)) return;
    const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const mat = o.material;
    // Multi-material, skinned, instanced and morphing meshes stay as they are.
    if (Array.isArray(mat) || o.isSkinnedMesh || o.isInstancedMesh || Object.keys(o.geometry.morphAttributes).length) {
      keep.push([o, rel]);
      return;
    }
    let g = o.geometry.clone();
    if (Object.values(g.attributes).some(a => a.isInterleavedBufferAttribute)) g = deinterleaveGeometry(g);
    g.applyMatrix4(rel);
    if (rel.determinant() < 0) {
      // A mirrored mesh: baking the mirror in turns its faces inside out, so swap the winding back.
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      const ix = g.index.array;
      for (let i = 0; i + 2 < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    g.clearGroups();
    const sig = Object.entries(g.attributes).map(([k, a]) => `${k}${a.itemSize}${a.normalized ? 'n' : ''}${a.array.constructor.name}`).sort().join();
    // Painted meshes merge only when they map into the painted body's space the same way.
    const liv = mat.userData.livery;
    const livKey = liv ? liv.uToRoot.value.clone().multiply(rel.clone().invert()).elements.map(v => v.toFixed(4)).join() : '';
    const key = [look(mat), livKey, systemOf(o), sig, g.index ? 'i' : '', o.castShadow, o.receiveShadow, o.renderOrder].join('#');
    if (!buckets.has(key)) buckets.set(key, { mat, rel, system: systemOf(o), src: o, list: [] });
    buckets.get(key).list.push(g);
  });

  const out = new THREE.Group();
  out.name = root.name;
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  out.userData = { ...root.userData, batched: true };
  const materialFor = b => {
    const liv = b.mat.userData.livery;
    if (!liv) return b.mat;
    // The livery shader maps mesh space to the painted body's space with uToRoot; the merged mesh is
    // in this group's space already, so its matrix is the first mesh's uToRoot times its inverse placement.
    const m = b.mat.clone();
    patch(m, { ...liv, uToRoot: { value: liv.uToRoot.value.clone().multiply(b.rel.clone().invert()) } });
    return m;
  };
  const add = (geometry, b, mat) => {
    const m = new THREE.Mesh(geometry, mat);
    m.castShadow = b.src.castShadow;
    m.receiveShadow = b.src.receiveShadow;
    m.renderOrder = b.src.renderOrder;
    m.userData = { part: true, system: b.system };
    out.add(m);
  };
  for (const b of buckets.values()) {
    const mat = materialFor(b);
    const merged = b.list.length > 1 ? mergeGeometries(b.list) : b.list[0];
    if (merged) { add(merged, b, mat); if (merged !== b.list[0]) b.list.forEach(g => g.dispose()); }
    else b.list.forEach(g => add(g, b, mat)); // attributes that would not merge: keep them apart
  }
  const kept = new Set(keep.map(([o]) => o));
  for (const [o, m] of keep) {
    const c = new THREE.Mesh(o.geometry, o.material);
    m.decompose(c.position, c.quaternion, c.scale);
    c.castShadow = o.castShadow;
    c.receiveShadow = o.receiveShadow;
    c.renderOrder = o.renderOrder;
    c.userData = { part: true, system: systemOf(o) };
    out.add(c);
  }
  root.traverse(o => { if (o.isMesh && !kept.has(o)) o.geometry.dispose(); });
  nearOnly(out, 'interior');
  return out;
}

/**
 * Draw one system (the interior) only while the camera is within a few lengths of the model: from
 * further away it cannot be seen through the windows, and in an airliner it is half the triangles.
 */
function nearOnly(group, system) {
  const inner = group.children.filter(c => c.userData.system === system);
  if (!inner.length) return;
  const box = new THREE.Box3();
  for (const c of group.children) box.expandByObject(c);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const lod = new THREE.LOD();
  const near = new THREE.Group();
  lod.position.copy(center);
  near.position.copy(center).negate();
  near.add(...inner);
  lod.addLevel(near, 0);
  lod.addLevel(new THREE.Object3D(), Math.max(size.x, size.z) * 2.5);
  group.add(lod);
}
