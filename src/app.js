// Machina app: hash router with home, category and model pages.
import * as THREE from 'three';
import './builders/index.js';
import { buildModel, finalize } from './registry.js';
import { loadAssetModel } from './assets.js';
import { createViewer } from './scene.js';
import { SYSTEMS } from './parts/common.js';
import { thumbnail } from './thumbs.js';
import { liveriesFor, withLivery, isAccent } from './parametric/liveries.js';

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

const state = { categories: [], models: [], part: null, model: null, xray: false, pick: false, loadToken: 0, livery: null, tab: 'overview', showPart: false, filter: '' };
let viewer = null;

// ── Icons ──────────────────────────────────────────────
const ICON = {
  overview: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  specs: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  drawing: '<path d="M3 17l6-10 4 7 3-4 5 7z"/><path d="M3 21h18"/>',
  sources: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  part: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  brush: '<path d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M6.5 12.5c-2 0-3.5 1.5-3.5 4 0 1.5-.5 2.5-1 3 3 0 6-1 6-4"/>',
  expand: '<path d="M7 9l5-5 5 5M7 15l5 5 5-5"/>',
  collapse: '<path d="M7 4l5 5 5-5M7 20l5-5 5 5"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
};
const icon = (name, size = 18) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

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
  if (seg[0] === 'm' && seg[1]) return { name: 'model', id: seg[1], part: q.get('part'), xray: q.get('xray') === '1', person: q.get('person') === '1', view: q.get('view'), livery: q.get('livery') };
  if (seg[0] === 'c' && seg[1]) return { name: 'category', id: seg[1] };
  if (seg[0] === 'history') return { name: 'history' };
  return { name: 'home' };
}

function navLinks(route) {
  const cur = route.name === 'category' ? route.id : route.name === 'model' ? state.model?.category : null;
  $('#nav').innerHTML = [
    `<a href="#/" ${route.name === 'home' ? 'aria-current="page"' : ''}>Catalog</a>`,
    ...state.categories.map(c => `<a href="#/c/${esc(c.id)}" ${cur === c.id ? 'aria-current="page"' : ''}>${esc(c.label)}</a>`),
    '<a aria-disabled="true" title="Milestone M3">Compare<span class="soon">M3</span></a>',
    `<a href="#/history" ${route.name === 'history' ? 'aria-current="page"' : ''}>History</a>`,
  ].join('');
}

