// @ts-check
// Test drive with the official specimen: opening the app as app/?demo=specimenv4 (the landing links here)
// or ?demo=specimenv3 loads that DNI version's specimen front and back as if they had been photographed
// and straightened, so anyone can try the whole flow without their own ID. The pictures are the template reference scans already served
// by the site (templates/ref); nothing is fetched from outside. A notice says so and offers to switch to
// your own photos (same URL without ?demo, keeping any request link in the #fragment).
import { $ } from '../dom.js';
import { createCanvas } from '../../core/canvas.js';
import { SIDE_LIST } from '../../core/flow.js';
import { loadSampleImage } from '../samples.js';
import { state, handlers } from './state.js';
import { renderSlot } from './photos.js';
import { renderAll } from './render.js';
import { updateNav } from './nav.js';

/** ?demo= value -> template whose reference pictures are loaded. Plain "specimen" means the default, v4. */
const DEMO_TEMPLATES = { specimen: 'dni_es_v4', specimenv4: 'dni_es_v4', specimenv3: 'dni_es_v3' };

/** Template id to load when the page was opened in specimen test mode, else null. */
function demoTemplateId() {
  const v = new URLSearchParams(location.search).get('demo');
  return v && Object.hasOwn(DEMO_TEMPLATES, v) ? DEMO_TEMPLATES[/** @type {keyof typeof DEMO_TEMPLATES} */ (v)] : null;
}

/**
 * Step 1's "Want to try? Load a v3 or v4 ID" links: same page with ?demo=…, keeping any request
 * link in the #fragment (a different query string reloads the page, which starts the test mode).
 */
export function initDemoLinks() {
  for (const v of ['v3', 'v4']) {
    /** @type {HTMLAnchorElement} */ ($('#demo-' + v)).href = location.pathname + '?demo=specimen' + v + location.hash;
  }
}

/** True when the page was opened in specimen test mode. */
export const isDemo = () => demoTemplateId() !== null;

/** Load the chosen version's reference pictures into both photo slots and run the usual checks. */
export async function loadDemo() {
  const id = demoTemplateId();
  const tpl = state.templates.find(x => x.id === id) || state.templates.find(x => x.isDefault);
  if (!tpl?.sample) return;
  for (const side of SIDE_LIST) {
    const path = tpl.sample[side];
    const img = path ? await loadSampleImage(path) : null;
    if (!img) continue;
    const card = createCanvas(img.naturalWidth, img.naturalHeight);
    /** @type {CanvasRenderingContext2D} */ (card.getContext('2d')).drawImage(img, 0, 0);
    state.src[side] = card; // already a straightened card: the photo and the card are the same picture
    state.base[side] = card;
  }
  state.pvSide = 'front';
  const exit = /** @type {HTMLAnchorElement} */ ($('#demo-exit'));
  exit.href = location.pathname + location.hash; // same page and request, without ?demo
  $('#demo-note').classList.remove('hidden');
  for (const side of SIDE_LIST) renderSlot(side);
  renderAll(); updateNav();
  await handlers.runChecks(); // identifies the version, as with real photos
}
