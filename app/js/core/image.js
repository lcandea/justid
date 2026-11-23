// @ts-check
// Perspective correction (homography + bilinear warp). Everything runs locally on <canvas>.
import { createCanvas } from './canvas.js';

/** Output size of a straightened card: ISO/IEC 7810 ID-1 (85.6 × 54 mm) at ~300 dpi. */
export const CARD_W = 1012, CARD_H = 638;

/** Gauss-Jordan elimination with partial pivoting. @param {number[][]} A @param {number[]} b */
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Homography mapping src[i] -> dst[i] (4 point pairs). Returns h0..h7 (h8 = 1).
 * @param {number[][]} src @param {number[][]} dst
 */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solveLinear(A, b);
}

/**
 * Straighten the card: map the quad (top-left, top-right, bottom-right, bottom-left)
 * onto a W × H canvas with bilinear sampling.
 * @param {HTMLCanvasElement} src @param {number[][]} quad
 * @returns {HTMLCanvasElement}
 */
export function warpToCard(src, quad, W = CARD_W, H = CARD_H) {
  const dist = (/** @type {number[]} */ a, /** @type {number[]} */ b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const qw = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let s = src, q = quad;
  const f = Math.min(1, 1.5 * W / qw);
  if (f < 1) { // downscale first to avoid aliasing
    s = createCanvas(Math.max(1, Math.round(src.width * f)), Math.max(1, Math.round(src.height * f)));
    const sctx = /** @type {CanvasRenderingContext2D} */ (s.getContext('2d'));
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, s.width, s.height);
    q = quad.map(p => [p[0] * f, p[1] * f]);
  }
  const sw = s.width, sh = s.height;
  const d = /** @type {CanvasRenderingContext2D} */ (s.getContext('2d')).getImageData(0, 0, sw, sh).data;
  const h = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
  const out = new ImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const den = h[6] * X + h[7] * Y + 1;
      let sx = (h[0] * X + h[1] * Y + h[2]) / den - 0.5;
      let sy = (h[3] * X + h[4] * Y + h[5]) / den - 0.5;
      sx = Math.min(Math.max(sx, 0), sw - 1.001);
      sy = Math.min(Math.max(sy, 0), sh - 1.001);
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
        const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
        o[oi + c] = top + (bot - top) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  const c = createCanvas(W, H);
  /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).putImageData(out, 0, 0);
  return c;
}