function render() {
  const route = parseRoute();
  if (route.name === 'model') {
    if (route.xray) state.xray = true;
    if (state.model?.id !== route.id) state.livery = route.livery ?? null;
    renderModel(route.id, route.part);
    if (route.view) viewer?.setView(route.view);
    if (route.person) $('#person')?.getAttribute('aria-pressed') !== 'true' && $('#person')?.click();
  }
  else {
    parkViewer();
    if (route.name === 'category') renderCategory(route.id);
    else if (route.name === 'history') renderHistory();
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
/** Project history: what was built, milestone by milestone, from data/history.json. */
async function renderHistory() {
  document.title = 'History · Machina';
  const h = state.history ??= await fetch('./data/history.json').then(r => r.json());
  if (parseRoute().name !== 'history') return;
  // Compact by design: newest first, one line per entry, only the latest open, so the
  // page stays about one screen long however many milestones are added.
  const entries = [...h.entries].reverse();
  $('#page').innerHTML = `<div class="page history">
    <div class="hist-top">
      <div><span class="label">Project</span><h1>History</h1><p class="sub">${esc(h.intro)}</p></div>
      <aside class="hist-next"><span class="label">Next</span><ul>${h.next.map(i => `<li>${esc(i)}</li>`).join('')}</ul></aside>
    </div>
    <div class="hist-list">${entries.map((e, k) => `
      <details class="hist-item"${k === 0 ? ' open' : ''}>
        <summary>
          <time datetime="${esc(e.date)}">${esc(e.date.slice(5))}</time>
          <span class="hist-title">${esc(e.title)}</span>
          ${e.tag ? `<span class="tl-tag">${esc(e.tag)}</span>` : ''}
          <span class="hist-n">${e.items.length}</span>
        </summary>
        <ul>${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
      </details>`).join('')}
    </div>
  </div>`;
}

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
    state.showPart = Boolean(p);
    if (p && !state.pick) setPicking(true); // chosen from the tree or a link: switch the tool on to match
    renderSheet();
    markTree();
    syncURL();
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
        <aside class="rail" aria-label="Parts">
          <div class="rail-head">
            <div class="crumbs"><a href="#/">Catalog</a><span class="sep">/</span><a href="#/c/${esc(cat.id)}">${esc(cat.label)}</a></div>
            <div class="rail-title"><span class="label">Parts</span><span class="rail-tools">
              <button type="button" class="icon-sm" data-tree-all="open" title="Expand all" aria-label="Expand all groups">${icon('expand', 15)}</button>
              <button type="button" class="icon-sm" data-tree-all="close" title="Collapse all" aria-label="Collapse all groups">${icon('collapse', 15)}</button>
              <button type="button" class="icon-sm" data-drawer="rail" title="Hide parts" aria-label="Hide the parts panel">${icon('left', 15)}</button>
            </span></div>
            <label class="filter">${icon('search', 15)}<input id="part-filter" type="search" placeholder="Filter parts" aria-label="Filter parts" autocomplete="off"></label>
          </div>
          <ul class="tree" id="tree" aria-label="Parts, grouped by system"></ul>
          <div class="rail-foot" id="rail-foot"></div>
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
          <button type="button" class="drawer-open" data-drawer="rail" title="Show parts" aria-label="Show the parts panel">${icon('right', 16)}<span>Parts</span></button>
          <div class="paint" id="paint" role="radiogroup" aria-label="Livery" hidden></div>
          <div class="dock" role="toolbar" aria-label="Viewer tools">
            <label class="tool" title="Pull parts apart (E)">Explode <input id="explode" type="range" min="0" max="1" step="0.01" value="0"></label>
            <span class="sep"></span>
            <button class="tool" id="pick" type="button" aria-pressed="${state.pick}" title="Click parts in the view to select them (S)">Select <kbd>S</kbd></button>
            <button class="tool" id="xray" type="button" aria-pressed="${state.xray}" title="See through the airframe (X)">X-ray <kbd>X</kbd></button>
            <button class="tool" id="person" type="button" aria-pressed="false" title="Show a 1.8 m person (P)">Person <kbd>P</kbd></button>
            <button class="tool" id="reset" type="button" title="Reset the camera (R)">Reset <kbd>R</kbd></button>
          </div>
        </section>
        <aside class="sheet">
          <div class="panel" id="sheet" role="tabpanel" aria-live="polite"></div>
          <nav class="vtabs" id="tabs" role="tablist" aria-orientation="vertical" aria-label="Model information"></nav>
        </aside>
      </div>`;
    $('#stage').prepend($('#stage-host'));
    applyDrawers();
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

// Side panels are drawers: the parts rail slides away, the sheet folds to its tab rail.
const drawers = (() => { try { return JSON.parse(localStorage.getItem('machina-drawers')) ?? {}; } catch { return {}; } })();
function applyDrawers() {
  const page = document.querySelector('.model-page');
  if (!page) return;
  page.classList.toggle('rail-closed', Boolean(drawers.rail));
  page.classList.toggle('sheet-closed', Boolean(drawers.sheet));
  try { localStorage.setItem('machina-drawers', JSON.stringify(drawers)); } catch {}
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
    renderPaint();
    viewer.select(partId ?? null);
    if (!partId) renderSheet();
  };
  if (m.asset) {
    viewer.clear(); // never show the previous model while this one loads
    $('#tree').innerHTML = '';
    $('#loading').hidden = false;
    loadAssetModel(m, { accent: isAccent(state.livery) ? state.livery : undefined, original: state.livery === 'original' })
      .then(o => { const f = finalize(o, m); f.userData.detailed = true; done(f); })
      .catch(err => {
        console.error(err);
        if (m.builder !== 'asset') return done(buildModel(m));
        $('#loading').innerHTML = '<span class="label">Could not load this model</span>';
      });
  } else done(buildModel(withLivery(m, state.livery)));
  // (asset models apply a chosen accent through setLivery after loading)
}

/** Repaint the generated model in another livery, keeping the camera where it is. */
function setLivery(id) {
  const m = state.model;
  if (!m) return;
  state.livery = id === (liveriesFor(m)[0]?.id ?? 'machina') ? null : id; // the first preset is the default
  if (m.builder === 'asset') {
    const token = ++state.loadToken;
    loadAssetModel(m, { accent: isAccent(state.livery) ? state.livery : undefined, original: state.livery === 'original' }).then(o => {
      if (token !== state.loadToken) return;
      const f = finalize(o, m); f.userData.detailed = true;
      viewer.setModel(f, { keepView: true });
      viewer.setExplode(Number($('#explode')?.value ?? 0));
    });
  } else {
    viewer.setModel(buildModel(withLivery(m, state.livery)), { keepView: true });
    viewer.setExplode(Number($('#explode')?.value ?? 0));
  }
  syncURL();
  renderPaint();
}

/** Keep the address in step with the selected part and livery (no navigation). */
function syncURL() {
  const m = state.model;
  if (!m) return;
  const q = new URLSearchParams();
  if (state.part) q.set('part', state.part);
  if (state.livery) q.set('livery', state.livery);
  history.replaceState(null, '', `#/m/${m.id}${q.size ? `?${q}` : ''}`);
}

/** The livery palette floating in the stage: one swatch per preset, drawn like a fuselage (crown, stripe, belly). */
function renderPaint() {
  const el = $('#paint');
  if (!el || !state.model) return;
  const list = liveriesFor(state.model);
  el.hidden = !list.length;
  if (!list.length) { el.innerHTML = ''; return; }
  const cur = state.livery ?? list[0].id;
  const custom = isAccent(cur) && !list.some(l => l.id === cur) ? cur : '#3fa7d6';
  el.innerHTML = `<span class="paint-ic" title="Livery">${icon('brush', 15)}</span>` + list.map(l => {
    const [crown, belly, stripe] = l.swatch;
    return `<button type="button" class="paint-btn" role="radio" data-livery="${esc(l.id)}" aria-checked="${l.id === cur}" aria-label="${esc(l.label)}" data-name="${esc(l.label)}" tabindex="${l.id === cur ? 0 : -1}"
      style="background: linear-gradient(180deg, ${crown} 0 48%, ${stripe} 48% 60%, ${belly} 60% 100%)"></button>`;
  }).join('') + `<label class="paint-btn paint-custom" title="Custom color" data-name="Custom color" style="background:${custom}" aria-checked="${cur === custom}"><input type="color" id="paint-color" value="${custom}" aria-label="Custom livery color"></label>`;
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
  const groups = [...groupedParts()];
  $('#tree').innerHTML = groups.map(([sys, ps]) => `
    <li class="tree-sys" data-open="false">
      <button type="button" class="sys-head" data-toggle aria-expanded="false"><svg class="chev" aria-hidden="true" viewBox="0 0 10 10" fill="currentColor"><path d="M1 3l4 4 4-4z"/></svg>
        <span class="sys-dot" style="background:${SYSTEMS[sys]?.color ?? '#888'}"></span><span class="sys-name">${esc(SYSTEMS[sys]?.label ?? sys)}</span><span class="n">${ps.length}</span></button>
      <ul>${ps.map(p => `<li><button type="button" class="part-btn" data-part="${esc(p.id)}">${esc(p.label)}</button></li>`).join('')}</ul>
    </li>`).join('');
  const n = groups.reduce((a, [, ps]) => a + ps.length, 0);
  $('#rail-foot').innerHTML = `<span>${n} parts</span><span>${groups.length} systems</span>`;
  const f = $('#part-filter');
  if (f) f.value = state.filter;
  applyFilter();
  markTree();
}

/** Show only parts whose name matches the filter; groups with no match hide, the rest open. */
function applyFilter(e) {
  const q = state.filter.trim().toLowerCase();
  document.querySelectorAll('#tree .tree-sys').forEach(g => {
    let any = false;
    g.querySelectorAll('[data-part]').forEach(b => {
      const hit = !q || b.textContent.toLowerCase().includes(q) || g.querySelector('.sys-name').textContent.toLowerCase().includes(q);
      b.parentElement.hidden = !hit;
      any ||= hit;
    });
    g.hidden = !any;
    const open = q ? any : Boolean(state.part && g.querySelector(`[data-part="${CSS.escape(state.part)}"]`));
    if (q || e === 'clear') { g.dataset.open = String(open); g.querySelector('[data-toggle]').setAttribute('aria-expanded', String(open)); }
  });
}

function markTree() {
  document.querySelectorAll('#tree [data-part]').forEach(b => {
    const on = b.dataset.part === state.part;
    b.setAttribute('aria-current', String(on));
    if (on) {
      // Groups start collapsed; the one holding the selected part opens.
      const g = b.closest('.tree-sys');
      g.dataset.open = 'true';
      g.querySelector('[data-toggle]').setAttribute('aria-expanded', 'true');
      b.scrollIntoView({ block: 'nearest' }); // picked in the view: bring it into sight in the tree
    }
  });
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

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'specs', label: 'Specs' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'sources', label: 'Sources' },
  { id: 'part', label: 'Part' },
];

function renderTabs(active) {
  $('#tabs').innerHTML = TABS.filter(t => t.id !== 'part' || state.part).map(t => {
    const off = false;
    return `<button type="button" role="tab" class="vtab" id="tab-${t.id}" data-tab="${t.id}" aria-selected="${t.id === active}" aria-controls="sheet" tabindex="${t.id === active ? 0 : -1}"${off ? ' disabled title="Select a part to see its details"' : ''}>
      ${icon(t.id, 20)}<span>${t.label}</span></button>`;
  }).join('');
  $('#sheet').setAttribute('aria-labelledby', `tab-${active}`);
}

function renderSheet() {
  const m = state.model;
  const sheet = $('#sheet');
  if (!sheet || !m) return;
  const p = state.part ? viewer.listParts().find(x => x.id === state.part) : null;
  const active = p && state.showPart ? 'part' : state.tab;
  renderTabs(active);
  sheet.scrollTop = 0;
  sheet.innerHTML = active === 'part' ? partPanel(m, p) : PANELS[active](m);
}

const statTiles = m => {
  const w = widthOf(m), wl = widthLabel(m);
  return `<div class="tiles">
    <div class="tile"><span>Length</span><b>${m.specs.length_m}<i>m</i></b></div>
    <div class="tile"><span>${wl === 'span' ? 'Span' : wl === 'rotor' ? 'Rotor' : 'Width'}</span><b>${w}<i>m</i></b></div>
    <div class="tile"><span>Height</span><b>${m.specs.height_m}<i>m</i></b></div>
  </div>`;
};

const builtFrom = m => m.asset && state.shownDetailed ? 'Detailed FlightGear model'
  : m.derived ? 'Parametric, measured from a FlightGear mesh'
  : m.reference ? 'Parametric, measured from a three-view drawing'
  : m.builder === 'parametric' ? 'Parametric, from published dimensions' : 'Generated from published dimensions';

const PANELS = {
  overview: m => `
    <span class="label">${esc(m.group)} · ${esc(code(m))}</span>
    <h1>${esc(m.name)}</h1>
    <p class="sub">${esc(m.summary)}</p>
    ${sizeBadge(m)}
    ${statTiles(m)}
    <dl class="facts">
      ${m.specs.manufacturer ? `<div><dt>Manufacturer</dt><dd>${esc(m.specs.manufacturer)}</dd></div>` : ''}
      ${m.specs.role ? `<div><dt>Role</dt><dd>${esc(m.specs.role)}</dd></div>` : ''}
      ${m.specs.first_flight ? `<div><dt>First flight</dt><dd>${esc(m.specs.first_flight)}</dd></div>` : ''}
      <div><dt>Built</dt><dd>${esc(builtFrom(m))}</dd></div>
    </dl>
    <button type="button" class="link-btn" data-tab="specs">All specifications →</button>`,
  specs: m => `
    <span class="label">Specifications</span>
    <h1>${esc(m.name)}</h1>
    <dl class="specs">${specRows(m)}</dl>
    <p class="note">Overall dimensions follow the published specs. Shapes are simplified and part details are approximate.</p>`,
  drawing: m => `
    <span class="label">Three-view drawing</span>
    <h1>${esc(m.name)}</h1>
    <p class="sub">Side, front and top views with sections, projected from the 3D model on an A3 sheet at a standard scale.</p>
    <a class="drawing" href="drawings/${esc(m.id)}.svg" target="_blank" rel="noopener" title="Open the drawing (SVG)">
      <img src="drawings/${esc(m.id)}.svg" alt="Side, top and front views of the ${esc(m.name)}" loading="lazy" onerror="this.closest('.drawing').outerHTML = '<p class=&quot;note&quot;>No drawing yet for this model.</p>'">
    </a>
    <div class="btn-row">
      <a class="btn" href="drawings/${esc(m.id)}.svg" target="_blank" rel="noopener">${icon('open', 16)}Open full size</a>
      <a class="btn" href="drawings/${esc(m.id)}.svg" download="${esc(m.id)}-three-view.svg">${icon('download', 16)}Download SVG</a>
    </div>`,
  sources: m => {
    const prov = m.asset && state.shownDetailed ? [['3D model', m.asset.author], ['License', m.asset.license], ['Source', m.asset.source]]
      : m.derived ? [['Measured from', `FlightGear model by ${m.derived.author}`], ['License', m.derived.license], ['Source', m.derived.source]]
      : m.reference ? [['Measured from', `Drawing by ${m.reference.author}`], ['License', m.reference.license], ['Source', m.reference.source]]
      : [];
    const row = ([k, v]) => `<div><dt>${esc(k)}</dt><dd>${/^https?:/.test(v ?? '') ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v.replace(/^https?:\/\//, ''))}</a>` : esc(v ?? '')}</dd></div>`;
    const note = (m.asset && state.shownDetailed ? m.asset.verify?.note : m.verify?.note) ?? '';
    return `
    <span class="label">Sources and credits</span>
    <h1>${esc(m.name)}</h1>
    ${prov.length ? `<h2 class="label">Geometry</h2><dl class="specs">${prov.map(row).join('')}</dl>` : ''}
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <h2 class="label">Specifications</h2>
    <div class="sources">${(m.sources ?? []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${icon('open', 14)}${esc(s.label)}</a>`).join('')}</div>`;
  },
};

function partPanel(m, p) {
  const size = viewer.partSize(p.id);
  const sys = SYSTEMS[p.system];
  const info = Object.entries(p.info ?? {}).filter(([, v]) => v !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(num(v))}</dd></div>`).join('');
  return `
    <button type="button" class="back" data-back>← ${esc(m.name)}</button>
    <span class="chip"><span class="sys-dot" style="background:${sys?.color ?? '#888'}"></span>${esc(sys?.label ?? p.system)}</span>
    <h1>${esc(p.label)}</h1>
    ${size ? `<div class="tiles">
      <div class="tile"><span>Length</span><b>${size.x.toFixed(2)}<i>m</i></b></div>
      <div class="tile"><span>Width</span><b>${size.z.toFixed(2)}<i>m</i></b></div>
      <div class="tile"><span>Height</span><b>${size.y.toFixed(2)}<i>m</i></b></div>
    </div><p class="note tight">Measured in the model.</p>` : ''}
    ${info ? `<h2 class="label">Details</h2><dl class="specs">${info}</dl>` : ''}
    <p class="note">Press Esc to return to the full model.</p>`;
}

// ── Events ─────────────────────────────────────────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-part],[data-toggle],[data-back],[data-livery],[data-tab],[data-tree-all],[data-drawer]');
  if (!t) return;
  if (t.dataset.livery !== undefined) setLivery(t.dataset.livery);
  else if (t.dataset.drawer !== undefined) { drawers[t.dataset.drawer] = !drawers[t.dataset.drawer]; applyDrawers(); }
  else if (t.dataset.tab !== undefined) {
    const active = t.getAttribute('aria-selected') === 'true';
    if (t.classList.contains('vtab') && (active || drawers.sheet)) { drawers.sheet = active && !drawers.sheet; applyDrawers(); if (active) return; }
    if (t.dataset.tab === 'part') state.showPart = true;
    else { state.tab = t.dataset.tab; state.showPart = false; }
    renderSheet();
    $(`#tab-${t.dataset.tab}`)?.focus();
  } else if (t.dataset.treeAll !== undefined) {
    const open = t.dataset.treeAll === 'open';
    document.querySelectorAll('#tree .tree-sys').forEach(g => { g.dataset.open = String(open); g.querySelector('[data-toggle]').setAttribute('aria-expanded', String(open)); });
  }
  else if (t.dataset.part !== undefined) viewer?.select(t.dataset.part);
  else if (t.dataset.toggle !== undefined) {
    const li = t.closest('.tree-sys');
    li.dataset.open = String(li.dataset.open !== 'true');
    t.setAttribute('aria-expanded', li.dataset.open);
  } else if (t.dataset.back !== undefined) viewer?.select(null);
});

