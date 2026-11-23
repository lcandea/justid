// @ts-check
// Step 2: the list of fields with their switches, and tapping zones on the preview.
import { $, el } from '../dom.js';
import { t } from '../i18n.js';
import { fieldLabel } from '../templates.js';
import { syncRequestPanel } from '../request-view.js';
import { SIDE_LIST, fieldsBySide, fieldAtPoint } from '../../core/flow.js';
import { state, sideName, request, reqCtx } from './state.js';
import { renderAll } from './render.js';

export function renderFields() {
  const groups = fieldsBySide(state.template);
  const box = $('#fields'); box.replaceChildren();
  for (const side of SIDE_LIST) {
    if (!groups[side].length) continue;
    box.append(el('h3', {}, sideName(side)));
    for (const f of groups[side]) {
      const label = fieldLabel(f);
      const cb = el('input', { type: 'checkbox', checked: state.hidden.has(f.id), 'aria-label': t('hide.aria', { field: label }) });
      cb.addEventListener('change', () => setHidden(f.id, cb.checked));
      const also = f.zones.some(z => z.side !== side) ? t(side === 'front' ? 'hide.also_on_back' : 'hide.also_on_front') : '';
      const extra = request && reqCtx.extras.has(f.id) ? t('hide.requested_extra', { name: request.from }) : '';
      const row = el('label', { class: 'fld' + (extra ? ' req-extra' : ''), 'data-f': f.id },
        el('span', { class: 'nm' }, label,
          el('small', { class: f.hide ? '' : 'ok' }, t(f.hide ? 'hide.recommended' : 'hide.usually_shown') + also + extra)),
        el('span', { class: 'switch' }, cb, el('i')));
      box.append(row);
    }
  }
}

/** @param {string} id @param {boolean} on */
export function setHidden(id, on) {
  on ? state.hidden.add(id) : state.hidden.delete(id);
  if (reqCtx.extras.has(id)) {
    on ? state.accepted.delete(id) : state.accepted.add(id); // showing an extra field = accepting it
    syncRequestPanel($('#req-panel'), x => !state.hidden.has(x));
  }
  const cb = /** @type {HTMLInputElement | null} */ (document.querySelector(`.fld[data-f="${id}"] input`));
  if (cb) cb.checked = on;
  renderAll();
}

export function initHide() {
  // Tap on the preview toggles the smallest zone under the finger.
  $('#pv-hide').addEventListener('click', e => {
    const cv = state.canvas[state.pvSide], r = cv.getBoundingClientRect();
    const best = fieldAtPoint(state.template, state.pvSide, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (!best) return;
    setHidden(best.id, !state.hidden.has(best.id));
    navigator.vibrate?.(10);
    const row = document.querySelector(`.fld[data-f="${best.id}"]`);
    if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 700); }
  });
}
