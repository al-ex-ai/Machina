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
    for (const id of ['antennas', 'beacons', 'nose-gear']) assert.ok(ids.has(id), `missing part "${id}"`);
    assert.ok([...ids].some(id => /^left-.*engine$/.test(id)), 'missing a left engine');
    assert.ok(lines > 10, `only ${lines} window and door outlines`);
  });
}

import { attachPod } from '../src/builders/parametric.js';
import { bodyProfile } from '../src/parametric/body.js';

for (const m of parametric) {
  test(`${m.id}: pods on the centerline sit on the fuselage, with no gap behind the lip`, () => {
    const g = m.geometry;
    const body = bodyProfile(g.fuselage.stations, g.fuselage);
    for (const pd of g.pods ?? []) {
      if (pd.mirror || Math.abs(pd.position.z ?? 0) > 0.01) continue;
      const Y = pd.position.y ?? 0;
      attachPod(pd, body, g.surfaces).slice(1).forEach(([x, , , bot]) => {
        const gap = Y + bot - body.at(pd.position.x + x).top;
        assert.ok(gap <= 0.02 || gap >= 1, `${pd.id} floats ${gap.toFixed(2)} m above the fuselage at x ${(pd.position.x + x).toFixed(1)}`);
      });
    }
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

import * as THREE from 'three';
import { liveriesFor, withLivery } from '../src/parametric/liveries.js';

for (const m of parametric) {
  test(`${m.id}: every livery builds and leaves the size alone`, () => {
    const size = o => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    const base = size(buildModel(m));
    const list = liveriesFor(m);
    assert.ok(list.length >= 4, 'expected the Machina livery plus at least three presets');
    for (const l of list) {
      const s = size(buildModel(withLivery(m, l.id)));
      assert.ok(s.distanceTo(base) < 1e-6, `${l.id} changed the size`);
    }
    assert.notEqual(withLivery(m, 'primer'), m, 'a preset returns a copy');
    assert.equal(m.livery.base, structuredClone(m).livery.base);
  });
}

test('detailed assets offer no livery presets', () => {
  for (const m of models.filter(x => x.builder === 'asset')) assert.equal(liveriesFor(m).length, 0);
});
