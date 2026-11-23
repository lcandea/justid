// @ts-check
// Template model shared by the app and the zone editor.
//
// Official templates come in two layers (see templates/):
//   family  (templates/dni_es.js)    -> which fields exist + whether each is shown by default
//   version (templates/dni_es_v4.js) -> where each field is on the card + reference pictures,
//                                       optional per-field `overrides` of the family defaults
// They are merged here into a flat ResolvedTemplate that the UI works with.
//
// Custom templates (imported .json or saved from the editor) are already flat and self-contained:
// they carry their own field labels and template name.
import { FAMILIES, VERSIONS } from '../../templates/index.js';
import { t } from './i18n.js';

/**
 * @typedef {'front' | 'back'} Side
 * @typedef {{ side: Side, x: number, y: number, w: number, h: number }} Zone  fractions of the card (0-1)
 * @typedef {{ id: string, hide: boolean, zones: Zone[], label?: string }} Field
 * @typedef {{ front?: string, back?: string }} Sample  paths relative to the site root
 * @typedef {{
 *   id: string, name?: string, family?: string, isDefault?: boolean, custom: boolean,
 *   sample?: Sample, fields: Field[]
 * }} ResolvedTemplate
 */

const SITE_ROOT = new URL('../../', import.meta.url);
/** Resolve a site-root-relative asset path (e.g. template sample pictures). @param {string} path */
export const assetUrl = path => new URL(path, SITE_ROOT).href;

/** @param {any} version @returns {ResolvedTemplate} */
export function resolveVersion(version) {
  const family = FAMILIES.find(f => f.id === version.family);
  if (!family) throw new Error(`Unknown template family: ${version.family}`);
  const overrides = version.overrides || {};
  const fields = family.fields
    .filter(f => version.zones[f.id]?.length) // a version only has the fields it draws
    .map(f => ({
      id: f.id,
      hide: !(overrides[f.id]?.show ?? f.show),
      zones: version.zones[f.id].map(z => ({ ...z })),
    }));
  return { id: version.id, family: family.id, isDefault: !!version.default, custom: false, sample: version.sample, fields };
}

/** @returns {ResolvedTemplate[]} official versions, default one first */
export function officialTemplates() {
  const list = VERSIONS.map(resolveVersion);
  return [...list.filter(x => x.isDefault), ...list.filter(x => !x.isDefault)];
}

/** Display name: locale string for official templates, own name for custom ones. @param {ResolvedTemplate} tpl */
export const templateName = tpl => tpl.name || t('template.' + tpl.id);

/** Display label of a field. @param {Field} field */
export const fieldLabel = field => field.label || t('field.' + field.id);

/* ---------- custom templates (stored in this browser only) ---------- */

const CUSTOM_KEY = 'justid.customTemplates';

/**
 * Validate and normalise a flat template (imported .json / editor). Throws on bad input.
 * @param {any} raw @returns {ResolvedTemplate}
 */
export function normalizeCustom(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.fields)) throw new Error(t('tpl.invalid'));
  return {
    id: raw.id, name: String(raw.name || raw.id), custom: true,
    sample: raw.sample && typeof raw.sample === 'object' ? raw.sample : undefined,
    fields: raw.fields.map(f => ({
      id: String(f.id), label: f.label ? String(f.label) : undefined, hide: !!f.hide,
      zones: (f.zones || []).filter(z => z.side === 'front' || z.side === 'back')
        .map(z => ({ side: z.side, x: +z.x, y: +z.y, w: +z.w, h: +z.h })),
    })),
  };
}

/** @returns {ResolvedTemplate[]} */
export function loadCustomTemplates() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]').map(normalizeCustom);
  } catch { return []; }
}

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
export function allTemplates() {
  const official = officialTemplates();
  const ids = new Set(official.map(x => x.id));
  return [...official, ...loadCustomTemplates().filter(x => !ids.has(x.id))];
}

/* ---------- export formats (used by the editor) ---------- */

/** Flat, self-contained JSON (labels included): what the app imports. @param {ResolvedTemplate} tpl */
export function toFlatJson(tpl) {
  return {
    id: tpl.id, name: templateName(tpl),
    ...(tpl.sample ? { sample: tpl.sample } : {}),
    fields: tpl.fields.map(f => ({ id: f.id, label: fieldLabel(f), hide: f.hide, zones: f.zones })),
  };
}

/**
 * Source of a version module for the repository (templates/<id>.js). Only valid for
 * templates of a known family; visibility that differs from the family becomes an override.
 * @param {ResolvedTemplate} tpl @returns {string}
 */
export function toVersionModule(tpl) {
  const family = FAMILIES.find(f => f.id === tpl.family);
  if (!family) throw new Error('Only templates of a known family can be exported as a module');
  /** @type {Record<string, { show: boolean }>} */
  const overrides = {};
  /** @type {Record<string, Zone[]>} */
  const zones = {};
  for (const f of tpl.fields) {
    const def = family.fields.find(x => x.id === f.id);
    if (def && def.show === f.hide) overrides[f.id] = { show: !f.hide };
    if (f.zones.length) zones[f.id] = f.zones;
  }
  const data = { kind: 'version', id: tpl.id, family: family.id, ...(tpl.isDefault ? { default: true } : {}),
    sample: tpl.sample || {}, overrides, zones };
  const json = JSON.stringify(data, null, 2)
    .replace(/\{\s*\n\s*([^{}[\]]*?)\s*\n\s*\}/g, (_, body) => '{ ' + body.replace(/,\s*\n\s*/g, ', ') + ' }');
  return '// Pure data: one `export default` of a JSON object, nothing else (enforced by tests/unit/templates.test.mjs).\n' +
    `// Generated by the zone editor (app/editor.html).\nexport default ${json};\n`;
}
