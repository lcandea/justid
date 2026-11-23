'use strict';

const SIDES = { front: 'Anverso', back: 'Reverso' };
const CHIPS = ['Alquiler de vivienda', 'Apertura de cuenta', 'Hotel / alojamiento', 'Alta en gimnasio', 'Proceso de selección', 'Trámite administrativo'];
const STEPS = 4;
const CAN_SHARE = !!navigator.canShare; // solo en HTTPS/localhost y navegadores compatibles
const state = {
  templates: [], template: null, hidden: new Set(),
  src: { front: null, back: null },   // foto original (canvas)
  base: { front: null, back: null },  // tarjeta enderezada sin procesar
  canvas: { front: el('canvas', { class: 'preview' }), back: el('canvas', { class: 'preview' }) }, // salida procesada
  mode: 'pixel', bw: false, step: 0, pvSide: 'front',
};
const zonesCanvas = el('canvas', { class: 'zones' });
const ICON_CAM = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';
const svg = html => { const s = el('span'); s.innerHTML = html; return s.firstChild; };
const sides = () => ['front', 'back'].filter(s => state.base[s]);

/* ---------- plantillas ---------- */
function allTemplates() {
  // las de la carpeta js/templates/ mandan sobre las guardadas en el navegador con el mismo id
  const ids = new Set(window.DOC_TEMPLATES.map(t => t.id));
  return [...window.DOC_TEMPLATES, ...loadCustomTemplates().filter(t => !ids.has(t.id))];
}
function fillTemplateSelect(selectId) {
  state.templates = allTemplates();
  const sel = $('#tpl');
  sel.replaceChildren(...state.templates.map(t => el('option', { value: t.id }, t.name)));
  if (selectId) sel.value = selectId;
  setTemplate(state.templates.find(t => t.id === sel.value) || state.templates[0]);
}
function setTemplate(t, { auto = false } = {}) {
  state.template = t;
  state.hidden = new Set(t.fields.filter(f => f.hide).map(f => f.id));
  $('#tpl-name').textContent = t.name;
  $('#tpl-auto').classList.toggle('hidden', !auto);
  renderTemplatePreview(t);
  renderSlot('front'); renderSlot('back'); // empty slots show the template's sample as a hint
  renderTplWarning();
  $('#tpl-note').textContent = /borrador/i.test(t.id + t.name)
    ? 'Plantilla aproximada: ajusta las zonas con el marcador antes de usarla en serio.' : '';
  renderFields(); renderAll();
}

// Reference pictures of the selected template (normalised, transparent corners).
function renderTemplatePreview(t) {
  const box = $('#tpl-pv');
  const items = ['front', 'back'].filter(s => t.sample?.[s]).map(s =>
    el('figure', {}, el('img', { src: t.sample[s], alt: `${t.name} — ${SIDES[s].toLowerCase()}`, loading: 'lazy', decoding: 'async' }),
      el('figcaption', {}, SIDES[s])));
  box.replaceChildren(...items);
  box.classList.toggle('hidden', !items.length);
}

// Guess the document type from the straightened photos. Always runs; the guess is only
// trusted when it's clearly better than the rest (r.confident).
//  - no manual choice yet -> switch to the guessed template silently (+ "detectado" badge)
//  - manual choice differs -> keep it, but show a mismatch warning with a one-tap fix
let identifyRun = 0;
async function autoIdentify() {
  if (typeof identifyDocument !== 'function') return;
  const run = ++identifyRun;
  const r = sides().length ? await identifyDocument(state.base, state.templates) : null;
  if (run !== identifyRun) return;
  if (r) console.debug('[identify]', r.ranking.map(x => `${x.template.id}=${x.score.toFixed(3)}`).join(' '), r.confident ? 'confident' : 'unsure');
  state.idGuess = r?.confident ? r.template : null;
  if (state.idGuess && !state.tplManual) {
    if (state.idGuess !== state.template) { $('#tpl').value = state.idGuess.id; setTemplate(state.idGuess, { auto: true }); return; }
    $('#tpl-auto').classList.remove('hidden');
  }
  renderTplWarning();
}

