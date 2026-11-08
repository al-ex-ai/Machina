// Compare a built model with its reference drawing. Projects the model onto the
// side, top and front views at the drawing's calibrated scale, reports how well the
// silhouettes overlap (intersection over union), and writes an overlay image:
// gray = both agree, red = only in the drawing, blue = only in the model.
// Usage: node --import ./scripts/node/register.js scripts/reference/compare.js references/b737-300
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import '../../src/builders/index.js';
import { buildModel } from '../../src/registry.js';
import { readPNG, writePNG } from './png.js';
import { viewOf } from './trace.js';

const dir = process.argv[2];
const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'));
const img = readPNG(readFileSync(join(dir, ref.image)));
const model = JSON.parse(readFileSync(ref.model, 'utf8'));
const obj = buildModel(model);
obj.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(obj);
const P = ref.published;

// World points in drawing axes: x from the nose aft, y up from the ground, z left.
const tris = [];
const v = new THREE.Vector3();
obj.traverse(o => {
  if (!o.isMesh || !o.visible) return;
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const pt = i => { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); return [v.x - box.min.x, v.y - box.min.y, v.z]; };
  for (let i = 0; i + 2 < n; i += 3) tris.push([pt(i), pt(i + 1), pt(i + 2)]);
});

function raster(w, h, project) {
  const mask = new Uint8Array(w * h);
  for (const t of tris) {
    const p = t.map(project);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1]);
    if (Math.abs(d) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const a = ((p[1][1] - p[2][1]) * (x + 0.5 - p[2][0]) + (p[2][0] - p[1][0]) * (y + 0.5 - p[2][1])) / d;
      const b = ((p[2][1] - p[0][1]) * (x + 0.5 - p[2][0]) + (p[0][0] - p[2][0]) * (y + 0.5 - p[2][1])) / d;
      if (a >= -0.01 && b >= -0.01 && a + b <= 1.02) mask[y * w + x] = 1;
    }
  }
  return mask;
}

const out = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
for (let i = 0; i < out.data.length; i += 4) { out.data[i] = out.data[i + 1] = out.data[i + 2] = 255; out.data[i + 3] = 255; }
const report = {};

function compareView(name, vw, project) {
  const view = viewOf(img, vw.box);
  const mask = raster(view.w, view.h, project(view));
  let both = 0, drawOnly = 0, modelOnly = 0;
  for (let y = 0; y < view.h; y++) for (let x = 0; x < view.w; x++) {
    const a = view.solid(x, y), b = mask[y * view.w + x] === 1;
    const i = ((vw.box[1] + y) * img.width + vw.box[0] + x) * 4;
    const c = a && b ? [150, 156, 166] : a ? [226, 60, 60] : b ? [50, 110, 230] : [255, 255, 255];
    if (a && b) both++; else if (a) drawOnly++; else if (b) modelOnly++;
    out.data.set([...c, 255], i);
  }
  report[name] = { iou: Math.round((both / (both + drawOnly + modelOnly)) * 1000) / 1000, onlyDrawing: drawOnly, onlyModel: modelOnly };
}

const sv = ref.views.side;
compareView('side', sv, view => {
  const B = view.bounds(), s = P.length / (B.maxX - B.minX + 1), gy = sv.ground - sv.box[1];
  return ([x, y]) => [B.minX + x / s, gy + 1 - y / s];
});
const tv = ref.views.top;
compareView('top', tv, view => {
  const B = view.bounds(), s = P.length / (B.maxX - B.minX + 1);
  const sz = P.span / (B.maxY - B.minY + 1), cy = (B.minY + B.maxY + 1) / 2;
  return ([x, , z]) => [B.minX + x / s, cy - z / sz];
});
const fv = ref.views.front;
compareView('front', fv, view => {
  const B = view.bounds(), s = P.span / (B.maxX - B.minX + 1), cx = (B.minX + B.maxX + 1) / 2, gy = fv.box[3] - fv.box[1];
  return ([, y, z]) => [cx - z / s, gy + 1 - y / s];
});

writeFileSync(join(dir, 'compare.png'), writePNG(out));
console.log(JSON.stringify(report));
