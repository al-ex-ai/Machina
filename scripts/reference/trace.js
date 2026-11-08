// Turn a line drawing into measurements. Works on one rectangular view of a
// reference image at a time:
//   - ink: dark, opaque pixels (the drawn lines)
//   - outside: background reachable from the view's border without crossing ink
//   - silhouette: everything that is not outside (lines plus enclosed areas)
//   - holes: enclosed non-ink regions (windows, doors, panes, and the big panel areas)

export function viewOf(img, box) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      const d = img.data;
      ink[y * w + x] = d[i + 3] > 100 && d[i] + d[i + 1] + d[i + 2] < 450 ? 1 : 0;
    }
  }
  const outside = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => { const k = y * w + x; if (!ink[k] && !outside[k]) { outside[k] = 1; stack.push(k); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k - x) / w;
    if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
  }
  const solid = k => !outside[k];
  return {
    w, h, ink, outside, x0, y0,
    solid: (x, y) => x >= 0 && y >= 0 && x < w && y < h && solid(y * w + x),
    /** Extents of the silhouette. */
    bounds() {
      let minX = w, maxX = -1, minY = h, maxY = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(y * w + x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return { minX, maxX, minY, maxY };
    },
    /** In column x, the solid run that contains row y: [top, bottom], or null. */
    runV(x, y) {
      if (!this.solid(x, y)) return null;
      let a = y, b = y;
      while (this.solid(x, a - 1)) a--;
      while (this.solid(x, b + 1)) b++;
      return [a, b];
    },
    /** In row y, the solid run that contains column x: [left, right], or null. */
    runH(x, y) {
      if (!this.solid(x, y)) return null;
      let a = x, b = x;
      while (this.solid(a - 1, y)) a--;
      while (this.solid(b + 1, y)) b++;
      return [a, b];
    },
    /** Enclosed non-ink regions with their pixel lists summarized. */
    holes(minArea = 4) {
      const seen = new Uint8Array(w * h);
      const out = [];
      for (let k0 = 0; k0 < w * h; k0++) {
        if (seen[k0] || ink[k0] || outside[k0]) continue;
        const st = [k0]; seen[k0] = 1;
        let n = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
        const pts = [];
        while (st.length) {
          const k = st.pop(), x = k % w, y = (k - x) / w;
          n++; sx += x; sy += y; pts.push(k);
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          for (const q of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
            if (q >= 0 && !seen[q] && !ink[q] && !outside[q]) { seen[q] = 1; st.push(q); }
          }
        }
        if (n >= minArea) out.push({ area: n, cx: sx / n, cy: sy / n, minX, maxX, minY, maxY, pts });
      }
      return out;
    },
  };
}

/** Convex hull (monotone chain) of [x, y] points. */
export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Reduce a convex polygon to k corners by repeatedly dropping the corner whose removal loses the least area. */
export function simplify(poly, k = 4) {
  const p = [...poly];
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (p.length > k) {
    let best = 0, loss = Infinity;
    for (let i = 0; i < p.length; i++) {
      const l = area(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]);
      if (l < loss) { loss = l; best = i; }
    }
    p.splice(best, 1);
  }
  return p;
}
