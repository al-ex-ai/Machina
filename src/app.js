// Machina app: hash router with home, category and model pages.
import * as THREE from 'three';
import './builders/index.js';
import { buildModel, finalize } from './registry.js';
import { loadAssetModel } from './assets.js';
import { createViewer } from './scene.js';
import { SYSTEMS } from './parts/common.js';
import { thumbnail } from './thumbs.js';

const SPEC_LABELS = {
  manufacturer: 'Manufacturer',
  role: 'Role',
  first_flight: 'First flight',
  in_service: 'In service',
  length_m: ['Length', 'm'],
  wingspan_m: ['Wingspan', 'm'],
  rotor_diameter_m: ['Rotor diameter', 'm'],
  width_m: ['Width', 'm'],
  height_m: ['Height', 'm'],
  mtow_kg: ['Max takeoff weight', 'kg'],
  weight_kg: ['Combat weight', 'kg'],
  range_km: ['Range', 'km'],
  max_speed_kmh: ['Max speed', 'km/h'],
  cruise_mach: ['Cruise speed', 'Mach'],
  engine_count: 'Engines',
  engine_type: 'Engine type',
  main_gun: 'Main gun',
  crew: 'Crew',
  seats: 'Seats',
};

// Categories planned on the roadmap, shown as "coming" until they have models.
const PLANNED = [
  { id: 'naval', label: 'Naval', description: 'Ships and submarines.' },
  { id: 'space', label: 'Space', description: 'Rockets and spacecraft.' },
  { id: 'automotive', label: 'Automotive', description: 'Cars and trucks.' },
];

// Sorting for galleries. "type" groups by kind of aircraft, biggest first within each.
const GROUP_ORDER = ['Airliners', 'Light aircraft', 'Helicopters', 'Historic', 'Prototype'];
const SORTS = {
  type: { label: 'Type, then size', cmp: (a, b) => groupRank(a) - groupRank(b) || b.specs.length_m - a.specs.length_m },
  name: { label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name) },
  largest: { label: 'Largest first', cmp: (a, b) => b.specs.length_m - a.specs.length_m },
  smallest: { label: 'Smallest first', cmp: (a, b) => a.specs.length_m - b.specs.length_m },
  oldest: { label: 'First flight, oldest', cmp: (a, b) => (a.specs.first_flight ?? 9999) - (b.specs.first_flight ?? 9999) },
  newest: { label: 'First flight, newest', cmp: (a, b) => (b.specs.first_flight ?? 0) - (a.specs.first_flight ?? 0) },
  maker: { label: 'Manufacturer', cmp: (a, b) => (a.specs.manufacturer ?? '').localeCompare(b.specs.manufacturer ?? '') || a.name.localeCompare(b.name) },
};
const groupRank = m => { const i = GROUP_ORDER.indexOf(m.group); return i < 0 ? GROUP_ORDER.length : i; };
let sortKey = (() => { try { return localStorage.getItem('machina-sort') || 'type'; } catch { return 'type'; } })();
if (!SORTS[sortKey]) sortKey = 'type';
const sorted = list => [...list].sort(SORTS[sortKey].cmp);
const sortSelect = () => `<label class="sort label">Sort <select id="sort" aria-label="Sort models">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>`;
function onSort(rerender) {
  document.getElementById('sort')?.addEventListener('change', e => {
    sortKey = e.target.value;
    try { localStorage.setItem('machina-sort', sortKey); } catch { /* storage unavailable */ }
    rerender();
  });
}

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (typeof v === 'number' ? v.toLocaleString('en-US') : v);
const widthOf = m => m.specs.wingspan_m ?? m.specs.rotor_diameter_m ?? m.specs.width_m;
const widthLabel = m => (m.specs.wingspan_m ? 'span' : m.specs.rotor_diameter_m ? 'rotor' : 'width');
const code = m => m.id.toUpperCase();

const state = { categories: [], models: [], part: null, model: null, xray: false, pick: false, loadToken: 0 };
let viewer = null;

