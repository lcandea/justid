// @ts-check
// Minimal PDF writer (no dependencies): JPEG images + text in the standard PDF fonts, one A4 page.
import { textWidth, wrapText } from './pdf-fonts.js';
import { QR_CODES } from './qr-codes.js';

/** @typedef {import('./pdf-fonts.js').PdfFont} PdfFont */
// Being this small is deliberate: it's easy to audit that the PDF contains only what you see.

/** PDF strings use Latin-1; anything outside it becomes "?". @param {string} str */
function latin1(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); b[i] = c < 256 ? c : 63; }
  return b;
}
/** Escape a PDF string literal. @param {string} s */
function pdfText(s) { return s.replace(/[\\()]/g, m => '\\' + m).replace(/[\r\n]+/g, ' '); }

/**
 * Texts printed on the page, already translated. Labels are upper-cased here (they are set as mono eyebrows).
 * @typedef {{ eyebrow: string, purposeLabel: string, purpose: string,
 *   meta: { label: string, value: string, wide?: boolean }[], notice: string, footer: string, site: string,
 *   recipient: { eyebrow: string, body: string, url: string }, useLabel: string }} PdfTexts
 */

// Colours of the site's theme (shared/theme.css), on paper instead of ink.
const INK = '0.051 0.051 0.047', MUTE = '0.42 0.404 0.373', LINE = '0.851 0.839 0.812', LIME = '0.843 1 0.227', PAPER = '1 1 1';
const CREAM = '0.953 0.945 0.925';
/** Font resource names. @type {Record<PdfFont, string>} */
const FONT_RES = { 'Helvetica': 'F1', 'Helvetica-Bold': 'F2', 'Courier': 'F3', 'Courier-Bold': 'F4' };
const n = (/** @type {number} */ v) => +v.toFixed(2);

/** Path of a rectangle with rounded corners (Bézier arcs). @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function roundRect(x, y, w, h, r) {
  const k = r * 0.5523;
  return `${n(x + r)} ${n(y)} m ${n(x + w - r)} ${n(y)} l ${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)} c ` +
    `${n(x + w)} ${n(y + h - r)} l ${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c ` +
    `${n(x + r)} ${n(y + h)} l ${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)} c ` +
    `${n(x)} ${n(y + r)} l ${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)} c h`;
}

/**
 * A QR code as vector squares: one path of dark-module runs filled at once (no seams between modules).
 * @param {import('./qr-codes.js').QrCode} code @param {number} x left @param {number} y bottom @param {number} size side in points
 */
function qrPath(code, x, y, size) {
  const m = size / code.size;
  let path = '';
  code.rows.forEach((row, r) => {
    for (const run of row.matchAll(/1+/g)) {
      path += `${n(x + /** @type {number} */ (run.index) * m)} ${n(y + size - (r + 1) * m)} ${n(run[0].length * m)} ${n(m)} re `;
    }
  });
  return `${INK} rg ${path}f\n`;
}

/**
 * One A4 page in the site's style, on white: header with the logo, the cards at real size
 * (85.6 × 54 mm, ID-1 corner radius) side by side, the purpose and its details, a note for the
 * recipient with a QR code to /why, and a footer with a QR code to JustID.
 * @param {{ jpeg: Uint8Array, w: number, h: number }[]} images sizes in pixels
 * @param {PdfTexts} texts
 * @returns {Blob}
 */
