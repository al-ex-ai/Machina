// Rig the crew controls a FlightGear cockpit draws but never animates: throttle levers, yokes, control
// columns, sticks and rudder pedals found by object name in the cockpit files, each given a plain hinge
// from its own geometry. Only where the model has no animation of that kind already (scripts/fg-cockpit.js
// runs first; run this after it, since fg-pose rewrites a file's animations).
// Usage: node scripts/rig-cockpit.js data/models/aviation/<id>.json [--dry] [--only throttle,yoke,pedals]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const modelFile = args.find(a => a.endsWith('.json'));
const dry = args.includes('--dry');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
const base = join('assets', model.asset.path.replace(/^assets\//, ''));

// What the model already moves.
const props = files.flatMap(f => (f.anim ?? []).filter(a => !a.note?.startsWith('Machina rig')).map(a => a.prop));
const has = {
  throttle: props.some(p => /^controls\/engines\/engine(\[\d+\])?\/throttle$/.test(p)),
  yoke: props.some(p => /^controls\/flight\/(elevator|aileron)$|^fcs\/(elevator|left-aileron)-pos/.test(p)),
  pedals: props.some(p => /^controls\/flight\/rudder$|^fcs\/rudder-pos/.test(p)),
};

const KINDS = {
  throttle: { name: /throttle|thrust.?lever|power.?lever|^thr(ust)?[\d_ .-]|^tl[\d_]|^rud_?thr|gaz|^lever.?(eng|thr)/i },
  yoke: { name: /yoke|column|steering.?wheel|control.?wheel|^stick|joystick|control.?stick|steuer|shturval|^wheel.?(capt|fo|cpt|pilot)/i },
  pedals: { name: /pedal/i },
};
const NOT = /knob|label|text|lamp|light|lts|switch|panel|placard|base|gate|slot|quad|frame|cover|mount|boot|shadow|indicator|trim|lock|reverser|guard|housing|plate|decal|hole|shaft|breaker|^red|sticker|_re\d/i;
// Largest dimension a single control can have (m): a shared bar across both seats is not one pilot's control.
const MAX = { throttle: 0.4, yoke: 0.7, pedals: 0.5 };
// --objects throttle=a,b;yoke=c;pedals=d,e names the controls outright where names mislead.
// A control drawn in several parts joins them with + (YokeIZQ_01+YokeIZQ_02): one pivot for all of them.
const named = args.includes('--objects') ? Object.fromEntries(args[args.indexOf('--objects') + 1].split(';').map(kv => { const [k, v] = kv.split('='); return [k, v.split(',').map(c => c.split('+'))]; })) : null;

// Object vertices in file coordinates (loc and rot applied down the tree), as scripts/fg-pose.js reads them.
function objects(path) {
  const L = readFileSync(path, 'latin1').split(/\r?\n/);
  const out = new Map();
  let i = 0;
  const R = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  const mul = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
  const obj = (parentLoc, parentRot, parentNames) => {
    let name = '', loc = [0, 0, 0], rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], verts = [], kids = 0;
    for (; i < L.length; i++) {
      const t = L[i].trim().split(/\s+/);
      if (t[0] === 'name') name = L[i].trim().slice(5).replace(/^"|"$/g, '');
      else if (t[0] === 'loc') loc = t.slice(1, 4).map(Number);
      else if (t[0] === 'rot') rot = t.slice(1, 10).map(Number);
      else if (t[0] === 'numvert') { const n = Number(t[1]); for (let k = 0; k < n; k++) verts.push(L[++i].trim().split(/\s+/).slice(0, 3).map(Number)); }
      else if (t[0] === 'kids') { kids = Number(t[1]); i++; break; }
    }
    const world = v => { const a = R(rot, v).map((c, k) => c + loc[k]); return R(parentRot, a).map((c, k) => c + parentLoc[k]); };
    const pts = verts.map(world);
    if (name) out.set(name, { pts, parents: parentNames });
    // A group's points include its children's, so a lever drawn as a group gets its whole extent.
    for (const p of parentNames) out.get(p)?.pts.push(...pts);
    const myLoc = world([0, 0, 0]), myRot = mul(parentRot, rot);
    for (let k = 0; k < kids; k++) { while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++; i++; obj(myLoc, myRot, name ? [...parentNames, name] : parentNames); }
  };
  while (i < L.length && !/^OBJECT/.test(L[i].trim())) i++;
  i++;
  obj([0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], []);
  return out;
}

const box = pts => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]), mid: hi.map((h, k) => (h + lo[k]) / 2) };
};
const r4 = c => Math.round(c * 1e4) / 1e4;

