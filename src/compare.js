// Compare: two to four models at true scale, lined up on one apron or overlaid on one spot,
// their silhouettes from the side, top and front, and a spec table that shows how they differ.
// "Line up all" puts every listed model on the apron, sorted by any spec.
import * as THREE from 'three';
import { silhouettes } from './silhouette.js';
import { pickerHTML } from './picker.js';

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

// Suggested sets come from data/collections.json, kept only when at least two of their models are listed.

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
  plate.material.userData.ownsMap = true; // the viewer frees the texture with the material
  // Flat on the ground, reading from the default camera (which looks along +x from the -x side).
  plate.rotation.set(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ');
  plate.renderOrder = 2;
  plate.raycast = () => {};
  plate.userData.cmpLabel = true;
  return plate;
}

// Overlay style: a stack of the real aircraft. Each keeps its own paint with a light wash of its
// color, and they are drawn whole from the largest at the bottom to the smallest on top, so every
// model stays visible and the larger ones show where they reach past the smaller. Interiors,
// lights and antennas are left out.
const OVERLAY_HIDE = new Set(['interior', 'lights', 'avionics']);
const TINT = 0.4; // share of the slot color mixed into each material's own color

function systemOf(o) {
  for (let p = o; p; p = p.parent) if (p.userData?.part) return p.userData.system;
  return null;
}

/**
 * Put a model at a place in the stack (layer 0 is drawn first) with a wash of its color, or give
 * it its own look back (color null). The stack is drawn in the transparent pass, after the ground
 * and grid, with the depth buffer cleared before each layer, so each layer is drawn whole on top.
 * Materials keep opacity 1; marking them transparent only moves them into that pass.
 */
function stackPaint(obj, color, layer = 0) {
  const wash = color && new THREE.Color(color);
  const seen = new Set();
  obj.traverse(o => {
    if (!o.isMesh || o.userData.cmpLabel || o.userData.cmpClear) return;
    o.userData.cmpVisible ??= o.visible;
    o.visible = color && OVERLAY_HIDE.has(systemOf(o)) ? false : o.userData.cmpVisible;
    o.renderOrder = color ? 2 + layer * 2 : 0;
    for (const m of [o.material].flat()) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      m.userData.cmpOwn ??= { transparent: m.transparent, color: m.color?.clone() };
      const own = m.userData.cmpOwn;
      m.transparent = color ? true : own.transparent;
      if (m.color && own.color) {
        m.color.copy(own.color);
        if (wash) m.color.lerp(wash, TINT);
      }
    }
  });
}

const easeOut = t => 1 - (1 - t) ** 3;
const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Taxi the stack in: the largest model is parked, then each smaller one rolls in nose first from
 * behind and brakes onto the shared nose line, one after another.
 * @param {object} viewer
 * @param {THREE.Object3D[]} objs in stack order, largest first, already at their parked positions
 */
function taxiIn(viewer, objs) {
  if (objs.length < 2 || reducedMotion()) return;
  const parked = objs.map(o => o.position.x);
  const run = Math.max(...objs.map(o => o.userData.cmpBox.max.x - o.userData.cmpBox.min.x)) * 1.1;
  // The clock starts after two drawn frames: the first frame of a new scene compiles its shaders,
  // which can take longer than the whole taxi-in on a slow machine.
  let t0 = null;
  let frames = 0;
  const START = 350; // pause on the parked model first
  const STEP = 750; // between arrivals
  const DUR = 1500;
  objs.slice(1).forEach(o => { o.visible = false; });
  viewer.animate(now => {
    if (frames++ < 2) return true;
    t0 ??= now;
    let busy = false;
    objs.forEach((o, i) => {
      if (i === 0) return;
      const t = (now - t0 - START - (i - 1) * STEP) / DUR;
      o.visible = t > 0;
      o.position.x = parked[i] + run * (1 - easeOut(Math.min(1, Math.max(0, t))));
      if (t < 1) busy = true;
    });
    return busy;
  });
}

/** Clears the depth buffer just before a layer of the stack, so that layer is drawn whole. */
function depthClear(layer) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true }));
  m.frustumCulled = false;
  m.renderOrder = 1 + layer * 2;
  m.userData.cmpClear = true;
  m.onBeforeRender = renderer => renderer.clearDepth();
  m.raycast = () => {};
  return m;
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
 * @param {(m: object) => string} ctx.classLabel
 * @param {(m: object) => number} ctx.classRank
 * @param {() => object[]} ctx.collections
 * @param {() => object} ctx.ensureViewer
 * @param {(m: object) => Promise<THREE.Object3D>} ctx.modelObject build or load one model
 */
