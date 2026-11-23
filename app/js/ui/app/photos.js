// @ts-check
// Step 1: the two photo slots and the full-screen framing (crop) overlay.
import { $, el, ICONS, icon } from '../dom.js';
import { t } from '../i18n.js';
import { loadImageFile } from '../image-file.js';
import { warpToCard } from '../../core/image.js';
import { assetUrl } from '../../core/templates.js';
import { requestNeedsBack } from '../../core/flow.js';
import { CropEditor } from '../crop-editor.js';
import { state, sides, sideName, request, reqCtx, handlers } from './state.js';
import { renderAll } from './render.js';
import { updateNav } from './nav.js';

/** @typedef {import('../../core/templates.js').Side} Side */

/** Framing overlay state. */
export const crop = {
  /** @type {Side} */ side: 'front',
  /** @type {CropEditor | null} */ editor: null,
  /** corners used last time, per side (for "Adjust") @type {Partial<Record<Side, number[][]>>} */ lastQuad: {},
};

/** Swap the remembered framing of the two slots (when the photos are swapped). */
export function swapFraming() {
  [crop.lastQuad.front, crop.lastQuad.back] = [crop.lastQuad.back, crop.lastQuad.front];
  for (const s of /** @type {Side[]} */ (['front', 'back'])) if (crop.lastQuad[s] === undefined) delete crop.lastQuad[s];
}

/** @param {boolean} capture open the camera directly @param {(f: File) => void} onFile */
function fileInput(capture, onFile) {
  const i = el('input', { type: 'file', accept: 'image/*', capture: capture ? 'environment' : false });
  i.addEventListener('change', () => { const f = i.files[0]; i.value = ''; if (f) onFile(f); });
  return i;
}

/** @param {Side} side @param {File} file */
async function takeFile(side, file) {
  $('#photo-status').textContent = '';
  try { state.src[side] = await loadImageFile(file, t('photos.read_error')); }
  catch (e) { $('#photo-status').textContent = /** @type {Error} */ (e).message; return; }
  delete crop.lastQuad[side]; // a new photo needs fresh detection, not the previous corners
  openCrop(side);
}

/** @param {Side} side */
export function renderSlot(side) {
  const box = $('#slot-' + side), base = state.base[side];
  if (!base) {
    const sample = state.template?.sample?.[side];
    const needsBack = requestNeedsBack(state.template, reqCtx);
    box.replaceChildren(
      el('label', { class: 'empty' + (sample ? ' has-sample' : '') },
        sample ? el('img', { class: 'ghost', src: assetUrl(sample), alt: '', 'aria-hidden': 'true', decoding: 'async' }) : null,
        icon(ICONS.camera), el('strong', {}, sideName(side)),
        el('span', { class: side === 'back' && needsBack ? 'req-asked' : '' }, side === 'front' ? t('photos.tap_front')
          : needsBack ? t('photos.tap_back_requested', { name: /** @type {any} */ (request).from }) : t('photos.tap_back')),
        fileInput(true, f => takeFile(side, f))),
      el('label', { class: 'gal' }, t('photos.gallery'), fileInput(false, f => takeFile(side, f))));
    return;
  }
  base.classList.add('thumb');
  const adjust = el('button', { type: 'button' }, t('photos.adjust')); adjust.addEventListener('click', () => openCrop(side));
  const remove = el('button', { type: 'button' }, t('photos.remove'));
  remove.addEventListener('click', () => {
    state.base[side] = state.src[side] = null;
    if (state.pvSide === side) state.pvSide = sides()[0] || 'front';
    renderSlot(side); renderAll(); updateNav();
    state.wrongSide[side] = false;
    handlers.runChecks(); // re-evaluate with the remaining photo
  });
  box.replaceChildren(base, el('div', { class: 'bar' }, el('span', { class: 't' }, t('photos.done', { side: sideName(side) })),
    el('div', { class: 'row' }, adjust,
      el('label', { class: 'btn file-btn' }, t('photos.retake'), fileInput(true, f => takeFile(side, f))), remove)));
}

/* ---------- full-screen framing ---------- */
const cropTitle = () => t(crop.side === 'front' ? 'crop.title_front' : 'crop.title_back');

/** @param {Side} side */
function openCrop(side) {
  const src = state.src[side]; if (!src) return;
  crop.side = side;
  $('#crop-ov').classList.remove('hidden'); document.body.classList.add('no-scroll');
  $('#crop-title').textContent = cropTitle();
  crop.editor?.destroy();
  crop.editor = new CropEditor($('#crop-canvas'), src, { fitParent: true, topLabel: t('crop.top_label') });
  const last = crop.lastQuad[side];
  if (state.base[side] && last) { crop.editor.setQuad(last); setCropMsg(null); }
  else cropDetect();
  history.pushState({ step: state.step, crop: true }, '');
}

/** @param {boolean | null} found null = neutral hint */
function setCropMsg(found) {
  $('#crop-msg').textContent = t(found === null ? 'crop.msg_adjust' : found ? 'crop.msg_found' : 'crop.msg_not_found');
}
function cropDetect() { if (crop.editor) setCropMsg(crop.editor.autoDetect()); }
export const isCropOpen = () => !$('#crop-ov').classList.contains('hidden');
export function closeCropUI() {
  crop.editor?.destroy(); crop.editor = null;
  $('#crop-ov').classList.add('hidden'); document.body.classList.remove('no-scroll');
}
function leaveCrop() { if (history.state?.crop) history.back(); else closeCropUI(); }

/** Re-translate the overlay after a language change. */
export function refreshCropText() {
  if (!crop.editor) return;
  crop.editor.opts.topLabel = t('crop.top_label'); crop.editor.draw();
  $('#crop-title').textContent = cropTitle();
}

export function initPhotos() {
  $('#crop-cancel').addEventListener('click', leaveCrop);
  $('#crop-rot').addEventListener('click', () => crop.editor?.rotate());
  $('#crop-det').addEventListener('click', cropDetect);
  $('#crop-full').addEventListener('click', () => { if (!crop.editor) return; crop.editor.full(); setCropMsg(null); });
  $('#crop-use').addEventListener('click', () => {
    const src = state.src[crop.side];
    if (!crop.editor || !src) return;
    const side = crop.side, q = crop.editor.getQuad();
    crop.lastQuad[side] = q;
    state.base[side] = warpToCard(src, q);
    if (!state.base[state.pvSide]) state.pvSide = side;
    leaveCrop();
    renderSlot(side); renderAll(); updateNav();
    handlers.runChecks(side);
    if (side === 'front' && !state.base.back) setTimeout(() => $('#slot-back').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  });
}
