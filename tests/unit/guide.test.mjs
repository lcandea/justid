// The /guia/ guide (guia/index.html): its Spanish text is written into the HTML so search engines read it without
// JavaScript, so it must match locales/guide-es.js exactly; its structured data must stay inert JSON and its FAQ
// must match the visible FAQ word for word, as Google requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.mjs';

const SITE = 'https://justid.candea.es';
const html = readFileSync(`${ROOT}/guia/index.html`, 'utf8');
const es = (await import(`${ROOT}/locales/es.js`)).default;
const en = (await import(`${ROOT}/locales/en.js`)).default;
const decode = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const meta = (/** @type {string} */ p) => decode(html.match(new RegExp(`<meta (?:property|name)="${p}" content="([^"]+)"`))?.[1] || '');

test('guide strings are all prefixed and live in the guide locale files', async () => {
  for (const [lang, all] of [['es', es], ['en', en]]) {
    const part = (await import(`${ROOT}/locales/guide-${lang}.js`)).default;
    assert.ok(Object.keys(part).length > 50);
    for (const k of Object.keys(part)) {
      assert.match(k, /^guide\./, `unprefixed /guia/ key ${k}`);
      assert.equal(all[k], part[k], `${k} not merged into ${lang}.js`);
    }
  }
});

test('the static Spanish text in the HTML is exactly what locales/es.js puts back', () => {
  let n = 0;
  for (const m of html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
    assert.ok(m[1] in es, `unknown key ${m[1]}`);
    assert.equal(decode(m[2]), es[m[1]], `static text of ${m[1]}`);
    n++;
  }
  assert.ok(n > 80);
  assert.equal(meta('description'), es['guide.meta.description']);
  assert.ok(es['guide.meta.title'].length <= 60, 'title over 60 characters');
  assert.ok(es['guide.meta.description'].length <= 160, 'description over 160 characters');
});

test('one h1, a real h2 per section and links back to the landing, /why and the app', () => {
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  for (const id of ['riesgos', 'que-datos', 'marca-de-agua', 'tapar', 'whatsapp', 'pedir', 'justid', 'preguntas']) {
    assert.match(html, new RegExp(`<section [^>]*id="${id}"[^>]*>\\s*(<div[^>]*>\\s*)?<h2 `), `section #${id} has no h2`);
    assert.match(html, new RegExp(`href="#${id}"`), `table of contents misses #${id}`);
  }
  for (const href of ['/', '/why/', '/app/', '/app/request.html']) assert.match(html, new RegExp(`href="${href}"`));
  assert.match(readFileSync(`${ROOT}/index.html`, 'utf8'), /<a href="guia\/" data-i18n="landing\.footer\.guide">/);
  assert.match(readFileSync(`${ROOT}/why/index.html`, 'utf8'), /<a href="\/guia\/" data-i18n="landing\.footer\.guide">/);
});

test('canonical URL, Open Graph and a large Twitter card', () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/guia/">`));
  assert.equal(meta('og:url'), `${SITE}/guia/`);
  assert.equal(meta('og:type'), 'article');
  for (const p of ['og:site_name', 'og:title', 'og:description', 'og:image:alt']) assert.ok(meta(p), p);
  assert.equal(meta('twitter:card'), 'summary_large_image');
  const image = meta('og:image');
  assert.ok(image.startsWith(`${SITE}/`), 'og:image must be absolute');
  const png = readFileSync(`${ROOT}/${image.slice(SITE.length + 1)}`);
  assert.equal(png.readUInt32BE(16), Number(meta('og:image:width')));
  assert.equal(png.readUInt32BE(20), Number(meta('og:image:height')));
});

test('the only inline scripts are JSON-LD: an Article and a FAQPage that mirrors the visible FAQ', () => {
  const blocks = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc="/.test(m[1])) continue;
    assert.match(m[1], /^\s*type="application\/ld\+json"\s*$/, `inline <script${m[1]}>`);
    blocks.push(JSON.parse(m[2]));
  }
  const article = blocks.find(b => b['@type'] === 'Article');
  assert.ok(article, 'no Article');
  assert.equal(article.inLanguage, 'es');
  assert.equal(article.datePublished, '2026-11-24');
  assert.equal(article.author.name, 'JustID');
  assert.equal(article.publisher.name, 'JustID');
  assert.match(article.headline, /compartir tu DNI/);

  const faq = blocks.find(b => b['@type'] === 'FAQPage');
  assert.ok(faq, 'no FAQPage');
  const visible = [...html.matchAll(/data-i18n="guide\.faq\.q(\d+)">([^<]+)</g)].map(([, n, q]) => ({
    name: decode(q),
    text: decode(html.match(new RegExp(`data-i18n="guide\\.faq\\.a${n}">([^<]+)<`))?.[1] || ''),
  }));
  assert.ok(visible.length >= 5);
  assert.deepEqual(faq.mainEntity.map(e => ({ name: e.name, text: e.acceptedAnswer.text })), visible);
});
