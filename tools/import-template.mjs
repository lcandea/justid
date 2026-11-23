// @ts-check
// Dev-only: imports a zone-editor JSON export (app/editor.html) into a template version file,
// rewriting only its `zones` (and, with --overrides, its `overrides`). Never shipped to the site.
// Usage: node tools/import-template.mjs [--overrides] <editor.json> [templates/<id>.js]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{side: string, x: number, y: number, w: number, h: number}} Zone */
/** @typedef {{id: string, show: boolean}} FamilyField */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIDES = ['front', 'back'];

/** @param {number} n */
export const round4 = n => Math.round(n * 10000) / 10000;

/** Parses a template data file: returns the object inside `export default {...};`. */
export function parseTemplateSource(/** @type {string} */ src) {
  const m = src.match(/^export default (\{[\s\S]*\});\s*$/m);
  if (!m) throw new Error('template file must end with "export default {...};"');
  return JSON.parse(m[1]);
}

/**
 * Validates an editor export against a family catalogue and a version id.
 * @param {any} json
 * @param {{id: string, fields: FamilyField[]}} family
 * @param {string} versionId
 * @returns {string[]} error messages (empty when valid)
 */
export function validateExport(json, family, versionId) {
  const errors = [];
  if (!json || typeof json !== 'object' || !Array.isArray(json.fields)) return ['JSON must be an object with a "fields" array'];
  if (json.id !== versionId) errors.push(`id "${json.id}" does not match target version "${versionId}"`);
  const known = new Set(family.fields.map(f => f.id));
  const seen = new Set();
  for (const f of json.fields) {
    const where = `field "${f?.id}"`;
    if (!f || typeof f.id !== 'string') { errors.push('a field has no string id'); continue; }
    if (!known.has(f.id)) errors.push(`${where}: not in family ${family.id}`);
    if (seen.has(f.id)) errors.push(`${where}: duplicated`);
    seen.add(f.id);
    if (typeof f.hide !== 'boolean') errors.push(`${where}: "hide" must be a boolean`);
    if (!Array.isArray(f.zones) || f.zones.length === 0) { errors.push(`${where}: needs at least one zone`); continue; }
    f.zones.forEach((/** @type {any} */ z, /** @type {number} */ i) => {
      const w = `${where} zone ${i + 1}`;
      if (!SIDES.includes(z?.side)) errors.push(`${w}: side must be front or back, got ${JSON.stringify(z?.side)}`);
      let numeric = true;
      for (const k of ['x', 'y', 'w', 'h']) {
        if (typeof z?.[k] !== 'number' || !Number.isFinite(z[k]) || z[k] < 0 || z[k] > 1) { errors.push(`${w}: ${k} must be a number in 0-1, got ${JSON.stringify(z?.[k])}`); numeric = false; }
      }
      if (numeric) {
        if (z.w <= 0 || z.h <= 0) errors.push(`${w}: w and h must be > 0`);
        if (round4(z.x) + round4(z.w) > 1.00001) errors.push(`${w}: x+w = ${round4(z.x + z.w)} exceeds 1`);
        if (round4(z.y) + round4(z.h) > 1.00001) errors.push(`${w}: y+h = ${round4(z.y + z.h)} exceeds 1`);
      }
    });
  }
  return errors;
}

/** Zones per field in family catalogue order, rounded to 4 decimals. Unknown fields are ignored. */
export function buildZones(/** @type {any} */ json, /** @type {{fields: FamilyField[]}} */ family) {
  /** @type {Record<string, Zone[]>} */
  const out = {};
  for (const fam of family.fields) {
    const f = json.fields.find((/** @type {any} */ x) => x.id === fam.id);
    if (f) out[fam.id] = f.zones.map((/** @type {Zone} */ z) => ({ side: z.side, x: round4(z.x), y: round4(z.y), w: round4(z.w), h: round4(z.h) }));
  }
  return out;
}

/** Renders the `"zones": {...}` block in the repository style (two-space indent, one zone per line). */
export function renderZones(/** @type {Record<string, Zone[]>} */ zones) {
  const body = Object.entries(zones).map(([id, list]) =>
    `    ${JSON.stringify(id)}: [\n` +
    list.map(z => `      { "side": ${JSON.stringify(z.side)}, "x": ${z.x}, "y": ${z.y}, "w": ${z.w}, "h": ${z.h} }`).join(',\n') +
    '\n    ]').join(',\n');
  return `  "zones": {\n${body}\n  }`;
}

/** Replaces only the zones block (which must be the last key) in the target source. */
export function replaceZones(/** @type {string} */ src, /** @type {Record<string, Zone[]>} */ zones) {
  const re = /^ {2}"zones": \{[\s\S]*?\n {2}\}(?=\n\};\s*$)/m;
  if (!re.test(src)) throw new Error('could not find the "zones" block as the last key of the target file');
  return src.replace(re, () => renderZones(zones));
}

