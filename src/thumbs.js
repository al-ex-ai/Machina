// Renders small images of models for the gallery with one shared offscreen renderer.
import * as THREE from 'three';
import { buildModel, finalize } from './registry.js';
import { loadAssetModel } from './assets.js';
import { studioEnvironment, disposeObject } from './scene.js';

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

function render(model, obj) {
  ctx ??= setup();
  const { renderer, scene, sun, ground, camera } = ctx;
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
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of [o.material].flat()) { m.map?.dispose(); m.normalMap?.dispose(); m.dispose(); }
  });
  return url;
}

/** Pixels per meter of every profile image, so profiles placed side by side are to scale. */
export const PROFILE_PX_PER_M = 12;

/**
 * Side profile for the true-scale line-up: orthographic, nose to the left, transparent, at
 * PROFILE_PX_PER_M. The image size follows the machine, so its width is its length to scale.
 */
function renderProfile(obj) {
  ctx ??= setup();
  const { renderer, scene, sun, ground } = ctx;
  ground.visible = false;
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const k = PROFILE_PX_PER_M, w = Math.max(8, Math.ceil(size.x * k)), h = Math.max(8, Math.ceil(size.y * k));
  const cam = new THREE.OrthographicCamera(-w / k / 2, w / k / 2, h / k / 2, -h / k / 2, 0.1, size.z * 4 + 10);
  cam.position.set(center.x, center.y, box.max.z + size.z + 5);
  cam.lookAt(center);
  sun.position.set(center.x - size.x, center.y + size.x, box.max.z + size.x);
  sun.target.position.copy(center);
  sun.castShadow = false;
  renderer.setSize(w, h, false);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setSize(W, H, false);
  sun.castShadow = true;
  ground.visible = true;
  scene.remove(obj);
  return url;
}

/** Profile data URL for a model (not cached: used once per model by the thumbnail script). */
export async function profile(model) {
  let obj = null;
  if (model.asset) obj = await loadAssetModel(model).then(o => finalize(o, model)).catch(() => null);
  obj ??= buildModel(model);
  const url = renderProfile(obj);
  disposeObject(obj);
  return url;
}

/** Thumbnail data URL for a model, rendered once and cached. Renders run one at a time. */
export function thumbnail(model) {
  if (cache.has(model.id)) return cache.get(model.id);
  const p = (queue = queue.then(async () => {
    let obj = null;
    if (model.asset) obj = await loadAssetModel(model).then(o => finalize(o, model)).catch(() => null);
    if (!obj && model.builder === 'asset') throw new Error(`no thumbnail for ${model.id}`);
    obj ??= buildModel(model);
    return new Promise(resolve => (window.requestIdleCallback ?? setTimeout)(() => { const url = render(model, obj); disposeObject(obj); resolve(url); }));
  }));
  cache.set(model.id, p);
  return p;
}
