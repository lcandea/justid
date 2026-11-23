// @ts-check
// End-to-end checks of the app: the full flow, privacy guarantees, identification UX and i18n.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Upload an image into a side's gallery input and accept the detected framing. */
async function addPhoto(page, side, file) {
  await page.locator(`#slot-${side} .gal input[type=file]`).setInputFiles(file);
  await expect(page.locator('#crop-ov')).toBeVisible();
  await expect(page.locator('#crop-msg')).toHaveText(/Tarjeta detectada|Card detected/);
  await page.locator('#crop-use').click();
  await expect(page.locator('#crop-ov')).toBeHidden();
  await expect(page.locator(`#slot-${side} canvas.thumb`)).toBeVisible();
}

test('full flow: photo -> auto-identified -> hide -> purpose -> PDF, with no errors and no outside requests', async ({ page, baseURL }) => {
  const errors = [], requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => requests.push(r.url()));

  await page.goto('/app/');
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)'); // default template

  await addPhoto(page, 'front', 'img/dni_es_v3_front.webp');
  // identified as v3 automatically, with the "detectado" badge
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v3 (2015–2021)');
  await expect(page.locator('#tpl-auto')).toBeVisible();

  await page.locator('#nav-next').click(); // -> hide
  await expect(page.locator('.fld')).not.toHaveCount(0);
  await page.locator('#nav-next').click(); // -> purpose
  await expect(page.locator('#nav-next')).toBeDisabled();
  await page.locator('#chips button').first().click();
  await page.locator('#nav-next').click(); // -> share
  await expect(page.locator('#summary')).toContainText('SOLO PARA: ALQUILER DE VIVIENDA');

  const dl = page.locator('#btn-dl');
  const trigger = (await dl.isVisible()) ? dl : page.locator('#nav-next');
  const [download] = await Promise.all([page.waitForEvent('download'), trigger.click()]);
  const pdf = readFileSync(/** @type {string} */ (await download.path()));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(20_000);

  expect(errors).toEqual([]);
  expect(requests.filter(u => !u.startsWith(/** @type {string} */ (baseURL)) && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
});

test('the page cannot send data anywhere (CSP blocks network APIs)', async ({ page, baseURL }) => {
  const outside = [];
  page.on('request', r => { if (!r.url().startsWith(/** @type {string} */ (baseURL))) outside.push(r.url()); });
  await page.goto('/app/');
  const outcome = await page.evaluate(async () => {
    /** @type {string[]} */
    const violations = [];
    document.addEventListener('securitypolicyviolation', e => violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    const tries = {
      fetch: () => fetch('https://example.com/collect', { method: 'POST', body: 'x' }),
      sameOriginFetch: () => fetch('/app/'),
      xhr: () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.onload = res; x.onerror = rej; x.open('GET', '/app/'); x.send(); }),
    };
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, fn] of Object.entries(tries)) {
      try { await fn(); out[k] = 'sent'; } catch { out[k] = 'blocked'; }
    }
    // sendBeacon only queues (returns true); the CSP blocks it when it is actually dispatched.
    navigator.sendBeacon('https://example.com/beacon', 'x');
    await new Promise(r => setTimeout(r, 500));
    out.beaconBlocked = violations.some(v => v.startsWith('connect-src') && v.includes('example.com/beacon'));
    return out;
  });
  expect(outcome).toEqual({ fetch: 'blocked', sameOriginFetch: 'blocked', xhr: 'blocked', beaconBlocked: true });
  expect(outside).toEqual([]); // nothing ever left for another host
});

test('warns when the manually chosen version does not match the photo', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('#tpl').selectOption('dni_es_v4'); // manual choice
  await addPhoto(page, 'front', 'img/dni_es_v3_front.webp');
  const warn = page.locator('#tpl-warn');
  await expect(warn).toBeVisible();
  await expect(warn).toContainText('DNI España v3');
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)'); // not switched silently
  await warn.getByRole('button', { name: /Cambiar a/ }).click();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v3 (2015–2021)');
  await expect(warn).toBeHidden();
});

