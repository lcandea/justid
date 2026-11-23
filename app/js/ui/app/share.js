// @ts-check
// Step 4: build the PDF from the redacted cards and share or download it.
import { $, $input, downloadBlob } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { makePdf, canvasToJpeg } from '../../core/pdf.js';
import { pdfTexts, pdfFileName } from '../../core/watermark.js';
import { hiddenFieldCount } from '../../core/flow.js';
import { state, sides, CAN_SHARE } from './state.js';

async function buildPdfFile() {
  const imgs = [];
  for (const side of sides()) { const cv = state.canvas[side]; imgs.push({ jpeg: await canvasToJpeg(cv, 0.78), w: cv.width, h: cv.height }); }
  const texts = pdfTexts({
    purpose: $input('#purpose').value, recipient: $input('#recipient').value, date: new Date().toLocaleDateString(getLang()),
    hiddenCount: hiddenFieldCount(state.template, state.hidden, sides()),
  }, t);
  return new File([makePdf(imgs, texts)], pdfFileName(t, new Date()), { type: 'application/pdf' });
}

/** @param {boolean} download force a download instead of the share sheet */
export async function share(download) {
  const st = $('#out-status');
  try {
    const file = await buildPdfFile(), kb = Math.round(file.size / 1024);
    if (!download && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: t('share.sheet_title') });
      st.className = 'status ok'; st.textContent = t('share.shared', { kb });
    } else {
      downloadBlob(file, file.name);
      st.className = 'status ok'; st.textContent = t('share.downloaded', { kb });
    }
  } catch (e) {
    if (/** @type {Error} */ (e).name === 'AbortError') return; // user closed the share sheet
    st.className = 'status warn'; st.textContent = t('share.error', { msg: /** @type {Error} */ (e).message });
  }
}

export function initShare() {
  // The main action lives in the bottom bar; here only "Download" stays, as an alternative when sharing is possible.
  $('#btn-share').classList.add('hidden');
  $('#btn-dl').addEventListener('click', () => share(true));
  if (!CAN_SHARE) $('#btn-dl').classList.add('hidden');
}
