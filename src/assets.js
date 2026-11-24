// Detailed models from open-licensed assets (FlightGear AC3D for now).
// The model file's "asset" block says where the files are, which objects to
// hide, and how named objects group into selectable parts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildAC, parseACInWorker } from './loaders/ac3d.js';
import { applyMachinaPaint } from './machina-paint.js';
import { conditionAt } from './fg-curve.js';

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
  for (const { group, fallback, offset, rotation, chain, pose, anim, groups: fgGroups, select: fgSelect, parentPose, parentAnim, parts: fileParts, places } of sources) {
    // parentPose and parentAnim: transforms the including XML gives this whole file (named "@file").
    const allPose = [...(pose ?? []), ...(parentPose ?? [])], allAnim = [...(anim ?? []), ...(parentAnim ?? [])];
    if (allPose.length || allAnim.length || fgSelect?.length) applyPose(group, allPose, allAnim, fgGroups, fgSelect);
    if (chain?.length) {
      // Nested FlightGear placements (an instrument in a panel in the interior), outermost first.
      const m = new THREE.Matrix4(), tmp = new THREE.Object3D();
      for (const c of [...chain, { offset, rotation }]) { tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); applyFgPlacement(tmp, c.offset, c.rotation); tmp.updateMatrix(); m.multiply(tmp.matrix); }
      m.decompose(group.position, group.quaternion, group.scale);
    } else if (offset || rotation) applyFgPlacement(group, offset, rotation);
    group.updateMatrixWorld(true);
    // places: the same file at many FlightGear offsets inside its placement (a cabin of seats), merged into
    // one mesh per object so hundreds of copies cost a handful of draw calls.
    if (places?.length) {
      const P = new THREE.Object3D(), inv = group.matrixWorld.clone().invert();
      const at = places.map(([x, y, z]) => { P.position.set(0, 0, 0); P.rotation.set(0, 0, 0); applyFgPlacement(P, { x, y, z }); P.updateMatrix(); return P.matrix.clone(); });
      group.traverse(o => {
        if (!o.isMesh || o.geometry.groups.length) return;
        const rel = inv.clone().multiply(o.matrixWorld), back = rel.clone().invert();
        o.geometry = mergeGeometries(at.map(M => o.geometry.clone().applyMatrix4(back.clone().multiply(M).multiply(rel))));
      });
    }
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
    if (mesh.userData.fgSelect) {
      // Shown as the simulator shows it with the gear down; src/fg-anim.js re-evaluates it as the gear moves.
      m.userData.fgSelect = mesh.userData.fgSelect;
      m.userData.baseVisible = mesh.visible;
      m.visible = mesh.visible && m.userData.fgSelect.every(c => conditionAt(c, poseStateOf(model)));
    }
    const fa = mesh.userData.fgAnim;
    if (fa) {
      // File space to this model's space: the geometry went through base * matrixWorld from the
      // mesh's own frame, and the mesh's own frame is toFile away from file space.
      const F = new THREE.Matrix4().multiplyMatrices(base, mesh.matrixWorld).multiply(fa.toFile.clone().invert());
      m.userData.fgAnim = { chain: fa.chain, F, tail: fa.poseInv.clone().multiply(F.clone().invert()) };
    }
    partFor(rule).add(m);
  }
  neutralGlass(groups);
  if (model.asset.compress) compressGear(groups, model.asset.compress);
  if (model.asset.restOnTail) restOnTail(root, groups, model.asset.restOnTail);
  return root;
}

/**
 * Windows (the glazing parts) left in a modeler's placeholder colour, an untextured fully saturated
 * primary such as pure green, render as neutral blue-grey glass. Light lenses are other parts and
 * keep their colours.
 */