function renderTplWarning() {
  const g = state.idGuess, box = $('#tpl-warn');
  const show = !!g && g !== state.template && state.idDismissed !== g.id && state.step <= 1;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const fix = el('button', { class: 'primary' }, `Cambiar a ${g.name}`);
  fix.addEventListener('click', () => { $('#tpl').value = g.id; state.tplManual = true; setTemplate(g, { auto: true }); });
  const keep = el('button', {}, 'Mantener');
  keep.addEventListener('click', () => { state.idDismissed = g.id; renderTplWarning(); });
  box.replaceChildren(
    el('p', {}, el('strong', {}, '¿Es la versión correcta? '),
      `Tu documento parece un ${g.name}, pero has elegido ${state.template.name}. Las zonas a ocultar no coincidirán.`),
    el('div', { class: 'row' }, fix, keep));
}

/* ---------- paso 1: huecos de foto ---------- */
function fileInput(capture, onFile) {
  const i = el('input', { type: 'file', accept: 'image/*', capture: capture ? 'environment' : false });
  i.addEventListener('change', () => { const f = i.files[0]; i.value = ''; if (f) onFile(f); });
  return i;
}
async function takeFile(side, file) {
  try { state.src[side] = await loadImageFile(file); } catch (e) { alert(e.message); return; }
  openCrop(side);
}
function renderSlot(side) {
  const box = $('#slot-' + side), base = state.base[side];
  if (!base) {
    const sample = state.template?.sample?.[side];
    box.replaceChildren(
      el('label', { class: 'empty' + (sample ? ' has-sample' : '') },
        sample ? el('img', { class: 'ghost', src: sample, alt: '', 'aria-hidden': 'true', decoding: 'async' }) : null,
        svg(ICON_CAM), el('strong', {}, SIDES[side]),
        el('span', {}, side === 'front' ? 'Toca para hacer la foto' : 'Opcional · toca para hacer la foto'),
        fileInput(true, f => takeFile(side, f))),
      el('label', { class: 'gal' }, 'o elegir de la galería', fileInput(false, f => takeFile(side, f))));
    return;
  }
  base.classList.add('thumb');
  const adjust = el('button', {}, 'Ajustar'); adjust.addEventListener('click', () => openCrop(side));
  const remove = el('button', {}, 'Quitar');
  remove.addEventListener('click', () => {
    state.base[side] = state.src[side] = null;
    if (state.pvSide === side) state.pvSide = sides()[0] || 'front';
    renderSlot(side); renderAll(); updateNav();
    autoIdentify(); // re-evaluate with the remaining photo (clears the warning if none left)
  });
  box.replaceChildren(base, el('div', { class: 'bar' }, el('span', { class: 't' }, '✓ ' + SIDES[side]),
    el('div', { class: 'row' }, adjust,
      el('label', { class: 'btn file-btn' }, 'Repetir', fileInput(true, f => takeFile(side, f))), remove)));
}

