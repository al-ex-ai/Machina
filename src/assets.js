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
  for (const { group, fallback, offset, rotation, chain, pose, parts: fileParts } of sources) {
    if (pose?.length) applyPose(group, pose);
    if (chain?.length) {
      // Nested FlightGear placements (an instrument in a panel in the interior), outermost first.
      const m = new THREE.Matrix4(), tmp = new THREE.Object3D();
      for (const c of [...chain, { offset, rotation }]) { tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); applyFgPlacement(tmp, c.offset, c.rotation); tmp.updateMatrix(); m.multiply(tmp.matrix); }
      m.decompose(group.position, group.quaternion, group.scale);
    } else if (offset || rotation) applyFgPlacement(group, offset, rotation);
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
      rule = rule.sides
        ? { ...rule, baseId: rule.id, id: `${k === 0 ? 'left' : 'right'}-${rule.id}`, label: `${k === 0 ? 'Left' : 'Right'} ${rule.label.toLowerCase()}` }
        : { ...rule, baseId: rule.id, id: `${rule.id}-${k + 1}`, label: `${rule.label} ${k + 1}` };
    }
    const geo = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(base, mesh.matrixWorld));
    if (model.asset.flipZ) flipWinding(geo);
    if (!clones.has(rule.id)) clones.set(rule.id, new Map());
    const cache = clones.get(rule.id);
    const own = mat => { if (!cache.has(mat)) cache.set(mat, mat.clone()); return cache.get(mat); };
    const m = new THREE.Mesh(geo, Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material));
    m.name = mesh.name;
    m.castShadow = m.receiveShadow = true;
    m.userData = { partChild: true, source: mesh.name, texture: mesh.userData.texture };
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

/**
 * Apply baked FlightGear animation transforms (see scripts/fg-pose.js) to the meshes they
 * name, in document order: each turns or slides the named objects, including meshes
 * inside a named group, in the file's own coordinates.
 */
function applyPose(group, pose) {
  const byName = new Map();
  group.traverse(o => { if (o.isMesh) { const names = []; for (let p = o; p && p !== group; p = p.parent) names.push(p.name); byName.set(o, names); } });
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const matrixOf = t => {
    const o = new THREE.Vector3(...t.origin), ax = new THREE.Vector3(...t.axis);
    return t.type === 'rotate'
      ? new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationAxis(ax, THREE.MathUtils.degToRad(t.value))).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z))
      : new THREE.Matrix4().makeTranslation(ax.x * t.value, ax.y * t.value, ax.z * t.value);
  };
  // FlightGear nests a transform above each animated object, so an object's own
  // animations act first, then its parent's, and so on up; at one level, file order.
  for (const [mesh, names] of byName) {
    const m = new THREE.Matrix4();
    for (const name of names) for (const t of pose) if (t.objects.includes(name)) m.premultiply(matrixOf(t));
    if (m.equals(new THREE.Matrix4())) continue;
    const toFile = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    mesh.geometry.applyMatrix4(new THREE.Matrix4().copy(toFile).invert().multiply(m).multiply(toFile));
  }
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
/**
 * Recolor a livery: pixels whose hue falls in the asset's livery hue range (the cheatline
 * and titles) take the accent's hue and saturation, keeping their lightness, so shading
 * and panel lines stay. Everything else in the texture is untouched.
 */
function recolor(bmp, accent, [h0, h1]) {
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const target = new THREE.Color(accent), hsl = {};
  target.getHSL(hsl);
  const col = new THREE.Color(), px = {};
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    col.getHSL(px);
    const deg = px.h * 360;
    if (px.s < 0.3 || px.l < 0.06 || px.l > 0.94 || deg < h0 || deg > h1) continue;
    // Lightness follows the original relative to its paint, centered on the accent's own.
    col.setHSL(hsl.h, Math.min(1, hsl.s), Math.min(0.95, Math.max(0.05, hsl.l + (px.l - 0.35) * 0.8)));
    d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255;
  }
  g.putImageData(img, 0, 0);
  return c.transferToImageBitmap();
}

/** @param {{ accent?: string }} [opts] accent recolors the livery (asset.recolor lists the textures) */
export async function loadAssetModel(model, opts = {}) {
  const a = model.asset;
  const base = `./${a.path.replace(/\/?$/, '/')}`;
  const files = assetFiles(model);
  if (!parsed.has(model.id)) {
    // A file placed several times (a screw, an instrument) is parsed once.
    const once = new Map();
    for (const f of files) if (!once.has(f.file)) once.set(f.file, parseACInWorker(base + f.file, hideRules(model)));
    parsed.set(model.id, Promise.all(files.map(f => once.get(f.file))));
  }
  const datas = await parsed.get(model.id);
  // Resolve only once every texture has loaded, so thumbnails never render blank.
  const pending = [];
  // Textures resolve relative to the .ac file that names them; shared ones load once.
  const textures = new Map();
  const optsFor = file => ({
    normalMaps: a.normalMaps,
    glass: a.glassTextures,
    loadTexture: tex0 => {
      const tex = a.textureMap?.[tex0] ?? tex0; // e.g. swap a white template for a painted livery
      const url = new URL(tex, new URL(base + file, location.href)).href;
      if (textures.has(url)) return textures.get(url);
      const t = new THREE.Texture();
      textures.set(url, t);
      t.flipY = false;
      const isNormal = /normal/i.test(tex);
      const paint = opts.accent && a.recolor?.textures?.some(r => url.endsWith(r));
      pending.push(loadBitmap(url).then(bmp => (paint ? recolor(bmp, opts.accent, a.recolor.hue) : bmp)).then(bmp => { t.image = bmp; t.needsUpdate = true; }).catch(err => console.warn('texture', url, err)));
      t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    },
  });
  const loaded = datas.map((d, i) => ({ ...files[i], group: buildAC(d, optsFor(files[i].file)) }));
  await Promise.all(pending);
  const root = assembleParts(loaded, model);
  // Body recolor: an all-white livery has no stripe to recolor, so the accent tints the
  // paint of the listed parts (materials are cloned per part). Dark details stay dark.
  if (opts.accent && a.recolor?.parts) {
    const want = new Set(a.recolor.parts), tint = new THREE.Color(opts.accent);
    root.traverse(o => { if (o.userData.part && want.has(o.userData.id)) o.traverse(q => { if (q.isMesh) for (const mat of [q.material].flat()) if (!mat.transparent) mat.color.copy(tint); }); });
  }
  return root;
}
