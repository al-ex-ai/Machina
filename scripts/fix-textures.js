// Make every texture a browser can load. FlightGear models often use SGI .rgb/.rgba/.bw
// images (and some DDS), which browsers cannot decode, so those surfaces render blank.
// This converts them to PNG next to the original and points the .ac files at the PNG.
// Usage: node scripts/fix-textures.js [--check]   (--check only reports, exit 1 if any)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { writePNG } from './reference/png.js';

const check = process.argv.includes('--check');
const OK = new Set(['.png', '.jpg', '.jpeg']);

/** Decode an SGI image (verbatim or RLE, 8 bits per channel) to RGBA, bottom row first in the file. */
export function readSGI(b) {
  if (b.readUInt16BE(0) !== 474) throw new Error('not an SGI image');
  const rle = b[2] === 1, bpc = b[3];
  if (bpc !== 1) throw new Error('only 8-bit SGI images are supported');
  const w = b.readUInt16BE(6), h = b.readUInt16BE(8), zc = b.readUInt16BE(10);
  const chan = Array.from({ length: zc }, () => new Uint8Array(w * h));
  if (!rle) {
    for (let z = 0; z < zc; z++) chan[z].set(b.subarray(512 + z * w * h, 512 + (z + 1) * w * h));
  } else {
    const n = h * zc, starts = 512, lens = 512 + n * 4;
    for (let z = 0; z < zc; z++) for (let y = 0; y < h; y++) {
      let o = b.readUInt32BE(starts + (z * h + y) * 4), x = 0;
      const row = chan[z].subarray(y * w, (y + 1) * w);
      for (;;) {
        const c = b[o++], count = c & 0x7f;
        if (!count) break;
        if (c & 0x80) { for (let k = 0; k < count && x < w; k++) row[x++] = b[o++]; }
        else { const v = b[o++]; for (let k = 0; k < count && x < w; k++) row[x++] = v; }
      }
      void lens;
    }
  }
  // SGI stores the bottom row first; AC3D texture coordinates match the file order when
  // FlightGear loads it, so flip to the top-first order PNG uses.
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (h - 1 - y) * w + x, d = (y * w + x) * 4;
    const g = chan[0][s];
    data[d] = g; data[d + 1] = zc >= 3 ? chan[1][s] : g; data[d + 2] = zc >= 3 ? chan[2][s] : g;
    data[d + 3] = zc === 4 ? chan[3][s] : zc === 2 ? chan[1][s] : 255;
  }
  return { width: w, height: h, data };
}

let bad = 0, converted = 0, missing = 0;
for (const f of readdirSync('data/models/aviation')) {
  const m = JSON.parse(readFileSync(join('data/models/aviation', f), 'utf8'));
  if (!m.asset) continue;
  for (const file of new Set((m.asset.files ?? [{ file: m.asset.file }]).map(q => q.file))) {
    const ac = join(m.asset.path, file);
    if (!existsSync(ac)) continue;
    let text = readFileSync(ac, 'latin1'), changed = false;
    for (const [, tex] of [...text.matchAll(/^texture "([^"]+)"/gm)]) {
      if (OK.has(extname(tex).toLowerCase())) continue;
      bad++;
      const src = join(dirname(ac), tex), png = tex.replace(/\.[^.]+$/, '.png');
      if (check) { console.log(`${m.id}: ${file} uses ${tex}`); continue; }
      if (!existsSync(join(dirname(ac), png))) {
        if (!existsSync(src)) { missing++; console.log(`${m.id}: ${tex} is missing`); continue; }
        try { writeFileSync(join(dirname(ac), png), writePNG(readSGI(readFileSync(src)))); converted++; }
        catch (e) { console.log(`${m.id}: ${tex}: ${e.message}`); continue; }
      }
      text = text.split(`texture "${tex}"`).join(`texture "${png}"`);
      changed = true;
    }
    if (changed) writeFileSync(ac, text, 'latin1');
  }
}
console.log(check ? `${bad} texture references a browser cannot load` : `converted ${converted} textures, ${missing} missing`);
if (check && bad) process.exit(1);
