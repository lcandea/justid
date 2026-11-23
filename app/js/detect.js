// @ts-nocheck -- numeric hot loop over typed arrays; kept untyped for readability of the algorithm.
// Automatic card detection in a photo, no dependencies.
// 1) downscale to ~480 px, 2) colour gradient (Sobel per channel) + non-maximum suppression,
// 3) gradient-oriented Hough transform, 4) combine pairs of near-parallel lines into quadrilaterals,
// 5) score each candidate by edge support on its 4 sides, its area and its aspect ratio (ID-1 ≈ 1.586).

export const CARD_RATIO = 85.6 / 54;

export function detectCard(src, opts = {}) {
  const MAXS = opts.maxSide || 480;
  const k = Math.min(1, MAXS / Math.max(src.width, src.height));
  const W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
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
    if (m < 8) continue;
    let a = Math.atan2(gyA[i], gxA[i]); if (a < 0) a += Math.PI; if (a >= Math.PI) a -= Math.PI;
    const q = Math.round(a / (Math.PI / 4)) % 4; // 0: horiz, 1: 45°, 2: vert, 3: 135°
    const o = q === 0 ? 1 : q === 1 ? W + 1 : q === 2 ? W : W - 1;
    if (m >= mag[i - o] && m > mag[i + o]) { edge[i] = 1; ang[i] = a; vals.push(m); }
  }
  if (vals.length < 50) return null;
  vals.sort((a, b) => a - b);
  const thr = Math.max(14, vals[Math.floor(vals.length * 0.98)] * 0.1); // relative to the strongest edges, not the median
  for (let i = 0; i < N; i++) if (edge[i] && mag[i] < thr) edge[i] = 0;

  // --- oriented Hough transform ---
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
  const minVotes = 0.25 * Math.min(W, H);
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
  const lines = peaks.slice(0, 40);
  if (lines.length < 4) return null;

  // --- near-parallel line pairs ---
  const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
  const minSep = 0.12 * Math.min(W, H);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i], B = lines[j];
    if (angDiff(A.t, B.t) > 0.8) continue; // ~45° (perspective)
    const rB = Math.abs(A.t - B.t) > Math.PI / 2 ? -B.r : B.r; // same normal orientation
    if (Math.abs(A.r - rB) < minSep) continue;
    pairs.push([A, B]);
  }
  // cap the cost on busy backgrounds: keep the most-voted pairs
  pairs.sort((p1, p2) => (p2[0].v + p2[1].v) - (p1[0].v + p1[1].v));
  pairs.length = Math.min(pairs.length, 120);

  const inter = (L1, L2) => {
    const a = Math.cos(L1.t), b = Math.sin(L1.t), c = Math.cos(L2.t), d = Math.sin(L2.t);
    const det = a * d - b * c; if (Math.abs(det) < 1e-6) return null;
    return [(L1.r * d - b * L2.r) / det, (a * L2.r - L1.r * c) / det];
  };
  // is there an edge with a compatible orientation near the point?
  const support = (x, y, nAng) => {
    const xi = Math.round(x), yi = Math.round(y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = xi + dx, yy = yi + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const i = yy * W + xx;
      if (edge[i] && angDiff(ang[i], nAng) < 0.3) return true;
    }
    return false;
  };
  const sideCoverage = (p, q) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let nAng = Math.atan2(q[0] - p[0], -(q[1] - p[1])); // side normal
    if (nAng < 0) nAng += Math.PI; if (nAng >= Math.PI) nAng -= Math.PI;
    const n = Math.max(12, Math.round(len / 2)); let hit = 0, tot = 0;
    for (let s = 0; s < n; s++) {
      const f = 0.06 + 0.88 * s / (n - 1);
      const x = p[0] + (q[0] - p[0]) * f, y = p[1] + (q[1] - p[1]) * f;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue; // outside the image: doesn't count
      tot++; if (support(x, y, nAng)) hit++;
    }
    return tot < n * 0.5 ? 0 : hit / tot;
  };

  let best = null; const cands = [];
  // Colour-step consistency across a side: on a real card edge, (inside − outside) always points
  // in the same colour direction; on a grid or fabric pattern it keeps flipping sign.
  const colorAt = (x, y) => { const i = Math.round(y) * W + Math.round(x); return [chans[0][i], chans[1][i], chans[2][i]]; };
  const polarity = (p, q, ctr) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    let nx = -dy / len, ny = dx / len;
    const mx0 = (p[0] + q[0]) / 2, my0 = (p[1] + q[1]) / 2;
    if ((ctr[0] - mx0) * nx + (ctr[1] - my0) * ny < 0) { nx = -nx; ny = -ny; }
    const d = 3, n = Math.max(12, Math.round(len / 3));
    const sum = [0, 0, 0]; let absSum = 0;
    for (let s = 0; s < n; s++) {
      const f = 0.08 + 0.84 * s / (n - 1), x = p[0] + dx * f, y = p[1] + dy * f;
      const xi = x + nx * d, yi = y + ny * d, xo = x - nx * d, yo = y - ny * d;
      if (Math.min(xi, xo) < 0 || Math.min(yi, yo) < 0 || Math.max(xi, xo) > W - 1 || Math.max(yi, yo) > H - 1) continue;
      const a = colorAt(xi, yi), b = colorAt(xo, yo);
      const v = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      sum[0] += v[0]; sum[1] += v[1]; sum[2] += v[2]; absSum += Math.hypot(...v);
    }
    return absSum < 1e-3 ? 1 : Math.hypot(...sum) / absSum; // no samples (outside the image): no penalty
  };
  const mx = W * 0.04, my = H * 0.04;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [A1, A2] = pairs[i], [B1, B2] = pairs[j];
    if (A1 === B1 || A1 === B2 || A2 === B1 || A2 === B2) continue;
    if (angDiff(A1.t, B1.t) < 0.87) continue; // < 50° between the two line families: not a rectangle
    const q = [inter(A1, B1), inter(A1, B2), inter(A2, B2), inter(A2, B1)];
    if (q.some(p => !p || p[0] < -mx || p[1] < -my || p[0] > W + mx || p[1] > H + my)) continue;
    let sgn = 0, convex = true, area = 0;
    for (let m = 0; m < 4; m++) {
      const a = q[m], b = q[(m + 1) % 4], c = q[(m + 2) % 4];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!sgn) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) { convex = false; break; }
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (!convex) continue;
    const areaFrac = Math.abs(area) / 2 / (W * H);
    if (areaFrac < 0.025 || areaFrac > 0.98) continue;
    const L = [0, 1, 2, 3].map(m => Math.hypot(q[(m + 1) % 4][0] - q[m][0], q[(m + 1) % 4][1] - q[m][1]));
    const sa = (L[0] + L[2]) / 2, sb = (L[1] + L[3]) / 2;
    const ratio = Math.max(sa, sb) / Math.min(sa, sb);
    const ratioF = Math.max(0.15, Math.exp(-(((ratio - CARD_RATIO) / 0.45) ** 2)));
    const cov = [0, 1, 2, 3].map(m => sideCoverage(q[m], q[(m + 1) % 4]));
    const minC = Math.min(...cov), meanC = cov.reduce((s, c) => s + c, 0) / 4;
    if (minC < 0.3 || meanC < 0.5) continue;
    const ctr = [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
    const pol = [0, 1, 2, 3].map(m => polarity(q[m], q[(m + 1) % 4], ctr));
    const minP = Math.min(...pol);
    if (minP < 0.45) continue;
    const score = meanC * (0.5 + 0.5 * minC) * ratioF * (0.55 + 0.45 * Math.sqrt(areaFrac)) * (0.5 + 0.5 * minP);
    cands.push({ score, quad: q, coverage: meanC, cov, ratio, areaFrac, lines: [A1, A2, B1, B2] });
  }
  cands.sort((a, b) => b.score - a.score);
  best = cands[0] || null;
  // Inner structures (photo, header...) form rectangles inside the card that share lines with it.
  // If a bigger candidate contains the best one and shares ≥ 2 lines, it's the real card border.
  const inside = (p, poly, tol) => {
    for (let m = 0; m < 4; m++) {
      const a = poly[m], b = poly[(m + 1) % 4];
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const sideSign = Math.sign((b[0] - a[0]) * (poly[(m + 2) % 4][1] - a[1]) - (b[1] - a[1]) * (poly[(m + 2) % 4][0] - a[0]));
      if (sideSign * cr < -tol * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
    }
    return true;
  };
  for (let guard = 0; best && guard < 5; guard++) {
    const outer = cands.find(c => c !== best && c.score >= 0.5 * best.score && c.areaFrac > best.areaFrac * 1.05 &&
      c.lines.filter(l => best.lines.includes(l)).length >= 2 && best.quad.every(p => inside(p, c.quad, 3)));
    if (!outer) break;
    best = outer;
  }
  if (opts.debug) detectCard.lastDebug = { k, W, H, thr, lines: lines.map(l => ({ deg: +(l.t * 180 / Math.PI).toFixed(1), r: Math.round(l.r / k), v: Math.round(l.v) })), pairs: pairs.length, cands: cands.slice(0, 6).map(c => ({ score: +c.score.toFixed(3), cov: c.cov.map(v => +v.toFixed(2)), ratio: +c.ratio.toFixed(2), areaFrac: +c.areaFrac.toFixed(3), q: c.quad.map(p => p.map(v => Math.round(v / k))) })), chosen: best && best.quad.map(p => p.map(v => Math.round(v / k))) };
  if (!best) return null;

  // --- order corners: clockwise from top-left, long side on top ---
  let q = best.quad.map(p => [p[0] / k, p[1] / k]);
  let area = 0; for (let m = 0; m < 4; m++) area += q[m][0] * q[(m + 1) % 4][1] - q[(m + 1) % 4][0] * q[m][1];
  if (area < 0) q.reverse();
  let s0 = 0; for (let m = 1; m < 4; m++) if (q[m][0] + q[m][1] < q[s0][0] + q[s0][1]) s0 = m;
  q = [...q.slice(s0), ...q.slice(0, s0)];
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (len(q[0], q[1]) + len(q[2], q[3]) < len(q[1], q[2]) + len(q[3], q[0])) q = [q[3], q[0], q[1], q[2]];
  q = q.map(p => [Math.min(Math.max(p[0], 0), src.width), Math.min(Math.max(p[1], 0), src.height)]);
  return { quad: q, score: best.score, coverage: best.coverage };
}
