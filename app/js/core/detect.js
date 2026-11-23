// @ts-nocheck -- numeric hot loop over typed arrays; kept untyped for readability of the algorithm.
// Automatic card detection in a photo, no dependencies.
// 1) downscale to ~480 px, 2) colour gradient (Sobel per channel) + non-maximum suppression,
// 3) gradient-oriented Hough transform, 4) per line, prefix sums of edge support and colour step
//    along it, so any segment of it can be scored in O(1), 5) for each pair of near-parallel lines,
//    the crossing lines that make a supported side between them; pairs of those close the
//    quadrilateral, 6) score each by edge support on its 4 sides, colour-step consistency, its area
//    and its aspect ratio (ID-1 ≈ 1.586).

import { createCanvas } from './canvas.js';
import { matchQuad, alignQuad } from './card-match.js';
import { refineQuad } from './refine.js';

const CARD_RATIO = 85.6 / 54;
const NB = 24; // orientation bins of the edge support maps (7.5° each)
const ANG_TOL = 0.3; // an edge pixel supports a side if their normals differ by less than this (rad)

const DEFAULTS = {
  maxSide: 480,
  edgeFloor: 8, // gradient magnitude below this is never an edge
  thrMin: 10, thrRel: 0.06, // edge threshold: max(thrMin, thrRel × 98th percentile of edge strength)
  minVotesF: 0.1, // a line needs this × min(W, H) votes
  maxLines: 80,
  minPol: 0.3, // colour-step consistency a side needs (grids and fabric flip sign: ~0)
  matchPool: 30, // with reference pictures: how many distinct top candidates are compared with them
  matchMin: 0.5, // best match below this: no known card in the photo, geometry alone decides
  alignMin: 0.2, alignTop: 1, // no clear match: align the best partial matches (≥ alignMin) to the reference
  refine: true, refineReach: 4, // re-measure the sides on a sharper copy, searching ± this many detection pixels
};

const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };

/** Downscale, blur, colour gradient, non-maximum suppression. */
function edgeMap(src, o) {
  const k = Math.min(1, o.maxSide / Math.max(src.width, src.height));
  const W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
  const cv = createCanvas(W, H);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(src, 0, 0, W, H);
  const rgba = cx.getImageData(0, 0, W, H).data;
  const N = W * H;

  // --- separable Gaussian blur [1 4 6 4 1] per channel ---
  const chans = [0, 1, 2].map(c => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c]; return a; });
  const tmp = new Float32Array(N);
  const K = [1, 4, 6, 4, 1];
  for (const a of chans) {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0; for (let j = -2; j <= 2; j++) { const xx = Math.min(W - 1, Math.max(0, x + j)); s += K[j + 2] * a[y * W + xx]; }
        tmp[y * W + x] = s / 16;
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0; for (let j = -2; j <= 2; j++) { const yy = Math.min(H - 1, Math.max(0, y + j)); s += K[j + 2] * tmp[yy * W + x]; }
        a[y * W + x] = s / 16;
      }
    }
  }

  // --- colour gradient: per pixel, the channel with the largest magnitude ---
  const mag = new Float32Array(N), gxA = new Float32Array(N), gyA = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    let best = -1, bx = 0, by = 0;
    for (const a of chans) {
      const gx = (a[i - W + 1] + 2 * a[i + 1] + a[i + W + 1]) - (a[i - W - 1] + 2 * a[i - 1] + a[i + W - 1]);
      const gy = (a[i + W - 1] + 2 * a[i + W] + a[i + W + 1]) - (a[i - W - 1] + 2 * a[i - W] + a[i - W + 1]);
      const m = gx * gx + gy * gy;
      if (m > best) { best = m; bx = gx; by = gy; }
    }
    mag[i] = Math.sqrt(best); gxA[i] = bx; gyA[i] = by;
  }

  // --- non-maximum suppression ---
  const edge = new Uint8Array(N), ang = new Float32Array(N); // ang: edge normal in [0, π)
  const vals = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = mag[i];
    if (m < o.edgeFloor) continue;
    let a = Math.atan2(gyA[i], gxA[i]); if (a < 0) a += Math.PI; if (a >= Math.PI) a -= Math.PI;
    const q = Math.round(a / (Math.PI / 4)) % 4; // 0: horiz, 1: 45°, 2: vert, 3: 135°
    const off = q === 0 ? 1 : q === 1 ? W + 1 : q === 2 ? W : W - 1;
    if (m >= mag[i - off] && m > mag[i + off]) { edge[i] = 1; ang[i] = a; vals.push(m); }
  }
  if (vals.length < 50) return null;
  vals.sort((a, b) => a - b);
  const thr = Math.max(o.thrMin, vals[Math.floor(vals.length * 0.98)] * o.thrRel); // relative to the strongest edges
  for (let i = 0; i < N; i++) if (edge[i] && mag[i] < thr) edge[i] = 0;
  return { k, W, H, rgba, chans, mag, edge, ang, thr };
}

