// Set up the livery color picker of a detailed model: find the exterior textures with the most
// painted (saturated) pixels, and the hue band most of that paint is in, and write them as
// asset.recolor. A livery with almost no color (white, bare metal, black) gets none: there is
// nothing for the picker to repaint.
// Usage: node --import ./scripts/node/register.js scripts/recolor-setup.js <model id> [...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { readPNG } from './reference/png.js';

for (const id of process.argv.slice(2)) {
  const file = `data/models/aviation/${id}.json`;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const a = m.asset;
  if (!a) { console.log(`${id}: not a detailed model`); continue; }
  const exterior = (a.files ?? [{ file: a.file }]).filter(f => f.fallback?.system !== 'interior').map(f => f.file);
  const textures = new Set();
  for (const f of new Set(exterior)) {
    const ac = join(a.path, f);
    if (!existsSync(ac)) continue;
    for (const t of readFileSync(ac, 'latin1').matchAll(/^texture "([^"]+)"/gm)) textures.add(normalize(join(dirname(f), t[1])).replace(/\\/g, '/'));
  }
  const stats = [];
  for (const t of textures) {
    const p = join(a.path, t);
    // Lights, effects and interior textures are not the livery.
    if (!existsSync(p) || !/\.png$/i.test(p) || /light|interior|panel|cockpit|instrument|glass|window|halo|(^|\/)fx|effect|shadow/i.test(t)) continue;
    let img; try { img = readPNG(readFileSync(p)); } catch { continue; }
    const hist = new Float64Array(360); let sat = 0, all = 0;
    for (let k = 0; k < img.width * img.height; k += 3) { // every third pixel is plenty
      const r = img.data[k * 4] / 255, g = img.data[k * 4 + 1] / 255, b = img.data[k * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
      all++;
      if (mx - mn < 0.2 || l < 0.08 || l > 0.92) continue;
      const s = (mx - mn) / (1 - Math.abs(2 * l - 1));
      if (s < 0.3) continue;
      let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      h = (h * 60 + 360) % 360;
      hist[Math.floor(h)]++; sat++;
    }
    stats.push({ t, sat, frac: sat / all, hist });
  }
  const best = stats.filter(s => s.frac > 0.015).sort((p, q) => q.sat - p.sat)[0];
  if (!best) { console.log(`${id}: no painted livery to recolor`); continue; }
  // The hue band: the strongest 36-degree window of the histogram.
  let peak = 0, bestSum = -1;
  for (let h = 0; h < 360; h++) { let s = 0; for (let k = -18; k <= 18; k++) s += best.hist[(h + k + 360) % 360]; if (s > bestSum) { bestSum = s; peak = h; } }
  const hue = [Math.max(0, peak - 22), Math.min(360, peak + 22)];
  a.recolor = { textures: [best.t], hue };
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  console.log(`${id}: recolor ${best.t} hue ${hue.join('-')} (${(best.frac * 100).toFixed(0)}% painted)`);
}
