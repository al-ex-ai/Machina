// Detailed models from open-licensed assets (FlightGear AC3D for now).
// The model file's "asset" block says where the files are, which objects to
// hide, and how named objects group into selectable parts.
import * as THREE from 'three';
import { parseAC } from './loaders/ac3d.js';

/**
 * Group the loaded objects into parts. Objects that match no rule go into a
 * catch-all "airframe" part so nothing is left unselectable.
 * @param {THREE.Group} loaded
 * @param {any} model
 */
export function assembleParts(loaded, model) {
  const rules = (model.asset.parts ?? []).map(p => ({ ...p, res: p.match.map(toRegExp) }));
  const root = new THREE.Group();
  const flip = model.asset.flipZ ? new THREE.Matrix4().makeScale(1, 1, -1) : new THREE.Matrix4();
  const scale = model.asset.scale ?? 1;
  const base = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(flip);
  const groups = new Map();
  const clones = new Map(); // per part: original material -> clone, so highlighting one part never tints another
  const partFor = rule => {
    if (!groups.has(rule.id)) {
      const g = new THREE.Group();
      g.name = rule.id;
      g.userData = { part: true, id: rule.id, label: rule.label, system: rule.system, info: { ...(model.parts?.[rule.id] ?? {}) } };
      groups.set(rule.id, g);
      root.add(g);
    }
    return groups.get(rule.id);
  };
  const fallback = model.asset.fallback ?? { id: 'airframe', label: 'Airframe details', system: 'structure' };

  loaded.updateMatrixWorld(true);
  const meshes = [];
  loaded.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const mesh of meshes) {
    const rule = rules.find(r => r.res.some(re => re.test(mesh.name))) ?? fallback;
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, mesh.matrixWorld));
    if (model.asset.flipZ) flipWinding(geo);
    if (!clones.has(rule.id)) clones.set(rule.id, new Map());
    const cache = clones.get(rule.id);
    const own = mat => { if (!cache.has(mat)) cache.set(mat, mat.clone()); return cache.get(mat); };
    const m = new THREE.Mesh(geo, Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material));
    m.name = mesh.name;
    m.castShadow = m.receiveShadow = true;
    m.userData = { partChild: true, source: mesh.name };
    partFor(rule).add(m);
  }
  return root;
}

function toRegExp(s) {
  return s.startsWith('/') ? new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1)) : new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

// Mirroring flips triangle orientation; swap two corners (normals were already mirrored).
function flipWinding(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, nor, uv]) {
      if (!attr) continue;
      for (let k = 0; k < attr.itemSize; k++) {
        const a = attr.array[(i + 1) * attr.itemSize + k];
        attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
        attr.array[(i + 2) * attr.itemSize + k] = a;
      }
    }
  }
  if (nor) nor.needsUpdate = true;
  pos.needsUpdate = true;
}

export const hideRules = model => (model.asset.hide ?? []).map(toRegExp);

/** Browser: fetch and build the detailed model. */
export async function loadAssetModel(model) {
  const a = model.asset;
  const base = `./${a.path.replace(/\/?$/, '/')}`;
  const text = await fetch(base + a.file).then(r => { if (!r.ok) throw new Error(`${a.file}: ${r.status}`); return r.text(); });
  // Resolve only once every texture has loaded, so thumbnails never render blank.
  const manager = new THREE.LoadingManager();
  const done = new Promise(resolve => { manager.onLoad = resolve; manager.onError = () => {}; });
  let pending = 0;
  const loader = new THREE.TextureLoader(manager);
  const loaded = parseAC(text, {
    hide: hideRules(model),
    normalMaps: a.normalMaps,
    loadTexture: file => {
      pending++;
      const t = loader.load(base + file);
      t.colorSpace = /normal/i.test(file) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    },
  });
  if (pending) await done;
  return assembleParts(loaded, model);
}
