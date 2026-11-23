// @ts-check
// Landing page behaviour: applies the chosen language to the static Spanish markup, mounts the
// ES/EN switches, wires the "copy the AI prompt" button and makes the hero's specimen draggable. No network access (the CSP forbids it).
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
setupSpecimenSlider();
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

/**
 * The hero's specimen: the CSS animation sweeps the scan line until the visitor takes over. Pressing
 * (mouse or touch) moves the line to the pointer and dragging follows it; arrow keys, Home and End
 * work too. RESUME_MS after the last interaction the animation picks up again from where the line
 * was left (not while the slider has keyboard focus). With reduced motion there is no animation,
 * but dragging still works. The card is rotated, so the pointer is mapped into the card's own axes.
 */
function setupSpecimenSlider() {
  const card = /** @type {HTMLElement | null} */ (document.querySelector('.id-card'));
  if (!card) return;
  const ANGLE = -4 * Math.PI / 180; // must match the rotate() in landing.css
  const RESUME_MS = 5000, SWEEP_S = 3; // half of the 6 s animation in landing.css: the left-to-right sweep
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animated = /** @type {HTMLElement[]} */ ([...card.querySelectorAll('.card-covered, .scan')]);
  let pos = 62, resumeTimer = 0;
  /** The pointer currently dragging, if any. @type {number | null} */
  let dragging = null;

  /**
   * Seconds into the animation at which the line is at `p` % while sweeping right. The keyframes go
   * from -4% to 100% in the first half with cubic-bezier(.6, 0, .4, 1): invert it by bisection.
   * @param {number} p
   */
  const phaseAt = p => {
    const target = Math.min(1, Math.max(0, (p + 4) / 104));
    const bez = (/** @type {number} */ s, /** @type {number} */ a, /** @type {number} */ b) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (bez(mid, 0, 1) < target) lo = mid; else hi = mid; }
    return bez(lo, 0.6, 0.4) * SWEEP_S;
  };
  const resume = () => {
    if (reducedMotion.matches || dragging !== null || card.matches(':focus-visible')) return;
    for (const el of animated) el.style.animationDelay = `-${phaseAt(pos).toFixed(3)}s`;
    card.classList.remove('is-manual');
  };
  const scheduleResume = () => { clearTimeout(resumeTimer); resumeTimer = window.setTimeout(resume, RESUME_MS); };

  /** @param {number} value percentage of the card showing the covered copy */
  const set = value => {
    clearTimeout(resumeTimer);
    pos = Math.round(Math.min(100, Math.max(0, value)));
    card.classList.add('is-manual');
    card.style.setProperty('--pos', pos + '%');
    card.setAttribute('aria-valuenow', String(pos));
    card.setAttribute('aria-valuetext', t('landing.hero.slider_value', { n: pos }));
  };
  /** Position under the pointer, in percent of the card's width. @param {PointerEvent} e */
  const fromPointer = e => {
    const r = card.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const local = dx * Math.cos(ANGLE) + dy * Math.sin(ANGLE); // undo the rotation
    return (local / card.offsetWidth + 0.5) * 100;
  };

  card.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = e.pointerId;
    try { card.setPointerCapture(e.pointerId); } catch { /* keeps working without capture */ }
    set(fromPointer(e));
  });
  card.addEventListener('pointermove', e => { if (e.pointerId === dragging) set(fromPointer(e)); });
  for (const type of ['pointerup', 'pointercancel']) card.addEventListener(type, () => { dragging = null; scheduleResume(); });
  card.addEventListener('blur', scheduleResume);
  card.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 5;
    const next = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, Home: 0, End: 100 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    set(next);
    scheduleResume();
  });
  window.addEventListener('langchange', () => card.setAttribute('aria-valuetext', t('landing.hero.slider_value', { n: pos })));
  card.setAttribute('aria-valuetext', t('landing.hero.slider_value', { n: pos }));
}
