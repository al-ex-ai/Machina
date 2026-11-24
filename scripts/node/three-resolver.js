const THREE_URL = new URL('../../vendor/three/three.module.js', import.meta.url).href;
const ADDONS_URL = new URL('../../vendor/three/addons/', import.meta.url).href;

// The browser's import map, for Node: "three" and "three/addons/..." from vendor/three.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: ADDONS_URL + specifier.slice('three/addons/'.length), shortCircuit: true };
  return next(specifier, context);
}