// ── Theme ──────────────────────────────────────────────
const THEMES = [
  { id: 'dark', label: 'Dark', swatch: '#0a0e13' },
  { id: 'light', label: 'Light', swatch: '#eef1f4' },
  { id: 'blueprint', label: 'Blueprint', swatch: 'linear-gradient(135deg, #0b2b4c 55%, #ffad4a 55%)' },
];
const theme = () => document.documentElement.dataset.theme || 'dark';
function paintThemes() {
  $('#theme').innerHTML = THEMES.map(t => `<button type="button" role="radio" data-theme-id="${t.id}" aria-checked="${t.id === theme()}" aria-label="${t.label} theme" title="${t.label}"><span style="background:${t.swatch}"></span></button>`).join('');
}
$('#theme').addEventListener('click', e => {
  const id = e.target.closest('[data-theme-id]')?.dataset.themeId;
  if (!id || id === theme()) return;
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('machina-theme', id); } catch { /* storage unavailable */ }
  paintThemes();
  viewer?.setTheme(id);
});
paintThemes();

// ── Routing ────────────────────────────────────────────
function parseRoute() {
  const h = location.hash;
  const legacy = new URLSearchParams(h.slice(1));
  if (legacy.get('model')) return { name: 'model', id: legacy.get('model'), part: legacy.get('part') };
  const [path, query = ''] = h.replace(/^#\/?/, '').split('?');
  const seg = path.split('/').filter(Boolean);
  const q = new URLSearchParams(query);
  if (seg[0] === 'm' && seg[1]) return { name: 'model', id: seg[1], part: q.get('part'), xray: q.get('xray') === '1', person: q.get('person') === '1', view: q.get('view') };
  if (seg[0] === 'c' && seg[1]) return { name: 'category', id: seg[1] };
  return { name: 'home' };
}

function navLinks(route) {
  const cur = route.name === 'category' ? route.id : route.name === 'model' ? state.model?.category : null;
  $('#nav').innerHTML = [
    `<a href="#/" ${route.name === 'home' ? 'aria-current="page"' : ''}>Catalog</a>`,
    ...state.categories.map(c => `<a href="#/c/${esc(c.id)}" ${cur === c.id ? 'aria-current="page"' : ''}>${esc(c.label)}</a>`),
    '<a aria-disabled="true" title="Milestone M3">Compare<span class="soon">M3</span></a>',
  ].join('');
}

function render() {
  const route = parseRoute();
  if (route.name === 'model') {
    if (route.xray) state.xray = true;
    renderModel(route.id, route.part);
    if (route.view) viewer?.setView(route.view);
    if (route.person) $('#person')?.getAttribute('aria-pressed') !== 'true' && $('#person')?.click();
  }
  else {
    parkViewer();
    if (route.name === 'category') renderCategory(route.id);
    else renderHome();
    window.scrollTo(0, 0);
  }
  navLinks(route);
}

// ── Shared bits ────────────────────────────────────────
function cardHTML(m) {
  return `<a class="card" href="#/m/${esc(m.id)}">
    <div class="thumb"><span class="label code">${esc(code(m))}</span><img data-thumb="${esc(m.id)}" alt="" hidden><span class="spinner" aria-hidden="true"></span></div>
    <div class="card-body">
      <h3>${esc(m.name)}</h3>
      <div class="dims"><span><b>${m.specs.length_m}</b> m long</span><span><b>${widthOf(m)}</b> m ${widthLabel(m)}</span></div>
    </div></a>`;
}

function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    const m = state.models.find(x => x.id === img.dataset.thumb);
    if (!m) continue;
    thumbnail(m).then(url => {
      img.src = url;
      img.hidden = false;
      img.nextElementSibling?.classList.contains('spinner') && img.nextElementSibling.remove();
    }).catch(() => {});
  }
}

