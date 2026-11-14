// Machina's dropdown: a button that opens a styled list, in place of the browser's <select>.
// Pages render it as an HTML string; one delegated handler runs every picker on the page.
// Choosing an option fires a bubbling "pick" event on the .pick element with { value } as detail.
//
// Keyboard: Enter, Space or the arrow keys open it; arrows, Home and End move; Enter or Space
// choose; Escape closes and returns focus to the button; Tab closes.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHEVRON = '<svg class="pick-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let uid = 0;

/**
 * @param {object} o
 * @param {string} o.name identifies the picker in "pick" events (data-pick)
 * @param {{ value: string, label: string, group?: string, hint?: string }[]} o.options
 * @param {string} [o.value] the chosen value; none shows the placeholder
 * @param {string} [o.prefix] short label inside the button, before the value ("Sort")
 * @param {string} [o.placeholder] button text when nothing is chosen
 * @param {string} o.label accessible name
 * @param {boolean} [o.disabled]
 * @param {boolean} [o.action] an action menu: the button keeps its placeholder after a choice
 * @param {'start'|'end'} [o.align] which edge of the button the list lines up with
 */
export function pickerHTML(o) {
  const id = `pick-${++uid}`;
  const cur = o.options.find(x => x.value === o.value);
  const shown = o.action || !cur ? o.placeholder ?? '' : cur.label;
  let group = null;
  const items = o.options.map(x => {
    const head = x.group && x.group !== group ? `<li class="pick-group" role="presentation">${esc((group = x.group))}</li>` : '';
    return `${head}<li role="option" id="${id}-${esc(x.value)}" data-value="${esc(x.value)}" tabindex="-1" aria-selected="${!o.action && x.value === o.value}">${esc(x.label)}${x.hint ? `<span class="pick-hint">${esc(x.hint)}</span>` : ''}</li>`;
  }).join('');
  return `<div class="pick${o.action ? ' pick-action' : ''}" data-pick="${esc(o.name)}" data-value="${esc(o.value ?? '')}">
    <button type="button" class="pick-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}" aria-label="${esc(o.label)}"${o.disabled ? ' disabled' : ''}>
      ${o.prefix ? `<span class="pick-pre">${esc(o.prefix)}</span>` : ''}<span class="pick-val">${esc(shown)}</span>${CHEVRON}
    </button>
    <ul class="pick-list${o.align === 'end' ? ' pick-end' : ''}" id="${id}" role="listbox" aria-label="${esc(o.label)}" hidden>${items}</ul>
  </div>`;
}

const options = pick => [...pick.querySelectorAll('[role="option"]')];

function open(pick) {
  closeAll(pick);
  const list = pick.querySelector('.pick-list');
  list.hidden = false;
  pick.querySelector('.pick-btn').setAttribute('aria-expanded', 'true');
  pick.classList.add('open');
  // Open upward when there is no room below.
  const r = pick.getBoundingClientRect();
  list.classList.toggle('pick-up', innerHeight - r.bottom < Math.min(list.scrollHeight, 320) + 12 && r.top > innerHeight - r.bottom);
  const sel = options(pick).find(x => x.getAttribute('aria-selected') === 'true') ?? options(pick)[0];
  sel?.focus({ preventScroll: true });
  sel?.scrollIntoView({ block: 'nearest' });
}

function close(pick, focusButton = false) {
  pick.querySelector('.pick-list').hidden = true;
  pick.querySelector('.pick-btn').setAttribute('aria-expanded', 'false');
  pick.classList.remove('open');
  if (focusButton) pick.querySelector('.pick-btn').focus();
}

function closeAll(except) {
  for (const p of document.querySelectorAll('.pick.open')) if (p !== except) close(p);
}

function choose(pick, opt) {
  const value = opt.dataset.value;
  if (!pick.classList.contains('pick-action')) {
    pick.dataset.value = value;
    for (const x of options(pick)) x.setAttribute('aria-selected', String(x === opt));
    pick.querySelector('.pick-val').textContent = opt.firstChild.textContent;
  }
  close(pick, true);
  pick.dispatchEvent(new CustomEvent('pick', { bubbles: true, detail: { value, name: pick.dataset.pick } }));
}

let installed = false;
/** Install the shared handlers once. */
export function installPickers() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest('.pick-btn');
    if (btn) {
      const pick = btn.closest('.pick');
      if (pick.classList.contains('open')) close(pick); else open(pick);
      return;
    }
    const opt = e.target.closest('.pick [role="option"]');
    if (opt) { choose(opt.closest('.pick'), opt); return; }
    closeAll();
  });
  document.addEventListener('keydown', e => {
    const pick = e.target.closest?.('.pick');
    if (!pick) return;
    const isBtn = e.target.classList.contains('pick-btn');
    if (isBtn) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(pick); }
      return;
    }
    const list = options(pick);
    const i = list.indexOf(e.target);
    const move = j => { e.preventDefault(); list[(j + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(pick, list[i]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(pick, true); }
    else if (e.key === 'Tab') close(pick);
  });
}
