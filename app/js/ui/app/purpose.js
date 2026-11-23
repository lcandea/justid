// @ts-check
// Step 3: the purpose (with quick-pick chips) and the recipient, which become the watermark.
import { $, $input, el } from '../dom.js';
import { t } from '../i18n.js';
import { PURPOSE_CHIPS } from '../../core/purposes.js';
import { renderAll } from './render.js';
import { canAdvance, goStep, updateNav } from './nav.js';

export function renderChips() {
  const current = $input('#purpose').value.trim();
  $('#chips').replaceChildren(...PURPOSE_CHIPS.map(key => {
    const text = t('purpose.chip.' + key);
    const b = el('button', { type: 'button', class: text === current ? 'on' : '' }, text);
    b.addEventListener('click', () => { $input('#purpose').value = text; $input('#purpose').dispatchEvent(new Event('input')); });
    return b;
  }));
}

export function initPurpose() {
  $('#purpose').addEventListener('input', () => {
    const v = $input('#purpose').value.trim();
    $('#chips').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === v));
    renderAll(); updateNav();
  });
  $('#purpose').addEventListener('keydown', e => { if (e.key === 'Enter') $input('#recipient').focus(); });
  $('#recipient').addEventListener('input', renderAll);
  $('#recipient').addEventListener('keydown', e => { if (e.key === 'Enter') { $input('#recipient').blur(); if (canAdvance()) goStep(3); } });
}
