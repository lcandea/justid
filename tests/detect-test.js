'use strict';
// Genera fotos sintéticas de una tarjeta ficticia y comprueba el detector.

function makeCard() {
  const c = document.createElement('canvas'); c.width = 856; c.height = 540; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 856, 540); g.addColorStop(0, '#dfeadf'); g.addColorStop(1, '#efe3d2');
  x.fillStyle = g; x.fillRect(0, 0, 856, 540);
  x.fillStyle = '#b8323a'; x.fillRect(0, 0, 856, 60);
  x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'; x.fillText('DOCUMENTO FICTICIO DE PRUEBA', 20, 42);
  x.fillStyle = '#888'; x.fillRect(25, 120, 230, 300);
  x.fillStyle = '#222'; x.font = '28px sans-serif';
  for (let i = 0; i < 7; i++) x.fillText('APELLIDO NOMBRE 12345 ' + i, 290, 130 + i * 45);
  x.font = '22px monospace';
  for (let i = 0; i < 3; i++) x.fillText('IDESPAAA000000<<<<<<<<<<<<<<<<', 25, 460 + i * 28);
  return c;
}
const CARD = makeCard();
const CD = CARD.getContext('2d').getImageData(0, 0, 856, 540).data;

function scene(W, H, corners, bg, opts = {}) {
  const out = new ImageData(W, H), o = out.data;
  const h = homography(corners, [[0, 0], [856, 0], [856, 540], [0, 540]]);
  const R = 30, noise = opts.noise ?? 14;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const den = h[6] * x + h[7] * y + 1, u = (h[0] * x + h[1] * y + h[2]) / den, v = (h[3] * x + h[4] * y + h[5]) / den;
    const i = (y * W + x) * 4; let r, g, b;
    let inside = u >= 0 && v >= 0 && u < 856 && v < 540;
    if (inside) { const a = Math.min(u, 856 - u), c = Math.min(v, 540 - v); if (a < R && c < R && Math.hypot(R - a, R - c) > R) inside = false; }
    if (inside) { const j = ((v | 0) * 856 + (u | 0)) * 4; r = CD[j]; g = CD[j + 1]; b = CD[j + 2]; }
    else {
      [r, g, b] = bg(x, y);
      if (opts.shadow) { // sombra suave junto a la tarjeta
        const d = Math.min(Math.abs(u < 0 ? u : u > 856 ? u - 856 : 0) + Math.abs(v < 0 ? v : v > 540 ? v - 540 : 0), 40);
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

const CASES = [
  ['madera, ligera rotación', 1600, 1200, [[350, 250], [1250, 330], [1210, 900], [300, 820]], wood],
  ['mesa blanca con sombra', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk, { shadow: true }],
  ['mesa blanca sin sombra (muy difícil)', 1600, 1200, [[300, 300], [1300, 280], [1320, 920], [290, 930]], desk, { hard: true }],
  ['cuadrícula', 1600, 1200, [[400, 300], [1200, 350], [1180, 860], [380, 800]], grid],
  ['tela con textura', 1600, 1200, [[380, 260], [1240, 300], [1230, 840], [360, 820]], fabric],
  ['pequeña en encuadre', 1600, 1200, [[700, 500], [1050, 520], [1040, 740], [690, 720]], dark],
  ['perspectiva fuerte', 1600, 1200, [[450, 300], [1150, 330], [1400, 1000], [200, 950]], wood],
  ['foto vertical, tarjeta girada', 1200, 1600, [[900, 250], [950, 1350], [300, 1330], [260, 260]], dark],
  ['ocupa casi todo', 1600, 1200, [[60, 70], [1540, 50], [1550, 1130], [50, 1140]], dark],
];

function run() {
  const out = $('#out'), results = [];
  let pass = 0, required = 0;
  for (const [name, W, H, q, bg, opts = {}] of CASES) {
    const s = scene(W, H, q, bg, opts);
    const t0 = performance.now(); const r = detectCard(s); const ms = Math.round(performance.now() - t0);
    let err = null;
    if (r) {
      err = Infinity;
      for (let k = 0; k < 4; k++) err = Math.min(err, Math.max(...r.quad.map((p, i) => Math.hypot(p[0] - q[(i + k) % 4][0], p[1] - q[(i + k) % 4][1]))));
    }
    const errPct = err == null ? null : 100 * err / Math.hypot(W, H);
    const ok = errPct != null && errPct < 1.5;
    if (!opts.hard) { required++; if (ok) pass++; }
    results.push({ name, ms, found: !!r, errPct: errPct == null ? null : +errPct.toFixed(2), ok, hard: !!opts.hard });
    const ctx = s.getContext('2d'); ctx.lineWidth = 8;
    const poly = (p, c) => { ctx.strokeStyle = c; ctx.beginPath(); p.forEach((pt, i) => i ? ctx.lineTo(...pt) : ctx.moveTo(...pt)); ctx.closePath(); ctx.stroke(); };
    poly(q, '#22c55e'); if (r) poly(r.quad, '#e11d48');
    out.append(el('div', {}, s, el('div', { class: ok ? 'pass' : 'fail' },
      `${ok ? '✔' : '✘'} ${name}${opts.hard ? ' (opcional)' : ''} — ${r ? `error ${errPct.toFixed(2)} %` : 'no detectada'} · ${ms} ms`)));
  }
  $('#sum').textContent = `${pass}/${required} casos obligatorios correctos`;
  window.__results = results;
}
run();
