// Seeded randomness of the redaction layers: stable redraws, different per seed and per zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const R = await import(join(ROOT, 'app/js/core/redact.js'));
const take = (rand, n) => Array.from({ length: n }, rand);

test('rng: same seed gives the same sequence, in [0, 1)', () => {
  const a = take(R.rng(42), 50), b = take(R.rng(42), 50);
  assert.deepEqual(a, b);
  assert.ok(a.every(x => x >= 0 && x < 1));
  assert.notDeepEqual(a, take(R.rng(43), 50));
});

test('hashSeed: depends on both the text and the secret seed', () => {
  assert.equal(R.hashSeed('dni:front:0', 7), R.hashSeed('dni:front:0', 7));
  assert.notEqual(R.hashSeed('dni:front:0', 7), R.hashSeed('dni:front:1', 7));
  assert.notEqual(R.hashSeed('dni:front:0', 7), R.hashSeed('dni:front:0', 8));
});
