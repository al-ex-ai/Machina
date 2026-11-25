// Takeoff checks run without a browser (test/takeoff.test.js, scripts/check-takeoff.js): the model's own
// animations played at the takeoff's start state and with the gear up, measured against the studio pose.
import * as THREE from 'three';
import { fgAnimator } from './fg-anim.js';
import { createTakeoffSim } from './takeoff-sim.js';

const v = new THREE.Vector3();

/** Lowest point of every visible mesh under a part, in root space, with the current local matrices. */
function lowest(root, test) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const out = {};
  root.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    let part = o; while (part && !part.userData.part) part = part.parent;
    if (!part || !test(part.userData)) return;
    const M = inv.clone().multiply(o.matrixWorld), a = o.geometry.attributes.position;
    let y = Infinity;
    for (let i = 0; i < a.count; i++) y = Math.min(y, v.fromBufferAttribute(a, i).applyMatrix4(M).y);
    const id = part.userData.id;
    out[id] = Math.min(out[id] ?? Infinity, y);
  });
  return out;
}

/**
 * @param {THREE.Object3D} root a model from loadAssetNode, in its studio pose
 * @param {any} model catalog entry
 * @returns {null | { jump: number, jumpMesh: string, ground: Record<string, number>, retracted: Record<string, number> | null, belly: number }}
 *   jump: largest distance (m) any animated mesh moves when the takeoff starts; ground: lowest point of each
 *   gear part at the start (0 is the ground the model stands on); retracted: the same with the gear up, and
 *   belly: the airframe's lowest point outside the gear, which retracted gear should not hang below.
 */
export function measureTakeoff(root, model) {
  const anim = fgAnimator(root, model);
  if (!anim) return null;
  root.updateMatrixWorld(true);
  const before = new Map();
  const inv = root.matrixWorld.clone().invert();
  const sample = o => { const a = o.geometry.attributes.position, step = Math.max(1, Math.floor(a.count / 200)), pts = []; const M = inv.clone().multiply(o.matrixWorld); for (let i = 0; i < a.count; i += step) pts.push(v.fromBufferAttribute(a, i).applyMatrix4(M).clone()); return pts; };
  // The airframe must not jump; the cockpit settles to the scene's readings and lever positions (rule 31).
  const outside = anim.meshes.filter(o => { let p = o; while (p && !p.userData.part) p = p.parent; return p?.userData.system !== 'interior'; });
  for (const o of outside) before.set(o, sample(o));
  const isGear = u => u.system === 'gear';
  // The ground the studio stands the model on: the lowest point of anything outside the cabin, not of the
  // gear alone (a wheel filed under the wrong part, like the 737's nose tyres, would otherwise set zero).
  const studioGround = Math.min(...Object.values(lowest(root, u => u.system !== 'interior')));
  // Start state: what the takeoff scene applies before anything moves.
  anim.apply();
  root.updateMatrixWorld(true);
  let jump = 0, jumpMesh = '';
  for (const o of outside) {
    const pts = sample(o), was = before.get(o);
    for (let i = 0; i < pts.length; i++) { const d = pts[i].distanceTo(was[i]); if (d > jump) { jump = d; jumpMesh = o.name; } }
  }
  const ground = Object.fromEntries(Object.entries(lowest(root, isGear)).map(([k, y]) => [k, y - studioGround]));
  // Gear up: every position-norm at 0, oleos extended (unloaded in the air).
  // Only gear the airframe retracts: a cockpit gear indicator reads the same property on a fixed-gear airplane.
  const gearProps = [...new Set(outside.flatMap(o => o.userData.fgAnim.chain.map(t => t.prop)))].filter(p => /position-norm$/.test(p));
  let retracted = null;
  if (gearProps.length) {
    for (const p of gearProps) anim.values[p] = 0;
    for (const p of anim.props) if (/compression-norm$/.test(p)) anim.values[p] = 0;
    anim.apply();
    root.updateMatrixWorld(true);
    retracted = Object.fromEntries(Object.entries(lowest(root, isGear)).map(([k, y]) => [k, y - studioGround]));
  }
  const belly = Math.min(...Object.values(lowest(root, u => u.system !== 'gear' && u.system !== 'interior'))) - studioGround;
  anim.reset();
  return { jump, jumpMesh, ground, retracted, belly };
}

/**
 * Play the takeoff frame by frame (src/takeoff-sim.js, the code the scene runs) and measure how far any
 * visible mesh reaches below the runway at any moment, with the gear moving, oleos unloading and wheels
 * spinning. Runs from the start until the gear is up, or for a landing (kind 'landing') from the approach
 * until the model stops.
 * @returns {null | { depth: number, mesh: string, part: string, t: number, phase: string }} depth: deepest point
 *   below the runway (m, positive = under it)
 */
