// @ts-check
// JustID app: the 4-step flow (photos -> hide -> purpose -> share).
// All processing is local; this page cannot make network requests (see the CSP in app/index.html).
import { $, $input, $select, $button, el, downloadBlob, ICONS, icon } from './dom.js';
import { t, getLang, applyI18n, mountLangSwitch } from './i18n.js';
import { loadImageFile, warpToCard } from './image.js';
import { CropEditor } from './crop-editor.js';
import { allTemplates, templateName, fieldLabel, normalizeCustom, saveCustomTemplate, assetUrl } from './templates.js';
import { identifyDocument, detectSide } from './identify.js';
import { renderRedacted } from './redact.js';
import { makePdf, canvasToJpeg } from './pdf.js';
import { openZoom } from './zoom-viewer.js';
import { decodeRequest, extraFields } from './request.js';
import { renderRequestPanel, syncRequestPanel, renderSendBlock } from './request-view.js';
import { FAMILIES } from '../../templates/index.js';

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {'front' | 'back'} Side */

/** Public repository; shown in the privacy dialog. */
const REPO_URL = 'https://github.com/lcandea/justid';
const PURPOSE_CHIPS = ['rental', 'bank', 'hotel', 'gym', 'hiring', 'admin'];
const STEPS = 4;
const CAN_SHARE = !!navigator.canShare; // only on HTTPS/localhost and supporting browsers
/** @type {Side[]} */
const SIDE_LIST = ['front', 'back'];

// A request link (#req=…, made on request.html) preselects what to show. It is decoded once, as
// untrusted input: an invalid link is ignored (with a notice) and the app works as usual.
const requestResult = decodeRequest(location.hash, FAMILIES);
const request = requestResult?.ok ? requestResult.request : null;
const requestFamily = request ? FAMILIES.find(f => f.id === request.doc) : undefined;
/** Requested fields that are normally hidden: each needs the user's explicit OK. */
const requestExtras = new Set(request && requestFamily ? extraFields(request, requestFamily) : []);
const requestFields = new Set(request?.fields || []);
// Another request pasted into the address bar: start over with it.
window.addEventListener('hashchange', () => location.reload());

const state = {
  /** @type {ResolvedTemplate[]} */ templates: [],
  /** @type {ResolvedTemplate} */ template: /** @type {any} */ (null),
  /** @type {Set<string>} ids of fields currently hidden */ hidden: new Set(),
  /** original photos @type {Record<Side, HTMLCanvasElement | null>} */ src: { front: null, back: null },
  /** straightened, unprocessed cards @type {Record<Side, HTMLCanvasElement | null>} */ base: { front: null, back: null },
  /** redacted output @type {Record<Side, HTMLCanvasElement>} */
  canvas: { front: el('canvas', { class: 'preview' }), back: el('canvas', { class: 'preview' }) },
  /** @type {'pixel' | 'solid'} */ mode: 'pixel', bw: false, step: 0, /** @type {Side} */ pvSide: 'front',
  /** user picked the template by hand: never auto-switch it */ tplManual: false,
  /** confident identification result @type {ResolvedTemplate | null} */ idGuess: null,
  /** template id the user chose to keep despite the warning @type {string | null} */ idDismissed: null,
  /** template was set by auto-identification */ tplAuto: false,
  /** true when that slot holds a photo that looks like the other side of the card @type {Record<Side, boolean>} */
  wrongSide: { front: false, back: false },
  /** the user said "it's fine" for that slot's photo @type {Record<Side, boolean>} */
  wrongSideOk: { front: false, back: false },
  /** extra requested fields the user agreed to show @type {Set<string>} */ accepted: new Set(),
};
const zonesCanvas = el('canvas', { class: 'zones' });
const sides = () => SIDE_LIST.filter(s => state.base[s]);
const sideName = (/** @type {Side} */ s) => t('side.' + s);

