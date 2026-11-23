// @ts-check
// Landing page (index.html): loads cleanly under the CSP, has its sections, switches language and links to the app.
import { test, expect } from '@playwright/test';

/** Collect console errors (CSP violations included) and requests that leave the site. */
function watch(page, baseURL) {
  const errors = [], outside = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => {
    const u = r.url();
    if (!u.startsWith(baseURL) && !u.startsWith('blob:') && !u.startsWith('data:')) outside.push(u);
  });
  return { errors, outside };
}

test('landing loads with no console errors and nothing leaves the site', async ({ page, baseURL }) => {
  const seen = watch(page, String(baseURL));
  await page.goto('/');
  await expect(page.locator('h1')).toContainText(/Comparte tu DNI/i);
  await page.evaluate(() => document.fonts.ready);
  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('has one h1 and the expected section headings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  for (const id of ['video', 'por-que', 'funciones', 'como', 'verifica', 'pedir', 'faq']) {
    await expect(page.locator(`section#${id} h2`)).toHaveCount(1);
  }
  await expect(page.locator('#faq details')).toHaveCount(5);
});

test('the ES/EN switch changes the headline and the document language', async ({ page }) => {
  await page.goto('/');
  const h1 = page.locator('h1');
  await expect(h1).toContainText(/Solo lo justo/i);
  await page.locator('.hero [data-lang-switch] button', { hasText: 'EN' }).click();
  await expect(h1).toContainText(/Just enough/i);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.hero .btn-primary')).toContainText('Protect my ID');
});

test('the primary calls to action go to the app and the request builder', async ({ page }) => {
  await page.goto('/');
  const primary = page.getByRole('link', { name: /Proteger mi DNI/ });
  await expect(primary).toHaveAttribute('href', 'app/');
  await expect(page.getByRole('link', { name: 'Pedir un DNI a alguien' })).toHaveAttribute('href', 'app/request.html');
  await primary.click();
  await expect(page).toHaveURL(/\/app\/$/);
});

test('the video placeholder is disabled and labelled as coming soon', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.play')).toBeDisabled();
  await expect(page.locator('.soon-badge')).toBeVisible();
});

test('"Copiar el texto" copies the prompt and shows the Copiado state', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const btn = page.locator('#copy-btn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(btn).toHaveText('Copiado');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('github.com/lcandea/justid');
});

test('no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('FAQ: the first answer starts open and at most one is open at a time', async ({ page }) => {
  await page.goto('/');
  const items = page.locator('details[name="faq"]');
  await expect(items).toHaveCount(5);
  await expect(items.nth(0)).toHaveAttribute('open', '');
  await items.nth(2).locator('summary').click();
  await expect(items.nth(2)).toHaveAttribute('open', '');
  await expect(items.nth(0)).not.toHaveAttribute('open', '');
  await expect(page.locator('details[name="faq"][open]')).toHaveCount(1);
});

