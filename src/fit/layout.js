// A drawing in, a model out, with the structure decided first. The layout (references/
// known/<id>.layout.json, written by someone reading the drawing) says what the aircraft
// is made of: how many engines and where, the tail, each gear leg and its wheels, the
// doors, the window rows. The drawing then only sets dimensions. Nothing the layout
// fixes is ever guessed from pixels, and the rules every airliner follows hold by
// construction: both sides alike, all engines one engine, every wheel on the ground.
import { buildModel } from '../registry.js';
import { measure, geometryFrom, correct } from './from-views.js';
import { targetOf, compareMasks } from './views.js';
import { MATERIALS, liveryFor, dress, distance } from './fit.js';
import { readDetails, applyDetails } from './details.js';

const r2 = v => Math.round(v * 100) / 100;
/** Grow (on = 1) or shrink (on = 0) a mask by r pixels, as a square. */
function grown(m, r, on = 1) {
  const { w, h } = m, a = m.data, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1 - on; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (a[y * w + k] === on) { v = on; break; } tmp[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1 - on; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] === on) { v = on; break; } out[y * w + x] = v; }
  const c = m.clone(); c.data = out; return c;
}

/** A model's views drawn with the drawing's line: grown by half its width, as the drawing's outline reaches past the edge. */
function inked(t, line) {
  const r = Math.round((line / 2) * t.ppm);
  if (r < 1) return t;
  return { ...t, side: grown(t.side, r), top: grown(t.top, r), front: t.front && grown(t.front, r) };
}

const median = a => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** Keep what the layout says exists, and nothing else, from one reading of the views. */
export function constrain(m, layout, views) {
  const out = { ...m };
  const per = Math.floor(layout.engines.count / 2);
  const biggest = (list, n, what) => {
    if (list.length < n) throw new Error(`layout has ${n} ${what} engine(s) a side, the drawing shows ${list.length}`);
    return [...list].sort((a, b) => b.dia - a.dia).slice(0, n).sort((a, b) => a.z - b.z);
  };
  // Engines in pairs, one box nacelle to each pair (Concorde, Tu-144): a box a side per two engines.
  // Such boxes sit under the wing and do not show in the top view: they are read from the side and front views.
  if (layout.engines.nacelle === 'box-pair') {
    out.boxes = views ? boxesFrom(views, m) : []; out.engines = []; out.rear = [];
    // The body's bottom runs straight over the boxes: the side view's low line there is theirs.
    for (const b of out.boxes) {
      const a = b.x0 - 0.5, c = b.x1 + 1, ya = lerpPts(out.bot, a), yc = lerpPts(out.bot, c);
      out.bot = out.bot.map(([x, y]) => (x > a && x < c ? [x, Math.max(y, ya + (yc - ya) * (x - a) / (c - a))] : [x, y]));
    }
  }
  else if (layout.engines.mount === 'wing') { out.engines = biggest(m.engines, per, 'wing'); out.rear = []; }
  else if (layout.engines.mount === 'rear') { out.rear = biggest(m.rear, per, 'rear'); out.engines = []; }
  // No tailplane (a tailless delta): whatever the top view shows ahead of the wing (canards) is not one.
  if (layout.tail === 'none') out.stab = null;
  // A T-tail: the tailplane is the long thin run across the top of the front view; its
  // chord plane is the middle of the rows where one run spans most of it.
  if (layout.tail === 'T' && out.stab) {
    const root = out.stab.rows[0], tip = out.stab.rows.at(-1).at;
    let y = m.H - 0.045 * (root.te - root.le);
    const f = views?.front;
    if (f) {
      const rows = [];
      for (let j = f.h - 1; j >= 0; j--) { const v = f.V(j); if (v < m.H * 0.5) break; if (f.runsU(v).some(r => r[0] < -tip * 0.7 && r[1] > tip * 0.7)) rows.push(v); }
      if (rows.length) y = (Math.min(...rows) + Math.max(...rows)) / 2;
    }
    out.stab = { ...out.stab, h: [[0, y]] };
  }
  // Engines beside the rear fuselage: the outer half of each nacelle is never hidden in the
  // front view. The outermost column gives its edge, the run heights inside it a circle.
  if (layout.engines.mount === 'rear' && views?.front) out.rear = out.rear.map(e => nacelleFromFront(views.front, e) ?? e);
  // A high wing: the hump over the root in the side view is the wing, not the body. The
  // body's top runs straight under it, from just ahead of the root chord to just behind it.
  if (layout.wing?.position === 'high' && out.wing.rows.length) {
    const root = out.wing.rows[0], a = root.le - 0.5, b = root.te + 0.5;
    const ya = lerpPts(out.top, a), yb = lerpPts(out.top, b);
    out.top = out.top.map(([x, y]) => (x > a && x < b ? [x, Math.min(y, ya + (yb - ya) * (x - a) / (b - a))] : [x, y]));
  }
  return out;
}

