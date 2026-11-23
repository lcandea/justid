// Architecture guard: app/js/core is pure logic (no page, no storage, no i18n); everything that
// touches the page lives in app/js/ui. See README "Project structure".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, walk } from './helpers.mjs';

const coreFiles = walk('app/js/core', '.js');
/** Remove comments so prose such as "the page" or a URL in a comment can't trip the checks. */
const code = file => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const rel = file => relative(ROOT, file);

const FORBIDDEN = [
  [/\bwindow\b/, 'window'], [/\blocalStorage\b/, 'localStorage'], [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bnavigator\b/, 'navigator'], [/\blocation\b/, 'location'], [/\baddEventListener\b/, 'addEventListener'],
  [/\bdocument\s*\.\s*(querySelector\w*|getElementById|getElementsBy\w+|body|documentElement|activeElement)\b/, 'document DOM access'],
  [/\bt\s*\(/, 't( (translation)'], [/\bgetLang\b/, 'getLang'], [/\binnerHTML\b/, 'innerHTML'],
];

test('core/ is not empty and holds only .js files and no sub-folders', () => {
  const entries = readdirSync(join(ROOT, 'app/js/core'), { withFileTypes: true });
  assert.ok(coreFiles.length >= 10);
  assert.ok(entries.every(e => e.isFile() && e.name.endsWith('.js')));
});

test('core/ never imports from ui/ or i18n (or anything outside core/ and templates/)', () => {
  for (const file of coreFiles) {
    const src = code(file);
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"\n;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/gm)) {
      const spec = m[1] || m[2] || m[3];
      assert.doesNotMatch(spec, /\/ui\/|i18n|locales\//, `${rel(file)} imports ${spec}`);
      assert.match(spec, /^(\.\/[\w-]+\.js|\.\.\/\.\.\/\.\.\/templates\/index\.js)$/, `${rel(file)}: unexpected import ${spec}`);
    }
  }
});

test('core/ does not touch the page, storage, navigation or translations', () => {
  for (const file of coreFiles) {
    const src = code(file);
    for (const [re, name] of FORBIDDEN) assert.doesNotMatch(src, re, `${rel(file)} uses ${name}`);
  }
});

test('the only `document` use in core/ is creating a canvas in core/canvas.js', () => {
  for (const file of coreFiles) {
    const uses = [...code(file).matchAll(/\bdocument\b[^;\n]*/g)].map(m => m[0]);
    if (file.endsWith('/core/canvas.js')) {
      assert.deepEqual(uses, ["document.createElement('canvas')"], 'canvas.js may only create canvases');
    } else assert.deepEqual(uses, [], `${rel(file)} uses document: create canvases with createCanvas() from canvas.js`);
  }
});

test('core/ has no module-level mutable state (let / var at top level, caches)', () => {
  for (const file of coreFiles) {
    const src = code(file);
    assert.doesNotMatch(src, /^(let|var)\s/m, `${rel(file)}: top-level let/var`);
    assert.doesNotMatch(src, /^const \w+ = new (Map|Set|WeakMap)\(\)/m, `${rel(file)}: top-level cache (an empty Map/Set filled later)`);
  }
});

test('ui/ files do not import across pages (controllers are only entered from their HTML)', () => {
  for (const file of walk('app/js/ui', '.js')) {
    for (const m of code(file).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(m[1], /request-page\.js|\/editor\.js|\/ui\/app\.js|^\.\/app\.js$/, `${rel(file)} imports a page controller`);
    }
  }
});

test('every HTML page loads its controller from ui/', () => {
  const scripts = { 'index.html': 'js/ui/app.js', 'request.html': 'js/ui/request-page.js', 'editor.html': 'js/ui/editor.js' };
  for (const [page, src] of Object.entries(scripts)) {
    assert.match(readFileSync(join(ROOT, 'app', page), 'utf8'), new RegExp(`<script type="module" src="${src}"></script>`));
  }
});
