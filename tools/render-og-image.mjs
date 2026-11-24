// @ts-check
// Dev-only: renders the social preview image (Open Graph / Twitter card) shared/og/og-es.png at 1200×630
// from tools/og-image.html, with the site's own fonts and the landing's covered specimen. Never shipped.
// Re-run it whenever the source page, the brand or the landing specimen change.
// Usage: npm run render-og-image
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8798;
const OUT = join(ROOT, 'shared/og/og-es.png');

const server = spawn('python3', ['tools/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
try {
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/tools/og-image.html`);
  await page.evaluate(() => Promise.all([document.fonts.load('900 100px Archivo'), document.fonts.load('400 22px "JetBrains Mono"')]));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
  mkdirSync(dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log('wrote', OUT);
  await browser.close();
} finally {
  server.kill();
}
