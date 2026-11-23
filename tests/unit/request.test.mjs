// Request links (app/js/core/request.js): fragment encode/decode, limits, and hostile input.
// Everything decoded from a link is untrusted; these tests pin down what gets through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const R = await import(join(ROOT, 'app/js/core/request.js'));
const { FAMILIES } = await import(join(ROOT, 'templates/index.js'));
const es = (await import(join(ROOT, 'locales/es.js'))).default;
const en = (await import(join(ROOT, 'locales/en.js'))).default;
const family = FAMILIES.find(f => f.id === 'dni_es');

/** A valid request; override parts per test. */
const base = (over = {}) => ({
  doc: 'dni_es', from: 'Inmobiliaria ABC', purpose: 'Alquiler de vivienda', fields: ['given_name', 'surnames', 'document_number'], back: false,
  delivery: { kind: 'whatsapp', value: '+34 600 11 22 33' }, why: '', ...over,
});
const enc = (over = {}) => R.encodeRequest(base(over), FAMILIES);
const dec = s => R.decodeRequest(s, FAMILIES);
/** Expect encodeRequest to throw a RequestError with `code`. */
const encFails = (over, code) => assert.throws(() => enc(over), e => e instanceof R.RequestError && e.code === code, code);
/** Decode a fragment built from key/value pairs (lets tests craft links the builder would never make). */
const decPairs = pairs => dec('#' + new URLSearchParams(pairs).toString());
const good = { req: '1', doc: 'dni_es', from: 'Ana', for: 'Alquiler', fields: 'given_name', wa: '34600112233' };

test('round trip: what the builder encodes is exactly what the app decodes', () => {
  const req = base({ fields: ['address', 'birth_place'], back: true, why: 'Lo exige el contrato de arrendamiento.',
    delivery: { kind: 'email', value: 'ana@example.com' } });
  const frag = R.encodeRequest(req, FAMILIES);
  const out = dec('#' + frag);
  assert.equal(out.ok, true);
  assert.deepEqual(out.request, { ...req, fields: ['address', 'birth_place'] });
  // without the leading # too
  assert.deepEqual(dec(frag), out);
});

test('the fragment is readable and has a fixed key order', () => {
  const frag = enc({ fields: ['address'], why: 'Contrato', back: true });
  assert.equal(frag, 'req=1&doc=dni_es&from=Inmobiliaria+ABC&for=Alquiler+de+vivienda&fields=address&back=1&wa=34600112233&why=Contrato');
});

test('each delivery method round-trips and is normalised', () => {
  assert.deepEqual(dec(enc()).request.delivery, { kind: 'whatsapp', value: '34600112233' });
  assert.deepEqual(dec(enc({ delivery: { kind: 'whatsapp', value: '0044 7700 900123' } })).request.delivery.value, '447700900123');
  assert.equal(dec(enc({ delivery: { kind: 'whatsapp', value: '612 345 678' } })).request.delivery.value, '612345678'); // taken as typed: no country is guessed
  assert.deepEqual(dec(enc({ delivery: { kind: 'email', value: ' a.b+c@sub.example.es ' } })).request.delivery, { kind: 'email', value: 'a.b+c@sub.example.es' });
  assert.deepEqual(dec(enc({ delivery: { kind: 'upload', value: 'https://Example.com/subir?x=1' } })).request.delivery,
    { kind: 'upload', value: 'https://example.com/subir?x=1' });
});

test('fields: deduplicated, catalogue order, unknown ids rejected', () => {
  assert.deepEqual(dec(enc({ fields: ['mrz', 'address', 'address', 'given_name'], why: 'x' })).request.fields, ['given_name', 'address', 'mrz']);
  encFails({ fields: ['address', 'password'] }, 'fields_unknown');
  encFails({ fields: 'address' }, 'fields_invalid');
  assert.deepEqual(decPairs({ ...good, fields: 'address,__proto__' }), { ok: false, error: 'fields_unknown' });
  assert.deepEqual(decPairs({ ...good, fields: 'address,' }), { ok: false, error: 'fields_unknown' });
});

