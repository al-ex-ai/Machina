// The picture-to-model path, checked without any labelled picture: a mesh is reduced to
// its three silhouettes, a model is fitted to them with no hints, and the model must
// land back on the mesh. Two aircraft keep the run short and cover the hard parts: a
// low wing with underwing engines and winglets, and rear engines under a T-tail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadAssetNode } from '../src/assets-node.js';
import { targetOf, score, compareMasks, Mask } from '../src/fit/views.js';
import { fitViews } from '../src/fit/fit.js';

const FLOOR = {
  a320neo: { side: 0.97, top: 0.97, front: 0.8, mean: 0.08 },
  tu134: { side: 0.95, top: 0.96, front: 0.74, mean: 0.1 },
};

for (const [id, floor] of Object.entries(FLOOR)) {
  test(`${id}: a model fitted to the mesh's silhouettes lands back on the mesh`, () => {
    const src = JSON.parse(readFileSync(`data/models/aviation/${id}.json`, 'utf8'));
    const target = targetOf(loadAssetNode(src));
    const model = fitViews(target, { id: `${id}-fitted`, name: src.name, specs: src.specs });
    const sc = score(target, buildModel(model));
    for (const view of ['side', 'top', 'front']) {
      assert.ok(sc[view].iou >= floor[view], `${view} overlap ${sc[view].iou}, needs ${floor[view]}`);
      assert.ok(sc[view].mean <= floor.mean, `${view} outline is ${sc[view].mean} m off on average, allowed ${floor.mean}`);
    }
    const g = model.geometry;
    assert.ok(g.gear.nose && g.gear.mains.length, 'nose and main gear found');
    assert.equal(g.engines.length, 1, 'one engine pair found');
  });
}

test('outline distance: a shape moved by 4 pixels is 4 pixels off', () => {
  const a = new Mask(60, 40, 10, 0, 0), b = new Mask(60, 40, 10, 0, 0);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 40; x++) { a.data[y * 60 + x] = 1; b.data[y * 60 + x + 4] = 1; }
  const r = compareMasks(a, b);
  assert.equal(r.max, 0.4);
  assert.ok(r.iou > 0.75 && r.iou < 0.8);
});
