// @ts-check
// The document-version picker (and what it shows: name, reference pictures), importing a custom
// template, and the request summary panel that depends on the chosen template.
import { $, $select, el } from '../dom.js';
import { t } from '../i18n.js';
import { allTemplates, templateName, normalizeCustom, saveCustomTemplate } from '../templates.js';
import { openZoom } from '../zoom-viewer.js';
import { assetUrl } from '../../core/templates.js';
import { initialHidden, requestNeedsBack, SIDE_LIST } from '../../core/flow.js';
import { renderRequestPanel } from '../request-view.js';
import { state, sideName, request, requestResult, reqCtx } from './state.js';
import { renderAll } from './render.js';
import { renderSlot } from './photos.js';
import { renderFields, setHidden } from './hide.js';

/** @typedef {import('../../core/templates.js').ResolvedTemplate} ResolvedTemplate */

/** @param {string} [selectId] */
export function fillTemplateSelect(selectId) {
  // A request is for one document family: only offer its versions.
  state.templates = allTemplates().filter(x => !request || x.family === request.doc);
  fillOptions();
  const sel = $select('#tpl');
  if (selectId) sel.value = selectId;
  setTemplate(state.templates.find(x => x.id === sel.value) || state.templates[0]);
}

function fillOptions() {
  $('#tpl').replaceChildren(...state.templates.map(x => el('option', { value: x.id }, templateName(x))));
}

/** @param {ResolvedTemplate} tpl @param {{ auto?: boolean }} [opts] */
export function setTemplate(tpl, { auto = false } = {}) {
  state.template = tpl;
  state.tplAuto = auto;
  state.hidden = initialHidden(tpl, reqCtx, state.accepted);
  renderTemplateInfo();
  renderRequest();
  renderSlot('front'); renderSlot('back'); // empty slots show the template's sample as a hint
  renderFields(); renderAll();
}

export function renderTemplateInfo() {
  const tpl = state.template;
  $('#tpl-name').textContent = templateName(tpl);
  $('#tpl-auto').classList.toggle('hidden', !state.tplAuto);
  $('#tpl-note').textContent = /draft|borrador/i.test(tpl.id + (tpl.name || '')) ? t('tpl.draft_note') : '';
  // reference pictures (normalised, transparent corners)
  const items = SIDE_LIST.filter(s => tpl.sample?.[s]).map(s => {
    const src = assetUrl(/** @type {string} */ (tpl.sample?.[s])), alt = `${templateName(tpl)} — ${sideName(s)}`;
    // tap to open full-screen with pinch-to-zoom
    const open = el('button', { type: 'button', class: 'tpl-pv-open', 'aria-label': t('zoom.open', { name: alt }) },
      el('img', { src, alt, loading: 'lazy', decoding: 'async' }));
    open.addEventListener('click', () => openZoom(src, alt));
    return el('figure', {}, open, el('figcaption', {}, sideName(s)));
  });
  $('#tpl-pv').replaceChildren(...items);
  $('#tpl-pv').classList.toggle('hidden', !items.length);
  $('#tpl-pv-hint').classList.toggle('hidden', !items.length);
}

export function renderRequest() {
  $('#req-invalid').classList.toggle('hidden', !requestResult || requestResult.ok);
  $('#req-cta').classList.toggle('hidden', !!request);
  // The photo tip says the back is optional, unless the request asks for it.
  $('#photos-tip').textContent = t(requestNeedsBack(state.template, reqCtx) ? 'photos.tip_back_requested' : 'photos.tip');
  if (!request) return;
  const present = new Set(state.template.fields.map(f => f.id));
  renderRequestPanel($('#req-panel'), {
    request, extras: [...reqCtx.extras].filter(id => present.has(id)), backNeeded: requestNeedsBack(state.template, reqCtx),
    isShown: id => !state.hidden.has(id),
    onAccept: (id, ok) => setHidden(id, !ok),
  });
}

/** After a language change: option names, picture captions, texts. */
export function refreshTemplateText() {
  const selected = state.template.id;
  fillOptions();
  $select('#tpl').value = selected;
  renderTemplateInfo(); renderRequest();
}

/** @param {{ onManualPick: () => void }} o called after the user picks a version by hand */
export function initTemplate({ onManualPick }) {
  $('#tpl').addEventListener('change', e => {
    state.tplManual = true; // a manual choice is never auto-switched, but a mismatch is still flagged
    const id = /** @type {HTMLSelectElement} */ (e.target).value;
    setTemplate(/** @type {ResolvedTemplate} */ (state.templates.find(x => x.id === id)));
    onManualPick();
  });
  $('#tpl-file').addEventListener('change', async e => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const f = input.files?.[0]; input.value = '';
    if (!f) return;
    try {
      const tpl = normalizeCustom(JSON.parse(await f.text()));
      saveCustomTemplate(tpl); state.tplManual = true; fillTemplateSelect(tpl.id);
    } catch (err) { $('#tpl-note').textContent = t('tpl.import_error', { msg: /** @type {Error} */ (err).message }); }
  });
}
