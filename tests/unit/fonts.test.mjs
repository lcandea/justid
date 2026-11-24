// The self-hosted fonts must be real WOFF2 files. A placeholder once shipped instead of JetBrains Mono and every
// mono label silently fell back to a system font.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, walk } from './helpers.mjs';

test('every shipped .woff2 is a real WOFF2 font', () => {
  const fonts = walk('shared/fonts', '.woff2');
  assert.ok(fonts.length > 0, 'no fonts found in shared/fonts');
  for (const file of fonts) {
    const buf = readFileSync(file);
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', `${relative(ROOT, file)} is not a WOFF2 file`);
    assert.ok(buf.length > 10_000, `${relative(ROOT, file)} is suspiciously small (${buf.length} bytes)`);
  }
});

test('every @font-face in the theme points to a font file that exists', () => {
  const css = readFileSync(`${ROOT}/shared/theme.css`, 'utf8');
  const urls = [...css.matchAll(/url\('([^']+\.woff2)'\)/g)].map(m => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) assert.doesNotThrow(() => readFileSync(`${ROOT}/shared/${url}`), `missing shared/${url}`);
});
