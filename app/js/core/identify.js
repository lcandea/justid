// @ts-check
// Document type identification by comparing a straightened card against each template's
// reference pictures (template.sample.front/back). Runs fully in the browser.
// Loading and caching of the reference pictures is ui/samples.js: here it is `sampleSignature`,
// a function passed in that returns the signature of a reference picture (or null).
//
// Signature: the card downscaled to SIG_W × SIG_H grey, high-passed (minus a local box mean)
// so lighting, white balance and blur matter little, then zero-mean / unit-norm.
// The header strip gets its own signature: it carries the most distinctive layout (logos,
// flags, title) and contains no personal data, so it varies least between people.
import { createCanvas } from './canvas.js';

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {{ full: Float32Array, head: Float32Array }} Signature */
/** @typedef {(path: string) => Promise<Signature | null>} SignatureLoader */

export const SIG_W = 64, SIG_H = 40;
const SIG_HEAD_ROWS = 9, SIG_BOX = 4; // box radius -> 9×9 window
const SIG_HEAD_WEIGHT = 0.5;
const ID_MIN_SCORE = 0.35, ID_MIN_MARGIN = 0.05; // below this we don't trust the guess

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
  const c = createCanvas(SIG_W, SIG_H);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  // Reference pictures have transparent corners; photos have background there. Same neutral fill for both.
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(0, 0, SIG_W, SIG_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, SIG_W, SIG_H);
  const d = ctx.getImageData(0, 0, SIG_W, SIG_H).data;
  const g = new Float32Array(SIG_W * SIG_H);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return greySignature(g);
}

/** Signature of a SIG_W × SIG_H grey card (row-major). @param {Float32Array} g @returns {Signature} */
export function greySignature(g) {
  // local mean over a (2·SIG_BOX+1)² window, edges replicated: summed-area table of the padded image
  const B = SIG_BOX, PW = SIG_W + 2 * B + 1, PH = SIG_H + 2 * B + 1, sat = new Float64Array(PW * PH);
  for (let y = 1; y < PH; y++) {
    const sy = Math.min(SIG_H - 1, Math.max(0, y - 1 - B));
    let row = 0;
    for (let x = 1; x < PW; x++) {
      row += g[sy * SIG_W + Math.min(SIG_W - 1, Math.max(0, x - 1 - B))];
      sat[y * PW + x] = sat[(y - 1) * PW + x] + row;
    }
  }
  const n = (2 * B + 1) ** 2, hp = new Float32Array(g.length);
  for (let y = 0; y < SIG_H; y++) for (let x = 0; x < SIG_W; x++) {
    const x1 = x + 2 * B + 1, y1 = y + 2 * B + 1;
    const s = sat[y1 * PW + x1] - sat[y * PW + x1] - sat[y1 * PW + x] + sat[y * PW + x];
    hp[y * SIG_W + x] = g[y * SIG_W + x] - s / n;
  }
  return { full: normalizeVec(hp.slice()), head: normalizeVec(hp.slice(0, SIG_HEAD_ROWS * SIG_W)) };
}

/** Similarity of two signatures, about -1..1 (same card ≈ 0.8–1). @param {Signature} a @param {Signature} b */
export function signatureScore(a, b) {
  let f = 0, h = 0;
  for (let i = 0; i < a.full.length; i++) f += a.full[i] * b.full[i];
  for (let i = 0; i < a.head.length; i++) h += a.head[i] * b.head[i];
  return (1 - SIG_HEAD_WEIGHT) * f + SIG_HEAD_WEIGHT * h;
}

/** Fronts and backs differ far more than versions do (~0.6 vs ~0.45 score gap), so a bigger margin is safe. */
const SIDE_MIN_MARGIN = 0.15;

/**
 * Which side of the card is this? Compares it with every template's front and back pictures.
 * The back is unmistakable (chip + 3-line MRZ); the front has the photo and the header.
 * @param {HTMLCanvasElement} card straightened card
 * @param {ResolvedTemplate[]} templates
 * @param {SignatureLoader} sampleSignature
 * @returns {Promise<{ side: 'front' | 'back', front: number, back: number, confident: boolean }>}
 */
export async function detectSide(card, templates, sampleSignature) {
  const sig = docSignature(card);
  const best = { front: -1, back: -1 };
  for (const tpl of templates) {
    for (const s of /** @type {('front' | 'back')[]} */ (['front', 'back'])) {
      const path = tpl.sample?.[s]; if (!path) continue;
      const ref = await sampleSignature(path); if (!ref) continue;
      best[s] = Math.max(best[s], signatureScore(sig, ref));
    }
  }
  const side = best.back > best.front ? 'back' : 'front';
  const confident = Math.max(best.front, best.back) >= ID_MIN_SCORE && Math.abs(best.front - best.back) >= SIDE_MIN_MARGIN;
  return { side, front: best.front, back: best.back, confident };
}

/**
 * Rank templates by similarity to the photographed card(s). Scores are averaged over the sides
 * both the photos and the template have; the front weighs double (both DNI backs share the
 * chip + MRZ layout). `confident` tells whether the best guess is safe to act on.
 * @param {{ front?: HTMLCanvasElement | null, back?: HTMLCanvasElement | null }} cards straightened sides
 * @param {ResolvedTemplate[]} templates
 * @param {SignatureLoader} sampleSignature
 * @returns {Promise<null | { template: ResolvedTemplate, score: number, margin: number, confident: boolean,
 *   ranking: { template: ResolvedTemplate, score: number }[] }>}
 */
export async function identifyDocument(cards, templates, sampleSignature) {
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
