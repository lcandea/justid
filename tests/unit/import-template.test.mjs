// Pure-function checks for tools/import-template.mjs (validation and rendering).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { validateExport, buildZones, renderZones, replaceZones, replaceOverrides, hideDifferences, overridesFromExport, summarize, parseTemplateSource } from '../../tools/import-template.mjs';

const family = { id: 'f', fields: [{ id: 'a', show: true }, { id: 'b', show: false }] };
const z = { side: 'front', x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
const good = { id: 'v', fields: [{ id: 'b', hide: true, zones: [z] }, { id: 'a', hide: false, zones: [z, { ...z, side: 'back' }] }] };

test('valid export passes; errors are reported clearly', () => {
  assert.deepEqual(validateExport(good, family, 'v'), []);
  assert.match(validateExport(good, family, 'other')[0], /does not match/);
  const bad = { id: 'v', fields: [
    { id: 'zzz', hide: false, zones: [z] },
    { id: 'a', hide: false, zones: [{ ...z, side: 'top' }, { ...z, x: 0.9 }, { ...z, y: -0.1 }, { ...z, w: 2 }] },
  ] };
  const msgs = validateExport(bad, family, 'v').join('\n');
  assert.match(msgs, /"zzz": not in family/);
  assert.match(msgs, /side must be front or back/);
  assert.match(msgs, /x\+w = 1.2 exceeds 1/);
  assert.match(msgs, /y must be a number in 0-1/);
  assert.match(msgs, /w must be a number in 0-1/);
});

test('buildZones follows catalogue order and rounds to 4 decimals', () => {
  const out = buildZones({ fields: [{ id: 'b', zones: [{ ...z, x: 0.123456 }] }, { id: 'a', zones: [z] }] }, family);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.equal(out.b[0].x, 0.1235);
});

test('replaceZones keeps everything else and round-trips through the parser', () => {
  const src = readFileSync(join(ROOT, 'templates', 'dni_es_v4.js'), 'utf8');
  const before = parseTemplateSource(src);
  assert.equal(replaceZones(src, before.zones), src); // idempotent: same formatting style
  const parsed = parseTemplateSource(replaceZones(src, { a: [z] }));
  assert.deepEqual(parsed.zones, { a: [z] });
  assert.deepEqual({ ...parsed, zones: null }, { ...before, zones: null });
  assert.ok(renderZones({ a: [z] }).includes('{ "side": "front", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 }'));
});

test('hide differences are detected, and overrides can be derived', () => {
  const json = { fields: [{ id: 'a', hide: true }, { id: 'b', hide: true }] };
  assert.equal(hideDifferences(json, family, {}).length, 1);
  assert.equal(hideDifferences(json, family, { a: { show: false } }).length, 0);
  assert.deepEqual(overridesFromExport(json, family), { a: { show: false } });
  assert.equal(replaceOverrides('  "overrides": {},\n', { a: { show: false } }), '  "overrides": {"a":{"show":false}},\n');
});

test('summarize reports added/removed zones and max delta', () => {
  const out = summarize({ a: [z], b: [z] }, { a: [{ ...z, x: 0.15 }, z], b: [] });
  assert.match(out, /a: \+1 zone\(s\) added, max delta 0.05/);
  assert.match(out, /b: -1 zone\(s\) removed/);
  assert.match(summarize({ a: [z] }, { a: [z] }), /No zone changes/);
});