// ── Home ───────────────────────────────────────────────
function renderHome() {
  document.title = 'Machina';
  const cats = state.categories.map(c => ({ ...c, models: state.models.filter(m => m.category === c.id) }));
  const partCount = state.models.reduce((n, m) => n + (m._parts ?? 0), 0);
  $('#page').innerHTML = `
    <div class="blueprint"><div class="page">
      <section class="hero">
        <div>
          <span class="label">Data-driven 3D catalog</span>
          <h1>Machines, built from <em>their numbers.</em></h1>
          <p>Real open-source 3D models, grouped into named parts and measured against their published specifications. Click any part to see what it is and how big it really is.</p>
        </div>
        <div class="stats bracket">
          <div class="stat"><b>${state.models.length}</b><span>models</span></div>
          <div class="stat"><b>${partCount || '…'}</b><span>selectable parts</span></div>
          <div class="stat"><b>100%</b><span>open licenses, credited</span></div>
        </div>
      </section>

      <div class="section-head"><h2>Categories</h2><span class="label">${cats.length} live · ${PLANNED.length} planned</span></div>
      <div class="cats cats-live">
        ${cats.map(c => `<a class="cat" href="#/c/${esc(c.id)}">
          <div class="cat-art">${c.models[0] ? `<img data-thumb="${esc(c.models[0].id)}" alt="" hidden>` : ''}</div>
          <div class="cat-body"><div><span class="label">Category</span><h3>${esc(c.label)}</h3><p>${esc(c.description)}</p></div><span class="count">${String(c.models.length).padStart(2, '0')}</span></div>
        </a>`).join('')}
      </div>
      <div class="cats cats-planned">
        ${PLANNED.map(c => `<div class="cat soon" aria-disabled="true">
          <div class="cat-body"><div><span class="label">Coming, milestone M5</span><h3>${esc(c.label)}</h3><p>${esc(c.description)}</p></div><span class="count">--</span></div>
        </div>`).join('')}
      </div>

      <div class="section-head"><h2>All models</h2><div class="toolbar-row">${sortSelect()}<input class="search" id="search" type="search" placeholder="Search by name, maker or role" aria-label="Search models"></div></div>
      <div class="gallery" id="gallery"></div>
    </div></div>`;
  hydrateThumbs();
  const fill = () => {
    const q = $('#search').value.toLowerCase();
    const list = sorted(state.models.filter(m => `${m.name} ${m.group} ${m.specs.manufacturer} ${m.specs.role}`.toLowerCase().includes(q)));
    $('#gallery').innerHTML = list.map(cardHTML).join('') || '<p class="note">No models match.</p>';
    hydrateThumbs($('#gallery'));
  };
  fill();
  $('#search').addEventListener('input', fill);
  onSort(fill);
}

