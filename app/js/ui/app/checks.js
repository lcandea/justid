// @ts-check
// Two automatic checks run after every photo, and each problem is shown as a blocking dialog
// that can only be closed by fixing it or by saying it's fine:
//   1. side:    is the photo in the "front" slot really the front (and vice versa)?
//   2. version: does the photo match the chosen template (v3 / v4)?
// With no manual template choice yet, a confident version guess is applied silently instead.
import { $, $select, $button, openModal } from '../dom.js';
import { t } from '../i18n.js';
import { templateName } from '../templates.js';
import { detectSide, identifyDocument } from '../samples.js';
import { otherSide, cardsByRealSide, pendingSideSlot, pendingVersion } from '../../core/flow.js';
import { state, sides } from './state.js';
import { renderAll } from './render.js';
import { updateNav } from './nav.js';
import { renderSlot, swapFraming } from './photos.js';
import { setTemplate } from './template.js';

/** @typedef {import('../../core/templates.js').Side} Side */

let identifyRun = 0;

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
  const r = sides().length ? await identifyDocument(cardsByRealSide(state.base, state.wrongSide, state.wrongSideOk), state.templates) : null;
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
  swapFraming();
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
  openModal(dlg);
  return new Promise(resolve => {
    let answered = false;
    const done = (/** @type {boolean} */ v) => () => { answered = true; dlg.onclose = null; dlg.close(); resolve(v); };
    $button('#decision-yes').onclick = done(true);
    $button('#decision-no').onclick = done(false);
    // Browsers may force-close a modal (e.g. pressing Escape twice): put the question back.
    dlg.onclose = () => { if (!answered) requestAnimationFrame(() => openModal(dlg)); };
  });
}

let reviewing = false, reviewAgain = false;
export const isReviewing = () => reviewing;

/** Walk through pending problems one dialog at a time (side first: the version check depends on it). */
export async function reviewChecks() {
  if (reviewing) { reviewAgain = true; return; }
  reviewing = true;
  try {
    do {
      reviewAgain = false;
      const slot = pendingSideSlot(state.base, state.wrongSide, state.wrongSideOk);
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
      const g = pendingVersion(state.idGuess, state.template, state.idDismissed);
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
let checkRuns = 0;
export const whenChecksDone = () => checksDone;

/** Run side + version checks for a slot, then ask about anything wrong. @param {Side} [slot] */
export function runChecks(slot) {
  const run = ++checkRuns;
  document.body.classList.add('busy'); // thin progress line under the header while checking
  checksDone = (async () => {
    try {
      if (slot) await checkSide(slot);
      await autoIdentify();
    } finally { if (run === checkRuns) document.body.classList.remove('busy'); }
    await reviewChecks(); // questions to the user do not count as busy
  })();
  return checksDone;
}

export function initChecks() {
  // Escape must not dismiss a decision: the user has to pick one of the two answers.
  $('#decision').addEventListener('cancel', e => e.preventDefault());
}
