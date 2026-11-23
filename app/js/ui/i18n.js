// @ts-check
// Minimal i18n: Spanish (default) and English, no dependencies.
// - Static HTML text: elements with data-i18n="key" get their textContent replaced;
//   data-i18n-attr="placeholder:key;aria-label:key" sets attributes.
// - Dynamic text: call t(key, { param }) and re-render on the 'langchange' window event.
// Text is always set as textContent, never innerHTML, so translations can't inject markup.
import es from '../../../locales/es.js';
import en from '../../../locales/en.js';

/** @typedef {'es' | 'en'} Lang */

/** @type {Record<Lang, Record<string, string>>} */
const DICTS = { es, en };
export const LANGS = /** @type {Lang[]} */ (['es', 'en']);
const STORAGE_KEY = 'justid.lang';

/** @returns {Lang} */
function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch { /* storage blocked: fall through */ }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language || 'es'];
  // Spanish is the default; English only for browsers that don't list Spanish at all.
  if (prefs.some(l => l.toLowerCase().startsWith('es'))) return 'es';
  return prefs.some(l => l.toLowerCase().startsWith('en')) ? 'en' : 'es';
}

let current = detectLang();

/** @returns {Lang} */
export function getLang() { return current; }

/**
 * Translate a key, filling {placeholders}. Falls back to Spanish, then to the key itself.
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 */
export function t(key, params) {
  let s = DICTS[current][key] ?? DICTS.es[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

/** Apply translations to static markup under `root`. @param {ParentNode} [root] */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = t(/** @type {HTMLElement} */ (n).dataset.i18n || ''); });
  root.querySelectorAll('[data-i18n-attr]').forEach(n => {
    for (const pair of (/** @type {HTMLElement} */ (n).dataset.i18nAttr || '').split(';')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) n.setAttribute(attr, t(key));
    }
  });
  document.documentElement.lang = current;
}

/** @param {Lang} lang */
export function setLang(lang) {
  if (!DICTS[lang] || lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not persisted: fine */ }
  applyI18n();
  window.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

/** Render an ES/EN switch into `box` (a container element). @param {HTMLElement} box */
export function mountLangSwitch(box) {
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t('lang.label'));
  const render = () => {
    box.replaceChildren(...LANGS.map(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l.toUpperCase();
      b.lang = l;
      b.setAttribute('aria-pressed', String(l === current));
      b.addEventListener('click', () => setLang(l));
      return b;
    }));
    box.setAttribute('aria-label', t('lang.label'));
  };
  render();
  window.addEventListener('langchange', render);
}
