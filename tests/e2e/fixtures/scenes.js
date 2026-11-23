// Synthetic photos of a fake card on different backgrounds, used to test the card detector.
// Loaded in the browser by tests/e2e/detector.spec.js (served from the repo root, never deployed).
import { homography } from '../../../app/js/image.js';

const CW = 856, CH = 540; // fake card size

function makeCard() {
  const c = document.createElement('canvas'); c.width = CW; c.height = CH; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, CW, CH); g.addColorStop(0, '#dfeadf'); g.addColorStop(1, '#efe3d2');
  x.fillStyle = g; x.fillRect(0, 0, CW, CH);
  x.fillStyle = '#b8323a'; x.fillRect(0, 0, CW, 60);
  x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'; x.fillText('FAKE TEST DOCUMENT', 20, 42);
  x.fillStyle = '#888'; x.fillRect(25, 120, 230, 300);
  x.fillStyle = '#222'; x.font = '28px sans-serif';
  for (let i = 0; i < 7; i++) x.fillText('SURNAME NAME 12345 ' + i, 290, 130 + i * 45);
  x.font = '22px monospace';
  for (let i = 0; i < 3; i++) x.fillText('IDESPAAA000000<<<<<<<<<<<<<<<<', 25, 460 + i * 28);
  return c.getContext('2d').getImageData(0, 0, CW, CH).data;
}

/** Render a W×H photo with the card mapped onto `corners` (TL, TR, BR, BL) over background `bg(x, y)`. */
function scene(card, W, H, corners, bg, opts = {}) {
  const out = new ImageData(W, H), o = out.data;
  const h = homography(corners, [[0, 0], [CW, 0], [CW, CH], [0, CH]]);
  const R = 30, noise = opts.noise ?? 14;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const den = h[6] * x + h[7] * y + 1, u = (h[0] * x + h[1] * y + h[2]) / den, v = (h[3] * x + h[4] * y + h[5]) / den;
    const i = (y * W + x) * 4; let r, g, b;
    let inside = u >= 0 && v >= 0 && u < CW && v < CH;
    if (inside) { const a = Math.min(u, CW - u), c = Math.min(v, CH - v); if (a < R && c < R && Math.hypot(R - a, R - c) > R) inside = false; }
    if (inside) { const j = ((v | 0) * CW + (u | 0)) * 4; r = card[j]; g = card[j + 1]; b = card[j + 2]; }
    else {
      [r, g, b] = bg(x, y);
      if (opts.shadow) { // soft shadow next to the card
        const d = Math.min(Math.abs(u < 0 ? u : u > CW ? u - CW : 0) + Math.abs(v < 0 ? v : v > CH ? v - CH : 0), 40);
        const f = 0.75 + 0.25 * d / 40; r *= f; g *= f; b *= f;
      }
    }
    const n = (Math.random() - 0.5) * noise; o[i] = r + n; o[i + 1] = g + n; o[i + 2] = b + n; o[i + 3] = 255;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').putImageData(out, 0, 0); return c;
}

const wood = (x, y) => { const t = Math.sin(y * 0.05 + Math.sin(x * 0.01) * 3) * 20; return [120 + t, 90 + t * 0.8, 60 + t * 0.5]; };
const desk = (x, y) => [228 - y * 0.01, 226 - y * 0.01, 222 - y * 0.01];
const grid = (x, y) => ((((x / 40) | 0) + ((y / 40) | 0)) % 2 ? [60, 60, 70] : [200, 200, 190]);
const dark = () => [30, 30, 35];
const fabric = (x, y) => { const t = (Math.sin(x * 0.3) + Math.sin(y * 0.3)) * 12; return [70 + t, 80 + t, 110 + t]; };

/** [name, W, H, true corners, background, options]. `hard` cases (very hard or known gaps) are reported but not required. */
export const CASES = [
  ['wood, slight rotation', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], wood],
  ['white desk with shadow', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk, { shadow: true }],
  ['white desk, no shadow (very hard)', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk, { hard: true }],
  // Known gap (also failed in the original prototype): high-contrast checkerboards produce stronger
  // line pairs than the card itself. Reported, not required, until the detector handles it.
  ['checkerboard', 1600, 1200, [[400, 300], [1200, 350], [1180, 860], [380, 800]], grid, { hard: true }],
  ['textured fabric', 1600, 1200, [[380, 260], [1240, 300], [1230, 840], [360, 820]], fabric],
  ['small in frame', 1600, 1200, [[700, 500], [1050, 520], [1040, 740], [690, 720]], dark],
  ['strong perspective', 1600, 1200, [[450, 300], [1150, 330], [1400, 1000], [200, 950]], wood],
  ['portrait photo, rotated card', 1200, 1600, [[900, 250], [950, 1350], [300, 1330], [260, 260]], dark],
  ['fills the frame', 1600, 1200, [[60, 70], [1540, 50], [1550, 1130], [50, 1140]], dark],
];

/**
 * Run the detector on every case. Error = worst corner distance (best of the 4 rotations,
 * since orientation is checked by the user) as a % of the photo diagonal.
 */
export function runCases(detectCard) {
  const card = makeCard();
  return CASES.map(([name, W, H, q, bg, opts = {}]) => {
    const s = scene(card, W, H, q, bg, opts);
    const r = detectCard(s);
    let errPct = null;
    if (r) {
      let err = Infinity;
      for (let k = 0; k < 4; k++) err = Math.min(err, Math.max(...r.quad.map((p, i) => Math.hypot(p[0] - q[(i + k) % 4][0], p[1] - q[(i + k) % 4][1]))));
      errPct = 100 * err / Math.hypot(W, H);
    }
    return { name, hard: !!opts.hard, found: !!r, errPct };
  });
}
