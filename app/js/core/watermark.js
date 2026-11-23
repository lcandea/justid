// @ts-check
// Texts that end up on the output: the watermark drawn over the card and the texts of the PDF page.
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
 * Everything printed on the PDF page around the cards, translated.
 * @param {{ purpose: string, recipient: string, date: string, hiddenCount: number }} o purpose / recipient as typed (trimmed here)
 * @param {Translate} tr translate function
 * @returns {import('./pdf.js').PdfTexts}
 */
export function pdfTexts({ purpose, recipient, date, hiddenCount }, tr) {
  const r = recipient.trim();
  return {
    eyebrow: tr('pdf.eyebrow'), purposeLabel: tr('pdf.purpose_label'), purpose: purpose.trim(),
    meta: [
      ...(r ? [{ label: tr('pdf.recipient_label'), value: r, wide: true }] : []),
      { label: tr('pdf.date_label'), value: date },
      { label: tr('pdf.hidden_label'), value: String(hiddenCount) },
    ],
    notice: tr('pdf.notice'), footer: tr('pdf.footer'), site: tr('pdf.site'),
  };
}

/** File name of the PDF. @param {Translate} tr @param {Date} now */
export const pdfFileName = (tr, now) => tr('pdf.filename', { date: now.toISOString().slice(0, 10) });
