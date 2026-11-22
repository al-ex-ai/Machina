// Machina app: hash router with home, category and model pages.
import { liveriesFor, withLivery, isAccent } from './parametric/liveries.js';
import { pickerHTML, installPickers } from './picker.js';

installPickers();

// The 3D engine (Three.js, builders, viewer) loads on demand: the catalog only shows prerendered
// thumbnails, so it renders without it. Model pages wait for it; the home page fetches it when idle.
let buildModel, finalize, partCount, loadAssetModel, createViewer, SYSTEMS, thumbnail, createCompare;
let engine = null;
const loadEngine = () => (engine ??= import('./engine.js').then(e => {
  ({ buildModel, finalize, partCount, loadAssetModel, createViewer, SYSTEMS, thumbnail, createCompare } = e);
}));
const needsEngine = route => route.name === 'model' || route.name === 'compare';
let compareView = null;
let engineReady = false;

const SPEC_LABELS = {
  manufacturer: 'Manufacturer',
  country: 'Country',
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

// Eras, from the first powered flight on, computed from a model's first flight.
const ERAS = [
  { id: 'pioneers', label: 'Pioneers', from: 1903, to: 1918 },
  { id: 'golden-age', label: 'Golden age', from: 1919, to: 1938 },
  { id: 'war-years', label: 'War years', from: 1939, to: 1945 },
  { id: 'jet-age', label: 'Jet age', from: 1946, to: 1969 },
  { id: 'wide-body', label: 'Wide-body era', from: 1970, to: 1989 },
  { id: 'digital', label: 'Digital era', from: 1990, to: 2009 },
  { id: 'modern', label: 'Modern', from: 2010, to: 9999 },
];
const eraOf = m => ERAS.find(e => m.specs.first_flight >= e.from && m.specs.first_flight <= e.to);
const liveCategories = () => state.categories.filter(c => !c.planned);
const plannedCategories = () => state.categories.filter(c => c.planned);
const classOf = m => state.categories.find(c => c.id === m.category)?.classes?.find(k => k.id === m.class);
const classLabel = m => classOf(m)?.label ?? '';
const countriesOf = m => [].concat(m.specs.country ?? []);
// Category order, then class order within it: the order the data files give.
const classRank = m => {
  const ci = state.categories.findIndex(c => c.id === m.category), cat = state.categories[ci];
  return ci * 100 + Math.max(0, cat?.classes?.findIndex(k => k.id === m.class) ?? 0);
};

// Sorting for galleries. "type" groups by class, biggest first within each.
const SORTS = {
  type: { label: 'Type, then size', cmp: (a, b) => classRank(a) - classRank(b) || b.specs.length_m - a.specs.length_m },
  name: { label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name) },
  largest: { label: 'Largest first', cmp: (a, b) => b.specs.length_m - a.specs.length_m },
  smallest: { label: 'Smallest first', cmp: (a, b) => a.specs.length_m - b.specs.length_m },
  oldest: { label: 'First flight, oldest', cmp: (a, b) => (a.specs.first_flight ?? 9999) - (b.specs.first_flight ?? 9999) },
  newest: { label: 'First flight, newest', cmp: (a, b) => (b.specs.first_flight ?? 0) - (a.specs.first_flight ?? 0) },
  maker: { label: 'Manufacturer', cmp: (a, b) => (a.specs.manufacturer ?? '').localeCompare(b.specs.manufacturer ?? '') || a.name.localeCompare(b.name) },
};
let sortKey = (() => { try { return localStorage.getItem('machina-sort') || 'type'; } catch { return 'type'; } })();
if (!SORTS[sortKey]) sortKey = 'type';
const sorted = list => [...list].sort(SORTS[sortKey].cmp);
const sortSelect = () => pickerHTML({ name: 'sort', label: 'Sort models', prefix: 'Sort', value: sortKey, align: 'end', options: Object.entries(SORTS).map(([k, v]) => ({ value: k, label: v.label })) });
function onSort(rerender) {
  document.querySelector('[data-pick="sort"]')?.addEventListener('pick', e => {
    sortKey = e.detail.value;
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

const state = { categories: [], models: [], thumbs: {}, part: null, model: null, xray: false, pick: false, loadToken: 0, livery: null, tab: 'overview', showPart: false, filter: '' };
let viewer = null;

// ── Icons ──────────────────────────────────────────────
const ICON = {
  overview: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  specs: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  drawing: '<path d="M3 17l6-10 4 7 3-4 5 7z"/><path d="M3 21h18"/>',
  compare: '<path d="M5 20V11M12 20V4M19 20v-6"/><path d="M3 20h18"/>',
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
  const filters = Object.fromEntries(['class', 'era', 'country', 'maker', 'q'].map(k => [k, q.get(k) ?? '']));
  if (seg[0] === 'c' && seg[1]) return { name: 'category', id: seg[1], filters };
  if (seg[0] === 'browse') return { name: 'browse', filters };
  if (seg[0] === 'history') return { name: 'history' };
  if (seg[0] === 'compare') return { name: 'compare', all: seg[1] === 'all', ids: seg[1] && seg[1] !== 'all' ? seg[1].split(',') : [], mode: q.get('mode'), view: q.get('view'), sort: q.get('sort') };
  return { name: 'home' };
}

function navLinks(route) {
  const cur = route.name === 'category' ? route.id : route.name === 'model' ? state.model?.category : null;
  const q = route.name === 'browse' ? route.filters.q : '';
  $('#nav').innerHTML = [
    `<a href="#/" ${route.name === 'home' ? 'aria-current="page"' : ''}>Catalog</a>`,
    ...liveCategories().map(c => `<a href="#/c/${esc(c.id)}" ${cur === c.id ? 'aria-current="page"' : ''}>${esc(c.label)}</a>`),
    `<a href="#/compare" ${route.name === 'compare' ? 'aria-current="page"' : ''}>Compare</a>`,
    `<a href="#/history" ${route.name === 'history' ? 'aria-current="page"' : ''}>History</a>`,
    `<form class="nav-search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search machines" aria-label="Search machines"></form>`,
  ].join('');
}
// The header search opens Browse with the query; one listener, since the nav is rebuilt per route.
document.addEventListener('submit', e => {
  if (!e.target.matches('.nav-search')) return;
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = q ? `#/browse?q=${encodeURIComponent(q)}` : '#/browse';
});

function render() {
  const route = parseRoute();
  if (needsEngine(route) && !engineReady) {
    navLinks(route);
    if (!$('#stage')) $('#page').innerHTML = `<div class="page"><p class="note">Loading the 3D viewer…</p></div>`;
    loadEngine().then(() => { engineReady = true; render(); }, err => {
      engine = null;
      $('#page').innerHTML = `<div class="page"><h1>Could not load the 3D viewer</h1><p class="note">${esc(err.message)}</p></div>`;
    });
    return;
  }
  if (route.name === 'compare') {
    compareView ??= createCompare({
      $, esc,
      models: () => state.models,
      specLabels: SPEC_LABELS,
      classLabel,
      classRank,
      collections: () => state.collections,
      ensureViewer,
      modelObject,
    });
    parkViewer(); // keep the canvas alive while the page is rebuilt (it may sit in the model page)
    state.loadToken++; // a model page load still in flight must not land on this page
    compareView.render(route);
    state.inCompare = true;
    window.scrollTo(0, 0);
    navLinks(route);
    return;
  }
  if (route.name === 'model') {
    if (state.inCompare) { state.inCompare = false; viewer?.setView(null); } // Compare leaves the apron camera on
    if (route.xray) state.xray = true;
    if (state.model?.id !== route.id) state.livery = route.livery ?? null;
    renderModel(route.id, route.part);
    if (route.view) viewer?.setView(route.view);
    if (route.person) $('#person')?.getAttribute('aria-pressed') !== 'true' && $('#person')?.click();
  }
  else {
    parkViewer();
    state.loadToken++;
    if (route.name === 'category') renderCategory(route.id, route.filters);
    else if (route.name === 'browse') renderBrowse(route.filters);
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

// Prerendered thumbnails (npm run thumbs) are plain images. A model without one, or whose image
// fails to load, is rendered in the browser instead, which downloads the whole model.
function hydrateThumbs(root = document) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    const m = state.models.find(x => x.id === img.dataset.thumb);
    if (!m) continue;
    const reveal = () => {
      img.hidden = false;
      img.nextElementSibling?.classList.contains('spinner') && img.nextElementSibling.remove();
    };
    const live = () => loadEngine().then(() => thumbnail(m)).then(url => { img.onload = null; img.src = url; reveal(); }).catch(() => {});
    const pre = state.thumbs[m.id];
    if (!pre) { live(); continue; }
    img.decoding = 'async';
    img.onload = reveal;
    img.onerror = () => { img.onerror = null; live(); };
    img.src = `./assets/thumbs/${encodeURIComponent(m.id)}.webp?v=${pre.hash}`;
  }
}

// ── Home ───────────────────────────────────────────────
function renderHome() {
  document.title = 'Machina · Machines, as they really are';
  const models = state.models;
  const parts = models.reduce((n, m) => n + (m._parts ?? 0), 0);
  const sources = new Set(models.map(m => m.asset?.author ?? m.id)).size;
  const live = liveCategories().map(c => ({ ...c, models: models.filter(m => m.category === c.id) }));
  // The line-up is the true-scale collection when there is one, else machines spread across the size range.
  const scale = state.collections?.find(c => c.id === 'true-scale')?.ids.map(id => models.find(m => m.id === id)).filter(Boolean);
  const lineup = scale?.length > 2 ? [...scale].sort((a, b) => a.specs.length_m - b.specs.length_m) : lineupPick(models, 7);
  const collections = (state.collections ?? []).filter(c => c.id !== 'true-scale').map(c => ({ ...c, models: c.ids.map(id => models.find(m => m.id === id)).filter(Boolean) })).filter(c => c.models.length > 1);
  const eras = ERAS.map(e => ({ ...e, n: models.filter(m => eraOf(m)?.id === e.id).length }));
  $('#page').innerHTML = `
    <div class="blueprint"><div class="page home">
      <section class="hero home-hero">
        <div>
          <span class="label">Open 3D catalog of real machines</span>
          <h1>Machines, <em>as they really are.</em></h1>
          <p>Real machines you can take apart, compare at true scale and trust, because every one is measured.</p>
          <p class="values"><span>Real.</span> <span>Measured.</span> <span>Open.</span></p>
        </div>
        <div class="stats bracket">
          <div class="stat"><b>${models.length}</b><span>machines</span></div>
          <div class="stat"><b>${parts || '…'}</b><span>named parts</span></div>
          <div class="stat"><b>${sources}</b><span>credited sources</span></div>
        </div>
      </section>

      <section class="lineup-wrap" aria-label="Machines at true scale">
        <div class="lineup-head"><span class="label">True scale</span><span class="label" id="lineup-scale"></span></div>
        <div class="lineup-scroll" id="lineup-scroll">
        <div class="lineup" id="lineup">${lineup.map(m => `
          <a class="lineup-item" href="#/m/${esc(m.id)}" title="${esc(m.name)}, ${num(m.specs.length_m)} m">
            <img alt="${esc(m.name)}" data-length="${m.specs.length_m}" src="./assets/thumbs/${encodeURIComponent(m.id)}-side.webp${state.thumbs[m.id] ? `?v=${state.thumbs[m.id].hash}` : ''}">
            <span class="lineup-name">${esc(shortName(m))}</span><span class="lineup-len">${num(m.specs.length_m)} m</span>
          </a>`).join('')}
        </div>
        <div class="ruler" id="ruler" aria-hidden="true"></div>
        </div>
      </section>

      <div class="section-head"><h2>Categories</h2><span class="label">${live.length} live · ${plannedCategories().length} coming</span></div>
      <div class="cats cats-live">
        ${live.map(c => {
          const rep = [...c.models].sort((a, b) => b.specs.length_m - a.specs.length_m)[Math.floor(c.models.length / 3)] ?? c.models[0];
          const classes = (c.classes ?? []).map(k => ({ ...k, n: c.models.filter(m => m.class === k.id).length })).filter(k => k.n);
          return `<div class="cat">
            <a class="cat-art" href="#/c/${esc(c.id)}" tabindex="-1" aria-hidden="true">${rep ? `<img data-thumb="${esc(rep.id)}" alt="" hidden>` : ''}</a>
            <div class="cat-body">
              <div><a class="cat-title" href="#/c/${esc(c.id)}"><h3>${esc(c.label)}</h3></a><p>${esc(c.description)}</p>
                <div class="chips">${classes.map(k => `<a class="class-chip" href="#/c/${esc(c.id)}?class=${esc(k.id)}">${esc(k.label)} <b>${k.n}</b></a>`).join('')}</div>
              </div>
              <span class="count">${String(c.models.length).padStart(2, '0')}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <p class="coming"><span class="label">Coming</span>${plannedCategories().map(c => `<span class="soon-chip" title="${esc(c.description)}">${esc(c.label)}</span>`).join('')}</p>

      ${collections.length ? `<div class="section-head"><h2>Collections</h2><span class="label">opens in Compare</span></div>
      <div class="collections">${collections.map(c => `
        <a class="collection" href="#/compare/${c.models.map(m => encodeURIComponent(m.id)).join(',')}">
          <div class="coll-thumbs">${c.models.slice(0, 4).map(m => `<img data-thumb="${esc(m.id)}" alt="" hidden>`).join('')}</div>
          <div class="coll-body"><h3>${esc(c.label)}</h3><p>${esc(c.description)}</p><span class="label">${c.models.length} machines</span></div>
        </a>`).join('')}</div>` : ''}

      <div class="section-head"><h2>Eras</h2><span class="label">by first flight</span></div>
      <div class="eras">${eras.map(e => `
        <a class="era${e.n ? '' : ' empty'}" href="#/browse?era=${esc(e.id)}"${e.n ? '' : ' aria-disabled="true" tabindex="-1"'}>
          <span class="era-years">${e.from}${e.to < 9999 ? `–${e.to}` : '+'}</span><span class="era-name">${esc(e.label)}</span><b>${e.n}</b>
        </a>`).join('')}</div>

      <section class="trust">
        <div><h3>Real</h3><p>Only genuine models: open-source simulator models and museum scans, never generated guesses.</p></div>
        <div><h3>Measured</h3><p>Every machine is checked against its published specifications and drawn from its own geometry.</p></div>
        <div><h3>Open</h3><p>Every source and license is credited, and everything here is free to explore.</p></div>
      </section>

      <div class="browse-all"><a class="button" href="#/browse">Browse all ${models.length} machines</a></div>
    </div></div>`;
  hydrateThumbs();
  layoutLineup();
}

/** Up to n machines from smallest to largest, spread evenly across the size range. */
function lineupPick(models, n) {
  const bySize = [...models].sort((a, b) => a.specs.length_m - b.specs.length_m);
  if (bySize.length <= n) return bySize;
  return [...new Set(Array.from({ length: n }, (_, i) => bySize[Math.round((i * (bySize.length - 1)) / (n - 1))]))];
}

/** A short label for the line-up: the type without the maker. */
const shortName = m => m.name.replace(/^(Boeing|Airbus|Lockheed|Antonov|Ilyushin|Tupolev|Cessna|Piper|Robin|Eurocopter|Aérospatiale\/BAC)\s+/, '');

/**
 * Size the line-up so every profile shares one meters-to-pixels scale. Each item is as wide as its
 * profile or its label, whichever is wider, and the scale is the largest that fits the row. When that
 * would shrink the smallest model below 20 px (phones, tablets) the row keeps a readable scale and
 * scrolls sideways instead.
 */
function layoutLineup() {
  const row = $('#lineup'), scroller = $('#lineup-scroll');
  if (!row) return;
  const items = [...row.querySelectorAll('.lineup-item')];
  const lengths = items.map(it => Number(it.querySelector('img').dataset.length));
  const labels = items.map(it => Math.max(...[...it.querySelectorAll('span')].map(s => s.scrollWidth)));
  const width = px => lengths.reduce((sum, len, i) => sum + Math.max(len * px, labels[i]), 0);
  const gap = 28, room = scroller.clientWidth - gap * (items.length - 1);
  let lo = 0, hi = 12;
  for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (width(mid) <= room) lo = mid; else hi = mid; }
  const smallest = Math.min(...lengths), scrolls = lo * smallest < 20;
  const pxPerM = scrolls ? 28 / smallest : lo;
  row.classList.toggle('scrolls', scrolls);
  items.forEach((it, i) => { it.querySelector('img').style.width = `${(lengths[i] * pxPerM).toFixed(1)}px`; });
  $('#ruler').style.backgroundSize = `${pxPerM * 10}px 100%`;
  $('#lineup-scale').textContent = scrolls ? 'ruler ticks 10 m · swipe' : 'ruler ticks 10 m';
}
window.addEventListener('resize', () => { if (parseRoute().name === 'home') layoutLineup(); });

// ── Browse and category pages ──────────────────────────
const FILTERS = ['class', 'era', 'country', 'maker'];
const makerOf = m => m.specs.manufacturer ?? '';

/** Browse every machine, or one category (fixed), filtered by class, era, country, maker and text. */
function renderBrowse(f, fixed = null) {
  const cat = fixed ? state.categories.find(c => c.id === fixed && !c.planned) : null;
  if (fixed && !cat) { location.hash = '#/'; return; }
  document.title = `${cat ? cat.label : 'Browse'} · Machina`;
  const base = cat ? state.models.filter(m => m.category === cat.id) : state.models;
  const q = (f.q ?? '').toLowerCase();
  const match = (m, skip) => (skip === 'class' || !f.class || `${m.category}:${m.class}` === f.class || (cat && m.class === f.class))
    && (skip === 'era' || !f.era || eraOf(m)?.id === f.era)
    && (skip === 'country' || !f.country || countriesOf(m).includes(f.country))
    && (skip === 'maker' || !f.maker || makerOf(m) === f.maker)
    && (!q || `${m.name} ${classLabel(m)} ${makerOf(m)} ${m.specs.role ?? ''} ${countriesOf(m).join(' ')}`.toLowerCase().includes(q));
  const list = sorted(base.filter(m => match(m)));
  // Each filter offers the values present among machines matching the other filters, with counts.
  const opts = (key, values, label) => {
    const counts = new Map();
    for (const m of base.filter(m => match(m, key))) for (const v of values(m)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [{ value: '', label: `All` }, ...[...counts].sort((a, b) => label(a[0]).localeCompare(label(b[0]))).map(([v, n]) => ({ value: v, label: `${label(v)} (${n})` }))];
  };
  const classValue = m => (cat ? m.class : `${m.category}:${m.class}`);
  const classText = v => { const [c, k] = cat ? [cat.id, v] : v.split(':'); const cc = state.categories.find(x => x.id === c); const kk = cc?.classes?.find(x => x.id === k)?.label ?? k; return cat ? kk : `${cc?.label ?? c}: ${kk}`; };
  const eraText = v => { const e = ERAS.find(x => x.id === v); return e ? `${e.label}, ${e.from}${e.to < 9999 ? `–${e.to}` : '+'}` : v; };
  const pick = (name, prefix, options, value) => pickerHTML({ name, label: `Filter by ${prefix.toLowerCase()}`, prefix, value, options });
  const active = FILTERS.filter(k => f[k]).length + (q ? 1 : 0);
  const groups = cat && !f.class ? (cat.classes ?? []).filter(k => list.some(m => m.class === k.id)) : null;
  $('#page').innerHTML = `
    <div class="blueprint"><div class="page">
      <div class="crumbs"><a href="#/">Catalog</a><span class="sep">/</span><span>${esc(cat ? cat.label : 'Browse')}</span></div>
      <section class="hero browse-hero">
        <div><span class="label">${cat ? 'Category' : 'All machines'}</span><h1>${esc(cat ? cat.label : 'Browse')}</h1><p>${esc(cat ? cat.description : 'Every machine in the catalog, by class, era, country and maker.')}</p></div>
        <div class="stats bracket" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat"><b>${base.length}</b><span>machines</span></div>
          <div class="stat"><b>${new Set(base.map(m => (cat ? '' : m.category) + m.class)).size}</b><span>classes</span></div>
        </div>
      </section>
      <div class="filters">
        ${pick('class', 'Class', opts('class', m => [classValue(m)], classText), f.class)}
        ${pick('era', 'Era', opts('era', m => (eraOf(m) ? [eraOf(m).id] : []), eraText), f.era)}
        ${pick('country', 'Country', opts('country', countriesOf, v => v), f.country)}
        ${pick('maker', 'Maker', opts('maker', m => (makerOf(m) ? [makerOf(m)] : []), v => v), f.maker)}
        <input class="search" id="filter-q" type="search" value="${esc(f.q ?? '')}" placeholder="Search by name, maker or role" aria-label="Search">
        ${active ? `<a class="clear" href="#/${cat ? `c/${esc(cat.id)}` : 'browse'}">Clear ${active > 1 ? `${active} filters` : 'filter'}</a>` : ''}
        <span class="spacer"></span>${sortSelect()}
      </div>
      <p class="result-count label">${list.length} of ${base.length} machines</p>
      ${!list.length ? '<p class="note">No machines match these filters.</p>'
        : groups ? groups.map(k => `<div class="group-title"><span class="label">${esc(k.label)}</span></div>
          <div class="gallery">${list.filter(m => m.class === k.id).map(cardHTML).join('')}</div>`).join('')
        : `<div class="gallery">${list.map(cardHTML).join('')}</div>`}
    </div></div>`;
  hydrateThumbs();
  const go = next => {
    const p = new URLSearchParams();
    for (const k of [...FILTERS, 'q']) if (next[k]) p.set(k, next[k]);
    const path = cat ? `#/c/${cat.id}` : '#/browse';
    history.replaceState(null, '', `${path}${p.size ? `?${p}` : ''}`);
    renderBrowse(next, fixed);
  };
  for (const k of FILTERS) document.querySelector(`[data-pick="${k}"]`)?.addEventListener('pick', e => go({ ...f, [k]: e.detail.value }));
  const input = $('#filter-q');
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { go({ ...f, q: input.value.trim() }); const el = $('#filter-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 250); });
  onSort(() => renderBrowse(f, fixed));
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

/** A category page is Browse with the category fixed. */
function renderCategory(id, filters = {}) { renderBrowse(filters, id); }

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
              <a class="icon-btn" href="#/compare/${esc(m.id)}" title="Compare with other models" aria-label="Compare ${esc(m.name)} with other models">${icon('compare', 16)}</a>
              <a class="icon-btn" href="#/m/${esc(prev.id)}" title="Previous:${esc(prev.name)}" aria-label="Previous model"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></a>
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
    v.setAmbientOcclusion(true); // Compare's overlay turns it off
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
/** One model at its default livery, for Compare. A detailed model that fails to load falls back to its generated build. */
function modelObject(m) {
  if (!m.asset) return Promise.resolve(buildModel(withLivery(m, null)));
  return loadAssetModel(m).then(o => finalize(o, m)).catch(err => {
    if (m.builder === 'asset') throw err;
    console.error(err);
    return buildModel(withLivery(m, null));
  });
}

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
  if (m.asset) {
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
    const value = Array.isArray(v) ? v.join(', ') : unit === 'Mach' ? `Mach ${v}` : `${isYear ? v : num(v)}${unit ? ` ${unit}` : ''}`;
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
    <span class="label">${esc(classLabel(m))} · ${esc(code(m))}</span>
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
// data/catalog.json bundles categories, listed models and thumbnails into one request. The dev
// server builds it on the fly and the deploy hook writes it; any other static server falls back
// to the separate files.
async function loadCatalog() {
  const bundle = await fetch('./data/catalog.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (bundle) return bundle;
  const [categories, collections, index, thumbs] = await Promise.all([
    fetch('./data/categories.json').then(r => r.json()),
    fetch('./data/collections.json').then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('./data/index.json').then(r => r.json()),
    fetch('./data/thumbs.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  const models = await Promise.all(index.models.map(p => fetch(`./data/${p}`).then(r => r.json())));
  return { categories, collections, models, thumbs };
}

async function boot() {
  const { categories, collections = [], models, thumbs } = await loadCatalog();
  state.collections = collections;
  // ?workshop opens unlisted models too, to check them before they are listed.
  if (/[?&]workshop/.test(location.search)) {
    const index = await fetch('./data/index.json').then(r => r.json());
    models.push(...await Promise.all(index.workshop.map(p => fetch(`./data/${p}`).then(r => r.json()))));
  }
  state.categories = categories;
  state.thumbs = thumbs;
  state.models = models;
  // Part counts for the home stats come with the thumbnails; only models without one are built here.
  if (models.some(m => !thumbs[m.id])) await loadEngine();
  for (const m of state.models) m._parts = thumbs[m.id]?.parts ?? partCount(m);
  render();
  // Warm the 3D engine once the thumbnails are in, so opening a model does not wait for it
  // and the download never competes with the catalog.
  const idle = window.requestIdleCallback ?? (f => setTimeout(f, 200));
  const thumbsIn = [...document.querySelectorAll('img[data-thumb]')].filter(i => !i.complete)
    .map(i => new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
  Promise.all(thumbsIn).then(() => idle(() => loadEngine().catch(() => {}), { timeout: 3000 }));
}

boot().catch(err => {
  $('#page').innerHTML = `<div class="page"><h1>Could not load the catalog</h1><p class="note">${esc(err.message)}</p></div>`;
  console.error(err);
});
