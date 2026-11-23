// @ts-check
// What the person who opens a request link sees: who asks, for what, which extra fields
// (each one must be accepted explicitly) and, at the end, how to send the PDF back.
// Everything in the request comes from the link and is untrusted: it is only ever set as text.
import { el } from './dom.js';
import { t } from './i18n.js';
import { deliveryHref, uploadHost } from '../core/request.js';

/** @typedef {import('../core/request.js').DniRequest} DniRequest */

/**
 * The justification, quoted and clearly attributed to the requester (never to JustID).
 * @param {DniRequest} req @param {string} leadKey
 */
function quote(req, leadKey) {
  return [el('p', { class: 'req-why-lead' }, t(leadKey, { name: req.from })), el('blockquote', { class: 'req-why' }, req.why)];
}

/**
 * Request summary shown on the first step.
 * @param {HTMLElement} box
 * @param {{
 *   request: DniRequest, extras: string[], backNeeded: boolean,
 *   isShown: (id: string) => boolean, onAccept: (id: string, accepted: boolean) => void
 * }} o
 */
export function renderRequestPanel(box, { request: req, extras, backNeeded, isShown, onAccept }) {
  const name = req.from;
  /** @type {Node[]} */
  const parts = [
    el('h2', { class: 'req-title' }, t('request.panel_title', { name })),
    el('p', { class: 'req-purpose' }, t('request.purpose', { purpose: req.purpose })),
    el('p', { class: 'req-fields' }, t('request.fields_list', { list: req.fields.map(id => t('field.' + id)).join(', ') })),
  ];
  if (extras.length) {
    parts.push(el('p', { class: 'req-lead warn' }, t('request.extras_lead', { name })));
    parts.push(el('ul', { class: 'req-extras' }, ...extras.map(id => {
      const label = t('field.' + id), shown = isShown(id);
      const cb = el('input', { type: 'checkbox', 'data-f': id, checked: shown, 'aria-label': t('request.accept', { field: label }) });
      cb.addEventListener('change', () => onAccept(id, cb.checked));
      return el('li', {}, el('label', { class: 'chk req-extra-row' + (shown ? ' accepted' : '') }, cb,
        el('span', {}, el('strong', {}, label), ' ',
          el('small', { class: 'req-state' }, t(shown ? 'request.extra_accepted' : 'request.extra_pending')))));
    })));
    parts.push(...(req.why ? quote(req, 'request.why_lead') : [el('p', { class: 'req-why-lead' }, t('request.no_why', { name }))]));
  } else {
    parts.push(el('p', { class: 'req-lead ok' }, t('request.normal', { name })));
    if (req.why) parts.push(...quote(req, 'request.note_lead'));
  }
  const d = req.delivery;
  parts.push(
    el('p', { class: 'req-meta' }, t(backNeeded ? 'request.back_yes' : 'request.back_no', { name })),
    el('p', { class: 'req-meta' }, t('request.delivery_' + d.kind, { value: d.kind === 'upload' ? uploadHost(d.value) : d.value })),
    el('p', { class: 'req-verify muted' }, t('request.verify')));
  box.replaceChildren(...parts);
  box.classList.remove('hidden');
}

/** Keep the panel's accept boxes in step with the field switches. @param {HTMLElement} box @param {(id: string) => boolean} isShown */
export function syncRequestPanel(box, isShown) {
  box.querySelectorAll('.req-extra-row').forEach(row => {
    const cb = /** @type {HTMLInputElement} */ (row.querySelector('input'));
    const shown = isShown(/** @type {string} */ (cb.dataset.f));
    cb.checked = shown;
    row.classList.toggle('accepted', shown);
    /** @type {HTMLElement} */ (row.querySelector('.req-state')).textContent = t(shown ? 'request.extra_accepted' : 'request.extra_pending');
  });
}

/**
 * "Send it back" block on the last step. wa.me and mailto: can't carry files, so this comes
 * after sharing / downloading the PDF and only opens the conversation with a prefilled message.
 * @param {HTMLElement} box @param {DniRequest} req @param {string} purpose the purpose the user kept
 */
export function renderSendBlock(box, req, purpose) {
  const d = req.delivery, name = req.from;
  const msg = { subject: t('request.message_subject', { purpose }), body: t('request.message_body', { purpose }) };
  const href = deliveryHref(d, msg);
  const host = d.kind === 'upload' ? uploadHost(d.value) : '';
  const label = t('request.open_' + d.kind, { value: d.value, host });
  // Not target=_blank for mailto: (it would leave an empty tab behind on some browsers).
  const link = el('a', { class: 'btn btn-primary btn-md btn-block req-send-btn', href, id: 'req-send-link',
    ...(d.kind === 'email' ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }, label);
  box.replaceChildren(
    el('h3', {}, t('request.send_title', { name })),
    el('p', { class: 'muted' }, t('request.send_step1')),
    el('p', { class: 'muted' }, t('request.send_hint_' + d.kind, { name, host })),
    link);
  box.classList.remove('hidden');
}
