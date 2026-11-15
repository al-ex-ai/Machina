// Is a three-view drawing good enough to build from? Checked before any fitting, so a poor
// drawing is turned away in seconds instead of being worked around in code.
// Usage: npm run check-drawing -- references/new/<id>   (the folder holds the drawing and layout.json)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { targetFromSheet } from '../src/fit/sheet.js';
import { measure } from '../src/fit/from-views.js';
import { fill } from '../src/fit/views.js';
import { readPNG } from './reference/png.js';
import { svgToPng } from './node/browser.js';

export function checkDrawing(dir) {
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const file = join(dir, layout.drawing);
  const img = readPNG(file.endsWith('.svg') ? svgToPng(readFileSync(file, 'utf8'), 3000) : readFileSync(file));
  const rows = [];
  const check = (name, ok, value, need) => rows.push({ name, ok, value, need });

  // 1. Line art: dark lines on a light page, little gray shading, nothing strongly colored.
  let ink = 0, shade = 0, color = 0;
  const d = img.data;
  for (let k = 0; k < img.width * img.height; k++) {
    if (d[k * 4 + 3] < 100) continue;
    const r = d[k * 4], g = d[k * 4 + 1], b = d[k * 4 + 2], s = r + g + b, spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread >= 60 && s < 690) color++;
    else if (s < 450) ink++;
    else if (s < 690) shade++;
  }
  check('line art (shading per ink)', shade < ink * 0.6, (shade / Math.max(1, ink)).toFixed(2), '< 0.6');
  check('no colored marks (per ink)', color < ink * 0.05, (color / Math.max(1, ink)).toFixed(3), '< 0.05');

  let t;
  try { t = targetFromSheet(img, { length: layout.size.length }); } catch (e) { check('views found', false, e.message, 'a side, top and front view'); return { layout, rows }; }
  const f = t.found;
  check('exactly three views', f.views === 3 && !!f.front, `${f.views}${f.front ? '' : ', no front'}`, '3');

  // 3. Closed outlines: each view fills as one solid shape (filling holes adds next to nothing).
  for (const v of ['side', 'top', 'front']) {
    const m = t[v]; if (!m) continue;
    let a = 0, b = 0; const full = fill(m.clone());
    for (let k = 0; k < m.data.length; k++) { a += m.data[k]; b += full.data[k]; }
    check(`${v} view outline closed`, (b - a) / b < 0.02, `${(((b - a) / b) * 100).toFixed(1)}% holes`, '< 2%');
  }

  // 4. The views agree with one another (pixel sizes on the sheet).
  const box = q => ({ w: q.box[2] - q.box[0] + 1, h: q.box[3] - q.box[1] + 1 });
  const s = box(f.side), tp = box(f.top), fr = f.front ? box(f.front) : null;
  const topLong = f.top.turned ? tp.h : tp.w, topWide = f.top.turned ? tp.w : tp.h;
  const frW = fr ? (f.front.turned ? fr.h : fr.w) : 0, frH = fr ? (f.front.turned ? fr.w : fr.h) : 0;
  const off = (a, b) => Math.abs(a / b - 1);
  check('side and top views as long', off(s.w, topLong) < 0.02, `${(off(s.w, topLong) * 100).toFixed(1)}%`, '< 2%');
  if (fr) {
    check('top and front views as wide', off(frW, topWide) < 0.02, `${(off(frW, topWide) * 100).toFixed(1)}%`, '< 2%');
    check('side and front views as tall', off(frH * (topWide / frW), s.h) < 0.03, `${(off(frH * (topWide / frW), s.h) * 100).toFixed(1)}%`, '< 3%');
  }

  // 5. At the length's scale the drawing shows the published span and height.
  const k = layout.size.length / s.w;
  check('span as published', off(topWide * k, layout.size.span) < 0.03, `${(topWide * k).toFixed(2)} m vs ${layout.size.span}`, '< 3%');
  check('height as published', off(s.h * k, layout.size.height) < 0.05, `${(s.h * k).toFixed(2)} m vs ${layout.size.height}`, '< 5%');

  // 6. The gear is drawn in the side view, standing on its wheels.
  let m = null;
  try { m = measure(t); } catch (e) { check('side view readable', false, e.message, ''); }
  if (m) check('gear drawn in the side view', !!m.noseLeg && m.mainLegs.length > 0, `${m.noseLeg ? 'nose' : 'no nose'}, ${m.mainLegs.length} main`, 'nose and main');

  // 7. Enough pixels to read windows, wheels and doors.
  check('resolution', s.w / layout.size.length >= 25, `${(s.w / layout.size.length).toFixed(0)} px/m`, '>= 25');
  return { layout, rows };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1].endsWith('check-drawing.js')) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: npm run check-drawing -- references/new/<id>'); process.exit(1); }
  const { layout, rows } = checkDrawing(dir);
  console.log(layout.name);
  for (const r of rows) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name.padEnd(30)} ${String(r.value).padEnd(26)} (${r.need})`);
  const bad = rows.filter(r => !r.ok).length;
  console.log(bad ? `  ${bad} failed: find a better drawing` : '  all passed: fit to build from');
  process.exitCode = bad ? 1 : 0;
}
