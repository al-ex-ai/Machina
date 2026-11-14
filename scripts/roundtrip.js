// Round trip: take a detailed mesh, keep only its three silhouettes (what a drawing
// shows), rebuild a parametric model from them with no hints, and score the result
// against the mesh it came from. The mesh is the answer key, so this measures the
// picture-to-model path on every aircraft there is a mesh for, with nothing labelled.
// Usage: npm run roundtrip [-- model-id ...] [--out dir]   (--out writes overlays and the fitted models)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadAssetNode } from '../src/assets-node.js';
import { targetOf, score, trianglesOf, raster, fill, overlay, Mask } from '../src/fit/views.js';
import { fitViews } from '../src/fit/fit.js';
import { writePNG } from './reference/png.js';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
// Every jet transport there is a mesh for. The A380 mesh has no tailplane and is left out.
const SET = ['a320neo', 'b737-300', 'b787-8', 'b747-400', 'b707', 'tu134', 'il76'];
if (out) mkdirSync(out, { recursive: true });

const pad = (v, n = 6) => String(v).padStart(n);
const rows = [];
for (const id of ids.length ? ids : SET) {
  const src = JSON.parse(readFileSync(`data/models/aviation/${id}.json`, 'utf8'));
  const target = targetOf(loadAssetNode(src));
  let model, sc;
  try {
    model = fitViews(target, { id: `${id}-fitted`, name: src.name, specs: src.specs }, { log: process.env.DEBUG ? l => console.log(`  ${l}`) : undefined });
    sc = score(target, buildModel(model));
  } catch (e) {
    console.log(`${id.padEnd(12)} failed: ${e.message}`);
    if (process.env.DEBUG) console.log(e.stack);
    continue;
  }
  const views = ['side', 'top', 'front'];
  const iou = views.reduce((a, v) => a + sc[v].iou, 0) / 3, p95 = Math.max(...views.map(v => sc[v].p95));
  rows.push({ id, iou, p95 });
  console.log(`${id.padEnd(12)} ${views.map(v => `${v} ${sc[v].iou.toFixed(3)} ${pad((sc[v].mean * 100).toFixed(0), 3)}/${pad((sc[v].p95 * 100).toFixed(0), 3)}/${pad((sc[v].max * 100).toFixed(0), 4)} cm`).join('   ')}`);
  if (out) {
    const tris = trianglesOf(buildModel(model));
    for (const v of views) {
      const t = target[v];
      writeFileSync(`${out}/${id}-${v}.png`, writePNG(overlay(t, fill(raster(tris, v, new Mask(t.w, t.h, t.ppm, t.u0, t.v0))))));
    }
    writeFileSync(`${out}/${id}-fitted.json`, JSON.stringify(model, null, 2) + '\n');
  }
}
if (rows.length > 1) console.log(`${'mean'.padEnd(12)} overlap ${(rows.reduce((a, r) => a + r.iou, 0) / rows.length).toFixed(3)}, worst 95% outline distance ${(Math.max(...rows.map(r => r.p95)) * 100).toFixed(0)} cm   (per view: overlap, then mean / 95% / max outline distance)`);