/** Gradient-oriented Hough transform: the strongest distinct lines {t (normal angle), r, v (votes)}. */
function houghLines(E, o) {
  const { W, H, edge, ang, mag, thr } = E;
  const NT = 180, D = Math.ceil(Math.hypot(W, H)), NR = 2 * D + 1;
  const acc = new Float32Array(NT * NR);
  const COS = new Float32Array(NT), SIN = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { COS[t] = Math.cos(t * Math.PI / NT); SIN[t] = Math.sin(t * Math.PI / NT); }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!edge[i]) continue;
    const t0 = Math.round(ang[i] / Math.PI * NT);
    const wv = Math.min(mag[i] / thr, 4); // high-contrast edges weigh more than texture
    for (let dt = -3; dt <= 3; dt++) {
      let t = t0 + dt; if (t < 0) t += NT; if (t >= NT) t -= NT;
      const r = Math.round(x * COS[t] + y * SIN[t]) + D;
      acc[t * NR + r] += wv;
    }
  }
  const minVotes = o.minVotesF * Math.min(W, H);
  const peaks = [];
  for (let t = 0; t < NT; t++) for (let r = 0; r < NR; r++) {
    const v = acc[t * NR + r]; if (v < minVotes) continue;
    let isMax = true;
    for (let dt = -2; dt <= 2 && isMax; dt++) for (let dr = -6; dr <= 6; dr++) {
      if (!dt && !dr) continue;
      let tt = t + dt, rr = r + dr;
      if (tt < 0) { tt += NT; rr = NR - 1 - rr; } else if (tt >= NT) { tt -= NT; rr = NR - 1 - rr; }
      if (rr < 0 || rr >= NR) continue;
      const w = acc[tt * NR + rr];
      if (w > v || (w === v && (dt < 0 || (dt === 0 && dr < 0)))) { isMax = false; break; }
    }
    if (isMax) peaks.push({ t: t * Math.PI / NT, r: r - D, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  return peaks.slice(0, o.maxLines);
}

/**
 * Edge support maps, one per orientation bin: sup[b][i] = 1 if an edge pixel within 2 px of i
 * has a normal within ANG_TOL of bin b's angle.
 */
function supportMaps(E) {
  const { W, H, edge, ang } = E, N = W * H;
  const sup = Array.from({ length: NB }, () => new Uint8Array(N));
  const bw = Math.PI / NB, span = Math.ceil(ANG_TOL / bw);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!edge[i]) continue;
    const b0 = Math.round(ang[i] / bw);
    for (let db = -span; db <= span; db++) {
      const b = ((b0 + db) % NB + NB) % NB;
      if (angDiff(b * bw, ang[i]) >= ANG_TOL) continue;
      const m = sup[b];
      for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++)
        for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) m[yy * W + xx] = 1;
    }
  }
  return sup;
}

/**
 * Prefix sums along a line (1 px steps): edge support, samples inside the image, and the colour
 * step across the line (3 channels, plus its magnitude). Any segment then scores in O(1).
 */
