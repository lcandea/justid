// @ts-check
// Decode a photo picked by the user into a canvas (browser file/image APIs, so it lives in ui/).
import { createCanvas } from '../core/canvas.js';

/** Enough to crop a 1012 px card; 4000 px can exhaust Safari's memory on iPhones. */
const MAX_SRC_SIDE = 2400;

/**
 * Decode an image file into a canvas, honouring EXIF orientation (the browser applies it).
 * Re-drawing onto a canvas also drops the photo's metadata (GPS, camera, dates).
 * @param {File} file @param {string} errorMessage @returns {Promise<HTMLCanvasElement>}
 */
export function loadImageFile(file, errorMessage) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SRC_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = createCanvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
      /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(errorMessage)); };
    img.src = url;
  });
}
