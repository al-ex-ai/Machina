// Convert SGI (.rgb, .rgba, .sgi) textures to PNG and point the AC files under a folder at
// the PNGs. Some FlightGear aircraft ship SGI textures, which browsers cannot load.
// Usage: node scripts/rgb-to-png.js <asset folder>
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { writePNG } from './reference/png.js';

function decode(buf) {
  if (buf.readUInt16BE(0) !== 474) throw new Error('not an SGI image');
  const rle = buf[2] === 1, bpc = buf[3], w = buf.readUInt16BE(6), h = buf.readUInt16BE(8), zs = buf.readUInt16BE(10);
  if (bpc !== 1) throw new Error('only 8-bit SGI images');
  const chan = new Array(zs).fill(0).map(() => new Uint8Array(w * h));
  for (let z = 0; z < zs; z++) for (let y = 0; y < h; y++) {
    const row = chan[z].subarray(y * w, y * w + w);
    if (!rle) { buf.copy(Buffer.from(row.buffer, row.byteOffset, w), 0, 512 + (z * h + y) * w, 512 + (z * h + y + 1) * w); continue; }
    let p = buf.readUInt32BE(512 + (z * h + y) * 4), x = 0;
    for (;;) {
      const c = buf[p++], n = c & 0x7f;
      if (!n) break;
      if (c & 0x80) { for (let i = 0; i < n; i++) row[x++] = buf[p++]; } else { const v = buf[p++]; for (let i = 0; i < n; i++) row[x++] = v; }
    }
  }
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * w + x, d = ((h - 1 - y) * w + x) * 4; // SGI rows run bottom to top
    const g = chan[0][s];
    data[d] = g; data[d + 1] = zs >= 3 ? chan[1][s] : g; data[d + 2] = zs >= 3 ? chan[2][s] : g;
    data[d + 3] = zs === 4 ? chan[3][s] : zs === 2 ? chan[1][s] : 255;
  }
  return { width: w, height: h, data };
}

const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const root = process.argv[2];
if (!root) { console.error('usage: node scripts/rgb-to-png.js <asset folder>'); process.exit(1); }
const files = walk(root);
let n = 0;
for (const f of files.filter(p => /\.(rgb|rgba|sgi)$/i.test(p))) {
  try { writeFileSync(f.slice(0, -extname(f).length) + '.png', writePNG(decode(readFileSync(f)))); unlinkSync(f); n++; } catch (e) { console.log(`${f}: ${e.message}`); }
}
let refs = 0;
for (const f of files.filter(p => /\.ac$/i.test(p))) {
  const s = readFileSync(f, 'latin1'), t = s.replace(/^(texture "[^"]+)\.(rgb|rgba|sgi)"/gim, (_, a) => { refs++; return `${a}.png"`; });
  if (t !== s) writeFileSync(f, t, 'latin1');
}
console.log(`${n} textures converted, ${refs} references updated`);