const lerpPts = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0] || 1); }
  return pts.at(-1)[1];
};

/**
 * The bullet on a T-tail where the fin meets the tailplane: in the side view, what reaches
 * ahead of the fin's top section at the tailplane's height. Its width is the fin tip's in
 * the front view at that height, or a third of its height.
 */
export function tailBullet(target, m, layout) {
  if (layout.tail !== 'T' || !m.fin || !m.stab) return null;
  const s = target.side, y = m.stab.h[0][1];
  const rows = [...m.fin.rows].sort((p, q) => p.at - q.at), finTop = rows.at(-1);
  const finLe = v => lerpPts(rows.map(r => [r.at, r.le]), v), stabLe = m.stab.rows[0].le;
  const ys = [], x0s = [];
  for (let v = y - 1.2; v <= target.H; v += 1 / s.ppm) {
    const r = s.runsU(v).filter(q => q[1] > finTop.le).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
    if (r && r[0] < Math.min(finLe(Math.min(v, finTop.at)), stabLe) - 0.3) { ys.push(v); x0s.push(r[0]); }
  }
  if (ys.length < 4) return null;
  // Behind its nose the bullet runs into the fin and tailplane: it is taken as long again behind the fin's leading edge.
  const lo = Math.min(...ys), hi = Math.max(...ys), mid = (lo + hi) / 2, x0 = Math.min(...x0s), x1 = finTop.le + (finTop.le - x0);
  let half = (hi - lo) / 3;
  const f = target.front;
  if (f) { const r = f.runsU(mid).find(q => q[0] <= 0 && q[1] >= 0); if (r && r[1] - r[0] < (hi - lo) * 1.5) half = Math.min(-r[0], r[1]); }
  const len = x1 - x0, hh = (hi - lo) / 2;
  const prof = [[0, 0.05], [0.08, 0.6], [0.25, 0.92], [0.5, 1], [0.75, 0.9], [0.92, 0.55], [1, 0.08]];
  return { id: 'tail-bullet', label: 'Tail bullet fairing', system: 'structure', mirror: false, position: { x: r2(x0), y: 0, z: 0 }, nTop: 2, nBot: 2,
    stations: prof.map(([t, k]) => [r2(t * len), r2(half * k), r2(mid + hh * k), r2(mid - hh * k), r2(mid)]) };
}

/**
 * The fairing under the body at the wing (a wing-body fairing, gear sponsons): where the
 * side view's belly drops below the straight belly of the constant section, as wide as the
 * front view shows the body at that height. The fuselage section alone is round there.
 */