function lineProfile(L, E, sup, S) {
  const { W, H, chans } = E;
  const c = Math.cos(L.t), s = Math.sin(L.t), dx = -s, dy = c, x0 = L.r * c, y0 = L.r * s;
  const n = 2 * S + 1, bw = Math.PI / NB;
  const m = sup[Math.round(L.t / bw) % NB];
  const P = { sup: new Float32Array(n + 1), inn: new Float32Array(n + 1), v0: new Float32Array(n + 1), v1: new Float32Array(n + 1), v2: new Float32Array(n + 1), abs: new Float32Array(n + 1) };
  const d = 3; // colour samples 3 px either side of the line
  for (let j = 0; j < n; j++) {
    const x = x0 + dx * (j - S), y = y0 + dy * (j - S);
    let su = 0, inn = 0, a0 = 0, a1 = 0, a2 = 0, ab = 0;
    if (x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2) {
      inn = 1; su = m[Math.round(y) * W + Math.round(x)];
      const xa = Math.round(x + c * d), ya = Math.round(y + s * d), xb = Math.round(x - c * d), yb = Math.round(y - s * d);
      if (xa >= 0 && ya >= 0 && xb >= 0 && yb >= 0 && xa < W && ya < H && xb < W && yb < H) {
        const ia = ya * W + xa, ib = yb * W + xb;
        a0 = chans[0][ia] - chans[0][ib]; a1 = chans[1][ia] - chans[1][ib]; a2 = chans[2][ia] - chans[2][ib];
        ab = Math.hypot(a0, a1, a2);
      }
    }
    P.sup[j + 1] = P.sup[j] + su; P.inn[j + 1] = P.inn[j] + inn;
    P.v0[j + 1] = P.v0[j] + a0; P.v1[j + 1] = P.v1[j] + a1; P.v2[j + 1] = P.v2[j] + a2; P.abs[j + 1] = P.abs[j] + ab;
  }
  return { x0, y0, dx, dy, P, S, n };
}

/**
 * Score the segment of a line between two points: edge coverage (sides mostly outside the image
 * score 0) and colour-step consistency. On a real card edge, (inside − outside) always points in
 * the same colour direction; on a grid or fabric pattern it keeps flipping sign.
 */
function segment(pr, p, q) {
  let a = (p[0] - pr.x0) * pr.dx + (p[1] - pr.y0) * pr.dy, b = (q[0] - pr.x0) * pr.dx + (q[1] - pr.y0) * pr.dy;
  if (a > b) [a, b] = [b, a];
  const len = b - a;
  const ia = Math.max(0, Math.min(pr.n, Math.round(a + 0.06 * len) + pr.S)), ib = Math.max(0, Math.min(pr.n, Math.round(b - 0.06 * len) + pr.S));
  const tot = ib - ia; if (tot <= 0) return { cov: 0, pol: 1 };
  const P = pr.P, inn = P.inn[ib] - P.inn[ia];
  const cov = inn < 0.5 * tot ? 0 : (P.sup[ib] - P.sup[ia]) / inn;
  const abs = P.abs[ib] - P.abs[ia];
  const pol = abs < 1e-3 ? 1 : Math.hypot(P.v0[ib] - P.v0[ia], P.v1[ib] - P.v1[ia], P.v2[ib] - P.v2[ia]) / abs;
  return { cov, pol };
}

/**
 * All plausible card quadrilaterals, best first, in the coordinates of the downscaled image
 * (`k` = scale factor to it). Each: { score, quad, cov, ratio, areaFrac, lines }.
 */
