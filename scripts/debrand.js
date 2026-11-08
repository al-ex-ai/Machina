// Paint airline titles, registrations and flags out of a texture, so a model can wear a
// neutral livery. Each box is filled per row by blending between the paint just left
// and right of the marks ("text"), or only reddish pixels are replaced ("red", for flags
// next to other markings). Usage: node scripts/debrand.js <in.png> <out.png> '<json boxes>'
// boxes: [[x0, y0, x1, y1, "text" | "red"], ...] in texture pixels.
import { readFileSync, writeFileSync } from 'node:fs';
import { readPNG, writePNG } from './reference/png.js';

const [src, out, json] = process.argv.slice(2);
const img = readPNG(readFileSync(src));
const { width: W, data: D } = img;
const px = (x, y) => (y * W + x) * 4;
const dist = (a, b) => Math.abs(D[a] - D[b]) + Math.abs(D[a + 1] - D[b + 1]) + Math.abs(D[a + 2] - D[b + 2]);
// "slant": [xa, ya, xb, yb, half, "slant"] removes dark lettering in a band of half-width
// half around the line from (xa, ya) to (xb, yb), for text set at an angle.
for (const box of JSON.parse(json)) {
  if (box[5] === 'slant') {
    const [xa, ya, xb, yb, half] = box;
    for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++) {
      const c = xa + ((xb - xa) * (y - ya)) / (yb - ya);
      const lo = Math.round(c - half), hi = Math.round(c + half);
      const dark = x => { const p = px(x, y); return D[p] * 0.3 + D[p + 1] * 0.59 + D[p + 2] * 0.11 < 110; };
      const hit = new Uint8Array(hi - lo + 1);
      for (let x = lo; x <= hi; x++) if (dark(x)) for (let d = -2; d <= 2; d++) { const k = x - lo + d; if (k >= 0 && k < hit.length) hit[k] = 1; }
      let x = lo;
      while (x <= hi) {
        if (!hit[x - lo]) { x++; continue; }
        let e = x; while (e <= hi && hit[e - lo]) e++;
        const a = px(x - 1, y), b = px(e, y);
        for (let k = x; k < e; k++) { const t = (k - x + 1) / (e - x + 1), p = px(k, y); for (let ch = 0; ch < 3; ch++) D[p + ch] = Math.round(D[a + ch] * (1 - t) + D[b + ch] * t); }
        x = e;
      }
    }
    continue;
  }
  const [x0, y0, x1, y1, mode = 'text'] = box;
  for (let y = y0; y <= y1; y++) {
    const L = px(x0 - 1, y), R = px(x1 + 1, y);
    // Pixels to replace: reddish ones, or anything unlike the paint at both box edges.
    // "red": warm pixels (red, and the yellow of an emblem on it), grown by 3 px to take
    // the soft edges too.
    const warm = x => { const p = px(x, y); if (mode === 'sat') { const mx = Math.max(D[p], D[p + 1], D[p + 2]), mn = Math.min(D[p], D[p + 1], D[p + 2]); return mx - mn > 30; } return D[p] - D[p + 2] > 35 && D[p] > 120; }; // 'sat': any colored pixel, grays kept
    const hit = new Uint8Array(x1 - x0 + 1);
    if (mode === 'red' || mode === 'sat') for (let x = x0; x <= x1; x++) if (warm(x)) for (let d = -3; d <= 3; d++) { const k = x - x0 + d; if (k >= 0 && k < hit.length) hit[k] = 1; }
    const bad = x => {
      const p = px(x, y);
      return mode === 'red' || mode === 'sat' ? hit[x - x0] === 1 : dist(p, L) > 40 && dist(p, R) > 40;
    };
    let x = x0;
    while (x <= x1) {
      if (!bad(x)) { x++; continue; }
      let e = x; while (e <= x1 && bad(e)) e++;
      const a = px(x - 1, y), b = px(Math.min(e, W - 1), y);
      for (let k = x; k < e; k++) {
        const t = (k - x + 1) / (e - x + 1), p = px(k, y);
        for (let c = 0; c < 3; c++) D[p + c] = Math.round(D[a + c] * (1 - t) + D[b + c] * t);
      }
      x = e;
    }
  }
}
writeFileSync(out, writePNG(img));
console.log(`${out}: cleaned`);
