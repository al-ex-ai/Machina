// Tracked armored vehicles: hull, tracks, running gear, turret and gun.
// Front of the hull is at x = 0; the gun points toward -x.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import { extrudeSide, extrudeTop, trackLoop, cylinderX, cylinderZ, mergeGeometries } from '../parts/shapes.js';

/** @param {any} model */
export function buildTracked(model) {
  const g = model.geometry;
  const lv = model.livery ?? {};
  const root = new THREE.Group();
  const h = g.hull;
  const tk = g.tracks;
  const W = h.width;
  const top = h.clearance + h.height;

  // Lower hull between the tracks, upper hull across the full width.
  const L = h.length;
  const glacis = h.glacisLength ?? L * 0.22;
  const lowerW = W - tk.width * 2;
  const lower = extrudeSide([
    [0.25, h.clearance + 0.25], [L * 0.1, h.clearance], [L * 0.93, h.clearance], [L, h.clearance + 0.3],
    [L, tk.height * 0.8], [0, tk.height * 0.8],
  ], lowerW);
  const upper = extrudeSide([
    [0, tk.height * 0.8], [glacis, top], [L - (h.rearSlope ?? 0.3), top], [L, top - 0.25], [L, tk.height * 0.8],
  ], W, 0.03);
  root.add(makeCompositePart([{ geometry: lower }, { geometry: upper }], {
    id: 'hull', label: 'Hull', system: 'structure',
    info: partInfo(model, 'hull', { Length: `${L} m`, Width: `${W} m`, 'Ground clearance': `${h.clearance} m` }),
  }, lv));

  // Engine deck grille at the rear
  const deck = new THREE.BoxGeometry(L * 0.28, 0.06, lowerW * 0.9);
  deck.translate(L * 0.82, top + 0.03, 0);
  root.add(makePart(deck, { id: 'engine-deck', label: 'Engine deck', system: 'propulsion', info: partInfo(model, 'engine') }, lv));

  // Tracks, running gear and side skirts, per side
  for (const [sign, side, label] of [[1, 'left', 'Left'], [-1, 'right', 'Right']]) {
    const z = sign * (W / 2 - tk.width / 2);
    const loop = trackLoop(tk.length, tk.height, tk.width, 0.09);
    loop.translate(tk.x, 0, z);
    root.add(makePart(loop, { id: `${side}-track`, label: `${label} track`, system: 'mobility', info: partInfo(model, 'tracks', { Width: `${tk.width} m` }) }, lv));

    const wheels = [];
    const rw = tk.wheelDiameter / 2;
    const first = tk.x + tk.height * 0.55;
    const last = tk.x + tk.length - tk.height * 0.55;
    for (let i = 0; i < tk.wheels; i++) {
      const w = cylinderZ(rw, tk.width * 0.75, 18);
      w.translate(first + ((last - first) * i) / (tk.wheels - 1), rw + 0.07, z);
      wheels.push(w);
    }
    const sprocket = cylinderZ(tk.height * 0.38, tk.width * 0.8, 14);
    sprocket.translate(tk.x + tk.length - tk.height / 2, tk.height / 2, z);
    const idler = cylinderZ(tk.height * 0.36, tk.width * 0.8, 14);
    idler.translate(tk.x + tk.height / 2, tk.height / 2, z);
    root.add(makeCompositePart([{ geometry: mergeGeometries(wheels) }, { geometry: sprocket }, { geometry: idler }], {
      id: `${side}-running-gear`, label: `${label} road wheels`, system: 'mobility',
      info: partInfo(model, 'runningGear', { 'Road wheels': tk.wheels, 'Wheel diameter': `${tk.wheelDiameter} m` }),
    }, lv));

    if (g.skirts !== false) {
      const skirt = new THREE.BoxGeometry(L * 0.94, tk.height * 0.42, 0.05);
      skirt.translate(L * 0.5, tk.height * 0.78, sign * (W / 2 + 0.03));
      root.add(makePart(skirt, { id: `${side}-skirt`, label: `${label} side skirt`, system: 'structure', info: partInfo(model, 'skirts') }, lv));
    }
  }

  // Turret: top-view outline extruded up from the hull roof.
  const t = g.turret;
  const tw = t.width / 2;
  const nose = t.noseWidth ?? 0.5;
  const wedge = t.frontTaper ?? 0.6;
  const outline = [
    [t.x, tw * nose], [t.x + wedge, tw], [t.x + t.length - 0.3, tw * 0.95], [t.x + t.length, tw * 0.8],
    [t.x + t.length, -tw * 0.8], [t.x + t.length - 0.3, -tw * 0.95], [t.x + wedge, -tw], [t.x, -tw * nose],
  ];
  const turret = extrudeTop(outline, t.height, 0.04);
  turret.translate(0, top, 0);
  root.add(makePart(turret, { id: 'turret', label: 'Turret', system: 'structure', info: partInfo(model, 'turret', { Length: `${t.length} m`, Width: `${t.width} m` }) }, lv));

  // Main gun: mantlet plus barrel with a fume extractor.
  const gun = g.gun;
  const gy = top + t.height * (gun.heightRatio ?? 0.45);
  const barrelLen = gun.mountX - gun.muzzleX;
  const barrel = cylinderX(gun.diameter / 2, barrelLen, 18, gun.diameter / 2 * 0.9);
  barrel.translate(gun.muzzleX + barrelLen / 2, gy, 0);
  const evac = cylinderX(gun.diameter * 0.85, barrelLen * 0.14, 18);
  evac.translate(gun.muzzleX + barrelLen * 0.55, gy, 0);
  const mantlet = new THREE.BoxGeometry(0.5, t.height * 0.7, t.width * 0.28);
  mantlet.translate(gun.mountX + 0.1, gy, 0);
  root.add(makeCompositePart([{ geometry: barrel }, { geometry: evac }, { geometry: mantlet }], {
    id: 'main-gun', label: 'Main gun', system: 'armament',
    info: partInfo(model, 'gun', { Caliber: model.specs.main_gun ?? '', 'Barrel length shown': `${barrelLen.toFixed(2)} m` }),
  }, lv));

  // Commander's cupola and sight
  for (const s of g.sights ?? []) {
    const geo = s.shape === 'box' ? new THREE.BoxGeometry(s.length, s.height, s.width) : new THREE.CylinderGeometry(s.width / 2, s.width / 2, s.height, 16);
    geo.translate(s.x, top + t.height + s.height / 2, s.z ?? 0);
    root.add(makePart(geo, { id: s.id, label: s.label, system: 'sensors', info: partInfo(model, s.id) }, lv));
  }

  return root;
}
