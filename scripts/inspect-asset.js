// Parse a model's detailed asset in Node and report its size, parts and unmatched objects.
// Usage: npm run inspect -- data/models/aviation/cessna-172s.json
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadAssetNode } from '../src/assets-node.js';

const model = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const obj = loadAssetNode(model);
const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
console.log(`size L ${size.x.toFixed(2)} (spec ${model.specs.length_m}) W ${size.z.toFixed(2)} (spec ${model.specs.wingspan_m ?? model.specs.width_m}) H ${size.y.toFixed(2)} (spec ${model.specs.height_m})`);
obj.traverse(o => {
  if (!o.userData.part) return;
  const names = o.children.map(c => c.name);
  let tris = 0; o.traverse(m => { if (m.isMesh) tris += m.geometry.attributes.position.count / 3; });
  console.log(`  ${o.userData.id.padEnd(20)} ${String(names.length).padStart(3)} objects ${String(Math.round(tris)).padStart(6)} tris  ${o.userData.id === 'airframe' ? names.join(', ') : ''}`);
});
