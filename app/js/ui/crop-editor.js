// @ts-check
// Four draggable corners over a photo (mouse and touch), with a magnifier while dragging.
import { detectCard } from '../core/detect.js';

export class CropEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLCanvasElement} src
   * @param {{ fitParent?: boolean, topLabel?: string }} [opts]
   */
  constructor(canvas, src, opts = {}) {
    this.c = canvas; this.src = src; this.drag = -1; this.opts = opts;
    this.scale = 1; this.k = 1;
    const w = src.width, h = src.height, mx = w * 0.1, my = h * 0.1;
    /** @type {number[][]} */
    this.quad = [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
    canvas.style.touchAction = 'none';
    // Listeners are stored so destroy() can remove them; the same canvas is reused across photos.
    this._handlers = {
      pointerdown: (/** @type {PointerEvent} */ e) => this.down(e),
      pointermove: (/** @type {PointerEvent} */ e) => this.move(e),
      pointerup: () => { this.drag = -1; this.draw(); },
      pointercancel: () => { this.drag = -1; this.draw(); },
    };
    for (const [ev, fn] of Object.entries(this._handlers)) canvas.addEventListener(ev, /** @type {EventListener} */ (fn));
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }
  destroy() {
    window.removeEventListener('resize', this._onResize);
    for (const [ev, fn] of Object.entries(this._handlers)) this.c.removeEventListener(ev, /** @type {EventListener} */ (fn));
  }
  resize() {
    const par = /** @type {HTMLElement} */ (this.c.parentElement), fit = this.opts.fitParent;
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
  /** @param {PointerEvent} e */
  pt(e) {
    const r = this.c.getBoundingClientRect();
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
  }
  /** @param {PointerEvent} e */
  down(e) {
    const p = this.pt(e);
    let best = -1, bd = 36 / this.scale;
    this.quad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { this.drag = best; this.c.setPointerCapture(e.pointerId); e.preventDefault(); }
  }
  /** @param {PointerEvent} e */
  move(e) {
    if (this.drag < 0) return;
    const [x, y] = this.pt(e);
    this.quad[this.drag] = [Math.min(Math.max(x, 0), this.src.width), Math.min(Math.max(y, 0), this.src.height)];
    this.draw();
  }
  /** Rotate which corner counts as "top-left" (the card was photographed sideways/upside down). */
  rotate() { this.quad.unshift(/** @type {number[]} */ (this.quad.pop())); this.draw(); }
  /** @param {number[][]} q */
  setQuad(q) { this.quad = q.map(p => [...p]); this.draw(); }
  /** Try to find the card automatically. @returns {boolean} found */
  autoDetect() {
    const r = detectCard(this.src);
    if (r) this.setQuad(r.quad);
    return !!r;
  }
  full() { const w = this.src.width, h = this.src.height; this.quad = [[0, 0], [w, 0], [w, h], [0, h]]; this.draw(); }
  getQuad() { return this.quad.map(p => [...p]); }
  draw() {
    const ctx = /** @type {CanvasRenderingContext2D} */ (this.c.getContext('2d')), q = this.quad, u = 1 / this.scale;
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
    ctx.drawImage(this.src, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath();
    ctx.rect(0, 0, this.src.width, this.src.height);
    ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath();
    ctx.fill('evenodd');
    ctx.lineWidth = 2 * u; ctx.strokeStyle = '#4ade80';
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); q.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
    // highlight the top edge so the user can tell the orientation
    ctx.lineWidth = 5 * u; ctx.strokeStyle = '#facc15';
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.stroke();
    ctx.font = `600 ${13 * u}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
    ctx.fillStyle = '#facc15'; ctx.fillText(this.opts.topLabel || 'TOP', mid[0], mid[1] - 14 * u);
    q.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 14 * u, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#facc15' : '#4ade80'; ctx.fill();
      ctx.lineWidth = 2 * u; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), p[0], p[1]);
    });
    if (this.drag >= 0) this.drawLoupe(ctx, u);
  }
  /**
   * The finger hides the corner being dragged, so show it magnified in the opposite corner.
   * @param {CanvasRenderingContext2D} ctx @param {number} u
   */
  drawLoupe(ctx, u) {
    const p = this.quad[this.drag], R = 60 * u, Z = 3;
    const W = this.src.width;
    const cx = p[0] < W / 2 ? W - R - 10 * u : R + 10 * u, cy = R + 10 * u;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const sr = R / Z;
    ctx.drawImage(this.src, p[0] - sr, p[1] - sr, 2 * sr, 2 * sr, cx - R, cy - R, 2 * R, 2 * R);
    // quad edges inside the magnifier
    ctx.translate(cx - p[0] * Z, cy - p[1] * Z); ctx.scale(Z, Z);
    ctx.lineWidth = 1.5 * u / Z; ctx.strokeStyle = '#4ade80';
    ctx.beginPath(); ctx.moveTo(this.quad[0][0], this.quad[0][1]); this.quad.slice(1).forEach(q => ctx.lineTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#facc15';
    ctx.beginPath(); ctx.moveTo(cx - 10 * u, cy); ctx.lineTo(cx + 10 * u, cy); ctx.moveTo(cx, cy - 10 * u); ctx.lineTo(cx, cy + 10 * u); ctx.stroke();
  }
}
