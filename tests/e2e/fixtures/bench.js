// Detector benchmark: the synthetic scenes of scenes.js plus harder ones built from the official
// specimen pictures (templates/ref). Run with `npm run bench-detect` (tools/bench-detect.mjs).
// Never add real ID photos here: synthetic scenes and specimen images only. Real photos go in
// tests/private/ (git-ignored), with corners marked in tools/mark-corners.html; they are added when present.
import { makeCard, loadCard, scene, cornerError, rng, CASES, wood, desk, grid, dark, fabric } from './scenes.js';

/** A cluttered desk: papers, notebooks, pens and a keyboard, drawn once and sampled per pixel. */
function clutter(W, H, seed) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); const r = rng(seed);
  x.fillStyle = '#8a8f96'; x.fillRect(0, 0, W, H);
  const s = W / 1600;
  for (let i = 0; i < 14; i++) {
    x.save(); x.translate(r() * W, r() * H); x.rotate((r() - 0.5) * 1.2);
    const w = (150 + r() * 450) * s, h = (100 + r() * 350) * s;
    x.fillStyle = ['#f4f4f0', '#ffffff', '#2b4c7e', '#c94f3d', '#e8d27a', '#1d1d1f', '#5c8a4f'][i % 7]; x.fillRect(-w / 2, -h / 2, w, h);
    if (i % 7 < 2) { x.fillStyle = '#555'; for (let l = 0; l < h / (18 * s) - 2; l++) x.fillRect(-w / 2 + 15 * s, -h / 2 + (15 + l * 18) * s, (w - 30 * s) * (0.5 + 0.5 * r()), 4 * s); }
    x.restore();
  }
  x.save(); x.translate(W * 0.15, H * 0.85); x.rotate(-0.08); // keyboard
  x.fillStyle = '#222'; x.fillRect(0, 0, 700 * s, 220 * s); x.fillStyle = '#444';
  for (let ky = 0; ky < 5; ky++) for (let kx = 0; kx < 15; kx++) x.fillRect((10 + kx * 45) * s, (10 + ky * 42) * s, 38 * s, 36 * s);
  x.restore();
  x.lineCap = 'round';
  for (let i = 0; i < 4; i++) { x.strokeStyle = ['#1a3dbd', '#111', '#d03030', '#f0c000'][i]; x.lineWidth = 12 * s; x.beginPath(); const px = r() * W, py = r() * H, a = r() * 6.28; x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 300 * s, py + Math.sin(a) * 300 * s); x.stroke(); }
  const d = x.getImageData(0, 0, W, H).data;
  return (px, py) => { const i = (py * W + px) * 4; return [d[i], d[i + 1], d[i + 2]]; };
}

/** A table edge: two surfaces split by a strong straight line close to the card. */
const tableEdge = (W, H) => (x, y) => (y > 0.82 * H + 0.05 * x ? [40, 40, 45] : wood(x, y));

/** Fingers (skin-coloured capsules) entering from a side and covering part of the card edge. */
const fingers = (pts) => (ctx, W, H) => {
  const s = W / 1600;
  for (const [x0, y0, x1, y1] of pts) {
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = '#c98d72'; ctx.lineWidth = 95 * s; ctx.beginPath(); ctx.moveTo(x0 * s, y0 * s); ctx.lineTo(x1 * s, y1 * s); ctx.stroke();
    ctx.strokeStyle = '#e0a98c'; ctx.lineWidth = 70 * s; ctx.beginPath(); ctx.moveTo(x0 * s, y0 * s); ctx.lineTo(x1 * s, y1 * s); ctx.stroke();
    ctx.restore();
  }
};

