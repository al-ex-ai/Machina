// Catalog access for Node (tests and scripts). The browser loads the same files over fetch.
import { readFileSync } from 'node:fs';
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
