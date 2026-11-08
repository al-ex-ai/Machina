// Paints a fuselage livery onto a canvas laid out in the body's own UV space
// (u = x / length, v = angle / 2PI), so windows, doors and stripes land at their
// measured positions. Browser only: returns null in Node.
import * as THREE from 'three';

const W = 4096, H = 1024;

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
  for (const pane of lv.windshield ?? []) for (const side of [left, right]) quad(pane, lv.window, side);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}
