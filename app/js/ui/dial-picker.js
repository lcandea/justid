// @ts-check
// Country calling-code picker for the request builder: flag + "+34" button that opens a searchable
// list (by country name in the UI language, by ISO code, or by dial prefix).
// Accessibility: the search box is an ARIA combobox driving a listbox (arrow keys, Enter, Escape),
// and the button says which country is selected. No dependencies; names come from Intl.DisplayNames.
// The pure part (country list, search, flags) is core/countries.js.
import { countryList, filterCountries, flagEmoji } from '../core/countries.js';
import { el } from './dom.js';

/** @typedef {import('../core/countries.js').Country} Country */

/**
 * The picker. Markup lives in the page (see app/request.html): a button, and a popup holding a
 * search input and a listbox.
 */
export class DialPicker {
  /**
   * @param {{ button: HTMLButtonElement, pop: HTMLElement, search: HTMLInputElement, list: HTMLElement, empty: HTMLElement, closeBtn?: HTMLButtonElement | null }} els
   * @param {{ initial: string, lang: () => string, buttonLabel: (c: Country) => string, onChange: (c: Country) => void }} opts
   */
  constructor(els, opts) {
    this.els = els; this.opts = opts;
    /** @type {Country[]} */ this.all = countryList(opts.lang());
    /** @type {Country[]} */ this.shown = this.all;
    this.active = 0;
    /** @type {Country} */ this.selected = this.all.find(c => c.iso === opts.initial) || this.all[0];
    this.renderButton();
    // Phones get a full-screen sheet: a popup next to the field ends up under the keyboard.
    this.sheetQuery = window.matchMedia('(max-width: 600px), (pointer: coarse)');
    this.syncViewport = () => {
      const vv = window.visualViewport; if (!vv) return;
      els.pop.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      els.pop.style.setProperty('--vv-h', `${vv.height}px`);
    };
    els.closeBtn?.addEventListener('click', () => this.close(true));

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
    const sheet = this.sheetQuery.matches;
    this.els.pop.classList.toggle('sheet', sheet);
    if (sheet) {
      document.documentElement.classList.add('dial-lock');
      this.syncViewport();
      window.visualViewport?.addEventListener('resize', this.syncViewport);
      window.visualViewport?.addEventListener('scroll', this.syncViewport);
    }
    this.els.pop.classList.remove('hidden');
    this.els.button.setAttribute('aria-expanded', 'true');
    this.els.search.value = '';
    this.shown = this.all;
    this.active = Math.max(0, this.all.indexOf(this.selected));
    this.renderList();
    // Desktop: the list opens upwards; keep the whole popup on screen, then focus without a second scroll.
    if (!sheet) this.els.pop.scrollIntoView({ block: 'nearest' });
    this.els.search.focus({ preventScroll: true });
  }

  /** @param {boolean} focusButton */
  close(focusButton) {
    this.els.pop.classList.add('hidden');
    document.documentElement.classList.remove('dial-lock');
    window.visualViewport?.removeEventListener('resize', this.syncViewport);
    window.visualViewport?.removeEventListener('scroll', this.syncViewport);
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
