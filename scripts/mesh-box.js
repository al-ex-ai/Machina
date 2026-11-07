// Print the bounding box of named meshes in a model's asset: node ... mesh-box.js <model.json> <name> [...]
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadAssetNode } from '../src/assets-node.js';
const [file, ...names] = process.argv.slice(2);
const obj = loadAssetNode(JSON.parse(readFileSync(file, 'utf8')));
obj.updateMatrixWorld(true);
obj.traverse(o => {
  if (o.isMesh && names.includes(o.name)) {
    const b = new THREE.Box3().setFromObject(o);
    console.log(o.name, 'x', b.min.x.toFixed(2), b.max.x.toFixed(2), 'y', b.min.y.toFixed(2), b.max.y.toFixed(2), 'z', b.min.z.toFixed(2), b.max.z.toFixed(2));
  }
});
