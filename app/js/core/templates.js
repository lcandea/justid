// @ts-check
// Template model shared by the app and the zone editor (pure: no i18n, no storage; see ui/templates.js
// for display names and the browser-side store of custom templates).
//
// Official templates come in two layers (see templates/):
//   family  (templates/dni_es.js)    -> which fields exist + whether each is shown by default
//   version (templates/dni_es_v4.js) -> where each field is on the card + reference pictures,
//                                       optional per-field `overrides` of the family defaults
// They are merged here into a flat ResolvedTemplate that the UI works with.
//
// Custom templates (imported .json or saved from the editor) are already flat and self-contained:
// they carry their own field labels and template name.
import { FAMILIES, VERSIONS } from '../../../templates/index.js';

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

const SITE_ROOT = new URL('../../../', import.meta.url);
/** Resolve a site-root-relative asset path (e.g. template sample pictures). @param {string} path */
export const assetUrl = path => new URL(path, SITE_ROOT).href;

/** @param {any} version @returns {ResolvedTemplate} */
function resolveVersion(version) {
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

/** Raised for a malformed flat template; the UI shows its own translated message. */
export class InvalidTemplateError extends Error {
  constructor() { super('invalid template'); this.name = 'InvalidTemplateError'; }
}

/**
 * Validate and normalise a flat template (imported .json / editor). Throws InvalidTemplateError on bad input.
 * @param {any} raw @returns {ResolvedTemplate}
 */
export function normalizeCustom(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.fields)) throw new InvalidTemplateError();
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

/**
 * Official templates first (they win on id clashes), then custom ones.
 * @param {ResolvedTemplate[]} official @param {ResolvedTemplate[]} custom @returns {ResolvedTemplate[]}
 */
export function mergeTemplates(official, custom) {
  const ids = new Set(official.map(x => x.id));
  return [...official, ...custom.filter(x => !ids.has(x.id))];
}

/* ---------- export formats (used by the editor) ---------- */

/**
 * Flat, self-contained JSON (labels included): what the app imports.
 * @param {ResolvedTemplate} tpl
 * @param {{ templateName: (tpl: ResolvedTemplate) => string, fieldLabel: (field: Field) => string }} names display names (translated by the caller)
 */
export function toFlatJson(tpl, names) {
  return {
    id: tpl.id, name: names.templateName(tpl),
    ...(tpl.sample ? { sample: tpl.sample } : {}),
    fields: tpl.fields.map(f => ({ id: f.id, label: names.fieldLabel(f), hide: f.hide, zones: f.zones })),
  };
}

/** Turn a free-form name into an id: lowercase ascii, underscores. @param {string} s */
export const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';

/** Stable colour per field id (editor overlays). @param {string} id */
export function fieldColor(id) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 85% 50%)`;
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
