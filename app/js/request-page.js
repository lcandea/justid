// @ts-check
// Request builder (app/request.html): someone who needs a copy of a DNI makes a link for it.
// The whole request goes into the link's #fragment (see request.js); nothing is sent anywhere.
import { $, $input, $textarea, $button, el } from './dom.js';
import { t, applyI18n, mountLangSwitch } from './i18n.js';
import { officialTemplates } from './templates.js';
import { FAMILIES } from '../../templates/index.js';
import { encodeRequest, shareLinkHrefs, normalizePhone, RequestError, BUILDER_ERRORS, LIMITS } from './request.js';

/** @typedef {import('./request.js').DeliveryKind} DeliveryKind */

const DOC = 'dni_es';
const PURPOSE_CHIPS = ['rental', 'bank', 'hotel', 'gym', 'hiring', 'admin'];
const family = /** @type {import('./request.js').Family} */ (FAMILIES.find(f => f.id === DOC));
const versions = officialTemplates().filter(x => x.family === DOC);
/** Fields that only appear on the back of the card (in every version): asking for one implies the back. */
const BACK_ONLY = new Set(family.fields.map(f => f.id).filter(id => {
  const inVersions = versions.map(v => v.fields.find(f => f.id === id)).filter(f => !!f);
  return inVersions.length > 0 && inVersions.every(f => f.zones.every(z => z.side === 'back'));
}));
const CAN_SHARE = typeof navigator.share === 'function';

const state = {
  /** @type {Set<string>} extra (normally hidden) fields ticked */ extras: new Set(),
  /** @type {DeliveryKind} */ delivery: 'whatsapp',
  /** last link built @type {string | null} */ link: null,
};

const fieldLabel = (/** @type {string} */ id) => t('field.' + id);

function renderFields() {
  const box = $('#b-fields');
  box.replaceChildren(...family.fields.map(f => {
    const extra = !f.show;
    const cb = el('input', { type: 'checkbox', 'data-f': f.id, checked: !extra || state.extras.has(f.id), disabled: !extra });
    if (extra) cb.addEventListener('change', () => { cb.checked ? state.extras.add(f.id) : state.extras.delete(f.id); onChange(); });
    return el('label', { class: 'chk b-field' + (extra ? ' extra' : '') }, cb,
      el('span', {}, fieldLabel(f.id), ' ', el('small', { class: extra ? 'b-extra-note' : 'muted' }, t(extra ? 'builder.field_extra' : 'builder.field_default'))));
  }));
}

function renderChips() {
  const current = $input('#b-purpose').value.trim();
  $('#b-chips').replaceChildren(...PURPOSE_CHIPS.map(key => {
    const text = t('purpose.chip.' + key);
    const b = el('button', { type: 'button', class: text === current ? 'on' : '' }, text);
    b.addEventListener('click', () => { $input('#b-purpose').value = text; $input('#b-purpose').dispatchEvent(new Event('input')); });
    return b;
  }));
}

/** Back side checkbox: forced on when an extra field lives only on the back. */
function needsBackForced() { return [...state.extras].some(id => BACK_ONLY.has(id)); }
function renderBack() {
  const forced = needsBackForced(), cb = $input('#b-back');
  if (forced) cb.checked = true;
  cb.disabled = forced;
  $('#b-back-forced').classList.toggle('hidden', !forced);
}

function renderWhy() {
  const why = $textarea('#b-why');
  $('#b-why-label').textContent = t(state.extras.size ? 'builder.why_label_required' : 'builder.why_label');
  $('#b-why-count').textContent = t('builder.why_count', { n: why.value.length, max: LIMITS.why });
}

function renderContact() {
  const kind = state.delivery, input = $input('#b-contact');
  $('#b-contact-label').textContent = t('builder.contact_' + kind);
  input.placeholder = t('builder.contact_placeholder_' + kind);
  input.inputMode = kind === 'whatsapp' ? 'tel' : kind === 'email' ? 'email' : 'url';
  input.setAttribute('autocomplete', kind === 'whatsapp' ? 'tel' : kind === 'email' ? 'email' : 'url');
  $('#b-delivery').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === kind));
}

