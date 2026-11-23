// @ts-check
// Deterministic capture step for the demo videos (dev-only, never shipped to the site).
//
// Drives the real app in a phone-sized Chrome and writes PNG screenshots of the send and request
// flows, plus lossless renders of the specimen card made with the app's own redaction code, into
// video/.cache/captures/<lang>/ with a manifest.json describing every file (pixel size, what it
// shows, bounding boxes of the key elements so the video can push in on them).
//
// Determinism:
//   - the clock is frozen at config.fixedDate (watermark and PDF dates), in the Europe/Madrid time zone;
//   - the app's secret per-session redaction seed (crypto.getRandomValues in ui/app/render.js) is
//     pinned to config.redactionSeed by an init script, so the on-screen previews are pixel-identical
//     to the card renders below (the script checks this and warns otherwise);
//   - reduced motion is on (no smooth scrolling, no wiggle / busy animations), caret and scrollbars hidden.
//
// Usage: node video/capture/capture.mjs --lang es [--flow send|request|all]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'video/config.json'), 'utf8'));

/* ---------- command line ---------- */
const args = process.argv.slice(2);
const arg = (/** @type {string} */ k, /** @type {string} */ d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const LANG = arg('--lang', 'es');
const FLOW = arg('--flow', 'all');
if (!config.langs.includes(LANG)) throw new Error(`--lang must be one of ${config.langs.join(', ')}`);
if (!['send', 'request', 'all'].includes(FLOW)) throw new Error('--flow must be send, request or all');

const CAPTURES = join(ROOT, 'video/.cache/captures');
const OUT = join(CAPTURES, LANG);
mkdirSync(OUT, { recursive: true });

/* ---------- app data, loaded in Node from the same modules the browser runs ---------- */
const imp = (/** @type {string} */ p) => import(pathToFileURL(join(ROOT, p)).href);
/** @type {Record<string, string>} */
const L = (await imp(`locales/${LANG}.js`)).default;
/** Same substitution as ui/i18n.js t(). @param {string} key @param {Record<string, string | number>} [params] */
const t = (key, params) => {
  const s = L[key]; if (s === undefined) throw new Error(`missing locale key ${key}`);
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;
};
const { officialTemplates } = await imp('app/js/core/templates.js');
/** @type {import('../../app/js/core/templates.js').ResolvedTemplate} */
const TEMPLATE = officialTemplates().find((/** @type {any} */ x) => x.id === config.template);
if (!TEMPLATE) throw new Error(`template ${config.template} not found`);
const zoneOf = (/** @type {string} */ id) => {
  const f = TEMPLATE.fields.find(x => x.id === id);
  if (!f?.zones.length) throw new Error(`field ${id} has no zone in ${config.template}`);
  return f.zones[0];
};
const pick = (/** @type {any} */ v) => (v && typeof v === 'object' ? v[LANG] : v); // per-language config values

const DPR = config.device.deviceScaleFactor;

/* ---------- manifest ---------- */
const manifestPath = join(OUT, 'manifest.json');
// A partial run (--flow send) keeps the other flow's entries from a previous run.
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
Object.assign(manifest, {
  lang: LANG, template: config.template, fixedDate: config.fixedDate, redactionSeed: config.redactionSeed,
  device: { ...config.device, screenshot: { width: config.device.width * DPR, height: config.device.height * DPR } },
  coordinates: 'Boxes: css = CSS px, device = screenshot px (css × deviceScaleFactor). "viewport" boxes are relative to that '
    + 'viewport screenshot; "page" boxes are relative to the document, i.e. to the -full.png screenshot.',
});
manifest.files ??= {};
manifest.watermarks ??= {};
manifest.warnings = [];

/** Width and height of a PNG, read from its IHDR chunk. @param {Buffer} buf */
const pngSize = buf => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

/** Write a PNG and record it in the manifest. @param {string} file @param {Buffer} buf @param {string} description @param {object} [extra] */
function record(file, buf, description, extra = {}) {
  writeFileSync(join(OUT, file), buf);
  manifest.files[file] = { ...pngSize(buf), bytes: buf.length, description, ...extra };
  console.log(`  ${file}  ${pngSize(buf).width}x${pngSize(buf).height}`);
}
const fromDataUrl = (/** @type {string} */ u) => Buffer.from(u.split(',')[1], 'base64');
/** @param {string} msg */
function warn(msg) { manifest.warnings.push(msg); console.warn('WARNING:', msg); }

/* ---------- local server ---------- */
/** Free TCP port: `want` if it is free, else any. @param {number} want @returns {Promise<number>} */
const freePort = want => new Promise(resolve => {
  const s = createServer(); s.unref();
  s.on('error', () => (want ? freePort(0).then(resolve) : resolve(0)));
  s.listen(want, () => { const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port; s.close(() => resolve(p)); });
});
// Prefer a fixed port: the request link shown on screen (req-03) contains the origin.
const PREFERRED_PORT = 8791;
const port = await freePort(PREFERRED_PORT);
if (port !== PREFERRED_PORT) warn(`port ${PREFERRED_PORT} busy, using ${port}: the link in req-03-result.png shows that port`);
const BASE = `http://localhost:${port}`;
const server = spawn('python3', ['tools/serve.py', String(port)], { cwd: ROOT, stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; ; i++) { // wait until it answers
  try { if ((await fetch(`${BASE}/app/`)).ok) break; } catch { /* not up yet */ }
  if (i > 100) throw new Error('local server did not start');
  await new Promise(r => setTimeout(r, 100));
}

// Software rendering: GPU rasterisation of scaled canvases varies by a level or two between runs.
const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome', args: ['--disable-gpu'] });

/**
 * A phone-like browser context with the frozen clock and the pinned redaction seed.
 * @param {{ bypassCSP?: boolean }} [o] bypassCSP only for the page.evaluate(import()) renders
 */
async function newContext({ bypassCSP = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: config.device.width, height: config.device.height }, deviceScaleFactor: DPR,
    isMobile: true, hasTouch: true, locale: 'es-ES', timezoneId: 'Europe/Madrid',
    reducedMotion: 'reduce', colorScheme: 'dark', bypassCSP,
  });
  await ctx.clock.setFixedTime(new Date(config.fixedDate));
  // ui/app/render.js draws its seed with crypto.getRandomValues(new Uint32Array(1)): pin it.
  await ctx.addInitScript(seed => {
    const orig = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = /** @type {any} */ ((/** @type {any} */ a) => {
      if (a instanceof Uint32Array && a.length === 1) { a[0] = seed; return a; }
      return orig(a);
    });
  }, config.redactionSeed);
  return ctx;
}

