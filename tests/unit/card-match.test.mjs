// Card matching for the detector (core/card-match.js) and the signature it shares with
// identification (core/identify.js). Pure pixel maths on plain arrays, no canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const I = await import(join(ROOT, 'app/js/core/identify.js'));
const M = await import(join(ROOT, 'app/js/core/card-match.js'));
const { homography } = await import(join(ROOT, 'app/js/core/image.js'));

/** Deterministic pseudo-random numbers. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

/** A synthetic card design (blocks and stripes, so it has a clear layout), CW × CH RGBA. */
function cardPixels(CW = 256, CH = 160) {
  const data = new Uint8ClampedArray(CW * CH * 4), r = rng(7);
  const blocks = Array.from({ length: 12 }, () => [r() * CW, r() * CH, 10 + r() * 60, 6 + r() * 30, r() * 255]);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    let v = y < 24 ? 60 : 225 - 20 * Math.sin(x / 9);
    for (const [bx, by, bw, bh, c] of blocks) if (x >= bx && x < bx + bw && y >= by && y < by + bh) v = c;
    const i = (y * CW + x) * 4; data[i] = v; data[i + 1] = v * 0.9; data[i + 2] = v * 0.8; data[i + 3] = 255;
  }
  return { data, width: CW, height: CH };
}

/** A W × H photo with the card mapped onto `quad` (TL, TR, BR, BL) over a noisy background. */
function photo(card, quad, W = 480, H = 360) {
  const data = new Uint8ClampedArray(W * H * 4), r = rng(3);
  const h = homography(quad, [[0, 0], [card.width, 0], [card.width, card.height], [0, card.height]]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const den = h[6] * x + h[7] * y + 1, u = Math.floor((h[0] * x + h[1] * y + h[2]) / den), v = Math.floor((h[3] * x + h[4] * y + h[5]) / den);
    const i = (y * W + x) * 4;
    if (u >= 0 && v >= 0 && u < card.width && v < card.height) { const j = (v * card.width + u) * 4; data[i] = card.data[j]; data[i + 1] = card.data[j + 1]; data[i + 2] = card.data[j + 2]; }
    else { const n = 90 + r() * 60; data[i] = n; data[i + 1] = n; data[i + 2] = n; }
    data[i + 3] = 255;
  }
  return { data, width: W, height: H };
}

const QUAD = [[90, 70], [400, 90], [390, 290], [80, 270]];
const card = cardPixels();
const refs = [{ id: 'test:front', sig: M.referenceSignature(card) }];

test('greySignature: summed-area local mean equals the plain 9×9 window mean', () => {
  const g = new Float32Array(I.SIG_W * I.SIG_H), r = rng(1);
  for (let i = 0; i < g.length; i++) g[i] = r() * 255;
  const fast = I.greySignature(g);
  // reference implementation: explicit window with replicated edges
  const hp = new Float32Array(g.length);
  for (let y = 0; y < I.SIG_H; y++) for (let x = 0; x < I.SIG_W; x++) {
    let s = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++)
      s += g[Math.min(I.SIG_H - 1, Math.max(0, y + dy)) * I.SIG_W + Math.min(I.SIG_W - 1, Math.max(0, x + dx))];
    hp[y * I.SIG_W + x] = g[y * I.SIG_W + x] - s / 81;
  }
  const m = hp.reduce((a, b) => a + b, 0) / hp.length;
  const n = Math.sqrt(hp.reduce((a, b) => a + (b - m) ** 2, 0));
  for (let i = 0; i < hp.length; i++) assert.ok(Math.abs(fast.full[i] - (hp[i] - m) / n) < 1e-5);
});

test('matchQuad: the card matches its reference and the rotation gives its top-left corner', () => {
  const px = photo(card, QUAD);
  const m = M.matchQuad(px, QUAD, refs);
  assert.ok(m.score > 0.8, `score ${m.score}`);
  assert.equal(m.rot, 0);
  assert.equal(m.ref, 'test:front');
  // the same corners listed from another one: the rotation points back at the real top-left
  const shifted = [QUAD[2], QUAD[3], QUAD[0], QUAD[1]];
  assert.equal(M.matchQuad(px, shifted, refs).rot, 2);
});

test('matchQuad: a wrong rectangle scores low', () => {
  const px = photo(card, QUAD);
  const wrong = [[10, 10], [200, 15], [195, 140], [12, 130]]; // mostly background
  assert.ok(M.matchQuad(px, wrong, refs).score < 0.5);
});

test('alignQuad: pulls a near-miss corner (a few % of the card off) back onto the card', () => {
  const px = photo(card, QUAD);
  const off = QUAD.map(p => [...p]); off[2] = [402, 303]; // bottom-right on a nearby wrong line (~5% of the card diagonal)
  const before = M.matchQuad(px, off, refs).score;
  const al = M.alignQuad(px, off, refs[0].sig);
  assert.ok(al.score > before, `${before} → ${al.score}`);
  const err = Math.max(...al.quad.map((p, i) => Math.hypot(p[0] - QUAD[i][0], p[1] - QUAD[i][1])));
  assert.ok(err < 6, `corner error ${err.toFixed(1)} px`);
});

const { refineQuadPixels } = await import(join(ROOT, 'app/js/core/refine.js'));
const worst = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

test('refineQuadPixels: corners a few pixels off snap back onto the card edges', () => {
  const px = photo(card, QUAD);
  const off = QUAD.map(([x, y], i) => [x + [3, -2, 2, -3][i], y + [-2, 3, 3, -2][i]]);
  const r = refineQuadPixels(px, off, 6);
  assert.ok(worst(r, QUAD) < 1, `corner error ${worst(r, QUAD).toFixed(2)} px`);
});

test('refineQuadPixels: a finger over part of a side does not drag the line', () => {
  const px = photo(card, QUAD);
  // a skin-coloured band across the left side
  for (let y = 150; y < 190; y++) for (let x = 40; x < 140; x++) { const i = (y * px.width + x) * 4; px.data[i] = 220; px.data[i + 1] = 170; px.data[i + 2] = 140; }
  const off = QUAD.map(([x, y]) => [x + 2, y + 2]);
  const r = refineQuadPixels(px, off, 6);
  assert.ok(worst(r, QUAD) < 1.5, `corner error ${worst(r, QUAD).toFixed(2)} px`);
});
