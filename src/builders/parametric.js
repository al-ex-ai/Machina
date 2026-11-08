// Parametric fixed-wing builder (v2): fuselage lofted through measured cross-sections,
// wings and tails lofted from NACA airfoils along the true planform, nacelles lofted
// the same way, and landing gear sized from tire data. Every number comes from the
// model file, every part is named by construction, and the size is exact by design.
import * as THREE from 'three';
import { makePart, makeCompositePart, partInfo } from '../parts/common.js';
import { bodyProfile, loftBody, mergeIndexed } from '../parametric/body.js';
import { surfacePlan, surfacePiece, mirrorZ } from '../parametric/surface.js';
import { paintFuselage, paintFin, sideUV } from '../parametric/livery.js';

const SIDES = [{ key: 'left', label: 'Left', z: 1 }, { key: 'right', label: 'Right', z: -1 }];

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
  root.add(makePart(loftBody(body, { length: L, segments: 128 }), {
    id: 'fuselage', label: 'Fuselage', system: 'structure', keepNormals: true,
    material: tex ? { map: tex, color: '#ffffff', roughness: 0.32, clearcoat: 0.8 } : { color: lv.base },
    info: partInfo(model, 'fuselage', { Length: `${L} m` }),
  }));
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
  for (const s of g.surfaces) {
    const plan = surfacePlan(s);
    const pieces = new Map();
    for (const seg of s.segments) {
      for (const [c0, c1, key] of seg.split) {
        if (!pieces.has(key)) pieces.set(key, []);
        pieces.get(key).push(surfacePiece(plan, seg.from, seg.to, c0, c1));
      }
    }
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

  // Engines: lofted nacelle, recessed fan with spinner, exhaust plug, pylon
  if (g.engine) {
    const e = g.engine;
    const nac = bodyProfile(e.nacelle.stations, e.nacelle);
    const length = nac.x1;
    const inlet = nac.at(0);
    const rFan = e.fan.radius;
    const fanX = e.fan.depth;
    const fanY = inlet.mid + (e.fan.offsetY ?? 0); // the fan sits above a flattened inlet floor
    const plug = new THREE.LatheGeometry(e.plug.map(([x, r]) => new THREE.Vector2(r, x)), 32).rotateZ(-Math.PI / 2);
    const spinner = new THREE.ConeGeometry(rFan * 0.32, rFan * 0.75, 32).rotateZ(Math.PI / 2).translate(fanX - rFan * 0.37, fanY, 0);
    plug.translate(0, (nac.at(length).mid), 0);
    const duct = new THREE.CylinderGeometry(rFan * 1.02, rFan * 1.02, fanX, 48, 1, true).rotateZ(Math.PI / 2).translate(fanX / 2, fanY, 0);
    const fan = new THREE.CircleGeometry(rFan, 48).rotateY(-Math.PI / 2).translate(fanX, fanY, 0);
    // Inlet lip: a ring from the nacelle's outer edge in to the round fan duct.
    const lip = (() => {
      const S = 72, pos = [], idx = [];
      const v = new THREE.Vector3();
      for (let j = 0; j <= S; j++) {
        const t = (j / S) * Math.PI * 2;
        nac.point(0, t, v);
        pos.push(v.x, v.y, v.z, 0.02, fanY + rFan * 1.02 * Math.cos(t), rFan * 1.02 * Math.sin(t));
      }
      for (let j = 0; j < S; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      return geo;
    })();
    const pylonPlan = surfacePlan({ axis: 'y', sections: e.pylon.sections });
    const pylon = surfacePiece(pylonPlan, e.pylon.sections[0].at, e.pylon.sections.at(-1).at, 0, 1);
    for (const side of SIDES) {
      const place = geo => geo.clone().translate(e.position.x, e.position.y, side.z * e.position.z);
      const pyl = pylon.clone().translate(0, 0, side.z * e.position.z);
      root.add(makeCompositePart([
        { geometry: place(loftBody(nac, { length, segments: 72, capStart: false })), material: { color: lv.nacelle ?? lv.belly, roughness: 0.32, clearcoat: 0.8 } },
        { geometry: place(lip), material: mat.metal },
        { geometry: place(duct), material: { color: '#2b3038', roughness: 0.6, metalness: 0.4, doubleSide: true } },
        { geometry: place(fan), material: { color: '#1c2026', roughness: 0.4, metalness: 0.7 } },
        { geometry: place(spinner), material: mat.metal },
        { geometry: place(plug), material: { color: '#6c727b', roughness: 0.5, metalness: 0.8 } },
        { geometry: pyl, material: { color: lv.pylon ?? '#d7dbe0', roughness: 0.4 } },
      ], { id: `${side.key}-engine`, label: `${side.label} engine (${e.name})`, system: 'propulsion', info: partInfo(model, 'engine') }));
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
  const tire = (d, w) => {
    const r = d / 2, k = w * 0.32;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 16;
      pts.push(new THREE.Vector2(r - k + Math.cos(a) * k, (w / 2) * Math.sin(a) * 1.05));
    }
    pts.unshift(new THREE.Vector2(r * 0.55, -w / 2)); pts.push(new THREE.Vector2(r * 0.55, w / 2));
    return new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2);
  };
  const leg = (gear, z, id, label) => {
    const r = gear.tire.d / 2;
    const y0 = gear.bottom ?? 0; // tire bottom in body axes (below 0 when the aircraft sits nose down)
    const parts = [];
    const n = gear.wheels;
    for (let i = 0; i < n; i++) {
      const dz = (i - (n - 1) / 2) * gear.spacing;
      parts.push({ geometry: tire(gear.tire.d, gear.tire.w).translate(gear.x, y0 + r, z + dz), material: { color: '#1b1d20', roughness: 0.85, metalness: 0 } });
      parts.push({ geometry: new THREE.CylinderGeometry(r * 0.55, r * 0.55, gear.tire.w * 0.9, 24).rotateX(Math.PI / 2).translate(gear.x, y0 + r, z + dz), material: { color: '#9aa1aa', roughness: 0.4, metalness: 0.8 } });
    }
    const top = gear.top;
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.5, gear.strut * 0.5, gear.spacing * (n - 1) + 0.1, 12).rotateX(Math.PI / 2).translate(gear.x, y0 + r, z), material: mat.metal });
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.42, gear.strut * 0.42, (top - y0 - r) * 0.55, 16).translate(gear.x, y0 + r + (top - y0 - r) * 0.275, z), material: { color: '#d9dde2', roughness: 0.15, metalness: 1 } });
    parts.push({ geometry: new THREE.CylinderGeometry(gear.strut * 0.6, gear.strut * 0.6, (top - y0 - r) * 0.55, 16).translate(gear.x, top - (top - y0 - r) * 0.275, z), material: { color: '#8d939b', roughness: 0.45, metalness: 0.6 } });
    return makeCompositePart(parts, { id, label, system: 'gear', info: partInfo(model, id) });
  };
  root.add(leg(g.gear.nose, 0, 'nose-gear', 'Nose gear'));
  for (const side of SIDES) root.add(leg(g.gear.main, side.z * g.gear.main.z, `${side.key}-main-gear`, `${side.label} main gear`));

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
