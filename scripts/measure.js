// Build models in Node and print their measured size next to the published specs.
// Usage: node --import ./test/register.js scripts/measure.js [model.json ...]
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadCatalog, expectedSize } from '../src/catalog-node.js';

const files = process.argv.slice(2);
const models = files.length ? files.map(f => JSON.parse(readFileSync(f, 'utf8'))) : loadCatalog().models;

const pct = (a, b) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : '');
for (const m of models) {
  const size = new THREE.Box3().setFromObject(buildModel(m)).getSize(new THREE.Vector3());
  const exp = expectedSize(m);
  const parts = [];
  buildModel(m).traverse(o => { if (o.userData.part) parts.push(o.userData.id); });
  console.log(
    `${m.id.padEnd(14)} length ${size.x.toFixed(2)} vs ${exp.length} (${pct(size.x, exp.length)})`
    + ` | width ${size.z.toFixed(2)} vs ${exp.width} (${pct(size.z, exp.width)})`
    + ` | height ${size.y.toFixed(2)} vs ${exp.height} (${pct(size.y, exp.height)})`
    + ` | ${parts.length} parts`,
  );
}
