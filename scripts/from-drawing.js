// Drawing in, model out. Finds the views on a three-view drawing, fits a parametric
// model to them and reports how closely the model's outline follows the drawing's.
// Nothing is marked on the drawing; only the published length and span are given.
// Usage: npm run fit -- <drawing.png> --length 47.9 --span 37.55 [--id tu-154 --name "Tupolev Tu-154M"] [--out dir]
//        npm run fit -- references/<id>          (takes the image and the published size from reference.json)
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { targetFromSheet } from '../src/fit/sheet.js';
import { fitViews } from '../src/fit/fit.js';
import { gate } from '../src/fit/gate.js';
import { score, trianglesOf, raster, fill, overlay, Mask } from '../src/fit/views.js';
import { readPNG, writePNG } from './reference/png.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const input = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!input) { console.error('usage: npm run fit -- <drawing.png> --length <m> --span <m> [--id id] [--name name] [--out dir]'); process.exit(1); }

let image = input, length = Number(opt('length')), span = opt('span') ? Number(opt('span')) : undefined, id = opt('id'), name = opt('name');
if (existsSync(input) && statSync(input).isDirectory()) {
  const ref = JSON.parse(readFileSync(join(input, 'reference.json'), 'utf8'));
  image = join(input, ref.image);
  length ||= ref.published.length; span ??= ref.published.span;
  id ??= `${basename(input)}-fitted`;
}
if (!length) { console.error('the published length in meters is needed for scale: --length <m>'); process.exit(1); }
id ??= basename(image).replace(/\.\w+$/, '');
name ??= id;

const target = targetFromSheet(readPNG(readFileSync(image)), { length, span });
const f = target.found;
console.log(`views: side ${JSON.stringify(f.side.box)}${f.side.mirrored ? ' (mirrored)' : ''}${f.side.wheelBlobs ? `, ${f.side.wheelBlobs} wheel marks under it` : ''}; top ${JSON.stringify(f.top.box)}${f.top.turned ? ' (turned)' : ''}; front ${f.front ? JSON.stringify(f.front.box) + (f.front.turned ? ' (turned)' : '') : 'none'}`);
console.log(`scale check: height ${f.heightMeasured} m on the sheet, span ${f.spanMeasured} m by the length scale${span ? ` (published ${span} m)` : ''}`);
const model = fitViews(target, { id, name, specs: { length_m: length, ...(span ? { wingspan_m: span } : {}), height_m: Math.round(target.found.heightMeasured * 100) / 100 } }, { log: l => console.log(`  ${l}`) });
const obj = buildModel(model);
const sc = score(target, obj);
for (const v of Object.keys(sc)) console.log(`${v.padEnd(6)} overlap ${sc[v].iou.toFixed(3)}, outline ${(sc[v].mean * 100).toFixed(0)} cm mean, ${(sc[v].p95 * 100).toFixed(0)} cm at 95%, worst ${(sc[v].max * 100).toFixed(0)} cm at ${JSON.stringify(sc[v].worst)}`);
const g = model.geometry;
console.log(`model: ${g.fuselage.stations.length} body stations, ${g.surfaces.map(s => Object.values(s.parts)[0].id).join(', ')}, ${g.engines.length} engine pair(s), gear ${g.gear.nose ? 'nose + ' : ''}${g.gear.mains.length} main leg pair(s)`);

const failures = gate(model, sc);
console.log(failures.length ? ['GATE: not fit to show', ...failures.map(f => `  - ${f}`)].join('\n') : 'GATE: passed');
const out = opt('out');
if (out) {
  mkdirSync(out, { recursive: true });
  const tris = trianglesOf(obj);
  for (const v of Object.keys(sc)) {
    const t = target[v];
    writeFileSync(join(out, `${id}-${v}.png`), writePNG(overlay(t, fill(raster(tris, v, new Mask(t.w, t.h, t.ppm, t.u0, t.v0))))));
  }
  writeFileSync(join(out, `${id}.json`), JSON.stringify(model, null, 2) + '\n');
  console.log(`wrote ${join(out, `${id}.json`)} and overlays (gray both, red drawing only, blue model only)`);
}