/** @type {string[]} uncaught page errors; shot() refuses to save a frame after one */
const pageErrors = [];
/** Fail loudly on page errors (a broken frame would otherwise end up in the video). @param {import('@playwright/test').Page} page */
function watchErrors(page) {
  page.on('pageerror', e => pageErrors.push(`${page.url()}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') warn(`console error on ${page.url()}: ${m.text()}`); });
}

/** Two animation frames and a short pause: lets the debounced preview render (50 ms) and layout settle. @param {import('@playwright/test').Page} page */
async function settle(page, ms = 150) {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))));
  await page.waitForTimeout(ms);
}

/** Open a page, hide caret and scrollbars, and switch the language with the app's own ES/EN toggle. @param {import('@playwright/test').Page} page @param {string} path */
async function open(page, path) {
  await page.goto(BASE + path);
  await page.locator('#lang button').first().waitFor();
  await page.addStyleTag({ content: 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}*{caret-color:transparent!important}' });
  const btn = page.locator(`#lang button[lang="${LANG}"]`);
  if (await btn.getAttribute('aria-pressed') !== 'true') await btn.click();
  await page.waitForFunction(l => document.documentElement.lang === l
    && document.querySelector(`#lang button[lang="${l}"]`)?.getAttribute('aria-pressed') === 'true', LANG);
}

/** Check that a static string shows in the target language. @param {import('@playwright/test').Page} page @param {string} sel @param {string} key */
async function expectText(page, sel, key) {
  const got = (await page.locator(sel).first().textContent())?.trim();
  if (got !== t(key)) throw new Error(`${sel}: expected "${t(key)}" (${LANG}), got "${got}"`);
}

/** @param {{ x: number, y: number, width: number, height: number }} r */
const cssBox = r => ({ x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
const devBox = (/** @type {{ x: number, y: number, w: number, h: number }} */ b) =>
  ({ x: Math.round(b.x * DPR), y: Math.round(b.y * DPR), w: Math.round(b.w * DPR), h: Math.round(b.h * DPR) });

/**
 * Bounding boxes of elements, in viewport and page coordinates.
 * @param {import('@playwright/test').Page} page @param {Record<string, string>} keys name -> selector
 */
async function measure(page, keys) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, sel] of Object.entries(keys)) {
    const r = await page.locator(sel).first().evaluate(el => {
      const b = el.getBoundingClientRect();
      // the fixed bottom bar covers the end of the viewport
      const bar = document.querySelector('.bottom-bar')?.getBoundingClientRect();
      const visibleBottom = bar && bar.height && !el.closest('.bottom-bar') ? bar.top : innerHeight;
      return { x: b.x, y: b.y, width: b.width, height: b.height, sx: scrollX, sy: scrollY,
        fullyVisible: b.top >= 0 && b.bottom <= visibleBottom, anyVisible: b.bottom > 0 && b.top < visibleBottom };
    });
    const v = cssBox(r), p = { ...v, x: +(v.x + r.sx).toFixed(1), y: +(v.y + r.sy).toFixed(1) };
    out[name] = { selector: sel, viewport: { css: v, device: devBox(v) }, page: { css: p, device: devBox(p) }, fullyVisible: r.fullyVisible, anyVisible: r.anyVisible };
  }
  return out;
}

/**
 * Viewport screenshot (and optionally full page) with the boxes of key elements. Any key element
 * that is not fully visible also gets its own viewport shot, scrolled so it is centred
 * (`<name>-at-<key>.png`), so the video can push in on it without stitching.
 * @param {import('@playwright/test').Page} page @param {string} name file name without .png
 * @param {string} description
 * @param {{ full?: boolean, keys?: Record<string, string>, extra?: object }} [o]
 */
async function shot(page, name, description, { full = false, keys = {}, extra = {} } = {}) {
  await settle(page);
  if (pageErrors.length) throw new Error('page error before ' + name + ': ' + pageErrors.join('; '));
  const boxes = await measure(page, keys);
  const top = await page.evaluate(() => window.scrollY);
  record(`${name}.png`, await page.screenshot(), description, { scrollY: top, boxes, ...extra });
  if (full) record(`${name}-full.png`, await page.screenshot({ fullPage: true }), `${description} (full page)`, { boxes: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, { selector: b.selector, page: b.page }])) });
  for (const [key, b] of Object.entries(boxes)) {
    if (b.fullyVisible) continue;
    await page.locator(b.selector).first().evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await settle(page);
    const sy = await page.evaluate(() => window.scrollY);
    record(`${name}-at-${key}.png`, await page.screenshot(), `${description}, scrolled to ${key}`, { scrollY: sy, boxes: await measure(page, keys) });
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), top);
  }
  return boxes;
}

