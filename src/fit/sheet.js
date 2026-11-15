// Find the three views on a drawing sheet and turn them into a silhouette target
// (src/fit/views.js), with nothing marked by hand: no boxes, no ground row, no
// orientation. Only the aircraft's published length and span are given, for scale.
//
// A view is a blob of ink and what it encloses. Which view it is follows from its
// symmetry: the top and front views mirror about their centerline, the side view does
// not. The top view is as long as the side view; the front view is as tall as it.
import { Mask, blank } from './views.js';

/** Everything the page's border cannot reach without crossing ink: the drawn outlines and what they enclose. */
function solidOf(img) {
  const { width: w, height: h, data } = img;
  const ink = new Uint8Array(w * h);
  // Ink is dark and opaque. A page may be white or transparent.
  for (let k = 0; k < w * h; k++) ink[k] = data[k * 4 + 3] > 100 && data[k * 4] + data[k * 4 + 1] + data[k * 4 + 2] < 450 ? 1 : 0;
  const clean = unframe(unrule(ink, w, h), w, h);
  let ruled = false;
  for (let k = 0; k < w * h && !ruled; k++) ruled = ink[k] !== clean[k];
  return { solid: enclosed(clean, w, h), ruled, ink: clean };
}

/** Grow (or shrink) a bitmap by r pixels, as a square. */
function grow(src, w, h, r, on = 1) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1 - on;
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k] === on) { v = on; break; }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 1 - on;
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] === on) { v = on; break; }
    out[y * w + x] = v;
  }
  return out;
}

/**
 * What the outlines enclose. Outlines leak: a pen lifts, and a wheel standing on a ground
 * line loses its lowest pixels with the line. The ink is thickened for the fill and the
 * result thinned by the same, which closes gaps and leaves every edge where it was.
 * Two passes: a fine one (2 px) keeps wheels and legs apart, a coarse one (scaled to the
 * image) closes the wider gaps a large sheet leaves in a long outline. Only large regions
 * the coarse pass adds are kept: a hollow fuselage, never the gap between two wheels.
 */
function enclosed(ink, w, h) {
  const fine = fillAt(ink, w, h, 2);
  const R = Math.max(2, Math.round(Math.max(w, h) / 500));
  if (R <= 2) return fine;
  const coarse = fillAt(ink, w, h, R);
  const extra = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) extra[k] = coarse[k] && !fine[k] ? 1 : 0;
  const { label, list } = blobs(extra, w, h);
  const keep = new Set(list.filter(q => q.area > w * h * 0.0005).map(q => q.id));
  for (let k = 0; k < w * h; k++) if (keep.has(label[k])) fine[k] = 1;
  return fine;
}

