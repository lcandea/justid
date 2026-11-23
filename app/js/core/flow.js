// @ts-check
// Rules of the 4-step flow (photos -> hide -> purpose -> share) as pure functions: which fields
// start hidden, what a request implies, which photo problems are pending, whether a step can be
// left, what the summary counts. The page (ui/app/) keeps the state and calls these.
import { extraFields } from './request.js';

/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {import('./templates.js').Field} Field */
/** @typedef {import('./templates.js').Side} Side */
/** @typedef {import('./request.js').DniRequest} DniRequest */
/** @typedef {import('./request.js').Family} Family */
/**
 * What an opened request link means for the app (all empty / null without a request).
 * @typedef {{ request: DniRequest | null, extras: Set<string>, fields: Set<string> }} RequestContext
 */

export const STEPS = 4;
/** @type {Side[]} */
export const SIDE_LIST = ['front', 'back'];

/** @param {Side} s @returns {Side} */
export const otherSide = s => (s === 'front' ? 'back' : 'front');

/**
 * Derive the request context from a decoded request.
 * `extras` are the requested fields that are normally hidden: each needs the user's explicit OK.
 * @param {DniRequest | null} request @param {Family[]} families @returns {RequestContext}
 */
export function requestContext(request, families) {
  const family = request ? families.find(f => f.id === request.doc) : undefined;
  return {
    request,
    extras: new Set(request && family ? extraFields(request, family) : []),
    fields: new Set(request?.fields || []),
  };
}

/**
 * Initial visibility. Without a request: the template's defaults. With one: only the requested
 * fields, and a normally hidden one stays hidden until the user accepts it. Fields that were not
 * asked for are hidden, even the usual ones.
 * @param {Field} f @param {RequestContext} ctx @param {Set<string>} accepted extras the user agreed to show
 */
function startsHidden(f, ctx, accepted) {
  if (!ctx.request) return f.hide;
  if (ctx.extras.has(f.id)) return !accepted.has(f.id);
  return !ctx.fields.has(f.id);
}

/** Ids of the fields hidden when a template is first applied. @param {ResolvedTemplate} tpl @param {RequestContext} ctx @param {Set<string>} accepted */
export const initialHidden = (tpl, ctx, accepted) => new Set(tpl.fields.filter(f => startsHidden(f, ctx, accepted)).map(f => f.id));

/** With a request: the back side is asked for, or a requested field is only on the back. @param {ResolvedTemplate} tpl @param {RequestContext} ctx */
export function requestNeedsBack(tpl, ctx) {
  if (!ctx.request) return false;
  return ctx.request.back || tpl.fields.some(f => ctx.fields.has(f.id) && f.zones.length > 0 && f.zones.every(z => z.side === 'back'));
}

/** Fields grouped by the side of their first zone (the list on step 2). @param {ResolvedTemplate} tpl @returns {Record<Side, Field[]>} */
export function fieldsBySide(tpl) {
  /** @type {Record<Side, Field[]>} */
  const groups = { front: [], back: [] };
  for (const f of tpl.fields) groups[f.zones[0]?.side || 'front'].push(f);
  return groups;
}

/**
 * The field whose smallest zone contains the point (fractions of the card) on `side`, or null.
 * @param {ResolvedTemplate} tpl @param {Side} side @param {number} x @param {number} y @returns {Field | null}
 */
export function fieldAtPoint(tpl, side, x, y) {
  /** @type {Field | null} */
  let best = null, bestArea = Infinity;
  for (const f of tpl.fields) for (const z of f.zones) {
    if (z.side === side && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h && z.w * z.h < bestArea) { best = f; bestArea = z.w * z.h; }
  }
  return best;
}

/** Number of hidden fields that have a zone on a side the user photographed. @param {ResolvedTemplate} tpl @param {Set<string>} hidden @param {Side[]} sidesWithPhoto */
export const hiddenFieldCount = (tpl, hidden, sidesWithPhoto) =>
  tpl.fields.filter(f => hidden.has(f.id) && f.zones.some(z => sidesWithPhoto.includes(z.side))).length;

/**
 * Cards keyed by the side they really are (a front photo put in the back slot counts as front).
 * @template C
 * @param {Record<Side, C | null>} base @param {Record<Side, boolean>} wrongSide @param {Record<Side, boolean>} wrongSideOk
 * @returns {Partial<Record<Side, C>>}
 */
export function cardsByRealSide(base, wrongSide, wrongSideOk) {
  /** @type {Partial<Record<Side, C>>} */
  const out = {};
  for (const s of SIDE_LIST) {
    const card = base[s];
    if (!card) continue;
    const real = wrongSide[s] && !wrongSideOk[s] ? otherSide(s) : s;
    out[real] ??= card;
  }
  return out;
}

/** The first slot whose photo looks like the other side and wasn't accepted. @param {Record<Side, unknown>} base @param {Record<Side, boolean>} wrongSide @param {Record<Side, boolean>} wrongSideOk @returns {Side | undefined} */
export const pendingSideSlot = (base, wrongSide, wrongSideOk) => SIDE_LIST.find(s => base[s] && wrongSide[s] && !wrongSideOk[s]);

/**
 * A confident version guess that differs from the chosen template and wasn't dismissed.
 * @param {ResolvedTemplate | null} guess @param {ResolvedTemplate | null} chosen @param {string | null} dismissedId @returns {ResolvedTemplate | null}
 */
export const pendingVersion = (guess, chosen, dismissedId) => (guess && guess !== chosen && dismissedId !== guess.id ? guess : null);

/**
 * Can the user leave step `step` forwards?
 * @param {number} step @param {{ hasPhotos: boolean, purpose: string }} o
 */
export function canAdvance(step, { hasPhotos, purpose }) {
  if (step === 0) return hasPhotos;
  if (step === 2) return !!purpose.trim();
  return true;
}

/** Highest step reachable from the start: the first one that can't be left, else the wanted one. @param {number} wanted @param {(step: number) => boolean} can */
export function reachableStep(wanted, can) {
  let n = Math.max(0, Math.min(STEPS - 1, wanted));
  for (let i = 0; i < n; i++) if (!can(i)) { n = i; break; }
  return n;
}

/**
 * Key of the label on the bottom bar's main button.
 * @param {number} step @param {boolean} advanceOk @param {boolean} canShare
 */
export function navLabelKey(step, advanceOk, canShare) {
  if (step === STEPS - 1) return canShare ? 'share.share_pdf' : 'share.download_pdf';
  if (step === 0 && !advanceOk) return 'nav.need_photo';
  if (step === 2 && !advanceOk) return 'nav.need_purpose';
  return 'nav.next';
}
