// Detailed models from open-licensed assets (FlightGear AC3D for now).
// The model file's "asset" block says where the files are, which objects to
// hide, and how named objects group into selectable parts.
import * as THREE from 'three';
import { buildAC, parseACInWorker } from './loaders/ac3d.js';

const parsed = new Map(); // model id -> promise of parsed AC data, shared by the viewer and thumbnails

/**
 * Group the loaded objects into parts. Objects that match no rule go into a
 * catch-all "airframe" part so nothing is left unselectable.
 * @param {THREE.Object3D | { group: THREE.Object3D, fallback?: object }[]} loaded one group, or one per asset file
 * @param {any} model
 */
export function assembleParts(loaded, model) {
  const sources = Array.isArray(loaded) ? loaded : [{ group: loaded }];
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
      g.userData = { part: true, id: rule.id, label: rule.label, system: rule.system, info: { ...(model.parts?.[rule.baseId ?? rule.id] ?? {}) } };
      groups.set(rule.id, g);
      root.add(g);
    }
    return groups.get(rule.id);
  };
  const defaultFallback = model.asset.fallback ?? { id: 'airframe', label: 'Airframe details', system: 'structure' };

  const meshes = [];
  for (const { group, fallback, offset, rotation, parts: fileParts } of sources) {
    if (offset || rotation) applyFgPlacement(group, offset, rotation);
    group.updateMatrixWorld(true);
    // File-scoped rules (for example a left wing file) win over the model-wide ones.
    const local = (fileParts ?? []).map(r => ({ ...r, res: r.match.map(toRegExp) }));
    group.traverse(o => { if (o.isMesh) meshes.push([o, fallback ?? defaultFallback, local]); });
  }
  // Rules with "split" divide their meshes into N parts by side-to-side position,
  // numbered from the left (+z), e.g. four engines with identical object names.
  const splitOf = new Map();
  for (const r of rules.filter(r => r.split)) {
    const list = meshes.filter(([mesh]) => r.res.some(re => re.test(mesh.name))).map(([mesh]) => {
      mesh.geometry.computeBoundingBox();
      return [mesh, mesh.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).z];
    }).sort((a, b) => b[1] - a[1]);
    const gaps = list.slice(1).map(([, z], i) => [list[i][1] - z, i]).sort((a, b) => b[0] - a[0]).slice(0, r.split - 1).map(([, i]) => i).sort((a, b) => a - b);
    let k = 0;
    list.forEach(([mesh], i) => { splitOf.set(mesh, k); if (gaps.includes(i)) k++; });
  }

  for (const [mesh, fallback, local] of meshes) {
    let rule = local.find(r => r.res.some(re => re.test(mesh.name))) ?? rules.find(r => r.res.some(re => re.test(mesh.name))) ?? fallback;
    if (rule.split) {
      const k = splitOf.get(mesh) ?? 0;
      rule = { ...rule, baseId: rule.id, id: `${rule.id}-${k + 1}`, label: `${rule.label} ${k + 1}` };
    }
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
  if (model.asset.restOnTail) restOnTail(root, groups, model.asset.restOnTail);
  return root;
}

/**
 * Taildraggers are modeled level, but published heights are measured sitting on the
 * ground. Pitch the model about the main wheels until the tail wheel touches down.
 */
function restOnTail(root, groups, { main, tail }) {
  const m = groups.get(main);
  const t = groups.get(tail);
  if (!m || !t) return;
  const mb = new THREE.Box3().setFromObject(m);
  const tb = new THREE.Box3().setFromObject(t);
  const pivot = new THREE.Vector3((mb.min.x + mb.max.x) / 2, mb.min.y, 0);
  const tailPoint = new THREE.Vector3((tb.min.x + tb.max.x) / 2, tb.min.y, 0);
  const angle = -Math.atan2(tailPoint.y - pivot.y, tailPoint.x - pivot.x);
  const rot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, 0));
  root.traverse(o => { if (o.isMesh) o.geometry.applyMatrix4(rot); });
}

/**
 * Place a sub-model using FlightGear offsets (x aft, y right, z up, in meters and
 * degrees). AC files use x aft, y up, z left, so FG (x, y, z) maps to AC (x, z, -y).
 */
function applyFgPlacement(group, offset = {}, rotation = {}) {
  group.position.set(offset.x ?? 0, offset.z ?? 0, -(offset.y ?? 0));
  const d = THREE.MathUtils.degToRad;
  group.rotation.set(d(rotation.roll ?? 0), d(rotation.heading ?? 0), -d(rotation.pitch ?? 0), 'YZX');
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

/** The asset files of a model: [{ file, fallback? }]. */
export const assetFiles = model => model.asset.files ?? [{ file: model.asset.file }];

const MAX_TEXTURE = 2048;

/**
 * Decode an image off the main thread, flipped for WebGL, and downscale it when
 * either side exceeds MAX_TEXTURE (a 4096 px texture costs four times the memory).
 */
async function loadBitmap(url) {
  const blob = await fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); });
  let bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  const big = Math.max(bmp.width, bmp.height);
  if (big > MAX_TEXTURE) {
    const k = MAX_TEXTURE / big;
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high', premultiplyAlpha: 'none' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}

/** Browser: fetch and build the detailed model. */
export async function loadAssetModel(model) {
  const a = model.asset;
  const base = `./${a.path.replace(/\/?$/, '/')}`;
  const files = assetFiles(model);
  if (!parsed.has(model.id)) parsed.set(model.id, Promise.all(files.map(f => parseACInWorker(base + f.file, hideRules(model)))));
  const datas = await parsed.get(model.id);
  // Resolve only once every texture has loaded, so thumbnails never render blank.
  const pending = [];
  // Textures resolve relative to the .ac file that names them; shared ones load once.
  const textures = new Map();
  const optsFor = file => ({
    normalMaps: a.normalMaps,
    loadTexture: tex => {
      const url = new URL(tex, new URL(base + file, location.href)).href;
      if (textures.has(url)) return textures.get(url);
      const t = new THREE.Texture();
      textures.set(url, t);
      t.flipY = false;
      const isNormal = /normal/i.test(tex);
      pending.push(loadBitmap(url).then(bmp => { t.image = bmp; t.needsUpdate = true; }).catch(err => console.warn('texture', url, err)));
      t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    },
  });
  const loaded = datas.map((d, i) => ({ ...files[i], group: buildAC(d, optsFor(files[i].file)) }));
  await Promise.all(pending);
  return assembleParts(loaded, model);
}
