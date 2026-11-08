// Lays projected views out on an A3 drawing sheet: side, front and top views at one
// standard scale, fuselage sections, dimensions, centerlines and a title block.
// All coordinates are millimeters on the sheet.
import { simplify } from './hlr.js';

const SHEET = { w: 420, h: 297, frame: 10 };
const TITLE = { w: 150, h: 34 };
const SCALES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
const INK = '#1b2633';
const FONT = 'Segoe UI, Helvetica, Arial, sans-serif';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = v => (Math.round(v * 100) / 100).toString();

/** Pick the largest standard scale at which the layout fits. */
function fit(L, S, H) {
  const X0 = 24, Y0 = 30, GX = 24, GY = 22;
  const right = SHEET.w - SHEET.frame - 6, bottom = SHEET.h - SHEET.frame - 6;
  for (const s of SCALES) {
    const k = 1000 / s;
    const w = X0 + L * k + GX + S * k + 14, h = Y0 + H * k + GY + S * k + 14;
    if (w > right || h > bottom) continue;
    const topRight = X0 + L * k, topBottom = Y0 + H * k + GY + S * k;
    const tx = right - TITLE.w, ty = bottom - TITLE.h;
    if (topRight + 14 > tx && topBottom + 12 > ty) continue; // top view would run into the title block
    return { s, k, X0, Y0, GX, GY };
  }
  const s = SCALES.at(-1);
  return { s, k: 1000 / s, X0, Y0, GX, GY };
}

/**
 * @param {object} model the catalog model
 * @param {Record<'side'|'top'|'front', ReturnType<import('./hlr.js').projectView>>} views
 * @param {{ x: number, label: string, lines: number[][][] }[]} sections cuts in (z, y), meters
 */
