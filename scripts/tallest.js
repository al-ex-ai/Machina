// List the objects that reach highest / lowest / furthest, to find stray or hidden-variant meshes.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { loadAssetNode } from '../src/assets-node.js';
const m = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const obj = loadAssetNode(m);
obj.updateMatrixWorld(true);
const rows = [];
obj.traverse(o => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); rows.push([o.name, o.parent.userData.id, b]); } });
const show = (label, key, n = 6) => console.log(label, rows.sort(key).slice(0, n).map(([nm, p, b]) => `${nm}[${p}] y${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)} x${b.min.x.toFixed(1)}..${b.max.x.toFixed(1)}`).join(' | '));
show('TOP:', (a, b) => b[2].max.y - a[2].max.y);
show('BOTTOM:', (a, b) => a[2].min.y - b[2].min.y, 3);
