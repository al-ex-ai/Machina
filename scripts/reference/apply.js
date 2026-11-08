// Write the measurements from references/<id>/measured.json into the model file.
// Usage: node scripts/reference/apply.js references/b737-300
// Only measured values are replaced; planform data the drawing does not cover
// (wing and stabilizer sections, engine shape) stays as it is in the model file.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'));
const m = JSON.parse(readFileSync(join(dir, 'measured.json'), 'utf8'));
const model = JSON.parse(readFileSync(ref.model, 'utf8'));
const g = model.geometry, lv = model.livery;
const r2 = v => Math.round(v * 100) / 100;
const lerp = (pts, x) => {
  const i = pts.findIndex(p => p[0] >= x);
  if (i <= 0) return pts[i < 0 ? pts.length - 1 : 0][1];
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
};
const st = m.fuselage.stations;
const bottomAt = x => lerp(st.map(s => [s[0], s[3]]), x);
const topAt = x => lerp(st.map(s => [s[0], s[2]]), x);

model.reference = { drawing: `${dir.replace(/\\/g, '/')}/${ref.image}`, source: ref.source, author: ref.author, license: ref.license, measured: `${dir.replace(/\\/g, '/')}/measured.json` };
g.attitude = m.attitude.degrees;

// Fuselage
// The measured upper section is quantized to whole pixels; fitting one smooth
// superellipse exponent to it keeps the shape and removes the steps (creases).
const fitExponent = pts => {
  let best = 2, err = Infinity;
  for (let n = 1.6; n <= 4; n += 0.02) {
    const e = pts.reduce((q, [yN, zN]) => q + (zN - Math.max(0, 1 - yN ** n) ** (1 / n)) ** 2, 0);
    if (e < err) { err = e; best = n; }
  }
  return r2(best);
};
g.fuselage = ref.fuselage.smoothSection
  ? { stations: st, nTop: fitExponent(m.fuselage.upper), nBot: m.fuselage.lowerExponent }
  : { stations: st, section: { upper: m.fuselage.upper }, nBot: m.fuselage.lowerExponent };

// Openings
const win = m.windows;
const winY = win.reduce((a, w) => a + w.y, 0) / win.length;
lv.windows = { list: win.map(w => [w.x, w.y]), w: ref.published.window[0], h: ref.published.window[1] };
lv.doors = [...m.doors, ...m.exits].map(d => ({ x: d.x, sill: r2(d.y - d.h / 2), w: d.w, h: d.h, window: true }));
if (!lv.cockpitWindows) lv.windshield = m.windshield; // traced panes, unless the six-pane layout is defined
lv.cheatline = { ...lv.cheatline, y: r2(winY - 0.5), riseFrom: 24, rise: 0.12 };
if (lv.titles) lv.titles.y = r2(winY + 0.62);

// Wing planform from the top view; heights, thickness and twist stay from the model file.
const wing0 = g.surfaces[0];
const hAt = z => lerp(wing0.sections.map(q => [q.at, q.h]), z);
const tcAt = z => lerp(wing0.sections.map(q => [q.at, q.tc]), z);
const twAt = z => lerp(wing0.sections.map(q => [q.at, q.twist ?? 0]), z);
wing0.sections = m.wing.plan.map(p => ({ at: p.z, le: p.le, chord: p.chord, h: r2(hAt(p.z)), tc: r2(tcAt(p.z) * 1000) / 1000, twist: r2(twAt(p.z)) }));
const kink = m.wing.kinkZ;
wing0.segments[0].to = kink; wing0.segments[1].from = kink;
const teAt = z => lerp(wing0.sections.map(q => [q.at, q.le + q.chord]), z);
if (g.canoes) g.canoes = g.canoes.map(c => ({ ...c, x0: r2(teAt(c.z) - 2.6), x1: r2(teAt(c.z) + 0.9), y: r2(hAt(c.z) - 0.08) }));
if (g.navLights) { const t = wing0.sections.at(-1); g.navLights.wingtip = { ...g.navLights.wingtip, x: r2(t.le + t.chord * 0.5), y: r2(t.h) }; }

// Horizontal stabilizer: planform from the top view, tip height from the side view, 7 degree dihedral.
const stab = g.surfaces[1];
const sp = m.stabilizer.plan;
const sh = ref.stabilizer.height, dihedral = Math.tan((sh.dihedral * Math.PI) / 180);
stab.sections = sp.map((p, i) => ({ ...stab.sections[i], at: p.z, le: p.le, chord: r2(Math.min(p.chord, ref.published.length - 0.02 - p.le)), h: r2(sh.y + (p.z - sh.z) * dihedral) }));
stab.segments[0].from = sp[0].z; stab.segments[0].to = sp.at(-1).z;