/* ---------- templates ---------- */
/** @param {string} [selectId] */
function fillTemplateSelect(selectId) {
  // A request is for one document family: only offer its versions.
  state.templates = allTemplates().filter(x => !request || x.family === request.doc);
  const sel = $select('#tpl');
  sel.replaceChildren(...state.templates.map(x => el('option', { value: x.id }, templateName(x))));
  if (selectId) sel.value = selectId;
  setTemplate(state.templates.find(x => x.id === sel.value) || state.templates[0]);
}
/** @param {ResolvedTemplate} tpl @param {{ auto?: boolean }} [opts] */
function setTemplate(tpl, { auto = false } = {}) {
  state.template = tpl;
  state.tplAuto = auto;
  state.hidden = new Set(tpl.fields.filter(startsHidden).map(f => f.id));
  renderTemplateInfo();
  renderRequest();
  renderSlot('front'); renderSlot('back'); // empty slots show the template's sample as a hint
  renderFields(); renderAll();
}
function renderTemplateInfo() {
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

// Two automatic checks run after every photo, and each problem is shown as a blocking dialog
// that can only be closed by fixing it or by saying it's fine:
//   1. side:    is the photo in the "front" slot really the front (and vice versa)?
//   2. version: does the photo match the chosen template (v3 / v4)?
// With no manual template choice yet, a confident version guess is applied silently instead.
let identifyRun = 0;
const otherSide = (/** @type {Side} */ s) => (s === 'front' ? 'back' : 'front');

/** Cards keyed by the side they really are (a front photo put in the back slot counts as front). */
function cardsByRealSide() {
  /** @type {Partial<Record<Side, HTMLCanvasElement>>} */
  const out = {};
  for (const s of sides()) {
    const real = state.wrongSide[s] && !state.wrongSideOk[s] ? otherSide(s) : s;
    out[real] ??= /** @type {HTMLCanvasElement} */ (state.base[s]);
  }
  return out;
}

/** Detect whether the photo in `slot` is really that side of the card. @param {Side} slot */
async function checkSide(slot) {
  const base = state.base[slot];
  state.wrongSide[slot] = false; state.wrongSideOk[slot] = false;
  if (!base) return;
  const r = await detectSide(base, state.templates);
  if (state.base[slot] !== base) return; // replaced meanwhile
  console.debug('[side]', slot, `front=${r.front.toFixed(3)} back=${r.back.toFixed(3)}`, r.confident ? r.side : 'unsure');
  state.wrongSide[slot] = r.confident && r.side !== slot;
}

/** Guess the template from the photos (using each photo's real side). */
async function autoIdentify() {
  const run = ++identifyRun;
  const r = sides().length ? await identifyDocument(cardsByRealSide(), state.templates) : null;
  if (run !== identifyRun) return; // a newer photo superseded this run
  if (r) console.debug('[identify]', r.ranking.map(x => `${x.template.id}=${x.score.toFixed(3)}`).join(' '), r.confident ? 'confident' : 'unsure');
  state.idGuess = r?.confident ? r.template : null;
  if (state.idGuess && !state.tplManual) {
    if (state.idGuess !== state.template) { $select('#tpl').value = state.idGuess.id; setTemplate(state.idGuess, { auto: true }); return; }
    state.tplAuto = true; $('#tpl-auto').classList.remove('hidden');
  }
}

/** Exchange everything between the two slots (photos and framing), then re-run the checks. */
async function swapSides() {
  for (const key of /** @type {const} */ (['src', 'base'])) [state[key].front, state[key].back] = [state[key].back, state[key].front];
  [crop.lastQuad.front, crop.lastQuad.back] = [crop.lastQuad.back, crop.lastQuad.front];
  for (const s of SIDE_LIST) if (crop.lastQuad[s] === undefined) delete crop.lastQuad[s];
  if (!state.base[state.pvSide]) state.pvSide = sides()[0] || 'front';
  renderSlot('front'); renderSlot('back'); renderAll(); updateNav();
  await Promise.all([checkSide('front'), checkSide('back')]);
  await autoIdentify();
}

/**
 * Show the blocking decision dialog and resolve with the button pressed.
 * Escape and clicks outside are ignored on purpose: the user has to choose.
 * @param {{ title: string, body: string, photo?: HTMLCanvasElement | null, yes: string, no: string }} o
 * @returns {Promise<boolean>} true = fix it (primary), false = it's fine
 */
function decide({ title, body, photo, yes, no }) {
  const dlg = /** @type {HTMLDialogElement} */ ($('#decision'));
  $('#decision-title').textContent = title;
  $('#decision-body').textContent = body;
  const img = /** @type {HTMLImageElement} */ ($('#decision-photo'));
  img.classList.toggle('hidden', !photo);
  if (photo) img.src = photo.toDataURL('image/jpeg', 0.7); // local data: URL, never leaves the page
  $button('#decision-yes').textContent = yes;
  $button('#decision-no').textContent = no;
  dlg.showModal();
  $button('#decision-yes').focus();
  return new Promise(resolve => {
    let answered = false;
    const done = (/** @type {boolean} */ v) => () => { answered = true; dlg.onclose = null; dlg.close(); resolve(v); };
    $button('#decision-yes').onclick = done(true);
    $button('#decision-no').onclick = done(false);
    // Browsers may force-close a modal (e.g. pressing Escape twice): put the question back.
    dlg.onclose = () => { if (!answered) requestAnimationFrame(() => dlg.showModal()); };
  });
}

/** The first slot whose photo looks like the other side and wasn't accepted. */
const pendingSideSlot = () => SIDE_LIST.find(s => state.base[s] && state.wrongSide[s] && !state.wrongSideOk[s]);
/** A confident version guess that differs from the chosen template and wasn't accepted. */
const pendingVersion = () => {
  const g = state.idGuess;
  return g && g !== state.template && state.idDismissed !== g.id ? g : null;
};

let reviewing = false, reviewAgain = false;
/** Walk through pending problems one dialog at a time (side first: the version check depends on it). */
async function reviewChecks() {
  if (reviewing) { reviewAgain = true; return; }
  reviewing = true;
  try {
    do {
      reviewAgain = false;
      const slot = pendingSideSlot();
      if (slot) {
        const target = otherSide(slot);
        const swap = !!state.base[target]; // the other slot is taken too: they were simply swapped
        const fix = await decide({
          title: t('side.warn_title'),
          body: t(slot === 'front' ? 'side.warn_body_front' : 'side.warn_body_back'),
          photo: state.base[slot],
          yes: t(swap ? 'side.warn_swap' : target === 'front' ? 'side.warn_move_front' : 'side.warn_move_back'),
          no: t('side.warn_keep'),
        });
        if (fix) await swapSides();
        else { state.wrongSideOk[slot] = true; await autoIdentify(); }
        reviewAgain = true;
        continue;
      }
      const g = pendingVersion();
      if (g) {
        const fix = await decide({
          title: t('tpl.warn_title'),
          body: t('tpl.warn_body', { detected: templateName(g), chosen: templateName(state.template) }),
          photo: state.base.front || state.base.back,
          yes: t('tpl.warn_switch', { name: templateName(g) }),
          no: t('tpl.warn_keep'),
        });
        if (fix) { $select('#tpl').value = g.id; state.tplManual = true; setTemplate(g, { auto: true }); }
        else state.idDismissed = g.id;
        reviewAgain = true;
      }
    } while (reviewAgain);
  } finally { reviewing = false; }
}

/** Resolves once the checks for the latest photo are done (Next waits for it). */
let checksDone = Promise.resolve();
/** Run side + version checks for a slot, then ask about anything wrong. @param {Side} [slot] */
function runChecks(slot) {
  checksDone = (async () => {
    if (slot) await checkSide(slot);
    await autoIdentify();
    await reviewChecks();
  })();
  return checksDone;
}

/* ---------- step 1: photo slots ---------- */
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
function renderSlot(side) {
  const box = $('#slot-' + side), base = state.base[side];
  if (!base) {
    const sample = state.template?.sample?.[side];
    box.replaceChildren(
      el('label', { class: 'empty' + (sample ? ' has-sample' : '') },
        sample ? el('img', { class: 'ghost', src: assetUrl(sample), alt: '', 'aria-hidden': 'true', decoding: 'async' }) : null,
        icon(ICONS.camera), el('strong', {}, sideName(side)),
        el('span', { class: side === 'back' && requestNeedsBack() ? 'req-asked' : '' }, side === 'front' ? t('photos.tap_front')
          : requestNeedsBack() ? t('photos.tap_back_requested', { name: /** @type {any} */ (request).from }) : t('photos.tap_back')),
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
    runChecks(); // re-evaluate with the remaining photo
  });
  box.replaceChildren(base, el('div', { class: 'bar' }, el('span', { class: 't' }, t('photos.done', { side: sideName(side) })),
    el('div', { class: 'row' }, adjust,
      el('label', { class: 'btn file-btn' }, t('photos.retake'), fileInput(true, f => takeFile(side, f))), remove)));
}

/* ---------- full-screen framing ---------- */
const crop = {
  /** @type {Side} */ side: 'front',
  /** @type {CropEditor | null} */ editor: null,
  /** corners used last time, per side (for "Adjust") @type {Partial<Record<Side, number[][]>>} */ lastQuad: {},
};
/** @param {Side} side */
function openCrop(side) {
  const src = state.src[side]; if (!src) return;
  crop.side = side;
  $('#crop-ov').classList.remove('hidden'); document.body.classList.add('no-scroll');
  $('#crop-title').textContent = t(side === 'front' ? 'crop.title_front' : 'crop.title_back');
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
function closeCropUI() {
  crop.editor?.destroy(); crop.editor = null;
  $('#crop-ov').classList.add('hidden'); document.body.classList.remove('no-scroll');
}
function leaveCrop() { if (history.state?.crop) history.back(); else closeCropUI(); }
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
  runChecks(side);
  if (side === 'front' && !state.base.back) setTimeout(() => $('#slot-back').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
});

/* ---------- request links ---------- */
/**
 * Initial visibility. Without a request: the template's defaults. With one: only the requested
 * fields, and a normally hidden one stays hidden until the user accepts it. Fields that were not
 * asked for are hidden, even the usual ones. The user can still hide anything on step 2.
 * @param {import('./templates.js').Field} f
 */
function startsHidden(f) {
  if (!request) return f.hide;
  if (requestExtras.has(f.id)) return !state.accepted.has(f.id);
  return !requestFields.has(f.id);
}
/** With a request: the back side is asked for, or a requested field is only on the back. */
function requestNeedsBack() {
  if (!request) return false;
  return request.back || state.template.fields.some(f => requestFields.has(f.id) && f.zones.length > 0 && f.zones.every(z => z.side === 'back'));
}
function renderRequest() {
  $('#req-invalid').classList.toggle('hidden', !requestResult || requestResult.ok);
  $('#req-cta').classList.toggle('hidden', !!request);
  // The photo tip says the back is optional, unless the request asks for it.
  $('#photos-tip').textContent = t(requestNeedsBack() ? 'photos.tip_back_requested' : 'photos.tip');
  if (!request) return;
  const present = new Set(state.template.fields.map(f => f.id));
  renderRequestPanel($('#req-panel'), {
    request, extras: [...requestExtras].filter(id => present.has(id)), backNeeded: requestNeedsBack(),
    isShown: id => !state.hidden.has(id),
    onAccept: (id, ok) => setHidden(id, !ok),
  });
}

/* ---------- step 2: fields ---------- */
function renderFields() {
  /** @type {Record<Side, import('./templates.js').Field[]>} */
  const groups = { front: [], back: [] };
  for (const f of state.template.fields) groups[f.zones[0]?.side || 'front'].push(f);
  const box = $('#fields'); box.replaceChildren();
  for (const side of SIDE_LIST) {
    if (!groups[side].length) continue;
    box.append(el('h3', {}, sideName(side)));
    for (const f of groups[side]) {
      const label = fieldLabel(f);
      const cb = el('input', { type: 'checkbox', checked: state.hidden.has(f.id), 'aria-label': t('hide.aria', { field: label }) });
      cb.addEventListener('change', () => setHidden(f.id, cb.checked));
      const also = f.zones.some(z => z.side !== side) ? t(side === 'front' ? 'hide.also_on_back' : 'hide.also_on_front') : '';
      const extra = request && requestExtras.has(f.id) ? t('hide.requested_extra', { name: request.from }) : '';
      const row = el('label', { class: 'fld' + (extra ? ' req-extra' : ''), 'data-f': f.id },
        el('span', { class: 'nm' }, label,
          el('small', { class: f.hide ? '' : 'ok' }, t(f.hide ? 'hide.recommended' : 'hide.usually_shown') + also + extra)),
        el('span', { class: 'switch' }, cb, el('i')));
      box.append(row);
    }
  }
}
/** @param {string} id @param {boolean} on */
function setHidden(id, on) {
  on ? state.hidden.add(id) : state.hidden.delete(id);
  if (requestExtras.has(id)) {
    on ? state.accepted.delete(id) : state.accepted.add(id); // showing an extra field = accepting it
    syncRequestPanel($('#req-panel'), x => !state.hidden.has(x));
  }
  const cb = /** @type {HTMLInputElement | null} */ (document.querySelector(`.fld[data-f="${id}"] input`));
  if (cb) cb.checked = on;
  renderAll();
}
/** Outline every zone on the preview: solid = hidden, dashed yellow = visible. */
function drawZones() {
  const side = state.pvSide, cv = state.canvas[side];
  if (!cv.isConnected || !zonesCanvas.isConnected) return;
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  zonesCanvas.width = Math.round(w * dpr); zonesCanvas.height = Math.round(h * dpr);
  const ctx = zonesCanvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const f of state.template.fields) for (const z of f.zones) {
    if (z.side !== side) continue;
    const hid = state.hidden.has(f.id);
    ctx.setLineDash(hid ? [] : [5, 4]); ctx.lineWidth = hid ? 1.5 : 2;
    ctx.strokeStyle = hid ? 'rgba(255,255,255,.75)' : '#facc15';
    ctx.strokeRect(z.x * w + 1, z.y * h + 1, z.w * w - 2, z.h * h - 2);
  }
}
// Tap on the preview toggles the smallest zone under the finger.
$('#pv-hide').addEventListener('click', e => {
  const cv = state.canvas[state.pvSide], r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  let best = null, bestA = Infinity;
  for (const f of state.template.fields) for (const z of f.zones) {
    if (z.side === state.pvSide && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h && z.w * z.h < bestA) { best = f; bestA = z.w * z.h; }
  }
  if (!best) return;
  setHidden(best.id, !state.hidden.has(best.id));
  navigator.vibrate?.(10);
  const row = document.querySelector(`.fld[data-f="${best.id}"]`);
  if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 700); }
});

