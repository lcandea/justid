// @ts-check
// "Request a DNI" links.
//
// Someone who needs a copy of your DNI (a landlord, a gym…) builds a link on app/request.html.
// Everything the request says travels in the URL #fragment, which browsers never send to the
// server: who asks, what for, which fields, whether the back side is needed, how to send it back
// and an optional justification. Opening the link starts the app showing only the requested
// fields (`fields` lists every one, the usual ones included; at least one is required).
//
// Fragment format (URLSearchParams syntax, readable on purpose so anyone can see what a link says):
//   #req=1&doc=dni_es&from=<name>&for=<purpose>&fields=<id>,<id>&back=1&wa=<digits>&why=<text>
//   exactly one delivery key: wa=<international phone digits> | mail=<email> | up=<https URL>
//
// Everything decoded is untrusted: the same validator runs when a link is built and when it is
// opened, with hard length limits, and it rejects the whole link on anything unexpected rather
// than guessing. Decoded text is only ever displayed with textContent.
//
// This module is pure (no DOM, no i18n) so the unit tests can run it in Node.

/** Format version written as `req=`; links with another value are rejected. */
export const REQUEST_VERSION = '1';

/** Document families a request can be made for. */
export const SUPPORTED_DOCS = ['dni_es'];

/**
 * Length limits, in UTF-16 code units (what <input maxlength> counts).
 * `fragment` caps the raw fragment before anything is parsed: the worst case of every text at its
 * limit, fully percent-encoded, is about 4.6k characters.
 */
export const LIMITS = { from: 60, purpose: 80, why: 240, email: 254, url: 300, fragment: 6000 };

/** Fragment keys. */
const K = { version: 'req', doc: 'doc', from: 'from', purpose: 'for', fields: 'fields', back: 'back',
  whatsapp: 'wa', email: 'mail', upload: 'up', why: 'why' };
const DELIVERY_KEYS = /** @type {const} */ ([['whatsapp', K.whatsapp], ['email', K.email], ['upload', K.upload]]);

/** Error codes the request builder can show to the requester (each has a `request.error.<code>` string). */
export const BUILDER_ERRORS = ['from_required', 'from_too_long', 'from_chars', 'purpose_required', 'purpose_too_long',
  'purpose_chars', 'why_required', 'why_too_long', 'why_chars', 'delivery_required', 'phone_invalid', 'email_invalid',
  'url_invalid', 'too_long', 'fields_required'];

/**
 * @typedef {'whatsapp' | 'email' | 'upload'} DeliveryKind
 * @typedef {{ kind: DeliveryKind, value: string }} Delivery
 *   value: phone digits with country code (whatsapp), address (email) or normalised https URL (upload)
 * @typedef {{
 *   doc: string, from: string, purpose: string, fields: string[], back: boolean,
 *   delivery: Delivery, why: string
 * }} DniRequest
 * @typedef {{ id: string, fields: { id: string, show: boolean }[] }} Family
 */

export class RequestError extends Error {
  /** @param {string} code */
  constructor(code) { super(code); this.name = 'RequestError'; this.code = code; }
}

// Control characters and bidirectional overrides: never legitimate here, and the latter can make
// displayed text read differently from what it is (e.g. disguise a phone number or a domain).
const BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

/**
 * Normalise one line of free text: NFC, whitespace runs (newlines included) become one space.
 * @param {unknown} value @param {'from' | 'purpose' | 'why'} name @param {boolean} required
 */
function cleanText(value, name, required) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new RequestError(`${name}_invalid`);
  const s = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s && required) throw new RequestError(`${name}_required`);
  if (s.length > LIMITS[name]) throw new RequestError(`${name}_too_long`);
  if (BAD_CHARS.test(s)) throw new RequestError(`${name}_chars`);
  return s;
}

/** Drop spaces, dots, dashes and brackets. @param {string} s */
const stripSeparators = s => s.replace(/[\s().-]/g, '');

/**
 * Full international number as wa.me wants it: country code + number, digits only (E.164 without
 * the +). Separators and a leading + or 00 are dropped; no country is ever guessed.
 * Throws `phone_invalid`.
 * @param {unknown} value @returns {string}
 */
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 40) throw new RequestError('phone_invalid');
  let s = stripSeparators(value);
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^[1-9]\d{7,14}$/.test(s)) throw new RequestError('phone_invalid');
  return s;
}

/** Countries whose numbers keep their leading 0 after the country code (Italy, San Marino, Vatican). */
const KEEP_LEADING_ZERO = new Set(['39', '378', '379']);

