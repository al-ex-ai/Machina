// Score a model built from a drawing against a real mesh of the same type: outline overlap
// per view, both standing as their sources have them. Gear can be left out of both when the
// mesh's gear is not usable (retracted or posed wrong).
// Usage: npm run compare-mesh -- <drawn model id> <mesh model id> [--no-gear] [--out dir]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadAssetNode } from '../src/assets-node.js';
import { targetOf, score, trianglesOf, raster, fill, overlay, Mask } from '../src/fit/views.js';
import { writePNG } from './reference/png.js';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : null;
const [drawnId, meshId] = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
const noGear = args.includes('--no-gear');
const load = id => JSON.parse(readFileSync(`data/models/aviation/${id}.json`, 'utf8'));

const hideGear = obj => {
  if (!noGear) return obj;
  obj.traverse(o => { let p = o; while (p && !p.userData.part) p = p.parent; if (p?.userData.system === 'gear') o.visible = false; });
  return obj;
};
const real = hideGear(loadAssetNode(load(meshId)));
const built = hideGear(buildModel(load(drawnId)));
const key = targetOf(real);
const mine = targetOf(built, { ppm: key.ppm, frame: key });
const sc = score(key, built);
console.log(`${drawnId} against ${meshId}${noGear ? ' (gear left out of both)' : ''}`);
{ const b = targetOf(built); console.log(`  size: mesh ${key.L.toFixed(2)} x ${(2 * key.S).toFixed(2)} x ${key.H.toFixed(2)} m, model ${b.L.toFixed(2)} x ${(2 * b.S).toFixed(2)} x ${b.H.toFixed(2)} m`); }
for (const v of ['side', 'top', 'front']) console.log(`  ${v.padEnd(6)} overlap ${sc[v].iou.toFixed(3)}   outline mean ${(sc[v].mean * 100).toFixed(0)} cm, 95% ${(sc[v].p95 * 100).toFixed(0)} cm`);
if (out) {
  mkdirSync(out, { recursive: true });
  const tris = trianglesOf(built);
  for (const v of ['side', 'top', 'front']) { const t = key[v]; writeFileSync(join(out, `${drawnId}-vs-${meshId}-${v}.png`), writePNG(overlay(t, fill(raster(tris, v, new Mask(t.w, t.h, t.ppm, t.u0, t.v0)))))); }
}

// With the stance set aside (gear left out, sources posed differently), the shape alone: the
// model is moved up or down to where its side and front views best overlap the mesh's.
import { compareMasks } from '../src/fit/views.js';
{
  const tris = trianglesOf(built);
  const at = dy => { const t = Float64Array.from(tris); for (let i = 1; i < t.length; i += 3) t[i] += dy; const r = {}; for (const v of ['side', 'front']) { const k = key[v]; r[v] = compareMasks(k, fill(raster(t, v, new Mask(k.w, k.h, k.ppm, k.u0, k.v0)))); } return r; };
  let best = { dy: 0, s: at(0) };
  for (let dy = -2; dy <= 2.001; dy += 0.05) { const s = at(dy); if (s.side.iou + s.front.iou > best.s.side.iou + best.s.front.iou) best = { dy, s }; }
  console.log(`  lined up (model moved ${best.dy >= 0 ? 'up' : 'down'} ${Math.abs(best.dy).toFixed(2)} m): side ${best.s.side.iou.toFixed(3)}, front ${best.s.front.iou.toFixed(3)}, top ${sc.top.iou.toFixed(3)}`);
}