function neutralGlass(groups) {
  const glass = new THREE.Color('#9fb6c8');
  for (const g of groups.values()) {
    if (g.userData.system !== 'glazing') continue;
    g.traverse(o => {
      if (!o.isMesh) return;
      for (const mat of [o.material].flat()) {
        if (!mat.transparent || mat.map || !mat.color) continue;
        const { r, g: gr, b } = mat.color, hi = Math.max(r, gr, b), lo = Math.min(r, gr, b);
        if (hi > 0.85 && lo < 0.05) mat.color.copy(glass);
      }
    });
  }
}

/**
 * Sources often store the oleos fully extended, as in flight, and compress them through an
 * animation. Slide the named objects (wheels, axles, lower struts) of each listed gear part
 * straight up until that part's lowest point is level with the reference part's.
 * compress: { parts: [part ids], objects: "/regex/" (default: every mesh), to: part id }
 */
function compressGear(groups, { parts, objects, to }) {
  const ref = groups.get(to);
  if (!ref) return;
  const re = objects ? new RegExp(objects.replace(/^\/|\/[a-z]*$/g, ''), (/\/([a-z]*)$/.exec(objects) ?? [])[1] ?? '') : null;
  const meshes = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
  const low = list => {
    let y = Infinity; const v = new THREE.Vector3();
    for (const o of list) { o.updateMatrixWorld(true); const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) y = Math.min(y, v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).y); }
    return y;
  };
  const target = low(meshes(ref));
  for (const id of parts) {
    const g = groups.get(id);
    if (!g) continue;
    const all = meshes(g), moving = re ? all.filter(o => re.test(o.userData.source ?? o.name)) : all;
    const dy = target - low(all);
    if (!(dy > 0) || !moving.length) continue;
    for (const o of moving) {
      // Shift in world space, applied to the geometry in the mesh's own frame.
      const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
      const shift = new THREE.Matrix4().makeTranslation(0, dy, 0);
      const S = new THREE.Matrix4().multiplyMatrices(inv, shift).multiply(o.matrixWorld);
      o.geometry.applyMatrix4(S);
      // Keep an animated part's frame (src/fg-anim.js) on the moved geometry, as restOnTail does.
      const fa = o.userData.fgAnim;
      if (fa) { fa.F.premultiply(S); fa.tail.multiply(S.clone().invert()); }
    }
  }
}

/**
 * Taildraggers are modeled level, but published heights are measured sitting on the
 * ground. Pitch the model about the main wheels until the tail wheel (or a nose wheel left
 * hanging by the source) touches down.
 */
