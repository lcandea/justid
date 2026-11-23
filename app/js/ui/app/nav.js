// @ts-check
// Step navigation: which step is shown, the step bar and the bottom bar's main button.
import { $, $input, $button } from '../dom.js';
import { t } from '../i18n.js';
import { canAdvance as canLeave, reachableStep, navLabelKey } from '../../core/flow.js';
import { renderSendBlock } from '../request-view.js';
import { state, zonesCanvas, sides, request, CAN_SHARE } from './state.js';
import { drawZones, updateSummary } from './render.js';

/** Can the user move on from step `s` (default: the current one)? @param {number} [s] */
export function canAdvance(s = state.step) {
  return canLeave(s, { hasPhotos: sides().length > 0, purpose: $input('#purpose').value });
}

/** Put the right preview canvases into the current step. */
export function mountPreviews() {
  const s = state.step;
  if (s === 1) {
    if (!state.base[state.pvSide]) state.pvSide = sides()[0] || 'front';
    $('#pv-side').classList.toggle('hidden', sides().length < 2);
    $('#pv-side').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.pvSide));
    $('#pv-hide').replaceChildren(state.canvas[state.pvSide], zonesCanvas);
    requestAnimationFrame(drawZones);
  } else if (s === 2) {
    $('#pv-wm').replaceChildren(state.canvas[sides()[0]]);
  } else if (s === 3) {
    $('#pv-final').replaceChildren(...sides().map(sd => state.canvas[sd]));
    updateSummary();
    if (request) renderSendBlock($('#req-send'), request, $input('#purpose').value.trim());
  }
}

/** @param {number} n @param {boolean} [push] add a history entry (so the phone's back button works) */
export function goStep(n, push = true) {
  n = reachableStep(n, i => canAdvance(i));
  state.step = n;
  document.querySelectorAll('.step').forEach(sec => sec.classList.toggle('hidden', Number(/** @type {HTMLElement} */ (sec).dataset.step) !== n));
  mountPreviews();
  updateNav();
  window.scrollTo(0, 0);
  if (push) history.pushState({ step: n }, '');
  if (n === 2 && !$input('#purpose').value) setTimeout(() => $input('#purpose').focus(), 100);
}

export function updateNav() {
  const s = state.step;
  document.querySelectorAll('#steps li').forEach(li => {
    const i = Number(/** @type {HTMLElement} */ (li).dataset.s);
    li.classList.toggle('cur', i === s);
    if (i === s) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    li.classList.toggle('done', i < s);
    li.classList.toggle('reach', i > s && [...Array(i).keys()].every(k => canAdvance(k)));
  });
  $('#nav-back').classList.toggle('invisible', s === 0);
  const next = $button('#nav-next');
  next.disabled = !canAdvance();
  next.textContent = t(navLabelKey(s, canAdvance(), CAN_SHARE));
}

/** Wire the step bar and the Back button. */
export function initNav() {
  $('#nav-back').addEventListener('click', () => history.back());
  $('#steps').addEventListener('click', e => {
    const li = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('li.done, li.reach'));
    if (li) goStep(Number(li.dataset.s));
  });
  window.addEventListener('resize', () => requestAnimationFrame(drawZones));
}