export function bellyFairing(target, m) {
  const L = target.L, pts = m.bot.filter(p => p[0] > L * 0.12 && p[0] < L * 0.65);
  if (pts.length < 20) return null;
  // The straight belly: the upper hull of the bottom line (a fairing only ever lowers it).
  const hull = [];
  for (const p of pts) {
    while (hull.length >= 2) { const [o, a] = hull.slice(-2); if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) >= 0) hull.pop(); else break; }
    hull.push(p);
  }
  const lineAt = x => { for (let i = 1; i < hull.length; i++) if (x <= hull[i][0]) { const [a, b] = [hull[i - 1], hull[i]]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return hull.at(-1)[1]; };
  // The deepest stretch below it.
  const depth = m.bot.map(([x, y]) => [x, x > L * 0.12 && x < L * 0.75 ? lineAt(Math.min(x, L * 0.65)) - y : 0]);
  let best = null, cur = null;
  for (const [x, d] of depth) {
    if (d > 0.06) { cur ??= { x0: x, x1: x, max: 0 }; cur.x1 = x; cur.max = Math.max(cur.max, d); }
    else if (cur) { if (!best || cur.max * (cur.x1 - cur.x0) > best.max * (best.x1 - best.x0)) best = cur; cur = null; }
  }
  if (cur && (!best || cur.max * (cur.x1 - cur.x0) > best.max * (best.x1 - best.x0))) best = cur;
  if (!best || best.max < 0.15 || best.x1 - best.x0 < L * 0.08) return null;
  const xm = (best.x0 + best.x1) / 2, floor = lineAt(Math.min(xm, L * 0.65)) - best.max;
  // Width: the body's half-width in the front view just above the fairing's floor.
  const f = target.front;
  if (!f) return null;
  const hw = [];
  for (let y = floor + 0.15; y < floor + best.max * 0.8 + 0.15; y += 1 / f.ppm) { const r = f.runsU(y).find(q => q[0] <= 0 && q[1] >= 0); if (r) hw.push(Math.min(-r[0], r[1])); }
  if (hw.length < 3) return null;
  const w = median(hw), top = lineAt(Math.min(xm, L * 0.65)) + m.R * 0.6;
  const n = 14, len = best.x1 - best.x0, botAt = x => { const q = m.bot.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a)); return q[1]; };
  const stations = Array.from({ length: n + 1 }, (_, i) => {
    const x = best.x0 + (len * i) / n, d = Math.max(0, lineAt(Math.min(x, L * 0.65)) - botAt(x));
    const k = Math.max(0.15, Math.sqrt(Math.min(1, d / best.max)));
    const bot = botAt(x);
    return [r2(x - best.x0), r2(w * k), r2(top), r2(bot), r2(bot + Math.min(best.max * 0.6, (top - bot) * 0.4))];
  });
  return { id: 'belly-fairing', label: 'Belly fairing', system: 'structure', mirror: false, position: { x: r2(best.x0), y: 0, z: 0 }, nTop: 2, nBot: 3, stations };
}

/**
 * Canards, from the top view: rows outboard of the body whose ink lies wholly ahead of the
 * wing root's leading edge. Root and tip rows give a trapezoid; it sits near the crown.
 */
export function canardFrom(target, m) {
  const t = target.top, wingLe = m.wing.rows.length ? Math.min(...m.wing.rows.map(r => r.le)) : m.L * 0.4;
  const rows = [];
  for (let z = m.R * 1.05; z < m.S; z += 1 / t.ppm) {
    const r = t.runsU(z).filter(q => q[1] < wingLe - 0.5 && q[0] > m.L * 0.08 && q[1] - q[0] > 0.3)[0];
    if (r) rows.push({ z, le: r[0], te: r[1] }); else if (rows.length) break;
  }
  if (rows.length < 5 || rows.at(-1).z - rows[0].z < 1) return null;
  const root = rows[0], tip = rows.at(-1);
  const h = lerpPts(m.top, (root.le + root.te) / 2) - 0.25 * m.R;
  const sec = (q, at) => ({ at: r2(at), le: r2(q.le), chord: r2(q.te - q.le), h: r2(h), tc: 0.06 });
  const sections = [sec(root, 0.3), sec(root, root.z), sec(tip, tip.z)];
  return { axis: 'z', mirror: true, sections, segments: [{ from: sections[0].at, to: sections.at(-1).at, split: [[0, 1, 'canard']] }], parts: { canard: { id: 'canard', label: 'Canard', system: 'surfaces' } } };
}

/**
 * A chined body (SR-71): ahead of the wing the body is as wide as the top view shows it,
 * chines and all, not as wide as its round core. Each station takes the half-width of the
 * top view's run through the centerline there; its section flattens to match.
 */
function chined(g, target, m) {
  const t = target.top, wingLe = m.wing.rows.length ? Math.min(...m.wing.rows.map(r => r.le)) : m.L * 0.5;
  // Its section comes to an edge at the chine: a lens, not an oval.
  g.fuselage.nTop = 1.6; g.fuselage.nBot = 1.6;
  g.fuselage.stations = g.fuselage.stations.map(q => {
    const [x] = q;
    if (x <= 0.2 || x >= wingLe) return q;
    const r = t.runsV(x).find(v => v[0] <= 0 && v[1] >= 0);
    if (!r) return q;
    const w = Math.min(-r[0], r[1]);
    return w > q[1] ? [q[0], r2(w), ...q.slice(2)] : q;
  });
}

