// Quality standard for detailed models. A model must pass every check here to be
// listed in the catalog. Measured on the parsed asset, so it runs in Node.
import * as THREE from 'three';

export const STANDARD = {
  minTriangles: 12000, // enough geometry for curved surfaces and small parts
  minTextured: 0.5, // share of opaque surface area that carries a texture (the rest must be colored, see maxPlain)
  maxPlain: 0.15, // share of opaque surface that is untextured near-white (unpainted placeholder)
  maxPlainGear: 0.25, // same, for the landing gear alone: white gear legs and wheels look unfinished
  minParts: 10,
  interior: true, // a cabin or cockpit must be modelled (seats, panel, controls)
  minInteriorTriangles: 1500,
};

const PLACEHOLDER_TEXTURE = /transparent|shadow/i;
const tri = new THREE.Triangle();
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

function meshArea(mesh) {
  const pos = mesh.geometry.attributes.position;
  let area = 0;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    area += tri.set(a, b, c).getArea();
  }
  return area;
}

const partOf = o => { while (o && !o.userData.part) o = o.parent; return o?.userData ?? {}; };

/** Measure a built model (from loadAssetNode) against the standard. */
export function measureQuality(obj, model) {
  obj.updateMatrixWorld(true);
  let triangles = 0, total = 0, textured = 0, plain = 0, gear = 0, gearPlain = 0, interiorTris = 0;
  const parts = new Set();
  obj.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const n = o.geometry.attributes.position.count / 3;
    const part = partOf(o);
    if (part.id) parts.add(part.id);
    triangles += n;
    if (part.system === 'interior' || part.system === 'avionics') interiorTris += n;
    const mat = [o.material].flat()[0];
    if (mat.transparent) return; // glass and covers do not count toward paint
    const area = meshArea(o);
    const tex = o.userData.texture;
    const hasTex = Boolean(tex) && !PLACEHOLDER_TEXTURE.test(tex);
    const isPlain = !hasTex && mat.color.r > 0.75 && mat.color.g > 0.75 && mat.color.b > 0.75;
    total += area;
    if (hasTex) textured += area;
    if (isPlain) plain += area;
    if (part.system === 'gear') { gear += area; if (isPlain) gearPlain += area; }
  });
  const fails = [];
  const m = {
    triangles: Math.round(triangles),
    parts: parts.size,
    textured: total ? textured / total : 0,
    plain: total ? plain / total : 0,
    plainGear: gear ? gearPlain / gear : 0,
    interiorTriangles: Math.round(interiorTris),
  };
  // A model may relax a rule only with a written reason, e.g. an open-frame aircraft with no cabin.
  const s = { ...STANDARD, ...model.quality?.standard };
  if (model.quality?.standard && !model.quality.reason) fails.push('quality override without a reason');
  if (m.triangles < s.minTriangles) fails.push(`${m.triangles} triangles, needs ${s.minTriangles}`);
  if (m.parts < s.minParts) fails.push(`${m.parts} parts, needs ${s.minParts}`);
  if (m.textured < s.minTextured) fails.push(`${pct(m.textured)} textured, needs ${pct(s.minTextured)}`);
  if (m.plain > s.maxPlain) fails.push(`${pct(m.plain)} plain white, max ${pct(s.maxPlain)}`);
  if (m.plainGear > s.maxPlainGear) fails.push(`landing gear ${pct(m.plainGear)} plain white, max ${pct(s.maxPlainGear)}`);
  if (s.interior && m.interiorTriangles < s.minInteriorTriangles) fails.push(`no interior (${m.interiorTriangles} triangles, needs ${s.minInteriorTriangles})`);
  return { metrics: m, fails, pass: fails.length === 0 };
}

const pct = v => `${Math.round(v * 100)}%`;
