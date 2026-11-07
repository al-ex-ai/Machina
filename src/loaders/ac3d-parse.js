// Pure AC3D parser (no Three.js), so it can run in a Web Worker.
// Returns plain data: materials and a node tree whose meshes are typed arrays.

/**
 * @typedef {{ name: string, rgb: number[], spec: number, shi: number, trans: number }} ACMaterial
 * @typedef {{ position: Float32Array, normal: Float32Array, uv: Float32Array, groups: number[][], texture: string|null }} ACMeshData
 * @typedef {{ name: string, loc: number[]|null, rot: number[]|null, mesh: ACMeshData|null, kids: ACNode[] }} ACNode
 */

/**
 * @param {string} text
 * @param {{ hide?: { source: string, flags: string }[] }} [opts] hide patterns as RegExp sources
 * @returns {{ materials: ACMaterial[], nodes: ACNode[] }}
 */
export function parseACData(text, opts = {}) {
  const hide = (opts.hide ?? []).map(h => new RegExp(h.source, h.flags));
  const lines = text.split(/\r?\n/);
  let i = 0;
  const next = () => lines[i++];
  if (!next()?.startsWith('AC3D')) throw new Error('Not an AC3D file');

  const materials = [];
  while (lines[i]?.startsWith('MATERIAL')) materials.push(parseMaterial(next()));

  const nums = line => {
    const out = [];
    let start = -1;
    for (let k = 0; k <= line.length; k++) {
      const ch = k < line.length ? line.charCodeAt(k) : 32;
      if (ch === 32 || ch === 9) { if (start >= 0) { out.push(+line.slice(start, k)); start = -1; } }
      else if (start < 0) start = k;
    }
    return out;
  };
  const quoted = line => line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));

  function readObject() {
    const type = next().trim().split(/\s+/)[1];
    const o = { type, name: '', texture: null, texrep: [1, 1], texoff: [0, 0], loc: null, rot: null, crease: 61, verts: null, tris: [], kids: [] };
    for (;;) {
      const line = next();
      if (line === undefined) break;
      const sp = line.indexOf(' ');
      const key = sp < 0 ? line.trim() : line.slice(0, sp);
      if (key === 'name') o.name = quoted(line);
      else if (key === 'data') { const n = +line.slice(sp + 1); let got = 0; while (got < n) got += (next()?.length ?? n) + 1; }
      else if (key === 'texture') o.texture = quoted(line);
      else if (key === 'texrep') o.texrep = nums(line.slice(sp + 1));
      else if (key === 'texoff') o.texoff = nums(line.slice(sp + 1));
      else if (key === 'loc') o.loc = nums(line.slice(sp + 1));
      else if (key === 'rot') o.rot = nums(line.slice(sp + 1));
      else if (key === 'crease') o.crease = +line.slice(sp + 1);
      else if (key === 'numvert') {
        const n = +line.slice(sp + 1);
        o.verts = new Float64Array(n * 3);
        for (let k = 0; k < n; k++) {
          const p = nums(next().trim());
          o.verts[k * 3] = p[0]; o.verts[k * 3 + 1] = p[1]; o.verts[k * 3 + 2] = p[2];
        }
      } else if (key === 'numsurf') {
        const n = +line.slice(sp + 1);
        for (let k = 0; k < n; k++) {
          let flags = 0, mat = 0;
          for (;;) {
            const sl = next().trim();
            const ss = sl.indexOf(' ');
            const sk = sl.slice(0, ss);
            if (sk === 'SURF') flags = parseInt(sl.slice(ss + 1), 16);
            else if (sk === 'mat') mat = +sl.slice(ss + 1);
            else if (sk === 'refs') {
              const count = +sl.slice(ss + 1);
              const refs = [];
              for (let r = 0; r < count; r++) refs.push(nums(next().trim()));
              if ((flags & 0xf) === 0 && count >= 3) {
                for (let r = 1; r < count - 1; r++) o.tris.push({ refs: [refs[0], refs[r], refs[r + 1]], flags, mat });
              }
              break;
            }
          }
        }
      } else if (key === 'kids') {
        const n = +line.slice(sp + 1);
        for (let k = 0; k < n; k++) o.kids.push(readObject());
        break;
      }
    }
    return o;
  }

  function toNode(o) {
    const hidden = Boolean(o.name) && hide.some(re => re.test(o.name));
    return {
      name: o.name,
      loc: o.loc,
      rot: o.rot,
      mesh: o.type === 'poly' && o.tris.length && !hidden ? buildMeshData(o) : null,
      kids: hidden ? [] : o.kids.filter(k => k.type !== 'light').map(toNode),
    };
  }

  const nodes = [];
  while (i < lines.length) {
    if (lines[i]?.startsWith('OBJECT')) nodes.push(toNode(readObject()));
    else i++;
  }
  return { materials, nodes };
}

