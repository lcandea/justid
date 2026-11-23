// @ts-check
// JustID app: the 4-step flow (photos -> hide -> purpose -> share). Boot file: wires the step
// modules in ui/app/ together. Decisions live in core/flow.js; all processing is local and this
// page cannot make network requests (see the CSP in app/index.html).
import { $, $input, segmented } from './dom.js';
import { applyI18n, mountLangSwitch } from './i18n.js';
import { renderSendBlock } from './request-view.js';
import { STEPS } from '../core/flow.js';
import { state, request, handlers, CAN_SHARE } from './app/state.js';
import { renderAll } from './app/render.js';
import { initNav, goStep, mountPreviews, updateNav } from './app/nav.js';
import { initPhotos, renderSlot, isCropOpen, closeCropUI, refreshCropText } from './app/photos.js';
import { initHide, renderFields } from './app/hide.js';
import { initTemplate, fillTemplateSelect, refreshTemplateText } from './app/template.js';
import { initChecks, runChecks, reviewChecks, whenChecksDone, isReviewing } from './app/checks.js';
import { initPurpose, renderChips } from './app/purpose.js';
import { initShare, share } from './app/share.js';
import { initPrivacy } from './app/privacy.js';
import { isDemo, loadDemo, initDemoLinks } from './app/demo.js';

/** @typedef {import('../core/templates.js').Side} Side */

handlers.runChecks = runChecks;

// Another request pasted into the address bar: start over with it.
window.addEventListener('hashchange', () => location.reload());

initNav(); initPhotos(); initHide(); initChecks(); initPurpose(); initShare();
initTemplate({ onManualPick: () => { reviewChecks(); } });

segmented('mode', v => { state.mode = /** @type {'pixel' | 'solid'} */ (v); renderAll(); });
segmented('color', v => { state.bw = v === 'bw'; renderAll(); });
segmented('pv-side', v => { state.pvSide = /** @type {Side} */ (v); mountPreviews(); });

$('#nav-next').addEventListener('click', async () => {
  if (state.step === STEPS - 1) return share(!CAN_SHARE);
  await whenChecksDone(); // don't move on while a photo is still being checked
  if (!isReviewing()) goStep(state.step + 1);
});
window.addEventListener('popstate', e => {
  if (isCropOpen()) { closeCropUI(); return; }
  goStep(e.state?.step ?? 0, false);
});

// Language switch: static text via applyI18n, dynamic parts re-rendered here.
window.addEventListener('langchange', () => {
  refreshTemplateText(); renderSlot('front'); renderSlot('back'); renderFields(); renderChips(); updateNav(); renderAll();
  if (request && state.step === STEPS - 1) renderSendBlock($('#req-send'), request, $input('#purpose').value.trim());
  refreshCropText();
});

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
initDemoLinks();
if (isDemo()) loadDemo();
goStep(0, false);
