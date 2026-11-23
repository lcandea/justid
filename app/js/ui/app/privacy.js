// @ts-check
// The privacy badge and its dialog.
import { $ } from '../dom.js';
import { REPO_URL } from './state.js';

export function initPrivacy() {
  const dlg = /** @type {HTMLDialogElement} */ ($('#privacy')), btn = $('#lock-btn');
  const link = /** @type {HTMLAnchorElement} */ ($('#privacy-repo'));
  link.href = REPO_URL;
  btn.addEventListener('click', () => {
    btn.classList.remove('wiggle'); // they found it: stop drawing attention to it
    dlg.showModal();
  });
  $('#privacy-close').addEventListener('click', () => dlg.close());
  // close when tapping the backdrop (the click lands on the <dialog> element itself)
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  btn.classList.add('wiggle');
}
