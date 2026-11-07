// Procedural fuselage paint: cabin windows, doors, windshield, cheatline and belly.
// Drawn on a canvas in meters, then mapped with cylindrical UVs (see cylindricalUV).
// Browser only: returns null in Node so builders stay testable.
import * as THREE from 'three';

const DEFAULT = { base: '#f4f5f7', belly: '#c9ced6', stripe: '#24508f', window: '#1f2a36' };

/**
 * Assign UVs from position: u runs nose to tail (x / length), v runs around the body
 * with v = 0.5 on top, 0.75 on the left (+z) side and 0.25 on the right (-z) side.
 */
export function cylindricalUV(geo0, length) {
  // Smooth normals first, then split triangles so faces crossing the seam
  // under the belly can wrap their v instead of smearing across the texture.
  geo0.computeVertexNormals();
  const geo = geo0.toNonIndexed();
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / length;
    uv[i * 2 + 1] = (Math.atan2(pos.getZ(i), pos.getY(i)) + Math.PI) / (Math.PI * 2);
  }
  for (let t = 0; t < pos.count; t += 3) {
    const vs = [uv[t * 2 + 1], uv[t * 2 + 3], uv[t * 2 + 5]];
    if (Math.max(...vs) - Math.min(...vs) > 0.5) {
      for (let k = 0; k < 3; k++) if (vs[k] < 0.5) uv[(t + k) * 2 + 1] += 1;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * @param {{ length: number, diameter: number, height?: number, noseLength?: number, tailLength?: number }} f
 * @param {{ doors?: number[], overwingExits?: number[], windowsFrom?: number, windowsTo?: number, decks?: number }} cabin
 * @param {Record<string, string>} colors
 */
export function fuselageTexture(f, cabin = {}, colors = {}) {
  if (typeof document === 'undefined') return null;
  const c = { ...DEFAULT, ...colors };
  const L = f.length;
  const R = f.diameter / 2;
  const circ = Math.PI * (R + (f.height ?? f.diameter) / 2); // ellipse perimeter, close enough
  const pxPerM = Math.min(4096 / L, 96);
  const W = Math.round(L * pxPerM);
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');

  const X = m => m * pxPerM; // meters along the body -> px
  const Vm = m => (m / circ) * H; // meters around the body -> px
  // v for a point at height y (fraction of radius) on the left or right side
  const vAt = (yFrac, side) => {
    const ang = Math.atan2(side * Math.sqrt(Math.max(0, 1 - yFrac * yFrac)), yFrac);
    return ((ang + Math.PI) / (Math.PI * 2)) * H;
  };

  g.fillStyle = c.base;
  g.fillRect(0, 0, W, H);

  // Belly: bottom of the body sits at the v seam (top and bottom rows of the canvas).
  const belly = vAt(-0.35, 1);
  g.fillStyle = c.belly;
  g.fillRect(0, belly, W, H - belly);
  g.fillRect(0, 0, W, H - belly);

  const nose = f.noseLength ?? f.diameter * 1.6;
  const tail = f.tailLength ?? f.diameter * 2.6;
  const from = cabin.windowsFrom ?? nose + 1.6;
  const to = cabin.windowsTo ?? L - tail + 1.2;
  const decks = cabin.decks ?? 1;

  for (const side of [1, -1]) {
    // Cheatline below the windows
    const sv = vAt(-0.05, side);
    g.fillStyle = c.stripe;
    g.fillRect(X(nose * 0.6), sv - Vm(0.12), X(L - nose * 0.6 - tail * 0.4), Vm(0.24));

    // Window rows
    g.fillStyle = c.window;
    const rows = decks === 2 ? [0.12, 0.62] : [0.2];
    for (const yf of rows) {
      const wv = vAt(yf, side);
      const wh = Vm(0.32);
      for (let x = from; x < to; x += 0.53) {
        roundRect(g, X(x), wv - wh / 2, X(0.24), wh, X(0.08));
      }
    }

    // Door outlines
    g.strokeStyle = 'rgba(40,50,60,0.55)';
    g.lineWidth = Math.max(1.5, X(0.025));
    const doorTop = vAt(0.55, side);
    const doorBottom = vAt(-0.4, side);
    for (const dx of cabin.doors ?? [nose + 0.9, L - tail + 0.4]) {
      g.strokeRect(X(dx), Math.min(doorTop, doorBottom), X(0.85), Math.abs(doorBottom - doorTop));
    }
    for (const dx of cabin.overwingExits ?? []) {
      g.strokeRect(X(dx), Math.min(vAt(0.42, side), vAt(-0.05, side)), X(0.5), Math.abs(vAt(-0.05, side) - vAt(0.42, side)));
    }

    // Flight deck windshield: four panes per side, wrapping toward the top.
    g.fillStyle = c.window;
    const wx = nose * 0.5;
    for (let i = 0; i < 4; i++) {
      const v0 = vAt(0.95 - i * 0.12, side);
      const v1 = vAt(0.95 - (i + 1) * 0.12 + 0.02, side);
      g.beginPath();
      g.moveTo(X(wx + i * 0.18), v0);
      g.lineTo(X(wx + 0.55 + i * 0.22), v0);
      g.lineTo(X(wx + 0.6 + (i + 1) * 0.22), v1);
      g.lineTo(X(wx + (i + 1) * 0.18), v1);
      g.closePath();
      g.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}
