'use strict';

const M = {
  tpl: null, images: { front: null, back: null }, side: 'front',
  userImage: { front: false, back: false }, // true once the user loaded their own picture for that side
  active: -1, sel: null, drag: null, cropSrc: null, editor: null,
};
const board = $('#board');

/* ---------- plantilla ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'campo';
function allTemplates() {
  // las de la carpeta js/templates/ mandan sobre las guardadas en el navegador con el mismo id
  const ids = new Set(window.DOC_TEMPLATES.map(t => t.id));
  return [...window.DOC_TEMPLATES, ...loadCustomTemplates().filter(t => !ids.has(t.id))];
}
function fillSelect(id) {
  const list = allTemplates();
  $('#tpl').replaceChildren(...list.map(t => el('option', { value: t.id }, t.name)));
  if (id) $('#tpl').value = id;
}
function setTpl(t) {
  M.tpl = clone(t); M.active = M.tpl.fields.length ? 0 : -1; M.sel = null;
  $('#tpl-name').value = M.tpl.name; $('#tpl-id').value = M.tpl.id;
  refresh();
  loadSampleImages();
}

// Default background: the template's normalised reference pictures (same 1012x638 frame
// as a straightened photo), unless the user already loaded their own picture for that side.
let sampleRun = 0;
async function loadSampleImages() {
  const run = ++sampleRun, sample = M.tpl.sample || {};
  for (const side of ['front', 'back']) {
    if (M.userImage[side]) continue;
    const img = sample[side] ? await loadSampleImage(sample[side]) : null;
    if (run !== sampleRun || M.userImage[side]) return;
    M.images[side] = img;
  }
  draw();
}
function refresh() { renderFields(); draw(); $('#json').value = JSON.stringify(M.tpl, null, 2); }

function renderFields() {
  $('#fields').replaceChildren(...M.tpl.fields.map((f, i) => {
    const label = el('input', { type: 'text', value: f.label });
    label.addEventListener('input', () => { f.label = label.value; draw(); $('#json').value = JSON.stringify(M.tpl, null, 2); });
    const idIn = el('input', { type: 'text', value: f.id, style: 'width:140px;font-size:12px' });
    idIn.addEventListener('change', () => { f.id = slug(idIn.value); idIn.value = f.id; refresh(); });
    const hide = el('input', { type: 'checkbox', checked: f.hide });
    hide.addEventListener('change', () => { f.hide = hide.checked; refresh(); });
    const del = el('button', { title: 'Borrar campo' }, '✕');
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`¿Borrar el campo «${f.label}» y sus ${f.zones.length} zonas?`)) return;
      M.tpl.fields.splice(i, 1); M.active = Math.min(M.active, M.tpl.fields.length - 1); M.sel = null; refresh();
    });
    const nf = f.zones.filter(z => z.side === 'front').length, nb = f.zones.length - nf;
    const row = el('div', { class: 'field-row' + (i === M.active ? ' active' : '') },
      el('span', { class: 'sw', style: `background:${fieldColor(f.id)}` }), label, del,
      el('div', { class: 'meta' }, idIn, el('label', { class: 'chk', style: 'padding:0' }, hide, 'ocultar por defecto'),
        el('span', {}, `A:${nf} R:${nb}`)));
    row.addEventListener('click', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') { if (M.active !== i) { M.active = i; row.parentElement.querySelectorAll('.field-row').forEach((r, j) => r.classList.toggle('active', j === i)); } return; } M.active = i; M.sel = null; refresh(); });
    return row;
  }));
}

/* ---------- lienzo ---------- */
function boardSize() {
  const img = M.images[M.side];
  const w = board.parentElement.clientWidth;
  const aspect = img ? img.width / img.height : CARD_W / CARD_H;
  return [w, w / aspect];
}
function draw() {
  const [w, h] = boardSize(), dpr = window.devicePixelRatio || 1;
  board.style.height = h + 'px';
  board.width = Math.round(w * dpr); board.height = Math.round(h * dpr);
  const ctx = board.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const img = M.images[M.side];
  if (img) ctx.drawImage(img, 0, 0, w, h);
  else {
    ctx.fillStyle = '#c9ced6'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6b7280'; ctx.font = '600 16px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`${M.side === 'front' ? 'Anverso' : 'Reverso'} — carga una imagen`, w / 2, h / 2);
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
    ctx.font = '600 11px system-ui'; const tw = ctx.measureText(f.label).width;
    ctx.fillStyle = c; ctx.fillRect(x, y - 15 < 0 ? y : y - 15, tw + 8, 15);
    ctx.fillStyle = '#000'; ctx.fillText(f.label, x + 4, (y - 15 < 0 ? y : y - 15) + 11);
    if (sel) { ctx.fillStyle = '#fff'; ctx.fillRect(x + zw - 7, y + zh - 7, 14, 14); ctx.strokeRect(x + zw - 7, y + zh - 7, 14, 14); }
  }));
}
function npt(e) {
  const r = board.getBoundingClientRect();
  return [Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1), Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)];
}
function hit(p) {
  const r = board.getBoundingClientRect();
  if (M.sel) { // asa de redimensionado
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
    if (z.w < 0.01 || z.h < 0.01) { zs.splice(M.sel.z, 1); M.sel = null; }
  }
  if (M.sel) { const z = M.tpl.fields[M.sel.f].zones[M.sel.z]; for (const k of ['x', 'y', 'w', 'h']) z[k] = +z[k].toFixed(4); }
  M.drag = null; refresh();
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', e => {
  if (!M.sel || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    M.tpl.fields[M.sel.f].zones.splice(M.sel.z, 1); M.sel = null; refresh(); e.preventDefault();
  }
});
window.addEventListener('resize', draw);

