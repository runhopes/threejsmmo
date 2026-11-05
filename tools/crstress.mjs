// Stress test in the showcase: N creatures with the game's LOD / update-rate policy; reports fps, update ms, draw calls.
// node tools/crstress.mjs [sp=all] [out.png]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const sp = process.argv[2] || 'all', out = process.argv[3] || 'shots/creatures/stress.png';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'creatures.html')).href + '?sp=' + sp + '&ui=1';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'ready' || document.title === 'ERR');
  await page.waitForTimeout(1500);
  const base = await page.evaluate(() => document.getElementById('info').textContent);
  await page.click('#stress');
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => document.getElementById('info').textContent);
  // CPU cost of one simulation+animation step for all creatures, measured directly (no rendering)
  const ms = await page.evaluate(() => { const t0 = performance.now(); for (let i = 0; i < 60; i++) __show.simStep(1 / 60); return (performance.now() - t0) / 60; });
  await page.screenshot({ path: out });
  console.log('--- before stress ---\n' + base.split('\n').slice(0, 3).join('\n'));
  console.log('--- with stress ---\n' + info);
  console.log('measured update step: ' + ms.toFixed(2) + ' ms / frame (all creatures, animation only)');
} finally { await browser.close(); }