// Face normals, then smooth shading inside the crease angle, grouped by material.
function buildMeshData(o) {
  const v = o.verts;
  const cosCrease = Math.cos((o.crease * Math.PI) / 180);
  const tris = o.tris;
  const fn = new Float64Array(tris.length * 3);
  const vertFaces = new Array(v.length / 3);
  tris.forEach((t, ti) => {
    const a = t.refs[0][0] * 3, b = t.refs[1][0] * 3, c = t.refs[2][0] * 3;
    const ux = v[c] - v[b], uy = v[c + 1] - v[b + 1], uz = v[c + 2] - v[b + 2];
    const wx = v[a] - v[b], wy = v[a + 1] - v[b + 1], wz = v[a + 2] - v[b + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn[ti * 3] = nx / len; fn[ti * 3 + 1] = ny / len; fn[ti * 3 + 2] = nz / len;
    for (const r of t.refs) (vertFaces[r[0]] ??= []).push(ti);
  });

  const order = new Map();
  tris.forEach((t, ti) => {
    const key = `${t.mat}|${(t.flags & 0x20) ? 1 : 0}`;
    if (!order.has(key)) order.set(key, []);
    order.get(key).push(ti);
  });

  const count = tris.length * 3;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const groups = [];
  const [ru, rv] = o.texrep;
  const [ou, ov] = o.texoff;
  let w = 0;
  for (const [key, list] of order) {
    const [mat, two] = key.split('|').map(Number);
    groups.push([w, list.length * 3, mat, two]);
    for (const ti of list) {
      const t = tris[ti];
      const smooth = (t.flags & 0x10) !== 0;
      const nx = fn[ti * 3], ny = fn[ti * 3 + 1], nz = fn[ti * 3 + 2];
      for (const [vi, u, vv] of t.refs) {
        position[w * 3] = v[vi * 3]; position[w * 3 + 1] = v[vi * 3 + 1]; position[w * 3 + 2] = v[vi * 3 + 2];
        uv[w * 2] = u * ru + ou; uv[w * 2 + 1] = vv * rv + ov;
        let ax = nx, ay = ny, az = nz;
        if (smooth) {
          ax = 0; ay = 0; az = 0;
          for (const f of vertFaces[vi]) {
            const mx = fn[f * 3], my = fn[f * 3 + 1], mz = fn[f * 3 + 2];
            if ((tris[f].flags & 0x10) && mx * nx + my * ny + mz * nz >= cosCrease) { ax += mx; ay += my; az += mz; }
          }
          const l = Math.hypot(ax, ay, az);
          if (l === 0) { ax = nx; ay = ny; az = nz; } else { ax /= l; ay /= l; az /= l; }
        }
        normal[w * 3] = ax; normal[w * 3 + 1] = ay; normal[w * 3 + 2] = az;
        w++;
      }
    }
  }
  return { position, normal, uv, groups, texture: o.texture };
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

/** Typed arrays to hand to postMessage as transferables. */
export function transferables(data) {
  const out = [];
  const walk = n => { if (n.mesh) out.push(n.mesh.position.buffer, n.mesh.normal.buffer, n.mesh.uv.buffer); n.kids.forEach(walk); };
  data.nodes.forEach(walk);
  return out;
}
