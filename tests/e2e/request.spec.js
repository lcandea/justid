// @ts-check
// End-to-end checks of request links: the requester builds a link (app/request.html), the
// recipient opens it, accepts the extra fields one by one, and gets a prefilled way to send it back.
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

/** App URL with a request fragment built from key/value pairs. @param {Record<string, string>} pairs */
const requestUrl = pairs => '/app/#' + new URLSearchParams(pairs).toString();

/** Collect page errors and requests that leave the site. */
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

test('requester -> recipient: build a link, open it, accept an extra field, send it back', async ({ page, baseURL }) => {
  const seen = watch(page, /** @type {string} */ (baseURL));

  // --- the requester builds the link ---
  await page.goto('/app/request.html');
  await page.locator('#b-from').fill('Inmobiliaria ABC');
  await page.locator('#b-chips button', { hasText: 'Alquiler de vivienda' }).click();
  await page.locator('.b-field input[data-f="address"]').check();
  await page.locator('.b-field input[data-f="birth_place"]').check();
  // the usual fields come ticked, but the requester may ask for less
  await expect(page.locator('.b-field input[data-f="birth_date"]')).toBeChecked();
  await page.locator('.b-field input[data-f="birth_date"]').uncheck();
  // address is only on the back of the card: the back side becomes required
  await expect(page.locator('#b-back')).toBeChecked();
  await expect(page.locator('#b-back')).toBeDisabled();
  await expect(page.locator('#b-dial')).toHaveAttribute('aria-label', 'Prefijo: España (+34). Cambiar'); // Spain by default
  await page.locator('#b-contact').fill('600 11 22 33');
  await expect(page.locator('#b-phone-preview')).toHaveText('Se usará: +34600112233');
  await page.locator('#b-create').click();
  // extra fields need a justification
  await expect(page.locator('#b-error')).toHaveText('Has pedido datos extra: explica por qué los necesitas.');
  await expect(page.locator('#b-result')).toBeHidden();
  await page.locator('#b-why').fill('El contrato de arrendamiento debe incluir tu domicilio actual.');
  await expect(page.locator('#b-why-count')).toHaveText('62/240');
  await page.locator('#b-create').click();
  await expect(page.locator('#b-result')).toBeVisible();
  const link = await page.locator('#b-link').inputValue();
  expect(link).toMatch(/\/app\/#req=1&doc=dni_es&from=Inmobiliaria\+ABC&for=Alquiler\+de\+vivienda&fields=given_name%2Csurnames%2Cdocument_number%2Cphoto%2Cexpiry_date%2Caddress%2Cbirth_place&back=1&wa=34600112233&why=/);
  await expect(page.locator('#b-wa')).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=.*%23req%3D1/);
  await expect(page.locator('#b-mail')).toHaveAttribute('href', /^mailto:\?subject=/);
  await expect(page.locator('#b-preview')).toHaveAttribute('href', link);
  // editing anything hides the now-stale link
  await page.locator('#b-from').fill('Inmobiliaria ABCD');
  await expect(page.locator('#b-result')).toBeHidden();

  // --- the recipient opens it ---
  await page.goto(link);
  const panel = page.locator('#req-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toHaveText('Solicitud de Inmobiliaria ABC');
  await expect(panel).toContainText('Para: Alquiler de vivienda');
  await expect(panel).toContainText('Datos que pide: Nombre, Apellidos, Número de DNI, Fotografía, Fecha de validez, Domicilio, Lugar de nacimiento.');
  await expect(panel).toContainText('Inmobiliaria ABC te pide estos datos extra');
  await expect(panel).not.toContainText('normalmente se comparten (según');
  await expect(panel).toContainText('Su justificación es (la ha escrito Inmobiliaria ABC, no JustID):');
  await expect(panel.locator('blockquote.req-why')).toHaveText('El contrato de arrendamiento debe incluir tu domicilio actual.');
  await expect(panel).toContainText('También te pide el reverso.');
  await expect(panel).toContainText('WhatsApp al +34600112233');
  await expect(page.locator('#req-cta')).toBeHidden();
  // each extra field is highlighted and starts NOT accepted
  const address = panel.locator('input[data-f="address"]'), birthPlace = panel.locator('input[data-f="birth_place"]');
  await expect(address).not.toBeChecked();
  await expect(birthPlace).not.toBeChecked();
  await expect(panel.locator('.req-extra-row')).toHaveCount(2);
  await expect(page.locator('#tpl option')).toHaveCount(2); // only DNI versions
  // the back is asked for: the tip doesn't call it optional, and the slot says who asks
  await expect(page.locator('#photos-tip')).not.toContainText('opcional');
  await expect(page.locator('#photos-tip')).toContainText('Te piden las dos caras.');
  await expect(page.locator('#slot-back .empty')).toContainText('Te lo pide Inmobiliaria ABC');

  await addPhoto(page, 'front', 'img/dni_es_v4_front.webp');
  await addPhoto(page, 'back', 'img/dni_es_v4_back.webp');
  await address.check(); // explicit acceptance, one field at a time
  await expect(panel.locator('.req-extra-row.accepted')).toHaveCount(1);
  await expect(panel.locator('.req-extra-row.accepted')).toContainText('Aceptado: se mostrará');

  await page.locator('#nav-next').click(); // -> hide
  const hidden = id => page.locator(`.fld[data-f="${id}"] input`);
  await expect(hidden('address')).not.toBeChecked();    // accepted extra: shown
  await expect(hidden('birth_place')).toBeChecked();    // not accepted: still hidden
  await expect(hidden('given_name')).not.toBeChecked(); // requested (usual field): shown
  await expect(hidden('birth_date')).toBeChecked();      // usual field the requester left out: hidden
  await expect(hidden('mrz')).toBeChecked();            // not requested: hidden
  await expect(page.locator('.fld.req-extra')).toHaveCount(2);
  await expect(page.locator('.fld[data-f="birth_place"]')).toContainText('te lo pide Inmobiliaria ABC');
  // showing an extra from the field list counts as accepting it, and the panel follows
  await hidden('birth_place').dispatchEvent('click'); // the sticky preview can cover the row on short screens
  await expect(hidden('birth_place')).not.toBeChecked();
  await expect(panel.locator('input[data-f="birth_place"]')).toBeChecked();

  await page.locator('#nav-next').click(); // -> purpose, prefilled from the request
  await expect(page.locator('#purpose')).toHaveValue('Alquiler de vivienda');
  await expect(page.locator('#recipient')).toHaveValue('Inmobiliaria ABC');
  await page.locator('#nav-next').click(); // -> share
  await expect(page.locator('#summary')).toContainText('SOLO PARA: ALQUILER DE VIVIENDA · INMOBILIARIA ABC');

  const send = page.locator('#req-send');
  await expect(send).toBeVisible();
  await expect(send).toContainText('Envíaselo a Inmobiliaria ABC');
  await expect(send).toContainText('WhatsApp no permite adjuntar archivos');
  const sendLink = page.locator('#req-send-link');
  await expect(sendLink).toHaveText('Abrir WhatsApp (+34600112233)');
  await expect(sendLink).toHaveAttribute('href', /^https:\/\/wa\.me\/34600112233\?text=Hola%2C%20te%20env%C3%ADo/);
  await expect(sendLink).toHaveAttribute('target', '_blank');
  await expect(sendLink).toHaveAttribute('rel', /noreferrer/);

  // the PDF still comes first (download / share sheet)
  const dl = page.locator('#btn-dl');
  const trigger = (await dl.isVisible()) ? dl : page.locator('#nav-next');
  const [download] = await Promise.all([page.waitForEvent('download'), trigger.click()]);
  const pdf = readFileSync(/** @type {string} */ (await download.path()));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  expect(seen.errors).toEqual([]);
  expect(seen.outside).toEqual([]); // nothing was sent anywhere, the request included
});

test('normal request: says so, credits INCIBE and the AEPD, back side stays optional', async ({ page }) => {
  await page.goto(requestUrl({ req: '1', doc: 'dni_es', from: 'Gimnasio Sol', for: 'Alta en gimnasio', fields: 'given_name,surnames,document_number', mail: 'altas@gimnasio.example' }));
  const panel = page.locator('#req-panel');
  await expect(panel).toContainText('Gimnasio Sol solo te pide los datos que normalmente se comparten (según las recomendaciones de INCIBE y la AEPD).');
  await expect(panel).not.toContainText(/gobierno/i);
  await expect(panel).toContainText('No necesita el reverso.');
  await expect(panel.locator('.req-extra-row')).toHaveCount(0);
  await expect(page.locator('#slot-back')).toBeVisible();
  await expect(page.locator('#slot-back .empty')).toContainText('Opcional');
  await expect(page.locator('#photos-tip')).toContainText('El reverso es opcional.');
  await addPhoto(page, 'front', 'img/dni_es_v4_front.webp');
  await page.locator('#nav-next').click();
  // fewer than the usual fields: only the requested ones are shown
  await expect(page.locator('.fld[data-f="document_number"] input')).not.toBeChecked();
  await expect(page.locator('.fld[data-f="photo"] input')).toBeChecked();
  await expect(page.locator('.fld[data-f="birth_date"] input')).toBeChecked();
  await page.locator('#nav-next').click();
  await page.locator('#nav-next').click();
  const sendLink = page.locator('#req-send-link');
  await expect(sendLink).toHaveAttribute('href', /^mailto:altas@gimnasio\.example\?subject=Copia%20de%20mi%20DNI%3A%20Alta%20en%20gimnasio&body=/);
  await expect(sendLink).not.toHaveAttribute('target', '_blank');
});

test('upload delivery shows the real host and warns that it is an external website', async ({ page }) => {
  await page.goto(requestUrl({ req: '1', doc: 'dni_es', from: 'Banco X', for: 'Apertura de cuenta', fields: 'given_name', up: 'https://subidas.example.com/dni?id=7' }));
  await expect(page.locator('#req-panel')).toContainText('Lo subirás a una web externa: subidas.example.com');
  await addPhoto(page, 'front', 'img/dni_es_v3_front.webp');
  for (let i = 0; i < 3; i++) await page.locator('#nav-next').click();
  await expect(page.locator('#req-send')).toContainText('Es una web externa (subidas.example.com) elegida por Banco X, no por JustID.');
  await expect(page.locator('#req-send-link')).toHaveAttribute('href', 'https://subidas.example.com/dni?id=7');
});

test('hostile request text is shown as plain text, never as markup', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(requestUrl({
    req: '1', doc: 'dni_es', from: '<b id="pwn">Evil</b>', for: '<script>alert(1)</script>', fields: 'address',
    why: '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">click</a>', wa: '34600112233',
  }));
  const panel = page.locator('#req-panel');
  await expect(panel.locator('blockquote.req-why')).toHaveText('<img src=x onerror="alert(1)"><a href="javascript:alert(2)">click</a>');
  await expect(panel.locator('h2')).toHaveText('Solicitud de <b id="pwn">Evil</b>');
  await expect(panel).toContainText('Para: <script>alert(1)</script>');
  await expect(panel.locator('img, a, script, b')).toHaveCount(0);
  await expect(page.locator('#pwn')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
});

test('an invalid or tampered link is ignored with a notice, and the app works as usual', async ({ page }) => {
  for (const url of [
    '/app/#req=1&doc=dni_es&from=Ana&for=x&fields=photo', // no delivery
    '/app/#req=1&doc=dni_es&from=Ana&for=x&wa=34600112233', // no fields
    requestUrl({ req: '1', doc: 'dni_es', from: 'Ana', for: 'x', wa: '34600112233', fields: 'address' }), // extra without justification
    requestUrl({ req: '1', doc: 'dni_es', from: 'a'.repeat(61), for: 'x', fields: 'photo', wa: '34600112233' }), // too long
    '/app/#req=1&doc=dni_es&from=Ana&from=Banco&for=x&fields=photo&wa=34600112233', // duplicate key
  ]) {
    await page.goto('about:blank');
    await page.goto(url);
    await expect(page.locator('#req-invalid'), url).toBeVisible();
    await expect(page.locator('#req-panel')).toBeHidden();
    await expect(page.locator('#req-cta')).toBeVisible();
    await expect(page.locator('#slot-back')).toBeVisible();
    await expect(page.locator('#purpose')).toHaveValue('');
  }
});

test('the request page ships the strict CSP and works in English', async ({ page }) => {
  await page.goto('/app/request.html');
  await page.locator('#lang button', { hasText: 'EN' }).click();
  await expect(page.locator('h2')).toHaveText('Ask for a copy of an ID, just enough');
  await page.locator('#b-delivery button', { hasText: 'Upload link' }).click();
  await expect(page.locator('#b-contact-label')).toHaveText('Your upload page (https://…)');
  await page.locator('#b-from').fill('ABC');
  await page.locator('#b-purpose').fill('Rental');
  await page.locator('#b-contact').fill('http://insecure.example.com/');
  await page.locator('#b-create').click();
  await expect(page.locator('#b-error')).toHaveText('The upload link must start with https:// and be a valid web address.');
  const blocked = await page.evaluate(async () => { try { await fetch('/app/'); return false; } catch { return true; } });
  expect(blocked).toBe(true);
});

for (const width of [360, 412]) {
  test(`request pages have no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const url of ['/app/request.html#picker', requestUrl({ req: '1', doc: 'dni_es', from: 'Inmobiliaria con un nombre bastante largo S.L.', for: 'Alquiler de vivienda', fields: 'address,signature', why: 'x'.repeat(240), up: 'https://example.com/' + 'y'.repeat(200) })]) {
      await page.goto(url);
      if (url.endsWith('#picker')) { await page.locator('#b-dial').click(); await expect(page.locator('#b-dial-list li').first()).toBeVisible(); }
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll, url).toBeLessThanOrEqual(client);
    }
  });
}

test('country code picker: searchable by name or prefix, keyboard friendly, full number in the link', async ({ page, isMobile }) => {
  await page.goto('/app/request.html');
  await page.locator('#b-from').fill('ABC');
  await page.locator('#b-purpose').fill('Alquiler');
  const btn = page.locator('#b-dial'), search = page.locator('#b-dial-search'), pop = page.locator('#b-dial-pop');
  await expect(btn).toContainText('+34');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');

  // by name (accents ignored), picked with the keyboard
  await btn.click();
  await expect(pop).toBeVisible();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toBeFocused();
  const popBox = await pop.boundingBox(), btnBox = await btn.boundingBox();
  if (isMobile) {
    // phones: full-screen sheet with the search box on top, so the keyboard never covers it
    await expect(pop).toHaveClass(/\bsheet\b/);
    expect(popBox && popBox.y <= 1).toBe(true);
    const searchBox = await search.boundingBox(), vh = page.viewportSize()?.height ?? 0;
    expect(searchBox && searchBox.y < vh / 3).toBe(true);
    await expect(page.locator('#b-dial-close')).toBeVisible();
  } else {
    // desktop: opens upwards (the field sits near the end of the page), fully on screen
    await expect(page.locator('#b-dial-close')).toBeHidden();
    expect(popBox && btnBox && popBox.y + popBox.height <= btnBox.y + 1).toBe(true);
    expect(popBox && popBox.y >= 0).toBe(true);
  }
  await search.fill('portu');
  await expect(page.locator('#b-dial-list li')).toHaveCount(1);
  await expect(page.locator('#b-dial-list li')).toContainText('Portugal');
  await expect(search).toHaveAttribute('aria-activedescendant', 'b-dial-list-PT');
  await search.press('Enter');
  await expect(pop).toBeHidden();
  await expect(btn).toBeFocused();
  await expect(btn).toContainText('+351');
  await expect(btn).toHaveAttribute('aria-label', 'Prefijo: Portugal (+351). Cambiar');

  // by prefix, with the arrow keys; Escape closes without changing anything
  await btn.press('ArrowDown');
  await search.fill('+44');
  await expect(page.locator('#b-dial-list li').first()).toContainText('+44');
  await expect(page.locator('#b-dial-list')).toContainText('Reino Unido');
  await search.press('Escape');
  await expect(pop).toBeHidden();
  await expect(btn).toContainText('+351');
  await btn.click();
  await search.fill('zzzz');
  await expect(page.locator('#b-dial-empty')).toBeVisible();
  await search.press('Escape');

  await page.locator('#b-contact').fill('912 345 678');
  await expect(page.locator('#b-phone-preview')).toHaveText('Se usará: +351912345678');
  await page.locator('#b-create').click();
  await expect(page.locator('#b-link')).toHaveValue(/&wa=351912345678(&|$)/);

  // mouse/touch pick, and names follow the UI language
  await btn.click();
  await search.fill('alem');
  await page.locator('#b-dial-list li', { hasText: 'Alemania' }).click();
  await expect(btn).toContainText('+49');
  await page.locator('#lang button', { hasText: 'EN' }).click();
  await expect(btn).toHaveAttribute('aria-label', 'Country code: Germany (+49). Change');

  // email delivery: no country picker
  await page.locator('#b-delivery button', { hasText: 'Email' }).click();
  await expect(btn).toBeHidden();
});

test('country code picker: the phone sheet closes with its button and unlocks the page', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'sheet mode is for phones');
  await page.goto('/app/request.html');
  await page.locator('#b-dial').click();
  await expect(page.locator('#b-dial-pop')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bdial-lock\b/);
  await page.locator('#b-dial-close').click();
  await expect(page.locator('#b-dial-pop')).toBeHidden();
  await expect(page.locator('html')).not.toHaveClass(/\bdial-lock\b/);
  await expect(page.locator('#b-dial')).toBeFocused();
});
