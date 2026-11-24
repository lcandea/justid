// The landing's demo video player (landing/landing.js) builds file names from flow × language × aspect:
// every combination must exist in landing/video/, with its poster, and stay small enough for the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { ROOT } from './helpers.mjs';

test('every demo video the landing can ask for exists, with a poster, under 4 MB', () => {
  for (const flow of ['send', 'request']) for (const lang of ['es', 'en']) for (const aspect of ['9x16', '16x9']) {
    const base = `${ROOT}/landing/video/justid-${flow}-${lang}-${aspect}`;
    assert.ok(existsSync(`${base}.mp4`), `missing ${base}.mp4`);
    assert.ok(existsSync(`${base}.jpg`), `missing ${base}.jpg`);
    assert.ok(statSync(`${base}.mp4`).size < 4 * 1024 * 1024, `${base}.mp4 is over 4 MB`);
  }
});
