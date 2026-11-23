# JustID: notes for AI assistants and contributors

- **No build step, ever.** The browser runs the repository files as-is (ES modules). Don't add bundlers, frameworks or runtime dependencies. `package.json` holds dev tools only.
- **Privacy is enforced by the CSP** (`connect-src 'none'`) on every page. Never relax it, and never add network APIs. `tests/unit/privacy.test.mjs` enforces both.
- **Language:** code, comments, identifiers and docs in English. Every user-visible string goes in `locales/es.js` and `locales/en.js`, with the same keys in both (tested). Spanish is the default language.
- **Types:** plain JS with JSDoc and `// @ts-check`. `npm run typecheck` must pass.
- **Templates** (`templates/`) are pure JSON inside `export default …;`. A family file is the field catalogue plus default visibility; a version file holds geometry, reference pictures and optional `overrides`. Register new files in `templates/index.js`.
- Text is set with `textContent` / `el()`. Never `innerHTML` with dynamic data.
- Deploys: Cloudflare builds with `tools/build-site.sh` (copy only) + `wrangler deploy`. If a new top-level public folder is added, add it to the script AND to the build-script test.
- Before committing, run `npm test` (typecheck + unit + Playwright).
