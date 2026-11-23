// @ts-check
// Reference pictures: loading them (browser Image) and caching their signatures, then binding
// the pure matching in core/identify.js to that cache. Same API the app and the tests use.
import { assetUrl } from '../core/templates.js';
import { docSignature, detectSide as detectSideWith, identifyDocument as identifyWith } from '../core/identify.js';

/** @typedef {import('../core/templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {import('../core/identify.js').Signature} Signature */

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