// Engine: place and stretch the nacelle to the measured inlet, exit and ground clearance.
const e = g.engine, n = m.nacelle;
const len0 = e.nacelle.stations.at(-1)[0], k = (n.exitX - n.inletX) / len0;
e.nacelle.stations = e.nacelle.stations.map(([x, ...rest]) => [r2(x * k), ...rest]);
e.plug = e.plug.map(([x, r]) => [r2(x * k), r]);
const nacBot = Math.min(...e.nacelle.stations.map(s => s[3])), nacTop = Math.max(...e.nacelle.stations.map(s => s[2]));
const wScale = (ref.engine?.width ?? 0) / 2 / Math.max(...e.nacelle.stations.map(q => q[1]));
if (ref.engine?.nTop) e.nacelle.nTop = ref.engine.nTop;
if (wScale) e.nacelle.stations = e.nacelle.stations.map(([x, w, ...rest]) => [x, r2(w * wScale), ...rest]);
e.position = { ...e.position, x: n.inletX, y: r2(n.bottom - nacBot), z: ref.engine?.z ?? m.engineZ };
const wing = g.surfaces[0];
const wingH = z => lerp(wing.sections.map(s => [s.at, s.h]), z);
const pylonTop = r2(wingH(e.position.z));
e.pylon = { sections: [
  { at: r2(e.position.y + nacTop - 0.08), le: r2(n.inletX + 1.3), chord: 2.7, tc: 0.12 },
  { at: pylonTop, le: r2(n.inletX + 2.4), chord: 2.9, tc: 0.12 },
] };

// Gear: measured positions; tire bottoms on the ground line in body axes.
g.gear.nose = { ...g.gear.nose, x: m.gear.noseX, bottom: m.gear.noseGround, top: r2(bottomAt(m.gear.noseX) + 0.1) };
g.gear.main = { ...g.gear.main, x: m.gear.mainX, bottom: m.gear.mainGround, top: r2(wingH(g.gear.main.z) - 0.25) };

// Fin: sections from the measured outline. Below the lowest clean row the trailing
// edge is hidden by the stabilizer, so it is held at that row's value.
const fin = g.surfaces.find(s => s.axis === 'y');
const rows = m.fin;
const tip = rows[0];
const clean = rows.filter(r => r.y >= 5.6);
const knee = clean.at(-1);
const dorsal = rows.find(r => r.y < 5.6 && r.y > topAt(r.le) + 0.1) ?? knee;
const slope = (knee.le - dorsal.le) / (knee.y - dorsal.y || 1);
const rootY = r2(topAt(dorsal.le) - 0.3);
const rootLe = r2(dorsal.le - (dorsal.y - rootY) * slope);
fin.sections = [
  { at: rootY, le: rootLe, chord: r2(knee.te - rootLe), tc: 0.05 },
  { at: dorsal.y, le: dorsal.le, chord: r2(knee.te - dorsal.le), tc: 0.08 },
  { at: knee.y, le: knee.le, chord: r2(knee.te - knee.le), tc: 0.11 },
  { at: tip.y, le: tip.le, chord: r2(tip.te - tip.le), tc: 0.1 },
];
fin.segments = [
  { from: rootY, to: knee.y, split: [[0, 1, 'fin']] },
  { from: knee.y, to: tip.y, split: [[0, 0.7, 'fin'], [0.7, 1, 'rudder']] },
];
if (fin.paint) {
  fin.paint.stripe.edge = [[knee.le, knee.y], [tip.le, tip.y]];
  const ty = r2((knee.y + tip.y) / 2 - 0.3);
  const f = (ty - knee.y) / (tip.y - knee.y);
  const le = knee.le + (tip.le - knee.le) * f, te = knee.te + (tip.te - knee.te) * f;
  fin.paint.title = { ...fin.paint.title, x: r2(le + (te - le) * 0.52), y: ty };
}

// Navigation light on the tail cone tip
if (g.navLights) g.navLights.tail = { x: r2(m.tailTip.x - 0.2), y: r2(m.tailTip.y) };

writeFileSync(ref.model, JSON.stringify(model, null, 2) + '\n');
console.log(`updated ${ref.model}: attitude ${g.attitude} deg, ${st.length} stations, ${win.length} windows, ${lv.doors.length} doors and exits, ${m.windshield.length} windshield panes, fin ${fin.sections.length} sections`);
