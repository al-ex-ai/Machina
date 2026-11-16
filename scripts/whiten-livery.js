// Paint a house livery neutral: every strongly colored pixel (the maker's color, its logo and
// lettering) becomes white, shaded as the original was, so panel lines and windows stay.
// Usage: node scripts/whiten-livery.js <in.png> <out.png> [min color spread, default 22] [light level]
import { readFileSync, writeFileSync } from 'node:fs';
import { readPNG, writePNG } from './reference/png.js';

const [inp, out, spreadArg, lightArg] = process.argv.slice(2);
// Optionally every light pixel too (lettering anti-aliased in gray on a white body): at or above this level.
const light = lightArg ? Number(lightArg) : Infinity;
if (!inp || !out) { console.error('usage: node scripts/whiten-livery.js <in.png> <out.png> [spread]'); process.exit(1); }
const min = Number(spreadArg ?? 22);
const img = readPNG(readFileSync(inp));
const d = img.data;
let n = 0;
for (let k = 0; k < img.width * img.height; k++) {
  const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2];
  if (Math.max(r, g, b) - Math.min(r, g, b) < min && Math.min(r, g, b) < light) continue;
  // One flat white: shading kept from the paint would leave the lettering faintly readable.
  const v = 240;
  d[k * 4] = v; d[k * 4 + 1] = v; d[k * 4 + 2] = Math.min(255, v + 2);
  n++;
}
writeFileSync(out, writePNG(img));
console.log(`${n} colored pixels painted white (${((n / (img.width * img.height)) * 100).toFixed(1)}%)`);
