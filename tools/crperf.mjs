// In-game creature cost: walks through the camps and samples renderer stats + the creature update time.
// node tools/crperf.mjs
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=warrior';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // wrap the creature update to time it
  await page.evaluate(() => {
    const W = __creatures, f = W.update; window.__crT = []; 
    W.update = function (dt, p) { const t0 = performance.now(); f(dt, p); __crT.push(performance.now() - t0); };
  });
  const sample = async (label) => {
    await page.evaluate(() => { __crT.length = 0; });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const T = __crT.slice().sort((a, b) => a - b), avg = T.reduce((s, x) => s + x, 0) / T.length;
      const R = __knight.root.parent; let calls = 0;
      return { frames: T.length, avg: avg.toFixed(3), p95: T[Math.floor(T.length * 0.95)].toFixed(3), stats: __creatures.stats(), pos: [__knight.root.position.x.toFixed(1), __knight.root.position.z.toFixed(1)] };
    });
    console.log(label.padEnd(14), 'creature update avg', r.avg, 'ms  p95', r.p95, 'ms  frames/1.5s', r.frames, ' views', r.stats.views, 'on-screen', r.stats.onScreen, ' at', r.pos.join(','));
  };
  await sample('spawn');
  for (const [k, ms, label] of [['w', 2600, 'rats/rabbits'], ['w', 3500, 'reeds'], ['a', 2600, 'wolves']]) {
    await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k);
    await sample(label);
  }
  const info = await page.evaluate(() => { const r = __knight; return null; });
} finally { await browser.close(); }
