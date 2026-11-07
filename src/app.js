// Catalog UI: category tabs, model list, specs panel and part details.
import './builders/index.js';
import { buildModel } from './registry.js';
import { createViewer } from './scene.js';
import { SYSTEMS } from './parts/common.js';

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

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (typeof v === 'number' ? v.toLocaleString('en-US') : v);

const state = { categories: [], models: [], category: null, model: null, part: null, query: '' };
const viewer = createViewer($('#canvas'));

async function load() {
  const [categories, index] = await Promise.all([
    fetch('./data/categories.json').then(r => r.json()),
    fetch('./data/index.json').then(r => r.json()),
  ]);
  state.categories = categories;
  state.models = await Promise.all(index.models.map(p => fetch(`./data/${p}`).then(r => r.json())));
  const fromHash = parseHash();
  const initial = state.models.find(m => m.id === fromHash.model) ?? state.models[0];
  state.category = initial.category;
  renderTabs();
  renderList();
  openModel(initial.id, fromHash.part);
}

function parseHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { model: p.get('model'), part: p.get('part') };
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.model) p.set('model', state.model.id);
  if (state.part) p.set('part', state.part);
  history.replaceState(null, '', `#${p}`);
}

function renderTabs() {
  $('#tabs').innerHTML = state.categories.map(c =>
    `<button type="button" data-cat="${esc(c.id)}" aria-pressed="${c.id === state.category}" title="${esc(c.description ?? '')}">${esc(c.label)}</button>`,
  ).join('');
}

function renderList() {
  const q = state.query.toLowerCase();
  const models = state.models.filter(m => m.category === state.category
    && (!q || `${m.name} ${m.group} ${m.specs.manufacturer ?? ''}`.toLowerCase().includes(q)));
  const groups = new Map();
  for (const m of models) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group).push(m);
  }
  $('#list').innerHTML = [...groups].map(([g, ms]) => `
    <div class="group">${esc(g)}</div>
    ${ms.map(m => {
      const w = m.specs.wingspan_m ?? m.specs.rotor_diameter_m ?? m.specs.width_m;
      return `<button type="button" class="item" data-model="${esc(m.id)}" aria-current="${m.id === state.model?.id}">
        ${esc(m.name)}<small>${m.specs.length_m} m × ${w} m</small></button>`;
    }).join('')}
  `).join('') || '<p class="note">No models match.</p>';
}

function openModel(id, partId = null) {
  const m = state.models.find(x => x.id === id);
  if (!m) return;
  state.model = m;
  state.part = null;
  viewer.setModel(buildModel(m));
  viewer.setExplode(Number($('#explode').value));
  renderList();
  if (partId) viewer.select(partId); else renderModelPanel();
  writeHash();
}

function renderModelPanel() {
  const m = state.model;
  const specs = Object.entries(m.specs).filter(([k]) => SPEC_LABELS[k]).map(([k, v]) => {
    const l = SPEC_LABELS[k];
    const [label, unit] = Array.isArray(l) ? l : [l, ''];
    const isYear = k === 'first_flight' || k === 'in_service';
    const value = unit === 'Mach' ? `Mach ${v}` : `${isYear ? v : num(v)}${unit ? ` ${unit}` : ''}`;
    return `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
  }).join('');
  const parts = viewer.listParts();
  const bySystem = new Map();
  for (const p of parts) {
    if (!bySystem.has(p.system)) bySystem.set(p.system, []);
    bySystem.get(p.system).push(p);
  }
  $('#panel').innerHTML = `
    <h1>${esc(m.name)}</h1>
    <p class="sub">${esc(m.summary ?? '')}</p>
    <h2>Specifications</h2>
    <dl class="kv">${specs}</dl>
    <h2>Parts (${parts.length})</h2>
    ${[...bySystem].map(([sys, ps]) => `
      <div class="system" style="margin:10px 0 6px"><span class="dot" style="background:${SYSTEMS[sys]?.color ?? '#999'}"></span>${esc(SYSTEMS[sys]?.label ?? sys)}</div>
      <div class="chips">${ps.map(p => `<button type="button" class="chip" data-part="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div>
    `).join('')}
    <h2>Sources</h2>
    <div class="sources">${(m.sources ?? []).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)}</a>`).join('')}</div>
    <p class="note">Overall dimensions follow the published specs. Shapes are simplified and part details are approximate.</p>
  `;
}

function renderPartPanel(p) {
  const size = viewer.partSize(p.id);
  const info = Object.entries(p.info ?? {}).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(num(v))}</dd>`).join('');
  const sys = SYSTEMS[p.system];
  $('#panel').innerHTML = `
    <button type="button" class="back" id="back">← ${esc(state.model.name)}</button>
    <h1>${esc(p.label)}</h1>
    <div class="system"><span class="dot" style="background:${sys?.color ?? '#999'}"></span>${esc(sys?.label ?? p.system)}</div>
    ${info ? `<h2>Details</h2><dl class="kv">${info}</dl>` : ''}
    ${size ? `<h2>Measured in the model</h2><dl class="kv">
      <dt>Length</dt><dd>${size.x.toFixed(2)} m</dd>
      <dt>Width</dt><dd>${size.z.toFixed(2)} m</dd>
      <dt>Height</dt><dd>${size.y.toFixed(2)} m</dd></dl>` : ''}
  `;
}

viewer.on('select', p => {
  state.part = p?.id ?? null;
  if (p) renderPartPanel(p); else renderModelPanel();
  writeHash();
});

viewer.on('hover', (p, ev) => {
  const tip = $('#tip');
  if (!p || !ev) { tip.hidden = true; return; }
  const r = $('#canvas').getBoundingClientRect();
  tip.textContent = p.label;
  tip.style.left = `${ev.clientX - r.left}px`;
  tip.style.top = `${ev.clientY - r.top}px`;
  tip.hidden = false;
});

document.addEventListener('click', ev => {
  const t = ev.target.closest('[data-cat],[data-model],[data-part],#back');
  if (!t) return;
  if (t.dataset.cat) {
    state.category = t.dataset.cat;
    renderTabs();
    renderList();
    const first = state.models.find(m => m.category === state.category);
    if (first && state.model?.category !== state.category) openModel(first.id);
  } else if (t.dataset.model) openModel(t.dataset.model);
  else if (t.dataset.part) viewer.select(t.dataset.part);
  else if (t.id === 'back') viewer.select(null);
});

$('#search').addEventListener('input', ev => { state.query = ev.target.value; renderList(); });
$('#explode').addEventListener('input', ev => viewer.setExplode(Number(ev.target.value)));
$('#person').addEventListener('change', ev => viewer.setPerson(ev.target.checked));
$('#reset').addEventListener('click', () => viewer.resetView());

load().catch(err => {
  $('#panel').innerHTML = `<h1>Could not load the catalog</h1><p class="sub">${esc(err.message)}</p>`;
  console.error(err);
});
