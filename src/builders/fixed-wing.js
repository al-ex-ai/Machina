// Fixed-wing aircraft: airliners, light aircraft and fighters.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import {
  bodyOfRevolution, fuselageStations, applyTailUpsweep, liftingSurface, cylinderX, cylinderZ, mergeGeometries,
} from '../parts/shapes.js';
import { fuselageTexture, cylindricalUV } from '../parts/livery.js';

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

  const paint = model.paint ?? {};

  // Fuselage, painted with windows, doors and windshield when a canvas is available.
  const tailLength = f.tailLength ?? f.diameter * 2.6;
  let fuseGeo = bodyOfRevolution(fuselageStations(f), { heightScale, segments: 64 });
  applyTailUpsweep(fuseGeo, { length: f.length, tailLength, rise: (f.tailUpsweep ?? 0) * R });
  const tex = g.canopy ? null : fuselageTexture(f, model.cabin, paint);
  if (tex) fuseGeo = cylindricalUV(fuseGeo, f.length);
  root.add(makePart(fuseGeo, {
    id: 'fuselage', label: 'Fuselage', system: 'structure',
    material: tex ? { map: tex, color: '#ffffff' } : paint.base ? { color: paint.base } : undefined,
    keepNormals: Boolean(tex),
    info: partInfo(model, 'fuselage', { Length: `${f.length} m`, Width: `${f.diameter} m` }),
  }, lv));

  // Fighter canopy
  if (g.canopy) {
    const c = g.canopy;
    const geo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(c.length / 2, c.height, c.width / 2);
    geo.translate(c.x + c.length / 2, c.y, 0);
    root.add(makePart(geo, { id: 'canopy', label: 'Canopy', system: 'glazing', material: { color: '#c9a64a', metalness: 0.7, roughness: 0.08 }, info: partInfo(model, 'canopy') }, lv));
  }

  // Wing-to-body fairing under the wing root
  if (!g.canopy && g.fairing !== false) {
    const w0 = g.wing;
    const len = w0.rootChord * 1.55;
    const geo = new THREE.SphereGeometry(1, 40, 20);
    geo.scale(len / 2, R * heightScale * 0.42, R * 0.92);
    geo.translate(w0.x + w0.rootChord * 0.5, -R * heightScale * 0.72, 0);
    root.add(makePart(geo, {
      id: 'wing-body-fairing', label: 'Wing-to-body fairing', system: 'structure',
      material: { color: paint.belly ?? '#c9ced6' }, info: partInfo(model, 'fairing', { Houses: 'Wing box, main gear bays and air-conditioning packs' }),
    }, lv));
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
  root.add(makePart(vGeo, {
    id: 'fin', label: 'Vertical stabilizer', system: 'surfaces',
    material: paint.tail || (!g.canopy && paint.stripe !== null) ? { color: paint.tail ?? paint.stripe ?? '#24508f', clearcoat: 0.8 } : undefined,
    info: partInfo(model, 'vtail', { Height: `${v.height} m` }),
  }, lv));

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
  // Turbofan: painted nacelle, polished inlet lip, recessed fan with spinner,
  // and a core nozzle with an exhaust plug at the back.
  const len = e.length;
  const y = e.y ?? 0;
  const z = e.z ?? 0;
  const paint = model.paint ?? {};
  const nacSt = [[len * 0.04, r * 0.97], [len * 0.12, r], [len * 0.55, r * 0.98], [len * 0.82, r * 0.82], [len * 0.86, r * 0.62]];
  const nac = bodyOfRevolution(nacSt, { segments: 48 });
  nac.translate(e.x, y, z);
  const lip = new THREE.TorusGeometry(r * 0.9, r * 0.085, 14, 48);
  lip.rotateY(Math.PI / 2);
  lip.translate(e.x + len * 0.04, y, z);
  const fan = cylinderX(r * 0.86, len * 0.02, 48);
  fan.translate(e.x + len * 0.16, y, z);
  const spinner = bodyOfRevolution([[0, 0], [r * 0.25, r * 0.17], [r * 0.45, r * 0.26]], { segments: 32 });
  spinner.translate(e.x + len * 0.16 - r * 0.45, y, z);
  const core = cylinderX(r * 0.6, len * 0.16, 36, r * 0.48);
  core.translate(e.x + len * 0.94, y, z);
  const plug = bodyOfRevolution([[0, r * 0.32], [r * 0.5, r * 0.2], [r * 0.9, 0]], { segments: 32 });
  plug.translate(e.x + len * 1.02, y, z);
  const parts = [
    { geometry: nac, system: 'structure', material: { color: paint.nacelle ?? paint.base ?? '#eef0f3', clearcoat: 0.8, doubleSide: true } },
    { geometry: lip, material: { color: '#c8ccd2', metalness: 0.9, roughness: 0.18 } },
    { geometry: fan, material: { color: '#262b32', metalness: 0.7, roughness: 0.3 } },
    { geometry: spinner, material: { color: '#3a4049', metalness: 0.8, roughness: 0.25 } },
    { geometry: core, material: { color: '#8d939b', metalness: 0.85, roughness: 0.35 } },
    { geometry: plug, material: { color: '#5d636c', metalness: 0.85, roughness: 0.4 } },
  ];
  if (e.pylon !== false) {
    const w = model.geometry.wing;
    const top = (w.y ?? 0) + Math.abs(e.z ?? 0) * Math.tan(((w.dihedralDeg ?? 0) * Math.PI) / 180);
    const bottom = (e.y ?? 0) + r * 0.6;
    if (top > bottom) {
      const py = new THREE.BoxGeometry(len * 0.7, top - bottom, r * 0.18);
      py.translate(e.x + len * 0.45, (top + bottom) / 2, e.z ?? 0);
      parts.push({ geometry: py, system: 'structure', material: { color: paint.base ?? '#eef0f3' } });
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
    const strut = new THREE.CylinderGeometry(wheelR * 0.16, wheelR * 0.16, height, 14);
    strut.translate(x, gear.attachY - height / 2 + wheelR * 0.5, z);
    const geos = [{ geometry: strut, material: { color: '#c3c8ce', metalness: 0.85, roughness: 0.25 } }];
    const spread = wheels > 1 ? wheelR * 1.1 : 0;
    for (let i = 0; i < wheels; i++) {
      const wz = z + (wheels > 1 ? (i - (wheels - 1) / 2) * spread * 2 : 0);
      const cy = gear.attachY - height + wheelR;
      const tire = new THREE.TorusGeometry(wheelR * 0.72, wheelR * 0.3, 14, 32);
      tire.scale(1, 1, 1.15);
      tire.translate(x, cy, wz);
      const hub = cylinderZ(wheelR * 0.5, wheelR * 0.62, 24);
      hub.translate(x, cy, wz);
      geos.push({ geometry: tire, material: { color: '#1c1e21', roughness: 0.9, metalness: 0 } });
      geos.push({ geometry: hub, material: { color: '#aeb4bb', metalness: 0.8, roughness: 0.3 } });
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
