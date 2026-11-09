// AC3D (.ac) loader, the text format used by FlightGear aircraft.
// Parsing lives in ac3d-parse.js (worker friendly); this file turns the parsed
// data into a THREE.Group with one named Mesh per AC "poly" object.
import * as THREE from 'three';
import { parseACData } from './ac3d-parse.js';

/**
 * @typedef {{
 *   loadTexture?: (file: string) => THREE.Texture | null,
 *   normalMaps?: Record<string, string>,
 *   hide?: RegExp[],
 * }} ACOptions
 */

/** Parse and build in one go (Node, tests, or browsers without workers). */
export function parseAC(text, opts = {}) {
  const hide = (opts.hide ?? []).map(re => ({ source: re.source, flags: re.flags }));
  return buildAC(parseACData(text, { hide }), opts);
}

/** Build Three.js objects from parsed AC data. */
export function buildAC(data, opts = {}) {
  const { materials } = data;
  const texCache = new Map();
  const getTexture = file => {
    if (!opts.loadTexture || !file) return null;
    if (!texCache.has(file)) texCache.set(file, opts.loadTexture(file));
    return texCache.get(file);
  };
  const matCache = new Map();
  const getMaterial = (mi, tex, twoSided) => {
    const key = `${mi}|${tex}|${twoSided}`;
    if (matCache.has(key)) return matCache.get(key);
    const m = materials[mi] ?? materials[0];
    const map = getTexture(tex);
    const normal = tex && opts.normalMaps?.[tex] ? getTexture(opts.normalMaps[tex]) : null;
    const transparent = m.trans > 0.01 || /alpha|glass/i.test(tex ?? '') || Boolean(tex && opts.glass?.includes(tex)); // opts.glass: textures the model file marks as glass
    const mat = new THREE.MeshStandardMaterial({
      name: m.name,
      color: map ? new THREE.Color(1, 1, 1) : new THREE.Color().setRGB(...m.rgb, THREE.SRGBColorSpace),
      map,
      normalMap: normal,
      roughness: transparent ? 0.05 : THREE.MathUtils.clamp(1 - m.shi / 128, 0.25, 0.85),
      metalness: 0.05,
      transparent,
      opacity: transparent ? Math.min(1 - m.trans, 0.35) || 0.3 : 1,
      // Two-sided always: simulator skins are single sheets, and seen from inside (through a
      // windshield) their back faces would be culled and the walls would vanish.
      side: THREE.DoubleSide,
      depthWrite: !transparent,
    });
    matCache.set(key, mat);
    return mat;
  };

  const toObject3D = n => {
    let node;
    if (n.mesh) {
      const d = n.mesh;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
      const mats = d.groups.map(([start, count, mat, two], gi) => {
        geo.addGroup(start, count, gi);
        return getMaterial(mat, d.texture, Boolean(two));
      });
      node = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
      if (mats.length === 1) geo.clearGroups();
      node.castShadow = node.receiveShadow = true;
      node.userData.texture = d.texture; // kept for the quality report
    } else node = new THREE.Group();
    node.name = n.name;
    if (n.loc) node.position.set(...n.loc);
    if (n.rot) {
      const r = n.rot;
      node.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1));
    }
    for (const k of n.kids) node.add(toObject3D(k));
    return node;
  };

  const root = new THREE.Group();
  for (const n of data.nodes) root.add(toObject3D(n));
  return root;
}

let worker = null;
let seq = 0;
const pending = new Map();

/** Fetch and parse an AC file in a Web Worker, so the page never freezes. */
export function parseACInWorker(url, hide = []) {
  // "noworker" in the URL parses on the main thread (headless screenshots, debugging).
  if (typeof Worker === 'undefined' || /noworker/.test(globalThis.location?.href ?? '')) return fetch(url).then(r => r.text()).then(t => parseACData(t, { hide: hide.map(re => ({ source: re.source, flags: re.flags })) }));
  if (!worker) {
    worker = new Worker(new URL('./ac3d-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (e.data.error) p?.reject(new Error(e.data.error)); else p?.resolve(e.data.data);
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, url: new URL(url, location.href).href, hide: hide.map(re => ({ source: re.source, flags: re.flags })) });
  });
}