test('"try it with the sample ID" opens a real example request with the specimen photos loaded', async ({ page, baseURL }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/');
  const tryLink = page.locator('#req-try');
  await expect(tryLink).toHaveAttribute('href', /^app\/\?demo=specimenv4#req=1&.*from=JustID/);
  await expect(page.locator('#req-url-frag')).toContainText('justid%40justid.com');
  await tryLink.click();
  await expect(page).toHaveURL(/\/app\/\?demo=specimenv4#req=1/);
  await expect(page.locator('#demo-note')).toBeVisible();
  await expect(page.locator('#req-panel')).toContainText('JustID');
  await expect(page.locator('#slot-front .slot-bar')).toBeVisible();
  await expect(page.locator('#slot-back .slot-bar')).toBeVisible();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)');
  // "use my photos" keeps the request but drops the test mode
  await expect(page.locator('#demo-exit')).toHaveAttribute('href', /^\/app\/#req=1&/);
  await page.locator('#nav-next').click();
  await expect(page.locator('.step[data-step="1"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?demo=specimenv3 loads the v3 specimen and identifies it as v3', async ({ page }) => {
  await page.goto('/app/?demo=specimenv3');
  await expect(page.locator('#demo-note')).toBeVisible();
  await expect(page.locator('#slot-front .slot-bar')).toBeVisible();
  await expect(page.locator('#slot-back .slot-bar')).toBeVisible();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v3 (2015–2021)');
});

test('step 1 offers to try with a v3 or v4 sample ID, keeping the request link', async ({ page }) => {
  await page.goto('/app/#keep-me');
  await expect(page.locator('#demo-v3')).toHaveAttribute('href', '/app/?demo=specimenv3#keep-me');
  await page.locator('#demo-v4').click();
  await expect(page).toHaveURL(/\/app\/\?demo=specimenv4#keep-me$/);
  await expect(page.locator('#demo-note')).toBeVisible();
  await expect(page.locator('#tpl-name')).toHaveText('DNI España v4 (desde 2021)');
});

test('/why loads cleanly, has both audiences, switches language and links to the app', async ({ page, baseURL }) => {
  const seen = watch(page, String(baseURL));
  await page.goto('/why/#receive');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('section#send h2')).toHaveCount(1);
  await expect(page.locator('section#receive h2')).toBeInViewport();
  await expect(page.locator('a[href="/app/request.html"]')).toHaveCount(1);
  await expect(page.locator('a[href="/app/"]')).toHaveCount(1);
  await page.locator('.site-header [data-lang-switch] button', { hasText: 'EN' }).click();
  await expect(page.locator('h1')).toContainText(/just enough/i);
  await expect(page.locator('#receive .why-sources a').first()).toHaveAttribute('href', /eur-lex\.europa\.eu\/legal-content\/EN\//);
  await page.evaluate(() => document.fonts.ready);
  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]);
});

test('the hero specimen can be dragged (also with reduced motion) and moved with the keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const card = page.locator('.id-card');
  const pos = () => card.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--pos')));
  await expect(card).toHaveAttribute('role', 'slider');
  expect(await pos()).toBe(62);
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await card.boundingBox());
  const midY = box.y + box.height / 2;
  // Pointer events work the same for mouse and touch (Playwright's mouse doesn't drag on emulated phones).
  const fire = (type, fx) => card.dispatchEvent(type, { pointerId: 7, button: 0, isPrimary: true, clientX: box.x + box.width * fx, clientY: midY });
  await fire('pointerdown', 0.3);
  await fire('pointermove', 0.55);
  await fire('pointermove', 0.8);
  await fire('pointerup', 0.8);
  await expect(card).toHaveClass(/is-manual/);
  expect(Math.abs(await pos() - 80)).toBeLessThan(6); // the card is rotated 4°, so roughly
  await card.focus();
  await page.keyboard.press('Home');
  expect(await pos()).toBe(0);
  await expect(card).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('ArrowRight');
  expect(await pos()).toBe(5);
});

test('after a drag the specimen animation resumes 5 s later, from where the line was left', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  const card = page.locator('.id-card');
  const box = /** @type {{ x: number, y: number, width: number, height: number }} */ (await card.boundingBox());
  const fire = (type, fx) => card.dispatchEvent(type, { pointerId: 3, button: 0, isPrimary: true, clientX: box.x + box.width * fx, clientY: box.y + box.height / 2 });
  await fire('pointerdown', 0.4);
  await fire('pointerup', 0.4);
  await expect(card).toHaveClass(/is-manual/);
  await page.clock.runFor(4000);
  await expect(card).toHaveClass(/is-manual/);
  await page.clock.runFor(1500);
  await expect(card).not.toHaveClass(/is-manual/);
  // The animation restarts at the phase where the line sits where it was left (about 40 %), not at the edge.
  const left = await page.locator('.scan').evaluate(el => el.offsetLeft / /** @type {HTMLElement} */ (el.parentElement).offsetWidth * 100);
  expect(Math.abs(left - 40)).toBeLessThan(12);
});
