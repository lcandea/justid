// @ts-check
// Country list for the calling-code picker: names in the UI language, flags and search.
import DIAL_CODES from './dial-codes.js';

/** @typedef {{ iso: string, dial: string, name: string }} Country */

/** Flag emoji from a two-letter region code (regional indicator symbols). @param {string} iso */
export const flagEmoji = iso => String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));

/** Lower-case, accents removed: "Perú" matches "peru". @param {string} s */
const foldText = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Every country with its name in `lang`, sorted by that name.
 * @param {string} lang @returns {Country[]}
 */
export function countryList(lang) {
  /** @type {Intl.DisplayNames | null} */
  let names = null;
  try { names = new Intl.DisplayNames([lang], { type: 'region' }); } catch { /* old browser: use the codes */ }
  const list = DIAL_CODES.map(([iso, dial]) => ({ iso, dial, name: names?.of(iso) || iso }));
  const collator = new Intl.Collator(lang);
  return list.sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Countries matching a search: digits (with or without + / 00) match the start of the dial code,
 * exact codes first; text matches any part of the name, or the ISO code. Empty query: everything.
 * @param {Country[]} list @param {string} query @returns {Country[]}
 */
export function filterCountries(list, query) {
  const q = query.trim();
  if (!q) return list;
  if (/^(\+|00)?\d+$/.test(q.replace(/\s/g, ''))) {
    const digits = q.replace(/\s/g, '').replace(/^(\+|00)/, '');
    const hits = list.filter(c => c.dial.startsWith(digits));
    return [...hits.filter(c => c.dial === digits), ...hits.filter(c => c.dial !== digits)];
  }
  const f = foldText(q);
  const byName = list.filter(c => foldText(c.name).includes(f));
  const startsFirst = [...byName.filter(c => foldText(c.name).startsWith(f)), ...byName.filter(c => !foldText(c.name).startsWith(f))];
  const iso = q.length === 2 ? list.filter(c => c.iso === q.toUpperCase() && !byName.includes(c)) : [];
  return [...iso, ...startsFirst];
}