function fillAt(ink, w, h, r) {
  const thick = grow(ink, w, h, r);
  const solid = new Uint8Array(w * h).fill(1), stack = [];
  const seed = k => { if (!thick[k] && solid[k]) { solid[k] = 0; stack.push(k); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const k = stack.pop(), x = k % w;
    if (x > 0) seed(k - 1); if (x < w - 1) seed(k + 1);
    if (k >= w) seed(k - w); if (k < w * (h - 1)) seed(k + w);
  }
  const thin = grow(solid, w, h, r, 0);
  for (let k = 0; k < w * h; k++) if (ink[k]) thin[k] = 1;
  return thin;
}

/**
 * Take ruled lines off the page before anything is filled: a ground line under two views
 * joins them into one blob, and closes off the space under the belly between the legs.
 * A ruled line runs across most of the page, the same few pixels thick nearly all the
 * way. The straight side of a fuselage is drawn the same way, but is never that long.
 */
function unrule(solid, w, h) {
  const out = solid.slice();
  const pass = (n, len, at) => {
    // n lines of len pixels; at(line, i) is the pixel index.
    for (let line = 0; line < n; line++) {
      let a = -1;
      for (let i = 0; i <= len; i++) {
        const on = i < len && solid[at(line, i)];
        if (on && a < 0) a = i;
        if (on || a < 0) continue;
        const b = i - 1, runLen = b - a + 1;
        if (runLen >= len * 0.6) {
          // Thickness across the run at each pixel.
          const th = [];
          for (let q = a; q <= b; q++) {
            let lo = line, hi = line;
            while (lo > 0 && solid[at(lo - 1, q)]) lo--;
            while (hi < n - 1 && solid[at(hi + 1, q)]) hi++;
            th.push(hi - lo + 1);
          }
          const sorted = [...th].sort((p, q) => p - q), typical = sorted[Math.floor(sorted.length / 2)];
          const same = th.filter(v => Math.abs(v - typical) <= 1).length;
          if (typical <= 4 && same >= th.length * 0.85) for (let q = a; q <= b; q++) if (Math.abs(th[q - a] - typical) <= 1) out[at(line, q)] = 0;
        }
        a = -1;
      }
    }
  };
  pass(h, w, (y, x) => y * w + x);
  pass(w, h, (x, y) => y * w + x);
  return out;
}

/** Connected blobs (touching sides or corners) with their bounding boxes. */
/** Drop a drawn page frame (and the title block joined to it): ink spanning most of the page both ways is never a view. */
function unframe(ink, w, h) {
  const { label, list } = blobs(ink, w, h);
  const frame = new Set(list.filter(b => b.x1 - b.x0 > w * 0.8 && b.y1 - b.y0 > h * 0.8).map(b => b.id));
  if (!frame.size) return ink;
  const out = ink.slice();
  for (let k = 0; k < w * h; k++) if (frame.has(label[k])) out[k] = 0;
  return out;
}

function blobs(solid, w, h) {
  const label = new Int32Array(w * h), out = [];
  for (let k0 = 0; k0 < w * h; k0++) {
    if (!solid[k0] || label[k0]) continue;
    const id = out.length + 1, b = { id, x0: w, x1: 0, y0: h, y1: 0, area: 0 };
    const stack = [k0]; label[k0] = id;
    while (stack.length) {
      const k = stack.pop(), x = k % w, y = (k - x) / w;
      b.area++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (solid[q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    out.push(b);
  }
  return { label, list: out };
}

/** A blob (and any merged into it) cut out as its own bitmap, rows running down as in the image. */
function cut(label, w, b) {
  const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1, data = new Uint8Array(W * H);
  const ids = new Set(b.ids ?? [b.id]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ids.has(label[(b.y0 + y) * w + b.x0 + x])) data[y * W + x] = 1;
  return { w: W, h: H, data };
}

const flipX = m => { const d = new Uint8Array(m.w * m.h); for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) d[y * m.w + x] = m.data[y * m.w + m.w - 1 - x]; return { w: m.w, h: m.h, data: d }; };
const flipY = m => { const d = new Uint8Array(m.w * m.h); for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) d[y * m.w + x] = m.data[(m.h - 1 - y) * m.w + x]; return { w: m.w, h: m.h, data: d }; };
/** Quarter turn: what was the left edge becomes the top. */
const turn = m => { const d = new Uint8Array(m.w * m.h); for (let y = 0; y < m.w; y++) for (let x = 0; x < m.h; x++) d[y * m.h + x] = m.data[(m.h - 1 - x) * m.w + y]; return { w: m.h, h: m.w, data: d }; };
const overlap = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.data.length; k++) { i += a.data[k] & b.data[k]; u += a.data[k] | b.data[k]; } return i / (u || 1); };

/** Solid extent of a row or a column of a bitmap. */
const colExtent = (m, x) => { let a = -1, b = -1; for (let y = 0; y < m.h; y++) if (m.data[y * m.w + x]) { if (a < 0) a = y; b = y; } return a < 0 ? 0 : b - a + 1; };

/**
 * @param {{ width: number, height: number, data: Uint8Array }} img RGBA pixels
 * @param {{ length: number, span?: number, ppm?: number }} dims published size in meters
 * @returns {object} a target for src/fit/fit.js, with `found` describing what was detected
 */
