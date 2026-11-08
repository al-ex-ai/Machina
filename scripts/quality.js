// Report every detailed model against the quality standard (src/quality.js).
// Usage: npm run quality [model.json ...]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadAssetNode } from '../src/assets-node.js';
import { measureQuality } from '../src/quality.js';

const dir = 'data/models/aviation';
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter(f => f.endsWith('.json')).map(f => join(dir, f));
const listed = new Set(JSON.parse(readFileSync('data/index.json', 'utf8')).models.map(p => p.split('/').pop()));
const pct = v => `${Math.round(v * 100)}%`.padStart(5);

console.log(`${'model'.padEnd(16)} ${'listed'.padEnd(6)} ${'tris'.padStart(7)} parts  tex  plain  gear  inside  result`);
for (const f of files) {
  const model = JSON.parse(readFileSync(f, 'utf8'));
  if (!model.asset) continue;
  const { metrics: m, fails } = measureQuality(loadAssetNode(model), model);
  const name = f.split(/[\\/]/).pop();
  console.log(`${model.id.padEnd(16)} ${(listed.has(name) ? 'yes' : '-').padEnd(6)} ${String(m.triangles).padStart(7)} ${String(m.parts).padStart(5)} ${pct(m.textured)} ${pct(m.plain)} ${pct(m.plainGear)} ${String(m.interiorTriangles).padStart(7)}  ${fails.length ? 'FAIL: ' + fails.join('; ') : 'pass'}`);
}
