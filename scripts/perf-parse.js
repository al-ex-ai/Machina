import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAC } from '../src/loaders/ac3d.js';
import { assembleParts, hideRules } from '../src/assets.js';
const m = JSON.parse(readFileSync('data/models/aviation/cessna-172s.json', 'utf8'));
const text = readFileSync(join(m.asset.path, m.asset.file), 'utf8');
for (let run = 0; run < 4; run++) {
  let t = performance.now();
  const g = parseAC(text, { hide: hideRules(m) });
  const tp = performance.now() - t; t = performance.now();
  assembleParts(g, m);
  console.log(`run ${run}: parse ${tp.toFixed(0)} ms, assemble ${(performance.now() - t).toFixed(0)} ms`);
}
