// @ts-check
// Full-screen image viewer with pinch-to-zoom, drag to pan, double-tap / double-click to zoom
// and mouse-wheel zoom. Used to inspect the template reference pictures.
import { el } from './dom.js';
import { t } from './i18n.js';

const MIN = 1, MAX = 6, DOUBLE_TAP_ZOOM = 2.5;

/** @type {HTMLDialogElement | null} */
let dialog = null;
/** @type {HTMLImageElement} */
let img;
/** @type {HTMLButtonElement} */
let closeBtn;
const view = { scale: 1, x: 0, y: 0 };
/** active pointers by id @type {Map<number, { x: number, y: number }>} */
const pointers = new Map();
/** @type {{ dist: number, scale: number, mid: { x: number, y: number }, x: number, y: number } | null} */
let pinch = null;
let lastTap = 0;

const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

function apply() {
  // keep the picture from being dragged completely off-screen
  const r = /** @type {HTMLDialogElement} */ (dialog).getBoundingClientRect();
  const w = img.offsetWidth * view.scale, h = img.offsetHeight * view.scale;
  const maxX = Math.max(0, (w - r.width) / 2), maxY = Math.max(0, (h - r.height) / 2);
  view.x = clamp(view.x, -maxX, maxX); view.y = clamp(view.y, -maxY, maxY);
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

/** Zoom to `scale`, keeping the screen point (cx, cy) fixed. */
function zoomAt(/** @type {number} */ scale, /** @type {number} */ cx, /** @type {number} */ cy) {
  const r = /** @type {HTMLDialogElement} */ (dialog).getBoundingClientRect();
  const s = clamp(scale, MIN, MAX), k = s / view.scale;
  const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2; // relative to the centre
  view.x = px - (px - view.x) * k; view.y = py - (py - view.y) * k; view.scale = s;
  if (s === MIN) { view.x = 0; view.y = 0; }
  apply();
}

function build() {
  img = el('img', { class: 'zoom-img', alt: '', draggable: 'false' });
  closeBtn = el('button', { type: 'button', class: 'zoom-close' }, '✕');
  dialog = el('dialog', { class: 'zoom-viewer' }, img, closeBtn);
  const d = /** @type {HTMLDialogElement} */ (dialog);
  document.body.append(d);
  closeBtn.addEventListener('click', () => d.close());
  d.addEventListener('close', () => { pointers.clear(); pinch = null; });

  d.addEventListener('pointerdown', e => {
    if (e.target === closeBtn) return;
    try { d.setPointerCapture(e.pointerId); } catch { /* synthetic pointers (tests) can't be captured */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, x: view.x, y: view.y };
    }
  });
  d.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // restore the state at pinch start, then zoom around the original midpoint and follow the fingers
      view.scale = pinch.scale; view.x = pinch.x; view.y = pinch.y;
      zoomAt(pinch.scale * dist / pinch.dist, pinch.mid.x, pinch.mid.y);
      view.x += (a.x + b.x) / 2 - pinch.mid.x; view.y += (a.y + b.y) / 2 - pinch.mid.y;
      apply();
    } else if (pointers.size === 1 && view.scale > 1) {
      view.x += cur.x - prev.x; view.y += cur.y - prev.y; apply();
    }
  });
  const up = (/** @type {PointerEvent} */ e) => {
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasSingle && e.type === 'pointerup') { // double tap / double click toggles zoom
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(view.scale > 1 ? 1 : DOUBLE_TAP_ZOOM, e.clientX, e.clientY); lastTap = 0; }
      else lastTap = now;
    }
  };
  d.addEventListener('pointerup', up);
  d.addEventListener('pointercancel', up);
  d.addEventListener('wheel', e => { e.preventDefault(); zoomAt(view.scale * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY); }, { passive: false });
}

/** Open the viewer on an image. @param {string} src @param {string} alt */
export function openZoom(src, alt) {
  if (!dialog) build();
  const d = /** @type {HTMLDialogElement} */ (dialog);
  img.src = src; img.alt = alt;
  closeBtn.setAttribute('aria-label', t('zoom.close'));
  view.scale = 1; view.x = 0; view.y = 0; img.style.transform = '';
  d.showModal();
}
