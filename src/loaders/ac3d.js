// AC3D (.ac) loader, the text format used by FlightGear aircraft.
// Produces a THREE.Group with one named Mesh per AC "poly" object, so each
// object can be mapped to a selectable part. Works in Node (no textures).
import * as THREE from 'three';

/**
 * @typedef {{
 *   loadTexture?: (file: string) => THREE.Texture | null,
 *   normalMaps?: Record<string, string>,
 *   hide?: RegExp[],
 * }} ACOptions
 */

/** @param {string} text @param {ACOptions} [opts] */
export function parseAC(text, opts = {}) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const next = () => lines[i++];
  if (!next()?.startsWith('AC3D')) throw new Error('Not an AC3D file');

  const materials = [];
  while (lines[i]?.startsWith('MATERIAL')) materials.push(parseMaterial(next()));

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
    const transparent = m.trans > 0.01 || /alpha|glass/i.test(tex ?? '');
    const mat = new THREE.MeshPhysicalMaterial({
      name: m.name,
      color: map ? new THREE.Color(1, 1, 1) : new THREE.Color().setRGB(...m.rgb, THREE.SRGBColorSpace),
      map,
      normalMap: normal,
      roughness: THREE.MathUtils.clamp(1 - m.shi / 128, 0.25, 0.85),
      metalness: 0.05,
      clearcoat: m.spec > 0.3 ? 0.5 : 0.1,
      clearcoatRoughness: 0.3,
      transparent,
      opacity: transparent ? Math.min(1 - m.trans, 0.35) || 0.3 : 1,
      side: twoSided || transparent ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: !transparent,
    });
    if (transparent) { mat.transmission = 0; mat.roughness = 0.05; }
    matCache.set(key, mat);
    return mat;
  };

  function readObject() {
    const header = next();
    const type = header.split(/\s+/)[1];
    const o = { type, name: '', texture: null, texrep: [1, 1], texoff: [0, 0], loc: null, rot: null, crease: 61, verts: [], surfs: [], kids: [] };
    for (;;) {
      const line = next();
      if (line === undefined) break;
      const [key, ...rest] = line.trim().split(/\s+/);
      if (key === 'name') o.name = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
      else if (key === 'data') { const n = Number(rest[0]); let got = 0; while (got < n) got += (next()?.length ?? n) + 1; }
      else if (key === 'texture') o.texture = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
      else if (key === 'texrep') o.texrep = rest.map(Number);
      else if (key === 'texoff') o.texoff = rest.map(Number);
      else if (key === 'loc') o.loc = rest.map(Number);
      else if (key === 'rot') o.rot = rest.map(Number);
      else if (key === 'crease') o.crease = Number(rest[0]);
      else if (key === 'numvert') {
        const n = Number(rest[0]);
        for (let k = 0; k < n; k++) o.verts.push(next().trim().split(/\s+/).map(Number));
      } else if (key === 'numsurf') {
        const n = Number(rest[0]);
        for (let k = 0; k < n; k++) {
          const surf = { flags: 0, mat: 0, refs: [] };
          for (;;) {
            const [sk, sv] = next().trim().split(/\s+/);
            if (sk === 'SURF') surf.flags = parseInt(sv, 16);
            else if (sk === 'mat') surf.mat = Number(sv);
            else if (sk === 'refs') {
              for (let r = 0; r < Number(sv); r++) {
                const [vi, u, v] = next().trim().split(/\s+/).map(Number);
                surf.refs.push([vi, u, v]);
              }
              break;
            }
          }
          o.surfs.push(surf);
        }
      } else if (key === 'kids') {
        const n = Number(rest[0]);
        for (let k = 0; k < n; k++) o.kids.push(readObject());
        break;
      }
    }
    return o;
  }

  function toObject3D(o) {
    const hidden = o.name && opts.hide?.some(re => re.test(o.name));
    let node;
    if (o.type === 'poly' && o.surfs.length && !hidden) node = buildMesh(o);
    else node = new THREE.Group();
    node.name = o.name;
    if (o.loc) node.position.set(...o.loc);
    if (o.rot) {
      const r = o.rot;
      const m = new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      node.quaternion.setFromRotationMatrix(m);
    }
    if (!hidden) for (const k of o.kids) if (k.type !== 'light') node.add(toObject3D(k));
    return node;
  }

  function buildMesh(o) {
    // Triangulate (fan), compute face normals, then smooth within the crease angle.
    const cosCrease = Math.cos(THREE.MathUtils.degToRad(o.crease));
    const tris = [];
    for (const s of o.surfs) {
      if ((s.flags & 0xf) !== 0 || s.refs.length < 3) continue; // skip lines
      for (let k = 1; k < s.refs.length - 1; k++) tris.push({ refs: [s.refs[0], s.refs[k], s.refs[k + 1]], s });
    }
    const v = o.verts;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const t of tris) {
      a.fromArray(v[t.refs[0][0]]); b.fromArray(v[t.refs[1][0]]); c.fromArray(v[t.refs[2][0]]);
      t.n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    }
    const byVert = new Map();
    tris.forEach(t => t.refs.forEach(([vi]) => { if (!byVert.has(vi)) byVert.set(vi, []); byVert.get(vi).push(t); }));

    // Group triangles by material/texture so each group gets one draw call.
    const groups = new Map();
    for (const t of tris) {
      const twoSided = (t.s.flags & 0x20) !== 0;
      const key = `${t.s.mat}|${twoSided}`;
      if (!groups.has(key)) groups.set(key, { mat: t.s.mat, twoSided, tris: [] });
      groups.get(key).tris.push(t);
    }
    const pos = [], nor = [], uv = [], geoGroups = [], mats = [];
    const [ru, rv] = o.texrep;
    const [ou, ov] = o.texoff;
    let start = 0;
    for (const g of groups.values()) {
      for (const t of g.tris) {
        const smooth = (t.s.flags & 0x10) !== 0;
        for (const [vi, u, vv] of t.refs) {
          pos.push(...v[vi]);
          uv.push(u * ru + ou, vv * rv + ov);
          if (!smooth) { nor.push(t.n.x, t.n.y, t.n.z); continue; }
          const acc = new THREE.Vector3();
          for (const o2 of byVert.get(vi)) if ((o2.s.flags & 0x10) && o2.n.dot(t.n) >= cosCrease) acc.add(o2.n);
          if (acc.lengthSq() === 0) acc.copy(t.n);
          acc.normalize();
          nor.push(acc.x, acc.y, acc.z);
        }
      }
      const count = g.tris.length * 3;
      geoGroups.push([start, count, mats.length]);
      mats.push(getMaterial(g.mat, o.texture, g.twoSided));
      start += count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    for (const [s, n, m] of geoGroups) geo.addGroup(s, n, m);
    const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const root = new THREE.Group();
  while (i < lines.length) {
    if (lines[i]?.startsWith('OBJECT')) root.add(toObject3D(readObject()));
    else i++;
  }
  return root;
}

function parseMaterial(line) {
  const name = line.match(/"([^"]*)"/)?.[1] ?? '';
  const num = key => {
    const m = line.match(new RegExp(`\\b${key}\\s+([-\\d.e]+)(?:\\s+([-\\d.e]+)\\s+([-\\d.e]+))?`));
    return m ? (m[2] !== undefined ? [Number(m[1]), Number(m[2]), Number(m[3])] : Number(m[1])) : null;
  };
  const spec = num('spec');
  return {
    name,
    rgb: num('rgb') ?? [0.8, 0.8, 0.8],
    spec: Array.isArray(spec) ? (spec[0] + spec[1] + spec[2]) / 3 : 0.3,
    shi: num('shi') ?? 32,
    trans: num('trans') ?? 0,
  };
}
