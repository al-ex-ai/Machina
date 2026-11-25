// The takeoff profile and pose, without the scene: the model's own animations driven from published
// figures, and where the model sits on the runway at each moment. src/takeoff.js draws it;
// src/takeoff-check.js plays it frame by frame in Node to check nothing goes through the runway.
import * as THREE from 'three';
import { fgAnimator } from './fg-anim.js';

const KT = 0.514444, FT = 3.28084;

/** Points where the wheels of the named parts meet the ground, kept as mesh-space positions. */
export function contactPoints(root, match) {
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
export function inRoot(root, mesh, p, out) {
  out.copy(p);
  for (let o = mesh; o && o !== root; o = o.parent) {
    if (o.matrixAutoUpdate) o.updateMatrix();
    out.applyMatrix4(o.matrix);
  }
  return out;
}

export const smooth = (a, b, x) => { if (!(x > a)) return 0; if (!(x < b)) return 1; const t = (x - a) / (b - a); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {THREE.Object3D} root a loaded model in its studio pose
 * @param {any} model catalog entry with a takeoff block
 * @param {{ blur?: (amount: number) => void }} [opts] blur: called each step with how far the propellers are spun up (0..1)
 */
export function createTakeoffSim(root, model, opts = {}) {
  const cfg = model.takeoff;
  const anim = fgAnimator(root, model);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const L = Math.max(size.x, size.z);
  let mains = contactPoints(root, cfg.mains ? new RegExp(cfg.mains) : /main-gear|body-gear|wing-gear/);
  if (!mains.length) {
    // One part holds every wheel (or skid): keep the rearmost contacts for a nose-wheel airplane,
    // the foremost for a tailwheel one.
    mains = contactPoints(root, /gear|skid/);
    if (!mains.length) mains = contactPoints(root, /./);
    const xs = mains.map(([c, p]) => inRoot(root, c, p, new THREE.Vector3()).x), lo = Math.min(...xs), hi = Math.max(...xs);
    if (hi - lo > 0.2 * L) mains = mains.filter((_, i) => cfg.tailwheel ? xs[i] < lo + 0.25 * (hi - lo) : xs[i] > hi - 0.25 * (hi - lo));
  }
  const pivot = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (const [c, p] of mains) pivot.add(inRoot(root, c, p, tmp));
  pivot.divideScalar(mains.length || 1);
  // On the ground the lowest of every gear contact sits on the runway, not only the mains: a nose oleo
  // extending as it unloads must lift the airplane, never sink into the ground.
  // The runway carries the true lowest point of the gear each moment: fixed contact vertices ride up
  // with a spinning tyre and would sink the airplane into the ground as the wheels turn.
  const gearMeshes = [];
  root.traverse(o => { if (o.isMesh) { let p = o; while (p && !p.userData.part) p = p.parent; if (p && /gear|skid/.test(p.userData.id)) gearMeshes.push(o); } });
  if (!gearMeshes.length) root.traverse(o => { if (o.isMesh) gearMeshes.push(o); });
  const toRoot = new THREE.Matrix4(), gv = new THREE.Vector3();
  // Lowest point with the model pitched as it will be placed (rear wheels swing down as the nose comes up).
  const pitched = new THREE.Matrix4(), PZ = new THREE.Matrix4();
  const lowestMain = () => {
    let y = Infinity;
    pitched.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(PZ.makeRotationZ(-THREE.MathUtils.degToRad(s.pitch))).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    for (const o of gearMeshes) {
      let shown = true;
      toRoot.identity();
      for (let q = o; q && q !== root; q = q.parent) { if (!q.visible) { shown = false; break; } if (q.matrixAutoUpdate) q.updateMatrix(); toRoot.premultiply(q.matrix); }
      if (!shown) continue;
      toRoot.premultiply(pitched);
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) y = Math.min(y, gv.fromBufferAttribute(a, i).applyMatrix4(toRoot).y);
    }
    return y === Infinity ? 0 : y;
  };

  // Profile from the published figures: constant acceleration to liftoff over the ground roll.
  const vr = cfg.vr_kt * KT, vlof = (cfg.lof_kt ?? cfg.vr_kt * 1.06) * KT, accel = (vlof * vlof) / (2 * cfg.roll_m);
  const RUNUP = 5, pitchMax = cfg.pitch_deg ?? 8, climb = cfg.climb_deg ?? 4, gearTime = cfg.gear_s ?? 8, flaps = cfg.flaps ?? 0;
  const gearProps = anim ? anim.props.filter(p => /position-norm$/.test(p)) : [];
  const mainComp = anim ? anim.props.filter(p => /gear\[[1-9]\]\/compression-norm$/.test(p)) : [];
  const noseComp = anim ? anim.props.filter(p => /gear\[0\]\/compression-norm$/.test(p)) : [];
  const rpmProps = anim ? anim.props.filter(p => /engines\/engine\[\d+\]\/(rpm|n1|n2)$/.test(p)) : [];
  // Tailwheel airplanes run with the tail raised once the elevator bites, then fly off near level.
  const tail = cfg.tailwheel ? (cfg.tail_deg ?? 10) : 0;
  const comp0 = anim ? Object.fromEntries([...mainComp, ...noseComp].map(p => [p, anim.values[p]])) : {};
  // Surfaces rest where the model was drawn (poseState), and move from there.
  const rest = anim ? { ...anim.values } : {};
  const blur = { set: opts.blur ?? (() => {}) };

  // The cockpit (src/fg-anim.js moves its needles, digit drums, levers and controls): what the airplane is
  // doing, engine readings from how far the engines are spun up (power 0 idle .. 1 takeoff), and what the
  // crew does with the yoke, pedals, throttles, flap and gear levers, brakes and speedbrake.
  // One setter per property, matched once; the props the airframe animates itself are not touched here.
  const RULES = [
    [/airspeed-indicator\/indicated-speed(-numbers)?-kt$|^velocities\/airspeed-kt$/, c => c.kt],
    [/indicated-mach$/, c => c.kt / 661.5],
    [/altimeter(\[\d+\])?\/indicated-altitude-ft$|^position\/altitude-agl-ft$|radar-altitude-ft$/, c => c.ft],
    [/setting-inhg$/, () => 29.92],
    [/setting-hpa$/, () => 1013],
    [/vertical-speed-fpm$|indicated-speed-fpm$/, c => c.fpm],
    [/^velocities\/vertical-speed-fps$/, c => c.fpm / 60],
    [/^orientation\/pitch-deg$|attitude-indicator(\[\d+\])?\/indicated-pitch-deg$/, c => c.pitch],
    [/heading(-indicator)?.*heading-deg$|magnetic-compass\/indicated-heading-deg$|^orientation\/heading-deg$/, () => 270],
    [/^engines\/engine(\[\d+\])?\/n1$/, c => lerp(21, 92, c.power)],
    [/^engines\/engine(\[\d+\])?\/n2$/, c => lerp(60, 97, c.power)],
    [/^engines\/engine(\[\d+\])?\/rpm$/, c => c.rpm],
    [/egt-degf$/, c => lerp(850, 1550, c.power)],
    [/egt-degc$/, c => lerp(450, 850, c.power)],
    [/fuel-flow_pph$/, c => lerp(900, 6800, c.power)],
    [/fuel-flow-gph$/, c => lerp(2, 14, c.power)],
    [/mp-(osi|inhg)$/, c => lerp(14, 29, c.power)],
    [/oil-pressure-psi$/, () => 62],
    [/oil-temperature-degf$/, () => 175],
    [/cht-degf$/, c => lerp(300, 400, c.power)],
    [/epr$/, c => lerp(1.02, 1.6, c.power)],
    [/torque-ftlb$/, c => lerp(150, 1900, c.power)],
    [/thrust_lb$/, c => lerp(1000, 20000, c.power)],
    // Soviet panels in metric units (the Tu-144D's JSBSim gauges).
    [/\/V(target)?-km_h$|\/V_g-km_h(\[\d+\])?$/, c => c.kt * 1.852],
    [/\/H-m$/, c => c.ft / 3.28084],
    [/\/Habs-dot-m_s$/, c => c.fpm / 196.85],
    [/\/gauge\/M$/, c => c.kt / 661.5],
    [/propulsion\/engine(\[\d+\])?\/panel\/gauge\/n$/, c => lerp(60, 97, c.power)],
    [/propulsion\/engine(\[\d+\])?\/panel\/gauge\/egt-degC$/, c => lerp(450, 850, c.power)],
    [/propulsion\/engine(\[\d+\])?\/panel\/gauge\/throttle-pos-deg$/, c => c.throttle * 70],
    [/hydr\/panel\/gauge\/P-kgf_cm2(\[\d+\])?$/, () => 210],
    [/gear\/panel\/gauge\/brake-kgf_cm2(\[\d+\])?$/, c => c.brake * 100],
    [/^controls\/flight\/elevator$/, c => c.ele],
    [/^controls\/flight\/aileron$/, c => c.ail],
    [/^surface-positions\/left-aileron-pos-norm$/, c => c.ail],
    [/^surface-positions\/right-aileron-pos-norm$/, c => -c.ail],
    [/^controls\/flight\/rudder$/, c => c.rud],
    // JSBSim's surface angles, which some yokes and pedals follow (about 20 degrees of travel each way).
    [/^fcs\/elevator-pos-rad$/, c => c.ele * 0.35], [/^fcs\/elevator-pos-deg$/, c => c.ele * 20], [/^fcs\/elevator-pos-norm$/, c => c.ele],
    [/^fcs\/left-aileron-pos-rad$/, c => c.ail * 0.3], [/^fcs\/right-aileron-pos-rad$/, c => -c.ail * 0.3],
    [/^fcs\/left-aileron-pos-deg$/, c => c.ail * 17], [/^fcs\/right-aileron-pos-deg$/, c => -c.ail * 17],
    [/^fcs\/(left|right)-aileron-pos-norm$/, (c, p) => (/right/.test(p) ? -c.ail : c.ail)],
    [/^fcs\/rudder-pos-rad$/, c => c.rud * 0.4], [/^fcs\/rudder-pos-deg$/, c => c.rud * 23], [/^fcs\/rudder-pos-norm$/, c => c.rud],
    [/^controls\/flight\/flaps$/, c => c.flapLever],
    [/^controls\/flight\/(speedbrake|spoilers)$|^surface-positions\/speedbrake-pos-norm$|spoiler.*-pos-norm$/, c => c.speedbrake],
    [/^controls\/engines\/engine(\[\d+\])?\/throttle$/, c => c.throttle],
    [/^controls\/engines\/engine(\[\d+\])?\/(mixture|condition)$/, () => 1], // propeller pitch stays where drawn: on some models it turns the blades
    [/^controls\/engines\/engine(\[\d+\])?\/reverser$/, c => c.reverse],
    [/^controls\/gear\/gear-down$/, c => c.gearLever],
    [/^controls\/gear\/brake-(left|right)$/, c => c.brake],
    // The A320's own cockpit lever properties: flap lever in its five detents, gear lever 1 down and 2 up.
    [/^controls\/cockpit\/flaps-lever(-rotate)?$/, c => c.flapLever * 4],
    [/^controls\/cockpit\/gear-lever$/, c => (c.gearLever ? 1 : 2)],
    [/^controls\/cockpit\/rudder-pedal$/, c => c.rud],
    [/^controls\/cockpit\/brake-pedal-(left|right)$/, c => c.brake],
    [/^controls\/cockpit\/spoilers-lever-(rotate|translate)$/, c => c.speedbrake],
  ];
  const setters = anim ? anim.props.flatMap(p => { const r = RULES.find(([re]) => re.test(p)); return r ? [[p, r[1]]] : []; }) : [];
  const cockpit = c => { for (const [p, f] of setters) anim.values[p] = f(c, p); };
  let s; // simulation state
  const reset = () => {
    s = { t: 0, x: 0, v: 0, h: 0, gamma: 0, pitch: 0, tR: null, tL: null, yLift: 0, wheel: 0, prop: 0, done: false };
    anim?.reset();
    blur.set(0);
  };
  reset();

  // How far the nose can come up on the ground before the tail (or a tail bumper) touches: rotation stops a
  // degree short of it until the model is 10 m up (the Tu-144D bumper touches at 8 degrees, the 707 tail at 9.75).
  const tailClear = (() => {
    const ground = lowestMain(); // runway level in root space, pitch 0
    const list = [];
    root.traverse(o => { if (!o.isMesh) return; for (let q = o; q; q = q.parent) if (!q.visible) return; let p = o; while (p && !p.userData.part) p = p.parent;
      if (p?.userData.system === 'gear' && !/bumper|tail-wheel|skid/.test(p.userData.id)) return; list.push(o); });
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert(), mats = list.map(o => inv.clone().multiply(o.matrixWorld));
    const R = new THREE.Matrix4(), T = new THREE.Matrix4(), B = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z), w = new THREE.Vector3();
    for (let deg = 0.5; deg <= 25; deg += 0.25) {
      R.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(T.makeRotationZ(-THREE.MathUtils.degToRad(deg))).multiply(B);
      for (let k = 0; k < list.length; k++) {
        const M = R.clone().multiply(mats[k]), a = list[k].geometry.attributes.position;
        for (let i = 0; i < a.count; i += 3) if (w.fromBufferAttribute(a, i).applyMatrix4(M).y < ground - 0.02) return deg;
      }
    }
    return 25;
  })();

  function step(dt) {
    s.t += dt;
    const t = s.t;
    const rpm = t < 2 ? 700 : lerp(700, cfg.rpm ?? 2800, smooth(2, RUNUP, t));
    if (t > RUNUP) {
      const a = s.tL === null ? accel : accel * 0.35;
      s.v += a * dt;
    }
    if (s.tR === null && s.v >= vr) s.tR = t;
    if (tail && s.tR === null) s.pitch = -tail * smooth(0.35 * vr, 0.8 * vr, s.v);
    if (s.tR !== null) s.pitch = Math.min(s.h < 10 ? Math.min(pitchMax, tailClear - 1) : pitchMax, s.pitch + (tail ? 1.5 : 2.6) * dt);
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
    // Propellers turn visibly at idle; spun up they are a blur, so the blades fade into a faint disc
    // (src/takeoff.js, propellerBlur) and spin fast enough not to be followed.
    const power = smooth(0, 1, (rpm - 700) / ((cfg.rpm ?? 2800) - 700));
    s.prop += lerp(540, 5400, power) * dt;
    blur.set(smooth(0.15, 0.6, power));
    if (anim) {
      const after = s.tL === null ? -1 : t - s.tL;
      for (const p of gearProps) anim.values[p] = after < 3 ? 1 : 1 - smooth(3, 3 + gearTime, after);
      const tR = s.tR ?? Infinity, tL = s.tL;
      for (const p of mainComp) anim.values[p] = comp0[p] * (1 - (tL !== null ? 1 : smooth(tR, tR + (vlof - vr) / accel, t)));
      for (const p of noseComp) anim.values[p] = comp0[p] * (1 - smooth(tR, tR + 1.2, t));
      // Tailwheel: stick back to hold the tail down, forward to raise it, then back to fly off.
      const pre = tail ? (s.v < 0.35 * vr ? -0.35 : 0.3 * (1 - smooth(0.8 * vr, vr, s.v))) : 0;
      const ele = t < tR - 0.4 ? pre : tL === null ? lerp(pre, -0.55, smooth(tR - 0.4, tR + 0.6, t)) : lerp(-0.55, -0.12, smooth(tL, tL + 8, t));
      for (const p of anim.props) {
        if (/elevator-pos-norm$/.test(p)) anim.values[p] = rest[p] + ele;
        else if (/flap-pos-norm$/.test(p)) anim.values[p] = rest[p] + flaps * (after < 14 ? 1 : 1 - smooth(14, 22, after));
        else if (/velocities\/uBody-fps$/.test(p)) anim.spin[p] = s.wheel;
      }
      for (const p of rpmProps) anim.spin[p] = s.prop;
      // The crew: brakes held through the run-up and released, throttles forward ahead of the engines, small
      // pedal and aileron corrections down the runway, gear lever up once climbing, flap lever ahead of the flaps.
      const wob = s.v > 2 && (tL === null || after < 6) ? 1 : 0.3;
      cockpit({
        kt: s.v / KT, ft: s.h * FT, fpm: s.v * Math.sin(s.gamma) * FT * 60, pitch: s.pitch, power, rpm,
        ele, ail: 0.06 * wob * Math.sin(t * 1.1 + 0.6), rud: (tL === null ? 0.1 : 0.03) * Math.sin(t * 0.8),
        throttle: tL !== null && after > 20 ? lerp(1, 0.88, smooth(20, 23, after)) : smooth(1.2, 3, t),
        reverse: 0, brake: t < RUNUP ? 1 : 0, speedbrake: 0,
        gearLever: after < 2.5 ? 1 : 0, flapLever: flaps * (after < 13 ? 1 : 0),
      });
      anim.apply();
    }
    if (s.tL !== null && t - s.tL > 32) s.done = true;
  }

  // Place the model: forward along -x, lifted so the main wheels stay on the ground until liftoff, pitched about them.
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), P = new THREE.Matrix4();
  const place = () => {
    // After liftoff the climb carries the model, but the nose keeps coming up: wheels aft of the pivot (the
    // 747's body gear) must not swing into the runway while it is still close.
    const y = s.tL === null ? -lowestMain() : Math.max(s.yLift + s.h, s.h < 20 ? -lowestMain() : -Infinity);
    root.matrixAutoUpdate = false;
    M.makeTranslation(-s.x, y, 0).multiply(P.makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(R.makeRotationZ(-THREE.MathUtils.degToRad(s.pitch))).multiply(P.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
    root.matrix.copy(M);
    root.matrixWorldNeedsUpdate = true;
  };

  if (opts.kind === 'landing') return landing();
  return {
    anim, cfg, pivot, lowestMain, tailClear, place, step, vr, RUNUP, gearTime, gearProps, tail,
    get s() { return s; },
    reset: () => { reset(); },
  };

  /**
   * Landing from the model's published figures (model.landing): a 3 degree approach from 50 m with the gear
   * down and landing flaps, a flare from 7 m that raises the nose (a degree short of a tail strike) and
   * takes the sink down to a metre a second, the mains first, the nose lowered, and a braked rollout.
   */
  function landing() {
    const lc = model.landing, KT_ = 0.514444, jet = Boolean(cfg.jet);
    const vapp = lc.vapp_kt * KT_, decel = (0.97 * vapp) ** 2 / (2 * lc.roll_m), glide = THREE.MathUtils.degToRad(lc.glide_deg ?? 3);
    // A tailwheel airplane comes in with its tail up (nose down from its three-point rest, pitch 0 here) and
    // flares onto all three wheels at once.
    const H0 = lc.from_m ?? 50, FLARE = Math.min(lc.flare_m ?? 7, H0 * 0.5), SINK_TD = 1.0, appPitch = lc.pitch_deg ?? (tail ? -0.8 * tail : 2.5);
    const flarePitch = Math.min(lc.flare_deg ?? (tail ? 0 : appPitch + 3), tailClear - 1);
    const TD = lc.touchdown_m ?? 400; // past the threshold, which is 100 m behind the takeoff's start
    // Where the approach starts: far enough out that the mains, after the flare, touch down TD metres past the
    // threshold (a quick run of the vertical profile alone gives the distance flown to touchdown).
    const toTouchdown = (() => {
      let h = H0, t = 0, tF = null, x = 0, v = vapp, sink = vapp * Math.sin(glide);
      while (h > 0 && t < 120) { t += 0.01; if (tF === null && h <= FLARE) tF = t; if (tF !== null) { const f = smooth(tF, tF + 3, t); sink = lerp(vapp * Math.sin(glide), SINK_TD, f); v = vapp * lerp(1, 0.97, f); } h -= sink * 0.01; x += v * 0.01; }
      return x;
    })();
    let L;
    const resetL = () => {
      anim?.reset();
      // In the air the oleos hang extended: compression 0, from the first frame.
      if (anim) { for (const p of [...mainComp, ...noseComp]) anim.values[p] = 0; anim.apply(); }
      L = { t: 0, x: TD - 100 - toTouchdown, v: vapp, h: H0, pitch: appPitch, tF: null, tD: null, tN: null, wheel: 0, prop: 0, done: false, sink: vapp * Math.sin(glide) };
      blur.set(0.2);
    };
    resetL();
    const stepL = dt => {
      L.t += dt;
      if (L.tD === null) {
        if (L.tF === null && L.h <= FLARE) L.tF = L.t;
        if (L.tF !== null) {
          const f = smooth(L.tF, L.tF + 3, L.t);
          L.pitch = lerp(appPitch, flarePitch, f);
          L.sink = lerp(vapp * Math.sin(glide), SINK_TD, f);
          L.v = vapp * lerp(1, 0.97, f);
        }
        L.h -= L.sink * dt;
        if (L.h <= 0) { L.h = 0; L.tD = L.t; }
      } else {
        // Mains down: hold the attitude a moment, then lower the nose; brakes and reversers to a stop.
        const after = L.t - L.tD;
        if (after > 1.5) L.pitch = Math.max(0, L.pitch - 2 * dt);
        if (L.tN === null && L.pitch <= 0) L.tN = L.t;
        L.v = Math.max(0, L.v - decel * dt);
        if (L.v === 0 && L.t - L.tD > 5) L.done = true;
      }
      L.x += L.v * dt;
      if (L.tD !== null) L.wheel += L.v * FT * 6 * dt;
      L.prop += (L.tD === null ? 1600 : lerp(700, 1600, L.v / vapp)) * dt;
      blur.set(0.25);
      if (anim) {
        for (const p of gearProps) anim.values[p] = 1;
        const tD = L.tD ?? Infinity, tN = L.tN ?? Infinity;
        for (const p of mainComp) anim.values[p] = comp0[p] * smooth(tD, tD + 0.5, L.t);
        for (const p of noseComp) anim.values[p] = comp0[p] * smooth(tN, tN + 0.5, L.t);
        const ele = L.tF === null ? -0.1 : L.tD === null ? lerp(-0.1, -0.55, smooth(L.tF, L.tF + 2, L.t)) : lerp(-0.55, 0, smooth(tD + 1.5, tD + 4, L.t));
        for (const p of anim.props) {
          if (/elevator-pos-norm$/.test(p)) anim.values[p] = rest[p] + ele;
          else if (/flap-pos-norm$/.test(p)) anim.values[p] = rest[p] + (lc.flaps ?? 1);
          else if (/velocities\/uBody-fps$/.test(p)) anim.spin[p] = L.wheel;
        }
        for (const p of rpmProps) anim.spin[p] = L.prop;
        // The crew: approach power, throttles closed in the flare, then (jets) reversers and speedbrake on
        // touchdown, reversers stowed by 60 kt, brakes once the nose is down; small corrections on the way in.
        const power = L.tD === null ? (L.tF === null ? 0.35 : 0.35 * (1 - smooth(L.tF, L.tF + 2, L.t))) : jet && L.v > 60 * KT_ ? 0.55 : 0.05;
        const rev = jet && L.tD !== null && L.v > 60 * KT_ ? smooth(tD, tD + 1.5, L.t) : 0;
        cockpit({
          kt: L.v / KT_, ft: L.h * FT, fpm: L.tD === null ? -L.sink * FT * 60 : 0, pitch: L.pitch, power, rpm: lerp(700, cfg.rpm ?? 2800, power),
          ele, ail: L.tD === null ? 0.07 * Math.sin(L.t * 0.9) : 0, rud: L.tD === null ? 0.05 * Math.sin(L.t * 0.6 + 1) : 0.06 * Math.sin(L.t * 1.2) * (L.v > 5 ? 1 : 0),
          throttle: L.tD === null ? (L.tF === null ? 0.35 : 0.35 * (1 - smooth(L.tF, L.tF + 2, L.t))) : 0,
          reverse: rev > 0.5 ? 1 : 0, brake: L.tN !== null && L.v > 0 ? 0.8 : 0, speedbrake: jet && L.tD !== null ? smooth(tD, tD + 1, L.t) : 0,
          gearLever: 1, flapLever: lc.flaps ?? 1,
        });
        anim.apply();
      }
    };
    const placeL = () => {
      // In the air the lowest point of the gear (pitched) is L.h above the runway; on it, on the runway.
      const y = -lowestMain() + (L.tD === null ? L.h : 0);
      root.matrixAutoUpdate = false;
      M.makeTranslation(-L.x, y, 0).multiply(P.makeTranslation(pivot.x, pivot.y, pivot.z)).multiply(R.makeRotationZ(-THREE.MathUtils.degToRad(L.pitch))).multiply(P.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      root.matrix.copy(M);
      root.matrixWorldNeedsUpdate = true;
    };
    // lowestMain reads s.pitch: point it at the landing state.
    s = new Proxy({}, { get: (_, k) => L[k] });
    return {
      anim, cfg, landing: lc, pivot, lowestMain, tailClear, place: placeL, step: stepL, vapp, gearProps, tail,
      get s() { return L; },
      reset: () => { resetL(); },
    };
  }
}

const PILOT = /(^|\/)(pilots?|copilot|general_(co)?pilot|liner_pilot|pilotWWII|fighter_default)\.ac$/i;

/**
 * Where the captain looks from: the head of the left-hand pilot figure in the front row, in root space
 * (studio pose), and that figure's meshes, which the cockpit view hides so it does not look out through
 * its own head. Models with no pilot (the Wright Flyer) get a point at pilot height over the centre.
 * cfg (takeoff.cockpit): offset [x, y, z] metres added to the eye (x aft, y up), hide: mesh or file
 * names ("/regex/" allowed) that block the view and are hidden in it (a head-up display), oneSided: skins
 * drawn from outside only in the view (the Concorde's nose, whose windows are painted on).
 * @param {THREE.Object3D} root
 * @param {{ offset?: number[], hide?: string[], oneSided?: string[] }} [cfg]
 * @returns {{ eye: THREE.Vector3, hide: THREE.Mesh[], oneSided: THREE.Mesh[] }}
 */
export function captainEye(root, cfg = {}) {
  const re = s => (s.startsWith('/') ? new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1)) : new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  const pick = list => { const res = (list ?? []).map(re), out = []; if (res.length) root.traverse(o => { if (o.isMesh && res.some(r => r.test(o.userData.source ?? o.name) || r.test(o.userData.file ?? ''))) out.push(o); }); return out; };
  const extra = pick(cfg.hide), oneSided = pick(cfg.oneSided), shift = new THREE.Vector3(...(cfg.offset ?? [0, 0, 0]));
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), figures = new Map(), v = new THREE.Vector3();
  root.traverse(o => { if (o.isMesh && PILOT.test(o.userData.file ?? '')) { const k = o.userData.entry; if (!figures.has(k)) figures.set(k, []); figures.get(k).push(o); } });
  const list = [...figures.values()].map(meshes => {
    const pts = [];
    for (const o of meshes) { const a = o.geometry.attributes.position, M = inv.clone().multiply(o.matrixWorld); for (let i = 0; i < a.count; i += 2) pts.push(v.fromBufferAttribute(a, i).applyMatrix4(M).toArray()); }
    let top = -Infinity, minX = Infinity; for (const p of pts) { top = Math.max(top, p[1]); minX = Math.min(minX, p[0]); }
    // The head: everything within 25 cm of the top of the figure (one pilots.ac file can hold two
    // figures side by side, so the head is taken on the left half when it is wider than a person).
    let head = pts.filter(p => p[1] > top - 0.25);
    let zMin = Infinity, zMax = -Infinity; for (const p of head) { zMin = Math.min(zMin, p[2]); zMax = Math.max(zMax, p[2]); }
    if (zMax - zMin > 0.6) head = head.filter(p => p[2] > (zMin + zMax) / 2);
    const c = head.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(x => x / head.length);
    return { meshes, minX, eye: new THREE.Vector3(c[0] - 0.06, top - 0.12, c[2]) };
  });
  if (!list.length) {
    const b = new THREE.Box3().setFromObject(root), c = b.getCenter(new THREE.Vector3());
    return { eye: new THREE.Vector3(c.x, b.min.y + 1.0, 0).add(shift), hide: extra, oneSided };
  }
  const front = Math.min(...list.map(f => f.minX));
  const row = list.filter(f => f.minX < front + 1.2);
  const captain = row.reduce((a, f) => (f.eye.z > a.eye.z ? f : a));
  return { eye: captain.eye.clone().add(shift), hide: [...captain.meshes, ...extra], oneSided };
}
