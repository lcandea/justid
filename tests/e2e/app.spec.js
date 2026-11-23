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

test('blocks with a question when the manually chosen version does not match the photo', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('#tpl').selectOption('dni_es_v4'); // manual choice
  await addPhoto(page, 'front', 'img/dni_es_v3_front.webp');
  const dlg = page.locator('#decision');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('DNI España v3');
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)'); // not switched silently
  // it can't be dismissed without answering: Escape, a forced close, or tapping outside
  await page.keyboard.press('Escape');
  await expect(dlg).toBeVisible();
  await page.evaluate(() => /** @type {HTMLDialogElement} */ (document.querySelector('#decision')).close());
  await expect(dlg).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: /Cambiar a/ }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v3 (2015–2021)');
});

test('"it\'s fine" keeps the chosen version and lets you continue', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('#tpl').selectOption('dni_es_v4');
  await addPhoto(page, 'front', 'img/dni_es_v3_front.webp');
  await page.locator('#decision').getByRole('button', { name: 'Mantener' }).click();
  await expect(page.locator('#decision')).toBeHidden();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)');
  await page.locator('#nav-next').click();
  await expect(page.locator('section[data-step="1"]')).toBeVisible();
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
  await expect(page.locator('#privacy-more')).toHaveAttribute('href', '../#verifica');
  await expect(page.locator('#privacy-more')).toHaveAttribute('target', '_blank');
  // focus goes to the dialog itself, not to its first link or button
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('privacy');
  await page.locator('#privacy-close').click();
  await expect(page.locator('#privacy')).toBeHidden();
  // tapping outside the dialog closes it too
  await page.locator('#lock-btn').click();
  await expect(page.locator('#privacy')).toBeVisible();
  await page.mouse.click(5, 5);
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

test('zone editor asks with our own dialogs, not the browser\'s', async ({ page }) => {
  let native = 0;
  page.on('dialog', d => { native++; d.dismiss(); });
  await page.goto('/app/editor.html');
  const rows = page.locator('.field-row');
  await expect(rows).not.toHaveCount(0);
  const before = await rows.count();

  // add a field: a themed dialog with the name field, not window.prompt()
  await page.locator('#field-add').click();
  const ask = page.locator('dialog.ask');
  await expect(ask).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('DIALOG'); // nothing auto-focused
  await ask.locator('input').fill('Mi campo');
  await ask.locator('input').press('Enter');
  await expect(ask).toHaveCount(0);
  await expect(rows).toHaveCount(before + 1);

  // delete it: cancel keeps it, confirming removes it
  await rows.last().locator('.ed-del').click();
  await ask.getByRole('button', { name: 'Cancelar' }).click();
  await expect(rows).toHaveCount(before + 1);
  await rows.last().locator('.ed-del').click();
  await ask.getByRole('button', { name: 'Borrar' }).click();
  await expect(rows).toHaveCount(before);
  expect(native).toBe(0);
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
  // opening it doesn't focus the close button
  expect(await page.evaluate(() => document.activeElement?.classList.contains('zoom-viewer'))).toBe(true);
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

test('tapping outside the enlarged picture closes the viewer', async ({ page, isMobile }) => {
  await page.goto('/app/');
  await page.locator('.tpl-box summary').click();
  await page.locator('.tpl-pv-open').first().click();
  const viewer = page.locator('dialog.zoom-viewer');
  await expect(viewer).toBeVisible();
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await page.locator('.zoom-img').boundingBox());
  const x = box.x + box.width / 2, y = Math.max(2, box.y - 10); // just above the picture
  if (isMobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
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

test('blocks when the back is put in the front slot, and moves it with one tap', async ({ page }) => {
  await page.goto('/app/');
  await addPhoto(page, 'front', 'img/dni_es_v3_back.webp');
  const dlg = page.locator('#decision');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('parece el reverso');
  await expect(page.locator('#decision-photo')).toBeVisible(); // shows which photo it means
  await dlg.getByRole('button', { name: 'Moverla al reverso' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#slot-front .empty')).toBeVisible();
  await expect(page.locator('#slot-back canvas.thumb')).toBeVisible();
  // the version is still recognised from the (now correctly placed) back
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v3 (2015–2021)');
});

test('offers to swap when both photos are in the wrong slots', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('#slot-front .gal input[type=file]').setInputFiles('img/dni_es_v4_back.webp');
  await page.locator('#crop-use').click();
  const dlg = page.locator('#decision');
  await dlg.getByRole('button', { name: 'Está bien así' }).click(); // keep it for now
  await addPhoto(page, 'back', 'img/dni_es_v4_front.webp');
  await dlg.getByRole('button', { name: 'Intercambiar las fotos' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)');
  await page.waitForTimeout(500);
  await expect(dlg).toBeHidden(); // nothing left to ask after the swap
});

test('no question for correctly placed photos', async ({ page }) => {
  await page.goto('/app/');
  await addPhoto(page, 'front', 'img/dni_es_v4_front.webp');
  await addPhoto(page, 'back', 'img/dni_es_v4_back.webp');
  await page.waitForTimeout(500);
  await expect(page.locator('#decision')).toBeHidden();
  await page.locator('#nav-next').click();
  await expect(page.locator('section[data-step="1"]')).toBeVisible();
});
