// Time the CPU work the viewer does per mouse move (hover raycast) on a model.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAC } from '../src/loaders/ac3d.js';
import { assembleParts, hideRules } from '../src/assets.js';
import { finalize } from '../src/registry.js';
import '../src/builders/index.js';

const m = JSON.parse(readFileSync('data/models/aviation/cessna-172s.json', 'utf8'));
let t = performance.now();
const text = readFileSync(join(m.asset.path, m.asset.file), 'utf8');
const obj = finalize(assembleParts(parseAC(text, { hide: hideRules(m) }), m), m);
console.log(`parse + assemble: ${(performance.now() - t).toFixed(0)} ms`);
obj.updateMatrixWorld(true);
let meshes = 0, tris = 0, mats = new Set();
obj.traverse(o => { if (o.isMesh) { meshes++; tris += o.geometry.attributes.position.count / 3; [o.material].flat().forEach(x => mats.add(x)); } });
console.log(`meshes ${meshes}, triangles ${Math.round(tris)}, materials ${mats.size}`);
const cam = new THREE.PerspectiveCamera(40, 1.6, 0.1, 1000);
cam.position.set(-8, 5, 9); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
const rc = new THREE.Raycaster();
t = performance.now();
const N = 200;
for (let i = 0; i < N; i++) { rc.setFromCamera(new THREE.Vector2(Math.random() * 2 - 1, Math.random() * 2 - 1), cam); rc.intersectObject(obj, true); }
console.log(`hover raycast: ${((performance.now() - t) / N).toFixed(2)} ms per mouse move`);
