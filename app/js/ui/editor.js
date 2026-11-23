// @ts-check
// Zone editor: draw where each field is on the card and export the template.
// Works on a flat copy of a template (ResolvedTemplate); exports either as
//   - flat JSON (self-contained, importable in the app), or
//   - a version module for the repository (templates/<id>.js), for official families.
import { $, $input, $select, $textarea, el, downloadBlob } from './dom.js';
import { t, applyI18n, mountLangSwitch } from './i18n.js';
import { loadImageFile } from './image-file.js';
import { warpToCard } from '../core/image.js';
import { CropEditor } from './crop-editor.js';
import { loadSampleImage } from './samples.js';
import { slug, fieldColor, toVersionModule } from '../core/templates.js';
import { allTemplates, templateName, fieldLabel, normalizeCustom, saveCustomTemplate, toFlatJson } from './templates.js';

/** @typedef {import('../core/templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {'front' | 'back'} Side */

const M = {
  /** @type {ResolvedTemplate} */ tpl: /** @type {any} */ (null),
  /** board background per side @type {Record<Side, CanvasImageSource & { width: number, height: number } | null>} */
  images: { front: null, back: null },
  /** true once the user loaded their own picture for that side @type {Record<Side, boolean>} */
  userImage: { front: false, back: false },
  /** @type {Side} */ side: 'front',
  active: -1,
  /** selected zone @type {{ f: number, z: number } | null} */ sel: null,
  /** @type {{ mode: 'draw' | 'move' | 'resize', p0: number[], z0?: any } | null} */ drag: null,
  /** @type {HTMLCanvasElement | null} */ cropSrc: null,
  /** @type {CropEditor | null} */ editor: null,
};
const board = /** @type {HTMLCanvasElement} */ ($('#board'));

/* ---------- template ---------- */
const clone = (/** @type {any} */ o) => JSON.parse(JSON.stringify(o));
const jsonText = () => JSON.stringify(toFlatJson(M.tpl), null, 2);

/** @param {string} [id] */
function fillSelect(id) {
  $('#tpl').replaceChildren(...allTemplates().map(x => el('option', { value: x.id }, templateName(x))));
  if (id) $select('#tpl').value = id;
}
/** @param {ResolvedTemplate} tpl */
function setTpl(tpl) {
  M.tpl = clone(tpl); M.active = M.tpl.fields.length ? 0 : -1; M.sel = null;
  $input('#tpl-name').value = templateName(M.tpl); $input('#tpl-id').value = M.tpl.id;
  refresh();
  loadSampleImages();
}
function refresh() { renderFields(); draw(); $textarea('#json').value = jsonText(); }

// Default background: the template's normalised reference pictures (same 1012×638 frame
// as a straightened photo), unless the user already loaded their own picture for that side.
let sampleRun = 0;
async function loadSampleImages() {
  const run = ++sampleRun, sample = M.tpl.sample || {};
  for (const side of /** @type {Side[]} */ (['front', 'back'])) {
    if (M.userImage[side]) continue;
    const path = sample[side];
    const img = path ? await loadSampleImage(path) : null;
    if (run !== sampleRun || M.userImage[side]) return; // template changed meanwhile
    M.images[side] = img;
  }
  draw();
}