/** Any edit makes a previously built link stale: hide it so it can't be sent by mistake. */
function onChange() {
  renderBack(); renderWhy();
  state.link = null;
  $('#b-result').classList.add('hidden');
  $('#b-error').textContent = '';
}

function buildLink() {
  const err = $('#b-error');
  err.textContent = '';
  const raw = {
    doc: DOC,
    from: $input('#b-from').value,
    purpose: $input('#b-purpose').value,
    fields: [...state.extras],
    back: $input('#b-back').checked || needsBackForced(),
    delivery: { kind: state.delivery, value: $input('#b-contact').value },
    why: $textarea('#b-why').value,
  };
  let fragment;
  try { fragment = encodeRequest(raw, FAMILIES); }
  catch (e) {
    if (!(e instanceof RequestError)) throw e;
    err.textContent = BUILDER_ERRORS.includes(e.code) ? t('request.error.' + e.code) : t('request.error.generic', { code: e.code });
    return;
  }
  // Show the phone as it will be used, so a missing country code is obvious.
  if (state.delivery === 'whatsapp') $input('#b-contact').value = '+' + normalizePhone(raw.delivery.value);
  const link = new URL('./', location.href).href + '#' + fragment;
  state.link = link;
  showResult(link, $input('#b-purpose').value.trim());
}

/** @param {string} link @param {string} purpose @param {boolean} [scroll] */
function showResult(link, purpose, scroll = true) {
  $input('#b-link').value = link;
  const msg = { subject: t('builder.message_subject'), body: t('builder.message_body', { purpose }) };
  const hrefs = shareLinkHrefs(link, msg);
  /** @type {HTMLAnchorElement} */ ($('#b-wa')).href = hrefs.whatsapp;
  /** @type {HTMLAnchorElement} */ ($('#b-mail')).href = hrefs.email;
  /** @type {HTMLAnchorElement} */ ($('#b-preview')).href = link;
  $button('#b-share').classList.toggle('hidden', !CAN_SHARE);
  $('#b-status').textContent = '';
  $('#b-result').classList.remove('hidden');
  if (scroll) $('#b-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** @param {string} text @param {'ok' | 'warn'} kind */
function status(text, kind) { const st = $('#b-status'); st.className = 'status ' + kind; st.textContent = text; }

async function copyLink() {
  if (!state.link) return;
  const input = $input('#b-link');
  try {
    await navigator.clipboard.writeText(state.link);
    status(t('builder.copied'), 'ok');
  } catch {
    input.focus(); input.select(); // let the user copy it by hand
    status(t('builder.copy_failed'), 'warn');
  }
}

async function shareLink() {
  if (!state.link) return;
  const purpose = $input('#b-purpose').value.trim();
  try {
    await navigator.share({ title: t('builder.message_subject'), text: t('builder.message_body', { purpose }), url: state.link });
    status(t('builder.shared'), 'ok');
  } catch (e) {
    if (/** @type {Error} */ (e).name === 'AbortError') return; // closed the share sheet
    await copyLink(); // share sheet unavailable: copying is the next best thing
  }
}

/* ---------- init ---------- */
$('#b-delivery').addEventListener('click', e => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button'));
  if (!b) return;
  state.delivery = /** @type {DeliveryKind} */ (b.dataset.v);
  $input('#b-contact').value = '';
  renderContact(); onChange();
});
for (const id of ['#b-from', '#b-contact', '#b-why']) $(id).addEventListener('input', onChange);
$('#b-back').addEventListener('change', onChange);
$('#b-purpose').addEventListener('input', () => {
  const v = $input('#b-purpose').value.trim();
  $('#b-chips').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === v));
  onChange();
});
$('#b-create').addEventListener('click', buildLink);
$('#b-copy').addEventListener('click', copyLink);
$('#b-share').addEventListener('click', shareLink);
$('#b-link').addEventListener('focus', () => $input('#b-link').select());

window.addEventListener('langchange', () => {
  renderFields(); renderChips(); renderWhy(); renderContact();
  if (state.link) showResult(state.link, $input('#b-purpose').value.trim(), false); // message text follows the language
});

applyI18n();
mountLangSwitch($('#lang'));
renderFields(); renderChips(); renderBack(); renderWhy(); renderContact();
