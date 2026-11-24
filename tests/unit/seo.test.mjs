// Search-engine plumbing: robots.txt, the sitemap, canonical/Open Graph tags and the landing's structured data.
// The structured data must stay inert (JSON only) and its FAQ must match the visible FAQ word for word,
// as Google requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, walk } from './helpers.mjs';

const SITE = 'https://justid.candea.es';
const read = (/** @type {string} */ f) => readFileSync(`${ROOT}/${f}`, 'utf8');
const decode = (/** @type {string} */ s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

test('robots.txt allows crawling, the zone editor is noindex and the sitemap is linked', () => {
  const robots = read('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  // Disallowing the editor would stop Google from reading its noindex tag.
  assert.doesNotMatch(robots, /^Disallow:/m);
  assert.match(read('app/editor.html'), /<meta name="robots" content="noindex">/);
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'));
});

test('every sitemap URL is on the site and maps to a page in the repository', () => {
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.includes(`${SITE}/`));
  for (const loc of locs) {
    assert.ok(loc.startsWith(`${SITE}/`), `${loc} is not on ${SITE}`);
    const path = loc.slice(SITE.length + 1);
    const file = path === '' || path.endsWith('/') ? `${path}index.html` : path;
    assert.ok(existsSync(`${ROOT}/${file}`), `${loc}: missing ${file}`);
  }
});

test('the landing, /why and /guia have a canonical URL, Open Graph and a large Twitter card', () => {
  for (const [file, url] of [['index.html', `${SITE}/`], ['why/index.html', `${SITE}/why/`], ['guia/index.html', `${SITE}/guia/`]]) {
    const html = read(file);
    const meta = (/** @type {string} */ p) => html.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]+)"`))?.[1];
    assert.match(html, new RegExp(`<link rel="canonical" href="${url}">`), `${file}: canonical`);
    assert.equal(meta('og:url'), url, `${file}: og:url`);
    for (const p of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image:alt']) assert.ok(meta(p), `${file}: ${p}`);
    assert.equal(meta('og:locale'), 'es_ES');
    assert.equal(meta('og:locale:alternate'), 'en_GB');
    assert.equal(meta('twitter:card'), 'summary_large_image');
    const image = meta('og:image') || '';
    assert.ok(image.startsWith(`${SITE}/`), `${file}: og:image must be absolute`);
    const png = readFileSync(`${ROOT}/${image.slice(SITE.length + 1)}`);
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    assert.equal(png.readUInt32BE(16), Number(meta('og:image:width')), `${file}: og:image width`);
    assert.equal(png.readUInt32BE(20), Number(meta('og:image:height')), `${file}: og:image height`);
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
});

test('the only inline scripts on any page are JSON-LD data blocks', () => {
  const pages = [...walk('app', '.html'), `${ROOT}/index.html`, `${ROOT}/404.html`, `${ROOT}/why/index.html`, `${ROOT}/guia/index.html`];
  for (const file of pages) {
    for (const m of readFileSync(file, 'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc="/.test(m[1])) continue;
      assert.match(m[1], /^\s*type="application\/ld\+json"\s*$/, `${relative(ROOT, file)}: inline <script${m[1]}>`);
      assert.doesNotThrow(() => JSON.parse(m[2]), `${relative(ROOT, file)}: JSON-LD does not parse`);
    }
  }
});

test('the landing JSON-LD describes the web app and mirrors the visible FAQ exactly', () => {
  const html = read('index.html');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  const app = blocks.find(b => b['@type'] === 'WebApplication');
  assert.ok(app, 'no WebApplication');
  assert.equal(app.name, 'JustID');
  assert.equal(app.url, `${SITE}/`);
  assert.equal(app.applicationCategory, 'UtilityApplication');
  assert.equal(app.offers.price, '0');
  assert.equal(app.offers.priceCurrency, 'EUR');

  const faq = blocks.find(b => b['@type'] === 'FAQPage');
  assert.ok(faq, 'no FAQPage');
  const visible = [...html.matchAll(/data-i18n="landing\.faq\.q(\d+)">([^<]+)</g)].map(([, n, q]) => ({
    name: decode(q),
    text: decode(html.match(new RegExp(`data-i18n="landing\\.faq\\.a${n}">([^<]+)<`))?.[1] || ''),
  }));
  assert.ok(visible.length > 0);
  assert.deepEqual(faq.mainEntity.map(e => ({ name: e.name, text: e.acceptedAnswer.text })), visible);

  // The visible Spanish text is also what locales/landing-es.js puts back on load.
  const es = read('locales/landing-es.js');
  for (const e of faq.mainEntity) assert.ok(es.includes(`'${e.name}'`) && es.includes(`'${e.acceptedAnswer.text}'`), e.name);
});

test('the Spanish title and description in index.html match the locale (the i18n swap must not change them)', async () => {
  const es = (await import(`${ROOT}/locales/landing-es.js`)).default;
  const html = read('index.html');
  assert.equal(decode(html.match(/<title data-i18n="landing\.meta\.title">([^<]+)<\/title>/)?.[1] || ''), es['landing.meta.title']);
  assert.equal(decode(html.match(/<meta name="description" content="([^"]+)"/)?.[1] || ''), es['landing.meta.description']);
  assert.ok(es['landing.meta.title'].length <= 60, 'title over 60 characters');
  assert.ok(es['landing.meta.description'].length <= 160, 'description over 160 characters');
});
