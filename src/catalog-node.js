// Catalog access for Node (tests and scripts). The browser loads the same files over fetch.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DATA = fileURLToPath(new URL('../data/', import.meta.url));

export function loadCatalog() {
  const categories = JSON.parse(readFileSync(join(DATA, 'categories.json'), 'utf8'));
  const index = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8'));
  const models = index.models.map(p => ({ ...JSON.parse(readFileSync(join(DATA, p), 'utf8')), _file: p }));
  return { categories, index, models };
}

/**
 * Short content hash of a model file (line endings ignored). The prerendered thumbnail
 * records it, so a test can tell when the model changed after its thumbnail was made.
 */
export function modelHash(file) {
  const text = readFileSync(join(DATA, file), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/**
 * The overall size a model should measure, from its published specs.
 * Width is wingspan for aircraft, rotor diameter for helicopters, width for ground vehicles.
 */
export function expectedSize(m) {
  const s = m.specs;
  return {
    length: s.length_m,
    width: s.wingspan_m ?? s.rotor_diameter_m ?? s.width_m,
    height: s.height_m,
  };
}
