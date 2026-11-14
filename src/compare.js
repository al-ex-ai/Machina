// Compare: two to four models at true scale, lined up on one apron or overlaid on one spot,
// their silhouettes from the side, top and front, and a spec table that shows how they differ.
// "Line up all" puts every listed model on the apron, sorted by any spec.
import * as THREE from 'three';
import { silhouettes } from './silhouette.js';

export const SLOT_COLORS = ['#ff8a3d', '#3fa7d6', '#5fc46a', '#b48cf2'];
const MAX = 4;

const widthOf = m => m.specs.wingspan_m ?? m.specs.rotor_diameter_m ?? m.specs.width_m;

const SORTS = {
  length: { label: 'Length', get: m => m.specs.length_m, unit: 'm' },
  span: { label: 'Span or rotor', get: widthOf, unit: 'm' },
  height: { label: 'Height', get: m => m.specs.height_m, unit: 'm' },
  mtow: { label: 'Max takeoff weight', get: m => m.specs.mtow_kg ?? m.specs.weight_kg, unit: 'kg' },
  speed: { label: 'Max speed', get: m => m.specs.max_speed_kmh, unit: 'km/h' },
  first_flight: { label: 'First flight', get: m => m.specs.first_flight, unit: '' },
};

// Suggested sets, kept only when at least two of their models are listed.
const PRESETS = [
  { label: 'Airliners', ids: ['b747-400-parametric', 'b787-8-parametric', 'b707-parametric', 'a320neo-parametric'] },
  { label: 'Light aircraft', ids: ['cessna-172s', 'dr400', 'j3-cub', 'ercoupe'] },
  { label: 'Soviet and supersonic', ids: ['concorde', 'tu-154m', 'il76', 'tu134'] },
  { label: 'First and biggest', ids: ['wright-flyer', 'b747-400-parametric'] },
];

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const YEARS = new Set(['first_flight', 'in_service']);
const fmt = (v, key) => (typeof v === 'number' && !YEARS.has(key) ? v.toLocaleString('en-US') : v);

/** Ground marking in front of a nose: the model's name and the value it is sorted by. */
// Every label in a line-up has the same size and the same name font, set by the longest name,
// so a small aircraft's label reads as large as a big one's.
const LABEL_ASPECT = 0.4; // label depth over width
const nameFont = size => `700 ${size}px "Segoe UI", system-ui, sans-serif`;
function labelFontSize(names) {
  const g = document.createElement('canvas').getContext('2d');
  let size = 150;
  const widest = () => { g.font = nameFont(size); return Math.max(...names.map(n => g.measureText(n).width)); };
  while (size > 56 && widest() > 1000) size -= 4;
  return size;
}
function apronLabel(name, detail, color, width, size) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024 * LABEL_ASPECT;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = nameFont(size);
  g.fillText(name, 512, c.height * 0.36);
  g.font = `600 ${Math.round(Math.min(96, size * 0.82))}px ui-monospace, Consolas, monospace`;
  g.globalAlpha = 0.85;
  g.fillText(detail, 512, c.height * 0.8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * LABEL_ASPECT),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  // Flat on the ground, reading from the default camera (which looks along +x from the -x side).
  plate.rotation.set(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ');
  plate.renderOrder = 2;
  plate.raycast = () => {};
  plate.userData.cmpLabel = true;
  return plate;
}

function tintFor(color) {
  return new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
}

/** Swap a model's materials for one see-through color, or put its own back. */
function tint(obj, material) {
  obj.traverse(o => {
    if (!o.isMesh || o.userData.cmpLabel) return;
    o.userData.cmpSolid ??= o.material;
    o.material = material ? (Array.isArray(o.userData.cmpSolid) ? o.userData.cmpSolid.map(() => material) : material) : o.userData.cmpSolid;
    o.castShadow = !material;
  });
}

function disposeDeep(obj) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    for (const m of [o.userData.cmpSolid ?? o.material].flat()) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) m?.[k]?.dispose();
      m?.dispose();
    }
  });
}

