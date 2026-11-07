// Parses AC3D files off the main thread.
import { parseACData, transferables } from './ac3d-parse.js';

self.onmessage = async e => {
  const { id, url, hide } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const data = parseACData(await res.text(), { hide });
    self.postMessage({ id, data }, transferables(data));
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
