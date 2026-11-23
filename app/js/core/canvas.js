// @ts-check
// The one place in core/ that touches `document`: creating a canvas. Everything else in core/
// receives canvases (or creates them through this helper), so the rest stays pure computation.

/** @param {number} width @param {number} height @returns {HTMLCanvasElement} */
export function createCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  return c;
}