export function measureTakeoffRun(root, model, { every = 0.1, kind = 'takeoff' } = {}) {
  const sim = createTakeoffSim(root, model, { kind });
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const partOf = o => { let p = o; while (p && !p.userData.part) p = p.parent; return p?.userData.id ?? ''; };
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  let worst = { depth: -Infinity, mesh: '', part: '', t: 0, phase: '' };
  const phase = kind === 'landing' ? s => (s.tD === null ? (s.tF === null ? 'approach' : 'flare') : s.tN === null ? 'touchdown' : 'rollout') : s => (s.tR === null ? 'roll' : s.tL === null ? 'rotation' : 'climb');
  const end = kind === 'landing' ? () => sim.s.done : () => sim.s.tL !== null && sim.s.t > sim.s.tL + 3 + sim.gearTime + 1;
  let next = 0;
  sim.place();
  for (let guard = 0; guard < 200000 && !end(); guard++) {
    sim.step(0.01);
    if (sim.s.t < next) continue;
    next += every;
    sim.place();
    root.updateMatrixWorld(true);
    for (const o of meshes) {
      if (!visible(o)) continue;
      const a = o.geometry.attributes.position, M = o.matrixWorld;
      for (let i = 0; i < a.count; i++) {
        const y = v.fromBufferAttribute(a, i).applyMatrix4(M).y;
        if (-y > worst.depth) worst = { depth: -y, mesh: o.userData.source ?? o.name, part: partOf(o), t: Math.round(sim.s.t * 10) / 10, phase: phase(sim.s) };
      }
    }
  }
  sim.anim?.reset();
  root.matrixAutoUpdate = true; root.matrix.identity(); root.updateMatrixWorld(true);
  return worst;
}

/**
 * Which cockpit and cabin meshes move during a takeoff or landing (yokes, pedals, levers, needles, digit
 * drums): those whose own matrix or texture coordinates change between samples once the scene is going.
 * @returns {{ moved: string[], kinds: Set<string> }} moved: source names of the meshes that moved;
 *   kinds: which crew props drove them (controls, throttle, gauges)
 */
export function cockpitMotion(root, model, { kind = 'takeoff', every = 0.5 } = {}) {
  const sim = createTakeoffSim(root, model, { kind });
  const inside = [];
  // The cabin parts, and cockpit files filed under another part (the 777's pedestal).
  const COCKPIT_FILE = /cockpit|flightdeck|pedestal|panel|instrument|yoke|throttle|pedal|gear-ctl/i;
  root.traverse(o => { if (!o.isMesh) return; let p = o; while (p && !p.userData.part) p = p.parent; if (p?.userData.system === 'interior' || COCKPIT_FILE.test(o.userData.file ?? '')) inside.push(o); });
  const end = kind === 'landing' ? () => sim.s.done : () => sim.s.tL !== null && sim.s.t > sim.s.tL + 25;
  const first = new Map(), moved = new Set(), kinds = new Set();
  const snap = o => [...o.matrix.elements, ...(o.userData.fgTex ? o.geometry.attributes.uv.array.slice(0, 8) : [])];
  let next = 1;
  sim.place();
  for (let guard = 0; guard < 30000 && !end(); guard++) {
    sim.step(0.02);
    if (sim.s.t < next) continue;
    next += every;
    for (const o of inside) {
      const now = snap(o);
      if (!first.has(o)) { first.set(o, now); continue; }
      if (!moved.has(o) && now.some((x, i) => Math.abs(x - first.get(o)[i]) > 1e-4)) {
        moved.add(o);
        for (const t of [...(o.userData.fgAnim?.chain ?? []), ...(o.userData.fgTex ?? [])]) {
          if (/^controls\/flight\/|^controls\/cockpit\/(rudder-pedal|flaps-lever)|^fcs\//.test(t.prop)) kinds.add('controls');
          else if (/^controls\/engines\//.test(t.prop)) kinds.add('throttle');
          else if (/^(instrumentation|engines|orientation|velocities|position|surface-positions)\//.test(t.prop)) kinds.add('gauges');
        }
      }
    }
  }
  sim.anim?.reset();
  root.matrixAutoUpdate = true; root.matrix.identity(); root.updateMatrixWorld(true);
  return { moved: [...moved].map(o => o.userData.source ?? o.name), kinds };
}
