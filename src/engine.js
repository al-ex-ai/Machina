// Everything the 3D pages need, Three.js included. The app imports this on demand, so the
// catalog opens with plain HTML and prerendered thumbnails before any of it downloads.
import './builders/index.js';
export { buildModel, finalize, partCount } from './registry.js';
export { loadAssetModel } from './assets.js';
export { createViewer } from './scene.js';
export { SYSTEMS } from './parts/common.js';
export { thumbnail } from './thumbs.js';
