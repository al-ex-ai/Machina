// X-ray geometry for one part: every mesh merged into one fill and one set of crease edges, in the
// part's own space, so x-ray costs two draw calls per part instead of two per mesh. Pure data in and
// out (no three.js), so it runs in a worker (xray-worker.js) or on the main thread alike.

/**
 * @param {{ pos: Float32Array, index: Uint32Array | null, matrix: number[] }[]} meshes positions,
 *   optional triangle index, and a column-major 4x4 matrix from the mesh into the part
 * @param {number} thresholdDeg edges between faces meeting at less than this angle are left out
 * @returns {{ pos: Float32Array, index: Uint32Array, edges: Float32Array }}
 */
export function buildXray(meshes, thresholdDeg) {
  const total = meshes.reduce((n, m) => n + m.pos.length, 0);
  const pos = new Float32Array(total);
  const tris = meshes.reduce((n, m) => n + (m.index ? m.index.length : m.pos.length / 3), 0);
  const index = new Uint32Array(tris);
  const edges = [];
  const cosT = Math.cos(thresholdDeg * Math.PI / 180);
  let vo = 0, io = 0;
  for (const m of meshes) {
    const e = m.matrix, src = m.pos, n = src.length / 3;
    for (let i = 0; i < n; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2], o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const count = m.index ? m.index.length : n;
    for (let i = 0; i < count; i++) index[io + i] = vo + (m.index ? m.index[i] : i);
    creases(pos, index, io, count, cosT, edges);
    vo += n; io += count;
  }
  return { pos, index, edges: new Float32Array(edges) };
}

// The same rule as three.js EdgesGeometry: vertices welded at 1e-4, an edge kept when it borders one
// face only or its two faces meet at more than the threshold angle.
function creases(pos, index, start, count, cosT, out) {
  const key = i => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
  const open = new Map();
  const v = [0, 0, 0], h = ['', '', ''];
  for (let t = start; t + 2 < start + count; t += 3) {
    v[0] = index[t]; v[1] = index[t + 1]; v[2] = index[t + 2];
    h[0] = key(v[0]); h[1] = key(v[1]); h[2] = key(v[2]);
    if (h[0] === h[1] || h[1] === h[2] || h[2] === h[0]) continue;
    const ax = pos[v[0] * 3], ay = pos[v[0] * 3 + 1], az = pos[v[0] * 3 + 2];
    const bx = pos[v[1] * 3], by = pos[v[1] * 3 + 1], bz = pos[v[1] * 3 + 2];
    const cx = pos[v[2] * 3], cy = pos[v[2] * 3 + 1], cz = pos[v[2] * 3 + 2];
    const ux = cx - bx, uy = cy - by, uz = cz - bz, wx = ax - bx, wy = ay - by, wz = az - bz;
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let j = 0; j < 3; j++) {
      const k = (j + 1) % 3, fwd = h[j] + '_' + h[k], rev = h[k] + '_' + h[j];
      const other = open.get(rev);
      if (other) {
        if (nx * other[2] + ny * other[3] + nz * other[4] <= cosT) push(pos, other[0], other[1], out);
        open.set(rev, null);
      } else if (!open.has(fwd)) open.set(fwd, [v[j], v[k], nx, ny, nz]);
    }
  }
  for (const e of open.values()) if (e) push(pos, e[0], e[1], out);
}

function push(pos, a, b, out) {
  out.push(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
}
