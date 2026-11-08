// Parametric fixed-wing builder (v2): fuselage lofted through measured cross-sections,
// wings and tails lofted from NACA airfoils along the true planform, nacelles lofted
// the same way, and landing gear sized from tire data. Every number comes from the
// model file, every part is named by construction, and the size is exact by design.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import { bodyProfile, loftBody, mergeIndexed } from '../parametric/body.js';
import { surfacePlan, surfacePiece, mirrorZ } from '../parametric/surface.js';
import { paintFuselage, paintFin, sideUV, surfaceBump } from '../parametric/livery.js';
import { skinOutlines, inletLip, fanBlades, nozzleSleeve, grooveTire, gearLinkage, airframeDetails, propeller, strut, rod } from '../parametric/details.js';
import { glassTest, glazingGeometry, interior } from '../parametric/cabin.js';

const SIDES = [{ key: 'left', label: 'Left', z: 1 }, { key: 'right', label: 'Right', z: -1 }];

/**
 * A drawing shows a pod's outline, not how it joins the airframe. A pod on the
 * centerline whose floor comes within a meter of the fuselage is mounted on it: behind
 * its front lip the floor runs down into the body, deep enough that the rounded sides
 * meet the crown too. If it ends just ahead of the fin, it runs on into the fin root,
 * narrowing to the fin's thickness. Returns the stations to loft.
 */
export function attachPod(pd, body, surfaces) {
  const X = pd.position.x, Y = pd.position.y ?? 0;
  if (pd.mirror || Math.abs(pd.position.z ?? 0) > 0.01) return pd.stations;
  const gap = ([x, , , bot]) => Y + bot - body.at(X + x).top;
  if (!pd.stations.some(s => gap(s) > 0.02 && gap(s) < 1)) return pd.stations;
  const st = pd.stations.map((s, i) => {
    if (i === 0) return s; // the lip keeps its own floor, like the boundary layer gap of a real intake
    const [x, w, top, bot, mid] = s;
    return [x, w, top, Math.min(bot, body.at(X + x).top - Y - w), mid];
  });
  const fin = surfaces.find(s => s.axis === 'y' && !s.mirror);
  if (fin) {
    const last = st.at(-1), end = X + last[0];
    const sec = surfacePlan(fin).section(Y + last[2]);
    if (sec.le > end && sec.le - end < 1.5) {
      const half = Math.max(0.06, sec.tc * sec.chord * 0.4);
      st.push([sec.le + sec.chord * 0.2 - X, last[1] * 0.75 + half * 0.25, last[2], last[3], last[4]]);
      st.push([sec.le + sec.chord * 0.6 - X, half, last[2], last[3], last[4]]);
    }
  }
  return st;
}