export function targetFromSheet(img, { length, span, ppm = 40 }) {
  const { width: w, height: h } = img;
  const { solid, ruled, ink } = solidOf(img);
  const { label, list } = blobs(solid, w, h);
  const size = b => Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1;
  const biggest = Math.max(...list.map(size));
  const big = list.filter(b => size(b) > biggest * 0.35 && b.area > 400);
  const small = list.filter(b => !big.includes(b) && b.area > 12);
  if (big.length < 2) throw new Error(`found ${big.length} view(s) on the sheet, need at least a side and a top view`);

  // Symmetry: about a horizontal line (a top view with the nose to one side, a front
  // view lying on its side) or about a vertical line (an upright front view).
  for (const b of big) {
    b.bits = cut(label, w, b);
    b.symH = overlap(b.bits, flipY(b.bits));
    b.symV = overlap(b.bits, flipX(b.bits));
    b.sym = Math.max(b.symH, b.symV);
  }
  // The side view is the one that mirrors least. Of the rest, the top view runs as long
  // along its centerline as the side view is long; the front view only as tall as it.
  const side = big.reduce((a, b) => (b.sym < a.sym ? b : a));
  const sideW = side.x1 - side.x0 + 1, sideH = side.y1 - side.y0 + 1;
  const along = b => (b.symH >= b.symV ? b.x1 - b.x0 + 1 : b.y1 - b.y0 + 1);
  const rest = big.filter(b => b !== side && b.sym > 0.8);
  const top = rest.reduce((a, b) => (!a || Math.abs(along(b) / sideW - 1) < Math.abs(along(a) / sideW - 1) ? b : a), null);
  if (!top || Math.abs(along(top) / sideW - 1) > 0.2) throw new Error('no top view found next to the side view');
  const front = rest.filter(b => b !== top).reduce((a, b) => (!a || Math.abs(along(b) / sideH - 1) < Math.abs(along(a) / sideH - 1) ? b : a), null);

  // Side view: nose to the left, which puts the fin (the tallest point) in the right half.
  let s = side.bits, sideFlipped = false;
  const peak = (() => { for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) return x; return 0; })();
  if (peak < s.w / 2) { s = flipX(s); sideFlipped = true; }
  // Wheels are sometimes drawn clear of the body, on a ground line of their own. Small
  // blobs just under the side view then belong to it. A side view that stands on its own
  // legs touches its lowest rows in narrow places only; one without legs rests on a long
  // stretch of belly, and only then are the blobs under it taken as wheels (and not as a caption).
  let widest = 0, run = 0;
  for (let x = 0; x < s.w; x++) {
    let hit = false;
    for (let y = s.h - 1; y >= s.h * 0.96 && !hit; y--) hit = s.data[y * s.w + x] === 1;
    run = hit ? run + 1 : 0;
    if (run > widest) widest = run;
  }
  // On a sheet with a ruled ground line the aircraft stands on that line, legs and all.
  const under = ruled || widest < s.w * 0.08 ? [] : small.filter(b => b.x0 >= side.x0 && b.x1 <= side.x1 && b.y0 > side.y1 - sideH * 0.1 && b.y1 < side.y1 + sideH * 0.25 && (top === null || b.y1 < top.y0 || top.x0 > side.x1 || top.x1 < side.x0 || b.y1 < top.y0 + (top.y1 - top.y0) * 0.5));
  if (under.length) {
    const m = { ...side, ids: [side.id, ...under.map(b => b.id)], y1: Math.max(side.y1, ...under.map(b => b.y1)) };
    s = cut(label, w, m);
    if (sideFlipped) s = flipX(s);
  }

  // Top view: centerline horizontal, nose to the left. The tail end is the wider one
  // just inside the tip (the tailplane), the nose comes to a point.
  let t = top.bits, topTurned = false;
  if (top.symV > top.symH) { t = turn(t); topTurned = true; }
  const wNose = colExtent(t, Math.round(t.w * 0.06)), wTail = colExtent(t, Math.round(t.w * 0.94));
  const topFlipped = wNose > wTail;
  if (topFlipped) t = flipX(t);

  // Front view: upright, which puts more of it above the wing than below (the fin).
  let f = front?.bits ?? null, frontTurned = false;
  if (f) {
    if (front.symH > front.symV) { f = turn(f); frontTurned = true; }
    // Up is where the fin is: rows that hold one narrow run on the centerline. The other
    // end has legs (several runs) or the belly (a wide one).
    const finRows = (y0, y1) => {
      let n = 0;
      for (let y = y0; y < y1; y++) {
        let runs = 0, a = -1, b = -1;
        for (let x = 0; x <= f.w; x++) { const on = x < f.w && f.data[y * f.w + x]; if (on && (x === 0 || !f.data[y * f.w + x - 1])) { runs++; a = x; } if (on) b = x; }
        if (runs === 1 && b - a < f.w * 0.06 && Math.abs((a + b) / 2 - f.w / 2) < f.w * 0.03) n++;
      }
      return n;
    };
    if (finRows(Math.floor(f.h * 0.6), f.h) > finRows(0, Math.ceil(f.h * 0.4))) f = flipY(f);
  }

  // Scale: the side and top views by the published length, the span by the published
  // span when given (drawings are often a few percent off between views), the front
  // view by the span.
  const kx = length / s.w;
  const S = (span ?? t.h * (length / t.w)) / 2;
  const kTopX = length / t.w, kTopZ = (2 * S) / t.h;
  const kFront = f ? (2 * S) / f.w : 0;
  const H = s.h * kx;
  const frame = { L: length, H, S };
  const sample = (view, bits, toPx) => {
    const m = blank(view, frame, ppm);
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
      const [px, py] = toPx(m.U(i), m.V(j));
      const x = Math.floor(px), y = Math.floor(py);
      if (x >= 0 && y >= 0 && x < bits.w && y < bits.h && bits.data[y * bits.w + x]) m.data[j * m.w + i] = 1;
    }
    return m;
  };
  const target = {
    ...frame, ppm,
    side: sample('side', s, (x, y) => [x / kx, s.h - y / kx]),
    top: sample('top', t, (x, z) => [x / kTopX, t.h / 2 + z / kTopZ]),
    // The front view hangs from its highest point, which both views share (the fin tip): a
    // front view drawn without its legs would otherwise sit on its belly.
    front: f ? sample('front', f, (z, y) => [f.w / 2 + z / kFront, (H - y) / kFront]) : null,
    // What is drawn inside the side view: windows, doors, cockpit panes.
    inner: innerShapes(ink, label, w, side, sideFlipped, s.w, kx),
    found: {
      side: { box: [side.x0, side.y0, side.x1, side.y1], mirrored: sideFlipped, wheelBlobs: under.length },
      top: { box: [top.x0, top.y0, top.x1, top.y1], turned: topTurned, mirrored: topFlipped, symmetry: Math.round(top.sym * 100) / 100 },
      front: front ? { box: [front.x0, front.y0, front.x1, front.y1], turned: frontTurned, symmetry: Math.round(front.sym * 100) / 100 } : null,
      heightMeasured: Math.round(s.h * kx * 100) / 100,
      spanMeasured: Math.round(t.h * kTopX * 100) / 100,
    },
  };
  return target;
}

