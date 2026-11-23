# JustID — share your ID, just enough

**JustID** prepares a copy of your Spanish ID card (DNI) for sharing: it hides the data the recipient doesn't need, stamps the purpose across the card as a watermark, and gives you a PDF ready to send.

**Everything happens in your browser.** Your photos are never uploaded, stored or sent anywhere. That's not just a promise: the page is technically unable to make network requests (see [Privacy](#privacy-how-you-can-verify-it)).

🌐 **https://justid.candea.es** · 🇪🇸 Spanish (default) and 🇬🇧 English

> Not affiliated with the Policía Nacional, the Ministerio del Interior or any government body.

## Features

- **Automatic card detection.** It finds the card in your photo and straightens it.
- **Automatic version detection.** It recognises whether your DNI is v3 (2015–2021) or v4 (2021+), and warns you if you picked the wrong one.
- **Field-by-field hiding.** You choose which fields to hide, with recommended defaults. Hidden fields are pixelated with noise, or covered with solid blocks.
- **Purpose watermark.** "SOLO PARA: …" is written across the whole card, so the copy can't be reused for anything else.
- **PDF at real card size**, with a caption stating its purpose and date. You can share it straight from your phone.
- **Zone editor** (`app/editor.html`) for adjusting templates or creating new ones.

## Privacy: how you can verify it

1. **The Content Security Policy blocks all network access.** Every page sets `connect-src 'none'` and `form-action 'none'`. Even if malicious code ran on the page, the browser would refuse to send data anywhere. The test suite checks this in a real browser (`tests/e2e/app.spec.js`).
2. **No dependencies, no build step.** The files in this repository are exactly what your browser runs: no bundler, no minifier, no third-party scripts, fonts or analytics.
3. **Guard tests.** CI fails if any shipped code mentions a network API (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`…), if a page weakens the CSP, or if a page loads an external resource (`tests/unit/privacy.test.mjs`).
4. **Check it yourself.** Open your browser's DevTools → *Network*, use the app, and confirm that no request leaves the site.

## How it works

1. **Photo.** The photo is decoded onto a `<canvas>`, which also drops its EXIF metadata.
2. **Detection.** A gradient-based Hough transform finds the card's four edges (`app/js/detect.js`).
3. **Straightening.** A homography warps the card to 1012 × 638 px, which is ID-1 size at about 300 dpi (`app/js/image.js`).
4. **Identification.** A small grey "signature" of the card is compared against each template's reference picture (`app/js/identify.js`).
5. **Redaction.** Each hidden field's zones are pixelated or covered, and the watermark is drawn on top (`app/js/redact.js`).
6. **PDF.** A tiny, dependency-free PDF writer embeds the redacted JPEGs (`app/js/pdf.js`).

## Project structure

```
index.html            entry point (landing page coming soon); 404.html, favicon.svg
_headers              HTTP security headers (CSP, anti-framing) for every response
wrangler.jsonc        Cloudflare deployment config (static files only, no server code)
app/                  the app: index.html (4-step flow), editor.html (zone editor)
  js/                 ES modules, plain JavaScript with JSDoc types (type-checked, never compiled)
  css/
locales/              es.js, en.js: every user-visible string
templates/            document templates, pure data:
  dni_es.js           family: field catalogue + which fields are shown by default
  dni_es_v3.js        version: where each field is on the card + reference pictures
  dni_es_v4.js
  ref/                normalised reference pictures (made with tools/normalize_refs.py)
img/                  original specimen scans (source for templates/ref)
tests/unit/           Node tests: template purity, translations, privacy guards
tests/e2e/            Playwright tests: full flow, CSP, detector, identification
tools/                dev-only: local server, reference-picture normaliser (uv project)
```

## Development

Requirements: Node 22+ (tests only) and Python 3 (local server). The site itself needs nothing.

```sh
npm install                 # dev tools only: TypeScript (type check) + Playwright (tests)
npm run serve               # http://localhost:8765/app/, also printed with your LAN IP for testing on a phone
npm test                    # type check + unit tests + browser tests
```

To regenerate the reference pictures after changing `img/`:

```sh
cd tools && uv run normalize_refs.py
```

### Hosting

Cloudflare (Workers static assets) deploys straight from this repository:
- `main` goes to production at https://justid.candea.es. Every other branch gets its own preview URL.
- Build: `sh tools/build-site.sh` copies the public files into `_site/` as-is (no compilation). Deploy: `npx wrangler deploy` (config in `wrangler.jsonc`).
- `_headers` adds HTTP security headers to every response. That includes the same no-network CSP plus `frame-ancestors 'none'`, which only a header can enforce.
- GitHub Actions runs the tests on every push and PR. Protect `main` so it only accepts merges once CI passes.

### Conventions

- Code, comments and docs are in **English**. User-visible text lives only in `locales/*.js` (Spanish first).
- Template files are **data only**: a single `export default {…}` holding JSON. Tests reject anything else.
- Field labels come from `locales/*.js` (`field.<id>`). Templates hold only ids, visibility and geometry.

## Specimen images

The pictures in `img/` and `templates/ref/` are the official **specimen** cards: fictional data ("ESPAÑOLA ESPAÑOLA, CARMEN") published for illustration. They are used only as reference layouts.

## License

[MIT](LICENSE)
