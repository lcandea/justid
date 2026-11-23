// @ts-check
// Shared state of the 4-step page, plus what the opened request link (if any) means.
// The decisions on that state are pure functions in core/flow.js.
import { el } from '../dom.js';
import { t } from '../i18n.js';
import { decodeRequest } from '../../core/request.js';
import { requestContext, SIDE_LIST } from '../../core/flow.js';
import { FAMILIES } from '../../../../templates/index.js';

/** @typedef {import('../../core/templates.js').ResolvedTemplate} ResolvedTemplate */
/** @typedef {import('../../core/templates.js').Side} Side */

/** Public repository; shown in the privacy dialog. */
export const REPO_URL = 'https://github.com/lcandea/justid';
export const CAN_SHARE = !!navigator.canShare; // only on HTTPS/localhost and supporting browsers

// A request link (#req=…, made on request.html) preselects what to show. It is decoded once, as
// untrusted input: an invalid link is ignored (with a notice) and the app works as usual.
export const requestResult = decodeRequest(location.hash, FAMILIES);
export const request = requestResult?.ok ? requestResult.request : null;
export const reqCtx = requestContext(request, FAMILIES);

export const state = {
  /** @type {ResolvedTemplate[]} */ templates: [],
  /** @type {ResolvedTemplate} */ template: /** @type {any} */ (null),
  /** @type {Set<string>} ids of fields currently hidden */ hidden: new Set(),
  /** original photos @type {Record<Side, HTMLCanvasElement | null>} */ src: { front: null, back: null },
  /** straightened, unprocessed cards @type {Record<Side, HTMLCanvasElement | null>} */ base: { front: null, back: null },
  /** redacted output @type {Record<Side, HTMLCanvasElement>} */
  canvas: { front: el('canvas', { class: 'preview' }), back: el('canvas', { class: 'preview' }) },
  /** @type {'pixel' | 'solid'} */ mode: 'pixel', bw: false, step: 0, pvSide: /** @type {Side} */ ('front'),
  /** user picked the template by hand: never auto-switch it */ tplManual: false,
  /** confident identification result @type {ResolvedTemplate | null} */ idGuess: null,
  /** template id the user chose to keep despite the warning @type {string | null} */ idDismissed: null,
  /** template was set by auto-identification */ tplAuto: false,
  /** true when that slot holds a photo that looks like the other side of the card @type {Record<Side, boolean>} */
  wrongSide: { front: false, back: false },
  /** the user said "it's fine" for that slot's photo @type {Record<Side, boolean>} */
  wrongSideOk: { front: false, back: false },
  /** extra requested fields the user agreed to show @type {Set<string>} */ accepted: new Set(),
};
export const zonesCanvas = el('canvas', { class: 'zones' });

/** Sides that currently have a straightened photo. */
export const sides = () => SIDE_LIST.filter(s => state.base[s]);
/** @param {Side} s */
export const sideName = s => t('side.' + s);

/**
 * Late-bound entry points, to keep module imports one-directional: the photo modules must trigger
 * the checks, but the checks (checks.js) depend on the photo modules.
 */
export const handlers = {
  /** @type {(slot?: Side) => Promise<void>} */ runChecks: async () => {},
};
