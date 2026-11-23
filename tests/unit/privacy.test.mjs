// Privacy guards on the source code itself. The CSP already blocks network access at runtime;
// these make sure nobody adds code that tries, or weakens the policy, without a test failing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, walk } from './helpers.mjs';
import { relative } from 'node:path';

const shipped = [...walk('app', '.js'), ...walk('landing', '.js'), ...walk('locales', '.js'), ...walk('templates', '.js')];
const pages = [...walk('app', '.html'), `${ROOT}/index.html`, `${ROOT}/404.html`];

test('no network APIs anywhere in the shipped JavaScript', () => {
  const apiNames = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /RTCPeerConnection/,
    /\bnew\s+Worker\s*\(/, /serviceWorker/];
  const remoteImports = [/\bimport\s*\(\s*['"`]https?:/, /from\s+['"]https?:/];
  for (const file of shipped) {
    const src = readFileSync(file, 'utf8');
    // Locale files are translated text only; they may name these APIs (the landing's "ask an AI" prompt does),
    // but they still must not import anything remote.
    const isLocale = relative(ROOT, file).startsWith('locales/');
    for (const re of isLocale ? remoteImports : [...apiNames, ...remoteImports]) {
      assert.ok(!re.test(src), `${relative(ROOT, file)} matches ${re}`);
    }
  }
});

test('every page ships the strict Content Security Policy', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(m, `${relative(ROOT, file)}: no CSP meta tag`);
    const csp = m[1];
    assert.match(csp, /connect-src 'none'/, `${relative(ROOT, file)}: connect-src must be 'none'`);
    assert.match(csp, /form-action 'none'/, `${relative(ROOT, file)}: form-action must be 'none'`);
    assert.doesNotMatch(csp, /https?:|\*/, `${relative(ROOT, file)}: CSP must not allow external origins`);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-(inline|eval)'/, `${relative(ROOT, file)}: no inline/eval scripts`);
  }
});

test('no external resources referenced from pages (scripts, styles, images, fonts)', () => {
  for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/<(script|link|img|iframe)\b[^>]*\b(src|href)="([^"]+)"/g)) {
      assert.doesNotMatch(m[3], /^(https?:)?\/\//, `${relative(ROOT, file)}: external ${m[1]} ${m[3]}`);
    }
  }
});

test('no innerHTML with dynamic content (only the static icon helper may use it)', () => {
  for (const file of shipped) {
    const src = readFileSync(file, 'utf8');
    const uses = [...src.matchAll(/\.innerHTML\s*=/g)].length;
    const allowed = relative(ROOT, file) === 'app/js/dom.js' ? 1 : 0;
    assert.ok(uses <= allowed, `${relative(ROOT, file)}: innerHTML assignment`);
  }
});

test('the deployed _headers file sends the strict CSP and anti-framing headers on every path', () => {
  const headers = readFileSync(`${ROOT}/_headers`, 'utf8');
  assert.match(headers, /^\/\*$/m, '_headers must have a rule for /*');
  const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1] || '';
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /https?:|\*|'unsafe-eval'/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Referrer-Policy: no-referrer/);
});

test('the build script publishes only the public folders', () => {
  const script = readFileSync(`${ROOT}/tools/build-site.sh`, 'utf8');
  const cp = script.match(/^cp -R (.+) _site\/$/m)?.[1].split(/\s+/) || [];
  assert.deepEqual(cp.sort(), ['404.html', '_headers', 'app', 'favicon.svg', 'index.html', 'landing', 'locales', 'templates']);
});
