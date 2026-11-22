// What each detailed model downloads: its .ac files and the textures they use (after
// textureMap), raw and gzipped, against a per-model budget. --prune deletes files in an
// asset folder that no model (listed or workshop) loads, keeping license and credit files.
// Usage: node scripts/size-report.js [--prune] [model id ...]
import { readFileSync, readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_MB = 20; // gzipped download per model
const prune = process.argv.includes('--prune');
const only = new Set(process.argv.slice(2).filter(a => !a.startsWith('--')));
const index = JSON.parse(readFileSync('data/index.json', 'utf8'));
const load = p => JSON.parse(readFileSync(join('data', p), 'utf8'));
const listed = new Set(index.models);
const all = [...index.models, ...index.workshop].map(p => ({ ...load(p), _listed: listed.has(p) })).filter(m => m.asset);

/** Files (relative to the asset folder) a model loads. */
function used(m) {
  const a = m.asset, out = new Set();
  const map = a.textureMap ?? {};
  for (const f of a.files ?? [{ file: a.file }]) {
    const file = normalize(f.file).replace(/\\/g, '/');
    out.add(file);
    const full = join(a.path, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, 'latin1');
    for (const t of text.matchAll(/^texture "([^"]+)"/gm)) {
      const tex = map[t[1]] ?? t[1];
      out.add(normalize(join(dirname(file), tex)).replace(/\\/g, '/'));
    }
  }
  if (a.recolor?.textures) for (const t of a.recolor.textures) out.add(t.file ?? t);
  return out;
}

const walk = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
};

const KEEP = /(^|[/\\])(LICENSE|COPYING|CREDITS|AUTHORS|README)[^/\\]*$/i;
const byPath = new Map();
for (const m of all) {
  if (!byPath.has(m.asset.path)) byPath.set(m.asset.path, new Set());
  for (const f of used(m)) byPath.get(m.asset.path).add(f);
}

let over = 0;
const rows = [];
for (const m of all) {
  if (only.size ? !only.has(m.id) : !m._listed) continue;
  let raw = 0, gz = 0, missing = 0;
  for (const f of used(m)) {
    const p = join(m.asset.path, f);
    if (!existsSync(p)) { missing++; continue; }
    const buf = readFileSync(p);
    raw += buf.length;
    gz += /\.(ac|xml|txt)$/i.test(p) ? gzipSync(buf, { level: 6 }).length : buf.length;
  }
  const mb = gz / 1e6;
  if (mb > BUDGET_MB) over++;
  rows.push([m.id, (raw / 1e6).toFixed(1), mb.toFixed(1), mb > BUDGET_MB ? 'OVER' : 'ok', missing ? `${missing} missing` : '']);
}
rows.sort((a, b) => b[2] - a[2]);
console.log('model'.padEnd(18), 'raw MB'.padStart(7), 'gz MB'.padStart(7));
for (const r of rows) console.log(r[0].padEnd(18), r[1].padStart(7), r[2].padStart(7), r[3], r[4]);

if (prune) {
  let n = 0, bytes = 0;
  for (const [path, keep] of byPath) {
    if (!existsSync(path)) continue;
    for (const p of walk(path)) {
      const rel = relative(path, p).replace(/\\/g, '/');
      if (keep.has(rel) || KEEP.test(rel)) continue;
      bytes += statSync(p).size; unlinkSync(p); n++;
    }
  }
  console.log(`pruned ${n} unused files, ${(bytes / 1e6).toFixed(1)} MB`);
}
process.exitCode = over ? 1 : 0;
