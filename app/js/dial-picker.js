// @ts-check
// Country calling-code picker for the request builder: flag + "+34" button that opens a searchable
// list (by country name in the UI language, by ISO code, or by dial prefix).
// Accessibility: the search box is an ARIA combobox driving a listbox (arrow keys, Enter, Escape),
// and the button says which country is selected. No dependencies; names come from Intl.DisplayNames.
// The helpers at the top are pure, so the unit tests can run them in Node.
import DIAL_CODES from './dial-codes.js';
import { el } from './dom.js';

/** @typedef {{ iso: string, dial: string, name: string }} Country */

/** Flag emoji from a two-letter region code (regional indicator symbols). @param {string} iso */
export const flagEmoji = iso => String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));

/** Lower-case, accents removed: "Perú" matches "peru". @param {string} s */
export const foldText = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Every country with its name in `lang`, sorted by that name.
 * @param {string} lang @returns {Country[]}
 */
export function countryList(lang) {
  /** @type {Intl.DisplayNames | null} */
  let names = null;
  try { names = new Intl.DisplayNames([lang], { type: 'region' }); } catch { /* old browser: use the codes */ }
  const list = DIAL_CODES.map(([iso, dial]) => ({ iso, dial, name: names?.of(iso) || iso }));
  const collator = new Intl.Collator(lang);
  return list.sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Countries matching a search: digits (with or without + / 00) match the start of the dial code,
 * exact codes first; text matches any part of the name, or the ISO code. Empty query: everything.
 * @param {Country[]} list @param {string} query @returns {Country[]}
 */
export function filterCountries(list, query) {
  const q = query.trim();
  if (!q) return list;
  if (/^(\+|00)?\d+$/.test(q.replace(/\s/g, ''))) {
    const digits = q.replace(/\s/g, '').replace(/^(\+|00)/, '');
    const hits = list.filter(c => c.dial.startsWith(digits));
    return [...hits.filter(c => c.dial === digits), ...hits.filter(c => c.dial !== digits)];
  }
  const f = foldText(q);
  const byName = list.filter(c => foldText(c.name).includes(f));
  const startsFirst = [...byName.filter(c => foldText(c.name).startsWith(f)), ...byName.filter(c => !foldText(c.name).startsWith(f))];
  const iso = q.length === 2 ? list.filter(c => c.iso === q.toUpperCase() && !byName.includes(c)) : [];
  return [...iso, ...startsFirst];
}

/**
 * The picker. Markup lives in the page (see app/request.html): a button, and a popup holding a
 * search input and a listbox.
 */
export class DialPicker {
  /**
   * @param {{ button: HTMLButtonElement, pop: HTMLElement, search: HTMLInputElement, list: HTMLElement, empty: HTMLElement }} els
   * @param {{ initial: string, lang: () => string, buttonLabel: (c: Country) => string, onChange: (c: Country) => void }} opts
   */
  constructor(els, opts) {
    this.els = els; this.opts = opts;
    /** @type {Country[]} */ this.all = countryList(opts.lang());
    /** @type {Country[]} */ this.shown = this.all;
    this.active = 0;
    /** @type {Country} */ this.selected = this.all.find(c => c.iso === opts.initial) || this.all[0];
    this.renderButton();

    els.button.addEventListener('click', () => (this.isOpen() ? this.close(true) : this.open()));
    els.button.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); this.open(); } });
    els.search.addEventListener('input', () => { this.active = 0; this.renderList(); });
    els.search.addEventListener('keydown', e => this.onKey(e));
    // pointerdown + preventDefault keeps focus in the search box while picking with mouse or touch
    els.list.addEventListener('pointerdown', e => e.preventDefault());
    els.list.addEventListener('click', e => {
      const li = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[role=option]'));
      if (li) this.pick(Number(li.dataset.i));
    });
    document.addEventListener('pointerdown', e => {
      const target = /** @type {Node} */ (e.target);
      if (this.isOpen() && !els.pop.contains(target) && !els.button.contains(target)) this.close(false);
    });
    els.pop.addEventListener('focusout', e => {
      const next = /** @type {Node | null} */ (e.relatedTarget);
      if (next && !els.pop.contains(next) && next !== els.button) this.close(false);
    });
  }

  /** Dial code of the selected country (digits). */
  get dial() { return this.selected.dial; }

  /** Rebuild names in the current language (call on language change). */
  refresh() {
    const iso = this.selected.iso;
    this.all = countryList(this.opts.lang());
    this.selected = this.all.find(c => c.iso === iso) || this.all[0];
    this.renderButton();
    if (this.isOpen()) this.renderList();
  }

  isOpen() { return !this.els.pop.classList.contains('hidden'); }

  open() {
    this.els.pop.classList.remove('hidden');
    this.els.button.setAttribute('aria-expanded', 'true');
    this.els.search.value = '';
    this.shown = this.all;
    this.active = Math.max(0, this.all.indexOf(this.selected));
    this.renderList();
    this.els.search.focus();
  }

  /** @param {boolean} focusButton */
  close(focusButton) {
    this.els.pop.classList.add('hidden');
    this.els.button.setAttribute('aria-expanded', 'false');
    this.els.search.removeAttribute('aria-activedescendant');
    if (focusButton) this.els.button.focus();
  }

  /** @param {number} i index in the shown list */
  pick(i) {
    const c = this.shown[i]; if (!c) return;
    this.selected = c;
    this.renderButton();
    this.close(true);
    this.opts.onChange(c);
  }

  /** @param {KeyboardEvent} e */
  onKey(e) {
    const n = this.shown.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) { this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; this.highlight(); }
    } else if (e.key === 'Home' || e.key === 'End') {
      if (n) { e.preventDefault(); this.active = e.key === 'Home' ? 0 : n - 1; this.highlight(); }
    } else if (e.key === 'Enter') {
      e.preventDefault(); this.pick(this.active);
    } else if (e.key === 'Escape') {
      e.preventDefault(); this.close(true);
    }
  }

  renderButton() {
    const c = this.selected;
    this.els.button.replaceChildren(el('span', { class: 'dial-flag', 'aria-hidden': 'true' }, flagEmoji(c.iso)), ` +${c.dial}`);
    this.els.button.setAttribute('aria-label', this.opts.buttonLabel(c));
  }

  renderList() {
    this.shown = filterCountries(this.all, this.els.search.value);
    if (this.active >= this.shown.length) this.active = 0;
    const id = this.els.list.id;
    this.els.list.replaceChildren(...this.shown.map((c, i) => el('li', {
      role: 'option', id: `${id}-${c.iso}`, 'data-i': String(i), 'data-iso': c.iso, 'aria-selected': String(c === this.selected),
    }, el('span', { class: 'dial-flag', 'aria-hidden': 'true' }, flagEmoji(c.iso)), el('span', { class: 'dial-name' }, c.name), el('span', { class: 'dial-code' }, `+${c.dial}`))));
    this.els.empty.classList.toggle('hidden', this.shown.length > 0);
    this.highlight();
  }

  /** Mark the active option for assistive tech and keep it in view. */
  highlight() {
    const items = this.els.list.children;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', i === this.active);
    const cur = /** @type {HTMLElement | undefined} */ (items[this.active]);
    if (cur) { this.els.search.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    else this.els.search.removeAttribute('aria-activedescendant');
  }
}
