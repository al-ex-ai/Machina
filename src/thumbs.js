// Renders small images of models for the gallery with one shared offscreen renderer.
import * as THREE from 'three';
import { buildModel } from './registry.js';
import { studioEnvironment } from './scene.js';

const W = 640;
const H = 400;
const cache = new Map();
let ctx = null;
let queue = Promise.resolve();

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c2cc', 0.35));
  const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);
  return { renderer, scene, sun, ground, camera };
}

function render(model) {
  ctx ??= setup();
  const { renderer, scene, sun, ground, camera } = ctx;
  const obj = buildModel(model);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = size.length() / 2;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = (r / Math.sin(Math.min(vFov, hFov) / 2)) * 0.82;
  camera.position.set(center.x - dist * 0.6, center.y + dist * 0.38, center.z + dist * 0.7);
  camera.near = r / 100;
  camera.far = dist * 10;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  ground.scale.set(r * 6, r * 6, 1);
  sun.position.set(center.x - r, r * 3, center.z + r * 1.5);
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -r * 1.6, right: r * 1.6, top: r * 1.6, bottom: -r * 1.6, near: 0.1, far: r * 8 });
  sun.shadow.camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  obj.traverse(o => {
    if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); }
  });
  return url;
}

/** Thumbnail data URL for a model, rendered once and cached. Renders run one at a time. */
export function thumbnail(model) {
  if (cache.has(model.id)) return cache.get(model.id);
  const p = (queue = queue.then(() => new Promise(resolve => {
    const run = () => resolve(render(model));
    (window.requestIdleCallback ?? setTimeout)(run);
  })));
  cache.set(model.id, p);
  return p;
}
