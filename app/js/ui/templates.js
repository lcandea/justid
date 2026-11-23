// @ts-check
// Template helpers that depend on the page: display names (i18n) and the custom templates stored
// in this browser (localStorage). The model itself is in core/templates.js.
import { t } from './i18n.js';
import { officialTemplates, normalizeCustom as normalizeFlat, InvalidTemplateError, mergeTemplates, toFlatJson as toFlat } from '../core/templates.js';

/** @typedef {import('../core/templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {import('../core/templates.js').Field} Field */

const CUSTOM_KEY = 'justid.customTemplates';

/** Display name: locale string for official templates, own name for custom ones. @param {ResolvedTemplate} tpl */
export const templateName = tpl => tpl.name || t('template.' + tpl.id);

/** Display label of a field. @param {Field} field */
export const fieldLabel = field => field.label || t('field.' + field.id);

/** Validate a flat template; the error message is translated. @param {any} raw @returns {ResolvedTemplate} */
export function normalizeCustom(raw) {
  try { return normalizeFlat(raw); }
  catch (e) { throw e instanceof InvalidTemplateError ? new Error(t('tpl.invalid')) : e; }
}

/** @returns {ResolvedTemplate[]} */
export function loadCustomTemplates() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]').map(normalizeCustom);
  } catch { return []; }
}

/** Flat JSON with translated names. @param {ResolvedTemplate} tpl */
export const toFlatJson = tpl => toFlat(tpl, { templateName, fieldLabel });

/** @param {ResolvedTemplate} tpl @returns {boolean} saved */
export function saveCustomTemplate(tpl) {
  try {
    const all = loadCustomTemplates().filter(x => x.id !== tpl.id);
    all.push(tpl);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(all.map(toFlatJson)));
    return true;
  } catch { return false; }
}

/** Official templates first (they win on id clashes), then custom ones. @returns {ResolvedTemplate[]} */
export const allTemplates = () => mergeTemplates(officialTemplates(), loadCustomTemplates());
