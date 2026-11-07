// Copy the exterior .ac files of a FlightGear aircraft, the textures they use,
// and the license into assets/<dest>. Keeps paths relative to the aircraft root.
// Usage: node scripts/import-fg.js <aircraftRoot> <dest> <file.ac> [file.ac ...]
import { readFileSync, copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const [src, dest, ...files] = process.argv.slice(2);
if (!src || !dest || !files.length) {
  console.error('Usage: node scripts/import-fg.js <aircraftRoot> <dest> <file.ac> [...]');
  process.exit(1);
}
const out = join('assets', dest);
let total = 0;
const copy = rel => {
  const from = join(src, rel);
  const to = join(out, rel);
  if (!existsSync(from)) { console.warn(`  missing ${rel}`); return; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  total += statSync(from).size;
};
for (const lic of ['LICENSE', 'COPYING', 'copying.txt', 'LICENSE.txt']) {
  if (existsSync(join(src, lic))) { mkdirSync(out, { recursive: true }); copyFileSync(join(src, lic), join(out, 'LICENSE')); break; }
}
const textures = new Set();
for (const f of files) {
  copy(f);
  const text = readFileSync(join(src, f), 'utf8');
  for (const m of text.matchAll(/^texture "([^"]+)"/gm)) textures.add(normalize(join(dirname(f), m[1])).replace(/\\/g, '/'));
}
for (const t of textures) copy(t);
console.log(`${dest}: ${files.length} model files, ${textures.size} textures, ${(total / 1048576).toFixed(1)} MB`);
console.log([...textures].join('\n'));
