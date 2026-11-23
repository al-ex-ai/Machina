// Takeoff scene: the model on a runway, run up, rolled, rotated and flown off, with its gear, oleos,
// flaps, elevator, propellers and wheels moved by its own FlightGear animations (src/fg-anim.js).
// A scripted profile from the model's published takeoff figures, not a flight model.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fgAnimator } from './fg-anim.js';

const KT = 0.514444, FT = 3.28084;
const RUNWAY = { length: 3000, width: 45, start: 100 }; // the model starts 100 m past the threshold, facing -x

/** Runway, grass and a scatter of trees for a sense of speed. */
function buildScenery() {
  const g = new THREE.Group();
  g.name = 'takeoff-scenery';
  // The grass has a hole where the runway is: two surfaces stacked a little apart fight for depth (and
  // flicker) once the camera is a few hundred meters away.
  const field = new THREE.Shape().moveTo(-8000 - RUNWAY.length / 2, -8000).lineTo(8000 - RUNWAY.length / 2, -8000).lineTo(8000 - RUNWAY.length / 2, 8000).lineTo(-8000 - RUNWAY.length / 2, 8000).closePath();
  const hw0 = RUNWAY.width / 2, s0 = RUNWAY.start, e0 = RUNWAY.start - RUNWAY.length;
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
  tex.repeat.set(RUNWAY.length / 12, RUNWAY.width / 12);
  tex.anisotropy = 8;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.length, RUNWAY.width), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
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
  const s = RUNWAY.start, e = RUNWAY.start - RUNWAY.length, hw = RUNWAY.width / 2;
  for (const end of [s, e]) {
    const dir = end === s ? -1 : 1;
    for (let k = 0; k < 6; k++) for (const side of [1, -1]) strip(end + dir * 6, end + dir * 36, side * (3 + k * 3.2), 1.8);
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
    p.set(s + 400 - rnd() * (RUNWAY.length + 2400), 0, side * (140 + rnd() ** 1.6 * 1600));
    sc.set(h * 0.32, h, h * 0.32);
    trees.setMatrixAt(i, m.compose(p, q, sc));
  }
  trees.castShadow = false;
  g.add(trees);
  return g;
}

/** Points where the wheels of the named parts meet the ground, kept as mesh-space positions. */
function contactPoints(root, match) {
  const out = [];
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  root.traverse(o => {
    if (!o.userData?.part || !match.test(o.userData.id)) return;
    const list = [];
    let low = Infinity;
    o.traverse(c => {
      if (!c.isMesh) return;
      const rel = inv.clone().multiply(c.matrixWorld), a = c.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(rel); if (v.y < low + 0.03) { low = Math.min(low, v.y); list.push([c, i, v.y]); } }
    });
    for (const [c, i, y] of list) if (y < low + 0.03) out.push([c, new THREE.Vector3().fromBufferAttribute(c.geometry.attributes.position, i)]);
  });
  return out;
}

/** A point's position in root space from its mesh's current local matrices (no world update needed). */
function inRoot(root, mesh, p, out) {
  out.copy(p);
  for (let o = mesh; o && o !== root; o = o.parent) {
    if (o.matrixAutoUpdate) o.updateMatrix();
    out.applyMatrix4(o.matrix);
  }
  return out;
}

