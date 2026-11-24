// Takeoff scene: the model on a runway, run up, rolled, rotated and flown off, with its gear, oleos,
// flaps, elevator, propellers and wheels moved by its own FlightGear animations (src/fg-anim.js).
// A scripted profile from the model's published takeoff figures, not a flight model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createTakeoffSim, captainEye } from './takeoff-sim.js';

const KT = 0.514444, FT = 3.28084;
const RUNWAY = { length: 3000, width: 45, start: 100 }; // the model starts 100 m past the threshold, facing -x

/** Runway, grass and a scatter of trees for a sense of speed. width: meters, wide enough for the wings. */
function buildScenery(width) {
  const RW = { ...RUNWAY, width };
  const g = new THREE.Group();
  g.name = 'takeoff-scenery';
  // The grass has a hole where the runway is: two surfaces stacked a little apart fight for depth (and
  // flicker) once the camera is a few hundred meters away.
  const field = new THREE.Shape().moveTo(-8000 - RUNWAY.length / 2, -8000).lineTo(8000 - RUNWAY.length / 2, -8000).lineTo(8000 - RUNWAY.length / 2, 8000).lineTo(-8000 - RUNWAY.length / 2, 8000).closePath();
  const hw0 = RW.width / 2, s0 = RUNWAY.start, e0 = RUNWAY.start - RUNWAY.length;
  field.holes.push(new THREE.Path().moveTo(e0, -hw0).lineTo(e0, hw0).lineTo(s0, hw0).lineTo(s0, -hw0).closePath());
  const grass = new THREE.Mesh(new THREE.ShapeGeometry(field), new THREE.MeshStandardMaterial({ color: '#7d8f5c', roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  g.add(grass);
  // Asphalt with a little grain, so speed reads even where there are no markings.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#55595d';
  ctx.fillRect(0, 0, 256, 256);
  // Soft patches a few pixels across, not single-pixel grain: fine grain sparkles as the runway slides past.
  for (let i = 0; i < 1400; i++) { const l = 78 + Math.random() * 24; ctx.fillStyle = `rgba(${l},${l + 2},${l + 4},0.35)`; ctx.beginPath(); ctx.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 6, 0, 7); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(RUNWAY.length / 12, RW.width / 12);
  tex.anisotropy = 8;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.length, RW.width), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.set(RUNWAY.start - RUNWAY.length / 2, 0, 0);
  asphalt.receiveShadow = true;
  g.add(asphalt);
  // Markings, all in one mesh: threshold bars, centerline, aiming points, touchdown zones, edge lines.
  const strips = [];
  const strip = (x0, x1, z, w) => {
    const p = new THREE.PlaneGeometry(Math.abs(x1 - x0), w);
    p.rotateX(-Math.PI / 2);
    p.translate((x0 + x1) / 2, 0.04, z);
    strips.push(p);
  };
  const s = RUNWAY.start, e = RUNWAY.start - RUNWAY.length, hw = RW.width / 2;
  for (const end of [s, e]) {
    const dir = end === s ? -1 : 1;
    for (let k = 0; k < Math.max(6, Math.floor((hw - 4) / 3.2)); k++) for (const side of [1, -1]) strip(end + dir * 6, end + dir * 36, side * (3 + k * 3.2), 1.8);
    for (const side of [1, -1]) strip(end + dir * 400, end + dir * 445, side * 9, 6);
    for (const d of [150, 300, 600, 750, 900]) for (const side of [1, -1]) for (let b = 0; b < (d < 400 ? 3 : d < 700 ? 2 : 1); b++) strip(end + dir * d, end + dir * (d + 22.5), side * (6 + b * 1.6), 1);
  }
  for (let x = s - 50; x > e + 50; x -= 50) strip(x, x - 30, 0, 0.9);
  for (const side of [1, -1]) strip(s, e, side * (hw - 0.6), 0.9);
  const marks = new THREE.Mesh(mergeGeometries(strips), new THREE.MeshStandardMaterial({ color: '#e9ebe6', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
  marks.receiveShadow = true;
  g.add(marks);
  const m = new THREE.Matrix4();
  // Trees, seeded so the scene is the same every time.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const crown = new THREE.ConeGeometry(1, 1, 7);
  crown.translate(0, 0.5, 0);
  const trees = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#3f5a33', roughness: 1, flatShading: true }), 900);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < trees.count; i++) {
    const side = rnd() < 0.5 ? -1 : 1, h = 7 + rnd() * 9;
    p.set(s + 400 - rnd() * (RUNWAY.length + 2400), 0, side * (hw + 120 + rnd() ** 1.6 * 1600)); // clear of the runway spotter at hw + 110
    sc.set(h * 0.32, h, h * 0.32);
    trees.setMatrixAt(i, m.compose(p, q, sc));
  }
  trees.castShadow = false;
  g.add(trees);
  return g;
}

/**
 * Propeller blur. Each propeller (meshes spun by an engine's rpm, grouped by their spin axis) gets a faint
 * disc the size of its blades; set(k) fades the blades out and the disc in (0 standing, 1 at power).
 * Hubs and spinners, close to the axis, stay solid.
 */
function propellerBlur(root, anim) {
  const groups = new Map();
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  for (const o of anim?.meshes ?? []) {
    // Piston propellers turn with rpm, turboprops (the Twin Otter) with n2; jet fans (n1) stay as they are.
    const fa = o.userData.fgAnim, t = fa.chain.find(t => t.type === 'spin' && /engines\/engine\[\d+\]\/(rpm|n2)$/.test(t.prop));
    if (!t) continue;
    // Some models spin their wheels on a spare engine's rpm (the Tu-144D): those are not propellers.
    let part = o; while (part && !part.userData.part) part = part.parent;
    if (part?.userData.system === 'gear') continue;
    // F maps the file's space into the mesh's parent; the disc hangs off the root.
    const P = toRoot.clone().multiply(o.parent.matrixWorld).multiply(fa.F);
    const center = new THREE.Vector3(...t.origin).applyMatrix4(P), axis = new THREE.Vector3(...t.axis).transformDirection(P);
    const key = center.toArray().map(c => c.toFixed(2)).join(',');
    if (!groups.has(key)) groups.set(key, { center, axis, meshes: [] });
    groups.get(key).meshes.push(o);
  }
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  const blades = [], discs = [], saved = new Map();
  const ring = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.2, 'rgba(255,255,255,0.35)');
    r.addColorStop(0.85, 'rgba(255,255,255,0.7)'); r.addColorStop(0.97, 'rgba(255,255,255,0.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  for (const { center, axis, meshes } of groups.values()) {
    // Distance from the spin axis of every vertex: the propeller's radius, and which meshes are blades.
    let R = 0, along = 0, n = 0;
    const reach = new Map();
    for (const o of meshes) {
      const a = o.geometry.attributes.position, M = toRoot.clone().multiply(o.matrixWorld);
      let r = 0;
      for (let i = 0; i < a.count; i++) {
        d.copy(v.fromBufferAttribute(a, i).applyMatrix4(M)).sub(center);
        const x = d.dot(axis);
        r = Math.max(r, d.addScaledVector(axis, -x).length());
        along += x; n++;
      }
      reach.set(o, r);
      R = Math.max(R, r);
    }
    if (R < 0.3) continue;
    for (const o of meshes) if (reach.get(o) > 0.45 * R) blades.push(o);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ color: '#9aa1a8', alphaMap: ring, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    disc.position.copy(center).addScaledVector(axis, n ? along / n : 0);
    disc.visible = false;
    disc.name = 'propeller-blur';
    root.add(disc);
    discs.push(disc);
  }
  return {
    set(k) {
      for (const o of blades) {
        if (!saved.has(o)) { saved.set(o, o.material); o.material = [o.material].flat().map(m => m.clone()); if (!Array.isArray(saved.get(o))) o.material = o.material[0]; }
        for (const m of [o.material].flat()) { m.transparent = k > 0; m.opacity = 1 - 0.94 * k; m.depthWrite = k < 0.5; }
      }
      for (const disc of discs) { disc.visible = k > 0.02; disc.material.opacity = 0.24 * k; }
    },
    dispose() {
      for (const [o, m] of saved) { [o.material].flat().forEach(x => x.dispose()); o.material = m; }
      saved.clear();
      for (const disc of discs) { root.remove(disc); disc.geometry.dispose(); disc.material.dispose(); }
      ring.dispose();
    },
  };
}


/**
 * @param {ReturnType<import('./scene.js').createViewer>} viewer the model page's viewer, with the model on stage
 * @param {any} model catalog entry with a takeoff block
 * @param {HTMLElement} hud element to draw the readout and controls into
 * @param {() => void} onExit called when the user leaves the scene
 * @returns {() => void} stops the scene and puts the studio back
 */
export function startTakeoff(viewer, model, hud, onExit) {
  const root = viewer.getModel();
  const cfg = model.takeoff;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  // Real runways are 45 to 60 m wide and the biggest wings overhang them; here the wingtips stay over the asphalt.
  const width = Math.max(RUNWAY.width, Math.ceil((size.z + 16) / 5) * 5);
  const scenery = buildScenery(width);
  viewer.scene.add(scenery);
  viewer.setOutdoor(true);

  const L = Math.max(size.x, size.z);
  let blur = null;
  const sim = createTakeoffSim(root, model, { blur: a => blur?.set(a) });
  const { anim, vr, RUNUP, gearTime, gearProps, tail, step, place } = sim;
  blur = propellerBlur(root, anim);
  const reset = () => { sim.reset(); blur.set(0); };

  // Cameras: follow (orbit freely while it tracks the model), runway (a spectator beside the runway
  // near the liftoff point), chase (behind and above) and cockpit (from the captain's eyes, the captain
  // figure hidden, with a near plane close enough for the panel).
  const cam = viewer.camera, controls = viewer.controls;
  const focus = new THREE.Vector3(), last = new THREE.Vector3(), tmp = new THREE.Vector3();
  const pilot = captainEye(root, cfg.cockpit);
  const near0 = cam.near;
  // From inside, glass is mostly clear (sim liveries and tints are made to be seen from outside).
  const glass = [], skins = new Map();
  root.traverse(o => { if (!o.isMesh) return; let p = o; while (p && !p.userData.part) p = p.parent; if (p?.userData.system === 'glazing') for (const m of [o.material].flat()) glass.push([m, m.transparent, m.opacity]); });
  for (const o of pilot.oneSided) for (const m of [o.material].flat()) skins.set(m, m.side);
  const inside = on => {
    for (const o of pilot.hide) o.visible = !on;
    for (const [m, t, op] of glass) { m.transparent = on || t; m.opacity = on ? Math.min(op, 0.18) : op; m.needsUpdate = true; }
    for (const [m, side] of skins) { m.side = on ? THREE.FrontSide : side; m.needsUpdate = true; }
  };
  let mode = 'follow';
  const setMode = m => {
    mode = m;
    controls.enabled = m === 'follow';
    inside(m === 'cockpit');
    const near = m === 'cockpit' ? 0.08 : near0;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    if (m === 'follow') {
      focus.copy(center).applyMatrix4(root.matrix);
      cam.position.copy(focus).add(new THREE.Vector3(-1.25 * L, 0.2 * L, 0.95 * L));
      controls.target.copy(focus);
      last.copy(focus);
      controls.update();
    }
    hud.querySelectorAll('[data-cam]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === m)));
  };
  // A spotter beside the runway just short of the liftoff point, with a long lens that keeps the model
  // about a third of the frame wide however far away it is.
  const spot = new THREE.Vector3(-(cfg.roll_m * 0.92), 1.7, width / 2 + 110);
  const fov0 = cam.fov;
  const aim = () => {
    focus.copy(center).applyMatrix4(root.matrix);
    let fov = fov0;
    if (mode === 'follow') {
      cam.position.add(tmp.copy(focus).sub(last));
      last.copy(focus);
    } else if (mode === 'runway') {
      cam.position.copy(spot);
      fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((L * 1.5) / (2 * spot.distanceTo(focus)))), 4, fov0);
    } else if (mode === 'cockpit') {
      // Eyes on the captain's seat, looking ahead and a little down over the nose, pitching with the model.
      cam.position.copy(pilot.eye).applyMatrix4(root.matrix);
      focus.copy(pilot.eye).add(tmp.set(-20, -2.4, 0)).applyMatrix4(root.matrix);
      fov = 70;
    } else {
      cam.position.copy(focus).add(tmp.set(1.6 * L, 0.32 * L, 0.45 * L));
    }
    // The orbit controls re-aim the camera at their target every frame, even while disabled, before this
    // runs: aim now as well, or the view lags the model by a frame.
    controls.target.copy(focus);
    cam.lookAt(focus);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    viewer.sunAround(tmp.copy(center).applyMatrix4(root.matrix), L * 0.9);
  };

  let speed = 2;
  const runupLabel = cfg.jet ? 'Spool up' : 'Engine run-up';
  const moved = !anim ? '' : `${gearProps.length ? 'Gear, flaps' : 'Flaps'} and elevator move by the model's own animations.`;
  hud.hidden = false;
  hud.innerHTML = `
    <div class="to-read">
      <span class="to-phase" id="to-phase">${runupLabel}</span>
      <span><b id="to-kt">0</b> kt</span><span><b id="to-ft">0</b> ft</span><span><b id="to-m">0</b> m</span>
    </div>
    <div class="to-bar" role="toolbar" aria-label="Takeoff controls">
      <span class="to-group" aria-label="Camera">${['follow', 'cockpit', 'runway', 'chase'].map(c => `<button type="button" class="tool" data-cam="${c}" aria-pressed="false">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</span>
      <span class="to-group" aria-label="Speed">${[1, 2, 4].map(k => `<button type="button" class="tool" data-speed="${k}" aria-pressed="${k === speed}">${k}×</button>`).join('')}</span>
      <button type="button" class="tool" data-to="replay">Replay</button>
      <button type="button" class="tool" data-to="exit">Exit</button>
    </div>
    <p class="to-note">Scripted from published takeoff figures (V<sub>R</sub> ${cfg.vr_kt} kt, ${cfg.roll_m.toLocaleString('en')} m roll). ${moved}</p>`;
  const $ = sel => hud.querySelector(sel);
  hud.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.cam)));
  hud.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    hud.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('[data-to="replay"]').addEventListener('click', () => { reset(); place(); setMode(mode); });
  $('[data-to="exit"]').addEventListener('click', () => onExit());

  place();
  setMode('follow');
  let prev = performance.now();
  const phase = () => {
    if (sim.s.t < RUNUP) return runupLabel;
    if (sim.s.tR === null) return tail && sim.s.v > 0.5 * vr ? 'Tail up' : 'Takeoff roll';
    if (sim.s.tL === null) return 'Rotate';
    const a = sim.s.t - sim.s.tL;
    return a < 3 ? 'Liftoff' : gearProps.length && a < 3 + gearTime ? 'Gear up' : sim.s.done ? 'Climb out' : 'Climb';
  };
  const stopLoop = viewer.animate(now => {
    const dt = Math.min(0.05, (now - prev) / 1000) * speed;
    prev = now;
    if (!sim.s.done) {
      for (let k = 0, n = Math.ceil(dt / 0.01); k < n; k++) step(dt / n);
      place();
    }
    aim();
    $('#to-phase').textContent = phase();
    $('#to-kt').textContent = Math.round(sim.s.v / KT);
    $('#to-ft').textContent = Math.round(sim.s.h * FT);
    $('#to-m').textContent = Math.round(sim.s.x).toLocaleString('en');
    return true;
  });

  return function stop() {
    stopLoop();
    viewer.scene.remove(scenery);
    scenery.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    blur.dispose();
    anim?.reset();
    root.matrix.identity();
    root.matrixAutoUpdate = true;
    root.matrixWorldNeedsUpdate = true;
    controls.enabled = true;
    inside(false);
    cam.near = near0;
    cam.fov = fov0;
    cam.updateProjectionMatrix();
    hud.hidden = true;
    hud.innerHTML = '';
    viewer.setOutdoor(false);
  };
}
