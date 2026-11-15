// The known-aircraft test: rebuild aircraft from their three-view drawings alone and score
// each model against the real mesh the drawing was made from. The drawings and the layout
// read from each live in references/known (<id>.svg, <id>.layout.json).
//
// Scores: outline overlap per view, and the error of engines, main gear legs and wing root
// as a share of the length, every part measured the same way on the mesh and on the model.
// Usage: npm run known [-- id ...] [--out dir]   (--out writes overlays and fitted models)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadAssetNode } from '../src/assets-node.js';
import { collect } from '../src/draw/hlr.js';
import { pick, boxOf, nacelle, clusters1 } from '../src/fit/mesh.js';
import { targetOf, score, trianglesOf, raster, fill, overlay, Mask } from '../src/fit/views.js';
import { targetFromSheet } from '../src/fit/sheet.js';
import { fitLayout } from '../src/fit/layout.js';
import { gate } from '../src/fit/gate.js';
import { readPNG, writePNG } from './reference/png.js';
import { svgToPng } from './node/browser.js';

const DIR = 'references/known';
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : null;
const ids = args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
const all = readdirSync(DIR).filter(f => f.endsWith('.layout.json')).map(f => f.replace('.layout.json', ''));
if (out) mkdirSync(out, { recursive: true });

/** Engines from geometry: propulsion triangles in clusters across the span, each measured as a nacelle. Nose at x = 0, ground at y = 0. */
function enginesOf(obj) {
  const meshes = collect(obj, { skipSystems: ['interior', 'lights', 'avionics'] });
  const box = boxOf(pick(meshes, /./));
  const eng = meshes.filter(m => m.system === 'propulsion').flatMap(m => pick([m], /./)).map(t => t.map((v, k) => v - (k % 3 === 0 ? box.min[0] : k % 3 === 1 ? box.min[1] : 0)));
  const cz = t => (t[2] + t[5] + t[8]) / 3;
  const out = [];
  for (const zc of clusters1(eng.map(cz), 0.6)) {
    const tris = eng.filter(t => cz(t) >= zc.min && cz(t) <= zc.max);
    if (tris.length < 20) continue;
    let n;
    try { n = nacelle(tris); } catch { continue; }
    const dia = 2 * Math.max(...n.nacelle.stations.map(q => q[1]));
    if (dia >= 0.4) out.push({ x: n.position.x, y: n.position.y, z: n.position.z, dia });
  }
  return out.sort((p, q) => p.z - q.z);
}

/** Where the gear meets the ground: runs of a silhouette's lowest 60 cm, joined across small gaps, as centers. */
function contacts(m, gap) {
  const on = new Uint8Array(m.w);
  for (let j = 0; j < m.h && m.V(j) < 0.6; j++) for (let i = 0; i < m.w; i++) if (m.data[j * m.w + i]) on[i] = 1;
  const out = [];
  let a = -1, last = -1;
  for (let i = 0; i <= m.w; i++) {
    if (i < m.w && on[i]) { if (a < 0 || (i - last) / m.ppm > gap) { if (a >= 0) out.push((m.U(a) + m.U(last)) / 2); a = i; } last = i; }
  }
  if (a >= 0) out.push((m.U(a) + m.U(last)) / 2);
  return out;
}

/** Wing root leading edge from a top silhouette: the first filled column at z just outside the widest body. */
function wingRootLE(top, R) {
  const row = Math.round((R + 0.4 - top.v0) * top.ppm);
  for (let x = 0; x < top.w; x++) if (top.at(x, row)) return top.u0 + (x + 0.5) / top.ppm;
  return NaN;
}

/** Half width of the body: the widest top-view row at the middle of the length that is still continuous from the centerline. */
function bodyHalfWidth(top, L) {
  let best = 0;
  for (const f of [0.25, 0.3, 0.35]) {
    const x = Math.round((L * f - top.u0) * top.ppm), y0 = Math.round((0 - top.v0) * top.ppm);
    let y = y0; while (y < top.h && top.at(x, y)) y++;
    best = Math.max(best, (y - y0) / top.ppm);
  }
  return best;
}

