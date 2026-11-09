// The Machina livery on any detailed model, painted in the shader by position on the
// body: navy belly, an orange cheatline that follows the fuselage, a navy tail and the
// MACHINA title on both sides. The fuselage outline is measured from the geometry, so
// no per-model texture work is needed. Only light paint is replaced: windows, doors,
// panel lines and other dark detail in the original texture stay.
import * as THREE from 'three';
import { drawTitle } from './parametric/livery.js';

const N = 64;
const NAVY = '#18273a', ORANGE = '#ff8a3d', WHITE = '#f4f5f7';

/** Title canvas: the Machina mark and wordmark, drawn once. */
let titleTex = null;
function title() {
  if (titleTex || typeof document === 'undefined') return titleTex;
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 256;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.scale(200, 200);
  drawTitle(g, { text: 'MACHINA', height: 0.85, color: NAVY, markColor: ORANGE });
  titleTex = new THREE.CanvasTexture(c);
  titleTex.colorSpace = THREE.SRGBColorSpace;
  titleTex.anisotropy = 8;
  return titleTex;
}

/**
 * Measure the fuselage along x in root coordinates: bottom and height at N stations,
 * from the vertices of the painted parts near the centerline (wings and engines left out).
 */
function measure(meshes, toRoot) {
  const pts = [];
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, M = toRoot.get(m);
    const step = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(M); pts.push(v.x, v.y, v.z); }
  }
  let x0 = Infinity, x1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); }
  const bin = x => Math.min(N - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * N)));
  // Body half-width: the typical side extent in the middle of the body.
  const zs = Array.from({ length: N }, () => []);
  for (let i = 0; i < pts.length; i += 3) zs[bin(pts[i])].push(Math.abs(pts[i + 2]));
  const mid = zs.slice(N * 0.3, N * 0.6).map(a => { a.sort((p, q) => p - q); return a[Math.floor(a.length * 0.5)] ?? 0; }).sort((p, q) => p - q);
  const half = Math.max(0.3, (mid[Math.floor(mid.length / 2)] ?? 1) * 1.2);
  // Bottom and top at each station from where the triangles cross it (skins are often
  // long thin triangles, so vertices alone leave stations with only a top or a bottom).
  const bot = new Array(N).fill(Infinity), top = new Array(N).fill(-Infinity);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const xs = Array.from({ length: N }, (_, k) => x0 + ((k + 0.5) / N) * (x1 - x0));
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, idx = m.geometry.index, M = toRoot.get(m);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M);
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(M);
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(M);
      const lo = Math.min(a.x, b.x, c.x), hi = Math.max(a.x, b.x, c.x);
      for (let k = Math.max(0, bin(lo)); k <= Math.min(N - 1, bin(hi)); k++) {
        const x = xs[k];
        if (x < lo || x > hi) continue;
        for (const [p, q] of [[a, b], [b, c], [c, a]]) {
          if ((p.x - x) * (q.x - x) > 0 || p.x === q.x) continue;
          const t = (x - p.x) / (q.x - p.x), y = p.y + (q.y - p.y) * t, z = p.z + (q.z - p.z) * t;
          if (Math.abs(z) > half) continue;
          bot[k] = Math.min(bot[k], y); top[k] = Math.max(top[k], y);
        }
      }
    }
  }
  // Fill empty stations from their neighbors.
  for (let k = 0; k < N; k++) if (!Number.isFinite(bot[k])) { const j = [...Array(N).keys()].sort((p, q) => Math.abs(p - k) - Math.abs(q - k)).find(q => Number.isFinite(bot[q])); bot[k] = bot[j]; top[k] = top[j]; }
  // Smooth over five stations: fairings and gear bays would make the cheatline wobble.
  const smooth = arr => arr.map((_, k) => { let s2 = 0, n = 0; for (let j = Math.max(0, k - 2); j <= Math.min(N - 1, k + 2); j++) { s2 += arr[j]; n++; } return s2 / n; });
  const botS = smooth(bot), topS = smooth(top);
  for (let k = 0; k < N; k++) { bot[k] = botS[k]; top[k] = topS[k]; }
  const h = top.map((t, k) => t - bot[k]);
  const h0 = [...h.slice(N * 0.25, N * 0.55)].sort((p, q) => p - q)[Math.floor(N * 0.15)] ?? 3;
  return { x0, x1, bot, h: h.map(q => Math.min(q, h0)), h0 };
}