/**
 * Twin fins standing on the nacelles, canted as the front view shows them: above the body,
 * the middle of each fin's run in the top rows gives where it stands at each height; a
 * line through those is the fin's lean. The side view gave its outline.
 */
function twinFins(g, front, H) {
  const fin = g.surfaces.find(s => s.axis === 'y' && !s.mirror);
  // Twin fins stand at the tailplane's tips (end plates) when there is a tailplane, else on the nacelles.
  const stab = g.surfaces.find(s => Object.values(s.parts).some(p => p.id === 'stabilizer'));
  const anchor = stab ? stab.sections.at(-1).at : g.engines[0]?.position.z;
  if (!fin || !front || !anchor) return;
  const zOn = anchor, pts = [];
  for (let y = H * 0.55; y < H - 0.1; y += 0.1) {
    const r = front.runsU(y).filter(q => q[0] > 0.3 && q[1] - q[0] < 1.2 && Math.abs((q[0] + q[1]) / 2 - zOn) < 4).sort((a, b) => Math.abs((a[0] + a[1]) / 2 - zOn) - Math.abs((b[0] + b[1]) / 2 - zOn))[0];
    if (r) pts.push([y, (r[0] + r[1]) / 2]);
  }
  let zAt = () => zOn;
  if (pts.length >= 4) {
    const n = pts.length, my = pts.reduce((a, p) => a + p[0], 0) / n, mz = pts.reduce((a, p) => a + p[1], 0) / n;
    const k = pts.reduce((a, p) => a + (p[0] - my) * (p[1] - mz), 0) / (pts.reduce((a, p) => a + (p[0] - my) ** 2, 0) || 1);
    zAt = y => mz + k * (y - my);
  }
  fin.mirror = true;
  fin.sections = fin.sections.map(q => ({ ...q, h: r2(zAt(q.at)) }));
}

/**
 * Nacelles built into the wing: each runs the whole of its row in the top view (inlet spike
 * to exhaust), round as the front view shows it, on the wing with no pylon.
 */
function inWingNacelles(g, target, spike = false) {
  for (const e of g.engines) {
    const z = e.position.z, row = target.top.runsU(z).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    if (!row) continue;
    const r0 = Math.max(...e.nacelle.stations.map(q => q[1]));
    const fit = target.front ? nacelleFromFront(target.front, { z, dia: 2 * r0, y: e.position.y }) : null;
    const r = fit ? fit.dia / 2 : r0, y = fit ? fit.y : e.position.y;
    // A spike inlet: from the tip of the row the top view is the cone alone, until it opens to the
    // nacelle's width at the lip. The nacelle starts there; the cone stands out ahead of it.
    let x0 = row[0];
    if (spike) {
      for (let x = row[0]; x < row[0] + (row[1] - row[0]) * 0.4; x += 1 / target.top.ppm) {
        const q = target.top.runsV(x).find(v => v[0] <= z && v[1] >= z);
        if (q && q[1] - q[0] > 1.6 * r) { x0 = x; break; }
      }
    }
    const len = row[1] - x0, cone = x0 - row[0];
    const prof = spike ? [[0, 0.9], [0.04, 1], [0.8, 1], [1, 0.82]] : [[0, 0.05], [0.08, 0.45], [0.16, 0.85], [0.25, 1], [0.8, 1], [1, 0.82]];
    e.position = { x: r2(x0), y: r2(y), z: r2(fit ? fit.z : z) };
    e.nacelle = { nTop: 2, nBot: 2, stations: prof.map(([f, k]) => [r2(f * len), r2(r * k), r2(r * k), r2(-r * k), 0]) };
    e.fan = { radius: r2(r * 0.7), depth: r2(spike ? 0.4 : len * 0.2) };
    if (spike && cone > 0.3) e.spike = { length: r2(cone + 0.4), radius: r2(r * 0.6) };
    e.plug = [[r2(len - 0.2), r2(r * 0.5)], [r2(len + 0.1), r2(r * 0.4)], [r2(len + 0.4), 0.03]];
    e.pylon = { axis: 'y', sections: [{ at: r2(y), le: r2(row[0] + len * 0.4), chord: 0.2, h: r2(z), tc: 0.1 }, { at: r2(y + 0.05), le: r2(row[0] + len * 0.4), chord: 0.2, h: r2(z), tc: 0.1 }] };
  }
}

