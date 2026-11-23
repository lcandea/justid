// @ts-check
// Rules of the request builder page (app/request.html) as pure functions.
import { composePhone, BUILDER_ERRORS } from './request.js';

/** @typedef {import('./request.js').Family} Family */
/** @typedef {import('./templates.js').ResolvedTemplate} ResolvedTemplate */

/** Fields ticked at the start: the usual ones. @param {Family} family @returns {Set<string>} */
export const defaultFields = family => new Set(family.fields.filter(f => f.show).map(f => f.id));

/** Ticked fields that are normally hidden: they need a justification. @param {Family} family @param {Set<string>} ticked @returns {string[]} */
export const tickedExtras = (family, ticked) => family.fields.filter(f => !f.show && ticked.has(f.id)).map(f => f.id);

/**
 * Fields that only appear on the back of the card (in every version): asking for one implies the back.
 * @param {Family} family @param {ResolvedTemplate[]} versions @returns {Set<string>}
 */
export function backOnlyFields(family, versions) {
  return new Set(family.fields.map(f => f.id).filter(id => {
    const inVersions = versions.map(v => v.fields.find(f => f.id === id)).filter(f => !!f);
    return inVersions.length > 0 && inVersions.every(f => f && f.zones.every(z => z.side === 'back'));
  }));
}

/** Is the back side forced on by a ticked field? @param {Set<string>} ticked @param {Set<string>} backOnly */
export const backForced = (ticked, backOnly) => [...ticked].some(id => backOnly.has(id));

/**
 * WhatsApp number as it will go in the link (dial code + number), or '' when nothing is typed.
 * Throws RequestError `phone_invalid` for a bad number.
 * @param {string} dial @param {string} typed
 */
export const wholePhone = (dial, typed) => (typed.trim() ? composePhone(dial, typed) : '');

/** Locale key of an error code shown to the requester. @param {string} code */
export const builderErrorKey = code => (BUILDER_ERRORS.includes(code) ? 'request.error.' + code : 'request.error.generic');
