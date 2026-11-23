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
  for (const file of [...walk('app', '.html'), `${ROOT}/index.html`]) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(m[1] in es, `${file}: unknown key ${m[1]}`);
    for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(';')) assert.ok(pair.split(':')[1]?.trim() in es, `${file}: unknown key in ${pair}`);
    }
  }
});

test("every literal t('key') used in JS exists", () => {
  for (const file of [...walk('app/js', '.js'), ...walk('landing', '.js')]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_.]+)'\s*[,)]/g)) assert.ok(m[1] in es, `${file}: unknown key ${m[1]}`);
  }
});

test('dynamic keys exist: field labels, template names, sides, purpose chips', () => {
  for (const fam of FAMILIES) for (const f of fam.fields) assert.ok(`field.${f.id}` in es, `missing field.${f.id}`);
  for (const v of VERSIONS) assert.ok(`template.${v.id}` in es, `missing template.${v.id}`);
  for (const s of ['front', 'back']) assert.ok(`side.${s}` in es);
  for (const file of ['app/js/app.js', 'app/js/request-page.js']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    const chips = src.match(/PURPOSE_CHIPS = \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map(s => s.slice(1, -1));
    for (const c of chips) assert.ok(`purpose.chip.${c}` in es, `${file}: missing purpose.chip.${c}`);
  }
});

test('landing strings are all prefixed and live in the landing locale files', async () => {
  const landingEs = (await import(join(ROOT, 'locales/landing-es.js'))).default;
  const landingEn = (await import(join(ROOT, 'locales/landing-en.js'))).default;
  for (const k of [...Object.keys(landingEs), ...Object.keys(landingEn)]) assert.match(k, /^landing\./, `unprefixed landing key ${k}`);
  for (const k of Object.keys(landingEs)) assert.equal(es[k], landingEs[k], `${k} not merged into es.js`);
  for (const k of Object.keys(landingEn)) assert.equal(en[k], landingEn[k], `${k} not merged into en.js`);
});

test('the landing "shown / covered by default" lists match the show flags of templates/dni_es.js', () => {
  const fields = Object.fromEntries(FAMILIES.find(f => f.id === 'dni_es').fields.map(f => [f.id, f.show]));
  // Landing list: name and surnames are one line; the hidden list names the fields below.
  const shown = ['given_name', 'surnames', 'document_number', 'photo', 'birth_date', 'expiry_date'];
  const covered = ['signature', 'support_number', 'can', 'address', 'birth_place', 'parents_names', 'sex', 'nationality', 'issue_date', 'mrz'];
  assert.deepEqual(Object.keys(fields).filter(k => fields[k]).sort(), [...shown].sort(), 'fields shown by default changed: update the landing table');
  for (const id of covered) assert.equal(fields[id], false, `${id} is shown by default but the landing says it is covered`);
  assert.equal(Object.keys(es).filter(k => /^landing\.defaults\.s\d+$/.test(k)).length, 5);
  assert.equal(Object.keys(es).filter(k => /^landing\.defaults\.h\d+$/.test(k)).length, covered.length);
});
