// Every listed model needs a prerendered thumbnail that is newer than its model file, so the
// catalog never falls back to downloading whole models. Fix a failure with: npm run thumbs -- <id>
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/builders/index.js';
import { partCount } from '../src/registry.js';
import { loadCatalog, modelHash } from '../src/catalog-node.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestFile = `${root}data/thumbs.json`;
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
const { models } = loadCatalog();

for (const m of models) {
  test(`${m.id}: prerendered thumbnail is current`, () => {
    const entry = manifest[m.id];
    assert.ok(entry, 'no thumbnail, run: npm run thumbs -- ' + m.id);
    const img = `${root}assets/thumbs/${m.id}.webp`;
    assert.ok(existsSync(img) && statSync(img).size > 2000, `missing or empty ${img}`);
    assert.equal(entry.hash, modelHash(m._file), 'model changed since its thumbnail, run: npm run thumbs -- ' + m.id);
    assert.equal(entry.parts, partCount(m), 'part count changed, run: npm run thumbs -- ' + m.id);
  });
}

test('no thumbnails for models that are not listed', () => {
  const listed = new Set(models.map(m => m.id));
  assert.deepEqual(Object.keys(manifest).filter(id => !listed.has(id)), []);
});