const smooth = (a, b, x) => { if (!(x > a)) return 0; if (!(x < b)) return 1; const t = (x - a) / (b - a); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

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
  const anim = fgAnimator(root, model);
  const scenery = buildScenery();
  viewer.scene.add(scenery);
  viewer.setOutdoor(true);

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const L = Math.max(size.x, size.z);
  let mains = contactPoints(root, /main-gear/);
  if (!mains.length) mains = contactPoints(root, /gear/);
  const pivot = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (const [c, p] of mains) pivot.add(inRoot(root, c, p, tmp));
  pivot.divideScalar(mains.length || 1);
  const lowestMain = () => { let y = Infinity; for (const [c, p] of mains) y = Math.min(y, inRoot(root, c, p, tmp).y); return mains.length ? y : 0; };

  // Profile from the published figures: constant acceleration to liftoff over the ground roll.
  const vr = cfg.vr_kt * KT, vlof = (cfg.lof_kt ?? cfg.vr_kt * 1.06) * KT, accel = (vlof * vlof) / (2 * cfg.roll_m);
  const RUNUP = 5, pitchMax = cfg.pitch_deg ?? 8, climb = cfg.climb_deg ?? 4, gearTime = cfg.gear_s ?? 8, flaps = cfg.flaps ?? 0;
  const gearProps = anim ? anim.props.filter(p => /position-norm$/.test(p)) : [];
  const mainComp = anim ? anim.props.filter(p => /gear\[[1-9]\]\/compression-norm$/.test(p)) : [];
  const noseComp = anim ? anim.props.filter(p => /gear\[0\]\/compression-norm$/.test(p)) : [];
  const rpmProps = anim ? anim.props.filter(p => /engines\/engine\[\d+\]\/rpm$/.test(p)) : [];
  const comp0 = anim ? Object.fromEntries([...mainComp, ...noseComp].map(p => [p, anim.values[p]])) : {};

  let s; // simulation state
  const reset = () => {
    s = { t: 0, x: 0, v: 0, h: 0, gamma: 0, pitch: 0, tR: null, tL: null, yLift: 0, wheel: 0, prop: 0, done: false };
    anim?.reset();
  };
  reset();

  function step(dt) {
    s.t += dt;
    const t = s.t;
    const rpm = t < 2 ? 700 : lerp(700, cfg.rpm ?? 2800, smooth(2, RUNUP, t));
    if (t > RUNUP) {
      const a = s.tL === null ? accel : accel * 0.35;
      s.v += a * dt;
    }
    if (s.tR === null && s.v >= vr) s.tR = t;
    if (s.tR !== null) s.pitch = Math.min(pitchMax, s.pitch + 2.6 * dt);
    if (s.tL === null && s.v >= vlof) { s.tL = t; s.yLift = -lowestMain(); }
    if (s.tL !== null) {
      s.gamma = THREE.MathUtils.degToRad(climb) * smooth(s.tL, s.tL + 5, t);
      s.h += s.v * Math.sin(s.gamma) * dt;
    }
    s.x += s.v * Math.cos(s.gamma) * dt;
    // Wheels roll with the ground speed and are braked after liftoff; the propellers are shown at a rate
    // the eye can follow (true rates alias into a standstill at screen frame rates).
    const groundV = s.tL === null ? s.v : s.v * Math.max(0, 1 - (t - s.tL) / 3);
    s.wheel += groundV * FT * 6 * dt;
    s.prop += lerp(300, 650, (rpm - 700) / 2100) * 6 * dt;
    if (anim) {
      const after = s.tL === null ? -1 : t - s.tL;
      for (const p of gearProps) anim.values[p] = after < 3 ? 1 : 1 - smooth(3, 3 + gearTime, after);
      const tR = s.tR ?? Infinity, tL = s.tL;
      for (const p of mainComp) anim.values[p] = comp0[p] * (1 - (tL !== null ? 1 : smooth(tR, tR + (vlof - vr) / accel, t)));
      for (const p of noseComp) anim.values[p] = comp0[p] * (1 - smooth(tR, tR + 1.2, t));
      const ele = t < tR - 0.4 ? 0 : tL === null ? -0.55 * smooth(tR - 0.4, tR + 0.6, t) : lerp(-0.55, -0.12, smooth(tL, tL + 8, t));
      for (const p of anim.props) {
        if (/elevator-pos-norm$/.test(p)) anim.values[p] = ele;
        else if (/flap-pos-norm$/.test(p)) anim.values[p] = flaps * (after < 14 ? 1 : 1 - smooth(14, 22, after));
        else if (/velocities\/uBody-fps$/.test(p)) anim.spin[p] = s.wheel;
      }
      for (const p of rpmProps) anim.spin[p] = s.prop;
      anim.apply();
    }
    if (s.tL !== null && t - s.tL > 32) s.done = true;
  }

  // Place the model: forward along -x, lifted so the main wheels stay on the ground until liftoff, pitched about them.
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), P = new THREE.Matrix4();
  const place = () => {
    const y = s.tL === null ? -lowestMain() : s.yLift + s.h;
    root.matrixAutoUpdate = false;
    M.makeTranslation(-s.x, y, 0).multiply(P.makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(R.makeRotationZ(-THREE.MathUtils.degToRad(s.pitch))).multiply(P.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    root.matrix.copy(M);
    root.matrixWorldNeedsUpdate = true;
  };

  // Cameras: follow (orbit freely while it tracks the model), runway (a spectator beside the runway
  // near the liftoff point) and chase (behind and above).
  const cam = viewer.camera, controls = viewer.controls;
  const focus = new THREE.Vector3(), last = new THREE.Vector3();
  let mode = 'follow';
  const setMode = m => {
    mode = m;
    controls.enabled = m === 'follow';
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
  const spot = new THREE.Vector3(-(cfg.roll_m * 0.92), 1.7, RUNWAY.width / 2 + 110);
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
    } else {
      cam.position.copy(focus).add(tmp.set(1.6 * L, 0.32 * L, 0.45 * L));
    }
    // The orbit controls re-aim the camera at their target every frame, even while disabled, before this
    // runs: aim now as well, or the view lags the model by a frame.
    controls.target.copy(focus);
    cam.lookAt(focus);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    viewer.sunAround(focus, L * 0.9);
  };

  let speed = 2;
  hud.hidden = false;
  hud.innerHTML = `
    <div class="to-read">
      <span class="to-phase" id="to-phase">Engine run-up</span>
      <span><b id="to-kt">0</b> kt</span><span><b id="to-ft">0</b> ft</span><span><b id="to-m">0</b> m</span>
    </div>
    <div class="to-bar" role="toolbar" aria-label="Takeoff controls">
      <span class="to-group" aria-label="Camera">${['follow', 'runway', 'chase'].map(c => `<button type="button" class="tool" data-cam="${c}" aria-pressed="false">${c[0].toUpperCase() + c.slice(1)}</button>`).join('')}</span>
      <span class="to-group" aria-label="Speed">${[1, 2, 4].map(k => `<button type="button" class="tool" data-speed="${k}" aria-pressed="${k === speed}">${k}×</button>`).join('')}</span>
      <button type="button" class="tool" data-to="replay">Replay</button>
      <button type="button" class="tool" data-to="exit">Exit</button>
    </div>
    <p class="to-note">Scripted from published takeoff figures (V<sub>R</sub> ${cfg.vr_kt} kt, ${cfg.roll_m.toLocaleString('en')} m roll). Gear, flaps and elevator move by the model's own animations.</p>`;
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
    if (s.t < RUNUP) return 'Engine run-up';
    if (s.tR === null) return 'Takeoff roll';
    if (s.tL === null) return 'Rotate';
    const a = s.t - s.tL;
    return a < 3 ? 'Liftoff' : a < 3 + gearTime ? 'Gear up' : s.done ? 'Climb out' : 'Climb';
  };
  const stopLoop = viewer.animate(now => {
    const dt = Math.min(0.05, (now - prev) / 1000) * speed;
    prev = now;
    if (!s.done) {
      for (let k = 0, n = Math.ceil(dt / 0.01); k < n; k++) step(dt / n);
      place();
    }
    aim();
    $('#to-phase').textContent = phase();
    $('#to-kt').textContent = Math.round(s.v / KT);
    $('#to-ft').textContent = Math.round(s.h * FT);
    $('#to-m').textContent = Math.round(s.x).toLocaleString('en');
    return true;
  });

  return function stop() {
    stopLoop();
    viewer.scene.remove(scenery);
    scenery.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } });
    anim?.reset();
    root.matrix.identity();
    root.matrixAutoUpdate = true;
    root.matrixWorldNeedsUpdate = true;
    controls.enabled = true;
    cam.fov = fov0;
    cam.updateProjectionMatrix();
    hud.hidden = true;
    hud.innerHTML = '';
    viewer.setOutdoor(false);
  };
}