/**
 * Closed shapes drawn inside the side view (each an area the ink encloses), in meters:
 * x from the nose, y up from the ground. Small ones keep their outline points.
 */
function innerShapes(ink, label, w, side, mirrored, sw, k) {
  const W = side.x1 - side.x0 + 1, H = side.y1 - side.y0 + 1;
  const seen = new Uint8Array(W * H), out = [];
  const free = (x, y) => !seen[y * W + x] && !ink[(side.y0 + y) * w + side.x0 + x] && label[(side.y0 + y) * w + side.x0 + x] === side.id;
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (!free(x0, y0)) continue;
    const stack = [[x0, y0]]; seen[y0 * W + x0] = 1;
    let n = 0, ax = W, bx = 0, ay = H, by = 0;
    const pts = [];
    while (stack.length) {
      const [x, y] = stack.pop();
      n++; if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y;
      if (pts.length < 4000) pts.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && free(nx, ny)) { seen[ny * W + nx] = 1; stack.push([nx, ny]); }
      }
    }
    if (n < 6) continue;
    const X = px => (mirrored ? sw - px - 0.5 : px + 0.5) * k, Y = py => (H - py - 0.5) * k;
    const shape = { x: (X(ax) + X(bx)) / 2, y: (Y(ay) + Y(by)) / 2, w: (bx - ax + 1) * k, h: (by - ay + 1) * k, area: n * k * k, line: k };
    if (shape.area < 4) shape.points = pts.map(([px, py]) => [X(px), Y(py)]);
    out.push(shape);
  }
  return out;
}