/**
 * Box nacelles under the wing: in the side view, the stretch whose bottom hangs well below
 * the belly and well clear of the ground (wheels reach the ground); in the front view, at
 * the box's mid height, the run beside the body gives its inner and outer side.
 */
function boxesFrom(views, m) {
  const s = views.side, f = views.front;
  if (!f) throw new Error('box nacelles are read from the front view, and the drawing has none');
  // The box is the lowest long stretch of the side view once the gear is set aside: the
  // bottom of each column (from the body down), and the stretch within 25 cm of the lowest.
  const bottoms = [];
  for (let i = 0; i < s.w; i++) {
    const x = s.U(i);
    if (x < m.L * 0.2 || x > m.L * 0.97) continue;
    if (m.mainLegs.some(g => x > g.x0 - 0.3 && x < g.x1 + 0.3) || (m.noseLeg && Math.abs(x - m.noseLeg.x) < 1)) continue;
    const top = lerpPts(m.top, x), r = s.runsV(x).filter(q => q[1] > top - 0.3)[0];
    if (r) bottoms.push([x, r[0]]);
  }
  const lowest = Math.min(...bottoms.map(p => p[1]));
  const low = bottoms.filter(p => p[1] < lowest + 0.25);
  // The longest stretch of such columns is the box; gear legs are short.
  let best = null, cur = null;
  for (const p of low) { if (cur && p[0] - cur.at(-1)[0] < 0.3) cur.push(p); else { cur = [p]; } if (!best || cur.length > best.length) best = cur; }
  if (!best || best.at(-1)[0] - best[0][0] < m.L * 0.1) throw new Error('no box nacelle under the wing in the side view');
  const x0 = best[0][0], x1 = best.at(-1)[0];
  // In the front view the box's floor is the lowest wide run beside the body (struts and
  // wheels in front of the box break up the rows above it, and are narrow below it).
  for (let j = 0; j < f.h; j++) {
    const y = f.V(j);
    if (y < 0.3) continue;
    if (y > m.H * 0.5) break;
    const r = f.runsU(y).filter(q => q[0] > m.R * 0.7 && q[1] - q[0] > 1.2).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    if (r) return [{ x0, x1, bottom: y, z0: r[0], z1: r[1] }];
  }
  throw new Error('no box nacelle beside the body in the front view');
}

/** A box nacelle from its reading: square in section with an intake face, up to the wing's underside. */
function boxPod(b, wing, i) {
  const at = (k, z) => lerpPts(wing.sections.map(q => [q.at, q[k]]), z);
  const z = (b.z0 + b.z1) / 2, half = (b.z1 - b.z0) / 2, under = at('h', z) - at('tc', z) * at('chord', z) * 0.3;
  // Up into the wing, so the box meets it with no gap; flat sides and a square intake from the front on.
  const top = Math.max(under + 0.3, b.bottom + 0.6) - b.bottom, len = b.x1 - b.x0;
  const prof = [[0, 1, 1], [0.92, 1, 1], [1, 0.96, 0.9]];
  const box = { id: i ? `engine-box-${i + 1}` : 'engine-box', label: 'Engine nacelle (two engines)', system: 'propulsion', mirror: true, inlet: true,
    position: { x: r2(b.x0), y: r2(b.bottom), z: r2(z) }, nTop: 12, nBot: 12,
    stations: prof.map(([t, kw, kh]) => [r2(t * len), r2(half * kw), r2(top), r2(top * (1 - kh)), r2(top / 2)]) };
  // Two round nozzles side by side at the back, one to each engine.
  const rn = r2(Math.min(half / 2, (top - 0.3) / 2) * 0.88), yn = r2((top - 0.3) / 2), ln = Math.max(1, len * 0.07);
  const nozzle = (k, dz) => ({ id: `engine-nozzle-${i * 2 + k + 1}`, label: 'Exhaust nozzle', system: 'propulsion', mirror: true, finish: 'metal',
    position: { x: r2(b.x1 - 0.3), y: r2(b.bottom), z: r2(z + dz) }, nTop: 2, nBot: 2,
    stations: [[0, rn, r2(yn + rn), r2(yn - rn), yn], [r2(ln * 0.7), r2(rn * 0.95), r2(yn + rn * 0.95), r2(yn - rn * 0.95), yn], [r2(ln), r2(rn * 0.88), r2(yn + rn * 0.88), r2(yn - rn * 0.88), yn]] });
  return [box, nozzle(0, -half / 2), nozzle(1, half / 2)];
}

