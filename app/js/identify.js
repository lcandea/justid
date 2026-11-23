// @ts-check
// Document type identification by comparing a straightened card against each template's
// reference pictures (template.sample.front/back). Runs fully in the browser.
//
// Signature: the card downscaled to SIG_W × SIG_H grey, high-passed (minus a local box mean)
// so lighting, white balance and blur matter little, then zero-mean / unit-norm.
// The header strip gets its own signature: it carries the most distinctive layout (logos,
// flags, title) and contains no personal data, so it varies least between people.
import { assetUrl } from './templates.js';

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {{ full: Float32Array, head: Float32Array }} Signature */

const SIG_W = 64, SIG_H = 40, SIG_HEAD_ROWS = 9, SIG_BOX = 4; // box radius -> 9×9 window
const SIG_HEAD_WEIGHT = 0.5;
const ID_MIN_SCORE = 0.35, ID_MIN_MARGIN = 0.05; // below this we don't trust the guess

/** @type {Map<string, Promise<HTMLImageElement | null>>} */
const sampleImages = new Map();

/** Load (and cache) a reference picture. Resolves to null if it can't be loaded. @param {string} path */
export function loadSampleImage(path) {
  const url = assetUrl(path);
  let p = sampleImages.get(url);
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    sampleImages.set(url, p);
  }
  return p;
}

/** @param {Float32Array} a */
function normalizeVec(a) {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let n = 0; for (let i = 0; i < a.length; i++) { a[i] -= m; n += a[i] * a[i]; }
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < a.length; i++) a[i] /= n;
  return a;
}

/** @param {CanvasImageSource} src @returns {Signature} */
export function docSignature(src) {
  const c = document.createElement('canvas'); c.width = SIG_W; c.height = SIG_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  // Reference pictures have transparent corners; photos have background there. Same neutral fill for both.
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, SIG_W, SIG_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, SIG_W, SIG_H);
  const d = ctx.getImageData(0, 0, SIG_W, SIG_H).data;
  const g = new Float32Array(SIG_W * SIG_H);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const hp = new Float32Array(g.length);
  for (let y = 0; y < SIG_H; y++) for (let x = 0; x < SIG_W; x++) {
    let s = 0, n = 0;
    for (let dy = -SIG_BOX; dy <= SIG_BOX; dy++) for (let dx = -SIG_BOX; dx <= SIG_BOX; dx++) {
      const yy = Math.min(SIG_H - 1, Math.max(0, y + dy)), xx = Math.min(SIG_W - 1, Math.max(0, x + dx));
      s += g[yy * SIG_W + xx]; n++;
    }
    hp[y * SIG_W + x] = g[y * SIG_W + x] - s / n;
  }
  return { full: normalizeVec(hp.slice()), head: normalizeVec(hp.slice(0, SIG_HEAD_ROWS * SIG_W)) };
}

/** @param {Signature} a @param {Signature} b */
function signatureScore(a, b) {
  let f = 0, h = 0;
  for (let i = 0; i < a.full.length; i++) f += a.full[i] * b.full[i];
  for (let i = 0; i < a.head.length; i++) h += a.head[i] * b.head[i];
  return (1 - SIG_HEAD_WEIGHT) * f + SIG_HEAD_WEIGHT * h;
}

/** @type {Map<string, Promise<Signature | null>>} */
const refSignatures = new Map();
/** @param {string} path */
function sampleSignature(path) {
  let p = refSignatures.get(path);
  if (!p) { p = loadSampleImage(path).then(img => img && docSignature(img)); refSignatures.set(path, p); }
  return p;
}

/**
 * Rank templates by similarity to the photographed card(s). Scores are averaged over the sides
 * both the photos and the template have; the front weighs double (both DNI backs share the
 * chip + MRZ layout). `confident` tells whether the best guess is safe to act on.
 * @param {{ front?: HTMLCanvasElement | null, back?: HTMLCanvasElement | null }} cards straightened sides
 * @param {ResolvedTemplate[]} templates
 * @returns {Promise<null | { template: ResolvedTemplate, score: number, margin: number, confident: boolean,
 *   ranking: { template: ResolvedTemplate, score: number }[] }>}
 */
export async function identifyDocument(cards, templates) {
  const sides = /** @type {('front' | 'back')[]} */ (['front', 'back']).filter(s => cards[s]);
  const mine = Object.fromEntries(sides.map(s => [s, docSignature(/** @type {HTMLCanvasElement} */ (cards[s]))]));
  const ranking = [];
  for (const tpl of templates) {
    let sum = 0, n = 0;
    for (const s of sides) {
      const path = tpl.sample?.[s]; if (!path) continue;
      const ref = await sampleSignature(path); if (!ref) continue;
      const w = s === 'front' ? 2 : 1;
      sum += w * signatureScore(mine[s], ref); n += w;
    }
    if (n) ranking.push({ template: tpl, score: sum / n });
  }
  if (!ranking.length) return null;
  ranking.sort((a, b) => b.score - a.score);
  const [best, second] = ranking;
  const margin = second ? best.score - second.score : best.score;
  return { template: best.template, score: best.score, margin, ranking,
    confident: best.score >= ID_MIN_SCORE && margin >= ID_MIN_MARGIN };
}
