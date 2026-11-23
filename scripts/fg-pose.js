// Bake a FlightGear pose into a Machina asset: evaluate the model XML's rotate and
// translate animations at chosen property values (by default, landing gear down) and
// store the resulting transforms on the asset file, in document order. Some models are
// saved with the gear retracted and only lower it through these animations.
// Usage: node scripts/fg-pose.js <model.xml> data/models/aviation/<id>.json [fileIndex] [--anim] [property=value ...]
//   Extra property=value pairs pose more animations, e.g. gear/gear[0]/compression-norm=1 to
//   settle oleos stored at full extension onto the ground.
//   --anim also keeps the animations themselves (gear, oleos, flaps, elevator, rudder, propellers,
//   wheels) with their curves, so the app can move the parts at runtime (the takeoff scene).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { curveAt } from '../src/fg-curve.js';

const [xmlPath, modelFile, fileIndex = '0', ...rest] = process.argv.slice(2);
const keepAnim = rest.includes('--anim');
const sets = rest.filter(s => s !== '--anim');
const exact = k => new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
const POSE = [ // property pattern -> value
  ...sets.map(kv => { const i = kv.lastIndexOf('='); return [exact(kv.slice(0, i)), Number(kv.slice(i + 1)), kv.slice(0, i)]; }),
  [/gear\/gear\[\d+\]\/position-norm/, 1],
];
const ANIM = /^(gear\/gear\[\d+\]\/(position|compression)-norm|surface-positions\/(flap|elevator|rudder)-pos-norm|engines\/engine\[\d+\]\/rpm|velocities\/uBody-fps)$/;
const xml = readFileSync(xmlPath, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
const num = (s, tag) => { const m = new RegExp(`<${tag}>\\s*([-\\d.eE+]+)\\s*</${tag}>`).exec(s); return m ? Number(m[1]) : undefined; };
const fgToAc = ([x, y, z]) => [x, z, -y]; // FlightGear x aft, y right, z up -> AC x aft, y up, z left

// Axis objects: some models give a hinge as a two-vertex line object in the .ac file.
// Read every object's vertices in file coordinates (loc and rot applied down the tree).
const acPath = (() => { const p = /<path>\s*([^<]+?\.ac)\s*<\/path>/.exec(xml.replace(/<model>[\s\S]*?<\/model>/g, ''))?.[1]; return p && join(dirname(xmlPath), p); })();
const acVerts = new Map();
if (acPath && existsSync(acPath)) {
  const L = readFileSync(acPath, 'latin1').split(/\r?\n/);
  let i = 0;
  const obj = (parentLoc, parentRot) => {
    let name = '', loc = [0, 0, 0], rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], verts = [], kids = 0;
    for (; i < L.length; i++) {
      const t = L[i].trim().split(/\s+/);
      if (t[0] === 'name') name = L[i].trim().slice(5).replace(/^"|"$/g, '');
      else if (t[0] === 'loc') loc = t.slice(1, 4).map(Number);
      else if (t[0] === 'rot') rot = t.slice(1, 10).map(Number);
      else if (t[0] === 'numvert') { const n = Number(t[1]); for (let k = 0; k < n; k++) verts.push(L[++i].trim().split(/\s+/).slice(0, 3).map(Number)); }
      else if (t[0] === 'kids') { kids = Number(t[1]); i++; break; }
    }
    // World = parentRot * (rot * v + loc) + parentLoc
    const R = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
    const world = v => { const a = R(rot, v).map((c, k) => c + loc[k]); return R(parentRot, a).map((c, k) => c + parentLoc[k]); };
    if (name) acVerts.set(name, verts.map(world));
    const myLoc = world([0, 0, 0]);
    const mul = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
    const myRot = mul(parentRot, rot);
    for (let k = 0; k < kids; k++) { while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++; i++; obj(myLoc, myRot); }
  };
  while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++;
  i++;
  obj([0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

const r4 = c => Math.round(c * 1e4) / 1e4, r6 = c => Math.round(c * 1e6) / 1e6;
const out = [], anim = [];
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const type = /<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1];
  if (type !== 'rotate' && type !== 'translate' && type !== 'spin') continue;
  const prop = /<property>\s*([^<]+?)\s*<\/property>/.exec(a.replace(/<condition>[\s\S]*?<\/condition>/g, ''))?.[1];
  if (!prop) continue;
  const rule = type !== 'spin' && POSE.find(([re]) => re.test(prop));
  const animated = keepAnim && ANIM.test(prop);
  if (!rule && !animated) continue;
  const objects = [...a.replace(/<axis>[\s\S]*?<\/axis>/g, '').matchAll(/<object-name>\s*([^<]+?)\s*<\/object-name>/g)].map(m => m[1]);
  if (!objects.length) continue;
  const unit = type === 'rotate' ? 'deg' : 'm';
  const entries = [...a.matchAll(/<entry>\s*<ind>\s*([-\d.eE+]+)\s*<\/ind>\s*<dep>\s*([-\d.eE+]+)\s*<\/dep>\s*<\/entry>/g)].map(m => [Number(m[1]), Number(m[2])]);
  const curve = entries.length ? { table: entries } : {
    factor: num(a, 'factor'), offset: num(a, `offset-${unit}`),
    min: num(a, `min-${unit}`) ?? num(a, 'min'), max: num(a, `max-${unit}`) ?? num(a, 'max'),
  };
  for (const k of Object.keys(curve)) if (curve[k] === undefined) delete curve[k];
  const val = rule ? curveAt(curve, rule[1]) : 0;
  // Axis: an axis object, two points, or a center and a direction.
  const ax = /<axis>([\s\S]*?)<\/axis>/.exec(a)?.[1] ?? '';
  let origin, axis, sign = 1;
  const axisObj = /<object-name>\s*([^<]+?)\s*<\/object-name>/.exec(ax)?.[1];
  if (axisObj) {
    const v = acVerts.get(axisObj);
    if (!v || v.length < 2) continue;
    const d = v[1].map((c, k) => c - v[0][k]), len = Math.hypot(...d);
    if (!len) continue;
    // The sign convention of axis objects is not consistent between models (or even
    // between the two sides of one model), so pick the sign that lowers the part: every
    // pose transform here extends landing gear. Ties keep the negated value.
    const lowest = s => {
      const th = (s * val * Math.PI) / 180, u = d.map(c => c / len), cs = Math.cos(th), sn = Math.sin(th);
      let lo = Infinity;
      for (const n of objects) for (const p0 of acVerts.get(n) ?? []) {
        const q = p0.map((c, k) => c - v[0][k]), dot = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
        const cr = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]];
        lo = Math.min(lo, v[0][1] + q[1] * cs + cr[1] * sn + u[1] * dot * (1 - cs));
      }
      return lo;
    };
    sign = val && lowest(1) < lowest(-1) - 0.05 ? 1 : -1;
    origin = v[0].map(r4);
    axis = d.map(c => r6(c / len));
  } else {
    let p1, dir;
    if (num(ax, 'x1-m') !== undefined) {
      p1 = [num(ax, 'x1-m') ?? 0, num(ax, 'y1-m') ?? 0, num(ax, 'z1-m') ?? 0];
      const p2 = [num(ax, 'x2-m') ?? 0, num(ax, 'y2-m') ?? 0, num(ax, 'z2-m') ?? 0];
      dir = p2.map((c, i) => c - p1[i]);
    } else {
      const c = /<center>([\s\S]*?)<\/center>/.exec(a)?.[1] ?? '';
      p1 = [num(c, 'x-m') ?? 0, num(c, 'y-m') ?? 0, num(c, 'z-m') ?? 0];
      dir = [num(ax, 'x') ?? 0, num(ax, 'y') ?? 0, num(ax, 'z') ?? 0];
    }
    const len = Math.hypot(...dir);
    if (!len) continue;
    origin = fgToAc(p1).map(r4);
    axis = fgToAc(dir.map(c => c / len)).map(r6);
  }
  if (rule && val) out.push({ type, objects, value: Math.round(sign * val * 1000) / 1000, origin, axis });
  if (animated) anim.push({ type, objects, prop, ...curve, ...(sign !== 1 ? { sign } : {}), origin, axis });
}