/* ---------- rendering ---------- */
function watermarkText() {
  const purpose = $input('#purpose').value.trim(), recipient = $input('#recipient').value.trim();
  if (!purpose) return '';
  return [t('wm.only_for', { purpose }), recipient, new Date().toLocaleDateString(getLang())].filter(Boolean).join(' · ').toUpperCase();
}
let renderTimer = 0;
function renderAll() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    const opts = { template: state.template, hidden: state.hidden, mode: state.mode, bw: state.bw, watermark: watermarkText() };
    for (const side of SIDE_LIST) {
      const base = state.base[side];
      if (base) renderRedacted(state.canvas[side], base, side, opts);
    }
    drawZones(); updateSummary();
  }, 50);
}

/* ---------- step navigation ---------- */
function mountPreviews() {
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
function canAdvance(s = state.step) {
  if (s === 0) return sides().length > 0;
  if (s === 2) return !!$input('#purpose').value.trim();
  return true;
}
/** @param {number} n @param {boolean} [push] add a history entry (so the phone's back button works) */
function goStep(n, push = true) {
  n = Math.max(0, Math.min(STEPS - 1, n));
  for (let i = 0; i < n; i++) if (!canAdvance(i)) { n = i; break; }
  state.step = n;
  document.querySelectorAll('.step').forEach(sec => sec.classList.toggle('hidden', Number(/** @type {HTMLElement} */ (sec).dataset.step) !== n));
  mountPreviews();
  updateNav();
  window.scrollTo(0, 0);
  if (push) history.pushState({ step: n }, '');
  if (n === 2 && !$input('#purpose').value) setTimeout(() => $input('#purpose').focus(), 100);
}
function updateNav() {
  const s = state.step;
  document.querySelectorAll('#steps li').forEach(li => {
    const i = Number(/** @type {HTMLElement} */ (li).dataset.s);
    li.classList.toggle('cur', i === s);
    li.classList.toggle('done', i < s);
    li.classList.toggle('reach', i > s && [...Array(i).keys()].every(k => canAdvance(k)));
  });
  $('#nav-back').classList.toggle('invisible', s === 0);
  const next = $button('#nav-next');
  const last = s === STEPS - 1;
  next.disabled = !canAdvance();
  next.textContent = last ? t(CAN_SHARE ? 'share.share_pdf' : 'share.download_pdf')
    : s === 0 && !canAdvance() ? t('nav.need_photo') : s === 2 && !canAdvance() ? t('nav.need_purpose') : t('nav.next');
}
function updateSummary() {
  if (state.step !== 3) return;
  const count = state.template.fields.filter(f => state.hidden.has(f.id) && f.zones.some(z => state.base[z.side])).length;
  const list = sides().map(sideName).join(t('share.sides_join'));
  $('#summary').textContent = t('share.summary', { sides: list, count, watermark: watermarkText() });
}
$('#nav-next').addEventListener('click', async () => {
  if (state.step === STEPS - 1) return share(!CAN_SHARE);
  await checksDone; // don't move on while a photo is still being checked
  if (!reviewing) goStep(state.step + 1);
});
$('#nav-back').addEventListener('click', () => history.back());
$('#steps').addEventListener('click', e => {
  const li = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('li.done, li.reach'));
  if (li) goStep(Number(li.dataset.s));
});
window.addEventListener('popstate', e => {
  if (!$('#crop-ov').classList.contains('hidden')) { closeCropUI(); return; }
  goStep(e.state?.step ?? 0, false);
});
window.addEventListener('resize', () => requestAnimationFrame(drawZones));

