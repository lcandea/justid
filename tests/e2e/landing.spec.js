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