test('extra (normally hidden) fields need a justification; default ones do not', () => {
  assert.deepEqual(R.extraFields(dec(enc({ fields: ['given_name', 'address'], why: 'x' })).request, family), ['address']);
  assert.equal(dec(enc({ fields: ['given_name', 'birth_date'] })).ok, true); // all shown by default
  encFails({ fields: ['address'] }, 'why_required');
  encFails({ fields: ['address'], why: '   \n ' }, 'why_required');
  assert.deepEqual(decPairs({ ...good, fields: 'address' }), { ok: false, error: 'why_required' });
});

test('length limits are enforced on encode and on decode', () => {
  const at = n => 'a'.repeat(n);
  for (const [key, param, limit] of [['from', 'from', 60], ['purpose', 'for', 80], ['why', 'why', 240]]) {
    assert.equal(R.LIMITS[key], limit);
    assert.equal(dec(enc({ [key]: at(limit) })).ok, true, `${key} at the limit`);
    encFails({ [key]: at(limit + 1) }, `${key}_too_long`);
    assert.deepEqual(decPairs({ ...good, [param]: at(limit + 1) }), { ok: false, error: `${key}_too_long` });
  }
  // limits count after whitespace is collapsed (a pasted paragraph is fine)
  assert.equal(dec(enc({ why: 'a\n\n\n'.repeat(80).trim() })).request.why, 'a '.repeat(80).trim());
  encFails({ delivery: { kind: 'email', value: at(250) + '@x.es' } }, 'email_invalid');
  encFails({ delivery: { kind: 'upload', value: 'https://x.es/' + at(300) } }, 'url_invalid');
});

test('the worst-case request (every text at its limit, all multi-byte) still fits the fragment limit', () => {
  const big = n => '漢'.repeat(n);
  const frag = enc({ from: big(60), purpose: big(80), why: big(240), fields: family.fields.map(f => f.id), back: true,
    delivery: { kind: 'upload', value: 'https://example.com/' + 'x'.repeat(270) } });
  assert.ok(frag.length <= R.LIMITS.fragment, `${frag.length}`);
  assert.equal(dec(frag).ok, true);
});

test('oversized fragments are rejected before parsing', () => {
  assert.deepEqual(dec('#req=1&x=' + 'a'.repeat(R.LIMITS.fragment)), { ok: false, error: 'too_long' });
  assert.equal(dec('#something-else-' + 'a'.repeat(R.LIMITS.fragment)), null); // not a request at all
});

test('required parts', () => {
  encFails({ from: '  ' }, 'from_required');
  encFails({ purpose: '' }, 'purpose_required');
  encFails({ delivery: null }, 'delivery_required');
  encFails({ delivery: { kind: 'whatsapp', value: ' ' } }, 'delivery_required');
  encFails({ delivery: { kind: 'fax', value: '123' } }, 'delivery_required');
  encFails({ doc: 'passport_es' }, 'doc_unsupported');
  encFails({ fields: [] }, 'fields_required');
  assert.deepEqual(decPairs({ ...good, fields: '' }), { ok: false, error: 'fields_required' });
  const { from, ...noFrom } = good;
  assert.deepEqual(decPairs(noFrom), { ok: false, error: 'from_required' });
  const { wa, ...noDelivery } = good;
  assert.deepEqual(decPairs(noDelivery), { ok: false, error: 'delivery_required' });
  assert.deepEqual(decPairs({ ...good, doc: 'dni_xx' }), { ok: false, error: 'doc_unsupported' });
});

test('not a request: empty or unrelated fragments decode to null', () => {
  for (const h of [undefined, null, '', '#', '#top', '#step=2', '#from=Ana&wa=34600112233']) assert.equal(dec(h), null, String(h));
});

