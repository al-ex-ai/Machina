// Every listed fixed-wing asset model has a takeoff scene, with figures the scripted profile can fly
// and animations that only name objects present in the asset file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog-node.js';
import { loadAssetNode } from '../src/assets-node.js';
import { measureTakeoff, measureTakeoffRun } from '../src/takeoff-check.js';
import { captainEye } from '../src/takeoff-sim.js';
import * as THREE from 'three';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const { models } = loadCatalog();
const listed = models.filter(m => m.asset && m.category === 'aviation' && m.listed !== false);
// MODEL_STANDARD.md rules 23 to 25. Gear parts that are not wheels (doors, wells, struts, bumpers) are
// held only to the retraction rule when they carry wheels.
const JUMP = 0.03, BELOW = -0.03, ABOVE = 0.05, UNDER_BELLY = 0.1;
const isWheel = id => !/door|well|structure|bumper/.test(id);

for (const m of listed) {
  test(`${m.id}: takeoff figures`, () => {
    const t = m.takeoff;
    assert.ok(t, 'no takeoff block');
    assert.ok(t.vr_kt > 15 && t.vr_kt < 260, `rotation speed ${t.vr_kt} kt`);
    assert.ok(t.roll_m > 20 && t.roll_m < 3000, `ground roll ${t.roll_m} m (runway is 3000 m)`);
    if (t.lof_kt) assert.ok(t.lof_kt >= t.vr_kt, 'liftoff before rotation');
    if (t.tailwheel) assert.ok(t.tail_deg > 0 && t.pitch_deg < 0, 'a tailwheel airplane lowers its nose from the ground attitude');
    for (const k of ['flaps']) if (t[k] !== undefined) assert.ok(t[k] >= 0 && t[k] <= 1, `${k} ${t[k]}`);
  });
  test(`${m.id}: takeoff starts still, on its wheels, and the gear closes`, () => {
    const t = m.takeoff ?? {}, r = measureTakeoff(loadAssetNode(m), m);
    if (!r) return; // no animations: nothing moves, the studio pose is the start
    assert.ok(r.jump <= JUMP, `${r.jumpMesh} jumps ${r.jump.toFixed(2)} m when the takeoff starts`);
    for (const [id, y] of Object.entries(r.ground)) {
      assert.ok(y >= BELOW, `${id} is ${(-y).toFixed(2)} m below the ground at the start`);
      if (isWheel(id) && !(t.offGround ?? []).includes(id)) assert.ok(y <= ABOVE, `${id} floats ${y.toFixed(2)} m above the ground at the start`);
    }
    for (const [id, y] of Object.entries(r.retracted ?? {})) {
      if (!isWheel(id) || (t.exposed ?? []).includes(id)) continue;
      assert.ok(y >= r.belly - UNDER_BELLY, `${id} hangs ${(r.belly - y).toFixed(2)} m below the belly with the gear up`);
    }
  });
  test(`${m.id}: nothing goes through the runway at any moment of the takeoff`, () => {
    const r = measureTakeoffRun(loadAssetNode(m), m);
    assert.ok(r.depth <= 0.02, `${r.part} ${r.mesh} is ${r.depth.toFixed(2)} m under the runway during the ${r.phase} (t ${r.t} s)`);
  });
  test(`${m.id}: the cockpit view looks out`, () => {
    // Rays from the captain's eye across the middle of the view: nothing solid closer than 43 cm (glass is
    // see-through from inside; head-up displays and visors that block it are hidden by takeoff.cockpit).
    const root = loadAssetNode(m), { eye, hide } = captainEye(root, m.takeoff?.cockpit), hid = new Set(hide), meshes = [];
    root.traverse(o => { if (!o.isMesh || hid.has(o)) return; for (let p = o; p; p = p.parent) if (!p.visible) return; let p = o; while (p && !p.userData.part) p = p.parent; if (p?.userData.system === 'glazing' || [o.material].flat().some(x => x.transparent && x.opacity < 1)) return; o.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); meshes.push(o); });
    const rc = new THREE.Raycaster(); rc.far = 0.43;
    for (const yaw of [-10, 0, 10]) for (const pitch of [-3, 3]) {
      rc.set(eye, new THREE.Vector3(-1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(pitch - 7)).applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yaw)));
      const h = rc.intersectObjects(meshes, false)[0];
      assert.ok(!h, `${h?.object.userData.source ?? h?.object.name} is ${h?.distance.toFixed(2)} m in front of the captain's eyes`);
    }
  });
  test(`${m.id}: pilots aboard`, () => {
    const files = (m.asset.files ?? [{ file: m.asset.file }]).map(f => f.file);
    const crew = files.filter(f => /(^|\/)(pilots?|copilot|general_(co)?pilot|liner_pilot|pilotWWII|fighter_default)\.ac$/i.test(f));
    assert.ok(crew.length || m.asset.noCrew, 'no pilot figure and no asset.noCrew reason');
  });
  const animated = (m.asset.files ?? []).filter(f => f.anim?.length);
  if (!animated.length) continue;
  test(`${m.id}: takeoff animations name objects in their files`, () => {
    for (const f of animated) {
      const ac = readFileSync(`${ROOT}${m.asset.path}/${f.file}`, 'latin1');
      const names = new Set([...ac.matchAll(/^name "?([^"\r\n]*)"?/gm)].map(x => x[1]));
      // Names can be FlightGear groups (file.groups), which hold objects or further groups.
      const expand = n => f.groups?.[n] ? f.groups[n].flatMap(expand) : [n];
      const hits = f.anim.filter(a => a.objects.flatMap(expand).some(o => names.has(o))).length;
      assert.ok(hits > 0, `${f.file}: none of ${f.anim.length} animations match an object`);
    }
  });
}