/* ---------- encuadre a pantalla completa ---------- */
const crop = { side: null, editor: null };
function openCrop(side) {
  crop.side = side;
  $('#crop-ov').classList.remove('hidden'); document.body.classList.add('no-scroll');
  $('#crop-title').textContent = 'Encuadra el ' + SIDES[side].toLowerCase();
  crop.editor?.destroy();
  crop.editor = new CropEditor($('#crop-canvas'), state.src[side], { fitParent: true });
  if (state.base[side] && crop.lastQuad?.[side]) { crop.editor.setQuad(crop.lastQuad[side]); setCropMsg(null); }
  else cropDetect();
  history.pushState({ step: state.step, crop: true }, '');
}
function setCropMsg(found) {
  $('#crop-msg').textContent = found === null ? 'Arrastra las esquinas si hace falta. La línea amarilla es el borde superior.'
    : found ? 'Tarjeta detectada. Revisa las esquinas; la línea amarilla es el borde superior.'
      : 'No la he encontrado: arrastra las 4 esquinas. Ayuda un fondo liso que contraste.';
}
function cropDetect() { if (crop.editor) setCropMsg(crop.editor.autoDetect()); }
function closeCropUI() {
  crop.editor?.destroy(); crop.editor = null;
  $('#crop-ov').classList.add('hidden'); document.body.classList.remove('no-scroll');
}
function leaveCrop() { if (history.state?.crop) history.back(); else closeCropUI(); }
$('#crop-cancel').addEventListener('click', leaveCrop);
$('#crop-rot').addEventListener('click', () => crop.editor?.rotate());
$('#crop-det').addEventListener('click', cropDetect);
$('#crop-full').addEventListener('click', () => { if (!crop.editor) return; crop.editor.full(); setCropMsg(null); });
$('#crop-use').addEventListener('click', () => {
  if (!crop.editor) return;
  const side = crop.side, q = crop.editor.getQuad();
  (crop.lastQuad ||= {})[side] = q;
  state.base[side] = warpToCard(state.src[side], q);
  if (!state.base[state.pvSide]) state.pvSide = side;
  leaveCrop();
  renderSlot(side); renderAll(); updateNav();
  autoIdentify();
  if (side === 'front' && !state.base.back) setTimeout(() => $('#slot-back').scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
});

/* ---------- paso 2: campos ---------- */
function renderFields() {
  const groups = { front: [], back: [] };
  for (const f of state.template.fields) groups[f.zones[0]?.side || 'front'].push(f);
  const box = $('#fields'); box.replaceChildren();
  for (const side of ['front', 'back']) {
    if (!groups[side].length) continue;
    box.append(el('h3', {}, SIDES[side]));
    for (const f of groups[side]) {
      const cb = el('input', { type: 'checkbox', checked: state.hidden.has(f.id), 'aria-label': 'Ocultar ' + f.label });
      cb.addEventListener('change', () => setHidden(f.id, cb.checked));
      const also = f.zones.some(z => z.side !== side) ? ' · también en el ' + SIDES[side === 'front' ? 'back' : 'front'].toLowerCase() : '';
      const row = el('label', { class: 'fld', 'data-f': f.id },
        el('span', { class: 'nm' }, f.label,
          el('small', { class: f.hide ? '' : 'ok' }, (f.hide ? 'Se recomienda ocultar' : 'Normalmente se muestra') + also)),
        el('span', { class: 'switch' }, cb, el('i')));
      box.append(row);
    }
  }
}
function setHidden(id, on) {
  on ? state.hidden.add(id) : state.hidden.delete(id);
  const cb = $(`.fld[data-f="${id}"] input`); if (cb) cb.checked = on;
  renderAll();
}
function drawZones() {
  const side = state.pvSide, cv = state.canvas[side];
  if (!cv.isConnected || !zonesCanvas.isConnected) return;
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  zonesCanvas.width = Math.round(w * dpr); zonesCanvas.height = Math.round(h * dpr);
  const ctx = zonesCanvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const f of state.template.fields) for (const z of f.zones) {
    if (z.side !== side) continue;
    const hid = state.hidden.has(f.id);
    ctx.setLineDash(hid ? [] : [5, 4]); ctx.lineWidth = hid ? 1.5 : 2;
    ctx.strokeStyle = hid ? 'rgba(255,255,255,.75)' : '#facc15';
    ctx.strokeRect(z.x * w + 1, z.y * h + 1, z.w * w - 2, z.h * h - 2);
  }
}
$('#pv-hide').addEventListener('click', e => {
  const cv = state.canvas[state.pvSide], r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  let best = null, bestA = Infinity;
  for (const f of state.template.fields) for (const z of f.zones) {
    if (z.side === state.pvSide && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h && z.w * z.h < bestA) { best = f; bestA = z.w * z.h; }
  }
  if (!best) return;
  setHidden(best.id, !state.hidden.has(best.id));
  navigator.vibrate?.(10);
  const row = $(`.fld[data-f="${best.id}"]`);
  if (row) { row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 700); }
});