/* ---------- output ---------- */
async function buildPdfFile() {
  const imgs = [];
  for (const side of sides()) { const cv = state.canvas[side]; imgs.push({ jpeg: await canvasToJpeg(cv, 0.78), w: cv.width, h: cv.height }); }
  const recipient = $input('#recipient').value.trim();
  const date = new Date().toLocaleDateString(getLang());
  const caption = [
    t('pdf.caption_purpose', { purpose: $input('#purpose').value.trim() }),
    t('pdf.caption_date', { recipient: recipient ? t('pdf.caption_recipient', { recipient }) : '', date }),
  ];
  const name = t('pdf.filename', { date: new Date().toISOString().slice(0, 10) });
  return new File([makePdf(imgs, caption)], name, { type: 'application/pdf' });
}
/** @param {boolean} download force a download instead of the share sheet */
async function share(download) {
  const st = $('#out-status');
  try {
    const file = await buildPdfFile(), kb = Math.round(file.size / 1024);
    if (!download && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: t('share.sheet_title') });
      st.className = 'status ok'; st.textContent = t('share.shared', { kb });
    } else {
      downloadBlob(file, file.name);
      st.className = 'status ok'; st.textContent = t('share.downloaded', { kb });
    }
  } catch (e) {
    if (/** @type {Error} */ (e).name === 'AbortError') return; // user closed the share sheet
    st.className = 'status warn'; st.textContent = t('share.error', { msg: /** @type {Error} */ (e).message });
  }
}

