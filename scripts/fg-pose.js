// Bake a FlightGear pose into a Machina asset: evaluate the model XML's rotate and
// translate animations at chosen property values (by default, landing gear down) and
// store the resulting transforms on the asset file, in document order. Some models are
// saved with the gear retracted and only lower it through these animations.
// Usage: node scripts/fg-pose.js <model.xml> data/models/aviation/<id>.json [fileIndex] [--anim] [property=value ...] [/params/x=property ...]
//   Extra property=value pairs pose more animations, e.g. gear/gear[0]/compression-norm=1 to
//   settle oleos stored at full extension onto the ground.
//   --anim also keeps the animations themselves (gear, oleos, flaps, elevator, rudder, propellers,
//   wheels) with their curves, so the app can move the parts at runtime (the takeoff scene).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { curveAt } from '../src/fg-curve.js';

const [xmlPath, modelFile, fileIndex = '0', ...rest] = process.argv.slice(2);
const keepAnim = rest.includes('--anim');
// --no-guess: every axis-object hinge turns by FlightGear's own convention (the negated value) instead of
// the per-hinge guess below, which cannot see a chain of hinges (a strut swinging a bogie that turns again).
const noGuess = rest.includes('--no-guess');
// --instruments: an instrument XML (a gauge on the panel): keep its needles and its texture animations
// (digit drums, the attitude ball) on the flight values the takeoff and landing scenes give.
// --cockpit: the airframe XML that also animates the cockpit drawn in the same file (the Cub, the C172's
// throttle and pedals): instrument props kept as with --instruments, while the airframe's surfaces still
// get their rest positions.
const cockpitMain = rest.includes('--cockpit');
const instruments = rest.includes('--instruments') || cockpitMain;
// Cockpit files also keep what the crew moves: yoke or stick, pedals, throttles and the other engine levers,
// flap and gear levers, brakes; and the engine gauges. The takeoff and landing scenes drive them all.
const INSTR = /^(instrumentation\/|orientation\/(pitch|roll|heading)-deg$|velocities\/(airspeed-kt|vertical-speed-fps)$|position\/altitude-agl-ft$|autopilot\/internal\/current-vertical-speed-fpm$|engines\/engine(\[\d+\])?\/(n1|n2|rpm|egt-degf|egt-degc|fuel-flow_pph|fuel-flow-gph|mp-osi|mp-inhg|oil-pressure-psi|oil-temperature-degf|cht-degf|epr|thrust_lb|torque-ftlb)$|surface-positions\/[\w-]+-pos-norm$|controls\/flight\/(elevator|aileron|rudder|flaps|speedbrake|spoilers|elevator-trim)$|controls\/engines\/engine(\[\d+\])?\/(throttle|mixture|propeller-pitch|condition|reverser)$|controls\/gear\/(gear-down|brake-left|brake-right|brake-parking)$|fcs\/(elevator|rudder|left-aileron|right-aileron)-pos-(rad|deg|norm)$|controls\/cockpit\/(flaps-lever(-rotate)?|gear-lever|rudder-pedal|brake-pedal-(left|right)|spoilers-lever-(rotate|translate))$)/;
// /params/x=property: the value of an alias the including model sets (e.g. a shared propeller XML's
// /params/rpm, given per engine by the airframe XML that includes it).
const paramArgs = rest.filter(s => s.startsWith('/params/'));
const sets = rest.filter(s => !s.startsWith('--') && !s.startsWith('/params/'));
const exact = k => new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
const POSE = [ // property pattern -> value
  ...sets.map(kv => { const i = kv.lastIndexOf('='); return [exact(kv.slice(0, i)), Number(kv.slice(i + 1)), kv.slice(0, i)]; }),
  [/gear\/gear\[\d+\]\/position-norm/, 1],
];
const ANIM = /^(gear\/gear\[\d+\]\/(position|compression)-norm|surface-positions\/(flap|elevator|rudder)-pos-norm|engines\/engine\[\d+\]\/(rpm|n1|n2)|velocities\/uBody-fps)$/;
const xml = readFileSync(xmlPath, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
// Property aliases: <property alias="/params/a/b"/> reads the text of <params><a><b> in this file.
const params = new Map();
{
  const block = /<params>([\s\S]*?)<\/params>/.exec(xml.replace(/<model>[\s\S]*?<\/model>/g, ''))?.[1] ?? '';
  const stack = ['/params'];
  for (const [, close, tag, text] of block.matchAll(/<(\/?)([\w-]+(?:\[\d+\])?)[^>]*>([^<]*)/g)) {
    if (close) { stack.pop(); continue; }
    stack.push(tag);
    if (text.trim()) params.set(stack.join('/'), text.trim());
  }
  for (const kv of paramArgs) { const i = kv.indexOf('='); params.set(kv.slice(0, i), kv.slice(i + 1)); }
}
const propertyOf = a => {
  const s = a.replace(/<condition>[\s\S]*?<\/condition>/g, '');
  // Absolute paths (/controls/flight/elevator) are the same properties as relative ones.
  return canonical(/<property>\s*([^<]+?)\s*<\/property>/.exec(s)?.[1] ?? params.get(/<property\s+alias="([^"]+)"/.exec(s)?.[1]))?.replace(/^\//, '');
};
// A package's own copies of standard properties (the C172 smooths its yoke into sim/model/c172p/cockpit/...,
// its airspeed needle reads JSBSim's): played as the standard ones.
const CANON = [
  [/(^|\/)cockpit\/yoke-aileron(-abs)?$/, 'controls/flight/aileron'],
  [/(^|\/)cockpit\/yoke-elevator(-norm)?$/, 'controls/flight/elevator'],
  [/(^|\/)cockpit\/pedals?-rudder$/, 'controls/flight/rudder'],
  [/(^|\/)cockpit\/flaps?-lever$/, 'controls/flight/flaps'],
  [/^fdm\/jsbsim\/velocities\/vias-kts$/, 'velocities/airspeed-kt'],
  [/^controls\/engines\/current-engine\//, p => p.replace(/^controls\/engines\/current-engine\//, 'controls/engines/engine[0]/')],
  // Throttle levers under the package's own names (the Twin Otter's throttle-fwd, the 777's throttle-lever).
  [/^controls\/engines\/engine(\[\d+\])?\/throttle-(fwd|lever|pos|norm)$/, p => p.replace(/throttle-\w+$/, 'throttle')],
  [/^fdm\/jsbsim\/fcs\//, p => p.replace(/^fdm\/jsbsim\//, '')],
];
const canonical = p => {
  if (p === undefined) return p;
  p = p.replace(/^\//, '');
  const to = CANON.find(([re]) => re.test(p))?.[1];
  return typeof to === 'function' ? to(p) : to ?? p;
};
const num = (s, tag) => { const m = new RegExp(`<${tag}>\\s*([-\\d.eE+]+)\\s*</${tag}>`).exec(s); return m ? Number(m[1]) : undefined; };
const fgToAc = ([x, y, z]) => [x, z, -y]; // FlightGear x aft, y right, z up -> AC x aft, y up, z left

// Axis objects: some models give a hinge as a two-vertex line object in the .ac file.
// Read every object's vertices in file coordinates (loc and rot applied down the tree).
const acPath = (() => { const p = /<path>\s*([^<]+?\.ac)\s*<\/path>/.exec(xml.replace(/<model>[\s\S]*?<\/model>/g, ''))?.[1]; return p && join(dirname(xmlPath), p); })();
const acVerts = new Map();
if (acPath && existsSync(acPath)) {
  const L = readFileSync(acPath, 'latin1').split(/\r?\n/);
  let i = 0;
  const obj = (parentLoc, parentRot) => {
    let name = '', loc = [0, 0, 0], rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], verts = [], kids = 0;
    for (; i < L.length; i++) {
      const t = L[i].trim().split(/\s+/);
      if (t[0] === 'name') name = L[i].trim().slice(5).replace(/^"|"$/g, '');
      else if (t[0] === 'loc') loc = t.slice(1, 4).map(Number);
      else if (t[0] === 'rot') rot = t.slice(1, 10).map(Number);
      else if (t[0] === 'numvert') { const n = Number(t[1]); for (let k = 0; k < n; k++) verts.push(L[++i].trim().split(/\s+/).slice(0, 3).map(Number)); }
      else if (t[0] === 'kids') { kids = Number(t[1]); i++; break; }
    }
    // World = parentRot * (rot * v + loc) + parentLoc
    const R = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
    const world = v => { const a = R(rot, v).map((c, k) => c + loc[k]); return R(parentRot, a).map((c, k) => c + parentLoc[k]); };
    if (name) acVerts.set(name, verts.map(world));
    const myLoc = world([0, 0, 0]);
    const mul = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
    const myRot = mul(parentRot, rot);
    for (let k = 0; k < kids; k++) { while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++; i++; obj(myLoc, myRot); }
  };
  while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++;
  i++;
  obj([0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

const r4 = c => Math.round(c * 1e4) / 1e4, r6 = c => Math.round(c * 1e6) / 1e6;

// FlightGear <expression>: nested operators over one property and constants, kept as a small tree
// ([op, ...args], 'p' for the property, numbers as they are) that src/fg-curve.js evaluates.
function parseExpr(s) {
  const tokens = [...s.matchAll(/<(\/?)([\w-]+)[^>]*?(\/?)>|([^<]+)/g)];
  let i = 0;
  const node = () => {
    for (; i < tokens.length; i++) {
      const [, close, tag, selfClose, text] = tokens[i];
      if (text !== undefined || close) continue;
      i++;
      // A second property (the Cub's <property alias="/params/water-rudder-norm"/>) is not driven: 0.
      if (selfClose) { if (tag === 'property') return 0; continue; }
      if (tag === 'property') { while (i < tokens.length && tokens[i][2] !== 'property') i++; i++; return 'p'; }
      if (tag === 'value') { const v = Number(tokens[i][4]); while (i < tokens.length && tokens[i][2] !== 'value') i++; i++; return v; }
      const args = [];
      for (;;) {
        while (i < tokens.length && tokens[i][4] !== undefined) i++;
        if (i >= tokens.length || (tokens[i][1] && tokens[i][2] === tag)) { i++; return [tag, ...args]; }
        args.push(node());
      }
    }
  };
  return node();
}
const out = [], anim = [], texanim = [];
// Named groups: an animation with a <name> gathers its objects (or other groups) under one node
// that later animations can name. Kept on the asset file for src/assets.js to nest the same way.
// An object named in another case than the mesh has it (the Spitfire's throttle XML says "throttle", the
// mesh "Throttle") is the mesh's object, when the mesh has no exact match.
const caseOf = n => { if (acVerts.has(n) || !acVerts.size) return n; const l = n.toLowerCase(); for (const k of acVerts.keys()) if (k.toLowerCase() === l) return k; return n; };
const objectNames = a => [...a.replace(/<axis>[\s\S]*?<\/axis>/g, '').matchAll(/<object-name>\s*([^<]+?)\s*<\/object-name>/g)].map(m => caseOf(m[1]));
const groups = {};
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const name = /<name>\s*([^<]+?)\s*<\/name>/.exec(a)?.[1];
  const members = objectNames(a);
  if (name && members.length && !members.includes(name)) groups[name] = [...new Set([...(groups[name] ?? []), ...members])];
}
const members = n => groups[n] ? groups[n].flatMap(members) : [n];
// Select animations on the gear: open and closed door sets, wells and legs shown only while they are out.
// Kept as condition trees (src/fg-curve.js conditionAt) so the app shows the same set the simulator would.
const COMPARE = { 'greater-than': 'gt', 'less-than': 'lt', 'greater-than-equals': 'ge', 'less-than-equals': 'le', equals: 'eq' };
function parseCond(s) {
  const tokens = [...s.matchAll(/<(\/?)([\w-]+)[^>]*?(\/?)>|([^<]+)/g)].filter(t => t[4] === undefined || t[4].trim());
  let i = 0;
  const text = () => (tokens[i]?.[4] ?? '').trim();
  const node = () => {
    const [, close, tag] = tokens[i++];
    if (close) return null;
    if (tag === 'property') { const p = text(); i += 2; return ['prop', p.replace(/^\//, '')]; }
    if (tag === 'value') { const v = Number(text()); i += 2; return v; }
    const kids = [];
    while (i < tokens.length && !(tokens[i][1] && tokens[i][2] === tag)) { const k = node(); if (k !== null) kids.push(k); }
    i++;
    if (COMPARE[tag]) {
      const prop = kids.find(k => Array.isArray(k) && k[0] === 'prop'), nums = kids.filter(k => typeof k === 'number');
      if (prop && nums.length) return [COMPARE[tag], prop[1], nums[0]];
      // Two constants: an object switched on or off for good (the Concorde's open main-gear doors).
      if (nums.length === 2) { const [a, b] = nums; return ['const', { gt: a > b, lt: a < b, ge: a >= b, le: a <= b, eq: a === b }[COMPARE[tag]]]; }
      return ['prop', ''];
    }
    if (tag === 'and' || tag === 'or' || tag === 'not') return [tag, ...kids];
    return kids.length === 1 ? kids[0] : ['and', ...kids];
  };
  return node();
}
const selects = [];
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  if (/<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1] !== 'select') continue;
  const c = /<condition>([\s\S]*?)<\/condition>/.exec(a)?.[1];
  if (!c || !(/gear\/gear(\[\d+\])?\/(position|compression)-norm/.test(c) || !/<property/.test(c))) continue;
  const objects = objectNames(a.replace(/<condition>[\s\S]*?<\/condition>/g, ''));
  if (objects.length) selects.push({ objects, cond: parseCond(`<and>${c}</and>`) });
}
for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const type = /<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1];
  if (type !== 'rotate' && type !== 'translate' && type !== 'spin') continue;
  let prop = propertyOf(a);
  if (!prop) continue;
  // Wheels spun from the flight model's own wheel speed (the Cub's fdm/jsbsim/gear/gear-spin-left) roll
  // with the ground speed, as the gear/gear[n]/rollspeed-ms ones do.
  if (type === 'spin' && /gear.*(spin|rollspeed)|wheel.*(spin|speed)/i.test(prop) && !ANIM.test(prop)) prop = 'velocities/uBody-fps';
  const rule = type !== 'spin' && POSE.find(([re]) => re.test(prop));
  // Engine properties only turn things (propellers, fans); some models also hang blade pitch or
  // instrument needles on them.
  // In an airframe XML (--cockpit) only the crew's controls and true instruments: JSBSim models reuse spare
  // engine slots for gear legs (the Cub's engine[3..6]), which the engine gauges would swing.
  const cockpitProp = !cockpitMain || /^(controls|instrumentation)\//.test(prop);
  const animated = keepAnim && ((ANIM.test(prop) && (type === 'spin' || !prop.startsWith('engines/'))) || (instruments && INSTR.test(prop) && type !== 'spin' && cockpitProp));
  if (!rule && !animated) continue;
  const objects = objectNames(a);
  if (!objects.length) continue;
  const unit = type === 'rotate' ? 'deg' : 'm';
  const entries = [...a.matchAll(/<entry>\s*<ind>\s*([-\d.eE+]+)\s*<\/ind>\s*<dep>\s*([-\d.eE+]+)\s*<\/dep>\s*<\/entry>/g)].map(m => [Number(m[1]), Number(m[2])]);
  const exprXml = /<expression>([\s\S]*?)<\/expression>/.exec(a)?.[1];
  // An expression that is only a lookup table (<expression><table>, the 737's vertical speed needle) is a plain table.
  const curve = exprXml && !/^\s*<table>/.test(exprXml) ? { expr: parseExpr(exprXml) } : entries.length ? { table: entries } : {
    factor: num(a, 'factor'), offset: num(a, `offset-${unit}`),
    min: num(a, `min-${unit}`) ?? num(a, 'min'), max: num(a, `max-${unit}`) ?? num(a, 'max'),
  };
  for (const k of Object.keys(curve)) if (curve[k] === undefined) delete curve[k];
  const val = rule ? curveAt(curve, rule[1]) : 0;
  // Axis: an axis object, two points, or a center and a direction.
  const ax = /<axis>([\s\S]*?)<\/axis>/.exec(a)?.[1] ?? '';
  let origin, axis, sign = 1;
  const axisObj = /<object-name>\s*([^<]+?)\s*<\/object-name>/.exec(ax)?.[1];
  if (axisObj) {
    const v = acVerts.get(axisObj);
    if (!v || v.length < 2) continue;
    const d = v[1].map((c, k) => c - v[0][k]), len = Math.hypot(...d);
    if (!len) continue;
    // The sign convention of axis objects is not consistent between models (or even
    // between the two sides of one model), so pick the sign that lowers the part: every
    // pose transform here extends landing gear. Ties keep the negated value.
    const lowest = s => {
      const th = (s * val * Math.PI) / 180, u = d.map(c => c / len), cs = Math.cos(th), sn = Math.sin(th);
      let lo = Infinity;
      for (const n of objects.flatMap(members)) for (const p0 of acVerts.get(n) ?? []) {
        const q = p0.map((c, k) => c - v[0][k]), dot = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
        const cr = [u[1] * q[2] - u[2] * q[1], u[2] * q[0] - u[0] * q[2], u[0] * q[1] - u[1] * q[0]];
        lo = Math.min(lo, v[0][1] + q[1] * cs + cr[1] * sn + u[1] * dot * (1 - cs));
      }
      return lo;
    };
    sign = !noGuess && val && lowest(1) < lowest(-1) - 0.05 ? 1 : -1;
    origin = v[0].map(r4);
    axis = d.map(c => r6(c / len));
  } else {
    let p1, dir;
    if (num(ax, 'x1-m') !== undefined) {
      p1 = [num(ax, 'x1-m') ?? 0, num(ax, 'y1-m') ?? 0, num(ax, 'z1-m') ?? 0];
      const p2 = [num(ax, 'x2-m') ?? 0, num(ax, 'y2-m') ?? 0, num(ax, 'z2-m') ?? 0];
      dir = p2.map((c, i) => c - p1[i]);
    } else {
      const c = /<center>([\s\S]*?)<\/center>/.exec(a)?.[1] ?? '';
      p1 = [num(c, 'x-m') ?? 0, num(c, 'y-m') ?? 0, num(c, 'z-m') ?? 0];
      dir = [num(ax, 'x') ?? 0, num(ax, 'y') ?? 0, num(ax, 'z') ?? 0];
    }
    const len = Math.hypot(...dir);
    if (!len) continue;
    origin = fgToAc(p1).map(r4);
    axis = fgToAc(dir.map(c => c / len)).map(r6);
  }
  if (rule && val) out.push({ type, objects, prop, value: Math.round(sign * val * 1000) / 1000, origin, axis });
  if (animated) anim.push({ type, objects, prop, ...curve, ...(sign !== 1 ? { sign } : {}), origin, axis });
  // A baked transform the app does not animate (nose-wheel steering set straight) still sits in the
  // chain at its baked value, or replaying the animated ones around it would undo it.
  else if (keepAnim && rule && val) anim.push({ type, objects, prop, fixed: val, ...(sign !== 1 ? { sign } : {}), origin, axis });
}

// Texture animations of instruments: a digit drum scrolls its texture in steps, an attitude ball moves its
// texture with pitch and turns it with roll (FlightGear textranslate, texrotate and texmultiple).
if (instruments) for (const [, a] of xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)) {
  const type = /<type>\s*(\w+)\s*<\/type>/.exec(a)?.[1];
  if (!['textranslate', 'texrotate', 'texmultiple'].includes(type)) continue;
  const objects = objectNames(a);
  if (!objects.length) continue;
  const parts = type === 'texmultiple' ? [...a.matchAll(/<transform>([\s\S]*?)<\/transform>/g)].map(m => [/<subtype>\s*(\w+)/.exec(m[1])?.[1], m[1]]) : [[type, a]];
  const steps = [];
  for (const [kind, x] of parts) {
    const prop = propertyOf(x);
    if (!prop || !INSTR.test(prop)) continue;
    const ax = /<axis>([\s\S]*?)<\/axis>/.exec(x)?.[1] ?? '';
    const t = { kind: kind === 'texrotate' ? 'rotate' : 'translate', prop, factor: num(x, 'factor') ?? 1, offset: num(x, 'offset') ?? num(x, 'offset-deg') ?? 0, step: num(x, 'step'), scroll: num(x, 'scroll'), bias: num(x, 'bias'), min: num(x, 'min'), max: num(x, 'max'), axis: [num(ax, 'x') ?? 0, num(ax, 'y') ?? 0, num(ax, 'z') ?? 0] };
    const entries = [...x.matchAll(/<entry>\s*<ind>\s*([-\d.eE+]+)\s*<\/ind>\s*<dep>\s*([-\d.eE+]+)\s*<\/dep>\s*<\/entry>/g)].map(m => [Number(m[1]), Number(m[2])]);
    if (entries.length) t.table = entries;
    if (t.kind === 'rotate') { const c = /<center>([\s\S]*?)<\/center>/.exec(x)?.[1] ?? ''; t.center = [num(c, 'x') ?? 0, num(c, 'y') ?? 0]; }
    for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
    steps.push(t);
  }
  if (steps.length) texanim.push({ objects, steps });
}
// Left and right gear are mirror images. Where a right-side transform (objects ending
// in R) has a left twin (same names ending in L), rebuild it as the mirror of the left
// one across the centerline: origin z flipped, axis (-x, -y, z), same angle.
function mirror(list, same) {
  const key = t => t.objects.map(n => n.replace(/L$/, '#')).join(',');
  const lefts = new Map(list.filter(t => t.objects.every(n => /L$/.test(n))).map(t => [key(t), t]));
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.objects.every(n => /R$/.test(n))) continue;
    const l = lefts.get(t.objects.map(n => n.replace(/R$/, '#')).join(','));
    if (!l || l.type !== t.type) continue;
    // Only true twins across the centerline: in some models L and R name the two doors of one
    // nacelle (LGmainLDoorFL and LGmainLDoorFR are both on the left gear), which must stay as given.
    if (Math.sign(t.origin[2]) === Math.sign(l.origin[2]) && t.origin[2] !== 0) continue;
    list[i] = { ...t, ...same(l), origin: [l.origin[0], l.origin[1], -l.origin[2]], axis: t.type === 'translate' ? [l.axis[0], l.axis[1], -l.axis[2]] : [-l.axis[0], -l.axis[1], l.axis[2]] };
  }
}
mirror(out, l => ({ value: l.value }));
// Only the gear is mirrored for the animations too: flaps, elevators and propellers have their own
// curves per side (a right flap deflects with the left one, not against it).
const gearAnim = anim.filter(t => t.prop.startsWith('gear/'));
mirror(gearAnim, l => { const { type, objects, prop, origin, axis, ...curve } = l; return curve; });
let g = 0;
for (let i = 0; i < anim.length; i++) if (anim[i].prop.startsWith('gear/')) anim[i] = gearAnim[g++];
// The takeoff starts from the baked pose: an animation that also has a baked transform must give exactly
// that transform at the pose's property value, or the part jumps when the scene begins (a right-hand door
// whose pose was mirrored from the left one while its animation kept the other sense). Take the pose's
// hinge and sense.
for (const t of anim) {
  const rule = POSE.find(([re]) => re.test(t.prop));
  if (!rule || t.type === 'spin') continue;
  const p = out.find(q => q.type === t.type && q.prop === t.prop && q.objects.join() === t.objects.join());
  if (!p) continue;
  t.origin = p.origin; t.axis = p.axis;
  // A fixed entry holds a baked transform under the animations (the Tu-144D steering links): exactly the pose's.
  if (t.fixed !== undefined) { t.fixed = p.value; delete t.sign; continue; }
  const v = curveAt(t, rule[1]);
  if (Math.abs(v + p.value) < 1e-6 && Math.abs(v) > 1e-6) { t.sign = -(t.sign ?? 1); if (t.sign === 1) delete t.sign; }
}

const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
const file = files[Number(fileIndex)];

// Sub-models: a <model> block with a <name> places another file, and this XML's animations can
// move it by that name (the 707's wheel bogies ride on its gear legs). Each one is matched to the
// asset file with the same mesh and offsets, and gets the transforms as its outermost level
// ("@file"), moved into its own coordinates.
const subs = new Map();
for (const [, b] of xml.matchAll(/<model>([\s\S]*?)<\/model>/g)) {
  const name = /<name>\s*([^<]+?)\s*<\/name>/.exec(b)?.[1], path = /<path>\s*([^<]+?)\s*<\/path>/.exec(b)?.[1];
  if (!name || !path) continue;
  let ac = path;
  if (/\.xml$/.test(path)) {
    // Aircraft/<name>/... is relative to the aircraft folder (the one holding Models), anything else to this XML.
    const sub = /^Aircraft\//.test(path) ? join(xmlPath.replace(/[\\/]Models?[\\/].*$/, ''), path.replace(/^Aircraft\/[^/]+\//, '')) : join(dirname(xmlPath), path);
    ac = existsSync(sub) ? /<path>\s*([^<]+?\.ac)\s*<\/path>/.exec(readFileSync(sub, 'latin1').replace(/<!--[\s\S]*?-->/g, '').replace(/<model>[\s\S]*?<\/model>/g, ''))?.[1] : undefined;
  }
  if (!ac) continue;
  const o = /<offsets>([\s\S]*?)<\/offsets>/.exec(b)?.[1] ?? '';
  // Offsets are relative to this XML's own file; the asset stores where each file sits overall.
  const off = [num(o, 'x-m') ?? 0, num(o, 'y-m') ?? 0, num(o, 'z-m') ?? 0], at = file.offset ?? {};
  const abs = [off[0] + (at.x ?? 0), off[1] + (at.y ?? 0), off[2] + (at.z ?? 0)];
  const j = files.findIndex(f => f.file.split('/').pop() === ac.split('/').pop() && Math.hypot(abs[0] - (f.offset?.x ?? 0), abs[1] - (f.offset?.y ?? 0), abs[2] - (f.offset?.z ?? 0)) < 0.01);
  // Files the asset places rotated are left alone: the shift below assumes axes parallel to ours.
  if (j >= 0 && j !== Number(fileIndex) && !Object.values(files[j].rotation ?? {}).some(Boolean)) subs.set(name, { j, shift: fgToAc(off) });
}
const toSub = new Map();
const moveTo = (t, kind) => {
  for (const n of t.objects) {
    const s = subs.get(n);
    if (!s) continue;
    const e = toSub.get(s.j) ?? { pose: [], anim: [] };
    e[kind].push({ ...t, objects: ['@file'], origin: t.origin.map((c, k) => r4(c - s.shift[k])) });
    toSub.set(s.j, e);
  }
};
out.forEach(t => moveTo(t, 'pose'));
anim.forEach(t => moveTo(t, 'anim'));
for (const [j, e] of toSub) {
  const f = files[j];
  if (e.pose.length) f.parentPose = e.pose; else delete f.parentPose;
  if (keepAnim) f.parentAnim = e.anim;
  console.log(`  ${f.file} [${j}]: ${e.pose.length} gear-down transforms and ${e.anim.length} animations from the parent`);
}

if (out.length) file.pose = out; else delete file.pose;
const used = {};
const use = n => { if (groups[n] && !used[n]) { used[n] = groups[n]; groups[n].forEach(use); } };
for (const t of [...out, ...anim, ...texanim, ...(keepAnim ? selects : [])]) t.objects.forEach(use);
// In definition order: an object in two groups belongs to the later one, nested in the earlier.
const ordered = Object.fromEntries(Object.keys(groups).filter(n => used[n]).map(n => [n, used[n]]));
if (Object.keys(ordered).length) file.groups = ordered; else delete file.groups;
if (keepAnim) {
  file.anim = anim;
  if (texanim.length) file.texanim = texanim; else delete file.texanim;
  if (selects.length) file.select = selects; else delete file.select;
  // The property values the pose was baked at, so the app starts its animations from them.
  file.poseState = Object.fromEntries(POSE.filter(r => r[2]).map(r => [r[2], r[1]]));
  // An oleo whose stroke is not zero at compression 0 (the Concorde nose: 0.35 c - 0.6) is modelled at the
  // compression where it is: start there, or the takeoff would drop the strut the moment it begins.
  // Control surfaces are not baked either: the Tu-144D rudder (23 v + 20 deg) rests where v = -0.87.
  const byProp = new Map();
  for (const t of anim) {
    // Blade pitch on an airframe (the 337's and Twin Otter's propellers) rests where the blades are drawn too.
    if (!(/(compression|surface-positions\/\w+-pos)-norm$/.test(t.prop) || (cockpitMain && /propeller-pitch$/.test(t.prop))) || t.prop in file.poseState || t.fixed !== undefined) continue;
    byProp.set(t.prop, [...(byProp.get(t.prop) ?? []), t]);
  }
  // An instrument shares the airplane's properties (the flap gauge reads the flap position): its needles
  // never decide where the airplane's own surfaces rest.
  if (instruments && !cockpitMain) byProp.clear();
  for (const [prop, ts] of byProp) {
    const off = c => Math.max(...ts.map(t => Math.abs(curveAt(t, c))));
    if (off(0) < 1e-6) continue;
    let best = 0;
    for (let c = /compression/.test(prop) ? 0 : -1; c <= 3; c += 0.001) if (off(c) < off(best)) best = c;
    for (let c = best - 0.001, b = best; c <= b + 0.001; c += 1e-6) if (off(c) < off(best)) best = c;
    if (off(best) < 1e-3) file.poseState[prop] = r6(best);
    // Blades with no pitch where all of them sit as drawn (the 337's front propeller) keep their drawn pitch:
    // their pitch animations go, the cockpit's pitch levers (zero at 0) stay.
    else if (cockpitMain && /propeller-pitch$/.test(prop)) for (const t of ts) if (Math.abs(curveAt(t, 0)) > 1e-6) anim.splice(anim.indexOf(t), 1);
  }
}
model.asset.files = files;
delete model.asset.file;
writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: baked ${out.length} gear-down transforms${keepAnim ? ` and kept ${anim.length} animations` : ''} into ${file.file}`);
