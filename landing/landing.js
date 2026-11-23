// @ts-check
// Landing page behaviour: applies the chosen language to the static Spanish markup, mounts the
// ES/EN switches and wires the "copy the AI prompt" button. No network access (the CSP forbids it).
import { applyI18n, mountLangSwitch, t } from '../app/js/i18n.js';

/** How long the "Copiado" state stays visible, in ms. */
const COPIED_MS = 2500;

applyI18n();
document.querySelectorAll('[data-lang-switch]').forEach(box => mountLangSwitch(/** @type {HTMLElement} */ (box)));
setupCopyButton();

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