/** Wait until the step `n` (0-based) is the one shown. @param {import('@playwright/test').Page} page @param {number} n */
async function waitStep(page, n) {
  await page.locator(`section.step[data-step="${n}"]:not(.hidden)`).waitFor();
  await page.waitForFunction(() => !document.body.classList.contains('busy'));
}
/** Press the bottom bar's Next and wait for step `n`. @param {import('@playwright/test').Page} page @param {number} n */
async function next(page, n) {
  await page.waitForFunction(() => !document.body.classList.contains('busy')); // checks still running
  await page.locator('#nav-next').click();
  await waitStep(page, n);
}
/** Wait for ?demo= to load both specimen sides and finish its checks. @param {import('@playwright/test').Page} page */
async function waitDemo(page) {
  await page.locator('#demo-note:not(.hidden)').waitFor();
  await page.locator('#slot-front canvas.thumb').waitFor();
  await page.locator('#slot-back canvas.thumb').waitFor();
  await page.waitForFunction(() => !document.body.classList.contains('busy') && !document.querySelector('#decision[open]'));
}

/** Watermark text drawn by the app, read back from the step-4 summary line. @param {import('@playwright/test').Page} page */
async function summaryWatermark(page) {
  const s = await page.locator('#summary').textContent() || '';
  return s.match(/[“«](.*)[”»]$/)?.[1] ?? '';
}

/**
 * Pixel hash of the redacted canvases on step 4 (front, back), to check that the UI and the card
 * renders below are the same pixels. @param {import('@playwright/test').Page} page
 */
const uiCanvasHashes = page => page.evaluate(() => [...document.querySelectorAll('#pv-final canvas')].map(c => {
  const cv = /** @type {HTMLCanvasElement} */ (c), d = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d')).getImageData(0, 0, cv.width, cv.height).data;
  let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
  return `${cv.width}x${cv.height}:${h.toString(16)}`;
}));
/** @type {Record<string, string[]>} */
const uiHashes = {};

