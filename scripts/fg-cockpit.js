// Bring a FlightGear aircraft's cockpit to life: every cockpit file of the asset (instruments, yokes,
// throttle quadrants, pedals) gets the animations of the XML that places it, through
// scripts/fg-pose.js --instruments. Walks the XML tree from the top model like
// scripts/import-fg-interior.js and pairs the files it finds with the asset's, in order.
// Files whose animations came from an airframe run (gear, wheels, propellers) are left alone.
// Usage: node scripts/fg-cockpit.js <aircraftRoot> data/models/aviation/<id>.json Models/<top>.xml
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const [root, modelFile, top] = process.argv.slice(2);
if (!root || !modelFile || !top) { console.error('Usage: node scripts/fg-cockpit.js <aircraftRoot> <model.json> Models/<top>.xml'); process.exit(1); }
const aircraftName = basename(normalize(root));

function resolvePath(p, fromDir) {
  p = p.trim().replace(/\\/g, '/');
  const abs = /^Aircraft\/([^/]+)\/(.*)$/.exec(p);
  if (abs) return abs[1].toLowerCase() === aircraftName.toLowerCase() || existsSync(join(root, abs[2])) ? normalize(join(root, abs[2])) : null;
  const rel = normalize(join(fromDir, p));
  return existsSync(rel) || !existsSync(join(root, p)) ? rel : normalize(join(root, p));
}

// Every .ac the tree places, in walk order, with the XML that animates it (null when a <model> names the .ac directly).
const found = [];
const seen = new Set();
function walk(xmlPath, depth) {
  if (!existsSync(xmlPath) || depth > 12) return;
  const key = xmlPath + '#' + found.length;
  if (seen.has(key)) return;
  seen.add(key);
  const text = readFileSync(xmlPath, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
  const dir = dirname(xmlPath);
  const own = text.replace(/<(model|animation|text|light|effect|particlesystem|params)>[\s\S]*?<\/\1>/g, '');
  const ownPath = /<path>\s*([^<]+?)\s*<\/path>/.exec(own)?.[1];
  if (ownPath && /\.ac$/i.test(ownPath)) {
    const ac = resolvePath(ownPath, dir);
    if (ac && existsSync(ac)) found.push({ file: relative(root, ac).replace(/\\/g, '/'), xml: xmlPath });
  }
  for (const [, b] of text.matchAll(/<model>([\s\S]*?)<\/model>/g)) {
    const p = /<path>\s*([^<]+?)\s*<\/path>/.exec(b)?.[1];
    if (!p) continue;
    const target = resolvePath(p, dir);
    if (!target) continue;
    if (/\.xml$/i.test(target)) walk(target, depth + 1);
    else if (/\.ac$/i.test(target) && existsSync(target)) found.push({ file: relative(root, target).replace(/\\/g, '/'), xml: null });
  }
}
walk(normalize(join(root, top)), 0);

const model = JSON.parse(readFileSync(modelFile, 'utf8'));
const files = model.asset.files ?? [{ file: model.asset.file }];
const AIRFRAME = /compression-norm$|^velocities\/uBody-fps$/; // oleos and wheels: only airframe files have them
const COCKPIT = /<property>\s*\/?(controls\/(flight|engines|gear)|instrumentation\/|engines\/engine|orientation\/|surface-positions\/|velocities\/airspeed|fdm\/jsbsim\/velocities|sim\/model\/[^<]*cockpit)/;

// Pair the k-th asset entry of a file with the k-th placement the tree gives it.
const byFile = new Map();
for (const f of found) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f); }
const used = new Map();
let ran = 0, kept = 0, skipped = 0;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const k = used.get(f.file) ?? 0;
  used.set(f.file, k + 1);
  const src = byFile.get(f.file)?.[Math.min(k, (byFile.get(f.file)?.length ?? 1) - 1)];
  if (!src?.xml) continue;
  // Only cockpit and cabin files: the airframe's own files keep what their recipe gave them (gear poses,
  // oleo settings, surface rest positions), which an instrument run would drop.
  if (f.fallback?.system !== 'interior' && (f.pose || !/cockpit|flightdeck|pedestal|panel|instrument|yoke|throttle|pedal|gear-ctl/i.test(f.file))) continue;
  // An airframe file (gear, oleos, wheels, propellers) keeps the animations its own recipe gave it.
  if ((f.anim ?? []).some(t => t.type === 'spin' || AIRFRAME.test(t.prop))) { skipped++; continue; }
  const xml = readFileSync(src.xml, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
  const anims = [...xml.matchAll(/<animation>([\s\S]*?)<\/animation>/g)].map(m => m[1]);
  if (!anims.some(a => COCKPIT.test(a) || /alias="\/params/.test(a))) continue;
  const out = execFileSync(process.execPath, ['scripts/fg-pose.js', src.xml, modelFile, String(i), '--anim', '--instruments'], { encoding: 'utf8' });
  const n = Number(/kept (\d+) anim/.exec(out)?.[1] ?? 0);
  ran++; kept += n;
}
console.log(`${model.id}: ${found.length} placed files, ran ${ran} cockpit XMLs, kept ${kept} animations, left ${skipped} airframe files as they were`);