/** A nacelle's center height, center and diameter from the outer half of its circle in the front view. */
function nacelleFromFront(f, e) {
  // A run of the nacelle spans its center height (a wing root beside it does not).
  const r0 = e.dia / 2, win = q => q[0] < e.y + 0.4 * r0 && q[1] > e.y - 0.4 * r0;
  const run = z => f.runsV(z).filter(win).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  let zOut = null;
  for (let z = e.z + 2 * r0; z > e.z; z -= 1 / f.ppm) if (run(z)) { zOut = z; break; }
  if (zOut === null) return null;
  const cols = [];
  for (let d = 2 / f.ppm; d < r0 * 0.9; d += 1 / f.ppm) { const q = run(zOut - d); if (q) cols.push({ d, mid: (q[0] + q[1]) / 2, hh: (q[1] - q[0]) / 2 }); }
  const fit = cols.filter(c => c.d > r0 * 0.25);
  if (fit.length < 3) return null;
  const r = median(fit.map(c => (c.hh * c.hh + c.d * c.d) / (2 * c.d)));
  if (!(r > r0 * 0.6 && r < r0 * 1.8)) return null;
  return { ...e, z: zOut - r, dia: 2 * r, y: median(fit.map(c => c.mid)) };
}

/** Gear legs and wheels as the layout has them; where each stands and how big its wheels are from the drawing. */
function gearAsLaid(g, m, layout, line = 0) {
  const gear = g.gear;
  const st = g.fuselage.stations, belly = x => st.reduce((a, q) => (Math.abs(q[0] - x) < Math.abs(a[0] - x) ? q : a))[3];
  // A tire is read with the drawing's line around it: that much less across and high. It is
  // never wider than about half its diameter: a wider reading is two tires seen as one.
  const tireOf = q => { const d = r2(q.tire.d - line); return { ...q.tire, d, w: r2(Math.min(q.tire.w - line, d * 0.42)) }; };
  // A nose leg the layout has but the drawing does not place (a side view drawn in flight):
  // where nose gear goes, a sixth of the way back, on wheels half the size of the mains'.
  if (layout.gear.nose && !gear.nose && gear.mains?.length) {
    const x = r2(g.length * 0.16), d = r2(gear.mains[0].tire.d * 0.6);
    gear.nose = { x, tire: { d: r2(d + line), w: r2(d * 0.4 + line) }, wheels: 2, spacing: r2(d * 0.5), strut: r2(Math.max(0.12, d * 0.26)), top: r2(belly(x) + 0.35), bottom: 0, byRule: true };
  }
  if (gear.nose) {
    const n = layout.gear.nose;
    gear.nose.tire = tireOf(gear.nose);
    const w = gear.nose.tire.w;
    gear.nose = { ...gear.nose, wheels: n.wheels, spacing: r2(n.wheels > 1 ? (gear.nose.wheels === n.wheels ? gear.nose.spacing : w * 1.25) : 0), ...(n.axles > 1 ? { axles: n.axles, axleSpacing: gear.nose.axleSpacing ?? r2(gear.nose.tire.d * 1.15) } : { axles: 1, axleSpacing: 0 }) };
  }
  const want = layout.gear.mains;
  let read = [...gear.mains];
  // Legs one behind the other read as one leg with an axle per leg: split it at its axles.
  if (read.length < want.length) {
    const total = want.reduce((a, w) => a + w.axles, 0);
    read = read.flatMap(q => {
      const n = q.axles ?? 1;
      if (n !== total || n < 2) return [q];
      return Array.from({ length: n }, (_, k) => ({ ...q, x: r2(q.x + (k - (n - 1) / 2) * q.axleSpacing), axles: 1, axleSpacing: 0 }));
    });
  }
  // Legs read from the drawing, outer first; the layout's wing legs are the outer ones.
  read.sort((a, b) => b.z - a.z || a.x - b.x);
  const order = want.map((w, i) => ({ ...w, i })).sort((a, b) => (a.place === b.place ? 0 : a.place === 'wing' ? -1 : 1));
  const base = read[0];
  gear.mains = order.map((w, k) => {
    const q0 = read[Math.min(k, read.length - 1)] ?? base;
    // Body gear hangs from the belly, whatever the wing does above it.
    const q = { ...q0, tire: tireOf(q0), ...(w.place === 'body' ? { top: r2(belly(q0.x) + 0.35) } : {}) };
    const axleSpacing = w.axles > 1 ? (q.axles === w.axles && q.axleSpacing ? q.axleSpacing : r2(q.tire.d * 1.15)) : 0;
    const spacing = w.wheels > 1 ? (q.wheels === w.wheels ? q.spacing : r2(q.tire.w * 1.25)) : 0;
    return { ...q, wheels: w.wheels, spacing, axles: w.axles, axleSpacing, id: want.length > 1 ? `${w.place}-gear-${k + 1}` : 'main-gear', label: want.length > 1 ? `${w.place} gear ${k + 1}` : 'main gear' };
  });
  return g;
}

