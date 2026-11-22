// Builds x-ray geometry off the main thread, so turning x-ray on never freezes the page.
import { buildXray } from './xray-build.js';

self.onmessage = e => {
  const { id, meshes, threshold } = e.data;
  try {
    const r = buildXray(meshes, threshold);
    self.postMessage({ id, data: r }, [r.pos.buffer, r.index.buffer, r.edges.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
