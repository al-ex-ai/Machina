// Node-side asset loading for tests and scripts (geometry only, no textures).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAC } from './loaders/ac3d.js';
import { assembleParts, hideRules, assetFiles } from './assets.js';
import { finalize } from './registry.js';

export function loadAssetNode(model) {
  const a = model.asset;
  const loaded = assetFiles(model).map(f => ({
    group: parseAC(readFileSync(join(a.path, f.file), 'utf8'), { hide: hideRules(model) }),
    fallback: f.fallback,
  }));
  return finalize(assembleParts(loaded, model), model);
}
