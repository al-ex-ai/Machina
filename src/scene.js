// Renderer, camera, lighting, selection and exploded view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';

const HIGHLIGHT = new THREE.Color('#ff8a3d');
const HOVER = new THREE.Color('#ffb27a');

/**
 * A soft studio environment for reflections: a sky-to-floor gradient dome with a
 * few bright softbox panels, prefiltered once with PMREM.
 */
function studioEnvironment(renderer) {
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c2cc', 0.35));
  const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let grid = null;

  // Person for scale: 1.8 m tall
  const person = new THREE.Group();
  {
    const mat = new THREE.MeshStandardMaterial({ color: '#2f6fb0', roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.05, 4, 12), mat);
    body.position.y = 0.2 + 0.525;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
    head.position.y = 1.67;
    body.castShadow = head.castShadow = true;
    person.add(body, head);
    person.visible = false;
    scene.add(person);
  }

  let model = null;
  let parts = [];
  let selected = null;
  let hovered = null;
  let explodeAmount = 0;
  const listeners = { select: [], hover: [] };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function partFrom(obj) {
    for (let o = obj; o; o = o.parent) if (o.userData?.part) return o;
    return null;
  }

  function paint(part, color, intensity) {
    part?.traverse(o => {
      if (o.isMesh) { o.material.emissive.copy(color ?? new THREE.Color(0)); o.material.emissiveIntensity = intensity; }
    });
  }

  function refreshPaint() {
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

  renderer.domElement.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY }; });
  renderer.domElement.addEventListener('pointerup', ev => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    select(pick(ev));
  });
  renderer.domElement.addEventListener('pointermove', ev => {
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

  function frame() {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    const center = box.getCenter(new THREE.Vector3());
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 0.78;
    camera.position.set(center.x - dist * 0.62, center.y + dist * 0.42, center.z + dist * 0.66);
    camera.near = radius / 100;
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = radius * 0.4;
    controls.maxDistance = dist * 4;
    controls.update();

    const span = Math.max(size.x, size.z) * 4;
    ground.scale.set(span, span, 1);
    if (grid) scene.remove(grid);
    const step = span > 300 ? 10 : span > 60 ? 5 : 1;
    grid = new THREE.GridHelper(span, Math.round(span / step), '#c3cbd4', '#dde3e9');
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
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

    person.position.set(box.min.x - 2.5, 0, box.max.z * 0.4);
  }

  function setModel(group) {
    if (model) {
      scene.remove(model);
      model.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    model = group;
    parts = [];
    model.traverse(o => { if (o.userData?.part) parts.push(o); });
    scene.add(model);
    selected = hovered = null;
    computeExplode();
    applyExplode();
    frame();
  }

  function loop() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  return {
    setModel,
    select: id => select(parts.find(p => p.userData.id === id) ?? null),
    setExplode(v) { explodeAmount = v; if (model) applyExplode(); },
    setPerson(v) { person.visible = v; },
    resetView() { if (model) frame(); },
    partSize(id) {
      const p = parts.find(q => q.userData.id === id);
      return p ? new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3()) : null;
    },
    listParts: () => parts.map(p => p.userData),
    on(event, fn) { listeners[event].push(fn); },
  };
}
