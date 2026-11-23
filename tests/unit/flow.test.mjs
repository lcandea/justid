// Pure rules extracted from the page: flow (visibility, request effects, checks, steps),
// watermark / PDF caption text, request builder rules, template helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const F = await import(join(ROOT, 'app/js/core/flow.js'));
const W = await import(join(ROOT, 'app/js/core/watermark.js'));
const B = await import(join(ROOT, 'app/js/core/request-builder.js'));
const T = await import(join(ROOT, 'app/js/core/templates.js'));
const R = await import(join(ROOT, 'app/js/core/request.js'));
const { FAMILIES } = await import(join(ROOT, 'templates/index.js'));
const es = (await import(join(ROOT, 'locales/es.js'))).default;

const dni = FAMILIES.find(f => f.id === 'dni_es');
const official = T.officialTemplates();
const v4 = official.find(x => x.id === 'dni_es_v4');
const shown = dni.fields.filter(f => f.show).map(f => f.id);
const hiddenByDefault = dni.fields.filter(f => !f.show).map(f => f.id);
const mkRequest = (fields, back = false) => R.validateRequest({
  doc: 'dni_es', from: 'Ana', purpose: 'Alquiler', fields, back, delivery: { kind: 'email', value: 'a@b.es' }, why: 'because',
}, FAMILIES);
const none = F.requestContext(null, FAMILIES);

/* ---------- watermark and caption ---------- */
const onlyFor = p => `solo para ${p}`;
test('watermark: upper-case "only for purpose · recipient · date"; empty without a purpose', () => {
  assert.equal(W.watermarkText({ purpose: ' alquiler ', recipient: ' Ana ', date: '1/2/2026', onlyFor }), 'SOLO PARA ALQUILER · ANA · 1/2/2026');
  assert.equal(W.watermarkText({ purpose: 'gym', recipient: '', date: '1/2/2026', onlyFor }), 'SOLO PARA GYM · 1/2/2026');
  assert.equal(W.watermarkText({ purpose: '   ', recipient: 'Ana', date: 'x', onlyFor }), '');
});

test('PDF caption and file name are composed from the translate function', () => {
  const tr = (key, p = {}) => `${key}:${Object.values(p).join('|')}`;
  assert.deepEqual(W.pdfCaption({ purpose: ' gym ', recipient: ' Ana ', date: 'D' }, tr),
    ['pdf.caption_purpose:gym', 'pdf.caption_date:pdf.caption_recipient:Ana|D']);
  assert.deepEqual(W.pdfCaption({ purpose: 'gym', recipient: ' ', date: 'D' }, tr)[1], 'pdf.caption_date:|D');
  assert.equal(W.pdfFileName(tr, new Date('2026-03-04T10:00:00Z')), 'pdf.filename:2026-03-04');
});

/* ---------- field visibility ---------- */
test('without a request, fields start hidden exactly as the template says', () => {
  const hidden = F.initialHidden(v4, none, new Set());
  for (const f of v4.fields) assert.equal(hidden.has(f.id), f.hide, f.id);
  assert.ok(hidden.size > 0 && hidden.size < v4.fields.length);
});

test('with a request, only requested fields start shown; extras need acceptance', () => {
  const extra = hiddenByDefault.find(id => v4.fields.some(f => f.id === id));
  const ctx = F.requestContext(mkRequest([shown[0], extra]), FAMILIES);
  assert.deepEqual([...ctx.extras], [extra]);
  const hidden = F.initialHidden(v4, ctx, new Set());
  assert.equal(hidden.has(shown[0]), false, 'requested usual field is shown');
  assert.equal(hidden.has(extra), true, 'requested extra field waits for the user');
  for (const f of v4.fields) if (![shown[0], extra].includes(f.id)) assert.ok(hidden.has(f.id), `${f.id} was not asked for`);
  assert.equal(F.initialHidden(v4, ctx, new Set([extra])).has(extra), false, 'accepted extra is shown');
});

test('requestNeedsBack: asked for explicitly or implied by a back-only field', () => {
  assert.equal(F.requestNeedsBack(v4, none), false);
  const front = shown.find(id => v4.fields.find(f => f.id === id)?.zones.every(z => z.side === 'front'));
  assert.equal(F.requestNeedsBack(v4, F.requestContext(mkRequest([front]), FAMILIES)), false);
  assert.equal(F.requestNeedsBack(v4, F.requestContext(mkRequest([front], true), FAMILIES)), true);
  const backOnly = v4.fields.find(f => f.zones.length && f.zones.every(z => z.side === 'back')).id;
  const ctx = F.requestContext(mkRequest([backOnly], false), FAMILIES);
  assert.equal(F.requestNeedsBack(v4, ctx), true);
});