/* ======================= A. UI screenshots: send flow ======================= */
async function sendFlow() {
  console.log(`[${LANG}] send flow`);
  const S = config.send;
  const ctx = await newContext(), page = await ctx.newPage(); watchErrors(page);

  // 1. Empty photo slots (no demo)
  await open(page, '/app/');
  await page.locator('#slot-front .empty').waitFor();
  await expectText(page, '#nav-next', 'nav.need_photo');
  await shot(page, 'send-01-photos', 'Step 1, no photos yet: the two empty "take a photo of each side" slots', { full: true, keys: { slotFront: '#slot-front', slotBack: '#slot-back' } });

  // 1b. Same step with the specimen loaded as if photographed
  await open(page, '/app/?demo=specimenv4');
  await waitDemo(page);
  await expectText(page, '#nav-next', 'nav.next');
  await shot(page, 'send-01-photos-demo', 'Step 1 with the specimen front and back loaded (test-mode notice visible)', { full: true, keys: { slotFront: '#slot-front', slotBack: '#slot-back', demoNote: '#demo-note' } });

  // 2. Hide: default hidden fields
  await next(page, 1);
  await page.locator('#pv-hide canvas.preview').waitFor();
  const fieldKeys = Object.fromEntries([...S.spotlightFields, S.toggleField].map(id => [`field_${id}`, `.fld[data-f="${id}"]`]));
  await shot(page, 'send-02-hide', 'Step 2 (hide), template default hidden fields, front preview', { full: true, keys: { pvHide: '#pv-hide', fields: '#fields', ...fieldKeys } });
  await page.locator('#pv-side button[data-v="back"]').click();
  await shot(page, 'send-02-hide-back', 'Step 2 (hide), default hidden fields, back preview', { keys: { pvHide: '#pv-hide' } });

  // 3. Tap the toggle field's zone on the preview, like a user would
  const z = zoneOf(S.toggleField);
  await page.locator(`#pv-side button[data-v="${z.side}"]`).click();
  await settle(page);
  const cv = page.locator('#pv-hide canvas.preview');
  await cv.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); // the sticky preview is at the top
  const cvBox = /** @type {{ x: number, y: number, width: number, height: number }} */ (await cv.boundingBox());
  const tapPos = { x: (z.x + z.w / 2) * cvBox.width, y: (z.y + z.h / 2) * cvBox.height };
  const before = await page.locator(`.fld[data-f="${S.toggleField}"] input`).isChecked();
  await cv.tap({ position: tapPos });
  await page.waitForFunction(([id, was]) => /** @type {HTMLInputElement} */ (document.querySelector(`.fld[data-f="${id}"] input`)).checked !== was, [S.toggleField, before]);
  await page.waitForFunction(() => !document.querySelector('.fld.flash')); // the row flashes for 700 ms
  const tap = { css: { x: +(cvBox.x + tapPos.x).toFixed(1), y: +(cvBox.y + tapPos.y).toFixed(1) } };
  await shot(page, 'send-02-hide-toggled', `Step 2 after tapping the ${S.toggleField} zone on the preview: it is now ${before ? 'visible' : 'hidden'}`,
    { full: true, keys: { pvHide: '#pv-hide', ...fieldKeys }, extra: { tapPoint: { viewport: { css: tap.css, device: { x: Math.round(tap.css.x * DPR), y: Math.round(tap.css.y * DPR) } }, field: S.toggleField } } });
  // Make the hidden set match config.send.extraHidden (the card renders use it).
  for (const id of S.extraHidden) {
    const box = page.locator(`.fld[data-f="${id}"] input`);
    if (!(await box.isChecked())) await page.locator(`.fld[data-f="${id}"]`).click();
  }
  await page.locator('#pv-side button[data-v="front"]').click();

  // 4. Purpose
  await next(page, 2);
  await page.waitForTimeout(200); // the app focuses #purpose 100 ms after entering the step
  await page.locator('#purpose').fill(pick(S.purpose));
  if (pick(S.recipient)) await page.locator('#recipient').fill(pick(S.recipient));
  await page.locator('#purpose').blur(); await page.locator('#recipient').blur();
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur());
  await shot(page, 'send-03-purpose', 'Step 3 with the purpose typed; the watermark preview below', { full: true, keys: { purpose: '#purpose', pvWm: '#pv-wm' } });

  // 5. Ready to share
  await next(page, 3);
  await page.locator('#pv-final canvas').first().waitFor();
  await shot(page, 'send-04-share', 'Step 4 "ready to share": final redacted cards; the share/download action is the bottom-bar button (#nav-next)',
    { full: true, keys: { pvFinal: '#pv-final', shareButton: '#nav-next', download: '#btn-dl', summary: '#summary' } });
  manifest.watermarks.sendUi = await summaryWatermark(page);
  uiHashes.send = await uiCanvasHashes(page);
  await ctx.close();
}

