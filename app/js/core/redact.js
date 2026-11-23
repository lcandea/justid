// @ts-check
// Where your data actually gets hidden. Everything here draws on a local <canvas>.
//
// renderRedacted() takes the straightened card and, in order:
//   1. optionally converts it to greyscale,
//   2. covers every zone of every hidden field (pixelation with noise, or a solid block),
//   3. writes the purpose watermark across the whole card.
// The output canvas is what goes into the PDF; the original photo is never exported.

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {'pixel' | 'solid'} HideMode */

/** @param {CanvasRenderingContext2D} ctx @param {number} W @param {number} H */
function toGray(ctx, W, H) {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
}

/**
 * Pixelate a rectangle with big blocks (≥ 16 px or half the zone's short side) plus random noise
 * per block, so the original text can't be recovered by "de-pixelating" tricks.
 * @param {CanvasRenderingContext2D} ctx @param {number} x @param {number} y @param {number} w @param {number} h
 */
function pixelate(ctx, x, y, w, h) {
  const img = ctx.getImageData(x, y, w, h), d = img.data;
  const b = Math.max(16, Math.round(Math.min(w, h) / 2));
  for (let by = 0; by < h; by += b) for (let bx = 0; bx < w; bx += b) {
    const bw = Math.min(b, w - bx), bh = Math.min(b, h - by);
    let r = 0, g = 0, bl = 0, n = 0;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { const i = ((by + yy) * w + bx + xx) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    const noise = (Math.random() - 0.5) * 60;
    r = r / n + noise; g = g / n + noise; bl = bl / n + noise;
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) { const i = ((by + yy) * w + bx + xx) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = bl; }
  }
  ctx.putImageData(img, x, y);
}

/**
 * Two layers of repeated text at different angles, sizes and colours, with random jitter,
 * so the watermark is hard to remove cleanly.
 * @param {CanvasRenderingContext2D} ctx @param {number} W @param {number} H @param {string} text @param {boolean} bw
 */
function drawWatermark(ctx, W, H, text, bw) {
  const layer = (/** @type {number} */ fs, /** @type {number} */ deg, /** @type {number} */ alpha, /** @type {string} */ rgb, /** @type {boolean} */ stroke) => {
    ctx.save();
    ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`; ctx.textBaseline = 'middle';
    ctx.translate(W / 2, H / 2); ctx.rotate(deg * Math.PI / 180);
    const D = Math.hypot(W, H), tw = ctx.measureText(text).width + fs * 1.5;
    let row = 0;
    for (let y = -D / 2; y < D / 2; y += fs * 2, row++) {
      const off = (row % 2) * tw / 2 + Math.random() * fs * 2;
      for (let x = -D / 2 - tw + off; x < D / 2; x += tw) {
        const a = alpha * (0.8 + Math.random() * 0.4), jy = y + (Math.random() - 0.5) * fs * 0.3;
        if (stroke) { ctx.lineWidth = Math.max(1, fs * 0.08); ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.strokeText(text, x, jy); }
        ctx.fillStyle = `rgba(${rgb},${a})`; ctx.fillText(text, x, jy);
      }
    }
    ctx.restore();
  };
  layer(Math.round(H * 0.05), -22, 0.34, bw ? '40,40,40' : '25,40,160', true);
  layer(Math.round(H * 0.022), 17, 0.2, bw ? '0,0,0' : '160,20,40', false);
}

/**
 * Draw the redacted version of one side of the card into `out`.
 * @param {HTMLCanvasElement} out
 * @param {HTMLCanvasElement} base straightened card (never modified)
 * @param {'front' | 'back'} side
 * @param {{ template: ResolvedTemplate, hidden: Set<string>, mode: HideMode, bw: boolean, watermark: string }} opts
 */
export function renderRedacted(out, base, side, { template, hidden, mode, bw, watermark }) {
  const W = base.width, H = base.height;
  out.width = W; out.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d', { willReadFrequently: true }));
  ctx.drawImage(base, 0, 0);
  if (bw) toGray(ctx, W, H);
  for (const f of template.fields) {
    if (!hidden.has(f.id)) continue;
    for (const z of f.zones) {
      if (z.side !== side) continue;
      const x = Math.max(0, Math.round(z.x * W)), y = Math.max(0, Math.round(z.y * H));
      const w = Math.min(W - x, Math.round(z.w * W)), h = Math.min(H - y, Math.round(z.h * H));
      if (w < 1 || h < 1) continue;
      if (mode === 'solid') { ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h); } else pixelate(ctx, x, y, w, h);
    }
  }
  if (watermark) drawWatermark(ctx, W, H, watermark, bw);
}
