// Idle pose in the game camera after facing several directions: CLS=.. node tools/idleplay.mjs <outPrefix>
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const out = process.argv[2] || 'shots/v3/idle';
const url = pathToFileURL(path.resolve(import.meta.dirname, '..', 'index.html')).href + '?cls=' + (process.env.CLS || 'archer');
const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  for (const k of ['s', 'd', 'a', 'w']) {
    await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k); await page.waitForTimeout(1300);
    const c = await page.evaluate(() => { const v = window.__knight.root.position.clone().setY(1.0).project(window.__camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; });
    await page.screenshot({ path: `${out}_${k}.png`, clip: { x: c.x - 170, y: c.y - 190, width: 340, height: 300 } });
  }
} finally { await browser.close(); }