/* ============ A.6 Crop overlay on a synthetic photo (real detection, no demo) ============ */
/** True corners (TL, TR, BR, BL) of the card in the synthetic photo, and its size. */
const SYNTH = { W: 1200, H: 1600, corners: [[170, 560], [1050, 610], [1090, 1150], [120, 1090]] };

async function cropFlow() {
  console.log(`[${LANG}] crop overlay`);
  const synthFile = join(OUT, 'synthetic-photo-front.png');
  {
    // Render the scene with the detector test fixture (tests/e2e/fixtures/scenes.js): specimen front,
    // perspective-mapped onto a procedural wood-ish table with a soft shadow. Deterministic (seeded noise).
    const ctx = await newContext({ bypassCSP: true }), page = await ctx.newPage(); watchErrors(page);
    await page.goto(`${BASE}/index.html`);
    const url = await page.evaluate(async ({ W, H, corners }) => {
      const { scene, loadCard } = await import('/tests/e2e/fixtures/scenes.js');
      const card = await loadCard('/templates/ref/dni_es_v4_front.webp');
      const bg = (/** @type {number} */ x, /** @type {number} */ y) => {
        // warm wood grain, darker towards the edges (vignette) and from top to bottom
        const grain = Math.sin(y * 0.045 + Math.sin(x * 0.008) * 2.5) * 14 + Math.sin(y * 0.31 + x * 0.002) * 4;
        const dx = x / W - 0.5, dy = y / H - 0.45, v = Math.max(0.55, 1 - 1.1 * (dx * dx + dy * dy)) * (1 - 0.15 * y / H);
        return [(104 + grain) * v, (76 + grain * 0.75) * v, (54 + grain * 0.5) * v];
      };
      return scene(card, W, H, corners, bg, { shadow: true, noise: 10, seed: 7 }).toDataURL('image/png');
    }, SYNTH);
    writeFileSync(synthFile, fromDataUrl(url));
    await ctx.close();
  }
  const synth = readFileSync(synthFile);
  manifest.files['synthetic-photo-front.png'] = { ...pngSize(synth), bytes: synth.length,
    description: 'Synthetic photo: the specimen front perspective-mapped onto a procedural wood table (no real ID)',
    trueCorners: { order: 'TL, TR, BR, BL', px: SYNTH.corners } };

  const ctx = await newContext(), page = await ctx.newPage(); watchErrors(page);
  await open(page, '/app/');
  await page.locator('#slot-front .gal input[type=file]').setInputFiles(synthFile);
  await page.locator('#crop-ov:not(.hidden)').waitFor();
  await page.waitForFunction(msg => document.querySelector('#crop-msg')?.textContent === msg, t('crop.msg_found'), { timeout: 30000 });
  // The crop canvas shows the photo scaled to fit: map the true corners to the screen.
  const c = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('#crop-canvas').boundingBox());
  const k = c.width / SYNTH.W;
  const screen = SYNTH.corners.map(([u, v]) => [+(c.x + u * k).toFixed(1), +(c.y + v * k).toFixed(1)]);
  await shot(page, 'send-01b-crop-detected', 'Framing overlay after real card detection on the synthetic photo ("card detected")', {
    keys: { cropCanvas: '#crop-canvas', cropMsg: '#crop-msg', useButton: '#crop-use' },
    extra: { trueCornersOnScreen: { order: 'TL, TR, BR, BL', css: screen, device: screen.map(([x, y]) => [Math.round(x * DPR), Math.round(y * DPR)]) } },
  });
  await ctx.close();
}

/* ======================= A. UI screenshots: request flow ======================= */
/** @type {string | null} fragment of the request link built in the builder */
let requestFragment = null;

