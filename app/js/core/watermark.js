// @ts-check
// Texts that end up on the output: the watermark drawn over the card and the PDF caption.
// Translation and the current date are decided by the caller; these functions only compose.

/** @typedef {(key: string, params?: Record<string, string | number>) => string} Translate */

/**
 * Watermark line: "ONLY FOR <PURPOSE> · RECIPIENT · DATE", upper-cased. Empty without a purpose
 * (no watermark is drawn then).
 * @param {{ purpose: string, recipient: string, date: string, onlyFor: (purpose: string) => string }} o
 *   purpose / recipient as typed (trimmed here); date already formatted; onlyFor: the translated "only for {purpose}"
 * @returns {string}
 */
export function watermarkText({ purpose, recipient, date, onlyFor }) {
  const p = purpose.trim(), r = recipient.trim();
  if (!p) return '';
  return [onlyFor(p), r, date].filter(Boolean).join(' · ').toUpperCase();
}

/**
 * The two caption lines printed under the cards in the PDF.
 * @param {{ purpose: string, recipient: string, date: string }} o
 * @param {Translate} tr translate function
 * @returns {string[]}
 */
export function pdfCaption({ purpose, recipient, date }, tr) {
  const r = recipient.trim();
  return [
    tr('pdf.caption_purpose', { purpose: purpose.trim() }),
    tr('pdf.caption_date', { recipient: r ? tr('pdf.caption_recipient', { recipient: r }) : '', date }),
  ];
}

/** File name of the PDF. @param {Translate} tr @param {Date} now */
export const pdfFileName = (tr, now) => tr('pdf.filename', { date: now.toISOString().slice(0, 10) });