function restOnTail(root, groups, { main, tail }) {
  const m = groups.get(main);
  const t = groups.get(tail);
  if (!m || !t) return;
  // Each group's lowest point, where its wheels meet the ground (a group's box can span doors
  // and struts well away from the wheels, which would put the pivot in the wrong place).
  const lowest = g => {
    const p = new THREE.Vector3(0, Infinity, 0), v = new THREE.Vector3();
    g.updateMatrixWorld(true);
    g.traverse(o => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (v.y < p.y) p.set(v.x, v.y, 0); } });
    return p;
  };
  const pivot = lowest(m), tailPoint = lowest(t);
  // The slope, not atan2: a nose wheel ahead of the mains must not turn the aircraft over.
  const angle = -Math.atan((tailPoint.y - pivot.y) / (tailPoint.x - pivot.x));
  const rot = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, 0));
  root.traverse(o => { if (o.isMesh) o.geometry.applyMatrix4(rot); });
  // Animated parts (src/fg-anim.js) map file space to model space through F; the geometry is now
  // pitched, so their frames are pitched with it or the gear would swing about the level pose.
  const inv = rot.clone().invert();
  root.traverse(o => { const fa = o.userData.fgAnim; if (o.isMesh && fa) { fa.F.premultiply(rot); fa.tail.multiply(inv); } });
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
function applyPose(group, pose = [], anim = [], fgGroups = {}, selects = []) {
  // Named groups (an animation with a <name>) sit between their member objects and the members'
  // parent, so they count as levels just above each member; a group can hold another group.
  const groupsOf = new Map();
  for (const [g, members] of Object.entries(fgGroups)) for (const n of members) groupsOf.set(n, [...(groupsOf.get(n) ?? []), g]);
  // An object in two groups sits in the one defined later, which FlightGear builds inside the earlier
  // one (the DC-3's lower leg folds within its whole leg): later groups are the inner levels.
  const levels = (name, out) => { out.push(name); for (const g of [...(groupsOf.get(name) ?? [])].reverse()) levels(g, out); return out; };
  const byName = new Map();
  group.traverse(o => { if (o.isMesh) { const names = []; for (let p = o; p && p !== group; p = p.parent) levels(p.name, names); names.push('@file'); byName.set(o, names); } });
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  // FlightGear nests a transform above each animated object, so an object's own
  // animations act first, then its parent's, and so on up. At one level, each later animation
  // is inserted between the object and the earlier ones, so it acts first: a wheel spins about its
  // axle, then the oleo slides it, then the gear leg swings it up.
  const late = list => [...list].reverse();
  const poseR = late(pose), animR = late(anim);
  for (const [mesh, names] of byName) {
    // Visibility by gear position (FlightGear select animations): every condition naming this mesh must hold.
    const conds = selects.filter(s => s.objects.some(o => names.includes(o))).map(s => s.cond);
    if (conds.length) mesh.userData.fgSelect = conds;
    const m = new THREE.Matrix4();
    for (const name of names) for (const t of poseR) if (t.objects.includes(name)) m.premultiply(fgMatrix(t, t.value));
    const chain = [];
    for (const name of names) for (const t of animR) if (t.objects.includes(name)) chain.push(t);
    const identity = m.equals(new THREE.Matrix4());
    if (identity && !chain.length) continue;
    const toFile = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    if (!identity) mesh.geometry.applyMatrix4(new THREE.Matrix4().copy(toFile).invert().multiply(m).multiply(toFile));
    // Kept for the runtime animations (see src/fg-anim.js): the geometry now holds the pose, so a
    // new state is applied as that state's transform times the pose's inverse.
    if (chain.length) mesh.userData.fgAnim = { chain, poseInv: m.clone().invert(), toFile };
  }
}

/** One FlightGear rotate, spin or translate transform at a value (degrees or meters), in file space. */
export function fgMatrix(t, value, out = new THREE.Matrix4()) {
  const [ox, oy, oz] = t.origin, [ax, ay, az] = t.axis;
  if (t.type === 'translate') return out.makeTranslation(ax * value, ay * value, az * value);
  _axis.set(ax, ay, az);
  return out.makeTranslation(ox, oy, oz).multiply(_rot.makeRotationAxis(_axis, THREE.MathUtils.degToRad(value))).multiply(_tr.makeTranslation(-ox, -oy, -oz));
}
const _axis = new THREE.Vector3(), _rot = new THREE.Matrix4(), _tr = new THREE.Matrix4();

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

// Simulator rendering aids inside cockpit files (a sky backdrop for the windows, light volumes)
// are never part of the aircraft.
const ALWAYS_HIDE = [/^internal.sky$/i, /^LightVolume/i];
export const hideRules = model => [...ALWAYS_HIDE, ...(model.asset.hide ?? []).map(toRegExp)];

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
 * Repaint a livery texture in the accent colour, keeping each pixel's lightness relative to its paint so
 * shading and panel lines stay. cfg (asset.recolor): hue [h0, h1] repaints that hue band (sat: minimum
 * saturation, 0.3 by default, lower for muted camouflage; base: the paint's usual lightness, 0.35 by
 * default); neutral [l0, l1, base] instead repaints the uncoloured skin (bare metal, white or black paint,
 * fabric) whose lightness lies in [l0, l1] and chroma (max - min channel) is at most sat, 0.08 by default;
 * chroma rather than HSL saturation, which runs high on near-whites. In hue mode sat may be [min, max] to
 * spare bright markings next to muted paint. skip lists texture rectangles [x0, y0, x1, y1] (0..1,
 * top-left origin) left alone, such as tyres and engine faces in the same atlas. A textures entry may be
 * { file, ...overrides } for a texture whose paint sits at another lightness.
 */
