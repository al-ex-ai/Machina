// Validation gate for listed models: checks that go beyond size and texture quality.
//   gear     nose (or tail) wheel and both main legs reach the ground, left and right match
//   cabin    a model with glazing has something inside (an interior part)
//   mapping  most of the model is in named parts, not the catch-all fuselage/airframe part
// Usage: npm run validate [model-id ...]   (exits 1 if any listed model fails)
import * as THREE from 'three';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadCatalog } from '../src/catalog-node.js';
import { loadAssetNode } from '../src/assets-node.js';

const only = new Set(process.argv.slice(2));
const { models } = loadCatalog();
let failed = 0;

function lowest(obj) {
  let lo = Infinity;
  const v = new THREE.Vector3();
  obj.traverse(o => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (v.y < lo) lo = v.y; }
  });
  return lo;
}
const tris = obj => { let n = 0; obj.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return n; };

for (const m of models) {
  if (only.size && !only.has(m.id)) continue;
  const obj = m.asset ? loadAssetNode(m) : buildModel(m);
  obj.updateMatrixWorld(true);
  const parts = [];
  obj.traverse(o => { if (o.userData.part) parts.push(o); });
  const fails = [], notes = [];
  // Gear: the wheel-carrying legs, not doors or fairings.
  const legs = parts.filter(p => p.userData.system === 'gear' && /nose|main|tail-wheel|landing-gear|wing-gear|body-gear|skid/.test(p.userData.id) && !/door|fairing/.test(p.userData.id));
  const heli = !!m.specs.rotor_diameter_m;
  // A tail wheel only has to reach the ground when there is no nose gear (taildraggers); on others it is a bumper.
  const hasNose = legs.some(p => /nose/.test(p.userData.id));
  const noseOrTail = legs.filter(p => /nose/.test(p.userData.id) || (!hasNose && /tail-wheel/.test(p.userData.id)));
  const mains = legs.filter(p => /main|wing-gear|body-gear|landing-gear|skid/.test(p.userData.id));
  const single = legs.some(p => /landing-gear/.test(p.userData.id)); // one part holding all legs
  if (!heli && !single && !noseOrTail.length && !m.id.includes('wright')) fails.push('no nose or tail wheel part');
  if (!mains.length && !m.id.includes('wright')) fails.push('no main gear part');
  // Helicopter skids are often merged into the fuselage mesh; the skid part is only the cross-tubes.
  for (const p of heli ? [] : [...noseOrTail, ...mains]) {
    const lo = lowest(p);
    if (lo > 0.25) fails.push(`${p.userData.id} does not reach the ground (lowest point ${lo.toFixed(2)} m up)`);
  }
  const lr = ['main-gear', 'wing-gear', 'body-gear'].map(k => [parts.find(p => p.userData.id === `left-${k}`), parts.find(p => p.userData.id === `right-${k}`)]).filter(([a, b]) => a && b);
  for (const [a, b] of lr) {
    const d = Math.abs(lowest(a) - lowest(b));
    if (d > 0.15) fails.push(`${a.userData.id} and ${b.userData.id} differ by ${d.toFixed(2)} m in height`);
  }
  // Cabin: glazing should have something behind it.
  const glazed = parts.some(p => p.userData.system === 'glazing') || m.geometry?.glazing;
  const inside = parts.some(p => p.userData.system === 'interior');
  if (glazed && !inside && m.builder !== 'parametric') fails.push('has windows but nothing inside');
  if (m.builder === 'parametric' && !inside) notes.push('no interior');
  // Mapping: share of triangles left in the catch-all part.
  const total = tris(obj), catchAll = parts.filter(p => /^(fuselage|airframe)$/.test(p.userData.id)).reduce((a, p) => a + tris(p), 0);
  const share = catchAll / total;
  if (m.asset && share > 0.85) fails.push(`${Math.round(share * 100)}% of the model is unmapped (catch-all part)`);
  const ok = !fails.length;
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${m.id.padEnd(22)} ${fails.join('; ')}${notes.length ? `  (${notes.join(', ')})` : ''}`);
}
console.log(failed ? `${failed} listed model(s) fail validation` : 'all listed models pass');
process.exit(failed ? 1 : 0);