/* ---------- privacy badge + dialog ---------- */
function initPrivacy() {
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

/* ---------- init ---------- */
/** Segmented control: one active button, calls onPick with its data-v. @param {string} id @param {(v: string) => void} onPick */
function seg(id, onPick) {
  const box = $('#' + id);
  box.addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button')); if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(/** @type {string} */ (b.dataset.v));
  });
}
seg('mode', v => { state.mode = /** @type {'pixel' | 'solid'} */ (v); renderAll(); });
seg('color', v => { state.bw = v === 'bw'; renderAll(); });
seg('pv-side', v => { state.pvSide = /** @type {Side} */ (v); mountPreviews(); });
$('#tpl').addEventListener('change', e => {
  state.tplManual = true; // a manual choice is never auto-switched, but a mismatch is still flagged
  const id = /** @type {HTMLSelectElement} */ (e.target).value;
  setTemplate(/** @type {ResolvedTemplate} */ (state.templates.find(x => x.id === id)));
  reviewChecks();
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
function renderChips() {
  const current = $input('#purpose').value.trim();
  $('#chips').replaceChildren(...PURPOSE_CHIPS.map(key => {
    const text = t('purpose.chip.' + key);
    const b = el('button', { type: 'button', class: text === current ? 'on' : '' }, text);
    b.addEventListener('click', () => { $input('#purpose').value = text; $input('#purpose').dispatchEvent(new Event('input')); });
    return b;
  }));
}
$('#purpose').addEventListener('input', () => {
  const v = $input('#purpose').value.trim();
  $('#chips').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === v));
  renderAll(); updateNav();
});
$('#purpose').addEventListener('keydown', e => { if (e.key === 'Enter') $input('#recipient').focus(); });
$('#recipient').addEventListener('input', renderAll);
$('#recipient').addEventListener('keydown', e => { if (e.key === 'Enter') { $input('#recipient').blur(); if (canAdvance()) goStep(3); } });
// The main action lives in the bottom bar; here only "Download" stays, as an alternative when sharing is possible.
$('#btn-share').classList.add('hidden');
$('#btn-dl').addEventListener('click', () => share(true));
if (!CAN_SHARE) $('#btn-dl').classList.add('hidden');