function renderFields() {
  $('#fields').replaceChildren(...M.tpl.fields.map((f, i) => {
    // Official templates take labels from locales/*.js; only custom ones have editable labels.
    const label = el('input', { type: 'text', value: fieldLabel(f), disabled: !M.tpl.custom });
    label.addEventListener('input', () => { f.label = label.value; draw(); $textarea('#json').value = jsonText(); });
    const idIn = el('input', { type: 'text', value: f.id, style: 'width:140px;font-size:12px' });
    idIn.addEventListener('change', () => { f.id = slug(idIn.value); idIn.value = f.id; refresh(); });
    const hide = el('input', { type: 'checkbox', checked: f.hide });
    hide.addEventListener('change', () => { f.hide = hide.checked; refresh(); });
    const del = el('button', { type: 'button', title: t('editor.field_delete') }, '✕');
    del.addEventListener('click', (/** @type {Event} */ e) => {
      e.stopPropagation();
      if (!confirm(t('editor.field_delete_confirm', { field: fieldLabel(f), count: f.zones.length }))) return;
      M.tpl.fields.splice(i, 1); M.active = Math.min(M.active, M.tpl.fields.length - 1); M.sel = null; refresh();
    });
    const nf = f.zones.filter(z => z.side === 'front').length, nb = f.zones.length - nf;
    const row = el('div', { class: 'field-row' + (i === M.active ? ' active' : '') },
      el('span', { class: 'sw', style: `background:${fieldColor(f.id)}` }), label, del,
      el('div', { class: 'meta' }, idIn, el('label', { class: 'chk', style: 'padding:0' }, hide, t('editor.hide_default')),
        el('span', {}, `${t('side.front')[0]}:${nf} ${t('side.back')[0]}:${nb}`)));
    row.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') {
        // typing in a field row also makes it active, without re-rendering (keeps focus)
        if (M.active !== i) { M.active = i; row.parentElement.querySelectorAll('.field-row').forEach((r, j) => r.classList.toggle('active', j === i)); }
        return;
      }
      M.active = i; M.sel = null; refresh();
    });
    return row;
  }));
}