test.describe('english browser', () => {
  test.use({ locale: 'en-GB' });
  test('shows English by default and can switch to Spanish', async ({ page }) => {
    await page.goto('/app/');
    await expect(page.locator('h2').first()).toHaveText('Take a photo of each side');
    await expect(page).toHaveTitle(/just enough/i);
    await page.locator('#lang button', { hasText: 'ES' }).click();
    await expect(page.locator('h2').first()).toHaveText('Haz una foto de cada cara');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#tpl option').first()).toHaveText('DNI España v4 (desde 2021)');
  });
});

test('privacy dialog opens from the lock badge and links to the repository', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('#lock-btn').click();
  await expect(page.locator('#privacy')).toBeVisible();
  await expect(page.locator('#privacy-repo')).toHaveAttribute('href', 'https://github.com/lcandea/justid');
  await page.locator('#privacy-close').click();
  await expect(page.locator('#privacy')).toBeHidden();
});

test('zone editor loads the default template with its reference picture', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/app/editor.html');
  await expect(page.locator('#tpl')).toHaveValue('dni_es_v4');
  await expect(page.locator('.field-row')).not.toHaveCount(0);
  // the board takes the reference picture's aspect ratio (1012x638) once loaded
  await expect.poll(async () => page.locator('#board').evaluate(c => c.clientWidth / c.clientHeight)).toBeCloseTo(1012 / 638, 1);
  expect(errors).toEqual([]);
});

for (const width of [360, 412]) {
  test(`no horizontal overflow at ${width}px, in both languages`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app/');
    for (const lang of ['ES', 'EN']) {
      await page.locator('#lang button', { hasText: lang }).click();
      const { scroll, client, header } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
        header: Math.max(...[...document.querySelectorAll('.brand *')].map(e => e.getBoundingClientRect().right)),
      }));
      expect(scroll, `${lang}: page scrolls sideways`).toBeLessThanOrEqual(client);
      expect(header, `${lang}: header content cut off`).toBeLessThanOrEqual(client);
    }
  });
}

test('reference pictures open full screen and can be zoomed', async ({ page, isMobile }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('.tpl-pv-open').first().click();
  const viewer = page.locator('dialog.zoom-viewer');
  await expect(viewer).toBeVisible();
  const scale = () => page.locator('.zoom-img').evaluate(i => new DOMMatrix(getComputedStyle(i).transform).a);
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.zoom-img').boundingBox());
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (isMobile) {
    await page.touchscreen.tap(cx, cy); await page.touchscreen.tap(cx, cy); // double tap
  } else {
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -400);
  }
  await expect.poll(scale).toBeGreaterThan(1.5);
  await page.locator('.zoom-close').click();
  await expect(viewer).toBeHidden();
});

test('pinch gesture zooms the reference picture', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('.tpl-pv-open').first().click();
  const scale = await page.evaluate(async () => {
    const d = /** @type {HTMLDialogElement} */ (document.querySelector('dialog.zoom-viewer'));
    const r = d.getBoundingClientRect(), cx = r.width / 2, cy = r.height / 2;
    const fire = (type, id, x, y) => d.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    fire('pointerdown', 1, cx - 40, cy); fire('pointerdown', 2, cx + 40, cy);   // fingers 80 px apart
    fire('pointermove', 1, cx - 120, cy); fire('pointermove', 2, cx + 120, cy); // spread to 240 px
    fire('pointerup', 1, cx - 120, cy); fire('pointerup', 2, cx + 120, cy);
    await new Promise(r => requestAnimationFrame(r));
    return new DOMMatrix(getComputedStyle(/** @type {Element} */ (document.querySelector('.zoom-img'))).transform).a;
  });
  expect(scale).toBeCloseTo(3, 1); // 240 / 80
});
