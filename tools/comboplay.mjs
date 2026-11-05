// Warrior 3-hit combo in the real game camera: crops every ~45 ms.   node tools/comboplay.mjs <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/combo';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=warrior';
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
let errs = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => { errs++; console.log('pageerror: ' + e.message); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await page.keyboard.down('s'); await page.waitForTimeout(500); await page.keyboard.up('s'); await page.waitForTimeout(700);   // room to swing
  const c = await page.evaluate(() => { const v = window.__knight.root.position.clone().setY(1.1).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
  await page.mouse.move(c.x, c.y - 150);
  let n = 0;
  for (let i = 0; i < 28; i++) {
    if (i === 0 || i === 7 || i === 14) { await page.mouse.down(); await page.mouse.up(); }
    await page.screenshot({ path: `${out}_${String(i).padStart(2, '0')}.png`, clip: { x: c.x - 220, y: c.y - 230, width: 440, height: 340 } });
    await page.waitForTimeout(45);
  }
} finally { await browser.close(); }
console.log('page errors', errs);
