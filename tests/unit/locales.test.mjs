// Translation checks: both languages have the same keys, and every key the code uses exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, walk } from './helpers.mjs';

const es = (await import(join(ROOT, 'locales/es.js'))).default;
const en = (await import(join(ROOT, 'locales/en.js'))).default;
const { FAMILIES, VERSIONS } = await import(join(ROOT, 'templates/index.js'));

test('es and en have exactly the same keys, none empty', () => {
  const a = Object.keys(es).sort(), b = Object.keys(en).sort();
  assert.deepEqual(a.filter(k => !(k in en)), [], 'keys missing in en');
  assert.deepEqual(b.filter(k => !(k in es)), [], 'keys missing in es');
  for (const [k, v] of [...Object.entries(es), ...Object.entries(en)]) assert.ok(String(v).trim(), `empty translation: ${k}`);
});

test('placeholders match between languages', () => {
  const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const k of Object.keys(es)) assert.equal(ph(en[k]), ph(es[k]), `placeholder mismatch in ${k}`);
});

test('every data-i18n key used in HTML exists', () => {
  for (const file of walk('app', '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(m[1] in es, `${file}: unknown key ${m[1]}`);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(';')) assert.ok(pair.split(':')[1]?.trim() in es, `${file}: unknown key in ${pair}`);
    }
  }
});

test("every literal t('key') used in JS exists", () => {
  for (const file of walk('app/js', '.js')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_.]+)'\s*[,)]/g)) assert.ok(m[1] in es, `${file}: unknown key ${m[1]}`);
  }
});

test('dynamic keys exist: field labels, template names, sides, purpose chips', () => {
  for (const fam of FAMILIES) for (const f of fam.fields) assert.ok(`field.${f.id}` in es, `missing field.${f.id}`);
  for (const v of VERSIONS) assert.ok(`template.${v.id}` in es, `missing template.${v.id}`);
  for (const s of ['front', 'back']) assert.ok(`side.${s}` in es);
  const app = readFileSync(join(ROOT, 'app/js/app.js'), 'utf8');
  const chips = app.match(/PURPOSE_CHIPS = \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
  for (const c of chips) assert.ok(`purpose.chip.${c}` in es, `missing purpose.chip.${c}`);
});