test('malformed and hostile fragments are rejected, never half-applied', () => {
  const cases = [
    [{ ...good, req: '2' }, 'version_unsupported'],
    [{ ...good, back: 'yes' }, 'back_invalid'],
    [{ ...good, mail: 'ana@example.com' }, 'delivery_multiple'], // wa + mail: which one?
    [{ ...good, wa: '+34 600' }, 'phone_invalid'],
    [{ ...good, wa: '34600112233?text=hola' }, 'phone_invalid'],
    [{ ...good, wa: '0' }, 'phone_invalid'],
  ];
  for (const [pairs, error] of cases) assert.deepEqual(decPairs(pairs), { ok: false, error }, JSON.stringify(pairs));
  // a repeated key could show one value and use another
  assert.deepEqual(dec('#req=1&doc=dni_es&from=Ana&from=Banco&for=x&wa=34600112233'), { ok: false, error: 'duplicate_key' });
  assert.deepEqual(dec('#req=1&req=1&doc=dni_es&from=Ana&for=x&wa=34600112233'), { ok: false, error: 'duplicate_key' });
  // broken percent-encoding must not throw
  assert.doesNotThrow(() => dec('#req=1&doc=dni_es&from=%E0%A4%A&for=%&wa=34600112233'));
  // unknown keys are ignored (they are never shown nor used)
  assert.equal(decPairs({ ...good, extra: '<script>' }).ok, true);
});

test('email addresses that could inject mailto: headers are rejected', () => {
  const { wa, ...noWa } = good;
  for (const v of ['a@b.es?cc=x@y.es', 'a@b.es&bcc=x@y.es', 'a%40b@c.es', '"a b"@c.es', 'a@b', 'a@-b.es', 'a@b..es', 'a@1.2.3.4', 'a@b.es\nBcc: x@y.es', '@b.es']) {
    encFails({ delivery: { kind: 'email', value: v } }, 'email_invalid');
    assert.deepEqual(decPairs({ ...noWa, mail: v }), { ok: false, error: 'email_invalid' }, v);
  }
  assert.equal(decPairs({ ...noWa, mail: 'ana@example.com' }).ok, true);
});

test('upload links: https only, no credentials, real host names', () => {
  for (const v of ['http://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pw@example.com/', 'https://localhost/',
    'https://192.168.1.1/', 'ftp://example.com/', 'https:///nohost', 'example.com/up', 'https://exa mple.com/']) {
    encFails({ delivery: { kind: 'upload', value: v } }, 'url_invalid');
  }
  // international look-alike domains are shown in their real (punycode) form
  const out = dec(enc({ delivery: { kind: 'upload', value: 'https://\u0435xample.com/' } })); // Cyrillic "\u0435"
  assert.equal(R.uploadHost(out.request.delivery.value), 'xn--xample-2of.com');
});

test('control and bidi-override characters are rejected (they can disguise text)', () => {
  for (const ch of ['\u0000', '\u0007', '\u202E', '\u2066', '\u200F', '\u061C', '\u200B']) {
    encFails({ from: `Ana${ch}Banco` }, 'from_chars');
    assert.deepEqual(decPairs({ ...good, for: `x${ch}y` }), { ok: false, error: 'purpose_chars' });
  }
  encFails({ delivery: { kind: 'upload', value: 'https://example.com/\u202Efdp.exe' } }, 'url_invalid');
});

test('markup survives as literal text: decoding never strips or interprets it', () => {
  const why = '<img src=x onerror=alert(1)> & <b>bold</b> "quotes"';
  const out = dec(enc({ fields: ['address'], why, from: '<script>x</script>' }));
  assert.equal(out.request.why, why);
  assert.equal(out.request.from, '<script>x</script>');
});

