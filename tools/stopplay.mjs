// Run -> stop in the real game camera, crops of the feet each ~60ms after releasing the key.  CLS=archer node tools/stopplay.mjs out key
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/stop', key = process.argv[3] || 'd';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + (process.env.CLS || 'warrior');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.keyboard.down(key); await page.waitForTimeout(1100); await page.keyboard.up(key);
  for (let i = 0; i < 12; i++) {
    const c = await page.evaluate(() => { const v = window.__knight.root.position.clone().setY(0.4).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
    await page.screenshot({ path: `${out}_${String(i).padStart(2, '0')}.png`, clip: { x: c.x - 170, y: c.y - 200, width: 340, height: 300 } });
    await page.waitForTimeout(50);
  }
} finally { await browser.close(); }
