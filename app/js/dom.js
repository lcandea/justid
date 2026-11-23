// @ts-check
// Tiny DOM helpers. No framework, no dependencies.

/**
 * @template {Element} [E=HTMLElement]
 * @param {string} sel @param {ParentNode} [root] @returns {E}
 */
export const $ = (sel, root = document) => /** @type {E} */ (root.querySelector(sel));
/** @param {string} sel */ export const $input = sel => /** @type {HTMLInputElement} */ ($(sel));
/** @param {string} sel */ export const $select = sel => /** @type {HTMLSelectElement} */ ($(sel));
/** @param {string} sel */ export const $textarea = sel => /** @type {HTMLTextAreaElement} */ ($(sel));
/** @param {string} sel */ export const $button = sel => /** @type {HTMLButtonElement} */ ($(sel));

/**
 * Create an element. `on*` attributes become event listeners, `class` sets className,
 * `true` sets a boolean attribute, `false`/null/undefined are skipped.
 * Children are appended as nodes or text (never parsed as HTML).
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 * @returns {any} typed as any so callers can use element-specific properties without casts
 */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
}

/** Save a Blob as a file through a temporary link. @param {Blob} blob @param {string} name */
export function downloadBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Inline SVG icons (static markup, no user data). */
export const ICONS = {
  camera: '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>',
};

/** Parse one of the static ICONS into a node. @param {string} markup @returns {Node} */
export function icon(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return /** @type {Node} */ (t.content.firstChild);
}