/**
 * @param {object} ctx what the app shares with this page
 * @param {(sel: string) => Element} ctx.$
 * @param {(s: string) => string} ctx.esc
 * @param {() => object[]} ctx.models listed models
 * @param {object} ctx.specLabels the model page's spec labels, in display order
 * @param {string[]} ctx.groupOrder
 * @param {() => object} ctx.ensureViewer
 * @param {(m: object) => Promise<THREE.Object3D>} ctx.modelObject build or load one model
 */
export function createCompare(ctx) {
  const { $, esc } = ctx;
  const cache = new Map(); // id -> Promise<Object3D>, only for the current selection
  let token = 0;
  let current = { key: '', sel: [], all: false, mode: 'lineup', sort: 'length', objs: null };

  const byId = id => ctx.models().find(m => m.id === id);
  const load = m => {
    if (!cache.has(m.id)) {
      cache.set(m.id, ctx.modelObject(m).then(obj => {
        obj.updateMatrixWorld(true);
        obj.userData.cmpBox = new THREE.Box3().setFromObject(obj);
        return obj;
      }));
    }
    return cache.get(m.id);
  };

  function hrefFor(ids, { all = false, mode = current.mode, sort = current.sort } = {}) {
    const q = new URLSearchParams();
    if (mode !== 'lineup') q.set('mode', mode);
    if (sort !== 'length') q.set('sort', sort);
    const path = all ? 'all' : ids.join(',');
    return `#/compare${path ? `/${path}` : ''}${q.size ? `?${q}` : ''}`;
  }

  function sortedSel() {
    const s = SORTS[current.sort] ?? SORTS.length;
    // Ascending, models without the value at the end. Ties keep the chosen order.
    return [...current.sel].sort((a, b) => (s.get(a) ?? Infinity) - (s.get(b) ?? Infinity));
  }

  function colorOf(m) {
    if (current.all) return css('--ink') || '#e7ecf2';
    return SLOT_COLORS[current.sel.indexOf(m) % SLOT_COLORS.length];
  }

  // ── 3D arrangement ────────────────────────────────────
  function arrange() {
    const viewer = ctx.ensureViewer();
    const group = new THREE.Group();
    group.name = 'compare';
    const objs = current.objs;
    if (current.mode === 'overlay') {
      for (const m of current.sel) {
        const obj = objs.get(m.id);
        obj.position.set(-obj.userData.cmpBox.min.x, 0, 0);
        tint(obj, tintFor(colorOf(m)));
        group.add(obj);
      }
      viewer.setAmbientOcclusion(false);
    } else {
      const list = sortedSel();
      const s = SORTS[current.sort] ?? SORTS.length;
      const spans = list.map(m => { const b = objs.get(m.id).userData.cmpBox; return b.max.z - b.min.z; });
      const maxSpan = Math.max(...spans);
      const gap = maxSpan * 0.12;
      // One label size for the whole line-up; every slot is at least that wide, so labels never overlap.
      const labelW = maxSpan * (list.length > MAX ? 0.5 : 0.85);
      const minSlot = labelW / 0.95;
      const fontSize = labelFontSize(list.map(m => m.name));
      // Wingtip to wingtip along +z, which is left to right from the apron camera, noses on one line.
      let z = 0;
      list.forEach((m, i) => {
        const obj = objs.get(m.id);
        const box = obj.userData.cmpBox;
        const slot = Math.max(spans[i], minSlot);
        const cz = z + slot / 2;
        obj.position.set(-box.min.x, 0, cz - (box.min.z + box.max.z) / 2);
        tint(obj, null);
        group.add(obj);
        const v = s.get(m);
        const detail = v == null ? 'no data' : `${s.label} ${fmt(v, current.sort)}${s.unit ? ` ${s.unit}` : ''}`;
        const plate = apronLabel(m.name, detail, colorOf(m), labelW, fontSize);
        plate.position.set(-labelW * LABEL_ASPECT / 2 - maxSpan * 0.03, 0.02, cz);
        group.add(plate);
        z += slot + gap;
      });
      viewer.setAmbientOcclusion(true);
    }
    viewer.setView(current.mode === 'lineup' ? 'apron' : null);
    viewer.setExplode(0);
    viewer.setXray(false);
    viewer.setPicking(false);
    // An overlay fits whole; a line-up fits its width to the stage, which brings a long row much closer.
    viewer.setModel(group, { fit: current.mode === 'lineup' ? lineupFit(group) : (innerWidth < 760 ? 1 : 0.9) });
  }

  /**
   * The viewer frames a model by its bounding sphere, which leaves a long, flat row tiny.
   * Work out the camera distance that fits the row's width (and its depth) instead, as a share
   * of that sphere distance. Uses the viewer's 40 degree field of view and the apron camera.
   */
  function lineupFit(group) {
    const stage = $('#stage');
    const aspect = (stage?.clientWidth || 1200) / Math.max(1, stage?.clientHeight || 600);
    group.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    const vFov = (40 * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const sphere = size.length() / 2 / Math.sin(Math.min(vFov, hFov) / 2);
    const el = Math.asin(0.78 / Math.hypot(0.62, 0.78, 0.1)); // apron camera elevation
    const needW = size.z / 2 / Math.tan(hFov / 2) + size.x / 2; // the near edge of the row is closer
    const needD = (size.x * Math.sin(el) + size.y * Math.cos(el)) / 2 / Math.tan(vFov / 2);
    return Math.min(1, Math.max(0.2, (Math.max(needW, needD) * 1.12) / sphere));
  }

  // ── Silhouettes and specs ─────────────────────────────
  function drawSilhouettes() {
    const host = $('#cmp-sil');
    if (!host || current.all || !current.objs) return;
    // Silhouettes borrow the objects for a moment: draw them at their own origin, untinted.
    const items = current.sel.map(m => ({ obj: current.objs.get(m.id), color: colorOf(m) }));
    const saved = items.map(it => it.obj.position.clone());
    items.forEach(it => it.obj.position.set(0, 0, 0));
    // A three-view sheet at one scale: side and front share the ground line, the top view sits
    // under the side view so noses and tails line up, and the key fills the last corner.
    const gap = 20;
    const width = Math.min((host.clientWidth || 900) - 34, 1240);
    const sil = silhouettes(items, { width, gap, ink: css('--ink'), faint: css('--faint') });
    items.forEach((it, i) => it.obj.position.copy(saved[i]));
    const cssW = c => parseFloat(c.style.width);
    host.innerHTML = `<div class="sil-sheet" style="grid-template-columns:${cssW(sil.side)}px ${cssW(sil.front)}px;gap:${gap}px">
        <figure class="sil" data-v="side"><figcaption class="label">Side</figcaption></figure>
        <figure class="sil" data-v="front"><figcaption class="label">Front</figcaption></figure>
        <figure class="sil" data-v="top"><figcaption class="label">Top</figcaption></figure>
        <ul class="sil-key">${current.sel.map(m => `<li><span class="dot" style="background:${colorOf(m)}"></span>${esc(m.name)}</li>`).join('')}</ul>
      </div>`;
    for (const v of ['side', 'front', 'top']) host.querySelector(`[data-v="${v}"]`).append(sil[v]);
  }

  function specTable() {
    const sel = current.sel;
    const rows = [];
    for (const [key, def] of Object.entries(ctx.specLabels)) {
      const vals = sel.map(m => m.specs[key]);
      if (vals.every(v => v == null)) continue;
      const [label, unit] = Array.isArray(def) ? def : [def, ''];
      const numeric = vals.every(v => v == null || typeof v === 'number');
      const shown = vals.filter(v => v != null);
      const same = shown.length === vals.length && new Set(shown.map(String)).size === 1;
      const nums = numeric ? shown : [];
      const max = nums.length > 1 && !same ? Math.max(...nums) : null;
      const ref = vals[0];
      const cells = vals.map((v, i) => {
        if (v == null) return '<td class="none">–</td>';
        let delta = '';
        if (i > 0 && numeric && typeof ref === 'number' && v !== ref) {
          if (key === 'first_flight') delta = `${v > ref ? '+' : '−'}${Math.abs(v - ref)} yr`;
          else if (ref) {
            const pct = ((v - ref) / ref) * 100;
            delta = `${pct > 0 ? '+' : '−'}${Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`;
          }
        }
        return `<td class="${v === max ? 'max' : ''}"><span class="v">${esc(fmt(v, key))}${unit && numeric ? ` <small>${esc(unit)}</small>` : ''}</span>${delta ? `<span class="d">${delta}</span>` : ''}</td>`;
      });
      rows.push(`<tr class="${same ? 'same' : ''}"><th scope="row">${esc(label)}${unit && !numeric ? ` <small>${esc(unit)}</small>` : ''}</th>${cells.join('')}</tr>`);
    }
    return `<div class="cmp-table-wrap"><table class="cmp-table">
      <thead><tr><th></th>${sel.map(m => `<th scope="col"><span class="dot" style="background:${colorOf(m)}"></span><a href="#/m/${esc(m.id)}">${esc(m.name)}</a></th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
      <p class="note">Differences are against ${esc(sel[0].name)}, the first model picked. The largest value in each row is marked; rows where every model agrees are dimmed.</p>`;
  }

  // ── Page ──────────────────────────────────────────────
  function pickerHTML() {
    const listed = ctx.models();
    const chosen = new Set(current.sel.map(m => m.id));
    const groups = [...new Set(listed.map(m => m.group))].sort((a, b) => (ctx.groupOrder.indexOf(a) + 1 || 99) - (ctx.groupOrder.indexOf(b) + 1 || 99));
    const presets = PRESETS.map(p => ({ ...p, ids: p.ids.filter(id => byId(id)) })).filter(p => p.ids.length > 1);
    const chips = current.all ? `<span class="cmp-chip"><span class="dot" style="background:var(--ink)"></span>All ${listed.length} models<a class="x" href="${hrefFor([])}" aria-label="Clear the line-up">×</a></span>`
      : current.sel.map(m => `<span class="cmp-chip"><span class="dot" style="background:${colorOf(m)}"></span>${esc(m.name)}<a class="x" href="${hrefFor(current.sel.filter(x => x !== m).map(x => x.id))}" aria-label="Remove ${esc(m.name)}">×</a></span>`).join('');
    const add = !current.all && current.sel.length < MAX ? `<label class="sort cmp-add"><select id="cmp-add" aria-label="Add a model to compare">
        <option value="">${current.sel.length ? 'Add a model' : 'Pick a model'}</option>
        ${groups.map(g => `<optgroup label="${esc(g)}">${listed.filter(m => m.group === g && !chosen.has(m.id)).map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>` : '';
    return `<div class="cmp-picks">${chips}${add}</div>
      <div class="cmp-presets"><span class="label">Try</span>${presets.map(p => `<a class="cmp-preset" href="${hrefFor(p.ids)}">${esc(p.label)}</a>`).join('')}<a class="cmp-preset" href="${hrefFor([], { all: true })}">Line up all ${listed.length}</a></div>`;
  }

  function controlsHTML() {
    return `<div class="seg" role="radiogroup" aria-label="Arrangement">
        <button type="button" role="radio" data-mode="lineup" aria-checked="${current.mode === 'lineup'}">Line-up</button>
        <button type="button" role="radio" data-mode="overlay" aria-checked="${current.mode === 'overlay'}" ${current.all ? 'disabled title="Overlay works with two to four models"' : ''}>Overlay</button>
      </div>
      <label class="sort">Sort <select id="cmp-sort" aria-label="Sort the line-up" ${current.mode === 'overlay' ? 'disabled' : ''}>${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === current.sort ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>`;
  }

  function wire() {
    $('#cmp-add')?.addEventListener('change', e => {
      if (e.target.value) location.hash = hrefFor([...current.sel.map(m => m.id), e.target.value]);
    });
    for (const b of document.querySelectorAll('[data-mode]')) {
      b.addEventListener('click', () => { if (b.dataset.mode !== current.mode) update({ mode: b.dataset.mode }); });
    }
    $('#cmp-sort')?.addEventListener('change', e => update({ sort: e.target.value }));
  }

  /** Mode or sort changed: re-arrange in place, no reload. */
  function update(patch) {
    Object.assign(current, patch);
    history.replaceState(null, '', hrefFor(current.sel.map(m => m.id), { all: current.all }));
    $('#cmp-controls').innerHTML = controlsHTML();
    wire();
    if (current.objs) arrange();
  }

  function render(route) {
    const listed = ctx.models();
    const all = route.all;
    const ids = all ? listed.map(m => m.id) : [...new Set(route.ids)].filter(byId).slice(0, MAX);
    const sel = ids.map(byId);
    const key = (all ? 'all' : ids.join(','));
    current = { ...current, sel, all, mode: all ? 'lineup' : (route.mode === 'overlay' ? 'overlay' : 'lineup'), sort: SORTS[route.sort] ? route.sort : 'length' };
    document.title = 'Compare · Machina';

    $('#page').innerHTML = `
      <div class="compare-page">
        <div class="page cmp-head">
          <div class="crumbs"><a href="#/">Catalog</a><span class="sep">/</span><span>Compare</span></div>
          <h1>Compare at true scale</h1>
          <p class="lede">Pick two to four models to line them up on one apron or lay them over each other, see their outlines from three sides, and read their specs side by side.</p>
          ${pickerHTML()}
        </div>
        <section class="stage cmp-stage" id="stage" aria-label="3D comparison">
          <div class="hud-top"><div class="cmp-controls" id="cmp-controls">${controlsHTML()}</div></div>
          <div class="loading" id="loading" role="status" aria-live="polite" hidden><span class="spinner"></span><span class="label" id="cmp-progress">Loading</span></div>
          ${sel.length ? '' : '<div class="cmp-empty"><p>Pick a model above, or try one of the suggested sets.</p></div>'}
        </section>
        <div class="page cmp-body">
          ${sel.length && !all ? `<div class="section-head"><h2>Silhouettes</h2><span class="label">one scale, noses aligned</span></div><div class="cmp-sil" id="cmp-sil"></div>
          <div class="section-head"><h2>Specifications</h2><span class="label">${sel.length} model${sel.length > 1 ? 's' : ''}</span></div>${specTable()}` : ''}
          ${all ? `<p class="note">Every listed model on one apron, sorted by ${esc((SORTS[current.sort] ?? SORTS.length).label.toLowerCase())}. Detailed models download one by one, so the full line-up takes a while on the first visit.</p>` : ''}
        </div>
      </div>`;
    $('#stage').prepend($('#stage-host'));
    wire();
    const viewer = ctx.ensureViewer();

    if (!sel.length) { viewer.clear(); current.objs = null; current.key = key; return; }

    // Drop models that left the selection; dispose them once they are off the stage.
    const leaving = [...cache.keys()].filter(id => !ids.includes(id));
    const myToken = ++token;
    const loadingEl = $('#loading');
    loadingEl.hidden = false;
    let done = 0;
    const progress = () => { const p = $('#cmp-progress'); if (p) p.textContent = sel.length > 1 ? `Loading ${done} of ${sel.length}` : 'Loading'; };
    progress();
    Promise.all(sel.map(m => load(m).then(o => { done++; if (myToken === token) progress(); return o; })))
      .then(objs => {
        if (myToken !== token) return;
        current.objs = new Map(sel.map((m, i) => [m.id, objs[i]]));
        current.key = key;
        arrange();
        loadingEl.hidden = true;
        drawSilhouettes();
        for (const id of leaving) {
          const p = cache.get(id);
          cache.delete(id);
          p?.then(disposeDeep).catch(() => {});
        }
      })
      .catch(err => {
        console.error(err);
        if (myToken === token) $('#cmp-progress').textContent = 'Could not load one of the models';
      });
  }

  // Theme switches recolor the labels and silhouette ink.
  new MutationObserver(() => {
    if (!$('.compare-page') || !current.objs) return;
    if (current.all) arrange();
    else { if (current.mode === 'lineup') arrange(); drawSilhouettes(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return { render };
}