/** A specular reflection: a bright soft blob (washes out part of the card and its edge). */
const glare = (cx, cy, r) => (ctx, W) => {
  const s = W / 1600, g = ctx.createRadialGradient(cx * s, cy * s, 0, cx * s, cy * s, r * s);
  g.addColorStop(0, 'rgba(255,255,255,0.97)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, ctx.canvas.height);
};

/** Uneven light: brighter at one corner, vignetting at the edges. */
const uneven = (W, H) => (x, y) => { const dx = x / W - 0.3, dy = y / H - 0.25; return Math.max(0.45, 1.15 - 0.9 * (dx * dx + dy * dy)); };

const sc = (q, f) => q.map(p => [p[0] * f, p[1] * f]);
const P = 4032 / 1600; // 12 MP phone photo scale

/** [name, card, W, H, corners, background (fn(x, y) or { make(W, H) }), options] */
const SPECIMEN_CASES = [
  ['v4 front · wood', 'v4f', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], wood],
  ['v4 back · desk + shadow', 'v4b', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk, { shadow: true }],
  ['v3 front · fabric', 'v3f', 1600, 1200, [[380, 260], [1240, 300], [1230, 840], [360, 820]], fabric],
  ['v4 front · white desk, no shadow', 'v4f', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk],
  ['v3 back · white desk, no shadow', 'v3b', 1600, 1200, [[330, 320], [1280, 260], [1330, 860], [360, 930]], desk],
  ['v4 front · checkerboard', 'v4f', 1600, 1200, [[400, 300], [1200, 350], [1180, 860], [380, 800]], grid],
  ['v3 back · checkerboard, rotated', 'v3b', 1600, 1200, [[520, 180], [1160, 420], [980, 900], [340, 660]], grid],
  ['v4 front · cluttered desk', 'v4f', 1600, 1200, [[420, 280], [1180, 320], [1160, 800], [400, 770]], { make: (W, H) => clutter(W, H, 7) }],
  ['v4 back · cluttered, small', 'v4b', 1600, 1200, [[650, 450], [1010, 470], [1000, 700], [640, 680]], { make: (W, H) => clutter(W, H, 11) }],
  ['v3 front · small, dark', 'v3f', 1600, 1200, [[700, 500], [1050, 520], [1040, 740], [690, 720]], dark],
  ['v4 front · strong perspective', 'v4f', 1600, 1200, [[450, 300], [1150, 330], [1400, 1000], [200, 950]], fabric],
  ['v4 front · table edge below', 'v4f', 1600, 1200, [[360, 260], [1240, 290], [1220, 850], [340, 830]], { make: tableEdge }],
  ['v4 front · glare on corner', 'v4f', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], wood, { overlay: glare(1200, 340, 260) }],
  ['v4 back · glare in centre', 'v4b', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], dark, { overlay: glare(800, 560, 330) }],
  ['v4 front · fingers on left edge', 'v4f', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], fabric, { overlay: fingers([[0, 480, 420, 470], [0, 600, 430, 600]]) }],
  ['v3 front · thumb over a corner', 'v3f', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], wood, { overlay: fingers([[1600, 1150, 1180, 870]]) }],
  ['v4 front · uneven light + blur', 'v4f', 1600, 1200, [[380, 260], [1240, 300], [1230, 840], [360, 820]], wood, { light: uneven(1600, 1200), blur: 2.5 }],
  ['v4 front · 12 MP phone, wood', 'v4f', 4032, 3024, sc([[350, 250], [1250, 330], [1210, 900], [300, 820]], P), wood, { noise: 20 }],
  ['v4 back · 12 MP phone, clutter', 'v4b', 4032, 3024, sc([[420, 280], [1180, 320], [1160, 800], [400, 770]], P), { make: (W, H) => clutter(W, H, 3) }, { noise: 20 }],
  ['v3 front · 12 MP portrait, fabric', 'v3f', 3024, 4032, sc([[900, 250], [950, 1350], [300, 1330], [260, 260]], P), fabric, { noise: 20 }],
];

/**
 * Real photos with hand-marked corners (tools/mark-corners.html), if there are any: tests/private/
 * is git-ignored and never committed. [] when the folder or its photos.js doesn't exist.
 * @returns {Promise<{ file: string, corners: number[][] }[]>}
 */
async function privatePhotos() {
  try { return (await import('/tests/private/photos.js')).default; } catch { return []; }
}

const CARD_URLS = { v4f: 'dni_es_v4_front', v4b: 'dni_es_v4_back', v3f: 'dni_es_v3_front', v3b: 'dni_es_v3_back' };

/**
 * Render every case and time the detector on it.
 * @param {(c: HTMLCanvasElement) => ({ quad: number[][] } | null)} detectCard
 * @param {{ only?: string, reps?: number }} opts
 */
export async function runBench(detectCard, opts = {}) {
  const cards = { fake: makeCard() };
  for (const [k, f] of Object.entries(CARD_URLS)) cards[k] = await loadCard(`/templates/ref/${f}.webp`);
  const all = [
    ...CASES.map(([name, W, H, q, bg, o = {}]) => [`fake · ${name}`, 'fake', W, H, q, bg, o]),
    ...SPECIMEN_CASES,
  ];
  const reps = opts.reps ?? 3, out = [];
  for (const c of await privatePhotos()) all.push([`photo · ${c.file}`, null, 0, 0, null, null, { photo: c }]);
  for (const [name, cardKey, W0, H0, q0, bgDef, o = {}] of all) {
    if (opts.only && !name.includes(opts.only)) continue;
    let s, W = W0, H = H0, q = q0;
    if (o.photo) {
      const img = new Image(); img.src = `/tests/private/${encodeURIComponent(o.photo.file)}`; await img.decode();
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)); // as the app (ui/image-file.js)
      W = Math.round(img.naturalWidth * k); H = Math.round(img.naturalHeight * k);
      s = document.createElement('canvas'); s.width = W; s.height = H; s.getContext('2d').drawImage(img, 0, 0, W, H);
      q = o.photo.corners.map(([u, v]) => [u * W, v * H]);
    } else s = scene(cards[cardKey], W, H, q, bgDef.make ? bgDef.make(W, H) : bgDef, o);
    const times = []; let r = null;
    for (let i = 0; i < reps; i++) { const t0 = performance.now(); r = detectCard(s); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b);
    const err = r ? cornerError(r.quad, q) : null;
    const cardDiag = Math.hypot(q[0][0] - q[2][0], q[0][1] - q[2][1]);
    out.push({
      name, W, H, truth: q, quad: r ? r.quad : null, found: !!r,
      errPct: err == null ? null : 100 * err / Math.hypot(W, H), // the spec's metric (% of the photo diagonal)
      errCard: err == null ? null : 100 * err / cardDiag, // what the straightened card actually suffers
      ms: times[Math.floor(times.length / 2)],
    });
  }
  return out;
}
