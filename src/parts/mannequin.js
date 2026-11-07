// A smooth 1.80 m scale figure, like the ones in architectural renders.
// Bodies of revolution give a sculpted silhouette; no visible joints.
import * as THREE from 'three';

const lathe = (profile, segments = 28) =>
  new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(Math.max(r, 0.0005), y)), segments);

// Tapered limb between two heights, slightly rounded at both ends.
function limb(y0, y1, r0, r1) {
  const h = y1 - y0;
  return lathe([
    [y0 - r0 * 0.6, 0], [y0 - r0 * 0.35, r0 * 0.75], [y0, r0], [y0 + h * 0.3, r0 * 0.98 + r1 * 0.02],
    [y0 + h * 0.7, (r0 + r1) / 2], [y1, r1], [y1 + r1 * 0.35, r1 * 0.75], [y1 + r1 * 0.6, 0],
  ]);
}

export function makeMannequin() {
  const mat = new THREE.MeshStandardMaterial({ color: '#d7dce2', roughness: 0.62, metalness: 0 });
  const g = new THREE.Group();
  const add = (geo, x = 0, z = 0, sx = 1, sz = 1, tiltX = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 0, z);
    m.scale.set(sx, 1, sz);
    m.rotation.x = tiltX;
    m.castShadow = true;
    g.add(m);
  };

  // Torso from hips to neck base: hips, waist, chest, shoulders. Flattened front to back.
  add(lathe([
    [0.86, 0], [0.88, 0.13], [0.95, 0.165], [1.02, 0.15], [1.1, 0.135], [1.2, 0.15],
    [1.3, 0.17], [1.38, 0.18], [1.44, 0.17], [1.48, 0.12], [1.5, 0.06], [1.5, 0],
  ], 36), 0, 0, 0.62, 1.15);
  // Neck and head
  add(limb(1.5, 1.58, 0.05, 0.048));
  add(new THREE.SphereGeometry(0.1, 32, 24).scale(1.02, 1.2, 0.9).translate(0.008, 1.68, 0));

  for (const s of [1, -1]) {
    // Legs: thigh to knee, calf to ankle, then a rounded foot
    add(limb(0.5, 0.88, 0.055, 0.082), 0, s * 0.092);
    add(limb(0.08, 0.5, 0.04, 0.056), 0, s * 0.09);
    const foot = new THREE.CapsuleGeometry(0.042, 0.16, 6, 14).rotateZ(Math.PI / 2).scale(1, 0.75, 1.05).translate(0.045, 0.035, 0);
    add(foot, 0, s * 0.09);
    // Rounded shoulder cap joins the arm to the torso
    add(new THREE.SphereGeometry(0.062, 20, 14).scale(1, 0.9, 1).translate(0, 1.425, 0), 0, s * 0.178);
    // Arms hang close to the body with a slight outward angle
    add(limb(1.12, 1.42, 0.04, 0.05), 0, s * 0.205, 1, 1, s * 0.05);
    add(limb(0.86, 1.12, 0.032, 0.04), 0.01, s * 0.218, 1, 1, s * 0.04);
    add(new THREE.SphereGeometry(0.045, 16, 12).scale(0.55, 1.5, 0.95).translate(0.012, 0.79, 0), 0, s * 0.225);
  }
  g.name = 'person';
  return g;
}