async function requestFlow() {
  console.log(`[${LANG}] request flow`);
  const R = config.request;
  const ctx = await newContext(), page = await ctx.newPage(); watchErrors(page);

  // 7. Builder, empty then filled
  await open(page, '/app/request.html');
  await expectText(page, '#b-create', 'builder.create');
  await shot(page, 'req-01-builder', 'Request builder, empty (top of the page)', { full: true, keys: { from: '#b-from', fields: '#b-fields' } });

  await page.locator('#b-from').fill(pick(R.from));
  await page.locator('#b-purpose').fill(pick(R.purpose));
  for (const id of R.extraFields) await page.locator(`#b-fields input[data-f="${id}"]`).check();
  await page.locator('#b-why').fill(pick(R.why));
  await page.locator(`#b-delivery button[data-v="${R.delivery.kind}"]`).click();
  await page.locator('#b-contact').fill(R.delivery.value);
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur());
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const extraRows = Object.fromEntries(R.extraFields.map((/** @type {string} */ id) => [`extraField_${id}`, `#b-fields label.b-field:has(input[data-f="${id}"])`]));
  await shot(page, 'req-02-builder-filled', 'Request builder filled in: requester, purpose, extra field ticked, reason, delivery and contact',
    { full: true, keys: { from: '#b-from', purpose: '#b-purpose', fields: '#b-fields', ...extraRows, why: '#b-why', delivery: '#b-delivery', contact: '#b-contact', create: '#b-create' } });

  // 8. Create the link
  await page.locator('#b-create').click();
  await page.locator('#b-result:not(.hidden)').waitFor();
  const err = (await page.locator('#b-error').textContent())?.trim();
  if (err) throw new Error(`request builder refused the config: ${err}`);
  const link = await page.locator('#b-link').inputValue();
  requestFragment = link.slice(link.indexOf('#') + 1);
  manifest.requestLink = 'app/#' + requestFragment;
  manifest.requestLinkDemo = 'app/?demo=specimenv4#' + requestFragment;
  // The page scrolls the result into view itself, sometimes before layout has settled: redo it
  // once everything is laid out so the frame is the same on every run.
  await settle(page);
  await page.locator('#b-result').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await shot(page, 'req-03-result', 'Request builder after "create link": the result section with the link', { keys: { result: '#b-result', link: '#b-link' } });

  // 9. The recipient opens the link (with the specimen photos)
  await open(page, '/app/?demo=specimenv4#' + requestFragment);
  await waitDemo(page);
  await page.locator('#req-panel:not(.hidden)').waitFor();
  const acceptKeys = Object.fromEntries(R.extraFields.map((/** @type {string} */ id) => [`accept_${id}`, `#req-panel label.req-extra-row:has(input[data-f="${id}"])`]));
  await shot(page, 'req-04-recipient-open', 'Recipient opens the request link: step 1 with the request panel (extras pending)',
    { full: true, keys: { reqPanel: '#req-panel', ...acceptKeys } });

  // Accept the extras with the panel's "I agree to show …" checkboxes
  for (const id of R.acceptExtras) await page.locator(`#req-panel input[data-f="${id}"]`).check();
  await page.waitForFunction(ids => ids.every((/** @type {string} */ id) => document.querySelector(`#req-panel label.req-extra-row:has(input[data-f="${id}"])`)?.classList.contains('accepted')), R.acceptExtras);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await shot(page, 'req-04b-recipient-accepted', 'Step 1 after ticking "I agree to show …" for the accepted extras',
    { full: true, keys: { reqPanel: '#req-panel', ...acceptKeys } });

  // 10. Step 2 with the accepted extras shown
  await next(page, 1);
  await page.locator('#pv-hide canvas.preview').waitFor();
  const rowKeys = Object.fromEntries(R.extraFields.map((/** @type {string} */ id) => [`field_${id}`, `.fld[data-f="${id}"]`]));
  const switchKeys = Object.fromEntries(R.acceptExtras.map((/** @type {string} */ id) => [`acceptSwitch_${id}`, `.fld[data-f="${id}"] .switch`]));
  await shot(page, 'req-05-recipient-hide', 'Recipient step 2: only the requested fields visible, accepted extras shown (row switch off = shown)',
    { full: true, keys: { pvHide: '#pv-hide', fields: '#fields', ...rowKeys, ...switchKeys } });
  await page.locator('#pv-side button[data-v="back"]').click();
  await shot(page, 'req-05-recipient-hide-back', 'Recipient step 2, back preview (where the address is)', { keys: { pvHide: '#pv-hide' } });
  await page.locator('#pv-side button[data-v="front"]').click();

  // Step 3 is prefilled from the request (purpose, and the requester as recipient)
  await next(page, 2);
  await page.waitForTimeout(200);
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur());
  await shot(page, 'req-05b-recipient-purpose', 'Recipient step 3: purpose and recipient prefilled from the request', { keys: { purpose: '#purpose', recipient: '#recipient', pvWm: '#pv-wm' } });

  // 11. Step 4 with the "send it back" block
  await next(page, 3);
  await page.locator('#req-send:not(.hidden)').waitFor();
  await shot(page, 'req-06-recipient-share', 'Recipient step 4: final cards and the "send it back to the requester" block',
    { full: true, keys: { pvFinal: '#pv-final', summary: '#summary', reqSend: '#req-send', reqSendLink: '#req-send-link', shareButton: '#nav-next' } });
  manifest.watermarks.requestUi = await summaryWatermark(page);
  uiHashes.request = await uiCanvasHashes(page);
  await ctx.close();
}

