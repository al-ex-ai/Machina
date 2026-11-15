// The gate: what a model built from a picture must get right before anyone sees it.
// Outline overlap alone lets through an airliner with no doors or one wheel; these are
// the checks an aircraft person would make at a glance. Each failure says what is wrong.

/**
 * @param {object} model a fitted parametric model
 * @param {{ side?: { iou: number }, top?: { iou: number }, front?: { iou: number } }} [score] outline scores, if known
 * @returns {string[]} failures; empty when the model may be shown
 */
export function gate(model, score) {
  const g = model.geometry, lv = model.livery ?? {}, bad = [];
  const L = g.length;
  const part = id => g.surfaces.find(s => Object.values(s.parts).some(p => p.id === id));
  const wing = part('wing'), stab = part('stabilizer'), fin = part('fin');

  // Airframe
  if (!wing) bad.push('no wing');
  if (!stab) bad.push('no tailplane');
  if (!fin) bad.push('no fin');
  const span = wing ? 2 * wing.sections.at(-1).at : 0;
  const R = Math.max(...g.fuselage.stations.map(q => q[1]));
  if (wing && (span < L * 0.4 || span > L * 1.6)) bad.push(`span ${span.toFixed(1)} m is out of proportion to the length ${L} m`);

  // Engines: at least one pair, all the same, shaped like a nacelle, clear of the ground.
  const eng = g.engines ?? [];
  if (!eng.length) bad.push('no engines');
  const size = e => [e.nacelle.stations.at(-1)[0], Math.max(...e.nacelle.stations.map(q => q[1]))];
  for (const e of eng) {
    const [len, r] = size(e), [len0, r0] = size(eng[0]);
    if (Math.abs(len - len0) > 0.02 || Math.abs(r - r0) > 0.02) bad.push('engines differ in size');
    if (len / (2 * r) < 1.3 || len / (2 * r) > (e.pylon?.axis === "z" ? 5 : 2.7)) bad.push(`nacelle ${len.toFixed(1)} m long and ${(2 * r).toFixed(1)} m across is not engine shaped`);
    if (e.position.y - r < 0.25) bad.push('a nacelle touches the ground');
  }

  // Gear: a nose leg and main legs, mains under the wing behind mid chord, wheels of a size that carries the aircraft.
  const gear = g.gear ?? {};
  if (!gear.nose) bad.push('no nose gear');
  if (!gear.mains?.length) bad.push('no main gear');
  if (wing) {
    const root = wing.sections.find(q => q.at >= R) ?? wing.sections[0];
    for (const m of gear.mains ?? []) {
      const f = (m.x - root.le) / root.chord;
      if (f < 0.3 || f > 1.15) bad.push(`main gear at ${m.x} m is not under the wing (root chord runs ${root.le} to ${(root.le + root.chord).toFixed(1)} m)`);
      if (m.tire.d < Math.max(0.45, L * 0.016)) bad.push(`main wheels of ${m.tire.d} m are too small for a ${L} m aircraft`);
      if (m.z < 0.4 || m.z > span * 0.25) bad.push(`main gear ${m.z} m off the centerline`);
    }
    if (gear.nose && gear.mains?.length && gear.nose.x > gear.mains[0].x - L * 0.2) bad.push('nose gear too close to the main gear');
  }

  // Cabin: windows the length of it, doors enough for it, a windshield.
  const wins = lv.windows?.list ?? [];
  if (wins.length < 8) bad.push(`${wins.length} cabin windows`);
  else if (wins.at(-1)[0] - wins[0][0] < L * 0.5) bad.push(`cabin windows cover only ${(wins.at(-1)[0] - wins[0][0]).toFixed(0)} m of a ${L} m aircraft`);
  const doors = (lv.doors ?? []).filter(d => d.h > 1.3).length, need = L < 36 ? 2 : L < 50 ? 3 : L < 65 ? 4 : 5;
  if (doors < Math.min(need, 2)) bad.push(`${doors} cabin doors`);
  if ((lv.cockpitWindows ?? []).length < 2) bad.push('no windshield');

  // Outline
  if (score) {
    for (const [view, min] of [['side', 0.95], ['top', 0.95], ['front', 0.7]]) if (score[view] && score[view].iou < min) bad.push(`${view} outline overlap ${score[view].iou}, needs ${min}`);
  }
  return [...new Set(bad)];
}