test('fieldsBySide groups by the first zone; fieldAtPoint picks the smallest zone under the point', () => {
  const groups = F.fieldsBySide(v4);
  assert.equal(groups.front.length + groups.back.length, v4.fields.length);
  for (const f of groups.back) assert.equal(f.zones[0].side, 'back');
  const tpl = { fields: [
    { id: 'big', hide: true, zones: [{ side: 'front', x: 0, y: 0, w: 1, h: 1 }] },
    { id: 'small', hide: true, zones: [{ side: 'front', x: .4, y: .4, w: .2, h: .2 }, { side: 'back', x: 0, y: 0, w: 1, h: 1 }] },
  ] };
  assert.equal(F.fieldAtPoint(tpl, 'front', .5, .5).id, 'small');
  assert.equal(F.fieldAtPoint(tpl, 'front', .1, .1).id, 'big');
  assert.equal(F.fieldAtPoint(tpl, 'back', .5, .5).id, 'small');
  assert.equal(F.fieldAtPoint({ fields: [] }, 'front', .5, .5), null);
});

test('hiddenFieldCount only counts fields with a zone on a photographed side', () => {
  const tpl = { fields: [
    { id: 'a', hide: true, zones: [{ side: 'front' }] }, { id: 'b', hide: true, zones: [{ side: 'back' }] },
    { id: 'c', hide: false, zones: [{ side: 'front' }] }, { id: 'd', hide: true, zones: [{ side: 'front' }, { side: 'back' }] },
  ] };
  const hidden = new Set(['a', 'b', 'd']);
  assert.equal(F.hiddenFieldCount(tpl, hidden, ['front']), 2);
  assert.equal(F.hiddenFieldCount(tpl, hidden, ['front', 'back']), 3);
  assert.equal(F.hiddenFieldCount(tpl, hidden, []), 0);
});

/* ---------- photo checks ---------- */
test('cardsByRealSide: a wrong-side photo counts as the other side unless accepted', () => {
  const A = { n: 'A' }, Bc = { n: 'B' };
  const no = { front: false, back: false };
  assert.deepEqual(F.cardsByRealSide({ front: A, back: null }, no, no), { front: A });
  assert.deepEqual(F.cardsByRealSide({ front: A, back: null }, { front: true, back: false }, no), { back: A });
  assert.deepEqual(F.cardsByRealSide({ front: A, back: null }, { front: true, back: false }, { front: true, back: false }), { front: A });
  assert.deepEqual(F.cardsByRealSide({ front: A, back: Bc }, { front: true, back: true }, no), { back: A, front: Bc }); // swapped
});

test('pendingSideSlot and pendingVersion', () => {
  const base = { front: {}, back: null };
  assert.equal(F.pendingSideSlot(base, { front: true, back: false }, { front: false, back: false }), 'front');
  assert.equal(F.pendingSideSlot(base, { front: true, back: false }, { front: true, back: false }), undefined);
  assert.equal(F.pendingSideSlot(base, { front: false, back: true }, { front: false, back: false }), undefined, 'empty slot');
  const [a, b] = official;
  assert.equal(F.pendingVersion(b, a, null), b);
  assert.equal(F.pendingVersion(a, a, null), null, 'already chosen');
  assert.equal(F.pendingVersion(b, a, b.id), null, 'dismissed');
  assert.equal(F.pendingVersion(null, a, null), null);
});

/* ---------- steps ---------- */
test('canAdvance, reachableStep and navLabelKey', () => {
  const none = { hasPhotos: false, purpose: ' ' }, ok = { hasPhotos: true, purpose: 'gym' };
  assert.equal(F.canAdvance(0, none), false);
  assert.equal(F.canAdvance(0, ok), true);
  assert.equal(F.canAdvance(1, none), true);
  assert.equal(F.canAdvance(2, none), false);
  assert.equal(F.canAdvance(2, ok), true);
  const can = o => i => F.canAdvance(i, o);
  assert.equal(F.reachableStep(3, can(none)), 0);
  assert.equal(F.reachableStep(3, can({ hasPhotos: true, purpose: '' })), 2);
  assert.equal(F.reachableStep(99, can(ok)), F.STEPS - 1);
  assert.equal(F.reachableStep(-4, can(ok)), 0);
  assert.equal(F.navLabelKey(0, false, true), 'nav.need_photo');
  assert.equal(F.navLabelKey(2, false, true), 'nav.need_purpose');
  assert.equal(F.navLabelKey(1, true, true), 'nav.next');
  assert.equal(F.navLabelKey(3, true, true), 'share.share_pdf');
  assert.equal(F.navLabelKey(3, true, false), 'share.download_pdf');
  for (const k of ['nav.need_photo', 'nav.need_purpose', 'nav.next', 'share.share_pdf', 'share.download_pdf']) assert.ok(k in es, k);
  assert.equal(F.otherSide('front'), 'back');
});