/** @param {any} model */
export function buildParametric(model) {
  const g = model.geometry;
  const lv = model.livery ?? {};
  const mat = g.materials ?? {};
  const root = new THREE.Group();
  const L = g.length;

  // Fuselage and wing-to-body fairing
  const body = bodyProfile(g.fuselage.stations, g.fuselage);
  const tex = paintFuselage(body, L, lv);
  const isGlass = glassTest(g.glazing);
  // Glazed bodies are lofted finer, so the window openings have small steps for the frames to cover.
  const fuselage = makePart(loftBody(body, { length: L, segments: g.glazing ? 256 : 128, maxStep: g.glazing ? 0.025 : undefined, skip: g.glazing ? isGlass : undefined }), {
    id: 'fuselage', label: 'Fuselage', system: 'structure', keepNormals: true,
    material: tex ? { map: tex.map, bumpMap: tex.bump, bumpScale: 1.2, color: '#ffffff', roughness: tex.metal ? 0.36 : 0.5, clearcoat: 0, envMapIntensity: tex.metal ? 0.9 : 0.45, specularIntensity: 0.2, ...(tex.metal ? { metalnessMap: tex.metal, metalness: 1 } : {}) } : { color: lv.base }, // satin, softer reflections: dark titles stay readable under the studio light
    info: partInfo(model, 'fuselage', { Length: `${L} m` }),
  });
  fuselage.userData.drawLines = skinOutlines(body, lv); // windows and doors for the line drawings
  root.add(fuselage);

  // See-through glazing (light aircraft): glass and frames over the openings, and the
  // cabin behind them.
  if (g.glazing) {
    const gz = glazingGeometry(body, g.glazing);
    root.add(makeCompositePart([
      { geometry: gz.frame, material: { color: lv.frame ?? '#2b3038', roughness: 0.5, doubleSide: true } },
      { geometry: gz.glass, material: { color: '#9fb8cc', roughness: 0.05, metalness: 0.1, clearcoat: 1, opacity: 0.22, doubleSide: true, envMapIntensity: 1.4 } },
    ], { id: 'glazing', label: 'Windshield and windows', system: 'glazing', info: partInfo(model, 'glazing') }));
  }
  if (g.interior) {
    const c = interior(body, g.interior, g.glazing, loftBody, bodyProfile);
    const trim = g.interior.trim ?? '#b9b2a5';
    root.add(makeCompositePart([
      { geometry: c.lining, material: { color: trim, roughness: 0.9, backSide: true } },
      { geometry: c.floor, material: { color: '#3b3f46', roughness: 0.95 } },
      { geometry: c.seats, material: { color: g.interior.seatColor ?? '#4a5568', roughness: 0.8 } },
      { geometry: c.panel, material: { color: '#262a30', roughness: 0.7 } },
      { geometry: c.gauges, material: { color: '#0d1116', roughness: 0.2, metalness: 0.3 } },
      ...(c.controls ? [{ geometry: c.controls, material: { color: '#1d2025', roughness: 0.6 } }] : []),
    ], { id: 'cabin', label: `Cabin (${g.interior.seats} seats)`, system: 'interior', info: partInfo(model, 'cabin', { Seats: g.interior.seats, Layout: g.interior.abreast === 1 ? 'Tandem' : 'Side by side' }) }));
  }
  if (g.fairing) {
    const fp = bodyProfile(g.fairing.stations, g.fairing);
    root.add(makePart(loftBody(fp, { length: L, segments: 64 }), {
      id: 'wing-body-fairing', label: 'Wing-to-body fairing', system: 'structure', keepNormals: true,
      material: { color: lv.belly, roughness: 0.35, clearcoat: 0.7 }, info: partInfo(model, 'wing-body-fairing'),
    }));
  }

  // Cockpit windows: each pane is a four-cornered panel given as [x, degrees from the
  // top centerline] corners, mapped bilinearly onto the nose so its edges stay straight,
  // and lifted 1.5 cm off the skin. Mirrored to the right side.
  if (lv.cockpitWindows?.length) {
    const v = new THREE.Vector3(), dx = new THREE.Vector3(), dt = new THREE.Vector3();
    const N = 12;
    const panels = (grow, lift) => {
    const pos = [], idx = [];
    for (const pane0 of lv.cockpitWindows) {
      const cx = pane0.reduce((q, p) => q + p[0], 0) / 4, cd = pane0.reduce((q, p) => q + p[1], 0) / 4;
      const pane = pane0.map(([x, d]) => [cx + (x - cx) * (1 + grow), Math.max(1, cd + (d - cd) * (1 + grow))]);
      const c = pane.map(([x, d]) => [x, THREE.MathUtils.degToRad(d)]);
      for (const sign of [1, -1]) {
        const base = pos.length / 3;
        for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
          const u = i / N, w = j / N;
          const x = (1 - u) * (1 - w) * c[0][0] + u * (1 - w) * c[1][0] + u * w * c[2][0] + (1 - u) * w * c[3][0];
          const t0 = (1 - u) * (1 - w) * c[0][1] + u * (1 - w) * c[1][1] + u * w * c[2][1] + (1 - u) * w * c[3][1];
          const t = sign > 0 ? t0 : Math.PI * 2 - t0;
          body.point(x, t, v);
          body.point(x + 0.01, t, dx).sub(v);
          body.point(x, t + 0.01, dt).sub(v);
          const n = dx.clone().cross(dt).normalize().negate(); // outward on both sides
          v.addScaledVector(n, lift);
          pos.push(v.x, v.y, v.z);
        }
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const a = base + i * (N + 1) + j, b = a + 1, cc = a + N + 1, d = cc + 1;
          if (sign > 0) idx.push(a, cc, b, b, cc, d); else idx.push(a, b, cc, b, d, cc);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
    };
    root.add(makeCompositePart([
      { geometry: panels(0.16, 0.008), material: { color: lv.frame ?? '#2b3038', roughness: 0.5, doubleSide: true } },
      { geometry: panels(0, 0.016), material: { color: '#0a1016', roughness: 0.03, metalness: 0.85, clearcoat: 1, doubleSide: true } },
    ], { id: 'windshield', label: 'Cockpit windows', system: 'glazing', info: partInfo(model, 'windshield') }));
  }

  // Lifting surfaces, split into named pieces
  // Movable surfaces stand off their neighbors by hinge and side gaps.
  for (const s of g.surfaces) {
    const plan = surfacePlan(s);
    const pieces = new Map();
    for (const seg of s.segments) {
      for (const [c0, c1, key] of seg.split) {
        if (!pieces.has(key)) pieces.set(key, []);
        const movable = s.parts[key].system === 'controls';
        pieces.get(key).push(surfacePiece(plan, seg.from, seg.to, c0, c1, movable ? { gap: 0.015, spanGap: 0.02 } : {}));
      }
    }
    const ats = s.sections.map(q => q.at);
    const bump = s.paint ? null : surfaceBump(Math.max(...ats) - Math.min(...ats));
    // A painted tail: one texture shared by the fin and rudder, mapped on both faces.
    let decal = null, bounds = null;
    if (s.paint) {
      const xs = s.sections.flatMap(q => [q.le, q.le + q.chord]), ys = s.sections.map(q => q.at);
      bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      decal = paintFin(bounds, s.paint);
    }
    for (const [key, geos] of pieces) {
      const meta = s.parts[key];
      let geo = mergeIndexed(geos);
      let material = mat[meta.finish ?? meta.system] ?? {};
      if (decal) { geo = sideUV(geo, bounds); material = { ...material, map: decal, color: '#ffffff' }; }
      else if (bump) material = { ...material, bumpMap: bump, bumpScale: 1.6 };
      if (!s.mirror) {
        root.add(makePart(geo, { ...meta, keepNormals: true, material, info: partInfo(model, meta.id) }));
        continue;
      }
      for (const side of SIDES) {
        root.add(makePart(side.z > 0 ? geo : mirrorZ(geo), {
          id: `${side.key}-${meta.id}`, label: `${side.label} ${meta.label.toLowerCase()}`, system: meta.system,
          keepNormals: true, material, info: partInfo(model, meta.id),
        }));
      }
    }
  }

  // Engines: lofted nacelle, recessed fan with spinner, exhaust plug, pylon.
  // g.engine (one pair under the wing) or g.engines (a list, each optionally mirrored,
  // with a wing pylon (vertical) or a fuselage pylon (horizontal stub)).
  const engineSpecs = g.engines ?? (g.engine ? [{ ...g.engine, mirror: true }] : []);
  engineSpecs.forEach((e, ei) => {
    const nac = bodyProfile(e.nacelle.stations, e.nacelle);
    const length = nac.x1;
    const inlet = nac.at(0);
    const rFan = e.fan.radius;
    const fanX = e.fan.depth;
    const fanY = inlet.mid + (e.fan.offsetY ?? 0); // the fan sits above a flattened inlet floor
    const plug = new THREE.LatheGeometry(e.plug.map(([x, r]) => new THREE.Vector2(r, x)), 32).rotateZ(-Math.PI / 2);
    plug.translate(0, nac.at(length).mid, 0);
    const spinner = new THREE.ConeGeometry(rFan * 0.32, rFan * 0.75, 32).rotateZ(Math.PI / 2).translate(fanX - rFan * 0.37, fanY, 0);
    const duct = new THREE.CylinderGeometry(rFan * 1.02, rFan * 1.02, fanX, 48, 1, true).rotateZ(Math.PI / 2).translate(fanX / 2, fanY, 0);
    const fan = new THREE.CircleGeometry(rFan, 48).rotateY(-Math.PI / 2).translate(fanX + 0.08, fanY, 0);
    const blades = fanBlades(rFan, fanX, fanY, e.fan.blades ?? 24);
    const sleeve = nozzleSleeve(nac, length);
    const lip = inletLip(nac, rFan * 1.02, fanY);
    const pylonPlan = surfacePlan({ axis: e.pylon.axis ?? 'y', sections: e.pylon.sections });
    const pylon = surfacePiece(pylonPlan, e.pylon.sections[0].at, e.pylon.sections.at(-1).at, 0, 1);
    const sides = e.mirror ? SIDES : [{ key: e.id ?? `engine-${ei + 1}`, label: '', z: 1 }];
    for (const side of sides) {
      const zz = e.mirror ? side.z * e.position.z : e.position.z;
      const place = geo => geo.clone().translate(e.position.x, e.position.y, zz);
      const pyl = e.mirror && side.z < 0 ? mirrorZ(pylon) : pylon.clone();
      if (!e.mirror && e.position.z < 0) pyl.scale(1, 1, -1);
      root.add(makeCompositePart([
        { geometry: place(loftBody(nac, { length, segments: 72, capStart: false, capEnd: false })), material: { color: lv.nacelle ?? lv.belly, roughness: 0.32, clearcoat: 0.8, doubleSide: true } },
        { geometry: place(lip), material: mat.metal },
        { geometry: place(duct), material: { color: '#3a4049', roughness: 0.75, metalness: 0.3, doubleSide: true } },
        { geometry: place(fan), material: { color: '#101318', roughness: 0.6, metalness: 0.4 } },
        { geometry: place(blades), material: { color: '#9aa3ad', roughness: 0.3, metalness: 0.9, doubleSide: true } },
        { geometry: place(spinner), material: { color: '#c3c8ce', roughness: 0.25, metalness: 0.9 } },
        { geometry: place(sleeve), material: { color: '#16191d', roughness: 0.8, metalness: 0.2, doubleSide: true } },
        { geometry: place(plug), material: { color: '#5a5f66', roughness: 0.55, metalness: 0.8 } },
        { geometry: pyl, material: { color: lv.pylon ?? '#d7dbe0', roughness: 0.4 } },
      ], { id: e.mirror ? `${side.key}-${e.id ?? 'engine'}` : (e.id ?? `engine-${ei + 1}`), label: e.mirror ? `${side.label} ${(e.label ?? 'engine').toLowerCase()} (${e.name})` : `${e.label ?? 'Engine'} (${e.name})`, system: 'propulsion', info: partInfo(model, 'engine') }));
    }
  });

  // Pods: lofted bodies such as landing gear fairings, an engine intake or a tail cone
  // fairing, each with an optional dark inlet face. Stations are relative to position.x.
  for (const pd of g.pods ?? []) {
    const prof = bodyProfile(attachPod(pd, body, g.surfaces), pd);
    const geo = loftBody(prof, { length: prof.x1, segments: 48 }).translate(pd.position.x, pd.position.y ?? 0, 0);
    const extra = [];
    if (pd.inlet) {
      const s0 = prof.at(0);
      extra.push({ geometry: new THREE.CircleGeometry(1, 40).scale(1, (s0.top - s0.bot) / 2 * 0.82, s0.w * 0.82).rotateY(-Math.PI / 2).translate(pd.position.x + 0.03, (pd.position.y ?? 0) + s0.mid, 0), material: { color: '#15191e', roughness: 0.5, metalness: 0.5 } });
    }
    const sides = pd.mirror ? SIDES : [{ key: '', label: '', z: 1 }];
    for (const side of sides) {
      const z = pd.mirror ? side.z * pd.position.z : (pd.position.z ?? 0);
      root.add(makeCompositePart([
        { geometry: geo.clone().translate(0, 0, z), material: mat[pd.finish] ?? { color: pd.color ?? lv.base, roughness: 0.35, clearcoat: 0.7 } },
        ...extra.map(q => ({ ...q, geometry: q.geometry.clone().translate(0, 0, z) })),
      ], { id: pd.mirror ? `${side.key}-${pd.id}` : pd.id, label: pd.mirror ? `${side.label} ${pd.label.toLowerCase()}` : pd.label, system: pd.system ?? 'structure', info: partInfo(model, pd.id) }));
    }
  }

  // Flap track fairings ("canoes") under the wing trailing edge
  if (g.canoes) {
    const geos = [];
    for (const c of g.canoes) {
      const len = c.x1 - c.x0;
      const p = bodyProfile([
        [0, 0.01, c.y, c.y - 0.01, c.y],
        [len * 0.25, c.w, c.y, c.y - c.h, c.y - c.h * 0.35],
        [len * 0.7, c.w * 0.8, c.y, c.y - c.h * 0.8, c.y - c.h * 0.3],
        [len, 0.02, c.y - c.h * 0.15, c.y - c.h * 0.3, c.y - c.h * 0.2],
      ], { nTop: 2, nBot: 2.4 });
      geos.push(loftBody(p, { length: len, segments: 24 }).translate(c.x0, 0, c.z));
    }
    const geo = mergeIndexed(geos);
    for (const side of SIDES) {
      root.add(makePart(side.z > 0 ? geo : mirrorZ(geo), {
        id: `${side.key}-flap-track-fairings`, label: `${side.label} flap track fairings`, system: 'controls', keepNormals: true,
        material: mat.controls ?? {}, info: partInfo(model, 'flap-track-fairings'),
      }));
    }
  }

  // Navigation lights: red on the left wingtip, green on the right, white on the tail
  if (g.navLights) {
    const n = g.navLights;
    const bulb = (x, y, z, color) => ({ geometry: new THREE.SphereGeometry(0.09, 16, 12).scale(1.6, 1, 1).translate(x, y, z), material: { color, roughness: 0.15, clearcoat: 1 } });
    root.add(makeCompositePart([
      bulb(n.wingtip.x, n.wingtip.y, n.wingtip.z, '#e0262b'),
      bulb(n.wingtip.x, n.wingtip.y, -n.wingtip.z, '#1fbf5a'),
      bulb(n.tail.x, n.tail.y, 0, '#f2f2f2'),
    ], { id: 'nav-lights', label: 'Navigation lights', system: 'lights', info: partInfo(model, 'nav-lights') }));
  }

  // Landing gear
  const tire = grooveTire;
  const leg = (gear, z, id, label) => {
    const r = gear.tire.d / 2;
    const y0 = gear.bottom ?? 0; // tire bottom in body axes (below 0 when the aircraft sits nose down)
    const parts = [];
    const n = gear.wheels;
    const axles = gear.axles ?? 1, pitch = gear.axleSpacing ?? 0;
    for (let k = 0; k < axles; k++) {
      const ax = gear.x + (k - (axles - 1) / 2) * pitch;
      for (let i = 0; i < n; i++) {
        const dz = (i - (n - 1) / 2) * gear.spacing;
        parts.push({ geometry: tire(gear.tire.d, gear.tire.w).translate(ax, y0 + r, z + dz), material: { color: '#1b1d20', roughness: 0.85, metalness: 0 } });
        parts.push({ geometry: new THREE.CylinderGeometry(r * 0.55, r * 0.55, gear.tire.w * 0.9, 24).rotateX(Math.PI / 2).translate(ax, y0 + r, z + dz), material: { color: '#9aa1aa', roughness: 0.4, metalness: 0.8 } });
        parts.push({ geometry: new THREE.CylinderGeometry(r * 0.2, r * 0.24, gear.tire.w * 1.02, 16).rotateX(Math.PI / 2).translate(ax, y0 + r, z + dz), material: { color: '#6f767f', roughness: 0.35, metalness: 0.9 } });
      }
      if (axles > 1) parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.4, gear.strut * 0.4, gear.spacing * (n - 1) + 0.1, 12).rotateX(Math.PI / 2).translate(ax, y0 + r, z), material: mat.metal });
    }
    if (axles > 1) parts.push({ geometry: new THREE.BoxGeometry(pitch * (axles - 1) + 0.3, gear.strut * 0.7, gear.strut * 0.7).translate(gear.x, y0 + r, z), material: mat.metal });
    const top = gear.top;
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.5, gear.strut * 0.5, gear.spacing * (n - 1) + 0.1, 12).rotateX(Math.PI / 2).translate(gear.x, y0 + r, z), material: mat.metal });
    if (gear.attach) {
      // A leg out from the body to a wheel beyond it (spring steel or strut legs of light aircraft).
      const zA = Math.sign(z || 1) * gear.attach.z;
      parts.push({ geometry: rod([gear.x, y0 + r, z - Math.sign(z || 1) * gear.tire.w * 0.6], [gear.x + (gear.attach.dx ?? 0), gear.attach.y, zA], gear.strut * 0.45, 10), material: { color: lv.gearLeg ?? '#d9dde2', roughness: 0.35, metalness: 0.4 } });
      return makeCompositePart(parts, { id, label, system: 'gear', info: partInfo(model, id) });
    }
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.42, gear.strut * 0.42, (top - y0 - r) * 0.55, 16).translate(gear.x, y0 + r + (top - y0 - r) * 0.275, z), material: { color: '#d9dde2', roughness: 0.15, metalness: 1 } });
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.6, gear.strut * 0.6, (top - y0 - r) * 0.55, 16).translate(gear.x, top - (top - y0 - r) * 0.275, z), material: { color: '#8d939b', roughness: 0.45, metalness: 0.6 } });
    const { links, brace } = gearLinkage(gear, y0 + r, z);
    parts.push({ geometry: links, material: mat.metal });
    parts.push({ geometry: brace, material: { color: '#8d939b', roughness: 0.45, metalness: 0.6 } });
    return makeCompositePart(parts, { id, label, system: 'gear', info: partInfo(model, id) });
  };
  if (g.gear.nose) root.add(leg(g.gear.nose, 0, 'nose-gear', 'Nose gear'));
  if (g.gear.tail) root.add(leg(g.gear.tail, 0, 'tail-wheel', 'Tail wheel'));
  // Main legs: one pair, or several (body and wing gear) as a list.
  for (const main of g.gear.mains ?? [{ ...g.gear.main, id: 'main-gear', label: 'main gear' }]) {
    for (const side of SIDES) root.add(leg(main, side.z * main.z, `${side.key}-${main.id}`, `${side.label} ${main.label}`));
  }

  for (const [i, pr] of (g.propellers ?? []).entries()) {
    const p = propeller(pr);
    root.add(makeCompositePart([
      { geometry: p.spinner, material: { color: lv.spinner ?? lv.belly ?? '#d9dde2', roughness: 0.3, clearcoat: 0.8 } },
      { geometry: p.blades, material: { color: '#22252a', roughness: 0.55, doubleSide: true } },
    ], { id: g.propellers.length > 1 ? `propeller-${i + 1}` : 'propeller', label: g.propellers.length > 1 ? `Propeller ${i + 1}` : 'Propeller', system: 'propulsion', info: partInfo(model, 'propeller', { Diameter: `${pr.diameter} m`, Blades: pr.blades }) }));
  }
  if (g.struts?.length) {
    for (const side of SIDES) {
      const geos = g.struts.map(s => strut([s.from[0], s.from[1], side.z * s.from[2]], [s.to[0], s.to[1], side.z * s.to[2]], s.chord ?? 0.12, s.thick ?? 0.04));
      root.add(makeCompositePart([{ geometry: mergeIndexed(geos), material: mat.surfaces ?? {} }], { id: `${side.key}-wing-struts`, label: `${side.label} wing struts`, system: 'structure', info: partInfo(model, 'struts') }));
    }
  }

  // Antennas, probes, beacons and the APU exhaust, placed on the body profile.
  if (g.details !== false) {
    const d = airframeDetails(body);
    root.add(makeCompositePart([
      { geometry: d.antennas, material: { color: lv.antenna ?? '#e4e7eb', roughness: 0.4 } },
    ], { id: 'antennas', label: 'Antennas and probes', system: 'avionics', info: partInfo(model, 'antennas') }));
    root.add(makeCompositePart([
      { geometry: d.beacons, material: { color: '#d1242b', roughness: 0.1, clearcoat: 1, metalness: 0.1 } },
    ], { id: 'beacons', label: 'Anti-collision beacons', system: 'lights', info: partInfo(model, 'beacons') }));
    // No APU disc when a pod (a center engine exhaust) already ends the tail.
    if (d.apu && !(g.pods ?? []).some(p => /exhaust/.test(p.id))) root.add(makeCompositePart([
      { geometry: d.apu, material: { color: '#121417', roughness: 0.8 } },
    ], { id: 'apu-exhaust', label: 'APU exhaust', system: 'propulsion', info: partInfo(model, 'apu-exhaust') }));
  }

  // Interior generated from the cabin layout: floor, seat rows, flight deck.
  if (g.cabin) {
    const c = g.cabin, floor = c.floor;
    const seat = () => {
      const parts = [
        new THREE.BoxGeometry(0.46, 0.12, 0.44).translate(0, 0.42, 0),
        new THREE.BoxGeometry(0.1, 0.72, 0.44).translate(0.22, 0.8, 0).rotateZ(-0.12),
        new THREE.BoxGeometry(0.1, 0.18, 0.3).translate(0.26, 1.2, 0),
        new THREE.BoxGeometry(0.44, 0.04, 0.05).translate(0, 0.62, 0.2),
        new THREE.BoxGeometry(0.44, 0.04, 0.05).translate(0, 0.62, -0.2),
        new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(0, 0.2, 0),
      ];
      return mergeIndexed(parts.map(p => p.toNonIndexed().index ? p : p));
    };
    const one = seat();
    const seats = [];
    for (let x = c.rows.from; x <= c.rows.to + 1e-6; x += c.rows.pitch) {
      for (const zc of c.rows.columns) seats.push(one.clone().translate(x, floor, zc));
    }
    const floorGeo = new THREE.BoxGeometry(c.rows.to - c.rows.from + 2.5, 0.06, c.floorWidth).translate((c.rows.from + c.rows.to) / 2, floor - 0.03, 0);
    root.add(makeCompositePart([
      { geometry: mergeIndexed(seats.map(q => q.index ? q : q)), material: { color: c.seatColor ?? '#2f4a6b', roughness: 0.8 } },
      { geometry: floorGeo, material: { color: '#5d6168', roughness: 0.9 } },
    ], { id: 'cabin', label: `Cabin (${seats.length} seats)`, system: 'interior', info: partInfo(model, 'cabin', { Seats: seats.length, Layout: `${c.rows.columns.length} abreast, ${Math.round(c.rows.pitch * 39.37)} in pitch` }) }));

    const fd = g.flightDeck;
    if (fd) {
      const dark = { color: '#23272e', roughness: 0.7 };
      const pilot = z => [
        new THREE.BoxGeometry(0.5, 0.12, 0.5).translate(fd.seatsX, floor + 0.45, z),
        new THREE.BoxGeometry(0.12, 0.85, 0.5).translate(fd.seatsX + 0.25, floor + 0.9, z),
      ];
      root.add(makeCompositePart([
        { geometry: mergeIndexed([...pilot(0.52), ...pilot(-0.52)]), material: { color: '#3b3f46', roughness: 0.8 } },
        { geometry: new THREE.BoxGeometry(0.3, 0.5, 1.5).translate(fd.panelX, floor + 0.6, 0), material: dark },
        { geometry: new THREE.BoxGeometry(0.42, 0.05, 1.5).translate(fd.panelX - 0.06, floor + 0.88, 0), material: dark },
        { geometry: new THREE.BoxGeometry(0.8, 0.5, 0.3).translate(fd.panelX + 0.5, floor + 0.55, 0), material: dark },
        { geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8).translate(fd.panelX + 0.35, floor + 0.55, 0.52), material: dark },
        { geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8).translate(fd.panelX + 0.35, floor + 0.55, -0.52), material: dark },
        { geometry: new THREE.BoxGeometry(0.04, 0.42, 1.3).translate(fd.panelX + 0.16, floor + 0.6, 0), material: { color: '#0d1a24', roughness: 0.2, metalness: 0.3 } },
      ], { id: 'flight-deck', label: 'Flight deck', system: 'interior', info: partInfo(model, 'flight-deck') }));
    }
  }

  // Sit the aircraft in its ground attitude (degrees, positive is nose down), as measured.
  if (g.attitude) {
    const sat = new THREE.Group();
    sat.add(root);
    root.rotation.z = THREE.MathUtils.degToRad(g.attitude);
    return sat;
  }
  return root;
}