const VERT_HEAD = 'uniform mat4 uToRoot;\nvarying vec3 vLiv;\nvarying vec3 vLivN;\n';
const FRAG_HEAD = `uniform float uBot[${N}];\nuniform float uH[${N}];\nuniform vec2 uX;\nuniform float uH0;\nuniform vec3 uBase, uBelly, uStripe, uTail;\nuniform float uTailAll;\nuniform vec4 uTitleBox;\nuniform sampler2D uTitle;\nvarying vec3 vLiv;\nvarying vec3 vLivN;\n`;
const FRAG_BODY = `
  {
    float fx = clamp((vLiv.x - uX.x) / (uX.y - uX.x), 0.0, 1.0) * ${N - 1}.0;
    int i0 = int(floor(fx)); int i1 = min(i0 + 1, ${N - 1}); float ft = fract(fx);
    float bot = mix(uBot[i0], uBot[i1], ft), hh = mix(uH[i0], uH[i1], ft);
    float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    float paint = smoothstep(0.5, 0.72, lum);
    float cheat = bot + 0.36 * hh, band = 0.045 * uH0;
    vec3 col = vLiv.y < cheat ? uBelly : (vLiv.y < cheat + band ? uStripe : uBase);
    bool fin = vLiv.y > bot + hh + 0.12 * uH0 && vLiv.x > uX.x + 0.62 * (uX.y - uX.x);
    if (uTailAll > 0.5 || fin) col = uTail;
    vec2 t = vec2((vLiv.x - uTitleBox.x) / uTitleBox.z, (vLiv.y - uTitleBox.y) / uTitleBox.w); // canvas textures are flipped in v already
    if (vLiv.z < 0.0) t.x = 1.0 - t.x; // right side (z < 0): mirror so the title reads normally from that side too
    if (abs(vLivN.z) > 0.3 && t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0 && uTailAll < 0.5) { vec4 tc = texture2D(uTitle, t); col = mix(col, tc.rgb, tc.a); }
    diffuseColor.rgb = mix(diffuseColor.rgb, col * clamp(lum / 0.9, 0.55, 1.0), paint);
  }
`;

function patch(mat, uniforms) {
  if (mat.transparent) return;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiv = (uToRoot * vec4(transformed, 1.0)).xyz;\nvLivN = normalize(mat3(uToRoot) * objectNormal);');
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + FRAG_BODY);
  };
  mat.customProgramCacheKey = () => 'machina-paint';
  mat.needsUpdate = true;
}

/**
 * Paint the Machina livery onto a loaded detailed model (before finalize).
 * cfg (model.asset.machina): { parts: body part ids, tail: part ids painted all tail color }
 * @param {{ stripe?: string }} [opts] stripe overrides the cheatline color
 */
export function applyMachinaPaint(root, cfg, opts = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toRoot = new Map();
  const meshesOf = ids => {
    const out = [];
    root.traverse(o => { if (o.userData.part && ids.includes(o.userData.id)) o.traverse(q => { if (q.isMesh) { out.push(q); toRoot.set(q, new THREE.Matrix4().multiplyMatrices(inv, q.matrixWorld)); } }); });
    return out;
  };
  // Cabin shells often lie exactly on the skin; drawn two-sided they would show through the
  // paint in patches. Push interior surfaces slightly back in depth so the skin wins.
  root.traverse(o => {
    if (o.userData.part && o.userData.system === 'interior') o.traverse(q => {
      if (q.isMesh) for (const mat of [q.material].flat()) { mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 2; }
    });
  });
  const body = meshesOf(cfg.parts ?? ['fuselage']), tail = meshesOf(cfg.tail ?? []);
  if (!body.length) return;
  const p = measure(body, toRoot);
  const L = p.x1 - p.x0;
  // Title: a third of the way back, above the window line.
  const k = Math.floor(N * 0.33), th = 0.2 * p.h0, tw = th * 7.2;
  const tx = p.x0 + L * (cfg.titleAt ?? 0.33) - tw / 2, ty = p.bot[k] + (cfg.titleY ?? 0.82) * p.h[k] - th / 2;
  const common = {
    uBot: { value: p.bot }, uH: { value: p.h }, uX: { value: new THREE.Vector2(p.x0, p.x1) }, uH0: { value: p.h0 },
    uBase: { value: new THREE.Color(WHITE) }, uBelly: { value: new THREE.Color(NAVY) }, uStripe: { value: new THREE.Color(opts.stripe ?? ORANGE) }, uTail: { value: new THREE.Color(NAVY) },
    uTitleBox: { value: new THREE.Vector4(tx, ty, tw, th) }, uTitle: { value: title() },
  };
  for (const [list, tailAll] of [[body, 0], [tail, 1]]) for (const m of list) {
    const u = { ...common, uToRoot: { value: toRoot.get(m) }, uTailAll: { value: tailAll } };
    for (const mat of [m.material].flat()) patch(mat, u);
  }
}