export function sheet(model, views, sections) {
  const sv = views.side.box, tv = views.top.box, fv = views.front.box;
  const L = sv.x1 - sv.x0, H = sv.y1 - sv.y0, S = tv.y1 - tv.y0;
  const { s, k, X0, Y0, GX, GY } = fit(L, Math.max(S, fv.x1 - fv.x0), H);
  const eps = 0.04 / k; // simplification tolerance: 0.04 mm on paper

  // Each view's placement: sheet = origin + (view - view min) * k
  const place = {
    side: { ox: X0, oy: Y0, box: sv },
    front: { ox: X0 + L * k + GX, oy: Y0, box: fv },
    top: { ox: X0, oy: Y0 + H * k + GY, box: tv },
  };
  const toSheet = (name, [x, y]) => {
    const p = place[name];
    return [p.ox + (x - p.box.x0) * k, p.oy + (y - p.box.y0) * k];
  };
  const path = (name, lines) => lines.map(l => {
    const pts = simplify(l, eps).map(q => toSheet(name, q));
    return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L');
  }).join('');

  let outline = '', detail = '';
  for (const name of ['side', 'front', 'top']) {
    // Drop dust: lines shorter than 0.3 mm on paper.
    const long = l => l.reduce((a, p, i) => i ? a + Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) : 0, 0) * k > 0.3;
    outline += path(name, views[name].outline.filter(long));
    detail += path(name, views[name].detail.filter(long));
  }

  const out = [];
  const line = (x1, y1, x2, y2, w = 0.15, extra = '') => out.push(`<path d="M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}" stroke-width="${w}"${extra}/>`);
  const text = (x, y, str, size = 2.8, anchor = 'start', extra = '') => out.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}" text-anchor="${anchor}" stroke="none"${extra}>${esc(str)}</text>`);
  const arrow = (x, y, dx, dy) => {
    const l = 2.4, w = 0.7;
    out.push(`<path d="M${x} ${y}L${x - dx * l - dy * w} ${y - dy * l + dx * w}L${x - dx * l + dy * w} ${y - dy * l - dx * w}Z" fill="${INK}" stroke="none"/>`);
  };
  // Dimension line with arrowheads and extension lines from (ex, ey) offsets.
  const dimH = (x1, x2, y, label, from) => {
    line(x1, y, x2, y);
    arrow(x1, y, -1, 0); arrow(x2, y, 1, 0);
    line(x1, from + 1, x1, y + 1.5, 0.12); line(x2, from + 1, x2, y + 1.5, 0.12);
    text((x1 + x2) / 2, y - 1.2, label, 2.8, 'middle');
  };
  const dimV = (y1, y2, x, label, from) => {
    line(x, y1, x, y2);
    arrow(x, y1, 0, -1); arrow(x, y2, 0, 1);
    line(from + 1, y1, x + 1.5, y1, 0.12); line(from + 1, y2, x + 1.5, y2, 0.12);
    const cx = x - 1.2, cy = (y1 + y2) / 2;
    text(cx, cy, label, 2.8, 'middle', ` transform="rotate(-90 ${cx.toFixed(2)} ${cy.toFixed(2)})"`);
  };
  const sp = model.specs ?? {};
  const fmt = (v, fallback) => `${n2(v ?? fallback)} m`;

  // Views: labels, ground lines, centerlines.
  const side = place.side, front = place.front, top = place.top;
  const sideW = L * k, sideH = H * k, topH = S * k, frontW = (fv.x1 - fv.x0) * k;
  text(side.ox, side.oy - 10, 'SIDE VIEW', 3, 'start', ' letter-spacing="0.6"');
  text(front.ox, front.oy - 10, 'FRONT VIEW', 3, 'start', ' letter-spacing="0.6"');
  text(top.ox, top.oy - 10, 'TOP VIEW', 3, 'start', ' letter-spacing="0.6"');
  const ground = side.oy + sideH;
  line(side.ox - 4, ground, side.ox + sideW + 4, ground, 0.12);
  line(front.ox - 4, ground, front.ox + frontW + 4, ground, 0.12);
  const dashdot = ' stroke-dasharray="8 1.5 1 1.5"';
  const cz = toSheet('top', [0, 0])[1];
  line(top.ox - 4, cz, top.ox + sideW + 4, cz, 0.12, dashdot);
  const cfx = toSheet('front', [0, 0])[0];
  line(cfx, front.oy - 4, cfx, ground + 3, 0.12, dashdot);

  // Overall dimensions.
  dimH(top.ox, top.ox + sideW, top.oy + topH + 9, fmt(sp.length_m, L), top.oy + topH);
  dimV(top.oy, top.oy + topH, top.ox + sideW + 9, fmt(sp.wingspan_m ?? sp.rotor_diameter_m, S), top.ox + sideW);
  dimV(front.oy, ground, front.ox + frontW + 8, fmt(sp.height_m, H), front.ox + frontW);

  // Sections: marked on the side view, drawn in a row below the front view.
  let sectionSvg = '';
  if (sections.length) {
    const ax = front.ox, ay = ground + 20;
    const bottom = SHEET.h - SHEET.frame - 6 - TITLE.h - 10;
    const boxes = sections.map(c => {
      let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const l of c.lines) for (const [z, y] of l) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      return { z0, z1, y0, y1 };
    });
    const total = boxes.reduce((a, b) => a + (b.z1 - b.z0) * k + 10, -10);
    const yTop = Math.max(...boxes.map(b => b.y1)), yBot = Math.min(...boxes.map(b => b.y0));
    const room = { w: SHEET.w - SHEET.frame - 8 - ax, h: bottom - ay };
    if (total <= room.w && (yTop - yBot) * k + 8 <= room.h && Number.isFinite(total)) {
      text(ax, ay - 6, 'SECTIONS', 3, 'start', ' letter-spacing="0.6"');
      let x = ax;
      sections.forEach((c, i) => {
        const b = boxes[i];
        const ox = x - b.z0 * k, oy = ay + yTop * k; // sheet = (ox + z k, oy - y k)
        const d = c.lines.map(l => 'M' + simplify(l, eps).map(([z, y]) => `${(ox + z * k).toFixed(2)} ${(oy - y * k).toFixed(2)}`).join('L')).join('');
        sectionSvg += `<path d="${d}" stroke-width="0.35"/>`;
        line(ox, oy - (b.y1 + 0.15) * k - 1.5, ox, oy - (b.y0 - 0.15) * k + 1.5, 0.12, dashdot);
        text(x + ((b.z1 - b.z0) * k) / 2, ay + (yTop - yBot) * k + 6, `${c.label}-${c.label}`, 2.8, 'middle');
        x += (b.z1 - b.z0) * k + 10;
        // Cutting plane marks on the side view.
        const [sx] = toSheet('side', [c.x, 0]);
        line(sx, side.oy - 3, sx, side.oy - 0.5, 0.35);
        line(sx, ground + 0.5, sx, ground + 3, 0.35);
        text(sx, side.oy - 4, c.label, 2.6, 'middle');
      });
    }
  }

  // Frame and title block.
  const F = SHEET.frame, R = SHEET.w - F, B = SHEET.h - F;
  const tx = R - 6 - TITLE.w + 6, ty = B - TITLE.h;
  out.push(`<rect x="${F}" y="${F}" width="${SHEET.w - 2 * F}" height="${SHEET.h - 2 * F}" stroke-width="0.5"/>`);
  out.push(`<rect x="${tx}" y="${ty}" width="${R - tx}" height="${B - ty}" stroke-width="0.35"/>`);
  line(tx, ty + 12, R, ty + 12, 0.15);
  line(tx, ty + 19, R, ty + 19, 0.15);
  line(tx, ty + 26, R, ty + 26, 0.15);
  line(tx + 60, ty + 19, tx + 60, ty + 26, 0.15);
  line(tx + 105, ty + 19, tx + 105, ty + 26, 0.15);
  text(tx + 3, ty + 8.6, model.name.toUpperCase(), 5.4, 'start', ' font-weight="700" letter-spacing="0.3"');
  const sub = [sp.manufacturer, sp.role, sp.first_flight ? `first flight ${sp.first_flight}` : null].filter(Boolean).join(', ');
  text(tx + 3, ty + 16.6, sub, 2.5);
  const dims = [`Length ${fmt(sp.length_m, L)}`, sp.wingspan_m ? `Span ${fmt(sp.wingspan_m)}` : sp.rotor_diameter_m ? `Rotor ${fmt(sp.rotor_diameter_m)}` : null, `Height ${fmt(sp.height_m, H)}`].filter(Boolean);
  text(tx + 3, ty + 23.6, dims.join('   '), 2.5);
  text(tx + 63, ty + 23.6, `Scale 1:${s} (A3)`, 2.5);
  text(tx + 108, ty + 23.6, 'Units: meters', 2.5);
  const src = model.asset ? `3D model: ${model.asset.author}, ${model.asset.license}` : model.reference ? `Parametric model measured from a drawing by ${model.reference.author}, ${model.reference.license}` : 'Machina parametric model';
  text(tx + 3, ty + 30.8, `${src}. Projected from the 3D model by Machina.`, 1.9);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" width="${SHEET.w}mm" height="${SHEET.h}mm" font-family="${FONT}" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">
<rect width="${SHEET.w}" height="${SHEET.h}" fill="#ffffff" stroke="none"/>
<g fill="${INK}">${out.filter(q => q.startsWith('<text') || q.includes('fill="')).join('\n')}</g>
${out.filter(q => !(q.startsWith('<text') || q.includes('fill="'))).join('\n')}
<path d="${detail}" stroke-width="0.18"/>
<path d="${outline}" stroke-width="0.45"/>
${sectionSvg}
</svg>
`;
}