/**
 * Side stays of wing gear, from the front view: just inboard of each leg, the run that
 * holds the wing reaches down to the stay; just outboard of the body, it reaches down to
 * where the stay meets it. A leg whose run there ends at the wing has no stay drawn.
 */
function staysFrom(g, front, fairing) {
  const wing = g.surfaces.find(s => Object.values(s.parts).some(p => p.id === 'wing'));
  if (!wing || !front) return g;
  const secs = wing.sections, at = (k, z) => lerpPts(secs.map(q => [q.at, q[k]]), z);
  const under = z => at('h', z) - at('tc', z) * at('chord', z) * 0.5;
  const R = Math.max(...g.fuselage.stations.map(q => q[1]));
  const zBody = Math.max(R * 0.9, fairing ? Math.max(...fairing.stations.map(q => q[1])) : 0) + 0.08;
  const reach = z => { const w = under(z); const r = front.runsV(z).filter(q => q[1] >= w - 0.15 && q[0] <= w + 0.3)[0]; return r ? r[0] : null; };
  for (const q of g.gear.mains) {
    if (q.z < R * 1.05) continue;
    const z1 = q.z - q.strut - 0.1;
    if (z1 <= zBody + 0.2) continue;
    const y1 = reach(z1);
    if (y1 === null || under(z1) - y1 < 0.3) continue;
    // Walk inboard until the run's bottom is back at the wing (or the body is reached): there the stay ends.
    let zEnd = zBody, yEnd = reach(zBody) ?? under(zBody);
    for (let z = z1; z > zBody; z -= 1 / front.ppm) {
      const y = reach(z);
      if (y === null || under(z) - y < 0.08) { zEnd = z; yEnd = under(z); break; }
    }
    if (yEnd <= y1) continue;
    q.stay = { y: r2(y1 + q.strut * 0.2), zTo: r2(zEnd), yTo: r2(yEnd) };
  }
  return g;
}

/**
 * @param {object} target silhouettes from a sheet (src/fit/sheet.js targetFromSheet)
 * @param {object} layout what the aircraft is made of, read from the drawing
 * @param {{ id: string, name: string, specs?: object }} about
 * @param {{ steps?: number, log?: (line: string) => void }} [opts]
 */
