// @ts-check
// Drawing the redacted previews, the zone outlines and the summary line.
import { $, $input } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { renderRedacted } from '../../core/redact.js';
import { watermarkText } from '../../core/watermark.js';
import { SIDE_LIST, hiddenFieldCount } from '../../core/flow.js';
import { state, zonesCanvas, sides, sideName } from './state.js';

/** The watermark for the purpose / recipient currently typed ('' without a purpose). */
function currentWatermark() {
  return watermarkText({
    purpose: $input('#purpose').value, recipient: $input('#recipient').value,
    date: new Date().toLocaleDateString(getLang()), onlyFor: purpose => t('wm.only_for', { purpose }),
  });
}

/** Outline every zone on the preview: solid = hidden, dashed yellow = visible. */
export function drawZones() {
  const side = state.pvSide, cv = state.canvas[side];
  if (!cv.isConnected || !zonesCanvas.isConnected) return;
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  zonesCanvas.width = Math.round(w * dpr); zonesCanvas.height = Math.round(h * dpr);
  const ctx = /** @type {CanvasRenderingContext2D} */ (zonesCanvas.getContext('2d')); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const f of state.template.fields) for (const z of f.zones) {
    if (z.side !== side) continue;
    const hid = state.hidden.has(f.id);
    ctx.setLineDash(hid ? [] : [5, 4]); ctx.lineWidth = hid ? 1.5 : 2;
    ctx.strokeStyle = hid ? 'rgba(243,241,236,.85)' : '#d7ff3a'; // cream = covered, lime dashed = visible
    ctx.strokeRect(z.x * w + 1, z.y * h + 1, z.w * w - 2, z.h * h - 2);
  }
}

export function updateSummary() {
  if (state.step !== 3) return;
  const count = hiddenFieldCount(state.template, state.hidden, sides());
  const list = sides().map(sideName).join(t('share.sides_join'));
  $('#summary').textContent = t('share.summary', { sides: list, count, watermark: currentWatermark() });
}

let renderTimer = 0;
/** Re-render both previews (debounced). */
export function renderAll() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    const opts = { template: state.template, hidden: state.hidden, mode: state.mode, bw: state.bw, watermark: currentWatermark() };
    for (const side of SIDE_LIST) {
      const base = state.base[side];
      if (base) renderRedacted(state.canvas[side], base, side, opts);
    }
    drawZones(); updateSummary();
  }, 50);
}
