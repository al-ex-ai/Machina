// Drawings are exact projections of the geometry, and parametric models carry the
// generated detail the drawings and the viewer rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadCatalog } from '../src/catalog-node.js';
import { collect, intersections, projectView } from '../src/draw/hlr.js';
import { sheet } from '../src/draw/sheet.js';

const { models } = loadCatalog();
const parametric = models.filter(m => m.builder === 'parametric');

for (const m of parametric) {
  test(`${m.id}: generated detail is present`, () => {
    const ids = new Set();
    let lines = 0;
    buildModel(m).traverse(o => {
      if (o.userData.part) ids.add(o.userData.id);
      lines += o.userData.drawLines?.length ?? 0;
    });
    for (const id of ['antennas', 'beacons', 'left-engine', 'nose-gear']) assert.ok(ids.has(id), `missing part "${id}"`);
    assert.ok(lines > 10, `only ${lines} window and door outlines`);
  });
}

test('the three-view sheet of a parametric model fits A3 and keeps the outline exact', () => {
  const m = parametric[0];
  const meshes = collect(buildModel(m));
  const cuts = intersections(meshes);
  assert.ok(cuts.length > 100, 'wing and tail roots should give intersection lines');
  const views = {};
  for (const name of ['side', 'top', 'front']) views[name] = projectView(meshes, name, { extra: cuts });
  // The side view spans the published length and height.
  const sv = views.side.box;
  assert.ok(Math.abs(sv.x1 - sv.x0 - m.specs.length_m) / m.specs.length_m < 0.02);
  assert.ok(Math.abs(sv.y1 - sv.y0 - m.specs.height_m) / m.specs.height_m < 0.02);
  for (const v of Object.values(views)) assert.ok(v.outline.length > 0 && v.detail.length > 0);
  const svg = sheet(m, views, []);
  assert.match(svg, /viewBox="0 0 420 297"/);
  assert.match(svg, /Scale 1:\d+ \(A3\)/);
});