// Language switch: static text via applyI18n, dynamic parts re-rendered here.
window.addEventListener('langchange', () => {
  const selected = state.template.id;
  $('#tpl').replaceChildren(...state.templates.map(x => el('option', { value: x.id }, templateName(x))));
  $select('#tpl').value = selected;
  renderTemplateInfo(); renderRequest(); renderSlot('front'); renderSlot('back'); renderFields(); renderChips(); updateNav(); renderAll();
  if (request && state.step === STEPS - 1) renderSendBlock($('#req-send'), request, $input('#purpose').value.trim());
  if (crop.editor) { crop.editor.opts.topLabel = t('crop.top_label'); crop.editor.draw(); $('#crop-title').textContent = t(crop.side === 'front' ? 'crop.title_front' : 'crop.title_back'); }
});

// Escape must not dismiss a decision: the user has to pick one of the two answers.
$('#decision').addEventListener('cancel', e => e.preventDefault());

applyI18n();
mountLangSwitch($('#lang'));
initPrivacy();
if (request) { // the requester's purpose and name become the watermark; the user can still edit both
  $input('#purpose').value = request.purpose;
  $input('#recipient').value = request.from;
}
renderChips();
fillTemplateSelect();
history.replaceState({ step: 0 }, '');
goStep(0, false);
