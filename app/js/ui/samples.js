// @ts-check
// Reference pictures: loading them (browser Image) and caching their signatures, then binding
// the pure matching in core/identify.js to that cache. Same API the app and the tests use.
import { assetUrl } from '../core/templates.js';
import { docSignature, detectSide as detectSideWith, identifyDocument as identifyWith } from '../core/identify.js';
import { referenceSignature } from '../core/card-match.js';

/** @typedef {import('../core/templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {import('../core/identify.js').Signature} Signature */
/** @typedef {import('../core/card-match.js').CardRef} CardRef */

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

/** @type {Map<string, Promise<Signature | null>>} */
const refSignatures = new Map();
/** @param {string} path */
function sampleSignature(path) {
  let p = refSignatures.get(path);
  if (!p) { p = loadSampleImage(path).then(img => img && docSignature(img)); refSignatures.set(path, p); }
  return p;
}

/** @param {HTMLCanvasElement} card @param {ResolvedTemplate[]} templates */
export const detectSide = (card, templates) => detectSideWith(card, templates, sampleSignature);

/**
 * @param {{ front?: HTMLCanvasElement | null, back?: HTMLCanvasElement | null }} cards
 * @param {ResolvedTemplate[]} templates
 */
export const identifyDocument = (cards, templates) => identifyWith(cards, templates, sampleSignature);

/** @type {Map<string, Promise<CardRef | null>>} */
const detectRefCache = new Map();
/**
 * Reference signatures for the card detector (detectCard's `refs`): every side of every template
 * that has a reference picture. Loaded once and cached.
 * @param {ResolvedTemplate[]} templates
 * @returns {Promise<CardRef[]>}
 */
export async function detectionRefs(templates) {
  const all = [];
  for (const tpl of templates) for (const side of /** @type {('front' | 'back')[]} */ (['front', 'back'])) {
    const path = tpl.sample?.[side]; if (!path) continue;
    let p = detectRefCache.get(path);
    if (!p) {
      p = loadSampleImage(path).then(img => {
        if (!img) return null;
        const c = document.createElement('canvas'); c.width = 256; c.height = 160;
        const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return { id: `${tpl.id}:${side}`, sig: referenceSignature(ctx.getImageData(0, 0, c.width, c.height)) };
      });
      detectRefCache.set(path, p);
    }
    all.push(p);
  }
  return /** @type {CardRef[]} */ ((await Promise.all(all)).filter(Boolean));
}
