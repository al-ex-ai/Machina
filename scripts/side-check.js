// Sanity check: parts named left/right must end up on Machina's left (+z) / right (-z).
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadAssetNode } from '../src/assets-node.js';
const m = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const obj = loadAssetNode(m);
obj.traverse(o => {
  if (o.userData.part && /left|right/.test(o.userData.id)) {
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    console.log(o.userData.id.padEnd(18), 'z', c.z.toFixed(2), /left/.test(o.userData.id) === c.z > 0 ? 'ok' : 'MIRRORED');
  }
});
