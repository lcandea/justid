// Country calling codes (app/js/dial-codes.js) and the picker's search (app/js/dial-picker.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const DIAL_CODES = (await import(join(ROOT, 'app/js/dial-codes.js'))).default;
const P = await import(join(ROOT, 'app/js/dial-picker.js'));

test('dial code data: unique ISO codes, digit-only dial codes, well-known entries', () => {
  const isos = DIAL_CODES.map(([iso]) => iso);
  assert.equal(new Set(isos).size, isos.length, 'duplicate ISO code');
  assert.ok(DIAL_CODES.length > 200);
  for (const [iso, dial] of DIAL_CODES) {
    assert.match(iso, /^[A-Z]{2}$/);
    assert.match(dial, /^[1-9]\d{0,3}$/, iso);
  }
  const map = Object.fromEntries(DIAL_CODES);
  assert.deepEqual([map.ES, map.PT, map.FR, map.GB, map.US, map.MA, map.RO, map.AR, map.MX], ['34', '351', '33', '44', '1', '212', '40', '54', '52']);
});

test('flag emoji from the ISO code', () => {
  assert.equal(P.flagEmoji('ES'), String.fromCodePoint(0x1F1EA, 0x1F1F8));
  assert.equal(P.flagEmoji('gb'), String.fromCodePoint(0x1F1EC, 0x1F1E7));
});

test('country names come from Intl in the UI language, sorted by name', () => {
  const es = P.countryList('es'), en = P.countryList('en');
  assert.equal(es.find(c => c.iso === 'DE').name, 'Alemania');
  assert.equal(en.find(c => c.iso === 'DE').name, 'Germany');
  assert.equal(es.length, DIAL_CODES.length);
  const names = es.map(c => c.name);
  assert.deepEqual(names, [...names].sort(new Intl.Collator('es').compare));
});

test('search by name (accents and case ignored), ISO code, or dial prefix', () => {
  const es = P.countryList('es');
  assert.deepEqual(P.filterCountries(es, 'peru').map(c => c.iso), ['PE']); // "Perú"
  assert.equal(P.filterCountries(es, 'ESPA')[0].iso, 'ES');
  assert.equal(P.filterCountries(es, 'reino')[0].iso, 'GB'); // "Reino Unido"
  assert.equal(P.filterCountries(es, 'pt')[0].iso, 'PT');
  assert.equal(P.filterCountries(es, '+351')[0].iso, 'PT');
  assert.equal(P.filterCountries(es, '0034')[0].iso, 'ES');
  const by44 = P.filterCountries(es, '44').map(c => c.iso);
  assert.ok(by44.includes('GB'));
  assert.ok(by44.every(iso => Object.fromEntries(DIAL_CODES)[iso].startsWith('44')));
  assert.ok(P.filterCountries(es, '3').length > 20); // prefix match
  assert.ok(P.filterCountries(es, '1').slice(0, 5).every(c => c.dial === '1')); // exact code first
  assert.deepEqual(P.filterCountries(es, 'zzzz'), []);
  assert.equal(P.filterCountries(es, '  ').length, es.length);
});