/* ---------- procesado ---------- */
function toGray(ctx, W, H) {
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
}
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
function watermarkText() {
  const motivo = $('#motivo').value.trim(), dest = $('#dest').value.trim();
  if (!motivo) return '';
  return ['SOLO PARA: ' + motivo, dest, new Date().toLocaleDateString('es-ES')].filter(Boolean).join(' · ').toUpperCase();
}
function drawWatermark(ctx, W, H, text, bw) {
  const layer = (fs, deg, alpha, rgb, stroke) => {
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
function renderSide(side) {
  const base = state.base[side], cv = state.canvas[side];
  if (!base) return;
  const W = base.width, H = base.height;
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(base, 0, 0);
  if (state.bw) toGray(ctx, W, H);
  for (const f of state.template.fields) {
    if (!state.hidden.has(f.id)) continue;
    for (const z of f.zones) {
      if (z.side !== side) continue;
      const x = Math.max(0, Math.round(z.x * W)), y = Math.max(0, Math.round(z.y * H));
      const w = Math.min(W - x, Math.round(z.w * W)), h = Math.min(H - y, Math.round(z.h * H));
      if (w < 1 || h < 1) continue;
      if (state.mode === 'solid') { ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h); } else pixelate(ctx, x, y, w, h);
    }
  }
  const text = watermarkText();
  if (text) drawWatermark(ctx, W, H, text, state.bw);
}
let renderTimer = 0;
function renderAll() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => { renderSide('front'); renderSide('back'); drawZones(); updateSummary(); }, 50);
}

/* ---------- navegación por pasos ---------- */
function mountPreviews() {
  const s = state.step;
  if (s === 1) {
    if (!state.base[state.pvSide]) state.pvSide = sides()[0] || 'front';
    $('#pv-side').classList.toggle('hidden', sides().length < 2);
    $('#pv-side').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === state.pvSide));
    $('#pv-hide').replaceChildren(state.canvas[state.pvSide], zonesCanvas);
    requestAnimationFrame(drawZones);
  } else if (s === 2) {
    $('#pv-wm').replaceChildren(state.canvas[sides()[0]]);
  } else if (s === 3) {
    $('#pv-final').replaceChildren(...sides().map(sd => state.canvas[sd]));
    updateSummary();
  }
}
function canAdvance(s = state.step) {
  if (s === 0) return sides().length > 0;
  if (s === 2) return !!$('#motivo').value.trim();
  return true;
}
function goStep(n, push = true) {
  n = Math.max(0, Math.min(STEPS - 1, n));
  for (let i = 0; i < n; i++) if (!canAdvance(i)) { n = i; break; }
  state.step = n;
  document.querySelectorAll('.step').forEach(sec => sec.classList.toggle('hidden', +sec.dataset.step !== n));
  mountPreviews();
  updateNav();
  renderTplWarning();
  window.scrollTo(0, 0);
  if (push) history.pushState({ step: n }, '');
  if (n === 2 && !$('#motivo').value) setTimeout(() => $('#motivo').focus(), 100);
}
function updateNav() {
  const s = state.step;
  document.querySelectorAll('#steps li').forEach(li => {
    const i = +li.dataset.s;
    li.classList.toggle('cur', i === s);
    li.classList.toggle('done', i < s);
    li.classList.toggle('reach', i > s && [...Array(i).keys()].every(k => canAdvance(k)));
  });
  $('#nav-back').classList.toggle('invisible', s === 0);
  const next = $('#nav-next');
  const last = s === STEPS - 1;
  next.disabled = !canAdvance();
  next.textContent = last ? (CAN_SHARE ? 'Compartir PDF' : 'Descargar PDF')
    : s === 0 && !canAdvance() ? 'Haz al menos una foto' : s === 2 && !canAdvance() ? 'Escribe el motivo' : 'Siguiente';
}
function updateSummary() {
  if (state.step !== 3) return;
  const n = state.template.fields.filter(f => state.hidden.has(f.id) && f.zones.some(z => state.base[z.side])).length;
  const caras = sides().map(s => SIDES[s].toLowerCase()).join(' y ');
  $('#summary').textContent = `${caras[0].toUpperCase() + caras.slice(1)} · ${n} datos ocultos · marca: «${watermarkText()}»`;
}
$('#nav-next').addEventListener('click', () => state.step === STEPS - 1 ? share(!CAN_SHARE) : goStep(state.step + 1));
$('#nav-back').addEventListener('click', () => history.back());
$('#steps').addEventListener('click', e => { const li = e.target.closest('li.done, li.reach'); if (li) goStep(+li.dataset.s); });
window.addEventListener('popstate', e => {
  if (!$('#crop-ov').classList.contains('hidden')) { closeCropUI(); return; }
  goStep(e.state?.step ?? 0, false);
});
window.addEventListener('resize', () => requestAnimationFrame(drawZones));

