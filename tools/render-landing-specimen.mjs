// @ts-check
// Dev-only: renders the landing's "covered" specimen (landing/img/dni_es_v4_front_covered_<lang>.webp) with the
// app's own redaction code, so the hero shows real JustID output. Never shipped to the site.
// It loads templates/ref/dni_es_v4_front.webp in a headless browser and calls renderRedacted() (app/js/redact.js)
// with the v4 template's default hidden fields, pixel mode and a fixed example watermark, once per language.
// Re-run it whenever redact.js, the default visibility (templates/dni_es.js) or the v4 zones change.
// Usage: npm run render-landing-specimen
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;

/** The example purpose baked into each image (the app upper-cases its watermark the same way). */
const WATERMARKS = {
  es: 'SOLO PARA: ALQUILER C/ MAYOR 12 · 23/11/2026',
  en: 'ONLY FOR: RENTAL C/ MAYOR 12 · 23/11/2026',
};

const server = spawn('python3', ['tools/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
try {
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  // The site's CSP forbids inline/evaluated scripts; bypass it only for this local render.
  const page = await (await browser.newContext({ bypassCSP: true })).newPage();
  await page.goto(`http://localhost:${PORT}/index.html`);
  for (const [lang, watermark] of Object.entries(WATERMARKS)) {
    const dataUrl = await page.evaluate(async watermark => {
      const { renderRedacted } = await import('/app/js/redact.js');
      const { officialTemplates } = await import('/app/js/templates.js');
      const template = officialTemplates().find(t => t.id === 'dni_es_v4');
      if (!template) throw new Error('dni_es_v4 template not found');
      const img = new Image();
      img.src = '/templates/ref/dni_es_v4_front.webp';
      await img.decode();
      const base = document.createElement('canvas');
      base.width = img.naturalWidth; base.height = img.naturalHeight;
      base.getContext('2d')?.drawImage(img, 0, 0);
      const hidden = new Set(template.fields.filter(f => f.hide).map(f => f.id));
      const out = document.createElement('canvas');
      renderRedacted(out, base, 'front', { template, hidden, mode: 'pixel', bw: false, watermark });
      return out.toDataURL('image/webp', 0.86);
    }, watermark);
    const file = join(ROOT, `landing/img/dni_es_v4_front_covered_${lang}.webp`);
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', file);
  }
  await browser.close();
} finally {
  server.kill();
}
