# Working on JustID

Notes for whoever changes the code (people and AI assistants). The hard rules are in [CLAUDE.md](CLAUDE.md); what the project is and how to run it are in the [README](README.md). This file covers how the code is organised and what is easy to forget.

## Pages

| URL | File | Controller | CSS |
|---|---|---|---|
| `/` | `index.html` (landing) | `landing/landing.js` | `shared/theme.css` + `landing/landing.css` |
| `/app/` | `app/index.html` (4-step flow) | `app/js/ui/app.js` | `theme.css` + `app/css/common.css` + `flow.css` |
| `/app/request.html` | request builder | `app/js/ui/request-page.js` | `theme.css` + `common.css` + `request.css` |
| `/app/editor.html` | zone editor (dev-ish tool) | `app/js/ui/editor.js` | `theme.css` + `common.css` + `editor.css` |

Every page has its own CSP `<meta>` (the `_headers` file repeats it as HTTP headers). New pages need both, and `tests/unit/privacy.test.mjs` checks them.

## Architecture: `core/` and `ui/`

The app's JavaScript is split in two folders under `app/js/`:

- **`core/`** is pure logic: inputs in, outputs out, no side effects, no module-level mutable state. It contains detection, warping, identification, redaction, the PDF writer, request links, the template model and the rules of each page (`flow.js` for the 4-step flow, `request-builder.js`, `watermark.js`). Canvas work is fine here when the canvas is passed in or created with `core/canvas.js`, which is the only place in core that may touch `document`.
- **`ui/`** is everything that touches the page: DOM, events, i18n, storage, browser image APIs. Page controllers are thin. They read the page, call core, and render the result. The 4-step flow is split per step in `ui/app/` (`photos`, `hide`, `purpose`, `share`, `checks`, `template`, `nav`, `render`, `privacy`, `demo`), with shared state in `ui/app/state.js`.

`tests/unit/architecture.test.mjs` enforces the split: core may not import from ui, i18n or locales, and may not use `window`, `localStorage`, `navigator`, `location`, `addEventListener`, `t(` and so on. When you add logic, put the decision in core as a pure function, give it a unit test (`tests/unit/flow.test.mjs` is the example), and keep the wiring in ui.

There are no framework and no dependencies. JSDoc with `// @ts-check` gives the types (`npm run typecheck`). No hexagonal layers either: the app is small and has no external services, so pure functions are enough.

## Theme and UI patterns

- **`shared/theme.css`** holds the design tokens (ink `#0d0d0c`, cream `#f3f1ec`, lime `#d7ff3a`, the mute/line greys, warn amber), the fonts (`shared/fonts`, self-hosted, OFL) and the shared components: buttons, redaction `.bar`, `.logo`, `.seg` segmented control, chips, fields and `dialog.dlg`. The landing and all app pages use it, so change shared styles there and page-specific ones in the page CSS.
- **Colours have meanings.** Lime is reserved for the primary action, the current step and focus. Cream means "selected". Amber is for warnings. Headings are Archivo condensed uppercase, labels JetBrains Mono.
- **Dialogs:** open them with `openModal(dlg)` from `ui/dom.js`, which puts focus on the dialog and not on its first control. Use `askConfirm()` and `askText()` from `ui/ask.js` instead of `confirm()` and `prompt()`. A tap outside should close a dialog unless the user must choose (the side/version decision dialog).
- **Text** is set with `textContent` or `el()`, never `innerHTML` with data. Strings live in `locales/es.js` / `en.js`. Landing strings are in `locales/landing-es.js` / `landing-en.js` (`landing.*` keys), merged into the main files.
- **Phones first.** Touch targets are at least 44px. Use whole-pixel border widths: iOS Safari skips the sides of fractional dashed borders. Respect `prefers-reduced-motion`.

## Specimen test mode

`app/?demo=specimenv4` (the default; `?demo=specimen` means the same) or `?demo=specimenv3` loads that version's reference scans (`templates/ref/`) as both photos and shows a test-mode notice (`ui/app/demo.js`). Step 1 links to it ("Carga un DNI v3 o un DNI v4"). The landing's request section links to it with a real example request built by `core/request.js` (from "JustID (ejemplo)", reply to justid@justid.com, address as an extra field). A request in the `#fragment` is kept when switching in or out of test mode.

## Regenerate after changes

| If you change… | Run | Updates |
|---|---|---|
| `app/js/core/redact.js`, default visibility in `templates/dni_es.js`, or the v4 zones | `npm run render-landing-specimen` | `landing/img/dni_es_v4_front_covered_{es,en}.webp`, the landing hero's covered card. It is real redaction output with the watermark baked in. Each run adds new random noise, so only commit it when something actually changed. |
| the scans in `img/` | `cd tools && uv run normalize_refs.py` | `templates/ref/*.webp` (reference pictures, used for identification and the specimen test mode) |
| zones in the zone editor | export JSON, then `npm run import-template -- <file.json> [templates/<id>.js] [--overrides]` | the template version file |
| the default hidden fields | (check) | the landing's "Se ve / Se tapa" lists in `index.html`, kept in sync by a unit test |

## Tests

- `npm test` runs the typecheck, the unit tests (`tests/unit`, Node) and the browser tests (`tests/e2e`, Playwright).
- The browser tests run on three projects: desktop Chrome, Android (Pixel 7) Chrome and iPhone 13 (WebKit). Locally the Chrome projects use your installed Chrome. WebKit needs `npx playwright install webkit` once. CI installs both.
- Use `isMobile`, not the project name, for phone-only branches in tests.
- The tests check behaviour, layout and overflow, not pixels. Look at real phones (especially iPhone Safari) after visual changes.
- Guard tests worth knowing: `privacy.test.mjs` (CSP, no network APIs in shipped code except names inside locale text, no external resources, build script folder list), `architecture.test.mjs` (core/ui), `locales.test.mjs` (same keys in both languages, every used key exists), `templates.test.mjs` (templates are pure data).

## Adding things

- **A new top-level public folder:** add it to `tools/build-site.sh` and to the expected list in the build-script test.
- **A new page:** CSP meta, `shared/theme.css` + `app/css/common.css`, a controller in `app/js/ui/`, and add the page to the architecture test's list.
- **A new string:** add it to both locale files (or both `landing-*` files).
- **A new document type:** add a family and version files in `templates/`, register them in `templates/index.js`, and add `field.<id>` labels to the locales.
