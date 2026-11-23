// @ts-check
// Glyph widths of the standard PDF fonts used by pdf.js (from the Adobe Core 14 AFM files), so the
// layout can measure, wrap and right-align text without embedding a font. Widths are in 1/1000 em.
// Only printable ASCII is listed; Latin-1 letters with accents take the width of their base letter.

/** @typedef {'Helvetica' | 'Helvetica-Bold' | 'Courier' | 'Courier-Bold'} PdfFont */

/** Widths of the characters 32..126. @param {string} list space-separated numbers */
const ascii = list => list.trim().split(/\s+/).map(Number);

const HELVETICA = ascii(`
  278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278
  556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556
  1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778
  667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556
  333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556
  556 556 333 500 278 556 500 722 500 500 500 334 260 334 584`);

const HELVETICA_BOLD = ascii(`
  278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278
  556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611
  975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778
  667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556
  333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611
  611 611 389 556 333 611 556 778 556 556 500 389 280 389 584`);

/** A few Latin-1 symbols that don't decompose to an ASCII letter. */
const EXTRA = { '·': 278, '¿': 611, '¡': 333, '«': 556, '»': 556, 'º': 365, 'ª': 370, 'ß': 611, 'æ': 889, 'Æ': 1000, 'ø': 611, 'Ø': 778 };

/** Width of one character in 1/1000 em. @param {PdfFont} font @param {string} ch */
function charWidth(font, ch) {
  if (font.startsWith('Courier')) return 600;
  const table = font === 'Helvetica-Bold' ? HELVETICA_BOLD : HELVETICA;
  let c = ch.charCodeAt(0);
  if (c < 32 || c > 126) {
    if (ch in EXTRA) return EXTRA[/** @type {keyof typeof EXTRA} */ (ch)];
    c = ch.normalize('NFD').charCodeAt(0); // á -> a, Ñ -> N
    if (c < 32 || c > 126) return 556;
  }
  return table[c - 32];
}

/**
 * Width of a string in points.
 * @param {string} text @param {PdfFont} font @param {number} size @param {number} [spacing] extra points after each character (PDF Tc)
 */
export function textWidth(text, font, size, spacing = 0) {
  let w = 0;
  for (const ch of text) w += charWidth(font, ch) * size / 1000 + spacing;
  return w;
}

/**
 * Break text into lines no wider than `max` points, at spaces (a single overlong word is kept whole).
 * @param {string} text @param {PdfFont} font @param {number} size @param {number} max
 * @returns {string[]}
 */
export function wrapText(text, font, size, max) {
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + word : word;
    if (line && textWidth(next, font, size) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
