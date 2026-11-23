// @ts-check
// Minimal PDF writer (no dependencies): JPEG images + Helvetica text, one A4 page.
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
 * Cards at real size (85.6 × 54 mm), centred on an A4 page, one under the other, then the caption.
 * @param {{ jpeg: Uint8Array, w: number, h: number }[]} images sizes in pixels
 * @param {string[]} captionLines
 * @returns {Blob}
 */
export function makePdf(images, captionLines) {
  const PW = 595.28, PH = 841.89, MM = 72 / 25.4;
  const cw = 85.6 * MM, ch = 54 * MM, gap = 10 * MM;
  const x = (PW - cw) / 2;
  let y = PH - 25 * MM - ch;

  let content = '';
  images.forEach((img, i) => {
    content += `q ${cw.toFixed(2)} 0 0 ${ch.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q\n`;
    content += `q 0.6 G 0.5 w ${x.toFixed(2)} ${y.toFixed(2)} ${cw.toFixed(2)} ${ch.toFixed(2)} re S Q\n`;
    y -= ch + gap;
  });
  let ty = y + ch - 4 * MM;
  captionLines.forEach((line, i) => {
    content += `BT /F1 ${i === 0 ? 10 : 8.5} Tf ${(25 * MM).toFixed(2)} ${ty.toFixed(2)} Td (${pdfText(line)}) Tj ET\n`;
    ty -= 14;
  });

  /** @type {(string | Uint8Array)[][]} each object: list of parts */
  const objs = [];
  objs[1] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objs[2] = ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'];
  const xo = images.map((_, i) => `/Im${i} ${6 + i} 0 R`).join(' ');
  objs[3] = [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 4 0 R >> /XObject << ${xo} >> >> /Contents 5 0 R >>`];
  objs[4] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const cb = latin1(content);
  objs[5] = [`<< /Length ${cb.length} >>\nstream\n`, cb, '\nendstream'];
  images.forEach((img, i) => {
    objs[6 + i] = [`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`, img.jpeg, '\nendstream'];
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