export function createCompare(ctx) {
  const { $, esc } = ctx;
  const presets = () => (ctx.collections() ?? []).map(p => ({ ...p, ids: p.ids.filter(id => byId(id)) })).filter(p => p.ids.length > 1);
  const cache = new Map(); // id -> Promise<Object3D>, only for the current selection
  let token = 0;
  let current = { key: '', sel: [], all: false, tab: 'lineup', mode: 'lineup', sort: 'length', objs: null, arranged: false };

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

  function hrefFor(ids, { all = false, tab = current.tab, sort = current.sort } = {}) {
    const q = new URLSearchParams();
    if (tab && tab !== 'lineup') q.set('view', tab);
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
  let stack = []; // the overlay's models in stack order, for the taxi-in and Replay
  function arrange({ animate = true } = {}) {
    const viewer = ctx.ensureViewer();
    const group = new THREE.Group();
    group.name = 'compare';
    const objs = current.objs;
    stack = [];
    for (const o of objs.values()) o.visible = true; // a taxi-in cut short may have left some hidden
    if (current.mode === 'overlay') {
      // Largest footprint at the bottom of the stack, smallest on top, noses on one point.
      const area = m => { const b = objs.get(m.id).userData.cmpBox; return (b.max.x - b.min.x) * (b.max.z - b.min.z); };
      [...current.sel].sort((a, b) => area(b) - area(a)).forEach((m, layer) => {
        const obj = objs.get(m.id);
        obj.position.set(-obj.userData.cmpBox.min.x, 0, 0);
        stackPaint(obj, colorOf(m), layer);
        group.add(obj, depthClear(layer));
        stack.push(obj);
      });
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
        stackPaint(obj, null);
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
    viewer.setView(current.mode === 'lineup' ? 'apron' : 'stack');
    viewer.setExplode(0);
    viewer.setXray(false);
    viewer.setPicking(false);
    // An overlay fits whole; a line-up fits its width to the stage, which brings a long row much closer.
    viewer.setModel(group, { fit: current.mode === 'lineup' ? lineupFit(group) : (innerWidth < 760 ? 0.9 : 0.76) });
    // Framed at the parked positions; now roll the smaller models in.
    if (current.mode === 'overlay' && animate) taxiIn(viewer, stack);
  }

  function replay() {
    if (current.mode !== 'overlay' || stack.length < 2) return;
    stack.forEach(o => { o.position.x = -o.userData.cmpBox.min.x; });
    taxiIn(ctx.ensureViewer(), stack);
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
  let silDirty = true;
  function drawSilhouettes() {
    const host = $('#cmp-sil');
    const panel = $('#cmp-panel-silhouettes');
    if (!host || !panel || panel.hidden || current.all || !current.objs) return;
    silDirty = false;
    // Silhouettes borrow the objects for a moment: draw them at their own origin.
    const items = current.sel.map(m => ({ obj: current.objs.get(m.id), color: colorOf(m) }));
    const saved = items.map(it => [it.obj.position.clone(), it.obj.visible]);
    items.forEach(it => { it.obj.position.set(0, 0, 0); it.obj.visible = true; });
    // A three-view sheet at one scale, sized to fit the panel without scrolling: side and front
    // share the ground line, the top view sits under the side view so noses and tails line up,
    // and the key fills the last corner.
    const gap = 20;
    const pad = parseFloat(getComputedStyle(panel).paddingLeft) || 20;
    const width = Math.min(panel.clientWidth - 2 * pad, 1400);
    const height = panel.clientHeight - 2 * pad;
    const sil = silhouettes(items, { width, height, gap, ink: css('--ink'), faint: css('--faint'), renderer: ctx.ensureViewer().renderer });
    items.forEach((it, i) => { it.obj.position.copy(saved[i][0]); it.obj.visible = saved[i][1]; });
    const cssW = c => parseFloat(c.style.width);
    host.innerHTML = `<div class="sil-sheet" style="grid-template-columns:${cssW(sil.side)}px ${cssW(sil.front)}px;gap:${gap}px">
        <figure class="sil" data-v="side"><figcaption class="label">Side</figcaption></figure>
        <figure class="sil" data-v="front"><figcaption class="label">Front</figcaption></figure>
        <figure class="sil" data-v="top"><figcaption class="label">Top</figcaption></figure>
        <div class="sil-key"><span class="label">One scale, noses aligned</span><ul>${current.sel.map(m => `<li><span class="dot" style="background:${colorOf(m)}"></span>${esc(m.name)}</li>`).join('')}</ul></div>
      </div>`;
    for (const v of ['side', 'front', 'top']) host.querySelector(`[data-v="${v}"]`).append(sil[v]);
  }

  function specTable() {
    const sel = current.sel;
    if (!sel.length) return '';
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
  const TABS = [
    { id: 'lineup', label: 'Line-up', panel: 'stage' },
    { id: 'overlay', label: 'Overlay', panel: 'stage' },
    { id: 'silhouettes', label: 'Silhouettes', panel: 'cmp-panel-silhouettes' },
    { id: 'specs', label: 'Specs', panel: 'cmp-panel-specs' },
  ];
  const tabOff = id => (id !== 'lineup' && (current.all || !current.sel.length)) || (id === 'overlay' && current.sel.length < 2);

  function headerHTML() {
    const listed = ctx.models();
    const chosen = new Set(current.sel.map(m => m.id));
    const byClass = [...listed].sort((a, b) => ctx.classRank(a) - ctx.classRank(b) || a.name.localeCompare(b.name));
    const suggested = presets();
    const chips = current.all ? `<span class="cmp-chip"><span class="dot" style="background:var(--ink)"></span>All ${listed.length} models<a class="x" href="${hrefFor([], { tab: 'lineup' })}" aria-label="Clear the line-up">×</a></span>`
      : current.sel.map(m => `<span class="cmp-chip"><span class="dot" style="background:${colorOf(m)}"></span>${esc(m.name)}<a class="x" href="${hrefFor(current.sel.filter(x => x !== m).map(x => x.id))}" aria-label="Remove ${esc(m.name)}">×</a></span>`).join('');
    const add = !current.all && current.sel.length < MAX ? pickerHTML({
      name: 'cmp-add', action: true, label: 'Add a model to compare', placeholder: current.sel.length ? 'Add a model' : 'Pick a model',
      options: byClass.filter(m => !chosen.has(m.id)).map(m => ({ value: m.id, label: m.name, group: ctx.classLabel(m) })),
    }) : '';
    const sets = pickerHTML({
      name: 'cmp-sets', action: true, label: 'Suggested sets', placeholder: 'Suggested sets', align: 'end',
      options: [
        ...suggested.map((p, i) => ({ value: String(i), label: p.label, hint: `${p.ids.length} models` })),
        { value: 'all', label: `Line up all ${listed.length}`, hint: 'every model' },
      ],
    });
    return `<header class="cmp-bar">
        <div class="cmp-title"><h1>Compare</h1><span class="label">at true scale</span></div>
        <div class="cmp-picks">${chips}${add}<span class="cmp-spacer"></span>${sets}</div>
      </header>`;
  }

  function tabsHTML() {
    return TABS.map(t => `<button type="button" role="tab" class="cmp-tab" id="cmp-tab-${t.id}" data-cmp-tab="${t.id}" aria-controls="${t.panel}" aria-selected="${t.id === current.tab}" tabindex="${t.id === current.tab ? 0 : -1}"${tabOff(t.id) ? ' disabled' : ''}>${t.label}</button>`).join('');
  }

  function toolsHTML() {
    if (current.tab === 'overlay' && current.sel.length > 1) {
      return `<button type="button" class="pick-btn" data-cmp-replay title="Taxi the aircraft in again"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>Replay</button>`;
    }
    if (current.tab !== 'lineup' || !current.sel.length) return '';
    return pickerHTML({ name: 'cmp-sort', label: 'Sort the line-up', prefix: 'Sort', value: current.sort, align: 'end', options: Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v.label })) });
  }

  /** Show the panel for the current tab, and draw whatever it needs. */
  function showTab() {
    const panelId = TABS.find(t => t.id === current.tab).panel;
    for (const id of ['stage', 'cmp-panel-silhouettes', 'cmp-panel-specs']) {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== panelId;
    }
    for (const b of document.querySelectorAll('[data-cmp-tab]')) {
      const on = b.dataset.cmpTab === current.tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    $('#cmp-tools').innerHTML = toolsHTML();
    if (panelId === 'stage') {
      const mode = current.tab === 'overlay' ? 'overlay' : 'lineup';
      if (current.objs && (mode !== current.mode || !current.arranged)) { current.mode = mode; arrange(); current.arranged = true; }
      current.mode = mode;
    } else if (current.tab === 'silhouettes' && silDirty) drawSilhouettes();
  }

  function setTab(tab) {
    if (tab === current.tab || tabOff(tab)) return;
    current.tab = tab;
    history.replaceState(null, '', hrefFor(current.sel.map(m => m.id), { all: current.all }));
    showTab();
  }

  function wire() {
    const page = $('.compare-page');
    page.addEventListener('pick', e => {
      const { name, value } = e.detail;
      if (name === 'cmp-add') location.hash = hrefFor([...current.sel.map(m => m.id), value]);
      else if (name === 'cmp-sets') {
        if (value === 'all') location.hash = hrefFor([], { all: true, tab: 'lineup' });
        else location.hash = hrefFor(presets()[Number(value)].ids);
      } else if (name === 'cmp-sort') {
        current.sort = value;
        history.replaceState(null, '', hrefFor(current.sel.map(m => m.id), { all: current.all }));
        if (current.objs) arrange();
      }
    });
    const tabs = $('.cmp-tabs');
    tabs.addEventListener('click', e => { const b = e.target.closest('[data-cmp-tab]'); if (b && !b.disabled) setTab(b.dataset.cmpTab); });
    $('#cmp-tools').addEventListener('click', e => { if (e.target.closest('[data-cmp-replay]')) replay(); });
    // Arrow keys move between tabs, as in any tab list.
    tabs.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const list = [...tabs.querySelectorAll('[data-cmp-tab]:not([disabled])')];
      const i = list.indexOf(document.activeElement);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
      e.preventDefault();
      list[j].focus();
      setTab(list[j].dataset.cmpTab);
    });
  }

  function render(route) {
    const listed = ctx.models();
    const all = route.all;
    const ids = all ? listed.map(m => m.id) : [...new Set(route.ids)].filter(byId).slice(0, MAX);
    const sel = ids.map(byId);
    const key = (all ? 'all' : ids.join(','));
    const wanted = route.view ?? (route.mode === 'overlay' ? 'overlay' : 'lineup');
    current = { ...current, sel, all, sort: SORTS[route.sort] ? route.sort : 'length', tab: 'lineup', arranged: false, objs: null };
    current.tab = TABS.some(t => t.id === wanted) && !tabOff(wanted) ? wanted : 'lineup';
    current.mode = current.tab === 'overlay' ? 'overlay' : 'lineup';
    silDirty = true;
    document.title = 'Compare · Machina';

    const empty = `<div class="cmp-empty"><div>
        <h2>Pick two to four models</h2>
        <p>Line them up on one apron, stack them on one spot, see their outlines from three sides and read their specs side by side, all at true scale.</p>
        <p class="label">Or start from a set</p>
        <div class="cmp-empty-sets">${presets().map(p => `<a class="cmp-preset" href="${hrefFor(p.ids)}">${esc(p.label)}</a>`).join('')}<a class="cmp-preset" href="${hrefFor([], { all: true, tab: 'lineup' })}">Line up all ${listed.length}</a></div>
      </div></div>`;
    $('#page').innerHTML = `
      <div class="compare-page">
        ${headerHTML()}
        <div class="cmp-tabbar">
          <div class="cmp-tabs" role="tablist" aria-label="Compare views">${tabsHTML()}</div>
          <div class="cmp-tools" id="cmp-tools"></div>
        </div>
        <div class="cmp-panels">
          <section class="stage cmp-stage" id="stage" role="tabpanel" aria-label="3D comparison">
            <div class="loading" id="loading" role="status" aria-live="polite" hidden><span class="spinner"></span><span class="label" id="cmp-progress">Loading</span></div>
            ${sel.length ? '' : empty}
          </section>
          <section class="cmp-panel" id="cmp-panel-silhouettes" role="tabpanel" aria-labelledby="cmp-tab-silhouettes" hidden><div class="cmp-sil" id="cmp-sil"></div></section>
          <section class="cmp-panel" id="cmp-panel-specs" role="tabpanel" aria-labelledby="cmp-tab-specs" hidden>${specTable()}</section>
        </div>
      </div>`;
    $('#stage').prepend($('#stage-host'));
    wire();
    showTab();
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
        current.arranged = true;
        loadingEl.hidden = true;
        if (current.tab === 'silhouettes') drawSilhouettes();
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

  // Theme switches recolor the labels and silhouette ink; a resize refits the silhouette sheet.
  new MutationObserver(() => {
    if (!$('.compare-page') || !current.objs) return;
    if (current.mode === 'lineup') arrange();
    silDirty = true;
    drawSilhouettes();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if ($('.compare-page')) { silDirty = true; drawSilhouettes(); } }, 150);
  });

  return { render };
}