/* ======================= B. Card renders with the app's redaction code ======================= */
async function cardRenders() {
  console.log(`[${LANG}] card renders`);
  const ctx = await newContext({ bypassCSP: true }), page = await ctx.newPage(); watchErrors(page);
  await page.goto(`${BASE}/index.html`); // any same-origin page with shared/theme.css (the Archivo font)
  const res = await page.evaluate(async ({ lang, cfg, fragment }) => {
    const { renderRedacted } = await import('/app/js/core/redact.js');
    const { officialTemplates } = await import('/app/js/core/templates.js');
    const { watermarkText } = await import('/app/js/core/watermark.js');
    const { encodeRequest, decodeRequest } = await import('/app/js/core/request.js');
    const { requestContext, initialHidden, SIDE_LIST } = await import('/app/js/core/flow.js');
    const { defaultFields, backOnlyFields, backForced } = await import('/app/js/core/request-builder.js');
    const { FAMILIES } = await import('/templates/index.js');
    const dict = (await import(`/locales/${lang}.js`)).default;
    await document.fonts.load('500 12px Archivo'); // the watermark is set in Archivo
    const tpl = officialTemplates().find(x => x.id === cfg.template);
    if (!tpl) throw new Error('template not found');
    // Exactly as ui/app/render.js: date = new Date().toLocaleDateString(lang) (the clock is frozen).
    const date = new Date().toLocaleDateString(lang);
    const onlyFor = (/** @type {string} */ purpose) => dict['wm.only_for'].replace('{purpose}', purpose);
    const pickL = (/** @type {any} */ v) => (v && typeof v === 'object' ? v[lang] : v);

    // Send: template defaults + extra hidden; watermark from purpose (+ recipient).
    const sendHidden = new Set([...tpl.fields.filter(f => f.hide).map(f => f.id), ...cfg.send.extraHidden]);
    const sendWm = watermarkText({ purpose: pickL(cfg.send.purpose), recipient: pickL(cfg.send.recipient), date, onlyFor });

    // Request: the link built in the builder (or the same request encoded here when only --flow send
    // ran). The app hides everything not requested, keeps extras hidden until accepted, and prefills
    // the purpose AND the requester's name (as recipient) into the watermark (ui/app.js).
    const family = FAMILIES.find(f => f.id === tpl.family);
    const versions = officialTemplates().filter(x => x.family === tpl.family);
    const fields = new Set([...defaultFields(family), ...cfg.request.extraFields]);
    const ownFragment = encodeRequest({
      doc: tpl.family, from: pickL(cfg.request.from), purpose: pickL(cfg.request.purpose), fields: [...fields],
      back: backForced(fields, backOnlyFields(family, versions)), delivery: cfg.request.delivery, why: pickL(cfg.request.why),
    }, FAMILIES);
    const decoded = decodeRequest(fragment || ownFragment, FAMILIES);
    if (!decoded?.ok) throw new Error('request does not decode: ' + JSON.stringify(decoded));
    const req = decoded.request, ctx = requestContext(req, FAMILIES);
    const reqHidden = initialHidden(tpl, ctx, new Set(cfg.request.acceptExtras.filter((/** @type {string} */ id) => ctx.extras.has(id))));
    const reqWm = watermarkText({ purpose: req.purpose, recipient: req.from, date, onlyFor });

    const hash = (/** @type {HTMLCanvasElement} */ cv) => {
      const d = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d')).getImageData(0, 0, cv.width, cv.height).data;
      let h = 0x811c9dc5; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 0x01000193) >>> 0;
      return `${cv.width}x${cv.height}:${h.toString(16)}`;
    };
    /** @type {Record<string, { url: string, hash: string }>} */
    const images = {};
    for (const side of SIDE_LIST) {
      const img = new Image(); img.src = `/${tpl.sample[side]}`; await img.decode();
      const base = document.createElement('canvas'); base.width = img.naturalWidth; base.height = img.naturalHeight;
      /** @type {CanvasRenderingContext2D} */ (base.getContext('2d')).drawImage(img, 0, 0);
      const render = (/** @type {Set<string>} */ hidden, /** @type {string} */ watermark) => {
        const out = document.createElement('canvas');
        renderRedacted(out, base, side, { template: tpl, hidden, mode: 'pixel', bw: false, watermark, seed: cfg.redactionSeed });
        return out;
      };
      const put = (/** @type {string} */ name, /** @type {HTMLCanvasElement} */ cv) => { images[name] = { url: cv.toDataURL('image/png'), hash: hash(cv) }; };
      put(`card-${side}-clean`, base);
      put(`card-${side}-allhidden`, render(new Set(tpl.fields.filter(f => f.zones.some(z => z.side === side)).map(f => f.id)), ''));
      put(`card-${side}-default`, render(new Set(tpl.fields.filter(f => f.hide).map(f => f.id)), ''));
      put(`send-card-${side}-final`, render(sendHidden, sendWm));
      put(`send-card-${side}-nowm`, render(sendHidden, ''));
      put(`req-card-${side}-final`, render(reqHidden, reqWm));
      put(`req-card-${side}-nowm`, render(reqHidden, ''));
    }
    return { images, date, sendWm, reqWm, sendHidden: [...sendHidden], reqHidden: [...reqHidden], ownFragment, usedFragment: fragment || ownFragment };
  }, { lang: LANG, cfg: config, fragment: requestFragment });
  await ctx.close();

  const desc = {
    clean: 'Reference scan, untouched',
    allhidden: 'Every field with a zone on this side hidden, pixel mode, no watermark (clip per-field patches from here)',
    default: 'Template default hidden fields, pixel mode, no watermark',
    'send-final': 'Send flow output: default hidden + config.send.extraHidden, pixel, colour, with watermark',
    'send-nowm': 'Send flow hidden set without the watermark',
    'req-final': 'Request flow output (what the recipient sends): only requested fields shown, accepted extras shown, with watermark',
    'req-nowm': 'Request flow hidden set without the watermark',
  };
  for (const [name, { url, hash }] of Object.entries(res.images)) {
    const kind = name.replace(/^(send|req)-card-(front|back)-(.*)$/, '$1-$3').replace(/^card-(front|back)-/, '');
    record(`${name}.png`, fromDataUrl(url), `${/** @type {any} */ (desc)[kind]} (${name.includes('front') ? 'front' : 'back'})`, { pixelHash: hash });
  }
  manifest.watermarkDate = res.date;
  Object.assign(manifest.watermarks, { send: res.sendWm, request: res.reqWm });
  manifest.hidden = { send: res.sendHidden, request: res.reqHidden };
  if (requestFragment && requestFragment !== res.ownFragment) warn('the builder link differs from the request encoded from config');
  if (!manifest.requestLink) manifest.requestLink = 'app/#' + res.usedFragment;

  // The UI and these renders must agree (same seed, date, hidden set).
  for (const [flow, wmKey, prefix] of /** @type {const} */ ([['send', 'send', 'send-card'], ['request', 'request', 'req-card']])) {
    if (!uiHashes[flow]) continue;
    const uiWm = manifest.watermarks[flow === 'send' ? 'sendUi' : 'requestUi'];
    if (uiWm !== manifest.watermarks[wmKey]) warn(`${flow}: UI watermark "${uiWm}" differs from rendered "${manifest.watermarks[wmKey]}"`);
    const mine = [res.images[`${prefix}-front-final`].hash, res.images[`${prefix}-back-final`].hash];
    if (uiHashes[flow].join() !== mine.join()) warn(`${flow}: step-4 canvases (${uiHashes[flow]}) differ from the renders (${mine})`);
    else console.log(`  ${flow}: step-4 canvases are pixel-identical to the renders`);
  }
}