/**
 * Join the dial code picked in the builder with the number typed next to it.
 * A number typed with its own + or 00 prefix is taken as already international. Otherwise one
 * national trunk 0 is dropped (UK 07700… -> 447700…), except where it is part of the number.
 * Throws `phone_invalid`.
 * @param {string} dial country calling code, digits only (e.g. '34') @param {string} number
 * @returns {string}
 */
export function composePhone(dial, number) {
  if (typeof dial !== 'string' || !/^[1-9]\d{0,3}$/.test(dial) || typeof number !== 'string') throw new RequestError('phone_invalid');
  const s = stripSeparators(number);
  if (s.startsWith('+') || s.startsWith('00')) return normalizePhone(s);
  if (!/^\d+$/.test(s)) throw new RequestError('phone_invalid');
  return normalizePhone(dial + (KEEP_LEADING_ZERO.has(dial) ? s : s.replace(/^0/, '')));
}

// Deliberately narrow (no quotes, no %, no IP literals): it ends up in a mailto: link, and
// anything that could add headers (?cc=, &bcc=) must be impossible.
const EMAIL = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** A real top-level domain (letters, or an xn-- IDN one): rules out IP literals like a@1.2.3.4. */
const TLD = /\.(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]+)$/;

/** @param {unknown} value @returns {string} */
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new RequestError('email_invalid');
  const s = value.trim();
  if (s.length > LIMITS.email || !EMAIL.test(s) || !TLD.test(s)) throw new RequestError('email_invalid');
  return s;
}

/**
 * External upload page: https only, no credentials in the URL, a real host name.
 * Returns the normalised href (an international domain comes back in its xn-- form, so a
 * look-alike domain shows as what it really is).
 * @param {unknown} value @returns {string}
 */
export function normalizeUploadUrl(value) {
  if (typeof value !== 'string') throw new RequestError('url_invalid');
  const s = value.trim();
  if (!s || s.length > LIMITS.url || BAD_CHARS.test(s)) throw new RequestError('url_invalid');
  let u;
  try { u = new URL(s); } catch { throw new RequestError('url_invalid'); }
  if (u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(u.hostname) ||
    /^[\d.]+$/.test(u.hostname) || u.href.length > LIMITS.url) throw new RequestError('url_invalid');
  return u.href;
}

/** @param {unknown} d @returns {Delivery} */
function cleanDelivery(d) {
  const dd = /** @type {any} */ (d);
  if (!dd || typeof dd !== 'object' || typeof dd.value !== 'string' || !dd.value.trim()) throw new RequestError('delivery_required');
  if (dd.kind === 'whatsapp') return { kind: 'whatsapp', value: normalizePhone(dd.value) };
  if (dd.kind === 'email') return { kind: 'email', value: normalizeEmail(dd.value) };
  if (dd.kind === 'upload') return { kind: 'upload', value: normalizeUploadUrl(dd.value) };
  throw new RequestError('delivery_required');
}

/** @param {string} id @param {Family[]} families */
function findFamily(id, families) {
  const fam = SUPPORTED_DOCS.includes(id) ? families.find(f => f.id === id) : undefined;
  if (!fam) throw new RequestError('doc_unsupported');
  return fam;
}

/**
 * Validate and normalise a request. Runs both when building a link and when opening one.
 * Throws RequestError with a code.
 * @param {any} raw @param {Family[]} families @returns {DniRequest}
 */
export function validateRequest(raw, families) {
  if (!raw || typeof raw !== 'object') throw new RequestError('invalid');
  const doc = typeof raw.doc === 'string' ? raw.doc : '';
  const family = findFamily(doc, families);
  const from = cleanText(raw.from, 'from', true);
  const purpose = cleanText(raw.purpose, 'purpose', true);
  if (!Array.isArray(raw.fields) || raw.fields.length > family.fields.length * 2) throw new RequestError('fields_invalid');
  const wanted = new Set();
  for (const id of raw.fields) {
    if (typeof id !== 'string' || !family.fields.some(f => f.id === id)) throw new RequestError('fields_unknown');
    wanted.add(id);
  }
  const fields = family.fields.filter(f => wanted.has(f.id)).map(f => f.id); // catalogue order, no duplicates
  if (!fields.length) throw new RequestError('fields_required'); // a request for nothing is a mistake
  if (typeof raw.back !== 'boolean') throw new RequestError('back_invalid');
  const delivery = cleanDelivery(raw.delivery);
  const why = cleanText(raw.why, 'why', false);
  /** @type {DniRequest} */
  const req = { doc, from, purpose, fields, back: raw.back, delivery, why };
  if (extraFields(req, family).length && !why) throw new RequestError('why_required');
  return req;
}

