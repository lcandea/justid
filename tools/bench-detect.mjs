#!/usr/bin/env node
// Card detector benchmark: accuracy per scene, failure rate and time per photo.
// Runs tests/e2e/fixtures/bench.js in real browsers (installed Chrome and Playwright's WebKit).
//
//   npm run bench-detect                              # Chrome + WebKit + Chrome with 4× CPU throttling (phone-ish)
//   npm run bench-detect -- --only "12 MP"            # just the cases whose name contains this
//   npm run bench-detect -- --detector /path/to/detect.js   # another module exporting detectCard (served from the repo)
//   npm run bench-detect -- --json out.json           # also write the raw results
//
// A case fails when the card isn't found or the worst corner is off by ≥ 1.5% of the photo
// diagonal (the e2e test's threshold). "card%" is the same error relative to the card diagonal.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = 8767, BASE = `http://localhost:${PORT}`;
const detector = arg('--detector', '/app/js/core/detect.js');
const only = arg('--only');
const targets = (arg('--targets', 'chrome,webkit,chrome-4x')).split(',');

const server = spawn('python3', ['tools/serve.py', String(PORT)], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/app/`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

const all = {};
for (const target of targets) {
  const browser = target.startsWith('chrome') ? await chromium.launch({ channel: 'chrome' }) : await webkit.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/app/`);
  if (target === 'chrome-4x') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  all[target] = await page.evaluate(async ({ detector, only }) => {
    const { detectCard } = await import(detector);
    const { runBench } = await import('/tests/e2e/fixtures/bench.js');
    return runBench(detectCard, { only });
  }, { detector, only });
  await browser.close();
}
stop();

const fail = r => !r.found || r.errPct >= 1.5;
const f = (v, d = 2) => v == null ? '  —  ' : v.toFixed(d).padStart(6);
const first = all[targets[0]];
console.log(`detector: ${detector}\n`);
console.log(`${'case'.padEnd(42)} ${'found'.padEnd(5)} ${'err%'.padStart(6)} ${'card%'.padStart(6)}  ${targets.map(t => (t + ' ms').padStart(13)).join(' ')}`);
first.forEach((r, i) => {
  const times = targets.map(t => f(all[t][i].ms, 0).padStart(13)).join(' ');
  console.log(`${(fail(r) ? '✗ ' : '  ') + r.name.padEnd(40)} ${(r.found ? 'yes' : 'NO').padEnd(5)} ${f(r.errPct)} ${f(r.errCard)}  ${times}`);
});
const fails = first.filter(fail).length;
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`\nfailures: ${fails}/${first.length} (${(100 * fails / first.length).toFixed(0)}%)`);
for (const t of targets) {
  const ms = all[t].map(r => r.ms);
  console.log(`${t.padEnd(10)} time per photo: median ${med(ms).toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms`);
}
const json = arg('--json');
if (json) writeFileSync(json, JSON.stringify({ detector, results: all }, null, 2));