/* ---------- request builder ---------- */
test('request builder: default and extra fields, back-only fields force the back', () => {
  assert.deepEqual([...B.defaultFields(dni)].sort(), [...shown].sort());
  const versions = official.filter(x => x.family === 'dni_es');
  const backOnly = B.backOnlyFields(dni, versions);
  assert.ok(backOnly.size > 0);
  for (const id of backOnly) for (const v of versions) for (const z of v.fields.find(f => f.id === id)?.zones || []) assert.equal(z.side, 'back');
  assert.equal(B.backForced(new Set(shown.filter(id => !backOnly.has(id))), backOnly), false);
  assert.equal(B.backForced(new Set([...backOnly].slice(0, 1)), backOnly), true);
  assert.deepEqual(B.tickedExtras(dni, new Set([...shown, hiddenByDefault[0]])), [hiddenByDefault[0]]);
  assert.deepEqual(B.tickedExtras(dni, new Set(shown)), []);
});

test('request builder: whole phone and error keys', () => {
  assert.equal(B.wholePhone('34', ' '), '');
  assert.equal(B.wholePhone('34', '600 11 22 33'), '34600112233');
  assert.throws(() => B.wholePhone('34', 'abc'), e => e.code === 'phone_invalid');
  for (const code of R.BUILDER_ERRORS) assert.ok(B.builderErrorKey(code) in es, code);
  assert.equal(B.builderErrorKey('whatever'), 'request.error.generic');
  assert.ok('request.error.generic' in es);
});

/* ---------- template helpers ---------- */
test('mergeTemplates: official first, custom ones with a clashing id are dropped', () => {
  const o = [{ id: 'a' }, { id: 'b' }], c = [{ id: 'b', custom: true }, { id: 'c', custom: true }];
  assert.deepEqual(T.mergeTemplates(o, c).map(x => x.id), ['a', 'b', 'c']);
  assert.equal(T.mergeTemplates(o, c)[1].custom, undefined);
});

test('normalizeCustom validates, filters bad zones and throws InvalidTemplateError', () => {
  assert.throws(() => T.normalizeCustom(null), T.InvalidTemplateError);
  assert.throws(() => T.normalizeCustom({ id: 'x' }), T.InvalidTemplateError);
  const tpl = T.normalizeCustom({ id: 'x', fields: [{ id: 'f', hide: 1, zones: [{ side: 'front', x: '0.1', y: 0, w: 1, h: 1 }, { side: 'left' }] }] });
  assert.equal(tpl.name, 'x'); assert.equal(tpl.custom, true);
  assert.deepEqual(tpl.fields, [{ id: 'f', label: undefined, hide: true, zones: [{ side: 'front', x: 0.1, y: 0, w: 1, h: 1 }] }]);
});

test('toFlatJson uses the given names; flat JSON survives normalizeCustom', () => {
  const names = { templateName: x => `N:${x.id}`, fieldLabel: f => `L:${f.id}` };
  const flat = T.toFlatJson(v4, names);
  assert.equal(flat.name, 'N:dni_es_v4');
  assert.ok(flat.fields.every(f => f.label === `L:${f.id}`));
  const back = T.normalizeCustom(JSON.parse(JSON.stringify(flat)));
  assert.equal(back.fields.length, v4.fields.length);
});

test('toVersionModule keeps visibility that differs from the family as an override', () => {
  const tpl = structuredClone(v4);
  const f = tpl.fields[0]; f.hide = !f.hide;
  const src = T.toVersionModule(tpl);
  const data = JSON.parse(src.match(/export default (\{[\s\S]*\});/)[1]);
  assert.equal(data.id, 'dni_es_v4');
  assert.deepEqual(data.overrides[f.id], { show: !f.hide });
  assert.throws(() => T.toVersionModule({ ...tpl, family: 'nope' }));
});

test('slug and fieldColor', () => {
  assert.equal(T.slug('  Número de Soporte! '), 'numero_de_soporte');
  assert.equal(T.slug('###'), 'field');
  assert.equal(T.fieldColor('photo'), T.fieldColor('photo'));
  assert.match(T.fieldColor('photo'), /^hsl\(\d+ 85% 50%\)$/);
});