export function cardCandidates(src, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const E = edgeMap(src, o);
  if (!E) return null;
  const { k, W, H } = E;
  const lines = houghLines(E, o);
  if (lines.length < 4) return { k, W, H, E, lines, cands: [] };

  const sup = supportMaps(E);
  const S = Math.ceil(Math.hypot(W, H));
  const prof = lines.map(L => lineProfile(L, E, sup, S));
  const nL = lines.length, X = new Array(nL * nL).fill(null);
  for (let i = 0; i < nL; i++) for (let j = i + 1; j < nL; j++) {
    const L1 = lines[i], L2 = lines[j];
    const a = Math.cos(L1.t), b = Math.sin(L1.t), c = Math.cos(L2.t), d = Math.sin(L2.t);
    const det = a * d - b * c; if (Math.abs(det) < 1e-6) continue;
    X[i * nL + j] = X[j * nL + i] = [(L1.r * d - b * L2.r) / det, (a * L2.r - L1.r * c) / det];
  }
  const mx = W * 0.04, my = H * 0.04;
  const inBounds = p => p && p[0] >= -mx && p[1] >= -my && p[0] <= W + mx && p[1] <= H + my;

  // Opposite sides: near-parallel (≤ ~45°, perspective) and far enough apart.
  // Adjacent sides: ≥ 50° apart.
  const minSep = 0.08 * Math.min(W, H);
  const para = new Uint8Array(nL * nL), cross = new Uint8Array(nL * nL);
  for (let i = 0; i < nL; i++) for (let j = 0; j < nL; j++) {
    if (i === j) continue;
    const A = lines[i], B = lines[j], da = angDiff(A.t, B.t);
    if (da >= 0.87) { cross[i * nL + j] = 1; continue; }
    if (da > 0.8) continue;
    const rB = Math.abs(A.t - B.t) > Math.PI / 2 ? -B.r : B.r; // same normal orientation
    if (Math.abs(A.r - rB) >= minSep) para[i * nL + j] = 1;
  }

  // For each pair of opposite lines (a1, a2), the crossing lines that form a supported side
  // between them. Quads are pairs of such crossers that are themselves opposite: each side is
  // scored in O(1) and only once per pair, so far more lines can be afforded than with a
  // blind pair × pair search.
  const cands = [];
  let nPairs = 0;
  for (let a1 = 0; a1 < nL; a1++) for (let a2 = a1 + 1; a2 < nL; a2++) {
    if (!para[a1 * nL + a2]) continue;
    nPairs++;
    const bs = [];
    for (let b = 0; b < nL; b++) {
      if (!cross[a1 * nL + b] || !cross[a2 * nL + b]) continue;
      const p = X[a1 * nL + b], q = X[a2 * nL + b];
      if (!inBounds(p) || !inBounds(q)) continue;
      const sg = segment(prof[b], p, q);
      if (sg.cov < 0.3 || sg.pol < o.minPol) continue;
      bs.push({ b, sg });
    }
    for (let u = 0; u < bs.length; u++) for (let w = u + 1; w < bs.length; w++) {
      const b1 = bs[u].b, b2 = bs[w].b;
      if (Math.min(b1, b2) < a1 || !para[b1 * nL + b2]) continue; // each quad once: the family with the lowest line index enumerates it
      const q = [X[a1 * nL + b1], X[a1 * nL + b2], X[a2 * nL + b2], X[a2 * nL + b1]];
      let sgn = 0, convex = true, area = 0;
      for (let m = 0; m < 4; m++) {
        const a = q[m], b = q[(m + 1) % 4], c = q[(m + 2) % 4];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (!sgn) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) { convex = false; break; }
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (!convex) continue;
      const areaFrac = Math.abs(area) / 2 / (W * H);
      if (areaFrac < 0.015 || areaFrac > 0.98) continue;
      // sides: q0→q1 on a1, q1→q2 on b2, q2→q3 on a2, q3→q0 on b1
      const s0 = segment(prof[a1], q[0], q[1]); if (s0.cov < 0.3 || s0.pol < o.minPol) continue;
      const s2 = segment(prof[a2], q[2], q[3]); if (s2.cov < 0.3 || s2.pol < o.minPol) continue;
      const cov = [s0.cov, bs[w].sg.cov, s2.cov, bs[u].sg.cov];
      const minC = Math.min(...cov), meanC = (cov[0] + cov[1] + cov[2] + cov[3]) / 4;
      if (meanC < 0.5) continue;
      const minP = Math.min(s0.pol, bs[w].sg.pol, s2.pol, bs[u].sg.pol);
      const L = [0, 1, 2, 3].map(m => Math.hypot(q[(m + 1) % 4][0] - q[m][0], q[(m + 1) % 4][1] - q[m][1]));
      const sa = (L[0] + L[2]) / 2, sb = (L[1] + L[3]) / 2;
      const ratio = Math.max(sa, sb) / Math.min(sa, sb);
      const ratioF = Math.max(0.15, Math.exp(-(((ratio - CARD_RATIO) / 0.45) ** 2)));
      const score = meanC * (0.5 + 0.5 * minC) * ratioF * (0.55 + 0.45 * Math.sqrt(areaFrac)) * (0.5 + 0.5 * minP);
      cands.push({ score, quad: q, coverage: meanC, cov, ratio, areaFrac, lines: [a1, a2, b1, b2] });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return { k, W, H, E, lines, pairs: nPairs, cands };
}

/** Is point p inside the convex polygon (with tolerance in px)? */
function inside(p, poly, tol) {
  for (let m = 0; m < 4; m++) {
    const a = poly[m], b = poly[(m + 1) % 4];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const sideSign = Math.sign((b[0] - a[0]) * (poly[(m + 2) % 4][1] - a[1]) - (b[1] - a[1]) * (poly[(m + 2) % 4][0] - a[0]));
    if (sideSign * cr < -tol * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
  }
  return true;
}

/** Corners clockwise from top-left, long side on top, in source coordinates. */
export function orderQuad(quad, k, src) {
  let q = quad.map(p => [p[0] / k, p[1] / k]);
  let area = 0; for (let m = 0; m < 4; m++) area += q[m][0] * q[(m + 1) % 4][1] - q[(m + 1) % 4][0] * q[m][1];
  if (area < 0) q.reverse();
  let s0 = 0; for (let m = 1; m < 4; m++) if (q[m][0] + q[m][1] < q[s0][0] + q[s0][1]) s0 = m;
  q = [...q.slice(s0), ...q.slice(0, s0)];
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (len(q[0], q[1]) + len(q[2], q[3]) < len(q[1], q[2]) + len(q[3], q[0])) q = [q[3], q[0], q[1], q[2]];
  return q.map(p => [Math.min(Math.max(p[0], 0), src.width), Math.min(Math.max(p[1], 0), src.height)]);
}

/** Same corners, clockwise in image coordinates (y down). */
function clockwise(q) {
  let a = 0; for (let m = 0; m < 4; m++) a += q[m][0] * q[(m + 1) % 4][1] - q[(m + 1) % 4][0] * q[m][1];
  return a < 0 ? [...q].reverse() : q;
}

/** Largest corner distance between two clockwise quads, over the 4 rotations. */
function quadDist(p, q) {
  let best = Infinity;
  for (let r = 0; r < 4; r++) {
    let d = 0; for (let i = 0; i < 4; i++) d = Math.max(d, Math.hypot(p[i][0] - q[(i + r) % 4][0], p[i][1] - q[(i + r) % 4][1]));
    best = Math.min(best, d);
  }
  return best;
}

/** Weight of a reference match in the final score: wrong rectangles (≲ 0.5) all but vanish. */
const matchWeight = m => Math.max(0.01, (m - 0.2) / 0.8) ** 2;

/**
 * Find the card in a photo. Returns its corners (top-left, top-right, bottom-right, bottom-left,
 * in source pixels) or null.
 * opts.refs: signatures of the reference pictures (card-match.js). When given and one of them
 * matches a candidate, the best geometric candidate that also looks like a known card wins, and
 * the corners come in the card's reading orientation (`match` tells which reference).
 * @returns {null | { quad: number[][], score: number, coverage: number, match?: { score: number, ref: string | null } }}
 */
export function detectCard(src, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const C = cardCandidates(src, o);
  if (!C) return null;
  const { cands, k, W, H } = C;
  let best = cands[0] || null, matched = null;

  if (o.refs?.length && cands.length) {
    // distinct candidates (best of each cluster of near-identical quads), compared with the references
    const pool = [], tol = 0.008 * Math.hypot(W, H);
    for (const c of cands) {
      const q = clockwise(c.quad);
      if (pool.some(p => quadDist(p.q, q) < tol)) continue;
      pool.push({ c, q });
      if (pool.length >= o.matchPool) break;
    }
    const px = { data: C.E.rgba, width: W, height: H };
    // In shape-score order; matchWeight ≤ 1, so once a shape score is below the best combined
    // score so far, no later candidate can win: stop matching there.
    let bestComb = 0;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].c.score <= bestComb) { pool.length = i; break; }
      const p = pool[i]; p.m = matchQuad(px, p.q, o.refs);
      bestComb = Math.max(bestComb, p.c.score * matchWeight(p.m.score));
    }
    let top = Math.max(...pool.map(p => p.m.score));
    if (top < o.matchMin && top >= o.alignMin) {
      // Partial matches: candidates with one side on a wrong line (a paper edge, a grid line).
      // Align the best few to their reference and keep them if they now match.
      const sigs = Object.fromEntries(o.refs.map(r => [r.id, r.sig]));
      const tries = [...pool].sort((a, b) => b.m.score - a.m.score).slice(0, o.alignTop);
      if (opts.debug) detectCard.lastAlignFrom = tries.map(p => p.m.score);
      for (const p of tries) {
        const r = p.m.rot, start = [0, 1, 2, 3].map(i => p.q[(i + r) % 4]);
        const al = alignQuad(px, start, sigs[p.m.ref]);
        p.q = al.quad; p.m = { score: al.score, rot: 0, ref: p.m.ref }; p.aligned = true;
      }
      top = Math.max(...pool.map(p => p.m.score));
      if (opts.debug) detectCard.lastAlign = tries.map(p => p.m.score);
    }
    if (top >= o.matchMin) {
      matched = pool.reduce((a, b) => (b.c.score * matchWeight(b.m.score) > a.c.score * matchWeight(a.m.score) ? b : a));
      best = matched.c;
    }
  }
  if (!matched) {
    // Inner structures (photo, header...) form rectangles inside the card that share lines with it.
    // If a bigger candidate contains the best one and shares ≥ 2 lines, it's the real card border.
    for (let guard = 0; best && guard < 5; guard++) {
      const outer = cands.find(c => c !== best && c.score >= 0.5 * best.score && c.areaFrac > best.areaFrac * 1.05 &&
        c.lines.filter(l => best.lines.includes(l)).length >= 2 && best.quad.every(p => inside(p, c.quad, 3)));
      if (!outer) break;
      best = outer;
    }
  }
  if (opts.debug) detectCard.lastDebug = { k, W, H, thr: C.E.thr, lines: C.lines.map(l => ({ deg: +(l.t * 180 / Math.PI).toFixed(1), r: Math.round(l.r / k), v: Math.round(l.v) })), pairs: C.pairs, cands: cands.slice(0, 6).map(c => ({ score: +c.score.toFixed(3), cov: c.cov.map(v => +v.toFixed(2)), ratio: +c.ratio.toFixed(2), areaFrac: +c.areaFrac.toFixed(3), q: c.quad.map(p => p.map(v => Math.round(v / k))) })), chosen: best && best.quad.map(p => p.map(v => Math.round(v / k))), match: matched && matched.m };
  if (!best) return null;
  let quad;
  if (matched) { const q = matched.q, r = matched.m.rot; quad = [0, 1, 2, 3].map(i => q[(i + r) % 4]).map(p => [p[0] / k, p[1] / k]); }
  else quad = orderQuad(best.quad, k, src);
  if (o.refine) quad = refineQuad(src, quad, o.refineReach / k);
  quad = quad.map(p => [Math.min(Math.max(p[0], 0), src.width), Math.min(Math.max(p[1], 0), src.height)]);
  const res = { quad, score: best.score, coverage: best.coverage };
  return matched ? { ...res, match: { score: matched.m.score, ref: matched.m.ref } } : res;
}
