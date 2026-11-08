// Bake a FlightGear pose into a Machina asset: evaluate the model XML's rotate and
// translate animations at chosen property values (by default, landing gear down) and
// store the resulting transforms on the asset file, in document order. Some models are
// saved with the gear retracted and only lower it through these animations.
// Usage: node scripts/fg-pose.js <model.xml> data/models/aviation/<id>.json [fileIndex]
import { readFileSync, writeFileSync } from 'node:fs';

const [xmlPath, modelFile, fileIndex = '0'] = process.argv.slice(2);
const POSE = [[/gear\/gear\[\d+\]\/position-norm/, 1]]; // property pattern -> value
const xml = readFileSync(xmlPath, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
const num = (s, tag) => { const m = new RegExp(`<${tag}>\\s*([-\\d.eE+]+)\\s*</${tag}>`).exec(s); return m ? Number(m[1]) : undefined; };
const fgToAc = ([x, y, z]) => [x, z, -y]; // FlightGear x aft, y right, z up -> AC x aft, y up, z left

const out = [];
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const type = /<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1];
  if (type !== 'rotate' && type !== 'translate') continue;
  const prop = /<property>\s*([^<]+?)\s*<\/property>/.exec(a)?.[1];
  const rule = prop && POSE.find(([re]) => re.test(prop));
  if (!rule) continue;
  const v = rule[1];
  const objects = [...a.matchAll(/<object-name>\s*([^<]+?)\s*<\/object-name>/g)].map(m => m[1]).filter(n => !/<axis>[\s\S]*<object-name>/.test(''));
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

const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
files[Number(fileIndex)].pose = out;
model.asset.files = files;
delete model.asset.file;
writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: baked ${out.length} gear-down transforms into ${files[Number(fileIndex)].file}`);
