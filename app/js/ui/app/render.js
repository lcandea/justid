// @ts-check
// Drawing the redacted previews, the zone outlines and the summary line.
import { $, $input } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { prepareCard, watermarkLayer, composeRedacted } from '../../core/redact.js';
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

/** Secret per-session seed: pixelation noise and watermark jitter are stable on screen but unpredictable. */
const SEED = crypto.getRandomValues(new Uint32Array(1))[0];

/**
 * Cached layers per side. A layer is rebuilt only when its own inputs change, and a side whose
 * output inputs are all unchanged is not redrawn at all (toggling a front field leaves the back alone).
 * @typedef {{ base: HTMLCanvasElement | null, bw: boolean, card: HTMLCanvasElement | null,
 *   wmKey: string, wm: HTMLCanvasElement | null, template: object | null, outKey: string }} SideCache
 * @type {Record<import('./state.js').Side, SideCache>}
 */
const cache = {
  front: { base: null, bw: false, card: null, wmKey: '', wm: null, template: null, outKey: '' },
  back: { base: null, bw: false, card: null, wmKey: '', wm: null, template: null, outKey: '' },
};
let cacheGen = 0; // bumped whenever a cached layer is rebuilt, so the output key changes too

/** @param {import('./state.js').Side} side @param {HTMLCanvasElement} base @param {string} watermark */
function renderSide(side, base, watermark) {
  const c = cache[side];
  if (c.base !== base || c.bw !== state.bw || !c.card) {
    c.base = base; c.bw = state.bw; c.card = prepareCard(base, state.bw); cacheGen++;
  }
  const wmKey = `${base.width}x${base.height}|${state.bw}|${watermark}`;
  if (c.wmKey !== wmKey) {
    c.wmKey = wmKey; c.wm = watermark ? watermarkLayer(base.width, base.height, watermark, state.bw, SEED) : null; cacheGen++;
  }
  if (c.template !== state.template) { c.template = state.template; cacheGen++; }
  const hiddenHere = state.template.fields
    .filter(f => state.hidden.has(f.id) && f.zones.some(z => z.side === side)).map(f => f.id).join(',');
  const outKey = `${cacheGen}|${state.mode}|${hiddenHere}`;
  if (c.outKey === outKey) return;
  c.outKey = outKey;
  composeRedacted(state.canvas[side], c.card, side, { template: state.template, hidden: state.hidden, mode: state.mode, seed: SEED }, c.wm);
}

let renderTimer = 0;
/** Re-render what changed in the previews (debounced). */
export function renderAll() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    const watermark = currentWatermark();
    for (const side of SIDE_LIST) {
      const base = state.base[side];
      if (base) renderSide(side, base, watermark);
      else cache[side].base = null;
    }
    drawZones(); updateSummary();
  }, 50);
}