/* ---------- board ---------- */
function boardSize() {
  const img = M.images[M.side];
  const w = /** @type {HTMLElement} */ (board.parentElement).clientWidth;
  const aspect = img ? img.width / img.height : 1012 / 638;
  return [w, w / aspect];
}
function draw() {
  const [w, h] = boardSize(), dpr = window.devicePixelRatio || 1;
  board.style.height = h + 'px';
  board.width = Math.round(w * dpr); board.height = Math.round(h * dpr);
  const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const img = M.images[M.side];
  if (img) ctx.drawImage(img, 0, 0, w, h);
  else {
    ctx.fillStyle = '#c9ced6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6b7280'; ctx.font = '600 16px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(t('editor.board_empty', { side: t('side.' + M.side) }), w / 2, h / 2);
    ctx.textAlign = 'left';
  }
  M.tpl.fields.forEach((f, fi) => f.zones.forEach((z, zi) => {
    if (z.side !== M.side) return;
    const c = fieldColor(f.id), sel = M.sel && M.sel.f === fi && M.sel.z === zi;
    const x = z.x * w, y = z.y * h, zw = z.w * w, zh = z.h * h;
    ctx.fillStyle = c.replace('hsl(', 'hsla(').replace(')', sel ? ' / .35)' : ' / .18)');
    ctx.fillRect(x, y, zw, zh);
    ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = c;
    ctx.setLineDash(f.hide ? [] : [6, 4]); ctx.strokeRect(x, y, zw, zh); ctx.setLineDash([]);
    const label = fieldLabel(f);
    ctx.font = '600 11px system-ui'; const tw = ctx.measureText(label).width;
    ctx.fillStyle = c; ctx.fillRect(x, y - 15 < 0 ? y : y - 15, tw + 8, 15);
    ctx.fillStyle = '#000'; ctx.fillText(label, x + 4, (y - 15 < 0 ? y : y - 15) + 11);
    if (sel) { ctx.fillStyle = '#fff'; ctx.fillRect(x + zw - 7, y + zh - 7, 14, 14); ctx.strokeRect(x + zw - 7, y + zh - 7, 14, 14); }
  }));
}
/** Pointer position as card fractions (0-1). @param {PointerEvent} e */
function npt(e) {
  const r = board.getBoundingClientRect();
  return [Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)];
}
/** @param {number[]} p @returns {{ f: number, z: number, resize?: boolean } | null} */
function hit(p) {
  const r = board.getBoundingClientRect();
  if (M.sel) { // resize handle
    const z = M.tpl.fields[M.sel.f].zones[M.sel.z];
    if (Math.abs((z.x + z.w - p[0]) * r.width) < 12 && Math.abs((z.y + z.h - p[1]) * r.height) < 12) return { ...M.sel, resize: true };
  }
  for (let fi = M.tpl.fields.length - 1; fi >= 0; fi--) {
    const zs = M.tpl.fields[fi].zones;
    for (let zi = zs.length - 1; zi >= 0; zi--) {
      const z = zs[zi];
      if (z.side === M.side && p[0] >= z.x && p[0] <= z.x + z.w && p[1] >= z.y && p[1] <= z.y + z.h) return { f: fi, z: zi };
    }
  }
  return null;
}
board.addEventListener('pointerdown', e => {
  const p = npt(e), h = hit(p);
  board.setPointerCapture(e.pointerId);
  if (h) {
    M.sel = { f: h.f, z: h.z };
    const z = M.tpl.fields[h.f].zones[h.z];
    M.drag = { mode: h.resize ? 'resize' : 'move', p0: p, z0: { ...z } };
    if (M.active !== h.f) { M.active = h.f; renderFields(); }
  } else if (M.active >= 0) {
    const f = M.tpl.fields[M.active];
    f.zones.push({ side: M.side, x: p[0], y: p[1], w: 0, h: 0 });
    M.sel = { f: M.active, z: f.zones.length - 1 };
    M.drag = { mode: 'draw', p0: p };
  } else { M.sel = null; }
  draw();
});
board.addEventListener('pointermove', e => {
  if (!M.drag || !M.sel) return;
  const p = npt(e), z = M.tpl.fields[M.sel.f].zones[M.sel.z], d = M.drag;
  if (d.mode === 'draw') {
    z.x = Math.min(d.p0[0], p[0]); z.y = Math.min(d.p0[1], p[1]);
    z.w = Math.abs(p[0] - d.p0[0]); z.h = Math.abs(p[1] - d.p0[1]);
  } else if (d.mode === 'move') {
    z.x = Math.min(Math.max(d.z0.x + p[0] - d.p0[0], 0), 1 - z.w);
    z.y = Math.min(Math.max(d.z0.y + p[1] - d.p0[1], 0), 1 - z.h);
  } else {
    z.w = Math.max(0.01, d.z0.w + p[0] - d.p0[0]); z.h = Math.max(0.01, d.z0.h + p[1] - d.p0[1]);
  }
  draw();
});
function endDrag() {
  if (!M.drag) return;
  if (M.drag.mode === 'draw' && M.sel) {
    const zs = M.tpl.fields[M.sel.f].zones, z = zs[M.sel.z];
    if (z.w < 0.01 || z.h < 0.01) { zs.splice(M.sel.z, 1); M.sel = null; } // a click, not a drag
  }
  if (M.sel) { const z = M.tpl.fields[M.sel.f].zones[M.sel.z]; for (const k of /** @type {const} */ (['x', 'y', 'w', 'h'])) z[k] = +z[k].toFixed(4); }
  M.drag = null; refresh();
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', e => {
  const active = /** @type {HTMLElement | null} */ (document.activeElement);
  if (!M.sel || (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    M.tpl.fields[M.sel.f].zones.splice(M.sel.z, 1); M.sel = null; refresh(); e.preventDefault();
  }
});
window.addEventListener('resize', draw);

/* ---------- own picture + framing ---------- */
$('#img-file').addEventListener('change', async e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const f = input.files?.[0]; input.value = '';
  if (!f) return;
  try { M.cropSrc = await loadImageFile(f, t('photos.read_error')); } catch (err) { status(/** @type {Error} */ (err).message, true); return; }
  $('#board-wrap').classList.add('hidden');
  $('#crop-wrap').classList.remove('hidden'); $('#crop-bar').classList.remove('hidden');
  M.editor?.destroy(); M.editor = new CropEditor($('#crop'), M.cropSrc, { topLabel: t('crop.top_label') });
  M.editor.autoDetect();
});
function closeCrop() {
  M.editor?.destroy(); M.editor = null;
  $('#crop-wrap').classList.add('hidden'); $('#crop-bar').classList.add('hidden');
  $('#board-wrap').classList.remove('hidden');
}
$('#crop-use').addEventListener('click', () => {
  if (!M.editor || !M.cropSrc) return;
  M.images[M.side] = warpToCard(M.cropSrc, M.editor.getQuad()); M.userImage[M.side] = true; closeCrop(); draw();
});
$('#crop-rot').addEventListener('click', () => M.editor?.rotate());
$('#crop-full').addEventListener('click', () => M.editor?.full());

