// Bring a FlightGear aircraft's cockpit and cabin into its Machina asset. FlightGear
// assembles a model from a tree of XML files, each placing sub-models with offsets;
// the first import only took the exterior. This walks the tree from the top model XML,
// keeps the files that belong inside (interior, cockpit, panel, instruments, seats,
// pilots, yokes, pedals), copies them and their textures, and adds them to the model
// file with their nested placements.
// Usage: node scripts/import-fg-interior.js <aircraftRoot> data/models/aviation/<id>.json [Models/<top>.xml]
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative, basename } from 'node:path';

const [root, modelFile, topArg] = process.argv.slice(2);
if (!root || !modelFile) { console.error('Usage: node scripts/import-fg-interior.js <aircraftRoot> <model.json> [Models/<top>.xml]'); process.exit(1); }
const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const dest = model.asset.path;
const aircraftName = basename(normalize(root));
const INSIDE = /(^|\/)vc[._]|interior|cockpit|panel|instrument|seat|pilot|yoke|pedal|cabin|stick|throttle|glareshield/i;
const SKIP = /effects?\/|lights?\/|sounds?\/|shadow|\/ai\/|immat|livery|liveries|procedural|flame|smoke|reflect/i;

const num = (block, tag) => { const m = new RegExp(`<${tag}>\\s*([-\\d.eE+]+)\\s*</${tag}>`).exec(block); return m ? Number(m[1]) : undefined; };
function placement(block) {
  const o = /<offsets>([\s\S]*?)<\/offsets>/.exec(block)?.[1];
  if (!o) return null;
  const offset = { x: num(o, 'x-m') ?? 0, y: num(o, 'y-m') ?? 0, z: num(o, 'z-m') ?? 0 };
  const rotation = { pitch: num(o, 'pitch-deg') ?? 0, heading: num(o, 'heading-deg') ?? 0, roll: num(o, 'roll-deg') ?? 0 };
  return { offset, rotation };
}
// Resolve a model path: relative to the current XML, or "Aircraft/<Name>/..." from the
// aircraft root. Shared FlightGear files outside the package are not available.
function resolvePath(p, fromDir) {
  p = p.trim().replace(/\\/g, '/');
  const abs = /^Aircraft\/([^/]+)\/(.*)$/.exec(p);
  if (abs) return abs[1].toLowerCase() === aircraftName.toLowerCase() ? normalize(join(root, abs[2])) : null;
  return normalize(join(fromDir, p));
}

const found = []; // { file (relative to root), chain }
const seen = new Set();
function walk(xmlPath, chain, inside) {
  if (!existsSync(xmlPath) || seen.has(xmlPath + JSON.stringify(chain))) return;
  seen.add(xmlPath + JSON.stringify(chain));
  const text = readFileSync(xmlPath, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
  const dir = dirname(xmlPath);
  const blocks = [...text.matchAll(/<model>([\s\S]*?)<\/model>/g)].map(m => m[1]);
  const own = text.replace(/<model>[\s\S]*?<\/model>/g, '').replace(/<animation>[\s\S]*?<\/animation>/g, '');
  const ownPath = /<path>\s*([^<]+?)\s*<\/path>/.exec(own)?.[1];
  const ownPlace = placement(own);
  const here = ownPlace ? [...chain, ownPlace] : chain;
  if (ownPath && /\.ac$/i.test(ownPath)) {
    const ac = resolvePath(ownPath, dir);
    if (ac && existsSync(ac)) found.push({ file: relative(root, ac).replace(/\\/g, '/'), chain: here, inside });
  }
  for (const b of blocks) {
    const p = /<path>\s*([^<]+?)\s*<\/path>/.exec(b)?.[1];
    if (!p || SKIP.test(p)) continue;
    const target = resolvePath(p, dir);
    if (!target) continue;
    const place = placement(b);
    const next = place ? [...here, place] : here;
    const nowInside = inside || INSIDE.test(p);
    if (/\.xml$/i.test(target)) walk(target, next, nowInside);
    else if (/\.ac$/i.test(target) && existsSync(target)) found.push({ file: relative(root, target).replace(/\\/g, '/'), chain: next, inside: nowInside });
  }
}

const top = topArg ?? (() => {
  const models = readdirSync(join(root, 'Models')).filter(f => /\.xml$/i.test(f));
  const ext = model.asset.files?.[0]?.file ?? model.asset.file;
  const stem = basename(ext, '.ac').toLowerCase();
  return 'Models/' + (models.find(f => basename(f, '.xml').toLowerCase() === stem) ?? models[0]);
})();
walk(normalize(join(root, top)), [], false);

// Keep only what is inside, and not already in the asset.
const have = new Set((model.asset.files ?? [{ file: model.asset.file }]).map(f => f.file));
const add = found.filter(f => f.inside && !have.has(f.file));
const unique = [];
for (const f of add) if (!unique.some(u => u.file === f.file && JSON.stringify(u.chain) === JSON.stringify(f.chain))) unique.push(f);
if (!unique.length) { console.log(`${model.id}: no interior files found below ${top}`); process.exit(0); }

// Copy the files and their textures.
const textures = new Set();
for (const f of unique) {
  const to = join('assets', dest.replace(/^assets\//, ''), f.file);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(root, f.file), to);
  for (const m of readFileSync(join(root, f.file), 'latin1').matchAll(/^texture "([^"]+)"/gm)) textures.add(normalize(join(dirname(f.file), m[1])).replace(/\\/g, '/'));
}
let missing = 0;
for (const t of textures) {
  const from = join(root, t), to = join('assets', dest.replace(/^assets\//, ''), t);
  if (!existsSync(from)) { missing++; continue; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const files = model.asset.files ?? [{ file: model.asset.file }];
delete model.asset.file;
model.asset.files = [...files, ...unique.map(f => ({ file: f.file, ...(f.chain.length ? { chain: f.chain } : {}), fallback: { id: 'cabin', label: 'Cockpit and cabin', system: 'interior' } }))];
writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: added ${unique.length} interior files and ${textures.size - missing} textures${missing ? ` (${missing} textures not in the package)` : ''}`);
for (const f of unique) console.log(`  ${f.file}${f.chain.length ? `  (${f.chain.length} placements)` : ''}`);
