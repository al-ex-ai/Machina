// A new aircraft from a three-view drawing: the folder holds the drawing and the layout read
// from it (layout.json: what the aircraft is made of, its published size and the drawing's
// credits). The drawing is read at one scale, set by the published length; the model is
// written to data/models/aviation/<id>-drawn.json and put in the workshop, not the catalog.
// Usage: npm run build-drawn -- references/new/<id> [--out dir]   (--out writes overlays)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { targetFromSheet } from '../src/fit/sheet.js';
import { fitLayout } from '../src/fit/layout.js';
import { gate } from '../src/fit/gate.js';
import { score, trianglesOf, raster, fill, overlay, Mask } from '../src/fit/views.js';
import { readPNG, writePNG } from './reference/png.js';
import { svgToPng } from './node/browser.js';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : null;
const dir = args.find((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
if (!dir) { console.error('usage: npm run build-drawn -- references/new/<id> [--out dir]'); process.exit(1); }
const id = `${basename(dir)}-drawn`;
const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
const file = join(dir, layout.drawing);
const img = readPNG(file.endsWith('.svg') ? svgToPng(readFileSync(file, 'utf8'), 3000) : readFileSync(file));
const target = targetFromSheet(img, { length: layout.size.length, height: layout.size.height });
const f = target.found;
console.log(`views: side ${JSON.stringify(f.side.box)}, top ${JSON.stringify(f.top.box)}, front ${f.front ? JSON.stringify(f.front.box) : 'none'}`);
console.log(`at the length's scale: height ${f.heightMeasured} m (published ${layout.size.height}), span ${(2 * target.S).toFixed(2)} m (published ${layout.size.span})`);

const model = fitLayout(target, layout, { id, name: layout.name, specs: { length_m: layout.size.length, wingspan_m: layout.size.span, height_m: layout.size.height } }, { log: l => console.log(`  ${l}`) });
model.reference = { source: layout.source, author: layout.author, license: layout.license, note: 'Built from a three-view drawing: outside only, no cockpit or cabin interior.' };
const sc = score(target, buildModel(model));
for (const v of Object.keys(sc)) console.log(`${v.padEnd(6)} overlap with the drawing ${sc[v].iou.toFixed(3)}`);
const failures = gate(model, sc);
console.log(failures.length ? ['GATE: not fit to show', ...failures.map(q => `  - ${q}`)].join('\n') : 'GATE: passed');

writeFileSync(`data/models/aviation/${id}.json`, JSON.stringify(model, null, 2) + '\n');
const indexFile = 'data/index.json', index = JSON.parse(readFileSync(indexFile, 'utf8')), path = `models/aviation/${id}.json`;
if (!index.models.includes(path) && !index.workshop.includes(path)) { index.workshop.push(path); writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n'); }
console.log(`wrote data/${path} (workshop)`);
if (out) {
  mkdirSync(out, { recursive: true });
  const tris = trianglesOf(buildModel(model));
  for (const v of Object.keys(sc)) { const t = target[v]; writeFileSync(join(out, `${id}-${v}.png`), writePNG(overlay(t, fill(raster(tris, v, new Mask(t.w, t.h, t.ppm, t.u0, t.v0)))))); }
}
