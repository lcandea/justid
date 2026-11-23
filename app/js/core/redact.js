// @ts-check
// Where your data actually gets hidden. Everything here draws on a local <canvas>.
//
// The output of one side is built from three layers, composited in this order:
//   1. the card itself, optionally converted to greyscale        (prepareCard: changes rarely),
//   2. the cover of every zone of every hidden field             (pixelation with noise, or a solid block),
//   3. the purpose watermark across the whole card, darken-blended (watermarkLayer: changes rarely).
// Layers 1 and 3 are separate canvases so the caller can cache them and only redo step 2 when a
// field is toggled. All randomness is seeded, so redrawing the same input gives the same pixels
// (nothing flickers), while the seed itself stays secret to the caller.
// The output canvas is what goes into the PDF; the original photo is never exported.
import { createCanvas } from './canvas.js';

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {'pixel' | 'solid'} HideMode */

/** 32-bit FNV-1a hash of a string, mixed with a numeric seed. @param {string} s @param {number} seed */
export function hashSeed(s, seed) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Small deterministic PRNG (mulberry32): returns numbers in [0, 1). @param {number} seed */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Layer 1: the card as it will be shown, i.e. the straightened card or a greyscale copy of it.
 * @param {HTMLCanvasElement} base straightened card (never modified)
 * @param {boolean} bw
 * @returns {HTMLCanvasElement} `base` itself when colour is kept
 */
export function prepareCard(base, bw) {
  if (!bw) return base;
  const W = base.width, H = base.height, c = createCanvas(W, H);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  ctx.drawImage(base, 0, 0);
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Pixelate a rectangle with big blocks (≥ 16 px or half the zone's short side) plus random noise
 * per block, so the original text can't be recovered by "de-pixelating" tricks.
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rand
 */
function pixelate(ctx, x, y, w, h, rand) {
  const img = ctx.getImageData(x, y, w, h), d = img.data;
  const b = Math.max(16, Math.round(Math.min(w, h) / 2));
  for (let by = 0; by < h; by += b) for (let bx = 0; bx < w; bx += b) {
    const bw = Math.min(b, w - bx), bh = Math.min(b, h - by);
    let r = 0, g = 0, bl = 0, n = 0;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { const i = ((by + yy) * w + bx + xx) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    const noise = (rand() - 0.5) * 60;
    r = r / n + noise; g = g / n + noise; bl = bl / n + noise;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { const i = ((by + yy) * w + bx + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = bl; }
  }
  ctx.putImageData(img, x, y);
}

/**
 * Layer 3: the watermark on a transparent canvas of the card's size. One dense pattern of small,
 * medium-weight text (the purpose line repeated with a "::" separator) in diagonal rows, each row
 * shifted by a seeded random amount so the pattern doesn't line up and is harder to remove.
 * It is meant to be composited with the 'darken' blend (see composeRedacted): it greys out light
 * areas but never covers dark ones, so the card's own text stays black and readable.
 * @param {number} W @param {number} H @param {string} text @param {boolean} bw @param {number} seed
 * @returns {HTMLCanvasElement}
 */
export function watermarkLayer(W, H, text, bw, seed) {
  const c = createCanvas(W, H);
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const rand = rng(hashSeed(text, seed));
  const fs = Math.max(8, Math.round(H * 0.027)), pitch = fs * 1.5;
  ctx.font = `500 ${fs}px Archivo, system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bw ? 'rgba(90,90,90,.6)' : 'rgba(30,110,98,.6)'; // teal-grey, like printed security ink
  ctx.translate(W / 2, H / 2); ctx.rotate(-30 * Math.PI / 180);
  const unit = text + '  ::  ', tw = ctx.measureText(unit).width, D = Math.hypot(W, H);
  for (let y = -D / 2; y < D / 2 + pitch; y += pitch) {
    for (let x = -D / 2 - rand() * tw; x < D / 2; x += tw) ctx.fillText(unit, x, y);
  }
  return c;
}

/**
 * Composite one side into `out`: the prepared card, the covers of the hidden zones, the watermark.
 * @param {HTMLCanvasElement} out
 * @param {HTMLCanvasElement} card layer 1, from prepareCard()
 * @param {'front' | 'back'} side
 * @param {{ template: ResolvedTemplate, hidden: Set<string>, mode: HideMode, seed: number }} opts
 *   seed: secret per-session number that makes the pixelation noise unpredictable but stable
 * @param {HTMLCanvasElement | null} watermark layer 3, from watermarkLayer(), or null for none
 */
export function composeRedacted(out, card, side, { template, hidden, mode, seed }, watermark) {
  const W = card.width, H = card.height;
  if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
  const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d', { willReadFrequently: true }));
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(card, 0, 0);
  for (const f of template.fields) {
    if (!hidden.has(f.id)) continue;
    f.zones.forEach((z, i) => {
      if (z.side !== side) return;
      const x = Math.max(0, Math.round(z.x * W)), y = Math.max(0, Math.round(z.y * H));
      const w = Math.min(W - x, Math.round(z.w * W)), h = Math.min(H - y, Math.round(z.h * H));
      if (w < 1 || h < 1) return;
      if (mode === 'solid') { ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h); }
      else pixelate(ctx, x, y, w, h, rng(hashSeed(`${f.id}:${side}:${i}`, seed)));
    });
  }
  if (watermark) {
    ctx.globalCompositeOperation = 'darken'; // only greys out what is lighter than the ink
    ctx.drawImage(watermark, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * One-shot version without caching: draw the redacted version of one side of the card into `out`.
 * @param {HTMLCanvasElement} out
 * @param {HTMLCanvasElement} base straightened card (never modified)
 * @param {'front' | 'back'} side
 * @param {{ template: ResolvedTemplate, hidden: Set<string>, mode: HideMode, bw: boolean, watermark: string, seed: number }} opts
 */
export function renderRedacted(out, base, side, opts) {
  const wm = opts.watermark ? watermarkLayer(base.width, base.height, opts.watermark, opts.bw, opts.seed) : null;
  composeRedacted(out, prepareCard(base, opts.bw), side, opts, wm);
}
