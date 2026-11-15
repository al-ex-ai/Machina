// What a drawing shows inside the side view's outline: cabin windows, doors and the
// cockpit panes. Each is a closed shape (src/fit/sheet.js innerShapes) and is told
// apart by size and place alone, so every aircraft gets its own, read from its drawing.
import { bodyProfile } from '../parametric/body.js';

const r2 = v => Math.round(v * 100) / 100;
const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Convex hull (monotone chain) of [x, y] points. */
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Reduce a convex polygon to k corners, dropping the corner whose removal loses the least area each time. */
function corners(poly, k = 4) {
  const p = [...poly];
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (p.length > k) {
    let best = 0, loss = Infinity;
    for (let i = 0; i < p.length; i++) { const l = area(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]); if (l < loss) { loss = l; best = i; } }
    p.splice(best, 1);
  }
  return p;
}

/**
 * @param {object[]} shapes closed shapes inside the side view, in meters
 * @param {number} L overall length
 * @returns {{ windows: { list: number[][], w: number, h: number } | null, doors: object[], panes: number[][][] }}
 */
export function readDetails(shapes, L) {
  // A shape is measured inside its drawn line: the opening reaches about a line width further out.
  const grow = s => ({ ...s, w: s.w + s.line * 2, h: s.h + s.line * 2 });
  const all = shapes.map(grow);

  // Cabin windows: many small shapes of one size on one line. The line is the height
  // most of the small shapes share.
  const small = all.filter(s => s.w > 0.12 && s.w < 0.6 && s.h > 0.18 && s.h < 0.7 && s.x > L * 0.1 && s.x < L * 0.9);
  let windows = null, winY = null;
  if (small.length >= 6) {
    const bins = new Map();
    for (const s of small) { const k = Math.round(s.y / 0.1); bins.set(k, (bins.get(k) ?? 0) + 1); }
    let bk = 0, bc = 0;
    for (const [k, c] of bins) { const c3 = c + (bins.get(k - 1) ?? 0) + (bins.get(k + 1) ?? 0); if (c3 > bc) { bc = c3; bk = k; } }
    const row0 = small.filter(s => Math.abs(s.y - bk * 0.1) < 0.2);
    const hh = median(row0.map(s => s.h)), ww = median(row0.map(s => s.w));
    const row = row0.filter(s => Math.abs(s.h - hh) < hh * 0.35 && Math.abs(s.w - ww) < ww * 0.5).sort((a, b) => a.x - b.x);
    if (row.length >= 6) {
      winY = median(row.map(s => s.y));
      // Windows sit on one line at one pitch (a frame bay): each is put on the line, and on
      // the pitch counted from its neighbor where it is within a few centimeters of it.
      const gaps = row.slice(1).map((s, i) => s.x - row[i].x), pitch = median(gaps);
      const xs = [row[0].x];
      for (let i = 1; i < row.length; i++) { const n = Math.round((row[i].x - xs[i - 1]) / pitch); xs.push(n >= 1 && Math.abs(row[i].x - xs[i - 1] - n * pitch) < 0.08 ? xs[i - 1] + n * pitch : row[i].x); }
      windows = { list: xs.map(x => [r2(x), r2(winY)]), w: r2(ww), h: r2(hh) };
    }
  }

  // Doors: shapes about a person tall that span the window line. A door is often drawn as
  // several nested or split shapes; overlapping ones are one door, the largest wins.
  const doors = [];
  if (winY !== null) {
    const tall = all.filter(s => s.h > 1.3 && s.h < 2.3 && s.w > 0.45 && s.w < 1.4 && s.y - s.h / 2 < winY && s.y + s.h / 2 > winY - 0.2).sort((a, b) => b.area - a.area);
    // Emergency exits over the wing are smaller: a meter tall, on the window line.
    const exits = all.filter(s => s.h > 0.75 && s.h <= 1.3 && s.w > 0.35 && s.w < 0.75 && Math.abs(s.y - winY) < 0.35).sort((a, b) => b.area - a.area);
    for (const s of [...tall, ...exits]) if (!doors.some(d => Math.abs(d.x - s.x) < (d.w + s.w) / 2)) doors.push(s);
    doors.sort((a, b) => a.x - b.x);
  }

  // Cockpit panes: shapes in the nose, at window height or above, ahead of the first door and window.
  const firstX = Math.min(L * 0.14, windows ? windows.list[0][0] - 0.3 : Infinity, doors.length ? doors[0].x - doors[0].w / 2 : Infinity);
  const panes = winY === null ? [] : all
    .filter(s => s.points && s.x < firstX && s.x > L * 0.01 && s.y > winY - 0.35 && s.area > 0.04 && s.area < 1.6 && s.w > 0.15 && s.h > 0.15)
    .sort((a, b) => a.x - b.x)
    .map(s => corners(hull(s.points), 4));

  return {
    windows,
    doors: doors.map(d => ({ x: r2(d.x), sill: r2(d.y - d.h / 2), w: r2(d.w), h: r2(d.h), window: true })),
    panes,
  };
}

/** Put the drawing's own windows, doors and cockpit panes on a fitted model, where the drawing has them. */
export function applyDetails(model, d) {
  const lv = model.livery, g = model.geometry;
  const found = [];
  if (d.windows) {
    lv.windows = d.windows;
    const y = median(d.windows.list.map(p => p[1]));
    const D = 2 * Math.max(...g.fuselage.stations.map(q => q[1]));
    // The cheatline runs under the window belt, the title above it.
    lv.cheatline = { ...lv.cheatline, y: r2(y - d.windows.h / 2 - 0.045 * D - lv.cheatline.width / 2) };
    if (lv.titles) lv.titles.y = r2(y + d.windows.h / 2 + 0.12 + lv.titles.height / 2);
    found.push(`${d.windows.list.length} windows`);
  }
  if (d.doors.length) { lv.doors = d.doors; found.push(`${d.doors.length} doors`); }
  if (d.panes.length >= 2) {
    // Each pane corner goes onto the body as [x, degrees round from the top centerline].
    const body = bodyProfile(g.fuselage.stations, g.fuselage);
    // Corners in the builder's order (front lower, rear lower, rear upper, front upper), so every pane faces out.
    lv.cockpitWindows = d.panes.filter(p => p.length === 4).map(p => {
      // A windshield has a post on the centerline: no pane comes within 9 cm of it.
      const post = x => { const q = body.at(x); return (Math.asin(Math.min(1, 0.09 / Math.max(0.1, q.w))) * 180) / Math.PI + 2; };
      const c = p.map(([x, y]) => [r2(x), r2(Math.max(post(x), (body.thetaAt(x, y) * 180) / Math.PI))]).sort((a, b) => a[0] - b[0]);
      const [f0, f1] = c.slice(0, 2).sort((a, b) => b[1] - a[1]), [r0, r1] = c.slice(2).sort((a, b) => b[1] - a[1]);
      return [f0, r0, r1, f1];
    });
    found.push(`${d.panes.length} cockpit panes`);
  }
  return found;
}
