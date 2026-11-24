import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXray } from '../src/xray-build.js';

// Unit cube: 8 corners, 12 triangles; only its 12 sharp edges survive, the face diagonals do not.
const P = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
const I = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
const id = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

test('x-ray build keeps a cube\'s 12 creases and drops its face diagonals', () => {
  const r = buildXray([{ pos: new Float32Array(P), index: new Uint32Array(I), matrix: id }], 35);
  assert.equal(r.edges.length / 6, 12);
  assert.equal(r.index.length, 36);
});

test('x-ray build merges meshes in the part\'s space', () => {
  const moved = [1,0,0,0, 0,1,0,0, 0,0,1,0, 10,0,0,1];
  const m = () => ({ pos: new Float32Array(P), index: new Uint32Array(I), matrix: id });
  const r = buildXray([m(), { ...m(), matrix: moved }], 35);
  assert.equal(r.pos.length, 48);
  assert.equal(r.index[36], 8); // second mesh indexes past the first
  assert.equal(r.pos[24], 10); // and sits where its matrix puts it
  assert.equal(r.edges.length / 6, 24);
});

// MODEL_STANDARD.md rule 18: the x-ray shows people's seats inside every listed model: the package's own
// seat meshes, or the shared FlightGear seats (assets/aircraft/cabin, assets/aircraft/crew) laid out in it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog-node.js';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SEAT = /name "[^"]*(seat|siege|chair|sitz)[^"]*"/i;
for (const m of loadCatalog().models.filter(m => m.asset && m.listed !== false && ['aviation', 'helicopters'].includes(m.category))) {
  test(`${m.id}: seats inside`, () => {
    if (m.asset.noCrew) return; // states why the model carries nobody (the Wright Flyer's prone pilot)
    const files = [...new Set((m.asset.files ?? [{ file: m.asset.file }]).map(f => f.file))];
    const has = files.some(f => /(^|\/)(cabin_seat|seat_light)\.ac$/.test(f) || SEAT.test(readFileSync(`${ROOT}${m.asset.path}/${f}`, 'latin1')));
    assert.ok(has, 'no seat in any of its files');
  });
}
