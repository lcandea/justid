// @ts-check
// Corner refinement after detection. Detection runs on a ~480 px copy of the photo, so its corners
// are only as precise as a pixel there (several pixels of the real photo). Here each side is
// measured again on a sharper copy: edge points are searched across the side, keeping only the
// colour step that the side as a whole has (dark table → light card, say), a line is fitted to them
// robustly (fingers, glare and text near the edge become outliers), and adjacent lines intersect
// in the new corners. A side without enough good points keeps its old line.
import { createCanvas } from './canvas.js';

/** @typedef {{ data: Uint8ClampedArray, width: number, height: number }} Pixels */

const DEFAULTS = {
  maxSide: 1600, // working copy size (long side)
  samples: 48, // edge points per side
  endSkip: 0.1, // ignore this much of each side at both ends (rounded corners)
  minInliers: 0.35, // share of a side's points the fitted line must keep
};

/** Bilinear sample of the 3 channels at (x, y). @param {Pixels} px @param {number} x @param {number} y @param {number[]} out */
function sample(px, x, y, out) {
  const { data, width: W, height: H } = px;
  x = Math.min(Math.max(x, 0), W - 1.001); y = Math.min(Math.max(y, 0), H - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
    const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
    out[c] = top + (bot - top) * fy;
  }
}

/**
 * Total least squares line through weighted points: { nx, ny, c } with nx·x + ny·y = c.
 * @param {{ x: number, y: number, w: number }[]} pts
 */
function fitLine(pts) {
  let sw = 0, mx = 0, my = 0;
  for (const p of pts) { sw += p.w; mx += p.w * p.x; my += p.w * p.y; }
  mx /= sw; my /= sw;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += p.w * dx * dx; syy += p.w * dy * dy; sxy += p.w * dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the line
  const nx = -Math.sin(th), ny = Math.cos(th);
  return { nx, ny, c: nx * mx + ny * my };
}

/**
 * Re-measure one side (p → q) of a quad with centre `ctr`. Returns the fitted line or null.
 * @param {Pixels} px @param {number[]} p @param {number[]} q @param {number[]} ctr @param {number} reach search ± px
 */
function refineSide(px, p, q, ctr, reach, o) {
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  if (len < 8) return null;
  const ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux; // normal pointing into the card
  if ((ctr[0] - p[0]) * nx + (ctr[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
  const R = Math.ceil(reach), a = [0, 0, 0], b = [0, 0, 0];
  // The side's colour step (inside − outside) from the current line, to tell the card edge from others.
  const dir = [0, 0, 0];
  for (let s = 0; s < o.samples; s++) {
    const f = o.endSkip + (1 - 2 * o.endSkip) * s / (o.samples - 1), x = p[0] + dx * f, y = p[1] + dy * f;
    sample(px, x + nx * 3, y + ny * 3, a); sample(px, x - nx * 3, y - ny * 3, b);
    for (let c = 0; c < 3; c++) dir[c] += a[c] - b[c];
  }
  const dn = Math.hypot(dir[0], dir[1], dir[2]);
  if (dn < 1e-3) return null;
  for (let c = 0; c < 3; c++) dir[c] /= dn;

  /** @type {{ x: number, y: number, w: number }[]} */
  const pts = [];
  const prof = new Float32Array(2 * R + 3);
  for (let s = 0; s < o.samples; s++) {
    const f = o.endSkip + (1 - 2 * o.endSkip) * s / (o.samples - 1), x = p[0] + dx * f, y = p[1] + dy * f;
    // colour along the normal, projected on the side's colour step, averaged over 3 parallel rows
    for (let t = -R - 1; t <= R + 1; t++) {
      let v = 0;
      for (const o2 of [-1, 0, 1]) { sample(px, x + nx * t + ux * o2, y + ny * t + uy * o2, a); v += a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2]; }
      prof[t + R + 1] = v / 3;
    }
    // rise outside → inside: of the strong ones (≥ half the strongest), the closest to the current
    // line; a background edge just outside the card can be as strong as the card's own
    let mx = 0;
    for (let t = -R; t <= R; t++) mx = Math.max(mx, prof[t + R + 2] - prof[t + R]);
    if (mx <= 0) continue;
    let best = -1, bt = 0;
    for (let t = -R; t <= R; t++) {
      const g = prof[t + R + 2] - prof[t + R];
      if (g < 0.5 * mx || g < prof[t + R + 1] - prof[Math.max(0, t + R - 1)] || g < prof[Math.min(2 * R + 2, t + R + 3)] - prof[t + R + 1]) continue; // strong local maxima only
      if (best < 0 || Math.abs(t) < Math.abs(bt)) { best = g; bt = t; }
    }
    if (best <= 0) continue;
    // sub-pixel: parabola through the derivative around the peak
    const g0 = prof[bt + R + 1] - prof[Math.max(0, bt + R - 1)], g2 = prof[Math.min(2 * R + 2, bt + R + 3)] - prof[bt + R + 1];
    const den = g0 - 2 * best + g2, off = Math.abs(den) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (g0 - g2) / den)) : 0;
    const t = bt + off;
    pts.push({ x: x + nx * t, y: y + ny * t, w: best });
  }
  if (pts.length < o.samples * o.minInliers) return null;
  // weak points are texture, not the edge
  const ws = pts.map(p => p.w).sort((u, v) => u - v), wMed = ws[ws.length >> 1];
  const cand = pts.filter(p => p.w >= 0.4 * wMed);
  // consensus: the line through two well-separated points that most points agree with (±1 px),
  // then a weighted fit on those. Robust to a run of junk points (finger, glare, a block of the
  // card's design as dark as the table), which a least-squares fit would tilt towards.
  const need = o.samples * o.minInliers, tol = 1;
  let inl = null, nBest = 0;
  for (let i = 0; i < cand.length; i++) for (let j = i + Math.max(1, cand.length >> 2); j < cand.length; j++) {
    const A = cand[i], B = cand[j], lx = B.x - A.x, ly = B.y - A.y, L = Math.hypot(lx, ly);
    if (L < 1e-6) continue;
    const nx = -ly / L, ny = lx / L, c = nx * A.x + ny * A.y;
    let n = 0; for (const p of cand) if (Math.abs(nx * p.x + ny * p.y - c) <= tol) n++;
    if (n > nBest) { nBest = n; inl = { nx, ny, c }; }
  }
  if (!inl || nBest < need) return null;
  const L0 = inl;
  let cur = cand.filter(p => Math.abs(L0.nx * p.x + L0.ny * p.y - L0.c) <= tol);
  const L1 = fitLine(cur);
  cur = cand.filter(p => Math.abs(L1.nx * p.x + L1.ny * p.y - L1.c) <= tol);
  if (cur.length < need) return null;
  return fitLine(cur);
}

