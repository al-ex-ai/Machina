// Fixed-wing aircraft: airliners, light aircraft and fighters.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import {
  bodyOfRevolution, fuselageStations, applyTailUpsweep, liftingSurface, cylinderX, cylinderZ, mergeGeometries,
} from '../parts/shapes.js';

const SIDES = [
  { sign: 1, name: 'left', label: 'Left' },
  { sign: -1, name: 'right', label: 'Right' },
];

/** @param {any} model */
export function buildFixedWing(model) {
  const g = model.geometry;
  const lv = model.livery ?? {};
  const root = new THREE.Group();
  const f = g.fuselage;
  const R = f.diameter / 2;
  const heightScale = (f.height ?? f.diameter) / f.diameter;

  // Fuselage
  const tailLength = f.tailLength ?? f.diameter * 2.6;
  const fuseGeo = bodyOfRevolution(fuselageStations(f), { heightScale });
  applyTailUpsweep(fuseGeo, { length: f.length, tailLength, rise: (f.tailUpsweep ?? 0) * R });
  root.add(makePart(fuseGeo, {
    id: 'fuselage', label: 'Fuselage', system: 'structure',
    info: partInfo(model, 'fuselage', { Length: `${f.length} m`, Width: `${f.diameter} m` }),
  }, lv));

  // Cockpit glazing or canopy
  if (g.canopy) {
    const c = g.canopy;
    const geo = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(c.length / 2, c.height, c.width / 2);
    geo.translate(c.x + c.length / 2, c.y, 0);
    root.add(makePart(geo, { id: 'canopy', label: 'Canopy', system: 'glazing', info: partInfo(model, 'canopy') }, lv));
  } else {
    // A thin band that follows the nose surface, upper half only.
    const stations = fuselageStations(f);
    const x0 = f.cockpitX ?? (f.noseLength ?? f.diameter * 1.6) * 0.42;
    const len = f.diameter * 0.32;
    const band = stations.filter(([x]) => x >= x0 && x <= x0 + len);
    const st = [[x0, radiusAt(stations, x0)], ...band, [x0 + len, radiusAt(stations, x0 + len)]].map(([x, r]) => [x, r * 1.012]);
    const geo = bodyOfRevolution(st, { segments: 32, heightScale });
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < R * heightScale * 0.35) pos.setY(i, R * heightScale * 0.35);
    root.add(makePart(geo, { id: 'cockpit', label: 'Flight deck windows', system: 'glazing', info: partInfo(model, 'cockpit') }, lv));
  }

  // Wings (and optional winglets)
  const w = g.wing;
  for (const s of SIDES) {
    const geo = liftingSurface({ ...w, span: w.span / 2, side: s.sign });
    geo.translate(w.x, w.y ?? 0, 0);
    root.add(makePart(geo, {
      id: `${s.name}-wing`, label: `${s.label} wing`, system: 'surfaces',
      info: partInfo(model, 'wing', { 'Wingspan (both)': `${w.span} m`, 'Root chord': `${w.rootChord} m`, 'Tip chord': `${w.tipChord} m`, 'Leading-edge sweep': `${w.sweepDeg ?? 0}°` }),
    }, lv));
    if (g.winglet) {
      const wl = g.winglet;
      const tipX = w.x + (w.span / 2) * Math.tan(((w.sweepDeg ?? 0) * Math.PI) / 180);
      const tipY = (w.y ?? 0) + (w.span / 2) * Math.tan(((w.dihedralDeg ?? 0) * Math.PI) / 180);
      const wg = liftingSurface({ span: wl.height, rootChord: w.tipChord, tipChord: w.tipChord * 0.4, sweepDeg: wl.sweepDeg ?? 35, vertical: true, thickness: 0.1 });
      wg.translate(tipX, tipY, s.sign * (w.span / 2));
      root.add(makePart(wg, { id: `${s.name}-winglet`, label: `${s.label} winglet`, system: 'surfaces', info: partInfo(model, 'winglet') }, lv));
    }
  }

  // Horizontal tail
  const h = g.htail;
  for (const s of SIDES) {
    const geo = liftingSurface({ ...h, span: h.span / 2, side: s.sign, thickness: 0.1 });
    geo.translate(h.x, h.y ?? 0, 0);
    root.add(makePart(geo, {
      id: `${s.name}-stabilizer`, label: `${s.label} horizontal stabilizer`, system: 'surfaces',
      info: partInfo(model, 'htail', { 'Tailplane span': `${h.span} m` }),
    }, lv));
  }

  // Vertical tail
  const v = g.vtail;
  const vGeo = liftingSurface({ ...v, span: v.height, vertical: true, thickness: 0.1 });
  vGeo.translate(v.x, v.y ?? R * heightScale * 0.6, 0);
  root.add(makePart(vGeo, { id: 'fin', label: 'Vertical stabilizer', system: 'surfaces', info: partInfo(model, 'vtail', { Height: `${v.height} m` }) }, lv));

  // Engines, numbered from left to right as crews do
  const engines = [];
  for (const e of g.engines ?? []) {
    if (e.mirror) {
      engines.push({ ...e, z: Math.abs(e.z) });
      engines.push({ ...e, z: -Math.abs(e.z) });
    } else engines.push(e);
  }
  engines.sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
  engines.forEach((e, i) => {
    const id = engines.length > 1 ? `engine-${i + 1}` : 'engine';
    const label = engines.length > 1 ? `Engine ${i + 1}` : 'Engine';
    root.add(buildEngine(e, { id, label, info: partInfo(model, 'engines', { Position: engines.length > 1 ? `${i + 1} of ${engines.length}, counted from the left` : 'Single' }) }, lv, model));
  });

  // Landing gear
  if (g.gear) root.add(...buildGear(g.gear, model, lv));

  return root;
}