export function fitLayout(target, layout, about, { steps = Number(process.env.FIT_STEPS ?? 3), log } = {}) {
  const want = constrain(measure(target), layout, target);
  const frame = { L: target.L, H: target.H, S: target.S };
  const fairing = bellyFairing(target, want), bullet = tailBullet(target, want, layout);
  const canard = layout.extras?.some(e => /canard/i.test(e)) ? canardFrom(target, want) : null;
  log?.(canard ? `canards ${canard.sections.at(-1).at} m out` : "no canards read");
  if (bullet) log?.(`tail bullet ${bullet.position.x} m on, ${bullet.stations.at(-1)[0]} m long`);
  log?.(fairing ? `belly fairing ${fairing.position.x} m on, ${fairing.stations.at(-1)[0]} m long` : "no belly fairing");
  const make = reading => {
    const geometry = staysFrom(gearAsLaid({ ...geometryFrom(reading, { engineName: about.specs?.engine_type }), materials: MATERIALS }, reading, layout, target.line ?? 0), target.front, fairing);
    if (canard) geometry.surfaces.push(canard);
    if (layout.body === 'chined') chined(geometry, target, reading);
    if (layout.engines.nacelle === 'in-wing') inWingNacelles(geometry, target, layout.engines.inlet === 'spike');
    if (/twin/.test(layout.fins ?? '')) twinFins(geometry, target.front, target.H);
    if (reading.boxes?.length) { const wing = geometry.surfaces[0]; geometry.pods = [...(geometry.pods ?? []), ...reading.boxes.flatMap((b, i) => boxPod(b, wing, i))]; }
    const extra = [fairing, bullet].filter(Boolean);
    if (extra.length) geometry.pods = [...(geometry.pods ?? []), ...extra];
    return { id: about.id, name: about.name, category: 'aviation', builder: 'parametric', specs: about.specs ?? {}, note: 'Built from a three-view drawing: outside only, no cockpit or cabin interior.', livery: liveryFor(geometry), geometry };
  };
  const views = obj => inked(targetOf(obj, { ppm: target.ppm, frame }), target.line ?? 0);
  const away = v => distance(Object.fromEntries(['side', 'top', 'front'].filter(k => target[k] && v[k]).map(k => [k, compareMasks(target[k], v[k])])));
  let cur = want, model = make(cur), obj = buildModel(model), best = away(views(obj));
  log?.(`start ${(best * 100).toFixed(1)} cm`);
  // Each step tries the whole correction, then half and a quarter of it, and keeps the best;
  // the loop ends when none of them brings the outline closer.
  for (let k = 0; k < steps; k++) {
    let got;
    try { const seen = views(obj); got = constrain(measure(seen), layout, seen); } catch (e) { log?.(`step ${k + 1} failed: ${e.message}`); break; }
    let pick = null;
    for (const alpha of [1, 0.5, 0.25]) {
      try {
        const next = correct(cur, want, got, 0.4, alpha), nextModel = make(next), nextObj = buildModel(nextModel), d = away(views(nextObj));
        if (!pick || d < pick.d) pick = { next, nextModel, nextObj, d, alpha };
      } catch { /* a step the builder cannot make is skipped */ }
    }
    if (!pick || pick.d >= best - 0.0005) { log?.(`step ${k + 1}: no closer`); break; }
    log?.(`step ${k + 1} ${(pick.d * 100).toFixed(1)} cm (step ${pick.alpha})`);
    cur = pick.next; model = pick.nextModel; obj = pick.nextObj; best = pick.d;
  }
  dress(model);
  // A tail decal is drawn for one fin on the centerline: twin fins take the tail color instead.
  for (const s of model.geometry.surfaces) if (s.axis === "y" && s.mirror) delete s.paint;
  if (target.inner && layout.windows?.drawn !== false) {
    const got = applyDetails(model, readDetails(target.inner, target.L));
    log?.(`from the drawing: ${got.join(', ') || 'no inner detail found'}`);
  }
  // What the layout says is not there is not painted on: no cabin windows (a freighter, a
  // reconnaissance aircraft), no cabin doors.
  const lv = model.livery;
  if (layout.windows?.rows === 0) lv.windows = { ...lv.windows, list: [] };
  if (Array.isArray(layout.doors?.list) && !layout.doors.list.length) lv.doors = [];
  // A paint the layout gives (an aircraft known by its color) covers the body, nacelles and fin.
  if (layout.paint) {
    Object.assign(lv, { base: layout.paint, belly: layout.paint, nacelle: layout.paint, stripe: layout.paint });
    delete lv.titles;
    for (const s of model.geometry.surfaces) { if (s.paint) s.paint = { ...s.paint, base: layout.paint }; for (const p of Object.values(s.parts)) if (p.finish === "metal") delete p.finish; }
    model.geometry.materials = { ...model.geometry.materials, tail: { ...model.geometry.materials.tail, color: layout.paint }, surfaces: { ...model.geometry.materials.surfaces, color: layout.paint }, controls: { ...model.geometry.materials.controls, color: layout.paint } };
  }
  return model;
}
