// @ts-check
// Does a quadrilateral in a photo hold a known card? The quad is straightened straight from the
// photo's pixels (no canvas per candidate) to the identification signature size and compared
// with the signatures of the templates' reference pictures (see identify.js), in its 4 rotations.
// Used by the card detector to tell the real card from other rectangles (papers, a checkerboard,
// the photo box inside the card) and to give its orientation.
import { homography } from './image.js';
import { SIG_W, SIG_H, greySignature, signatureScore } from './identify.js';

/** @typedef {import('./identify.js').Signature} Signature */
/** @typedef {{ data: Uint8ClampedArray, width: number, height: number }} Pixels */
/** @typedef {{ id: string, sig: Signature }} CardRef */

const SS = 2; // supersampling per signature pixel (antialiasing)
const FILL = 200; // transparent reference corners (and outside the photo): neutral grey, as in identify.js

/**
 * Grey SIG_W × SIG_H picture of the quad (TL, TR, BR, BL), straightened.
 * @param {Pixels} px @param {number[][]} quad
 */
export function straightenGrey(px, quad, ss = SS) {
  const SS = ss;
  const { data, width: W, height: H } = px;
  const h = homography([[0, 0], [SIG_W, 0], [SIG_W, SIG_H], [0, SIG_H]], quad);
  const g = new Float32Array(SIG_W * SIG_H);
  for (let y = 0; y < SIG_H; y++) for (let x = 0; x < SIG_W; x++) {
    let sum = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const X = x + (sx + 0.5) / SS, Y = y + (sy + 0.5) / SS;
      const den = h[6] * X + h[7] * Y + 1;
      const u = Math.floor((h[0] * X + h[1] * Y + h[2]) / den), v = Math.floor((h[3] * X + h[4] * Y + h[5]) / den);
      if (u < 0 || v < 0 || u >= W || v >= H) { sum += FILL; continue; }
      const i = (v * W + u) * 4, a = data[i + 3] / 255;
      sum += a * (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) + (1 - a) * FILL;
    }
    g[y * SIG_W + x] = sum / (SS * SS);
  }
  return g;
}

/**
 * Signature of a whole reference picture, from its pixels (any size; ~4× the signature size,
 * e.g. 256 × 160, is plenty).
 * @param {Pixels} px
 */
export function referenceSignature(px) {
  const w = px.width, h = px.height;
  return greySignature(straightenGrey(px, [[0, 0], [w, 0], [w, h], [0, h]], 4));
}

/**
 * Best match of the quad against the references, over its 4 rotations.
 * `rot` r means the card's top-left corner is quad[r] (so the card reads quad[r], quad[r+1]…).
 * @param {Pixels} px @param {number[][]} quad clockwise (in image coordinates, y down)
 * @param {CardRef[]} refs
 * @returns {{ score: number, rot: number, ref: string | null }}
 */
export function matchQuad(px, quad, refs) {
  let best = { score: -1, rot: 0, ref: /** @type {string | null} */ (null) };
  for (let r = 0; r < 4; r++) {
    const sig = greySignature(straightenGrey(px, [0, 1, 2, 3].map(i => quad[(i + r) % 4])));
    for (const ref of refs) {
      const s = signatureScore(sig, ref.sig);
      if (s > best.score) best = { score: s, rot: r, ref: ref.id };
    }
  }
  return best;
}

/**
 * Template alignment: move the corners (one at a time, coarse to fine) while the straightened quad
 * matches the reference better. Pulls a side that sits on a wrong line back onto the card.
 * @param {Pixels} px @param {number[][]} quad in the card's reading orientation (TL, TR, BR, BL)
 * @param {Signature} ref
 * @returns {{ quad: number[][], score: number, evals: number }}
 */
export function alignQuad(px, quad, ref, { from = 0.08, to = 0.004, maxIter = 6 } = {}) {
  const score = (/** @type {number[][]} */ q) => signatureScore(greySignature(straightenGrey(px, q)), ref);
  let q = quad.map(p => [...p]), best = score(q), evals = 1;
  const size = Math.hypot(q[0][0] - q[2][0], q[0][1] - q[2][1]);
  for (let step = from * size; step >= to * size; step /= 2) {
    for (let it = 0, improved = true; improved && it < maxIter; it++) {
      improved = false;
      for (let i = 0; i < 4; i++) for (let c = 0; c < 2; c++) for (const d of [-1, 1]) {
        const t = q.map(p => [...p]); t[i][c] += d * step;
        const s = score(t); evals++;
        if (s > best) { best = s; q = t; improved = true; }
      }
    }
  }
  return { quad: q, score: best, evals };
}