// ── Category ───────────────────────────────────────────
function renderCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat) { location.hash = '#/'; return; }
  document.title = `${cat.label} · Machina`;
  const models = state.models.filter(m => m.category === id);
  const groups = [...new Set(sorted(models).map(m => m.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  $('#page').innerHTML = `
    <div class="blueprint"><div class="page">
      <div class="crumbs"><a href="#/">Catalog</a><span class="sep">/</span><span>${esc(cat.label)}</span></div>
      <section class="hero" style="grid-template-columns:1fr auto">
        <div><span class="label">Category</span><h1>${esc(cat.label)}</h1><p>${esc(cat.description)}</p></div>
        <div class="stats bracket" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><b>${models.length}</b><span>models</span></div>
          <div class="stat"><b>${groups.length}</b><span>groups</span></div>
        </div>
      </section>
      <div class="section-head" style="margin-top:24px"><span></span>${sortSelect()}</div>
      ${groups.map(g => `<div class="group-title"><span class="label">${esc(g)}</span></div>
        <div class="gallery">${sorted(models.filter(m => m.group === g)).map(cardHTML).join('')}</div>`).join('')}
    </div></div>`;
  hydrateThumbs();
  onSort(() => renderCategory(id));
}

// ── Model ──────────────────────────────────────────────
function ensureViewer() {
  if (viewer) return viewer;
  viewer = createViewer($('#stage-host'));
  viewer.setTheme(theme());
  viewer.on('select', p => {
    state.part = p?.id ?? null;
    if (p && !state.pick) setPicking(true); // chosen from the tree or a link: switch the tool on to match
    renderSheet();
    markTree();
    const m = state.model;
    if (m) history.replaceState(null, '', `#/m/${m.id}${state.part ? `?part=${state.part}` : ''}`);
  });
  viewer.on('hover', (p, ev) => {
    const tip = $('#tip');
    if (!tip) return;
    if (!p || !ev) { tip.hidden = true; return; }
    const r = $('#stage').getBoundingClientRect();
    tip.textContent = p.label;
    tip.style.left = `${ev.clientX - r.left}px`;
    tip.style.top = `${ev.clientY - r.top}px`;
    tip.hidden = false;
  });
  return viewer;
}

function parkViewer() {
  const host = $('#stage-host');
  if (host && host.parentElement.id !== 'viewer-park') $('#viewer-park').appendChild(host);
}

function renderModel(id, partId) {
  const m = state.models.find(x => x.id === id);
  if (!m) { location.hash = '#/'; return; }
  const sameModel = state.model?.id === m.id && $('#stage');
  state.model = m;
  document.title = `${m.name} · Machina`;
  if (!sameModel) {
    const cat = state.categories.find(c => c.id === m.category);
    const list = sorted(state.models.filter(x => x.category === m.category));
    const i = list.indexOf(m);
    const prev = list[(i - 1 + list.length) % list.length];
    const next = list[(i + 1) % list.length];
    parkViewer(); // keep the canvas alive while the page is rebuilt
    $('#page').innerHTML = `
      <div class="model-page">
        <aside class="rail">
          <div class="crumbs" style="padding:0 8px 14px"><a href="#/">Catalog</a><span class="sep">/</span><a href="#/c/${esc(cat.id)}">${esc(cat.label)}</a></div>
          <span class="label">Part tree</span>
          <ul class="tree" id="tree" aria-label="Parts, grouped by system"></ul>
        </aside>
        <section class="stage" id="stage" aria-label="3D view of ${esc(m.name)}. Select parts from the part tree, or turn on the Select tool and click them in the view.">
          <div class="hud-top">
            <div class="readout"><span>${esc(code(m))}</span><span>L <b>${m.specs.length_m}</b> m</span><span>${widthLabel(m) === 'span' ? 'S' : 'W'} <b>${widthOf(m)}</b> m</span><span>H <b>${m.specs.height_m}</b> m</span></div>
            <div class="stepper">
              <a class="icon-btn" href="#/m/${esc(prev.id)}" title="Previous: ${esc(prev.name)}" aria-label="Previous model"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></a>
              <a class="icon-btn" href="#/m/${esc(next.id)}" title="Next: ${esc(next.name)}" aria-label="Next model"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></a>
            </div>
          </div>
          <div class="tip" id="tip" hidden></div>
          <div class="loading" id="loading" role="status" aria-live="polite" hidden><span class="spinner"></span><span class="label">Loading detailed model</span></div>
          <div class="dock" role="toolbar" aria-label="Viewer tools">
            <label class="tool" title="Pull parts apart (E)">Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"></label>
            <span class="sep"></span>
            <button class="tool" id="pick" type="button" aria-pressed="${state.pick}" title="Click parts in the view to select them (S)">Select <kbd>S</kbd></button>
            <button class="tool" id="xray" type="button" aria-pressed="${state.xray}" title="See through the airframe (X)">X-ray <kbd>X</kbd></button>
            <button class="tool" id="person" type="button" aria-pressed="false" title="Show a 1.8 m person (P)">Person <kbd>P</kbd></button>
            <button class="tool" id="reset" type="button" title="Reset the camera (R)">Reset <kbd>R</kbd></button>
          </div>
        </section>
        <aside class="sheet" id="sheet" aria-live="polite"></aside>
      </div>`;
    $('#stage').prepend($('#stage-host'));
    const v = ensureViewer();
    v.setXray(state.xray);
    v.setPicking(state.pick);
    $('#pick').addEventListener('click', () => setPicking(!state.pick));
    $('#xray').addEventListener('click', e => {
      state.xray = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(state.xray));
      v.setXray(state.xray);
    });
    $('#explode').addEventListener('input', e => v.setExplode(Number(e.target.value)));
    $('#person').addEventListener('click', e => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      v.setPerson(on);
    });
    $('#reset').addEventListener('click', () => v.resetView());
    showModel(m, partId);
    return;
  }
  viewer.select(partId ?? null);
  if (!partId) renderSheet();
}

/** Turn clicking parts in the view on or off. Turning it off clears the selection. */
function setPicking(on) {
  state.pick = on;
  $('#pick')?.setAttribute('aria-pressed', String(on));
  viewer?.setPicking(on);
  if (!on && state.part) viewer?.select(null);
}

/** Put the detailed asset (when there is one and it is enabled) or the generated model on stage. */
function showModel(m, partId) {
  const token = ++state.loadToken;
  const done = obj => {
    if (token !== state.loadToken) return;
    state.shownDetailed = Boolean(obj.userData.detailed);
    viewer.setModel(obj);
    viewer.setExplode(Number($('#explode')?.value ?? 0));
    $('#loading').hidden = true;
    renderTree();
    viewer.select(partId ?? null);
    if (!partId) renderSheet();
  };
  if (m.asset) {
    viewer.clear(); // never show the previous model while this one loads
    $('#tree').innerHTML = '';
    $('#loading').hidden = false;
    loadAssetModel(m)
      .then(o => { const f = finalize(o, m); f.userData.detailed = true; done(f); })
      .catch(err => {
        console.error(err);
        if (m.builder !== 'asset') return done(buildModel(m));
        $('#loading').innerHTML = '<span class="label">Could not load this model</span>';
      });
  } else done(buildModel(m));
}