const added = [];
for (const f of files) {
  if (!named && f.fallback?.system !== 'interior' && !/cockpit|flightdeck|panel|pedestal|interior|yoke|throttle|pedal|stick/i.test(f.file)) continue;
  const path = join(base, f.file);
  if (!existsSync(path) || !/\.ac$/i.test(path)) continue;
  const objs = objects(path);
  for (const [kind, { name }] of Object.entries(KINDS)) {
    if (has[kind] || (only && !only.includes(kind))) continue;
    // Outermost matches only: a lever group and its handle are one lever.
    const hits = named
      ? (named[kind] ?? []).filter(parts => parts.every(n => objs.has(n))).map(parts => [parts, { pts: parts.flatMap(n => objs.get(n).pts) }])
      : [...objs.entries()].filter(([n, o]) => name.test(n) && !NOT.test(n) && o.pts.length >= 4 && !o.parents.some(p => name.test(p) && !NOT.test(p))).map(([n, o]) => [[n], o]);
    for (const [parts, o] of hits) {
      const n = parts[0];
      const b = box(o.pts);
      if (!named && (Math.max(...b.size) > MAX[kind] || Math.max(...b.size) < 0.05)) continue; // not one control
      const anim = [];
      if (kind === 'throttle') {
        // Pivot at the foot of the lever; forward (toward -x) with power, 28 degrees of travel.
        // A knob in a slot (the Cub's) slides forward instead, 8 cm.
        if (Math.max(...b.size) < 0.08) anim.push({ type: 'translate', objects: parts, prop: 'controls/engines/engine[0]/throttle', factor: 0.08, origin: b.mid.map(r4), axis: [-1, 0, 0] });
        else anim.push({ type: 'rotate', objects: parts, prop: 'controls/engines/engine[0]/throttle', factor: 28, origin: [b.mid[0], b.lo[1], b.mid[2]].map(r4), axis: [0, 0, 1] });
      } else if (kind === 'yoke') {
        if (b.size[1] > 0.35) {
          // A column standing on the floor: it tips fore and aft about its foot, the wheel on top turns with the ailerons.
          anim.push({ type: 'rotate', objects: parts, prop: 'controls/flight/elevator', factor: 14, origin: [b.mid[0], b.lo[1], b.mid[2]].map(r4), axis: [0, 0, 1] });
        } else if (/stick/i.test(n)) {
          anim.push({ type: 'rotate', objects: parts, prop: 'controls/flight/elevator', factor: 16, origin: [b.mid[0], b.lo[1], b.mid[2]].map(r4), axis: [0, 0, 1] });
          anim.push({ type: 'rotate', objects: parts, prop: 'controls/flight/aileron', factor: -16, origin: [b.mid[0], b.lo[1], b.mid[2]].map(r4), axis: [1, 0, 0] });
        } else {
          // A wheel on a shaft through the panel: in and out with the elevator, turned with the ailerons.
          anim.push({ type: 'translate', objects: parts, prop: 'controls/flight/elevator', factor: -0.12, origin: b.mid.map(r4), axis: [1, 0, 0] });
          anim.push({ type: 'rotate', objects: parts, prop: 'controls/flight/aileron', factor: -45, origin: b.mid.map(r4), axis: [1, 0, 0] });
        }
      } else {
        // Right rudder pushes the right pedal (z < 0 in file coordinates) forward and lets the left one back.
        anim.push({ type: 'translate', objects: parts, prop: 'controls/flight/rudder', factor: 0.07, origin: b.mid.map(r4), axis: [b.mid[2] < 0 ? -1 : 1, 0, 0] });
      }
      for (const a of anim) a.note = 'Machina rig: the package draws this control but does not animate it';
      if (!dry) f.anim = [...(f.anim ?? []).filter(a => !(a.note?.startsWith('Machina rig') && a.objects[0] === n)), ...anim];
      added.push(`${kind} ${parts.join('+')} (${f.file}) ${b.size.map(c => c.toFixed(2)).join('x')} m`);
    }
  }
}
if (!dry && added.length) writeFileSync(modelFile, JSON.stringify(model, null, 2) + '\n');
console.log(`${model.id}: has ${Object.entries(has).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nothing'}; ${dry ? 'would rig' : 'rigged'} ${added.length}`);
for (const a of added) console.log('  ' + a);
