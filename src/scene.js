// Renderer, camera, lighting, selection and exploded view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeMannequin } from './parts/mannequin.js';

const HDRI = './assets/hdri/studio_small_08.hdr'; // Poly Haven, CC0

/** Backdrop gradient, grid and shadow strength for each UI theme. */
const STAGE = {
  dark: { sky: ['#33414f', '#212b36', '#141a21'], grid: ['#5a7086', '#3a4a5b'], shadow: 0.45, xray: '#7fd4ff' },
  light: { sky: ['#ffffff', '#f1f4f7', '#e2e8ee'], grid: ['#5f6f80', '#97a5b4'], gridOpacity: 0.85, shadow: 0.2, xray: '#0b7fc0' },
  blueprint: { sky: ['#1e5a90', '#134574', '#0a2b4c'], grid: ['#8fb6dc', '#3f72a6'], shadow: 0.4, xray: '#ffffff' },
};
const stageFor = name => STAGE[name] ?? STAGE.dark;

/** Vertical gradient used as the scene backdrop, matched to the UI theme. */
function backdrop(name) {
  const { sky } = stageFor(name);
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, sky[0]);
  grad.addColorStop(0.62, sky[1]);
  grad.addColorStop(1, sky[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _sunOff = new THREE.Vector3(), _sunC = new THREE.Vector3(), _zero = new THREE.Vector3(), _sunRot = new THREE.Matrix4(), _sunInv = new THREE.Matrix4();

/** A clear day sky, deep blue overhead to pale haze at the horizon. */
function daySky() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#4a7fb5');
  grad.addColorStop(0.55, '#9dbcd8');
  grad.addColorStop(1, '#d6e0e8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HIGHLIGHT = new THREE.Color('#ff8a3d');
const HOVER = new THREE.Color('#ffb27a');

/**
 * A soft studio environment for reflections: a sky-to-floor gradient dome with a
 * few bright softbox panels, prefiltered once with PMREM.
 */
export function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.SphereGeometry(50, 48, 24);
  const colors = [];
  const pos = dome.attributes.position;
  const top = new THREE.Color('#f4f7fb');
  const horizon = new THREE.Color('#c9d2dc');
  const floor = new THREE.Color('#6b7480');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 50;
    if (t >= 0) c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    else c.copy(horizon).lerp(floor, Math.min(1, -t * 2.5));
    colors.push(c.r, c.g, c.b);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) });
  for (const [x, y, z, w, h] of [[0, 40, 0, 40, 18], [-35, 18, 20, 4, 24], [30, 14, -25, 4, 18]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), panel);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.background = backdrop(document.documentElement.dataset.theme);
  new RGBELoader().load(HDRI, hdr => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    scene.environmentIntensity = 0.9;
    hdr.dispose();
    pmrem.dispose();
    invalidate(true);
  });
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  // Every frame goes through the composer, so the canvas's own antialiasing never
  // applies. Multisampled render targets smooth the edges instead.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.output = GTAOPass.OUTPUT.Default;
  // The gradient backdrop must not be drawn into GTAO's normal and depth pre-pass:
  // it corrupts those buffers behind the model and shows up as black blocks.
  const renderOverride = gtao.renderOverride.bind(gtao);
  gtao.renderOverride = (...args) => {
    const bg = scene.background;
    scene.background = null;
    renderOverride(...args);
    scene.background = bg;
  };
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;

  // Render on demand. While the camera moves we draw fast frames (no ambient
  // occlusion); once it rests we draw a single full-quality frame.
  let dirty = true;
  let fullPending = true;
  let lastMove = 0;
  let dragging = false;
  function invalidate(full = false) {
    dirty = true;
    fullPending = true;
    if (full) lastMove = 0;
  }
  controls.addEventListener('change', () => { lastMove = performance.now(); invalidate(); });
  controls.addEventListener('start', () => { dragging = true; });
  controls.addEventListener('end', () => { dragging = false; lastMove = performance.now(); });

  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c2cc', 0.35));
  const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.autoUpdate = false; // shadows only change with the model, not the camera
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let grid = null;
  let outdoor = false;

  // Person for scale: 1.8 m tall
  const person = makeMannequin();
  person.visible = false;
  scene.add(person);

  // X-ray view: translucent fill plus cyan edges; the selected part stays solid.
  let xray = false;
  let ao = true;
  const XRAY_FILL = new THREE.MeshBasicMaterial({ color: '#5ec8ff', transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const XRAY_EDGE = new THREE.LineBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.45, depthWrite: false });
  // The interior (seats, consoles, cabin) is what x-ray is for: a stronger fill and finer edges,
  // so rounded seats that have few sharp creases still read through the skin.
  const XRAY_FILL_INSIDE = new THREE.MeshBasicMaterial({ color: '#5ec8ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const XRAY_EDGE_INSIDE = new THREE.LineBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.7, depthWrite: false });
  // Hides a mesh from the render while keeping it pickable (the raycaster ignores material visibility).
  const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
  const SHARED = new Set([XRAY_FILL, XRAY_EDGE, XRAY_FILL_INSIDE, XRAY_EDGE_INSIDE, HIDDEN]);

  /** A part's own meshes, not those of parts nested in it. */
  function meshesOf(p) {
    if (!p.userData.meshes) {
      const out = [];
      const walk = o => { for (const c of o.children) if (!c.userData?.part && !c.userData?.xrayOf) { if (c.isMesh) out.push(c); walk(c); } };
      if (p.isMesh) out.push(p);
      walk(p);
      p.userData.meshes = out;
    }
    return p.userData.meshes;
  }

  // Each part's x-ray geometry (all its meshes merged into one fill and one edge set) is built in a
  // worker shortly after the model loads, so the first toggle is instant. Until a part's merged
  // geometry arrives, its meshes swap to the fill material one by one.
  let xrayWorker = null, xraySeq = 0, xrayGen = 0;
  const xrayPending = new Map();
  function runXrayBuild(meshes, threshold) {
    if (typeof Worker === 'undefined' || /noworker/.test(location.href)) return import('./xray-build.js').then(m => m.buildXray(meshes, threshold));
    if (!xrayWorker) {
      xrayWorker = new Worker(new URL('./xray-worker.js', import.meta.url), { type: 'module' });
      xrayWorker.onmessage = e => {
        const p = xrayPending.get(e.data.id);
        xrayPending.delete(e.data.id);
        if (e.data.error) p?.reject(new Error(e.data.error)); else p?.resolve(e.data.data);
      };
    }
    const id = ++xraySeq;
    const transfer = meshes.flatMap(m => (m.index ? [m.pos.buffer, m.index.buffer] : [m.pos.buffer]));
    return new Promise((resolve, reject) => { xrayPending.set(id, { resolve, reject }); xrayWorker.postMessage({ id, meshes, threshold }, transfer); });
  }
  function positionsOf(g) {
    const a = g.attributes.position;
    if (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized) return a.array.slice(0, a.count * 3);
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
    return out;
  }
  function prepareXray() {
    if (!model || model.userData.xrayQueued) return;
    model.userData.xrayQueued = true;
    const gen = xrayGen, root = model;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
    // One part at a time, so a model switch stops the queue early and the worker never holds the whole model.
    (async () => {
      for (const p of [...parts]) {
        if (gen !== xrayGen) return;
        const own = meshesOf(p).filter(o => o.geometry?.attributes.position);
        if (!own.length) continue;
        inv.copy(p.matrixWorld).invert();
        const meshes = own.map(o => ({
          pos: positionsOf(o.geometry),
          index: o.geometry.index ? Uint32Array.from(o.geometry.index.array) : null,
          matrix: rel.multiplyMatrices(inv, o.matrixWorld).toArray(),
        }));
        const inside = p.userData.system === 'interior';
        const r = await runXrayBuild(meshes, inside ? 20 : 35).catch(() => null);
        if (!r || gen !== xrayGen) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
        g.setIndex(new THREE.BufferAttribute(r.index, 1));
        const group = new THREE.Group();
        group.userData.xrayOf = p;
        const fill = new THREE.Mesh(g, inside ? XRAY_FILL_INSIDE : XRAY_FILL);
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.BufferAttribute(r.edges, 3));
        const lines = new THREE.LineSegments(eg, inside ? XRAY_EDGE_INSIDE : XRAY_EDGE);
        for (const o of [fill, lines]) { o.raycast = () => {}; o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; }
        group.add(fill, lines);
        group.visible = false;
        p.add(group);
        p.userData.xray = group;
        if (xray) { applyXrayPart(p); invalidate(true); }
        await new Promise(res => setTimeout(res, 0));
      }
    })();
  }
  function applyXrayPart(p) {
    const solid = !xray || p === selected;
    const merged = p.userData.xray;
    const fill = p.userData.system === 'interior' ? XRAY_FILL_INSIDE : XRAY_FILL;
    const stand = merged ? HIDDEN : fill;
    for (const o of meshesOf(p)) {
      o.userData.solid ??= o.material;
      o.userData.shadow ??= o.castShadow;
      o.material = solid ? o.userData.solid : Array.isArray(o.userData.solid) ? o.userData.solid.map(() => stand) : stand;
      o.castShadow = xray ? false : o.userData.shadow;
    }
    if (merged) merged.visible = !solid;
  }
  function applyXray() {
    if (xray) prepareXray();
    for (const p of parts) applyXrayPart(p);
    renderer.shadowMap.needsUpdate = true;
  }

  let model = null;
  let parts = [];
  let selected = null;
  let hovered = null;
  let explodeAmount = 0;
  let themeName = document.documentElement.dataset.theme || 'dark';
  const listeners = { select: [], hover: [] };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;

  // While the viewer is parked off-page it measures 0 x 0. Ignore that size, and
  // finish any framing that was asked for once the viewer is visible again.
  let framePending = false;
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    invalidate(true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (framePending && model) frame();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function partFrom(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData?.part) return o;
    return null;
  }

  function paint(part, color, intensity) {
    part?.traverse(o => {
      if (o.isMesh) for (const m of [o.material].flat()) { m.emissive?.copy(color ?? new THREE.Color(0)); m.emissiveIntensity = intensity; }
    });
  }

  function refreshPaint() {
    invalidate(true);
    for (const p of parts) paint(p, null, 0);
    if (hovered && hovered !== selected) paint(hovered, HOVER, 0.35);
    if (selected) paint(selected, HIGHLIGHT, 0.55);
  }

  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = model ? raycaster.intersectObject(model, true)[0] : null;
    return hit ? partFrom(hit.object) : null;
  }

  let picking = false; // clicking parts in the view is off until the Select tool is on
  renderer.domElement.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!picking || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    select(pick(ev));
  });
  renderer.domElement.addEventListener('pointermove', ev => {
    if (!picking) return;
    const p = pick(ev);
    if (p !== hovered) {
      hovered = p;
      renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
      refreshPaint();
      listeners.hover.forEach(f => f(p ? p.userData : null, ev));
    } else if (p) listeners.hover.forEach(f => f(p.userData, ev));
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    hovered = null; refreshPaint(); listeners.hover.forEach(f => f(null));
  });

  function select(part) {
    selected = part;
    if (xray) applyXray();
    refreshPaint();
    listeners.select.forEach(f => f(part ? part.userData : null));
  }

  function computeExplode() {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    for (const p of parts) {
      p.userData.base = p.position.clone();
      const c = new THREE.Box3().setFromObject(p).getCenter(new THREE.Vector3());
      const dir = c.sub(center);
      dir.y = Math.max(dir.y, 0) + size * 0.02;
      p.userData.explodeDir = dir.multiplyScalar(0.6);
    }
  }

  function applyExplode() {
    for (const p of parts) p.position.copy(p.userData.base).addScaledVector(p.userData.explodeDir, explodeAmount);
  }

  // Camera presets: null is the default three-quarter view. "apron" looks at a wingtip-to-wingtip
  // line-up nose on and from above, so every model in it is about the same distance away; "stack" is
  // a higher three-quarter view for Compare's overlay, where the wing outlines matter most.
  const VIEWS = { front: [-1, 0.06, 0], side: [0, 0.06, 1], right: [0, 0.06, -1], top: [0.001, 1, 0], rear: [1, 0.12, 0], apron: [-0.62, 0.78, 0.1], stack: [-0.55, 0.72, 0.5] };
  let view = null;
  let fit = 0.78;
  function frame() {
    if (outdoor) return; // the outdoor scene drives the camera itself
    if (!container.clientWidth || !container.clientHeight) { framePending = true; return; }
    framePending = false;
    if (container.clientWidth / container.clientHeight !== camera.aspect) resize();
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    const center = box.getCenter(new THREE.Vector3());
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dir = VIEWS[view] ?? [-0.62, 0.42, 0.66];
    // Distance at which every corner of the box is inside the view (with a margin), so long thin
    // machines are not cropped; fit then tightens it, capped so nothing leaves the frame.
    const back = new THREE.Vector3(...dir).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    const tx = Math.tan(hFov / 2) * 0.94, ty = Math.tan(vFov / 2) * 0.94;
    let need = 0;
    for (const sx of [box.min.x, box.max.x]) for (const sy of [box.min.y, box.max.y]) for (const sz of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(sx, sy, sz).sub(center);
      const z = p.dot(back);
      need = Math.max(need, z + Math.abs(p.dot(right)) / tx, z + Math.abs(p.dot(up)) / ty);
    }
    const dist = Math.max(need, (radius / Math.sin(Math.min(vFov, hFov) / 2)) * fit);
    camera.position.set(center.x + dist * dir[0], center.y + dist * dir[1], center.z + dist * dir[2]);
    camera.near = radius / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    gtao.updateGtaoMaterial({ radius: radius * 0.05, distanceExponent: 1.5, thickness: radius * 0.02, scale: 1 });
    controls.minDistance = radius * 0.4;
    controls.maxDistance = dist * 4;
    // "cam=px,py,pz,tx,ty,tz" in the URL places the camera exactly (close-up screenshots).
    const cam = /[?&#]cam=([-\d.,]+)/.exec(globalThis.location?.href ?? '')?.[1]?.split(',').map(Number);
    if (cam?.length === 6) {
      controls.minDistance = 0.1;
      camera.position.set(cam[0], cam[1], cam[2]);
      controls.target.set(cam[3], cam[4], cam[5]);
    }
    controls.update();

    const span = Math.max(size.x, size.z) * 4;
    ground.scale.set(span, span, 1);
    if (grid) scene.remove(grid);
    const step = span > 300 ? 10 : span > 60 ? 5 : 1;
    grid = new THREE.GridHelper(span, Math.round(span / step), ...stageFor(themeName).grid);
    grid.material.transparent = true;
    grid.material.opacity = stageFor(themeName).gridOpacity ?? 0.55;
    grid.position.y = 0.001;
    scene.add(grid);

    sun.position.set(center.x - radius * 1.2, radius * 3, center.z + radius * 1.6);
    sun.target.position.copy(center);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -radius * 1.6;
    sc.right = sc.top = radius * 1.6;
    sc.near = 0.1;
    sc.far = radius * 8;
    sc.updateProjectionMatrix();

    // Stand the person just ahead of the nose on the camera side, turned toward the viewer.
    person.position.set(box.min.x + size.x * 0.06, 0, center.z + Math.max(size.z * 0.1, 1.2));
    person.rotation.y = -2.4;
    renderer.shadowMap.needsUpdate = true;
    invalidate(true);
  }

  // Per-frame callbacks for animations. Each runs every frame until it returns false; the viewer
  // otherwise renders only on demand. Replacing or clearing the model stops them.
  const anims = new Set();

  function clearModel() {
    anims.clear();
    if (!model) return;
    scene.remove(model);
    // Textures are usually shared with a loader cache, so only those a material owns outright
    // (userData.ownsMap, like Compare's ground labels) are freed here.
    xrayGen++; // x-ray builds still queued for this model are dropped
    model.traverse(o => {
      if (!o.isMesh && !o.isLineSegments) return;
      o.geometry.dispose();
      for (const m of new Set([o.material, o.userData.solid].flat())) { if (!m || SHARED.has(m)) continue; if (m.userData?.ownsMap) m.map?.dispose(); m.dispose(); }
    });
    model = null;
    parts = [];
    selected = hovered = null;
    renderer.shadowMap.needsUpdate = true;
    invalidate(true);
  }

  /**
   * @param {THREE.Object3D} group
   * @param {{ keepView?: boolean, fit?: number, xray?: boolean }} [opts] keepView: same model repainted, leave the camera alone.
   *   fit: camera distance as a share of the whole-model fit (default 0.78, a little tight for a closer look).
   *   xray: false when the caller never turns x-ray on, so its geometry is not built.
   */
  function setModel(group, opts = {}) {
    clearModel();
    model = group;
    fit = opts.fit ?? 0.78;
    parts = [];
    model.traverse(o => { if (o.userData?.part) parts.push(o); });
    scene.add(model);
    selected = hovered = null;
    if (xray) applyXray();
    computeExplode();
    applyExplode();
    if (opts.keepView) { renderer.shadowMap.needsUpdate = true; invalidate(true); }
    else frame();
    // Build the x-ray geometry once the first frames are out, unless the caller never uses x-ray (Compare).
    if (opts.xray !== false) { const m = model; setTimeout(() => { if (model === m) prepareXray(); }, 1500); }
  }

  function loop() {
    controls.update();
    const now = performance.now();
    if (anims.size) {
      for (const f of anims) if (!f(now)) anims.delete(f);
      dirty = true;
      fullPending = true;
    }
    const moving = dragging || now - lastMove < 180;
    if (dirty && !moving) {
      // Camera at rest (hover, selection, explode): go straight to full quality,
      // so the image never alternates between the two looks.
      composer.render();
      dirty = false;
      fullPending = false;
    } else if (dirty) {
      gtao.enabled = false; // camera moving: same pipeline, just without ambient occlusion
      composer.render();
      gtao.enabled = !xray && ao && !outdoor;
      dirty = false;
    } else if (fullPending && !moving) {
      composer.render(); // full quality with ambient occlusion
      fullPending = false;
    }
    requestAnimationFrame(loop);
  }
  loop();

  return {
    setModel,
    clear: clearModel,
    select: id => select(parts.find(p => p.userData.id === id) ?? null),
    setExplode(v) {
      explodeAmount = v;
      if (model) applyExplode();
      renderer.shadowMap.needsUpdate = true;
      lastMove = performance.now();
      invalidate();
    },
    setPerson(v) { person.visible = v; renderer.shadowMap.needsUpdate = true; invalidate(true); },
    setTheme(name) {
      themeName = name;
      if (outdoor) return;
      scene.background = backdrop(name);
      ground.material.opacity = stageFor(name).shadow;
      for (const mat of [XRAY_EDGE, XRAY_FILL, XRAY_EDGE_INSIDE, XRAY_FILL_INSIDE]) mat.color.set(stageFor(name).xray);
      if (model) frame();
    },
    setPicking(on) {
      picking = on;
      if (!on) {
        hovered = null;
        renderer.domElement.style.cursor = 'grab';
        refreshPaint();
        listeners.hover.forEach(f => f(null));
      }
    },
    setHover(id) {
      hovered = parts.find(p => p.userData.id === id) ?? null;
      refreshPaint();
    },
    selectedId: () => selected?.userData.id ?? null,
    setXray(on) {
      xray = on;
      gtao.enabled = !on && ao && !outdoor; // see-through fills still write depth, so occlusion would darken the ground under them
      if (model) applyXray();
      invalidate(true);
    },
    /** Run fn(now) every frame until it returns false. Returns a function that stops it. */
    animate(fn) { anims.add(fn); invalidate(true); return () => anims.delete(fn); },
    /**
     * Outdoor scenes (the takeoff): the studio floor, grid and person go, ambient occlusion is off so
     * every frame stays cheap, shadows follow the moving model, and the backdrop becomes a day sky with
     * haze. Turning it off restores the studio and frames the model again.
     */
    setOutdoor(on) {
      outdoor = on;
      ground.visible = !on;
      if (grid) grid.visible = !on;
      if (on) person.visible = false;
      sun.shadow.autoUpdate = on;
      gtao.enabled = !on && !xray && ao;
      scene.background = on ? daySky() : backdrop(themeName);
      scene.fog = on ? new THREE.Fog('#c9d6e2', 1500, 9000) : null;
      // Depth precision: a near plane a meter out and a far plane just past the haze, so the runway
      // markings never fight the asphalt for depth.
      if (on) { camera.near = 1; camera.far = 10000; }
      sun.shadow.normalBias = on ? 0.04 : 0;
      controls.maxDistance = on ? 3000 : controls.maxDistance;
      camera.updateProjectionMatrix();
      if (!on && model) frame();
      invalidate(true);
    },
    /** Keep the sun's shadow box around a point (a moving model), radius in meters. */
    sunAround(center, radius) {
      // Snap the box to whole shadow-map texels in the light's own frame: a box that slides with the
      // model every frame makes its shadow edges and the ground under it shimmer.
      const off = _sunOff.set(-1.2, 3, 1.6).multiplyScalar(radius);
      _sunRot.lookAt(off, _zero, THREE.Object3D.DEFAULT_UP);
      const texel = (radius * 3.2) / sun.shadow.mapSize.x;
      const c = _sunC.copy(center).applyMatrix4(_sunInv.copy(_sunRot).transpose());
      c.x = Math.round(c.x / texel) * texel;
      c.y = Math.round(c.y / texel) * texel;
      c.applyMatrix4(_sunRot);
      sun.position.copy(c).add(off);
      sun.target.position.copy(c);
      const sc = sun.shadow.camera;
      sc.left = sc.bottom = -radius * 1.6;
      sc.right = sc.top = radius * 1.6;
      sc.far = radius * 8 + center.y * 2;
      sc.updateProjectionMatrix();
    },
    scene,
    controls,
    getModel: () => model,
    /** Ambient occlusion on or off. Compare turns it off for its stacked overlay. */
    setAmbientOcclusion(on) {
      ao = on;
      gtao.enabled = !xray && ao && !outdoor;
      invalidate(true);
    },
    resetView() { view = null; if (model) frame(); },
    /** Look straight from the front, left side, right side, top or rear. */
    setView(name) { view = VIEWS[name] ? name : null; if (model) frame(); },
    partSize(id) {
      const p = parts.find(q => q.userData.id === id);
      return p ? new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3()) : null;
    },
    listParts: () => parts.map(p => p.userData),
    /** The WebGL renderer, so off-screen drawing (Compare's silhouettes) can reuse its uploaded geometry. */
    renderer,
    /** The camera, for pages that pick in the view themselves (Compare picks whole models). */
    camera,
    /** Draw again after a change the viewer does not know about (a material tint). */
    redraw: () => invalidate(true),
    modelSize: () => (model ? new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()) : null),
    on(event, fn) { listeners[event].push(fn); },
  };
}
