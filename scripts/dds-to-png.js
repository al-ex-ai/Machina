// Convert a DXT1 or DXT5 DDS texture to PNG, reading the first mipmap no larger than
// maxSize (default 2048, Machina's texture cap). Some FlightGear aircraft ship DDS only,
// which browsers cannot load as images.
// Usage: node scripts/dds-to-png.js <in.dds> <out.png> [maxSize]
import { readFileSync, writeFileSync } from 'node:fs';
import { writePNG } from './reference/png.js';

const [src, out, max = '2048'] = process.argv.slice(2);
const b = readFileSync(src);
if (b.toString('ascii', 0, 4) !== 'DDS ') throw new Error('not a DDS file');
let h = b.readUInt32LE(12), w = b.readUInt32LE(16);
const mips = Math.max(1, b.readUInt32LE(28)), fourcc = b.toString('ascii', 84, 88);
const block = fourcc === 'DXT1' ? 8 : fourcc === 'DXT5' ? 16 : 0;
if (!block) throw new Error(`unsupported DDS format ${fourcc}`);
let o = 128;
for (let level = 0; level < mips && Math.max(w, h) > Number(max); level++) {
  o += Math.max(1, w >> 2) * Math.max(1, h >> 2) * block;
  w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
}
const data = new Uint8Array(w * h * 4);
const rgb = c => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31];
for (let by = 0; by < Math.max(1, h >> 2); by++) for (let bx = 0; bx < Math.max(1, w >> 2); bx++) {
  let p = o + (by * Math.max(1, w >> 2) + bx) * block;
  const alpha = new Array(16).fill(255);
  if (block === 16) {
    const a0 = b[p], a1 = b[p + 1];
    const tbl = [a0, a1];
    if (a0 > a1) for (let i = 1; i < 7; i++) tbl.push(((7 - i) * a0 + i * a1) / 7);
    else { for (let i = 1; i < 5; i++) tbl.push(((5 - i) * a0 + i * a1) / 5); tbl.push(0, 255); }
    let bits = 0n;
    for (let i = 0; i < 6; i++) bits |= BigInt(b[p + 2 + i]) << BigInt(8 * i);
    for (let i = 0; i < 16; i++) alpha[i] = tbl[Number((bits >> BigInt(3 * i)) & 7n)];
    p += 8;
  }
  const c0 = b.readUInt16LE(p), c1 = b.readUInt16LE(p + 2), idx = b.readUInt32LE(p + 4);
  const A = rgb(c0), B = rgb(c1);
  const four = block === 16 || c0 > c1;
  const pal = four
    ? [A, B, A.map((v, i) => (2 * v + B[i]) / 3), A.map((v, i) => (v + 2 * B[i]) / 3)]
    : [A, B, A.map((v, i) => (v + B[i]) / 2), [0, 0, 0]];
  for (let i = 0; i < 16; i++) {
    const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
    if (x >= w || y >= h) continue;
    const k = (idx >> (2 * i)) & 3, q = (y * w + x) * 4;
    data[q] = pal[k][0]; data[q + 1] = pal[k][1]; data[q + 2] = pal[k][2];
    data[q + 3] = !four && k === 3 ? 0 : alpha[i];
  }
}
writeFileSync(out, writePNG({ width: w, height: h, data }));
console.log(`${out}: ${w} x ${h} from ${fourcc}`);