test('delivery links: wa.me / mailto: / https with the message safely encoded', () => {
  const msg = { subject: 'Copia & DNI?', body: 'Hola\nAdjunto #1 & más' };
  assert.equal(R.deliveryHref({ kind: 'whatsapp', value: '34600112233' }, msg),
    'https://wa.me/34600112233?text=Hola%0AAdjunto%20%231%20%26%20m%C3%A1s');
  assert.equal(R.deliveryHref({ kind: 'email', value: 'ana@example.com' }, msg),
    'mailto:ana@example.com?subject=Copia%20%26%20DNI%3F&body=Hola%0AAdjunto%20%231%20%26%20m%C3%A1s');
  assert.equal(R.deliveryHref({ kind: 'upload', value: 'https://example.com/up' }, msg), 'https://example.com/up');
  // re-validated at the point of use too
  assert.throws(() => R.deliveryHref({ kind: 'upload', value: 'javascript:alert(1)' }, msg));
  assert.throws(() => R.deliveryHref({ kind: 'email', value: 'a@b.es?bcc=c@d.es' }, msg));
  const share = R.shareLinkHrefs('https://justid.example/app/#req=1&x=1', { subject: 'S', body: 'B' });
  assert.equal(share.whatsapp, 'https://wa.me/?text=B%0Ahttps%3A%2F%2Fjustid.example%2Fapp%2F%23req%3D1%26x%3D1');
  assert.equal(share.email, 'mailto:?subject=S&body=B%0Ahttps%3A%2F%2Fjustid.example%2Fapp%2F%23req%3D1%26x%3D1');
});

test('every builder error and delivery kind has a message in both languages', () => {
  for (const code of R.BUILDER_ERRORS) for (const d of [es, en]) assert.ok(`request.error.${code}` in d, `request.error.${code}`);
  for (const kind of ['whatsapp', 'email', 'upload']) {
    for (const prefix of ['request.delivery_', 'request.open_', 'request.send_hint_', 'builder.delivery_', 'builder.contact_', 'builder.contact_placeholder_']) {
      assert.ok(`${prefix}${kind}` in es, `${prefix}${kind}`);
    }
  }
});

test('wording: credits INCIBE and the AEPD, never claims a government recommendation', () => {
  assert.match(es['request.normal'], /solo te pide los datos que normalmente se comparten \(según las recomendaciones de INCIBE y la AEPD\)/);
  assert.match(es['request.extras_lead'], /te pide estos datos extra/);
  assert.match(es['request.why_lead'], /Su justificación es/);
  for (const d of [es, en]) {
    for (const [k, v] of Object.entries(d)) {
      if (!k.startsWith('request.') && !k.startsWith('builder.')) continue;
      assert.doesNotMatch(v, /gobierno|government|ministerio|ministry|policía|police/i, `${k}: ${v}`);
    }
  }
});

test('request code renders decoded text only as text (no innerHTML, no HTML parsing)', () => {
  for (const f of ['app/js/core/request.js', 'app/js/ui/request-view.js', 'app/js/ui/request-page.js', 'app/js/ui/dial-picker.js']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/, f);
  }
});

test('a request may ask for fewer fields than the usual ones, but not for none', () => {
  const out = dec(enc({ fields: ['given_name', 'document_number'] }));
  assert.deepEqual(out.request.fields, ['given_name', 'document_number']);
  assert.deepEqual(R.extraFields(out.request, family), []); // still within what is normally shared
  encFails({ fields: [] }, 'fields_required');
});

test('composePhone joins the picked dial code and the typed number', () => {
  assert.equal(R.composePhone('34', '600 11 22 33'), '34600112233');
  assert.equal(R.composePhone('351', '912-345-678'), '351912345678');
  assert.equal(R.composePhone('44', '07700 900123'), '447700900123'); // national trunk 0 dropped
  assert.equal(R.composePhone('39', '06 1234 5678'), '390612345678'); // Italy keeps it
  assert.equal(R.composePhone('34', '+44 7700 900123'), '447700900123'); // typed its own prefix: wins
  assert.equal(R.composePhone('34', '0044 7700 900123'), '447700900123');
  for (const [dial, n] of [['34', '600abc'], ['34', '12'], ['x', '600112233'], ['34', '+'], ['0', '600112233']]) {
    assert.throws(() => R.composePhone(dial, n), e => e.code === 'phone_invalid', `${dial} ${n}`);
  }
});
