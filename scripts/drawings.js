// Generate an A3 three-view drawing (SVG) for every model in the catalog.
// Lines are exact projections of the 3D geometry with hidden lines removed
// (src/draw/hlr.js), laid out at a standard scale with sections and a title block
// (src/draw/sheet.js). Nothing is traced from pixels and nothing is set per model.
// Usage: npm run drawings [model-id ...] [--png] [--plain] [--out dir]
//   Named ids may be workshop models too. --png also writes each sheet as a 4200 px PNG.
//   --plain draws the three views alone, each with its closed outline: no frame, title,
//   dimensions, sections or ground lines. This is the sheet the fitter reads.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import '../src/builders/index.js';
import { buildModel } from '../src/registry.js';
import { loadCatalog } from '../src/catalog-node.js';
import { loadAssetNode } from '../src/assets-node.js';
import { collect, intersections, projectView, section, bounds, contour } from '../src/draw/hlr.js';
import { sheet } from '../src/draw/sheet.js';
import { svgToPng } from './node/browser.js';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const outDir = oi >= 0 ? args[oi + 1] : 'drawings';
const png = args.includes('--png'), plain = args.includes('--plain');
const only = new Set(args.filter((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1)));
const { index, models: listed } = loadCatalog();
const models = only.size ? [...index.models, ...index.workshop].map(p => JSON.parse(readFileSync(`data/${p}`, 'utf8'))).filter(m => only.has(m.id)) : listed;
mkdirSync(outDir, { recursive: true });

function drawing(model) {
  const obj = model.asset ? loadAssetNode(model) : buildModel(model);
  const meshes = collect(obj);
  const cuts = intersections(meshes);
  const views = {};
  for (const name of ['side', 'top', 'front']) views[name] = projectView(meshes, name, { extra: cuts });
  // A plain sheet is read by the fitter: every view gets its closed outline, gaps and all bridged.
  if (plain) for (const name of ['side', 'top', 'front']) views[name].outline.push(...contour(meshes, name));

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
  const svg = sheet(model, views, sections, { plain, dims: plain ? null : measure(meshes, sections) });
  writeFileSync(`${outDir}/${model.id}.svg`, svg);
  if (png) writeFileSync(`${outDir}/${model.id}.png`, svgToPng(svg, 4200));
  const count = v => v.outline.length + v.detail.length;
  return { id: model.id, bytes: svg.length, lines: count(views.side) + count(views.top) + count(views.front), cuts: cuts.length };
}

/**
 * The standard dimension set beyond length, span and height, measured from the geometry:
 * wheelbase and track from the tire contact points, tail span from the horizontal tail,
 * fuselage width from the widest section. Anything not present is left out.
 */
function measure(meshes, sections) {
  const dims = {};
  const LEG = /nose|main|wing-gear|body-gear|tail-wheel|landing-gear/, NOT = /door|bay|fairing|cover/;
  const parts = new Map();
  for (const m of meshes) {
    if (m.system !== 'gear' || !LEG.test(m.part) || NOT.test(m.part)) continue;
    if (!parts.has(m.part)) parts.set(m.part, []);
    parts.get(m.part).push(m);
  }
  // Each part's contact points: its vertices within 3 cm of its own lowest point. A part that
  // holds both sides, or every leg, is split into legs: left, right and (for all legs) center.
  const mean = (list, k) => list.reduce((a, p) => a + p[k], 0) / list.length;
  const leg = list => ({ x: mean(list, 'x'), z: mean(list, 'z') });
  const lead = [], mains = [];
  // Ground contact of a set of vertices: those within 3 cm of its lowest one. A region whose lowest
  // point is well above the ground (a brace, a door, a mis-mapped hinge) has no wheel and is skipped.
  let ground = Infinity;
  for (const list of parts.values()) for (const m of list) for (let i = 1; i < m.verts.length; i += 3) ground = Math.min(ground, m.verts[i]);
  const contact = vs => {
    const lo = Math.min(...vs.map(v => v.y));
    return lo > ground + 0.3 ? null : vs.filter(v => v.y < lo + 0.03);
  };
  const add = (list, pts) => { if (pts?.length) list.push(leg(pts)); };
  for (const [id, list] of parts) {
    const vs = [];
    for (const m of list) for (let i = 0; i < m.verts.length; i += 3) vs.push({ x: m.verts[i], y: m.verts[i + 1], z: m.verts[i + 2] });
    if (!vs.length) continue;
    if (/nose|tail-wheel/.test(id)) { add(lead, contact(vs)); continue; }
    // Regions by side, each with its own ground contact, so legs at slightly different heights all count.
    const maxZ = Math.max(...vs.map(v => Math.abs(v.z)));
    if (maxZ < 0.3) { add(mains, contact(vs)); continue; } // one narrow leg on the centerline
    const left = vs.filter(v => v.z > 0.25 * maxZ), right = vs.filter(v => v.z < -0.25 * maxZ);
    const center = /landing-gear/.test(id) ? vs.filter(v => Math.abs(v.z) <= 0.25 * maxZ) : [];
    if (center.length) add(lead, contact(center));
    if (left.length) add(mains, contact(left));
    if (right.length) add(mains, contact(right));
  }
  if (lead.length && mains.length) {
    const a = lead[0].x, b = mean(mains, 'x');
    dims.wheelbase = { x1: Math.min(a, b), x2: Math.max(a, b) };
  }
  // Track: between the outermost main legs, as manufacturers state it.
  const zs = mains.map(p => p.z);
  if (zs.length >= 2 && Math.max(...zs) > 0.15 && Math.min(...zs) < -0.15) dims.track = { z1: Math.min(...zs), z2: Math.max(...zs) };
  const tail = meshes.filter(m => /stabilizer|elevator|tailplane|htail/.test(m.part));
  if (tail.length) {
    const b = bounds(tail);
    dims.tailSpan = { z1: b.min.z, z2: b.max.z, x: b.max.x };
  }
  let widest = -1, w = 0;
  sections.forEach((c, i) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const l of c.lines) for (const [z] of l) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (z1 - z0 > w) { w = z1 - z0; widest = i; }
  });
  if (widest >= 0) dims.fuselage = { section: widest, width: w };
  return dims;
}

for (const m of models) {
  if (only.size && !only.has(m.id)) continue;
  const t = Date.now();
  const r = drawing(m);
  console.log(`${r.id.padEnd(22)} ${String(r.lines).padStart(6)} lines  ${String(r.cuts).padStart(6)} cut segments  ${(r.bytes / 1024).toFixed(0).padStart(4)} KB  ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
