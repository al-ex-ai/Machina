// Livery presets for parametric models. A preset only swaps colors, finishes and text:
// every position (cheatline height, title spot, fin stripe edge) comes from the
// model's own livery block, which is measured, so any parametric aircraft can wear
// any preset. No airline liveries: Machina's own colors, neutral schemes and the
// manufacturer's name.

const maker = m => (m.specs?.manufacturer ?? '').split(/[\s(,]/)[0].toUpperCase();
/** "Boeing 737-300 (parametric)" -> "737-300", "Tupolev Tu-154M" -> "TU-154M" */
const designation = m => m.name.replace(/\(.*?\)/g, '').replace(new RegExp(`^${m.specs?.manufacturer?.split(/[\s(,]/)[0] ?? ''}\\s*`, 'i'), '').trim().toUpperCase();

const PRESETS = [
  { id: 'machina', label: 'Machina', swatch: ['#f5f6f8', '#18273a', '#ff8a3d'] },
  {
    id: 'demonstrator', label: 'Factory demonstrator', swatch: ['#ffffff', '#1f5fa8', '#3fb6c8'],
    livery: m => ({ base: '#ffffff', belly: '#e6eaef', stripe: '#1f5fa8', stripe2: '#3fb6c8', nacelle: '#ffffff', titles: { text: maker(m), mark: false, color: '#1f5fa8' } }),
    fin: m => ({ base: '#1f5fa8', stripe: '#3fb6c8', title: designation(m), titleColor: '#ffffff' }),
    materials: { tail: '#1f5fa8' },
  },
  {
    id: 'metal', label: 'Polished metal', swatch: ['#f2f3f5', '#b9c0c8', '#2d5d9f'],
    livery: m => ({ base: '#f2f3f5', belly: '#bcc3cb', stripe: '#2d5d9f', metalBelly: true, nacelle: '#c4cad1', titles: { text: maker(m), mark: false, color: '#2d5d9f' } }),
    fin: m => ({ base: '#f2f3f5', stripe: '#2d5d9f', title: designation(m), titleColor: '#2d5d9f' }),
    materials: { surfaces: { color: '#c3c9d0', metalness: 0.85, roughness: 0.3 }, controls: { color: '#b8bfc7', metalness: 0.8, roughness: 0.34 }, tail: '#f2f3f5' },
  },
  {
    id: 'primer', label: 'Factory primer', swatch: ['#a3b06a', '#8f9a9e', '#d9dde2'],
    livery: () => ({ base: '#a3b06a', belly: '#a3b06a', stripe: '#a3b06a', nacelle: '#c9ced4', pylon: '#a3b06a', titles: null }),
    fin: () => ({ base: '#a3b06a', stripe: null, title: null }),
    materials: { surfaces: '#a8b571', controls: '#8f9a9e', tail: '#a3b06a' },
  },
  {
    id: 'white', label: 'Plain white', swatch: ['#f6f7f8', '#d3d8de', '#9aa3ad'],
    livery: () => ({ base: '#f4f5f6', belly: '#f4f5f6', stripe: '#f4f5f6', nacelle: '#eceef1', titles: null }),
    fin: () => ({ base: '#f4f5f6', stripe: null, title: null }),
    materials: { surfaces: '#d3d8de', controls: '#c6ccd3', tail: '#f4f5f6' },
  },
];

/** Presets a model can wear, for the picker. */
const ACCENTS = [
  { id: 'original', label: 'Original colors', swatch: ['#f2f3f5', '#f2f3f5', '#2a4a7a'] },
  { id: '#ff8a3d', label: 'Machina orange', swatch: ['#f2f3f5', '#f2f3f5', '#ff8a3d'] },
  { id: '#c8202f', label: 'Red', swatch: ['#f2f3f5', '#f2f3f5', '#c8202f'] },
  { id: '#1f8a4c', label: 'Green', swatch: ['#f2f3f5', '#f2f3f5', '#1f8a4c'] },
  { id: '#6b3fa0', label: 'Purple', swatch: ['#f2f3f5', '#f2f3f5', '#6b3fa0'] },
];

/** True when a color is a custom accent ("#rrggbb"). */
export const isAccent = id => /^#[0-9a-f]{6}$/i.test(id ?? '');

export function liveriesFor(model) {
  if (model.builder === 'asset' && model.asset?.machina) return [
    { id: 'machina', label: 'Machina', swatch: ['#f5f6f8', '#18273a', '#ff8a3d'] },
    { id: 'original', label: 'Original paint', swatch: ['#f2f3f5', '#f2f3f5', '#c9ced6'] },
    ...ACCENTS.slice(2).map(a => ({ ...a, label: `Machina with ${a.label.toLowerCase()} stripe`, swatch: ['#f5f6f8', '#18273a', a.id] })),
  ];
  if (model.builder === 'asset' && model.asset?.recolor) return ACCENTS;
  return model.builder === 'parametric' && model.livery ? PRESETS.map(({ id, label, swatch }) => ({ id, label, swatch })) : [];
}

/**
 * The model wearing a preset: a copy with its livery, fin paint, materials and painted
 * pods recolored. Unknown ids and "machina" return the model unchanged.
 */
export function withLivery(model, id) {
  // A custom accent on the Machina scheme: stripe, tail stripe and mark take the color.
  if (isAccent(id) && model.builder === 'parametric') {
    const m = structuredClone(model);
    m.livery.stripe = id;
    if (m.livery.titles) m.livery.titles.markColor = id;
    for (const s of m.geometry.surfaces) if (s.paint?.stripe) s.paint.stripe.color = id;
    return m;
  }
  const p = PRESETS.find(q => q.id === id);
  if (!p?.livery || model.builder !== 'parametric') return model;
  const m = structuredClone(model);
  const old = model.livery;
  const lv = p.livery(model);
  m.livery = { ...old, ...lv, titles: lv.titles === null ? null : { ...old.titles, ...lv.titles } };
  const g = m.geometry;
  const finSpec = p.fin(model);
  let oldFin = null;
  for (const s of g.surfaces) {
    if (!s.paint) continue;
    oldFin = s.paint.base;
    s.paint = {
      base: finSpec.base,
      stripe: finSpec.stripe && s.paint.stripe ? { ...s.paint.stripe, color: finSpec.stripe } : null,
      title: finSpec.title && s.paint.title ? { ...s.paint.title, text: finSpec.title, color: finSpec.titleColor, height: Math.min(s.paint.title.height, s.paint.title.height * 7 / Math.max(finSpec.title.length, 1)) } : null,
    };
  }
  for (const [k, v] of Object.entries(p.materials ?? {})) g.materials[k] = { ...g.materials[k], ...(typeof v === 'string' ? { color: v } : v) };
  // Pods painted in the old belly or tail color follow the new scheme.
  for (const pd of g.pods ?? []) if (pd.color && (pd.color === old.belly || pd.color === oldFin)) pd.color = finSpec.base;
  return m;
}
