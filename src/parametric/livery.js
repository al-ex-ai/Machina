// Paints a fuselage livery onto a canvas laid out in the body's own UV space
// (u = x / length, v = angle / 2PI), so windows, doors and stripes land at their
// measured positions. Browser only: returns null in Node.
import * as THREE from 'three';

const W = 4096, H = 1024;

// Text is laid out at 100 px and scaled to its size in meters: canvas fonts below a
// pixel are not reliable.
const FONT = '"Segoe UI", system-ui, sans-serif';
function text(g, str, height, spacing, align = 'left') {
  g.save();
  g.scale(height / 100, height / 100);
  g.font = `800 100px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${spacing * 100}px`;
  const w = g.measureText(str).width;
  g.fillText(str, 0, 4);
  g.restore();
  return (w * height) / 100;
}

/** The Machina mark (the arrowhead from the app logo) and wordmark, centered on the origin, in meters. */
function drawTitle(g, t) {
  const h = t.height;
  g.save();
  g.font = `800 100px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = '18px';
  const total = h * 1.35 + (g.measureText(t.text).width * h) / 100;
  g.restore();
  g.translate(-total / 2, 0);
  g.fillStyle = t.markColor ?? t.color;
  g.beginPath();
  for (const [x, y] of [[0, 0.6], [1, 0], [0.65, 1], [0.5, 0.7]]) g.lineTo(x * h, (y - 0.5) * h);
  g.closePath();
  g.fill();
  g.fillStyle = t.color;
  g.translate(h * 1.35, 0);
  text(g, t.text, h, 0.18);
}

/**
 * Paint a vertical tail: base color, a stripe parallel to the leading edge and a
 * title. The canvas holds the left face in its left half and the right face,
 * mirrored so text reads correctly, in its right half (see sideUV).
 */
export function paintFin(bounds, spec) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 4096; c.height = 1024;
  const g = c.getContext('2d');
  const { x0, x1, y0, y1 } = bounds;
  const sx = 2048 / (x1 - x0), sy = 1024 / (y1 - y0);
  for (const half of [0, 1]) {
    g.save();
    if (half === 0) { g.translate(-x0 * sx, y1 * sy); g.scale(sx, -sy); }
    else { g.translate(2048 + x1 * sx, y1 * sy); g.scale(-sx, -sy); }
    g.fillStyle = spec.base;
    g.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    if (spec.stripe) {
      const [[ax, ay], [bx, by]] = spec.stripe.edge;
      const o = spec.stripe.offset, w = spec.stripe.width;
      g.fillStyle = spec.stripe.color;
      g.beginPath();
      g.moveTo(ax + o, ay); g.lineTo(bx + o, by); g.lineTo(bx + o + w, by); g.lineTo(ax + o + w, ay);
      g.closePath();
      g.fill();
    }
    if (spec.title) {
      const t = spec.title;
      g.save();
      g.translate(t.x, t.y);
      g.scale(1, -1);
      if (half === 1) g.scale(-1, 1);
      g.fillStyle = t.color;
      text(g, t.text, t.height, 0.12, 'center');
      g.restore();
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Planar UVs for a vertical surface: faces on the left (+z) map to the left half of
 * the texture, faces on the right to the right half, mirrored.
 */
export function sideUV(geo0, bounds) {
  const geo = geo0.index ? geo0.toNonIndexed() : geo0;
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const { x0, x1, y0, y1 } = bounds;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    const nz = b.clone().sub(a).cross(c.clone().sub(a)).z;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k);
      const fu = (x - x0) / (x1 - x0);
      uv[(i + k) * 2] = nz >= 0 ? fu / 2 : 0.5 + (1 - fu) / 2;
      uv[(i + k) * 2 + 1] = (y1 - y) / (y1 - y0);
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * @param {ReturnType<import('./body.js').bodyProfile>} body
 * @param {number} length
 * @param {any} lv livery spec from the model file
 */
export function paintFuselage(body, length, lv) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const U = x => (x / length) * W;
  const V = t => (t / (Math.PI * 2)) * H;
  const left = (x, y) => [U(x), V(body.thetaAt(x, y))];
  const right = (x, y) => [U(x), V(Math.PI * 2 - body.thetaAt(x, y))];

  g.fillStyle = lv.base;
  g.fillRect(0, 0, W, H);

  // Belly color below a line, and a stripe above it, following the body.
  const band = (yAt, color, x0 = body.x0, x1 = body.x1) => {
    g.fillStyle = color;
    g.beginPath();
    for (let x = x0; x <= x1; x += 0.05) g.lineTo(...left(x, yAt(x)));
    for (let x = x1; x >= x0; x -= 0.05) g.lineTo(...right(x, yAt(x)));
    g.closePath();
    g.fill();
  };
  const cheat = x => lv.cheatline.y + (lv.cheatline.rise ?? 0) * Math.max(0, x - (lv.cheatline.riseFrom ?? length)) ;
  band(x => cheat(x) + lv.cheatline.width, lv.stripe);
  band(cheat, lv.belly);

  // Skin panel joints: faint lines at frame stations and lap joints.
  g.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  g.lineWidth = 1.5;
  for (let x = lv.panels?.from ?? 2; x < length - 1; x += lv.panels?.pitch ?? 1.6) {
    g.beginPath(); g.moveTo(U(x), 0); g.lineTo(U(x), H); g.stroke();
  }

  // Shapes drawn on both sides from side-view coordinates (x, y).
  const quad = (pts, color, side) => {
    g.fillStyle = color;
    g.beginPath();
    for (const [x, y] of pts) g.lineTo(...side(x, y));
    g.closePath();
    g.fill();
  };
  const rect = (x, y, w, h, color, radius = 0.3) => {
    for (const side of [left, right]) {
      const [u0, v0] = side(x - w / 2, y + h / 2), [u1, v1] = side(x + w / 2, y - h / 2);
      g.fillStyle = color;
      g.beginPath();
      const r = Math.min(Math.abs(u1 - u0), Math.abs(v1 - v0)) * radius;
      g.roundRect(Math.min(u0, u1), Math.min(v0, v1), Math.abs(u1 - u0), Math.abs(v1 - v0), r);
      g.fill();
    }
  };
  const outlineRect = (x, y, w, h) => {
    for (const side of [left, right]) {
      const [u0, v0] = side(x - w / 2, y + h), [u1, v1] = side(x + w / 2, y);
      g.strokeStyle = 'rgba(20, 30, 45, 0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(Math.min(u0, u1), Math.min(v0, v1), Math.abs(u1 - u0), Math.abs(v1 - v0), 10);
      g.stroke();
    }
  };

  const win = lv.windows;
  const skip = (x, list) => list?.some(([a, b]) => x > a && x < b);
  for (let x = win.from; x <= win.to + 1e-6; x += win.pitch) {
    if (skip(x, win.skip)) continue;
    rect(x, win.y, win.w, win.h, lv.window, 0.45);
  }
  for (const d of lv.doors ?? []) {
    outlineRect(d.x, d.sill, d.w, d.h);
    if (d.window) rect(d.x, d.sill + d.h * 0.7, 0.22, 0.3, lv.window, 0.45);
  }
  // Windshield panes: points are [x, y] in side view, or [x, angle in degrees from
  // the top centerline] when a pane wraps onto the nose (the front panes meet at the
  // center post, which side-view heights cannot express).
  const leftDeg = (x, deg) => [U(x), V((deg * Math.PI) / 180)];
  const rightDeg = (x, deg) => [U(x), V(Math.PI * 2 - (deg * Math.PI) / 180)];
  for (const pane of lv.windshield ?? []) {
    const angles = pane.angles;
    const pts = angles ? pane.angles : pane;
    for (const side of angles ? [leftDeg, rightDeg] : [left, right]) quad(pts, lv.window, side);
  }

  // Titles: the Machina mark and wordmark, upright on both sides. The canvas is
  // stretched (u covers the length, v the girth), so text is drawn with matching scale.
  if (lv.titles) {
    const t = lv.titles;
    const pxPerMeterU = W / length;
    const s0 = body.at(t.x);
    const a = s0.w, b = (s0.top - s0.bot) / 2;
    const girth = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); // Ramanujan's ellipse perimeter
    const pxPerMeterV = H / girth;
    for (const [side, flip] of [[left, false], [right, true]]) {
      const [u, v] = side(t.x, t.y);
      g.save();
      g.translate(u, v);
      g.scale(pxPerMeterU, pxPerMeterV);
      if (flip) g.scale(-1, -1);
      drawTitle(g, t);
      g.restore();
    }
  }


  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}