export function makePdf(images, texts) {
  const PW = 595.28, PH = 841.89, MM = 72 / 25.4;
  // Margins are set so two cards at real size plus their gap fill the content width exactly.
  const CW_CARD = 85.6 * MM, GAP = 6 * MM, M = (PW - 2 * CW_CARD - GAP) / 2, CW = PW - 2 * M;
  let content = '';
  /** @param {string} str @param {PdfFont} font @param {number} size @param {number} x @param {number} y @param {string} color @param {number} [sp] */
  const text = (str, font, size, x, y, color, sp = 0) => {
    content += `BT /${FONT_RES[font]} ${size} Tf ${n(sp)} Tc ${color} rg ${n(x)} ${n(y)} Td (${pdfText(str)}) Tj ET\n`;
  };
  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} color */
  const rect = (x, y, w, h, color) => { content += `${color} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f\n`; };
  /** Mono eyebrow label (upper-case, tracked). @param {string} str @param {number} x @param {number} y @param {string} [color] */
  const eyebrow = (str, x, y, color = MUTE) => text(str.toUpperCase(), 'Courier-Bold', 7.5, x, y, color, 0.6);
  const eyebrowWidth = (/** @type {string} */ str) => textWidth(str.toUpperCase(), 'Courier-Bold', 7.5, 0.6);

  // Header: logo ("Just" + an inverted "ID" block, as on the site), eyebrow on the right, a thick rule.
  const hy = PH - 18 * MM, ls = 15;
  text('Just', 'Helvetica-Bold', ls, M, hy, INK);
  const idX = M + textWidth('Just', 'Helvetica-Bold', ls) + 1.5, idW = textWidth('ID', 'Helvetica-Bold', ls) + 6;
  rect(idX, hy - 3.6, idW, ls * 0.98, INK);
  text('ID', 'Helvetica-Bold', ls, idX + 3, hy, PAPER);
  eyebrow(texts.eyebrow, M + CW - eyebrowWidth(texts.eyebrow), hy + 1);
  rect(M, hy - 9 * MM / 2 - 3, CW, 1.4, INK);

  // Footer geometry (drawn at the end).
  const fy = 14 * MM, siteW = textWidth(texts.site, 'Courier-Bold', 7.5);
  const footLines = wrapText(texts.footer, 'Courier', 7.5, CW - siteW - 8 * MM);
  const ruleY = fy + (footLines.length - 1) * 9.5 + 12;
  const uS = 16 * MM, uQuiet = uS / QR_CODES.use.size * 2, uBox = uS + 2 * uQuiet, barH = 5 * MM;
  const ux = M + CW - uBox, uy = ruleY + 3 * MM;

  /** Everything under the cards, from `top` down: purpose, details, notice and the recipient panel. @param {number} top */
  const below = top => {
    let y = top;
    // Purpose: label, then the purpose itself highlighted in lime (like the site's <mark>).
    eyebrow(texts.purposeLabel, M, y);
    const ps = 17, lead = 23;
    y -= 7 * MM;
    for (const line of wrapText(texts.purpose, 'Helvetica-Bold', ps, CW - 8)) {
      rect(M, y - 4.5, textWidth(line, 'Helvetica-Bold', ps) + 8, ps + 3.5, LIME);
      text(line, 'Helvetica-Bold', ps, M + 4, y, INK);
      y -= lead;
    }
    // Details in columns (a "wide" one gets twice the room), values wrapped to two lines at most.
    y -= 4 * MM;
    const units = texts.meta.reduce((s, m) => s + (m.wide ? 2 : 1), 0), colGap = 6 * MM;
    let x = M, lowest = y;
    for (const m of texts.meta) {
      const w = (CW - colGap * (texts.meta.length - 1)) * (m.wide ? 2 : 1) / units;
      eyebrow(m.label, x, y);
      let vy = y - 14;
      for (const line of wrapText(m.value, 'Helvetica', 10.5, w).slice(0, 2)) { text(line, 'Helvetica', 10.5, x, vy, INK); vy -= 13.5; }
      lowest = Math.min(lowest, vy);
      x += w + colGap;
    }
    // Notice, introduced by a short redaction bar (the site's motif).
    y = lowest - 5 * MM;
    rect(M, y - 0.5, 16, 7, INK);
    for (const line of wrapText(texts.notice, 'Helvetica-Bold', 9.5, CW - 24)) { text(line, 'Helvetica-Bold', 9.5, M + 24, y, INK); y -= 12.5; }
    // For the recipient: a cream panel with a lime edge, a short explanation, the /why address and its
    // QR code (on a white square with a quiet zone, so it scans on the cream).
    const pad = 4.5 * MM, qrS = 22 * MM, quiet = qrS / QR_CODES.why.size * 2.5, qrBox = qrS + 2 * quiet;
    const bodyLines = wrapText(texts.recipient.body, 'Helvetica', 9.5, CW - qrBox - 3 * pad - 3);
    const textH = 7.5 + 7 + bodyLines.length * 12.5 + 6 + 10;
    const panelH = Math.max(textH, qrBox) + 2 * pad, panelTop = y + 12.5 - 6 * MM;
    rect(M, panelTop - panelH, CW, panelH, CREAM);
    rect(M, panelTop - panelH, 3, panelH, LIME);
    let ty = panelTop - pad - 6;
    eyebrow(texts.recipient.eyebrow, M + pad + 3, ty);
    ty -= 7 + 12.5;
    for (const line of bodyLines) { text(line, 'Helvetica', 9.5, M + pad + 3, ty, INK); ty -= 12.5; }
    text(texts.recipient.url, 'Courier-Bold', 10, M + pad + 3, ty - 4, INK);
    const qx = M + CW - pad - qrBox, qy = panelTop - pad - qrBox - (panelH - 2 * pad - qrBox) / 2;
    rect(qx, qy, qrBox, qrBox, PAPER);
    content += qrPath(QR_CODES.why, qx + quiet, qy + quiet, qrS);
  };

  // Cards at real size (ID-1: 85.6 × 54 mm, 3.18 mm corners), side by side, centred.
  const ch = 54 * MM, r = 3.18 * MM, y = PH - 34 * MM - ch;
  let cx = (PW - images.length * CW_CARD - (images.length - 1) * GAP) / 2;
  images.forEach((_, i) => {
    content += `q ${roundRect(cx, y, CW_CARD, ch, r)} W n ${n(CW_CARD)} 0 0 ${n(ch)} ${n(cx)} ${n(y)} cm /Im${i} Do Q\n`;
    content += `q ${LINE} RG 0.6 w ${roundRect(cx, y, CW_CARD, ch, r)} S Q\n`;
    cx += CW_CARD + GAP;
  });
  below(y - 12 * MM);

  // Footer: hairline, then what made this file and where (site right-aligned), and above the rule the
  // "Use JustID" QR code: framed, with its label in an ink bar (like the logo's "ID" block).
  rect(M, ruleY, CW, 0.6, LINE);
  rect(ux, uy, uBox, barH, INK);
  const useLabel = texts.useLabel.toUpperCase(), useW = textWidth(useLabel, 'Helvetica-Bold', 7, 0.4);
  text(useLabel, 'Helvetica-Bold', 7, ux + (uBox - useW) / 2, uy + barH / 2 - 2.4, PAPER, 0.4);
  content += `q ${INK} RG 1 w ${n(ux + 0.5)} ${n(uy + barH)} ${n(uBox - 1)} ${n(uBox - 0.5)} re S Q\n`;
  content += qrPath(QR_CODES.use, ux + uQuiet, uy + barH + uQuiet, uS);
  footLines.forEach((line, i) => text(line, 'Courier', 7.5, M, fy + (footLines.length - 1 - i) * 9.5, MUTE));
  text(texts.site, 'Courier-Bold', 7.5, M + CW - siteW, fy, INK);

  // Objects: 1 catalog, 2 page tree, 3 page, 4 content, 5.. fonts, then the images.
  const fonts = /** @type {[PdfFont, string][]} */ (Object.entries(FONT_RES)), firstImg = 5 + fonts.length;
  /** @type {(string | Uint8Array)[][]} each object: list of parts */
  const objs = [];
  objs[1] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objs[2] = ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'];
  const fontRefs = fonts.map(([, res], i) => `/${res} ${5 + i} 0 R`).join(' ');
  const xo = images.map((_, i) => `/Im${i} ${firstImg + i} 0 R`).join(' ');
  objs[3] = [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << ${fontRefs} >> /XObject << ${xo} >> >> /Contents 4 0 R >>`];
  const cb = latin1(content);
  objs[4] = [`<< /Length ${cb.length} >>\nstream\n`, cb, '\nendstream'];
  fonts.forEach(([font], i) => { objs[5 + i] = [`<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`]; });
  images.forEach((img, i) => {
    objs[firstImg + i] = [`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`, img.jpeg, '\nendstream'];
  });

  /** @type {Uint8Array[]} */
  const parts = []; let len = 0;
  const push = (/** @type {string | Uint8Array} */ p) => { const b = typeof p === 'string' ? latin1(p) : p; parts.push(b); len += b.length; };
  push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  /** @type {number[]} */
  const offsets = [];
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = len;
    push(`${n} 0 obj\n`); objs[n].forEach(push); push('\nendobj\n');
  }
  const xref = len;
  let xs = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) xs += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(xs);
  push(`trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(/** @type {BlobPart[]} */ (parts), { type: 'application/pdf' });
}

/** @param {HTMLCanvasElement} canvas @param {number} quality @returns {Promise<Uint8Array>} */
export function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(async b => {
    if (!b) return reject(new Error('JPEG encoding failed'));
    resolve(new Uint8Array(await b.arrayBuffer()));
  }, 'image/jpeg', quality));
}