function groupedParts() {
  const by = new Map();
  for (const p of viewer.listParts()) {
    if (!by.has(p.system)) by.set(p.system, []);
    by.get(p.system).push(p);
  }
  const order = Object.keys(SYSTEMS);
  return new Map([...by].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
}

function renderTree() {
  $('#tree').innerHTML = [...groupedParts()].map(([sys, ps]) => `
    <li class="tree-sys" data-open="true">
      <button type="button" data-toggle aria-expanded="true"><svg class="chev" aria-hidden="true" viewBox="0 0 10 10" fill="currentColor"><path d="M1 3l4 4 4-4z"/></svg>
        <span class="sys-dot" style="background:${SYSTEMS[sys]?.color ?? '#888'}"></span>${esc(SYSTEMS[sys]?.label ?? sys)}<span class="n">${ps.length}</span></button>
      <ul>${ps.map(p => `<li><button type="button" data-part="${esc(p.id)}">${esc(p.label)}</button></li>`).join('')}</ul>
    </li>`).join('');
  markTree();
}

function markTree() {
  document.querySelectorAll('#tree [data-part]').forEach(b => b.setAttribute('aria-current', String(b.dataset.part === state.part)));
}

function specRows(m) {
  return Object.entries(m.specs).filter(([k]) => SPEC_LABELS[k]).map(([k, v]) => {
    const l = SPEC_LABELS[k];
    const [label, unit] = Array.isArray(l) ? l : [l, ''];
    const isYear = k === 'first_flight' || k === 'in_service';
    const numeric = typeof v === 'number' && !isYear;
    const value = unit === 'Mach' ? `Mach ${v}` : `${isYear ? v : num(v)}${unit ? ` ${unit}` : ''}`;
    return `<div><dt>${esc(label)}</dt><dd class="${numeric ? 'num' : ''}">${esc(value)}</dd></div>`;
  }).join('');
}

/** Compare the size on stage with the published specs and say so plainly. */
function sizeBadge(m) {
  const size = viewer?.modelSize();
  if (!size) return '';
  const want = { length: m.specs.length_m, [widthLabel(m) === 'span' ? 'span' : widthLabel(m)]: widthOf(m), height: m.specs.height_m };
  const got = [size.x, size.z, size.y];
  const off = Object.entries(want).map(([k, w], i) => [k, (got[i] - w) / w]).filter(([, e]) => Math.abs(e) > 0.02);
  const measured = `Measured ${size.x.toFixed(2)} × ${size.z.toFixed(2)} × ${size.y.toFixed(2)} m`;
  if (!off.length) return `<span class="verified" title="${measured}">● Size matches published specs</span>`;
  const txt = off.map(([k, e]) => `${k} ${Math.abs(e * 100).toFixed(0)}% ${e > 0 ? 'over' : 'under'}`).join(', ');
  return `<span class="verified warn" title="${measured}">● Differs from published specs: ${txt}</span>`;
}

function renderSheet() {
  const m = state.model;
  const sheet = $('#sheet');
  if (!sheet || !m) return;
  const p = state.part ? viewer.listParts().find(x => x.id === state.part) : null;
  if (p) {
    const size = viewer.partSize(p.id);
    const sys = SYSTEMS[p.system];
    const info = Object.entries(p.info ?? {}).filter(([, v]) => v !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(num(v))}</dd></div>`).join('');
    sheet.innerHTML = `
      <button type="button" class="back" data-back>← ${esc(m.name)}</button>
      <h1>${esc(p.label)}</h1>
      <div class="part-head"><span class="sys-dot" style="background:${sys?.color ?? '#888'}"></span>${esc(sys?.label ?? p.system)}</div>
      ${info ? `<h2 class="label">Details</h2><dl class="specs">${info}</dl>` : ''}
      ${size ? `<h2 class="label">Measured in the model</h2><dl class="specs">
        <div><dt>Length</dt><dd class="num">${size.x.toFixed(2)} m</dd></div>
        <div><dt>Width</dt><dd class="num">${size.z.toFixed(2)} m</dd></div>
        <div><dt>Height</dt><dd class="num">${size.y.toFixed(2)} m</dd></div></dl>` : ''}
      <p class="note">Press Esc to return to the full model.</p>`;
    return;
  }
  sheet.innerHTML = `
    <span class="label">${esc(m.group)} · ${esc(code(m))}</span>
    <h1>${esc(m.name)}</h1>
    <p class="sub">${esc(m.summary)}</p>
    ${sizeBadge(m)}
    <h2 class="label">Specifications</h2>
    <dl class="specs">${specRows(m)}</dl>
    ${m.asset && state.shownDetailed ? `<h2 class="label">3D model</h2>
    <dl class="specs">
      <div><dt>Author</dt><dd>${esc(m.asset.author)}</dd></div>
      <div><dt>License</dt><dd>${esc(m.asset.license)}</dd></div>
      <div><dt>Source</dt><dd><a href="${esc(m.asset.source)}" target="_blank" rel="noopener noreferrer">${esc(m.asset.source.replace(/^https?:\/\//, ''))}</a></dd></div>
    </dl>
    ${m.asset.verify?.note ? `<p class="note">${esc(m.asset.verify.note)}</p>` : ''}` : ''}
    <h2 class="label">Sources</h2>
    <div class="sources">${(m.sources ?? []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} ↗</a>`).join('')}</div>
    <p class="note">Overall dimensions follow the published specs. Shapes are simplified and part details are approximate.</p>`;
}

// ── Events ─────────────────────────────────────────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-part],[data-toggle],[data-back]');
  if (!t) return;
  if (t.dataset.part !== undefined) viewer?.select(t.dataset.part);
  else if (t.dataset.toggle !== undefined) {
    const li = t.closest('.tree-sys');
    li.dataset.open = String(li.dataset.open !== 'true');
    t.setAttribute('aria-expanded', li.dataset.open);
  } else if (t.dataset.back !== undefined) viewer?.select(null);
});

document.addEventListener('mouseover', e => {
  const t = e.target.closest('#tree [data-part]');
  if (t) viewer?.setHover(t.dataset.part);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('#tree [data-part]')) viewer?.setHover(null);
});