/* ---------- controls ---------- */
$('#side').addEventListener('click', e => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button')); if (!b) return;
  $('#side').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  M.side = /** @type {Side} */ (b.dataset.v); M.sel = null; draw();
});
$('#tpl').addEventListener('change', e => {
  const id = /** @type {HTMLSelectElement} */ (e.target).value;
  setTpl(/** @type {ResolvedTemplate} */ (allTemplates().find(x => x.id === id)));
});
$('#tpl-new').addEventListener('click', () => setTpl({ id: 'new_template', name: t('editor.new_template_name'), custom: true, fields: [] }));
$('#tpl-name').addEventListener('input', e => { M.tpl.name = /** @type {HTMLInputElement} */ (e.target).value; $textarea('#json').value = jsonText(); });
$('#tpl-id').addEventListener('change', e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  M.tpl.id = slug(input.value); input.value = M.tpl.id; refresh();
});
$('#tpl-file').addEventListener('change', async e => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const f = input.files?.[0]; input.value = '';
  if (!f) return;
  try { setTpl(normalizeCustom(JSON.parse(await f.text()))); } catch (err) { status(t('tpl.import_error', { msg: /** @type {Error} */ (err).message }), true); }
});
$('#field-add').addEventListener('click', () => {
  const name = prompt(t('editor.field_prompt'), t('editor.field_default_name')); if (!name) return;
  let id = slug(name); while (M.tpl.fields.some(f => f.id === id)) id += '_2';
  M.tpl.fields.push({ id, label: name, hide: true, zones: [] });
  M.active = M.tpl.fields.length - 1; M.sel = null; refresh();
});
$('#json-apply').addEventListener('click', () => {
  try {
    const raw = JSON.parse($textarea('#json').value);
    if (!Array.isArray(raw.fields)) throw new Error(t('editor.missing_fields'));
    // Edited JSON becomes a custom template (self-contained labels), keeping the family link if any.
    M.tpl = { ...normalizeCustom(raw), family: M.tpl.family, isDefault: M.tpl.isDefault };
    M.sel = null; $input('#tpl-name').value = templateName(M.tpl); $input('#tpl-id').value = M.tpl.id; refresh(); status(t('editor.json_applied'));
  } catch (err) { status(t('editor.json_invalid', { msg: /** @type {Error} */ (err).message }), true); }
});
/** @param {string} msg @param {boolean} [warn] */
function status(msg, warn) { const s = $('#exp-status'); s.className = 'status ' + (warn ? 'warn' : 'ok'); s.textContent = msg; }
$('#exp-save').addEventListener('click', () => {
  // official ids are reserved: saving a modified official template stores a personal copy
  if (!M.tpl.custom || allTemplates().some(x => !x.custom && x.id === M.tpl.id)) { M.tpl.id += '_mine'; $input('#tpl-id').value = M.tpl.id; }
  const tpl = { ...normalizeCustom(toFlatJson(M.tpl)) };
  if (saveCustomTemplate(tpl)) { M.tpl = clone(tpl); fillSelect(M.tpl.id); refresh(); status(t('editor.saved')); }
  else status(t('editor.save_failed'), true);
});
$('#exp-dl').addEventListener('click', () => downloadBlob(new Blob([jsonText()], { type: 'application/json' }), M.tpl.id + '.json'));
$('#exp-module').addEventListener('click', () => {
  try { downloadBlob(new Blob([toVersionModule(M.tpl)], { type: 'text/javascript' }), M.tpl.id + '.js'); }
  catch (err) { status(/** @type {Error} */ (err).message, true); }
});
$('#exp-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(jsonText()); status(t('editor.copied')); } catch { status(t('editor.copy_failed'), true); }
});
window.addEventListener('langchange', () => {
  const id = M.tpl.id; fillSelect(id);
  if (!M.tpl.custom) $input('#tpl-name').value = templateName(M.tpl);
  refresh();
});

applyI18n();
mountLangSwitch($('#lang'));
fillSelect();
setTpl(allTemplates()[0]);
