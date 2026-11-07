// Every model must be well formed, buildable, and match its published size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/builders/index.js';
import { buildModel, hasBuilder } from '../src/registry.js';
import { loadCatalog, expectedSize } from '../src/catalog-node.js';

const TOLERANCE = 0.02; // 2 percent
const { categories, models } = loadCatalog();
const categoryIds = new Set(categories.map(c => c.id));

test('model ids are unique', () => {
  const ids = models.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

for (const m of models) {
  test(`${m.id}: required fields`, () => {
    for (const k of ['id', 'name', 'category', 'group', 'builder', 'summary', 'specs', 'geometry', 'sources']) {
      assert.ok(m[k] !== undefined, `missing "${k}"`);
    }
    assert.ok(categoryIds.has(m.category), `unknown category "${m.category}"`);
    assert.ok(hasBuilder(m.builder), `no builder "${m.builder}"`);
    assert.ok(m.sources.length > 0, 'needs at least one source');
    assert.ok(m._file.includes(`/${m.category}/`), 'file should live in its category folder');
  });

  test(`${m.id}: parts are named and unique`, () => {
    const ids = [];
    buildModel(m).traverse(o => { if (o.userData.part) ids.push(o.userData.id); });
    assert.ok(ids.length >= 5, `only ${ids.length} parts`);
    assert.equal(new Set(ids).size, ids.length, `duplicate part ids: ${ids}`);
  });

  test(`${m.id}: built size matches published specs within ${TOLERANCE * 100}%`, () => {
    const size = new THREE.Box3().setFromObject(buildModel(m)).getSize(new THREE.Vector3());
    const exp = expectedSize(m);
    for (const [axis, got, want] of [['length', size.x, exp.length], ['width', size.z, exp.width], ['height', size.y, exp.height]]) {
      const err = Math.abs(got - want) / want;
      assert.ok(err <= TOLERANCE, `${axis} ${got.toFixed(2)} m vs published ${want} m (${(err * 100).toFixed(1)}% off)`);
    }
  });
}
