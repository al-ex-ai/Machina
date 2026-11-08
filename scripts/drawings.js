// Generate an A3 three-view drawing (SVG) for every model in the catalog.
// Lines are exact projections of the 3D geometry with hidden lines removed
// (src/draw/hlr.js), laid out at a standard scale with sections and a title block
// (src/draw/sheet.js). Nothing is traced from pixels and nothing is set per model.
// Usage: npm run drawings [model-id ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadCatalog } from '../src/catalog-node.js';
import { loadAssetNode } from '../src/assets-node.js';
import { collect, intersections, projectView, section, bounds } from '../src/draw/hlr.js';
import { sheet } from '../src/draw/sheet.js';

const only = new Set(process.argv.slice(2));
const { models } = loadCatalog();
mkdirSync('drawings', { recursive: true });

function drawing(model) {
  const obj = model.asset ? loadAssetNode(model) : buildModel(model);
  const meshes = collect(obj);
  const cuts = intersections(meshes);
  const views = {};
  for (const name of ['side', 'top', 'front']) views[name] = projectView(meshes, name, { extra: cuts });

  // Fuselage sections at fixed fractions of the fuselage length. Only closed outlines
  // at least a fifth of the fuselage width are kept: open skins with door and window
  // cutouts give fragments, and those stations are left out.
  const body = meshes.filter(m => m.part === 'fuselage');
  const sections = [];
  if (body.length) {
    const box = bounds(body);
    const len = box.max.x - box.min.x, width = box.max.z - box.min.z;
    const closed = l => l.length > 8 && Math.hypot(l[0][0] - l.at(-1)[0], l[0][1] - l.at(-1)[1]) < 1e-6;
    const wide = l => Math.max(...l.map(p => p[0])) - Math.min(...l.map(p => p[0])) > width * 0.2;
    let n = 0;
    for (const f of [0.12, 0.3, 0.55, 0.8]) {
      const x = box.min.x + len * f;
      const lines = section(meshes, ['fuselage'], x).filter(l => closed(l) && wide(l));
      if (lines.length) sections.push({ x, label: 'ABCD'[n++], lines });
    }
  }
  const svg = sheet(model, views, sections);
  writeFileSync(`drawings/${model.id}.svg`, svg);
  const count = v => v.outline.length + v.detail.length;
  return { id: model.id, bytes: svg.length, lines: count(views.side) + count(views.top) + count(views.front), cuts: cuts.length };
}

for (const m of models) {
  if (only.size && !only.has(m.id)) continue;
  const t = Date.now();
  const r = drawing(m);
  console.log(`${r.id.padEnd(22)} ${String(r.lines).padStart(6)} lines  ${String(r.cuts).padStart(6)} cut segments  ${(r.bytes / 1024).toFixed(0).padStart(4)} KB  ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
