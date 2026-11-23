// @ts-check
// Landing page behaviour: applies the chosen language to the static Spanish markup, mounts the
// ES/EN switches and wires the "copy the AI prompt" button. No network access (the CSP forbids it).
import { applyI18n, mountLangSwitch, t } from '../app/js/ui/i18n.js';
import { encodeRequest } from '../app/js/core/request.js';
import { defaultFields } from '../app/js/core/request-builder.js';
import { FAMILIES } from '../templates/index.js';

/** How long the "Copiado" state stays visible, in ms. */
const COPIED_MS = 2500;

applyI18n();
document.querySelectorAll('[data-lang-switch]').forEach(box => mountLangSwitch(/** @type {HTMLElement} */ (box)));
setupCopyButton();
setupExampleRequest();
window.addEventListener('langchange', setupExampleRequest);

/** Select all the text of an element so the user can copy it by hand. @param {HTMLElement} node */
function selectText(node) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Copy `text` to the clipboard; resolves false when the browser refuses. @param {string} text @returns {Promise<boolean>} */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function setupCopyButton() {
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('copy-btn'));
  const prompt = document.getElementById('ai-prompt');
  const status = document.getElementById('copy-status');
  if (!btn || !prompt || !status) return;
  btn.hidden = false;

  /** @type {'idle' | 'copied' | 'fallback'} */
  let state = 'idle';
  /** @type {number | undefined} */
  let timer;

  const render = () => {
    btn.classList.toggle('copied', state === 'copied');
    if (state === 'copied') btn.textContent = t('landing.verify.copied');
    else btn.textContent = t('landing.verify.copy');
    status.textContent = state === 'copied' ? t('landing.verify.copied')
      : state === 'fallback' ? t('landing.verify.copy_fallback') : '';
  };

  btn.addEventListener('click', async () => {
    clearTimeout(timer);
    const ok = await copyText(prompt.textContent || '');
    if (ok) state = 'copied';
    else {
      // Clipboard API unavailable or denied: select the text so Ctrl/Cmd+C finishes the job.
      selectText(prompt);
      prompt.focus();
      state = 'fallback';
    }
    render();
    timer = window.setTimeout(() => { state = 'idle'; render(); }, COPIED_MS);
  });
  window.addEventListener('langchange', render);
  // applyI18n() also rewrote the button label from data-i18n; keep both in sync.
  render();
}

/**
 * The request band's example: a real request link (made with the same code as app/request.html),
 * from "JustID (example)", answered by email to a placeholder address, asking for the usual fields plus the
 * home address as an extra, so visitors see how an extra field is asked for and accepted.
 * "Try it" opens it in the app's specimen test mode (?demo=specimenv4, see app/js/ui/app/demo.js).
 * Rebuilt on language change: the purpose and justification follow the page language.
 */
function setupExampleRequest() {
  const family = FAMILIES.find(f => f.id === 'dni_es');
  const tryLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('req-try'));
  if (!family || !tryLink) return;
  const fragment = encodeRequest({
    doc: 'dni_es',
    from: t('landing.request.demo_from'),
    purpose: t('landing.request.demo_purpose'),
    fields: [...defaultFields(family), 'address'],
    back: true, // the address is on the back
    delivery: { kind: 'email', value: 'justid@justid.com' },
    why: t('landing.request.demo_why'),
  }, FAMILIES);
  tryLink.href = 'app/?demo=specimenv4#' + fragment;
  const base = document.getElementById('req-url-base'), frag = document.getElementById('req-url-frag');
  if (base) base.textContent = location.host + '/app/';
  if (frag) frag.textContent = '#' + fragment;
}