// Left and right gear are mirror images. Where a right-side transform (objects ending
// in R) has a left twin (same names ending in L), rebuild it as the mirror of the left
// one across the centerline: origin z flipped, axis (-x, -y, z), same angle.
function mirror(list, same) {
  const key = t => t.objects.map(n => n.replace(/L$/, '#')).join(',');
  const lefts = new Map(list.filter(t => t.objects.every(n => /L$/.test(n))).map(t => [key(t), t]));
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.objects.every(n => /R$/.test(n))) continue;
    const l = lefts.get(t.objects.map(n => n.replace(/R$/, '#')).join(','));
    if (!l || l.type !== t.type) continue;
    // Only true twins across the centerline: in some models L and R name the two doors of one
    // nacelle (LGmainLDoorFL and LGmainLDoorFR are both on the left gear), which must stay as given.
    if (Math.sign(t.origin[2]) === Math.sign(l.origin[2]) && t.origin[2] !== 0) continue;
    list[i] = { ...t, ...same(l), origin: [l.origin[0], l.origin[1], -l.origin[2]], axis: t.type === 'translate' ? [l.axis[0], l.axis[1], -l.axis[2]] : [-l.axis[0], -l.axis[1], l.axis[2]] };
  }
}
mirror(out, l => ({ value: l.value }));
// Only the gear is mirrored for the animations too: flaps, elevators and propellers have their own
// curves per side (a right flap deflects with the left one, not against it).
const gearAnim = anim.filter(t => t.prop.startsWith('gear/'));
mirror(gearAnim, l => { const { type, objects, prop, origin, axis, ...curve } = l; return curve; });
let g = 0;
for (let i = 0; i < anim.length; i++) if (anim[i].prop.startsWith('gear/')) anim[i] = gearAnim[g++];

const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
const file = files[Number(fileIndex)];
if (out.length) file.pose = out; else delete file.pose;
if (keepAnim) {
  file.anim = anim;
  // The property values the pose was baked at, so the app starts its animations from them.
  file.poseState = Object.fromEntries(POSE.filter(r => r[2]).map(r => [r[2], r[1]]));
}
model.asset.files = files;
delete model.asset.file;
writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: baked ${out.length} gear-down transforms${keepAnim ? ` and kept ${anim.length} animations` : ''} into ${file.file}`);