/** Replaces the one-line `"overrides": {...},` entry. */
export function replaceOverrides(/** @type {string} */ src, /** @type {Record<string, {show: boolean}>} */ overrides) {
  const re = /^ {2}"overrides": .*,$/m;
  if (!re.test(src)) throw new Error('could not find a one-line "overrides" entry in the target file');
  return src.replace(re, () => `  "overrides": ${JSON.stringify(overrides)},`);
}

/** Visibility implied by family defaults + overrides: field id -> hide. */
export function effectiveHide(/** @type {{fields: FamilyField[]}} */ family, /** @type {Record<string, {show?: boolean}>} */ overrides) {
  return Object.fromEntries(family.fields.map(f => [f.id, !(overrides?.[f.id]?.show ?? f.show)]));
}

/** Descriptions of fields whose `hide` in the export differs from the effective hide. */
export function hideDifferences(/** @type {any} */ json, /** @type {{fields: FamilyField[]}} */ family, /** @type {Record<string, {show?: boolean}>} */ overrides) {
  const eff = effectiveHide(family, overrides);
  return json.fields.filter((/** @type {any} */ f) => f.id in eff && eff[f.id] !== f.hide)
    .map((/** @type {any} */ f) => `${f.id}: file ${eff[f.id] ? 'hidden' : 'shown'}, export ${f.hide ? 'hidden' : 'shown'}`);
}

/** Overrides that make the family defaults match the export's hide flags. */
export function overridesFromExport(/** @type {any} */ json, /** @type {{fields: FamilyField[]}} */ family) {
  /** @type {Record<string, {show: boolean}>} */
  const out = {};
  for (const fam of family.fields) {
    const f = json.fields.find((/** @type {any} */ x) => x.id === fam.id);
    if (f && fam.show === f.hide) out[fam.id] = { show: !f.hide };
  }
  return out;
}

/** Human-readable summary of how zones changed. */
export function summarize(/** @type {Record<string, Zone[]>} */ before, /** @type {Record<string, Zone[]>} */ after) {
  const lines = [];
  let maxDelta = 0;
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[id] || [], b = after[id] || [];
    const parts = [];
    if (b.length > a.length) parts.push(`+${b.length - a.length} zone(s) added`);
    if (b.length < a.length) parts.push(`-${a.length - b.length} zone(s) removed`);
    let fieldMax = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i].side !== b[i].side) parts.push(`zone ${i + 1} side ${a[i].side} -> ${b[i].side}`);
      for (const k of /** @type {const} */ (['x', 'y', 'w', 'h'])) fieldMax = Math.max(fieldMax, Math.abs(round4(b[i][k] - a[i][k])));
    }
    if (fieldMax > 0) parts.push(`max delta ${round4(fieldMax)}`);
    maxDelta = Math.max(maxDelta, fieldMax);
    if (parts.length) lines.push(`  ${id}: ${parts.join(', ')}`);
  }
  lines.push(lines.length ? `Max coordinate delta overall: ${round4(maxDelta)}` : 'No zone changes.');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const writeOverrides = args.includes('--overrides');
  const [input, targetArg] = args.filter(a => !a.startsWith('--'));
  if (!input) { console.error('Usage: node tools/import-template.mjs [--overrides] <editor.json> [templates/<id>.js]'); process.exit(2); }
  const fail = (/** @type {string[]} */ msgs) => { console.error(msgs.map(m => `error: ${m}`).join('\n')); process.exit(1); };

  const json = JSON.parse(readFileSync(input, 'utf8'));
  if (!json || typeof json.id !== 'string' || !/^[a-z0-9_]+$/.test(json.id)) fail(['JSON has no valid "id"']);
  const target = resolve(targetArg || join(ROOT, 'templates', `${json.id}.js`));
  let src = readFileSync(target, 'utf8');
  const version = parseTemplateSource(src);
  if (version.kind !== 'version') fail([`${target} is not a version file`]);
  const family = parseTemplateSource(readFileSync(join(dirname(target), `${version.family}.js`), 'utf8'));

  const errors = validateExport(json, family, version.id);
  if (errors.length) fail(errors);

  const zones = buildZones(json, family);
  src = replaceZones(src, zones);
  const diffs = hideDifferences(json, family, version.overrides || {});
  if (diffs.length) {
    if (writeOverrides) {
      src = replaceOverrides(src, overridesFromExport(json, family));
      console.log('Overrides rewritten to match the export:');
    } else console.warn('warning: hide flags differ from family defaults + overrides (overrides left unchanged; use --overrides to write them):');
    for (const d of diffs) console.log(`  ${d}`);
  }
  writeFileSync(target, src);
  console.log(`Imported ${json.id} into ${target}`);
  console.log(summarize(version.zones, zones));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