/* ---------- imagen + encuadre ---------- */
$('#img-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  M.cropSrc = await loadImageFile(f);
  $('#board-wrap').classList.add('hidden');
  $('#crop-wrap').classList.remove('hidden'); $('#crop-bar').classList.remove('hidden');
  M.editor?.destroy(); M.editor = new CropEditor($('#crop'), M.cropSrc);
  M.editor.autoDetect();
});
function closeCrop() {
  M.editor?.destroy(); M.editor = null;
  $('#crop-wrap').classList.add('hidden'); $('#crop-bar').classList.add('hidden');
  $('#board-wrap').classList.remove('hidden');
}
$('#crop-use').addEventListener('click', () => { M.images[M.side] = warpToCard(M.cropSrc, M.editor.getQuad()); M.userImage[M.side] = true; closeCrop(); draw(); });
$('#crop-rot').addEventListener('click', () => M.editor.rotate());
$('#crop-full').addEventListener('click', () => M.editor.full());

/* ---------- controles ---------- */
$('#side').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('#side').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  M.side = b.dataset.v; M.sel = null; draw();
});
$('#tpl').addEventListener('change', e => setTpl(allTemplates().find(t => t.id === e.target.value)));
$('#tpl-new').addEventListener('click', () => setTpl({ id: 'nueva_plantilla', name: 'Nueva plantilla', fields: [] }));
$('#tpl-name').addEventListener('input', e => { M.tpl.name = e.target.value; $('#json').value = JSON.stringify(M.tpl, null, 2); });
$('#tpl-id').addEventListener('change', e => { M.tpl.id = slug(e.target.value); e.target.value = M.tpl.id; refresh(); });
$('#tpl-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { setTpl(JSON.parse(await f.text())); } catch (err) { status('No se pudo importar: ' + err.message, true); }
});
$('#field-add').addEventListener('click', () => {
  const name = prompt('Nombre del campo', 'Nuevo campo'); if (!name) return;
  let id = slug(name); while (M.tpl.fields.some(f => f.id === id)) id += '_2';
  M.tpl.fields.push({ id, label: name, hide: true, zones: [] });
  M.active = M.tpl.fields.length - 1; M.sel = null; refresh();
});
$('#json-apply').addEventListener('click', () => {
  try { const t = JSON.parse($('#json').value); if (!Array.isArray(t.fields)) throw new Error('falta "fields"'); M.tpl = t; M.sel = null; $('#tpl-name').value = t.name; $('#tpl-id').value = t.id; refresh(); status('JSON aplicado.'); }
  catch (err) { status('JSON no válido: ' + err.message, true); }
});
function status(msg, warn) { const s = $('#exp-status'); s.className = 'status ' + (warn ? 'warn' : 'ok'); s.textContent = msg; }
$('#exp-save').addEventListener('click', () => {
  if (window.DOC_TEMPLATES.some(t => t.id === M.tpl.id)) { M.tpl.id += '_mia'; $('#tpl-id').value = M.tpl.id; }
  if (saveCustomTemplate(clone(M.tpl))) { fillSelect(M.tpl.id); refresh(); status('Guardada. Ya aparece en la app (mismo navegador).'); }
  else status('Este navegador no permite guardar; usa Descargar.', true);
});
$('#exp-dl').addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(M.tpl, null, 2)], { type: 'application/json' }), M.tpl.id + '.json'));
$('#exp-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(M.tpl, null, 2)); status('Copiado.'); } catch { status('No se pudo copiar.', true); }
});

fillSelect();
setTpl(allTemplates()[0]);
