// @ts-check
// Our own confirm() and prompt(): themed modal dialogs that resolve a Promise. The browser's native
// ones can't be styled and look out of place. Each call builds a fresh <dialog> and removes it when closed.
// Escape or a tap outside counts as "cancel". No <form>: the CSP's form-action 'none' covers forms, and
// Enter is handled directly.
import { el, openModal } from './dom.js';
import { t } from './i18n.js';

/**
 * Build the dialog shell, open it and settle with `value()` on OK or `cancelled` otherwise.
 * @template T
 * @param {{ title: string, body?: string, ok: string, cancel?: string, danger?: boolean,
 *           extra?: HTMLElement, value: () => T, cancelled: T }} o
 * @returns {Promise<T>}
 */
function ask({ title, body, ok, cancel = t('dialog.cancel'), danger = false, extra, value, cancelled }) {
  const okBtn = el('button', { type: 'button', class: 'btn btn-md btn-block ' + (danger ? 'btn-danger' : 'btn-primary') }, ok);
  const cancelBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-md btn-block' }, cancel);
  const titleEl = el('h2', { class: 'display' }, title);
  const dlg = /** @type {HTMLDialogElement} */ (el('dialog', { class: 'dlg ask' },
    titleEl, body ? el('p', {}, body) : null, extra || null,
    el('div', { class: 'ask-actions' }, okBtn, cancelBtn)));
  titleEl.id = 'ask-title-' + Math.random().toString(36).slice(2);
  dlg.setAttribute('aria-labelledby', titleEl.id);
  document.body.append(dlg);
  return new Promise(resolve => {
    let result = cancelled;
    okBtn.addEventListener('click', () => { result = value(); dlg.close(); });
    cancelBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // tap on the backdrop
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    openModal(dlg);
  });
}

/**
 * Yes/no question. Resolves true only when the OK button is pressed.
 * @param {{ title: string, body?: string, ok: string, cancel?: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function askConfirm(o) {
  return ask({ ...o, value: () => true, cancelled: false });
}

/**
 * Ask for a short text. Resolves with the trimmed text, or null when cancelled or left empty.
 * The field starts filled with `value` (selected, so typing replaces it) but is not focused,
 * so phones don't pop the keyboard up before the user decides to type.
 * @param {{ title: string, label: string, value?: string, ok: string, cancel?: string }} o
 * @returns {Promise<string | null>}
 */
export function askText({ label, value = '', ...o }) {
  const input = /** @type {HTMLInputElement} */ (el('input', { type: 'text', value, maxlength: '60', autocomplete: 'off' }));
  const field = el('label', { class: 'ask-field' }, el('span', { class: 'label' }, label), input);
  const p = ask({ ...o, extra: field, value: () => input.value.trim() || null, cancelled: null });
  input.addEventListener('focus', () => input.select(), { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); /** @type {HTMLButtonElement} */ (input.closest('dialog')?.querySelector('.ask-actions .btn')).click(); }
  });
  return p;
}