/** Intersection of two lines nx·x + ny·y = c. */
function meet(/** @type {{nx:number,ny:number,c:number}} */ A, /** @type {{nx:number,ny:number,c:number}} */ B) {
  const det = A.nx * B.ny - A.ny * B.nx;
  if (Math.abs(det) < 1e-9) return null;
  return [(A.c * B.ny - A.ny * B.c) / det, (A.nx * B.c - A.c * B.nx) / det];
}

/**
 * Refine the corners of a detected card.
 * @param {CanvasImageSource & { width: number, height: number }} src the photo
 * @param {number[][]} quad corners in source pixels (any consistent order)
 * @param {number} coarse how far off the corners may be, in source pixels (≈ a few detection pixels)
 * @returns {number[][]} refined corners, same order (unchanged where a side couldn't be measured)
 */
export function refineQuad(src, quad, coarse, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const k = Math.min(1, o.maxSide / Math.max(src.width, src.height));
  const W = Math.max(1, Math.round(src.width * k)), H = Math.max(1, Math.round(src.height * k));
  const cv = createCanvas(W, H);
  const cx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, W, H);
  return refineQuadPixels(cx.getImageData(0, 0, W, H), quad.map(p => [p[0] * k, p[1] * k]), coarse * k, o).map(p => [p[0] / k, p[1] / k]);
}

/**
 * Same, on pixels already in hand (coordinates in those pixels).
 * @param {Pixels} px @param {number[][]} quad @param {number} coarse
 */
export function refineQuadPixels(px, quad, coarse, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const ctr = [0, 1].map(c => (quad[0][c] + quad[1][c] + quad[2][c] + quad[3][c]) / 4);
  const short = Math.min(...[0, 1, 2, 3].map(m => Math.hypot(quad[(m + 1) % 4][0] - quad[m][0], quad[(m + 1) % 4][1] - quad[m][1])));
  // search far enough to cover the detection error, never as far as the card's own inner structures
  const reach = Math.max(3, Math.min(coarse, 0.06 * short));
  const lines = [0, 1, 2, 3].map(m => refineSide(px, quad[m], quad[(m + 1) % 4], ctr, reach, o));
  const old = (/** @type {number} */ m) => { const p = quad[m], q = quad[(m + 1) % 4]; const L = Math.hypot(q[0] - p[0], q[1] - p[1]); const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L; return { nx, ny, c: nx * p[0] + ny * p[1] }; };
  // corner m is where side m-1 (ending at it) meets side m (starting at it)
  return quad.map((p, m) => {
    const A = lines[(m + 3) % 4] || old((m + 3) % 4), B = lines[m] || old(m);
    const x = meet(A, B);
    if (!x || Math.hypot(x[0] - p[0], x[1] - p[1]) > 2 * reach) return p; // implausible jump: keep
    return x;
  });
}
