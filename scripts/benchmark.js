// Score every converted model against the mesh it was measured from: silhouette
// overlap in the side, top and front views. The source mesh is the answer key, so
// this is the accuracy of the conversion, and later of fitting from pictures.
// Usage: npm run benchmark [model-id ...]
import { readFileSync, readdirSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadAssetNode } from '../src/assets-node.js';
import { compareSilhouettes } from '../src/fit/silhouette.js';

const only = new Set(process.argv.slice(2));
const dir = 'data/models/aviation';
const rows = [];
for (const f of readdirSync(dir)) {
  const m = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  // The answer key: the mesh a model was converted from, or for a model measured from a
  // drawing, an independent detailed mesh of the same aircraft.
  const key = m.derived?.from ?? m.reference?.answerKey;
  if (!key || (only.size && !only.has(m.id))) continue;
  const src = JSON.parse(readFileSync(key, 'utf8'));
  const s = compareSilhouettes(buildModel(m), loadAssetNode(src));
  rows.push({ id: m.id, ...s, mean: Math.round(((s.side + s.top + s.front) / 3) * 1000) / 1000 });
  console.log(`${(m.id + (m.derived ? '' : ' (drawing)')).padEnd(26)} side ${s.side.toFixed(3)}  top ${s.top.toFixed(3)}  front ${s.front.toFixed(3)}`);
}
if (rows.length > 1) console.log(`${'mean'.padEnd(26)} ${(rows.reduce((a, r) => a + r.mean, 0) / rows.length).toFixed(3)}`);
