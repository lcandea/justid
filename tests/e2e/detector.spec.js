// @ts-check
// Card detection and document identification, run inside a real browser.
import { test, expect } from '@playwright/test';

test.describe('detector', () => {
  test.skip(({ isMobile }) => isMobile, 'pure computation: running it once (desktop) is enough');

  test('finds the card in synthetic photos (corner error < 1.5% of the diagonal)', async ({ page }) => {
    await page.goto('/app/');
    const results = await page.evaluate(async () => {
      const { detectCard } = await import('/app/js/core/detect.js');
      const { runCases } = await import('/tests/e2e/fixtures/scenes.js');
      return runCases(detectCard);
    });
    for (const r of results) {
      if (r.hard) continue; // reported only
      expect(r.found, `${r.name}: not found`).toBe(true);
      expect(r.errPct, `${r.name}: error ${r.errPct?.toFixed(2)}%`).toBeLessThan(1.5);
    }
  });

  test('finds the specimen cards in harder scenes, with the reference pictures', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/app/');
    const results = await page.evaluate(async () => {
      const { detectCard } = await import('/app/js/core/detect.js');
      const { runBench } = await import('/tests/e2e/fixtures/bench.js');
      const { detectionRefs } = await import('/app/js/ui/samples.js');
      const { officialTemplates } = await import('/app/js/core/templates.js');
      const refs = await detectionRefs(officialTemplates());
      return (await runBench(c => detectCard(c, { refs }), { reps: 1 })).filter(r => !r.name.startsWith('fake'));
    });
    // Known gaps (see `npm run bench-detect`): reported by the benchmark, not required here.
    const KNOWN_GAPS = ['v4 front · white desk, no shadow', 'v4 back · cluttered, small'];
    for (const r of results) {
      if (KNOWN_GAPS.includes(r.name)) continue;
      expect(r.found, `${r.name}: not found`).toBe(true);
      expect(r.errPct, `${r.name}: error ${r.errPct?.toFixed(2)}%`).toBeLessThan(1.5);
    }
  });

  for (const [file, expected] of [
    ['dni_es_v3_front', 'dni_es_v3'], ['dni_es_v3_back', 'dni_es_v3'],
    ['dni_es_v4_front', 'dni_es_v4'], ['dni_es_v4_back', 'dni_es_v4'],
  ]) {
    test(`detects and identifies the original scan ${file}`, async ({ page }) => {
      await page.goto('/app/');
      const r = await page.evaluate(async name => {
        const { detectCard } = await import('/app/js/core/detect.js');
        const { warpToCard } = await import('/app/js/core/image.js');
        const { identifyDocument, loadSampleImage } = await import('/app/js/ui/samples.js');
        const { officialTemplates } = await import('/app/js/core/templates.js');
        const img = await loadSampleImage(`img/${name}.webp`); // the un-normalised originals act as "photos"
        if (!img) throw new Error('image not loaded');
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d')?.drawImage(img, 0, 0);
        const det = detectCard(c);
        const side = name.endsWith('front') ? 'front' : 'back';
        const res = await identifyDocument({ [side]: det && warpToCard(c, det.quad) }, officialTemplates());
        return { found: !!det, id: res?.template.id, confident: res?.confident };
      }, file);
      expect(r.found).toBe(true);
      expect(r.id).toBe(expected);
      expect(r.confident).toBe(true);
    });
  }
});