function recolor(bmp, accent, cfg) {
  const [h0, h1] = cfg.hue ?? [0, 360], neutral = cfg.neutral, skip = cfg.skip ?? [];
  const [minSat, satCap] = Array.isArray(cfg.sat) ? cfg.sat : [cfg.sat ?? 0.3, 1];
  const maxChroma = cfg.sat ?? 0.08, hueBase = cfg.base ?? 0.35;
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const target = new THREE.Color(accent), hsl = {};
  target.getHSL(hsl);
  const col = new THREE.Color(), px = {};
  const W = c.width, H = c.height;
  for (let i = 0; i < d.length; i += 4) {
    if (skip.length) {
      const x = ((i >> 2) % W) / W, y = Math.floor((i >> 2) / W) / H;
      if (skip.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
    }
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    col.getHSL(px);
    const deg = px.h * 360;
    if (neutral) {
      const [l0, l1, base] = neutral;
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > maxChroma * 255 || px.l < l0 || px.l > l1) continue;
      col.setHSL(hsl.h, Math.min(1, hsl.s), Math.min(0.95, Math.max(0.05, hsl.l + (px.l - base) * 0.8)));
    } else {
      if (px.s < minSat || px.s > satCap || px.l < 0.06 || px.l > 0.94 || deg < h0 || deg > h1) continue;
      // Lightness follows the original relative to its paint, centered on the accent's own.
      col.setHSL(hsl.h, Math.min(1, hsl.s), Math.min(0.95, Math.max(0.05, hsl.l + (px.l - hueBase) * 0.8)));
    }
    d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255;
  }
  g.putImageData(img, 0, 0);
  return c.transferToImageBitmap();
}

// glTF binary files load as they are (materials and textures included), alongside .ac files.
const isGlb = file => /\.glb$/i.test(file);
async function loadGlb(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(url)).scene;
}

/** @param {{ accent?: string }} [opts] accent recolors the livery (asset.recolor lists the textures) */
export async function loadAssetModel(model, opts = {}) {
  const a = model.asset;
  const base = `./${a.path.replace(/\/?$/, '/')}`;
  const files = assetFiles(model);
  if (!parsed.has(model.id)) {
    // A file placed several times (a screw, an instrument) is parsed once.
    const once = new Map();
    for (const f of files) if (!once.has(f.file)) once.set(f.file, isGlb(f.file) ? loadGlb(base + f.file) : parseACInWorker(base + f.file, hideRules(model)));
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
      // With the Machina livery on, the accent colours its stripe instead of repainting the skin.
      const paint = opts.accent && !(a.machina && !opts.original) && a.recolor?.textures?.find(r => url.endsWith(r.file ?? r));
      const cfg = paint && (typeof paint === 'string' ? a.recolor : { ...a.recolor, ...paint });
      pending.push(loadBitmap(url).then(bmp => (paint ? recolor(bmp, opts.accent, cfg) : bmp)).then(bmp => { t.image = bmp; t.needsUpdate = true; }).catch(err => console.warn('texture', url, err)));
      t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return t;
    },
  });
  const loaded = datas.map((d, i) => ({ ...files[i], group: isGlb(files[i].file) ? d.clone(true) : buildAC(d, optsFor(files[i].file)) }));
  await Promise.all(pending);
  const root = assembleParts(loaded, model);
  // The Machina livery is the default for models that opt in; "original" keeps the source paint.
  if (a.machina && !opts.original) applyMachinaPaint(root, a.machina, { stripe: opts.accent });
  return root;
}

/** The property values a model's baked pose stands for (gear down, oleos as modelled), from all its files. */
export function poseStateOf(model) {
  return Object.assign({}, ...(model.asset.files ?? []).map(f => f.poseState ?? {}));
}
