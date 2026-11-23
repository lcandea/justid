// @ts-check
// Dev tool: mark the true card corners of real photos for the detector benchmark.
// Writes tests/private/photos.js (git-ignored): export default [{ file, corners }], corners as
// fractions of the image width/height (TL, TR, BR, BL; any rotation), so any resolution works.
import { CropEditor } from '../app/js/ui/crop-editor.js';
import { loadImageFile } from '../app/js/ui/image-file.js';
import { detectionRefs } from '../app/js/ui/samples.js';
import { officialTemplates } from '../app/js/core/templates.js';
import { downloadBlob } from '../app/js/ui/dom.js';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
/** @type {File[]} */ let files = [];
let idx = 0;
/** @type {CropEditor | null} */ let editor = null;
/** @type {Map<string, number[][] | null>} file → corners (fractions), null = skipped */
const marks = new Map();
const refs = await detectionRefs(officialTemplates());

function status() {
  const done = [...marks.values()].filter(Boolean).length;
  $('#status').textContent = files.length ? `${idx + 1} / ${files.length} · ${files[idx].name} · marked ${done}` : '';
}

async function show() {
  if (!files.length) return;
  const src = await loadImageFile(files[idx], 'cannot read');
  editor?.destroy();
  editor = new CropEditor(/** @type {HTMLCanvasElement} */ ($('#crop')), src, { topLabel: 'TOP' });
  const prev = marks.get(files[idx].name);
  if (prev) editor.setQuad(prev.map(([u, v]) => [u * src.width, v * src.height]));
  else $('#note').textContent = editor.autoDetect(refs) ? 'Auto-detected: check every corner.' : 'Not detected: place the corners by hand.';
  status();
}

$('#files').addEventListener('change', e => {
  files = [...(/** @type {HTMLInputElement} */ (e.target).files || [])].sort((a, b) => a.name.localeCompare(b.name));
  idx = 0; show();
});
$('#prev').addEventListener('click', () => { if (idx > 0) { idx--; show(); } });
$('#det').addEventListener('click', () => { editor?.autoDetect(refs); });
$('#skip').addEventListener('click', () => { if (!files.length) return; marks.set(files[idx].name, null); if (idx < files.length - 1) { idx++; show(); } else status(); });
$('#next').addEventListener('click', () => {
  if (!editor || !files.length) return;
  const { width: w, height: h } = editor.src;
  marks.set(files[idx].name, editor.getQuad().map(([x, y]) => [+(x / w).toFixed(5), +(y / h).toFixed(5)]));
  if (idx < files.length - 1) { idx++; show(); } else { status(); $('#note').textContent = 'All done: download photos.js.'; }
});
$('#save').addEventListener('click', () => {
  const list = [...marks].filter(([, c]) => c).map(([file, corners]) => ({ file, corners }));
  const text = '// Ground truth for the detector benchmark (tools/mark-corners.html). Git-ignored with the photos.\n' +
    `export default ${JSON.stringify(list, null, 1)};\n`;
  downloadBlob(new Blob([text], { type: 'text/javascript' }), 'photos.js');
});
