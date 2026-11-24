// Print the takeoff measurements of every listed model with animations (see src/takeoff-check.js).
// Usage: npm run takeoff-check [-- id ...]
import { loadCatalog } from '../src/catalog-node.js';
import { loadAssetNode } from '../src/assets-node.js';
import { measureTakeoff } from '../src/takeoff-check.js';

const only = process.argv.slice(2);
const { models } = loadCatalog();
const f = x => (x === Infinity ? '-' : x.toFixed(2));
for (const m of models.filter(m => m.asset && m.takeoff && (!only.length || only.includes(m.id)))) {
  const r = measureTakeoff(loadAssetNode(m), m);
  if (!r) { console.log(`${m.id.padEnd(14)} no animations`); continue; }
  const ground = Object.entries(r.ground).map(([k, y]) => `${k} ${f(y)}`).join(', ');
  const up = r.retracted ? Object.entries(r.retracted).map(([k, y]) => `${k} ${f(y)}`).join(', ') : 'fixed gear';
  console.log(`${m.id.padEnd(14)} jump ${f(r.jump)} m (${r.jumpMesh}) | start: ${ground} | belly ${f(r.belly)} | up: ${up}`);
}