document.addEventListener('keydown', e => {
  if (parseRoute().name !== 'model' || e.target.matches('input, textarea')) return;
  if (e.key === 'Escape') viewer?.select(null);
  else if (e.key === 'r' || e.key === 'R') viewer?.resetView();
  else if (e.key === 'p' || e.key === 'P') $('#person')?.click();
  else if (e.key === 'x' || e.key === 'X') $('#xray')?.click();
  else if (e.key === 's' || e.key === 'S') $('#pick')?.click();
  else if (e.key === 'e' || e.key === 'E') {
    const s = $('#explode');
    s.value = Number(s.value) > 0 ? 0 : 0.6;
    s.dispatchEvent(new Event('input'));
  }
});

window.addEventListener('hashchange', render);

// ── Boot ───────────────────────────────────────────────
async function boot() {
  const [categories, index] = await Promise.all([
    fetch('./data/categories.json').then(r => r.json()),
    fetch('./data/index.json').then(r => r.json()),
  ]);
  state.categories = categories;
  state.models = await Promise.all(index.models.map(p => fetch(`./data/${p}`).then(r => r.json())));
  // Count parts once for the home stats (cheap: builders only make geometry).
  for (const m of state.models) {
    let n = 0;
    const g = m.builder === 'asset' ? new THREE.Group() : buildModel(m);
    g.traverse(o => { if (o.userData.part) n++; if (o.isMesh) { o.geometry.dispose(); for (const mt of [o.material].flat()) { mt.map?.dispose(); mt.dispose(); } } });
    // Real models: count the parts their mapping produces (rules plus fallbacks).
    m._parts = m.asset ? new Set([...(m.asset.parts ?? []).map(r => r.id), m.asset.fallback?.id ?? 'airframe', ...(m.asset.files ?? []).map(f => f.fallback?.id).filter(Boolean)]).size : n;
  }
  render();
}

boot().catch(err => {
  $('#page').innerHTML = `<div class="page"><h1>Could not load the catalog</h1><p class="note">${esc(err.message)}</p></div>`;
  console.error(err);
});
