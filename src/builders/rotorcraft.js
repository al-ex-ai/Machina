// Helicopters: cabin, tail boom, main and tail rotors, engines, gear.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import { bodyOfRevolution, fuselageStations, liftingSurface, cylinderX, cylinderZ, mergeGeometries } from '../parts/shapes.js';

/** @param {any} model */
export function buildRotorcraft(model) {
  const g = model.geometry;
  const lv = model.livery ?? {};
  const root = new THREE.Group();

  // Cabin
  const c = g.cabin;
  const hs = c.height / c.width;
  const cabin = bodyOfRevolution(fuselageStations({ length: c.length, diameter: c.width, noseLength: c.noseLength, tailLength: c.tailLength, tailEndRatio: 0.35, noseBluntness: 0.8 }), { heightScale: hs });
  root.add(makePart(cabin, { id: 'fuselage', label: 'Cabin and fuselage', system: 'structure', info: partInfo(model, 'fuselage', { Length: `${c.length} m`, Width: `${c.width} m` }) }, lv));

  if (g.canopy) {
    const k = g.canopy;
    const geo = new THREE.SphereGeometry(1, 24, 16, Math.PI / 2, Math.PI, 0, Math.PI / 2);
    geo.scale(k.length, k.height, k.width / 2);
    geo.translate(k.x + k.length, k.y, 0);
    root.add(makePart(geo, { id: 'canopy', label: 'Cockpit glazing', system: 'glazing', info: partInfo(model, 'canopy') }, lv));
  }

  // Tail boom
  const b = g.boom;
  const boom = cylinderX(b.rootRadius, b.length, 20, b.tipRadius);
  boom.translate(b.x + b.length / 2, b.y, 0);
  root.add(makePart(boom, { id: 'tail-boom', label: 'Tail boom', system: 'structure', info: partInfo(model, 'boom', { Length: `${b.length} m` }) }, lv));

  // Fin (tail pylon)
  const f = g.fin;
  const fin = liftingSurface({ span: f.height, rootChord: f.rootChord, tipChord: f.tipChord, sweepDeg: f.sweepDeg, vertical: true, thickness: 0.14 });
  fin.translate(f.x, f.y, 0);
  root.add(makePart(fin, { id: 'tail-pylon', label: 'Tail pylon', system: 'surfaces', info: partInfo(model, 'fin') }, lv));

  // Stabilator
  if (g.stabilator) {
    const s = g.stabilator;
    for (const side of [1, -1]) {
      const geo = liftingSurface({ span: s.span / 2, rootChord: s.rootChord, tipChord: s.tipChord, sweepDeg: 0, side, thickness: 0.1 });
      geo.translate(s.x, s.y, 0);
      root.add(makePart(geo, { id: side > 0 ? 'left-stabilator' : 'right-stabilator', label: side > 0 ? 'Left stabilator' : 'Right stabilator', system: 'surfaces', info: partInfo(model, 'stabilator', { Span: `${s.span} m` }) }, lv));
    }
  }

  // Main rotor: mast, hub and blades. The first blade points forward.
  const m = g.mainRotor;
  const R = m.diameter / 2;
  const mast = new THREE.CylinderGeometry(0.12, 0.16, m.mastHeight ?? 0.6, 12);
  mast.translate(m.x, m.y - (m.mastHeight ?? 0.6) / 2, 0);
  const hub = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16);
  hub.translate(m.x, m.y, 0);
  const blades = [];
  for (let i = 0; i < m.blades; i++) {
    const blade = new THREE.BoxGeometry(R - 0.3, 0.06, m.chord);
    blade.translate(-(R - 0.3) / 2 - 0.3, 0, 0);
    blade.rotateY((i / m.blades) * Math.PI * 2);
    blade.translate(m.x, m.y, 0);
    blades.push(blade);
  }
  root.add(makeCompositePart(
    [{ geometry: mast, system: 'structure' }, { geometry: hub }, { geometry: mergeGeometries(blades) }],
    { id: 'main-rotor', label: 'Main rotor', system: 'rotor', info: partInfo(model, 'mainRotor', { Diameter: `${m.diameter} m`, Blades: m.blades }) }, lv,
  ));

  // Tail rotor: a vertical disk of blades on one side of the pylon.
  const t = g.tailRotor;
  const tr = t.diameter / 2;
  const tz = (t.side ?? 1) * (t.offset ?? 0.35);
  const thub = cylinderZ(0.12, 0.2, 12);
  thub.translate(t.x, t.y, tz);
  const tblades = [];
  for (let i = 0; i < t.blades; i++) {
    const blade = new THREE.BoxGeometry(0.2, tr, 0.04);
    blade.translate(0, tr / 2, 0);
    blade.rotateZ((i / t.blades) * Math.PI * 2);
    blade.translate(t.x, t.y, tz);
    tblades.push(blade);
  }
  root.add(makeCompositePart([{ geometry: thub }, { geometry: mergeGeometries(tblades) }],
    { id: 'tail-rotor', label: 'Tail rotor', system: 'rotor', info: partInfo(model, 'tailRotor', { Diameter: `${t.diameter} m`, Blades: t.blades }) }, lv));

  // Engines
  const engines = [];
  for (const e of g.engines ?? []) {
    if (e.mirror) engines.push({ ...e, z: Math.abs(e.z) }, { ...e, z: -Math.abs(e.z) });
    else engines.push(e);
  }
  engines.sort((a, b2) => b2.z - a.z).forEach((e, i) => {
    const geo = cylinderX(e.diameter / 2, e.length, 20, e.diameter * 0.4);
    geo.translate(e.x + e.length / 2, e.y, e.z);
    const id = engines.length > 1 ? `engine-${i + 1}` : 'engine';
    root.add(makePart(geo, { id, label: engines.length > 1 ? `Engine ${i + 1}` : 'Engine', system: 'propulsion', info: partInfo(model, 'engines') }, lv));
  });

  // Wheeled gear
  if (g.gear) {
    const gr = g.gear;
    const wr = gr.wheelDiameter / 2;
    const wheel = (x, z, id, label) => {
      const strut = new THREE.CylinderGeometry(0.06, 0.06, gr.height, 8);
      strut.translate(x, gr.attachY - gr.height / 2 + wr * 0.5, z);
      const w = cylinderZ(wr, wr * 0.6, 18);
      w.translate(x, gr.attachY - gr.height + wr, z);
      root.add(makeCompositePart([{ geometry: strut }, { geometry: w }], { id, label, system: 'gear', info: partInfo(model, 'gear') }, lv));
    };
    wheel(gr.main.x, gr.main.track / 2, 'left-main-gear', 'Left main gear');
    wheel(gr.main.x, -gr.main.track / 2, 'right-main-gear', 'Right main gear');
    wheel(gr.tail.x, 0, 'tail-wheel', 'Tail wheel');
  }

  return root;
}