document.addEventListener('change', e => {
  if (e.target.id === 'paint-color') setLivery(e.target.value);
});

document.addEventListener('input', e => {
  if (e.target.id !== 'part-filter') return;
  state.filter = e.target.value;
  applyFilter(state.filter ? null : 'clear');
});

// Arrow keys move between vertical tabs and between livery swatches (roving focus).
document.addEventListener('keydown', e => {
  const tab = e.target.closest?.('.vtab'), sw = e.target.closest?.('.paint-btn');
  if (!tab && !sw) return;
  const keys = tab ? ['ArrowUp', 'ArrowDown'] : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (![...keys, 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const items = [...(tab ? document.querySelectorAll('.vtab:not([disabled])') : document.querySelectorAll('.paint-btn'))];
  const i = items.indexOf(e.target);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1) + items.length) % items.length;
  items[next].click();
  items[next].focus?.();
});

document.addEventListener('mouseover', e => {
  const t = e.target.closest('#tree [data-part]');
  if (t) viewer?.setHover(t.dataset.part);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('#tree [data-part]')) viewer?.setHover(null);
});

document.addEventListener('keydown', e => {
  if (parseRoute().name !== 'model' || e.target.matches('input, textarea') || e.target.closest('.vtab, .paint-btn')) return;
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
