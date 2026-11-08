// List the meshes of a model with their part, size and whether they are transparent.
// Usage: node --import ./scripts/node/register.js scripts/mesh-list.js <model.json> [name regex]
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadAssetNode } from '../src/assets-node.js';

const model = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const re = new RegExp(process.argv[3] ?? '.', 'i');
loadAssetNode(model).traverse(o => {
  if (!o.isMesh) return;
  let part = o; while (part && !part.userData.part) part = part.parent;
  const id = part?.userData.id ?? '';
  if (!re.test(o.name) && !re.test(id)) return;
  const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  const m = [o.material].flat()[0];
  console.log(`${o.name.padEnd(34)} ${id.padEnd(18)} ${s.toArray().map(v => v.toFixed(2)).join(' x ').padEnd(20)} ${m.transparent ? 'transparent' : ''} ${m.map ? 'tex' : ''}`);
});
