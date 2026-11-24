// @ts-check
// The /why page (why/index.html) and the /guia/ guide (guia/index.html): apply the chosen language to the
// static Spanish markup and mount the ES/EN switches. No network access (the CSP forbids it).
import { applyI18n, mountLangSwitch } from '../app/js/ui/i18n.js';

applyI18n();
document.querySelectorAll('[data-lang-switch]').forEach(box => mountLangSwitch(/** @type {HTMLElement} */ (box)));
// Opened from the PDF's link or QR code (#receive / #send): the translated text can change the
// height of what comes before the section, so scroll to it again once the language is applied.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