/* ---------- salida ---------- */
async function buildPdfFile() {
  const imgs = [];
  for (const side of sides()) { const cv = state.canvas[side]; imgs.push({ jpeg: await canvasToJpeg(cv, 0.78), w: cv.width, h: cv.height }); }
  const dest = $('#dest').value.trim();
  const caption = [
    `Copia de documento de identidad con datos ocultados. Finalidad: ${$('#motivo').value.trim()}`,
    `${dest ? 'Destinatario: ' + dest + '. ' : ''}Fecha: ${new Date().toLocaleDateString('es-ES')}. No válida para otro fin.`,
  ];
  return new File([makePdf(imgs, caption)], `copia_documento_${new Date().toISOString().slice(0, 10)}.pdf`, { type: 'application/pdf' });
}
async function share(download) {
  const st = $('#out-status');
  try {
    const file = await buildPdfFile(), kb = Math.round(file.size / 1024);
    if (!download && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Copia del documento' });
      st.className = 'status ok'; st.textContent = `PDF compartido (${kb} KB).`;
    } else {
      downloadBlob(file, file.name);
      st.className = 'status ok'; st.textContent = `PDF descargado (${kb} KB).`;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    st.className = 'status warn'; st.textContent = 'Error: ' + e.message;
  }
}

/* ---------- init ---------- */
function seg(id, onPick) {
  const box = $('#' + id);
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.v);
  });
}
seg('mode', v => { state.mode = v; renderAll(); });
seg('color', v => { state.bw = v === 'bw'; renderAll(); });
seg('pv-side', v => { state.pvSide = v; mountPreviews(); });
$('#tpl').addEventListener('change', e => {
  state.tplManual = true; // a manual choice always wins over auto-identification
  setTemplate(state.templates.find(t => t.id === e.target.value));
});
$('#tpl-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const t = JSON.parse(await f.text());
    if (!t.id || !Array.isArray(t.fields)) throw new Error('Formato de plantilla no válido');
    saveCustomTemplate(t); fillTemplateSelect(t.id);
  } catch (err) { $('#tpl-note').textContent = 'No se pudo importar: ' + err.message; }
});
const chips = $('#chips');
CHIPS.forEach(c => {
  const b = el('button', { type: 'button' }, c);
  b.addEventListener('click', () => { $('#motivo').value = c; $('#motivo').dispatchEvent(new Event('input')); });
  chips.append(b);
});
$('#motivo').addEventListener('input', () => {
  const v = $('#motivo').value.trim();
  chips.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === v));
  renderAll(); updateNav();
});
$('#motivo').addEventListener('keydown', e => { if (e.key === 'Enter') $('#dest').focus(); });
$('#dest').addEventListener('input', renderAll);
$('#dest').addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); if (canAdvance()) goStep(3); } });
// La acción principal va en la barra inferior; aquí solo queda «Descargar» como alternativa cuando se puede compartir.
$('#btn-share').classList.add('hidden');
$('#btn-dl').addEventListener('click', () => share(true));
if (!CAN_SHARE) $('#btn-dl').classList.add('hidden');

renderSlot('front'); renderSlot('back');
fillTemplateSelect();
history.replaceState({ step: 0 }, '');
goStep(0, false);

/* ---------- privacy badge + dialog ---------- */
// Public repository URL. Leave empty until the repo is published; the dialog then says "coming soon".
const REPO_URL = '';
{
  const dlg = $('#privacy'), btn = $('#lock-btn');
  $('#privacy-repo').replaceChildren(REPO_URL
    ? el('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Ver el código fuente')
    : el('span', { class: 'muted' }, 'Muy pronto publicaremos aquí el enlace al repositorio.'));
  btn.addEventListener('click', () => {
    btn.classList.remove('wiggle'); // they found it: stop drawing attention to it
    dlg.showModal();
  });
  $('#privacy-close').addEventListener('click', () => dlg.close());
  // close when tapping the backdrop (click lands on the <dialog> element itself)
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  btn.classList.add('wiggle');
}