/** zones.json (language independent, both languages' labels). */
async function writeZones() {
  /** @type {Record<string, Record<string, string>>} */
  const dicts = {};
  for (const l of config.langs) dicts[l] = (await imp(`locales/${l}.js`)).default;
  /** @type {Record<string, Record<string, any>>} */
  const sides = { front: {}, back: {} };
  for (const f of TEMPLATE.fields) for (const side of /** @type {const} */ (['front', 'back'])) {
    const rects = f.zones.filter(z => z.side === side).map(({ x, y, w, h }) => ({ x, y, w, h }));
    if (!rects.length) continue;
    sides[side][f.id] = { rects, label: Object.fromEntries(config.langs.map((/** @type {string} */ l) => [l, dicts[l][`field.${f.id}`]])), hiddenByDefault: f.hide };
  }
  const zones = { template: config.template, units: 'fractions of the card (0-1), after the version overrides', sides };
  writeFileSync(join(CAPTURES, 'zones.json'), JSON.stringify(zones, null, 2) + '\n');
}

try {
  if (FLOW !== 'request') { await sendFlow(); await cropFlow(); }
  if (FLOW !== 'send') await requestFlow();
  await cardRenders();
  await writeZones();
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${Object.keys(manifest.files).length} files + manifest.json to ${OUT}`);
  if (manifest.warnings.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