function radiusAt(stations, x) {
  for (let i = 1; i < stations.length; i++) {
    const [x1, r1] = stations[i - 1];
    const [x2, r2] = stations[i];
    if (x >= x1 && x <= x2) return x2 === x1 ? r2 : r1 + ((r2 - r1) * (x - x1)) / (x2 - x1);
  }
  return 0;
}

function buildEngine(e, meta, lv, model) {
  const r = e.diameter / 2;
  if (e.kind === 'propeller') {
    const hub = cylinderX(e.diameter * 0.08, e.diameter * 0.18, 20, e.diameter * 0.02);
    hub.translate(e.x - e.diameter * 0.09, e.y ?? 0, e.z ?? 0);
    const blades = [];
    const n = e.blades ?? 2;
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(0.05, r, e.diameter * 0.06);
      b.translate(0, r / 2, 0);
      b.rotateX((i / n) * Math.PI * 2 + 0.3);
      b.translate(e.x - e.diameter * 0.05, e.y ?? 0, e.z ?? 0);
      blades.push(b);
    }
    return makeCompositePart([{ geometry: hub }, { geometry: mergeGeometries(blades) }], { ...meta, id: 'propeller', label: 'Propeller', system: 'propulsion' }, lv);
  }
  if (e.kind === 'internal') {
    // Fighter: engine inside the fuselage, shown as intake plus exhaust nozzle.
    const parts = [];
    if (e.intake) {
      const i = e.intake;
      const geo = new THREE.BoxGeometry(i.length, i.height, i.width);
      geo.translate(i.x + i.length / 2, i.y, 0);
      parts.push({ geometry: geo });
    }
    const noz = cylinderX(r, e.length, 24, r * 0.82);
    noz.translate(e.x + e.length / 2, e.y ?? 0, 0);
    parts.push({ geometry: noz });
    return makeCompositePart(parts, { ...meta, system: 'propulsion' }, lv);
  }
  // Turbofan nacelle hung on a pylon
  const len = e.length;
  const st = [[0, r * 0.92], [len * 0.08, r], [len * 0.55, r * 0.98], [len * 0.9, r * 0.72], [len, r * 0.5]];
  const nac = bodyOfRevolution([[0, r * 0.7], ...st, [len, 0.001]], { segments: 32 });
  nac.translate(e.x, e.y ?? 0, e.z ?? 0);
  const parts = [{ geometry: nac }];
  if (e.pylon !== false) {
    const wingY = model.geometry.wing.y ?? 0;
    const top = wingY + 0.15;
    const bottom = (e.y ?? 0) + r * 0.6;
    if (top > bottom) {
      const py = new THREE.BoxGeometry(len * 0.7, top - bottom, r * 0.18);
      py.translate(e.x + len * 0.45, (top + bottom) / 2, e.z ?? 0);
      parts.push({ geometry: py, system: 'structure' });
    }
  }
  return makeCompositePart(parts, { ...meta, system: 'propulsion' }, lv);
}

function buildGear(gear0, model, lv) {
  const f = model.geometry.fuselage;
  const gear = { attachY: -((f.height ?? f.diameter) / 2) * 0.8, ...gear0 };
  const wheelR = gear.wheelDiameter / 2;
  const parts = [];
  const leg = (x, z, height, wheels, id, label) => {
    const strut = new THREE.CylinderGeometry(wheelR * 0.18, wheelR * 0.18, height, 10);
    strut.translate(x, gear.attachY - height / 2 + wheelR * 0.5, z);
    const geos = [{ geometry: strut }];
    const spread = wheels > 1 ? wheelR * 1.1 : 0;
    for (let i = 0; i < wheels; i++) {
      const wz = z + (wheels > 1 ? (i - (wheels - 1) / 2) * spread * 2 : 0);
      const wGeo = cylinderZ(wheelR, wheelR * 0.7, 20);
      wGeo.translate(x, gear.attachY - height + wheelR, wz);
      geos.push({ geometry: wGeo });
    }
    parts.push(makeCompositePart(geos, { id, label, system: 'gear', info: partInfo(model, 'gear') }, lv));
  };
  leg(gear.nose.x, 0, gear.height, gear.nose.wheels ?? 2, 'nose-gear', gear.tailwheel ? 'Tail wheel' : 'Nose gear');
  const mainWheels = gear.main.wheels ?? 2;
  const struts = gear.main.struts ?? 1;
  for (const s of SIDES) {
    for (let k = 0; k < struts; k++) {
      const z = s.sign * (gear.main.track / 2 - k * (gear.main.strutSpacing ?? 0));
      const x = gear.main.x + k * (gear.main.strutOffsetX ?? 0);
      const suffix = struts > 1 ? ` ${k + 1}` : '';
      leg(x, z, gear.height, mainWheels, `${s.name}-main-gear${struts > 1 ? `-${k + 1}` : ''}`, `${s.label} main gear${suffix}`);
    }
  }
  return parts;
}
