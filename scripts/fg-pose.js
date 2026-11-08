// Bake a FlightGear pose into a Machina asset: evaluate the model XML's rotate and
// translate animations at chosen property values (by default, landing gear down) and
// store the resulting transforms on the asset file, in document order. Some models are
// saved with the gear retracted and only lower it through these animations.
// Usage: node scripts/fg-pose.js <model.xml> data/models/aviation/<id>.json [fileIndex]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [xmlPath, modelFile, fileIndex = '0'] = process.argv.slice(2);
const POSE = [[/gear\/gear\[\d+\]\/position-norm/, 1]]; // property pattern -> value
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

const out = [];
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const type = /<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1];
  if (type !== 'rotate' && type !== 'translate') continue;
  const prop = /<property>\s*([^<]+?)\s*<\/property>/.exec(a)?.[1];
  const rule = prop && POSE.find(([re]) => re.test(prop));
  if (!rule) continue;
  const v = rule[1];
  const objects = [...a.replace(/<axis>[\s\S]*?<\/axis>/g, '').matchAll(/<object-name>\s*([^<]+?)\s*<\/object-name>/g)].map(m => m[1]);
  if (!objects.length) continue;
  // Value at the pose: interpolation table, or factor and offset, then clamps.
  const unit = type === 'rotate' ? 'deg' : 'm';
  let val;
  const entries = [...a.matchAll(/<entry>\s*<ind>\s*([-\d.eE+]+)\s*<\/ind>\s*<dep>\s*([-\d.eE+]+)\s*<\/dep>\s*<\/entry>/g)].map(m => [Number(m[1]), Number(m[2])]);
  if (entries.length) {
    if (v <= entries[0][0]) val = entries[0][1];
    else if (v >= entries.at(-1)[0]) val = entries.at(-1)[1];
    else for (let i = 0; i < entries.length - 1; i++) if (v <= entries[i + 1][0]) { const f = (v - entries[i][0]) / (entries[i + 1][0] - entries[i][0]); val = entries[i][1] + (entries[i + 1][1] - entries[i][1]) * f; break; }
  } else {
    val = v * (num(a, 'factor') ?? 1) + (num(a, `offset-${unit}`) ?? 0);
    const lo = num(a, `min-${unit}`) ?? num(a, 'min'), hi = num(a, `max-${unit}`) ?? num(a, 'max');
    if (lo !== undefined) val = Math.max(lo, val);
    if (hi !== undefined) val = Math.min(hi, val);
  }
  if (!val) continue;
  // Axis: two points, or a center and a direction.
  const ax = /<axis>([\s\S]*?)<\/axis>/.exec(a)?.[1] ?? '';
  let p1, dir;
  const axisObj = /<object-name>\s*([^<]+?)\s*<\/object-name>/.exec(ax)?.[1];
  if (axisObj) {
    const v = acVerts.get(axisObj);
    if (!v || v.length < 2) continue;
    const d = v[1].map((c, k) => c - v[0][k]), len = Math.hypot(...d);
    if (!len) continue;
    // The sign convention of axis objects is not consistent between models (or even
    // between the two sides of one model), so pick the sign that lowers the part: every
    // transform here extends landing gear. Ties keep the negated value.
    const lowest = sign => {
      const th = (sign * val * Math.PI) / 180, u = d.map(c => c / len), cs = Math.cos(th), sn = Math.sin(th);
      let lo = Infinity;
      for (const n of objects) for (const p0 of acVerts.get(n) ?? []) {
        const q = p0.map((c, k) => c - v[0][k]), dot = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
        const cr = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]];
        lo = Math.min(lo, v[0][1] + q[1] * cs + cr[1] * sn + u[1] * dot * (1 - cs));
      }
      return lo;
    };
    const sign = lowest(1) < lowest(-1) - 0.05 ? 1 : -1;
    out.push({ type, objects, value: Math.round(sign * val * 1000) / 1000, origin: v[0].map(c => Math.round(c * 1e4) / 1e4), axis: d.map(c => Math.round((c / len) * 1e6) / 1e6) });
    continue;
  }
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
  out.push({ type, objects, value: Math.round(val * 1000) / 1000, origin: fgToAc(p1).map(c => Math.round(c * 1e4) / 1e4), axis: fgToAc(dir.map(c => c / len)).map(c => Math.round(c * 1e6) / 1e6) });
}

// Left and right gear are mirror images. Where a right-side transform (objects ending
// in R) has a left twin (same names ending in L), rebuild it as the mirror of the left
// one across the centerline: origin z flipped, axis (-x, -y, z), same angle.
const key = t => t.objects.map(n => n.replace(/L$/, '#')).join(',');
const lefts = new Map(out.filter(t => t.objects.every(n => /L$/.test(n))).map(t => [key(t), t]));
for (let i = 0; i < out.length; i++) {
  const t = out[i];
  if (!t.objects.every(n => /R$/.test(n))) continue;
  const l = lefts.get(t.objects.map(n => n.replace(/R$/, '#')).join(','));
  if (!l || l.type !== t.type) continue;
  out[i] = { ...t, value: l.value, origin: [l.origin[0], l.origin[1], -l.origin[2]], axis: t.type === 'rotate' ? [-l.axis[0], -l.axis[1], l.axis[2]] : [l.axis[0], l.axis[1], -l.axis[2]] };
}

const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
files[Number(fileIndex)].pose = out;
model.asset.files = files;
delete model.asset.file;
writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: baked ${out.length} gear-down transforms into ${files[Number(fileIndex)].file}`);
