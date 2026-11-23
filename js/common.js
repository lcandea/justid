'use strict';
// Utilidades compartidas: carga de imagen, enderezado por homografía y editor de esquinas.
// Todo se ejecuta en local; nada sale del navegador.

const CARD_W = 1012, CARD_H = 638; // ID-1 (85,6 × 54 mm) a ~300 ppp
const MAX_SRC_SIDE = 2400; // de sobra para recortar una tarjeta de 1012 px; 4000 puede agotar la memoria de Safari en iPhone

function $(sel, root = document) { return root.querySelector(sel); }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

// Carga un archivo de imagen respetando la orientación EXIF y lo devuelve como canvas
// (así además se descartan los metadatos de la foto).
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SRC_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}

function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// Homografía que lleva src[i] -> dst[i] (4 pares). Devuelve h0..h7 (h8 = 1).
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solveLinear(A, b);
}

// quad: 4 esquinas en la imagen origen, en orden sup-izq, sup-der, inf-der, inf-izq.
function warpToCard(src, quad, W = CARD_W, H = CARD_H) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const qw = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let s = src, q = quad;
  const f = Math.min(1, 1.5 * W / qw);
  if (f < 1) { // reducir antes para evitar aliasing
    s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(src.width * f));
    s.height = Math.max(1, Math.round(src.height * f));
    const sctx = s.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, s.width, s.height);
    q = quad.map(p => [p[0] * f, p[1] * f]);
  }
  const sw = s.width, sh = s.height;
  const d = s.getContext('2d').getImageData(0, 0, sw, sh).data;
  const h = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
  const out = new ImageData(W, H), o = out.data;
  for (let y = 0; y < H; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < W; x++) {
      const X = x + 0.5;
      const den = h[6] * X + h[7] * Y + 1;
      let sx = (h[0] * X + h[1] * Y + h[2]) / den - 0.5;
      let sy = (h[3] * X + h[4] * Y + h[5]) / den - 0.5;
      sx = Math.min(Math.max(sx, 0), sw - 1.001);
      sy = Math.min(Math.max(sy, 0), sh - 1.001);
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
        const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
        o[oi + c] = top + (bot - top) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.getContext('2d').putImageData(out, 0, 0);
  return c;
}

// Editor de 4 esquinas arrastrables (ratón y táctil).
class CropEditor {
  constructor(canvas, src, opts = {}) {
    this.c = canvas; this.src = src; this.drag = -1; this.opts = opts;
    const w = src.width, h = src.height, mx = w * 0.1, my = h * 0.1;
    this.quad = [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', () => { this.drag = -1; this.draw(); });
    canvas.addEventListener('pointercancel', () => { this.drag = -1; this.draw(); });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }
  destroy() { window.removeEventListener('resize', this._onResize); }
  resize() {
    const par = this.c.parentElement, fit = this.opts.fitParent;
    const maxW = (fit ? par.clientWidth - 16 : par.clientWidth) || 600;
    const maxH = fit ? par.clientHeight - 16 : window.innerHeight * 0.65;
    this.scale = Math.min(maxW / this.src.width, maxH / this.src.height);
    const dpr = window.devicePixelRatio || 1;
    const cw = this.src.width * this.scale, ch = this.src.height * this.scale;
    this.c.style.width = cw + 'px'; this.c.style.height = ch + 'px';
    this.c.width = Math.round(cw * dpr); this.c.height = Math.round(ch * dpr);
    this.k = this.scale * dpr;
    this.draw();
  }
  pt(e) {
    const r = this.c.getBoundingClientRect();
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
  }
  down(e) {
    const p = this.pt(e);
    let best = -1, bd = 36 / this.scale;
    this.quad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { this.drag = best; this.c.setPointerCapture(e.pointerId); e.preventDefault(); }
  }
  move(e) {
    if (this.drag < 0) return;
    const [x, y] = this.pt(e);
    this.quad[this.drag] = [Math.min(Math.max(x, 0), this.src.width), Math.min(Math.max(y, 0), this.src.height)];
    this.draw();
  }
  rotate() { this.quad.unshift(this.quad.pop()); this.draw(); }
  setQuad(q) { this.quad = q.map(p => [...p]); this.draw(); }
  // Intenta detectar la tarjeta; devuelve true si la encontró.
  autoDetect() {
    if (typeof detectCard !== 'function') return false;
    const r = detectCard(this.src);
    if (r) this.setQuad(r.quad);
    return !!r;
  }
  full() { const w = this.src.width, h = this.src.height; this.quad = [[0, 0], [w, 0], [w, h], [0, h]]; this.draw(); }
  getQuad() { return this.quad.map(p => [...p]); }
  draw() {
    const ctx = this.c.getContext('2d'), q = this.quad, u = 1 / this.scale;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.drawImage(this.src, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.rect(0, 0, this.src.width, this.src.height);
    ctx.moveTo(...q[0]); q.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath();
    ctx.fill('evenodd');
    ctx.lineWidth = 2 * u; ctx.strokeStyle = '#4ade80';
    ctx.beginPath(); ctx.moveTo(...q[0]); q.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.stroke();
    // borde superior destacado
    ctx.lineWidth = 5 * u; ctx.strokeStyle = '#facc15';
    ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.stroke();
    ctx.font = `600 ${13 * u}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
    ctx.fillStyle = '#facc15'; ctx.fillText('ARRIBA', mid[0], mid[1] - 14 * u);
    q.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 14 * u, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#facc15' : '#4ade80'; ctx.fill();
      ctx.lineWidth = 2 * u; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), p[0], p[1]);
    });
    if (this.drag >= 0) this.drawLoupe(ctx, u);
  }
  // Lupa: con el dedo encima no se ve la esquina; mostramos la zona ampliada en la esquina opuesta.
  drawLoupe(ctx, u) {
    const p = this.quad[this.drag], R = 60 * u, Z = 3;
    const W = this.src.width, H = this.src.height;
    const cx = p[0] < W / 2 ? W - R - 10 * u : R + 10 * u, cy = R + 10 * u;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const sr = R / Z;
    ctx.drawImage(this.src, p[0] - sr, p[1] - sr, 2 * sr, 2 * sr, cx - R, cy - R, 2 * R, 2 * R);
    // lados del cuadrilátero dentro de la lupa
    ctx.translate(cx - p[0] * Z, cy - p[1] * Z); ctx.scale(Z, Z);
    ctx.lineWidth = 1.5 * u / Z; ctx.strokeStyle = '#4ade80';
    ctx.beginPath(); ctx.moveTo(...this.quad[0]); this.quad.slice(1).forEach(q => ctx.lineTo(...q)); ctx.closePath(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#facc15';
    ctx.beginPath(); ctx.moveTo(cx - 10 * u, cy); ctx.lineTo(cx + 10 * u, cy); ctx.moveTo(cx, cy - 10 * u); ctx.lineTo(cx, cy + 10 * u); ctx.stroke();
  }
}

function fieldColor(id) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 85% 50%)`;
}

const CUSTOM_TPL_KEY = 'dni-safe.customTemplates';
function loadCustomTemplates() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_TPL_KEY) || '[]'); } catch { return []; }
}
function saveCustomTemplate(t) {
  try {
    const all = loadCustomTemplates().filter(x => x.id !== t.id);
    all.push(t);
    localStorage.setItem(CUSTOM_TPL_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}
function downloadBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