/**
 * Requested fields that are normally hidden: the user must accept each one before it is shown.
 * Empty means the request stays within what is normally shared (it may ask for less).
 * @param {DniRequest} req @param {Family} family @returns {string[]}
 */
export function extraFields(req, family) {
  const hiddenByDefault = new Set(family.fields.filter(f => !f.show).map(f => f.id));
  return req.fields.filter(id => hiddenByDefault.has(id));
}

/**
 * Build the fragment (without the leading #) for a request. Throws RequestError.
 * @param {any} raw @param {Family[]} families @returns {string}
 */
export function encodeRequest(raw, families) {
  const req = validateRequest(raw, families);
  const p = new URLSearchParams();
  p.set(K.version, REQUEST_VERSION);
  p.set(K.doc, req.doc);
  p.set(K.from, req.from);
  p.set(K.purpose, req.purpose);
  if (req.fields.length) p.set(K.fields, req.fields.join(','));
  if (req.back) p.set(K.back, '1');
  p.set(/** @type {string} */ (DELIVERY_KEYS.find(([kind]) => kind === req.delivery.kind)?.[1]), req.delivery.value);
  if (req.why) p.set(K.why, req.why);
  const out = p.toString();
  if (out.length > LIMITS.fragment) throw new RequestError('too_long');
  return out;
}

/**
 * Read a request from a URL fragment.
 * @param {string | null | undefined} hash location.hash (with or without the #)
 * @param {Family[]} families
 * @returns {null | { ok: true, request: DniRequest } | { ok: false, error: string }}
 *   null when the fragment is not a request at all
 */
export function decodeRequest(hash, families) {
  let s = typeof hash === 'string' ? hash : '';
  if (s.startsWith('#')) s = s.slice(1);
  if (!s) return null;
  if (s.length > LIMITS.fragment) return /(^|&)req=/.test(s) ? { ok: false, error: 'too_long' } : null;
  const p = new URLSearchParams(s);
  if (!p.has(K.version)) return null;
  try {
    for (const key of Object.values(K)) if (p.getAll(key).length > 1) throw new RequestError('duplicate_key');
    if (p.get(K.version) !== REQUEST_VERSION) throw new RequestError('version_unsupported');
    const deliveries = DELIVERY_KEYS.filter(([, key]) => p.has(key));
    if (deliveries.length > 1) throw new RequestError('delivery_multiple');
    const back = p.get(K.back);
    if (back !== null && back !== '0' && back !== '1') throw new RequestError('back_invalid');
    const fields = p.get(K.fields);
    const request = validateRequest({
      doc: p.get(K.doc) ?? '',
      from: p.get(K.from) ?? '',
      purpose: p.get(K.purpose) ?? '',
      fields: fields ? fields.split(',') : [],
      back: back === '1',
      delivery: deliveries.length ? { kind: deliveries[0][0], value: p.get(deliveries[0][1]) } : null,
      why: p.get(K.why) ?? '',
    }, families);
    return { ok: true, request };
  } catch (e) {
    if (e instanceof RequestError) return { ok: false, error: e.code };
    throw e;
  }
}

/**
 * Where the "send it" button goes. wa.me and mailto: links can't carry a file, so the message
 * only accompanies a PDF the user has already shared or downloaded. Opening these is a
 * navigation, not a network request from the page (connect-src 'none' still applies).
 * @param {Delivery} d @param {{ subject: string, body: string }} msg @returns {string}
 */
export function deliveryHref(d, msg) {
  if (d.kind === 'whatsapp') return `https://wa.me/${normalizePhone(d.value)}?text=${encodeURIComponent(msg.body)}`;
  if (d.kind === 'email') {
    return `mailto:${normalizeEmail(d.value)}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
  }
  return normalizeUploadUrl(d.value);
}

/** Host name of an upload URL, to show the user where they are going. @param {string} url */
export const uploadHost = url => new URL(url).hostname;

/**
 * Links for the requester to pass the request link on (no recipient chosen yet).
 * @param {string} link @param {{ subject: string, body: string }} msg
 */
export function shareLinkHrefs(link, msg) {
  const body = `${msg.body}\n${link}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(body)}`,
    email: `mailto:?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(body)}`,
  };
}