const pct = (v, L) => `${(100 * v / L).toFixed(1)}%`;
const rows = [];
for (const id of ids.length ? ids : all) {
  const layout = JSON.parse(readFileSync(`${DIR}/${id}.layout.json`, 'utf8'));
  const svg = readFileSync(`${DIR}/${layout.drawing}`, 'utf8');
  const sheet = targetFromSheet(readPNG(svgToPng(svg, 4200)), { length: layout.size.length, span: layout.size.span });
  let model;
  try {
    model = fitLayout(sheet, layout, { id: `${id}-drawn`, name: id, specs: { length_m: layout.size.length, wingspan_m: layout.size.span, height_m: layout.size.height } }, { log: process.env.DEBUG ? l => console.log(`  ${l}`) : undefined });
  } catch (e) {
    console.log(`${id.padEnd(10)} failed: ${e.message}`);
    if (process.env.DEBUG) console.log(e.stack);
    continue;
  }
  const src = JSON.parse(readFileSync(`data/models/aviation/${id}.json`, 'utf8'));
  const real = loadAssetNode(src), built = buildModel(model);
  const key = targetOf(real);
  const sc = score(key, built);
  const L = key.L;
  const mine = targetOf(built, { ppm: key.ppm, frame: key });
  const R = bodyHalfWidth(key.top, L);
  // Part errors as a share of length. Parts pair up by position; a missing or extra part is a structure failure.
  const errs = [], bad = [];
  const pair = (want, got, keys, what) => {
    if (want.length !== got.length) { bad.push(`${what}: ${got.length} built, ${want.length} real`); return; }
    want.forEach((w, i) => errs.push({ what: `${what} ${i + 1}`, e: Math.max(...keys.map(k => Math.abs(w[k] - got[i][k]))) }));
  };
  pair(enginesOf(real), enginesOf(built), ['x', 'y', 'z', 'dia'], 'engine');
  const along = m => contacts(m, 0.6).map(x => ({ x })), across = m => contacts(m, 0.7).map(z => ({ z }));
  pair(along(key.side), along(mine.side), ['x'], 'gear along');
  pair(across(key.front), across(mine.front), ['z'], 'gear across');
  // Wheels per leg are structure: what the layout read from the drawing.
  const gg = model.geometry.gear, lg = layout.gear;
  const ax = q => `${q.axles ?? 1}x${q.wheels}`;
  if (!gg.nose || ax(gg.nose) !== ax(lg.nose)) bad.push(`nose wheels ${gg.nose ? ax(gg.nose) : 'none'}, drawing ${ax(lg.nose)}`);
  const gm = (gg.mains ?? []).map(ax).sort().join(' '), lm = lg.mains.map(ax).sort().join(' ');
  if (gm !== lm) bad.push(`main legs ${gm}, drawing ${lm}`);
  const le = [wingRootLE(key.top, R), wingRootLE(mine.top, R)];
  errs.push({ what: 'wing root', e: Math.abs(le[0] - le[1]) });
  const worst = errs.reduce((p, q) => (q.e > p.e ? q : p), { what: '-', e: 0 });
  const failures = gate(model, sc);
  const views = ['side', 'top', 'front'];
  const pass = views.every(v => sc[v].iou >= 0.97) && worst.e <= 0.02 * L && !bad.length;
  rows.push({ id, pass });
  console.log(`${id.padEnd(10)} ${views.map(v => `${v} ${sc[v].iou.toFixed(3)}`).join('  ')}   worst part ${worst.what} ${pct(worst.e, L)}   ${pass ? 'PASS' : 'FAIL'}`);
  for (const q of errs.filter(q => q.e > 0.02 * L)) console.log(`    ${q.what} off by ${q.e.toFixed(2)} m (${pct(q.e, L)})`);
  for (const q of bad) console.log(`    structure: ${q}`);
  for (const q of failures) console.log(`    gate: ${q}`);
  if (out) {
    const tris = trianglesOf(built);
    for (const v of views) {
      const t = key[v];
      writeFileSync(`${out}/${id}-${v}.png`, writePNG(overlay(t, fill(raster(tris, v, new Mask(t.w, t.h, t.ppm, t.u0, t.v0))))));
    }
    writeFileSync(`${out}/${id}-drawn.json`, JSON.stringify(model, null, 2) + '\n');
  }
}
if (rows.length > 1) console.log(`${rows.filter(r => r.pass).length} of ${rows.length} pass`);
